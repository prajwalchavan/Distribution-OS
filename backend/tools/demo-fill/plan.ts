import { demoId, shuffled, unit } from './ids.js'
import type { TesterKey } from './people.js'

/**
 * THE PLAN OF A DAY — pure, no network. Given what the API told the tool about the distributor (its shops,
 * beats, items, prices, stock) and what earlier days left for today, it decides WHO orders WHAT for WHICH
 * shop, which door of which van each bill rides to and how that door ends. Every choice is a function of
 * the business date and the ids the API returned, so the same date gives the same plan.
 */

export interface ShopInfo {
  id: string
  beatId: string | null
  active: boolean
  /** A shopkeeper login is linked to the shop (`identityId`). */
  hasLogin: boolean
  hasPhone: boolean
  creditMode: string
  creditLimitPaise: number
  /** What the shop owes now (receivables' own figure). */
  outstandingPaise: number
}

export interface ItemInfo {
  variantId: string
  /** The shop's rate from the price list (`pricing.rates`); 0 = no price. */
  ratePaise: number
  /** Pieces the godown can still promise (`inventory.stock.sellable`). */
  available: number
  minOrderQty: number
  orderIncrement: number
  maxPerOrder: number | null
  /** Purchase rate from the costs register, for a supplier bill; null = unknown. */
  costPaise: number | null
  mrpPaise: number | null
  gstBps: number | null
  hsnCode: string | null
}

export type DoorOutcome = 'cash' | 'upi' | 'cheque' | 'part' | 'refused' | 'credit' | 'pending'

/** The two vans' doors, in route order (brief: 6 to 8 doors, some paid, one part, one refused, the rest to do). */
export const TRIP_DOORS: Record<'driver1' | 'driver2', readonly DoorOutcome[]> = {
  driver1: ['cash', 'upi', 'cheque', 'part', 'refused', 'credit', 'pending', 'pending'],
  driver2: ['cash', 'upi', 'cheque', 'part', 'refused', 'credit', 'credit', 'pending'],
}

/**
 * The three shops that stand for `tester.shop1…3`: each has one bill delivered on credit (dues) and one on
 * the way, on the two vans. [driver, door index] pairs.
 */
export const SLOT_DOORS: readonly {
  slot: 0 | 1 | 2
  delivered: ['driver1' | 'driver2', number]
  onTheWay: ['driver1' | 'driver2', number]
}[] = [
  { slot: 0, delivered: ['driver1', 5], onTheWay: ['driver2', 7] },
  { slot: 1, delivered: ['driver2', 5], onTheWay: ['driver1', 6] },
  { slot: 2, delivered: ['driver2', 6], onTheWay: ['driver1', 7] },
]

export interface PlannedLine {
  id: string
  variantId: string
  qty: number
}

export type OrderSlot =
  `t1.${number}` | `t2.${number}` | 'h1' | 'h2' | 'w1' | 'w2' | 'k1' | 'k2' | 'l1' | 'l2'

export interface PlannedOrder {
  slot: OrderSlot
  id: string
  shopId: string
  /** Who places it: a rep (source `salesperson`) or the desk taking a phone order. */
  by: Extract<TesterKey, 'sales1' | 'sales2' | 'manager'>
  lines: PlannedLine[]
  /** h2 only: the line the rep asks a better rate for. */
  bargainLineIndex?: number
}

/** A packed bill an earlier day left, waiting for a van today. */
export interface CarriedBill {
  invoiceId: string
  orderId: string
  shopId: string
  /** On an earlier draft load sheet for van 1: it must ride van 1 (driver1). */
  mustRideVan1: boolean
}

export interface PlannedDoor {
  sequence: number
  outcome: DoorOutcome
  shopId: string
  /** A fresh order of today, or a bill an earlier day left. */
  orderSlot: OrderSlot | null
  carried: CarriedBill | null
  /** Stands for tester.shop<n+1>. */
  shopSlot: 0 | 1 | 2 | null
}

export interface DayPlan {
  date: string
  orders: PlannedOrder[]
  trips: Record<'driver1' | 'driver2', PlannedDoor[]>
  /** Carried bills no door could take today (they wait for tomorrow). */
  waiting: CarriedBill[]
  /** Planned orders that found no priced item in stock, by slot. */
  emptySlots: OrderSlot[]
}

