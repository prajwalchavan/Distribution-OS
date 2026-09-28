import { createHash } from 'node:crypto'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm'
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
  DropBillInput,
  DropBillOutput,
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
  TripPlanningInput,
  TripPlanningOutput,
  TripsListInput,
  TripsListOutput,
  TripStopInput,
} from '@dos/contracts'
import { businessDate, type StopState as MachineStopState } from '@dos/domain'
import {
  deliveries,
  deliveryLines,
  departedEarly,
  memberships,
  trips,
  tripStops,
  vehicles,
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
  writeAudit,
} from '../../platform/index.js'
import { istDateWord } from '../../platform/refusal-words.js'
import { BillingService } from '../billing/index.js'
import { OrdersService } from '../orders/index.js'
import { ReceivablesService } from '../receivables/index.js'
import { activeMembersWithRole } from '../tenancy/index.js'
import { LoadSheetsService } from '../warehouse/index.js'
import {
  assertCrewOrDesk,
  asSystemRole,
  declareUndelivered,
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
  retailerNames,
  ridingTrips,
  STOCK_VIEWERS,
  STOP_TERMINAL,
  stopEventsTo,
  stopTransition,
  stopsOf,
  TRIP_BOARD,
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

/**
 * A trip that still has a claim on a van (architect rulings of 2026-09-28, vans and trips 1): its number, day and
 * state, whether goods were already loaded for it, and the van's plate — how every refusal names it.
 */
export interface VanTrip {
  tripId: string
  tripNo: string | null
  tripDate: string
  state: 'planned' | 'loading' | 'active' | 'closing'
  /** On the road or checked in, or planned / loading with a confirmed load-out: the van holds its goods. */
  loaded: boolean
  vehicle: string | null
}

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
type DropBillIn = z.infer<typeof DropBillInput>
type DropBillOut = z.infer<typeof DropBillOutput>
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

/** `OrdersService.fulfilmentOrders` answers at most 200 orders per call; the depart gate reads in pages of it. */
const MAX_ORDERS_PER_READ = 200

/**
 * Trips and their stops: the plan, the departure, the road, the return.
 *
 * WAREHOUSE DISPATCHES (coordination §4 item 4): `packed → dispatched` happens at
 * `warehouse.loadSheets.confirm`, and nowhere else. `depart` here verifies and never dispatches: it refuses
 * a trip that still carries a packed bill (QA DOS-172) and passes an already-dispatched one. The godown →
 * vehicle transfer is warehouse's too; this module only asks `LoadSheetsService.confirmedForTrip` whether
 * the load is out, and `LoadSheetsService.draftsForTrip` whether a draft sheet still holds the departure
 * back (QA DOS-043).
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
    private readonly receivables: ReceivablesService,
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
        /*
         * RLS is the guarantee; the literal is what lets the planner start from the tenant-led
         * `trips_date_idx` instead of scanning the table (docs/20 rule 8).
         */
        eq(trips.tenantId, ctx.tenantId),
        input.state ? eq(trips.state, input.state) : undefined,
        input.states && input.states.length > 0 ? inArray(trips.state, input.states) : undefined,
        input.vehicleId ? eq(trips.vehicleId, input.vehicleId) : undefined,
        input.driverId ? eq(trips.driverId, input.driverId) : undefined,
        input.from ? gte(trips.tripDate, input.from) : undefined,
        input.to ? lte(trips.tripDate, input.to) : undefined,
        mine ? or(eq(trips.driverId, ctx.actorId), eq(trips.helperId, ctx.actorId)) : undefined,
        /*
         * Keyset on the cursor trip's own (trip_date, id), read inside this tenant's transaction with its
         * own tenant fence, so no other distributor's row can anchor a page and an unknown cursor matches
         * nothing (DOS-009, the DOS-023/DOS-133 convention).
         */
        input.cursor
          ? sql`(${trips.tripDate}, ${trips.id}) < (select c.trip_date, c.id from trips c where c.tenant_id = ${ctx.tenantId} and c.id = ${input.cursor})`
          : undefined,
      ]
      const rows = await tx
        .select()
        .from(trips)
        .where(and(...defined(filters)))
        /*
         * Newest first by TRIP DATE (DOS-009), the same column `from`/`to` filters on — a pre-planned trip
         * is a future-dated row and belongs on top, whatever its id says. Ids are minted on the device and
         * the demo seed's are hashes, so id order is not the running order of the board.
         */
        .orderBy(desc(trips.tripDate), desc(trips.id))
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

  /**
   * The trip planning board (QA DOS-131): the crew on `date` and the packed bills no trip carries yet —
   * what the godown (W10) and the desk (M7) plan a trip from, and what W7 narrows a load with.
   *
   * The crew is named through tenancy (`activeMembersWithRole`: ids and names, no phone, no username); a
   * member is busy when it is the driver or the helper of a trip that day that is not settled, settled
   * with variance or cancelled — `create`'s own rule. The bills are one page of orders' packed queue
   * (newest first, the cursor an order id), each order's live bill from billing, sorted by `ridingTrips`:
   * the very predicate `insertStop` refuses with 409, so the board never offers a bill a plan would be
   * refused. A bill riding no trip is in `bills`; one that came back undelivered on a van still out is in
   * `held`, with that trip (QA DOS-172); one planned on an open trip is left out. One bounded page (≤ 200
   * orders) plus three batched lookups per call (docs/20 rule 3); a page may carry fewer bills than
   * `limit` while `nextCursor` is set.
   */
  async planning(
    input: z.infer<typeof TripPlanningInput>,
  ): Promise<z.infer<typeof TripPlanningOutput>> {
    requireRole(TRIP_BOARD)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const date = input.date ?? businessDate().date
      // The output caps the crew at 200, the same bound as every list here.
      const members = await activeMembersWithRole(tx, 'delivery', 200)
      const onDate = await tx
        .select({
          id: trips.id,
          tripNo: trips.tripNo,
          driverId: trips.driverId,
          helperId: trips.helperId,
        })
        .from(trips)
        .where(
          and(
            eq(trips.tenantId, ctx.tenantId),
            eq(trips.tripDate, date),
            sql`${trips.state} not in ('settled', 'settled_with_variance', 'cancelled')`,
          ),
        )
        .orderBy(asc(trips.id))
      const busy = new Map<string, { onTripId: string; onTripNo: string | null }>()
      for (const trip of onDate)
        for (const userId of [trip.driverId, trip.helperId])
          if (userId !== null && !busy.has(userId))
            busy.set(userId, { onTripId: trip.id, onTripNo: trip.tripNo })
      const crew = members.map((member) => ({
        userId: member.userId,
        name: member.name,
        onTripId: busy.get(member.userId)?.onTripId ?? null,
        onTripNo: busy.get(member.userId)?.onTripNo ?? null,
      }))

      const rows = await this.orders.fulfilmentQueue(tx, {
        state: 'packed',
        beatId: input.beatId,
        limit: input.limit + 1,
        cursor: input.cursor,
      })
      const page = rows.slice(0, input.limit)
      const live = await this.billing.liveInvoicesForOrders(
        tx,
        page.map((order) => order.orderId),
      )
      const riding = await ridingTrips(
        tx,
        [...live.values()].map((bill) => bill.id),
      )
      const bills: z.infer<typeof TripPlanningOutput>['bills'] = []
      const held: z.infer<typeof TripPlanningOutput>['held'] = []
      for (const order of page) {
        const bill = live.get(order.orderId)
        if (bill === undefined) continue
        const row = {
          invoiceId: bill.id,
          invoiceNo: bill.invoiceNo,
          invoiceTotalPaise: bill.totalPaise,
          orderId: order.orderId,
          orderNo: order.orderNo,
          retailerId: order.retailerId,
          retailerName: order.retailerName,
          beatId: order.beatId,
          beatName: order.beatName,
        }
        const onTrip = riding.get(bill.id)
        if (onTrip === undefined) bills.push(row)
        // QA DOS-172: back on the van, which has not checked in — shown with its trip, never plannable.
        else if (onTrip.how === 'returned_on_road')
          held.push({ ...row, onTripId: onTrip.tripId, onTripNo: onTrip.tripNo })
      }
      const last = page[page.length - 1]
      return {
        date,
        crew,
        bills,
        held,
        nextCursor: rows.length > input.limit && last ? last.orderId : null,
      }
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
        // Who put the vehicle on the dock is on the record (QA DOS-043); a replay never gets this far.
        await writeAudit(tx, {
          action: 'trip.start_loading',
          entityType: 'trip',
          entityId: trip.id,
          before: { state: trip.state },
          after: { state: to, tripDate: trip.tripDate },
          deviceId: input.deviceId ?? null,
        })
        await emitDeliveryEvent(tx, 'trip', next.id, 'TripLoading', tripEventPayload(next))
        return { item: await this.detail(tx, next) }
      }),
    )
  }

  /**
   * `loading → active`: the crew's step (docs/23 D2), or the desk's from the office, never the godown's
   * (DOORSTEP, QA DOS-043). Refused 409 `load_sheet_not_confirmed` while any load sheet of the trip is
   * still a draft: one linked by `trip_id`, or one carrying a bill planned on one of its stops (the
   * warehouse app builds a sheet for the vehicle and may leave `trip_id` empty). Refused 409
   * `bill_not_loaded` while a bill planned on the trip is still `packed` (QA DOS-172): warehouse dispatches
   * at `loadSheets.confirm`, after the manager's approval, the blind count, the challan and the e-way bill
   * check, so `depart` verifies and never dispatches. A trip whose bills are all dispatched, or one with
   * none and van sales on, departs. Both refusals come before the driver's granted location consent (DPDP,
   * 403 `gps_consent_missing`; a denied OS permission on the phone never blocks a trip). The departure is
   * audited; a replay and a refusal write no row (the short-circuit returns first, a throw rolls the
   * transaction back).
   */
  async depart(input: DepartIn): Promise<DepartOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.id)
        assertCrewOrDesk(trip, DOORSTEP)
        if (trip.state === 'active') return { item: await this.detail(tx, trip) }
        const to = tripTransition(trip.state, 'depart')
        // Vans and trips 1 (architect ruling of 2026-09-28): a van carries one trip at a time. A trip does not leave
        // with a van that another trip still holds — on the road, checked in and not settled, or already loaded —
        // or its goods and this trip's would share one van, and one settlement would sweep the other's bills.
        const van = await loadVehicle(tx, trip.vehicleId)
        const holder = await this.vanHolder(tx, van.locationId, trip.id)
        if (holder !== null) {
          const { words, first } = vanTripWords(holder)
          throw new ORPCError('CONFLICT', {
            message: `${van.regNo} is ${words}, so trip ${trip.tripNo ?? 'this trip'} does not leave with it: a van carries one trip at a time. ${capitalise(first)} first, then send this trip out.`,
            data: {
              code: 'vehicle_on_trip',
              tripId: holder.tripId,
              tripNo: holder.tripNo,
              tripState: holder.state,
            },
          })
        }
        const stops = await stopsOf(tx, trip.id)
        if (stops.length === 0 && !trip.vanSalesEnabled)
          throw new ORPCError('CONFLICT', {
            message: 'a trip with no stops and no van sales has nowhere to go',
          })
        // The bills planned on this trip's stops: the draft-sheet gate looks for them, and the load-out gate
        // below checks each one already left the godown on a confirmed sheet.
        const planned = await tx
          .select({ orderId: deliveries.orderId })
          .from(deliveries)
          .where(and(eq(deliveries.tripId, trip.id), sql`${deliveries.outcome} is null`))
        const orderIds = [
          ...new Set(planned.map((d) => d.orderId).filter((id): id is string => id !== null)),
        ]
        // Nobody departs past a load that has not been counted out at the godown (QA DOS-043): a draft
        // sheet linked to the trip, or one carrying a bill on its stops, holds the vehicle back.
        const drafts = await this.loadSheets.draftsForTrip(tx, trip.id, orderIds)
        if (drafts.length > 0)
          throw new ORPCError('CONFLICT', {
            message: `the load sheet of trip ${trip.tripNo ?? trip.id} has not been counted out at the godown yet; the vehicle leaves after the load-out check`,
            data: { code: 'load_sheet_not_confirmed', loadSheetIds: drafts },
          })
        // QA DOS-172: a bill leaves the godown only through a confirmed load sheet, whose confirm dispatches
        // it. One batched read; a bill still packed — or an order the read does not return — holds the
        // vehicle back, and nothing is dispatched here.
        await this.assertEveryBillLoaded(tx, trip, orderIds)
        if (!trip.driverId || !(await driverConsentGranted(tx, trip.driverId)))
          throw new ORPCError('FORBIDDEN', {
            message:
              'the driver has not acknowledged the location notice; record it with POST /delivery/consents first',
            data: { code: 'gps_consent_missing', driverId: trip.driverId },
          })
        const now = whenOr(input.occurredAt, new Date())
        const next = await this.updateTrip(tx, trip.id, {
          state: to,
          startedAt: now,
          startOdometerKm: input.startOdometerKm ?? trip.startOdometerKm,
          openingCashPaise: input.openingCashPaise ?? trip.openingCashPaise,
        })
        await writeAudit(tx, {
          action: 'trip.depart',
          entityType: 'trip',
          entityId: trip.id,
          before: { state: trip.state },
          after: {
            state: to,
            tripDate: next.tripDate,
            startedAt: now.toISOString(),
            // QA DOS-043: an early departure is recorded, not refused — the day it was planned for is
            // right beside it, so the audit says what was planned as well as what happened.
            departedEarly: departedEarly(next),
            startOdometerKm: next.startOdometerKm,
            openingCashPaise: next.openingCashPaise,
          },
          deviceId: input.deviceId ?? null,
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
   *
   * EVERY BILL THAT CAME BACK IS SAID TO HAVE COME BACK (QA DOS-237). A planned bill with no outcome on a
   * stop that is ALREADY terminal — one a stop walked to `delivered` on its first bill before DOS-232, or
   * any path yet unknown — used to be skipped here, because only open stops were failed. Its delivery stayed
   * NULL, its order `dispatched`, and nothing ever put it on the Undelivered register or the planning board:
   * INV/9017 was paid and its goods sat in the godown with no way to send them. Each such bill is failed
   * too, with the same effects as a stop failure; the stop keeps the state it ended in (a terminal stop has
   * no way out of it) and the settlement stages the bill's pieces on the dock like any other that came back.
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
        const now = whenOr(input.occurredAt, new Date())
        /*
         * QA DOS-354 (architect ruling 8): a trip whose load-out was confirmed is checked in even when it never
         * left the gate — the machine's `loading → closing`, and a `planned` trip the godown loaded anyway walks
         * `start_loading` first. Its bills that were never counted out come off it; its draft sheets end.
         */
        const from =
          trip.state === 'planned' || trip.state === 'loading'
            ? await this.checkInBeforeLeaving(tx, trip, now, input.deviceId ?? null)
            : trip.state
        const to = tripTransition(from, 'return')
        // Vans and trips 3 (QA DOS-354 verify 2, M2): a bill planned on the trip that never rode its van — already
        // delivered elsewhere, part-delivered, closed or cancelled (a trip planned before the rule) — comes off it
        // here, named in the settlement, and the check-in goes on. It used to fail the whole check-in with the
        // machine's "order: cannot apply "return_undelivered" in state "delivered"", and the van stayed frozen.
        await this.takeOffNotCarried(tx, trip, null, now, input.deviceId ?? null)
        for (const stop of await stopsOf(tx, trip.id)) {
          if (STOP_TERMINAL.has(stop.state)) continue
          await this.failStopInTx(tx, stop, 'other', 'trip returned', now, input.deviceId ?? null)
        }
        // QA DOS-237: the bills still unrecorded on a stop that had already ended
        const unrecorded = await tx
          .select()
          .from(deliveries)
          .where(and(eq(deliveries.tripId, trip.id), sql`${deliveries.outcome} is null`))
          .orderBy(asc(deliveries.id))
        for (const d of unrecorded)
          await this.failPlannedDelivery(tx, d, {
            failureReason: 'other',
            failureNote: 'trip returned',
            at: now,
            deviceId: input.deviceId ?? null,
          })
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

  /**
   * Only from `planned` / `loading`, and only BEFORE the load-out (QA DOS-354, architect ruling 8): a trip the
   * godown has counted out onto the vehicle — a confirmed load sheet of this trip, or a bill planned on it that
   * is already dispatched — is refused 409 `trip_loaded`, and the sentence sends the desk to the check-in, which
   * brings the bills back undelivered, their pieces back to the dock at the godown's count, and frees them. A
   * cancel before the load-out frees every bill for another trip: stops → `skipped` (the one non-machine stop
   * write, documented), and the trip's DRAFT load sheets are cancelled with it, so none of them can later
   * dispatch a bill with no trip to carry it.
   */
  async cancel(input: CancelIn): Promise<CancelOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.id)
        if (trip.state === 'cancelled') return { item: await this.detail(tx, trip) }
        // QA DOS-354 verify 2 (M2): a trip that has left is never cancelled, and the desk is told what to do in words
        // — never the machine's "trip: cannot apply "cancel" in state "active"".
        if (trip.state !== 'planned' && trip.state !== 'loading') {
          const tripName = trip.tripNo ?? 'This trip'
          throw new ORPCError('CONFLICT', {
            message:
              trip.state === 'active'
                ? `Trip ${tripName} is out on the road, so it is not cancelled: check it in when the van is back. Its bills that did not reach a shop come back undelivered, the godown counts the van off, and the desk settles it.`
                : trip.state === 'closing'
                  ? `Trip ${tripName} has come back and is checked in, so it is not cancelled: settle it on the desk.`
                  : `Trip ${tripName} is settled; there is nothing left to cancel.`,
            data: { code: 'trip_left', tripState: trip.state },
          })
        }
        const to = tripTransition(trip.state, 'cancel')
        const loaded = await this.loadOf(tx, trip)
        if (loaded.challans.length > 0 || loaded.dispatched.length > 0) {
          const tripName = trip.tripNo ?? trip.id
          const what = [
            loaded.challans.length > 0 ? `challan ${loaded.challans.join(', ')}` : null,
            loaded.dispatched.length > 0 ? `bill(s) ${loaded.dispatched.join(', ')}` : null,
          ]
            .filter((part): part is string => part !== null)
            .join('; ')
          throw new ORPCError('CONFLICT', {
            message: `Trip ${tripName} has already been loaded (${what}), so it is not cancelled: check the vehicle in instead. Its bills come back undelivered, the godown counts their pieces off the van onto the dock, and the bills can then be planned on another trip.`,
            data: { code: 'trip_loaded', loadSheetIds: loaded.sheetIds },
          })
        }
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
        // A draft sheet moves nothing; cancelled with the trip, its bills are free for another sheet. As
        // `system`: the desk may cancel a trip, and the sheet's own write policy is the godown's.
        await asSystemRole(tx, () =>
          this.loadSheets.cancelDraftsForTrip(
            tx,
            trip.id,
            `trip ${trip.tripNo ?? trip.id} cancelled: ${input.reason}`,
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

  /**
   * TAKE A BILL THAT WAS NEVER LOADED OFF A TRIP THAT HAS NOT LEFT (QA DOS-241). TRIP-0007 could not depart
   * (`bill_not_loaded`) because one of its three bills could not be loaded — its batches had been sold — and
   * nothing but the database could take that bill off it, so two shops' loaded goods sat on the van. The desk
   * now can: the bill's planned delivery row (outcome null) is deleted, its stop is `skipped` when it carries no
   * other bill (the same non-machine stop write `cancel` makes), and the bill is back on the planning board for
   * another trip. Nothing about the bill, the order or the stock changes — none of them had moved.
   *
   * 409 once the trip has left (`planned` / `loading` only), when the bill is not planned on this trip, when
   * its order is not `packed` (dispatched means it is on the van: the trip must go and come back), or while a
   * DRAFT load sheet still carries it (cancel or rebuild that sheet first — a draft would dispatch it). Audited.
   */
  async dropBill(input: DropBillIn): Promise<DropBillOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.id)
        const tripName = trip.tripNo ?? trip.id
        if (trip.state !== 'planned' && trip.state !== 'loading')
          throw new ORPCError('CONFLICT', {
            message: `Trip ${tripName} has already left (${trip.state}); a bill comes off a trip only before it leaves. What it brings back is recorded at the door or at the check-in.`,
            data: { code: 'trip_left', tripState: trip.state },
          })
        const planned = await tx
          .select()
          .from(deliveries)
          .where(
            and(
              eq(deliveries.tenantId, ctx.tenantId),
              eq(deliveries.tripId, trip.id),
              eq(deliveries.invoiceId, input.invoiceId),
              sql`${deliveries.outcome} is null`,
            ),
          )
          .orderBy(asc(deliveries.id))
          .for('update')
        const invoice = await this.billing.invoiceForDelivery(tx, input.invoiceId)
        const bill = invoice.invoiceNo ?? invoice.id
        if (planned.length === 0)
          throw new ORPCError('CONFLICT', {
            message: `Bill ${bill} is not planned on trip ${tripName}`,
            data: { code: 'bill_not_on_trip' },
          })
        const orderIds = [
          ...new Set(planned.map((d) => d.orderId).filter((id): id is string => id !== null)),
        ]
        // Only a dispatched bill stays: its goods are on the van. A packed bill waits on the dock; one already
        // delivered or cancelled never rode this van at all (vans and trips 3), so it comes off like a packed one.
        for (const orderId of orderIds) {
          const order = await this.orders.findOrder(tx, orderId)
          if (order && order.state === 'dispatched')
            throw new ORPCError('CONFLICT', {
              message: `Bill ${bill} is already on the van (the godown counted it out); it comes off at the door or at the check-in, not here`,
              data: { code: 'bill_loaded', orderState: order.state },
            })
        }
        const onDraft = await this.loadSheets.ordersOnADraftSheet(tx, orderIds)
        if (onDraft.length > 0) {
          // Named the way the desk knows a sheet: by its trip and vehicle, never by its id.
          const tripNos = await tx
            .select({ id: trips.id, tripNo: trips.tripNo })
            .from(trips)
            .where(
              inArray(
                trips.id,
                onDraft.map((s) => s.tripId).filter((id): id is string => id !== null),
              ),
            )
          const tripNo = new Map(tripNos.map((r) => [r.id, r.tripNo]))
          const where = onDraft
            .map((s) =>
              [s.tripId === null ? null : (tripNo.get(s.tripId) ?? null), s.vehicleRegNo]
                .filter((part): part is string => part !== null)
                .join(' · '),
            )
            .map((name) => (name === '' ? 'a sheet with no trip' : name))
            .join(', ')
          throw new ORPCError('CONFLICT', {
            message: `Bill ${bill} is still on a load sheet the godown has not sent out (${where}). Cancel that sheet under Load-out, or have the godown build it again without this bill, then take it off.`,
            data: {
              code: 'bill_on_draft_sheet',
              loadSheetIds: onDraft.map((s) => s.sheetId),
            },
          })
        }

        const now = new Date()
        await tx.delete(deliveries).where(
          and(
            eq(deliveries.tenantId, ctx.tenantId),
            inArray(
              deliveries.id,
              planned.map((d) => d.id),
            ),
          ),
        )
        let skipped = 0
        for (const stopId of new Set(planned.map((d) => d.stopId))) {
          const [left] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(deliveries)
            .where(and(eq(deliveries.tenantId, ctx.tenantId), eq(deliveries.stopId, stopId)))
          if (Number(left?.n ?? 0) > 0) continue
          const done = await tx
            .update(tripStops)
            .set({
              state: 'skipped',
              failureNote: `bill ${bill} taken off the trip: ${input.reason}`,
              completedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(tripStops.id, stopId),
                sql`${tripStops.state} not in ('delivered', 'partial', 'failed', 'skipped')`,
              ),
            )
            .returning({ id: tripStops.id })
          skipped += done.length
        }
        const next =
          skipped > 0
            ? await this.updateTrip(tx, trip.id, {
                plannedStops: Math.max(0, trip.plannedStops - skipped),
              })
            : trip
        await writeAudit(tx, {
          action: 'trip.drop_bill',
          entityType: 'trip',
          entityId: trip.id,
          before: {
            tripState: trip.state,
            invoiceId: invoice.id,
            invoiceNo: invoice.invoiceNo,
            deliveryIds: planned.map((d) => d.id),
          },
          after: { reason: input.reason, stopsSkipped: skipped },
          deviceId: null,
        })
        await emitDeliveryEvent(tx, 'trip', trip.id, 'TripBillDropped', {
          ...tripEventPayload(next),
          invoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
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
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(tripStops.tenantId, ctx.tenantId),
        input.tripId ? eq(tripStops.tripId, input.tripId) : undefined,
        input.retailerId ? eq(tripStops.retailerId, input.retailerId) : undefined,
        input.state ? eq(tripStops.state, input.state) : undefined,
        input.date
          ? sql`${tripStops.tripId} in (select t.id from trips t where t.trip_date = ${input.date})`
          : undefined,
        /*
         * Keyset on the cursor stop's own (created_at, id), read inside this tenant's transaction with its
         * own tenant fence, so no other distributor's row can anchor a page and an unknown cursor matches
         * nothing (the DOS-023 convention, as in `trips.list`).
         */
        input.cursor
          ? sql`(${tripStops.createdAt}, ${tripStops.id}) < (select c.created_at, c.id from trip_stops c where c.tenant_id = ${ctx.tenantId} and c.id = ${input.cursor})`
          : undefined,
      ]
      const rows = await tx
        .select()
        .from(tripStops)
        .where(and(...defined(filters)))
        /*
         * Newest first by SERVER time (QA DOS-023; founder, 2026-09-20), the row id only breaking a tie:
         * a stop id is minted on the device that planned it, which offline is not when the office saw it.
         * A trip's own route order is `sequence`, and is read from the trip (`stopsOf`), never from here.
         */
        .orderBy(desc(tripStops.createdAt), desc(tripStops.id))
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

  /**
   * WHERE A STOP STANDS AFTER ONE OF ITS BILLS HAS AN OUTCOME (QA DOS-232).
   *
   * A stop carries every bill planned for that shop, and the crew records them one at a time. Landing the
   * stop on `delivered` after the FIRST bill made it terminal while the second still rode on the van: the
   * next bill was refused ("already delivered; a second attempt is a new stop"), the check-in counted the
   * shop as delivered, and the desk read "every bill that went out was delivered" over goods that never
   * left the van. So a stop ends only when every bill on it has an outcome:
   *
   *   - a bill of the stop still has no outcome   → the stop is (at most) `arrived`: the crew is at the door
   *   - every bill delivered in full               → `delivered`
   *   - every bill failed                          → `failed`
   *   - anything else                              → `partial` (some goods went, some came back)
   *
   * A stop already terminal is left where it is: the stop machine has no way out of a terminal state, and a
   * stop that ended before this rule existed keeps its word while its remaining bill is still recorded.
   */
  async settleStopAfterBill(tx: Db, stop: StopRow, at: Date): Promise<StopRow> {
    const [current] = await tx.select().from(tripStops).where(eq(tripStops.id, stop.id)).limit(1)
    const row = current ?? stop
    if (STOP_TERMINAL.has(row.state)) return row
    const outcomes = await tx
      .select({ outcome: deliveries.outcome })
      .from(deliveries)
      .where(eq(deliveries.stopId, row.id))
    if (outcomes.some((d) => d.outcome === null) || outcomes.length === 0)
      return this.walkStop(tx, row, 'arrived', at, null)
    const done = outcomes.map((d) => (d.outcome === 'returned' ? 'delivered' : d.outcome))
    const target = done.every((o) => o === 'delivered')
      ? 'delivered'
      : done.every((o) => o === 'failed')
        ? 'failed'
        : 'partial'
    return this.walkStop(tx, row, target, at, null)
  }

  /** The bills of a stop that have no outcome yet — the ones still riding on the van for this shop. */
  async billsStillOnStop(tx: Db, stopId: string): Promise<string[]> {
    const rows = await tx
      .select({ invoiceId: deliveries.invoiceId })
      .from(deliveries)
      .where(and(eq(deliveries.stopId, stopId), sql`${deliveries.outcome} is null`))
    return rows.map((r) => r.invoiceId)
  }

  /**
   * The cause of a doorstep failure onto the stop itself (QA DOS-203), for the path that does NOT go
   * through the fail sheet: `deliveries.record` with every line zero. `failStopInTx` writes the same two
   * columns for `stops.fail` and `trips.return`. Never overwrites a reason already recorded, so a
   * second bill failed at the same stop keeps the first one's words.
   */
  async recordStopFailure(
    tx: Db,
    stop: StopRow,
    failureReason: StopRow['failureReason'],
    failureNote: string | null,
  ): Promise<StopRow> {
    if (stop.failureReason !== null) return stop
    const [next] = await tx
      .update(tripStops)
      .set({ failureReason, failureNote, updatedAt: new Date() })
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

  /**
   * What the godown has already counted out for a trip (QA DOS-354): its confirmed load sheets (with their challan
   * numbers) and the bills planned on it whose orders are already `dispatched` — a sheet built for the vehicle may
   * leave `trip_id` empty, so the bills are asked too. One bounded read per 200 orders.
   */
  private async loadOf(
    tx: Db,
    trip: { id: string },
  ): Promise<{ sheetIds: string[]; challans: string[]; dispatched: string[] }> {
    const confirmed = await this.loadSheets.confirmedForTrip(tx, trip.id)
    const planned = await tx
      .select({ orderId: deliveries.orderId, invoiceId: deliveries.invoiceId })
      .from(deliveries)
      .where(and(eq(deliveries.tripId, trip.id), sql`${deliveries.outcome} is null`))
    const orderIds = [
      ...new Set(planned.map((d) => d.orderId).filter((id): id is string => id !== null)),
    ]
    const dispatchedOrders = new Set<string>()
    for (let at = 0; at < orderIds.length; at += MAX_ORDERS_PER_READ)
      for (const order of await this.orders.fulfilmentOrders(
        tx,
        orderIds.slice(at, at + MAX_ORDERS_PER_READ),
      ))
        if (order.state === 'dispatched') dispatchedOrders.add(order.orderId)
    const dispatchedBills = planned.filter(
      (d) => d.orderId !== null && dispatchedOrders.has(d.orderId),
    )
    const refs = await this.billing.invoiceRefs(
      tx,
      dispatchedBills.map((d) => d.invoiceId),
    )
    return {
      sheetIds: confirmed.map((s) => s.id),
      challans: confirmed.map((s) => s.challanNo ?? 'a challan'),
      dispatched: [
        ...new Set(dispatchedBills.map((d) => refs.get(d.invoiceId)?.invoiceNo ?? d.invoiceId)),
      ],
    }
  }

  /**
   * EVERY TRIP THAT STILL HAS A CLAIM ON A VAN (architect rulings of 2026-09-28, vans and trips 1: "a van carries
   * one trip at a time"). The trips of the vehicle whose stock location is `vehicleLocationId` that are not over —
   * planned, loading, on the road or checked in and not settled — each with whether goods were already loaded for
   * it: a confirmed load sheet of it, or a bill planned on it that the godown has dispatched (a sheet built for
   * the vehicle before QA DOS-354 may name no trip). The one on the road first, then the one checked in, then the
   * loaded ones by day. Read as `system`: the crew's and the godown's own RLS may not see every trip, delivery or
   * sheet, and only ids, numbers and states come out of it.
   */
  async tripsOnVan(tx: Db, vehicleLocationId: string): Promise<VanTrip[]> {
    const { tenantId } = currentTenant()
    return asSystemRole(tx, async () => {
      const rows = await tx
        .select({
          tripId: trips.id,
          tripNo: trips.tripNo,
          tripDate: trips.tripDate,
          state: trips.state,
          vehicle: vehicles.regNo,
        })
        .from(trips)
        .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
        .where(
          and(
            eq(trips.tenantId, tenantId),
            eq(vehicles.locationId, vehicleLocationId),
            inArray(trips.state, ['planned', 'loading', 'active', 'closing']),
          ),
        )
        .orderBy(asc(trips.tripDate), asc(trips.id))
      const out: VanTrip[] = []
      for (const row of rows) {
        if (
          row.state !== 'planned' &&
          row.state !== 'loading' &&
          row.state !== 'active' &&
          row.state !== 'closing'
        )
          continue
        const onTheVan = row.state === 'active' || row.state === 'closing'
        const load = onTheVan ? null : await this.loadOf(tx, { id: row.tripId })
        out.push({
          tripId: row.tripId,
          tripNo: row.tripNo,
          tripDate: row.tripDate,
          state: row.state,
          loaded:
            onTheVan || (load !== null && (load.sheetIds.length > 0 || load.dispatched.length > 0)),
          vehicle: row.vehicle,
        })
      }
      const rank = (t: VanTrip): number =>
        t.state === 'active' ? 0 : t.state === 'closing' ? 1 : t.loaded ? 2 : 3
      return out.sort((a, b) => rank(a) - rank(b))
    })
  }

  /**
   * THE TRIP THAT HOLDS A VAN, other than `exceptTripId` (vans and trips 1): one on the road, one checked in and not
   * settled, or one the godown has already loaded — or null when the van is free. A load-out onto the van, a trip's
   * departure with it, and a hand move into it are refused while another trip holds it (`vehicle_on_trip`); a
   * settlement takes off the van only its own trip's pieces (ruling 2). `LoadSheetsService` and `InventoryService`
   * ask it through the lookups `DeliveryModule` registers at start-up; inventory and warehouse never read trips.
   */
  async vanHolder(
    tx: Db,
    vehicleLocationId: string,
    exceptTripId: string | null,
  ): Promise<VanTrip | null> {
    return (
      (await this.tripsOnVan(tx, vehicleLocationId)).find(
        (t) => t.tripId !== exceptTripId && t.loaded,
      ) ?? null
    )
  }

  /**
   * The trip a vehicle location is in the hands of among `states`, for `InventoryService.assertVehicleNotOut`
   * (QA DOS-358): a trip the godown has loaded while it was still `planned` holds the van as a `loading` one does.
   */
  async vehicleTripOut(
    tx: Db,
    vehicleLocationId: string,
    states: readonly ('loading' | 'active' | 'closing')[],
  ): Promise<{
    tripId: string
    tripNo: string | null
    state: 'loading' | 'active' | 'closing'
    vehicle: string | null
  } | null> {
    if (states.length === 0) return null
    for (const t of await this.tripsOnVan(tx, vehicleLocationId)) {
      const state = t.state === 'planned' ? (t.loaded ? 'loading' : null) : t.state
      if (state !== null && states.includes(state))
        return { tripId: t.tripId, tripNo: t.tripNo, state, vehicle: t.vehicle }
    }
    return null
  }

  /**
   * THE CHECK-IN OF A LOADED TRIP THAT NEVER LEFT (QA DOS-354, architect ruling 8: "a loaded trip is not
   * cancelled, it is checked in"). Refused 409 `trip_not_loaded` when nothing was counted out — that trip is
   * cancelled instead. Otherwise, before the ordinary check-in runs:
   *
   *   - a bill planned on the trip that the godown never counted out (its order still `packed`) comes off it,
   *     exactly as `dropBill` takes it off — its planned delivery row goes, a stop left with no bill is
   *     `skipped` — so it is back on the planning board and the check-in never "fails" a bill that never left;
   *   - the trip's DRAFT load sheets are cancelled (nothing had moved on them);
   *   - a `planned` trip the godown loaded anyway walks `start_loading` through the machine first.
   *
   * The loaded bills then go through the check-in every trip goes through: their stops fail ("trip returned"),
   * their orders go back to `packed`, the bills are flagged undelivered, and the settlement counts the van so
   * their pieces go onto the dock, held for them, and the bills can be planned again. Returns the state the
   * `return` event applies from. Audited.
   */
  private async checkInBeforeLeaving(
    tx: Db,
    trip: TripRow,
    now: Date,
    deviceId: string | null,
  ): Promise<TripRow['state']> {
    const tripName = trip.tripNo ?? trip.id
    const loaded = await this.loadOf(tx, trip)
    if (loaded.sheetIds.length === 0 && loaded.dispatched.length === 0)
      throw new ORPCError('CONFLICT', {
        message: `Trip ${tripName} has not been loaded, so there is nothing to check in: cancel it instead, and its bills go back on the planning board.`,
        data: { code: 'trip_not_loaded', tripState: trip.state },
      })
    const from = trip.state === 'planned' ? tripTransition(trip.state, 'start_loading') : trip.state
    const planned = await asSystemRole(tx, () =>
      tx
        .select()
        .from(deliveries)
        .where(and(eq(deliveries.tripId, trip.id), sql`${deliveries.outcome} is null`))
        .orderBy(asc(deliveries.id))
        .for('update'),
    )
    const orderIds = [
      ...new Set(planned.map((d) => d.orderId).filter((id): id is string => id !== null)),
    ]
    const stateOf = new Map<string, string>()
    for (let at = 0; at < orderIds.length; at += MAX_ORDERS_PER_READ)
      for (const order of await this.orders.fulfilmentOrders(
        tx,
        orderIds.slice(at, at + MAX_ORDERS_PER_READ),
      ))
        stateOf.set(order.orderId, order.state)
    // Still packed on the dock (or unknown): never counted out, so it comes off here. A bill already handed over
    // elsewhere never rode this van either; `takeOffNotCarried` takes it off with the check-in and names it.
    const notLoaded = planned.filter(
      (d) => d.orderId === null || (stateOf.get(d.orderId) ?? 'packed') === 'packed',
    )
    let skipped = 0
    if (notLoaded.length > 0) {
      await asSystemRole(tx, () =>
        tx.delete(deliveries).where(
          inArray(
            deliveries.id,
            notLoaded.map((d) => d.id),
          ),
        ),
      )
      for (const stopId of new Set(notLoaded.map((d) => d.stopId))) {
        const [left] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(deliveries)
          .where(eq(deliveries.stopId, stopId))
        if (Number(left?.n ?? 0) > 0) continue
        const done = await tx
          .update(tripStops)
          .set({
            state: 'skipped',
            failureNote: 'not loaded: the trip was checked in before it left',
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(tripStops.id, stopId),
              sql`${tripStops.state} not in ('delivered', 'partial', 'failed', 'skipped')`,
            ),
          )
          .returning({ id: tripStops.id })
        skipped += done.length
      }
      if (skipped > 0)
        await this.updateTrip(tx, trip.id, {
          plannedStops: Math.max(0, trip.plannedStops - skipped),
        })
    }
    const cancelledSheets = await asSystemRole(tx, () =>
      this.loadSheets.cancelDraftsForTrip(
        tx,
        trip.id,
        `trip ${tripName} was checked in before it left`,
      ),
    )
    await writeAudit(tx, {
      action: 'trip.check_in_before_departure',
      entityType: 'trip',
      entityId: trip.id,
      before: { state: trip.state, loadSheetIds: loaded.sheetIds },
      after: {
        billsTakenOff: notLoaded.map((d) => d.invoiceId),
        stopsSkipped: skipped,
        draftSheetsCancelled: cancelledSheets,
      },
      deviceId,
    })
    return from
  }

  /**
   * The departure gate on the bills (QA DOS-172): every order planned on the trip must already have left
   * the godown through a confirmed load sheet. Dispatched, delivered and partially delivered orders pass;
   * any other state but `packed` keeps the old refusal; a `packed` order, or one the batched read does not
   * return (fail closed), is refused 409 `bill_not_loaded` with every such order named. Nothing is
   * dispatched here.
   */
  private async assertEveryBillLoaded(
    tx: Db,
    trip: TripRow,
    orderIds: readonly string[],
  ): Promise<void> {
    if (orderIds.length === 0) return
    const found = new Map<string, { state: string; orderNo: string | null }>()
    for (let at = 0; at < orderIds.length; at += MAX_ORDERS_PER_READ)
      for (const order of await this.orders.fulfilmentOrders(
        tx,
        orderIds.slice(at, at + MAX_ORDERS_PER_READ),
      ))
        found.set(order.orderId, { state: order.state, orderNo: order.orderNo })
    const notLoaded: string[] = []
    const dispatched: string[] = []
    const cannotGo: string[] = []
    for (const orderId of orderIds) {
      const order = found.get(orderId)
      if (order === undefined || order.state === 'packed') {
        notLoaded.push(orderId)
        continue
      }
      if (order.state === 'dispatched') dispatched.push(orderId)
      else cannotGo.push(orderId)
    }
    /*
     * Vans and trips 3 (QA DOS-354 verify 2, M2): a bill already handed over — delivered, part-delivered, closed —
     * or cancelled does not leave again. It used to pass this gate ("delivered orders pass"), the door answered "0
     * left to deliver", and the trip could never be checked in. Named with the shop, and the way out: take it off.
     */
    if (cannotGo.length > 0) {
      const planned = await tx
        .select({
          orderId: deliveries.orderId,
          invoiceId: deliveries.invoiceId,
          retailerId: deliveries.retailerId,
        })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.tripId, trip.id),
            sql`${deliveries.outcome} is null`,
            inArray(deliveries.orderId, cannotGo),
          ),
        )
      const refs = await this.billing.invoiceRefs(
        tx,
        planned.map((d) => d.invoiceId),
      )
      const names = await retailerNames(
        tx,
        planned.map((d) => d.retailerId),
      )
      const why = cannotGo.map((orderId) => {
        const d = planned.find((p) => p.orderId === orderId)
        const order = found.get(orderId)
        return billGoesOutWords(
          d === undefined ? null : (refs.get(d.invoiceId)?.invoiceNo ?? null),
          d === undefined ? '' : (names.get(d.retailerId) ?? ''),
          order?.orderNo ?? null,
          order?.state ?? 'unknown',
        )
      })
      throw new ORPCError('CONFLICT', {
        message: `${why.join(' ')} Take ${cannotGo.length === 1 ? 'it' : 'them'} off trip ${trip.tripNo ?? 'this trip'} (Take it off, on Trips), then send the trip out.`,
        data: { code: 'bill_cannot_go_out', orderIds: cannotGo },
      })
    }
    if (notLoaded.length > 0)
      throw new ORPCError('CONFLICT', {
        message: `${String(notLoaded.length)} bill(s) on trip ${trip.tripNo ?? trip.id} have not been counted out at the godown: ${notLoaded.map((id) => found.get(id)?.orderNo ?? id).join(', ')}; build and confirm the load sheet first`,
        data: { code: 'bill_not_loaded', orderIds: notLoaded },
      })
    /*
     * QA DOS-354 (verify): "dispatched" is not "on this van". A bill counted out on another load — a sheet of no
     * trip, or of another trip, written before a sheet took only its own trip's bills — was swept off that van
     * as free stock at the other trip's settlement; planned on this trip it departed, and the door answered
     * "Only 0 pc … in the vehicle". A trip leaves only with the bills a confirmed sheet of ITS OWN loaded. The
     * way out is the check-in of this trip: the bill comes back undelivered and is loaded again from the dock
     * or the godown ("Bring them from the godown").
     */
    if (dispatched.length === 0) return
    const ownLoad = new Set(
      (await this.loadSheets.confirmedForTrip(tx, trip.id)).flatMap((s) => s.orderIds),
    )
    const offLoad = dispatched.filter((orderId) => !ownLoad.has(orderId))
    if (offLoad.length === 0) return
    const planned = await tx
      .select({ orderId: deliveries.orderId, invoiceId: deliveries.invoiceId })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.tripId, trip.id),
          sql`${deliveries.outcome} is null`,
          inArray(deliveries.orderId, offLoad),
        ),
      )
    const refs = await this.billing.invoiceRefs(
      tx,
      planned.map((d) => d.invoiceId),
    )
    const bills = offLoad.map((orderId) => {
      const invoiceId = planned.find((d) => d.orderId === orderId)?.invoiceId
      return (
        (invoiceId === undefined ? undefined : refs.get(invoiceId)?.invoiceNo) ??
        found.get(orderId)?.orderNo ??
        orderId
      )
    })
    const vehicle = await loadVehicle(tx, trip.vehicleId)
    const tripName = trip.tripNo ?? 'this trip'
    const one = offLoad.length === 1
    throw new ORPCError('CONFLICT', {
      message: `${bills.join(', ')} ${one ? 'was' : 'were'} counted out at the godown on another load, not on trip ${tripName}'s own load sheet, so ${one ? 'its' : 'their'} pieces are not on ${vehicle.regNo}. A trip leaves only with the bills loaded for it: check trip ${tripName} in — ${one ? 'the bill comes' : 'the bills come'} back undelivered — and load ${one ? 'it' : 'them'} again from the dock or the godown.`,
      data: { code: 'bill_not_on_this_load', orderIds: offLoad },
    })
  }

  /**
   * ONE PLANNED BILL THAT DID NOT GO: its delivery `failed` with zero lines, the order back to `packed`
   * (`return_undelivered`), and the bill flagged undelivered — out of the shop's dues and ageing, onto the
   * desk's register, the shop told by bill number (QA DOS-197). Stock is not touched: the goods are wherever
   * they physically are, and the caller says (the van until check-in; `deliveries.cameBack` stages them).
   * Shared by the fail sheet, the check-in and the desk's "it came back" (QA DOS-237). Idempotent in effect:
   * a delivery that already has an outcome is left as it is.
   */
  async failPlannedDelivery(
    tx: Db,
    d: typeof deliveries.$inferSelect,
    how: {
      failureReason: StopRow['failureReason']
      failureNote: string | null
      at: Date
      deviceId: string | null
    },
  ): Promise<void> {
    const ctx = currentTenant()
    if (d.outcome !== null) return
    // Vans and trips 3: only a bill that rode the van comes back on it. The check-in and the fail sheet take a bill
    // that never rode off the trip first (`takeOffNotCarried`); any other caller is told so in words.
    if (d.orderId !== null) {
      const order = await this.orders.findOrder(tx, d.orderId)
      if (order !== undefined && order.state !== 'dispatched') {
        const bill = await this.billing.invoiceRefs(tx, [d.invoiceId])
        const names = await retailerNames(tx, [d.retailerId])
        throw new ORPCError('CONFLICT', {
          message: `${notCarriedWords(bill.get(d.invoiceId)?.invoiceNo ?? null, names.get(d.retailerId) ?? '', order.orderNo, order.state)} It is not declared undelivered.`,
          data: { code: 'bill_not_on_van', orderState: order.state },
        })
      }
    }
    await tx
      .update(deliveries)
      .set({
        outcome: 'failed',
        deliveredBy: ctx.actorRole === 'system' ? null : ctx.actorId,
        deliveredAt: how.at,
        deviceId: how.deviceId ?? d.deviceId,
        note: how.failureNote ?? d.note,
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
        how.deviceId,
        how.failureReason ?? 'failed',
      )
    // QA DOS-197: the bill rides back on the van, so it leaves the shop's dues and the ageing, and
    // the shop is told by bill NUMBER. docs/22 §4: it waits on the van until check-in.
    await declareUndelivered(tx, this.billing, {
      deliveryId: d.id,
      tripId: d.tripId,
      stopId: d.stopId,
      retailerId: d.retailerId,
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      failureReason: how.failureReason,
      at: how.at,
    })
  }

  /**
   * BILLS THAT NEVER RODE THIS VAN COME OFF THE TRIP (vans and trips 3, QA DOS-354 verify 2 M2). A planned bill with
   * no outcome whose order is not `dispatched` — delivered elsewhere or sold off a van, part-delivered, closed,
   * cancelled, or (on a trip that left) still packed — was never counted onto this van, so nothing of it comes back:
   * failing it would walk a delivered order back to `packed` (the machine refuses, and the check-in used to die on
   * its raw text). Its planned delivery row is removed as `dropBill` removes one, audited
   * `trip.bills_not_carried` with the bill, the shop and why, which the settlement lists (`skippedBills`). With no
   * `stopId` (the check-in) every such bill of the trip goes and a stop left with no bill is `skipped`; with one (the
   * crew's fail sheet) only that stop's, and the stop fails as the crew said. Returns the bills taken off.
   */
  async takeOffNotCarried(
    tx: Db,
    trip: TripRow,
    stopId: string | null,
    at: Date,
    deviceId: string | null,
  ): Promise<{ invoiceId: string; invoiceNo: string | null; why: string }[]> {
    const planned = await asSystemRole(tx, () =>
      tx
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.tripId, trip.id),
            stopId === null ? undefined : eq(deliveries.stopId, stopId),
            sql`${deliveries.outcome} is null`,
          ),
        )
        .orderBy(asc(deliveries.id))
        .for('update'),
    )
    const orderIds = [
      ...new Set(planned.map((d) => d.orderId).filter((id): id is string => id !== null)),
    ]
    if (orderIds.length === 0) return []
    const orders = new Map<string, { state: string; orderNo: string | null }>()
    for (let i = 0; i < orderIds.length; i += MAX_ORDERS_PER_READ)
      for (const order of await this.orders.fulfilmentOrders(
        tx,
        orderIds.slice(i, i + MAX_ORDERS_PER_READ),
      ))
        orders.set(order.orderId, { state: order.state, orderNo: order.orderNo })
    const notCarried = planned.filter((d) => {
      if (d.orderId === null) return false
      const state = orders.get(d.orderId)?.state
      return state !== undefined && state !== 'dispatched'
    })
    if (notCarried.length === 0) return []
    const refs = await this.billing.invoiceRefs(
      tx,
      notCarried.map((d) => d.invoiceId),
    )
    const names = await retailerNames(
      tx,
      notCarried.map((d) => d.retailerId),
    )
    const bills = notCarried.map((d) => {
      const order = orders.get(d.orderId ?? '')
      const invoiceNo = refs.get(d.invoiceId)?.invoiceNo ?? null
      return {
        deliveryId: d.id,
        stopId: d.stopId,
        invoiceId: d.invoiceId,
        invoiceNo,
        retailerName: names.get(d.retailerId) ?? '',
        orderNo: order?.orderNo ?? null,
        orderState: order?.state ?? 'unknown',
        why: notCarriedWords(
          invoiceNo,
          names.get(d.retailerId) ?? '',
          order?.orderNo ?? null,
          order?.state ?? 'unknown',
        ),
      }
    })
    await asSystemRole(tx, () =>
      tx.delete(deliveries).where(
        inArray(
          deliveries.id,
          notCarried.map((d) => d.id),
        ),
      ),
    )
    let skipped = 0
    if (stopId === null) {
      for (const emptied of new Set(notCarried.map((d) => d.stopId))) {
        const [left] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(deliveries)
          .where(eq(deliveries.stopId, emptied))
        if (Number(left?.n ?? 0) > 0) continue
        const done = await tx
          .update(tripStops)
          .set({
            state: 'skipped',
            failureNote: 'not carried: its bill never rode this van',
            completedAt: at,
            updatedAt: at,
          })
          .where(
            and(
              eq(tripStops.id, emptied),
              sql`${tripStops.state} not in ('delivered', 'partial', 'failed', 'skipped')`,
            ),
          )
          .returning({ id: tripStops.id })
        skipped += done.length
      }
      if (skipped > 0)
        await this.updateTrip(tx, trip.id, {
          plannedStops: Math.max(0, trip.plannedStops - skipped),
        })
    }
    await writeAudit(tx, {
      action: 'trip.bills_not_carried',
      entityType: 'trip',
      entityId: trip.id,
      before: { tripState: trip.state },
      after: {
        bills: bills.map((b) => ({
          invoiceId: b.invoiceId,
          invoiceNo: b.invoiceNo,
          retailerName: b.retailerName,
          orderNo: b.orderNo,
          orderState: b.orderState,
          why: b.why,
        })),
        stopsSkipped: skipped,
      },
      deviceId,
    })
    return bills.map((b) => ({ invoiceId: b.invoiceId, invoiceNo: b.invoiceNo, why: b.why }))
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
    // Vans and trips 3: a bill of this stop that never rode the van (delivered elsewhere, cancelled) comes off the
    // trip instead of being failed — failing it would walk a delivered order back to `packed`.
    await this.takeOffNotCarried(tx, await findTrip(tx, stop.tripId), stop.id, at, deviceId)
    // QA DOS-232: a stop where some bill was already handed over did not fail — the rest came back.
    const [handedOver] = await tx
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.stopId, stop.id),
          inArray(deliveries.outcome, ['delivered', 'partial', 'returned']),
        ),
      )
      .limit(1)
    const walked = await this.walkStop(tx, stop, handedOver ? 'partial' : 'failed', at, null)
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
      await this.failPlannedDelivery(tx, d, { failureReason, failureNote, at, deviceId })
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
   * `record` know which documents ride on the van. Each bill must be the shop's own, issued, not already
   * planned on another open stop, and not riding back on a van that has not checked in (409 `bill_on_road`,
   * QA DOS-172: this trip included) — asked through `ridingTrips`, the one ids-only predicate the trip
   * planning board shares, whatever the planner's role (QA DOS-131). Two planners of one bill take turns:
   * each bill of the stop is held by a transaction-scoped advisory lock before the guard runs, so the
   * second planner's guard sees the first planner's committed row.
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
    // QA DOS-131: one advisory lock per bill, deduped and taken in id order, released at commit or
    // rollback. Without it two planners pressing at the same instant both passed the guard below. The
    // planning board never locks.
    for (const invoiceId of [...invoiceIds].sort())
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${ctx.tenantId}::text || ':' || ${invoiceId}::text, 0))`,
      )
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
      // Vans and trips 3 (QA DOS-354 verify 2, M2): a trip takes only a bill that can still go out. A bill whose
      // goods were already handed over — delivered in full or in part, or sold off a van — never rides again:
      // planned, it departed, and the trip could then be neither checked in nor settled.
      await this.assertBillCanGoOut(tx, {
        invoiceNo: ref.invoiceNo ?? null,
        orderId: bill.orderId,
        retailerName: retailer.name,
      })
      // QA DOS-131: under the caller's own RLS a warehouse planner, or another crew, saw no planned row
      // and this 409 never fired; the shared ids-only predicate runs as `system`.
      const riding = (await ridingTrips(tx, [invoiceId])).get(invoiceId)
      if (riding?.how === 'planned')
        throw new ORPCError('CONFLICT', {
          message: `${ref.invoiceNo ?? 'This bill'} · ${retailer.name} is already planned on trip ${riding.tripNo ?? 'another trip'}, which has not come back and settled. A bill rides one trip at a time: take it off that trip first (Take it off, on Trips), then plan it here.`,
          data: { code: 'bill_on_another_trip', tripId: riding.tripId, tripNo: riding.tripNo },
        })
      // QA DOS-172: the goods ride back on the van until it checks in; no trip plans the bill before then.
      if (riding?.how === 'returned_on_road')
        throw new ORPCError('CONFLICT', {
          message: `invoice ${ref.invoiceNo ?? invoiceId} came back undelivered and is still out on trip ${riding.tripNo ?? riding.tripId}; plan it again after that trip checks in`,
          data: { code: 'bill_on_road', tripId: riding.tripId },
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

  /**
   * A BILL THAT CAN STILL GO OUT (vans and trips 3, QA DOS-354 verify 2 M2): its order is packed (waiting to be
   * loaded) or dispatched (on a van, planned again only through the trip that carries it). A bill already handed
   * over — the order delivered, part-delivered or closed, which a van sale is from the moment it is billed — or
   * one whose order was cancelled, is refused 409 `bill_cannot_go_out`, naming the bill, the shop and why. Asked
   * when a stop is planned (`trips.create`, `stops.add`); `depart` asks the same of the bills already on the trip.
   */
  private async assertBillCanGoOut(
    tx: Db,
    bill: { invoiceNo: string | null; orderId: string | null; retailerName: string },
  ): Promise<void> {
    if (bill.orderId === null) return
    const order = await this.orders.findOrder(tx, bill.orderId)
    if (!order || order.state === 'packed' || order.state === 'dispatched') return
    throw new ORPCError('CONFLICT', {
      message: `${billGoesOutWords(bill.invoiceNo, bill.retailerName, order.orderNo, order.state)} A trip takes only bills that can still go out.`,
      data: { code: 'bill_cannot_go_out', orderId: order.id, orderState: order.state },
    })
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
      tripMoney: (tx, tripId) => this.receivables.tripMoney(tx, tripId, { lock: false }),
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

/**
 * How a refusal names the trip that holds a van, and what has to happen first (vans and trips 1): "out on the
 * road on trip TRIP-0003" → "check trip TRIP-0003 in and settle it". Shared by the load-out, the departure and the
 * hand moves, so the godown, the desk and the crew read the same sentence.
 */
export function vanTripWords(t: VanTrip): { words: string; first: string } {
  const no = t.tripNo ?? 'its trip'
  if (t.state === 'active')
    return { words: `out on the road on trip ${no}`, first: `check trip ${no} in and settle it` }
  if (t.state === 'closing')
    return {
      words: `back from trip ${no}, which is checked in but not settled yet`,
      first: `settle trip ${no}`,
    }
  return {
    words: `already loaded for trip ${no} of ${istDateWord(t.tripDate)}`,
    first: `send trip ${no} out and settle it when it is back (or, if it is not going, check it in and settle it)`,
  }
}

/** The first letter of a sentence part upper-cased: "settle trip TRIP-0003" → "Settle trip TRIP-0003". */
function capitalise(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Why a bill cannot go out on a trip, in the desk's words (vans and trips 3): "INV/9030 · Patel Stores was already
 * delivered (order SO-0812 is delivered), so it does not go out again."
 */
function billGoesOutWords(
  invoiceNo: string | null,
  retailerName: string,
  orderNo: string | null,
  orderState: string,
): string {
  const bill = `${invoiceNo ?? 'This bill'}${retailerName === '' ? '' : ` · ${retailerName}`}`
  const order = orderNo ?? 'its order'
  if (orderState === 'delivered' || orderState === 'closed')
    return `${bill} was already delivered (order ${order} is ${orderState}), so it does not go out again.`
  if (orderState === 'partially_delivered')
    return `${bill} was already handed over in part (order ${order} is part-delivered), so it does not go out again; what the shop is still owed is a new order.`
  if (orderState === 'cancelled')
    return `${bill} belongs to order ${order}, which is cancelled, so nothing of it goes out.`
  return `${bill} is not packed yet (order ${order} is ${orderState}), so there is nothing to load.`
}

/**
 * Why a bill planned on a trip was not on its van (vans and trips 3), as the settlement lists it: "INV/9030 ·
 * Patel Stores was not on this van: order SO-0812 was already delivered, so nothing of it comes back."
 */
function notCarriedWords(
  invoiceNo: string | null,
  retailerName: string,
  orderNo: string | null,
  orderState: string,
): string {
  const bill = `${invoiceNo ?? 'A bill'}${retailerName === '' ? '' : ` · ${retailerName}`}`
  const state =
    orderState === 'delivered' || orderState === 'closed'
      ? 'was already delivered'
      : orderState === 'partially_delivered'
        ? 'was already handed over in part'
        : orderState === 'cancelled'
          ? 'is cancelled'
          : orderState === 'packed'
            ? 'was never counted out at the godown'
            : `is ${orderState}`
  return `${bill} was not on this van: order ${orderNo ?? '(no number)'} ${state}, so nothing of it comes back.`
}
