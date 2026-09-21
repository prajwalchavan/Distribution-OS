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
 * test reads the screen as source — importing it in Node pulls in `react-native`, which does not
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

describe('DOS-102 the home screen asks before it prints', () => {
  it('reads the total through `acrossTotal` and carries no `?? 0` fallback for the summary', async () => {
    const { readFileSync } = (await import(NODE_FS)) as NodeFs
    const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
    const source = readFileSync(
      fileURLToPath(new URL('../../app/index.tsx', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    expect(source).toContain('acrossTotal(across)')
    expect(source).not.toContain('across.data?.totalOutstandingPaise ?? 0')
    // Nothing on this screen may turn an unanswered summary into a number or a green chip.
    expect(source).not.toMatch(/across\.data\?\.[A-Za-z.]*\s*\?\?\s*0/)
  })
})
