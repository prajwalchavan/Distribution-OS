/**
 * DOS-182 — the picker could not see Picked and Short on a wave the phone was already holding.
 *
 * TWO READINGS, AND THE SECOND ONE IS THE MEASURED ONE. The first fix read the Pixel 7 run as a lock:
 * `locked = liveStatus === undefined || notStarted` treating an absent `picklists` row as "not
 * started". The device log says otherwise — `wh-run.log:245` prints `PICK-0052 | picking`, and that
 * chip is drawn only when the screen HAS the sheet row, so `liveStatus` was `'picking'` and `locked`
 * was already `false` on main. Nothing was locked. What the prover could not find was the first
 * card's buttons: at a cold start with the office away, two standing sentences above the list — the
 * offline promise and "Still filling this phone from the server" — pushed the first row's Picked /
 * Short under the sticky bottom bar, and the harness reads only the first viewport. The 5 min 48 s is
 * the time until those sentences left, not the time until a lock lifted.
 *
 * So this file holds what is actually true of the gate, and the fold is fixed where it lives — in the
 * screen (the two sentences moved into the bottom bar) and in `LocalAsyncBody` (the filling sentence
 * prints under the rows). Both are asserted from the source below.
 *
 * AND ABSENCE STAYS `waiting`. It is tempting to call "lines on the device, no sheet row" pickable —
 * the phone clearly has the wave. It is not safe: `sync.pull` cuts one page set at a single instant
 * across every table, so a FINISHED pass hands over the header with its lines, and lines without a
 * header mean the pass is still running and the sheet on this phone may be short of rows. W5 enables
 * "Take it to packing" on `left === 0`, so a half-read sheet with every landed row picked would offer
 * to confirm a wave into packing over lines nobody has seen. DOS-040 is untouched either way: a sheet
 * the device holds as `open` still asks to be started, and that tap is still online-only.
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

async function readSource(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  // `fileURLToPath`, never `URL.pathname`: the path has a space.
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that names an element is not counted as the element. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Nothing has been started through this screen; only the device's own copy speaks. */
const settled = { startedHere: undefined } as const

