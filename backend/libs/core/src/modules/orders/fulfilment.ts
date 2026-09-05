import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm'
import type { OrderState } from '@dos/domain'
import {
  beats,
  productVariants,
  retailers,
  salesOrderLines,
  salesOrders,
  tenantProducts,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The read surface the WAREHOUSE module works from (coordination §3.9 and §4). Warehouse never queries
 * `sales_orders` or `sales_order_lines` itself; it asks here.
 *
 * Everything in this file is deliberately money-free. A picker, and the picking sheet on their phone, must
 * not be able to back a rate — let alone a purchase cost — out of a screen (warehouse §4.9, ADR 0002). So
 * the queue carries counts and pieces, and the line shape carries quantities and the sell-side pack size,
 * and neither carries `rate_paise`, `line_total_paise`, `discount_paise` or anything derived from them.
 */

/** One row of the warehouse app's order queue. No amounts: quantities and identity only. */
export interface FulfilmentOrder {
  orderId: string
  orderNo: string | null
  retailerId: string
  retailerName: string
  retailerCode: string
  beatId: string | null
  beatName: string | null
  state: OrderState
  fulfilFromLocationId: string | null
  expectedDeliveryDate: string | null
  confirmedAt: string | null
  lineCount: number
  /** Paid + free pieces on the order — what actually has to come off the rack. */
  totalQtyPcs: number
}

/**
 * One order line as the godown sees it. `sellCaseSize` is the SELL-side pack
 * (`tenant_products.case_size_override` else `product_variants.default_case_size`) and is only the
 * fallback for display: the picklist freezes the LOT's own `stock_lots.case_size` where it has one,
 * because a promo batch changes the case size per batch (docs/17 A2).
 */
export interface FulfilmentLine {
  orderId: string
  orderLineId: string
  lineNo: number
  variantId: string
  qtyPcs: number
  freeQtyPcs: number
  pickedQtyPcs: number
  sellCaseSize: number
}

/**
 * The moves the godown and the van make on the order aggregate. Warehouse drives the first three
 * (`picklists.start`, `packs.confirm`, `loadSheets.confirm`); DELIVERY drives the last three from the
 * doorstep (coordination §3.9 and §4): `deliver_all` / `deliver_partial` after `recordDelivered`, and
 * `return_undelivered` (`dispatched → packed`) for a failed stop or a trip that came back with the bill
 * still on the van. Nothing else may be driven from outside.
 */
export type FulfilmentEvent =
  'start_picking' | 'pack' | 'dispatch' | 'deliver_all' | 'deliver_partial' | 'return_undelivered'

/** States a fulfilment queue is ever interested in: the order is confirmed but not yet out of the door. */
export const FULFILMENT_STATES = [
  'confirmed',
  'picking',
  'packed',
] as const satisfies readonly OrderState[]

/** docs/20 rule 3: bounded work per request. The warehouse contract caps a wave at 200 orders. */
export const MAX_FULFILMENT_ORDERS = 200

export interface FulfilmentQueueFilter {
  locationId?: string | undefined
  beatId?: string | undefined
  state?: OrderState | undefined
  expectedDeliveryDate?: string | undefined
  limit: number
  cursor?: string | undefined
}

/**
 * The queue screen. Newest first on the UUIDv7 id, so `cursor` is the last row's `orderId`; at most
 * `limit` rows come back, so a caller that wants to know whether a further page exists asks for
 * `limit + 1` and trims. `state` defaults to the three fulfilment states — a draft or a cancelled order
 * is never the warehouse's business.
 */
export function fulfilmentQueue(tx: Db, filter: FulfilmentQueueFilter): Promise<FulfilmentOrder[]> {
  const filters: (SQL | undefined)[] = [
    filter.state
      ? eq(salesOrders.state, filter.state)
      : inArray(salesOrders.state, [...FULFILMENT_STATES]),
    filter.locationId ? eq(salesOrders.fulfilFromLocationId, filter.locationId) : undefined,
    filter.beatId ? eq(retailers.beatId, filter.beatId) : undefined,
    filter.expectedDeliveryDate
      ? eq(salesOrders.expectedDeliveryDate, filter.expectedDeliveryDate)
      : undefined,
    filter.cursor ? lt(salesOrders.id, filter.cursor) : undefined,
  ]
  return queueRows(tx, filters, filter.limit)
}

/**
 * The SAME row as the queue, looked up BY ID instead of scanned — what a picklist, a pack list and a
 * load sheet print beside each order (its number, its shop, its state). The queue only ever answers for
 * orders that are still `confirmed | picking | packed`; a load sheet lists orders that have already
 * been dispatched, and a warehouse screen that lost the shop's name the moment the van left would be
 * useless. Bounded at `MAX_FULFILMENT_ORDERS` ids, and as money-free as everything else in this file.
 */
export async function fulfilmentOrders(
  tx: Db,
  orderIds: readonly string[],
): Promise<FulfilmentOrder[]> {
  if (orderIds.length === 0) return []
  if (orderIds.length > MAX_FULFILMENT_ORDERS)
    throw new ORPCError('BAD_REQUEST', {
      message: `at most ${MAX_FULFILMENT_ORDERS} orders per call, got ${orderIds.length}`,
    })
  return queueRows(tx, [inArray(salesOrders.id, [...orderIds])], orderIds.length)
}

/**
 * Which order each line belongs to. `reservations.order_line_id` is a plain id (inventory is upstream
 * of orders), so the warehouse's holds screen has a line id and needs the order it is holding for.
 */
export async function orderLineOwners(
  tx: Db,
  orderLineIds: readonly string[],
): Promise<Map<string, { orderId: string; orderNo: string | null }>> {
  const ids = [...new Set(orderLineIds)]
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({
      orderLineId: salesOrderLines.id,
      orderId: salesOrders.id,
      orderNo: salesOrders.orderNo,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .where(inArray(salesOrderLines.id, ids))
  return new Map(rows.map((r) => [r.orderLineId, { orderId: r.orderId, orderNo: r.orderNo }]))
}

async function queueRows(
  tx: Db,
  filters: (SQL | undefined)[],
  limit: number,
): Promise<FulfilmentOrder[]> {
  const rows = await tx
    .select({
      orderId: salesOrders.id,
      orderNo: salesOrders.orderNo,
      retailerId: salesOrders.retailerId,
      retailerName: retailers.name,
      retailerCode: retailers.code,
      beatId: retailers.beatId,
      beatName: beats.name,
      state: salesOrders.state,
      fulfilFromLocationId: salesOrders.fulfilFromLocationId,
      expectedDeliveryDate: salesOrders.expectedDeliveryDate,
      confirmedAt: salesOrders.confirmedAt,
      lineCount: sql<number>`count(${salesOrderLines.id})`,
      totalQtyPcs: sql<number>`coalesce(sum(${salesOrderLines.qtyPcs} + ${salesOrderLines.freeQtyPcs}), 0)`,
    })
    .from(salesOrders)
    .innerJoin(retailers, eq(retailers.id, salesOrders.retailerId))
    .leftJoin(beats, eq(beats.id, retailers.beatId))
    .leftJoin(salesOrderLines, eq(salesOrderLines.orderId, salesOrders.id))
    .where(and(...filters.filter((f): f is SQL => f !== undefined)))
    .groupBy(salesOrders.id, retailers.name, retailers.code, retailers.beatId, beats.name)
    .orderBy(desc(salesOrders.id))
    .limit(limit)
  return rows.map((r) => ({
    orderId: r.orderId,
    orderNo: r.orderNo,
    retailerId: r.retailerId,
    retailerName: r.retailerName,
    retailerCode: r.retailerCode,
    beatId: r.beatId,
    beatName: r.beatName,
    state: r.state,
    fulfilFromLocationId: r.fulfilFromLocationId,
    expectedDeliveryDate: r.expectedDeliveryDate,
    confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    lineCount: Number(r.lineCount),
    totalQtyPcs: Number(r.totalQtyPcs),
  }))
}

/**
 * The lines of one wave, in `(orderId, lineNo)` order — what a picklist is snapshotted from. Bounded at
 * `MAX_FULFILMENT_ORDERS` ids so a caller cannot ask for a whole tenant's book in one query.
 */
export async function fulfilmentLines(
  tx: Db,
  orderIds: readonly string[],
): Promise<FulfilmentLine[]> {
  if (orderIds.length === 0) return []
  if (orderIds.length > MAX_FULFILMENT_ORDERS)
    throw new ORPCError('BAD_REQUEST', {
      message: `at most ${MAX_FULFILMENT_ORDERS} orders per call, got ${orderIds.length}`,
    })
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      orderId: salesOrderLines.orderId,
      orderLineId: salesOrderLines.id,
      lineNo: salesOrderLines.lineNo,
      variantId: salesOrderLines.variantId,
      qtyPcs: salesOrderLines.qtyPcs,
      freeQtyPcs: salesOrderLines.freeQtyPcs,
      pickedQtyPcs: salesOrderLines.pickedQtyPcs,
      sellCaseSize: sql<number>`coalesce(${tenantProducts.caseSizeOverride}, ${productVariants.defaultCaseSize})`,
    })
    .from(salesOrderLines)
    .innerJoin(productVariants, eq(productVariants.id, salesOrderLines.variantId))
    .leftJoin(
      tenantProducts,
      and(
        eq(tenantProducts.variantId, salesOrderLines.variantId),
        eq(tenantProducts.tenantId, tenantId),
      ),
    )
    .where(inArray(salesOrderLines.orderId, [...orderIds]))
    .orderBy(asc(salesOrderLines.orderId), asc(salesOrderLines.lineNo))
  return rows.map((r) => ({
    orderId: r.orderId,
    orderLineId: r.orderLineId,
    lineNo: r.lineNo,
    variantId: r.variantId,
    qtyPcs: r.qtyPcs,
    freeQtyPcs: r.freeQtyPcs,
    pickedQtyPcs: r.pickedQtyPcs,
    sellCaseSize: Number(r.sellCaseSize),
  }))
}

export interface PickedLine {
  orderLineId: string
  /**
   * PAID pieces taken off the rack for this line. Free pieces travel with them and are counted by
   * `free_qty_pcs`, not here — billing reads `picked_qty_pcs` as the billable quantity and clamps it to
   * `qty_pcs`, so a caller that added the free pieces in would over-bill the shop.
   */
  pickedQtyPcs: number
}

/**
 * Writes back what the godown actually took. This is the ONLY writer of `sales_order_lines.picked_qty_pcs`
 * and it is deliberately not a state change: a short pick is a smaller invoice, never an edit to
 * `qty_pcs` and never a credit note (warehouse §4.6). Refuses a line that is not on the order and a
 * quantity outside `0 .. qty_pcs`, because both mean the caller has mis-summed its pick lines.
 */
export async function recordPick(
  tx: Db,
  orderId: string,
  picked: readonly PickedLine[],
): Promise<void> {
  if (picked.length === 0) return
  const lines = await tx
    .select({ id: salesOrderLines.id, qtyPcs: salesOrderLines.qtyPcs })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, orderId))
  const byId = new Map(lines.map((l) => [l.id, l.qtyPcs]))
  for (const line of picked) {
    const ordered = byId.get(line.orderLineId)
    if (ordered === undefined)
      throw new ORPCError('BAD_REQUEST', {
        message: `line ${line.orderLineId} does not belong to order ${orderId}`,
      })
    if (
      !Number.isInteger(line.pickedQtyPcs) ||
      line.pickedQtyPcs < 0 ||
      line.pickedQtyPcs > ordered
    )
      throw new ORPCError('BAD_REQUEST', {
        message: `picked ${line.pickedQtyPcs} pieces on line ${line.orderLineId}, which ordered ${ordered}`,
      })
  }
  const now = new Date()
  for (const line of picked) {
    await tx
      .update(salesOrderLines)
      .set({ pickedQtyPcs: line.pickedQtyPcs, updatedAt: now })
      .where(eq(salesOrderLines.id, line.orderLineId))
  }
}

