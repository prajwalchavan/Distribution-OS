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
import { describe, expect, it } from 'vitest'

import { lineFigure, saleFigures } from './van-sale'

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
    roundOffPaise: 3,
    totalPaise: 24800,
  },
}

/** The van-sale screen's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../app/stop/[id]/van-sale.tsx', import.meta.url)),
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
      cashDiscountPaise: 0,
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
