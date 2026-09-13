/**
 * Reading every page of a window the service already bounds (DOS-095).
 *
 * The retailer statement asked `receivables.ledger.get` once, took the contract's default page of 50,
 * and printed the WHOLE window's closing balance under it. Measured on a shop with 54 entries in 90
 * days: the list stopped at RCPT-0659 with a running balance of ₹63,535.00 and the closing line said
 * ₹35,843.00 — the four latest payments (₹12,180, ₹5,558, ₹5,511 and ₹4,443) were simply not on it.
 *
 * The fake service below is that statement: 50 entries adding up to ₹63,535.00, then those four
 * receipts, every page carrying the window's own opening and closing figures as `retailerLedger` does.
 */
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from './errors.js'
import { readEveryPage } from './pages.js'

interface Entry {
  refId: string
  amountPaise: number
  balancePaise: number
}

interface StatementPage {
  openingPaise: number
  items: Entry[]
  closingPaise: number
  nextCursor: string | null
}

/** 50 bills of ₹1,270.70 (₹63,535.00 by entry 50), then the four receipts the screen never showed. */
function statement(): Entry[] {
  const amounts = [
    ...Array.from({ length: 50 }, () => 127_070),
    -1_218_000, // RCPT-0668, ₹12,180 UPI, 10 Sep
    -555_800, // RCPT-0672, ₹5,558, 11 Sep
    -551_100, // RCPT-0693, ₹5,511, 12 Sep
    -444_300, // RCPT-0687, ₹4,443, 12 Sep
  ]
  let balance = 0
  return amounts.map((amountPaise, i) => {
    balance += amountPaise
    return { refId: `entry-${String(i + 1).padStart(2, '0')}`, amountPaise, balancePaise: balance }
  })
}

/** A keyset pager over `rows`: the cursor names the first row of the next page. */
function pager(rows: readonly Entry[], pageSize: number) {
  const closingPaise = rows.at(-1)?.balancePaise ?? 0
  return vi.fn(async (cursor: string | undefined): Promise<StatementPage> => {
    await Promise.resolve()
    const start = cursor === undefined ? 0 : Number(cursor)
    const end = Math.min(start + pageSize, rows.length)
    return {
      openingPaise: 0,
      items: rows.slice(start, end),
      closingPaise,
      nextCursor: end < rows.length ? String(end) : null,
    }
  })
}

describe('readEveryPage', () => {
  it('DOS-095: follows nextCursor until it is null and returns every statement entry in order, ending on the closing balance', async () => {
    const rows = statement()
    const fetchPage = pager(rows, 50)

    const read = await readEveryPage(fetchPage, { maxPages: 5 })

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls[0]?.[0]).toBeUndefined()
    expect(fetchPage.mock.calls[1]?.[0]).toBe('50')
    expect(read.items).toHaveLength(54)
    expect(read.items.map((row) => row.refId)).toEqual(rows.map((row) => row.refId))
    expect(read.complete).toBe(true)
    expect(read.pages).toBe(2)
    expect(read.first.openingPaise).toBe(0)
    expect(read.items[49]?.balancePaise).toBe(6_353_500)
    expect(read.last.closingPaise).toBe(3_584_300)
    expect(read.items.at(-1)?.balancePaise).toBe(read.last.closingPaise)
  })

  it('DOS-095: a read capped at maxPages reports complete=false so no closing balance is printed over part of a statement', async () => {
    const fetchPage = pager(statement(), 10)

    const read = await readEveryPage(fetchPage, { maxPages: 5 })

    expect(fetchPage).toHaveBeenCalledTimes(5)
    expect(read.items).toHaveLength(50)
    expect(read.pages).toBe(5)
    expect(read.complete).toBe(false)
    // the service still has a page to give: the balance on the last row read is not the closing one
    expect(read.last.nextCursor).not.toBeNull()
    expect(read.items.at(-1)?.balancePaise).not.toBe(read.last.closingPaise)
  })

  it('DOS-095: a cursor that does not advance ends the read instead of looping', async () => {
    const rows = statement()
    const fetchPage = vi.fn(async (cursor: string | undefined): Promise<StatementPage> => {
      await Promise.resolve()
      return {
        openingPaise: 0,
        items: cursor === undefined ? rows.slice(0, 50) : rows.slice(50),
        closingPaise: 3_584_300,
        nextCursor: 'stuck',
      }
    })

    const read = await readEveryPage(fetchPage, { maxPages: 100 })

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls[1]?.[0]).toBe('stuck')
    expect(read.complete).toBe(false)
    expect(read.pages).toBe(2)
  })

  it('DOS-095: a failed later page rejects the whole read (no partial statement)', async () => {
    const rows = statement()
    const lost = new ApiError({ kind: 'network', message: 'No connection.' })
    const fetchPage = vi.fn(async (cursor: string | undefined): Promise<StatementPage> => {
      await Promise.resolve()
      if (cursor !== undefined) throw lost
      return {
        openingPaise: 0,
        items: rows.slice(0, 50),
        closingPaise: 3_584_300,
        nextCursor: '50',
      }
    })

    await expect(readEveryPage(fetchPage, { maxPages: 5 })).rejects.toBe(lost)
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('DOS-095: a read with no page bound (maxPages < 1) is refused', async () => {
    const fetchPage = pager(statement(), 50)

    await expect(readEveryPage(fetchPage, { maxPages: 0 })).rejects.toThrow(RangeError)
    await expect(readEveryPage(fetchPage, { maxPages: -1 })).rejects.toThrow(RangeError)
    await expect(readEveryPage(fetchPage, { maxPages: 2.5 })).rejects.toThrow(RangeError)
    await expect(readEveryPage(fetchPage, { maxPages: Number.NaN })).rejects.toThrow(RangeError)
    expect(fetchPage).not.toHaveBeenCalled()
  })
})

