/**
 * DOS-102 — a summary the device did not read is never printed as a money figure.
 *
 * WHAT WAS WRONG. `app/index.tsx` printed `formatMoney(across.data?.totalOutstandingPaise ?? 0)`, so
 * for the whole life of a read that never landed — in flight, refused, or 401'd on a token the client
 * would not renew (`libs/api-client/src/auth-retry.test.ts`) — the shop read "You owe ₹0.00 across 3
 * distributors". The same `?? 0` made every card's green "You owe" chip, and `card?.lastBill ===
 * undefined` made every card say "No bills yet", off a read that had answered nothing.
 *
 * HOW IT IS READ. The decision is a pure function, so it is called rather than described. The second
 * test reads the cards as source (since 2026-09-28 they are `./distributors.tsx`, opened from the home) — importing it in Node pulls in `react-native`, which does not
 * resolve outside Metro — to pin that the screen asks the function and no longer carries the `?? 0`.
 */
import { describe, expect, it } from 'vitest'

import { acrossTotal } from './across'

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}
interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

describe('DOS-102 the total owed across distributors', () => {
  it('is a figure only when the read answered', () => {
    expect(acrossTotal({ data: { totalOutstandingPaise: 9_149_400 } })).toEqual({
      kind: 'known',
      totalPaise: 9_149_400,
    })
    // Genuinely nothing owed is still a figure: zero is an ANSWER here, not a fallback.
    expect(acrossTotal({ data: { totalOutstandingPaise: 0 } })).toEqual({
      kind: 'known',
      totalPaise: 0,
    })
  })

  it('is never a figure while the read is in flight, or after it was refused', () => {
    expect(acrossTotal({})).toEqual({ kind: 'reading' })
    expect(acrossTotal({ data: undefined, error: undefined })).toEqual({ kind: 'reading' })
    expect(acrossTotal({ error: new Error('Access token expired.') })).toEqual({ kind: 'unread' })
  })

  it('keeps the figure it has when a REVALIDATION fails — the strip says how old it is', () => {
    expect(
      acrossTotal({
        data: { totalOutstandingPaise: 9_149_400 },
        error: new Error('No connection'),
      }),
    ).toEqual({ kind: 'known', totalPaise: 9_149_400 })
  })
})

/*
 * WHERE THE CARDS ARE NOW. Until 2026-09-28 the distributor cards were the top of the home screen,
 * `app/retailer/index.tsx`, and this guard read that file. The founder's decision of 2026-09-28 made
 * the home a shop front ("a shopping app feel"): the cards moved, unchanged in what they say, into
 * `DistributorList` (`./distributors.tsx`), which the home's distributor chip opens in a sheet and the
 * Me page lists. The rule is the same and so are the assertions; they follow the cards. The home is
 * read as well, so the rule cannot be dodged by printing the summary there again.
 */
describe('DOS-102 the distributor cards ask before they print', () => {
  async function read(path: string): Promise<string> {
    const { readFileSync } = (await import(NODE_FS)) as NodeFs
    const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
    return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  }

  it('reads the total through `acrossTotal` and carries no `?? 0` fallback for the summary', async () => {
    const source = await read('./distributors.tsx')

    expect(source).toContain('acrossTotal(across)')
    expect(source).not.toContain('across.data?.totalOutstandingPaise ?? 0')
    // Nothing on these cards may turn an unanswered summary into a number or a green chip.
    expect(source).not.toMatch(/across\.data\?\.[A-Za-z.]*\s*\?\?\s*0/)
  })

  it('the home prints no summary figure of its own: it opens the cards', async () => {
    const home = await read('../../../../app/retailer/index.tsx')
    expect(home).toContain('<DistributorList')
    expect(home).not.toMatch(/across\.data\?\.[A-Za-z.]*\s*\?\?\s*0/)
    expect(home).not.toContain('totalOutstandingPaise')
  })
})
