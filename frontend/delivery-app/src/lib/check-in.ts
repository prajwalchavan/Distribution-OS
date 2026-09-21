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
 * The state it branches on is the one the PREVIEW answered with, never the screen's local-first trip
 * row: the office may settle while the driver is standing on D8, and the row catches up a delta pull
 * later. Figures and the rule that reads them come from one snapshot or they disagree in that window.
 *
 * And once the trip has settled, the phone adds nothing at all. The figures of a settled trip are
 * the figures it settled with, and a receipt that reaches the office afterwards is refused
 * `trip_settled` (founder, 2026-09-14) — that money goes to the cashier over the counter, so the
 * screen names it instead of folding it into a hand-over the office has already closed.
 */

/**
 * The part of `trips.settlementPreview` the arithmetic below needs — ONE SNAPSHOT.
 *
 * The state rides WITH the figures on purpose. The screen's own trip row is local-first and lags a
 * settlement by one delta pull, so branching on it would run the not-settled arithmetic over settled
 * figures and ask the driver for the same rupee twice; the preview carries the state it answered
 * with, and that is the only state this file reads.
 */
export interface DayEndFigures {
  /** The trip's state as of the moment these figures were computed. */
  readonly tripState: string
  /** `openingCashPaise + Σ cash receipts − Σ expenses`, as the office counts it. */
  readonly expectedCashPaise: number
  readonly cashCollectedPaise: number
  readonly upiCollectedPaise: number
  readonly chequeCollectedPaise: number
}

/**
 * A doorstep receipt as D8 counts it — its mode, its money, and what the outbox is doing with it.
 *
 * Structurally `LocalReceipt`; declared here so the rules stay free of React and of the device schema.
 */
export interface DeviceReceipt {
  readonly mode: string
  readonly amount_paise: number
  readonly _pending?: 'queued' | 'sending' | 'rejected' | 'kept' | null
}

/**
 * What THIS PHONE is carrying, and which part of it the office has not answered for (DOS-178, S-183).
 *
 * A receipt the office refused and the crew handed to the cashier stays on the phone for ever — nothing a
 * person entered is ever thrown away (never-list #13) — but it is the cashier's money from that moment
 * on. Counting it here would put it back into "Hand ₹X to the cashier" and ask the driver for the same
 * notes a second time, at the counter, having already put them down. `kept` is the only status that
 * leaves: queued, sending and rejected money is all still the driver's.
 *
 * `cashPaise` is every rupee of doorstep CASH this trip's receipts add up to on this device, the total
 * the screen needs when the office cannot be reached at all and there is no server figure to add to.
 *
 * `held*` is the OUTBOX half, and it is a different question: money the office has not taken —
 * `queued`, `sending`, or refused outright. The DOS-168..170 ruling's risk (e)(2) named this: held
 * money used to be `Σ local receipts − Σ the office counted`, exact only while this phone's table is a
 * superset of the server's. A trip has a driver AND a helper, so a helper's landed receipt of the same
 * amount, not yet pulled to this device, made the difference zero and the sentence vanish while this
 * phone really was holding it. A row's own `_pending` cannot be masked that way.
 */
export function deviceMoney(rows: readonly DeviceReceipt[]): {
  readonly cashPaise: number
  readonly heldCashPaise: number
  readonly heldAllPaise: number
} {
  const mine = rows.filter((row) => row._pending !== 'kept')
  const held = mine.filter(
    (row) => row._pending === 'queued' || row._pending === 'sending' || row._pending === 'rejected',
  )
  const cash = (rowsIn: readonly DeviceReceipt[]): number =>
    rowsIn.filter((row) => row.mode === 'cash').reduce((sum, row) => sum + row.amount_paise, 0)
  return {
    cashPaise: cash(mine),
    heldCashPaise: cash(held),
    heldAllPaise: held.reduce((sum, row) => sum + row.amount_paise, 0),
  }
}

/** Why "Check the vehicle in" is refused, or `null` when it is not. */
export type CheckInBlock = 'notActive' | 'offline' | 'pending' | 'odometer'

/** What D8 shows under "Cash the office expects". */
export interface DayEndCash {
  /** What the driver hands the cashier; `null` until the preview has been read. */
  readonly handOverPaise: number | null
  /** Doorstep money of any mode that this phone still holds, cash and UPI and cheques together. */
  readonly uncountedAllPaise: number
  /**
   * The sentence under the figure, or `null` when the office has everything.
   *
   * A keep WORD, not a string key (DOS-179): both sentences say "This phone holds {amount} in receipts",
   * which is false on a browser with no OPFS. The screen turns the word into a key through `keepKey`, so
   * the money sentence agrees with the strip above it instead of contradicting it. This file stays free
   * of the device — which store opened is not arithmetic — and of the strings catalogue.
   */
  readonly note: 'uncounted' | 'uncountedSettled' | null
}

