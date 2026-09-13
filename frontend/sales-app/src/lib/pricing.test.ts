import { describe, expect, it } from 'vitest'

import { describePriceChange, diffQuoteVsOrder } from './pricing'

/**
 * DOS-082: `orders.create` re-prices on the server from the same price-list tables the device just
 * quoted from — correct, because the office may have edited a price list while the draft sat open —
 * but until now nothing compared the two, so a rep who quoted ₹1,877.76 across the counter watched
 * the order go through at ₹1,980.00 with no notice at all.
 */
describe('DOS-082: diffQuoteVsOrder names a rate the office changed while the draft sat open', () => {
  it("names a rate that moved between the device quote and the orders.create reply: '26.08 → 27.50'", () => {
    const changes = diffQuoteVsOrder(
      [{ variantId: 'v1', ratePaise: 2608 }],
      [{ variantId: 'v1', variantName: 'Neelam Neem Soap 100 g', ratePaise: 2750 }],
    )
    expect(changes).toHaveLength(1)
    const [change] = changes
    if (change === undefined) throw new Error('unreachable: length checked above')
    expect(describePriceChange(change)).toBe('Neelam Neem Soap 100 g 26.08 → 27.50')
  })

  it('says nothing when every line came back at the rate the device quoted', () => {
    expect(
      diffQuoteVsOrder(
        [{ variantId: 'v1', ratePaise: 2608 }],
        [{ variantId: 'v1', variantName: 'Neelam Neem Soap 100 g', ratePaise: 2608 }],
      ),
    ).toEqual([])
  })

  it('ignores a server line the device never quoted (unpriced on the device, or added server-side)', () => {
    expect(
      diffQuoteVsOrder(
        [],
        [{ variantId: 'v1', variantName: 'Neelam Neem Soap 100 g', ratePaise: 2750 }],
      ),
    ).toEqual([])
  })

  it('names every line that moved, in the order the server returned them', () => {
    const changes = diffQuoteVsOrder(
      [
        { variantId: 'v1', ratePaise: 2608 },
        { variantId: 'v2', ratePaise: 5000 },
      ],
      [
        { variantId: 'v1', variantName: 'Neelam Neem Soap 100 g', ratePaise: 2750 },
        { variantId: 'v2', variantName: 'Campa Cola 750 ml', ratePaise: 5000 },
      ],
    )
    expect(changes.map((change) => change.variantId)).toEqual(['v1'])
  })
})
