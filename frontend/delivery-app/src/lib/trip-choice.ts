/**
 * Which trip the crew's phone opens on, where a trip row leads, and what a load sheet is called
 * (DOS-061).
 *
 * Pure rules over rows the device already holds: no React, no SQLite, no kit. Every screen that names
 * "the" trip (home, expenses, end of day and start with no trip in the route, the location tracker)
 * asks `pickCurrentTrip`, so they can never name two different trips at once.
 */
import { tripMachine, type TripState } from '@dos/domain'

/**
 * The states a crew member's trip can be open in, IN RANK ORDER. Do not reorder.
 *
 * `active` first: a van on the road is the trip, whatever date it was planned for. Then `loading` and
 * `planned`: the next thing the crew has to do. `closing` last: a checked-in trip waits for the office
 * to count and settle it and needs nothing from the crew, so it must not take the home from the next
 * trip.
 */
export const OPEN_TRIP_STATES = ['active', 'loading', 'planned', 'closing'] as const

/**
 * The open trip a crew member should be looking at. A total order, so the answer never depends on the
 * order the rows arrive in:
 *
 * 1. state rank (`OPEN_TRIP_STATES`; any other state last);
 * 2. the trip dated `today` (the IST business date) first;
 * 3. then the earliest `trip_date`, so a trip still out from yesterday beats one the godown sent out
 *    early for a later day;
 * 4. then the lowest id.
 */
export function pickCurrentTrip<T extends { id: string; state: string; trip_date: string }>(
  trips: readonly T[],
  today: string,
): T | null {
  const rank = (state: string): number => {
    const index = OPEN_TRIP_STATES.indexOf(state as (typeof OPEN_TRIP_STATES)[number])
    return index === -1 ? OPEN_TRIP_STATES.length : index
  }
  const compare = (a: T, b: T): number => {
    const byState = rank(a.state) - rank(b.state)
    if (byState !== 0) return byState
    const aToday = a.trip_date === today
    if (aToday !== (b.trip_date === today)) return aToday ? -1 : 1
    if (a.trip_date !== b.trip_date) return a.trip_date < b.trip_date ? -1 : 1
    if (a.id !== b.id) return a.id < b.id ? -1 : 1
    return 0
  }
  return [...trips].sort(compare)[0] ?? null
}

/**
 * Where a trip row leads. A trip that can still start loading or depart goes to the Start screen; one
 * that has left (on the road, or checked in and waiting for the office) opens its own end-of-day
 * summary with its stops, the route a Trip history row already takes. The Start screen can do nothing
 * for a trip that has left except refuse.
 */
export function tripEntryHref(trip: {
  id: string
  state: string
}): `/trip/start?tripId=${string}` | `/day?tripId=${string}` {
  const state = trip.state as TripState
  return tripMachine.can(state, 'start_loading') || tripMachine.can(state, 'depart')
    ? `/trip/start?tripId=${trip.id}`
    : `/day?tripId=${trip.id}`
}

/**
 * The carton line under one load sheet. Only a CONFIRMED sheet is on board: a draft is built but
 * nothing has moved yet, and a cancelled sheet carries no carton line at all (its chip says so).
 */
export function loadSheetPackagesKey(status: string): 'd1.packages' | 'd1.packagesPlanned' | null {
  if (status === 'confirmed') return 'd1.packages'
  if (status === 'draft') return 'd1.packagesPlanned'
  return null
}

/**
 * The load panel's heading. "Load on board" is a claim, so it is made only when a sheet is confirmed;
 * with sheets but none confirmed the panel is just the load sheet. No sheet at all keeps the heading
 * the empty state has always had.
 */
export function loadPanelTitleKey(statuses: readonly string[]): 'd1.load' | 'd1.loadPlanned' {
  return statuses.length > 0 && !statuses.includes('confirmed') ? 'd1.loadPlanned' : 'd1.load'
}
