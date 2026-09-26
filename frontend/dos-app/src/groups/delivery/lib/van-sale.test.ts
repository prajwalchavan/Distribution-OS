/**
 * DOS-171 — at the van door the crew reads the bill's own figure, GST and rounding included.
 *
 * D6 used to print `totals.netPaise` ("Before GST.") under 'Sale total': a 12-piece sale at 12 % GST read
 * Rs 221.40 while the bill it issued was Rs 248.00, and collecting the figure shown left Rs 26.60 due
 * (QA/evidence/batch2/suspects/S-28). `saleFigures` and `lineFigure` are the only readers of the quote's
 * money fields; the figures below are S-28's executed quote, to the paisa.
 *
 * The third case reads the screen's source rather than rendering it, like
 * `manager-app/src/lib/review-desk.test.ts`: importing the screen in Node pulls in `react-native` and
 * `expo-router`, which do not resolve outside Metro. `@types/node` is deliberately absent from an app
 * (`env.d.ts`), so the two Node functions come in through a non-literal specifier and their shapes are
 * named here. Every pattern tolerates whitespace, so `pnpm format` reflowing the JSX cannot turn it red.
 */
import type { Quote } from '@dos/contracts'
import { caseLine, stepByCase } from '@dos/ui'
import { describe, expect, it } from 'vitest'

import {
  amountToTake,
  collectFor,
  lineFigure,
  payNowOf,
  piecesToSell,
  saleFigures,
  takenCheck,
  vanStockByVariant,
} from './van-sale'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

const VARIANT = '01964a3e-0000-7000-8000-000000000171'

/** S-28's `pricing.quote` reply: one line of 12 pc at Rs 18.45 on an HSN at 12 % GST, seller and shop in state 27. */
const S28_QUOTE: Quote = {
  retailerId: '01964a3e-0000-7000-8000-00000000a171',
  pricingDate: '2026-09-14',
  lines: [
    {
      lineId: VARIANT,
      variantId: VARIANT,
      qtyPcs: 12,
      caseSize: 1,
      listRatePaise: 1845,
      ratePaise: 1845,
      grossPaise: 22140,
      discountPaise: 0,
      bargainPaise: 0,
      freeQtyPcs: 0,
      freeItems: [],
      appliedRules: [],
      lineNetPaise: 22140,
      gstBps: 1200,
      // DOS-079 added compensation cess to the quote. S-28's item is an ordinary 12 % HSN with no
      // cess, so both figures are 0 and `taxPaise` below is unchanged — GST alone, to the paisa.
      cessBps: 0,
      cessPaise: 0,
      taxPaise: 2657,
      lineTotalPaise: 24797,
    },
  ],
  orderRules: [],
  cashDiscountBps: 0,
  cashDiscountPaise: 0,
  totals: {
    grossPaise: 22140,
    discountPaise: 0,
    bargainPaise: 0,
    netPaise: 22140,
    taxPaise: 2657,
    cessPaise: 0,
    roundOffPaise: 3,
    totalPaise: 24800,
  },
}

