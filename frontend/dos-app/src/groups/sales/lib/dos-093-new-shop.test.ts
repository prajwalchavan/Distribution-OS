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
 * THE ERROR IS BUILT THE WAY THE WIRE BUILDS IT, never by hand. The first version of this test made
 * up `{ status: 404, code: 'behaviour_not_computed' }`, an object the app never produces — the oRPC
 * code at the top level is `NOT_FOUND` and the module's word is inside `data` — so it passed with
 * the branch stone dead. Here the service's own `ORPCError` is serialised with `toJSON()`, sent
 * through `JSON` exactly as a reply is, rebuilt the way `@orpc/client` rebuilds it
 * (`new ORPCError(json.code, { ...json })`, its `createORPCErrorFromJson` verbatim) and normalised
 * by the app's real `toApiError`. What `isNewShop` is handed here is what a rep's phone holds.
 *
 * The owner's shops panel had the opposite failure on the same 404: it printed `?? 0`, so a shop
 * with no history showed "0 days to pay" as if it paid instantly. `lastOrderAt` in the same panel
 * already printed "—"; now the rest of the panel does too. No new owner string key — `—` is already
 * written inline four times in that file.
 *
 * ONE OF THE TWO SCREENS BELOW IS THE OWNER GROUP'S. Since the one-app merge (docs/31 §6.5) it is a
 * sibling directory rather than a sibling project, and this spec READS it as text — `readFileSync`,
 * never an `import` — so the rule that no group reaches into another (§6.4 (a)) is not contradicted
 * by a test that checks the two halves of one finding in one place.
 */
import { ORPCError, toApiError, type ApiError } from '@dos/api-client'
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

/**
 * A service failure as a screen receives it: thrown on the server, serialised, parsed, rebuilt by
 * the client and normalised by `toApiError`. No field is filled in by this test.
 */
function asTheScreenSeesIt(thrown: ORPCError<string, unknown>): ApiError {
  const wire: unknown = JSON.parse(JSON.stringify(thrown.toJSON()))
  const json = wire as { code: string }
  // `createORPCErrorFromJson` in @orpc/client, verbatim.
  const rebuilt = new ORPCError(json.code, { ...(wire as object) })
  return toApiError(rebuilt)
}

/** What `reporting.service.ts:1073` throws for a shop the nightly rollup has not seen yet. */
function behaviourNotComputed(): ORPCError<string, unknown> {
  return new ORPCError('NOT_FOUND', {
    message: 'No behaviour has been computed for this shop yet.',
    data: { code: 'behaviour_not_computed', retailerId: 'r-1' },
  })
}

describe('DOS-093 a shop with no history yet is a new shop, not an error', () => {
  it('DOS-093 reads the service’s real 404 payload as "new shop" and leaves every other failure alone', () => {
    const newShop = asTheScreenSeesIt(behaviourNotComputed())
    // The proof that the first fix was inert: the CODE on the wire is the oRPC one.
    expect(newShop.status).toBe(404)
    expect(newShop.code).toBe('NOT_FOUND')
    expect(isNewShop(newShop)).toBe(true)

    // A 404 from somewhere else is still a 404 the rep should see.
    expect(
      isNewShop(
        asTheScreenSeesIt(
          new ORPCError('NOT_FOUND', {
            message: 'That shop is not here.',
            data: { code: 'retailer_not_found', retailerId: 'r-1' },
          }),
        ),
      ),
    ).toBe(false)
    expect(isNewShop(asTheScreenSeesIt(new ORPCError('NOT_FOUND', { message: 'Gone.' })))).toBe(
      false,
    )
    // And a refusal, a timeout or a server fault are never "new shop".
    expect(
      isNewShop(
        asTheScreenSeesIt(
          new ORPCError('FORBIDDEN', {
            message: 'Not your shop.',
            data: { code: 'behaviour_not_computed', retailerId: 'r-1' },
          }),
        ),
      ),
    ).toBe(false)
    expect(
      isNewShop(
        asTheScreenSeesIt(
          new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'The rollup crashed.',
            data: { code: 'behaviour_not_computed', retailerId: 'r-1' },
          }),
        ),
      ),
    ).toBe(false)
    expect(isNewShop(undefined)).toBe(false)
  })

  it('DOS-093 the sales shop card shows the new-shop line instead of an error panel with Retry', async () => {
    const card = await source('../../../../app/sales/shops/[id].tsx')
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
    const panel = await source('../../../../app/owner/shops/index.tsx')
    const ownerStrings = await source('../../owner/strings.ts')

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
