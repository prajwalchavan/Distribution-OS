/**
 * DOS-144: after a short pick, the order detail kept showing what was ORDERED — "60 pc" and "You pay
 * ₹6,753.00" — next to its own bill panel reading INV/9010 ₹6,679.00, with no mention of the 6 pieces
 * that never shipped. Once an order has a bill, the screen must say what was actually delivered per
 * line and let the bill's own amount due (never the order's original total) answer "how much".
 *
 * Read as source: the retailer app has no test runner of its own to render this screen.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(
  join(here, '..', '..', '..', 'retailer-app', 'app', 'orders', '[id].tsx'),
  'utf8',
)

describe('DOS-144: a billed order shows what was actually delivered, and the bill decides "how much"', () => {
  it('a short line compares deliveredQtyPcs against qtyPcs once the order has a bill', () => {
    expect(source).toMatch(/deliveredQtyPcs/)
    expect(source).toMatch(/line\.qtyPcs\s*-\s*line\.deliveredQtyPcs/)
  })

  it("the bottom bar's money is the bill's amountDuePaise once there is one, not the order's own total", () => {
    const bar = /bottomBar=\{[\s\S]*?\n {6}\}\n/.exec(source)?.[0] ?? ''
    expect(bar.length).toBeGreaterThan(0)
    expect(bar).toMatch(/amountDuePaise/)
  })

  it('the bar links to the bill once the order has one', () => {
    const bar = /bottomBar=\{[\s\S]*?\n {6}\}\n/.exec(source)?.[0] ?? ''
    expect(bar).toMatch(/\/bills\/\$\{/)
  })
})
