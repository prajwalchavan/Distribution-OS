/**
 * DOS-061 — which trip the crew's phone opens on, where a trip row leads, and what a load sheet is
 * called.
 *
 * The rows are shaped like ganesh.more's trips in dos_qa on 12 Sep 2026 (IST): TRIP-ACTIVE dated that
 * day with 9 of 10 stops done, and TRIP-NEXT dated 14 Sep that the godown sent out early with a draft
 * sheet — both `active`. They are supplied in `useLocalTrips` order (trip_date DESC) and reversed,
 * because the comparator this replaces never returned 0 and so answered differently per input order.
 *
 * Pure rules only: no database, no network, no React.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import {
  OPEN_TRIP_STATES,
  loadPanelTitleKey,
  loadSheetPackagesKey,
  pickCurrentTrip,
  tripEntryHref,
} from './trip-choice'

interface Trip {
  id: string
  trip_no: string
  state: string
  trip_date: string
}

const TODAY = '2026-09-12'

const TRIP_ACTIVE: Trip = {
  id: 'dda35990-f442-7931-8da4-5808f09a33b6',
  trip_no: 'TRIP-ACTIVE',
  state: 'active',
  trip_date: '2026-09-12',
}
const TRIP_NEXT: Trip = {
  id: '72649337-4c50-7033-a988-ca5cf4406f9c',
  trip_no: 'TRIP-NEXT',
  state: 'active',
  trip_date: '2026-09-14',
}

const trip = (trip_no: string, state: string, trip_date: string, id: string): Trip => ({
  id,
  trip_no,
  state,
  trip_date,
})

/** Every order the rows could arrive in. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  )
}

const pickedNo = (trips: readonly Trip[], today: string = TODAY): string | undefined =>
  pickCurrentTrip(trips, today)?.trip_no

/** The catalogue as the translator sees it: a key that is missing prints as itself on screen. */
const catalogue: Readonly<Record<string, string>> = strings