/** The van-sale screen's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../../../app/delivery/stop/[id]/van-sale.tsx', import.meta.url)),
    'utf8',
  )
}

/** Block and line comments removed, so a comment that names a field or a call is not counted. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function testIdAt(code: string, id: string): number {
  return code.search(new RegExp(`testID\\s*=\\s*\\{?\\s*["'\`]${id}["'\`]\\s*\\}?`))
}

describe('van sale figures', () => {
  it("DOS-171 the figure under the van-sale button is the quote's payable total, GST and rounding included", () => {
    const figures = saleFigures(S28_QUOTE)
    expect(figures?.billPaise).toBe(24800)
    expect(figures).toEqual({
      billPaise: 24800,
      beforeGstPaise: 22140,
      gstPaise: 2657,
      roundOffPaise: 3,
    })
    expect(saleFigures(undefined)).toBeNull()
  })

  it('DOS-171 a line shows its GST-inclusive amount', () => {
    expect(lineFigure(S28_QUOTE, VARIANT)).toBe(24797)
    expect(lineFigure(S28_QUOTE, '01964a3e-0000-7000-8000-00000000dead')).toBeNull()
    expect(lineFigure(undefined, VARIANT)).toBeNull()
  })

  it('DOS-171 D6 reads money only through saleFigures and lineFigure and stays on the bill after issue', async () => {
    const code = withoutComments(await readScreen())

    expect.soft(code, 'D6 reads the before-GST net of the quote').not.toMatch(/\bnetPaise\b/)
    expect.soft(code, 'D6 reads the before-GST net of a line').not.toMatch(/\blineNetPaise\b/)
    expect.soft(code, 'D6 reads the quote totals itself').not.toMatch(/\.\s*totals\b/)
    expect.soft(code, 'D6 names a cash discount').not.toMatch(/\bcashDiscount/)
    expect.soft(code, 'D6 does not take its figures from saleFigures').toMatch(/\bsaleFigures\s*\(/)
    expect.soft(code, 'D6 does not take its lines from lineFigure').toMatch(/\blineFigure\s*\(/)
    expect
      .soft(testIdAt(code, 'd6-billed-total'), 'D6 shows no bill after issue')
      .toBeGreaterThan(-1)

    const onSuccessAt = code.search(/\bonSuccess\s*:/)
    const onSuccess = code.slice(onSuccessAt, code.indexOf('onError', onSuccessAt))
    expect.soft(onSuccessAt, 'D6 has no onSuccess').toBeGreaterThan(-1)
    expect.soft(onSuccess, 'D6 leaves the bill the moment it is issued').not.toMatch(/\brouter\b/)
    expect.soft(onSuccess, 'D6 hides the bill in a toast').not.toMatch(/\bsetToast\s*\(/)

    const replaces = [...code.matchAll(/\brouter\s*\.\s*replace\s*\(/g)].map((hit) => hit.index)
    expect.soft(replaces, 'D6 leaves the screen from more than one place').toHaveLength(1)
    const back = testIdAt(code, 'd6-back')
    expect.soft(back, 'D6 has no Back to the stop button').toBeGreaterThan(-1)
    expect
      .soft(replaces[0] ?? -1, 'D6 leaves the bill before the crew taps Back')
      .toBeGreaterThan(back)
  })
})

describe('DOS-233 what the crew may sell is the van less the trip’s bills', () => {
  it('offers only the free pieces, one row per SKU, and never a SKU all of whose pieces belong to a bill', () => {
    const rows = [
      // Bourbon: three lots, one of them wholly the next shop's bill
      { variantId: 'bourbon', variantName: 'Bourbon', availablePcs: 0, expiryDate: '2026-10-01' },
      { variantId: 'bourbon', variantName: 'Bourbon', availablePcs: 24, expiryDate: '2027-01-31' },
      { variantId: 'bourbon', variantName: 'Bourbon', availablePcs: 6, expiryDate: '2026-11-30' },
      // Salted Cracker: everything aboard is billed to another shop
      { variantId: 'cracker', variantName: 'Salted Cracker', availablePcs: 0, expiryDate: null },
      { variantId: 'atta', variantName: 'Atta 10 kg', availablePcs: 3, expiryDate: null },
    ]
    expect(vanStockByVariant(rows)).toEqual([
      { variantId: 'atta', name: 'Atta 10 kg', available: 3, expiry: null, caseSize: 1 },
      { variantId: 'bourbon', name: 'Bourbon', available: 30, expiry: '2026-11-30', caseSize: 1 },
    ])
    expect(vanStockByVariant([])).toEqual([])
  })
})

describe('DOS-239 one case more is one case of THIS item', () => {
  /** Day 4, TRIP-0005: Sunbake Bourbon Cream 120 g, 60 pieces to a case, 60 pieces free on the van. */
  const bourbon = {
    variantId: 'bourbon',
    variantName: 'Sunbake Bourbon Cream 120 g',
    availablePcs: 60,
    expiryDate: '2027-05-20',
    caseSize: 60,
  }

  it("carries the row's sell-side case, and 1 only when the office names none", () => {
    expect(vanStockByVariant([bourbon])[0]?.caseSize).toBe(60)
    expect(vanStockByVariant([{ ...bourbon, caseSize: null }])[0]?.caseSize).toBe(1)
    // a lot with no case first, one with the case after: the SKU still steps by its case
    expect(
      vanStockByVariant([{ ...bourbon, caseSize: null, availablePcs: 6 }, bourbon])[0],
    ).toMatchObject({ available: 66, caseSize: 60 })
  })

  it('a case step on the stepper is 60 pieces, and nothing goes past what is free on the van', () => {
    const row = vanStockByVariant([bourbon])[0]
    expect(row).toBeDefined()
    const one = stepByCase(0, 1, row?.caseSize ?? 0)
    expect(one).toBe(60)
    expect(caseLine(one, row?.caseSize ?? 0)).toBe('1 cs = 60 pc')
    expect(piecesToSell(stepByCase(one, 1, row?.caseSize ?? 0), row?.available ?? 0)).toBe(60)
    expect(piecesToSell(12, 60)).toBe(12)
    expect(piecesToSell(-3, 60)).toBe(0)
  })

  it('the screen hands the stepper and the draft the row case, never a case of one', async () => {
    const code = withoutComments(await readScreen())
    expect
      .soft(code, 'D6 steps by a case of one')
      .not.toMatch(/caseSize\s*[:=]\s*\{?\s*1\s*\}?\s*[,\n}]/)
    expect
      .soft(code, "D6 does not give the stepper the row's case")
      .toMatch(/caseSize=\{\s*row\.caseSize\s*\}/)
    expect.soft(code, 'D6 offers no loose-pieces pad').toMatch(/onOpenPieces=/)
  })
})

