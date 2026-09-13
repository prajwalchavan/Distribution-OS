/**
 * DOS-101: the retailer app's price list must let a shop type an exact piece count, not just step
 * whole cases — otherwise an item with less than one case on the shelf ("Only 9 pc left") cannot be
 * ordered at all (a shop is forced to accept 1 cs = 24 pc against 9 in stock). The kit already carries
 * the pieces entry the sales app got in DOS-085 (`QtyStepperProps.onOpenPieces`, `parsePieces` here in
 * `@dos/ui`); R7 only has to wire it in.
 *
 * Read as source, the way `document-urls.test.ts` and `parity.test.ts` pin cross-app rules: the
 * retailer app has no test runner of its own to render the screen under.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(
  join(here, '..', '..', '..', 'retailer-app', 'app', 'order.tsx'),
  'utf8',
)

describe('DOS-101: R7 lets a shop type an exact piece count', () => {
  it('imports parsePieces from the kit, the same helper DOS-085 uses', () => {
    expect(/\bparsePieces\b/.test(source)).toBe(true)
  })

  it('wires onOpenPieces on the price list stepper', () => {
    const stepper = /<QtyStepper\b[\s\S]*?\/>/.exec(source)?.[0] ?? ''
    expect(stepper.length).toBeGreaterThan(0)
    expect(stepper).toContain('onOpenPieces')
  })

  it('commits the typed count through setQty, so a non-multiple types as a piece entry (enteredFor)', () => {
    expect(source).toMatch(/setQty\([^)]*\bqtyPcs\b[^)]*\)/)
  })
})
