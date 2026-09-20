/**
 * S3 — WHAT THE OFFICE DID WITH THIS ORDER, and what it will do before the rep taps Place (DOS-081).
 *
 * Two holes, one subject. After the tap, the banner read "Order placed — The office has it, with its
 * number and its price" for a strict shop whose order was held on a credit gate, for a stop shop and
 * for a warn shop over its limit alike; the hold was visible only if the rep opened the order. Before
 * the tap, the shop card said the office checks credit "not here", although the rep may call
 * `receivables.creditCheck` and the server's own answer is one request away.
 *
 * Both halves are PURE here, and neither re-implements the credit rule: the first reads the submit
 * reply's `state` and `approvalFlags`, the second reads the verdict's own reasons. The chip never
 * disables Place — stop and strict HOLD the order, they do not refuse it at the doorway
 * (docs/plans/receivables.md §4.14) — and the server's submit-time check stays the decision.
 */
import type { OrderOutcome } from './outcome'

/** The submit reply, as much of it as the sentence depends on. */
export interface PlacedReply {
  readonly state: string
  readonly approvalFlags: readonly string[]
}

export interface PlacedCopy {
  readonly titleKey: string
  readonly bodyKey: string
  readonly buttonKey: string
}

/**
 * The banner's words for an order that really reached the office.
 *
 * `orderOutcome` (DOS-180) already decides between placed, queued, a draft and a refusal from facts
 * about the order; this narrows its `placed` branch, which is the only one where the office has
 * answered: a `submitted` order is WAITING, not placed, and it says what it waits on. Credit comes
 * first when more than one gate stands — it is the one that stops the goods.
 */
export function placedCopy(
  outcome: OrderOutcome,
  reply: PlacedReply | null | undefined,
): PlacedCopy {
  const spoken = {
    titleKey: outcome.titleKey,
    bodyKey: outcome.bodyKey,
    buttonKey: outcome.buttonKey,
  }
  if (outcome.kind !== 'placed' || reply == null || reply.state !== 'submitted') return spoken
  const flags = reply.approvalFlags
  if (flags.includes('credit_limit'))
    return { titleKey: 's3.heldCreditTitle', bodyKey: 's3.heldCreditBody', buttonKey: 's3.held' }
  if (flags.includes('bargain'))
    return { titleKey: 's3.heldBargainTitle', bodyKey: 's3.heldBargainBody', buttonKey: 's3.held' }
  if (flags.includes('below_floor'))
    return { titleKey: 's3.heldFloorTitle', bodyKey: 's3.heldFloorBody', buttonKey: 's3.held' }
  // Submitted with no gate at all: it is with the office and nobody is waiting on a decision.
  return { titleKey: 's3.heldTitle', bodyKey: 's3.heldBody', buttonKey: 's3.held' }
}

/** As much of `receivables.creditCheck`'s verdict as the chip reads. */
export interface CreditVerdictLike {
  readonly creditMode: 'indicate' | 'strict' | 'stop'
  readonly reasons: readonly string[]
  /** Limit − outstanding − this order: negative is over the limit, in paise. */
  readonly headroomPaise: number
  readonly overdueDays: number
}

export interface CreditChipCopy {
  readonly family: 'brick' | 'ochre'
  readonly key:
    | 's3.creditWillHoldOver'
    | 's3.creditWillHoldOverNet'
    | 's3.creditWillHoldOverdue'
    | 's3.creditWillHoldBills'
    | 's3.creditWarnOver'
    | 's3.creditWarnOverNet'
    | 's3.creditWarnOverdue'
    | 's3.creditWarnBills'
  /** Paise over the rupee limit; 0 when the rupee limit is not what is breached. */
  readonly overPaise: number
  /** Days past the agreed credit days; 0 when that is not what is breached. */
  readonly overdueDays: number
}

/**
 * WHICH FIGURE the office was asked about — the review's own correction to DOS-081.
 *
 * `payable` is the order's GST-and-cess-inclusive total, which is what the server's submit-time gate
 * weighs (`approvalFlags()` → `checkCredit(tx, retailerId, order.totalPaise)`). `before-gst` is the
 * device engine's net, all the phone has with no signal or before the quote lands — a smaller figure,
 * so a shop that will be held can look as though it fits. The chip must then SAY so.
 */
export type CreditBasis = 'payable' | 'before-gst'

/** The amount to ask `receivables.creditCheck` about, and the basis the chip must own up to. */
export interface CreditAsk {
  readonly amountPaise: number
  readonly basis: CreditBasis
}

/**
 * The payable whenever the screen has one, the device net otherwise.
 *
 * Both arguments are already the screen's own figures: `payablePaise` is `payableSummary`'s, which is
 * null unless `pricing.quote` answered for THIS basket (DOS-083), and `netPaise` is the device
 * engine's. Nothing here computes a rate — the phone has no `hsn_rates` — it only picks which of two
 * known figures the office is asked about, and records which one that was.
 */
export function creditAsk(payablePaise: number | null | undefined, netPaise: number): CreditAsk {
  if (payablePaise == null) return { amountPaise: netPaise, basis: 'before-gst' }
  return { amountPaise: payablePaise, basis: 'payable' }
}

/**
 * The chip under the total, before Place. Nothing to say is `null` — never a reassuring green chip,
 * which would be one more thing to read at a counter.
 *
 * `basis` is not optional on purpose: a rupee figure read across a counter must carry the basis it
 * was computed on, and a default would let a call site forget it silently (review of DOS-081).
 */
export function creditChipCopy(
  verdict: CreditVerdictLike | null | undefined,
  basis: CreditBasis,
): CreditChipCopy | null {
  if (verdict == null || verdict.reasons.length === 0) return null
  const holds = verdict.creditMode === 'strict' || verdict.creditMode === 'stop'
  const family = holds ? 'brick' : 'ochre'
  const overPaise = Math.max(0, -verdict.headroomPaise)
  if (verdict.reasons.includes('limit_exceeded')) {
    /*
     * The only sentence whose truth depends on the amount: "over the limit by ₹X". On the net it is
     * understated by exactly the tax, so it says "(before GST)" until the payable is what was sent.
     */
    const net = basis === 'before-gst'
    return {
      family,
      key: holds
        ? net
          ? 's3.creditWillHoldOverNet'
          : 's3.creditWillHoldOver'
        : net
          ? 's3.creditWarnOverNet'
          : 's3.creditWarnOver',
      overPaise,
      overdueDays: 0,
    }
  }
  if (verdict.reasons.includes('overdue_days_exceeded'))
    return {
      family,
      key: holds ? 's3.creditWillHoldOverdue' : 's3.creditWarnOverdue',
      overPaise: 0,
      overdueDays: verdict.overdueDays,
    }
  return {
    family,
    key: holds ? 's3.creditWillHoldBills' : 's3.creditWarnBills',
    overPaise: 0,
    overdueDays: 0,
  }
}
