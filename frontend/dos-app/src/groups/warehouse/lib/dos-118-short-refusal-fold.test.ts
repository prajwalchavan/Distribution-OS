/**
 * DOS-118 — THE REASON THE SAVE WAS REFUSED WAS LAID OUT BELOW THE FOLD.
 *
 * Measured on the warehouse app at 390 x 844 — the phone, which is the godown's main device. A lot
 * row asking 12 pc, Short pressed, 2 and 0 keyed, Short pressed again: the save is correctly refused
 * (DOS-041 — the pack would take the extra pieces from a lot nobody asked to hold them), and the
 * sentence that says so was laid out at y 836-880 in an 844-px viewport, UNDER the Short button at
 * y 728-804. A sliver of red at the very bottom edge is all a picker sees; pressing Short looks like
 * nothing happening, over and over. At 1280 x 800 the same line is fully visible, which is why the
 * desk walk never found it.
 *
 * `NumberPadProps` has no `disabled`, and the kit is another lane's, so the fix is the order of the
 * sheet: every reason a save can be refused prints ABOVE the pad, beside the reason chips and the
 * requested figure — the top of the sheet, where a refusal belongs, and where no keypad can push it
 * off a phone.
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

describe('DOS-118 a refused Short says why where the thumb already is', () => {
  it('DOS-118: the over-ask refusal is laid out ABOVE the keypad, not under its Short button', async () => {
    const screen = await read('../../../../app/warehouse/pick/[id].tsx')

    const padAt = screen.indexOf('<NumberPad')
    const overAt = screen.indexOf('testID="w5-short-over"')
    expect(padAt, 'the Short sheet has no keypad any more').toBeGreaterThan(-1)
    expect(overAt, 'the over-ask refusal is not rendered at all').toBeGreaterThan(-1)
    expect(
      overAt,
      'the refusal is still below the pad, which is below the fold on a 390 x 844 phone',
    ).toBeLessThan(padAt)
  })

  it('DOS-118: every reason a Short can be refused sits in the same place, above the pad', async () => {
    const screen = await read('../../../../app/warehouse/pick/[id].tsx')

    const padAt = screen.indexOf('<NumberPad')
    // The missing-reason refusal (DOS-051) is the other one, and it must not drift below the pad
    // either — a picker should never have to scroll to learn why a tap did nothing.
    expect(screen.indexOf('testID="w5-short-noreason"')).toBeGreaterThan(-1)
    expect(screen.indexOf('testID="w5-short-noreason"')).toBeLessThan(padAt)

    // And nothing is left hanging after the pad in that sheet: the pad is the last thing in it.
    const sheetAt = screen.indexOf('testID="w5-short-sheet"')
    expect(sheetAt, 'the Short sheet could not be found').toBeGreaterThan(-1)
    const tail = screen.slice(padAt, screen.indexOf('</Sheet>', padAt))
    expect(tail, 'something still prints under the keypad on a phone').not.toContain('<Txt')
  })

  /*
   * MERGE REVIEW. Above the pad is where a refusal BELONGS, and on this phone it is also up to a
   * keypad away from the button that was pressed. The Short sheet's body scrolls on both renderers
   * (`native/feedback.tsx` ScrollView at maxHeight 86%, `web/feedback.tsx` overflowY auto at 80vh)
   * and DOS-152 measured this very sheet overflowing on a Pixel 7 — so a picker who has scrolled
   * down to reach the pad's own Short button is looking at the BOTTOM of the content, and the
   * sentence that says why the press did nothing is a pad-height above the top of the viewport.
   * That is DOS-118's own symptom, moved rather than removed, and a source-order test cannot see it.
   *
   * `NumberPadProps` gives exactly one thing rendered at the bottom of the pad: `doneLabel`, on the
   * button itself. So the button says what it will refuse — the kit's own `disabledReason` idea,
   * expressed through the one prop the contract offers — and the full sentence stays above the pad
   * where DOS-118 put it. Whatever the picker can see of the sheet, one of the two is in it.
   */
  it('DOS-118: the pad\u2019s own button says why the press will be refused', async () => {
    const screen = await read('../../../../app/warehouse/pick/[id].tsx')
    const catalogue = strings as Readonly<Record<string, string | undefined>>

    const padAt = screen.indexOf('<NumberPad')
    const pad = screen.slice(padAt, screen.indexOf('/>', padAt))
    expect(pad, 'the Short button never says a refused press was refused').toMatch(
      /doneLabel=\{[\s\S]*?overAsk[\s\S]*?needsReason[\s\S]*?\}/,
    )
    expect(pad, 'an accepted press no longer reads as the action it is').toContain("t('w5.short')")

    // Short enough to survive a 390 px button beside nothing else, and each says what is missing.
    for (const key of ['w5.shortOverAsk', 'w5.shortNeedsReason']) {
      const label = catalogue[key]
      expect(label, `no button label exists for ${key}`).toBeTruthy()
      expect((label ?? '').length, `${key} is too long for the pad's own button`).toBeLessThan(22)
    }
  })

  it('DOS-118: nothing is laid out between the refusal and the pad it belongs to', async () => {
    const screen = await read('../../../../app/warehouse/pick/[id].tsx')

    // The gap between the last refusal and the pad is the distance a picker would have to scroll
    // back up. It is zero, and a later line of the sheet must not quietly widen it.
    const lastRefusalAt = Math.max(
      screen.indexOf('testID="w5-short-noreason"'),
      screen.indexOf('testID="w5-short-over"'),
    )
    const padAt = screen.indexOf('<NumberPad')
    const between = screen.slice(screen.indexOf('</Txt>', lastRefusalAt), padAt)
    expect(between, 'something new sits between the refusal and the keypad').not.toMatch(
      /<(Txt|Group|ListRow|Row|Panel|Segments|Button)/,
    )
  })
})
