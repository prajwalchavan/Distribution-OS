/**
 * Vehicles, trips, stops, deliveries, POD, collections and settlements — ADR 0013.
 *
 * Migration 0014/0015 (delivery database slice) changed what a row must carry, and this seed with it:
 *   - every `deliveries` row names its shop (`retailer_id`, copied from the stop — the column the
 *     shopkeeper's read policy keys on) and the phone that recorded it (`device_id`);
 *   - every `trip_points` row names its phone: today's active trip is tracked from TWO devices, the
 *     driver's and the helper's, so `trip_points_dedupe_idx` (tenant, trip, device, time) and the
 *     two-phone case of ADR 0012 are exercised; a re-seed against a database migrated with '' device ids
 *     stamps the demo rows with the right phone;
 *   - a settlement closed WITH a variance carries the owner's approval (`approved_by` / `approved_at`,
 *     enforced by `dos_trip_settlement_guard`) and the matching `approvals` row of kind
 *     `trip_settlement`, decided by the owner; its cash arithmetic (`variance = handed over − expected`)
 *     is exact, and its `stock_variance` names a lot that did not tally;
 *   - each crew member holds a granted `location_consents` row, which `trips.depart` requires (DPDP;
 *     docs/plans/delivery.md §4 rule 11).
 *
 * Which day's loads rode which vehicle is decided once, in `trip-plan.ts`, and shared with the
 * warehouse seed. The stops say what the order book already knows (`OrderRecord.stopOutcome`):
 * delivered, part-delivered with a short count, or failed with a reason and the goods back on the
 * dock. Money taken at the door is the receipt the sales seed already wrote for that bill; this seed
 * pins it to the trip and files the `collections` row, so a settlement's arithmetic ties.
 *
 * The ids of what this seed creates are deterministic (`demoId`) and exposed twice: as the `demo*Id`
 * helpers below and as the returned `DeliveryResult`.
 */
import { insertMany } from './db-helpers.js'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  approvals,
  collections,
  deliveries,
  deliveryLines,
  locationConsents,
  locations,
  podEvidence,
  stockLots,
  tripExpenses,
  tripPoints,
  tripSettlements,
  tripStops,
  trips,
  vehiclePositions,
  vehicles,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { DEFAULT_SETTLEMENT_TOLERANCE_PAISE } from '../tenant-bootstrap.js'
import { currentDemoScope, demoId } from './ids.js'
import type { PeopleResult, PersonRef } from './people.js'
import type { InvoiceRecord, OrderRecord, SalesResult, StopOutcome } from './sales.js'
import type { RetailersResult } from './retailers.js'
import {
  activeTripId,
  bucketise,
  tripIdFor,
  vehiclesForDay,
  type DemoVehicleKey,
} from './trip-plan.js'
import { vehicleRegNos } from './warehouse.js'
import {
  atIstTime,
  daysAgo,
  isoDate,
  jitter,
  makeRng,
  nth,
  occurred,
  occurredSeries,
  previousWorkingDay,
  randChance,
  randInt,
  TODAY,
  workingDaysBack,
} from './util.js'

export { activeTripId, type DemoVehicleKey } from './trip-plan.js'

const DEPOT = { lat: 19.2455, lng: 73.1305 }

/** The crew's phones (`trip_points.device_id`, `deliveries.device_id`), one per delivery user. */
export const DEMO_DEVICES = {
  ganesh: 'demo-device-ganesh',
  raju: 'demo-device-raju',
  santosh: 'demo-device-santosh',
  iqbal: 'demo-device-iqbal',
  tanaji: 'demo-device-tanaji',
  mahesh: 'demo-device-mahesh',
} as const

/** The version of the GPS notice every demo crew member has acknowledged (`location_consents`). */
export const DEMO_GPS_NOTICE_VERSION = 'gps-notice-2026-09'

export const demoVehicleId = (key: string): string => demoId('vehicle', key)
export const demoVehicleLocationId = (key: string): string => demoId('location-vehicle', key)
/** A settled trip of an earlier working day on one vehicle. */
export const demoTripId = (day: Date, vehicleKey: string): string =>
  demoId('trip', `${isoDate(day)}:${vehicleKey}`)
export const demoStopId = (tripId: string, sequence: number): string =>
  demoId('trip-stop', `${tripId}:${sequence}`)
export const demoDeliveryId = (tripId: string, invoiceId: string): string =>
  demoId('delivery', `${tripId}:${invoiceId}`)
