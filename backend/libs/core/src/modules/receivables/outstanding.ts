import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm'
import type { AgeingBucket, OpenBill, RetailerOutstanding } from '@dos/contracts'
import { businessDate, daysBetween } from '@dos/domain'
import { ageingSnapshots, retailerOutstandingSummary, retailers, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * `retailer_outstanding_summary` is the read surface for every "what does this shop owe" number (scale
 * rule 9): the owner tile, the rep's shop card, the accountant's follow-up list and the retailer app's
 * "my dues" all read ONE row and never scan the ledger. It is refreshed inside the same transaction as
 * every posting, so it cannot drift.
 *
 * TWO DEFINITIONS THAT EVERY READER MUST SHARE (they are what `seed-demo/receivables.ts` asserts):
 *  - `outstanding_paise` is GROSS: the sum of the open balances of the shop's bills.
 *  - money paid on account and not yet matched to a bill sits in `unallocated_credit_paise`.
 * So the identity that holds against the books is
 *     Σ(outstanding_paise − unallocated_credit_paise) == the AR balance in `journal_lines`,
 * NOT `Σ outstanding_paise == AR`.
 *
 * Ageing buckets are 0-7 / 8-15 / 16-30 / 31-60 / 61-90 / 90+ days past the bill's due date, measured on
 * IST business dates. A bill that is not due yet counts as current (bucket 0-7).
 */

export const AGEING_BUCKETS = [
  'b0_7',
  'b8_15',
  'b16_30',
  'b31_60',
  'b61_90',
  'b90plus',
] as const satisfies readonly AgeingBucket[]

export function bucketIndex(overdueDays: number): number {
  if (overdueDays <= 7) return 0
  if (overdueDays <= 15) return 1
  if (overdueDays <= 30) return 2
  if (overdueDays <= 60) return 3
  if (overdueDays <= 90) return 4
  return 5
}

export function bucketOf(overdueDays: number): AgeingBucket {
  return AGEING_BUCKETS[bucketIndex(overdueDays)] ?? 'b0_7'
}

const at = (values: readonly number[], i: number): number => values[i] ?? 0

/**
 * A parameterised `in (...)` list. drizzle's `sql` template hands a JS array to the driver as one bound
 * value, which Postgres then tries to read as an array literal, so `= any($1)` fails on a plain text[].
 */
export function idList(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )
}

export function bucketsOf(values: readonly number[]): RetailerOutstanding['buckets'] {
  return {
    b0_7: at(values, 0),
    b8_15: at(values, 1),
    b16_30: at(values, 2),
    b31_60: at(values, 3),
    b61_90: at(values, 4),
    b90plus: at(values, 5),
  }
}

/** An open bill with its due date already resolved (`due_date`, else invoice date + the shop's credit days). */
export interface OpenBillRow {
  id: string
  retailerId: string
  invoiceNo: string | null
  invoiceDate: string
  dueDate: string | null
  due: string
  totalPaise: number
  allocatedPaise: number
  cashDiscountBps: number
  cashDiscountUntil: string | null
  upiQrPayload: string | null
}

interface RawBill {
  id: string
  retailer_id: string
  invoice_no: string | null
  invoice_date: string
  due_date: string | null
  due: string
  total_paise: string | number
  allocated: string | number
  cash_discount_bps: number
  cash_discount_until: string | null
  upi_qr_payload: string | null
}

const num = (v: string | number | null): number => (v === null ? 0 : Number(v))

/**
 * Every bill of the tenant (or of the named shops) that still carries money, newest allocation state
 * included. `state IN ('issued','partially_paid')` is the definition of "open" everywhere in this module.
 */
