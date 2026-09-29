import { contract } from '@dos/contracts'
import type { Ctx } from './context.js'
import { officeMoney, returnToApprove, supplierBills } from './desk.js'
import { billOf, earlier, getOrder, istTime, maybe, pages } from './helpers.js'
import { addDays, demoKey, unit } from './ids.js'
import {
  VAN_LOAD_DOORS,
  orderIdOf,
  planCounts,
  planDay,
  type CarriedBill,
  type DayPlan,
  type PlannedOrder,
} from './plan.js'
import { loadAndDepart, readTrip, workDoors, type DriverKey } from './road.js'
import type { Standing } from './setup.js'
import type { Section } from './summary.js'
import { readWorld } from './world.js'

/**
 * MAKE A DAY: the orders of `date` taken, the godown's waves, the two vans out and their doors worked, the
 * van load waiting for the manager, the desk's money and the supplier bills. Every step first reads whether
 * its thing is already there; the same date run twice writes nothing the second time.
 */

const SECTION_OF: Record<string, Section> = {
  h1: 'manager',
  h2: 'manager',
  w1: 'sales',
  w2: 'sales',
  k1: 'godown',
  k2: 'godown',
  l1: 'godown',
  l2: 'godown',
}
const sectionOf = (slot: string): Section => SECTION_OF[slot] ?? 'driver'

/** Packed bills an earlier day left: on no open trip yet, or already riding one of today's vans. */
export async function findCarried(
  ctx: Ctx,
  date: string,
  standing: Standing,
): Promise<CarriedBill[]> {
  const out = new Map<string, CarriedBill>()
  const planning = await pages((cursor) =>
    ctx
      .read(contract.delivery.trips.planning, { date, limit: 200, ...(cursor ? { cursor } : {}) })
      .then((r) => ({ items: r.bills, nextCursor: r.nextCursor })),
  )
  for (const b of planning)
    if (earlier(b.orderId, date))
      out.set(b.invoiceId, {
        invoiceId: b.invoiceId,
        orderId: b.orderId,
        shopId: b.retailerId,
        mustRideVan1: false,
      })
  for (const driver of ['driver1', 'driver2'] as const) {
    const trip = await readTrip(ctx, ctx.tripId(date, driver))
    for (const stop of trip?.stops ?? [])
      for (const d of stop.deliveries)
        if (d.orderId && earlier(d.orderId, date))
          out.set(d.invoiceId, {
            invoiceId: d.invoiceId,
            orderId: d.orderId,
            shopId: stop.retailerId,
            mustRideVan1: false,
            // Already on this trip (last night's van load, or a run that stopped halfway): it keeps its door.
            pin: { driver, sequence: stop.sequence },
          })
  }
  // A bill on an earlier sheet for van 1 (the van load the manager signs off in the morning) rides van 1.
  const van1 = standing.vans.driver1
  if (van1) {
    const sheets = await ctx.read(contract.warehouse.loadSheets.list, {
      toLocationId: van1.locationId,
      limit: 200,
    })
    for (const s of sheets.items) {
      if (!earlier(s.id, date) || s.tripId !== null || s.status === 'cancelled') continue
      const sheet = await ctx.read(contract.warehouse.loadSheets.get, { id: s.id })
      for (const o of sheet.item.orders) {
        const hit = [...out.values()].find((c) => c.orderId === o.orderId)
        if (hit) hit.mustRideVan1 = true
      }
    }
  }
  return [...out.values()].sort((a, b) => a.orderId.localeCompare(b.orderId))
}

// ------------------------------------------------------------------------------------------- orders

