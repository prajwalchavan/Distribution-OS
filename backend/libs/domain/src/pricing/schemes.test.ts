import { describe, expect, it } from 'vitest'
import { fromRupees, percentOf, paise } from '../money.js'
import { priceOrder, PricingError, type PriceOrderInput, type SchemeRule } from './schemes.js'

const V1 = 'variant-1' // ₹10.00, case of 12
const V2 = 'variant-2' // ₹20.00, case of 24
const V3 = 'variant-3' // ₹5.00, case of 10 (used as a free-goods variant)
const BRAND = 'brand-campa'

function scheme(over: Partial<SchemeRule> & { id: string }): SchemeRule {
  return {
    version: 1,
    scope: { variantIds: [V1] },
    triggerKind: 'qty',
    triggerMin: 12,
    triggerUnit: 'pcs',
    rewardKind: 'free_qty',
    rewardValue: 1,
    applicability: {},
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    stackable: true,
    final: false,
    fundingSource: 'company',
    claimable: true,
    gstOnFreeGoods: false,
    pricingDateMode: 'order',
    ...over,
  }
}

function order(over: Partial<PriceOrderInput> = {}): PriceOrderInput {
  return {
    pricingDate: '2026-09-04',
    retailer: { id: 'retailer-1', tier: 'C', beatId: 'beat-1' },
    lines: [
      {
        lineId: 'l1',
        variantId: V1,
        brandId: BRAND,
        category: 'beverages',
        qtyPcs: 24,
        caseSize: 12,
      },
      { lineId: 'l2', variantId: V2, brandId: BRAND, category: 'snacks', qtyPcs: 5, caseSize: 24 },
    ],
    tierPrices: { [V1]: fromRupees('10'), [V2]: fromRupees('20'), [V3]: fromRupees('5') },
    overrides: [],
    schemes: [],
    approvedBargains: [],
    ...over,
  }
}

function line(result: ReturnType<typeof priceOrder>, lineId: string) {
  const found = result.lines.find((l) => l.lineId === lineId)
  if (!found) throw new Error(`no line ${lineId}`)
  return found
}

