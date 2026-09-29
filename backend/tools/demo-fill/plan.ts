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
  /** `POST_FULFILLMENT`, `ON` (pay on delivery: never held for credit, DOS-225) or `PRE`. */
  paymentTerms: string
  /** What the shop owes now (receivables' own figure). */
  outstandingPaise: number
  /**
   * Money on account the tool did NOT put there: a real receipt or credit note no bill has claimed. The
   * product applies a shop's money on account to every new bill of it (DOS-312), so the tool never bills such a
   * shop: real money never settles a dummy bill (rule 3b).
   */
  foreignOnAccountPaise: number
  /** What the shop owes on bills the tool did not make (opening bills, real orders). */
  foreignOpenPaise: number
  /** A bill of the shop stands written off: money it pays recovers that first (DOS-311). */
  writtenOff: boolean
}

/**
 * A shop the tool may bill: open, credit not stopped (a stopped shop takes no order, DOS-314), and holding no
 * money on account the tool did not put there (rule 3b: the product would apply that money to the tool's bill).
 */
export function billable(s: ShopInfo): boolean {
  return s.active && s.creditMode !== 'stop' && s.foreignOnAccountPaise <= 0
}

/**
 * A shop the tool may leave its OWN money on account with: billable, owing nothing on a bill the tool did not
 * make and with no bill written off — so the product, which applies money on account to the oldest open bill
 * (DOS-312) and recovers write-offs first (DOS-311), can only ever apply it to a bill of the tool (rule 3b).
 */
export function clean(s: ShopInfo): boolean {
  return billable(s) && s.foreignOpenPaise <= 0 && !s.writtenOff
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

/**
 * The door whose shop sends the desk a UPI payment it does not name a bill for ("collections to match"): that
 * money sits on account overnight, so the door always goes to a fresh order of a CLEAN shop (`clean`), never to a
 * bill an earlier day carried. [driver, door index].
 */
export const ON_ACCOUNT_DOOR: readonly ['driver1', number] = ['driver1', 3]

/**
 * The doors of van 1 that tomorrow's van load (planned tonight on tomorrow's trip, "a van to load") takes, in
 * this order: the first doors that are neither a stand-in shop's nor the on-account door.
 */
export const VAN_LOAD_DOORS: readonly number[] = [0, 1]

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
  /**
   * Already planned on one of the day's trips (tomorrow's van load is planned the night before, a crash may
   * leave a trip half made): it keeps that door, since a bill rides one trip at a time.
   */
  pin?: { driver: 'driver1' | 'driver2'; sequence: number } | undefined
}

export interface PlannedDoor {
  sequence: number
  outcome: DoorOutcome
  shopId: string
  /** A fresh order of today, or a bill an earlier day left. */
  orderSlot: OrderSlot | null
  carried: CarriedBill | null
  /**
   * More bills earlier days left for the SAME shop on this van: one door, all its bills (a stop carries a list of
   * bills), never the same shop twice on one route.
   */
  alsoCarried: CarriedBill[]
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
  // Its order must be HELD, not refused: never a stopped shop (it takes no order, DOS-314) nor a pay-on-delivery
  // one (never held for credit, DOS-225); and the limit must bite on what it owes, so no money on account.
  const on = shops.filter(
    (s) =>
      billable(s) && s.paymentTerms !== 'ON' && s.beatId === beatId && !exclude.has(s.id),
  )
  const already = on
    .filter((s) => s.creditMode === 'strict' && s.outstandingPaise > s.creditLimitPaise)
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
  const free = shops.filter((s) => billable(s) && !s.hasLogin && !exclude.has(s.id))
  const withPhone = free.filter((s) => s.hasPhone)
  const pool = withPhone.length >= 3 ? withPhone : free
  return shuffled(pool, `slot-shops:${tenantId}`, (s) => s.id)
    .slice(0, 3)
    .map((s) => s.id)
}

