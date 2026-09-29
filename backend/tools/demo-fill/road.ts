import { contract } from '@dos/contracts'
import type { Ctx } from './context.js'
import { SIGNATURE_PNG, digitsFrom, istTime, maybe } from './helpers.js'
import { demoId, demoKey, unit } from './ids.js'
import { TRIP_DOORS, type DoorOutcome } from './plan.js'

/**
 * THE ROAD: a van loaded, out, door by door, back and settled — each step done by the person who does it in
 * the app (the godown loads, the manager signs the load sheet off, the driver departs and works the doors, the
 * accountant settles). Every function reads the trip first and does only what is still to do, so a second
 * run, or a run after a crash, picks up where the last one stopped.
 */

export type DriverKey = 'driver1' | 'driver2'

const BANKS = ['Saraswat Bank', 'Cosmos Bank', 'TJSB Sahakari Bank', 'Kalyan Janata Sahakari Bank']

const TERMINAL_STOPS = new Set(['delivered', 'partial', 'failed', 'skipped'])

type Trip = NonNullable<Awaited<ReturnType<typeof readTrip>>>
export function readTrip(ctx: Ctx, id: string) {
  return maybe(ctx.read(contract.delivery.trips.get, { id })).then((r) => r?.item ?? null)
}

/** The outcome a door of a van ends the day with, by its place on the route. */
export function doorOutcome(driver: DriverKey, sequence: number): DoorOutcome {
  return TRIP_DOORS[driver][sequence - 1] ?? 'credit'
}

/**
 * Get a planned or loading trip onto the road: loading started by the godown, every draft sheet that carries
 * one of its bills signed off by the manager and counted out by the godown, a sheet of its own for the bills
 * still on the dock, then the driver departs.
 */
export async function loadAndDepart(
  ctx: Ctx,
  tripId: string,
  driver: DriverKey,
  date: string,
): Promise<void> {
  let trip = await readTrip(ctx, tripId)
  if (!trip) return
  if (trip.state === 'planned') {
    await ctx.write('driver', 'loading started', () => ctx.as('godown'), contract.delivery.trips.startLoading, {
      idempotencyKey: demoKey(date, 'trip', tripId, 'loading'),
      id: tripId,
    })
    trip = (await readTrip(ctx, tripId)) ?? trip
  }
  if (trip.state !== 'loading') return

  // Which of the trip's bills are still on the dock (their order is `packed`), and which draft sheet holds each.
  const orderIds = [
    ...new Set(
      trip.stops.flatMap((s) => s.deliveries.map((d) => d.orderId)).filter((o): o is string => !!o),
    ),
  ]
  const packed: string[] = []
  for (const orderId of orderIds) {
    const order = await maybe(ctx.read(contract.orders.get, { id: orderId }))
    if (order?.item.state === 'packed') packed.push(orderId)
  }
  const drafts = await ctx.read(contract.warehouse.loadSheets.list, { status: 'draft', limit: 200 })
  const onDraft = new Map<string, string>()
  for (const s of drafts.items) {
    const sheet = await ctx.read(contract.warehouse.loadSheets.get, { id: s.id })
    for (const o of sheet.item.orders) onDraft.set(o.orderId, s.id)
  }
  const ownSheet = demoId(date, 'sheet', tripId)
  const loose = packed.filter((o) => !onDraft.has(o))
  if (loose.length > 0 && !(await maybe(ctx.read(contract.warehouse.loadSheets.get, { id: ownSheet })))) {
    const made = await ctx.write('godown', 'load sheet', () => ctx.as('godown'), contract.warehouse.loadSheets.create, {
      idempotencyKey: demoKey(date, 'sheet', tripId),
      id: ownSheet,
      toLocationId: trip.vehicleLocationId,
      tripId,
      sheetDate: date,
      orderIds: loose,
    })
    if (made) for (const o of loose) onDraft.set(o, ownSheet)
  }
  const sheets = [...new Set(packed.map((o) => onDraft.get(o)).filter((s): s is string => !!s))]
  for (const sheetId of sheets) await signOffAndLoad(ctx, sheetId, date)

  trip = (await readTrip(ctx, tripId)) ?? trip
  if (trip.state !== 'loading') return
  await ctx.write('driver', 'departed', () => ctx.as(driver), contract.delivery.trips.depart, {
    idempotencyKey: demoKey(date, 'trip', tripId, 'depart'),
    id: tripId,
    occurredAt: new Date().toISOString(),
  })
}

