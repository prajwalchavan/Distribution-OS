/**
 * DOS-047 — THE TWO LISTS THE FLOOR OPENS SHOWED IT EVERYTHING EXCEPT ITS WORK.
 *
 * Measured on the pilot data: the Pick tab's WAVES panel held 30 rows, every one of them `packed` or
 * `picked`, and the two waves that actually needed a hand — PICK-0078 (`picking`) and PICK-0079
 * (`open`) — were not on the page at all. The Load tab was the same story: 30 `confirmed` sheets and
 * no sign of the one `draft` waiting to be counted out. Both screens asked for ONE unfiltered page
 * (`limit: 30`, newest first), so a godown whose finished waves outnumber its live ones simply never
 * sees the live ones, and the only route to today's work is the Home queue.
 *
 * The service already answers the question: `picklists?status=picking` returns PICK-0078 and
 * `load-sheets?status=draft` returns the sheet. So the screens ASK it — the work statuses first, each
 * as its own read, and the unfiltered page after them for everything that is finished.
 *
 * `workFirst` is that "after them": the same row may come back in two reads, and it must be listed
 * once, in the place its first read earned it.
 */
import { describe, expect, it } from 'vitest'

import { workFirst } from './work-first'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** Source with its comments taken out: a comment may quote the very call it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  // `fileURLToPath`, never `URL.pathname`: the path has a space in it.
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const row = (id: string, status: string): { id: string; status: string } => ({ id, status })

describe('DOS-047 the work comes first on the two lists the floor opens', () => {
  it('DOS-047: workFirst keeps each row once, in the order of the read that found it first', () => {
    const picking = [row('p78', 'picking')]
    const open = [row('p79', 'open')]
    // The unfiltered page: the finished ones, and the live ones AGAIN once they reach it.
    const recent = [row('p77', 'packed'), row('p78', 'picking'), row('p47', 'picked')]

    expect(workFirst(picking, open, recent).map((one) => one.id)).toEqual([
      'p78',
      'p79',
      'p77',
      'p47',
    ])
  })

  it('DOS-047: a wave the unfiltered page never reached is still listed', () => {
    // The whole defect in one line: 30 finished rows, and the live wave off the end of the page.
    const recent = Array.from({ length: 30 }, (_, at) => row(`done${String(at)}`, 'packed'))
    const listed = workFirst([row('p79', 'open')], recent)
    expect(listed[0]?.id).toBe('p79')
    expect(listed).toHaveLength(31)
  })

  it('DOS-047: nothing to do reads as nothing, not as an empty first row', () => {
    expect(workFirst([], [], [])).toEqual([])
  })

  it('DOS-047: W4 asks for the open and picking waves, and lists them above the finished page', async () => {
    const screen = await read('../../app/pick/index.tsx')

    expect(screen, 'W4 never asks for the waves that are still open').toMatch(
      /picklists\.list\(\{[^}]*status: 'open'/s,
    )
    expect(screen, 'W4 never asks for the waves being picked').toMatch(
      /picklists\.list\(\{[^}]*status: 'picking'/s,
    )
    expect(screen, 'W4 does not put the live waves above the finished page').toMatch(/workFirst\(/)
  })

  it('DOS-047: W7 asks for the draft sheets, and lists them above the confirmed page', async () => {
    const screen = await read('../../app/load/index.tsx')

    expect(screen, 'W7 never asks for the sheets still waiting to go out').toMatch(
      /loadSheets\.list\(\{[^}]*status: 'draft'/s,
    )
    expect(screen, 'W7 does not put the draft sheets above the confirmed page').toMatch(
      /workFirst\(/,
    )
  })
})
