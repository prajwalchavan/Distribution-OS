import { describe, expect, it } from 'vitest'
import { fromRupees } from '../money.js'
import { resolvePrice } from './resolve-price.js'

describe('resolvePrice', () => {
  it('uses the tier price with a secondary discount scheme (invoice E shape)', () => {
    // 12 pcs x 8.66 = 103.92 gross, 12% secondary discount = 12.47 -> 91.45 net
    const r = resolvePrice({
      tierUnitPrice: fromRupees('8.66'),
      quantity: 12,
      schemes: [{ kind: 'percent_off', bps: 1200 }],
    })
    expect(r.gross).toBe(fromRupees('103.92'))
    expect(r.schemeDiscount).toBe(fromRupees('12.47'))
    expect(r.net).toBe(fromRupees('91.45'))
    expect(r.applied).toEqual(['scheme:percent_off:1200'])
  })

  it('lets a retailer override beat the tier and still stack schemes unless final', () => {
    const stacking = resolvePrice({
      tierUnitPrice: fromRupees('10'),
      override: { unitPrice: fromRupees('9'), final: false },
      quantity: 10,
      schemes: [{ kind: 'free_qty', buy: 10, free: 1 }],
    })
    expect(stacking.unitPrice).toBe(fromRupees('9'))
    expect(stacking.freeQuantity).toBe(1)

    const final = resolvePrice({
      tierUnitPrice: fromRupees('10'),
      override: { unitPrice: fromRupees('9'), final: true },
      quantity: 10,
      schemes: [
        { kind: 'free_qty', buy: 10, free: 1 },
        { kind: 'percent_off', bps: 500 },
      ],
    })
    expect(final.freeQuantity).toBe(0)
    expect(final.schemeDiscount).toBe(0)
    expect(final.net).toBe(fromRupees('90'))
  })

  it('applies an approved bargain after schemes', () => {
    const r = resolvePrice({
      tierUnitPrice: fromRupees('100'),
      quantity: 1,
      schemes: [{ kind: 'percent_off', bps: 1000 }],
      bargainBps: 200,
    })
    expect(r.schemeDiscount).toBe(fromRupees('10'))
    expect(r.bargainDiscount).toBe(fromRupees('1.80'))
    expect(r.net).toBe(fromRupees('88.20'))
  })
})
