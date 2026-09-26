import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  AddPodInput,
  AddPodOutput,
  CameBackInput,
  CameBackOutput,
  CreditNoteReason,
  DeliveriesListInput,
  DeliveriesListOutput,
  DeliveryGetInput,
  DeliveryGetOutput,
  DeliveryLineReason,
  DeliveryOutcome,
  PodEvidenceIn,
  RecordDeliveryInput,
  RecordDeliveryOutput,
  StopFailureReason,
} from '@dos/contracts'
import { isSaleableReturn } from '@dos/contracts'
import { orderMachine, uuidv7, type OrderState } from '@dos/domain'
import { deliveries, deliveryLines, podEvidence, stockBalances, withTenant, type Db } from '@dos/db'
import {
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'
import { BillingService, CreditNotesService, type InvoiceForDelivery } from '../billing/index.js'
import {
  dockLocationId,
  InventoryService,
  reservableLocationId,
  type LedgerEntryInput,
} from '../inventory/index.js'
import { OrdersService } from '../orders/index.js'
import {
  acceptObjectKey,
  assertCrewOrDesk,
  dayWindow,
  declareUndelivered,
  defined,
  DOORSTEP,
  emitDeliveryEvent,
  findRetailer,
  loadLots,
  loadTripPolicy,
  loadVehicle,
  lockStop,
  lockTrip,
  MONEY_READERS,
  PIN_HOLDERS,
  STOP_TERMINAL,
  storeInline,
  TRIP_ON_THE_ROAD,
  whenOr,
  type StopRow,
  type TripRow,
} from './delivery.internals.js'
import {
  loadDeliveryDetail,
  mapDeliveries,
  toPod,
  type DeliveryRow,
  type PodRow,
} from './delivery.mappers.js'
import { TripsService } from './trips.service.js'

type RecordIn = z.infer<typeof RecordDeliveryInput>
type RecordOut = z.infer<typeof RecordDeliveryOutput>
type AddPodIn = z.infer<typeof AddPodInput>
type AddPodOut = z.infer<typeof AddPodOutput>
type ListIn = z.infer<typeof DeliveriesListInput>
type ListOut = z.infer<typeof DeliveriesListOutput>
type GetIn = z.infer<typeof DeliveryGetInput>
type GetOut = z.infer<typeof DeliveryGetOutput>
type CameBackIn = z.infer<typeof CameBackInput>
type CameBackOut = z.infer<typeof CameBackOutput>

/** A trip that has come back to the godown: its unrecorded bills are the desk's to decide (QA DOS-237). */
const CHECKED_IN = new Set(['closing', 'settled', 'settled_with_variance'])

/** At most this much proof per delivery: a photo of the bill, a signature, an OTP, a geo check, and spares. */
const MAX_POD_PER_DELIVERY = 10

/** How many bills the desk's Undelivered register reaches back over (QA DOS-196). */
const UNDELIVERED_BILLS_MAX = 500

/**
 * THE doorstep write and everything that reads it back.
 *
 * `record` is full, partial or failed in one call — the outcome is DERIVED from the lines, never sent.
 * The issued invoice is never edited: a shortfall or a return is ONE credit note at the original rate
 * through `CreditNotesService.raiseForDelivery`, which also puts the pieces back where they went —
 * saleable ones INTO THE VEHICLE, damaged ones into the damaged bin (ADR 0013, coordination §4 item 5).
 * The order moves through `OrdersService.recordDelivered` + `applyFulfilmentEvent`, the stop through
 * `stopMachine`.
 *
 * THE SALE HAPPENS AT THE DOOR (QA DOS-195). The bill's pieces rode here in the vehicle's own location —
 * the pack put them on the dock, the load sheet put them on the van — and an attempt that opened the
 * shutter relieves the VAN of the whole bill, as `sale` rows keyed `delivery:<deliveryId>:<lotId>`.
 * Whatever the shop would not take comes straight back on the credit note's own rows: onto the van if it
 * is still saleable, into the damaged bin if it is not. A FAILED attempt posts NOTHING, which is how
 * "the goods stay on the van" (docs/22 §4, D5) becomes a fact in the ledger rather than a sentence on a
 * screen, and how the godown's van check-in has something to count back.
 *
 * Pack used to post the `sale` instead, so between the pack bench and the shop's counter the pieces
 * stood in no location at all: a refused bill's cartons were physically on a van and in nothing.
 *
 * Proof travels as an object key from `files.uploadUrl`, or as inline bytes on the local storage
 * driver (`InlineFileInput`); either way only a key is stored here. `get` signs read URLs for the
 * shop's proof screen and the owner's dispute view (docs/23 §8.4).
 */
@Injectable()
export class DeliveriesService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly billing: BillingService,
    private readonly creditNotes: CreditNotesService,
    private readonly trips: TripsService,
    /** The van is relieved here, at the door: the sale leaves the vehicle's own location (QA DOS-195). */
    private readonly inventory: InventoryService,
  ) {}

  async record(input: RecordIn): Promise<RecordOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, () => this.recordInTx(tx, input)),
    )
  }

  /** The doorstep write inside the caller's transaction — the HTTP procedure and the `deliveries` sync op. */
  async recordInTx(tx: Db, input: RecordIn): Promise<RecordOut> {
    const ctx = currentTenant()
    {
      {
        const trip = await lockTrip(tx, input.tripId)
        assertCrewOrDesk(trip, DOORSTEP)
        if (!TRIP_ON_THE_ROAD.has(trip.state))
          throw new ORPCError('CONFLICT', {
            message: `trip ${trip.tripNo ?? trip.id} is ${trip.state}; a bill is delivered while the trip is out`,
          })
        const stop = await lockStop(tx, input.stopId)
        if (stop.tripId !== trip.id)
          throw new ORPCError('BAD_REQUEST', {
            message: `stop ${stop.id} is not on trip ${trip.id}`,
          })
        /*
         * QA DOS-232: the per-bill guard. A stop holds every bill planned for the shop and is terminal
         * only once each of them has an outcome (`trips.settleStopAfterBill`), so a terminal stop may
         * still carry a planned bill with none — one that ended before that rule existed. That bill is
         * recorded; a bill that already has an outcome is refused by `completeDeliveryRow` by name. A
         * terminal stop takes no NEW bill: a second attempt at the shop is a new stop.
         */
        if (
          STOP_TERMINAL.has(stop.state) &&
          !(await this.trips.billsStillOnStop(tx, stop.id)).includes(input.invoiceId)
        )
          throw new ORPCError('CONFLICT', {
            message: `stop ${stop.id} is already ${stop.state}; a second attempt is a new stop`,
          })
        const invoice = await this.billing.invoiceForDelivery(tx, input.invoiceId)
        if (invoice.retailerId !== stop.retailerId)
          throw new ORPCError('BAD_REQUEST', {
            message: `invoice ${invoice.invoiceNo ?? invoice.id} belongs to another shop than this stop`,
          })
        if (invoice.state === 'draft' || invoice.state === 'cancelled')
          throw new ORPCError('CONFLICT', {
            message: `invoice ${invoice.invoiceNo ?? invoice.id} is ${invoice.state}; only an issued bill is delivered`,
          })

        const lines = this.checkLines(invoice, input.lines)
        const outcome = outcomeOf(lines)
        if (invoice.orderId)
          assertOnTheVan(
            invoice,
            (await this.orders.lockOrder(tx, invoice.orderId)).state,
            fulfilmentEventFor(outcome),
          )
        await this.assertPodPolicy(tx, stop, outcome, input.pod)
        const at = whenOr(input.deliveredAt, new Date())

        const row = await this.completeDeliveryRow(tx, trip, stop, invoice, input, outcome, at)
        await tx.insert(deliveryLines).values(
          lines.map((l) => ({
            id: l.id,
            tenantId: ctx.tenantId,
            deliveryId: row.id,
            invoiceLineId: l.invoiceLineId,
            deliveredQtyPcs: l.deliveredQtyPcs,
            returnedQtyPcs: l.returnedQtyPcs,
            returnedSaleable: l.returnedSaleable,
            reason: l.reason ?? null,
          })),
        )
        for (const evidence of input.pod) await this.writePod(tx, row.id, evidence, at)

        // the order: delivered pieces written back, then the machine move
        if (invoice.orderId) {
          const byOrderLine = new Map<string, number>()
          for (const l of lines) {
            if (!l.orderLineId) continue
            byOrderLine.set(
              l.orderLineId,
              (byOrderLine.get(l.orderLineId) ?? 0) + l.deliveredQtyPcs,
            )
          }
          await this.orders.recordDelivered(
            tx,
            invoice.orderId,
            [...byOrderLine].map(([orderLineId, deliveredQtyPcs]) => ({
              orderLineId,
              deliveredQtyPcs,
            })),
          )
          await this.orders.applyFulfilmentEvent(
            tx,
            invoice.orderId,
            fulfilmentEventFor(outcome),
            input.deviceId ?? null,
            outcome === 'failed' ? 'refused at the door' : null,
          )
        }

        // The van is relieved of this bill the moment a door opens for it (QA DOS-195). A FAILED attempt
        // (every line zero) is the same as `stops.fail`: nothing is posted, nothing is credited, the bill
        // stays open and its cartons stay standing on the vehicle for the next attempt or the check-in.
        if (outcome !== 'failed') {
          const vehicle = await loadVehicle(tx, trip.vehicleId)
          const byLot = new Map<string, number>()
          for (const line of invoice.lines) {
            if (line.lotId === null) continue
            const pcs = line.qtyPcs + line.freeQtyPcs
            if (pcs <= 0) continue
            byLot.set(line.lotId, (byLot.get(line.lotId) ?? 0) + pcs)
          }
          if (byLot.size > 0)
            await this.inventory.post(
              tx,
              [...byLot].map(([lotId, qtyPcs]) => ({
                lotId,
                locationId: vehicle.locationId,
                qtyDelta: -qtyPcs,
                reason: 'sale' as const,
                refType: 'delivery',
                refId: row.id,
                idempotencyKey: `delivery:${row.id}:${lotId}`,
              })),
            )
        }

        // ONE credit note at the original rate for whatever came back; billing restocks it.
        const returned = outcome === 'failed' ? [] : lines.filter((l) => l.returnedQtyPcs > 0)
        let creditNoteId: string | null = null
        if (returned.length > 0) {
          const vehicle = await loadVehicle(tx, trip.vehicleId)
          const reason: CreditNoteReason = returned.every((l) => !l.returnedSaleable)
            ? 'return_damaged'
            : returned.every((l) => l.reason === 'short_loaded')
              ? 'short_delivery'
              : 'return_saleable'
          const note = await this.creditNotes.raiseForDelivery(tx, {
            id: uuidv7(),
            invoiceId: invoice.id,
            reason,
            deliveryId: row.id,
            /*
             * Back onto the VAN, whatever the reason (QA DOS-195). Short-loaded pieces used to restock at
             * the godown on the reading that they "never left it" — but the bill's whole quantity left the
             * rack at pack and rode out on this sheet, and the line above has just relieved the van of it,
             * so crediting them anywhere else would drive the vehicle's balance below zero. A godown that
             * really did put fewer in the carton is a MISCOUNT, and the check-in's van count is where it
             * surfaces: the crew counts what is there, the settlement writes the `cycle_count` difference
             * and a stock variance sends the trip to the owner.
             */
            restockLocationId: vehicle.locationId,
            note: input.note ?? null,
            lines: returned.map((l) => ({
              id: uuidv7(),
              invoiceLineId: l.invoiceLineId,
              qtyPcs: l.returnedQtyPcs,
              saleable: l.returnedSaleable,
            })),
          })
          creditNoteId = note.id
        }

        // QA DOS-197 / DOS-203: "Nothing from this bill" is a failed stop like the fail sheet's. The bill
        // rides back on the van — out of the shop's dues and its ageing until it is delivered, and the
        // shop told by bill NUMBER — and the stop carries WHY, read off the lines the crew tapped, so no
        // desk register over it says "failed" with no cause. Anything handed over clears the flag.
        if (outcome === 'failed')
          await declareUndelivered(tx, this.billing, {
            deliveryId: row.id,
            tripId: trip.id,
            stopId: stop.id,
            retailerId: stop.retailerId,
            invoiceId: invoice.id,
            invoiceNo: invoice.invoiceNo,
            failureReason: stopReasonOf(lines),
            at,
          })
        else await this.billing.clearUndelivered(tx, invoice.id)

        // QA DOS-232: the stop ends when its LAST bill has an outcome, never on the first.
        let nextStop = await this.trips.settleStopAfterBill(tx, stop, at)
        if (outcome === 'failed')
          nextStop = await this.trips.recordStopFailure(
            tx,
            nextStop,
            stopReasonOf(lines),
            input.note?.trim() || null,
          )
        await emitDeliveryEvent(tx, 'delivery', row.id, 'DeliveryRecorded', {
          deliveryId: row.id,
          tripId: trip.id,
          invoiceId: invoice.id,
          orderId: invoice.orderId,
          retailerId: stop.retailerId,
          outcome,
          shortPcs: returned.reduce((n, l) => n + l.returnedQtyPcs, 0),
          creditNoteId,
        })
        return {
          item: await loadDeliveryDetail(tx, row, this.trips.deps()),
          stop: await this.trips.stopItem(tx, nextStop, trip),
          creditNoteId,
        }
      }
    }
  }

  /** Proof that arrived after the state ("proof pending"). Idempotent by the evidence id. */
  async addPod(input: AddPodIn): Promise<AddPodOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, () =>
        this.addPodInTx(tx, input.id, input.evidence),
      ),
    )
  }

  async addPodInTx(tx: Db, deliveryId: string, evidence: PodEvidenceIn): Promise<AddPodOut> {
    const delivery = await this.findDelivery(tx, deliveryId)
    const trip = await lockTrip(tx, delivery.tripId)
    assertCrewOrDesk(trip, DOORSTEP)
    // A replay is the SAME proof on the SAME delivery. Narrowed by delivery id on purpose: `pod_evidence_read`
    // shows the desk the whole tenant, so an id-only look-up handed an owner another delivery's row back as a
    // 200 "proof recorded" (QA DOS-176). A foreign row falls through to the 409 in `writePod`, whether or not
    // this caller is allowed to see it.
    const [existing] = await tx
      .select()
      .from(podEvidence)
      .where(and(eq(podEvidence.id, evidence.id), eq(podEvidence.deliveryId, delivery.id)))
      .limit(1)
    if (existing) return { item: toPod(existing) }
    const [{ n }] = (await tx
      .select({ n: sql<number>`count(*)` })
      .from(podEvidence)
      .where(eq(podEvidence.deliveryId, delivery.id))) as [{ n: number | string }]
    if (Number(n) >= MAX_POD_PER_DELIVERY)
      throw new ORPCError('BAD_REQUEST', {
        message: `delivery ${delivery.id} already carries ${String(MAX_POD_PER_DELIVERY)} pieces of proof`,
      })
    const row = await this.writePod(tx, delivery.id, evidence, new Date())
    return { item: toPod(row) }
  }

  /**
   * The owner's register, the shop's proof list, and THE DESK'S UNDELIVERED REGISTER (QA DOS-196); RLS
   * narrows the shop to its own bills.
   *
   * `undeliveredOnly` answers the last attempt on every bill still waiting to be delivered. Which bills
   * those are is billing's fact (`invoices.undelivered_at`, and the bill not cancelled since), asked of
   * billing rather than joined here; which ATTEMPT carries the reason and the trip is this module's, and
   * is the failed row with no later row for the same bill.
   */
  async list(input: ListIn): Promise<ListOut> {
    requireRole(MONEY_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const waiting = input.undeliveredOnly
        ? await this.billing.undeliveredInvoiceIds(tx, UNDELIVERED_BILLS_MAX)
        : null
      if (waiting !== null && waiting.length === 0) return { items: [], nextCursor: null }
      const filters: (SQL | undefined)[] = [
        input.tripId ? eq(deliveries.tripId, input.tripId) : undefined,
        input.stopId ? eq(deliveries.stopId, input.stopId) : undefined,
        input.invoiceId ? eq(deliveries.invoiceId, input.invoiceId) : undefined,
        input.retailerId ? eq(deliveries.retailerId, input.retailerId) : undefined,
        input.outcome ? eq(deliveries.outcome, input.outcome) : undefined,
        input.attemptedOnly ? sql`${deliveries.outcome} is not null` : undefined,
        // QA DOS-237: went out on a trip that has checked in, and nobody ever said what became of it
        input.unrecordedOnly
          ? sql`${deliveries.outcome} is null and exists (
                  select 1 from trips t
                   where t.tenant_id = ${deliveries.tenantId}
                     and t.id = ${deliveries.tripId}
                     and t.state in ('closing', 'settled', 'settled_with_variance'))`
          : undefined,
        waiting === null ? undefined : inArray(deliveries.invoiceId, waiting),
        waiting === null ? undefined : eq(deliveries.outcome, 'failed'),
        waiting === null
          ? undefined
          : sql`not exists (select 1 from deliveries later
                             where later.tenant_id = ${deliveries.tenantId}
                               and later.invoice_id = ${deliveries.invoiceId}
                               and later.id > ${deliveries.id})`,
        ...dayWindow(deliveries.deliveredAt, input.from, input.to),
        input.cursor ? lt(deliveries.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(deliveries)
        .where(and(...defined(filters)))
        .orderBy(desc(deliveries.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const items = await mapDeliveries(tx, page, this.trips.deps())
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(MONEY_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => ({
      item: await loadDeliveryDetail(tx, await this.findDelivery(tx, input.id), this.trips.deps()),
    }))
  }

  /**
   * THE DESK SAYS A BILL CAME BACK (QA DOS-237).
   *
   * INV/9017 went out on TRIP-0002 as the second bill of a two-bill stop. Before DOS-232 the first bill walked
   * the stop to `delivered`, the second could not be recorded at the door, the check-in skipped the ended
   * stop, and the trip settled with the bill's delivery still NULL: paid, `dispatched`, its 166 pieces
   * counted back into the godown as free stock, on no register and no planning board. Nothing in the app
   * could send it again. This is the desk's way out for any such bill:
   *
   *   record   the delivery `failed` through `trips.failPlannedDelivery` — the check-in's own effects: the
   *            order back to `packed`, the bill flagged undelivered (Undelivered register, planning board,
   *            out of the shop's dues, the shop told);
   *   stage    the bill's pieces on the DOCK for its next load sheet (docs/22 §4, DOS-195/DOS-172: a bill
   *            that came back goes out again on a fresh sheet from the dock). While the trip is `closing`
   *            the pieces still on the van are left there — the settlement's count moves them to the dock
   *            now that the bill is failed — and only the rest is taken from the godown. After settlement
   *            they were counted into the godown as free stock, so they are moved godown → dock, as many as
   *            the godown still holds FREE (on hand less reserved). A batch sold on since is reported short,
   *            never invented, and the load-out will name it.
   *
   * 409 while the trip is still out (the crew or the check-in records it), before it left, once the delivery
   * has an outcome, or for a bill cancelled since. Audited. One transaction; a replay answers the first reply.
   */
  async cameBack(input: CameBackIn): Promise<CameBackOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const found = await this.findDelivery(tx, input.id)
        const trip = await lockTrip(tx, found.tripId)
        const [d] = await tx
          .select()
          .from(deliveries)
          .where(eq(deliveries.id, found.id))
          .for('update')
        if (!d) throw new ORPCError('NOT_FOUND', { message: `delivery ${input.id} not found` })
        const invoice = await this.billing.invoiceForDelivery(tx, d.invoiceId)
        const bill = invoice.invoiceNo ?? invoice.id
        const tripName = trip.tripNo ?? trip.id
        if (d.outcome !== null)
          throw new ORPCError('CONFLICT', {
            message: `bill ${bill} has an outcome on trip ${tripName} (${d.outcome}); only a bill nobody recorded can be declared back`,
            data: { code: 'delivery_recorded', outcome: d.outcome },
          })
        if (!CHECKED_IN.has(trip.state))
          throw new ORPCError('CONFLICT', {
            message:
              trip.state === 'active'
                ? `trip ${tripName} is still out; the crew records bill ${bill} at the door, or the check-in does`
                : `trip ${tripName} is ${trip.state}; bill ${bill} did not go out on it`,
            data: { code: 'trip_not_checked_in', tripState: trip.state },
          })
        if (invoice.state === 'cancelled' || invoice.state === 'draft')
          throw new ORPCError('CONFLICT', {
            message: `bill ${bill} is ${invoice.state}; there is nothing to send again`,
          })

        const at = new Date()
        const note = input.note?.trim() || 'nothing was recorded at the door'
        await this.trips.failPlannedDelivery(tx, d, {
          failureReason: 'other',
          failureNote: note,
          at,
          deviceId: null,
        })
        const staged = await this.stageOnDock(tx, trip, d.id, invoice)
        await writeAudit(tx, {
          action: 'delivery.came_back',
          entityType: 'delivery',
          entityId: d.id,
          before: { outcome: null, tripState: trip.state },
          after: {
            outcome: 'failed',
            invoiceId: invoice.id,
            invoiceNo: invoice.invoiceNo,
            note,
            staged: staged.map((s) => ({
              lotId: s.lotId,
              neededPcs: s.neededPcs,
              stagedPcs: s.stagedPcs,
              onVanPcs: s.onVanPcs,
            })),
          },
          deviceId: null,
        })
        // the outbox already carries `DeliveryFailed` (`failPlannedDelivery`): the shop is told by bill number
        const [row] = await tx.select().from(deliveries).where(eq(deliveries.id, d.id)).limit(1)
        const [item] = await mapDeliveries(tx, [row ?? d], this.trips.deps())
        if (!item)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'delivery row vanished' })
        return { item, staged }
      }),
    )
  }

  /** Where a bill that came back must stand for its next load sheet: the dock (QA DOS-237, see `cameBack`). */
  private async stageOnDock(
    tx: Db,
    trip: TripRow,
    deliveryId: string,
    invoice: InvoiceForDelivery,
  ): Promise<CameBackOut['staged']> {
    const { tenantId } = currentTenant()
    const need = new Map<string, { pcs: number; description: string }>()
    for (const line of invoice.lines) {
      const pcs = line.qtyPcs + line.freeQtyPcs
      if (line.lotId === null || pcs <= 0) continue
      const held = need.get(line.lotId)
      need.set(line.lotId, {
        pcs: (held?.pcs ?? 0) + pcs,
        description: held?.description ?? line.description,
      })
    }
    if (need.size === 0) return []

    // While the trip is `closing` the settlement still counts the van: what stands on it for this bill (after
    // the other bills that came back on it) goes to the dock there. Settled, the van is somebody else's now.
    const onVan = new Map<string, number>()
    if (trip.state === 'closing') {
      const vehicle = await loadVehicle(tx, trip.vehicleId)
      const van = await this.inventory.onHandAt(tx, vehicle.locationId)
      const others = await this.otherBillsBack(tx, trip.id, invoice.id)
      for (const [lotId, { pcs }] of need)
        onVan.set(
          lotId,
          Math.min(pcs, Math.max(0, (van.get(lotId) ?? 0) - (others.get(lotId) ?? 0))),
        )
    }

    const godown = await reservableLocationId(tx)
    const dock = await dockLocationId(tx)
    const lots = await loadLots(tx, [...need.keys()])
    const entries: LedgerEntryInput[] = []
    const staged: CameBackOut['staged'] = []
    for (const [lotId, { pcs, description }] of need) {
      const fromVan = onVan.get(lotId) ?? 0
      const wanted = pcs - fromVan
      let take = 0
      if (wanted > 0) {
        const [balance] = await tx
          .select({ onHand: stockBalances.onHand, reserved: stockBalances.reserved })
          .from(stockBalances)
          .where(
            and(
              eq(stockBalances.tenantId, tenantId),
              eq(stockBalances.lotId, lotId),
              eq(stockBalances.locationId, godown),
            ),
          )
          .for('update')
        take = Math.min(wanted, Math.max(0, (balance?.onHand ?? 0) - (balance?.reserved ?? 0)))
      }
      if (take > 0) {
        const note = `bill ${invoice.invoiceNo ?? invoice.id} came back: staged for its next trip`
        entries.push(
          {
            lotId,
            locationId: godown,
            qtyDelta: -take,
            reason: 'transfer_out',
            refType: 'delivery',
            refId: deliveryId,
            idempotencyKey: `came-back:${deliveryId}:${lotId}:out`,
            note,
          },
          {
            lotId,
            locationId: dock,
            qtyDelta: take,
            reason: 'transfer_in',
            refType: 'delivery',
            refId: deliveryId,
            idempotencyKey: `came-back:${deliveryId}:${lotId}:in`,
            note,
          },
        )
      }
      const lot = lots.get(lotId)
      staged.push({
        lotId,
        description,
        batchNo: lot === undefined || lot.batchNo === '' ? null : lot.batchNo,
        neededPcs: pcs,
        stagedPcs: take,
        onVanPcs: fromVan,
      })
    }
    if (entries.length > 0) await this.inventory.post(tx, entries)
    return staged
  }

  /** The pieces per lot of the OTHER bills that came back on this trip (the settlement stages those first). */
  private async otherBillsBack(
    tx: Db,
    tripId: string,
    invoiceId: string,
  ): Promise<Map<string, number>> {
    const rows = await tx
      .select({ invoiceId: deliveries.invoiceId })
      .from(deliveries)
      .where(and(eq(deliveries.tripId, tripId), eq(deliveries.outcome, 'failed')))
    const need = new Map<string, number>()
    for (const other of new Set(rows.map((r) => r.invoiceId))) {
      if (other === invoiceId) continue
      const bill = await this.billing.invoiceForDelivery(tx, other)
      if (bill.state === 'cancelled') continue
      for (const line of bill.lines) {
        const pcs = line.qtyPcs + line.freeQtyPcs
        if (line.lotId === null || pcs <= 0) continue
        need.set(line.lotId, (need.get(line.lotId) ?? 0) + pcs)
      }
    }
    return need
  }

  // -------------------------------------------------------------------------------------------------------------
  // internals

  /**
   * Every listed line must be the bill's, listed once, with `delivered + returned = qty + free`, and a
   * damaged or expired return is never saleable (`return_not_saleable`). A line the crew did not list
   * was handed over in full — the crew records exceptions, not the whole bill.
   */
  private checkLines(
    invoice: InvoiceForDelivery,
    input: RecordIn['lines'],
  ): {
    id: string
    invoiceLineId: string
    orderLineId: string | null
    deliveredQtyPcs: number
    returnedQtyPcs: number
    returnedSaleable: boolean
    reason: RecordIn['lines'][number]['reason']
  }[] {
    const byId = new Map(invoice.lines.map((l) => [l.id, l]))
    const seen = new Set<string>()
    const out: ReturnType<DeliveriesService['checkLines']> = []
    for (const line of input) {
      const source = byId.get(line.invoiceLineId)
      if (!source)
        throw new ORPCError('BAD_REQUEST', {
          message: `line ${line.invoiceLineId} does not belong to invoice ${invoice.invoiceNo ?? invoice.id}`,
        })
      if (seen.has(line.invoiceLineId))
        throw new ORPCError('BAD_REQUEST', {
          message: `line ${line.invoiceLineId} is listed twice`,
        })
      seen.add(line.invoiceLineId)
      const billed = source.qtyPcs + source.freeQtyPcs
      if (line.deliveredQtyPcs + line.returnedQtyPcs !== billed)
        throw new ORPCError('BAD_REQUEST', {
          message: `${source.description}: delivered ${String(line.deliveredQtyPcs)} + returned ${String(line.returnedQtyPcs)} must equal the ${String(billed)} pieces billed`,
          data: { invoiceLineId: source.id, billedPcs: billed },
        })
      // a damaged or expired piece goes to the damaged bin: the line cannot also say it goes back on sale
      if (line.returnedQtyPcs > 0 && line.returnedSaleable && !isSaleableReturn(line.reason))
        throw new ORPCError('BAD_REQUEST', {
          message: `${source.description}: ${String(line.reason)} goods go to the damaged bin, not back on sale`,
          data: { code: 'return_not_saleable', invoiceLineId: source.id, reason: line.reason },
        })
      out.push({
        id: line.id,
        invoiceLineId: source.id,
        orderLineId: source.orderLineId,
        deliveredQtyPcs: line.deliveredQtyPcs,
        returnedQtyPcs: line.returnedQtyPcs,
        returnedSaleable: line.returnedSaleable,
        reason: line.reason,
      })
    }
    for (const source of invoice.lines) {
      if (seen.has(source.id)) continue
      out.push({
        id: uuidv7(),
        invoiceLineId: source.id,
        orderLineId: source.orderLineId,
        deliveredQtyPcs: source.qtyPcs + source.freeQtyPcs,
        returnedQtyPcs: 0,
        returnedSaleable: true,
        reason: undefined,
      })
    }
    return out
  }

  /**
   * `delivery.pod_required`: `always` wants a photo or a signature on every delivered bill,
   * `credit_only` on a shop that pays after delivery (`payment_terms = POST_FULFILLMENT`), `never`
   * nothing. A failed attempt never needs proof — there is nothing to prove.
   */
  private async assertPodPolicy(
    tx: Db,
    stop: StopRow,
    outcome: DeliveryOutcome,
    pod: readonly PodEvidenceIn[],
  ): Promise<void> {
    if (outcome === 'failed') return
    const policy = await loadTripPolicy(tx)
    if (policy.podRequired === 'never') return
    if (policy.podRequired === 'credit_only') {
      const retailer = await findRetailer(tx, stop.retailerId)
      if (retailer.paymentTerms !== 'POST_FULFILLMENT') return
    }
    if (pod.some((p) => p.kind === 'photo' || p.kind === 'signature')) return
    throw new ORPCError('BAD_REQUEST', {
      message:
        'this distributor requires a photo or a signature as proof of delivery for this shop',
      data: { code: 'pod_required', podRequired: policy.podRequired },
    })
  }

  /**
   * The planned row created with the stop (`outcome: null`) is completed; a bill added at the door
   * gets a new row under the caller's id. One invoice is delivered at most once per stop.
   */
  private async completeDeliveryRow(
    tx: Db,
    trip: TripRow,
    stop: StopRow,
    invoice: InvoiceForDelivery,
    input: RecordIn,
    outcome: DeliveryOutcome,
    at: Date,
  ): Promise<DeliveryRow> {
    const ctx = currentTenant()
    const [planned] = await tx
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.stopId, stop.id), eq(deliveries.invoiceId, invoice.id)))
      .for('update')
    if (planned?.outcome)
      throw new ORPCError('CONFLICT', {
        message: `invoice ${invoice.invoiceNo ?? invoice.id} was already ${planned.outcome} at this stop`,
      })
    const values = {
      outcome,
      deliveredBy: ctx.actorId,
      deliveredAt: at,
      receiverName: input.receiverName ?? null,
      note: input.note ?? null,
      deviceId: input.deviceId ?? null,
      idempotencyKey: input.idempotencyKey,
      updatedAt: new Date(),
    }
    if (planned) {
      const [row] = await tx
        .update(deliveries)
        .set(values)
        .where(eq(deliveries.id, planned.id))
        .returning()
      return row ?? planned
    }
    const [row] = await tx
      .insert(deliveries)
      .values({
        id: input.id,
        tenantId: ctx.tenantId,
        tripId: trip.id,
        stopId: stop.id,
        retailerId: stop.retailerId,
        orderId: invoice.orderId,
        invoiceId: invoice.id,
        ...values,
      })
      .returning()
    if (!row)
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'delivery insert returned nothing' })
    return row
  }

  private async writePod(
    tx: Db,
    deliveryId: string,
    evidence: PodEvidenceIn,
    at: Date,
  ): Promise<PodRow> {
    const ctx = currentTenant()
    let key: string | null = null
    if (evidence.inline)
      key = await storeInline(tx, {
        domain: 'pod',
        entityId: deliveryId,
        fileId: evidence.id,
        mimeType: evidence.inline.mimeType,
        contentBase64: evidence.inline.contentBase64,
      })
    else if (evidence.objectKey) key = await acceptObjectKey(tx, evidence.objectKey, 'pod')
    const [row] = await tx
      .insert(podEvidence)
      .values({
        id: evidence.id,
        tenantId: ctx.tenantId,
        deliveryId,
        kind: evidence.kind,
        objectKey: key,
        payload: evidence.payload ?? null,
        lat: evidence.lat ?? null,
        lng: evidence.lng ?? null,
        capturedAt: evidence.capturedAt ? new Date(evidence.capturedAt) : at,
      })
      .onConflictDoNothing()
      .returning()
    if (row) return row
    const [existing] = await tx
      .select()
      .from(podEvidence)
      .where(and(eq(podEvidence.id, evidence.id), eq(podEvidence.deliveryId, deliveryId)))
      .limit(1)
    // A replay of proof already recorded on THIS delivery: the row it already wrote.
    if (existing) return existing
    // The insert hit the primary key, yet nothing comes back from the look-up: the row that holds this id is one
    // this caller cannot see, or one on another delivery (QA DOS-176). Either way it is not this delivery's proof,
    // and saying "recorded" would put the proof on a delivery it is not on. The id is the client's, so the answer
    // belongs to the client; a 500 told the crew nothing and left a delivered stop it could not close.
    throw new ORPCError('CONFLICT', {
      message: `proof ${evidence.id} is already recorded against another delivery; send this proof under an id of its own`,
      data: { code: 'pod_id_taken', evidenceId: evidence.id },
    })
  }

  private async findDelivery(tx: Db, id: string): Promise<DeliveryRow> {
    const [row] = await tx.select().from(deliveries).where(eq(deliveries.id, id)).limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `delivery ${id} not found` })
    return row
  }
}

