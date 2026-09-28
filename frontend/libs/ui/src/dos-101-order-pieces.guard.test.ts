/**
 * DOS-101: the retailer app's price list must let a shop type an exact piece count, not just step
 * whole cases — otherwise an item with less than one case on the shelf ("Only 9 pc left") cannot be
 * ordered at all (a shop is forced to accept 1 cs = 24 pc against 9 in stock). The kit already carries
 * the pieces entry the sales app got in DOS-085 (`QtyStepperProps.onOpenPieces`, `parsePieces` here in
 * `@dos/ui`); R7 only has to wire it in.
 *
 * WHERE THE PAD IS NOW. Since the founder's decision of 2026-09-28 (the shopkeeper's home is a shop
 * front, and every tile on it sells into the same basket) the pad is no longer drawn inside
 * `order.tsx`: it was lifted, unchanged, into `src/groups/retailer/lib/pieces.tsx` so the home, a brand
 * page and search open the SAME pad as the order screen's rows. This guard follows it there and pins
 * that the order screen and the shop front both still wire it — it is not weakened: every promise it
 * made about R7 is still asserted, one file over.
 *
 * Read as source, the way `document-urls.test.ts` and `parity.test.ts` pin cross-app rules: the
 * retailer app has no test runner of its own to render the screen under.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..', '..', '..', 'dos-app')
const read = (...path: string[]): string => readFileSync(join(app, ...path), 'utf8')

const source = read('app', 'retailer', 'order.tsx')
const pad = read('src', 'groups', 'retailer', 'lib', 'pieces.tsx')
const tile = read('src', 'groups', 'retailer', 'lib', 'shop-ui.tsx')

describe('DOS-101: R7 lets a shop type an exact piece count', () => {
  it('the pad imports parsePieces from the kit, the same helper DOS-085 uses', () => {
    expect(/\bparsePieces\b/.test(pad)).toBe(true)
  })

  it('wires onOpenPieces on the price list stepper', () => {
    const stepper = /<QtyStepper\b[\s\S]*?\/>/.exec(source)?.[0] ?? ''
    expect(stepper.length).toBeGreaterThan(0)
    expect(stepper).toContain('onOpenPieces')
  })

  it('commits the typed count through setQty, so a non-multiple types as a piece entry (enteredFor)', () => {
    expect(pad).toMatch(/setQty\([^)]*\bqtyPcs\b[^)]*\)/)
    // …and the order screen hands the pad the basket's own setQty, the call a stepper tap makes.
    expect(source).toMatch(/usePiecesEntry\(\{[\s\S]*?setQty: shopping\.setQty/)
  })

  it('every tile on the shop front opens the same pad (founder, 2026-09-28)', () => {
    const product = /<ProductTile\b[\s\S]*?\/>/.exec(tile)?.[0] ?? ''
    expect(product).toContain('onOpenPieces')
  })
})
