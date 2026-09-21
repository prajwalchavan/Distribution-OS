/**
 * DOS-130 — "Stock held" was the number of reservation ROWS, not the pieces held.
 *
 * SO-0897 held 1 case of Campa Cola 2 L — 24 pieces — spread over five lots, and the owner's order
 * panel printed "Stock held 5". Five is a lot count; the owner reads it as a quantity when checking
 * what a confirmed order has taken out of stock.
 *
 * `warehouse.reservations.list` answers one PAGE of holds with a cursor (`ReservationsListOutput`),
 * so the pieces cannot be summed off `data.items` alone: an order with more holds than a page would
 * under-report, which on this figure is worse than the count it replaces. `readAllReservations`
 * follows the cursor to the end, and `reservedPcs` sums `qtyPcs` — integer pieces, as everything in
 * this repo is.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { readAllReservations, reservedPcs, type CursorPage } from './reservations'

interface Hold {
  id: string
  qtyPcs: number
}

/** A server that answers the given pages in order, remembering which cursor it was asked for. */
function server(pages: readonly (readonly Hold[])[]): {
  fetchPage: (cursor: string | null) => Promise<CursorPage<Hold>>
  asked: string[]
} {
  const asked: string[] = []
  return {
    asked,
    fetchPage: (cursor) => {
      asked.push(cursor ?? 'first')
      const index = cursor === null ? 0 : Number(cursor)
      const items = pages[index] ?? []
      const next = index + 1 < pages.length ? String(index + 1) : null
      return Promise.resolve({ items, nextCursor: next })
    },
  }
}

describe('reservedPcs', () => {
  it('DOS-130: the pieces held are the sum of the holds, not how many there are', () => {
    // One case of 24 spread over five lots: five is the row count the panel used to print.
    const holds: Hold[] = [
      { id: 'a', qtyPcs: 6 },
      { id: 'b', qtyPcs: 6 },
      { id: 'c', qtyPcs: 6 },
      { id: 'd', qtyPcs: 4 },
      { id: 'e', qtyPcs: 2 },
    ]
    expect(holds).toHaveLength(5)
    expect(reservedPcs(holds)).toBe(24)
  })

  it('DOS-130: nothing held is zero pieces', () => {
    expect(reservedPcs([])).toBe(0)
  })
})

describe('readAllReservations', () => {
  it('DOS-130: the pieces are summed across every page, not just the first', async () => {
    const { fetchPage, asked } = server([
      [
        { id: 'a', qtyPcs: 6 },
        { id: 'b', qtyPcs: 6 },
      ],
      [
        { id: 'c', qtyPcs: 6 },
        { id: 'd', qtyPcs: 4 },
      ],
      [{ id: 'e', qtyPcs: 2 }],
    ])
    const holds = await readAllReservations(fetchPage)
    expect(holds).toHaveLength(5)
    expect(reservedPcs(holds)).toBe(24)
    expect(asked).toEqual(['first', '1', '2'])
  })

  it('DOS-130: one page with no cursor is one request', async () => {
    const { fetchPage, asked } = server([[{ id: 'a', qtyPcs: 24 }]])
    expect(reservedPcs(await readAllReservations(fetchPage))).toBe(24)
    expect(asked).toEqual(['first'])
  })

  it('DOS-130: a server that keeps handing back the same cursor is cut off, never looped on', async () => {
    let calls = 0
    const holds = await readAllReservations<Hold>(() => {
      calls += 1
      return Promise.resolve({ items: [{ id: String(calls), qtyPcs: 1 }], nextCursor: 'same' })
    }, 3)
    expect(calls).toBe(3)
    expect(holds).toHaveLength(3)
  })
})

/**
 * And the panel prints those pieces. Read as SOURCE, like `dos-012-refusal.guard.test.ts`: importing
 * a screen in Node pulls in `react-native` and `expo-router`, which resolve only under Metro.
 */
interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function readScreen(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('O5 order panel: Stock held', () => {
  it('DOS-130: the panel states the pieces held, and the lot count only as lots', async () => {
    const code = withoutComments(await readScreen('../../../../app/owner/orders/index.tsx'))

    // The pieces, summed over every page of holds.
    expect(code).toMatch(/readAllReservations\(/)
    const panel = /<Panel title=\{t\('o5\.reservations'\)\}>[\s\S]*?<\/Panel>/.exec(code)?.[0] ?? ''
    expect(panel.length, 'the panel is gone').toBeGreaterThan(0)
    expect(panel, 'the panel still prints a bare row count').not.toMatch(/\.length \?\? 0\)\}/)
    expect(panel).toMatch(/reservedPcs\(/)
    // The count is still shown — said to be lots, which is what it is.
    expect(panel).toMatch(/o5\.reservationsLots/)
    // ...and ONE hold is said to be one lot: the panel carries both lines and picks by the count.
    expect(panel, 'the panel has no singular line to pick').toMatch(/o5\.reservationsLot['"]/)
    expect(panel, 'nothing chooses between the two lines').toMatch(/===\s*1\s*\?/)
  })
})

/**
 * Merge-review blocker, 2026-09-20 — "across 1 lots".
 *
 * `interpolate` (`ui/src/strings.ts`) is a plain `{name}` substitution: there is no plural form
 * anywhere in this repo, deliberately, because Hindi and Marathi do not share English's one-or-many
 * rule. A count that can be 1 therefore needs two keys and a screen that picks between them — the
 * shape `retailer-app/app/order.tsx` already uses for `r7.linesOne` / `r7.lines`.
 *
 * One lot is the COMMON case, not the edge: most confirmed orders are picked out of a single lot,
 * so "across 1 lots" is the first thing a walker reads on the first panel they open.
 */
describe('O5 "Stock held": the lot line reads as English at any count', () => {
  const catalog: Readonly<Record<string, string>> = strings

  it('DOS-130: one hold is "across 1 lot", never "across 1 lots"', () => {
    const singular = catalog['o5.reservationsLot']
    expect(singular, 'there is no singular key').toBeDefined()
    expect(singular).toBe('across 1 lot')
    // It states the one itself, so nothing is substituted into it and no placeholder may survive.
    expect(singular).not.toMatch(/\{/)
    expect(singular).not.toMatch(/lots/)
  })

  it('DOS-130: the many-line still carries the count it is counting', () => {
    const plural = catalog['o5.reservationsLots']
    expect(plural).toMatch(/\{count\}/)
    expect(plural).toMatch(/lots/)
  })
})