export async function loadOpenBills(
  tx: Db,
  filter: { retailerIds?: readonly string[] } = {},
): Promise<OpenBillRow[]> {
  const { tenantId } = currentTenant()
  const scope = filter.retailerIds
    ? sql`and i.retailer_id in (${idList(filter.retailerIds)})`
    : sql``
  const result = await tx.execute(sql`
    select i.id, i.retailer_id, i.invoice_no,
           i.invoice_date::text as invoice_date,
           i.due_date::text as due_date,
           coalesce(i.due_date, (i.invoice_date + make_interval(days => r.credit_days)))::text as due,
           i.total_paise, coalesce(a.allocated, 0) as allocated,
           i.cash_discount_bps, i.cash_discount_until::text as cash_discount_until,
           i.upi_qr_payload
      from invoices i
      join retailers r on r.id = i.retailer_id and r.tenant_id = i.tenant_id
      left join lateral (
        select sum(al.amount_paise) as allocated
          from allocations al
         where al.tenant_id = i.tenant_id and al.invoice_id = i.id) a on true
     where i.tenant_id = ${tenantId}
       and i.state in ('issued', 'partially_paid')
       ${scope}
     order by due asc, i.invoice_date asc, i.invoice_no asc nulls last, i.id asc`)
  return (result.rows as unknown as RawBill[]).map((row) => ({
    id: row.id,
    retailerId: row.retailer_id,
    invoiceNo: row.invoice_no,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    due: row.due,
    totalPaise: num(row.total_paise),
    allocatedPaise: num(row.allocated),
    cashDiscountBps: row.cash_discount_bps,
    cashDiscountUntil: row.cash_discount_until,
    upiQrPayload: row.upi_qr_payload,
  }))
}

export const openPaiseOf = (bill: OpenBillRow): number =>
  Math.max(0, bill.totalPaise - bill.allocatedPaise)

export function toOpenBill(bill: OpenBillRow, asOf: string): OpenBill {
  const ageDays = daysBetween(bill.due, asOf)
  return {
    id: bill.id,
    invoiceNo: bill.invoiceNo,
    invoiceDate: bill.invoiceDate,
    dueDate: bill.dueDate ?? bill.due,
    totalPaise: bill.totalPaise,
    openPaise: openPaiseOf(bill),
    ageDays,
    bucket: bucketOf(ageDays),
    cashDiscountBps: bill.cashDiscountBps,
    cashDiscountUntil: bill.cashDiscountUntil,
  }
}

interface RawCredit {
  retailer_id: string
  unallocated: string | number | null
  last_receipt_at: string | Date | null
  last_receipt_paise: string | number | null
}

/**
 * On-account money per shop: everything the shop has handed over (cash plus any cash discount it earned,
 * because a realised discount also closes bill value) minus everything already matched to a bill. A
 * reversal receipt carries a negative amount and negative mirror allocations, so it nets itself out.
 */
async function loadCredit(
  tx: Db,
  retailerIds: readonly string[],
): Promise<
  Map<string, { unallocated: number; lastReceiptAt: Date | null; lastPaise: number | null }>
> {
  const { tenantId } = currentTenant()
  if (retailerIds.length === 0) return new Map()
  const result = await tx.execute(sql`
    select r.retailer_id,
           sum(r.amount_paise + r.cash_discount_paise) - coalesce(sum(al.allocated), 0) as unallocated,
           max(r.received_at) filter (where r.amount_paise > 0) as last_receipt_at,
           (array_agg(r.amount_paise order by r.received_at desc)
              filter (where r.amount_paise > 0))[1] as last_receipt_paise
      from receipts r
      left join lateral (
        select sum(a.amount_paise) as allocated
          from allocations a
         where a.tenant_id = r.tenant_id and a.receipt_id = r.id) al on true
     where r.tenant_id = ${tenantId} and r.retailer_id in (${idList(retailerIds)})
     group by r.retailer_id`)
  const map = new Map<
    string,
    { unallocated: number; lastReceiptAt: Date | null; lastPaise: number | null }
  >()
  for (const row of result.rows as unknown as RawCredit[]) {
    map.set(row.retailer_id, {
      unallocated: num(row.unallocated),
      lastReceiptAt: row.last_receipt_at === null ? null : new Date(row.last_receipt_at),
      lastPaise: row.last_receipt_paise === null ? null : num(row.last_receipt_paise),
    })
  }
  return map
}

export type OutstandingRow = typeof retailerOutstandingSummary.$inferInsert

/**
 * The summary row a shop would have right now, computed from its bills and its receipts. Pure: it writes
 * nothing, so a read-only surface (and a `retailer` actor, who may not write the table) can use it.
 */