describe('priceOrder', () => {
  it('prices from the tier list with no rules', () => {
    const r = priceOrder(order())
    expect(line(r, 'l1').ratePaise).toBe(fromRupees('10'))
    expect(line(r, 'l1').grossPaise).toBe(fromRupees('240'))
    expect(line(r, 'l1').appliedRules).toEqual([])
    expect(line(r, 'l2').lineNetPaise).toBe(fromRupees('100'))
    expect(r.totals).toEqual({
      grossPaise: fromRupees('340'),
      discountPaise: 0,
      bargainPaise: 0,
      netPaise: fromRupees('340'),
    })
    expect(r.cashDiscountBps).toBe(0)
  })

  it('applies a 12 + 1 free_qty scheme for every multiple', () => {
    const r = priceOrder(order({ schemes: [scheme({ id: 's-12-1' })] }))
    const l1 = line(r, 'l1')
    expect(l1.freeQtyPcs).toBe(2)
    expect(l1.freeItems).toEqual([{ variantId: V1, qtyPcs: 2, ruleId: 's-12-1', version: 1 }])
    expect(l1.appliedRules).toEqual([
      {
        ruleId: 's-12-1',
        version: 1,
        kind: 'scheme',
        rewardKind: 'free_qty',
        freeQty: 2,
        freeVariantId: V1,
      },
    ])
    expect(l1.lineNetPaise).toBe(fromRupees('240'))
    expect(line(r, 'l2').freeQtyPcs).toBe(0)
  })

  it('gives free goods of a different variant without touching the line free count', () => {
    const r = priceOrder(
      order({ schemes: [scheme({ id: 's-cross', freeVariantId: V3, rewardValue: 3 })] }),
    )
    const l1 = line(r, 'l1')
    expect(l1.freeQtyPcs).toBe(0)
    expect(l1.freeItems).toEqual([{ variantId: V3, qtyPcs: 6, ruleId: 's-cross', version: 1 }])
    expect(l1.appliedRules[0]).toMatchObject({ freeQty: 6, freeVariantId: V3 })
  })

  it('applies a line_pct secondary discount (invoice E shape: 12 × 8.66 − 12% = 91.45)', () => {
    const r = priceOrder(
      order({
        lines: [{ lineId: 'e', variantId: 'e-variant', qtyPcs: 12, caseSize: 12 }],
        tierPrices: { 'e-variant': fromRupees('8.66') },
        schemes: [
          scheme({
            id: 's-sec',
            scope: { all: true },
            triggerMin: 1,
            rewardKind: 'line_pct',
            rewardValue: 1200,
            version: 3,
          }),
        ],
      }),
    )
    const l = line(r, 'e')
    expect(l.grossPaise).toBe(fromRupees('103.92'))
    expect(l.discountPaise).toBe(fromRupees('12.47'))
    expect(l.lineNetPaise).toBe(fromRupees('91.45'))
    expect(l.appliedRules).toEqual([
      {
        ruleId: 's-sec',
        version: 3,
        kind: 'scheme',
        rewardKind: 'line_pct',
        amountPaise: fromRupees('12.47'),
      },
    ])
  })

  it('applies net_scheme_amount per multiple of the trigger and never below zero', () => {
    const r = priceOrder(
      order({
        schemes: [
          scheme({ id: 's-net', rewardKind: 'net_scheme_amount', rewardValue: fromRupees('10') }),
        ],
      }),
    )
    // 24 pcs = 2 multiples of 12 → ₹20 off
    expect(line(r, 'l1').discountPaise).toBe(fromRupees('20'))
    expect(line(r, 'l1').lineNetPaise).toBe(fromRupees('220'))

    const capped = priceOrder(
      order({
        schemes: [
          scheme({
            id: 's-huge',
            rewardKind: 'net_scheme_amount',
            rewardValue: fromRupees('1000'),
          }),
        ],
      }),
    )
    expect(line(capped, 'l1').discountPaise).toBe(fromRupees('240'))
    expect(line(capped, 'l1').lineNetPaise).toBe(0)
  })

  it('spreads an order_pct discount across the lines to the paisa', () => {
    const input = order({
      lines: [
        { lineId: 'a', variantId: V1, qtyPcs: 1, caseSize: 12 },
        { lineId: 'b', variantId: V1, qtyPcs: 1, caseSize: 12 },
        { lineId: 'c', variantId: V1, qtyPcs: 1, caseSize: 12 },
      ],
      tierPrices: { [V1]: paise(1001) },
      schemes: [
        scheme({
          id: 's-order',
          scope: { all: true },
          triggerKind: 'value',
          triggerUnit: 'inr',
          triggerMin: 3_000, // ₹30 in paise; the order is ₹30.03
          rewardKind: 'order_pct',
          rewardValue: 333,
        }),
      ],
    })
    const r = priceOrder(input)
    const expected = percentOf(paise(3003), 333) // 100.0 → 100 paise
    const allocated = r.lines.map((l) => l.discountPaise)
    expect(allocated.reduce((a, b) => a + b, 0)).toBe(expected)
    expect(allocated).toEqual([34, 33, 33])
    expect(r.orderRules).toEqual([
      {
        ruleId: 's-order',
        version: 1,
        kind: 'scheme',
        rewardKind: 'order_pct',
        amountPaise: expected,
      },
    ])
    expect(r.totals.discountPaise).toBe(expected)
    expect(r.totals.netPaise).toBe(3003 - expected)
    for (const l of r.lines) expect(l.appliedRules[0]?.amountPaise).toBe(l.discountPaise)
  })

  it('does not trigger order_pct below the order value threshold', () => {
    const r = priceOrder(
      order({
        schemes: [
          scheme({
            id: 's-order',
            scope: { all: true },
            triggerKind: 'value',
            triggerUnit: 'inr',
            triggerMin: 50_000, // ₹500 in paise; the order is ₹340
            rewardKind: 'order_pct',
            rewardValue: 500,
          }),
        ],
      }),
    )
    expect(r.totals.discountPaise).toBe(0)
    expect(r.orderRules).toEqual([])
  })

  it("DOS-075: an inr trigger is paise — '2% off on bills over ₹25,000' (triggerMin 2_500_000) fires at exactly ₹25,000.00 and not at ₹24,990.00", () => {
    // Stored the way the seed, POST /pricing/schemes and every app store it: paise of gross in-scope value.
    const over25k = scheme({
      id: 's-order-25k',
      scope: { all: true },
      triggerKind: 'value',
      triggerUnit: 'inr',
      triggerMin: 2_500_000,
      rewardKind: 'order_pct',
      rewardValue: 200,
      priority: 30,
    })
    const share = {
      ruleId: 's-order-25k',
      version: 1,
      kind: 'scheme',
      rewardKind: 'order_pct',
      amountPaise: 50_000,
    }
    const at = priceOrder(
      order({
        lines: [{ lineId: 'l1', variantId: V1, qtyPcs: 2_500, caseSize: 12 }],
        schemes: [over25k],
      }),
    )
    expect(at.totals.grossPaise).toBe(fromRupees('25000.00'))
    expect(at.orderRules).toEqual([share])
    expect(at.totals.discountPaise).toBe(50_000)
    expect(line(at, 'l1').appliedRules).toEqual([share])

    const below = priceOrder(
      order({
        lines: [{ lineId: 'l1', variantId: V1, qtyPcs: 2_499, caseSize: 12 }],
        schemes: [over25k],
      }),
    )
    expect(below.totals.grossPaise).toBe(fromRupees('24990.00'))
    expect(below.orderRules).toEqual([])
    expect(below.totals.discountPaise).toBe(0)
  })

  it('DOS-075: a line-level inr threshold is paise too — a 10% line_pct over ₹240 (triggerMin 24_000) fires on 24 pcs at ₹10 and not on 23', () => {
    const over240 = scheme({
      id: 's-line-240',
      scope: { variantIds: [V1] },
      triggerKind: 'value',
      triggerUnit: 'inr',
      triggerMin: 24_000,
      rewardKind: 'line_pct',
      rewardValue: 1000,
    })
    const at = priceOrder(order({ schemes: [over240] }))
    expect(line(at, 'l1').grossPaise).toBe(fromRupees('240'))
    expect(line(at, 'l1').discountPaise).toBe(2_400)
    expect(line(at, 'l1').appliedRules).toEqual([
      {
        ruleId: 's-line-240',
        version: 1,
        kind: 'scheme',
        rewardKind: 'line_pct',
        amountPaise: 2_400,
      },
    ])

    const base = order({ schemes: [over240] })
    const below = priceOrder({
      ...base,
      lines: base.lines.map((l) => (l.lineId === 'l1' ? { ...l, qtyPcs: 23 } : l)),
    })
    expect(line(below, 'l1').grossPaise).toBe(fromRupees('230'))
    expect(line(below, 'l1').discountPaise).toBe(0)
    expect(line(below, 'l1').appliedRules).toEqual([])
  })

  it('reports cash discount as conditional without deducting it', () => {
    const r = priceOrder(
      order({
        schemes: [
          scheme({
            id: 's-cd',
            scope: { all: true },
            triggerMin: 1,
            rewardKind: 'cash_discount_pct',
            rewardValue: 200,
          }),
          scheme({
            id: 's-cd-small',
            scope: { all: true },
            triggerMin: 1,
            rewardKind: 'cash_discount_pct',
            rewardValue: 100,
          }),
        ],
      }),
    )
    expect(r.cashDiscountBps).toBe(200)
    expect(r.cashDiscountPaise).toBe(fromRupees('6.80'))
    expect(r.totals.netPaise).toBe(fromRupees('340'))
    expect(r.orderRules).toEqual([
      {
        ruleId: 's-cd',
        version: 1,
        kind: 'scheme',
        rewardKind: 'cash_discount_pct',
        amountPaise: fromRupees('6.80'),
      },
    ])
  })

  it("DOS-076: a brand-scoped cash discount is reported on that brand's lines only, not the whole order", () => {
    const r = priceOrder(
      order({
        lines: [
          {
            lineId: 'l1',
            variantId: V1,
            brandId: 'brand-tooyumm',
            category: 'snacks',
            qtyPcs: 24,
            caseSize: 12,
          },
          {
            lineId: 'l2',
            variantId: V2,
            brandId: BRAND,
            category: 'snacks',
            qtyPcs: 5,
            caseSize: 24,
          },
        ],
        schemes: [
          scheme({
            id: 's-cd-ty',
            scope: { brandIds: ['brand-tooyumm'] },
            triggerKind: 'value',
            triggerUnit: 'inr',
            triggerMin: 0,
            rewardKind: 'cash_discount_pct',
            rewardValue: 200,
          }),
        ],
      }),
    )
    // 2% of the Too Yumm line's ₹240 net, not of the whole ₹340 order
    expect(r.cashDiscountBps).toBe(200)
    expect(r.cashDiscountPaise).toBe(fromRupees('4.80'))
    expect(r.orderRules).toEqual([
      {
        ruleId: 's-cd-ty',
        version: 1,
        kind: 'scheme',
        rewardKind: 'cash_discount_pct',
        amountPaise: fromRupees('4.80'),
      },
    ])
    // reported, never deducted
    expect(r.totals.netPaise).toBe(fromRupees('340'))
    expect(line(r, 'l1').discountPaise).toBe(0)
    expect(line(r, 'l2').discountPaise).toBe(0)
  })

  it('DOS-076: between cash discounts scoped to different brands, the one worth more to the retailer is reported', () => {
    const r = priceOrder(
      order({
        lines: [
          {
            lineId: 'l1',
            variantId: V1,
            brandId: 'brand-tooyumm',
            category: 'snacks',
            qtyPcs: 24,
            caseSize: 12,
          },
          {
            lineId: 'l2',
            variantId: V2,
            brandId: 'brand-rajwadi',
            category: 'beverages',
            qtyPcs: 50,
            caseSize: 24,
          },
        ],
        // in id order, as both callers pass them
        schemes: [
          scheme({
            id: 's-cd-rj',
            scope: { brandIds: ['brand-rajwadi'] },
            triggerKind: 'value',
            triggerUnit: 'inr',
            triggerMin: 0,
            rewardKind: 'cash_discount_pct',
            rewardValue: 150,
          }),
          scheme({
            id: 's-cd-ty',
            scope: { brandIds: ['brand-tooyumm'] },
            triggerKind: 'value',
            triggerUnit: 'inr',
            triggerMin: 0,
            rewardKind: 'cash_discount_pct',
            rewardValue: 200,
          }),
        ],
      }),
    )
    // Rajwadi 1.5% of ₹1,000 = ₹15.00 beats Too Yumm 2% of ₹240 = ₹4.80, whatever the rate says
    expect(r.cashDiscountBps).toBe(150)
    expect(r.cashDiscountPaise).toBe(fromRupees('15'))
    expect(r.orderRules).toEqual([
      {
        ruleId: 's-cd-rj',
        version: 1,
        kind: 'scheme',
        rewardKind: 'cash_discount_pct',
        amountPaise: fromRupees('15'),
      },
    ])
    expect(r.totals.netPaise).toBe(fromRupees('1240'))
  })

  it('lets a retailer override beat the tier and still stack schemes', () => {
    const r = priceOrder(
      order({
        overrides: [{ id: 'ov-1', variantId: V1, ratePaise: fromRupees('9'), final: false }],
        schemes: [scheme({ id: 's-12-1' })],
      }),
    )
    const l1 = line(r, 'l1')
    expect(l1.listRatePaise).toBe(fromRupees('10'))
    expect(l1.ratePaise).toBe(fromRupees('9'))
    expect(l1.grossPaise).toBe(fromRupees('216'))
    expect(l1.freeQtyPcs).toBe(2)
    expect(l1.appliedRules).toEqual([
      { ruleId: 'ov-1', version: 1, kind: 'override', amountPaise: fromRupees('24') },
      {
        ruleId: 's-12-1',
        version: 1,
        kind: 'scheme',
        rewardKind: 'free_qty',
        freeQty: 2,
        freeVariantId: V1,
      },
    ])
  })

  it('a final override blocks every scheme on that line, including order-level ones', () => {
    const r = priceOrder(
      order({
        overrides: [{ id: 'ov-final', variantId: V1, ratePaise: fromRupees('8.50'), final: true }],
        schemes: [
          scheme({ id: 's-12-1' }),
          scheme({
            id: 's-sec',
            scope: { all: true },
            triggerMin: 1,
            rewardKind: 'line_pct',
            rewardValue: 1000,
          }),
          scheme({
            id: 's-order',
            scope: { all: true },
            triggerKind: 'value',
            triggerUnit: 'inr',
            triggerMin: 1,
            rewardKind: 'order_pct',
            rewardValue: 500,
          }),
        ],
      }),
    )
    const l1 = line(r, 'l1')
    expect(l1.ratePaise).toBe(fromRupees('8.50'))
    expect(l1.freeQtyPcs).toBe(0)
    expect(l1.discountPaise).toBe(0)
    expect(l1.appliedRules).toEqual([
      { ruleId: 'ov-final', version: 1, kind: 'override', amountPaise: fromRupees('36') },
    ])
    expect(l1.lineNetPaise).toBe(fromRupees('204'))
    // the other line is unaffected: 10% line + 5% order on the remaining ₹90
    const l2 = line(r, 'l2')
    expect(l2.discountPaise).toBe(fromRupees('10') + fromRupees('4.50'))
    expect(r.orderRules).toEqual([
      {
        ruleId: 's-order',
        version: 1,
        kind: 'scheme',
        rewardKind: 'order_pct',
        amountPaise: fromRupees('4.50'),
      },
    ])
  })

  it('a non-stackable scheme applies alone: the engine picks whichever is worth more', () => {
    const stackA = scheme({
      id: 'stack-a',
      triggerMin: 1,
      rewardKind: 'line_pct',
      rewardValue: 500,
    }) // ₹12
    const stackB = scheme({
      id: 'stack-b',
      triggerMin: 1,
      rewardKind: 'line_pct',
      rewardValue: 300,
    }) // ₹6.84 after stack-a (compounds on the running net)
    const exclusive = scheme({
      id: 'excl',
      triggerMin: 1,
      rewardKind: 'line_pct',
      rewardValue: 1000,
      stackable: false,
    }) // ₹24
    const r = priceOrder(order({ schemes: [stackA, stackB, exclusive] }))
    expect(line(r, 'l1').appliedRules.map((a) => a.ruleId)).toEqual(['excl'])
    expect(line(r, 'l1').discountPaise).toBe(fromRupees('24'))

    // when the stackable pair is worth more than the exclusive one, the pair wins
    const weak = scheme({
      id: 'excl-weak',
      triggerMin: 1,
      rewardKind: 'line_pct',
      rewardValue: 600,
      stackable: false,
    })
    const r2 = priceOrder(order({ schemes: [stackA, stackB, weak] }))
    expect(line(r2, 'l1').appliedRules.map((a) => a.ruleId)).toEqual(['stack-a', 'stack-b'])
    // compounding: 5% of 240 = 12.00, then 3% of the running net 228 = 6.84 (review item 14)
    expect(line(r2, 'l1').discountPaise).toBe(fromRupees('18.84'))

    // two exclusive schemes: the best single one
    const r3 = priceOrder(order({ schemes: [exclusive, weak] }))
    expect(line(r3, 'l1').appliedRules.map((a) => a.ruleId)).toEqual(['excl'])
  })

  it('picks the highest slab whose min is met and applies it once', () => {
    const slabbed = scheme({
      id: 's-slab',
      triggerMin: 12,
      slabs: [
        { min: 12, value: 1 },
        { min: 24, value: 3 },
        { min: 48, value: 8, freeVariantId: V3 },
      ],
    })
    expect(line(priceOrder(order({ schemes: [slabbed] })), 'l1').freeQtyPcs).toBe(3) // 24 pcs → slab 24
    const big = priceOrder(
      order({
        lines: [{ lineId: 'l1', variantId: V1, qtyPcs: 100, caseSize: 12 }],
        schemes: [slabbed],
      }),
    )
    expect(line(big, 'l1').freeQtyPcs).toBe(0)
    expect(line(big, 'l1').freeItems).toEqual([
      { variantId: V3, qtyPcs: 8, ruleId: 's-slab', version: 1 },
    ])
    const small = priceOrder(
      order({
        lines: [{ lineId: 'l1', variantId: V1, qtyPcs: 6, caseSize: 12 }],
        schemes: [slabbed],
      }),
    )
    expect(line(small, 'l1').appliedRules).toEqual([])
  })

  it('measures case triggers in whole cases of the line case size', () => {
    const perCase = scheme({ id: 's-case', triggerMin: 1, triggerUnit: 'case', rewardValue: 2 })
    // 24 pcs / case 12 = 2 cases → 4 free
    expect(line(priceOrder(order({ schemes: [perCase] })), 'l1').freeQtyPcs).toBe(4)
    const loose = priceOrder(
      order({
        lines: [{ lineId: 'l1', variantId: V1, qtyPcs: 11, caseSize: 12 }],
        schemes: [perCase],
      }),
    )
    expect(line(loose, 'l1').freeQtyPcs).toBe(0)
  })

  it('filters applicability by tier, retailer and beat', () => {
    const forTierA = scheme({ id: 's-tier', applicability: { tiers: ['A'] } })
    const forRetailer = scheme({ id: 's-retailer', applicability: { retailerIds: ['retailer-1'] } })
    const forOtherBeat = scheme({ id: 's-beat', applicability: { beatIds: ['beat-9'] } })
    const forBeat = scheme({ id: 's-beat-ok', applicability: { beatIds: ['beat-1'] } })
    const r = priceOrder(order({ schemes: [forTierA, forRetailer, forOtherBeat, forBeat] }))
    // stacked rules apply in (priority, free-goods-first, id) order
    expect(line(r, 'l1').appliedRules.map((a) => a.ruleId)).toEqual(['s-beat-ok', 's-retailer'])
    // a retailer without a beat never matches a beat-restricted scheme
    const noBeat = priceOrder(
      order({ retailer: { id: 'retailer-1', tier: 'A' }, schemes: [forTierA, forBeat] }),
    )
    expect(line(noBeat, 'l1').appliedRules.map((a) => a.ruleId)).toEqual(['s-tier'])
  })

  it('honours the validity window inclusively and the delivery-date mode', () => {
    const expired = scheme({ id: 's-old', validFrom: '2026-01-01', validTo: '2026-09-03' })
    const future = scheme({ id: 's-next', validFrom: '2026-09-05', validTo: '2026-12-31' })
    const today = scheme({ id: 's-today', validFrom: '2026-09-04', validTo: '2026-09-04' })
    const r = priceOrder(order({ schemes: [expired, future, today] }))
    expect(line(r, 'l1').appliedRules.map((a) => a.ruleId)).toEqual(['s-today'])

    const onDelivery = scheme({
      id: 's-delivery',
      validFrom: '2026-09-05',
      validTo: '2026-09-06',
      pricingDateMode: 'delivery',
    })
    expect(line(priceOrder(order({ schemes: [onDelivery] })), 'l1').appliedRules).toEqual([])
    expect(
      line(
        priceOrder(order({ deliveryDate: '2026-09-06', schemes: [onDelivery] })),
        'l1',
      ).appliedRules.map((a) => a.ruleId),
    ).toEqual(['s-delivery'])
  })

  it('scopes by brand and category, and an empty scope matches nothing', () => {
    const byBrand = scheme({
      id: 's-brand',
      scope: { brandIds: [BRAND] },
      triggerMin: 1,
      rewardKind: 'line_pct',
      rewardValue: 100,
    })
    const byCategory = scheme({
      id: 's-cat',
      scope: { categories: ['snacks'] },
      triggerMin: 1,
      rewardKind: 'line_pct',
      rewardValue: 100,
    })
    const empty = scheme({
      id: 's-empty',
      scope: {},
      triggerMin: 1,
      rewardKind: 'line_pct',
      rewardValue: 100,
    })
    const r = priceOrder(order({ schemes: [byBrand, byCategory, empty] }))
    expect(line(r, 'l1').appliedRules.map((a) => a.ruleId)).toEqual(['s-brand'])
    expect(line(r, 'l2').appliedRules.map((a) => a.ruleId)).toEqual(['s-brand', 's-cat'])
  })

  it('applies an approved bargain last, after schemes, as the charged rate', () => {
    const r = priceOrder(
      order({
        schemes: [
          scheme({ id: 's-12-1' }),
          scheme({ id: 's-sec', triggerMin: 1, rewardKind: 'line_pct', rewardValue: 1000 }),
        ],
        approvedBargains: [{ id: 'bg-1', variantId: V1, ratePaise: fromRupees('9.50') }],
      }),
    )
    const l1 = line(r, 'l1')
    expect(l1.ratePaise).toBe(fromRupees('9.50'))
    expect(l1.listRatePaise).toBe(fromRupees('10'))
    expect(l1.grossPaise).toBe(fromRupees('240'))
    expect(l1.discountPaise).toBe(fromRupees('24')) // 10% of the pre-bargain gross
    expect(l1.bargainPaise).toBe(fromRupees('12'))
    expect(l1.freeQtyPcs).toBe(2)
    expect(l1.lineNetPaise).toBe(fromRupees('204'))
    expect(l1.appliedRules.at(-1)).toEqual({
      ruleId: 'bg-1',
      version: 1,
      kind: 'bargain',
      amountPaise: fromRupees('12'),
    })
    expect(r.totals.bargainPaise).toBe(fromRupees('12'))

    // a bargain that is not below the rate is ignored
    const noop = priceOrder(
      order({ approvedBargains: [{ variantId: V1, ratePaise: fromRupees('10') }] }),
    )
    expect(line(noop, 'l1').bargainPaise).toBe(0)
    expect(line(noop, 'l1').appliedRules).toEqual([])
  })

  it('a final scheme locks the line: no other scheme and no bargain', () => {
    const r = priceOrder(
      order({
        schemes: [
          scheme({
            id: 's-final',
            triggerMin: 1,
            rewardKind: 'line_pct',
            rewardValue: 1500,
            final: true,
          }),
          scheme({ id: 's-12-1' }),
          scheme({
            id: 's-order',
            scope: { all: true },
            triggerKind: 'value',
            triggerUnit: 'inr',
            triggerMin: 1,
            rewardKind: 'order_pct',
            rewardValue: 500,
          }),
        ],
        approvedBargains: [{ variantId: V1, ratePaise: fromRupees('1') }],
      }),
    )
    const l1 = line(r, 'l1')
    expect(l1.appliedRules.map((a) => a.ruleId)).toEqual(['s-final'])
    expect(l1.bargainPaise).toBe(0)
    // the order-level scheme still applies to the other line
    expect(line(r, 'l2').appliedRules.map((a) => a.ruleId)).toEqual(['s-order'])
  })

  it('a mix trigger measures the assortment across lines and rewards once per order', () => {
    // buy 25 pcs across the brand → 2 pcs of V3 free, attached to the biggest line
    const mix = scheme({
      id: 's-mix',
      scope: { brandIds: [BRAND] },
      triggerKind: 'mix',
      triggerMin: 25,
      rewardValue: 2,
      freeVariantId: V3,
    })
    const r = priceOrder(order({ schemes: [mix] }))
    expect(line(r, 'l1').freeItems).toEqual([
      { variantId: V3, qtyPcs: 2, ruleId: 's-mix', version: 1 },
    ])
    expect(line(r, 'l2').freeItems).toEqual([])
    expect(r.orderRules).toEqual([
      {
        ruleId: 's-mix',
        version: 1,
        kind: 'scheme',
        rewardKind: 'free_qty',
        freeQty: 2,
        freeVariantId: V3,
      },
    ])
    // 24 + 5 = 29 pcs; a 30-pc mix does not fire
    const tooHigh = priceOrder(
      order({ schemes: [scheme({ ...mix, id: 's-mix-30', triggerMin: 30 })] }),
    )
    expect(tooHigh.orderRules).toEqual([])
  })

  it('rejects an unpriced variant, bad dates and duplicate line ids', () => {
    expect(() => priceOrder(order({ tierPrices: { [V1]: 1000 } }))).toThrow(PricingError)
    expect(() => priceOrder(order({ pricingDate: '04/09/2026' }))).toThrow(PricingError)
    expect(() =>
      priceOrder(
        order({
          lines: [
            { lineId: 'dup', variantId: V1, qtyPcs: 1, caseSize: 12 },
            { lineId: 'dup', variantId: V2, qtyPcs: 1, caseSize: 24 },
          ],
        }),
      ),
    ).toThrow(PricingError)
    expect(() =>
      priceOrder(order({ lines: [{ lineId: 'x', variantId: V1, qtyPcs: 1.5, caseSize: 12 }] })),
    ).toThrow(PricingError)
    // an override alone is enough to price a variant that is missing from the list
    const r = priceOrder(
      order({
        tierPrices: { [V2]: 2000 },
        overrides: [{ variantId: V1, ratePaise: 900, final: false }],
      }),
    )
    expect(line(r, 'l1').listRatePaise).toBe(900)
    expect(line(r, 'l1').appliedRules).toEqual([
      { ruleId: `override:${V1}`, version: 1, kind: 'override', amountPaise: 0 },
    ])
  })

  it('is deterministic: the same input prices identically on every call (device == server)', () => {
    const input = order({
      overrides: [{ id: 'ov', variantId: V2, ratePaise: 1900, final: false }],
      schemes: [
        scheme({ id: 's-12-1' }),
        scheme({
          id: 's-order',
          scope: { all: true },
          triggerKind: 'value',
          triggerUnit: 'inr',
          triggerMin: 1,
          rewardKind: 'order_pct',
          rewardValue: 250,
        }),
        scheme({
          id: 's-cd',
          scope: { all: true },
          triggerMin: 1,
          rewardKind: 'cash_discount_pct',
          rewardValue: 150,
        }),
      ],
      approvedBargains: [{ id: 'bg', variantId: V1, ratePaise: 975 }],
    })
    const a = priceOrder(input)
    const b = priceOrder(JSON.parse(JSON.stringify(input)) as PriceOrderInput)
    expect(b).toEqual(a)
    expect(a.totals.netPaise).toBe(
      a.totals.grossPaise - a.totals.discountPaise - a.totals.bargainPaise,
    )
    expect(a.totals.netPaise).toBe(a.lines.reduce((n, l) => n + l.lineNetPaise, 0))
  })
})

