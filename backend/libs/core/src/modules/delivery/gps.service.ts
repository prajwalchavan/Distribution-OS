import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, eq, gt, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { GpsPointsInput, GpsPointsOutput, GpsTraceInput, GpsTraceOutput } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import { tripPoints, trips, vehiclePositions, withTenant, type Db } from '@dos/db'
import { currentTenant, DB, requireDb, requireRole, writeAudit } from '../../platform/index.js'
import {
  asSystemRole,
  DOORSTEP,
  findTrip,
  isCrew,
  PIN_HOLDERS,
  TRIP_ON_THE_ROAD,
  type TripRow,
} from './delivery.internals.js'

type PointsIn = z.infer<typeof GpsPointsInput>
type PointsOut = z.infer<typeof GpsPointsOutput>
type TraceIn = z.infer<typeof GpsTraceInput>
type TraceOut = z.infer<typeof GpsTraceOutput>

/** Points before the trip started, or after it ended, by more than this are dropped and counted. */
const WINDOW_SLACK_MS = 15 * 60_000
/** A device clock more than this ahead of the server is reported as skewed (still stored). */
const SKEW_MS = 10 * 60_000
/** Per-device budget: more points than this in the last minute and the batch is throttled, not stored. */
const POINTS_PER_MINUTE_BUDGET = 1_500
const THROTTLE_RETRY_SECONDS = 30

/**
 * `trip_points` is readable by the owner and the manager only (DPDP): the crew INSERTS under its own
 * user id and may never read a breadcrumb back. PostgreSQL applies the SELECT policy to the rows an
 * `INSERT … ON CONFLICT DO NOTHING … RETURNING` proposes (the same fact `modules/receivables/posting.ts`
 * documents for `journal_lines`), so a crew's batch would be refused by the very policy that protects
 * it. For THAT statement — and the per-device budget count before it — the session runs as `system`
 * (`asSystemRole`, the documented escalation); the INSERT policy still pins `user_id` to the actor.
 * The desk (owner, manager: DOORSTEP) may post a batch for a trip it is not crew on — a phone handed
 * to the manager for the day — and goes through the same door, since the INSERT policy names only
 * the crew and the system.
 */
async function asGpsWriter<T>(tx: Db, fn: () => Promise<T>): Promise<T> {
  return asSystemRole(tx, fn)
}

/**
 * GPS breadcrumbs (ADR 0012, docs/07 §7.5). `/gps/points` bypasses the sync queue entirely so hundreds
 * of points can never queue ahead of a cash receipt, and it is NOT wrapped in `idempotent()`: the
 * dedupe is `UNIQUE(tenant, trip, device, recorded_at)` with `ON CONFLICT DO NOTHING`, so a replay is
 * free and 50,000 points a minute write no idempotency rows (docs/20 rule 3). A well-formed batch is
 * always 2xx — stale points are `dropped`, a fast clock is `skewed`, a device over budget is
 * `throttled` with `retryAfterSeconds` — so a phone backs off instead of hot-looping (docs/20 rule 6).
 *
 * DPDP: points are trip-scoped (consent at `depart`), inserted under the crew member's own user id
 * (the INSERT policy pins it), never updated or deleted through the app, pruned by the worker after
 * `dpdp.gps_retention_days`. Reading them back (`trace`) and the live map are audited (docs/17 A12).
 */
