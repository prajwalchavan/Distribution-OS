import { describe, expect, it } from 'vitest'
import { HSN_RATES, PRODUCTS } from './catalog.js'

/**
 * THE DEMO CATALOGUE'S TAX TABLE IS A FUNCTION, NOT A LOOKUP WITH TWO ANSWERS (QA S-176).
 *
 * `hsn_rates` is keyed by HSN and date, and every caller — `pricing.quote` for the order, billing for
 * the invoice, the godown for the challan, docint for an inbound bill — asks it the same question:
 * the rows live on this date, newest `effective_from` first, take the first. So one HSN on one date
 * must name ONE rate, or "the first" is whatever the query plan hands back, and the rep quotes 12%
 * on a case the bill charges 28% + 12% cess for.
 *
 * Every variant in the demo catalogue declares the rate it is meant to bear (`gstBps` / `cessBps`,
 * used by `seed-demo/billing.ts` to build the invoices). These two tests hold that declaration and
 * the HSN table to each other: a SKU whose HSN resolves to a different rate is a SKU that will be
 * billed at a number nobody chose.
 */
describe('the demo catalogue HSN rates', () => {
  const live = HSN_RATES.map((r) => ({ ...r, effectiveFrom: '2017-07-01' }))

  it('names one rate per HSN and effective date', () => {
    const seen = new Map<string, string[]>()
    for (const rate of live) {
      const key = `${rate.hsnCode}@${rate.effectiveFrom}`
      seen.set(key, [...(seen.get(key) ?? []), `${rate.description} (${rate.gstBps} bps)`])
    }
    const ambiguous = [...seen].filter(([, rows]) => rows.length > 1)
    expect(Object.fromEntries(ambiguous)).toEqual({})
  })

  it('gives every SKU an HSN whose rate is the rate the SKU is billed at', () => {
    const byCode = new Map(live.map((r) => [r.hsnCode, r]))
    const wrong: string[] = []
    for (const product of PRODUCTS)
      for (const variant of product.variants) {
        const rate = byCode.get(variant.hsnCode)
        if (!rate) {
          wrong.push(`${product.name} ${variant.name}: HSN ${variant.hsnCode} has no rate`)
          continue
        }
        if (rate.gstBps !== variant.gstBps || rate.cessBps !== variant.cessBps)
          wrong.push(
            `${product.name} ${variant.name}: HSN ${variant.hsnCode} is ${rate.gstBps}/${rate.cessBps} ("${rate.description}") but the SKU is billed at ${variant.gstBps}/${variant.cessBps}`,
          )
      }
    expect(wrong).toEqual([])
  })

  it('bills an aerated drink at 28% plus 12% cess', () => {
    const campa = PRODUCTS.find((p) => p.key === 'campa-cola')?.variants[0]
    expect(campa?.gstBps).toBe(2800)
    expect(campa?.cessBps).toBe(1200)
    const rate = live.find((r) => r.hsnCode === campa?.hsnCode)
    expect(rate?.gstBps).toBe(2800)
    expect(rate?.cessBps).toBe(1200)
  })
})
