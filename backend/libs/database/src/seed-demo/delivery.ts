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
 *   - each of the four crew members holds a granted `location_consents` row, which `trips.depart`
 *     requires (DPDP; docs/plans/delivery.md §4 rule 11).
 *
 * The ids of what this seed creates are deterministic (`demoId`) and exposed twice: as the `demo*Id`
 * helpers below (for the seeds that run after this one — warehouse loads a vehicle, billing bills from
 * one) and as the returned `DeliveryResult` (for the delivery module's own seed extension: van sales,
 * partial deliveries with credit notes, tomorrow's planned trip).
 */
import { insertMany } from './db-helpers.js'
import { and, eq, inArray } from 'drizzle-orm'
import {
  accounts,
  allocations,
  approvals,
  collections,
  deliveries,
  deliveryLines,
  invoices,
  journalEntries,
  journalLines,
  locationConsents,
  locations,
  podEvidence,
  receipts,
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
import { demoId } from './ids.js'
import type { PeopleResult, PersonRef } from './people.js'
import type { InvoiceRecord, SalesResult } from './sales.js'
import type { RetailersResult } from './retailers.js'
import {
  atIstTime,
  daysAgo,
  isoDate,
  jitter,
  makeRng,
  nth,
  randChance,
  randInt,
  TODAY,
  workingDaysBack,
} from './util.js'

const DEPOT = { lat: 19.2455, lng: 73.1305 }

/** The crew's phones (`trip_points.device_id`, `deliveries.device_id`), one per delivery user. */
export const DEMO_DEVICES = {
  ganesh: 'demo-device-ganesh',
  raju: 'demo-device-raju',
  santosh: 'demo-device-santosh',
  iqbal: 'demo-device-iqbal',
} as const

/** The version of the GPS notice every demo crew member has acknowledged (`location_consents`). */
export const DEMO_GPS_NOTICE_VERSION = 'gps-notice-2026-09'

/**
 * Vehicle keys: `tempo` (Tempo 1, Ganesh + Raju) and `three-wheeler` (Loader 1, Santosh + Iqbal). The id
 * helpers take any string so the delivery module's seed extension can add a third vehicle under its own
 * key without touching this file.
 */
export type DemoVehicleKey = 'tempo' | 'three-wheeler'

export const demoVehicleId = (key: string): string => demoId('vehicle', key)
export const demoVehicleLocationId = (key: string): string => demoId('location-vehicle', key)
/** Today's active trip (Tempo 1, out delivering yesterday's bills). */
export const DEMO_ACTIVE_TRIP_ID = demoId('trip', 'active')
/** A settled trip of an earlier working day on one vehicle. */
export const demoTripId = (day: Date, vehicleKey: string): string =>
  demoId('trip', `${isoDate(day)}:${vehicleKey}`)
export const demoStopId = (tripId: string, sequence: number): string =>
  demoId('trip-stop', `${tripId}:${sequence}`)
export const demoDeliveryId = (tripId: string, invoiceId: string): string =>
  demoId('delivery', `${tripId}:${invoiceId}`)
export const demoTripSettlementId = (tripId: string): string => demoId('trip-settlement', tripId)

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

export async function seedDelivery(
  db: Db,
  tenantId: string,
  retailersRes: RetailersResult,
  sales: SalesResult,
  people: PeopleResult,
): Promise<DeliveryResult> {
  const rng = makeRng('dos-demo:delivery')
  const accountRows = await db.select().from(accounts).where(eq(accounts.tenantId, tenantId))
  const accountId = new Map(accountRows.map((a) => [a.code, a.id]))
  const acc = (code: string): string => {
    const id = accountId.get(code)
    if (!id) throw new Error(`chart of accounts missing ${code}; run bootstrapTenant first`)
    return id
  }
  const retailerById = new Map(retailersRes.retailers.map((r) => [r.id, r]))

  const vehicleDefs: VehicleDef[] = [
    {
      key: 'tempo',
      regNo: 'MH-05-AB-1234',
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
      regNo: 'MH-05-CD-5678',
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
  await insertMany(
    db,
    locationConsents,
    (Object.keys(consentIds) as (keyof typeof consentIds)[]).map((key) => ({
      id: consentIds[key],
      userId: crew[key].id,
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

  // Invoices, bucketed by the calendar day they were issued on.
  const invoicesByDay = new Map<string, InvoiceRecord[]>()
  for (const inv of sales.invoices) {
    const key = isoDate(inv.invoiceDate)
    const arr = invoicesByDay.get(key) ?? []
    arr.push(inv)
    invoicesByDay.set(key, arr)
  }
  const shortPcsByInvoiceId = new Map(sales.shortDeliveries.map((s) => [s.invoiceId, s.shortPcs]))
  const usedInvoiceIds = new Set<string>()

  // Bills that already carry money from ANYWHERE but this seed's own doorstep receipt. On a fresh
  // database this is empty (delivery runs before billing and receivables, which then see the bills it
  // paid as paid and leave them alone). On a database seeded before this seed collected at the door,
  // the receivables seed has since settled some of the bills the draw below would pick — booking a
  // second full payment against those double-allocates them and breaks the books (the rollup nets
  // more than the AR account). So the door collects only where nobody else has.
  const doorAllocationId = (invoiceId: string): string => demoId('allocation', `trip:${invoiceId}`)
  const settledElsewhere = new Set(
    (
      await db
        .select({ id: allocations.id, invoiceId: allocations.invoiceId })
        .from(allocations)
        .where(
          and(
            eq(allocations.tenantId, tenantId),
            inArray(
              allocations.invoiceId,
              sales.invoices.map((inv) => inv.id),
            ),
          ),
        )
    )
      .filter((a) => a.id !== doorAllocationId(a.invoiceId))
      .map((a) => a.invoiceId),
  )

  const tripRows: (typeof trips.$inferInsert)[] = []
  const stopRows: (typeof tripStops.$inferInsert)[] = []
  const deliveryRows: (typeof deliveries.$inferInsert)[] = []
  const deliveryLineRows: (typeof deliveryLines.$inferInsert)[] = []
  const podRows: (typeof podEvidence.$inferInsert)[] = []
  const collectionRows: (typeof collections.$inferInsert)[] = []
  const expenseRows: (typeof tripExpenses.$inferInsert)[] = []
  const settlementRows: (typeof tripSettlements.$inferInsert)[] = []
  const newReceiptRows: (typeof receipts.$inferInsert)[] = []
  const newAllocationRows: (typeof allocations.$inferInsert)[] = []
  const newJournalEntryRows: (typeof journalEntries.$inferInsert)[] = []
  const newJournalLineRows: (typeof journalLines.$inferInsert)[] = []
  const receiptTripUpdates: { receiptId: string; tripId: string }[] = []
  const invoicePaidUpdates: string[] = []
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

  function collectExistingReceipt(inv: InvoiceRecord, tripId: string): void {
    if (inv.state === 'issued') return
    // The receipt id follows the same deterministic scheme sales.ts used.
    const receiptId = demoId('receipt', inv.id)
    receiptTripUpdates.push({ receiptId, tripId })
    collectionRows.push({
      id: demoId('collection', `${tripId}:${inv.id}`),
      tenantId,
      tripId,
      retailerId: inv.retailerId,
      receiptId,
      mode: 'cash',
      amountPaise: inv.totalPaise,
      collectedBy: null,
      collectedAt: atIstTime(inv.invoiceDate, 17, 30),
    })
    taken(tripId, 'cash', inv.totalPaise)
  }

  function collectFreshPayment(inv: InvoiceRecord, tripId: string, collectedAt: Date): void {
    const receiptId = demoId('receipt', `trip:${inv.id}`)
    // The mode is drawn BEFORE the skip so the random sequence — and with it every later trip's
    // draw — is the same on every database, seeded fresh or re-seeded.
    const mode = randChance(rng, 0.6) ? ('cash' as const) : ('upi' as const)
    if (settledElsewhere.has(inv.id)) return
    newReceiptRows.push({
      id: receiptId,
      tenantId,
      // Numbered by the bill, not by position: a skipped bill must not renumber the ones after it.
      receiptNo: `RCPT-T-${inv.invoiceNo.replace(/^.*\//, '')}`,
      retailerId: inv.retailerId,
      mode,
      amountPaise: inv.totalPaise,
      receivedAt: collectedAt,
      receivedBy: people.delivery.ganesh.id,
      tripId,
      idempotencyKey: `trip-receipt:${inv.id}`,
    })
    newAllocationRows.push({
      id: doorAllocationId(inv.id),
      tenantId,
      invoiceId: inv.id,
      receiptId,
      amountPaise: inv.totalPaise,
      allocatedAt: collectedAt,
    })
    const entryId = demoId('journal-entry', `trip-receipt:${inv.id}`)
    newJournalEntryRows.push({
      id: entryId,
      tenantId,
      entryDate: isoDate(collectedAt),
      refType: 'receipt',
      refId: receiptId,
      narration: `Cash on delivery for ${inv.invoiceNo}`,
      idempotencyKey: `journal:trip-receipt:${inv.id}`,
      postedBy: people.delivery.ganesh.id,
      postedAt: collectedAt,
    })
    newJournalLineRows.push(
      {
        id: demoId('journal-line', `trip-receipt:${inv.id}:cash`),
        tenantId,
        entryId,
        accountId: acc(mode === 'cash' ? 'CASH_VAN' : 'UPI'),
        amountPaise: inv.totalPaise,
        partyType: 'retailer',
        partyId: inv.retailerId,
      },
      {
        id: demoId('journal-line', `trip-receipt:${inv.id}:ar`),
        tenantId,
        entryId,
        accountId: acc('AR'),
        amountPaise: -inv.totalPaise,
        partyType: 'retailer',
        partyId: inv.retailerId,
      },
    )
    collectionRows.push({
      id: demoId('collection', `${tripId}:${inv.id}`),
      tenantId,
      tripId,
      retailerId: inv.retailerId,
      receiptId,
      mode,
      amountPaise: inv.totalPaise,
      collectedBy: people.delivery.ganesh.id,
      collectedAt,
    })
    taken(tripId, mode, inv.totalPaise)
    invoicePaidUpdates.push(inv.id)
  }

  function addStop(
    tripId: string,
    sequence: number,
    inv: InvoiceRecord,
    state: 'delivered' | 'partial' | 'arrived' | 'started' | 'pending' | 'failed',
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
    stopRows.push({
      id: stopId,
      tenantId,
      tripId,
      sequence,
      retailerId: inv.retailerId,
      state,
      plannedCollectionPaise: inv.totalPaise,
      etaAt: atIstTime(inv.invoiceDate, 9 + sequence, 0),
      startedAt: atIstTime(inv.invoiceDate, 9 + sequence, 0),
      arrivedAt: state === 'pending' ? null : atIstTime(inv.invoiceDate, 9 + sequence, 10),
      completedAt,
      arrivedLat: retailer ? jitter(rng, retailer.lat, 0.0005) : null,
      arrivedLng: retailer ? jitter(rng, retailer.lng, 0.0005) : null,
    })
    if (retailer) activeTripStopsForPositions.push({ lat: retailer.lat, lng: retailer.lng })

    if (state !== 'delivered' && state !== 'partial') return
    const shortPcs = shortPcsByInvoiceId.get(inv.id) ?? 0
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
      deliveredAt: completedAt,
      receiverName: retailer?.ownerName ?? 'Shop staff',
      deviceId,
      idempotencyKey: `delivery:${tripId}:${inv.id}`,
    })
    inv.lines.forEach((l, i) => {
      const returned = i === 0 ? shortPcs : 0
      deliveryLineRows.push({
        id: demoId('delivery-line', `${tripId}:${inv.id}:${i}`),
        tenantId,
        deliveryId: demoId('delivery', `${tripId}:${inv.id}`),
        invoiceLineId: l.invoiceLineId,
        deliveredQtyPcs: l.qtyPcs - returned,
        returnedQtyPcs: returned,
        returnedSaleable: false,
        reason: returned > 0 ? 'Short at doorstep count' : null,
      })
    })
    podRows.push({
      id: demoId('pod', `${tripId}:${inv.id}`),
      tenantId,
      deliveryId: demoId('delivery', `${tripId}:${inv.id}`),
      kind: 'photo' as const,
      objectKey: `demo/pod/${tripId}/${inv.id}.jpg`,
      capturedAt: completedAt ?? atIstTime(inv.invoiceDate, 17, 0),
    })
    usedInvoiceIds.add(inv.id)
    if (state === 'delivered' || state === 'partial') {
      if (inv.state !== 'issued') collectExistingReceipt(inv, tripId)
      else if (randChance(rng, 0.7) && completedAt) collectFreshPayment(inv, tripId, completedAt)
    }
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
  ): string {
    const dieselPaise = 30_000 + randInt(rng, 0, 10_000)
    expenseRows.push({
      id: demoId('trip-expense', `${tripId}:diesel`),
      tenantId,
      tripId,
      kind: 'diesel',
      amountPaise: dieselPaise,
      recordedBy: people.delivery.ganesh.id,
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
        recordedBy: people.delivery.ganesh.id,
      })
    }
    const expensesTotal = dieselPaise + tollPaise
    const took = takenByTrip.get(tripId) ?? { cashPaise: 0, upiPaise: 0 }
    // expected cash = float + cash taken − cash spent (UPI is reported, never netted); a red settlement
    // is ₹450 short (beyond the ₹100 tolerance) AND one lot miscounted, so both variance paths show.
    // (the draw below is taken exactly as the earlier seed took it, so re-seeding a database seeded
    // before 0014 lands the variance on the SAME trip; ₹442–₹450 short, well beyond the ₹100 tolerance)
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

  const days = workingDaysBack(10)
  for (const day of days) {
    const ageDays = Math.round((TODAY.getTime() - day.getTime()) / 86_400_000)
    const isToday = ageDays === 0
    const sourceDay = isToday ? daysAgo(1) : day
    const candidates = (invoicesByDay.get(isoDate(sourceDay)) ?? []).filter(
      (i) => !usedInvoiceIds.has(i.id),
    )

    if (isToday) {
      const tripId = demoId('trip', 'active')
      const def = nth(vehicleDefs, 0)
      const stops = candidates.slice(0, Math.min(7, candidates.length))
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
        startedAt: atIstTime(day, 9, 0),
      })
      activeTripStopsForPositions = []
      const firstStop = demoStops.length
      stops.forEach((inv, i) => {
        const cutoff = Math.min(stops.length - 1, Math.ceil(stops.length * 0.55))
        if (i < cutoff) {
          addStop(
            tripId,
            i + 1,
            inv,
            'delivered',
            atIstTime(day, 9 + i, 20),
            def.driverId,
            def.driverDeviceId,
          )
        } else if (i === cutoff) {
          addStop(tripId, i + 1, inv, 'arrived', null, def.driverId, def.driverDeviceId)
        } else {
          addStop(tripId, i + 1, inv, 'pending', null, def.driverId, def.driverDeviceId)
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
      const lastPoint = waypoints[waypoints.length - 1] ?? DEPOT
      await insertMany(db, vehiclePositions, [
        {
          tenantId,
          vehicleId: vehicleRowId(def.key),
          tripId,
          lat: lastPoint.lat,
          lng: lastPoint.lng,
          recordedAt: clock,
        },
      ])
    } else {
      // Yesterday's invoices are dispatched/packed, not yet delivered (sales.ts's day model): today's
      // active trip is still out delivering them, so yesterday's own trips only claim a portion.
      const claimable =
        ageDays === 1 ? candidates.slice(0, Math.ceil(candidates.length * 0.6)) : candidates
      const half = Math.ceil(claimable.length / 2)
      const buckets = [claimable.slice(0, half), claimable.slice(half)]
      buckets.forEach((stops, vi) => {
        const def = nth(vehicleDefs, vi)
        const tripId = demoTripId(day, def.key)
        const hasVariance = randChance(rng, 0.2)
        const firstStop = demoStops.length
        tripRows.push({
          id: tripId,
          tenantId,
          tripNo: `TRIP-${isoDate(day).replace(/-/g, '')}-${vi + 1}`,
          tripDate: isoDate(day),
          vehicleId: vehicleRowId(def.key),
          driverId: def.driverId,
          helperId: def.helperId,
          state: hasVariance ? ('settled_with_variance' as const) : ('settled' as const),
          plannedStops: stops.length,
          openingCashPaise: 500_000,
          startedAt: atIstTime(day, 9, 0),
          endedAt: atIstTime(day, 18, 0),
        })
        stops.forEach((inv, i) => {
          const isFail = i === stops.length - 1 && randChance(rng, 0.1)
          const state = isFail
            ? ('failed' as const)
            : shortPcsByInvoiceId.has(inv.id)
              ? ('partial' as const)
              : ('delivered' as const)
          addStop(
            tripId,
            i + 1,
            inv,
            state,
            isFail ? null : atIstTime(day, 9 + i, 20),
            def.driverId,
            def.driverDeviceId,
          )
        })
        const settlementId = settleTrip(tripId, hasVariance, 500_000, atIstTime(day, 18, 30))
        demoTrips.push({
          id: tripId,
          tripNo: `TRIP-${isoDate(day).replace(/-/g, '')}-${vi + 1}`,
          tripDate: isoDate(day),
          vehicle: demoVehicle(def.key),
          state: hasVariance ? 'settled_with_variance' : 'settled',
          stops: demoStops.slice(firstStop),
          settlementId,
        })
      })
    }
  }

  await insertMany(db, trips, tripRows)
  await insertMany(db, tripStops, stopRows)
  await insertMany(db, deliveries, deliveryRows)
  await insertMany(db, deliveryLines, deliveryLineRows)
  await insertMany(db, podEvidence, podRows)
  await insertMany(db, receipts, newReceiptRows)
  await insertMany(db, allocations, newAllocationRows)
  await insertMany(db, journalEntries, newJournalEntryRows)
  await insertMany(db, journalLines, newJournalLineRows)
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

  for (const u of receiptTripUpdates) {
    await db.update(receipts).set({ tripId: u.tripId }).where(eq(receipts.id, u.receiptId))
  }
  for (const invoiceId of invoicePaidUpdates) {
    await db
      .update(invoices)
      .set({ state: 'paid' as const })
      .where(eq(invoices.id, invoiceId))
  }

  // The three-wheeler isn't on today's active trip; park it at the depot.
  const idle = nth(vehicleDefs, 1)
  await insertMany(db, vehiclePositions, [
    {
      tenantId,
      vehicleId: vehicleRowId(idle.key),
      lat: DEPOT.lat,
      lng: DEPOT.lng,
      recordedAt: atIstTime(daysAgo(1), 19, 30),
    },
  ])

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
