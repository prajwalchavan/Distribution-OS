import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { CreateVanSaleInput, CreateVanSaleOutput } from '@dos/contracts'
import { deliveries, deliveryLines, trips, tripStops, withTenant, type Db } from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { BillingService } from '../billing/index.js'
import { OrdersService } from '../orders/index.js'
import { CollectionsService } from './collections.service.js'
import {
  assertCrewOrDesk,
  DOORSTEP,
  emitDeliveryEvent,
  findRetailer,
  loadVehicle,
  lockTrip,
  STOP_TERMINAL,
  stopsOf,
  vanSalesFlag,
  whenOr,
  type StopRow,
} from './delivery.internals.js'
import { mapDeliveries } from './delivery.mappers.js'
import { deterministicLineId, TripsService } from './trips.service.js'

type CreateIn = z.infer<typeof CreateVanSaleInput>
type CreateOut = z.infer<typeof CreateVanSaleOutput>

/**
 * An on-the-spot sale from van stock (ADR 0013), in ONE transaction:
 *
 *   order   `OrdersService.insertDraft` + `writeLines` (`source = 'van_sale'`, `fulfilFromLocationId` =
 *           the vehicle's location, priced by `priceOrder()` like any other order) → `submitInTx`,
 *           which confirms on the spot when no approval gate trips; a gate (credit, bargain, floor) is
 *           a 409 — the crew cannot wait for the owner at a shop door;
 *   bill    `BillingService.issueFromLocation` on the TENANT'S NORMAL SERIES (docs/17 §D5), which
 *           reserves from the VEHICLE — a shortage is a hard 400 from inventory, the van never goes
 *           negative — posts the `sale` rows at the vehicle and the AR entry through receivables;
 *   road    the order `dispatch` → `deliver_all` through `applyFulfilmentEvent`, a stop for the shop
 *           when the caller named none, a `deliveries` row at full quantity;
 *   money   when `collect` is present, exactly what `collections.record` does, allocated to this bill.
 *
 * 403 unless the trip is `active` AND `vanSalesAllowed` (the trip toggle AND the feature flag). The
 * shop must already exist in this tenant — the crew never onboards a shop (docs/17 item 27).
 */
