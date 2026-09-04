import { asc, eq } from 'drizzle-orm'
import type { SyncOp } from '@dos/contracts'
import { salesOrderLines, salesOrders, type Db } from '@dos/db'
import { SyncRejection } from '../sync/index.js'
import type { OrdersService } from './orders.service.js'
import type { EnteredLine, EnteredUnit } from './pricing-lines.js'

/**
 * ADR 0007: what a team device is allowed to push. A device drafts orders offline and the server re-prices
 * them (§7.3) — it never accepts a total, a rate or a state beyond `draft`; submit/confirm/cancel are online
 * procedures, so the number, the approval gates and the stock reservation are always decided by the server.
 *
 * Every rejection here is a `SyncRejection`: 2xx plus a `sync_errors` row, never a 4xx that would wedge the
 * device's queue. Business faults raised deeper down (unknown variant, no price, no dated HSN rate) surface as
 * 4xx ORPCErrors, which `SyncService` already turns into rejections. Replays are handled upstream by
 * `sync_ops(tenant, device, op_id)`.
 */

const UNITS: readonly EnteredUnit[] = ['piece', 'inner', 'case']

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : null

const int = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isSafeInteger(n) ? n : null
}

const unitOf = (v: unknown): EnteredUnit => {
  const value = str(v)
  return value && (UNITS as readonly string[]).includes(value) ? (value as EnteredUnit) : 'piece'
}

function putOnly(op: SyncOp, table: string): void {
  if (op.op !== 'PUT')
    throw new SyncRejection(
      'unsupported_op',
      `${table} accepts PUT from a device, not ${op.op}`,
      `${table} में डिवाइस से केवल नया ऑर्डर भेजा जा सकता है`,
    )
}

/** Create or update the header of a draft order uploaded by a device. Idempotent by the row's own id. */
export async function applyOrderSync(tx: Db, op: SyncOp, orders: OrdersService): Promise<void> {
  putOnly(op, 'sales_orders')
  const data = op.data ?? {}
  const state = str(data.state)
  if (state !== null && state !== 'draft')
    throw new SyncRejection(
      'state_not_allowed',
      'A device may only upload a draft order; submit it online',
      'डिवाइस से केवल ड्राफ्ट ऑर्डर भेजा जा सकता है',
    )
  const existing = await orders.findOrder(tx, op.id)
  if (existing && existing.state !== 'draft')
    throw new SyncRejection(
      'order_not_draft',
      `Order ${existing.orderNo ?? existing.id} is already ${existing.state}`,
      `ऑर्डर ${existing.orderNo ?? existing.id} पहले ही ${existing.state} है`,
    )
  if (existing) {
    await tx
      .update(salesOrders)
      .set({
        expectedDeliveryDate: str(data.expected_delivery_date) ?? existing.expectedDeliveryDate,
        note: str(data.note) ?? existing.note,
        fulfilFromLocationId: str(data.fulfil_from_location_id) ?? existing.fulfilFromLocationId,
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, existing.id))
    return
  }
  const retailerId = str(data.retailer_id)
  if (!retailerId)
    throw new SyncRejection(
      'retailer_required',
      'The order has no retailer',
      'ऑर्डर में दुकान नहीं है',
    )
  await orders.insertDraft(tx, {
    id: op.id,
    retailerId,
    source: (str(data.source) ?? 'salesperson') as 'salesperson',
    pricingDateMode: str(data.pricing_date_mode) === 'delivery' ? 'delivery' : 'order',
    fulfilFromLocationId: str(data.fulfil_from_location_id),
    expectedDeliveryDate: str(data.expected_delivery_date),
    note: str(data.note),
  })
}

/** One line of a draft; the whole order is re-priced so the header always matches its lines. */
export async function applyLineSync(tx: Db, op: SyncOp, orders: OrdersService): Promise<void> {
  putOnly(op, 'sales_order_lines')
  const data = op.data ?? {}
  const orderId = str(data.order_id)
  if (!orderId)
    throw new SyncRejection(
      'order_required',
      'The line has no order',
      'लाइन किस ऑर्डर की है, पता नहीं',
    )
  const order = await orders.findOrder(tx, orderId)
  if (!order)
    throw new SyncRejection(
      'order_not_found',
      `Order ${orderId} has not arrived yet`,
      `ऑर्डर ${orderId} अभी सर्वर पर नहीं आया`,
    )
  if (order.state !== 'draft')
    throw new SyncRejection(
      'order_not_draft',
      `Order ${order.orderNo ?? order.id} is already ${order.state}`,
      `ऑर्डर ${order.orderNo ?? order.id} पहले ही ${order.state} है`,
    )
  const variantId = str(data.variant_id)
  const enteredQty = int(data.entered_qty)
  if (!variantId || enteredQty === null || enteredQty <= 0)
    throw new SyncRejection(
      'line_invalid',
      'The line needs a product and a positive quantity',
      'लाइन में प्रोडक्ट और मात्रा ज़रूरी है',
    )
  const current = await tx
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, order.id))
    .orderBy(asc(salesOrderLines.lineNo))
  const lines: EnteredLine[] = current
    .filter((l) => l.id !== op.id)
    .map((l) => ({
      id: l.id,
      variantId: l.variantId,
      enteredQty: l.enteredQty,
      enteredUnit: l.enteredUnit,
    }))
  lines.push({ id: op.id, variantId, enteredQty, enteredUnit: unitOf(data.entered_unit) })
  await orders.writeLines(tx, order, lines)
}