export interface DeliveredLine {
  orderLineId: string
  /** Pieces the shop actually accepted at the door — paid and free alike. */
  deliveredQtyPcs: number
}

/**
 * Writes back what the shop accepted (coordination §3.9, the delivery slice's one addition here). The
 * ONLY writer of `sales_order_lines.delivered_qty_pcs`, and — like `recordPick` — deliberately not a
 * state change: the delivery module moves the order through `applyFulfilmentEvent('deliver_all' |
 * 'deliver_partial')` right after. Additive on purpose: a bill delivered in two attempts (a failed
 * stop, then a second trip) accumulates; a replay is guarded by the delivery's own idempotency, not
 * here. Refuses a line that is not on the order, a negative quantity, and a total beyond the paid and
 * free pieces of the line, because each means the caller has mis-summed its delivery lines.
 */
export async function recordDelivered(
  tx: Db,
  orderId: string,
  delivered: readonly DeliveredLine[],
): Promise<void> {
  if (delivered.length === 0) return
  const lines = await tx
    .select({
      id: salesOrderLines.id,
      qtyPcs: salesOrderLines.qtyPcs,
      freeQtyPcs: salesOrderLines.freeQtyPcs,
      deliveredQtyPcs: salesOrderLines.deliveredQtyPcs,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, orderId))
  const byId = new Map(lines.map((l) => [l.id, l]))
  for (const line of delivered) {
    const ordered = byId.get(line.orderLineId)
    if (!ordered)
      throw new ORPCError('BAD_REQUEST', {
        message: `line ${line.orderLineId} does not belong to order ${orderId}`,
      })
    const ceiling = ordered.qtyPcs + ordered.freeQtyPcs
    if (
      !Number.isInteger(line.deliveredQtyPcs) ||
      line.deliveredQtyPcs < 0 ||
      ordered.deliveredQtyPcs + line.deliveredQtyPcs > ceiling
    )
      throw new ORPCError('BAD_REQUEST', {
        message: `delivered ${String(line.deliveredQtyPcs)} pieces on line ${line.orderLineId}, which has ${String(ceiling - ordered.deliveredQtyPcs)} left to deliver`,
      })
  }
  const now = new Date()
  for (const line of delivered) {
    if (line.deliveredQtyPcs === 0) continue
    await tx
      .update(salesOrderLines)
      .set({
        deliveredQtyPcs: sql`${salesOrderLines.deliveredQtyPcs} + ${line.deliveredQtyPcs}`,
        updatedAt: now,
      })
      .where(eq(salesOrderLines.id, line.orderLineId))
  }
}
