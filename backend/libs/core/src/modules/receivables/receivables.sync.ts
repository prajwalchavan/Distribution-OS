import { and, eq } from 'drizzle-orm'
import type { ReceiptMode, SyncOp } from '@dos/contracts'
import { allocations, invoices, receipts, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { SyncRejection } from '../sync/index.js'
import { recomputeInvoiceStates } from './allocation.js'
import type { ReceivablesService } from './receivables.service.js'

/**
 * ADR 0007 / docs/07 §7.3 — what a delivery device may push after a day with no signal.
 *
 * Only `PUT` is accepted: a receipt is append-only, so a device may create one and may never edit or
 * delete it. Every refusal is a `SyncRejection` (2xx plus a `sync_errors` row the device shows in its
 * "needs attention" tray), never a 4xx that would wedge the queue.
 *
 * Replays are handled twice over: `sync_ops(tenant, device, op_id)` upstream, and
 * `(tenant_id, device_id, client_receipt_no)` inside `recordReceipt`, which is the crew's paper receipt
 * book number and the only key that survives a device reinstall.
 */

const MODES: readonly ReceiptMode[] = ['cash', 'upi', 'bank_transfer', 'cheque', 'adjustment']

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : null

const int = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isSafeInteger(n) ? n : null
}

function putOnly(op: SyncOp, table: string, code: string, message: string): void {
  if (op.op !== 'PUT') throw new SyncRejection(code, message)
}

/** A receipt written at a shop door while the phone was offline. */
export async function applyReceiptSync(
  tx: Db,
  op: SyncOp,
  receivables: ReceivablesService,
): Promise<void> {
  putOnly(
    op,
    'receipts',
    'receipt_immutable',
    'A receipt is never edited or deleted; send a reversal from the desk instead',
  )
  const data = op.data ?? {}
  const retailerId = str(data.retailer_id)
  const amountPaise = int(data.amount_paise)
  const mode = str(data.mode)
  if (!retailerId) {
    throw new SyncRejection('retailer_required', 'The receipt does not say which shop paid')
  }
  if (amountPaise === null || amountPaise <= 0) {
    throw new SyncRejection('amount_invalid', 'A receipt must carry a positive amount')
  }
  if (!mode || !(MODES as readonly string[]).includes(mode)) {
    throw new SyncRejection('mode_invalid', `${mode ?? 'no mode'} is not a way of taking money`)
  }
  await receivables.recordReceipt(tx, {
    id: op.id,
    idempotencyKey: `sync:receipt:${op.opId}`,
    retailerId,
    mode: mode as ReceiptMode,
    amountPaise,
    receivedAt: str(data.received_at) ?? op.clientTime ?? undefined,
    receivedBy: str(data.received_by) ?? undefined,
    reference: str(data.reference),
    upiVpa: str(data.upi_vpa),
    chequeDate: str(data.cheque_date),
    bankName: str(data.bank_name),
    tripId: str(data.trip_id),
    deviceId: str(data.device_id),
    clientReceiptNo: str(data.client_receipt_no),
    note: str(data.note),
    proofObjectKey: str(data.proof_object_key),
    strategy: 'fifo',
  })
}

/**
 * A device may upload the split it showed the shopkeeper, but never invent one: the row must name a
 * receipt that has already arrived, and the amount is checked against what that receipt still has free.
 */
export async function applyAllocationSync(
  tx: Db,
  op: SyncOp,
  receivables: ReceivablesService,
): Promise<void> {
  putOnly(
    op,
    'allocations',
    'allocation_immutable',
    'An allocation is removed at the desk, not from a device',
  )
  const { tenantId, actorId } = currentTenant()
  const data = op.data ?? {}
  const invoiceId = str(data.invoice_id)
  const receiptId = str(data.receipt_id)
  const amountPaise = int(data.amount_paise)
  if (!invoiceId || !receiptId) {
    throw new SyncRejection('allocation_invalid', 'An allocation needs a bill and a receipt')
  }
  if (amountPaise === null || amountPaise <= 0) {
    throw new SyncRejection('amount_invalid', 'An allocation must carry a positive amount')
  }
  const [existing] = await tx
    .select({ id: allocations.id })
    .from(allocations)
    .where(and(eq(allocations.tenantId, tenantId), eq(allocations.id, op.id)))
    .limit(1)
  if (existing) return
  const [receipt] = await tx
    .select({ id: receipts.id, status: receipts.status })
    .from(receipts)
    .where(and(eq(receipts.tenantId, tenantId), eq(receipts.id, receiptId)))
    .limit(1)
  if (!receipt) {
    throw new SyncRejection('receipt_not_found', `Receipt ${receiptId} has not arrived yet`)
  }
  if (receipt.status !== 'collected' && receipt.status !== 'deposited') {
    throw new SyncRejection('receipt_not_open', `Receipt ${receiptId} is ${receipt.status}`)
  }
  const [invoice] = await tx
    .select({ id: invoices.id, retailerId: invoices.retailerId, state: invoices.state })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
    .limit(1)
  if (!invoice) {
    throw new SyncRejection('invoice_not_found', `Bill ${invoiceId} has not arrived yet`)
  }
  if (invoice.state !== 'issued' && invoice.state !== 'partially_paid') {
    throw new SyncRejection('invoice_not_open', `Bill ${invoiceId} is ${invoice.state}`)
  }
  const open = await receivables.invoiceOutstandingPaise(tx, invoiceId)
  if (amountPaise > open) {
    throw new SyncRejection(
      'over_allocated',
      `Bill ${invoiceId} owes ${String(open)} paise; ${String(amountPaise)} was offered`,
    )
  }
  await tx
    .insert(allocations)
    .values({
      id: op.id,
      tenantId,
      invoiceId,
      receiptId,
      amountPaise,
      allocatedBy: actorId,
    })
    .onConflictDoNothing()
  await recomputeInvoiceStates(tx, [invoiceId])
  await receivables.refreshOutstanding(tx, invoice.retailerId)
}
