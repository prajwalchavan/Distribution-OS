import { and, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { trips, tripStops } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The rows REPORTING's `deliveryPerformance` register is built from (coordination §4: reporting →
 * delivery `performanceRows`), one per trip: stops planned / delivered / partial / failed, how many
 * were on time against their ETA, and the crew. A plain exported function — the worker's rollup sweep
 * imports it without Nest DI (coordination §3.9 worker rule). Counts and identity only; the money of
 * a trip is receivables' (`collectionsRegister`) and never travels through here.
 */

export interface DeliveryPerformanceFilter {
  from: string
  to: string
  driverId?: string | undefined
  vehicleId?: string | undefined
  /** docs/20 rule 3: bounded work. */
  limit?: number | undefined
}

export interface DeliveryPerformanceRow {
  tripId: string
  tripNo: string | null
  tripDate: string
  vehicleId: string
  driverId: string | null
  helperId: string | null
  state: string
  stopsPlanned: number
  stopsDelivered: number
  stopsPartial: number
  stopsFailed: number
  /** Stops completed at or before their planned ETA (null ETA never counts). */
  stopsOnTime: number
  startedAt: string | null
  endedAt: string | null
}

export async function deliveryPerformanceRows(
  tx: Db,
  filter: DeliveryPerformanceFilter,
): Promise<DeliveryPerformanceRow[]> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      tripId: trips.id,
      tripNo: trips.tripNo,
      tripDate: trips.tripDate,
      vehicleId: trips.vehicleId,
      driverId: trips.driverId,
      helperId: trips.helperId,
      state: trips.state,
      startedAt: trips.startedAt,
      endedAt: trips.endedAt,
      stopsPlanned: sql<number>`count(${tripStops.id})`,
      stopsDelivered: sql<number>`count(*) filter (where ${tripStops.state} = 'delivered')`,
      stopsPartial: sql<number>`count(*) filter (where ${tripStops.state} = 'partial')`,
      stopsFailed: sql<number>`count(*) filter (where ${tripStops.state} = 'failed')`,
      stopsOnTime: sql<number>`count(*) filter (where ${tripStops.completedAt} is not null and ${tripStops.etaAt} is not null and ${tripStops.completedAt} <= ${tripStops.etaAt})`,
    })
    .from(trips)
    .leftJoin(tripStops, eq(tripStops.tripId, trips.id))
    .where(
      and(
        eq(trips.tenantId, tenantId),
        gte(trips.tripDate, filter.from),
        lte(trips.tripDate, filter.to),
        filter.driverId ? eq(trips.driverId, filter.driverId) : undefined,
        filter.vehicleId ? eq(trips.vehicleId, filter.vehicleId) : undefined,
        sql`${trips.state} <> 'cancelled'`,
      ),
    )
    .groupBy(trips.id)
    .orderBy(trips.tripDate, trips.id)
    .limit(Math.min(filter.limit ?? 500, 2_000))
  return rows.map((r) => ({
    tripId: r.tripId,
    tripNo: r.tripNo,
    tripDate: r.tripDate,
    vehicleId: r.vehicleId,
    driverId: r.driverId,
    helperId: r.helperId,
    state: r.state,
    stopsPlanned: Number(r.stopsPlanned),
    stopsDelivered: Number(r.stopsDelivered),
    stopsPartial: Number(r.stopsPartial),
    stopsFailed: Number(r.stopsFailed),
    stopsOnTime: Number(r.stopsOnTime),
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
  }))
}