export interface PlanInput {
  tenantId: string
  date: string
  shops: readonly ShopInfo[]
  items: readonly ItemInfo[]
  repBeats: Partial<Record<'sales1' | 'sales2', string>>
  creditShops: Partial<Record<'sales1' | 'sales2', string>>
  slotShops: readonly string[]
  carried: readonly CarriedBill[]
}

// ------------------------------------------------------------------------------------------ choices

/**
 * The beats the two reps walk: kept once assigned (`existing`); otherwise the beats with the most shops
 * that owe money (a credit shop is needed on each), then the most active shops, then the id.
 */
export function chooseRepBeats(
  shops: readonly ShopInfo[],
  beatIds: readonly string[],
  existing: Partial<Record<'sales1' | 'sales2', string>>,
): Partial<Record<'sales1' | 'sales2', string>> {
  const stats = beatIds.map((id) => {
    const on = shops.filter((s) => s.active && s.beatId === id)
    return { id, shops: on.length, owing: on.filter((s) => s.outstandingPaise > 0).length }
  })
  const ranked = stats
    .filter((b) => b.shops >= 6 && b.owing > 0)
    .sort((a, b) => b.owing - a.owing || b.shops - a.shops || a.id.localeCompare(b.id))
    .map((b) => b.id)
  const out: Partial<Record<'sales1' | 'sales2', string>> = { ...existing }
  for (const rep of ['sales1', 'sales2'] as const) {
    if (out[rep]) continue
    const taken = new Set(Object.values(out))
    const pick = ranked.find((id) => !taken.has(id))
    if (pick) out[rep] = pick
  }
  return out
}

/**
 * The shop on a rep's beat that is over its credit limit. One the desk already put on a strict limit it has
 * crossed is kept; otherwise the shop that owes the most (its dues are real opening dues or bills the tool
 * never collects), never a shop that stands for a shopkeeper login.
 */
export function chooseCreditShop(
  shops: readonly ShopInfo[],
  beatId: string | undefined,
  exclude: ReadonlySet<string>,
): ShopInfo | null {
  if (!beatId) return null
  const on = shops.filter((s) => s.active && s.beatId === beatId && !exclude.has(s.id))
  const already = on
    .filter(
      (s) =>
        (s.creditMode === 'strict' || s.creditMode === 'stop') &&
        s.outstandingPaise > s.creditLimitPaise,
    )
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  if (already) return already
  return (
    on
      .filter((s) => s.outstandingPaise > 0)
      .sort((a, b) => b.outstandingPaise - a.outstandingPaise || a.id.localeCompare(b.id))[0] ??
    null
  )
}

/** The strict limit that puts a shop over it: half of what it owes, in whole hundreds of rupees, at least ₹100. */
export function creditLimitFor(outstandingPaise: number): number {
  return Math.max(10_000, Math.floor(outstandingPaise / 2 / 10_000) * 10_000)
}

/**
 * The three shops that stand for `tester.shop1…3`: shops with no shopkeeper login (and a phone when there
 * are enough), in a stable order of the tenant, never a credit shop. The same three every day.
 */
export function chooseSlotShops(
  tenantId: string,
  shops: readonly ShopInfo[],
  exclude: ReadonlySet<string>,
): string[] {
  const free = shops.filter((s) => s.active && !s.hasLogin && !exclude.has(s.id))
  const withPhone = free.filter((s) => s.hasPhone)
  const pool = withPhone.length >= 3 ? withPhone : free
  return shuffled(pool, `slot-shops:${tenantId}`, (s) => s.id)
    .slice(0, 3)
    .map((s) => s.id)
}

/** An offer as the tool needs to see it: its id and the shops it is for (none named = every shop). */
export interface OfferInfo {
  id: string
  retailerIds: readonly string[] | undefined
}

export type OfferStep =
  { kind: 'keep'; id: string } | { kind: 'move'; id: string } | { kind: 'make' } | { kind: 'none' }

/**
 * What to do about the tool's offer today, given the offers live on the date and the stand-in shops chosen
 * today. The tool's live offer is KEPT while it is for exactly those shops; when a stand-in shop was
 * replaced (it was closed, got a login or became a credit shop) the offer is MOVED to today's three, so the
 * shopkeeper row never loses its offer for the thirty days the offer runs; when none of the tool's offers is
 * live, one is MADE. With no stand-in shop at all nothing is made or moved: an offer that names no shop is
 * an offer for every shop, and the real shops' prices are not the tool's to change.
 */