export async function computeOutstanding(
  tx: Db,
  retailerIds: readonly string[],
  asOf: string = businessDate().date,
): Promise<Map<string, OutstandingRow>> {
  const { tenantId } = currentTenant()
  const bills = await loadOpenBills(tx, { retailerIds })
  const credit = await loadCredit(tx, retailerIds)
  const out = new Map<string, OutstandingRow>()
  for (const retailerId of retailerIds) {
    const mine = bills.filter((b) => b.retailerId === retailerId && openPaiseOf(b) > 0)
    const buckets = [0, 0, 0, 0, 0, 0]
    let overdue = 0
    let oldestDue: string | null = null
    let oldestInvoice: string | null = null
    for (const bill of mine) {
      const open = openPaiseOf(bill)
      const i = bucketIndex(daysBetween(bill.due, asOf))
      buckets[i] = at(buckets, i) + open
      if (bill.due < asOf) overdue += open
      if (!oldestDue || bill.due < oldestDue) oldestDue = bill.due
      if (!oldestInvoice || bill.invoiceDate < oldestInvoice) oldestInvoice = bill.invoiceDate
    }
    const c = credit.get(retailerId)
    out.set(retailerId, {
      tenantId,
      retailerId,
      outstandingPaise: mine.reduce((s, b) => s + openPaiseOf(b), 0),
      overduePaise: overdue,
      unallocatedCreditPaise: c?.unallocated ?? 0,
      openBills: mine.length,
      oldestDueDate: oldestDue,
      oldestInvoiceDate: oldestInvoice,
      lastReceiptAt: c?.lastReceiptAt ?? null,
      lastReceiptPaise: c?.lastPaise ?? null,
      bucket0to7Paise: at(buckets, 0),
      bucket8to15Paise: at(buckets, 1),
      bucket16to30Paise: at(buckets, 2),
      bucket31to60Paise: at(buckets, 3),
      bucket61to90Paise: at(buckets, 4),
      bucket90PlusPaise: at(buckets, 5),
      asOf,
    })
  }
  return out
}

/** UPDATE-first upsert of the rollup. Staff only: the table is `staffWritePolicy` at the database. */
export async function writeOutstanding(tx: Db, rows: OutstandingRow[]): Promise<void> {
  if (rows.length === 0) return
  await tx
    .insert(retailerOutstandingSummary)
    .values(rows)
    .onConflictDoUpdate({
      target: [retailerOutstandingSummary.tenantId, retailerOutstandingSummary.retailerId],
      set: {
        outstandingPaise: sql`excluded.outstanding_paise`,
        overduePaise: sql`excluded.overdue_paise`,
        unallocatedCreditPaise: sql`excluded.unallocated_credit_paise`,
        openBills: sql`excluded.open_bills`,
        oldestDueDate: sql`excluded.oldest_due_date`,
        oldestInvoiceDate: sql`excluded.oldest_invoice_date`,
        lastReceiptAt: sql`excluded.last_receipt_at`,
        lastReceiptPaise: sql`excluded.last_receipt_paise`,
        bucket0to7Paise: sql`excluded.bucket_0_7_paise`,
        bucket8to15Paise: sql`excluded.bucket_8_15_paise`,
        bucket16to30Paise: sql`excluded.bucket_16_30_paise`,
        bucket31to60Paise: sql`excluded.bucket_31_60_paise`,
        bucket61to90Paise: sql`excluded.bucket_61_90_paise`,
        bucket90PlusPaise: sql`excluded.bucket_90_plus_paise`,
        asOf: sql`excluded.as_of`,
        updatedAt: new Date(),
      },
    })
}

export function toRetailerOutstanding(row: OutstandingRow): RetailerOutstanding {
  return {
    retailerId: row.retailerId,
    outstandingPaise: row.outstandingPaise ?? 0,
    overduePaise: row.overduePaise ?? 0,
    unallocatedCreditPaise: row.unallocatedCreditPaise ?? 0,
    openBills: row.openBills ?? 0,
    oldestDueDate: row.oldestDueDate ?? null,
    oldestInvoiceDate: row.oldestInvoiceDate ?? null,
    lastReceiptAt: row.lastReceiptAt ? row.lastReceiptAt.toISOString() : null,
    lastReceiptPaise: row.lastReceiptPaise ?? null,
    buckets: bucketsOf([
      row.bucket0to7Paise ?? 0,
      row.bucket8to15Paise ?? 0,
      row.bucket16to30Paise ?? 0,
      row.bucket31to60Paise ?? 0,
      row.bucket61to90Paise ?? 0,
      row.bucket90PlusPaise ?? 0,
    ]),
    asOf: row.asOf,
  }
}

/**
 * Recompute and store one shop's rollup. Called in the SAME transaction as every posting, which is what
 * makes "the summary can never drift from the ledger" true rather than eventually true.
 */
