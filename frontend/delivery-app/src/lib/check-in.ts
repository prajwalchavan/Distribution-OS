/**
 * D8 End of day — the check-in gate and the hand-over figure (DOS-168 · DOS-169 · DOS-170).
 *
 * Pure rules, no React, no kit, no imports, so both can be read in a test without Metro.
 *
 * WHAT CHANGED UNDERNEATH THEM. `trips.settlementPreview` used to add up `collections` rows only,
 * and a doorstep payment taken with no signal goes back as a `receipts` op — so the office never
 * counted it, and this screen made up the difference by adding the phone's own cash on top. DOS-169
 * moved the count to the trip's RECEIPTS, however they arrived, so the office now sees that money
 * the moment it lands. The phone therefore adds only what it STILL HOLDS; anything else asks the
 * driver for the same rupee twice.
 *
 * And once the trip has settled, the phone adds nothing at all. The figures of a settled trip are
 * the figures it settled with, and a receipt that reaches the office afterwards is refused
 * `trip_settled` (founder, 2026-09-14) — that money goes to the cashier over the counter, so the
 * screen names it instead of folding it into a hand-over the office has already closed.
 */

/** The part of `trips.settlementPreview` the arithmetic below needs. */
export interface DayEndFigures {
  /** `openingCashPaise + Σ cash receipts − Σ expenses`, as the office counts it. */
  readonly expectedCashPaise: number
  readonly cashCollectedPaise: number
  readonly upiCollectedPaise: number
  readonly chequeCollectedPaise: number
}

/** Why "Check the vehicle in" is refused, or `null` when it is not. */
export type CheckInBlock = 'notActive' | 'offline' | 'pending' | 'odometer'

/** What D8 shows under "Cash the office expects". */
export interface DayEndCash {
  /** What the driver hands the cashier; `null` until the preview has been read. */
  readonly handOverPaise: number | null
  /** Doorstep money of any mode that this phone still holds, cash and UPI and cheques together. */
  readonly uncountedAllPaise: number
  /** The sentence under the figure, or `null` when the office has everything. */
  readonly note: 'd8.uncounted' | 'd8.uncountedSettled' | null
}

/**
 * Whether the vehicle can be checked in, and the first reason it cannot.
 *
 * The order is the order the driver can act on. The trip and the signal come first because neither
 * is about this phone's records. Then the OUTBOX: `trips.return` closes the trip to the office, and
 * the office settles what has reached it, so a queued doorstep receipt has to go first or it is
 * refused when it finally lands. The odometer is last — it is the one thing the driver fixes here.
 *
 * `pending` is queued + sending (docs/27 §10). A REJECTED write does not block: it will never leave
 * on its own, the Needs-attention tray owns it, and blocking on it would strand the vehicle.
 */
export function checkInBlock(input: {
  readonly onTheRoad: boolean
  readonly online: boolean
  readonly pending: number
  readonly odometerBad: boolean
}): CheckInBlock | null {
  if (!input.onTheRoad) return 'notActive'
  if (!input.online) return 'offline'
  if (input.pending > 0) return 'pending'
  if (input.odometerBad) return 'odometer'
  return null
}

/**
 * The hand-over figure and the sentence beside it.
 *
 * `deviceAllPaise − everything the office counted` is what this phone is still carrying. Only its
 * CASH half moves the hand-over figure, because UPI and a cheque are not in the driver's hand; the
 * sentence names all of it either way, so "the office expects ₹8,000" is never read next to a phone
 * holding a ₹2,500 UPI receipt with nothing said.
 */
export function dayEndCash(input: {
  readonly tripState: string | null
  readonly figures: DayEndFigures | undefined
  readonly deviceCashPaise: number
  readonly deviceAllPaise: number
}): DayEndCash {
  const { figures } = input
  if (figures === undefined) return { handOverPaise: null, uncountedAllPaise: 0, note: null }

  const counted =
    figures.cashCollectedPaise + figures.upiCollectedPaise + figures.chequeCollectedPaise
  const uncountedAllPaise = Math.max(0, input.deviceAllPaise - counted)

  /* A closed trip reports the figures it settled with; nothing on this phone is added to them. */
  if (input.tripState === 'settled' || input.tripState === 'settled_with_variance') {
    return {
      handOverPaise: figures.expectedCashPaise,
      uncountedAllPaise,
      note: uncountedAllPaise === 0 ? null : 'd8.uncountedSettled',
    }
  }

  const uncountedCashPaise = Math.max(0, input.deviceCashPaise - figures.cashCollectedPaise)
  return {
    handOverPaise: figures.expectedCashPaise + uncountedCashPaise,
    uncountedAllPaise,
    note: uncountedAllPaise === 0 ? null : 'd8.uncounted',
  }
}
