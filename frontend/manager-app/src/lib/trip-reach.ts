/**
 * What the desk may do about a trip, and about a bill riding one, as pure functions of the trip's
 * state (QA DOS-196). M7 Trips draws these; it decides nothing itself, because the rules are the
 * server's and the screen must follow them from the same moment the server does.
 *
 * THE SERVER'S TWO RULES, in the trip machine's words (`@dos/domain` state-machines/delivery.ts:
 * planned → loading → active --return--> closing → settled | settled_with_variance; cancelled at any
 * point before departure):
 *
 *  - A late bill goes only on a trip that has not left. `delivery.stops.add` is refused once the trip
 *    is `active`, so the panel is offered only in `planned` and `loading` (`TRIP_TAKES_A_LATE_BILL`).
 *
 *  - A bill that came back undelivered rides its van until the van CHECKS IN, not until the cash is
 *    settled. The road hold in `delivery.internals.ts` (`ridingTrips`) holds a failed bill only while
 *    `trips.state = 'active'`; `trips.return` moves the trip to `closing` and the bill is on the
 *    planning board that instant — `load-out.spec.ts` proves it ("check-in frees it at once, before
 *    any settlement"). So the Undelivered register says "plan it again" from `closing` on
 *    (`TRIP_BACK_AT_THE_GODOWN`), and says "back after check-in" only while the trip is still out.
 */

/** The trip states a late bill can still be added to. */
export const TRIP_TAKES_A_LATE_BILL: ReadonlySet<string> = new Set(['planned', 'loading'])

/**
 * The trip states in which the van is no longer carrying an undelivered bill: it checked in
 * (`closing`), it was settled either way, or it never left.
 */
export const TRIP_BACK_AT_THE_GODOWN: ReadonlySet<string> = new Set([
  'closing',
  'settled',
  'settled_with_variance',
  'cancelled',
])

/** The one thing the desk does about an undelivered bill: plan it again, or wait for its van. */
export type UndeliveredNext = 'plan' | 'wait'

export function undeliveredNext(tripState: string): UndeliveredNext {
  return TRIP_BACK_AT_THE_GODOWN.has(tripState) ? 'plan' : 'wait'
}

/**
 * The trips register's reach column states a fact about the TRIP only: "on the road" when the van has
 * left, so the row opens nothing. A viewer who may not add a bill at all (the accountant, who lacks
 * `delivery.stops.add`) is told nothing here — a trip standing at the godown is not "on the road"
 * because the reader cannot change it.
 */
export type TripReach = 'onTheRoad' | null

export function tripReach(tripState: string, mayAdd: boolean): TripReach {
  return mayAdd && TRIP_TAKES_A_LATE_BILL.has(tripState) ? null : 'onTheRoad'
}
