/**
 * DOS-182 — the pick sheet locked the picker out of a wave the phone was already holding.
 *
 * Measured on a Pixel 7 with the office unreachable: Picked and Short were hidden for 5 min 48 s and
 * came back seconds after the signal did. `locked = liveStatus === undefined || notStarted` is why.
 * `liveStatus` is `startedHere ?? sheet?.status`, and `sheet` is the device's own `picklists` row —
 * which `pick_lines` can outrun, because the two tables are separate pages of one pull (the screen's
 * own comment says so). Cut the network between those two pages and the phone holds the wave's LINES
 * with no sheet row to go with them. The screen read that absence as "not started" and locked every
 * row, while the bottom bar cheerfully offered Scan and Take it to packing — for as long as the office
 * stayed away.
 *
 * ABSENCE IS NOT A STATUS. There are three states, not two, and `pickGate` is the only place that says
 * which: the device has not answered yet; the device holds the sheet and it says `open` (DOS-040: a tap
 * that could only ever be refused is never queued, so Start is the one action); or the wave is on this
 * phone and may be picked — which is what the offline copy is FOR, and which no longer waits on a read
 * reaching the office.
 *
 * `@types/node` is deliberately absent from an app (`env.d.ts`), so the two Node functions the screen
 * guard needs come in through a non-literal specifier and their shapes are named here.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { pickGate } from './pick-gate'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** W5's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL('../../app/pick/[id].tsx', import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that names an element is not counted as the element. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Both device reads have answered; nothing has been started through this screen. */
const settled = { startedHere: undefined, reading: false } as const

describe('W5 the picking sheet: the wave on the phone is the wave the picker may pick', () => {
  it('DOS-182: a wave whose lines are on the phone is pickable with no signal, even before its sheet row lands', () => {
    expect(
      pickGate({ ...settled, deviceStatus: null, linesOnDevice: 12 }),
      'the picker is locked out of work the device is already holding until a read reaches the office',
    ).toBe('pickable')
  })

  it('DOS-182: "not loaded yet" is not "not started" — while the device has not answered, the sheet waits', () => {
    expect(
      pickGate({ startedHere: undefined, deviceStatus: null, reading: true, linesOnDevice: 0 }),
    ).toBe('waiting')
    // The lines can land in the same tick the sheet row does; until BOTH reads answer, nothing is known.
    expect(
      pickGate({ startedHere: undefined, deviceStatus: null, reading: true, linesOnDevice: 12 }),
    ).toBe('waiting')
    // Answered, and there is nothing on this phone at all: still nothing to offer.
    expect(pickGate({ ...settled, deviceStatus: null, linesOnDevice: 0 })).toBe('waiting')
  })

  it('DOS-182: the device\'s own copy decides — a sheet it holds as "picking" needs no signal', () => {
    expect(pickGate({ ...settled, deviceStatus: 'picking', linesOnDevice: 12 })).toBe('pickable')
  })

  it('DOS-182: a sheet the device holds as "open" still asks to be started — DOS-040 is untouched', () => {
    expect(pickGate({ ...settled, deviceStatus: 'open', linesOnDevice: 12 })).toBe('not-started')
    // And an empty sheet that is open is still open, not "waiting".
    expect(pickGate({ ...settled, deviceStatus: 'open', linesOnDevice: 0 })).toBe('not-started')
  })

  it('DOS-182: the Start reply wins until the next pull repaints the local row', () => {
    expect(
      pickGate({ startedHere: 'picking', deviceStatus: 'open', reading: false, linesOnDevice: 12 }),
    ).toBe('pickable')
  })

  it('DOS-182: W5 asks that one question, and says so when the office has not confirmed the wave', async () => {
    const code = withoutComments(await readScreen())

    // One rule, in one place: the old expression conflated the two unknowns.
    expect(code).toMatch(/const gate = pickGate\(/)
    expect(code).not.toMatch(/liveStatus === undefined \|\| notStarted/)
    expect(code).toMatch(/const locked = gate !== 'pickable'/)
    expect(code).toMatch(/const notStarted = gate === 'not-started'/)

    // The bottom bar offers nothing while the device has not answered — never Scan and Confirm over
    // rows that refuse to be picked.
    expect(code).toMatch(/gate === 'waiting' \? null :/)

    // And the picker is told when the wave is being picked on this phone's word alone.
    expect(code).toContain('testID="w5-unconfirmed"')
    expect(code).toMatch(/t\('w5\.unconfirmed'\)/)
    expect(
      (strings as Readonly<Record<string, string>>)['w5.unconfirmed'],
      'w5.unconfirmed is missing from the warehouse namespace',
    ).toBeTruthy()
  })
})