/**
 * Whether the vehicle can be checked in, and the first reason it cannot.
 *
 * The order is the order the driver can act on, and the reason has to be the one that will STILL be
 * there when the thing above it clears. The trip comes first: a van that is not on the road is not
 * checked in from here at all. Then the OUTBOX — `trips.return` closes the trip to the office, and
 * the office settles what has reached it, so a queued doorstep receipt has to go first or it is
 * refused when it finally lands. Only then the signal, which is not a reason of its own while
 * records are waiting: it is merely HOW they leave. The odometer is last — the one thing the driver
 * fixes on this screen.
 *
 * S-184 reordered those two. `offline` answered first, so `pending` was unreachable with no signal —
 * the state D8 exists for — and the driver holding ₹1,544 the office had never seen was told about a
 * van sale instead (day.tsx borrowed `d6.online` for it). Measured 3/3 on web at both widths,
 * money-web.md §5(A); `d8.pendingBlocks` was never once observed. Both orders refuse the button, so
 * nothing about the gate itself moves: a van still cannot leave with money on the phone.
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
  if (input.pending > 0) return 'pending'
  if (!input.online) return 'offline'
  if (input.odometerBad) return 'odometer'
  return null
}

/**
 * The hand-over figure and the sentence beside it — ONE rule, in every state the screen can be in.
 *
 * Held money is the outbox's (`deviceMoney`): only its CASH half moves the hand-over figure, because
 * UPI and a cheque are not in the driver's hand; the sentence names all of it either way, so "the
 * office expects ₹8,000" is never read next to a phone holding a ₹2,500 UPI receipt with nothing said.
 *
 * S-183: WITH NO SIGNAL THIS STILL ANSWERS. `figures` is the server's preview and cannot resolve
 * offline, and the rule used to return nothing at all — so on the exact state D8 exists for, the
 * driver was never told the phone was holding money. The device knows enough to say: the float is on
 * its own trip row, the doorstep receipts are its own. The figure it gives is the office's own
 * arithmetic minus what only the office can see — this trip's expenses, and anything a helper's phone
 * took — so it is an estimate, and the panel says so above it (`d.noConnectionRead`). It is the
 * figure the bottom bar was already computing privately; owning it here is what keeps the sentence
 * and the rupee from disagreeing.
 *
 * `officeUnreachable` is not "figures are missing": a read still in flight is not an answer, and a
 * device figure that flashes and then changes under the driver's eyes is its own kind of lie.
 */
export function dayEndCash(input: {
  readonly figures: DayEndFigures | undefined
  /** The office read has FAILED or there is no signal — not merely "has not come back yet". */
  readonly officeUnreachable: boolean
  /** The float the cashier handed out, from this device's own trip row. */
  readonly openingCashPaise: number
  /** Every rupee of doorstep cash on this trip's receipts on this device, `kept` excluded. */
  readonly deviceCashPaise: number
  readonly heldCashPaise: number
  readonly heldAllPaise: number
}): DayEndCash {
  const { figures, heldAllPaise } = input

  if (figures === undefined) {
    /*
     * No office figure to build on. What the device can account for: the float it was given plus the
     * cash it took at doors. The note is `uncounted` — with no preview there is no trip state to read
     * (this rule takes none by design), and "not reached the office yet" is the true half of it.
     */
    if (!input.officeUnreachable) return { handOverPaise: null, uncountedAllPaise: 0, note: null }
    return {
      handOverPaise: input.openingCashPaise + input.deviceCashPaise,
      uncountedAllPaise: heldAllPaise,
      note: heldAllPaise === 0 ? null : 'uncounted',
    }
  }

  /*
   * A closed trip reports the figures it settled with; nothing on this phone is added to them. The
   * state is the SNAPSHOT'S, not the screen's: the office can settle while the driver is standing on
   * this screen, and the preview says so a pull before the phone's own trip row does.
   */
  if (figures.tripState === 'settled' || figures.tripState === 'settled_with_variance') {
    return {
      handOverPaise: figures.expectedCashPaise,
      uncountedAllPaise: heldAllPaise,
      note: heldAllPaise === 0 ? null : 'uncountedSettled',
    }
  }

  return {
    handOverPaise: figures.expectedCashPaise + input.heldCashPaise,
    uncountedAllPaise: heldAllPaise,
    note: heldAllPaise === 0 ? null : 'uncounted',
  }
}