/** A door of a van as the tool reads it back: its place on the route and its shop. */
export interface DoorInfo {
  sequence: number
  retailerId: string
}

/**
 * The shops a day's vans already carry as stand-ins for the shopkeepers: the shops at the stand-in doors
 * (`SLOT_DOORS`) of that day's two trips. None when the day has no van yet.
 */
export function slotShopsOnVans(
  doors: Partial<Record<'driver1' | 'driver2', readonly DoorInfo[] | null>>,
): string[] {
  const out = new Set<string>()
  for (const slot of SLOT_DOORS)
    for (const [driver, index] of [slot.delivered, slot.onTheWay]) {
      const stop = doors[driver]?.find((s) => s.sequence === index + 1)
      if (stop) out.add(stop.retailerId)
    }
  return [...out].sort()
}

/**
 * The shops the tool's offer is for on a date: the three chosen today, and any shop the day's vans already
 * carry as a stand-in (a shop replaced in the middle of a day keeps the offer until its day is over; the
 * next day's vans carry the new three only). Sorted, each once.
 */
export function offerShops(chosen: readonly string[], onVans: readonly string[]): string[] {
  return [...new Set([...chosen, ...onVans])].sort()
}

/** An offer as the tool needs to see it: its id and the shops it is for (none named = every shop). */
export interface OfferInfo {
  id: string
  retailerIds: readonly string[] | undefined
}

export type OfferStep =
  { kind: 'keep'; id: string } | { kind: 'move'; id: string } | { kind: 'make' } | { kind: 'none' }