/**
 * The same helper under the order screens' stock hint (DOS-074 rep, DOS-097 shop).
 *
 * `inventory.stock.availability` answers one row per item that has stock at the godown, 500 to a page, and
 * nothing for an item with none. So a screen may read a missing item as ZERO only after a complete read:
 * the old screens read one 500-row page and told a shop "Stock not known", or a rep "0 cs", for items the
 * godown held by the pallet.
 */
interface StockRow {
  variantId: string
  available: number
}

interface StockPage {
  items: StockRow[]
  nextCursor: string | null
}

/** `count` stocked items, keyed like the service: cursor = the last variant id of the page. */
function godown(count: number): StockRow[] {
  return Array.from({ length: count }, (_, i) => ({
    variantId: `variant-${String(i).padStart(5, '0')}`,
    available: (i % 7) * 24 + 1,
  }))
}

function stockPager(rows: readonly StockRow[], limit: number) {
  return vi.fn(async (cursor: string | undefined): Promise<StockPage> => {
    await Promise.resolve()
    const start = cursor === undefined ? 0 : rows.findIndex((row) => row.variantId === cursor) + 1
    const page = rows.slice(start, start + limit)
    const more = start + limit < rows.length
    return { items: page, nextCursor: more ? (page.at(-1)?.variantId ?? null) : null }
  })
}

describe('readEveryPage under the stock hint', () => {
  it('DOS-074: readEveryPage follows nextCursor to the last page, so every stocked item gets its godown total', async () => {
    const rows = godown(1_203)
    const fetchPage = stockPager(rows, 500)

    const read = await readEveryPage(fetchPage, { maxPages: 20 })

    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(fetchPage.mock.calls.map((call) => call[0])).toEqual([
      undefined,
      'variant-00499',
      'variant-00999',
    ])
    expect(read.complete).toBe(true)
    expect(read.items).toEqual(rows)
    // an item past row 500 (the one the old single read never saw) is on the list with its total
    expect(read.items.find((row) => row.variantId === 'variant-01202')?.available).toBe(
      rows[1_202]?.available,
    )
  })

  it('DOS-097: readEveryPage reports an incomplete read when the page cap or a repeated cursor stops it, so an absent item is not treated as zero', async () => {
    const rows = godown(1_203)

    const capped = await readEveryPage(stockPager(rows, 500), { maxPages: 2 })
    expect(capped.complete).toBe(false)
    expect(capped.items).toHaveLength(1_000)
    // this item HAS stock; it is only missing because the read stopped, which `complete: false` says
    expect(capped.items.some((row) => row.variantId === 'variant-01202')).toBe(false)

    const stuck = vi.fn(async (): Promise<StockPage> => {
      await Promise.resolve()
      return { items: rows.slice(0, 500), nextCursor: 'variant-00499' }
    })
    const looped = await readEveryPage(stuck, { maxPages: 20 })
    expect(stuck).toHaveBeenCalledTimes(2)
    expect(looped.complete).toBe(false)
  })

  it('DOS-097: readEveryPage rejects when any page fails, so a screen never gets a partial stock map', async () => {
    const rows = godown(1_203)
    const lost = new ApiError({ kind: 'network', message: 'No connection.' })
    const fetchPage = vi.fn(async (cursor: string | undefined): Promise<StockPage> => {
      await Promise.resolve()
      if (cursor === 'variant-00999') throw lost
      const start = cursor === undefined ? 0 : 500
      return {
        items: rows.slice(start, start + 500),
        nextCursor: `variant-${String(start + 499).padStart(5, '0')}`,
      }
    })

    await expect(readEveryPage(fetchPage, { maxPages: 20 })).rejects.toBe(lost)
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })
})
