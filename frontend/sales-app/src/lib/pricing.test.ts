import { describe, expect, it } from 'vitest'

import {
  describePriceChange,
  diffQuoteVsOrder,
  formatCaseSummary,
  payableSummary,
  summarizeCases,
} from './pricing'

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

/**
 * DOS-129: `new.tsx:266` formatted the order footer's total against `caseSizeOf()` — the FIRST
 * line's case size — so 2 cs of a 24-pc case plus 1 cs of a 48-pc case (96 pc total) read "4 cs"
 * (96 / 24), not "3 cs". The helper must move out of `app/` to be testable (sales vitest runs
 * `--dir src`), and sum each line's whole cases and loose pieces against its OWN case size.
 */
describe('DOS-129: summarizeCases sums each line in its OWN case size', () => {
  it("2 cs of a 24-pc case plus 1 cs of a 48-pc case reads '3 cs', not '4 cs' off the first line's case size", () => {
    const summary = summarizeCases([
      { qtyPcs: 48, caseSize: 24 }, // 2 cs
      { qtyPcs: 48, caseSize: 48 }, // 1 cs
    ])
    expect(summary).toEqual({ cases: 3, pieces: 0 })
    expect(formatCaseSummary(summary)).toBe('3 cs')
  })

  it("21 single-case lines with mixed case sizes read '21 cs'", () => {
    const lines = [24, 48, 12, 96, 120, 144, 90].flatMap((caseSize) =>
      Array.from({ length: 3 }, () => ({ qtyPcs: caseSize, caseSize })),
    )
    expect(lines).toHaveLength(21)
    expect(formatCaseSummary(summarizeCases(lines))).toBe('21 cs')
  })

  it("carries loose pieces separately, each counted against its own line's case size", () => {
    const summary = summarizeCases([
      { qtyPcs: 54, caseSize: 24 }, // 2 cs + 6 pc
      { qtyPcs: 25, caseSize: 48 }, // 0 cs + 25 pc
    ])
    expect(summary).toEqual({ cases: 2, pieces: 31 })
    expect(formatCaseSummary(summary)).toBe('2 cs + 31 pcs')
  })

  it('reads pieces alone when there is no whole case anywhere, and "0 pcs" for an empty order', () => {
    expect(formatCaseSummary(summarizeCases([{ qtyPcs: 5, caseSize: 24 }]))).toBe('5 pcs')
    expect(formatCaseSummary(summarizeCases([]))).toBe('0 pcs')
  })
})

/**
 * DOS-083: the rep read "₹28,739.70 before GST" on the order screen and "Order total ₹32,030.00" on
 * the order the moment it was placed — two totals for the same goods on consecutive screens, and the
 * shop heard the wrong one across the counter. `pricing.quote` knows the payable (GST and, since
 * DOS-079, cess); the device engine never will, because `hsn_rates` is not in a salesperson's
 * manifest. So the summary carries the server's payable when there is one and says "before GST"
 * honestly when there is not — it never invents a tax.
 */
describe('DOS-083: the payable the shop will owe, before the rep commits', () => {
  const deviceTotals = { netPaise: 2_873_970, discountPaise: 41_200 }
  const serverTotals = {
    netPaise: 2_873_970,
    discountPaise: 41_200,
    taxPaise: 329_030,
    cessPaise: 13_231,
    roundOffPaise: 0,
    totalPaise: 3_203_000,
  }

  it('carries the server quote: the payable is its total, with GST and cess named', () => {
    const summary = payableSummary(deviceTotals, serverTotals)
    expect(summary).toEqual({
      netPaise: 2_873_970,
      discountPaise: 41_200,
      taxPaise: 329_030,
      cessPaise: 13_231,
      roundOffPaise: 0,
      payablePaise: 3_203_000,
      withGst: true,
    })
  })

  it('stays honestly before GST with no server quote: no tax, no payable, nothing invented', () => {
    const summary = payableSummary(deviceTotals, null)
    expect(summary).toEqual({
      netPaise: 2_873_970,
      discountPaise: 41_200,
      taxPaise: null,
      cessPaise: null,
      roundOffPaise: null,
      payablePaise: null,
      withGst: false,
    })
  })

  it('refuses a server quote that priced a different basket: a stale payable is worse than none', () => {
    const stale = payableSummary(deviceTotals, { ...serverTotals, netPaise: 1_000_000 })
    expect(stale.withGst).toBe(false)
    expect(stale.payablePaise).toBeNull()
    expect(stale.netPaise).toBe(2_873_970)
  })
})