/** The order move a doorstep outcome asks for — the one place the three are paired. */
function fulfilmentEventFor(
  outcome: DeliveryOutcome,
): 'deliver_all' | 'deliver_partial' | 'return_undelivered' {
  if (outcome === 'delivered') return 'deliver_all'
  return outcome === 'partial' ? 'deliver_partial' : 'return_undelivered'
}

/** Where each doorstep move takes a dispatched order — so "already applied" is read off the machine. */
const DOORSTEP_TARGET = orderMachine.transitions.dispatched

/** The states of an order that is still at the godown: nothing on it is at any shop door. */
const IN_THE_GODOWN = new Set<OrderState>(['draft', 'submitted', 'confirmed', 'picking', 'packed'])

/**
 * DOS-148 — A BILL THAT WAS NEVER LOADED IS REFUSED IN THE DRIVER'S OWN WORDS, BEFORE THE PHOTOGRAPH.
 *
 * `packed → dispatched` happens at `warehouse.loadSheets.confirm` and nowhere else, and the depart gate
 * (QA DOS-043 / DOS-172) holds a vehicle back whose planned bills have not been through it. A bill ADDED
 * to a trip already on the road never meets that gate, so a stop can offer "Deliver this bill" for goods
 * sitting in the godown. Recorded, that reached `applyFulfilmentEvent` and came back as the order
 * machine's own `TransitionError` — `cannot apply "deliver_partial" in state "packed"` — in red, at a
 * shop door, after the crew had photographed a signed bill.
 *
 * So it is asked here, before `assertPodPolicy` sends anybody to a camera. A move the machine already
 * allows passes, and so does one the order has ALREADY been through: `applyFulfilmentEvent` is
 * idempotent by state, and a failed attempt on a bill that came back to `packed` has always been a
 * no-op rather than a refusal. Everything else is a sentence naming the bill and the next action.
 */
