/**
 * DOS-064 — A DELIVERY LINE MOVES BY PIECES, AND ZERO SAYS WHAT IT MEANS.
 *
 * Two findings in one line of D4. Campa Lemon 750 ml was on INV/0825 as 75 pc = 3 cs + 3 pc, and the
 * only controls were "one case less" and "one case more": 75 → 51 → 27, with no way at all to drop 70
 * of 75 — a shop refusing five loose bottles, which is the common case at a door. And Godavari Cow Ghee
 * 200 ml, 5 pc on the bill, stepped straight to zero and then read "Not ordered", on a line that is
 * printed on the bill in the driver's hand. A partial delivery recorded a case back when three bottles
 * came back; the credit note and the stock follow it.
 *
 * The pieces pad is the kit's own (`QtyStepperProps.onOpenPieces` + `parsePieces`, DOS-085), the same
 * one S3 and the manager's credit notes use — never a bespoke keypad and never a kit change. The zero
 * word is an APP-LEVEL override of `qty.notOrdered`: the kit's catalogue speaks for an order screen,
 * and this app has no order screens. It has to read right on both of this app's steppers — a bill line
 * at the door, and an item nobody has added to a van sale.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { droppedPieces } from './at-the-door'

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
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-064 pieces at the door', () => {
  it('DOS-064 the zero word is this app’s own, and never "Not ordered" on a bill line', () => {
    const zero = (strings as Record<string, string>)['qty.notOrdered']
    expect(zero).toBeDefined()
    // A line on the bill in the driver's hand WAS ordered; so was every item on the van.
    expect(zero).not.toBe('Not ordered')
    expect(zero?.toLowerCase()).not.toContain('order')
  })

  it('DOS-064 D4 offers the kit’s pieces pad on every bill line', async () => {
    const deliver = await read('../../app/stop/[id]/deliver.tsx')
    expect({
      opensThePad: /onOpenPieces=\{/.test(deliver),
      // The kit's own parser (DOS-085), not a second reading of what a driver typed.
      parsesWithTheKit: /\bparsePieces\b/.test(deliver),
      // Whole pieces only, and the pad is a sheet like S3's rather than a keypad of its own.
      hasASheet: /testID="d4-pieces-sheet"/.test(deliver),
    }).toEqual({ opensThePad: true, parsesWithTheKit: true, hasASheet: true })
  })

  it('DOS-064 a typed count is whole pieces, and never more than the bill carries', () => {
    // The case a driver could not record at all: 70 of 75, on a 3 cs + 3 pc line.
    expect(droppedPieces('70', 75)).toBe(70)
    expect(droppedPieces('5', 5)).toBe(5)
    expect(droppedPieces('0', 5)).toBe(0)
    expect(droppedPieces(' 1,200 ', 2000)).toBe(1200)
    // More than the bill is capped at the bill: nothing may be dropped that was never on it.
    expect(droppedPieces('90', 75)).toBe(75)
    // What a person types that is not a whole count of pieces is refused, never truncated.
    for (const typed of ['', '   ', '1.5', '-3', '5abc', '1e3'])
      expect(droppedPieces(typed, 75)).toBeNull()
  })
})
