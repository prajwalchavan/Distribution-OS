/**
 * DOS-093 — a brand-new shop's card throws a 404 at the rep who just created it.
 *
 * The contract settles what the 404 MEANS: `reporting.retailers.behaviour` answers
 * `behaviour_not_computed` until the nightly rollup has seen the shop, and the app is meant to say
 * "new shop". The service throws it and `reporting.spec.ts` asserts the status, so the 404 in the
 * network log is correct and stays — what was wrong is that the sales `<Async>` shows an ErrorState
 * with a Retry for ANY error, so a rep who added a shop and opened its card got a red panel and a
 * button that could only fail again, on the one screen they open next.
 *
 * The owner's shops panel had the opposite failure on the same 404: it printed `?? 0`, so a shop
 * with no history showed "0 days to pay" as if it paid instantly. `lastOrderAt` in the same panel
 * already printed "—"; now the rest of the panel does too. No new owner string key — `—` is already
 * written inline four times in that file.
 */
import { describe, expect, it } from 'vitest'

import { isNewShop } from './behaviour'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function source(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-093 a shop with no history yet is a new shop, not an error', () => {
  it('DOS-093 reads a 404 behaviour_not_computed as "new shop" and leaves every other failure alone', () => {
    expect(isNewShop({ status: 404, code: 'behaviour_not_computed' })).toBe(true)
    // A 404 from somewhere else is still a 404 the rep should see.
    expect(isNewShop({ status: 404, code: 'retailer_not_found' })).toBe(false)
    expect(isNewShop({ status: 404, code: undefined })).toBe(false)
    // And a refusal, a timeout or a server fault are never "new shop".
    expect(isNewShop({ status: 403, code: 'behaviour_not_computed' })).toBe(false)
    expect(isNewShop({ status: 500, code: 'behaviour_not_computed' })).toBe(false)
    expect(isNewShop(undefined)).toBe(false)
  })

  it('DOS-093 the sales shop card shows the new-shop line instead of an error panel with Retry', async () => {
    const card = await source('../../app/shops/[id].tsx')
    const strings = await source('../strings.ts')

    expect({
      usesHelper: /isNewShop\(behaviour\.error\)/.test(card),
      hasLine: /'s2\.newShop':/.test(strings),
      showsLine: /t\('s2\.newShop'\)/.test(card),
      // The four figures are drawn only when there ARE four figures.
      guardsFigures: /newShop \?[\s\S]{0,400}?<Async/.test(card),
    }).toEqual({ usesHelper: true, hasLine: true, showsLine: true, guardsFigures: true })
  })

  it('DOS-093 the owner shops panel prints an em dash instead of a false zero', async () => {
    const panel = await source('../../../owner-app/app/shops/index.tsx')
    const ownerStrings = await source('../../../owner-app/src/strings.ts')

    expect({
      falseZero: /avgDaysToPay \?\? 0/.test(panel),
      emDash: /avgDaysToPay[\s\S]{0,120}'—'/.test(panel),
      /*
       * No new owner string key — owner `strings.ts` belongs to another group in this batch — so the
       * em dash is the literal this file already writes beside code, phone and GSTIN.
       */
      noNewKey: /t\('o6\.(noBehaviour|newShop|never)/.test(panel),
      ownerKeyAdded: /'o6\.(noBehaviour|newShop|never)'/.test(ownerStrings),
    }).toEqual({ falseZero: false, emDash: true, noNewKey: false, ownerKeyAdded: false })
  })
})
