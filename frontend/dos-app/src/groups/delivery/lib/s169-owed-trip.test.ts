/**
 * S-169 — after the desk settles the crew's own trip, D8 silently showed a DIFFERENT trip.
 *
 * Measured on web at both widths (QA/evidence/batch2/walks/money-web.md §5(B)). The phone was offline
 * holding ₹1,544 from a door; the desk returned and settled that trip; the phone came back online and
 * the op was refused `trip_settled` into the tray — exactly founder answer A, and the ledger was
 * right. Then D8 was re-opened:
 *
 * - at 1280×800 the settled row had dropped out of `useLocalTrips` (open states only), so
 *   `pickCurrentTrip` answered with **another open trip the same person is crew on** — a seeded
 *   12-Sep trip where he is the HELPER — and D8 read "Hand ₹5,000.00 to the cashier", that trip's
 *   float, money he is not holding;
 * - at 390×844, on a driver with no other open trip, D8 read "Nothing is on the road yet" while the
 *   phone was holding ₹1,544 of refused cash.
 *
 * Either way the settled trip's `expectedCashPaise` and the `d8.uncountedSettled` sentence could
 * never be shown, so the ruling's item 5(B) Pass condition was unreachable.
 *
 * THE RULE. End of day opens on the trip this phone still owes the office money for — receipts of its
 * own still queued, sending, or refused — whatever state that trip is in; only with nothing owed does
 * it fall back to the open trip `pickCurrentTrip` picks. Money the office has not taken is the one
 * thing on this screen that cannot wait for a trip to be open, and the settled branch of `dayEndCash`
 * is the only place that says where it goes. The trade: a crew member holding refused money from a
 * finished trip sees THAT trip here until they hand it over (the tray's one tap, `_pending = 'kept'`),
 * and reaches an open trip's check-in from Trip history, which already routes there with a `tripId`.
 */
import { describe, expect, it } from 'vitest'

import { dayEndTripId } from './trip-choice'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** One of this app's source files. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that quotes the old rule is not counted. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('S-169 which trip End of day opens on', () => {
  it('opens on the settled trip whose money this phone is still holding', () => {
    // The 1280×800 leg. `TRIP-SETTLED` settled while its ₹1,544 was on the phone and is gone from the
    // open rows; `TRIP-ACTIVE` is the other open trip, where this person is the helper. The money
    // decides: D8 shows the trip the driver has to account for, not the one he is riding along on.
    expect(dayEndTripId({ id: 'TRIP-ACTIVE' }, ['TRIP-SETTLED'])).toBe('TRIP-SETTLED')

    // The 390×844 leg: no open trip at all, and the screen used to say nothing is on the road while
    // the phone held the cash.
    expect(dayEndTripId(null, ['TRIP-SETTLED'])).toBe('TRIP-SETTLED')
  })

  it('leaves the ordinary day alone: the open trip wins whenever nothing is owed elsewhere', () => {
    // Driving, with a doorstep receipt of this trip still queued: same trip either way.
    expect(dayEndTripId({ id: 'TRIP-TODAY' }, ['TRIP-TODAY'])).toBe('TRIP-TODAY')

    // Nothing owed anywhere: the open trip, exactly as before.
    expect(dayEndTripId({ id: 'TRIP-TODAY' }, [])).toBe('TRIP-TODAY')

    // Owed on the open trip AND on an older one: the trip in hand is not taken away from the driver.
    expect(dayEndTripId({ id: 'TRIP-TODAY' }, ['TRIP-OLD', 'TRIP-TODAY'])).toBe('TRIP-TODAY')

    // Nothing open and nothing owed: there is no trip to show, and the screen says so.
    expect(dayEndTripId(null, [])).toBeNull()

    // Several owed trips, none of them open: the most recent, which the caller orders first.
    expect(dayEndTripId(null, ['TRIP-B', 'TRIP-A'])).toBe('TRIP-B')
  })

  it('guard: app/day.tsx picks its trip through the rule, and reads the row whatever state it is in', async () => {
    const code = withoutComments(await read('../../../../app/delivery/day.tsx'))

    expect(code).toMatch(
      /import\s*\{[^}]*\bdayEndTripId\b[^}]*\}\s*from\s*'\.\.\/\.\.\/src\/groups\/delivery\/lib\/local'/,
    )
    expect(code.match(/\bdayEndTripId\s*\(/g) ?? []).toHaveLength(1)

    // The row itself must not be looked up in the OPEN rows any more: that is the filter that made
    // a settled trip unreachable in the first place.
    expect(code).not.toMatch(/local\.rows\.find/)
    expect(code).toMatch(/useLocalTrip\(/)

    // And the money the rule reads is the outbox's, named on the screen so a reader can follow it.
    expect(code).toMatch(/useOwedTripIds\(\)/)
  })

  it('guard: the owed-trip query asks the outbox, never the trip table’s state', async () => {
    const local = withoutComments(await read('./local.ts'))
    const owed = /export function useOwedTripIds\(\)[\s\S]*?\n}/.exec(local)
    expect(owed).not.toBeNull()

    // queued + sending + refused, and nothing else: `kept` money is the cashier's (DOS-178) and a
    // landed receipt is the office's. A trip id is required, so an office receipt never selects one.
    expect(owed?.[0]).toMatch(/_pending IN \('queued', 'sending', 'rejected'\)/)
    expect(owed?.[0]).toMatch(/trip_id IS NOT NULL/)
  })
})
