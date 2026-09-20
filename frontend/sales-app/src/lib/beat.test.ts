/**
 * DOS-084 — "Today's beat" has to be today's beat.
 *
 * The home screen took `myBeatIds[0]`, which is whichever assignment row came back first, so a rep
 * on three beats opened Station Road every day of the week — including the Saturday they were on
 * Khadakpada. `beats.visit_days` is ISO weekdays (Mon = 1 … Sun = 7) and it is already on the phone
 * with the assignments, so the right beat is a screen decision and not a schema change.
 *
 * The rep still overrules it — a round gets swapped, a shop gets revisited — and that choice has to
 * last the day rather than the screen: it is stored against the IST business date and ignored the
 * moment that date moves on.
 */
import { storage } from '@dos/ui/platform'
import { describe, expect, it } from 'vitest'

import { istWeekday } from './dates'
import { beatForDay, forgetBeatChoice, readBeatChoice, rememberBeatChoice } from './local'

/** The pilot's own three beats, as the manifest hands them to the device. */
const BEATS = [
  { id: 'beat-station-road', name: 'Station Road', visit_days: [1, 4] },
  { id: 'beat-kalyan-west', name: 'Kalyan West Market', visit_days: [2, 5] },
  { id: 'beat-khadakpada', name: 'Khadakpada', visit_days: [3, 6] },
]

const MINE = ['beat-station-road', 'beat-kalyan-west', 'beat-khadakpada']

describe('DOS-084 the beat the home screen opens on', () => {
  it('DOS-084 opens the beat whose visit days include the IST weekday, not the first assignment', () => {
    // Saturday 12 September 2026 in IST is ISO weekday 6 — Khadakpada's day, not Station Road's.
    expect(istWeekday('2026-09-12')).toBe(6)
    expect(beatForDay(BEATS, MINE, '2026-09-12')).toBe('beat-khadakpada')

    expect(beatForDay(BEATS, MINE, '2026-09-14')).toBe('beat-station-road')
    expect(beatForDay(BEATS, MINE, '2026-09-11')).toBe('beat-kalyan-west')
  })

  it('DOS-084 falls back to the first assigned beat on a day none of them is walked', () => {
    // Sunday is ISO weekday 7 and no beat lists it: a rep who opens the app still gets a beat.
    expect(beatForDay(BEATS, MINE, '2026-09-13')).toBe('beat-station-road')
    // A beat with no visit days at all is never picked over one that names today.
    expect(
      beatForDay(
        [{ id: 'beat-none', visit_days: null }, ...BEATS],
        ['beat-none', ...MINE],
        '2026-09-12',
      ),
    ).toBe('beat-khadakpada')
    expect(beatForDay(BEATS, [], '2026-09-12')).toBeNull()
  })

  it('DOS-084 a chip the rep taps sticks for that IST day and is ignored the next', async () => {
    await forgetBeatChoice('rahul')
    expect(await readBeatChoice('rahul', '2026-09-12')).toBeNull()

    await rememberBeatChoice('rahul', '2026-09-12', 'beat-station-road')
    expect(await readBeatChoice('rahul', '2026-09-12')).toBe('beat-station-road')

    // The next IST day is a new round: yesterday's override is not it.
    expect(await readBeatChoice('rahul', '2026-09-13')).toBeNull()
    // And it belongs to the rep who tapped it, never to the phone.
    expect(await readBeatChoice('sunil', '2026-09-12')).toBeNull()

    await forgetBeatChoice('rahul')
    expect(await storage.getItem('dos.sales.beat.rahul')).toBeNull()
  })
})