async function placeOrder(ctx: Ctx, order: PlannedOrder, date: string): Promise<void> {
  const section = sectionOf(order.slot)
  const placer = (): ReturnType<Ctx['as']> => ctx.as(order.by)
  let current = await getOrder(ctx, order.id)
  if (!current) {
    // Every price comes from the engine: the order is quoted first, and a line it cannot price is dropped.
    const quoteAs = ctx.commit ? await placer() : ctx.owner
    if (!quoteAs) {
      ctx.summary.refusedOne(section, 'order', 'no sign-in')
      return
    }
    const quote = await ctx.readAs(quoteAs, contract.pricing.quote, {
      retailerId: order.shopId,
      lines: order.lines.map((l) => ({ lineId: l.id, variantId: l.variantId, qtyPcs: l.qty })),
    })
    const priced = order.lines.filter((l) =>
      quote.lines.some((q) => q.lineId === l.id && q.ratePaise > 0),
    )
    if (priced.length === 0) {
      ctx.summary.refusedOne(section, 'order', 'no priced line')
      return
    }
    if (order.bargainLineIndex !== undefined) {
      const line = priced[order.bargainLineIndex] ?? priced[0]
      const q = quote.lines.find((x) => x.lineId === line?.id)
      if (line && q && q.ratePaise > 200) {
        // Three per cent under the quoted rate, in whole rupees: what a rep asks for a regular shop.
        const asked = Math.min(q.ratePaise - 100, Math.floor((q.ratePaise * 0.97) / 100) * 100)
        await ctx.write(section, 'rate asked', placer, contract.pricing.bargains.request, {
          idempotencyKey: ctx.dayKey(date, 'bargain', order.slot),
          id: ctx.dayId(date, 'bargain', order.slot),
          retailerId: order.shopId,
          variantId: line.variantId,
          askedRatePaise: asked,
          qtyPcs: line.qty,
          orderId: order.id,
          note: 'Shop is comparing with the wholesale market rate',
        })
      }
    }
    const made = await ctx.write(section, 'order taken', placer, contract.orders.create, {
      idempotencyKey: ctx.dayKey(date, 'order', order.slot, 'create'),
      id: order.id,
      retailerId: order.shopId,
      source: order.by === 'manager' ? 'phone' : 'salesperson',
      lines: priced.map((l) => ({
        id: l.id,
        variantId: l.variantId,
        enteredQty: l.qty,
        enteredUnit: 'piece' as const,
      })),
    })
    if (!made) return
    current = made.item
    if (order.by !== 'manager') await recordVisit(ctx, order, date)
  } else ctx.summary.foundOne(section, 'order taken')
  if (current.state === 'draft') {
    const sent = await ctx.write(section, 'order placed', placer, contract.orders.submit, {
      idempotencyKey: ctx.dayKey(date, 'order', order.slot, 'submit'),
      id: order.id,
    })
    if (sent) current = sent.item
  }
  // Only h1 (credit) and h2 (rate) are meant to wait. Anything else a gate held, the manager clears.
  if (current.state === 'submitted' && order.slot !== 'h1' && order.slot !== 'h2')
    await clearGates(ctx, order.id, date)
}

/** The manager approves every pending gate of an order that is meant to go through today. */
async function clearGates(ctx: Ctx, orderId: string, date: string): Promise<void> {
  const list = await ctx.read(contract.orders.approvals.list, {
    orderId,
    status: 'pending',
    limit: 20,
  })
  for (const a of list.items)
    await ctx.write(
      'manager',
      'approval decided',
      () => ctx.as('manager'),
      contract.orders.approvals.decide,
      {
        idempotencyKey: demoKey(date, 'approval', a.id),
        id: a.id,
        decision: 'approve',
        note: 'Regular shop, cleared by phone',
      },
    )
}

async function recordVisit(ctx: Ctx, order: PlannedOrder, date: string): Promise<void> {
  const minute = Math.floor(unit(`${order.id}:visit`) * 50)
  await ctx.write(
    'sales',
    'shop visited',
    () => ctx.as(order.by),
    contract.retailers.visits.record,
    {
      idempotencyKey: ctx.dayKey(date, 'visit', order.slot),
      id: ctx.dayId(date, 'visit', order.slot),
      retailerId: order.shopId,
      startedAt: istTime(date, order.slot.endsWith('1') ? 10 : 11, minute),
      endedAt: istTime(date, order.slot.endsWith('1') ? 10 : 11, minute + 9),
      outcome: 'ordered',
    },
  )
}

// -------------------------------------------------------------------------------------------- waves

/**
 * A wave on the godown floor: made from the orders that are confirmed, started, picked in full and packed —
 * each only as far as `upTo` says, so today can leave a wave open ("a wave to pick") or picked ("packs to make").
 */