describe('W5 the picking sheet: the wave on the phone is the wave the picker may pick', () => {
  it('DOS-182: the device\'s own copy decides — a sheet it holds as "picking" needs no signal', () => {
    expect(
      pickGate({ ...settled, deviceStatus: 'picking' }),
      'the phone holds the wave and says it is being picked; it needs nobody else to say so',
    ).toBe('pickable')
  })

  it('DOS-182: a sheet row the device does not hold is NOT a started sheet, and NOT a pickable one', () => {
    // Both unknowns answer the same way now: nothing is claimed about a sheet nobody here has read.
    expect(pickGate({ ...settled, deviceStatus: null })).toBe('waiting')
    expect(pickGate({ ...settled, deviceStatus: undefined })).toBe('waiting')
  })

  it('DOS-182: lines on the phone with no sheet row stay `waiting` — a mid-pass sheet is never confirmed into packing', () => {
    /*
     * The one the first fix got wrong. `pickGate` is not told how many lines the device holds, ON
     * PURPOSE: lines without their header only ever mean a pull that has not finished, and W5's
     * "Take it to packing" is enabled by `left === 0` over the rows the device HAS. Pickable there
     * is an offer to confirm a wave short of rows that have not landed.
     */
    expect(
      pickGate({ ...settled, deviceStatus: null }),
      'a sheet still arriving was offered as ready to pick and to confirm into packing',
    ).toBe('waiting')
    expect(Object.keys({ startedHere: undefined, deviceStatus: null })).toEqual([
      'startedHere',
      'deviceStatus',
    ])
  })

  it('DOS-182: a sheet the device holds as "open" still asks to be started — DOS-040 is untouched', () => {
    expect(pickGate({ ...settled, deviceStatus: 'open' })).toBe('not-started')
  })

  it('DOS-182 · DOS-120: the Start reply wins until the next pull repaints the local row', () => {
    expect(pickGate({ startedHere: 'picking', deviceStatus: 'open' })).toBe('pickable')
    // And the reply is only ever about THIS sheet: the screen passes `undefined` for any other id.
    expect(pickGate({ startedHere: undefined, deviceStatus: 'open' })).toBe('not-started')
  })

  it('DOS-182: W5 asks that one question, and offers nothing while the device has not answered', async () => {
    const code = withoutComments(await readSource('../../../../app/warehouse/pick/[id].tsx'))

    // One rule, in one place: the old expression conflated the two unknowns.
    expect(code).toMatch(/const gate = pickGate\(/)
    expect(code).not.toMatch(/liveStatus === undefined \|\| notStarted/)
    expect(code).toMatch(/const locked = gate !== 'pickable'/)
    expect(code).toMatch(/const notStarted = gate === 'not-started'/)

    // The bottom bar offers nothing while the device has not answered — never Scan and Confirm over
    // rows that refuse to be picked.
    expect(code).toMatch(/gate === 'waiting' \? null :/)

    // And the sentence that said the wave was unconfirmed is gone with the branch that drew it.
    expect(code).not.toContain('w5-unconfirmed')
    expect((strings as Readonly<Record<string, string>>)['w5.unconfirmed']).toBeUndefined()
  })

  it('DOS-182: NOTHING STANDS ABOVE THE FIRST ROW — no sentence between the view switch and the list', async () => {
    const code = withoutComments(await readSource('../../../../app/warehouse/pick/[id].tsx'))

    const switchAt = code.indexOf('<Segments')
    const listAt = code.indexOf('<LocalAsync')
    expect(switchAt, 'the view switch could not be found in W5').toBeGreaterThan(-1)
    expect(listAt, 'the list could not be found in W5').toBeGreaterThan(switchAt)
    expect(
      code.slice(switchAt, listAt),
      'a standing sentence above the list pushes the first row under the sticky bar',
    ).not.toContain('<Txt')

    // The two that used to stand there are in the bottom bar now, where the thumb already is: after
    // `bottomBar={` and before the body, which is everything from the view switch down.
    const barAt = code.indexOf('bottomBar={')
    expect(barAt, 'the bottom bar could not be found in W5').toBeGreaterThan(-1)
    for (const id of ['testID="w5-offline"', 'testID="w5-scan-note"']) {
      const at = code.indexOf(id)
      expect(at, `${id} is not rendered at all`).toBeGreaterThan(barAt)
      expect(at, `${id} is a line of the body again, above the rows`).toBeLessThan(switchAt)
    }
  })

  it('DOS-182: "still filling this phone" prints UNDER the rows it is about', async () => {
    const ui = withoutComments(await readSource('./ui.tsx'))
    // The half-full branch of LocalAsyncBody only: the stack it returns after the `hydrated` early
    // return, so the `<>{children}</>` of the full one cannot stand in for the rows.
    const halfFullAt = ui.indexOf('<Stack gap={3}>', ui.indexOf('if (hydrated) return'))
    expect(halfFullAt, "LocalAsyncBody's half-full branch could not be found").toBeGreaterThan(-1)
    const branch = ui.slice(halfFullAt, ui.indexOf('</Stack>', halfFullAt))
    const rowsAt = branch.indexOf('{children}')
    const sentenceAt = branch.indexOf('testID="local-filling"')
    expect(rowsAt, 'LocalAsyncBody no longer renders the rows it holds').toBeGreaterThan(-1)
    expect(
      sentenceAt,
      'the filling sentence is gone; the latch has to say something',
    ).toBeGreaterThan(-1)
    expect(
      rowsAt,
      'the filling sentence is drawn above the rows again, which is what cost W5 its first card',
    ).toBeLessThan(sentenceAt)
  })
})
