import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ApplyRoutePlanInput,
  ApplyRoutePlanOutput,
  PlanRouteInput,
  PlanRouteOutput,
  RoutePlanDetail,
  RoutePlanGetInput,
  RoutePlanGetOutput,
} from '@dos/contracts'
import { AI_MAX_ROUTE_STOPS } from '@dos/contracts'
import { routePlans, withTenant, type Db, type RoutePlanStop } from '@dos/db'
import {
  DEFAULT_AVG_SPEED_KMPH,
  DEFAULT_ROAD_FACTOR,
  DEFAULT_SERVICE_MINUTES,
  planRoute,
  sequenceDistanceM,
  type RouteStopInput,
} from '@dos/domain'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { TripsService, type RoutingStop } from '../delivery/index.js'
import {
  AI_SETTING_KEYS,
  numberSetting,
  optionalNumberSetting,
  readSettings,
  ROUTE_DESK,
  ROUTE_OPTIMISERS,
  ROUTE_READ_DESK,
  ROUTE_READERS,
} from './ai.internals.js'
import { toRoutePlanDetail, tripNumbers, type PlanRow, type RouteDeps } from './ai.mappers.js'

type PlanIn = z.infer<typeof PlanRouteInput>
type PlanOut = z.infer<typeof PlanRouteOutput>
type GetIn = z.infer<typeof RoutePlanGetInput>
type GetOut = z.infer<typeof RoutePlanGetOutput>
type ApplyIn = z.infer<typeof ApplyRoutePlanInput>
type ApplyOut = z.infer<typeof ApplyRoutePlanOutput>

/**
 * Route optimisation for one trip (founder decision 2026-09-05, docs/22 §8: "stop sequencing by
 * distance and time windows, driver may override").
 *
 * THREE PROPERTIES, and each is a deliberate refusal to let a solver run the business:
 *
 *   `plan`   computes a sequence and writes it to `route_plans`. It touches the TRIP NOT AT ALL. A
 *            crew that never opens the plan drives exactly the round it was given.
 *   `get`    reads the plan beside the trip's CURRENT sequence, so the app shows what would move
 *            before anything does.
 *   `apply`  writes the sequence onto the trip — and does it through `TripsService.reorderStopsInTx`,
 *            the same path, the same validation and the same refusals the crew's own drag-and-drop
 *            goes through. A stop already started, delivered or failed keeps its place; only open
 *            stops move. The crew may re-sequence afterwards, which flips the plan to `overridden`
 *            and changes nothing else — the plan is advice, `trip_stops.sequence` is the record.
 *
 * The optimiser itself is a PURE function in `@dos/domain` (`planRoute`: haversine → nearest
 * neighbour → 2-opt), unit-tested on instances whose optimum is known. Its assumptions — average
 * speed, per-stop service time, the road factor, the depot — come from `tenant_settings`, NEVER from
 * the wire, so one distributor's tuning cannot be sent by a client.
 */
