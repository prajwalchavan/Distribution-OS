import { contract } from '@dos/contracts'
import type { Ctx } from './context.js'
import { officeMoney, returnToApprove, supplierBills } from './desk.js'
import { billOf, earlier, getOrder, istTime, maybe, pages } from './helpers.js'
import { addDays, demoKey, isDemoId, unit } from './ids.js'
import {
  VAN_LOAD_DOORS,
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
          idempotencyKey: demoKey(date, 'bargain', order.slot),
          id: ctx.id(date, 'bargain', order.slot),
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
      idempotencyKey: demoKey(date, 'order', order.slot, 'create'),
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
      idempotencyKey: demoKey(date, 'order', order.slot, 'submit'),
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
      idempotencyKey: demoKey(date, 'visit', order.slot),
      id: ctx.id(date, 'visit', order.slot),
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
  const id = ctx.id(date, 'wave', name)
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
        idempotencyKey: demoKey(date, 'wave', name),
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
        idempotencyKey: demoKey(date, 'wave', name, 'start'),
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
          idempotencyKey: demoKey(date, 'wave', name, 'pick'),
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
    const bill = door.carried
      ? { id: door.carried.invoiceId, retailerId: door.carried.shopId }
      : door.orderSlot
        ? await billOf(ctx, ctx.id(date, 'order', door.orderSlot))
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
    await addMissingStops(ctx, date, existing.id, await plannedStops(ctx, date, driver, plan), 'driver')
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
  const id = ctx.id(date, 'sheet', 'van-to-load')
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
      idempotencyKey: demoKey(date, 'sheet', 'van-to-load'),
      id,
      toLocationId: van1.locationId,
      tripId,
      sheetDate: tomorrow,
      orderIds: loads.map((l) => l.orderId),
    },
  )
}

/** How many trips of `date` the tool gave a driver it no longer has, and that have left (D6). */
async function formerDriversTrips(ctx: Ctx, date: string): Promise<number> {
  const trips = await pages((cursor) =>
    ctx.read(contract.delivery.trips.list, {
      from: date,
      to: date,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    }),
  )
  return trips.filter(
    (t) =>
      isDemoId(t.id) &&
      ctx.crewDriverOf(t.driverId) === null &&
      t.state !== 'planned' &&
      t.state !== 'cancelled',
  ).length
}

// ------------------------------------------------------------------------------------------- the day

export async function makeDay(ctx: Ctx, date: string, standing: Standing): Promise<DayPlan> {
  const world = await readWorld(ctx)
  const carried = await findCarried(ctx, date, standing)
  const plan = planDay({
    tenantId: ctx.tenantId,
    date,
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

  // D6: a date the tool's former tester logins already made keeps its trips — a trip's driver is fixed when it is
  // planned, and the date's bills ride those trips — so the drivers of today take their first trips the next date.
  const byFormer = await formerDriversTrips(ctx, date)
  if (byFormer > 0)
    ctx.summary.note(
      `${date} was made by tester logins the tool no longer uses (${String(byFormer)} of its trips are theirs, D6): a trip's driver is fixed when it is planned, so the drivers of today take their first trips on the next business date, and the next run has the desk finish these`,
    )
  else
    for (const driver of ['driver1', 'driver2'] as const)
      await planTrip(ctx, date, driver, plan, standing)
  await vanToLoad(ctx, date, plan, standing)
  await returnToApprove(ctx, date)
  await officeMoney(ctx, date)
  await supplierBills(ctx, date, world)
  return plan
}
