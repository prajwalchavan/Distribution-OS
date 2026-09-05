import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Allocation, Receipt, SellerBranding } from '@dos/contracts'
import { allocations, invoices, receipts, retailers, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { sellerBranding } from '../tenancy/index.js'
import { allocatedAgainst } from './allocation.js'
import { toAllocation, toReceipt } from './receivables.mappers.js'
import { receiptWithAllocations } from './receivables.queries.js'

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