export function offerStep(
  live: readonly OfferInfo[],
  shops: readonly string[],
  isTool: (id: string) => boolean,
): OfferStep {
  if (shops.length === 0) return { kind: 'none' }
  // The newest of the tool's live offers (its id carries the date it was made for).
  const mine = live.filter((o) => isTool(o.id)).sort((a, b) => b.id.localeCompare(a.id))[0]
  if (!mine) return { kind: 'make' }
  const now = [...(mine.retailerIds ?? [])].sort()
  const want = [...shops].sort()
  const same = now.length === want.length && now.every((s, i) => s === want[i])
  return same ? { kind: 'keep', id: mine.id } : { kind: 'move', id: mine.id }
}

// -------------------------------------------------------------------------------------------- items

/** A quantity a kirana shop would order: 2 to 12 pieces, on the item's own order rules. */
export function quantityFor(seed: string, item: ItemInfo): number {
  const want = 2 + Math.floor(unit(seed) * 11)
  const step = Math.max(1, item.orderIncrement)
  let qty = Math.max(item.minOrderQty, Math.ceil(want / step) * step)
  if (item.maxPerOrder !== null) qty = Math.min(qty, item.maxPerOrder)
  return qty
}

/** What the plan may still take of an item today: the godown's figure less a reserve for real orders. */
export function stockBudget(items: readonly ItemInfo[]): Map<string, number> {
  return new Map(
    items.map((i) => [
      i.variantId,
      Math.max(0, i.available - Math.max(5, Math.ceil(i.available / 10))),
    ]),
  )
}

/**
 * Two to four lines of priced items the godown holds, each quantity inside what is left of the day's
 * budget (which this call spends). An item without a price or without stock is never chosen.
 */
export function chooseLines(
  seed: string,
  lineId: (n: number) => string,
  items: readonly ItemInfo[],
  budget: Map<string, number>,
): PlannedLine[] {
  const count = 2 + Math.floor(unit(`${seed}:count`) * 3)
  const pool = shuffled(
    items.filter((i) => i.ratePaise > 0 && (budget.get(i.variantId) ?? 0) > 0),
    `${seed}:items`,
    (i) => i.variantId,
  )
  const lines: PlannedLine[] = []
  for (const item of pool) {
    if (lines.length >= count) break
    const qty = quantityFor(`${seed}:${item.variantId}`, item)
    const left = budget.get(item.variantId) ?? 0
    if (qty < 1 || qty > left) continue
    budget.set(item.variantId, left - qty)
    lines.push({ id: lineId(lines.length), variantId: item.variantId, qty })
  }
  return lines
}

// --------------------------------------------------------------------------------------------- the day