@Injectable()
export class RoutingService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly trips: TripsService,
  ) {}

  async plan(input: PlanIn): Promise<PlanOut> {
    requireRole(ROUTE_OPTIMISERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await this.trips.tripForRouting(tx, input.tripId, ROUTE_DESK)
        const stops = await this.trips.routingStops(tx, trip.id)
        const open = stops.filter((stop) => !stop.terminal)
        if (open.length === 0)
          throw new ORPCError('CONFLICT', {
            message: `trip ${trip.tripNo ?? trip.id} has no open stop left to sequence`,
            data: { code: 'no_open_stops' },
          })
        if (open.length > AI_MAX_ROUTE_STOPS)
          throw new ORPCError('BAD_REQUEST', {
            message: `a route plan covers at most ${String(AI_MAX_ROUTE_STOPS)} open stops`,
            data: { code: 'too_many_stops' },
          })

        const tuning = await this.tuning(tx)
        const startAt = trip.startedAt ?? new Date(`${trip.tripDate}T09:00:00.000+05:30`)
        const result = planRoute(open.map(toRouteStop), { ...tuning, startAt })
        // A plan is a PERMUTATION OF THE OPEN STOPS' OWN SLOTS. Terminal stops keep the sequence they
        // hold — a delivered stop is history — so the plan reuses exactly the numbers the open stops
        // occupy today, in ascending order. Numbering them 1..n instead would collide with a stop the
        // crew has already delivered, and `reorderStopsInTx` would rightly refuse the whole apply.
        const openSlots = open.map((stop) => stop.sequence).sort((a, b) => a - b)
        const sequence: RoutePlanStop[] = result.order.map((entry, index) => ({
          stopId: entry.stopId,
          seq: openSlots[index] ?? index + 1,
          etaAt:
            entry.etaMinutes === null
              ? null
              : new Date(startAt.getTime() + entry.etaMinutes * 60_000).toISOString(),
          distanceM: entry.distanceM,
        }))

        // THE INSERT RUNS AS THE CALLER, under `route_plans_insert`. The policy admits the desk and,
        // since migration 0035, the CREW OF THIS VERY TRIP — the same EXISTS branch the read and
        // update policies already carried, and the same one `trips_insert` uses. It matters that the
        // row is written by the caller and not escalated: who may ask is checked twice above
        // (`requireRole(ROUTE_OPTIMISERS)`, then `tripForRouting`, which admits a `delivery` caller
        // only for a trip it drives), and the database now refuses a third time on its own instead of
        // trusting those two. An escalation here would have been wider than the thing it allowed.
        const [row] = await tx
          .insert(routePlans)
          .values({
            id: input.id,
            tenantId: ctx.tenantId,
            tripId: trip.id,
            method: 'nearest_neighbour_2opt',
            sequence,
            totalDistanceM: result.totalDistanceM,
            totalDurationS: result.totalDurationS,
            computedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning()
        const plan = row ?? (await this.load(tx, input.id))
        return { item: await this.detail(tx, plan, stops) }
      }),
    )
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(ROUTE_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const trip = await this.trips.tripForReading(tx, input.tripId, ROUTE_READ_DESK)
      const [row] = input.planId
        ? await tx
            .select()
            .from(routePlans)
            .where(and(eq(routePlans.id, input.planId), eq(routePlans.tripId, trip.id)))
            .limit(1)
        : await tx
            .select()
            .from(routePlans)
            .where(eq(routePlans.tripId, trip.id))
            .orderBy(desc(routePlans.computedAt), desc(routePlans.id))
            .limit(1)
      if (!row) return { item: null }
      const stops = await this.trips.routingStops(tx, trip.id)
      return { item: await this.detail(tx, row, stops) }
    })
  }

  /**
   * Put the plan on the road. One route per trip: the partial unique index
   * `route_plans_applied_idx` refuses a second applied plan, so a trip cannot be driving two.
   */
  async apply(input: ApplyIn): Promise<ApplyOut> {
    requireRole(ROUTE_OPTIMISERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await this.trips.tripForRouting(tx, input.tripId, ROUTE_DESK)
        const [locked] = await tx
          .select()
          .from(routePlans)
          .where(and(eq(routePlans.id, input.id), eq(routePlans.tripId, trip.id)))
          .for('update')
        if (!locked)
          throw new ORPCError('NOT_FOUND', {
            message: `route plan ${input.id} is not a plan of trip ${trip.tripNo ?? trip.id}`,
          })
        const plan = locked
        const stops = await this.trips.routingStops(tx, trip.id)
        const open = new Map(stops.filter((s) => !s.terminal).map((s) => [s.stopId, s]))
        const order = plan.sequence
          .filter((entry) => open.has(entry.stopId))
          .map((entry) => ({ stopId: entry.stopId, sequence: entry.seq }))
        if (order.length === 0)
          throw new ORPCError('CONFLICT', {
            message: 'every stop of this plan has already been attempted',
            data: { code: 'nothing_to_apply' },
          })

        if (!plan.appliedAt) {
          // Another plan may already be the applied one for this trip; the index says so, and a
          // clear 409 beats a constraint error the app cannot read.
          const [applied] = await tx
            .select({ id: routePlans.id })
            .from(routePlans)
            .where(
              and(
                eq(routePlans.tripId, trip.id),
                isNotNull(routePlans.appliedAt),
                sql`${routePlans.id} <> ${plan.id}`,
              ),
            )
            .limit(1)
          if (applied)
            throw new ORPCError('CONFLICT', {
              message: 'a route plan has already been applied to this trip',
              data: { code: 'already_applied', planId: applied.id },
            })
        }

        await this.trips.reorderStopsInTx(tx, trip, order)
        const now = new Date()
        const [updated] = await tx
          .update(routePlans)
          .set({
            appliedAt: plan.appliedAt ?? now,
            appliedBy: plan.appliedBy ?? ctx.actorId,
            updatedAt: now,
          })
          .where(eq(routePlans.id, plan.id))
          .returning()
        const after = await this.trips.routingStops(tx, trip.id)
        return {
          item: await this.detail(tx, updated ?? plan, after),
          stops: await this.trips.stopsOfTrip(tx, trip),
        }
      }),
    )
  }

  /** Tuning that belongs to the distributor: speed, service time, road factor and the depot pin. */
  private async tuning(tx: Db) {
    const settings = await readSettings(tx, Object.values(AI_SETTING_KEYS))
    const lat = optionalNumberSetting(settings, AI_SETTING_KEYS.routingDepotLat)
    const lng = optionalNumberSetting(settings, AI_SETTING_KEYS.routingDepotLng)
    return {
      avgSpeedKmph: numberSetting(
        settings,
        AI_SETTING_KEYS.routingAvgSpeedKmph,
        DEFAULT_AVG_SPEED_KMPH,
      ),
      serviceMinutes: numberSetting(
        settings,
        AI_SETTING_KEYS.routingServiceMinutes,
        DEFAULT_SERVICE_MINUTES,
      ),
      roadFactor:
        numberSetting(
          settings,
          AI_SETTING_KEYS.routingRoadFactorBps,
          DEFAULT_ROAD_FACTOR * 10_000,
        ) / 10_000,
      depot: lat !== null && lng !== null ? { lat, lng } : null,
    }
  }

  private async load(tx: Db, id: string): Promise<PlanRow> {
    const [row] = await tx.select().from(routePlans).where(eq(routePlans.id, id)).limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `route plan ${id} not found` })
    return row
  }

  private async detail(
    tx: Db,
    row: PlanRow,
    stops: readonly RoutingStop[],
  ): Promise<RoutePlanDetail> {
    const deps: RouteDeps = {
      tripNumbers: await tripNumbers(tx, [row.tripId]),
      newestPlanIds: await newestPlanIds(tx, [row.tripId]),
      stops: new Map(
        stops.map((stop) => [
          stop.stopId,
          {
            sequence: stop.sequence,
            retailerId: stop.retailerId,
            retailerName: stop.retailerName,
            lat: stop.lat,
            lng: stop.lng,
          },
        ]),
      ),
    }
    return toRoutePlanDetail(row, deps)
  }
}

