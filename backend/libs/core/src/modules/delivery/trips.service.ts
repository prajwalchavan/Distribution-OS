import { createHash } from 'node:crypto'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  AddStopInput,
  AddStopOutput,
  ArriveStopInput,
  ArriveStopOutput,
  CancelTripInput,
  CancelTripOutput,
  CreateTripInput,
  CreateTripOutput,
  DepartTripInput,
  DepartTripOutput,
  FailStopInput,
  FailStopOutput,
  NextStopInput,
  NextStopOutput,
  ReorderStopsInput,
  ReorderStopsOutput,
  ReturnTripInput,
  ReturnTripOutput,
  StartLoadingInput,
  StartLoadingOutput,
  StartStopInput,
  StartStopOutput,
  Stop,
  StopsListInput,
  StopsListOutput,
  TripDetail,
  TripGetInput,
  TripGetOutput,
  TripsListInput,
  TripsListOutput,
  TripStopInput,
} from '@dos/contracts'
import type { StopState as MachineStopState } from '@dos/domain'
import {
  deliveries,
  deliveryLines,
  memberships,
  trips,
  tripStops,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  ANY_MEMBER,
  currentTenant,
  DB,
  idempotent,
  nextDocumentNumber,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { BillingService } from '../billing/index.js'
import { OrdersService } from '../orders/index.js'
import { LoadSheetsService } from '../warehouse/index.js'
import {
  assertCrewOrDesk,
  asSystemRole,
  defined,
  DOORSTEP,
  driverConsentGranted,
  emitDeliveryEvent,
  findRetailer,
  findTrip,
  haversineMetres,
  isForeignKeyViolation,
  isUniqueViolation,
  loadTripPolicy,
  loadVehicle,
  loadVehicles,
  lockStop,
  lockTrip,
  PIN_HOLDERS,
  STOCK_VIEWERS,
  STOP_TERMINAL,
  stopEventsTo,
  stopTransition,
  stopsOf,
  TRIP_PLANNERS,
  TRIP_TERMINAL,
  tripEventPayload,
  tripTransition,
  vanSalesFlag,
  whenOr,
  type StopRow,
  type TripRow,
} from './delivery.internals.js'
import {
  loadTripDetail,
  mapDeliveries,
  mapStops,
  stopsWithVehicles,
  toStopRetailer,
  toTrip,
  type TripDetailDeps,
} from './delivery.mappers.js'

/** One stop as the route optimiser needs it: where it stands today, and where the shop actually is. */
export interface RoutingStop {
  stopId: string
  sequence: number
  retailerId: string
  retailerName: string
  lat: number | null
  lng: number | null
  /** Delivered, partial, failed or skipped: a plan may not move it, and the optimiser is told so. */
  terminal: boolean
}

type CreateIn = z.infer<typeof CreateTripInput>
type CreateOut = z.infer<typeof CreateTripOutput>
type ListIn = z.infer<typeof TripsListInput>
type ListOut = z.infer<typeof TripsListOutput>
type GetIn = z.infer<typeof TripGetInput>
type GetOut = z.infer<typeof TripGetOutput>
type StartLoadingIn = z.infer<typeof StartLoadingInput>
type StartLoadingOut = z.infer<typeof StartLoadingOutput>
type DepartIn = z.infer<typeof DepartTripInput>
type DepartOut = z.infer<typeof DepartTripOutput>
type ReturnIn = z.infer<typeof ReturnTripInput>
type ReturnOut = z.infer<typeof ReturnTripOutput>
type CancelIn = z.infer<typeof CancelTripInput>
type CancelOut = z.infer<typeof CancelTripOutput>
type StopsIn = z.infer<typeof StopsListInput>
type StopsOut = z.infer<typeof StopsListOutput>
type NextIn = z.infer<typeof NextStopInput>
type NextOut = z.infer<typeof NextStopOutput>
type AddStopIn = z.infer<typeof AddStopInput>
type AddStopOut = z.infer<typeof AddStopOutput>
type ReorderIn = z.infer<typeof ReorderStopsInput>
type ReorderOut = z.infer<typeof ReorderStopsOutput>
type StartStopIn = z.infer<typeof StartStopInput>
type StartStopOut = z.infer<typeof StartStopOutput>
type ArriveIn = z.infer<typeof ArriveStopInput>
type ArriveOut = z.infer<typeof ArriveStopOutput>
type FailIn = z.infer<typeof FailStopInput>
type FailOut = z.infer<typeof FailStopOutput>
type StopIn = z.infer<typeof TripStopInput>

/** The `TRIP` series: internal paper, allocated at plan time (a trip is never a tax document). */
export const TRIP_SERIES = 'TRIP'

/** How far a planned collection may be from the bills on the stop before it is a planning mistake: none. */
const MAX_STOPS_PER_TRIP = 80

/**
 * Trips and their stops: the plan, the departure, the road, the return.
 *
 * WAREHOUSE DISPATCHES (coordination §4 item 4): `packed → dispatched` happens at
 * `warehouse.loadSheets.confirm`. `depart` here dispatches only the orders the godown has not, and
 * treats an already-dispatched order as a no-op. The godown → vehicle transfer is warehouse's too; this
 * module only asks `LoadSheetsService.confirmedForTrip` whether the load is out.
 *
 * Every state move is `tripMachine` / `stopMachine` through `tripTransition` / `stopTransition`; the
 * one column written outside a machine is `trip_stops.state = 'skipped'` on a cancelled trip, which
 * the contract documents as exactly that. Out-of-order offline batches are tolerated (docs/07 §7.3):
 * a stop already past the requested state whose incoming `occurredAt` is older than what is stored
 * answers the current row, never a 409.
 */
@Injectable()
export class TripsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly billing: BillingService,
    private readonly loadSheets: LoadSheetsService,
  ) {}

  // -------------------------------------------------------------------------------------------------------------
  // trips

  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(TRIP_PLANNERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        if (input.helperId !== undefined && input.helperId === input.driverId)
          throw new ORPCError('BAD_REQUEST', {
            message: 'the driver and the helper are two people',
          })
        if (
          ctx.actorRole === 'delivery' &&
          ctx.actorId !== input.driverId &&
          ctx.actorId !== input.helperId
        )
          throw new ORPCError('FORBIDDEN', {
            message: 'a crew member plans only a trip it is the driver or the helper of',
          })
        if (input.vanSalesEnabled && !(await vanSalesFlag(tx)))
          throw new ORPCError('BAD_REQUEST', {
            message: 'van sales are not enabled for this distributor (feature_flags.van_sales)',
          })
        if (input.stops.length === 0 && !input.vanSalesEnabled)
          throw new ORPCError('BAD_REQUEST', {
            message: 'a trip with no stops only makes sense with van sales enabled',
          })
        const vehicle = await loadVehicle(tx, input.vehicleId)
        if (!vehicle.active)
          throw new ORPCError('BAD_REQUEST', { message: `vehicle ${vehicle.regNo} is not active` })
        await this.assertMember(tx, input.driverId)
        if (input.helperId) await this.assertMember(tx, input.helperId)
        const [busy] = await tx
          .select({ id: trips.id, tripNo: trips.tripNo })
          .from(trips)
          .where(
            and(
              eq(trips.tripDate, input.tripDate),
              or(eq(trips.driverId, input.driverId), eq(trips.helperId, input.driverId)),
              sql`${trips.state} not in ('settled', 'settled_with_variance', 'cancelled')`,
            ),
          )
          .limit(1)
        if (busy)
          throw new ORPCError('CONFLICT', {
            message: `the driver is already on trip ${busy.tripNo ?? busy.id} on ${input.tripDate}`,
          })
        const sequences = new Set<number>()
        for (const stop of input.stops) {
          if (sequences.has(stop.sequence))
            throw new ORPCError('BAD_REQUEST', {
              message: `two stops carry sequence ${String(stop.sequence)}`,
            })
          sequences.add(stop.sequence)
        }
        const now = new Date()
        const tripNo = await nextDocumentNumber(tx, TRIP_SERIES, now)
        let trip: TripRow | undefined
        try {
          ;[trip] = await tx.transaction((sp) =>
            sp
              .insert(trips)
              .values({
                id: input.id,
                tenantId: ctx.tenantId,
                tripNo,
                tripDate: input.tripDate,
                vehicleId: vehicle.id,
                driverId: input.driverId,
                helperId: input.helperId ?? null,
                state: 'planned',
                vanSalesEnabled: input.vanSalesEnabled,
                plannedStops: input.stops.length,
                openingCashPaise: input.openingCashPaise,
              })
              .returning(),
          )
        } catch (err) {
          if (isUniqueViolation(err))
            throw new ORPCError('CONFLICT', { message: `trip ${input.id} already exists` })
          throw err
        }
        if (!trip)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'trip insert returned nothing' })
        for (const stop of input.stops) await this.insertStop(tx, trip, stop, stop.sequence)
        await emitDeliveryEvent(tx, 'trip', trip.id, 'TripPlanned', tripEventPayload(trip))
        return { item: await this.detail(tx, trip) }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(STOCK_VIEWERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      // The crew never lists another crew's trips: RLS hides them AND the filter is forced.
      const mine = input.mine || ctx.actorRole === 'delivery'
      const filters: (SQL | undefined)[] = [
        input.state ? eq(trips.state, input.state) : undefined,
        input.states && input.states.length > 0 ? inArray(trips.state, input.states) : undefined,
        input.vehicleId ? eq(trips.vehicleId, input.vehicleId) : undefined,
        input.driverId ? eq(trips.driverId, input.driverId) : undefined,
        input.from ? gte(trips.tripDate, input.from) : undefined,
        input.to ? lte(trips.tripDate, input.to) : undefined,
        mine ? or(eq(trips.driverId, ctx.actorId), eq(trips.helperId, ctx.actorId)) : undefined,
        input.cursor ? lt(trips.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(trips)
        .where(and(...defined(filters)))
        .orderBy(desc(trips.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const vehicles = await loadVehicles(
        tx,
        page.map((r) => r.vehicleId),
      )
      const stopRows =
        page.length === 0
          ? []
          : await tx
              .select({ tripId: tripStops.tripId, state: tripStops.state })
              .from(tripStops)
              .where(
                inArray(
                  tripStops.tripId,
                  page.map((r) => r.id),
                ),
              )
      const items = page.map((row) =>
        toTrip(
          row,
          vehicles.get(row.vehicleId),
          stopRows.filter((s) => s.tripId === row.id),
        ),
      )
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(STOCK_VIEWERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const trip = await findTrip(tx, input.id)
      assertCrewOrDesk(
        trip,
        STOCK_VIEWERS.filter((r) => r !== 'delivery'),
      )
      return { item: await this.detail(tx, trip) }
    })
  }

  async startLoading(input: StartLoadingIn): Promise<StartLoadingOut> {
    requireRole(TRIP_PLANNERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.id)
        assertCrewOrDesk(trip, TRIP_PLANNERS)
        if (trip.state === 'loading') return { item: await this.detail(tx, trip) }
        const to = tripTransition(trip.state, 'start_loading')
        const next = await this.updateTrip(tx, trip.id, { state: to })
        await emitDeliveryEvent(tx, 'trip', next.id, 'TripLoading', tripEventPayload(next))
        return { item: await this.detail(tx, next) }
      }),
    )
  }

  /**
   * `loading → active`. Needs the driver's granted location consent (DPDP, 403 `gps_consent_missing`;
   * a denied OS permission on the phone never blocks a trip). Orders on the trip the godown has NOT
   * dispatched through a confirmed load sheet are dispatched here; an already-dispatched order is a
   * no-op (coordination §4 item 4).
   */
  async depart(input: DepartIn): Promise<DepartOut> {
    requireRole(TRIP_PLANNERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.id)
        assertCrewOrDesk(trip, TRIP_PLANNERS)
        if (trip.state === 'active') return { item: await this.detail(tx, trip) }
        const to = tripTransition(trip.state, 'depart')
        const stops = await stopsOf(tx, trip.id)
        if (stops.length === 0 && !trip.vanSalesEnabled)
          throw new ORPCError('CONFLICT', {
            message: 'a trip with no stops and no van sales has nowhere to go',
          })
        if (!trip.driverId || !(await driverConsentGranted(tx, trip.driverId)))
          throw new ORPCError('FORBIDDEN', {
            message:
              'the driver has not acknowledged the location notice; record it with POST /delivery/consents first',
            data: { code: 'gps_consent_missing', driverId: trip.driverId },
          })
        const now = whenOr(input.occurredAt, new Date())
        const planned = await tx
          .select({ orderId: deliveries.orderId })
          .from(deliveries)
          .where(and(eq(deliveries.tripId, trip.id), sql`${deliveries.outcome} is null`))
        for (const orderId of new Set(planned.map((d) => d.orderId).filter(Boolean)))
          await this.dispatchIfPacked(tx, orderId as string, input.deviceId ?? null)
        const next = await this.updateTrip(tx, trip.id, {
          state: to,
          startedAt: now,
          startOdometerKm: input.startOdometerKm ?? trip.startOdometerKm,
          openingCashPaise: input.openingCashPaise ?? trip.openingCashPaise,
        })
        await emitDeliveryEvent(tx, 'trip', next.id, 'TripDeparted', tripEventPayload(next))
        return { item: await this.detail(tx, next) }
      }),
    )
  }

  /**
   * Check-in: `active → closing`. Stops still open become `failed` ("trip returned") and their bills
   * go back to `packed` through `OrdersService`; the pieces stay on the van until the settlement
   * counts them back in.
   */
  async return(input: ReturnIn): Promise<ReturnOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.id)
        assertCrewOrDesk(trip, DOORSTEP)
        if (trip.state === 'closing') return { item: await this.detail(tx, trip) }
        const to = tripTransition(trip.state, 'return')
        const now = whenOr(input.occurredAt, new Date())
        for (const stop of await stopsOf(tx, trip.id)) {
          if (STOP_TERMINAL.has(stop.state)) continue
          await this.failStopInTx(tx, stop, 'other', 'trip returned', now, input.deviceId ?? null)
        }
        const next = await this.updateTrip(tx, trip.id, {
          state: to,
          endedAt: now,
          endOdometerKm: input.endOdometerKm ?? trip.endOdometerKm,
        })
        await emitDeliveryEvent(tx, 'trip', next.id, 'TripReturned', tripEventPayload(next))
        return { item: await this.detail(tx, next) }
      }),
    )
  }

  /** Only from `planned` / `loading`. Stops → `skipped` (the one non-machine stop write, documented). */
  async cancel(input: CancelIn): Promise<CancelOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.id)
        if (trip.state === 'cancelled') return { item: await this.detail(tx, trip) }
        const to = tripTransition(trip.state, 'cancel')
        const now = new Date()
        await tx
          .update(tripStops)
          .set({ state: 'skipped', failureNote: input.reason, completedAt: now, updatedAt: now })
          .where(
            and(
              eq(tripStops.tripId, trip.id),
              sql`${tripStops.state} not in ('delivered', 'partial', 'failed', 'skipped')`,
            ),
          )
        const next = await this.updateTrip(tx, trip.id, { state: to, endedAt: now })
        await emitDeliveryEvent(tx, 'trip', next.id, 'TripCancelled', {
          ...tripEventPayload(next),
          reason: input.reason,
        })
        return { item: await this.detail(tx, next) }
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // stops

  /** A shop sees only its own stops (RLS) with an ETA and never a coordinate (mapper); the crew its own trips'. */
  async listStops(input: StopsIn): Promise<StopsOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.tripId ? eq(tripStops.tripId, input.tripId) : undefined,
        input.retailerId ? eq(tripStops.retailerId, input.retailerId) : undefined,
        input.state ? eq(tripStops.state, input.state) : undefined,
        input.date
          ? sql`${tripStops.tripId} in (select t.id from trips t where t.trip_date = ${input.date})`
          : undefined,
        input.cursor ? lt(tripStops.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(tripStops)
        .where(and(...defined(filters)))
        .orderBy(desc(tripStops.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const items = await stopsWithVehicles(tx, page, this.deps())
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /** The crew's home screen: the first open stop by sequence, with the shop to visit. */
  async nextStop(input: NextIn): Promise<NextOut> {
    requireRole(STOCK_VIEWERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const trip = await findTrip(tx, input.id)
      assertCrewOrDesk(
        trip,
        STOCK_VIEWERS.filter((r) => r !== 'delivery'),
      )
      const open = (await stopsOf(tx, trip.id)).filter((s) => !STOP_TERMINAL.has(s.state))
      const first = open[0]
      if (!first) return { item: null, retailer: null, remaining: 0 }
      const vehicle = await loadVehicle(tx, trip.vehicleId)
      const [item] = await mapStops(tx, [first], this.deps(), () => vehicle.regNo)
      const retailer = await findRetailer(tx, first.retailerId)
      return { item: item ?? null, retailer: toStopRetailer(retailer), remaining: open.length }
    })
  }

  /** A late bill from the desk, or the shop the crew is about to sell van stock to. */
  async addStop(input: AddStopIn): Promise<AddStopOut> {
    requireRole(TRIP_PLANNERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.id)
        assertCrewOrDesk(trip, TRIP_PLANNERS)
        if (TRIP_TERMINAL.has(trip.state) || trip.state === 'closing')
          throw new ORPCError('CONFLICT', {
            message: `trip ${trip.tripNo ?? trip.id} is ${trip.state}; a stop is added before check-in`,
          })
        if (ctx.actorRole === 'delivery') {
          if (trip.state !== 'active')
            throw new ORPCError('CONFLICT', {
              message: 'the crew adds a stop only to its active trip',
            })
          if (!trip.vanSalesEnabled || !(await vanSalesFlag(tx)))
            throw new ORPCError('FORBIDDEN', {
              message: 'the crew adds a stop only when van sales are allowed on this trip',
            })
        }
        const existing = await stopsOf(tx, trip.id)
        if (existing.some((s) => s.id === input.stop.id))
          return { item: await this.detail(tx, trip) }
        if (existing.length >= MAX_STOPS_PER_TRIP)
          throw new ORPCError('BAD_REQUEST', {
            message: `a trip carries at most ${String(MAX_STOPS_PER_TRIP)} stops`,
          })
        const maxSeq = existing.reduce((n, s) => Math.max(n, s.sequence), 0)
        const sequence = input.stop.sequence ?? maxSeq + 1
        if (existing.some((s) => s.sequence === sequence))
          throw new ORPCError('CONFLICT', {
            message: `sequence ${String(sequence)} is already taken on this trip`,
          })
        await this.insertStop(tx, trip, input.stop, sequence)
        const next = await this.updateTrip(tx, trip.id, { plannedStops: existing.length + 1 })
        return { item: await this.detail(tx, next) }
      }),
    )
  }

  /**
   * Two passes — first every listed stop to `sequence + 1000`, then the target values — so
   * `trip_stops_sequence_idx` never trips mid-statement. A terminal stop keeps its sequence and is
   * refused when listed with a new one.
   */
  async reorderStops(input: ReorderIn): Promise<ReorderOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.id)
        assertCrewOrDesk(trip, DOORSTEP)
        await this.reorderStopsInTx(tx, trip, input.order)
        return { item: await this.detail(tx, trip) }
      }),
    )
  }

  /**
   * The re-sequencing itself, transaction-scoped, so `modules/ai`'s `routing.apply` writes a computed
   * sequence through exactly this code — the same validation, the same refusals and the same
   * two-pass swap the crew's own drag-and-drop goes through (coordination §3.9, §4: ai → delivery).
   * There is no second way to move a stop.
   */
  async reorderStopsInTx(
    tx: Db,
    trip: TripRow,
    order: readonly { stopId: string; sequence: number }[],
  ): Promise<void> {
    if (TRIP_TERMINAL.has(trip.state) || trip.state === 'closing')
      throw new ORPCError('CONFLICT', {
        message: `trip ${trip.tripNo ?? trip.id} is ${trip.state}; nothing left to reorder`,
      })
    const existing = new Map((await stopsOf(tx, trip.id)).map((s) => [s.id, s]))
    const targets = new Set<number>()
    for (const entry of order) {
      const stop = existing.get(entry.stopId)
      if (!stop)
        throw new ORPCError('BAD_REQUEST', {
          message: `stop ${entry.stopId} is not on this trip`,
        })
      if (STOP_TERMINAL.has(stop.state) && stop.sequence !== entry.sequence)
        throw new ORPCError('CONFLICT', {
          message: `stop ${entry.stopId} is ${stop.state} and keeps its sequence`,
        })
      if (targets.has(entry.sequence))
        throw new ORPCError('BAD_REQUEST', {
          message: `two stops are given sequence ${String(entry.sequence)}`,
        })
      targets.add(entry.sequence)
    }
    const untouched = [...existing.values()].filter((s) => !order.some((o) => o.stopId === s.id))
    for (const s of untouched)
      if (targets.has(s.sequence))
        throw new ORPCError('CONFLICT', {
          message: `sequence ${String(s.sequence)} is held by stop ${s.id}, which is not in the order`,
        })
    // Two passes: park every moving stop 1000 above itself, then set the new numbers. A single pass
    // would collide with the unique (trip, sequence) index halfway through a swap.
    const now = new Date()
    const ids = order.map((o) => o.stopId)
    await tx
      .update(tripStops)
      .set({ sequence: sql`${tripStops.sequence} + 1000`, updatedAt: now })
      .where(inArray(tripStops.id, ids))
    for (const entry of order)
      await tx
        .update(tripStops)
        .set({ sequence: entry.sequence, updatedAt: now })
        .where(eq(tripStops.id, entry.stopId))
  }

  /**
   * A trip the caller may plan a route for, locked. `desk` names the roles that pass on sight; a
   * `delivery` caller falls through to the crew check, so a driver sequences its OWN trip and no
   * other. RLS has already hidden another crew's trip (404), this only turns that into a clear 403.
   */
  async tripForRouting(tx: Db, tripId: string, desk: readonly ActorRole[]): Promise<TripRow> {
    const trip = await lockTrip(tx, tripId)
    assertCrewOrDesk(trip, desk)
    return trip
  }

  /** The same, without the row lock: the read side of `ai.routing.get`. */
  async tripForReading(tx: Db, tripId: string, desk: readonly ActorRole[]): Promise<TripRow> {
    const trip = await findTrip(tx, tripId)
    assertCrewOrDesk(trip, desk)
    return trip
  }

  /**
   * The stops of a trip with the shop's PIN, for the route optimiser (coordination §3.9: ai reads
   * delivery's stops through this, never through `trip_stops`). Terminal stops are included and
   * flagged, because a plan may not move one — the optimiser needs to know they are spoken for.
   */
  async routingStops(tx: Db, tripId: string): Promise<RoutingStop[]> {
    const result = await tx.execute(sql`
      select s.id, s.sequence, s.retailer_id, s.state, r.name as retailer_name, r.lat, r.lng
      from trip_stops s
      join retailers r on r.id = s.retailer_id
      where s.trip_id = ${tripId}
      order by s.sequence asc, s.id asc
    `)
    return result.rows.map((row) => ({
      stopId: String(row.id),
      sequence: Number(row.sequence),
      retailerId: String(row.retailer_id),
      retailerName: String(row.retailer_name),
      lat: row.lat === null ? null : Number(row.lat),
      lng: row.lng === null ? null : Number(row.lng),
      terminal: STOP_TERMINAL.has(String(row.state) as MachineStopState),
    }))
  }

  /** Every stop of a trip in its current order, mapped for the wire. */
  async stopsOfTrip(tx: Db, trip: TripRow): Promise<Stop[]> {
    const vehicle = await loadVehicle(tx, trip.vehicleId)
    return mapStops(tx, await stopsOf(tx, trip.id), this.deps(), () => vehicle.regNo)
  }

  async startStop(input: StartStopIn): Promise<StartStopOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, () => this.startStopInTx(tx, input)),
    )
  }

  async startStopInTx(tx: Db, input: StartStopIn): Promise<StartStopOut> {
    {
      {
        const stop = await lockStop(tx, input.id)
        const trip = await this.tripOfStop(tx, stop)
        const at = whenOr(input.occurredAt, new Date())
        if (stop.state !== 'pending') {
          // out-of-order batch: an older `start` on a stop already past it is a no-op, never a 409
          if (input.occurredAt && stop.startedAt && at.getTime() <= stop.startedAt.getTime())
            return { item: await this.stopItem(tx, stop, trip) }
          if (stop.state === 'started') return { item: await this.stopItem(tx, stop, trip) }
          stopTransition(stop.state as MachineStopState, 'start')
        }
        this.assertOnTheRoad(trip)
        const next = await this.walkStop(tx, stop, 'started', at, null)
        return { item: await this.stopItem(tx, next, trip) }
      }
    }
  }

  /** `distanceM` is evidence for the geofence, never a block; a missing fix on either side is null. */
  async arriveStop(input: ArriveIn): Promise<ArriveOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, () => this.arriveStopInTx(tx, input)),
    )
  }

  async arriveStopInTx(tx: Db, input: ArriveIn): Promise<ArriveOut> {
    {
      {
        const stop = await lockStop(tx, input.id)
        const trip = await this.tripOfStop(tx, stop)
        const at = whenOr(input.occurredAt, new Date())
        const fix =
          input.lat !== undefined && input.lng !== undefined
            ? { lat: input.lat, lng: input.lng }
            : null
        const retailer = await findRetailer(tx, stop.retailerId)
        const distanceM =
          fix && retailer.lat !== null && retailer.lng !== null
            ? haversineMetres(fix, { lat: retailer.lat, lng: retailer.lng })
            : null
        if (stop.state !== 'pending' && stop.state !== 'started') {
          const reached = stop.arrivedAt ?? stop.completedAt
          if (input.occurredAt && reached && at.getTime() <= reached.getTime())
            return { item: await this.stopItem(tx, stop, trip), distanceM }
          if (stop.state === 'arrived')
            return { item: await this.stopItem(tx, stop, trip), distanceM }
          stopTransition(stop.state as MachineStopState, 'arrive')
        }
        this.assertOnTheRoad(trip)
        const next = await this.walkStop(tx, stop, 'arrived', at, fix)
        return { item: await this.stopItem(tx, next, trip), distanceM }
      }
    }
  }

  /** Nothing delivered: the reason, `failed` on every planned bill, the orders back to `packed`, NO stock moves. */
  async failStop(input: FailIn): Promise<FailOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, () => this.failStopFromInput(tx, input)),
    )
  }

  async failStopFromInput(tx: Db, input: FailIn): Promise<FailOut> {
    {
      {
        const stop = await lockStop(tx, input.id)
        const trip = await this.tripOfStop(tx, stop)
        const at = whenOr(input.occurredAt, new Date())
        if (STOP_TERMINAL.has(stop.state)) {
          if (stop.state === 'failed') return this.failReply(tx, stop, trip)
          stopTransition(stop.state as MachineStopState, 'fail')
        }
        this.assertOnTheRoad(trip)
        const next = await this.failStopInTx(
          tx,
          stop,
          input.failureReason,
          input.failureNote?.trim() || null,
          at,
          input.deviceId ?? null,
        )
        return this.failReply(tx, next, trip)
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // shared with the other delivery services

  detail(tx: Db, trip: TripRow): Promise<TripDetail> {
    return loadTripDetail(tx, trip, this.tripDeps())
  }

  deps(): TripDetailDeps {
    return this.tripDeps()
  }

  /**
   * A stop from where it is to `target`, every step through `stopMachine`, stamping the timestamp of
   * each rung it passes. Shared with `deliveries.record`, which lands a stop on `delivered` /
   * `partial` even when the offline batch lost the `arrive` op.
   */
  async walkStop(
    tx: Db,
    stop: StopRow,
    target: 'started' | 'arrived' | 'delivered' | 'partial' | 'failed',
    at: Date,
    fix: { lat: number; lng: number } | null,
  ): Promise<StopRow> {
    let state = stop.state as MachineStopState
    const patch: Partial<typeof tripStops.$inferInsert> = {}
    for (const event of stopEventsTo(state, target)) {
      state = stopTransition(state, event)
      if (event === 'start') patch.startedAt = stop.startedAt ?? at
      if (event === 'arrive') {
        patch.arrivedAt = stop.arrivedAt ?? at
        if (fix) {
          patch.arrivedLat = fix.lat
          patch.arrivedLng = fix.lng
        }
      }
      if (event === 'deliver' || event === 'deliver_partial' || event === 'fail')
        patch.completedAt = at
    }
    if (state === stop.state && Object.keys(patch).length === 0) return stop
    const [next] = await tx
      .update(tripStops)
      .set({ ...patch, state, updatedAt: new Date() })
      .where(eq(tripStops.id, stop.id))
      .returning()
    return next ?? stop
  }

  async stopItem(tx: Db, stop: StopRow, trip: TripRow): Promise<Stop> {
    const vehicle = await loadVehicle(tx, trip.vehicleId)
    const [item] = await mapStops(tx, [stop], this.deps(), () => vehicle.regNo)
    if (!item)
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'stop mapper returned nothing' })
    return item
  }

  /** The trip a stop hangs off, with the crew check for a delivery actor. */
  async tripOfStop(tx: Db, stop: StopRow): Promise<TripRow> {
    const trip = await lockTrip(tx, stop.tripId)
    assertCrewOrDesk(trip, DOORSTEP)
    return trip
  }

  assertOnTheRoad(trip: TripRow): void {
    if (trip.state !== 'active')
      throw new ORPCError('CONFLICT', {
        message: `trip ${trip.tripNo ?? trip.id} is ${trip.state}; the crew works a stop while the trip is active`,
      })
  }

  /** An order the godown packed but never put on a confirmed load sheet leaves with the trip. */
  private async dispatchIfPacked(tx: Db, orderId: string, deviceId: string | null): Promise<void> {
    const order = await this.orders.findOrder(tx, orderId)
    if (!order) return
    if (
      order.state === 'dispatched' ||
      order.state === 'delivered' ||
      order.state === 'partially_delivered'
    )
      return
    if (order.state !== 'packed')
      throw new ORPCError('CONFLICT', {
        message: `order ${order.orderNo ?? order.id} is ${order.state}; only a packed bill leaves on a trip`,
      })
    await this.orders.applyFulfilmentEvent(tx, order.id, 'dispatch', deviceId, 'trip depart')
  }

  /** The doorstep failure, shared by `stops.fail` and `trips.return`. Stock stays on the van. */
  private async failStopInTx(
    tx: Db,
    stop: StopRow,
    failureReason: StopRow['failureReason'],
    failureNote: string | null,
    at: Date,
    deviceId: string | null,
  ): Promise<StopRow> {
    const ctx = currentTenant()
    const walked = await this.walkStop(tx, stop, 'failed', at, null)
    const [next] = await tx
      .update(tripStops)
      .set({ failureReason, failureNote, updatedAt: new Date() })
      .where(eq(tripStops.id, stop.id))
      .returning()
    const row = next ?? walked
    const planned = await tx
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.stopId, stop.id), sql`${deliveries.outcome} is null`))
      .orderBy(asc(deliveries.id))
    const invoiceIds: string[] = []
    for (const d of planned) {
      invoiceIds.push(d.invoiceId)
      await tx
        .update(deliveries)
        .set({
          outcome: 'failed',
          deliveredBy: ctx.actorRole === 'system' ? null : ctx.actorId,
          deliveredAt: at,
          deviceId: deviceId ?? d.deviceId,
          note: failureNote ?? d.note,
          updatedAt: new Date(),
        })
        .where(eq(deliveries.id, d.id))
      const invoice = await this.billing.invoiceForDelivery(tx, d.invoiceId)
      if (invoice.lines.length > 0)
        await tx
          .insert(deliveryLines)
          .values(
            invoice.lines.map((l) => ({
              id: deterministicLineId(d.id, l.id),
              tenantId: ctx.tenantId,
              deliveryId: d.id,
              invoiceLineId: l.id,
              deliveredQtyPcs: 0,
              returnedQtyPcs: 0,
              returnedSaleable: true,
              reason: null,
            })),
          )
          .onConflictDoNothing()
      if (d.orderId)
        await this.orders.applyFulfilmentEvent(
          tx,
          d.orderId,
          'return_undelivered',
          deviceId,
          failureReason ?? 'failed',
        )
    }
    await emitDeliveryEvent(tx, 'trip', row.tripId, 'StopFailed', {
      tripId: row.tripId,
      stopId: row.id,
      retailerId: row.retailerId,
      failureReason,
      invoiceIds,
    })
    return row
  }

  private async failReply(tx: Db, stop: StopRow, trip: TripRow): Promise<FailOut> {
    const rows = await tx
      .select()
      .from(deliveries)
      .where(eq(deliveries.stopId, stop.id))
      .orderBy(asc(deliveries.id))
    return {
      item: await this.stopItem(tx, stop, trip),
      deliveries: await mapDeliveries(tx, rows, this.deps()),
    }
  }

  /**
   * A stop and the planned `deliveries` row (outcome null) per bill on it, so `depart`, `fail` and
   * `record` know which documents ride on the van. Each bill must be the shop's own, issued, and not
   * already planned on another open stop.
   */
  private async insertStop(
    tx: Db,
    trip: TripRow,
    stop: Omit<StopIn, 'sequence'>,
    sequence: number,
  ): Promise<void> {
    const ctx = currentTenant()
    const retailer = await findRetailer(tx, stop.retailerId)
    const invoiceIds = [...new Set(stop.invoiceIds)]
    const refs = await this.billing.invoiceRefs(tx, invoiceIds)
    const orderIds = new Map<string, string | null>()
    for (const invoiceId of invoiceIds) {
      const ref = refs.get(invoiceId)
      if (!ref) throw new ORPCError('NOT_FOUND', { message: `invoice ${invoiceId} not found` })
      if (ref.state === 'draft' || ref.state === 'cancelled')
        throw new ORPCError('CONFLICT', {
          message: `invoice ${ref.invoiceNo ?? invoiceId} is ${ref.state}; only an issued bill rides on a trip`,
        })
      const bill = await this.billing.invoiceForDelivery(tx, invoiceId)
      if (bill.retailerId !== retailer.id)
        throw new ORPCError('BAD_REQUEST', {
          message: `invoice ${ref.invoiceNo ?? invoiceId} belongs to another shop than stop ${String(sequence)}`,
        })
      orderIds.set(invoiceId, bill.orderId)
      const [open] = await tx
        .select({ id: deliveries.id, tripId: deliveries.tripId })
        .from(deliveries)
        .innerJoin(trips, eq(trips.id, deliveries.tripId))
        .where(
          and(
            eq(deliveries.invoiceId, invoiceId),
            sql`${deliveries.outcome} is null`,
            sql`${trips.state} not in ('settled', 'settled_with_variance', 'cancelled')`,
          ),
        )
        .limit(1)
      if (open)
        throw new ORPCError('CONFLICT', {
          message: `invoice ${ref.invoiceNo ?? invoiceId} is already planned on trip ${open.tripId}`,
        })
    }
    try {
      await tx.transaction(async (sp) => {
        await sp.insert(tripStops).values({
          id: stop.id,
          tenantId: ctx.tenantId,
          tripId: trip.id,
          sequence,
          retailerId: retailer.id,
          state: 'pending',
          plannedCollectionPaise:
            stop.plannedCollectionPaise ??
            invoiceIds.reduce((n, id) => n + (refs.get(id)?.totalPaise ?? 0), 0),
          etaAt: stop.etaAt ? new Date(stop.etaAt) : null,
        })
        // The planned rows are DERIVED from the stop the planner just wrote; the doorstep write
        // policy is the crew's and the desk's, so a WAREHOUSE planner inserts them as `system`.
        if (invoiceIds.length > 0)
          await asSystemRole(sp, () =>
            sp.insert(deliveries).values(
              invoiceIds.map((invoiceId) => ({
                id: deterministicDeliveryId(stop.id, invoiceId),
                tenantId: ctx.tenantId,
                tripId: trip.id,
                stopId: stop.id,
                retailerId: retailer.id,
                orderId: orderIds.get(invoiceId) ?? null,
                invoiceId,
                outcome: null,
                idempotencyKey: `plan:${stop.id}:${invoiceId}`,
              })),
            ),
          )
      })
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ORPCError('CONFLICT', {
          message: `stop ${stop.id} (sequence ${String(sequence)}) clashes with a stop that already exists`,
        })
      if (isForeignKeyViolation(err))
        throw new ORPCError('BAD_REQUEST', { message: 'a stop names a row that does not exist' })
      throw err
    }
  }

  private async assertMember(tx: Db, userId: string): Promise<void> {
    const { tenantId } = currentTenant()
    const [row] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1)
    if (!row)
      throw new ORPCError('BAD_REQUEST', {
        message: `user ${userId} is not an active member of this distributor`,
      })
  }

  private async updateTrip(
    tx: Db,
    id: string,
    values: Partial<typeof trips.$inferInsert>,
  ): Promise<TripRow> {
    const [row] = await tx
      .update(trips)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(trips.id, id))
      .returning()
    if (!row) throw new ORPCError('NOT_FOUND', { message: `trip ${id} not found` })
    return row
  }

  private tripDeps(): TripDetailDeps {
    return {
      invoiceRefs: (tx, ids) => this.billing.invoiceRefs(tx, ids),
      loadConfirmed: async (tx, tripId) =>
        (await this.loadSheets.confirmedForTrip(tx, tripId)).map((s) => ({
          id: s.id,
          confirmedAt: s.confirmedAt,
        })),
      policy: (tx) => loadTripPolicy(tx),
      vanSalesFlag: (tx) => vanSalesFlag(tx),
    }
  }
}

/**
 * The planned `deliveries` row of one bill on one stop, keyed so a replayed plan lands on the same
 * row: `uuidv7`-shaped, derived from the pair (the ids the crew will see are the ones the desk saw).
 */
export function deterministicDeliveryId(stopId: string, invoiceId: string): string {
  return stableId(`delivery:${stopId}:${invoiceId}`)
}

export function deterministicLineId(deliveryId: string, invoiceLineId: string): string {
  return stableId(`delivery-line:${deliveryId}:${invoiceLineId}`)
}

/** A stable UUIDv7-shaped id derived from a seed string (version and variant bits set). */
function stableId(seed: string): string {
  const b = Buffer.from(createHash('sha256').update(seed).digest().subarray(0, 16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