function assertOnTheVan(
  invoice: InvoiceForDelivery,
  state: OrderState,
  event: 'deliver_all' | 'deliver_partial' | 'return_undelivered',
): void {
  if (orderMachine.can(state, event) || state === DOORSTEP_TARGET[event]) return
  const bill = invoice.invoiceNo ?? invoice.id
  throw new ORPCError('CONFLICT', {
    message: IN_THE_GODOWN.has(state)
      ? `bill ${bill} was not loaded on this van — it is still in the godown. Tell the office; nothing on it can be handed over here.`
      : `bill ${bill} is not out for delivery on this van. Tell the office before you hand anything over.`,
    data: { code: 'order_not_dispatched', orderState: state, invoiceId: invoice.id },
  })
}

/**
 * WHY THE STOP FAILED, read off the lines the crew tapped (QA DOS-203).
 *
 * A refusal taken through the deliver screen used to leave `trip_stops.failure_reason` NULL while the two
 * stops failed through the fail sheet carried `shop_closed` and `other`, so any desk register over the
 * stop showed a failure with no cause. The word is already in the row — `delivery_lines.reason` — and
 * this maps it onto the crew's own fail-sheet vocabulary (`StopFailureReason`). A line reason with no
 * stop equivalent, or none at all, is `other`, which is what the fail sheet itself records for it.
 */
function stopReasonOf(
  lines: readonly { returnedQtyPcs: number; reason?: DeliveryLineReason | null | undefined }[],
): StopFailureReason {
  const reasons = new Set(lines.filter((l) => l.returnedQtyPcs > 0).map((l) => l.reason ?? 'other'))
  if (reasons.size === 1) {
    const [only] = [...reasons]
    if (only === 'refused') return 'refused'
    if (only === 'damaged' || only === 'expired') return 'damaged_goods'
  }
  return 'other'
}

/** Derived, never sent (brief rule 8): every line full → delivered; every line zero → failed; else partial. */
function outcomeOf(
  lines: readonly { deliveredQtyPcs: number; returnedQtyPcs: number }[],
): DeliveryOutcome {
  const delivered = lines.reduce((n, l) => n + l.deliveredQtyPcs, 0)
  const returned = lines.reduce((n, l) => n + l.returnedQtyPcs, 0)
  if (delivered === 0 && returned > 0) return 'failed'
  if (returned === 0) return 'delivered'
  return 'partial'
}