export const demoTripSettlementId = (tripId: string): string => demoId('trip-settlement', tripId)

/** Why a stop failed, in the order the failures land. */
const FAILURE_REASONS = ['shop_closed', 'refused', 'no_cash', 'wrong_address'] as const
const FAILURE_NOTES: Record<(typeof FAILURE_REASONS)[number], string> = {
  shop_closed: 'Shutter down at 11:40; neighbour said owner is out of town',
  refused: 'Shopkeeper refused the load: wants the old bill settled first',
  no_cash: 'Cash-only shop had no cash; will pay on the next visit',
  wrong_address: 'New shop, address on the beat card is the old premises',
}
/**
 * A part-delivery: the shop took the load minus what it refused at the door, and why — the shelf
 * was full, the money was not there for all of it, the carton was crushed, the batch was too close
 * to its date, or the count came up short. In the order the short stops land.
 */
const PARTIAL_REASONS: readonly {
  reason: 'refused' | 'no_cash' | 'damaged_goods' | 'other'
  note: string
}[] = [
  { reason: 'refused', note: 'refused: no room on the shelf, took the rest' },
  { reason: 'damaged_goods', note: 'refused at the door, outer carton crushed' },
  { reason: 'no_cash', note: 'taken short: shop paid for what it could and sent the rest back' },
  { reason: 'refused', note: 'refused: batch closer to expiry than the last lot' },
  { reason: 'other', note: 'short in the carton on the doorstep count' },
  { reason: 'refused', note: 'refused: wrong size loaded, wanted the smaller pack' },
]

export interface DemoVehicle {
  key: DemoVehicleKey
  id: string
  regNo: string
  name: string
  locationId: string
  driver: PersonRef
  helper: PersonRef
  driverDeviceId: string
  helperDeviceId: string
}

export interface DemoStop {
  id: string
  tripId: string
  sequence: number
  retailerId: string
  invoiceId: string
  state: 'delivered' | 'partial' | 'arrived' | 'started' | 'pending' | 'failed'
  /** Present when the stop produced a `deliveries` row. */
  deliveryId: string | null
}

export interface DemoTrip {
  id: string
  tripNo: string
  tripDate: string
  vehicle: DemoVehicle
  state: 'active' | 'settled' | 'settled_with_variance'
  stops: DemoStop[]
  /** Set on settled trips. */
  settlementId: string | null
}

export interface DeliveryResult {
  vehicles: DemoVehicle[]
  activeTrip: DemoTrip
  settledTrips: DemoTrip[]
  /** The one trip closed with a variance the owner accepted (and its `approvals` row). */
  varianceTrip: DemoTrip | null
  varianceApprovalId: string | null
  /** `location_consents` ids per crew member. */
  consentIds: Record<keyof PeopleResult['delivery'], string>
  devices: typeof DEMO_DEVICES
}

interface VehicleDef {
  key: DemoVehicleKey
  regNo: string
  name: string
  kind: string
  capacityCases: number
  driverId: string
  helperId: string
  driver: PersonRef
  helper: PersonRef
  driverDeviceId: string
  helperDeviceId: string
}

export interface SeedDeliveryOptions {
  historyDays?: number
}

