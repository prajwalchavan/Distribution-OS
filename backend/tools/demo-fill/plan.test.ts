import { describe, expect, it } from 'vitest'
import { demoId, isDemoId } from './ids.js'
import {
  ON_ACCOUNT_DOOR,
  SLOT_DOORS,
  TRIP_DOORS,
  VAN_LOAD_DOORS,
  chooseCreditShop,
  chooseLines,
  chooseRepBeats,
  chooseSlotShops,
  creditLimitFor,
  offerShops,
  offerStep,
  planCounts,
  planDay,
  quantityFor,
  slotShopsOnVans,
  stockBudget,
  type ItemInfo,
  type PlanInput,
  type ShopInfo,
} from './plan.js'

const TENANT = '01a0eb1e-3c50-74e3-8bdb-c81a7fd0d498'
/** An offer the tool made (its id carries the tool's tag). */
const toolId = demoId(TENANT, '2026-09-20', 'offer', 'v1')
const id = (prefix: string, n: number): string =>
  `${prefix}${String(n).padStart(4, '0')}-0000-7000-8000-000000000000`

function shop(n: number, over: Partial<ShopInfo> = {}): ShopInfo {
  return {
    id: id('5', n),
    beatId: id('b', n % 5),
    active: true,
    hasLogin: false,
    hasPhone: n % 3 !== 2,
    creditMode: 'indicate',
    creditLimitPaise: 0,
    paymentTerms: 'POST_FULFILLMENT',
    outstandingPaise: n % 4 === 1 ? 50_000 + n * 1_000 : 0,
    foreignOnAccountPaise: 0,
    // What a shop owes is on its opening bills (none of the tool's yet).
    foreignOpenPaise: n % 4 === 1 ? 50_000 + n * 1_000 : 0,
    writtenOff: false,
    ...over,
  }
}

function item(n: number, over: Partial<ItemInfo> = {}): ItemInfo {
  return {
    variantId: id('a', n),
    ratePaise: n % 10 === 9 ? 0 : 1_000 + n * 50,
    available: n % 13 === 12 ? 0 : 200 + n,
    minOrderQty: 1,
    orderIncrement: 1,
    maxPerOrder: null,
    costPaise: 900 + n * 40,
    mrpPaise: 1_500 + n * 60,
    gstBps: 500,
    hsnCode: '88110001',
    ...over,
  }
}

const SHOPS = Array.from({ length: 60 }, (_, n) => shop(n))
const ITEMS = Array.from({ length: 40 }, (_, n) => item(n))
const BEATS = Array.from({ length: 5 }, (_, n) => id('b', n))
const beat = (n: number): string => BEATS[n] ?? ''

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    tenantId: TENANT,
    date: '2026-09-29',
    shops: SHOPS,
    items: ITEMS,
    repBeats: { sales1: beat(1), sales2: beat(2) },
    creditShops: { sales1: id('5', 1), sales2: id('5', 2) },
    slotShops: [id('5', 10), id('5', 20), id('5', 30)],
    carried: [],
    ...over,
  }
}

describe('quantities a kirana shop would order', () => {
  it('asks for 2 to 12 pieces, on the item own order rules', () => {
    for (let n = 0; n < 200; n++) {
      const q = quantityFor(`q:${String(n)}`, item(1))
      expect(q).toBeGreaterThanOrEqual(2)
      expect(q).toBeLessThanOrEqual(12)
    }
    expect(quantityFor('q', item(1, { minOrderQty: 24 }))).toBe(24)
    expect(quantityFor('q', item(1, { orderIncrement: 6 })) % 6).toBe(0)
    expect(quantityFor('q', item(1, { maxPerOrder: 1 }))).toBe(1)
  })

  it('keeps a reserve of every item for real orders', () => {
    const budget = stockBudget([item(1, { available: 3 }), item(2, { available: 200 })])
    expect(budget.get(id('a', 1))).toBe(0)
    expect(budget.get(id('a', 2))).toBe(180)
  })
})

describe('the lines of an order', () => {
  it('never picks an item without a price or without stock, and spends the budget it takes', () => {
    const budget = stockBudget(ITEMS)
    const before = [...budget.values()].reduce((a, b) => a + b, 0)
    for (let n = 0; n < 30; n++) {
      const lines = chooseLines(`o:${String(n)}`, (k) => `line-${String(k)}`, ITEMS, budget)
      expect(lines.length).toBeGreaterThanOrEqual(2)
      expect(lines.length).toBeLessThanOrEqual(4)
      for (const l of lines) {
        const it = ITEMS.find((i) => i.variantId === l.variantId)
        expect(it?.ratePaise).toBeGreaterThan(0)
        expect(it?.available).toBeGreaterThan(0)
      }
      expect(new Set(lines.map((l) => l.variantId)).size).toBe(lines.length)
    }
    const after = [...budget.values()].reduce((a, b) => a + b, 0)
    expect(after).toBeLessThan(before)
    expect([...budget.values()].every((v) => v >= 0)).toBe(true)
  })

  it('gives no line at all when nothing is priced and in stock', () => {
    const none = ITEMS.map((i) => ({ ...i, ratePaise: 0 }))
    expect(chooseLines('o', (k) => String(k), none, stockBudget(none))).toEqual([])
  })
})

