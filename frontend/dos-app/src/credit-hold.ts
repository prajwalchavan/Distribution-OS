/**
 * QA DOS-313 (architect ruling 4) at the approval door. An order that waited on a rate or a below-floor
 * gate was not counted against the shop's limit while it waited, so the server measures the shop again
 * when the last gate is approved, or when the desk confirms an order by hand. If the order would now take
 * a holding shop over its limit it is NOT confirmed: the reply is the order still `submitted`, with a new
 * pending `credit_limit` approval on it. The owner's and the manager's screens read that off the reply
 * and say so, instead of saying nothing (DOS-155: the toast states what actually happened).
 *
 * Pure and shared by both desks, so the rule is pinned by a test and the screens only print it.
 */
export interface HoldableOrder {
  readonly state: string
  readonly approvals?: readonly { readonly kind: string; readonly status: string }[] | undefined
}

export function heldForCredit(order: HoldableOrder | null | undefined): boolean {
  if (order === null || order === undefined || order.state !== 'submitted') return false
  return (order.approvals ?? []).some((a) => a.kind === 'credit_limit' && a.status === 'pending')
}