describe('priority and compounding (review item 14)', () => {
  it('applies rules in priority order and compounds each percentage on the running net', async () => {
    const { priceOrder } = await import('./schemes.js')
    const base = {
      scope: { all: true },
      triggerKind: 'qty' as const,
      triggerMin: 1,
      triggerUnit: 'pcs' as const,
      applicability: {},
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      version: 1,
      stackable: true,
      final: false,
      fundingSource: 'company' as const,
      claimable: false,
      gstOnFreeGoods: false,
      pricingDateMode: 'order' as const,
    }
    const ten = {
      ...base,
      id: 'z-ten',
      rewardKind: 'line_pct' as const,
      rewardValue: 1000,
      priority: 1,
    }
    const five = {
      ...base,
      id: 'a-five',
      rewardKind: 'line_pct' as const,
      rewardValue: 500,
      priority: 2,
    }
    const r = priceOrder({
      pricingDate: '2026-09-04',
      retailer: { id: 'r1', tier: 'C' },
      lines: [{ lineId: 'l1', variantId: 'v1', qtyPcs: 10, caseSize: 10 }],
      tierPrices: { v1: 10_000 },
      overrides: [],
      schemes: [five, ten],
      approvedBargains: [],
    })
    const l = r.lines[0]
    if (!l) throw new Error('no line')
    // priority 1 first despite the id order: 10% of 100,000 = 10,000; then 5% of 90,000 = 4,500
    expect(l.appliedRules.map((a) => a.ruleId)).toEqual(['z-ten', 'a-five'])
    expect(l.discountPaise).toBe(14_500)
  })
})