describe('DOS-240 a van sale paid at the door', () => {
  it('asks the crew to type what it took: cash may carry change, UPI is the bill exactly, short is credit', () => {
    expect(takenCheck('account', null, 106200)).toEqual({ problem: null, changePaise: 0 })
    expect(takenCheck('cash', null, 106200).problem).toBe('enter')
    expect(takenCheck('cash', 100000, 106200).problem).toBe('short')
    expect(takenCheck('cash', 106200, 106200)).toEqual({ problem: null, changePaise: 0 })
    expect(takenCheck('cash', 110000, 106200)).toEqual({ problem: null, changePaise: 3800 })
    expect(takenCheck('upi', 110000, 106200).problem).toBe('upiExact')
    expect(takenCheck('upi', 106200, 106200).problem).toBeNull()
  })

  it('receipts the bill, never the change, and sends nothing for a sale on account', () => {
    const ids = { id: 'c1', receiptId: 'r1' }
    expect(collectFor('account', 106200, '', ids)).toBeUndefined()
    expect(collectFor('cash', null, '', ids)).toBeUndefined()
    expect(collectFor('cash', 106200, 'ignored', ids)).toEqual({
      id: 'c1',
      receiptId: 'r1',
      mode: 'cash',
      amountPaise: 106200,
    })
    expect(collectFor('upi', 106200, ' 626926200501 ', ids)).toEqual({
      id: 'c1',
      receiptId: 'r1',
      mode: 'upi',
      amountPaise: 106200,
      reference: '626926200501',
    })
  })

  it("takes the office's figure when the bill it issues is more than the quote", () => {
    expect(amountToTake(106200, null)).toBe(106200)
    expect(amountToTake(106200, 106300)).toBe(106300)
    expect(amountToTake(106200, 100)).toBe(106200)
    expect(amountToTake(null, 106300)).toBeNull()
    expect(payNowOf({ code: 'approval_required', payNowPaise: 106200 })).toBe(106200)
    expect(payNowOf({ code: 'approval_required' })).toBeNull()
    expect(payNowOf(undefined)).toBeNull()
  })

  it('the screen sends the collect with the sale and never pre-fills the money', async () => {
    const code = withoutComments(await readScreen())
    expect.soft(code, 'D6 sends no collect').toMatch(/collectFor\s*\(/)
    expect.soft(code, 'D6 has no way to pay').toMatch(/testID="d6-pay-mode"/)
    // the typed money starts empty and is never set from the bill
    expect.soft(code, 'D6 pre-fills the money').not.toMatch(/setTakenPaise\(\s*toTake\s*\)/)
    expect.soft(code, 'D6 pre-fills the money').toMatch(/useState<number \| null>\(null\)/)
  })
})
