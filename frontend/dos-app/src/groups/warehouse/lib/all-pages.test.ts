import { describe, expect, it } from 'vitest'

import { allPages, type Paged } from './all-pages'

/** A server that pages `rows` two at a time, the cursor being the last row read. */
const pager =
  (rows: readonly string[], size = 2) =>
  (cursor: string | null): Promise<Paged<string>> => {
    const from = cursor === null ? 0 : rows.indexOf(cursor) + 1
    const items = rows.slice(from, from + size)
    const last = items[items.length - 1]
    return Promise.resolve({
      items,
      nextCursor: from + size < rows.length && last !== undefined ? last : null,
    })
  }

describe('DOS-234 a van check-in reads every page of what is on the vehicle', () => {
  it('follows the cursor to the end', async () => {
    const lots = ['a', 'b', 'c', 'd', 'e']
    expect(await allPages(pager(lots))).toEqual({ items: lots, complete: true })
  })

  it('a single short page is the whole answer', async () => {
    expect(await allPages(pager(['a']))).toEqual({ items: ['a'], complete: true })
    expect(await allPages(pager([]))).toEqual({ items: [], complete: true })
  })

  it('says so when the ceiling stops it, instead of passing a part off as the whole', async () => {
    const lots = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(await allPages(pager(lots), 2)).toEqual({ items: ['a', 'b', 'c', 'd'], complete: false })
  })

  it('stops on a cursor that does not move', async () => {
    let calls = 0
    const stuck = (): Promise<Paged<string>> => {
      calls += 1
      return Promise.resolve({ items: ['x'], nextCursor: 'x' })
    }
    const answer = await allPages(stuck)
    expect(calls).toBe(2)
    expect(answer.complete).toBe(true)
  })
})
