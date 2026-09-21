/**
 * DOS-070 — "WHERE YOU WERE IS ATTACHED AS PROOF", ON A DEVICE THAT NEVER MEASURED ANYTHING.
 *
 * D4 printed that line under the proof panel while the home screen of the same app read "Location is
 * off — this phone is not sharing location". What actually travels is `trip_stops.arrived_lat/lng`: the
 * one fix taken when the crew tapped "I am at the shop", which in the walked case was the seeded 10:40
 * am arrival and in a browser that refuses location is nothing at all. `pod_evidence` held a `geo` row
 * at 19.231291 / 73.142109 — the stop's arrival point, not a reading the browser had ever made.
 *
 * So the line says what the proof IS — the arrival point, and when it was taken — or there is no line,
 * because there is no `geo` row either. Nothing about the platform's location module changes: D4 has
 * never asked for a fix of its own, and it still does not.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { geoProofLine } from './at-the-door'

/** The delivery app's own catalogue, as `<ThemeProvider>` merges it: key in, sentence out. */
const t = (key: string, vars?: Record<string, string | number>): string => {
  const line = (strings as Record<string, string>)[key] ?? key
  return vars === undefined
    ? line
    : line.replace(/\{(\w+)\}/g, (whole, name: string) => String(vars[name] ?? whole))
}

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Source with its comments taken out: a comment may quote the very sentence it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-070 the geo proof says what it is', () => {
  it('DOS-070 no sentence in this app claims a reading the device never made', () => {
    const claims = Object.entries(strings as Record<string, string>).filter(
      ([, line]) => /where you were/i.test(line) && !/arriv/i.test(line),
    )
    expect(claims).toEqual([])
  })

  it('DOS-070 the line names the arrival and the clock reading of the fix that travels', () => {
    // The walked case: the seeded 10:40 am arrival at Rameshwar General Store.
    expect(
      geoProofLine(t, { arrived_lat: 19.231291, arrived_at: '2026-09-13T05:10:00.000Z' }),
    ).toBe('Where you were when you arrived, 13 Sep, 10:40 am, goes with this as proof')
    // A fix with no arrival time still says what it is, and claims no clock it does not have.
    expect(geoProofLine(t, { arrived_lat: 19.231291, arrived_at: null })).toBe(
      'Where you were when you arrived goes with this as proof',
    )
  })

  it('DOS-070 no fix, no claim: the line is absent exactly when the geo row is', () => {
    // These are the cases where `commit()` attaches no `geo` evidence at all.
    expect(
      geoProofLine(t, { arrived_lat: null, arrived_at: '2026-09-13T05:10:00.000Z' }),
    ).toBeNull()
    expect(geoProofLine(t, {})).toBeNull()
    expect(geoProofLine(t, null)).toBeNull()
    expect(geoProofLine(t, undefined)).toBeNull()
  })

  it('DOS-070 D4 names the arrival point and when it was taken, through one rule', async () => {
    const deliver = await read('../../../../app/delivery/stop/[id]/deliver.tsx')
    expect({
      // One rule decides both the sentence and whether there is one at all.
      viaTheRule: /geoProofLine\(/.test(deliver),
      // Never the bare claim the finding measured.
      bareClaim: /t\('d4\.podGeo'\)/.test(deliver),
      // And the `geo` row still travels only when there IS an arrival fix.
      gatedOnTheFix: /arrived_lat !== null && stop\?\.arrived_lat !== undefined/.test(deliver),
      // D4 asks the phone for no fix of its own; the arrival is the only reading there ever was.
      asksForAFix: /platformLocation|location\.current\(/.test(deliver),
    }).toEqual({
      viaTheRule: true,
      bareClaim: false,
      gatedOnTheFix: true,
      asksForAFix: false,
    })
  })
})
