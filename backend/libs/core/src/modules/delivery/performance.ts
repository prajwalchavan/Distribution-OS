import { and, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { tripSettlements, trips, tripStops, vehicles } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The rows REPORTING's `deliveryPerformance` register is built from (coordination §4: reporting →
 * delivery `performanceRows`), one per trip: stops planned / delivered / partial / failed, how many
 * were on time against their ETA, how many carry a proof of delivery, the crew, and the cash variance
 * once the trip has been settled. A plain exported function — the worker's rollup sweep imports it
 * without Nest DI (coordination §3.9 worker rule).
 *
 * ON TIME is `completed_at <= eta_at`: a stop with no ETA is never counted as late (nothing was
 * promised) and never as on time either, so the rate is honest about how much of the day was planned.
 * POD COVERAGE counts the delivered / partial stops with at least one `pod_evidence` row — the
 * denominator is attempts that ended in goods changing hands, not every stop, because a failed stop
 * has nothing to prove.
 *
 * The money of a trip is receivables' (`collectionsRegister`) and never travels through here; the ONE
 * rupee figure below is `trip_settlements.cash_variance_paise`, which is delivery's own column and the
 * reason a red settlement needs the owner (docs/22 §6).
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
  vehicleRegNo: string
  driverId: string | null
  helperId: string | null
  state: string
  stopsPlanned: number
  stopsDelivered: number
  stopsPartial: number
  stopsFailed: number
  /** Stops completed at or before their planned ETA (null ETA never counts). */
  stopsOnTime: number
  /** Delivered or partial stops carrying at least one proof-of-delivery row. */
  stopsWithPod: number
  /** `trip_settlements.cash_variance_paise`; null until the trip is settled. */
  cashVariancePaise: number | null
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
      vehicleRegNo: vehicles.regNo,
      driverId: trips.driverId,
      helperId: trips.helperId,
      state: trips.state,
      startedAt: trips.startedAt,
      endedAt: trips.endedAt,
      cashVariancePaise: tripSettlements.cashVariancePaise,
      stopsPlanned: sql<number>`count(${tripStops.id})`,
      stopsDelivered: sql<number>`count(*) filter (where ${tripStops.state} = 'delivered')`,
      stopsPartial: sql<number>`count(*) filter (where ${tripStops.state} = 'partial')`,
      stopsFailed: sql<number>`count(*) filter (where ${tripStops.state} = 'failed')`,
      stopsOnTime: sql<number>`count(*) filter (where ${tripStops.completedAt} is not null and ${tripStops.etaAt} is not null and ${tripStops.completedAt} <= ${tripStops.etaAt})`,
      // A stop proves itself through its deliveries' evidence rows; EXISTS keeps the fan-out out of the
      // counts above (a stop with three photos is one covered stop, not three).
      stopsWithPod: sql<number>`count(*) filter (where ${tripStops.state} in ('delivered', 'partial') and exists (
        select 1 from deliveries d
          join pod_evidence pe on pe.delivery_id = d.id and pe.tenant_id = d.tenant_id
         where d.tenant_id = ${tenantId} and d.stop_id = ${tripStops.id}))`,
    })
    .from(trips)
    .leftJoin(tripStops, eq(tripStops.tripId, trips.id))
    .leftJoin(tripSettlements, eq(tripSettlements.tripId, trips.id))
    .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
    .where(
      and(
        eq(trips.tenantId, tenantId),
        gte(trips.tripDate, filter.from),
        lte(trips.tripDate, filter.to),
        filter.driverId
          ? sql`(${trips.driverId} = ${filter.driverId} or ${trips.helperId} = ${filter.driverId})`
          : undefined,
        filter.vehicleId ? eq(trips.vehicleId, filter.vehicleId) : undefined,
        sql`${trips.state} <> 'cancelled'`,
      ),
    )
    .groupBy(trips.id, tripSettlements.cashVariancePaise, vehicles.regNo)
    .orderBy(trips.tripDate, trips.id)
    .limit(Math.min(filter.limit ?? 500, 2_000))
  return rows.map((r) => ({
    tripId: r.tripId,
    tripNo: r.tripNo,
    tripDate: r.tripDate,
    vehicleId: r.vehicleId,
    vehicleRegNo: r.vehicleRegNo,
    driverId: r.driverId,
    helperId: r.helperId,
    state: r.state,
    stopsPlanned: Number(r.stopsPlanned),
    stopsDelivered: Number(r.stopsDelivered),
    stopsPartial: Number(r.stopsPartial),
    stopsFailed: Number(r.stopsFailed),
    stopsOnTime: Number(r.stopsOnTime),
    stopsWithPod: Number(r.stopsWithPod),
    cashVariancePaise: r.cashVariancePaise === null ? null : Number(r.cashVariancePaise),
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
  }))
}

/**
 * The same last mile, one row per IST trip date rather than per trip — what the reporting rollup writes
 * into `daily_tenant_stats` so the delivery TREND is a read of the rollup, never of this join.
 */
export async function deliveryStopsByDay(
  tx: Db,
  filter: Pick<DeliveryPerformanceFilter, 'from' | 'to'>,
): Promise<
  {
    day: string
    deliveredStops: number
    partialStops: number
    failedStops: number
    onTimeStops: number
    podStops: number
  }[]
> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select t.trip_date::text as day,
           count(*) filter (where s.state = 'delivered')::int as delivered_stops,
           count(*) filter (where s.state = 'partial')::int   as partial_stops,
           count(*) filter (where s.state = 'failed')::int    as failed_stops,
           count(*) filter (where s.completed_at is not null and s.eta_at is not null
                              and s.completed_at <= s.eta_at)::int as on_time_stops,
           count(*) filter (where s.state in ('delivered', 'partial') and exists (
             select 1 from deliveries d
               join pod_evidence pe on pe.delivery_id = d.id and pe.tenant_id = d.tenant_id
              where d.tenant_id = t.tenant_id and d.stop_id = s.id))::int as pod_stops
      from trips t
      join trip_stops s on s.trip_id = t.id and s.tenant_id = t.tenant_id
     where t.tenant_id = ${tenantId}
       and t.state <> 'cancelled'
       and t.trip_date between ${filter.from} and ${filter.to}
     group by 1
     order by 1`)
  return result.rows.map((row: Record<string, unknown>) => ({
    day: String(row.day),
    deliveredStops: Number(row.delivered_stops ?? 0),
    partialStops: Number(row.partial_stops ?? 0),
    failedStops: Number(row.failed_stops ?? 0),
    onTimeStops: Number(row.on_time_stops ?? 0),
    podStops: Number(row.pod_stops ?? 0),
  }))
}