/** The manager signs a draft sheet off; the godown counts the packages out and the challan is issued. */
export async function signOffAndLoad(ctx: Ctx, sheetId: string, date: string): Promise<void> {
  const sheet = await maybe(ctx.read(contract.warehouse.loadSheets.get, { id: sheetId }))
  if (!sheet || sheet.item.status !== 'draft') return
  if (!sheet.item.approvedAt)
    await ctx.write('manager', 'load sheet signed off', () => ctx.as('manager'), contract.warehouse.loadSheets.approve, {
      idempotencyKey: demoKey(date, 'sheet', sheetId, 'approve'),
      id: sheetId,
    })
  await ctx.write('godown', 'van loaded', () => ctx.as('godown'), contract.warehouse.loadSheets.confirm, {
    idempotencyKey: demoKey(date, 'sheet', sheetId, 'confirm'),
    id: sheetId,
    countedPackages: sheet.item.expectedPackages,
    challanId: demoId(date, 'challan', sheetId),
  })
}

/**
 * Work the doors of an active trip, each to the outcome its place on the route says: paid in cash, UPI or
 * by cheque, part delivered, refused, delivered on credit, or not yet visited. `finish` delivers every door
 * still open in full, on credit — the crew's last round before it checks in.
 */
export async function workDoors(
  ctx: Ctx,
  tripId: string,
  driver: DriverKey,
  date: string,
  finish = false,
): Promise<void> {
  const trip = await readTrip(ctx, tripId)
  if (!trip || trip.state !== 'active') return
  const collected = new Set(trip.collections.map((c) => c.id))
  const stops = [...trip.stops].sort((a, b) => a.sequence - b.sequence)
  for (const stop of stops) {
    const planned = doorOutcome(driver, stop.sequence)
    const outcome: DoorOutcome = finish && planned === 'pending' ? 'credit' : planned
    if (outcome === 'pending') continue
    if (!TERMINAL_STOPS.has(stop.state)) await deliverDoor(ctx, trip, stop, driver, outcome, date)
    if (outcome === 'cash' || outcome === 'upi' || outcome === 'cheque') {
      const id = demoId(date, 'collection', stop.id)
      if (!collected.has(id)) await takeMoney(ctx, trip, stop, driver, outcome, date)
    }
  }
}

async function deliverDoor(
  ctx: Ctx,
  trip: Trip,
  stop: Trip['stops'][number],
  driver: DriverKey,
  outcome: Exclude<DoorOutcome, 'pending'>,
  date: string,
): Promise<void> {
  const as = (): ReturnType<Ctx['as']> => ctx.as(driver)
  if (stop.state === 'pending')
    await ctx.write('driver', 'door started', as, contract.delivery.stops.start, {
      idempotencyKey: demoKey(date, 'stop', stop.id, 'start'),
      id: stop.id,
    })
  if (stop.state === 'pending' || stop.state === 'started')
    await ctx.write('driver', 'arrived at door', as, contract.delivery.stops.arrive, {
      idempotencyKey: demoKey(date, 'stop', stop.id, 'arrive'),
      id: stop.id,
    })
  for (const planned of stop.deliveries) {
    if (planned.outcome !== null) continue
    const bill = await ctx.read(contract.billing.invoices.get, { id: planned.invoiceId })
    const lines = bill.item.lines.map((l, n) => {
      const all = l.qtyPcs + l.freeQtyPcs
      const back =
        outcome === 'refused' ? all : outcome === 'part' && n === 0 ? Math.max(1, Math.floor(all / 3)) : 0
      return {
        id: demoId(date, 'delivery-line', planned.id, String(n)),
        invoiceLineId: l.id,
        deliveredQtyPcs: all - back,
        returnedQtyPcs: back,
        returnedSaleable: true,
        ...(back > 0 ? { reason: 'refused' as const } : {}),
      }
    })
    await ctx.write('driver', `door ${outcome}`, as, contract.delivery.deliveries.record, {
      idempotencyKey: demoKey(date, 'delivery', planned.id),
      id: planned.id,
      tripId: trip.id,
      stopId: stop.id,
      invoiceId: planned.invoiceId,
      receiverName: outcome === 'refused' ? 'Shop owner (did not take)' : 'Shop owner',
      ...(outcome === 'refused' ? { note: 'Shop did not want the goods today' } : {}),
      lines,
      pod: [
        {
          id: demoId(date, 'pod', planned.id),
          kind: 'signature',
          inline: { mimeType: 'image/png', contentBase64: SIGNATURE_PNG },
        },
      ],
    })
  }
}

