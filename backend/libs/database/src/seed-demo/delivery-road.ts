/**
 * The delivery MODULE's seed extension (docs/plans/delivery.md §6, items the database slice left to
 * this slice): what the delivery app needs to open on something startable and what every delivery
 * endpoint needs to answer with a real row against the Tarsun data.
 *
 *   - `feature_flags.van_sales = true` and `van_sales_enabled` on today's active trip, so the crew's
 *     van-sale button exists and `delivery.vanSales.create` bills off the tempo's real stock (the
 *     warehouse seed loaded the most recent sheet's lots onto it);
 *   - a PLANNED `deliveries` row (`outcome: null`) for every open stop of the active trip — the row
 *     `trips.depart`, `stops.fail` and `deliveries.record` complete — which the database slice's seed
 *     only wrote for stops already delivered;
 *   - tomorrow's planned trip on the tempo (Ganesh + Raju, van sales on) with pending stops carrying
 *     ETAs, built from bills that are packed or dispatched and not yet riding on any trip, so
 *     `trips.startLoading → depart` has a trip to move and the delivery app opens on a plan.
 *
 * Runs after every other seed (it reads the orders, invoices and load sheets they wrote). Deterministic
 * ids (`demoId`), `onConflictDoNothing` everywhere: a second `pnpm db:seed` adds nothing.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  deliveries,
  featureFlags,
  invoices,
  salesOrders,
  trips,
  tripStops,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { insertMany } from './db-helpers.js'
import { demoVehicleId, type DeliveryResult } from './delivery.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { SalesResult } from './sales.js'
import { activeTripId, plannedTripId } from './trip-plan.js'
import { atIstTime, isoDate, nextWorkingDay } from './util.js'

const MAX_PLANNED_STOPS = 14

export async function seedDeliveryRoad(
  db: Db,
  tenantId: string,
  sales: SalesResult,
  people: PeopleResult,
  delivery: DeliveryResult,
): Promise<{ plannedTripId: string; plannedStops: number }> {
  const DEMO_PLANNED_TRIP_ID = plannedTripId()
  // 1. van sales exist for this distributor, and today's trip may make them
  await db
    .insert(featureFlags)
    .values({ tenantId, flag: 'van_sales', enabled: true })
    .onConflictDoUpdate({
      target: [featureFlags.tenantId, featureFlags.flag],
      set: { enabled: true, updatedAt: new Date() },
    })
  await db
    .update(trips)
    .set({ vanSalesEnabled: true })
    .where(
      and(
        eq(trips.tenantId, tenantId),
        eq(trips.id, activeTripId()),
        eq(trips.vanSalesEnabled, false),
      ),
    )

  // 2. the planned rows of the active trip's open stops
  const invoiceById = new Map(sales.invoices.map((i) => [i.id, i]))
  const openStops = delivery.activeTrip.stops.filter(
    (s) => s.state === 'pending' || s.state === 'started' || s.state === 'arrived',
  )
  await insertMany(
    db,
    deliveries,
    openStops.map((s) => ({
      id: demoId('delivery', `planned:${s.id}:${s.invoiceId}`),
      tenantId,
      tripId: s.tripId,
      stopId: s.id,
      retailerId: s.retailerId,
      orderId: invoiceById.get(s.invoiceId)?.orderId ?? null,
      invoiceId: s.invoiceId,
      outcome: null,
      idempotencyKey: `plan:${s.id}:${s.invoiceId}`,
    })),
  )

  // 3. tomorrow's planned trip: bills packed or dispatched that ride on no trip yet
  const [existing] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.tenantId, tenantId), eq(trips.id, DEMO_PLANNED_TRIP_ID)))
    .limit(1)
  if (existing) {
    const [count] = await db
      .select({ n: sql<number>`count(*)` })
      .from(tripStops)
      .where(eq(tripStops.tripId, DEMO_PLANNED_TRIP_ID))
    return { plannedTripId: DEMO_PLANNED_TRIP_ID, plannedStops: Number(count?.n ?? 0) }
  }
  const candidates = await db
    .select({
      id: invoices.id,
      retailerId: invoices.retailerId,
      orderId: invoices.orderId,
      totalPaise: invoices.totalPaise,
    })
    .from(invoices)
    .innerJoin(salesOrders, eq(salesOrders.id, invoices.orderId))
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        inArray(salesOrders.state, ['packed', 'dispatched']),
        inArray(invoices.state, ['issued', 'partially_paid']),
        sql`not exists (select 1 from deliveries d where d.invoice_id = ${invoices.id})`,
      ),
    )
    .orderBy(invoices.id)
    .limit(MAX_PLANNED_STOPS)
  // the next WORKING day: Monday's round on a Saturday, never a trip dated on the weekly off
  const tomorrow = nextWorkingDay()
  const tempo = delivery.vehicles.find((v) => v.key === 'tempo')
  await insertMany(db, trips, [
    {
      id: DEMO_PLANNED_TRIP_ID,
      tenantId,
      tripNo: 'TRIP-NEXT',
      tripDate: isoDate(tomorrow),
      vehicleId: tempo?.id ?? demoVehicleId('tempo'),
      driverId: people.delivery.ganesh.id,
      helperId: people.delivery.raju.id,
      state: 'planned',
      vanSalesEnabled: true,
      plannedStops: candidates.length,
      openingCashPaise: 300_000,
    },
  ])
  const stopRows = candidates.map((inv, i) => ({
    id: demoId('trip-stop', `${DEMO_PLANNED_TRIP_ID}:${i + 1}`),
    tenantId,
    tripId: DEMO_PLANNED_TRIP_ID,
    sequence: i + 1,
    retailerId: inv.retailerId,
    state: 'pending' as const,
    plannedCollectionPaise: inv.totalPaise,
    // every 40 minutes from 10:00
    etaAt: atIstTime(tomorrow, 10 + Math.floor((i * 40) / 60), (i * 40) % 60),
  }))
  await insertMany(db, tripStops, stopRows)
  await insertMany(
    db,
    deliveries,
    candidates.map((inv, i) => {
      const stopId = demoId('trip-stop', `${DEMO_PLANNED_TRIP_ID}:${i + 1}`)
      return {
        id: demoId('delivery', `planned:${stopId}:${inv.id}`),
        tenantId,
        tripId: DEMO_PLANNED_TRIP_ID,
        stopId,
        retailerId: inv.retailerId,
        orderId: inv.orderId,
        invoiceId: inv.id,
        outcome: null,
        idempotencyKey: `plan:${stopId}:${inv.id}`,
      }
    }),
  )
  return { plannedTripId: DEMO_PLANNED_TRIP_ID, plannedStops: candidates.length }
}