@Injectable()
export class VanSalesService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly billing: BillingService,
    private readonly trips: TripsService,
    private readonly collections: CollectionsService,
  ) {}

  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const trip = await lockTrip(tx, input.tripId)
        assertCrewOrDesk(trip, DOORSTEP)
        if (trip.state !== 'active')
          throw new ORPCError('CONFLICT', {
            message: `trip ${trip.tripNo ?? trip.id} is ${trip.state}; a van sale happens on an active trip`,
          })
        if (!trip.vanSalesEnabled || !(await vanSalesFlag(tx)))
          throw new ORPCError('FORBIDDEN', {
            message: 'van sales are not allowed on this trip',
            data: { code: 'van_sales_disabled' },
          })
        const vehicle = await loadVehicle(tx, trip.vehicleId)
        const retailer = await findRetailer(tx, input.retailerId)
        const stop = await this.stopFor(tx, trip.id, input.stopId, retailer.id)

        // the order, priced like any other, from the vehicle
        const draft = await this.orders.insertDraft(tx, {
          id: input.id,
          retailerId: retailer.id,
          source: 'van_sale',
          pricingDateMode: 'order',
          fulfilFromLocationId: vehicle.locationId,
          note: input.note ?? null,
        })
        const lined = await this.orders.writeLines(tx, draft, input.lines)
        const submitted = await this.orders.submitInTx(tx, lined, input.deviceId ?? null)
        if (submitted.flags.length > 0)
          throw new ORPCError('CONFLICT', {
            message: `this sale needs the desk's approval (${submitted.flags.join(', ')}); it cannot be billed at the door`,
            data: { code: 'approval_required', flags: submitted.flags },
          })

        // the bill, from the tenant's normal series, stock leaving the VEHICLE
        const at = whenOr(undefined, new Date())
        const invoiceRow = await this.billing.issueFromLocation(tx, {
          orderId: draft.id,
          locationId: vehicle.locationId,
          issuedBy: ctx.actorId,
          invoiceId: input.invoiceId,
          ...(input.invoiceDate === undefined ? {} : { invoiceDate: input.invoiceDate }),
          deviceId: input.deviceId ?? null,
        })
        await this.orders.applyFulfilmentEvent(
          tx,
          draft.id,
          'dispatch',
          input.deviceId ?? null,
          'van sale',
        )
        const invoice = await this.billing.invoiceForDelivery(tx, invoiceRow.id)
        await this.orders.recordDelivered(
          tx,
          draft.id,
          invoice.lines
            .filter((l) => l.orderLineId !== null)
            .map((l) => ({
              orderLineId: l.orderLineId as string,
              deliveredQtyPcs: l.qtyPcs + l.freeQtyPcs,
            })),
        )
        await this.orders.applyFulfilmentEvent(
          tx,
          draft.id,
          'deliver_all',
          input.deviceId ?? null,
          'van sale',
        )

        // the doorstep record, at full quantity
        const [deliveryRow] = await tx
          .insert(deliveries)
          .values({
            id: input.deliveryId,
            tenantId: ctx.tenantId,
            tripId: trip.id,
            stopId: stop.id,
            retailerId: retailer.id,
            orderId: draft.id,
            invoiceId: invoice.id,
            outcome: 'delivered',
            deliveredBy: ctx.actorId,
            deliveredAt: at,
            note: input.note ?? null,
            deviceId: input.deviceId ?? null,
            idempotencyKey: `van-sale:${input.id}`,
          })
          .returning()
        if (!deliveryRow)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'delivery insert returned nothing',
          })
        if (invoice.lines.length > 0)
          await tx.insert(deliveryLines).values(
            invoice.lines.map((l) => ({
              id: deterministicLineId(deliveryRow.id, l.id),
              tenantId: ctx.tenantId,
              deliveryId: deliveryRow.id,
              invoiceLineId: l.id,
              deliveredQtyPcs: l.qtyPcs + l.freeQtyPcs,
              returnedQtyPcs: 0,
              returnedSaleable: true,
              reason: null,
            })),
          )
        // a shop already visited keeps its stop state; a fresh stop lands on `delivered`
        if (!STOP_TERMINAL.has(stop.state))
          await this.trips.walkStop(tx, stop, 'delivered', at, null)

        // the money, when the shop pays at the door
        let collection: CreateOut['collection'] = null
        let receipt: CreateOut['receipt'] = null
        if (input.collect) {
          const collected = await this.collections.collectInTx(tx, trip, {
            id: input.collect.id,
            receiptId: input.collect.receiptId,
            idempotencyKey: input.idempotencyKey,
            retailerId: retailer.id,
            stopId: stop.id,
            mode: input.collect.mode,
            amountPaise: input.collect.amountPaise,
            reference: input.collect.reference,
            upiVpa: input.collect.upiVpa,
            chequeDate: input.collect.chequeDate,
            bankName: input.collect.bankName,
            clientReceiptNo: input.collect.clientReceiptNo,
            allocations: [
              {
                id: deterministicLineId(input.collect.receiptId, invoice.id),
                invoiceId: invoice.id,
                amountPaise: Math.min(input.collect.amountPaise, invoice.totalPaise),
              },
            ],
            deviceId: input.deviceId,
          })
          collection = collected.item
          receipt = collected.receipt
        }

        await emitDeliveryEvent(tx, 'delivery', deliveryRow.id, 'VanSaleInvoiced', {
          orderId: draft.id,
          invoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          tripId: trip.id,
          retailerId: retailer.id,
          totalPaise: invoice.totalPaise,
        })
        const order = await this.orders.findOrder(tx, draft.id)
        const [delivery] = await mapDeliveries(tx, [deliveryRow], this.trips.deps())
        if (!order || !delivery)
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'van sale rows vanished' })
        return {
          order: await this.orders.detail(tx, order),
          invoice: await this.billing.detail(tx, invoiceRow),
          delivery,
          collection,
          receipt,
        }
      }),
    )
  }

  /** The stop the sale happens at: the caller's, else the shop's open stop on this trip, else a new one. */
  private async stopFor(
    tx: Db,
    tripId: string,
    stopId: string | undefined,
    retailerId: string,
  ): Promise<StopRow> {
    const stops = await stopsOf(tx, tripId)
    if (stopId) {
      const stop = stops.find((s) => s.id === stopId)
      if (!stop)
        throw new ORPCError('BAD_REQUEST', { message: `stop ${stopId} is not on trip ${tripId}` })
      if (stop.retailerId !== retailerId)
        throw new ORPCError('BAD_REQUEST', {
          message: `stop ${stopId} belongs to another shop`,
        })
      return stop
    }
    const own = stops.find((s) => s.retailerId === retailerId && s.state !== 'skipped')
    if (own) return own
    const { tenantId } = currentTenant()
    const trip = await lockTrip(tx, tripId)
    const sequence = stops.reduce((n, s) => Math.max(n, s.sequence), 0) + 1
    const [row] = await tx
      .insert(tripStops)
      .values({
        id: deterministicLineId(tripId, `van-sale-stop:${retailerId}`),
        tenantId,
        tripId,
        sequence,
        retailerId,
        state: 'pending',
        plannedCollectionPaise: 0,
      })
      .returning()
    if (!row)
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'stop insert returned nothing' })
    await tx
      .update(trips)
      .set({ plannedStops: stops.length + 1, updatedAt: new Date() })
      .where(eq(trips.id, trip.id))
    return row
  }
}
