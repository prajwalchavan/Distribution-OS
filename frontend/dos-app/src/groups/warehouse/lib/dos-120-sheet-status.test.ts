/**
 * DOS-120 — THE COUNT SAID DONE AND THE BADGE SAID STILL PICKING.
 *
 * Measured on the desk: PICK-0083 was started on this screen, every row was then recorded (one here,
 * the rest by a second device), and the server closed the wave — `status picked`, `completed_at
 * 01:21:53`. For all 13 s sampled after the next pull the screen read "7 of 7 picked" with "Take it to
 * packing" enabled and a chip saying `picking`. It said `picked` only after navigating away and back.
 *
 * `liveStatus = startedHere ?? sheet.status` is why: the Start reply is a stand-in for a local row
 * that has not been repainted yet — `engine.sync` returns early while a pull is already running, so
 * the device's `picklists` row can still read `open` after a start that succeeded — and it was being
 * treated as a second truth that outlived its purpose for as long as the screen stayed mounted. A
 * stand-in is only ever consulted while the thing it stands in for has not spoken: `open`, or absent.
 *
 * This is the smaller instance of the "three truths on one sheet" problem DOS-042 fixed. The rule
 * lives in one pure function so it can be read as behaviour rather than grepped out of a screen.
 */
import { describe, expect, it } from 'vitest'

import { sheetStatus } from './sheet-status'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Source with its comments taken out: a comment may quote the very expression it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  // `fileURLToPath`, never `URL.pathname`: the path has a space in it.
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('DOS-120 the chip says what the sheet on this device says', () => {
  it('DOS-120: once the local row has moved past open, the Start reply stops speaking for it', () => {
    // The measured case: started here, then the server closed the wave and the pull brought it back.
    expect(
      sheetStatus({ startedHere: 'picking', deviceStatus: 'picked' }),
      'the badge said "picking" beside "7 of 7 picked" until the screen was reopened',
    ).toBe('picked')
    // And every other status the row can land on after a start, for the same reason.
    expect(sheetStatus({ startedHere: 'picking', deviceStatus: 'packed' })).toBe('packed')
    expect(sheetStatus({ startedHere: 'picking', deviceStatus: 'cancelled' })).toBe('cancelled')
  })

  it('DOS-120: the Start reply still wins while the local row is the one that is stale', () => {
    // `engine.sync` returns early while a pull is running, so `open` after a successful start is the
    // row that has not been repainted yet — the whole reason the reply is kept at all.
    expect(sheetStatus({ startedHere: 'picking', deviceStatus: 'open' })).toBe('picking')
    expect(sheetStatus({ startedHere: 'picking', deviceStatus: undefined })).toBe('picking')
    expect(sheetStatus({ startedHere: 'picking', deviceStatus: null })).toBe('picking')
  })

  it('DOS-120: with no reply of its own, the screen says exactly what the device holds', () => {
    expect(sheetStatus({ startedHere: undefined, deviceStatus: 'open' })).toBe('open')
    expect(sheetStatus({ startedHere: undefined, deviceStatus: 'picking' })).toBe('picking')
    expect(sheetStatus({ startedHere: undefined, deviceStatus: null })).toBeUndefined()
    expect(sheetStatus({ startedHere: undefined, deviceStatus: undefined })).toBeUndefined()
  })

  it('DOS-120: W5 asks that question rather than keeping the reply for as long as it is mounted', async () => {
    const screen = await read('../../../../app/warehouse/pick/[id].tsx')

    expect(screen, 'the Start reply is still kept for the life of the screen').not.toMatch(
      /const liveStatus = startedHere \?\? sheet\?\.status/,
    )
    expect(screen, 'the rule is not asked of one place').toMatch(/sheetStatus\(\{/)
  })
})
