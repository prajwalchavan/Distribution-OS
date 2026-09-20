import { asc, eq } from 'drizzle-orm'
import type { Approval, ApprovalQueueItem, Order, OrderDetail, OrderLine } from '@dos/contracts'
import type { salesOrders } from '@dos/db'
import { approvals, orderStateTransitions, salesOrderLines, type Db } from '@dos/db'
import { variantNames } from '../tenant-catalog/index.js'

/** Drizzle rows in, contract shapes out (docs/16 §2): no Drizzle row ever leaves the module. */

export type OrderRow = typeof salesOrders.$inferSelect
export type OrderLineRow = typeof salesOrderLines.$inferSelect
export type TransitionRow = typeof orderStateTransitions.$inferSelect
export type ApprovalRow = typeof approvals.$inferSelect

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

/**
 * `office` is false for a retailer-role caller: `stockShortages` is what the GODOWN could not hold
 * (DOS-078), an internal fact like an approval payload, and it never reaches the retailer app.
 */
export function toOrder(row: OrderRow, office: boolean): Order {
  return {
    id: row.id,
    orderNo: row.orderNo,
    retailerId: row.retailerId,
    state: row.state,
    source: row.source,
    createdBy: row.createdBy,
    salespersonId: row.salespersonId,
    pricingDateMode: row.pricingDateMode,
    paymentTerms: row.paymentTerms,
    fulfilFromLocationId: row.fulfilFromLocationId,
    externalRef: row.externalRef,
    subtotalPaise: row.subtotalPaise,
    discountPaise: row.discountPaise,
    taxPaise: row.taxPaise,
    cessPaise: row.cessPaise,
    roundOffPaise: row.roundOffPaise,
    totalPaise: row.totalPaise,
    approvalFlags: row.approvalFlags,
    stockShortages: office ? row.stockShortages : [],
    expectedDeliveryDate: row.expectedDeliveryDate,
    note: row.note,
    submittedAt: iso(row.submittedAt),
    confirmedAt: iso(row.confirmedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toOrderLine(row: OrderLineRow, variantName: string): OrderLine {
  return {
    id: row.id,
    lineNo: row.lineNo,
    variantId: row.variantId,
    variantName,
    enteredQty: row.enteredQty,
    enteredUnit: row.enteredUnit,
    packSizeAtEntry: row.packSizeAtEntry,
    qtyPcs: row.qtyPcs,
    freeQtyPcs: row.freeQtyPcs,
    pickedQtyPcs: row.pickedQtyPcs,
    deliveredQtyPcs: row.deliveredQtyPcs,
    listRatePaise: row.listRatePaise,
    ratePaise: row.ratePaise,
    discountBps: row.discountBps,
    discountPaise: row.discountPaise,
    gstBps: row.gstBps,
    cessBps: row.cessBps,
    taxPaise: row.taxPaise,
    cessPaise: row.cessPaise,
    lineTotalPaise: row.lineTotalPaise,
    appliedRules: row.appliedRules,
    priceLocked: row.priceLocked,
  }
}

export function toTransition(row: TransitionRow): OrderDetail['transitions'][number] {
  return {
    id: row.id,
    fromState: row.fromState,
    toState: row.toState,
    event: row.event,
    actorId: row.actorId,
    deviceId: row.deviceId,
    reason: row.reason,
    occurredAt: row.occurredAt.toISOString(),
  }
}

export function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    kind: row.kind,
    orderId: row.orderId,
    entityType: row.entityType,
    entityId: row.entityId,
    requestedBy: row.requestedBy,
    status: row.status,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    decidedBy: row.decidedBy,
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
  }
}

/** A queue row: the approval with its order's number, total and shop, each null when no order is behind it. */
export function toApprovalQueueItem(
  row: ApprovalRow,
  order: {
    orderNo: string | null
    orderTotalPaise: number | null
    retailerId: string | null
    retailerName: string | null
  },
): ApprovalQueueItem {
  return {
    ...toApproval(row),
    orderNo: order.orderNo,
    orderTotalPaise: order.orderTotalPaise,
    retailerId: order.retailerId,
    retailerName: order.retailerName,
  }
}

/**
 * The full order view. `withApprovals` is false for a retailer-role caller: an approval payload carries the
 * shop's credit limit and outstanding, which never reach the retailer app (ADR 0006).
 */
export async function loadDetail(
  tx: Db,
  order: OrderRow,
  withApprovals: boolean,
): Promise<OrderDetail> {
  const lines = await tx
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, order.id))
    .orderBy(asc(salesOrderLines.lineNo))
  // One lookup for every line, owned by tenant-catalog: the alias first, the global name otherwise. The
  // fallback is unreachable while `sales_order_lines.variant_id` references `product_variants`.
  const names = await variantNames(
    tx,
    lines.map((l) => l.variantId),
  )
  const transitions = await tx
    .select()
    .from(orderStateTransitions)
    .where(eq(orderStateTransitions.orderId, order.id))
    .orderBy(asc(orderStateTransitions.occurredAt), asc(orderStateTransitions.id))
  const pending = withApprovals
    ? await tx
        .select()
        .from(approvals)
        .where(eq(approvals.orderId, order.id))
        .orderBy(asc(approvals.id))
    : []
  return {
    ...toOrder(order, withApprovals),
    lines: lines.map((l) => toOrderLine(l, names.get(l.variantId) ?? l.variantId)),
    transitions: transitions.map(toTransition),
    approvals: pending.map(toApproval),
  }
}