@Injectable()
export class GpsService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async points(input: PointsIn): Promise<PointsOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const trip = await this.tripForCrew(tx, input.tripId)
      const none = (state: TripRow['state']): PointsOut => ({
        accepted: 0,
        duplicates: 0,
        dropped: input.points.length,
        skewed: 0,
        throttled: false,
        retryAfterSeconds: null,
        tripState: state,
        positionUpdated: false,
      })
      if (!TRIP_ON_THE_ROAD.has(trip.state)) return none(trip.state)

      const now = Date.now()
      const from = (trip.startedAt?.getTime() ?? now) - WINDOW_SLACK_MS
      const to = (trip.endedAt?.getTime() ?? now) + WINDOW_SLACK_MS
      const kept: (PointsIn['points'][number] & { at: Date })[] = []
      let dropped = 0
      let skewed = 0
      for (const p of input.points) {
        const at = new Date(p.recordedAt)
        const t = at.getTime()
        if (Number.isNaN(t) || t < from || t > to) {
          dropped += 1
          continue
        }
        if (t > now + SKEW_MS) skewed += 1
        kept.push({ ...p, at })
      }
      if (kept.length === 0) return { ...none(trip.state), dropped, skewed }

      // per-device fairness: a phone that floods is told to wait, and nothing of its batch is stored
      const recent = await asGpsWriter(tx, async () => {
        const [row] = await tx
          .select({ n: sql<number>`count(*)` })
          .from(tripPoints)
          .where(
            and(
              eq(tripPoints.tripId, trip.id),
              eq(tripPoints.deviceId, input.deviceId),
              gt(tripPoints.recordedAt, new Date(now - 60_000)),
            ),
          )
        return Number(row?.n ?? 0)
      })
      if (recent + kept.length > POINTS_PER_MINUTE_BUDGET)
        return {
          accepted: 0,
          duplicates: 0,
          dropped,
          skewed,
          throttled: true,
          retryAfterSeconds: THROTTLE_RETRY_SECONDS,
          tripState: trip.state,
          positionUpdated: false,
        }

      // one insert for the whole batch; the unique index is the dedupe
      const inserted = await asGpsWriter(tx, () =>
        tx
          .insert(tripPoints)
          .values(
            kept.map((p) => ({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              tripId: trip.id,
              userId: ctx.actorId,
              deviceId: input.deviceId,
              recordedAt: p.at,
              lat: p.lat,
              lng: p.lng,
              accuracyM: p.accuracyM ?? null,
              speedMps: p.speedMps ?? null,
              heading: p.heading ?? null,
              battery: p.battery ?? null,
            })),
          )
          .onConflictDoNothing({
            target: [
              tripPoints.tenantId,
              tripPoints.tripId,
              tripPoints.deviceId,
              tripPoints.recordedAt,
            ],
          })
          .returning({ recordedAt: tripPoints.recordedAt }),
      )
      const accepted = inserted.length
      const duplicates = kept.length - accepted

      // the live map: the newest ACCEPTED point, only when it is newer than what is stored
      let positionUpdated = false
      const newest = kept
        .filter((p) => p.at.getTime() <= now + SKEW_MS)
        .reduce<(typeof kept)[number] | null>(
          (best, p) => (best === null || p.at.getTime() > best.at.getTime() ? p : best),
          null,
        )
      if (accepted > 0 && newest) {
        const moved = await tx
          .insert(vehiclePositions)
          .values({
            tenantId: ctx.tenantId,
            vehicleId: trip.vehicleId,
            tripId: trip.id,
            lat: newest.lat,
            lng: newest.lng,
            recordedAt: newest.at,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [vehiclePositions.tenantId, vehiclePositions.vehicleId],
            set: {
              tripId: trip.id,
              lat: newest.lat,
              lng: newest.lng,
              recordedAt: newest.at,
              updatedAt: new Date(),
            },
            setWhere: sql`${vehiclePositions.recordedAt} < ${newest.at}`,
          })
          .returning({ vehicleId: vehiclePositions.vehicleId })
        positionUpdated = moved.length > 0
      }
      return {
        accepted,
        duplicates,
        dropped,
        skewed,
        throttled: false,
        retryAfterSeconds: null,
        tripState: trip.state,
        positionUpdated,
      }
    })
  }

  /** The owner's replay of a trip; every call writes `gps.trace_read` (docs/17 A12). */
  async trace(input: TraceIn): Promise<TraceOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const trip = await findTrip(tx, input.id)
      await writeAudit(tx, {
        action: 'gps.trace_read',
        entityType: 'trip',
        entityId: trip.id,
        after: { deviceId: input.deviceId ?? null, everyNth: input.everyNth, limit: input.limit },
      })
      const cursorAt = input.cursor ? new Date(input.cursor) : null
      if (cursorAt && Number.isNaN(cursorAt.getTime()))
        throw new ORPCError('BAD_REQUEST', {
          message: 'cursor is the recordedAt of the last point',
        })
      const rows = (
        await tx.execute(sql`
          select recorded_at, lat, lng, accuracy_m, speed_mps, heading, battery, device_id
            from (
              select p.*, row_number() over (order by p.recorded_at, p.id) as rn
                from trip_points p
               where p.trip_id = ${trip.id}
                 ${input.deviceId ? sql`and p.device_id = ${input.deviceId}` : sql``}
            ) t
           where (t.rn - 1) % ${input.everyNth} = 0
             ${cursorAt ? sql`and t.recorded_at > ${cursorAt}` : sql``}
           order by t.recorded_at, t.id
           limit ${input.limit + 1}`)
      ).rows as {
        recorded_at: Date | string
        lat: number
        lng: number
        accuracy_m: number | null
        speed_mps: number | null
        heading: number | null
        battery: number | null
        device_id: string
      }[]
      const page = rows.slice(0, input.limit)
      const items = page.map((r) => ({
        recordedAt: new Date(r.recorded_at).toISOString(),
        lat: r.lat,
        lng: r.lng,
        accuracyM: r.accuracy_m,
        speedMps: r.speed_mps,
        heading: r.heading,
        battery: r.battery,
        deviceId: r.device_id,
      }))
      const last = items[items.length - 1]
      const truncated = rows.length > input.limit
      return { items, nextCursor: truncated && last ? last.recordedAt : null, truncated }
    })
  }

  /**
   * The trip a batch belongs to. A delivery actor sees only its own trips (RLS), so a missing row is
   * "not your trip" — the one 4xx besides a malformed body the contract allows; the desk gets a 404.
   */
  private async tripForCrew(tx: Db, tripId: string): Promise<TripRow> {
    const ctx = currentTenant()
    const [trip] = await tx.select().from(trips).where(eq(trips.id, tripId)).limit(1)
    if (!trip) {
      if (ctx.actorRole === 'delivery')
        throw new ORPCError('FORBIDDEN', {
          message: `you are not the driver or the helper of trip ${tripId}`,
        })
      throw new ORPCError('NOT_FOUND', { message: `trip ${tripId} not found` })
    }
    if (ctx.actorRole === 'delivery' && !isCrew(trip))
      throw new ORPCError('FORBIDDEN', {
        message: `you are not the driver or the helper of trip ${tripId}`,
      })
    return trip
  }
}
