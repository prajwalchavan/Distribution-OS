/**
 * The desk's credit line (UX-01 M4) reads the SAME figures the rep's shop card reads (QA DOS-312/313,
 * architect rulings 3 and 4): what the shop owes NET of the money it has already paid on account, and
 * the confirmed orders not billed yet that the credit check also counts. Pure, so the rule is pinned by a
 * test and the screen only prints it.
 */
import { netDuesPaise } from '@dos/domain'

/** A credit verdict (`receivables.creditCheck`) or the credit notice stored on an order at submit. */
export interface CreditFigures {
  readonly outstandingPaise: number
  readonly unallocatedCreditPaise?: number | undefined
  readonly unbilledOrdersPaise?: number | undefined
}

/** "Owes": the dues after the shop's money on account, never below zero — the rep's "Owes" too. */
export function owedNet(c: CreditFigures): number {
  return netDuesPaise(c.outstandingPaise, c.unallocatedCreditPaise ?? 0)
}

/** Confirmed orders of the shop that carry no bill yet: counted against the limit (DOS-313). */
export function promisedPaise(c: CreditFigures): number {
  return Math.max(0, c.unbilledOrdersPaise ?? 0)
}

/**
 * The order total the line is asked with. An order still waiting (draft or submitted) is not in the
 * shop's exposure yet, so the line shows the headroom AFTER it. A confirmed order is already counted —
 * among the orders not billed yet, or as its bill — so asking with its total again would count it twice;
 * it is asked with nothing on top and the line says how far over the limit the shop stands.
 */
export function creditAskTotal(order: { readonly state: string; readonly totalPaise: number }): {
  readonly totalPaise: number
  readonly waiting: boolean
} {
  const waiting = order.state === 'draft' || order.state === 'submitted'
  return { totalPaise: waiting ? order.totalPaise : 0, waiting }
}