describe('the standing choices', () => {
  it('walks the beats with enough shops that owe money, and keeps a beat once given', () => {
    const chosen = chooseRepBeats(SHOPS, BEATS, {})
    expect(chosen.sales1).toBeDefined()
    expect(chosen.sales2).toBeDefined()
    expect(chosen.sales1).not.toBe(chosen.sales2)
    expect(chooseRepBeats(SHOPS, BEATS, { sales1: beat(4) }).sales1).toBe(beat(4))
  })

  it('puts over its limit the shop that owes most, or keeps one already over a strict limit', () => {
    const onThis = beat(1)
    const most = chooseCreditShop(SHOPS, onThis, new Set())
    const onBeat = SHOPS.filter((s) => s.beatId === onThis && s.outstandingPaise > 0)
    expect(most?.outstandingPaise).toBe(Math.max(...onBeat.map((s) => s.outstandingPaise)))
    const strict = SHOPS.map((s) =>
      s.id === id('5', 6)
        ? { ...s, creditMode: 'strict', creditLimitPaise: 1_000, outstandingPaise: 9_000 }
        : s,
    )
    expect(chooseCreditShop(strict, onThis, new Set())?.id).toBe(id('5', 6))
    expect(chooseCreditShop(SHOPS, onThis, new Set([most?.id ?? '']))?.id).not.toBe(most?.id)
    expect(chooseCreditShop(SHOPS, undefined, new Set())).toBeNull()
  })

  it('never makes a shop the product would not hold the credit shop: stopped, pay on delivery, money on account', () => {
    const onThis = beat(1)
    const most = chooseCreditShop(SHOPS, onThis, new Set())
    for (const change of [
      { creditMode: 'stop' },
      { paymentTerms: 'ON' },
      { foreignOnAccountPaise: 5_000 },
    ] as Partial<ShopInfo>[]) {
      const changed = SHOPS.map((s) => (s.id === most?.id ? { ...s, ...change } : s))
      expect(chooseCreditShop(changed, onThis, new Set())?.id, JSON.stringify(change)).not.toBe(
        most?.id,
      )
    }
    // A shop already over a limit it was put on is kept only while that limit is strict (stop takes no order).
    const stopped = SHOPS.map((s) =>
      s.id === id('5', 6)
        ? { ...s, creditMode: 'stop', creditLimitPaise: 1_000, outstandingPaise: 9_000 }
        : s,
    )
    expect(chooseCreditShop(stopped, onThis, new Set())?.id).not.toBe(id('5', 6))
  })

  it('never stands in a shop that holds real money on account or has credit stopped', () => {
    const three = chooseSlotShops(TENANT, SHOPS, new Set())
    const [a, b] = three
    const changed = SHOPS.map((s) =>
      s.id === a
        ? { ...s, foreignOnAccountPaise: 10_000 }
        : s.id === b
          ? { ...s, creditMode: 'stop' }
          : s,
    )
    const now = chooseSlotShops(TENANT, changed, new Set())
    expect(now).toHaveLength(3)
    expect(now).not.toContain(a)
    expect(now).not.toContain(b)
  })

  it('sets a strict limit at half the dues in whole hundreds of rupees, at least one hundred', () => {
    expect(creditLimitFor(1_00_000)).toBe(50_000)
    expect(creditLimitFor(1_23_456)).toBe(60_000)
    expect(creditLimitFor(500)).toBe(10_000)
  })

  it('stands three shops without a login in for the shopkeepers, the same three every day', () => {
    const three = chooseSlotShops(TENANT, SHOPS, new Set([id('5', 1)]))
    expect(three).toHaveLength(3)
    expect(chooseSlotShops(TENANT, SHOPS, new Set([id('5', 1)]))).toEqual(three)
    expect(three).not.toContain(id('5', 1))
    for (const s of three) expect(SHOPS.find((x) => x.id === s)?.hasPhone).toBe(true)
    const withLogin = SHOPS.map((s) => (three.includes(s.id) ? { ...s, hasLogin: true } : s))
    for (const s of chooseSlotShops(TENANT, withLogin, new Set())) expect(three).not.toContain(s)
  })

  it("moves the tool's offer to the shop that replaces a closed stand-in shop", () => {
    const three = chooseSlotShops(TENANT, SHOPS, new Set())
    const closed = SHOPS.map((s) => (s.id === three[0] ? { ...s, active: false } : s))
    const now = chooseSlotShops(TENANT, closed, new Set())
    expect(now).not.toContain(three[0])
    expect(now.filter((s) => three.includes(s))).toHaveLength(2)
    const offer = { id: toolId, retailerIds: three }
    // The offer made for yesterday's three is live, and today's three are not the same shops: moved.
    expect(offerStep([offer], now, isDemoId)).toEqual({ kind: 'move', id: toolId })
    // Once moved (in any order), it is kept.
    expect(offerStep([{ ...offer, retailerIds: [...now].reverse() }], now, isDemoId)).toEqual({
      kind: 'keep',
      id: toolId,
    })
  })

  it("keeps the offer on a replaced shop the day's vans still carry, until that day is over", () => {
    const three = chooseSlotShops(TENANT, SHOPS, new Set())
    const closed = SHOPS.map((s) => (s.id === three[0] ? { ...s, active: false } : s))
    const now = chooseSlotShops(TENANT, closed, new Set())
    // Today's vans were loaded with yesterday's three at the stand-in doors (and other shops elsewhere).
    const doors = (driver: 'driver1' | 'driver2') =>
      Array.from({ length: 8 }, (_, i) => {
        const slot = SLOT_DOORS.find(
          (d) =>
            (d.delivered[0] === driver && d.delivered[1] === i) ||
            (d.onTheWay[0] === driver && d.onTheWay[1] === i),
        )
        return { sequence: i + 1, retailerId: slot ? (three[slot.slot] ?? '') : id('7', i) }
      })
    const onVans = slotShopsOnVans({ driver1: doors('driver1'), driver2: doors('driver2') })
    expect(onVans).toEqual([...three].sort())
    const today = offerShops(now, onVans)
    expect(today).toEqual([...new Set([...three, ...now])].sort())
    expect(today).toHaveLength(4)
    const offer = { id: toolId, retailerIds: three }
    expect(offerStep([offer], today, isDemoId)).toEqual({ kind: 'move', id: toolId })
    // The next day has no van yet: the offer is for the new three only.
    expect(slotShopsOnVans({ driver1: null })).toEqual([])
    expect(offerShops(now, [])).toEqual([...now].sort())
    expect(offerStep([{ ...offer, retailerIds: today }], offerShops(now, []), isDemoId)).toEqual({
      kind: 'move',
      id: toolId,
    })
  })

  it("makes an offer when none of the tool's is live, and never one for every shop", () => {
    const real = { id: id('9', 1), retailerIds: undefined }
    const three = chooseSlotShops(TENANT, SHOPS, new Set())
    expect(offerStep([real], three, isDemoId)).toEqual({ kind: 'make' })
    expect(offerStep([], three, isDemoId)).toEqual({ kind: 'make' })
    // No shop can stand in: nothing is made or moved (an offer naming no shop is for every shop).
    expect(offerStep([], [], isDemoId)).toEqual({ kind: 'none' })
    expect(offerStep([{ id: toolId, retailerIds: three }], [], isDemoId)).toEqual({ kind: 'none' })
  })
})