/** How much shorter the plan is than the sequence the trip holds today — used by the spec and the demo. */
export function savingMetres(
  stops: readonly RoutingStop[],
  planned: readonly RoutePlanStop[],
  tuning: { depot?: { lat: number; lng: number } | null; roadFactor?: number } = {},
): number {
  const byId = new Map(stops.map((stop) => [stop.stopId, stop]))
  const current = [...stops].sort((a, b) => a.sequence - b.sequence).map(toRouteStop)
  const proposed = [...planned]
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => byId.get(entry.stopId))
    .filter((stop): stop is RoutingStop => stop !== undefined)
    .map(toRouteStop)
  return sequenceDistanceM(current, tuning) - sequenceDistanceM(proposed, tuning)
}

function toRouteStop(stop: RoutingStop): RouteStopInput {
  return { stopId: stop.stopId, lat: stop.lat, lng: stop.lng }
}

/** The newest plan per trip, so an older pass reads as `superseded` rather than as a live draft. */
export async function newestPlanIds(tx: Db, tripIds: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(tripIds)]
  if (unique.length === 0) return new Set()
  const rows = await tx
    .select({ id: routePlans.id, tripId: routePlans.tripId, computedAt: routePlans.computedAt })
    .from(routePlans)
    .where(inArray(routePlans.tripId, unique))
    .orderBy(desc(routePlans.computedAt), desc(routePlans.id))
  const seen = new Set<string>()
  const out = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.tripId)) continue
    seen.add(row.tripId)
    out.add(row.id)
  }
  return out
}