export async function wave(
  ctx: Ctx,
  date: string,
  name: string,
  orderIds: readonly string[],
  upTo: 'open' | 'picked' | 'packed',
): Promise<void> {
  const id = ctx.dayId(date, 'wave', name)
  let pl = await maybe(ctx.read(contract.warehouse.picklists.get, { id }))
  if (!pl) {
    const ready: string[] = []
    for (const orderId of orderIds) {
      const o = await getOrder(ctx, orderId)
      if (o?.state === 'confirmed') ready.push(orderId)
    }
    if (ready.length === 0) return
    const made = await ctx.write(
      'godown',
      'wave',
      () => ctx.as('godown'),
      contract.warehouse.picklists.create,
      {
        idempotencyKey: ctx.dayKey(date, 'wave', name),
        id,
        orderIds: ready,
        pickDate: date,
      },
    )
    if (!made) return
    pl = made
  }
  if (upTo === 'open') return
  if (pl.item.status === 'open') {
    const started = await ctx.write(
      'godown',
      'wave started',
      () => ctx.as('godown'),
      contract.warehouse.picklists.start,
      {
        idempotencyKey: ctx.dayKey(date, 'wave', name, 'start'),
        id,
        assignedTo: ctx.userIds.get('godown'),
      },
    )
    if (!started) return
    pl = started
  }
  if (pl.item.status === 'picking') {
    const todo = pl.item.lines.filter((l) => l.pickedAt === null && (l.lotId ?? l.suggestedLotId))
    if (todo.length > 0) {
      const picked = await ctx.write(
        'godown',
        'wave picked',
        () => ctx.as('godown'),
        contract.warehouse.picklists.pick,
        {
          idempotencyKey: ctx.dayKey(date, 'wave', name, 'pick'),
          id,
          // A line the godown has no lot for cannot be recorded (a pick names its lot); the plan never orders
          // an item without stock, so that line is a race with a real order and is left for the desk.
          lines: todo.flatMap((l) => {
            const lotId = l.lotId ?? l.suggestedLotId
            return lotId
              ? [{ id: l.id, orderLineId: l.orderLineId, lotId, pickedQtyPcs: l.requestedQtyPcs }]
              : []
          }),
        },
      )
      if (!picked) return
      pl = { item: picked.item }
    }
  }
  if (upTo === 'picked') return
  for (const o of pl.item.orders) await pack(ctx, date, o.orderId)
}

/** Tape the cartons shut: the pack confirmation issues the bill. */
export async function pack(ctx: Ctx, date: string, orderId: string): Promise<void> {
  const order = await getOrder(ctx, orderId)
  if (!order || (order.state !== 'picking' && order.state !== 'confirmed')) return
  const lines = order.lines.length
  await ctx.write(
    'godown',
    'packed and billed',
    () => ctx.as('godown'),
    contract.warehouse.packs.confirm,
    {
      idempotencyKey: demoKey(date, 'pack', orderId),
      id: ctx.id(date, 'pack', orderId),
      orderId,
      packages: Math.max(1, Math.ceil(lines / 2)),
    },
  )
}

// -------------------------------------------------------------------------------------------- vans

interface StopPlan {
  id: string
  sequence: number
  retailerId: string
  invoiceIds: string[]
}

/** The stops a day's plan gives a van, each with the bill its door carries (a door with no bill yet is left out). */
async function plannedStops(
  ctx: Ctx,
  date: string,
  driver: DriverKey,
  plan: DayPlan,
): Promise<StopPlan[]> {
  const tripId = ctx.tripId(date, driver)
  if (!tripId) return []
  const stops: StopPlan[] = []
  for (const door of plan.trips[driver]) {
    // The door goes to the shop the BILL is for: after a crash the plan may name another shop for a slot
    // whose order already exists, and the order is what it is.
    const orderId = door.orderSlot
      ? plan.orders.find((o) => o.slot === door.orderSlot)?.id
      : undefined
    const bill = door.carried
      ? { id: door.carried.invoiceId, retailerId: door.carried.shopId }
      : orderId
        ? await billOf(ctx, orderId)
        : null
    if (!bill) continue
    stops.push({
      id: ctx.stopId(date, tripId, door.sequence),
      sequence: door.sequence,
      retailerId: bill.retailerId,
      // A shop with two carried bills on this van is one door with both (a stop carries a list of bills).
      invoiceIds: [bill.id, ...door.alsoCarried.map((c) => c.invoiceId)],
    })
  }
  return stops
}

/**
 * A trip that is planned or loading takes the doors it does not have yet, as the desk adds a late bill
 * (`trips.addStop`): tomorrow's van load is planned the night before on van 1's trip with its own doors only,
 * and the rest of the day's doors join it in the morning.
 */
async function addMissingStops(
  ctx: Ctx,
  date: string,
  tripId: string,
  stops: readonly StopPlan[],
  section: Section,
): Promise<void> {
  const trip = await readTrip(ctx, tripId)
  if (!trip || (trip.state !== 'planned' && trip.state !== 'loading')) return
  const have = new Set(trip.stops.map((s) => s.sequence))
  const riding = new Set(trip.stops.flatMap((s) => s.deliveries.map((d) => d.invoiceId)))
  for (const stop of stops) {
    if (have.has(stop.sequence) || stop.invoiceIds.some((i) => riding.has(i))) continue
    await ctx.write(section, 'door added', () => ctx.as('manager'), contract.delivery.stops.add, {
      idempotencyKey: demoKey(date, 'trip', tripId, 'stop', String(stop.sequence)),
      id: tripId,
      stop,
    })
  }
}

