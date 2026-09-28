import { sql } from 'drizzle-orm'
import type { Allocation, SettledInvoice } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import { allocations, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { recomputeInvoiceStates } from './allocation.js'
import { idList, loadOpenBills, openPaiseOf } from './outstanding.js'
import { emitEvent } from './posting.js'
import { toAllocation } from './receivables.mappers.js'

/**
 * MONEY ON ACCOUNT IS USED (QA DOS-312, P1; architect ruling 2026-09-28, docs/22 §8 "money and credit" (3)).
 *
 * A shop's money on account — what its receipts and credit notes hold that no bill has claimed — waited for an
 * accountant to allocate it by hand, while its bills aged, counted overdue and counted in full against the limit:
 * R-9034 was ₹405.00 in credit and breached by ₹190.00; 14 seeded shops held ₹35,380.00 beside overdue bills.
 *
 * `applyMoneyOnAccount` applies it to the shop's open bills, OLDEST MONEY TO THE OLDEST BILL — the order FIFO
 * pays a receipt in (`loadOpenBills`: due date, bill date, number). Each application is an allocation exactly
 * like one the desk makes by hand (`allocations.create`): an `allocations` row from the receipt or the credit note,
 * no journal rows (the money was credited to AR when it arrived), the bill's payment state re-derived, visible on
 * the bill and on its source, undone by `allocations.remove`. It runs:
 *   * when a receipt leaves money over while bills are open (an explicit split that named fewer bills than the
 *     money covers; FIFO never leaves any) — that receipt only;
 *   * when a credit note on a paid bill leaves money on account (`postCreditNoteIssued`) — that note only;
 *   * when a NEW bill is issued for a shop that holds money on account (`postInvoiceIssued`, which billing calls
 *     inside its own transaction at pack and at a van sale) — all of it;
 *   * when the desk presses "Apply money on account" (`allocations.applyOnAccount`) for one shop or all — for
 *     money that already sat on account before this rule; nothing is applied by a migration.
 * A bill on a van is not the shop's dues yet and is left alone, as FIFO leaves it. The shop's money lock is taken
 * first, so two of these (or one and a receipt) for the same shop take turns.
 */

interface Source {
  kind: 'receipt' | 'credit_note'
  id: string
  freePaise: number
}

/** The per-shop money lock `recordReceipt` also takes before it spends a shop's money on its bills. */
export async function lockShopMoney(tx: Db, retailerId: string): Promise<void> {
  const { tenantId } = currentTenant()
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`shop-money:${tenantId}:${retailerId}`}))`,
  )
}

/** The shop's money on account, oldest first: receipts by when they came, credit notes by their date. */
async function moneyOnAccount(
  tx: Db,
  retailerId: string,
  only: { receiptIds?: readonly string[]; creditNoteIds?: readonly string[] } | null,
): Promise<Source[]> {
  const { tenantId } = currentTenant()
  const receiptScope =
    only === null
      ? sql``
      : only.receiptIds && only.receiptIds.length > 0
        ? sql`and r.id in (${idList(only.receiptIds)})`
        : sql`and false`
  const noteScope =
    only === null
      ? sql``
      : only.creditNoteIds && only.creditNoteIds.length > 0
        ? sql`and c.id in (${idList(only.creditNoteIds)})`
        : sql`and false`
  const result = await tx.execute(sql`
    select * from (
      select 'receipt' as kind, r.id, r.received_at as at,
             r.amount_paise + r.cash_discount_paise - coalesce(a.allocated, 0) as free
        from receipts r
        left join lateral (
          select sum(al.amount_paise) as allocated
            from allocations al
           where al.tenant_id = r.tenant_id and al.receipt_id = r.id) a on true
       where r.tenant_id = ${tenantId}
         and r.retailer_id = ${retailerId}
         and r.status in ('collected', 'deposited')
         and r.amount_paise > 0
         and r.reverses_receipt_id is null
         ${receiptScope}
      union all
      select 'credit_note', c.id, (c.note_date::timestamp at time zone 'Asia/Kolkata'),
             c.total_paise - coalesce(a.allocated, 0)
        from credit_notes c
        left join lateral (
          select sum(al.amount_paise) as allocated
            from allocations al
           where al.tenant_id = c.tenant_id and al.credit_note_id = c.id) a on true
       where c.tenant_id = ${tenantId}
         and c.retailer_id = ${retailerId}
         and c.state in ('issued', 'applied')
         ${noteScope}
    ) money
     where free > 0
     order by at asc, id asc`)
  return (
    result.rows as unknown as { kind: 'receipt' | 'credit_note'; id: string; free: string }[]
  ).map((row) => ({ kind: row.kind, id: row.id, freePaise: Number(row.free) }))
}

export interface AppliedOnAccount {
  retailerId: string
  appliedPaise: number
  allocations: Allocation[]
  invoices: SettledInvoice[]
}

/**
 * Applies the shop's money on account (all of it, or only the named receipts / credit notes) to its open bills,
 * oldest first. Writes allocations only; the caller refreshes the shop's rollup (or lets `recordReceipt` /
 * `postInvoiceIssued` do it with the rest of its work).
 */
export async function applyMoneyOnAccount(
  tx: Db,
  retailerId: string,
  only: { receiptIds?: readonly string[]; creditNoteIds?: readonly string[] } | null = null,
): Promise<AppliedOnAccount> {
  const { tenantId, actorId } = currentTenant()
  const none: AppliedOnAccount = { retailerId, appliedPaise: 0, allocations: [], invoices: [] }
  await lockShopMoney(tx, retailerId)
  const sources = await moneyOnAccount(tx, retailerId, only)
  if (sources.length === 0) return none
  const bills = (await loadOpenBills(tx, { retailerIds: [retailerId] })).filter(
    (bill) => openPaiseOf(bill) > 0,
  )
  if (bills.length === 0) return none
  const written: Allocation[] = []
  let applied = 0
  let s = 0
  for (const bill of bills) {
    let open = openPaiseOf(bill)
    while (open > 0 && s < sources.length) {
      const source = sources[s]
      if (!source) break
      const amount = Math.min(open, source.freePaise)
      const [row] = await tx
        .insert(allocations)
        .values({
          id: uuidv7(),
          tenantId,
          invoiceId: bill.id,
          receiptId: source.kind === 'receipt' ? source.id : null,
          creditNoteId: source.kind === 'credit_note' ? source.id : null,
          amountPaise: amount,
          allocatedBy: actorId,
        })
        .returning()
      if (row) written.push(toAllocation(row))
      applied += amount
      open -= amount
      source.freePaise -= amount
      if (source.freePaise <= 0) s += 1
    }
    if (s >= sources.length) break
  }
  if (written.length === 0) return none
  const invoiceIds = [...new Set(written.map((a) => a.invoiceId))]
  const settled = await recomputeInvoiceStates(tx, invoiceIds)
  await emitEvent(tx, 'retailer', retailerId, 'AllocationChanged', {
    reason: 'money_on_account_applied',
    appliedPaise: applied,
    invoiceIds,
    receiptIds: [...new Set(written.flatMap((a) => (a.receiptId ? [a.receiptId] : [])))],
    creditNoteIds: [...new Set(written.flatMap((a) => (a.creditNoteId ? [a.creditNoteId] : [])))],
  })
  return { retailerId, appliedPaise: applied, allocations: written, invoices: settled }
}

/**
 * The shops "Apply money on account for all shops" walks: those holding money on account beside open bills, by
 * the rollup every posting keeps (`retailer_outstanding_summary`), in id order, at most `limit` + 1 so the caller
 * can say there are more.
 */
export async function shopsWithMoneyOnAccount(tx: Db, limit: number): Promise<string[]> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select s.retailer_id
      from retailer_outstanding_summary s
     where s.tenant_id = ${tenantId}
       and s.unallocated_credit_paise > 0
       and s.outstanding_paise > 0
     order by s.retailer_id asc
     limit ${limit + 1}`)
  return (result.rows as unknown as { retailer_id: string }[]).map((row) => row.retailer_id)
}
