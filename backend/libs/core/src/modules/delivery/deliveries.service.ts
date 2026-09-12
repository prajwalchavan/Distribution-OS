import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  AddPodInput,
  AddPodOutput,
  CreditNoteReason,
  DeliveriesListInput,
  DeliveriesListOutput,
  DeliveryGetInput,
  DeliveryGetOutput,
  DeliveryOutcome,
  PodEvidenceIn,
  RecordDeliveryInput,
  RecordDeliveryOutput,
} from '@dos/contracts'
import { isSaleableReturn } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import { deliveries, deliveryLines, podEvidence, withTenant, type Db } from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { BillingService, CreditNotesService, type InvoiceForDelivery } from '../billing/index.js'
import { OrdersService } from '../orders/index.js'
import {
  acceptObjectKey,
  assertCrewOrDesk,
  dayWindow,
  defined,
  DOORSTEP,
  emitDeliveryEvent,
  findRetailer,
  loadTripPolicy,
  loadVehicle,
  lockStop,
  lockTrip,
  MONEY_READERS,
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

/** At most this much proof per delivery: a photo of the bill, a signature, an OTP, a geo check, and spares. */
const MAX_POD_PER_DELIVERY = 10

/**
 * THE doorstep write and everything that reads it back.
 *
 * `record` is full, partial or failed in one call — the outcome is DERIVED from the lines, never sent.
 * The issued invoice is never edited: a shortfall or a return is ONE credit note at the original rate
 * through `CreditNotesService.raiseForDelivery`, which also puts the pieces back where they went —
 * saleable ones INTO THE VEHICLE, damaged ones into the damaged bin (ADR 0013, coordination §4 item 5)
 * — so this module posts no ledger row of its own for a return. The order moves through
 * `OrdersService.recordDelivered` + `applyFulfilmentEvent`, the stop through `stopMachine`.
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
        if (STOP_TERMINAL.has(stop.state))
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
            outcome === 'delivered'
              ? 'deliver_all'
              : outcome === 'partial'
                ? 'deliver_partial'
                : 'return_undelivered',
            input.deviceId ?? null,
            outcome === 'failed' ? 'refused at the door' : null,
          )
        }

        // ONE credit note at the original rate for whatever came back; billing restocks it. A FAILED
        // attempt (every line zero) is the same as `stops.fail`: the bill stays open, the pieces stay on
        // the van for the next attempt, and nothing is credited.
        const returned = outcome === 'failed' ? [] : lines.filter((l) => l.returnedQtyPcs > 0)
        let creditNoteId: string | null = null
        if (returned.length > 0) {
          const vehicle = await loadVehicle(tx, trip.vehicleId)
          const allShortLoaded = returned.every((l) => l.reason === 'short_loaded')
          const reason: CreditNoteReason = returned.every((l) => !l.returnedSaleable)
            ? 'return_damaged'
            : allShortLoaded
              ? 'short_delivery'
              : 'return_saleable'
          const note = await this.creditNotes.raiseForDelivery(tx, {
            id: uuidv7(),
            invoiceId: invoice.id,
            reason,
            deliveryId: row.id,
            // short-loaded pieces never left the godown: they restock where the order shipped from
            restockLocationId: allShortLoaded ? null : vehicle.locationId,
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

        const nextStop = await this.trips.walkStop(
          tx,
          stop,
          outcome === 'returned' ? 'delivered' : outcome,
          at,
          null,
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
    const [existing] = await tx
      .select()
      .from(podEvidence)
      .where(eq(podEvidence.id, evidence.id))
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

  /** The owner's register and the shop's proof list; RLS narrows the shop to its own bills. */
  async list(input: ListIn): Promise<ListOut> {
    requireRole(MONEY_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.tripId ? eq(deliveries.tripId, input.tripId) : undefined,
        input.stopId ? eq(deliveries.stopId, input.stopId) : undefined,
        input.invoiceId ? eq(deliveries.invoiceId, input.invoiceId) : undefined,
        input.retailerId ? eq(deliveries.retailerId, input.retailerId) : undefined,
        input.outcome ? eq(deliveries.outcome, input.outcome) : undefined,
        input.attemptedOnly ? sql`${deliveries.outcome} is not null` : undefined,
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
      .where(eq(podEvidence.id, evidence.id))
      .limit(1)
    if (!existing)
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'proof insert returned nothing' })
    return existing
  }

  private async findDelivery(tx: Db, id: string): Promise<DeliveryRow> {
    const [row] = await tx.select().from(deliveries).where(eq(deliveries.id, id)).limit(1)
    if (!row) throw new ORPCError('NOT_FOUND', { message: `delivery ${id} not found` })
    return row
  }
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
