/**
 * What an order is still waiting on, read from the approvals themselves (DOS-027).
 *
 * `sales_orders.approval_flags` is a stored copy of the gates raised at submit; nothing keeps it in
 * step with the decisions afterwards, and the seed leaves it empty, so the queue's "Waiting on"
 * column was blank for an order with two gates pending. `orders.approvals.list` is the live list the
 * approvals panel already reads on this screen, and the server's own rule is written against those
 * rows — an order confirms only when none of them is pending (`approvals.service.ts:195`) — so the
 * column states them.
 *
 * Pure on purpose: no query, no translation, no React. The screen passes the rows it already holds
 * and turns the kinds into words with `useWord()`.
 */

/** A row of `orders.approvals.list`, narrowed to what deciding "whose gate is this" needs. */
export interface PendingGate {
  readonly kind: string
  readonly status: string
  /** Set on every gate raised at submit; null on a gate raised against something else. */
  readonly orderId: string | null
  /** The shop the gate's order belongs to, or the shop the gate itself is about. */
  readonly retailerId: string | null
}

export interface GatedOrder {
  readonly id: string
  readonly retailerId: string
}

/**
 * The kinds `order` is still waiting on, most recently raised first, each named once.
 *
 * A gate belongs to this order when it names it. The one exception is a credit-limit gate raised
 * against the SHOP rather than an order (`entityType: 'retailer'`, no `orderId`): the shop's limit
 * is what that order is held by, so it counts for every order of that shop. No other kind reaches an
 * order through its shop — a trip settlement is nobody's order.
 */
export function waitingOnKinds(order: GatedOrder, gates: readonly PendingGate[]): string[] {
  const kinds: string[] = []
  for (const gate of gates) {
    if (gate.status !== 'pending') continue
    const mine =
      gate.orderId === order.id ||
      (gate.orderId === null &&
        gate.kind === 'credit_limit' &&
        gate.retailerId === order.retailerId)
    if (!mine || kinds.includes(gate.kind)) continue
    kinds.push(gate.kind)
  }
  return kinds
}