async function takeMoney(
  ctx: Ctx,
  trip: Trip,
  stop: Trip['stops'][number],
  driver: DriverKey,
  mode: 'cash' | 'upi' | 'cheque',
  date: string,
): Promise<void> {
  // Only the bills on THIS door, and only what each still owes: the money never touches another bill.
  const allocations: { id: string; invoiceId: string; amountPaise: number }[] = []
  for (const d of stop.deliveries) {
    const bill = await ctx.read(contract.billing.invoices.get, { id: d.invoiceId })
    if (bill.item.amountDuePaise > 0)
      allocations.push({
        id: demoId(date, 'allocation', stop.id, d.invoiceId),
        invoiceId: d.invoiceId,
        amountPaise: bill.item.amountDuePaise,
      })
  }
  const amount = allocations.reduce((n, a) => n + a.amountPaise, 0)
  if (amount <= 0) return
  const id = demoId(date, 'collection', stop.id)
  const hex = id.replace(/-/g, '')
  await ctx.write('driver', `paid ${mode}`, () => ctx.as(driver), contract.delivery.collections.record, {
    idempotencyKey: demoKey(date, 'collection', stop.id),
    id,
    receiptId: demoId(date, 'receipt', stop.id),
    tripId: trip.id,
    stopId: stop.id,
    retailerId: stop.retailerId,
    mode,
    amountPaise: amount,
    ...(mode === 'upi' ? { reference: digitsFrom(hex.slice(-15), 12) } : {}),
    ...(mode === 'cheque'
      ? {
          reference: digitsFrom(hex.slice(-12), 6),
          chequeDate: date,
          bankName: BANKS[Math.floor(unit(id) * BANKS.length)] ?? 'Saraswat Bank',
        }
      : {}),
    allocations,
  })
}

/** Back at the godown: the driver checks in. */
export async function returnTrip(ctx: Ctx, tripId: string, driver: DriverKey, date: string): Promise<void> {
  const trip = await readTrip(ctx, tripId)
  if (!trip || trip.state !== 'active') return
  await ctx.write('driver', 'checked in', () => ctx.as(driver), contract.delivery.trips.return, {
    idempotencyKey: demoKey(date, 'trip', tripId, 'return'),
    id: tripId,
    occurredAt: new Date().toISOString(),
  })
}

/**
 * The accountant settles a trip that has checked in: exactly the cash the cockpit expects is handed over and
 * every piece the van still holds is counted back, so the settlement carries no variance.
 */
export async function settleTrip(ctx: Ctx, tripId: string, date: string): Promise<void> {
  const trip = await readTrip(ctx, tripId)
  if (!trip || trip.state !== 'closing') return
  const preview = await ctx.read(contract.delivery.trips.settlementPreview, { id: tripId })
  await ctx.write('accountant', 'trip settled', () => ctx.as('accounts'), contract.delivery.trips.settle, {
    idempotencyKey: demoKey(date, 'trip', tripId, 'settle'),
    id: demoId(date, 'settlement', tripId),
    tripId,
    handedOverCashPaise: preview.expectedCashPaise,
    counted: preview.expectedVanStock.map((l) => ({ lotId: l.lotId, countedPcs: l.expectedPcs })),
    note: 'Cash and returns counted at the godown',
  })
}

/** Stand-alone day time for a door, for readable timestamps. */
export function doorTime(date: string, sequence: number): string {
  return istTime(date, 10 + Math.floor(sequence / 2), (sequence % 2) * 30)
}
