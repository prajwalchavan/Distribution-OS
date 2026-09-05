import { and, eq, inArray, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type { SettledInvoice } from '@dos/contracts'
import { invoiceMachine, paise, percentOf } from '@dos/domain'
import { allocations, cashDiscountConditions, invoices, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import type { OpenBillRow } from './outstanding.js'
import { idList, openPaiseOf } from './outstanding.js'

/**
 * Allocation: which money settles which bill, and the derived payment state that follows from it.
 *
 * `invoices.state` is written HERE and nowhere else (docs/plans/00-coordination.md §3.2): billing owns the
 * document, receivables owns the derived payment cache. The guarantee is not the import graph, it is the
 * `invoices_immutable` trigger from migration 0003, which lets only `state`, `due_date` and the document
 * keys change once a bill is issued.
 */

/** The three payment states a bill moves between as money arrives. `written_off` has its own event. */
export type PaymentState = 'issued' | 'partially_paid' | 'paid'

/**
 * The payment state is a pure function of "how much of this bill is settled", so it is derived by walking
 * `invoiceMachine` forward from `issued` — the state every bill is in the instant it is issued — rather
 * than by assigning a string. That is also what makes a REVERSAL work: un-receiving is not an event the
 * machine has (and `state-machines/invoice.ts` belongs to billing, coordination §3.9), but re-deriving from
 * the baseline walks the cache back down through the same transitions it walked up.
 */
export function derivePaymentState(allocatedPaise: number, totalPaise: number): PaymentState {
  if (allocatedPaise <= 0) return 'issued'
  const next = invoiceMachine.next(
    'issued',
    allocatedPaise >= totalPaise ? 'receive_full' : 'receive_partial',
  )
  return next as PaymentState
}

/** States whose payment cache receivables maintains. `draft`, `cancelled` and `written_off` are left alone. */
const DERIVED_STATES = new Set(['issued', 'partially_paid', 'paid'])

export interface InvoiceForAllocation {
  id: string
  invoiceNo: string | null
  retailerId: string
  state: string
  totalPaise: number
  allocatedPaise: number
}

interface RawInvoice {
  id: string
  invoice_no: string | null
  retailer_id: string
  state: string
  total_paise: string | number
  allocated: string | number | null
}

const num = (v: string | number | null): number => (v === null ? 0 : Number(v))

/** Bills with their live allocation total. One statement, however many bills a mutation touched. */
export async function loadInvoices(
  tx: Db,
  invoiceIds: readonly string[],
): Promise<Map<string, InvoiceForAllocation>> {
  const ids = [...new Set(invoiceIds)]
  const out = new Map<string, InvoiceForAllocation>()
  if (ids.length === 0) return out
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select i.id, i.invoice_no, i.retailer_id, i.state::text as state, i.total_paise,
           coalesce(a.allocated, 0) as allocated
      from invoices i
      left join lateral (
        select sum(al.amount_paise) as allocated
          from allocations al
         where al.tenant_id = i.tenant_id and al.invoice_id = i.id) a on true
     where i.tenant_id = ${tenantId} and i.id in (${idList(ids)})`)
  for (const row of result.rows as unknown as RawInvoice[]) {
    out.set(row.id, {
      id: row.id,
      invoiceNo: row.invoice_no,
      retailerId: row.retailer_id,
      state: row.state,
      totalPaise: num(row.total_paise),
      allocatedPaise: num(row.allocated),
    })
  }
  return out
}

export async function invoiceOpenPaise(tx: Db, invoiceId: string): Promise<number> {
  const found = await loadInvoices(tx, [invoiceId])
  const invoice = found.get(invoiceId)
  if (!invoice) throw new ORPCError('NOT_FOUND', { message: `invoice ${invoiceId} not found` })
  return invoice.totalPaise - invoice.allocatedPaise
}

/**
 * Re-derive and store the payment state of every bill a mutation touched, and report what each one now
 * owes. This is the ONLY place `invoices.state` is assigned.
 */
export async function recomputeInvoiceStates(
  tx: Db,
  invoiceIds: readonly string[],
): Promise<SettledInvoice[]> {
  const { tenantId } = currentTenant()
  const found = await loadInvoices(tx, invoiceIds)
  const out: SettledInvoice[] = []
  for (const invoice of found.values()) {
    const openPaise = invoice.totalPaise - invoice.allocatedPaise
    if (!DERIVED_STATES.has(invoice.state)) {
      out.push({
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        state: invoice.state as SettledInvoice['state'],
        openPaise,
      })
      continue
    }
    const next = derivePaymentState(invoice.allocatedPaise, invoice.totalPaise)
    if (next !== invoice.state) {
      // module-boundary: receivables owns the derived payment state, see docs/plans/00-coordination.md §3.2
      await tx
        .update(invoices)
        .set({ state: next, updatedAt: new Date() })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoice.id)))
    }
    out.push({ id: invoice.id, invoiceNo: invoice.invoiceNo, state: next, openPaise })
  }
  return out
}

/** A full write-off closes the bill through the machine's own `write_off` event, never by assignment. */
export async function markWrittenOff(tx: Db, invoiceId: string, fromState: string): Promise<void> {
  const { tenantId } = currentTenant()
  const next = invoiceMachine.next(fromState as 'issued' | 'partially_paid', 'write_off')
  if (next !== 'written_off') {
    throw new ORPCError('CONFLICT', {
      message: `bill ${invoiceId} cannot be written off from ${fromState}`,
    })
  }
  await tx
    .update(invoices)
    .set({ state: next, updatedAt: new Date() })
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
}

// ---------------------------------------------------------------------------------------------------------------
// cash discount conditions

export interface OpenCondition {
  id: string
  invoiceId: string
  discountBps: number
  payBy: string
}

/** The "2% if you pay within 7 days" offers still open on these bills. */
export async function openConditions(
  tx: Db,
  invoiceIds: readonly string[],
): Promise<Map<string, OpenCondition>> {
  const ids = [...new Set(invoiceIds)]
  const out = new Map<string, OpenCondition>()
  if (ids.length === 0) return out
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      id: cashDiscountConditions.id,
      invoiceId: cashDiscountConditions.invoiceId,
      discountBps: cashDiscountConditions.discountBps,
      payBy: cashDiscountConditions.payBy,
    })
    .from(cashDiscountConditions)
    .where(
      and(
        eq(cashDiscountConditions.tenantId, tenantId),
        eq(cashDiscountConditions.status, 'open'),
        inArray(cashDiscountConditions.invoiceId, ids),
      ),
    )
  for (const row of rows) out.set(row.invoiceId, row)
  return out
}

export async function realiseCondition(
  tx: Db,
  conditionId: string,
  receiptId: string,
  realisedPaise: number,
): Promise<void> {
  const { tenantId } = currentTenant()
  await tx
    .update(cashDiscountConditions)
    .set({
      status: 'realised',
      realisedReceiptId: receiptId,
      realisedPaise,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(cashDiscountConditions.tenantId, tenantId),
        eq(cashDiscountConditions.id, conditionId),
      ),
    )
}

/**
 * Undoing a receipt hands the offer back: still `open` while the window has not closed, otherwise `lapsed`
 * (docs/plans/receivables.md §4.9 — a bounced cheque must restore AR exactly, discount included).
 */
export async function releaseConditionsOf(
  tx: Db,
  receiptId: string,
  today: string,
): Promise<string[]> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({ id: cashDiscountConditions.id, payBy: cashDiscountConditions.payBy })
    .from(cashDiscountConditions)
    .where(
      and(
        eq(cashDiscountConditions.tenantId, tenantId),
        eq(cashDiscountConditions.realisedReceiptId, receiptId),
      ),
    )
  for (const row of rows) {
    await tx
      .update(cashDiscountConditions)
      .set({
        status: row.payBy >= today ? 'open' : 'lapsed',
        realisedReceiptId: null,
        realisedPaise: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(cashDiscountConditions.tenantId, tenantId), eq(cashDiscountConditions.id, row.id)),
      )
  }
  return rows.map((r) => r.id)
}

// ---------------------------------------------------------------------------------------------------------------
// planning what a receipt settles

/** What a cash discount on a bill is worth: `percentOf(total, bps)`, never more than the bill still owes. */
export const cashDiscountValue = (totalPaise: number, discountBps: number): number =>
  percentOf(paise(totalPaise), discountBps)

export interface PlannedAllocation {
  invoiceId: string
  /** Money out of the receipt. */
  cashPaise: number
  /** Cash discount realised with this bill; 0 unless the payment settles it in full inside the window. */
  discountPaise: number
  conditionId: string | null
}

export const plannedAmount = (line: PlannedAllocation): number =>
  line.cashPaise + line.discountPaise

/**
 * FIFO: oldest due bill first, then oldest bill date, then bill number — Tarsun's physical file order
 * (docs/plans/receivables.md §4.5). `bills` arrives already sorted by `loadOpenBills`.
 *
 * A cash discount is realised only when all three hold: the offer is `open`, the payment landed inside the
 * window, and the money settles that bill IN FULL. Anything left over stays on the receipt as on-account
 * credit; it is never silently spread.
 */
export function planFifo(
  bills: readonly OpenBillRow[],
  amountPaise: number,
  conditions: Map<string, OpenCondition>,
  paidOn: string,
): PlannedAllocation[] {
  const plan: PlannedAllocation[] = []
  let remaining = amountPaise
  for (const bill of bills) {
    if (remaining <= 0) break
    const open = openPaiseOf(bill)
    if (open <= 0) continue
    const condition = conditions.get(bill.id)
    const inWindow = condition !== undefined && paidOn <= condition.payBy
    const discount =
      inWindow && condition
        ? Math.min(cashDiscountValue(bill.totalPaise, condition.discountBps), open)
        : 0
    const needed = open - discount
    if (discount > 0 && remaining >= needed) {
      plan.push({
        invoiceId: bill.id,
        cashPaise: needed,
        discountPaise: discount,
        conditionId: condition?.id ?? null,
      })
      remaining -= needed
      continue
    }
    const cash = Math.min(remaining, open)
    plan.push({ invoiceId: bill.id, cashPaise: cash, discountPaise: 0, conditionId: null })
    remaining -= cash
  }
  return plan.filter((line) => plannedAmount(line) > 0)
}

/**
 * An explicit split names the bills itself. The same discount rule applies — the offer only realises when
 * the named amount settles that bill in full — and a line may never exceed what the bill still owes.
 */
export function planExplicit(
  lines: readonly { invoiceId: string; amountPaise: number }[],
  invoicesById: Map<string, InvoiceForAllocation>,
  conditions: Map<string, OpenCondition>,
  paidOn: string,
): PlannedAllocation[] {
  const plan: PlannedAllocation[] = []
  for (const line of lines) {
    const invoice = invoicesById.get(line.invoiceId)
    if (!invoice) {
      throw new ORPCError('NOT_FOUND', { message: `invoice ${line.invoiceId} not found` })
    }
    const open = invoice.totalPaise - invoice.allocatedPaise
    if (line.amountPaise > open) {
      throw new ORPCError('CONFLICT', {
        message: `bill ${invoice.invoiceNo ?? invoice.id} owes ${String(open)} paise; ${String(line.amountPaise)} was offered`,
      })
    }
    const condition = conditions.get(invoice.id)
    const inWindow = condition !== undefined && paidOn <= condition.payBy
    const discount =
      inWindow && condition
        ? Math.min(cashDiscountValue(invoice.totalPaise, condition.discountBps), open)
        : 0
    const settles = discount > 0 && line.amountPaise >= open - discount
    plan.push({
      invoiceId: invoice.id,
      cashPaise: line.amountPaise,
      discountPaise: settles ? open - line.amountPaise : 0,
      conditionId: settles ? (condition?.id ?? null) : null,
    })
  }
  return plan.filter((line) => plannedAmount(line) > 0)
}

/** The value a receipt still has free to allocate: the cash it carried plus any discount it realised. */
export async function allocatedAgainst(
  tx: Db,
  column: 'receiptId' | 'creditNoteId' | 'writeOffId',
  sourceIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(sourceIds)]
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      sourceId: allocations[column],
      total: sql<string>`coalesce(sum(${allocations.amountPaise}), 0)`,
    })
    .from(allocations)
    .where(and(eq(allocations.tenantId, tenantId), inArray(allocations[column], ids)))
    .groupBy(allocations[column])
  for (const row of rows) {
    if (row.sourceId) out.set(row.sourceId, Number(row.total))
  }
  return out
}
