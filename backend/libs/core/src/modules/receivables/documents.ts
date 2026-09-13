import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Allocation, Receipt, SellerBranding } from '@dos/contracts'
import { allocations, invoices, receipts, retailers, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { sellerBranding } from '../tenancy/index.js'
import { allocatedAgainst } from './allocation.js'
import { loadOutstanding } from './outstanding.js'
import { toAllocation, toReceipt } from './receivables.mappers.js'
import {
  ledgerBalances,
  MAX_LEDGER_WINDOW_DAYS,
  receiptWithAllocations,
  shiftDate,
} from './receivables.queries.js'

/** What the printed receipt carries (docs/22 §4 D6: the third white-label document). */
export interface ReceiptDocument {
  item: Receipt
  allocations: (Allocation & { invoiceNo: string | null })[]
  reversal: Receipt | null
  seller: SellerBranding
  retailer: { id: string; code: string; name: string; phone: string | null }
}

/**
 * The receipt data the worker's PDF renderer prints from — what `receivables.receipts.get` answers,
 * plus the shop's name and the bill numbers behind each allocation (a receipt names the bills it
 * settled). Plain function, no Nest DI (coordination §3.9 worker rule).
 */
export async function loadReceiptDocument(
  tx: Db,
  receiptId: string,
): Promise<ReceiptDocument | null> {
  const { tenantId } = currentTenant()
  const found = await receiptWithAllocations(tx, receiptId)
  if (!found) return null
  const rows = await tx
    .select()
    .from(allocations)
    .where(and(eq(allocations.tenantId, tenantId), eq(allocations.receiptId, receiptId)))
    .orderBy(asc(allocations.id))
  const invoiceIds = [...new Set(rows.map((r) => r.invoiceId))]
  const numbers = new Map(
    invoiceIds.length === 0
      ? []
      : (
          await tx
            .select({ id: invoices.id, invoiceNo: invoices.invoiceNo })
            .from(invoices)
            .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.id, invoiceIds)))
        ).map((i) => [i.id, i.invoiceNo]),
  )
  const [reversal] = await tx
    .select()
    .from(receipts)
    .where(and(eq(receipts.tenantId, tenantId), eq(receipts.reversesReceiptId, receiptId)))
    .limit(1)
  const reversalAllocated = reversal
    ? ((await allocatedAgainst(tx, 'receiptId', [reversal.id])).get(reversal.id) ?? 0)
    : 0
  const [shop] = await tx
    .select({
      id: retailers.id,
      code: retailers.code,
      name: retailers.name,
      phone: retailers.phone,
    })
    .from(retailers)
    .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, found.row.retailerId)))
    .limit(1)
  return {
    item: toReceipt(found.row, found.allocatedPaise),
    allocations: rows.map((r) => ({
      ...toAllocation(r),
      invoiceNo: numbers.get(r.invoiceId) ?? null,
    })),
    reversal: reversal ? toReceipt(reversal, reversalAllocated) : null,
    seller: await sellerBranding(tx),
    retailer: shop ?? { id: found.row.retailerId, code: '', name: '', phone: null },
  }
}

/** What a shop's statement message prints (DOS-007). */
export interface StatementSummary {
  /** The window actually covered: `from` is clamped to `to` − 400 days, exactly as `ledger.get` clamps it. */
  from: string
  to: string
  openingPaise: number
  closingPaise: number
  /** Overdue as of today (the rollup), whatever the window. */
  overduePaise: number
  /** What the shop owes today net of money on account, never below zero: the pay link's amount. */
  duePaise: number
  openBills: number
}

/**
 * One shop's statement figures, for the worker's `StatementRequested` consumer. Opening and closing come
 * from the AR journal the way `receivables.ledger.get` reads them for staff — same source, same 400-day
 * clamp — so the message and the ledger agree for the same window; overdue and dues are TODAY's, from the
 * outstanding rollup (a statement for a past quarter must never ask the shop to pay that quarter's balance).
 * `null` when the shop is not this tenant's. Plain function, no Nest DI (coordination §3.9 worker rule).
 */
export async function loadStatementSummary(
  tx: Db,
  input: { retailerId: string; from: string; to: string },
): Promise<StatementSummary | null> {
  const { tenantId } = currentTenant()
  const [shop] = await tx
    .select({ id: retailers.id })
    .from(retailers)
    .where(and(eq(retailers.tenantId, tenantId), eq(retailers.id, input.retailerId)))
    .limit(1)
  if (!shop) return null
  const earliest = shiftDate(input.to, -MAX_LEDGER_WINDOW_DAYS)
  const from = input.from < earliest ? earliest : input.from
  const { openingPaise, closingPaise } = await ledgerBalances(
    tx,
    { retailerId: shop.id, from, to: input.to },
    true,
  )
  const outstanding = await loadOutstanding(tx, shop.id)
  return {
    from,
    to: input.to,
    openingPaise,
    closingPaise,
    overduePaise: outstanding.overduePaise,
    duePaise: Math.max(0, outstanding.outstandingPaise - outstanding.unallocatedCreditPaise),
    openBills: outstanding.openBills,
  }
}
