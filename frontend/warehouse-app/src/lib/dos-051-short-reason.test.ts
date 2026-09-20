/**
 * DOS-051 + DOS-165 — THE REASON IN THE SHORT REPORT WAS THE ONE NOBODY CHOSE.
 *
 * DOS-051, measured on the desk: PICK-0079, one lot row asking 1 pc, Short pressed with no reason
 * picked and no number keyed. It saved. `pick_lines` kept `picked_qty_pcs 0` and `short_reason 'Not
 * on the rack'` — the first chip, preselected by the screen and never touched by the picker. Every
 * short report the desk reads, and every supplier conversation it starts, is that chip.
 *
 * DOS-165, measured on an iPhone 16 Pro (402 pt): the three reasons shared one segmented row, so the
 * third read 'Batcl' with half of it off the screen. A tap at its centre landed on nothing and the
 * preselected first chip stayed selected — the two defects compounding, an unreadable option and a
 * default that saves itself.
 *
 * So the default goes and the row stops being a row. The three reasons become the same stacked list
 * D4's return reasons became (DOS-163), one full-width row each at every width, with nothing
 * preselected; and Short refuses a save that is under the ask until one of them is chosen, the way it
 * already refuses one that is over it. `w5.reasonRack` and its siblings are not shortened: the desk's
 * short report prints these words.
 *
 * `@types/node` is deliberately absent from an app (`env.d.ts`), so the two Node functions this guard
 * needs come in through a non-literal specifier and their shapes are named here.
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

/** Source with its comments taken out: a comment may quote the very element it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  // `fileURLToPath`, never `URL.pathname`: the path has a space in it.
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const catalogue = strings as Readonly<Record<string, string | undefined>>

describe('DOS-051 · DOS-165 the short reason is the picker’s, or there is no save', () => {
  it('DOS-051: the Short sheet opens with NO reason chosen — the first chip is never a saved answer', async () => {
    const screen = await read('../../app/pick/[id].tsx')

    // The two places the old default lived: the state's seed, and the reset on every open.
    expect(
      screen,
      'the sheet still seeds a reason, so a picker who chooses nothing still saves one',
    ).not.toMatch(/useState<string>\(REASON_KEYS\[0\]\)/)
    expect(screen, 'opening the sheet still preselects the first chip').not.toMatch(
      /setShortReason\(REASON_KEYS\[0\]\)/,
    )
    expect(screen, 'the reason is not allowed to be unanswered').toMatch(
      /useState<string \| null>\(null\)/,
    )
  })

  it('DOS-051: a pick under the ask with no reason is refused, and the refusal is a sentence', async () => {
    const screen = await read('../../app/pick/[id].tsx')

    expect(screen, 'nothing in the sheet notices a short with no reason').toMatch(/needsReason/)
    expect(screen, 'the save does not turn back on a missing reason').toMatch(
      /if \(overAsk \|\| needsReason\)/,
    )
    expect(screen, 'the refusal is never said out loud').toContain('w5-short-noreason')
    expect(catalogue['w5.chooseReason'], 'no sentence exists for a missing reason').toBeTruthy()
  })

  it('DOS-165: the three reasons take a row each, so none of them is cut off at 402 pt', async () => {
    const screen = await read('../../app/pick/[id].tsx')

    // Whatever else the screen draws, the reasons are no longer a shared segmented row.
    expect(screen, 'the reasons still share one line between them').not.toMatch(
      /<Segments[^>]*testID="w5-short-reason"/,
    )
    expect(screen, 'the reasons are not a stacked list of full-width rows').toMatch(
      /<Group testID="w5-short-reason">/,
    )
    expect(screen, 'a reason row cannot be addressed on its own').toMatch(
      /testID=\{`w5-short-reason-\$\{key\}`\}/,
    )

    // And the words themselves are untouched: the desk's short report prints them.
    expect(catalogue['w5.reasonRack']).toBe('Not on the rack')
    expect(catalogue['w5.reasonDamaged']).toBe('Damaged carton')
    expect(catalogue['w5.reasonHeld']).toBe('Batch held back')
  })

  it('DOS-051: the gate count asks for the GOOD pieces, because the server adds the damaged ones on top', async () => {
    // `grn.service.ts`: `received = countedQtyPcs + damagedQtyPcs`. A hand that counted 144 boxes of
    // which 2 were crushed keyed 144 and then 2, and the receipt recorded an excess of 2 that never
    // came off the lorry — and with it a supplier claim wrong by the same 2 pieces.
    expect(catalogue['w3.countLabel'], 'the pad still asks for every piece received').not.toBe(
      'Pieces received',
    )
    expect(catalogue['w3.countLabel']).toMatch(/good/i)
    expect(
      catalogue['w3.countSplit'],
      'nothing on the screen says where damaged pieces go',
    ).toMatch(/damaged/i)

    const screen = await read('../../app/inbound/[id].tsx')
    expect(screen, 'the split is never said on the counting step').toContain('w3-count-split')
  })
})
