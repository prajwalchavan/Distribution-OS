/**
 * DOS-067 — THE ONE SCORE THE CREW SEES SAYS WHAT IT MEASURES, AND THE LIST HOLDS EVERY TRIP.
 *
 * D11 read "DELIVERED ON THE FIRST ATTEMPT 0%" over "STOPS 125 · DELIVERED 104 · NOT DELIVERED 8".
 * The figure under that label is `deliveryPerformance.totals.onTimeRate` — stops finished by the
 * time the office promised (`completed_at <= eta_at`) — which is a different measurement of a
 * different thing, and the register was dividing it by every attempted stop rather than by the ones
 * that carried an ETA (fixed in `performance.ts`; proved in `reporting.spec.ts`).
 *
 * And the list under it asked for the same thirty-day window as the score, so the round planned for
 * the next working day — the one the home screen calls "Today's trip", because the godown loads
 * ahead — was not in the crew's own list of trips at all. The list runs past today; the score does
 * not, because a trip nobody has driven yet has nothing to score.
 *
 * Read as SOURCE, like `dos-149-door-toast.test.ts`: importing a screen in Node pulls in
 * `expo-router` and the kit's native renderer, which resolve only under Metro.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-067 the crew’s own score and its own list of trips', () => {
  it('DOS-067 the KPI is labelled as the on-time rate it is, never as a first-attempt rate', () => {
    const label = (strings as Record<string, string>)['d11.onTime'] ?? ''
    expect(label.toLowerCase()).toContain('on time')
    expect(label.toLowerCase()).not.toContain('attempt')
  })

  it('DOS-067 the list reaches past today so a trip planned ahead is on it; the score stops at today', async () => {
    const screen = await read('../../../../app/delivery/trips.tsx')
    // The list is asked for a window that runs forward from today…
    expect(screen).toMatch(/const until = shiftDays\(to, \d+\)/)
    expect(screen).toMatch(/trips\.list\(\{[^}]*to: until/)
    // …and the score is asked for the window that ends today.
    expect(screen).toMatch(/deliveryPerformance\(\{\s*from,\s*to,/)
  })
})
