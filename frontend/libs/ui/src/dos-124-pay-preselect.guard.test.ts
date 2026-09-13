/**
 * DOS-124: "Pay this bill" → "Start the payment" has to carry the bill it was raised from. Today
 * `dues.tsx` and `bills/[id].tsx` both `router.push('/pay')` with no id, and `pay.tsx` reads no route
 * params, so the Pay screen opens with nothing ticked and the shop's WHOLE dues prefilled — one tap
 * away from minting a payment intent for every bill instead of the one the shop chose.
 *
 * Read as source, the way `document-urls.test.ts` and `parity.test.ts` pin cross-app rules: the
 * retailer app has no test runner of its own to render the three screens together.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const retailerApp = join(here, '..', '..', '..', 'retailer-app', 'app')

function read(path: string): string {
  return readFileSync(join(retailerApp, path), 'utf8')
}

/**
 * The argument of the LAST `router.push(...)` call before a given `testID`, a plain string or a
 * ternary — `dues.tsx` pushes `/pay` from two buttons (its own "Pay everything", which has no one
 * bill to carry, and the QR sheet's "Start the payment", which does), so the guard has to find the
 * one beside the button it is actually about rather than the first `/pay` push in the file.
 */
function pushBefore(source: string, testId: string): string {
  const at = source.indexOf(`testID="${testId}"`)
  expect(at).toBeGreaterThan(-1)
  const calls = [...source.slice(0, at).matchAll(/router\.push\(([\s\S]*?)\)/g)]
  return calls.at(-1)?.[1] ?? ''
}

describe('DOS-124: the Pay screen is opened WITH the bill it was raised from', () => {
  it("dues.tsx's own QR sheet carries the bill id to /pay", () => {
    expect(pushBefore(read('dues.tsx'), 'r3-qr-pay')).toContain('bill=')
  })

  it("the bill detail's Pay button carries the bill id to /pay", () => {
    expect(pushBefore(read('bills/[id].tsx'), 'r4-pay')).toContain('bill=')
  })

  it('pay.tsx reads the bill id from the route and pre-ticks it', () => {
    const source = read('pay.tsx')
    expect(source).toMatch(/useLocalSearchParams<\{[^}]*\bbill\b/)
    expect(source).toMatch(/setChosen\(/)
  })
})
