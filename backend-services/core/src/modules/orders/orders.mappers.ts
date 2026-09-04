import { asc, eq } from 'drizzle-orm'
import type { Approval, Order, OrderDetail, OrderLine } from '@dos/contracts'
import type { salesOrders } from '@dos/db'
import { approvals, orderStateTransitions, salesOrderLines, type Db } from '@dos/db'

/** Drizzle rows in, contract shapes out (docs/16 §2): no Drizzle row ever leaves the module. */

export type OrderRow = typeof salesOrders.$inferSelect
export type OrderLineRow = typeof salesOrderLines.$inferSelect
export type TransitionRow = typeof orderStateTransitions.$inferSelect
export type ApprovalRow = typeof approvals.$inferSelect

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

export function toOrder(row: OrderRow): Order {
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
    roundOffPaise: row.roundOffPaise,
    totalPaise: row.totalPaise,
    approvalFlags: row.approvalFlags,
    expectedDeliveryDate: row.expectedDeliveryDate,
    note: row.note,
    submittedAt: iso(row.submittedAt),
    confirmedAt: iso(row.confirmedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toOrderLine(row: OrderLineRow): OrderLine {
  return {
    id: row.id,
    lineNo: row.lineNo,
    variantId: row.variantId,
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
    taxPaise: row.taxPaise,
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
    ...toOrder(order),
    lines: lines.map(toOrderLine),
    transitions: transitions.map(toTransition),
    approvals: pending.map(toApproval),
  }
}
