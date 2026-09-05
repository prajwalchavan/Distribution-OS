/** Vehicles, trips, stops, deliveries, POD, collections and settlements — ADR 0013. */
import { insertMany } from './db-helpers.js'
import { eq } from 'drizzle-orm'
import {
  accounts,
  allocations,
  collections,
  deliveries,
  deliveryLines,
  invoices,
  journalEntries,
  journalLines,
  locations,
  podEvidence,
  receipts,
  tripExpenses,
  tripPoints,
  tripSettlements,
  tripStops,
  trips,
  vehiclePositions,
  vehicles,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
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

interface VehicleDef {
  key: string
  regNo: string
  name: string
  kind: string
  capacityCases: number
  driverId: string
  helperId: string
}

export async function seedDelivery(
  db: Db,
  tenantId: string,
  retailersRes: RetailersResult,
  sales: SalesResult,
  people: PeopleResult,
): Promise<void> {
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
    },
    {
      key: 'three-wheeler',
      regNo: 'MH-05-CD-5678',
      name: 'Loader 1',
      kind: 'three_wheeler',
      capacityCases: 60,
      driverId: people.delivery.santosh.id,
      helperId: people.delivery.iqbal.id,
    },
  ]
  const vehicleLocId = (key: string) => demoId('location-vehicle', key)
  const vehicleRowId = (key: string) => demoId('vehicle', key)

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
  let activeTripStopsForPositions: { lat: number; lng: number }[] = []

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
  }

  function collectFreshPayment(inv: InvoiceRecord, tripId: string, collectedAt: Date): void {
    const receiptId = demoId('receipt', `trip:${inv.id}`)
    const mode = randChance(rng, 0.6) ? ('cash' as const) : ('upi' as const)
    newReceiptRows.push({
      id: receiptId,
      tenantId,
      receiptNo: `RCPT-T-${String(newReceiptRows.length + 1).padStart(4, '0')}`,
      retailerId: inv.retailerId,
      mode,
      amountPaise: inv.totalPaise,
      receivedAt: collectedAt,
      receivedBy: people.delivery.ganesh.id,
      tripId,
      idempotencyKey: `trip-receipt:${inv.id}`,
    })
    newAllocationRows.push({
      id: demoId('allocation', `trip:${inv.id}`),
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
    invoicePaidUpdates.push(inv.id)
  }

  function addStop(
    tripId: string,
    sequence: number,
    inv: InvoiceRecord,
    state: 'delivered' | 'partial' | 'arrived' | 'started' | 'pending' | 'failed',
    completedAt: Date | null,
    driverId: string,
  ): void {
    const retailer = retailerById.get(inv.retailerId)
    const stopId = demoId('trip-stop', `${tripId}:${sequence}`)
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
    deliveryRows.push({
      id: demoId('delivery', `${tripId}:${inv.id}`),
      tenantId,
      tripId,
      stopId,
      orderId: inv.orderId,
      invoiceId: inv.id,
      outcome,
      deliveredBy: driverId,
      deliveredAt: completedAt,
      receiverName: retailer?.ownerName ?? 'Shop staff',
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

  function settleTrip(tripId: string, hasVariance: boolean, cashCollected: number): void {
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
    const expected = cashCollected - expensesTotal
    const variance = hasVariance ? -(200 + randInt(rng, 0, 800)) : 0
    settlementRows.push({
      id: demoId('trip-settlement', tripId),
      tenantId,
      tripId,
      expectedCashPaise: Math.max(0, expected),
      handedOverCashPaise: Math.max(0, expected + variance),
      cashVariancePaise: variance,
      expensesPaise: expensesTotal,
      hasVariance,
      settledBy: people.accountant.id,
    })
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
      stops.forEach((inv, i) => {
        const cutoff = Math.min(stops.length - 1, Math.ceil(stops.length * 0.55))
        if (i < cutoff) {
          addStop(tripId, i + 1, inv, 'delivered', atIstTime(day, 9 + i, 20), def.driverId)
        } else if (i === cutoff) {
          addStop(tripId, i + 1, inv, 'arrived', null, def.driverId)
        } else {
          addStop(tripId, i + 1, inv, 'pending', null, def.driverId)
        }
      })

      // ~200 GPS breadcrumbs along depot -> each reached stop, for the live map.
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
          tripPointRows.push({
            id: demoId('trip-point', `${pointSeq}`),
            tenantId,
            tripId,
            userId: def.driverId,
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
        const tripId = demoId('trip', `${isoDate(day)}:${def.key}`)
        const hasVariance = randChance(rng, 0.2)
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
        let cashCollected = 0
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
          )
          if (!isFail && (inv.state !== 'issued' || randChance(rng, 0.7)))
            cashCollected += inv.totalPaise
        })
        settleTrip(tripId, hasVariance, cashCollected)
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
  await insertMany(db, tripPoints, tripPointRows)

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
}
