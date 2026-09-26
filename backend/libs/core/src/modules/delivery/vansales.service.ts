import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, eq, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  CreateVanSaleInput,
  CreateVanSaleOutput,
  VanSaleStockInput,
  VanSaleStockOutput,
  VanSaleStockRow,
} from '@dos/contracts'
import {
  deliveries,
  deliveryLines,
  stockBalances,
  trips,
  tripStops,
  withTenant,
  type Db,
} from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { BillingService } from '../billing/index.js'
import { InventoryService } from '../inventory/index.js'
import { OrdersService } from '../orders/index.js'
import { CollectionsService } from './collections.service.js'
import {
  assertCrewOrDesk,
  DOORSTEP,
  emitDeliveryEvent,
  findRetailer,
  findTrip,
  loadLots,
  loadVehicle,
  lockTrip,
  stopsOf,
  vanSalesFlag,
  variantNames,
  whenOr,
  type StopRow,
} from './delivery.internals.js'
import { mapDeliveries } from './delivery.mappers.js'
import { deterministicLineId, TripsService } from './trips.service.js'

type CreateIn = z.infer<typeof CreateVanSaleInput>
type CreateOut = z.infer<typeof CreateVanSaleOutput>
type StockIn = z.infer<typeof VanSaleStockInput>
type StockOut = z.infer<typeof VanSaleStockOutput>

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
    /** Holds the other shops' billed cartons out of the sale's reach for its transaction (QA DOS-233). */
    private readonly inventory: InventoryService,
  ) {}

  /**
   * What the crew may sell here (QA DOS-233): the van's sellable pieces per lot less the pieces this trip's
   * own bills still hold on board. The screen used to list the whole van — the next shop's Bourbon and
   * cracker cartons as stock to sell — and the sale would have drawn on them.
   */
  async stock(input: StockIn): Promise<StockOut> {
    requireRole(DOORSTEP)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const trip = await findTrip(tx, input.tripId)
      assertCrewOrDesk(trip, DOORSTEP)
      const vehicle = await loadVehicle(tx, trip.vehicleId)
      const held = await this.heldForBills(tx, trip.id)
      const rows = await tx
        .select({
          lotId: stockBalances.lotId,
          onHand: stockBalances.onHand,
          reserved: stockBalances.reserved,
        })
        .from(stockBalances)
        .where(
          and(
            eq(stockBalances.locationId, vehicle.locationId),
            sql`${stockBalances.onHand} - ${stockBalances.reserved} > 0`,
          ),
        )
      const lots = await loadLots(
        tx,
        rows.map((r) => r.lotId),
      )
      const names = await variantNames(
        tx,
        [...lots.values()].map((l) => l.variantId),
      )
      const items: VanSaleStockRow[] = []
      for (const r of rows) {
        const lot = lots.get(r.lotId)
        if (!lot) continue
        const sellable = r.onHand - r.reserved
        const forBills = Math.min(sellable, held.get(r.lotId) ?? 0)
        const variant = names.get(lot.variantId)
        items.push({
          lotId: r.lotId,
          variantId: lot.variantId,
          variantName: variant?.name ?? '',
          batchNo: lot.batchNo === '' ? null : lot.batchNo,
          mrpPaise: lot.mrpPaise,
          expiryDate: lot.expiryDate,
          caseSize: lot.caseSize ?? variant?.sellCaseSize ?? null,
          availablePcs: sellable - forBills,
          heldForBillsPcs: forBills,
        })
      }
      items.sort(
        (a, b) => a.variantName.localeCompare(b.variantName) || (a.lotId < b.lotId ? -1 : 1),
      )
      return {
        items,
        vanSalesAllowed:
          trip.state === 'active' && trip.vanSalesEnabled && (await vanSalesFlag(tx)),
      }
    })
  }

  /**
   * The pieces per lot this trip's bills still have on the van: every bill planned on it that has no
   * outcome yet, and every bill that came back undelivered (it rides the van until check-in, docs/22 §4
   * D5) and has not been cancelled since. A bill handed over — in full or in part — was relieved from the
   * van at the door (QA DOS-195); what the shop sent back is free van stock again.
   */
  private async heldForBills(tx: Db, tripId: string): Promise<Map<string, number>> {
    const rows = await tx
      .select({ invoiceId: deliveries.invoiceId })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.tripId, tripId),
          or(sql`${deliveries.outcome} is null`, eq(deliveries.outcome, 'failed')),
        ),
      )
    const held = new Map<string, number>()
    for (const invoiceId of new Set(rows.map((r) => r.invoiceId))) {
      const invoice = await this.billing.invoiceForDelivery(tx, invoiceId)
      if (invoice.state === 'cancelled' || invoice.state === 'draft') continue
      for (const line of invoice.lines) {
        if (line.lotId === null) continue
        const pcs = line.qtyPcs + line.freeQtyPcs
        if (pcs > 0) held.set(line.lotId, (held.get(line.lotId) ?? 0) + pcs)
      }
    }
    return held
  }

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

        // QA DOS-233: the other shops' billed cartons ride on this van too. They are held out of the sale's
        // reach for as long as it reserves — at confirm and again at billing — so a shortage is refused
        // here rather than found at the next shop's door. Given back once the bill has taken its pieces.
        const held = await this.inventory.holdPieces(
          tx,
          vehicle.locationId,
          await this.heldForBills(tx, trip.id),
        )

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
        await this.inventory.releaseHeld(tx, vehicle.locationId, held)
        await this.orders.applyFulfilmentEvent(
          tx,
          draft.id,
          'dispatch',
          input.deviceId ?? null,
          'van sale',
        )
        const invoice = await this.billing.invoiceForDelivery(tx, invoiceRow.id)
        // QA DOS-171: a van sale is a bill at this door, so it joins what is owed here
        // (`planned_collection_paise` = the bills at the stop plus agreed old dues), which the crew's money
        // screen reads as "Owed on the bills here". An INCREMENT in SQL, never a read-then-write: the trip
        // lock above serialises van sales on one trip, `idempotent()` makes a replay add nothing, and
        // `walkStop` below never sets this column. It holds for the caller's stop, the shop's open stop and
        // a stop `stopFor` has just created at 0. Moving `updated_at` (the 0040 touch trigger does too)
        // is what puts the row into the phone's next delta pull.
        await tx
          .update(tripStops)
          .set({
            plannedCollectionPaise: sql`${tripStops.plannedCollectionPaise} + ${invoice.totalPaise}`,
            updatedAt: new Date(),
          })
          .where(and(eq(tripStops.tenantId, ctx.tenantId), eq(tripStops.id, stop.id)))
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
        // A shop already visited keeps its stop state; a fresh stop lands on `delivered`; a stop whose
        // planned bills are still on the van stays open for them (QA DOS-232).
        await this.trips.settleStopAfterBill(tx, stop, at)

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
