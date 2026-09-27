import { describe, expect, it } from 'vitest'

import { mergePages, nextCursorOf } from './paging'
import { brandSlices } from './stock'

/** The simulation's day-7 brand split at cost (SQL, `7/sql-dos253-stock-rows.txt`), in paise. */
const DAY7 = [
  { brandId: 'b1', brandName: 'Annapurna', valuePaise: 45_052_719 },
  { brandId: 'b2', brandName: 'Godavari', valuePaise: 39_750_318 },
  { brandId: 'b3', brandName: 'Neelam', valuePaise: 35_824_909 },
  { brandId: 'b4', brandName: 'Campa', valuePaise: 33_796_893 },
  { brandId: 'b5', brandName: 'Sunbake', valuePaise: 27_725_854 },
  { brandId: 'b6', brandName: 'Balaji', valuePaise: 21_000_000 },
  { brandId: 'b7', brandName: 'Too Yumm', valuePaise: 19_808_724 },
  { brandId: null, brandName: null, valuePaise: 10_000_000 },
]
const TOTAL = DAY7.reduce((s, b) => s + b.valuePaise, 0)
describe('QA DOS-253: the stock-by-brand chart adds up to the stock at cost', () => {
  it('hands the chart EVERY brand, largest first, so its segments sum to the total (the kit folds past four into Other)', () => {
    const slices = brandSlices(DAY7, 'No brand')
    expect(slices.map((s) => s.label)).toEqual([
      'Annapurna',
      'Godavari',
      'Neelam',
      'Campa',
      'Sunbake',
      'Balaji',
      'Too Yumm',
      'No brand',
    ])
    expect(slices.reduce((s, x) => s + x.value, 0)).toBe(TOTAL)
    // Campa — the brand the page-built donut left out — is on the chart
    expect(slices.find((s) => s.label === 'Campa')?.value).toBe(33_796_893)
  })

  it('orders by value whatever order the reply came in, names a row with no brand, and drops empty brands', () => {
    const slices = brandSlices(
      [
        { brandId: null, brandName: null, valuePaise: 500 },
        { brandId: 'z', brandName: 'Zed', valuePaise: 0 },
        { brandId: 'a', brandName: 'Alpha', valuePaise: 900 },
      ],
      'No brand',
    )
    expect(slices).toEqual([
      { label: 'Alpha', value: 900 },
      { label: 'No brand', value: 500 },
    ])
  })
})

describe('QA DOS-253: Show more reads the register page by page, never a page as the whole', () => {
  type Row = { lotId: string; locationId: string }
  const key = (r: Row) => `${r.lotId}:${r.locationId}`
  const first = { items: [{ lotId: 'l1', locationId: 'g' }], nextCursor: 'c1' }
  const second = {
    items: [
      { lotId: 'l1', locationId: 'g' },
      { lotId: 'l2', locationId: 'g' },
    ],
    nextCursor: 'c2',
  }
  const last = { items: [{ lotId: 'l3', locationId: 'g' }], nextCursor: null }

  it('appends each page read, once per row, in the order read', () => {
    expect(mergePages(first, [second, last], key).map(key)).toEqual(['l1:g', 'l2:g', 'l3:g'])
    expect(mergePages(undefined, [second], key)).toEqual([])
  })

  it('reads on from the last page, and says nothing follows only when the last page says so', () => {
    expect(nextCursorOf(first, [])).toBe('c1')
    expect(nextCursorOf(first, [second])).toBe('c2')
    expect(nextCursorOf(first, [second, last])).toBeNull()
    expect(nextCursorOf(undefined, [])).toBeNull()
    expect(nextCursorOf({ items: [], nextCursor: '' }, [])).toBeNull()
  })
})
