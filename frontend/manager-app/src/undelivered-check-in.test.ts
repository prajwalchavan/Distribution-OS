/**
 * DOS-196, verifier's major and the reach minor — M7 Trips follows the server from the moment the van
 * checks in, and the trips register states facts about the trip only.
 *
 * The first cut of the Undelivered register said "Out on TRIP-7 — back after check-in" until the trip
 * was SETTLED. The server releases the bill at CHECK-IN: `ridingTrips` in delivery.internals.ts holds a
 * failed bill only while `trips.state = 'active'`, `trips.return` moves the trip to `closing`, and
 * load-out.spec.ts proves the bill is on the planning board that instant. So for the whole
 * check-in → settlement window (hours, and a separate desk step) the register contradicted the planning
 * board under it. The decision now lives in `src/lib/trip-reach.ts`, which this spec exercises directly;
 * the screen is read as source only to prove it draws from there and nowhere else (importing it in Node
 * pulls in `react-native` and `expo-router`, which do not resolve outside Metro).
 */
import { describe, expect, it } from 'vitest'

import {
  TRIP_BACK_AT_THE_GODOWN,
  TRIP_TAKES_A_LATE_BILL,
  undeliveredNext,
} from './lib/trip-reach'
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
    fileURLToPath(new URL('../app/fulfilment/trips.tsx', import.meta.url)),
    'utf8',
  )
}

/** Block and line comments removed, so a comment that names an identifier is not counted as a use. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const catalogue: Readonly<Record<string, string>> = strings

/** Every state of the trip machine (`@dos/domain` state-machines/delivery.ts). */
const TRIP_STATES = [
  'planned',
  'loading',
  'active',
  'closing',
  'settled',
  'settled_with_variance',
  'cancelled',
] as const

describe('M7 Trips: the desk follows the server from check-in', () => {
  it('DOS-196: an undelivered bill is back at the godown from `closing` on — the server releases it at check-in, not at settlement', () => {
    expect(
      [...TRIP_BACK_AT_THE_GODOWN].sort(),
      'TRIP_BACK_AT_THE_GODOWN must be exactly {closing, settled, settled_with_variance, cancelled}: ' +
        "the server's road hold (`ridingTrips`, delivery.internals.ts) keeps a failed bill only while " +
        "trips.state = 'active', and trips.return moves the trip to `closing` — load-out.spec.ts " +
        'proves the bill is plannable that instant, before any settlement',
    ).toEqual(['cancelled', 'closing', 'settled', 'settled_with_variance'])

    // The register's action for a trip that has just checked in is the plan action, in words.
    expect(undeliveredNext('closing'), 'a van in `closing` has checked in: plan the bill again').toBe(
      'plan',
    )
    expect(catalogue['m7u.backAtTheGodown']).toBe('Back at the godown — plan it again')
    for (const state of ['settled', 'settled_with_variance', 'cancelled'])
      expect(undeliveredNext(state), `${state}: the van is not carrying the bill`).toBe('plan')

    // And only while the van is genuinely out does the desk wait for it.
    for (const state of ['planned', 'loading', 'active'])
      expect(undeliveredNext(state), `${state}: the bill rides its van until check-in`).toBe('wait')
    expect(catalogue['m7u.onTheRoad']).toBe('Out on {trip} — back after check-in')

    // Every state of the machine has an answer; the two sets never overlap.
    for (const state of TRIP_STATES) expect(['plan', 'wait']).toContain(undeliveredNext(state))
    for (const state of TRIP_TAKES_A_LATE_BILL) expect(TRIP_BACK_AT_THE_GODOWN.has(state)).toBe(false)
  })

  it('DOS-196: the Undelivered register draws its action from `undeliveredNext`, off the trip state the server sent', async () => {
    const code = withoutComments(await readScreen())
    expect(code).toMatch(/from '\.\.\/\.\.\/src\/lib\/trip-reach'/)
    expect(code).toMatch(/undeliveredNext\(row\.tripState\)\s*===\s*'plan'/)
    expect(code).toMatch(/t\('m7u\.backAtTheGodown'\)/)
    // No second copy of either set inside the screen.
    expect(code).not.toMatch(/new Set\(\[/)
  })
})
