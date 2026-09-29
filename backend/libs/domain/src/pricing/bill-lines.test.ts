import { describe, expect, it } from 'vitest'
import { lineTax, placeOfSupply, splitGst } from '../gst.js'
import { divideHalfUp, shareOut } from '../money.js'
import { billOrderLine, spreadFreePieces, type BatchLineMoney } from './bill-lines.js'
import type { AppliedRule } from './schemes.js'

const total = (lines: readonly BatchLineMoney[], pick: (l: BatchLineMoney) => number): number =>
  lines.reduce((s, l) => s + pick(l), 0)

/** Σ of one rule's amount (or free pieces) over the bill's batch lines. */
const ruleTotal = (lines: readonly BatchLineMoney[], ruleId: string, what: 'amount' | 'free') =>
  lines.reduce(
    (s, l) =>
      s +
      l.appliedRules
        .filter((r) => r.ruleId === ruleId)
        .reduce((n, r) => n + ((what === 'amount' ? r.amountPaise : r.freeQty) ?? 0), 0),
    0,
  )

const scheme = (ruleId: string, extra: Partial<AppliedRule>): AppliedRule => ({
  ruleId,
  version: 1,
  kind: 'scheme',
  ...extra,
})

describe('divideHalfUp and shareOut', () => {
  it('rounds a half paisa up, both signs, in integers', () => {
    expect(divideHalfUp(1025 * 1200, 20_000)).toBe(62) // 61.5
    expect(divideHalfUp(1025 * 1200, 10_000)).toBe(123) // 123.0
    expect(divideHalfUp(-123, 2)).toBe(-62)
    expect(divideHalfUp(149, 100)).toBe(1)
    expect(divideHalfUp(150, 100)).toBe(2)
    expect(divideHalfUp(900_719_925_474_099, 20_000)).toBe(45_035_996_274) // .95 up
  })

  it('shares any amount: zero, negative, and weights that are all zero', () => {
    expect(shareOut(0, [1, 2])).toEqual([0, 0])
    expect(shareOut(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(shareOut(-100, [1, 1, 1])).toEqual([-34, -33, -33])
    expect(shareOut(7, [0, 0])).toEqual([7, 0])
    expect(shareOut(5, [])).toEqual([])
  })
})

describe('lineTax — the one GST rule (ruling 2, QA DOS-332)', () => {
  it('halves each rounded half up inside the state; IGST whole across states', () => {
    // T01: ₹10.25 at 12 %: 61.5 p each half → 62 + 62, never the combined 123 p.
    expect(lineTax(1025, { gstBps: 1200, cessBps: 0 }, false)).toEqual({
      cgstPaise: 62,
      sgstPaise: 62,
      igstPaise: 0,
      cessPaise: 0,
      gstPaise: 124,
      taxPaise: 124,
    })
    // T05: the same across states is one IGST, rounded once.
    expect(lineTax(1050, { gstBps: 1800, cessBps: 0 }, true).igstPaise).toBe(189)
    expect(lineTax(1050, { gstBps: 1800, cessBps: 0 }, false).gstPaise).toBe(190) // 94.5 → 95, twice
    // Cess is its own rate on the same taxable.
    expect(lineTax(10_000, { gstBps: 2800, cessBps: 1200 }, false)).toMatchObject({
      cgstPaise: 1400,
      sgstPaise: 1400,
      cessPaise: 1200,
      taxPaise: 4000,
    })
    // An odd rate is not refused: 0.25 % halves to 0.125 %.
    expect(lineTax(10_000, { gstBps: 25, cessBps: 0 }, false).cgstPaise).toBe(13)
  })

  it('splitGst is the same rule', () => {
    const s = splitGst(1025 as never, 1200, '27', '27')
    expect(s.cgst + s.sgst).toBe(lineTax(1025, { gstBps: 1200, cessBps: 0 }, false).gstPaise)
  })

  it('place of supply: a registered GSTIN wins, an unregistered one does not', () => {
    expect(placeOfSupply({ gstin: '24AAACB1234C1Z5', stateCode: '27' })).toBe('24')
    expect(
      placeOfSupply({ gstin: '24AAACB1234C1Z5', stateCode: '27', gstRegType: 'unregistered' }),
    ).toBe('27')
    expect(placeOfSupply({ gstin: null, stateCode: '27' })).toBe('27')
  })
})

describe('billOrderLine — an order line over its batches (rulings 1, 2, 10)', () => {
  it('X05: a 6 % exclusive scheme over five batches is counted once, and adds up to the discount', () => {
    // 12 × Godavari Ghee at ₹317.38 = ₹3,808.56, 6 % = ₹228.51; picked 1 + 3 + 3 + 3 + 2.
    const rate = 31_738
    const ghee6 = scheme('ghee-6', { rewardKind: 'line_pct', amountPaise: 22_851 })
    const lines = billOrderLine(
      {
        variantId: 'ghee',
        qtyPcs: 12,
        freeQtyPcs: 0,
        ratePaise: rate,
        discountPaise: 22_851,
        appliedRules: [ghee6],
      },
      [1, 3, 3, 3, 2].map((q) => ({ qtyPcs: q, freeQtyPcs: 0 })),
      { gstBps: 1200, cessBps: 0 },
      false,
    )
    expect(lines).toHaveLength(5)
    expect(ruleTotal(lines, 'ghee-6', 'amount')).toBe(22_851) // not 5 × 22 851
    expect(total(lines, (l) => l.discountPaise)).toBe(22_851)
    for (const l of lines) {
      const share = l.appliedRules.find((r) => r.ruleId === 'ghee-6')
      expect(share?.batchShare).toBe(true)
      expect(share?.amountPaise).toBe(l.discountPaise)
    }
    // The tax is the order line's, shared: 12 × 317.38 − 228.51 = 3 580.05 at 12 % → 214.80 + 214.80.
    const tax = lineTax(12 * rate - 22_851, { gstBps: 1200, cessBps: 0 }, false)
    expect(total(lines, (l) => l.cgstPaise)).toBe(tax.cgstPaise)
    expect(total(lines, (l) => l.sgstPaise)).toBe(tax.sgstPaise)
    expect(total(lines, (l) => l.taxablePaise)).toBe(12 * rate - 22_851)
  })

  it('two stacked rules over three batches: each rule once, each batch its rules, the bill its discount', () => {
    const pct = scheme('pct', { rewardKind: 'line_pct', amountPaise: 3_333 })
    const bill = scheme('bill', { rewardKind: 'order_pct', amountPaise: 1_001 })
    const lines = billOrderLine(
      {
        variantId: 'v',
        qtyPcs: 30,
        freeQtyPcs: 0,
        ratePaise: 1_111,
        discountPaise: 4_334,
        appliedRules: [pct, bill],
      },
      [
        { qtyPcs: 7, freeQtyPcs: 0 },
        { qtyPcs: 13, freeQtyPcs: 0 },
        { qtyPcs: 10, freeQtyPcs: 0 },
      ],
      { gstBps: 500, cessBps: 0 },
      false,
    )
    expect(ruleTotal(lines, 'pct', 'amount')).toBe(3_333)
    expect(ruleTotal(lines, 'bill', 'amount')).toBe(1_001)
    for (const l of lines)
      expect(l.appliedRules.reduce((s, r) => s + (r.amountPaise ?? 0), 0)).toBe(l.discountPaise)
    expect(total(lines, (l) => l.discountPaise)).toBe(4_334)
  })

  it('a short pack bills and shares only the packed part of each rule', () => {
    const pct = scheme('pct', { rewardKind: 'line_pct', amountPaise: 1_000 })
    const lines = billOrderLine(
      {
        variantId: 'v',
        qtyPcs: 10,
        freeQtyPcs: 0,
        ratePaise: 1_000,
        discountPaise: 1_000,
        appliedRules: [pct],
      },
      [
        { qtyPcs: 4, freeQtyPcs: 0 },
        { qtyPcs: 3, freeQtyPcs: 0 },
      ],
      { gstBps: 1800, cessBps: 0 },
      false,
    )
    expect(total(lines, (l) => l.discountPaise)).toBe(700)
    expect(ruleTotal(lines, 'pct', 'amount')).toBe(700)
  })

  it('the tax of a split line is the order line’s tax to the paisa, across states too', () => {
    // Six batches of one ₹10.50 18 % piece each: per batch the halves would round 94.5 → 95 six times.
    for (const inter of [false, true]) {
      const lines = billOrderLine(
        {
          variantId: 'v',
          qtyPcs: 6,
          freeQtyPcs: 0,
          ratePaise: 1_050,
          discountPaise: 0,
          appliedRules: [],
        },
        Array.from({ length: 6 }, () => ({ qtyPcs: 1, freeQtyPcs: 0 })),
        { gstBps: 1800, cessBps: 0 },
        inter,
      )
      const tax = lineTax(6_300, { gstBps: 1800, cessBps: 0 }, inter)
      expect(total(lines, (l) => l.cgstPaise)).toBe(tax.cgstPaise)
      expect(total(lines, (l) => l.sgstPaise)).toBe(tax.sgstPaise)
      expect(total(lines, (l) => l.igstPaise)).toBe(tax.igstPaise)
      expect(total(lines, (l) => l.lineTotalPaise)).toBe(6_300 + tax.taxPaise)
    }
  })

  it('F04: free pieces follow the batches in proportion, and so does the rule that gave them', () => {
    // 120 Glucose + 10 free (12 + 1) and 5 % off; the pack put all 10 free on the last batch.
    const free = scheme('twelve-plus-one', { rewardKind: 'free_qty', freeQty: 10 })
    const pct = scheme('five', { rewardKind: 'line_pct', amountPaise: 4_464 })
    const picked = [
      { qtyPcs: 48, freeQtyPcs: 0 },
      { qtyPcs: 65, freeQtyPcs: 0 },
      { qtyPcs: 7, freeQtyPcs: 10 },
    ]
    expect(spreadFreePieces(picked)).toEqual([
      { qtyPcs: 44, freeQtyPcs: 4 },
      { qtyPcs: 60, freeQtyPcs: 5 },
      { qtyPcs: 16, freeQtyPcs: 1 },
    ])
    const lines = billOrderLine(
      {
        variantId: 'glucose',
        qtyPcs: 120,
        freeQtyPcs: 10,
        ratePaise: 744,
        discountPaise: 4_464,
        appliedRules: [free, pct],
      },
      picked,
      { gstBps: 500, cessBps: 0 },
      false,
    )
    expect(ruleTotal(lines, 'twelve-plus-one', 'free')).toBe(10)
    expect(lines.map((l) => l.freeQtyPcs)).toEqual([4, 5, 1])
    expect(total(lines, (l) => l.qtyPcs)).toBe(120)
    // Whole pieces cannot make the ratios identical (44/48, 60/65, 16/17), but the last batch is no longer worth
    // 2.4× less a piece (₹7.07 against ₹2.91 before): within 20 paise. The credit note values a returned piece
    // on the ORDER LINE, so it is the same on every batch line (`creditableTaxable` on the group).
    const perPiece = lines.map((l) => l.taxablePaise / (l.qtyPcs + l.freeQtyPcs))
    expect(Math.max(...perPiece) - Math.min(...perPiece)).toBeLessThan(20)
  })

  it('another item’s free pieces stay whole on the trigger (split over its batches), a reward pointer stays as it is', () => {
    const gift = scheme('bottle', { rewardKind: 'free_qty', freeQty: 3, freeVariantId: 'campa' })
    const pointer = scheme('bottle', { reward: true })
    const lines = billOrderLine(
      {
        variantId: 'glucose32',
        qtyPcs: 36,
        freeQtyPcs: 0,
        ratePaise: 500,
        discountPaise: 0,
        appliedRules: [gift],
      },
      [
        { qtyPcs: 24, freeQtyPcs: 0 },
        { qtyPcs: 12, freeQtyPcs: 0 },
      ],
      { gstBps: 1800, cessBps: 0 },
      false,
    )
    expect(ruleTotal(lines, 'bottle', 'free')).toBe(3)
    const reward = billOrderLine(
      {
        variantId: 'campa',
        qtyPcs: 0,
        freeQtyPcs: 3,
        ratePaise: 0,
        discountPaise: 0,
        appliedRules: [pointer],
      },
      [
        { qtyPcs: 0, freeQtyPcs: 2 },
        { qtyPcs: 0, freeQtyPcs: 1 },
      ],
      { gstBps: 2800, cessBps: 1200 },
      false,
    )
    expect(reward.every((l) => l.appliedRules[0]?.batchShare === undefined)).toBe(true)
    expect(total(reward, (l) => l.taxablePaise + l.lineTotalPaise)).toBe(0)
  })

  it('an override above the list rate (a negative rule amount) and a bargain are shared too', () => {
    const override = { ruleId: 'ov', version: 1, kind: 'override' as const, amountPaise: -300 }
    const bargain = { ruleId: 'bg', version: 1, kind: 'bargain' as const, amountPaise: 1_000 }
    const lines = billOrderLine(
      {
        variantId: 'v',
        qtyPcs: 10,
        freeQtyPcs: 0,
        ratePaise: 900,
        discountPaise: 0,
        appliedRules: [override, bargain],
      },
      [
        { qtyPcs: 5, freeQtyPcs: 0 },
        { qtyPcs: 5, freeQtyPcs: 0 },
      ],
      { gstBps: 500, cessBps: 0 },
      false,
    )
    expect(ruleTotal(lines, 'ov', 'amount')).toBe(-300)
    expect(ruleTotal(lines, 'bg', 'amount')).toBe(1_000)
    expect(total(lines, (l) => l.discountPaise)).toBe(0)
  })
})