describe('the plan of a day', () => {
  it('is the same plan for the same date and the same distributor', () => {
    expect(planDay(input())).toEqual(planDay(input()))
    expect(planDay(input({ date: '2026-09-30' })).orders.map((o) => o.id)).not.toEqual(
      planDay(input()).orders.map((o) => o.id),
    )
  })

  it('makes about 25 orders of marked ids, two vans of eight doors, and small quantities', () => {
    const plan = planDay(input())
    expect(plan.orders.length).toBeGreaterThanOrEqual(20)
    expect(plan.orders.length).toBeLessThanOrEqual(26)
    for (const o of plan.orders) {
      expect(isDemoId(o.id)).toBe(true)
      for (const l of o.lines) {
        expect(isDemoId(l.id)).toBe(true)
        expect(l.qty).toBeLessThanOrEqual(12)
      }
    }
    expect(plan.trips.driver1).toHaveLength(TRIP_DOORS.driver1.length)
    expect(plan.trips.driver2).toHaveLength(TRIP_DOORS.driver2.length)
    const outcomes = plan.trips.driver1.map((d) => d.outcome)
    for (const o of ['cash', 'upi', 'cheque', 'part', 'refused', 'pending'] as const)
      expect(outcomes).toContain(o)
    expect(planCounts(plan).orders).toBe(plan.orders.length)
  })

  it('sends each stand-in shop one bill that is delivered and one that is still on the way', () => {
    const plan = planDay(input())
    for (const s of SLOT_DOORS) {
      const delivered = plan.trips[s.delivered[0]][s.delivered[1]]
      const onTheWay = plan.trips[s.onTheWay[0]][s.onTheWay[1]]
      expect(delivered?.shopId).toBe(input().slotShops[s.slot])
      expect(onTheWay?.shopId).toBe(input().slotShops[s.slot])
      expect(onTheWay?.outcome).toBe('pending')
      expect(['credit', 'cash', 'upi', 'cheque']).toContain(delivered?.outcome)
    }
  })

  it('holds the rep order of the shop over its limit, and never sends a van to it', () => {
    const plan = planDay(input())
    const h1 = plan.orders.find((o) => o.slot === 'h1')
    expect(h1?.shopId).toBe(id('5', 1))
    expect(h1?.by).toBe('sales1')
    const doors = [...plan.trips.driver1, ...plan.trips.driver2]
    expect(doors.some((d) => d.shopId === id('5', 1) || d.shopId === id('5', 2))).toBe(false)
    const h2 = plan.orders.find((o) => o.slot === 'h2')
    expect(h2?.bargainLineIndex).toBe(0)
  })

  it("puts the desk's phone orders on shops that owe nothing first", () => {
    const plan = planDay(input())
    const fresh = plan.orders.filter(
      (o) => o.by === 'manager' && !input().slotShops.includes(o.shopId),
    )
    const owing = fresh.filter(
      (o) => (SHOPS.find((s) => s.id === o.shopId)?.outstandingPaise ?? 0) > 0,
    )
    expect(owing).toHaveLength(0)
    expect(new Set(fresh.map((o) => o.shopId)).size).toBe(fresh.length)
  })

  it('carries the bills an earlier day left: a van-1 load on van 1, the rest where a door is free', () => {
    const carried = [
      { invoiceId: 'inv-1', orderId: 'o-1', shopId: id('5', 40), mustRideVan1: true },
      { invoiceId: 'inv-2', orderId: 'o-2', shopId: id('5', 41), mustRideVan1: false },
    ]
    const plan = planDay(input({ carried }))
    const van1 = plan.trips.driver1.map((d) => d.carried?.invoiceId)
    const van2 = plan.trips.driver2.map((d) => d.carried?.invoiceId)
    expect(van1).toContain('inv-1')
    expect(van2).toContain('inv-2')
    expect(plan.trips.driver1).toHaveLength(8)
    expect(planCounts(plan).carriedBills).toBe(2)
  })

  it('never bills a shop that holds real money on account or has credit stopped (rule 3b, DOS-314)', () => {
    // The product applies a shop's money on account to every new bill of it (DOS-312): a shop holding money the
    // tool did not put there would have the tool's bill paid with real money.
    const marked = new Set<string>()
    const shops = SHOPS.map((s, n) => {
      if (n % 3 === 0) {
        marked.add(s.id)
        return n % 2 === 0 ? { ...s, foreignOnAccountPaise: 25_000 } : { ...s, creditMode: 'stop' }
      }
      return s
    })
    const plan = planDay(input({ shops, slotShops: [id('5', 10), id('5', 20), id('5', 40)] }))
    expect(plan.orders.length).toBeGreaterThan(15)
    for (const o of plan.orders) expect(marked.has(o.shopId), `${o.slot} ${o.shopId}`).toBe(false)
  })

  it("gives the door whose money stays on account a shop that owes nothing on a real bill, never a carried bill", () => {
    // Every shop that owes nothing on a real bill is taken by the other doors first, except one.
    const [driver, index] = ON_ACCOUNT_DOOR
    for (const date of ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']) {
      const plan = planDay(input({ date }))
      const door = plan.trips[driver][index]
      const shop = SHOPS.find((s) => s.id === door?.shopId)
      expect(door?.carried).toBeNull()
      expect(shop?.foreignOpenPaise).toBe(0)
      expect(shop?.writtenOff).toBe(false)
    }
    // Only shops with real dues left but one clean one: that one gets the door, before any other door.
    const dirty = SHOPS.map((s, n) => (n === 56 ? s : { ...s, foreignOpenPaise: 10_000 + n }))
    const plan = planDay(input({ shops: dirty }))
    expect(plan.trips[driver][index]?.shopId).toBe(id('5', 56))
    // Many carried bills: none of them takes that door.
    const carried = Array.from({ length: 12 }, (_, n) => ({
      invoiceId: `inv-${String(n)}`,
      orderId: `o-${String(n)}`,
      shopId: id('5', 40 + n),
      mustRideVan1: n % 2 === 0,
    }))
    const full = planDay(input({ carried }))
    expect(full.trips[driver][index]?.carried).toBeNull()
    expect(full.waiting.length).toBeGreaterThan(0)
  })

  it("keeps a bill already planned on the day's trip at its door (tomorrow's van load)", () => {
    const carried = [
      {
        invoiceId: 'inv-load-1',
        orderId: 'o-load-1',
        shopId: id('5', 45),
        mustRideVan1: false,
        pin: { driver: 'driver1' as const, sequence: (VAN_LOAD_DOORS[0] ?? 0) + 1 },
      },
      {
        invoiceId: 'inv-load-2',
        orderId: 'o-load-2',
        shopId: id('5', 46),
        mustRideVan1: false,
        pin: { driver: 'driver1' as const, sequence: (VAN_LOAD_DOORS[1] ?? 1) + 1 },
      },
      { invoiceId: 'inv-3', orderId: 'o-3', shopId: id('5', 47), mustRideVan1: false },
    ]
    const plan = planDay(input({ carried }))
    const at = (inv: string) =>
      (['driver1', 'driver2'] as const).flatMap((d) =>
        plan.trips[d].filter((x) => x.carried?.invoiceId === inv).map((x) => `${d}:${String(x.sequence)}`),
      )
    expect(at('inv-load-1')).toEqual([`driver1:${String((VAN_LOAD_DOORS[0] ?? 0) + 1)}`])
    expect(at('inv-load-2')).toEqual([`driver1:${String((VAN_LOAD_DOORS[1] ?? 1) + 1)}`])
    expect(at('inv-3')).toHaveLength(1)
    // The van-load doors are never a stand-in shop's or the on-account door.
    for (const d of VAN_LOAD_DOORS) {
      expect(SLOT_DOORS.some((s) => s.delivered.join() === `driver1,${String(d)}` || s.onTheWay.join() === `driver1,${String(d)}`)).toBe(false)
      expect(d).not.toBe(ON_ACCOUNT_DOOR[1])
    }
  })

  it('gives a shop one door on a van, with all its carried bills (wrapper gap d)', () => {
    const shopA = id('5', 44)
    const shopB = id('5', 45)
    const carried = [
      { invoiceId: 'inv-a1', orderId: 'o-a1', shopId: shopA, mustRideVan1: false },
      { invoiceId: 'inv-a2', orderId: 'o-a2', shopId: shopA, mustRideVan1: false },
      { invoiceId: 'inv-a3', orderId: 'o-a3', shopId: shopA, mustRideVan1: false },
      // B's first bill is already on van 1's trip (last night's van load); its second cannot join a door that
      // is already planned, so it rides van 2.
      {
        invoiceId: 'inv-b1',
        orderId: 'o-b1',
        shopId: shopB,
        mustRideVan1: false,
        pin: { driver: 'driver1' as const, sequence: 1 },
      },
      { invoiceId: 'inv-b2', orderId: 'o-b2', shopId: shopB, mustRideVan1: false },
    ]
    const plan = planDay(input({ carried }))
    for (const driver of ['driver1', 'driver2'] as const) {
      const shops = plan.trips[driver].map((d) => d.shopId)
      expect(new Set(shops).size, driver).toBe(shops.length)
    }
    const doorA = [...plan.trips.driver1, ...plan.trips.driver2].filter((d) => d.shopId === shopA)
    expect(doorA).toHaveLength(1)
    expect([doorA[0]?.carried?.invoiceId, ...(doorA[0]?.alsoCarried ?? []).map((c) => c.invoiceId)]).toEqual([
      'inv-a1',
      'inv-a2',
      'inv-a3',
    ])
    expect(plan.trips.driver1.find((d) => d.sequence === 1)?.carried?.invoiceId).toBe('inv-b1')
    expect(plan.trips.driver2.filter((d) => d.shopId === shopB).map((d) => d.carried?.invoiceId)).toEqual([
      'inv-b2',
    ])
    // A shop a carried bill visits gets no fresh order of its own the same day.
    expect(plan.orders.some((o) => o.shopId === shopA || o.shopId === shopB)).toBe(false)
  })

  it('leaves a slot empty, and says so, when no priced item is in stock', () => {
    const plan = planDay(input({ items: ITEMS.map((i) => ({ ...i, available: 0 })) }))
    expect(plan.orders).toHaveLength(0)
    expect(plan.emptySlots.length).toBeGreaterThan(0)
  })
})
