/**
 * UX-O-1 … UX-O-7 — what the owner's screens must keep saying (the owner UX review, 2026-09-27).
 *
 * The arithmetic is proven in `owner-ux.test.ts`; this file reads the SCREENS as source, like
 * `dos-015-rebuild-ageing.guard.test.ts`, so a later edit cannot quietly drop a link, a filter or a line.
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

const catalogue: Readonly<Record<string, string>> = strings

describe('owner UX review fixes, as the screens are written', () => {
  it('UX-O-1: the home draws the flow strip under the page tabs, above the KPI strip', async () => {
    const home = await read('../../../../app/owner/index.tsx')
    expect(home.indexOf('<FlowStrip')).toBeGreaterThan(home.indexOf('<PageTabs'))
    expect(home.indexOf('<FlowStrip')).toBeLessThan(home.indexOf('<KpiStrip'))
    // every step reads a procedure the owner already holds
    for (const read of [
      'orders.list({ from: now, to: now',
      "orders.list({ state: 'packed'",
      "orders.list({ state: 'dispatched'",
      "delivery.trips.list({ state: 'active'",
      'reporting.registers.collections({ from: now, to: now',
      "receivables.receipts.list({ status: 'deposited', from: now, to: now",
      'billing.invoices.list({ from: now, to: now',
    ])
      expect(home, read).toContain(read)
  })

  it('UX-O-1: the receiving registers take the parameters the strip links with', async () => {
    const orders = await read('../../../../app/owner/orders/index.tsx')
    expect(orders).toMatch(
      /useLocalSearchParams<\{ q\?: string; state\?: string; range\?: string \}>/,
    )
    expect(orders).toMatch(/params\.range === 'all'/)
    const billing = await read('../../../../app/owner/billing/index.tsx')
    expect(billing).toMatch(/rangeParam\(params\.range, 'd30'\)/)
    const receipts = await read('../../../../app/owner/money/receipts.tsx')
    expect(receipts).toMatch(/rangeParam\(params\.range, 'd30'\)/)
    expect(receipts).toMatch(/params\.status === 'deposited'/)
    for (const screen of [orders, billing, receipts])
      expect(screen).toMatch(/<RangeSegments[\s\S]{0,300}?\n\s*today\n/)
  })

  it('UX-O-2: an expired lot reads Expired in brick, with a filter, and the home counts them', async () => {
    const stock = await read('../../../../app/owner/stock/index.tsx')
    expect(stock).toMatch(/isExpired\(row\.expiryDate, now\)/)
    expect(stock).toMatch(/expiringBefore: shiftDays\(now, -1\)/)
    expect(stock).toMatch(/id: 'expired', label: t\('o15\.expired'\)/)
    const home = await read('../../../../app/owner/index.tsx')
    expect(home).toMatch(/go\.push\('\/stock\?filter=expired'\)/)
    expect(catalogue['o1.expired']).toBe('Expired, still in the godown')
  })

  it('UX-O-3: each KPI tile opens its register; trips and failed stops are said', async () => {
    const home = await read('../../../../app/owner/index.tsx')
    for (const route of [
      "'/billing?range=today'",
      "'/money/receipts?range=today'",
      "'/money'",
      "'/orders?range=today'",
    ])
      expect(home, route).toContain(`go.push(${route})`)
    expect(home).toMatch(/todayFailedStops/)
    expect(home).toMatch(/tone: tripStuck \? 'attention'/)
    expect(catalogue['o1.tripOnRoad']).toBe('1 trip on the road · since {since}')
    expect(catalogue['o1.deliveredFailed']).toBe('{delivered} delivered · {failed} failed')
  })

  it('UX-O-4: this month is compared with the same days of last month, not series.growth', async () => {
    const home = await read('../../../../app/owner/index.tsx')
    expect(home).toMatch(/monthCompare\(monthSeries\.data\.points, now\)/)
    expect(home).not.toMatch(/series\.growth/)
  })

  it('UX-O-6: Shop by shop opens on the shops that owe; the ladder still reads them all', async () => {
    const money = await read('../../../../app/owner/money/index.tsx')
    expect(money).toMatch(/minOutstandingPaise: 1/)
    expect(money).toMatch(/const register = showAll \? list : owing/)
    expect(money).toMatch(/row\.unallocatedCreditPaise/)
    // Rebuild ageing sits behind More, and the date switch belongs to the history chart
    expect(money).toMatch(/<MoreActions[\s\S]*?money-rebuild[\s\S]*?<\/MoreActions>/)
    expect(money).toMatch(/testID="money-history-range"/)
  })

  it('UX-O-7: a bill in the shop panel names its dates; the panel names the phone and last payment', async () => {
    const money = await read('../../../../app/owner/money/index.tsx')
    expect(money).toMatch(/secondary=\{billLine\(bill\)\}/)
    expect(money).toMatch(/money-shop-phone/)
    expect(money).toMatch(/lastReceiptAt/)
    expect(catalogue['o10.leftOf']).toBe('{left} left of {total}')
  })
})