export async function seedDelivery(
  db: Db,
  tenantId: string,
  retailersRes: RetailersResult,
  sales: SalesResult,
  people: PeopleResult,
  opts: SeedDeliveryOptions = {},
): Promise<DeliveryResult> {
  const historyDays = opts.historyDays ?? 90
  const rng = makeRng('dos-demo:delivery')
  const outcomeRng = makeRng('dos-demo:delivery:outcomes')
  const retailerById = new Map(retailersRes.retailers.map((r) => [r.id, r]))

  // The loader's crew are the two newest drivers where the roster has them (the pilot); a smaller
  // distributor runs its third vehicle with the second crew.
  const extraCrew = people.extra.filter((p) => p.role === 'delivery')
  const loaderDriver = extraCrew[0] ?? people.delivery.santosh
  const loaderHelper = extraCrew[1] ?? people.delivery.iqbal
  const regNos = vehicleRegNos(currentDemoScope())
  const vehicleDefs: VehicleDef[] = [
    {
      key: 'tempo',
      regNo: regNos.tempo,
      name: 'Tempo 1',
      kind: 'tempo',
      capacityCases: 150,
      driverId: people.delivery.ganesh.id,
      helperId: people.delivery.raju.id,
      driver: people.delivery.ganesh,
      helper: people.delivery.raju,
      driverDeviceId: DEMO_DEVICES.ganesh,
      helperDeviceId: DEMO_DEVICES.raju,
    },
    {
      key: 'three-wheeler',
      regNo: regNos['three-wheeler'],
      name: 'Loader 1',
      kind: 'three_wheeler',
      capacityCases: 60,
      driverId: people.delivery.santosh.id,
      helperId: people.delivery.iqbal.id,
      driver: people.delivery.santosh,
      helper: people.delivery.iqbal,
      driverDeviceId: DEMO_DEVICES.santosh,
      helperDeviceId: DEMO_DEVICES.iqbal,
    },
    {
      key: 'loader',
      regNo: regNos.loader,
      name: 'Loader 2',
      kind: 'loader',
      capacityCases: 90,
      driverId: loaderDriver.id,
      helperId: loaderHelper.id,
      driver: loaderDriver,
      helper: loaderHelper,
      driverDeviceId: extraCrew[0] ? DEMO_DEVICES.tanaji : DEMO_DEVICES.santosh,
      helperDeviceId: extraCrew[1] ? DEMO_DEVICES.mahesh : DEMO_DEVICES.iqbal,
    },
  ]
  const vehicleLocId = demoVehicleLocationId
  const vehicleRowId = demoVehicleId
  const demoVehicles: DemoVehicle[] = vehicleDefs.map((v) => ({
    key: v.key,
    id: vehicleRowId(v.key),
    regNo: v.regNo,
    name: v.name,
    locationId: vehicleLocId(v.key),
    driver: v.driver,
    helper: v.helper,
    driverDeviceId: v.driverDeviceId,
    helperDeviceId: v.helperDeviceId,
  }))
  const vehicleDef = (key: DemoVehicleKey): VehicleDef => {
    const v = vehicleDefs.find((d) => d.key === key)
    if (!v) throw new Error(`no demo vehicle ${key}`)
    return v
  }
  const demoVehicle = (key: DemoVehicleKey): DemoVehicle => {
    const v = demoVehicles.find((d) => d.key === key)
    if (!v) throw new Error(`no demo vehicle ${key}`)
    return v
  }

  // The GPS notice, acknowledged once per crew member per tenant: `trips.depart` refuses a driver
  // without a granted row (DPDP, delivery §4 rule 11). Consent is evidence of the notice, never a lock —
  // a denied OS permission on the phone does not stop a trip.
  const crew = people.delivery
  const consentIds = {
    ganesh: demoId('location-consent', `${tenantId}:${crew.ganesh.id}`),
    raju: demoId('location-consent', `${tenantId}:${crew.raju.id}`),
    santosh: demoId('location-consent', `${tenantId}:${crew.santosh.id}`),
    iqbal: demoId('location-consent', `${tenantId}:${crew.iqbal.id}`),
  }
  const consentRows = [
    ...(Object.keys(consentIds) as (keyof typeof consentIds)[]).map((key) => ({
      id: consentIds[key],
      userId: crew[key].id,
    })),
    ...extraCrew.map((p) => ({
      id: demoId('location-consent', `${tenantId}:${p.id}`),
      userId: p.id,
    })),
  ]
  await insertMany(
    db,
    locationConsents,
    consentRows.map((c) => ({
      id: c.id,
      userId: c.userId,
      tenantId,
      policyVersion: DEMO_GPS_NOTICE_VERSION,
      locale: 'en-IN',
      granted: true,
      grantedAt: atIstTime(daysAgo(30), 9, 0),
      evidence: { source: 'demo', app: 'delivery', noticeVersion: DEMO_GPS_NOTICE_VERSION },
    })),
  )

  await insertMany(
    db,
    locations,
    vehicleDefs.map((v) => ({
      id: vehicleLocId(v.key),
      tenantId,
      kind: 'vehicle' as const,
      name: `Vehicle ${v.regNo}`,
      vehicleId: vehicleRowId(v.key),
    })),
  )

  await insertMany(
    db,
    vehicles,
    vehicleDefs.map((v) => ({
      id: vehicleRowId(v.key),
      tenantId,
      regNo: v.regNo,
      name: v.name,
      kind: v.kind,
      capacityCases: v.capacityCases,
      locationId: vehicleLocId(v.key),
    })),
  )

  // Every attempt at a door, bucketed by the calendar day it was made, in order-book order. An order
  // whose first attempt failed is on two days: the failed stop and the delivery two days later.
  interface Attempt {
    inv: InvoiceRecord
    order: OrderRecord
    outcome: StopOutcome
    /** Still on the tempo right now (today's active trip). */
    onRoad: boolean
  }
  const orderById = new Map(sales.orders.map((o) => [o.id, o]))
  const attemptsByDay = new Map<string, Attempt[]>()
  for (const inv of sales.invoices) {
    const order = orderById.get(inv.orderId)
    if (!order || order.stops.length === 0) continue
    order.stops.forEach((stop) => {
      const key = isoDate(stop.day)
      const arr = attemptsByDay.get(key) ?? []
      arr.push({ inv, order, outcome: stop.outcome, onRoad: stop.outcome === 'on_road' })
      attemptsByDay.set(key, arr)
    })
  }
  const shortByInvoiceLineId = new Map(
    sales.shortDeliveries.map((s) => [s.invoiceLineId, s.shortPcs]),
  )

  const tripRows: (typeof trips.$inferInsert)[] = []
  const stopRows: (typeof tripStops.$inferInsert)[] = []
  const deliveryRows: (typeof deliveries.$inferInsert)[] = []
  const deliveryLineRows: (typeof deliveryLines.$inferInsert)[] = []
  const podRows: (typeof podEvidence.$inferInsert)[] = []
  const collectionRows: (typeof collections.$inferInsert)[] = []
  const expenseRows: (typeof tripExpenses.$inferInsert)[] = []
  const settlementRows: (typeof tripSettlements.$inferInsert)[] = []
  const receiptTripUpdates: { receiptId: string; tripId: string }[] = []
  const tripPointRows: (typeof tripPoints.$inferInsert)[] = []
  const approvalRows: (typeof approvals.$inferInsert)[] = []
  let activeTripStopsForPositions: { lat: number; lng: number }[] = []
  /** Cash and UPI actually taken per trip, so a settlement's arithmetic ties to its collections. */
  const takenByTrip = new Map<string, { cashPaise: number; upiPaise: number }>()
  const taken = (tripId: string, mode: 'cash' | 'upi', amountPaise: number): void => {
    const t = takenByTrip.get(tripId) ?? { cashPaise: 0, upiPaise: 0 }
    if (mode === 'cash') t.cashPaise += amountPaise
    else t.upiPaise += amountPaise
    takenByTrip.set(tripId, t)
  }
  const demoStops: DemoStop[] = []
  const demoTrips: DemoTrip[] = []
  let failureSeq = 0
  let partialSeq = 0

  /** The receipt the crew took at this door, pinned to the trip it came home on. */
  function collectAtDoor(inv: InvoiceRecord, tripId: string, collector: string): void {
    const door = inv.doorReceipt
    if (!door) return
    receiptTripUpdates.push({ receiptId: door.receiptId, tripId })
    collectionRows.push({
      id: demoId('collection', `${tripId}:${inv.id}`),
      tenantId,
      tripId,
      retailerId: inv.retailerId,
      receiptId: door.receiptId,
      mode: door.mode,
      amountPaise: door.amountPaise,
      collectedBy: collector,
      collectedAt: occurred(atIstTime(inv.invoiceDate, 17, 0)),
    })
    taken(tripId, door.mode, door.amountPaise)
  }

  function addStop(
    tripId: string,
    sequence: number,
    inv: InvoiceRecord,
    state: DemoStop['state'],
    day: Date,
    completedAt: Date | null,
    driverId: string,
    deviceId: string,
  ): void {
    const retailer = retailerById.get(inv.retailerId)
    const stopId = demoStopId(tripId, sequence)
    const stop: DemoStop = {
      id: stopId,
      tripId,
      sequence,
      retailerId: inv.retailerId,
      invoiceId: inv.id,
      state,
      deliveryId: null,
    }
    demoStops.push(stop)
    const failureReason =
      state === 'failed' ? nth(FAILURE_REASONS, failureSeq++ % FAILURE_REASONS.length) : null
    const shortLine = inv.lines.find((l) => shortByInvoiceLineId.has(l.invoiceLineId))
    const shortPcs = shortLine ? (shortByInvoiceLineId.get(shortLine.invoiceLineId) ?? 0) : 0
    const partial =
      state === 'partial' ? nth(PARTIAL_REASONS, partialSeq++ % PARTIAL_REASONS.length) : null
    const partialNote =
      partial && shortLine ? `${shortPcs} pcs ${partial.note}` : (partial?.note ?? null)
    stopRows.push({
      id: stopId,
      tenantId,
      tripId,
      sequence,
      retailerId: inv.retailerId,
      state,
      failureReason: failureReason ?? partial?.reason ?? null,
      failureNote: failureReason ? FAILURE_NOTES[failureReason] : partialNote,
      createdAt: occurred(atIstTime(day, 8, 30)),
      plannedCollectionPaise: inv.totalPaise,
      etaAt: atIstTime(day, 9 + Math.floor((sequence - 1) / 2), ((sequence - 1) % 2) * 30),
      startedAt: occurred(
        atIstTime(day, 9 + Math.floor((sequence - 1) / 2), ((sequence - 1) % 2) * 30),
      ),
      arrivedAt:
        state === 'pending'
          ? null
          : occurred(
              atIstTime(day, 9 + Math.floor((sequence - 1) / 2), ((sequence - 1) % 2) * 30 + 10),
            ),
      completedAt: completedAt ? occurred(completedAt) : null,
      arrivedLat: retailer ? jitter(rng, retailer.lat, 0.0005) : null,
      arrivedLng: retailer ? jitter(rng, retailer.lng, 0.0005) : null,
    })
    if (retailer) activeTripStopsForPositions.push({ lat: retailer.lat, lng: retailer.lng })

    if (state === 'failed') {
      // the goods came back: a `deliveries` row with the failed outcome, no lines, no POD
      const deliveryId = demoDeliveryId(tripId, inv.id)
      stop.deliveryId = deliveryId
      deliveryRows.push({
        id: deliveryId,
        tenantId,
        tripId,
        stopId,
        retailerId: inv.retailerId,
        orderId: inv.orderId,
        invoiceId: inv.id,
        outcome: 'failed',
        deliveredBy: driverId,
        deliveredAt: occurred(
          atIstTime(day, 9 + Math.floor((sequence - 1) / 2), ((sequence - 1) % 2) * 30 + 25),
        ),
        deviceId,
        idempotencyKey: `delivery:${tripId}:${inv.id}`,
        note: failureReason ? FAILURE_NOTES[failureReason] : null,
      })
      return
    }
    if (state !== 'delivered' && state !== 'partial') return
    const outcome = state === 'partial' ? ('partial' as const) : ('delivered' as const)
    const deliveryId = demoDeliveryId(tripId, inv.id)
    stop.deliveryId = deliveryId
    deliveryRows.push({
      id: deliveryId,
      tenantId,
      tripId,
      stopId,
      // the stop's shop, denormalised: `dos_deliveries_retailer_guard` refuses any other value
      retailerId: inv.retailerId,
      orderId: inv.orderId,
      invoiceId: inv.id,
      outcome,
      deliveredBy: driverId,
      deliveredAt: completedAt ? occurred(completedAt) : null,
      receiverName: retailer?.ownerName ?? 'Shop staff',
      deviceId,
      idempotencyKey: `delivery:${tripId}:${inv.id}`,
    })
    inv.lines.forEach((l, i) => {
      const returned = outcome === 'partial' ? (shortByInvoiceLineId.get(l.invoiceLineId) ?? 0) : 0
      deliveryLineRows.push({
        id: demoId('delivery-line', `${tripId}:${inv.id}:${i}`),
        tenantId,
        deliveryId,
        invoiceLineId: l.invoiceLineId,
        deliveredQtyPcs: l.pickedQtyPcs + l.freeQtyPcs - returned,
        returnedQtyPcs: returned,
        returnedSaleable: returned > 0,
        reason: returned > 0 ? (partialNote ?? 'Short at doorstep count') : null,
      })
    })
    podRows.push({
      id: demoId('pod', `${tripId}:${inv.id}`),
      tenantId,
      deliveryId,
      kind: 'photo' as const,
      objectKey: `demo/pod/${tripId}/${inv.id}.jpg`,
      capturedAt: occurred(completedAt ?? atIstTime(day, 17, 0)),
    })
    collectAtDoor(inv, tripId, driverId)
  }

  // One lot the variance settlement reports as miscounted (any non-zero stock variance is red).
  const [miscountedLot] = await db
    .select({ id: stockLots.id })
    .from(stockLots)
    .where(eq(stockLots.tenantId, tenantId))
    .orderBy(stockLots.id)
    .limit(1)

  function settleTrip(
    tripId: string,
    hasVariance: boolean,
    openingCashPaise: number,
    settledAt: Date,
    driverId: string,
  ): string {
    const dieselPaise = 30_000 + randInt(rng, 0, 10_000)
    expenseRows.push({
      id: demoId('trip-expense', `${tripId}:diesel`),
      tenantId,
      tripId,
      kind: 'diesel',
      amountPaise: dieselPaise,
      recordedBy: driverId,
    })
    let tollPaise = 0
    if (randChance(rng, 0.4)) {
      tollPaise = 5_000 + randInt(rng, 0, 10_000)
      expenseRows.push({
        id: demoId('trip-expense', `${tripId}:toll`),
        tenantId,
        tripId,
        kind: 'toll',
        amountPaise: tollPaise,
        recordedBy: driverId,
      })
    }
    const expensesTotal = dieselPaise + tollPaise
    const took = takenByTrip.get(tripId) ?? { cashPaise: 0, upiPaise: 0 }
    // expected cash = float + cash taken − cash spent (UPI is reported, never netted); a red settlement
    // is ₹442–₹450 short (beyond the ₹100 tolerance) AND one lot miscounted, so both variance paths show.
    const expected = openingCashPaise + took.cashPaise - expensesTotal
    const variance = hasVariance
      ? -(DEFAULT_SETTLEMENT_TOLERANCE_PAISE + 34_200 + randInt(rng, 0, 800))
      : 0
    const stockVariance =
      hasVariance && miscountedLot
        ? [{ lotId: miscountedLot.id, expectedPcs: 24, countedPcs: 22 }]
        : []
    const settlementId = demoTripSettlementId(tripId)
    settlementRows.push({
      id: settlementId,
      tenantId,
      tripId,
      expectedCashPaise: expected,
      handedOverCashPaise: expected + variance,
      cashVariancePaise: variance,
      upiCollectedPaise: took.upiPaise,
      expensesPaise: expensesTotal,
      stockVariance,
      hasVariance,
      settledBy: people.accountant.id,
      settledAt,
      // the owner accepted the red settlement (`dos_trip_settlement_guard` insists on it)
      approvedBy: hasVariance ? people.owner.id : null,
      approvedAt: hasVariance ? new Date(settledAt.getTime() + 20 * 60_000) : null,
      note: hasVariance
        ? 'Cash short beyond tolerance and one case of 24 counted 22; owner accepted'
        : null,
    })
    if (hasVariance) {
      approvalRows.push({
        id: demoId('approval', `trip-settlement:${tripId}`),
        tenantId,
        kind: 'trip_settlement',
        entityType: 'trip',
        entityId: tripId,
        requestedBy: people.accountant.id,
        status: 'approved',
        payload: {
          settlementId,
          expectedCashPaise: expected,
          handedOverCashPaise: expected + variance,
          cashVariancePaise: variance,
          tolerancePaise: DEFAULT_SETTLEMENT_TOLERANCE_PAISE,
          stockVariance,
        },
        decidedBy: people.owner.id,
        decidedAt: new Date(settledAt.getTime() + 20 * 60_000),
        decisionNote:
          'Accepted: crew paid the diesel top-up from the float; case recounted next morning',
        createdAt: settledAt,
      })
    }
    return settlementId
  }

  const days = workingDaysBack(historyDays)
  for (const day of days) {
    const ageDays = Math.round((TODAY.getTime() - day.getTime()) / 86_400_000)
    const dayKey = isoDate(day)

    if (ageDays === 0) {
      // Today's active trip: the tempo left with the previous working day's loads (Saturday's on a
      // Monday). Two are already delivered (their stop is dated today), one is where the crew stands
      // now, the rest are pending.
      const tripId = activeTripId()
      const def = vehicleDef('tempo')
      const onRoad = attemptsByDay.get(isoDate(previousWorkingDay()))?.filter((a) => a.onRoad) ?? []
      const done = attemptsByDay.get(dayKey)?.filter((a) => a.outcome === 'delivered') ?? []
      const stops = [...done, ...onRoad]
      if (stops.length === 0) continue
      tripRows.push({
        id: tripId,
        tenantId,
        tripNo: 'TRIP-ACTIVE',
        tripDate: isoDate(day),
        vehicleId: vehicleRowId(def.key),
        driverId: def.driverId,
        helperId: def.helperId,
        state: 'active' as const,
        plannedStops: stops.length,
        openingCashPaise: 500_000,
        startedAt: occurred(atIstTime(day, 9, 0)),
        createdAt: atIstTime(previousWorkingDay(), 18, 30),
      })
      activeTripStopsForPositions = []
      const firstStop = demoStops.length
      stops.forEach(({ inv }, i) => {
        if (i < done.length) {
          addStop(
            tripId,
            i + 1,
            inv,
            'delivered',
            day,
            atIstTime(day, 9 + Math.floor(i / 2), 20 + (i % 2) * 20),
            def.driverId,
            def.driverDeviceId,
          )
        } else if (i === done.length) {
          addStop(tripId, i + 1, inv, 'arrived', day, null, def.driverId, def.driverDeviceId)
        } else {
          addStop(tripId, i + 1, inv, 'pending', day, null, def.driverId, def.driverDeviceId)
        }
      })
      demoTrips.push({
        id: tripId,
        tripNo: 'TRIP-ACTIVE',
        tripDate: isoDate(day),
        vehicle: demoVehicle(def.key),
        state: 'active',
        stops: demoStops.slice(firstStop),
        settlementId: null,
      })

      // ~200 GPS breadcrumbs along depot -> each reached stop, for the live map: the first 130 from the
      // driver's phone, the last 70 from the helper's (ADR 0012: a crew carries two phones, and the
      // dedupe key is per device).
      const waypoints =
        activeTripStopsForPositions.length > 0
          ? [DEPOT, ...activeTripStopsForPositions]
          : [
              DEPOT,
              { lat: DEPOT.lat + 0.01, lng: DEPOT.lng + 0.006 },
              { lat: DEPOT.lat + 0.004, lng: DEPOT.lng - 0.012 },
              DEPOT,
            ]
      const totalPoints = 200
      const perLeg = Math.max(1, Math.floor(totalPoints / Math.max(1, waypoints.length - 1)))
      let pointSeq = 0
      let clock = atIstTime(day, 9, 0)
      for (let leg = 0; leg < waypoints.length - 1; leg++) {
        const from = nth(waypoints, leg)
        const to = nth(waypoints, leg + 1)
        for (let s = 0; s < perLeg; s++) {
          const t = s / perLeg
          pointSeq += 1
          clock = new Date(clock.getTime() + 45_000)
          const fromHelper = pointSeq > 130
          tripPointRows.push({
            id: demoId('trip-point', `${pointSeq}`),
            tenantId,
            tripId,
            userId: fromHelper ? def.helperId : def.driverId,
            deviceId: fromHelper ? def.helperDeviceId : def.driverDeviceId,
            recordedAt: clock,
            lat: jitter(rng, from.lat + (to.lat - from.lat) * t, 0.0008),
            lng: jitter(rng, from.lng + (to.lng - from.lng) * t, 0.0008),
            accuracyM: 8 + rng() * 6,
            speedMps: 3 + rng() * 6,
            heading: rng() * 360,
            battery: 60 + Math.floor(rng() * 35),
          })
        }
      }
      // a trail that runs past the wall clock is packed into the seconds before now, in order and
      // one second apart: `trip_points_dedupe_idx` keys on the time
      const trail = tripPointRows.filter((p) => p.tripId === tripId)
      occurredSeries(trail.map((p) => p.recordedAt ?? clock)).forEach((at, i) => {
        const point = trail[i]
        if (point) point.recordedAt = at
      })
      const lastPoint = waypoints[waypoints.length - 1] ?? DEPOT
      await insertMany(db, vehiclePositions, [
        {
          tenantId,
          vehicleId: vehicleRowId(def.key),
          tripId,
          lat: lastPoint.lat,
          lng: lastPoint.lng,
          recordedAt: occurred(clock),
        },
      ])
      continue
    }

    // the previous working day: what is still on the road rides today's active trip (above); the
    // rest went out on the loader and came home that evening
    const candidates = (attemptsByDay.get(dayKey) ?? []).filter((a) => !a.onRoad)
    if (candidates.length === 0) continue
    const buckets = bucketise(candidates, vehiclesForDay(day, ageDays, candidates.length), day)
    buckets.forEach(({ key, items: stops }, vi) => {
      if (stops.length === 0) return
      const def = vehicleDef(key)
      const tripId = tripIdFor(day, key, ageDays)
      const hasVariance = outcomeRng() < 0.2
      const firstStop = demoStops.length
      const tripNo = `TRIP-${isoDate(day).replace(/-/g, '')}-${vi + 1}`
      tripRows.push({
        id: tripId,
        tenantId,
        tripNo,
        tripDate: isoDate(day),
        vehicleId: vehicleRowId(def.key),
        driverId: def.driverId,
        helperId: def.helperId,
        state: hasVariance ? ('settled_with_variance' as const) : ('settled' as const),
        plannedStops: stops.length,
        openingCashPaise: 500_000,
        startedAt: atIstTime(day, 9, 0),
        endedAt: atIstTime(day, 18, 0),
        createdAt: atIstTime(day, 8, 30),
      })
      stops.forEach(({ inv, outcome }, i) => {
        const state =
          outcome === 'failed'
            ? ('failed' as const)
            : outcome === 'partial'
              ? ('partial' as const)
              : ('delivered' as const)
        addStop(
          tripId,
          i + 1,
          inv,
          state,
          day,
          state === 'failed' ? null : atIstTime(day, 9 + Math.floor(i / 2), 20 + (i % 2) * 20),
          def.driverId,
          def.driverDeviceId,
        )
      })
      const settlementId = settleTrip(
        tripId,
        hasVariance,
        500_000,
        atIstTime(day, 18, 30),
        def.driverId,
      )
      demoTrips.push({
        id: tripId,
        tripNo,
        tripDate: isoDate(day),
        vehicle: demoVehicle(def.key),
        state: hasVariance ? 'settled_with_variance' : 'settled',
        stops: demoStops.slice(firstStop),
        settlementId,
      })
    })
  }

  await insertMany(db, trips, tripRows)
  await insertMany(db, tripStops, stopRows)
  await insertMany(db, deliveries, deliveryRows)
  await insertMany(db, deliveryLines, deliveryLineRows)
  await insertMany(db, podEvidence, podRows)
  await insertMany(db, collections, collectionRows)
  await insertMany(db, tripExpenses, expenseRows)
  await insertMany(db, tripSettlements, settlementRows)
  // A database seeded by an earlier version keeps ITS settlements (the insert above is a no-op for
  // them), so the owner's decision is filed only for a settlement that is red in the database.
  const redSettlements = new Set(
    (
      await db
        .select({ tripId: tripSettlements.tripId })
        .from(tripSettlements)
        .where(and(eq(tripSettlements.tenantId, tenantId), eq(tripSettlements.hasVariance, true)))
    ).map((r) => r.tripId),
  )
  await insertMany(
    db,
    approvals,
    approvalRows.filter((a) => redSettlements.has(a.entityId)),
  )
  await insertMany(db, tripPoints, tripPointRows)
  // A database migrated with points already in it carries '' as their device (0015's backfill); the
  // insert above is a no-op for those, so stamp the demo rows with the phone they came from.
  for (const deviceId of new Set(tripPointRows.map((p) => p.deviceId))) {
    const rows = tripPointRows.filter((p) => p.deviceId === deviceId)
    const userId = rows[0]?.userId
    if (!userId) continue
    await db
      .update(tripPoints)
      .set({ deviceId, userId })
      .where(
        and(
          eq(tripPoints.tenantId, tenantId),
          eq(tripPoints.deviceId, ''),
          inArray(
            tripPoints.id,
            rows.map((p) => p.id),
          ),
        ),
      )
  }

  if (receiptTripUpdates.length > 0) {
    const values = sql.join(
      receiptTripUpdates.map((u) => sql`(${u.receiptId}, ${u.tripId})`),
      sql`, `,
    )
    await db.execute(sql`
      UPDATE receipts r SET trip_id = v.trip_id
        FROM (VALUES ${values}) AS v(receipt_id, trip_id)
       WHERE r.id = v.receipt_id AND r.tenant_id = ${tenantId} AND r.trip_id IS NULL`)
  }

  // The vehicles that are not on today's active trip are parked at the depot.
  await insertMany(
    db,
    vehiclePositions,
    vehicleDefs
      .filter((v) => v.key !== 'tempo')
      .map((v) => ({
        tenantId,
        vehicleId: vehicleRowId(v.key),
        lat: DEPOT.lat,
        lng: DEPOT.lng,
        recordedAt: atIstTime(previousWorkingDay(), 19, 30),
      })),
  )

  const activeTrip = demoTrips.find((t) => t.state === 'active')
  if (!activeTrip) throw new Error('delivery seed produced no active trip')
  const varianceTrip = demoTrips.find((t) => t.state === 'settled_with_variance') ?? null
  return {
    vehicles: demoVehicles,
    activeTrip,
    settledTrips: demoTrips.filter((t) => t.state !== 'active'),
    varianceTrip,
    varianceApprovalId: varianceTrip
      ? demoId('approval', `trip-settlement:${varianceTrip.id}`)
      : null,
    consentIds,
    devices: DEMO_DEVICES,
  }
}
