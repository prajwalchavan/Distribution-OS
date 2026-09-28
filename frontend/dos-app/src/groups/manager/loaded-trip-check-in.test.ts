/**
 * QA DOS-354 (architect ruling of 2026-09-28): "a loaded trip is not cancelled, it is checked in".
 *
 * The server now refuses to cancel a trip whose load-out was confirmed (409 `trip_loaded`) and to take a
 * loaded bill off it (`bill_loaded`), and accepts the check-in of a loaded trip that never left
 * (`loading → closing`). M7 Trips must follow: on such a trip the panel offers "Check the vehicle in"
 * (`delivery.trips.return`) and no "take it off" that can only fail. The decision is `standingTripNext`,
 * exercised directly here; the screen is read as source only to prove it draws from there (importing it in
 * Node pulls in `react-native` and `expo-router`, which do not resolve outside Metro).
 */
import { describe, expect, it } from 'vitest'

import { standingTripNext } from './lib/trip-reach'
import { strings } from './strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** M7 Trips' source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../../app/manager/fulfilment/trips.tsx', import.meta.url)),
    'utf8',
  )
}

describe('QA DOS-354: a loaded trip is checked in from the desk, never left with a dead button', () => {
  it('offers the check-in once the load-out is confirmed, and taking bills off before it', () => {
    expect(standingTripNext('loading', '2026-09-28T05:30:00.000Z')).toBe('checkIn')
    // counted out while the trip was still `planned` (nobody pressed "start loading"): loaded all the same
    expect(standingTripNext('planned', '2026-09-28T05:30:00.000Z')).toBe('checkIn')
    expect(standingTripNext('loading', null)).toBe('takeBillsOff')
    expect(standingTripNext('planned', null)).toBe('takeBillsOff')
    // a trip that has left is checked in by its crew on the road; the desk panel does not open for it
    expect(standingTripNext('active', '2026-09-28T05:30:00.000Z')).toBeNull()
    expect(standingTripNext('closing', '2026-09-28T05:30:00.000Z')).toBeNull()
  })

  it('M7 Trips calls the check-in through that decision and hides "take it off" on a loaded trip', async () => {
    const screen = await readScreen()
    expect(screen).toContain('standingTripNext(')
    expect(screen).toContain('api.api.delivery.trips.return(')
    expect(screen).toContain("mayDrop && standing !== 'checkIn'")
  })

  it('says what the check-in does in words, from the strings file', () => {
    expect(strings['m7c.action']).toBe('Check the vehicle in')
    expect(strings['m7c.body']).toMatch(/do not come off it here\. Check the vehicle in/)
    expect(strings['m7c.done']).toMatch(/Money › Day-end/)
  })
})