/** The whole day: orders for every slot, and the doors of both vans with the bills that ride them. */
export function planDay(input: PlanInput): DayPlan {
  const { date } = input

  const budget = stockBudget(input.items)
  const credit = new Set(Object.values(input.creditShops))
  const slots = new Set(input.slotShops)
  const orders: PlannedOrder[] = []
  const emptySlots: OrderSlot[] = []

  // Fresh shops for the desk's phone orders: never a credit shop or a shopkeeper stand-in, one order each,
  // shops that owe nothing first — their real dues stay out of the way of the day's money (brief rule 3),
  // and no credit gate holds an order that is meant to go out today.
  const eligible = input.shops.filter((s) => s.active && !credit.has(s.id) && !slots.has(s.id))
  const fresh = [
    ...shuffled(
      eligible.filter((s) => s.outstandingPaise <= 0),
      `fresh-shops:${date}`,
      (s) => s.id,
    ),
    ...shuffled(
      eligible.filter((s) => s.outstandingPaise > 0),
      `fresh-shops:${date}`,
      (s) => s.id,
    ),
  ]
  let freshAt = 0
  const nextFresh = (): string | null => fresh[freshAt++]?.id ?? null

  const addOrder = (
    slot: OrderSlot,
    shopId: string | null,
    by: PlannedOrder['by'],
    extra: Partial<PlannedOrder> = {},
  ): PlannedOrder | null => {
    if (!shopId) {
      emptySlots.push(slot)
      return null
    }
    const id = demoId(input.tenantId, date, 'order', slot)
    const lines = chooseLines(
      `${date}:${slot}`,
      (n) => demoId(input.tenantId, date, 'order', slot, 'line', String(n)),
      input.items,
      budget,
    )
    if (lines.length === 0) {
      emptySlots.push(slot)
      return null
    }
    const order: PlannedOrder = { slot, id, shopId, by, lines, ...extra }
    orders.push(order)
    return order
  }

  // --- the vans: carried bills first (van 1's own first), then today's orders for the rest --------------
  const trips: DayPlan['trips'] = { driver1: [], driver2: [] }
  const slotAt = new Map<string, 0 | 1 | 2>()
  for (const s of SLOT_DOORS) {
    slotAt.set(`${s.delivered[0]}:${String(s.delivered[1])}`, s.slot)
    slotAt.set(`${s.onTheWay[0]}:${String(s.onTheWay[1])}`, s.slot)
  }
  const carriedVan1 = input.carried.filter((c) => c.mustRideVan1)
  const carriedAny = input.carried.filter((c) => !c.mustRideVan1)
  const waiting: CarriedBill[] = []
  const freeDoors = (driver: 'driver1' | 'driver2'): number[] =>
    TRIP_DOORS[driver].map((_o, i) => i).filter((i) => !slotAt.has(`${driver}:${String(i)}`))
  const takes = new Map<string, CarriedBill>()
  const van1 = freeDoors('driver1')
  const van2 = freeDoors('driver2')
  for (const c of carriedVan1) {
    const door = van1.shift()
    if (door === undefined) waiting.push(c)
    else takes.set(`driver1:${String(door)}`, c)
  }
  for (const c of carriedAny) {
    const onVan2 = van2.shift()
    if (onVan2 !== undefined) {
      takes.set(`driver2:${String(onVan2)}`, c)
      continue
    }
    const onVan1 = van1.shift()
    if (onVan1 !== undefined) takes.set(`driver1:${String(onVan1)}`, c)
    else waiting.push(c)
  }
  for (const driver of ['driver1', 'driver2'] as const) {
    TRIP_DOORS[driver].forEach((outcome, i) => {
      const at = `${driver}:${String(i)}`
      const carried = takes.get(at) ?? null
      const shopSlot = slotAt.get(at) ?? null
      if (carried) {
        trips[driver].push({
          sequence: i + 1,
          outcome,
          shopId: carried.shopId,
          orderSlot: null,
          carried,
          shopSlot: null,
        })
        return
      }
      const slot = `${driver === 'driver1' ? 't1' : 't2'}.${String(i)}` as OrderSlot
      const shopId = shopSlot !== null ? (input.slotShops[shopSlot] ?? null) : nextFresh()
      const order = addOrder(slot, shopId, 'manager')
      if (!order) return
      trips[driver].push({
        sequence: i + 1,
        outcome,
        shopId: order.shopId,
        orderSlot: slot,
        carried: null,
        shopSlot,
      })
    })
  }

  // --- the reps: two orders each on their own beat; one held for credit, one waiting on a rate -----------
  for (const rep of ['sales1', 'sales2'] as const) {
    const beat = input.repBeats[rep]
    const beatShops = shuffled(
      input.shops.filter(
        (s) => s.active && s.beatId === beat && !credit.has(s.id) && !slots.has(s.id),
      ),
      `beat-shops:${date}:${rep}`,
      (s) => s.id,
    )
    if (rep === 'sales1') {
      addOrder('h1', input.creditShops.sales1 ?? null, 'sales1')
      addOrder('w1', beatShops[0]?.id ?? null, 'sales1')
    } else {
      const h2 = addOrder('h2', beatShops[0]?.id ?? null, 'sales2')
      if (h2) h2.bargainLineIndex = 0
      addOrder('w2', beatShops[1]?.id ?? null, 'sales2')
    }
  }

  // --- the godown's queues: a picked wave waiting to be packed, a van load waiting for the manager -------
  addOrder('k1', nextFresh(), 'manager')
  addOrder('k2', nextFresh(), 'manager')
  addOrder('l1', nextFresh(), 'manager')
  addOrder('l2', nextFresh(), 'manager')

  return { date, orders, trips, waiting, emptySlots }
}

/** Summary counts of a plan, for the dry run and the report (ids and counts only). */
export function planCounts(plan: DayPlan): Record<string, number> {
  const doors = [...plan.trips.driver1, ...plan.trips.driver2]
  return {
    orders: plan.orders.length,
    lines: plan.orders.reduce((n, o) => n + o.lines.length, 0),
    pieces: plan.orders.reduce((n, o) => n + o.lines.reduce((m, l) => m + l.qty, 0), 0),
    doorsDriver1: plan.trips.driver1.length,
    doorsDriver2: plan.trips.driver2.length,
    carriedBills: doors.filter((d) => d.carried !== null).length,
    waitingBills: plan.waiting.length,
    emptySlots: plan.emptySlots.length,
  }
}