export async function refreshOutstandingFor(
  tx: Db,
  retailerIds: readonly string[],
  asOf: string = businessDate().date,
): Promise<Map<string, OutstandingRow>> {
  const ids = [...new Set(retailerIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return new Map()
  const rows = await computeOutstanding(tx, ids, asOf)
  await writeOutstanding(tx, [...rows.values()])
  return rows
}

/**
 * The stored rollup, or a computed one when the shop has never had a posting (a brand-new distributor, or
 * a tenant seeded before this module existed). Never writes, so a retailer actor may call it.
 */
export async function loadOutstanding(
  tx: Db,
  retailerId: string,
  asOf: string = businessDate().date,
): Promise<RetailerOutstanding> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select()
    .from(retailerOutstandingSummary)
    .where(
      and(
        eq(retailerOutstandingSummary.tenantId, tenantId),
        eq(retailerOutstandingSummary.retailerId, retailerId),
      ),
    )
    .limit(1)
  if (row) return toRetailerOutstanding(row)
  const computed = await computeOutstanding(tx, [retailerId], asOf)
  const fresh = computed.get(retailerId)
  if (!fresh) {
    return toRetailerOutstanding({ tenantId, retailerId, asOf })
  }
  return toRetailerOutstanding(fresh)
}

/** One page of the tenant's retailers, keyed on id so the ageing rebuild walks them in bounded batches. */
export async function retailerIdPage(
  tx: Db,
  cursor: string | null,
  limit: number,
): Promise<string[]> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({ id: retailers.id })
    .from(retailers)
    .where(
      and(eq(retailers.tenantId, tenantId), cursor === null ? undefined : gt(retailers.id, cursor)),
    )
    .orderBy(asc(retailers.id))
    .limit(limit)
  return rows.map((r) => r.id)
}

/**
 * The day's ageing register. `bucket_60_plus_paise` is the legacy roll-up docs/01 promises the owner and is
 * always `bucket_61_90 + bucket_90_plus` — a spec asserts the identity.
 */
export async function writeAgeingSnapshot(
  tx: Db,
  asOf: string,
  rows: readonly OutstandingRow[],
): Promise<void> {
  if (rows.length === 0) return
  const values = rows.map((row) => ({
    tenantId: row.tenantId,
    retailerId: row.retailerId,
    asOf,
    outstandingPaise: row.outstandingPaise ?? 0,
    bucket0to7Paise: row.bucket0to7Paise ?? 0,
    bucket8to15Paise: row.bucket8to15Paise ?? 0,
    bucket16to30Paise: row.bucket16to30Paise ?? 0,
    bucket31to60Paise: row.bucket31to60Paise ?? 0,
    bucket60PlusPaise: (row.bucket61to90Paise ?? 0) + (row.bucket90PlusPaise ?? 0),
    bucket61to90Paise: row.bucket61to90Paise ?? 0,
    bucket90PlusPaise: row.bucket90PlusPaise ?? 0,
    overduePaise: row.overduePaise ?? 0,
    unallocatedCreditPaise: row.unallocatedCreditPaise ?? 0,
    openBills: row.openBills ?? 0,
    oldestDueDate: row.oldestDueDate ?? null,
    computedAt: new Date(),
  }))
  await tx
    .insert(ageingSnapshots)
    .values(values)
    .onConflictDoUpdate({
      target: [ageingSnapshots.tenantId, ageingSnapshots.retailerId, ageingSnapshots.asOf],
      set: {
        outstandingPaise: sql`excluded.outstanding_paise`,
        bucket0to7Paise: sql`excluded.bucket_0_7_paise`,
        bucket8to15Paise: sql`excluded.bucket_8_15_paise`,
        bucket16to30Paise: sql`excluded.bucket_16_30_paise`,
        bucket31to60Paise: sql`excluded.bucket_31_60_paise`,
        bucket60PlusPaise: sql`excluded.bucket_60_plus_paise`,
        bucket61to90Paise: sql`excluded.bucket_61_90_paise`,
        bucket90PlusPaise: sql`excluded.bucket_90_plus_paise`,
        overduePaise: sql`excluded.overdue_paise`,
        unallocatedCreditPaise: sql`excluded.unallocated_credit_paise`,
        openBills: sql`excluded.open_bills`,
        oldestDueDate: sql`excluded.oldest_due_date`,
        computedAt: sql`excluded.computed_at`,
      },
    })
}
