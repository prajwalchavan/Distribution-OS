/**
 * DOS-130 — "Held for this order" was the number of reservation ROWS, not the pieces held.
 *
 * The finding names both order panels: the owner's O5 and this app's M2 ("owner :322, manager :620").
 * The owner half was fixed first; this file is the manager half. SO-0897 held 1 case of Campa Cola
 * 2 L — 24 pieces — spread over five lots, and the panel printed "Held for this order 5". Five is a
 * lot count, and the manager confirming that order reads it as a quantity.
 *
 * `warehouse.reservations.list` answers one PAGE of holds with a cursor (`ReservationsListOutput`),
 * so the pieces cannot be summed off `data.items` alone: an order with more holds than a page would
 * under-report, which on this figure is worse than the count it replaces. `readAllReservations`
 * follows the cursor to the end, and `reservedPcs` sums `qtyPcs` — integer pieces, as everything in
 * this repo is.
 *
 * The helper is this app's own copy of the owner's `src/lib/reservations.ts`: the two apps install
 * separately and neither imports the other's source.
 */
import { describe, expect, it } from 'vitest'

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
 * And the panel prints those pieces. Read as SOURCE, like `dos-010-phone-shop.guard.test.ts`:
 * importing a screen in Node pulls in `react-native` and `expo-router`, which resolve only under
 * Metro.
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

describe('M2 order panel: Held for this order', () => {
  it('DOS-130: the panel states the pieces held, and the lot count only as lots', async () => {
    const code = withoutComments(await readScreen('../../app/orders/index.tsx'))

    // The pieces, summed over every page of holds.
    expect(code).toMatch(/readAllReservations\(/)
    const field = /<Field label=\{t\('m2\.reservations'\)\}>[\s\S]*?<\/Field>/.exec(code)?.[0] ?? ''
    expect(field.length, 'the panel is gone').toBeGreaterThan(0)
    expect(field, 'the panel still prints a bare row count').not.toMatch(/\.length \?\? 0\)\}/)
    expect(field).toMatch(/reservedPcs\(/)
    // The count is still shown — said to be lots, which is what it is.
    expect(field).toMatch(/m2\.reservationsLots/)
  })

  it('DOS-130: nothing on the screen reads the first page of holds alone', async () => {
    const code = withoutComments(await readScreen('../../app/orders/index.tsx'))
    // `data.items` is one page; every reader of the holds must go through the full list.
    expect(code, 'a reader still stops at the first page').not.toMatch(
      /reservations\.data\?\.items/,
    )
  })
})