describe('delivery trip choice', () => {
  it("DOS-061: today's active trip is Today's trip, not a later-dated active one, whatever order the rows arrive in", () => {
    // The dos_qa pair, in useLocalTrips order and reversed.
    expect(pickedNo([TRIP_NEXT, TRIP_ACTIVE])).toBe('TRIP-ACTIVE')
    expect(pickedNo([TRIP_ACTIVE, TRIP_NEXT])).toBe('TRIP-ACTIVE')

    // The trip dated today also beats an older active trip still out, in every arrival order.
    const older = trip('TRIP-OLDER', 'active', '2026-09-11', '0199e0a1-0000-7000-8000-000000000001')
    for (const order of permutations([TRIP_NEXT, TRIP_ACTIVE, older])) {
      expect(pickedNo(order)).toBe('TRIP-ACTIVE')
    }

    // Same state, same date: the answer never depends on the order (lowest id).
    const twin = trip('TRIP-TWIN', 'active', TODAY, 'f0a1c2d3-0000-7000-8000-000000000002')
    expect(pickedNo([twin, TRIP_ACTIVE])).toBe('TRIP-ACTIVE')
    expect(pickedNo([TRIP_ACTIVE, twin])).toBe('TRIP-ACTIVE')
  })

  it('DOS-061: an active trip still out from yesterday beats a future-dated active trip', () => {
    const yesterday = trip(
      'TRIP-YESTERDAY',
      'active',
      '2026-09-11',
      'e1b2c3d4-0000-7000-8000-000000000003',
    )
    expect(pickedNo([TRIP_NEXT, yesterday])).toBe('TRIP-YESTERDAY')
    expect(pickedNo([yesterday, TRIP_NEXT])).toBe('TRIP-YESTERDAY')

    // The day after: neither dos_qa trip is dated today, and the one still out from the 12th wins.
    expect(pickedNo([TRIP_NEXT, TRIP_ACTIVE], '2026-09-13')).toBe('TRIP-ACTIVE')
    expect(pickedNo([TRIP_ACTIVE, TRIP_NEXT], '2026-09-13')).toBe('TRIP-ACTIVE')
  })

  it("DOS-061: an active trip still outranks today's planned trip (midnight rule kept)", () => {
    const stillOut = trip(
      'TRIP-OUT',
      'active',
      '2026-09-11',
      'f9000000-0000-7000-8000-000000000004',
    )
    const plannedToday = trip(
      'TRIP-PLANNED',
      'planned',
      TODAY,
      '01000000-0000-7000-8000-000000000005',
    )
    const loadingToday = trip(
      'TRIP-LOADING',
      'loading',
      TODAY,
      '02000000-0000-7000-8000-000000000006',
    )
    for (const order of permutations([plannedToday, stillOut, loadingToday])) {
      expect(pickedNo(order)).toBe('TRIP-OUT')
    }
  })

  it('DOS-061: a checked-in (closing) trip does not take the home from a loading or planned trip (state rank unchanged by the extraction)', () => {
    expect(OPEN_TRIP_STATES).toEqual(['active', 'loading', 'planned', 'closing'])

    // Checked in today, waiting for the office to settle; the next trips are dated tomorrow.
    const checkedIn = trip('TRIP-CLOSING', 'closing', TODAY, '00000000-0000-7000-8000-000000000007')
    const planned = trip(
      'TRIP-PLANNED',
      'planned',
      '2026-09-13',
      'fa000000-0000-7000-8000-000000000008',
    )
    const loading = trip(
      'TRIP-LOADING',
      'loading',
      '2026-09-13',
      'fb000000-0000-7000-8000-000000000009',
    )

    expect(pickedNo([checkedIn, planned])).toBe('TRIP-PLANNED')
    expect(pickedNo([planned, checkedIn])).toBe('TRIP-PLANNED')
    expect(pickedNo([checkedIn, loading])).toBe('TRIP-LOADING')
    expect(pickedNo([loading, checkedIn])).toBe('TRIP-LOADING')
    for (const order of permutations([checkedIn, planned, loading])) {
      expect(pickedNo(order)).toBe('TRIP-LOADING')
    }
  })

  it('DOS-061: a trip on the road opens its stops, never the Start screen', () => {
    expect(tripEntryHref(TRIP_ACTIVE)).toBe(`/day?tripId=${TRIP_ACTIVE.id}`)
    expect(tripEntryHref(TRIP_NEXT)).toBe(`/day?tripId=${TRIP_NEXT.id}`)
    expect(tripEntryHref({ id: 'trip-closing', state: 'closing' })).toBe('/day?tripId=trip-closing')

    // Before the road the Start screen is still the way in.
    expect(tripEntryHref({ id: 'trip-planned', state: 'planned' })).toBe(
      '/trip/start?tripId=trip-planned',
    )
    expect(tripEntryHref({ id: 'trip-loading', state: 'loading' })).toBe(
      '/trip/start?tripId=trip-loading',
    )

    // The Start screen's way out for a trip that has left is a real sentence, not a key.
    expect(catalogue['d2.openTrip']).toBeDefined()
  })

  it('DOS-061: a draft load sheet is not counted as cartons on board', () => {
    // TRIP-NEXT's sheet: draft, 38 packages, no challan.
    const draftKey = loadSheetPackagesKey('draft')
    expect(draftKey).toBe('d1.packagesPlanned')
    const draftLine = catalogue[String(draftKey)]
    const draftLineOne = catalogue[`${String(draftKey)}.one`]
    expect(draftLine).toBeDefined()
    expect(draftLineOne).toBeDefined()
    expect(draftLine).not.toMatch(/on board/)
    expect(draftLineOne).not.toMatch(/on board/)

    // DC-0081, confirmed: on board. A cancelled sheet carries no carton line at all.
    expect(loadSheetPackagesKey('confirmed')).toBe('d1.packages')
    expect(loadSheetPackagesKey('cancelled')).toBeNull()

    // The panel heading makes the same claim: "Load on board" only once something is confirmed.
    expect(loadPanelTitleKey(['draft'])).toBe('d1.loadPlanned')
    expect(catalogue['d1.loadPlanned']).toBeDefined()
    expect(catalogue['d1.loadPlanned']).not.toMatch(/on board/)
    expect(loadPanelTitleKey(['cancelled'])).toBe('d1.loadPlanned')
    expect(loadPanelTitleKey(['draft', 'confirmed'])).toBe('d1.load')
    expect(loadPanelTitleKey(['confirmed'])).toBe('d1.load')
    // No sheet at all: the empty state is unchanged.
    expect(loadPanelTitleKey([])).toBe('d1.load')
  })
})