/**
 * What to do about the tool's offer today, given the offers live on the date and the shops it must be for
 * (`offerShops`). The tool's live offer is KEPT while it is for exactly those shops; when a stand-in shop was
 * replaced (it was closed, got a login or became a credit shop) the offer is MOVED to the shops of today, so
 * the shopkeeper row never loses its offer for the thirty days the offer runs; when none of the tool's offers
 * is live, one is MADE. With no stand-in shop at all nothing is made or moved: an offer that names no shop is
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
  const now = [...new Set(mine.retailerIds ?? [])].sort()
  const want = [...new Set(shops)].sort()
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

  // Fresh shops for the desk's phone orders: never a credit shop or a shopkeeper stand-in, one order each, only
  // shops the tool may bill (`billable`), and shops that owe nothing on a real bill first — their real dues stay
  // out of the way of the day's money (brief rules 3 and 3b), and no credit gate holds an order that is meant to
  // go out today.
  const eligible = input.shops.filter((s) => billable(s) && !credit.has(s.id) && !slots.has(s.id))
  const fresh = [
    ...shuffled(
      eligible.filter((s) => clean(s) && s.outstandingPaise <= 0),
      `fresh-shops:${date}`,
      (s) => s.id,
    ),
    ...shuffled(
      eligible.filter((s) => clean(s) && s.outstandingPaise > 0),
      `fresh-shops:${date}`,
      (s) => s.id,
    ),
    ...shuffled(
      eligible.filter((s) => !clean(s)),
      `fresh-shops:${date}`,
      (s) => s.id,
    ),
  ]
  const usedFresh = new Set<string>()
  const nextFresh = (when: (s: ShopInfo) => boolean = () => true): string | null => {
    const s = fresh.find((x) => !usedFresh.has(x.id) && when(x))
    if (!s) return null
    usedFresh.add(s.id)
    return s.id
  }

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
  const onAccountAt = `${ON_ACCOUNT_DOOR[0]}:${String(ON_ACCOUNT_DOOR[1])}`
  const takes = new Map<string, CarriedBill>()
  const also = new Map<string, CarriedBill[]>()
  // Which door of which van a shop's carried bills have: a second bill of that shop on that van joins the door
  // (one door, two bills: a stop carries a list of bills) instead of taking another. A door already on the trip
  // (pinned) takes no more bills — a stop is planned with its bills — so a second bill of its shop rides the
  // other van, or waits for tomorrow; the same shop never has two doors on one van.
  const doorOfShop = new Map<string, string>()
  const pinnedAt = new Set<string>()
  const put = (at: string, c: CarriedBill): void => {
    if (takes.has(at)) also.set(at, [...(also.get(at) ?? []), c])
    else takes.set(at, c)
    doorOfShop.set(`${at.slice(0, at.indexOf(':'))}:${c.shopId}`, at)
  }
  // A bill already planned on one of the day's trips keeps its door (a bill rides one trip at a time).
  for (const c of input.carried)
    if (c.pin) {
      const at = `${c.pin.driver}:${String(c.pin.sequence - 1)}`
      put(at, c)
      pinnedAt.add(at)
    }
  // A stand-in shop's doors are its own (a fresh order each): a carried bill of that shop does not join them.
  for (const [at, slot] of slotAt) {
    const shop = input.slotShops[slot]
    if (!shop) continue
    doorOfShop.set(`${at.slice(0, at.indexOf(':'))}:${shop}`, at)
    pinnedAt.add(at)
  }
  const waiting: CarriedBill[] = []
  const freeDoors = (driver: 'driver1' | 'driver2'): number[] =>
    TRIP_DOORS[driver]
      .map((_o, i) => i)
      .filter((i) => {
        const at = `${driver}:${String(i)}`
        return !slotAt.has(at) && at !== onAccountAt && !takes.has(at)
      })
  const free = { driver1: freeDoors('driver1'), driver2: freeDoors('driver2') }
  /** Puts a carried bill on the first of `vans` that can take it; false when none can today. */
  const place = (c: CarriedBill, vans: readonly ('driver1' | 'driver2')[]): boolean => {
    // Its shop's door on one of these vans, when that door is still to be planned: the bill joins it.
    for (const van of vans) {
      const same = doorOfShop.get(`${van}:${c.shopId}`)
      if (same && !pinnedAt.has(same)) {
        put(same, c)
        return true
      }
    }
    for (const van of vans) {
      if (doorOfShop.has(`${van}:${c.shopId}`)) continue
      const door = free[van].shift()
      if (door !== undefined) {
        put(`${van}:${String(door)}`, c)
        return true
      }
    }
    return false
  }
  const loose = input.carried.filter((c) => !c.pin)
  for (const c of [...loose.filter((x) => x.mustRideVan1), ...loose.filter((x) => !x.mustRideVan1)])
    if (!place(c, c.mustRideVan1 ? ['driver1'] : ['driver2', 'driver1'])) waiting.push(c)
  // A shop a carried bill already visits today is given no fresh door of its own as well.
  for (const c of input.carried) usedFresh.add(c.shopId)
  // The door whose money stays on account overnight takes the first clean shop before any other door does.
  const onAccountShop = nextFresh(clean)
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
          alsoCarried: also.get(at) ?? [],
          shopSlot: null,
        })
        return
      }
      const slot = `${driver === 'driver1' ? 't1' : 't2'}.${String(i)}` as OrderSlot
      const shopId =
        shopSlot !== null
          ? (input.slotShops[shopSlot] ?? null)
          : at === onAccountAt
            ? onAccountShop
            : nextFresh()
      const order = addOrder(slot, shopId, 'manager')
      if (!order) return
      trips[driver].push({
        sequence: i + 1,
        outcome,
        shopId: order.shopId,
        orderSlot: slot,
        carried: null,
        alsoCarried: [],
        shopSlot,
      })
    })
  }

  // --- the reps: two orders each on their own beat; one held for credit, one waiting on a rate -----------
  for (const rep of ['sales1', 'sales2'] as const) {
    const beat = input.repBeats[rep]
    const beatShops = shuffled(
      input.shops.filter(
        (s) => billable(s) && s.beatId === beat && !credit.has(s.id) && !slots.has(s.id),
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
