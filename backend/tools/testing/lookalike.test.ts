import { describe, expect, it } from 'vitest'
import { databaseName, lookalikePlan } from './lookalike.js'

describe('the look-alike plan (invented names, the real distributor shape)', () => {
  const { plan, suppliers } = lookalikePlan({
    slug: 'tarsun',
    ownerUsername: 'owner.tarsun',
    ownerPassword: 'x',
    asOf: '2026-09-29',
  })

  it('has 84 items on 13 HSN headings: 8 without a price, 36 priced at cost, 83 with opening stock', () => {
    expect(plan.items).toHaveLength(84)
    expect(plan.hsnRates).toHaveLength(13)
    expect(plan.items.filter((i) => i.salePaise === null)).toHaveLength(8)
    expect(
      plan.items.filter((i) => i.salePaise !== null && i.salePaise === i.purchaseRatePaise),
    ).toHaveLength(36)
    expect(plan.items.filter((i) => (i.openingQty ?? 0) > 0)).toHaveLength(83)
    expect(new Set(plan.items.map((i) => i.code)).size).toBe(84)
  })

  it('has about 120 shops, a third without a phone, on 15 beats, and opening bills on about 30', () => {
    expect(plan.retailers).toHaveLength(120)
    expect(plan.retailers.filter((r) => r.phone === '')).toHaveLength(40)
    expect(plan.beats).toHaveLength(15)
    expect(new Set(plan.retailers.map((r) => r.beatName)).size).toBe(15)
    expect(new Set(plan.bills.map((b) => b.cashAcc)).size).toBe(30)
    for (const b of plan.bills) {
      expect(b.openPaise).toBeGreaterThan(0)
      expect(b.invoiceDate < '2026-09-29').toBe(true)
    }
    expect(new Set(plan.retailers.map((r) => r.name)).size).toBe(120)
    expect(suppliers).toHaveLength(5)
  })

  it('is the same plan for the same slug, and another for another', () => {
    const again = lookalikePlan({
      slug: 'tarsun',
      ownerUsername: 'o',
      ownerPassword: 'x',
      asOf: '2026-09-29',
    })
    expect(again.plan).toEqual(plan)
    const other = lookalikePlan({
      slug: 'other',
      ownerUsername: 'o',
      ownerPassword: 'x',
      asOf: '2026-09-29',
    })
    expect(other.plan.retailers.map((r) => r.name)).not.toEqual(plan.retailers.map((r) => r.name))
  })

  it('puts the headings under the stem a shared test database gives it', () => {
    const own = lookalikePlan({
      slug: 't',
      ownerUsername: 'o',
      ownerPassword: 'x',
      asOf: '2026-09-29',
      hsnStem: '771234',
    })
    for (const h of own.plan.hsnRates) expect(h.hsn.startsWith('771234')).toBe(true)
  })

  it('reads the database name the builder refuses by', () => {
    expect(databaseName('postgres://dos:dos@127.0.0.1:5439/dos_test_fill')).toBe('dos_test_fill')
    expect(databaseName('postgres://dos:dos@127.0.0.1:5439/dos')).toBe('dos')
    expect(databaseName('not a url')).toBeNull()
  })
})
