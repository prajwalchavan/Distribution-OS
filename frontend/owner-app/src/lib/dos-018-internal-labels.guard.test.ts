/**
 * DOS-018 — the owner's screens carry no internal labels.
 *
 * Three of the leaks the walkthrough found are this app's own (the rest are the seed's trip numbers,
 * the scheme-spend register's rule kinds and the owner summary's trip count, each proved where it is
 * built):
 *
 *   · the order panel printed `order.paymentTerms` raw, so a credit customer's terms read
 *     "POST_FULFILLMENT" — the app already has the trade's word for it (`word.POST_FULFILLMENT` =
 *     "Credit") and the shops register already goes through `useWord`;
 *   · the trips register headed the opening cash "Amount ₹", which reads as what the trip collected;
 *     it is the float handed to the crew at the start and is the same 5 000.00 on every trip;
 *   · the stock-turns axis printed every tick to ONE decimal, so a slow month's ticks (0, 0.05, 0.1,
 *     0.15) all read "0.1×" — the same number four times up the side of a chart.
 *
 * Read as SOURCE, like `settings-views.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('DOS-018 no internal label reaches the owner', () => {
  it('DOS-018: the order panel prints the trade word for the payment terms, not the enum', async () => {
    const screen = await read('../../app/orders/index.tsx')
    const catalogue: Readonly<Record<string, string>> = strings

    expect({
      raw: /\{order\.paymentTerms\}/.test(screen),
      worded: /\{word\(order\.paymentTerms\)\}/.test(screen),
      hasWord: catalogue['word.POST_FULFILLMENT'],
    }).toEqual({ raw: false, worded: true, hasWord: 'Credit' })
  })

  it('DOS-018: the trips register calls the opening cash what it is', async () => {
    const screen = await read('../../app/orders/trips.tsx')
    const catalogue: Readonly<Record<string, string>> = strings

    expect({
      // "Amount ₹" against a column that is the same float on every trip says the trip collected it.
      amount: /moneyColumn\('opening',\s*t\('o11\.amount'\)/.test(screen),
      opening: /moneyColumn\('opening',\s*t\('o18\.openingCash'\)/.test(screen),
      wording: catalogue['o18.openingCash'],
    }).toEqual({
      amount: false,
      opening: true,
      wording: 'Opening cash ₹',
    })
  })

  it('DOS-018: the stock-turns axis prints ticks that differ, not "0.1×" four times', async () => {
    const screen = await read('../../app/reports/index.tsx')

    expect(/toFixed\(1\)/.test(screen)).toBe(false)
    expect(/import \{ turnsLabel \} from '[^']*lib\/turns'/.test(screen)).toBe(true)
    expect(/formatValue=\{turnsLabel\}/.test(screen)).toBe(true)

    // The axis of a slow month, straight out of `niceTicks(0.2)`: four ticks, four different labels.
    const { turnsLabel } = await import('./turns')
    expect([0, 0.05, 0.1, 0.15, 0.2].map(turnsLabel)).toEqual([
      '0×',
      '0.05×',
      '0.1×',
      '0.15×',
      '0.2×',
    ])
    expect([0.89, 1, 2.5].map(turnsLabel)).toEqual(['0.89×', '1×', '2.5×'])
  })
})