async function planTrip(
  ctx: Ctx,
  date: string,
  driver: DriverKey,
  plan: DayPlan,
  standing: Standing,
): Promise<void> {
  const id = ctx.tripId(date, driver)
  const key = ctx.tripKey(date, driver)
  const van = standing.vans[driver]
  const driverId = ctx.userIds.get(driver)
  const existing = await readTrip(ctx, id)
  if (!existing && !ctx.commit) {
    // A dry run has no packed bill to put on a van: the van's day is counted as the one it would be.
    ctx.summary.wouldOne('driver', 'trip planned')
    return
  }
  if (existing) {
    ctx.summary.foundOne('driver', 'trip planned')
    await addMissingStops(
      ctx,
      date,
      existing.id,
      await plannedStops(ctx, date, driver, plan),
      'driver',
    )
  } else {
    if (!van || !driverId || !id || !key) {
      ctx.summary.refusedOne('driver', 'trip planned', 'no van or no driver')
      return
    }
    const stops = await plannedStops(ctx, date, driver, plan)
    if (stops.length === 0) {
      ctx.summary.refusedOne('driver', 'trip planned', 'no packed bill')
      return
    }
    const made = await ctx.write(
      'driver',
      'trip planned',
      () => ctx.as('manager'),
      contract.delivery.trips.create,
      {
        idempotencyKey: key,
        id,
        tripDate: date,
        vehicleId: van.id,
        driverId,
        openingCashPaise: 50_000,
        stops,
      },
    )
    if (!made) return
  }
  if (!id) return
  await loadAndDepart(ctx, id, driver, date)
  await workDoors(ctx, id, driver, date)
}

/**
 * The van load for tomorrow morning: the desk plans van 1's trip of tomorrow with these bills tonight (a bill is
 * loaded only onto the trip that carries it, DOS-354), and the godown builds that trip's sheet, which waits for the
 * manager to sign it off — the product refuses the sign-off until today's trip of van 1 is settled (a van carries
 * one trip at a time), so it waits overnight, as it would at the godown. Tomorrow's run adds the day's other doors
 * to that trip, and the bills keep the first doors of van 1 (`VAN_LOAD_DOORS`).
 */
async function vanToLoad(ctx: Ctx, date: string, plan: DayPlan, standing: Standing): Promise<void> {
  const van1 = standing.vans.driver1
  if (!van1) return
  const id = ctx.dayId(date, 'sheet', 'van-to-load')
  if (await maybe(ctx.read(contract.warehouse.loadSheets.get, { id }))) {
    ctx.summary.foundOne('godown', 'van to load')
    return
  }
  const loads: { orderId: string; invoiceId: string; retailerId: string }[] = []
  for (const o of plan.orders.filter((x) => x.slot === 'l1' || x.slot === 'l2')) {
    if ((await getOrder(ctx, o.id))?.state !== 'packed') continue
    const bill = await billOf(ctx, o.id)
    if (bill) loads.push({ orderId: o.id, invoiceId: bill.id, retailerId: bill.retailerId })
  }
  if (loads.length === 0) return
  const tomorrow = addDays(date, 1)
  const tripId = ctx.tripId(tomorrow, 'driver1')
  const tripKey = ctx.tripKey(tomorrow, 'driver1')
  if (!tripId || !tripKey) {
    ctx.summary.refusedOne('godown', 'trip planned', 'no driver')
    return
  }
  const stops: StopPlan[] = loads.map((l, n) => {
    const sequence = (VAN_LOAD_DOORS[n] ?? n) + 1
    return {
      id: ctx.stopId(tomorrow, tripId, sequence),
      sequence,
      retailerId: l.retailerId,
      invoiceIds: [l.invoiceId],
    }
  })
  const trip = await readTrip(ctx, tripId)
  if (!trip) {
    const driverId = ctx.userIds.get('driver1') ?? ''
    const made = await ctx.write(
      'godown',
      'trip planned',
      () => ctx.as('manager'),
      contract.delivery.trips.create,
      {
        idempotencyKey: tripKey,
        id: tripId,
        tripDate: tomorrow,
        vehicleId: van1.id,
        driverId,
        openingCashPaise: 50_000,
        stops,
      },
    )
    if (!made) return
  } else if (trip.state === 'planned' || trip.state === 'loading')
    await addMissingStops(ctx, tomorrow, tripId, stops, 'godown')
  // Tomorrow's van already left (a later date was made first): there is nothing to load tonight.
  else return
  await ctx.write(
    'godown',
    'van to load',
    () => ctx.as('godown'),
    contract.warehouse.loadSheets.create,
    {
      idempotencyKey: ctx.dayKey(date, 'sheet', 'van-to-load'),
      id,
      toLocationId: van1.locationId,
      tripId,
      sheetDate: tomorrow,
      orderIds: loads.map((l) => l.orderId),
    },
  )
}

/** Every slot a day's plan can fill: its orders' ids say which crew made the date (`dayShift`). */
export const DAY_SLOTS: readonly string[] = [
  ...['t1', 't2'].flatMap((van) => [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `${van}.${String(n)}`)),
  ...['h1', 'w1', 'h2', 'w2', 'k1', 'k2', 'l1', 'l2'],
]
/** The shifts a date can have, in order (D6): its own, then one per crew that took the date over. */
export const SHIFTS: readonly string[] = ['', 's2', 's3', 's4', 's5']

/**
 * THE SHIFT of `date` (D6). A date is made under one crew's ids. When the tool's former tester logins already made
 * it — its orders were placed by a person who is not in today's crew — today's crew takes the next shift whose
 * orders are nobody else's (`s2`, then `s3`…), after the former drivers finished their trips of the day, so the new
 * testers open on work of their own that day and nothing of the first shift is made twice. A date only one crew
 * made keeps no tag: the ids are the ones the tool always made. Reads only; the same answer on every run of the date.
 */
export async function dayShift(ctx: Ctx, date: string): Promise<string> {
  const crew = new Set(ctx.userIds.values())
  for (const shift of SHIFTS) {
    let maker: string | null = null
    for (const slot of DAY_SLOTS) {
      const o = await getOrder(ctx, orderIdOf(ctx.tenantId, date, slot, shift || undefined))
      if (o) {
        maker = o.createdBy
        break
      }
    }
    if (maker === null || crew.has(maker)) return shift
  }
  throw new Error(`${date} has more shifts than the tool keeps (${String(SHIFTS.length)})`)
}

// ------------------------------------------------------------------------------------------- the day

/** Reads the shift of `date` once per run and keeps it on the run (`Ctx.shifts`); the report says when there is one. */
export async function takeShift(ctx: Ctx, date: string): Promise<string> {
  const known = ctx.shifts.get(date)
  if (known !== undefined) return known
  const shift = await dayShift(ctx, date)
  ctx.shifts.set(date, shift)
  if (shift)
    ctx.summary.note(
      `${date} was already made by tester logins the tool no longer uses: today's testers take their own shift of it (${shift}), after the former drivers finished and checked in their trips (D6)`,
    )
  return shift
}

export async function makeDay(ctx: Ctx, date: string, standing: Standing): Promise<DayPlan> {
  const shift = await takeShift(ctx, date)
  const world = await readWorld(ctx)
  const carried = await findCarried(ctx, date, standing)
  const plan = planDay({
    tenantId: ctx.tenantId,
    date,
    shift: shift || undefined,
    shops: world.shops,
    items: world.items,
    repBeats: standing.repBeats,
    creditShops: standing.creditShops,
    slotShops: standing.slotShops,
    carried,
  })
  ctx.log(`  plan for ${date}: ${JSON.stringify(planCounts(plan))}`)
  for (const slot of plan.emptySlots)
    ctx.summary.refusedOne(sectionOf(slot), `order ${slot}`, 'no shop or no priced item in stock')

  for (const order of plan.orders) await placeOrder(ctx, order, date)

  const tripOrders = plan.orders.filter((o) => o.slot.startsWith('t') || o.slot.startsWith('l'))
  await wave(
    ctx,
    date,
    'trips',
    tripOrders.map((o) => o.id),
    'packed',
  )
  await wave(
    ctx,
    date,
    'to-pack',
    plan.orders.filter((o) => o.slot.startsWith('k')).map((o) => o.id),
    'picked',
  )
  await wave(
    ctx,
    date,
    'to-pick',
    plan.orders.filter((o) => o.slot.startsWith('w')).map((o) => o.id),
    'open',
  )

  for (const driver of ['driver1', 'driver2'] as const)
    await planTrip(ctx, date, driver, plan, standing)
  await vanToLoad(ctx, date, plan, standing)
  await returnToApprove(ctx, date)
  await officeMoney(ctx, date)
  await supplierBills(ctx, date, world)
  return plan
}
