import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  CancelLoadSheetInput,
  CancelLoadSheetOutput,
  ChallanGetInput,
  ChallanGetOutput,
  ChallansListInput,
  ChallansListOutput,
  ConfirmLoadSheetInput,
  ConfirmLoadSheetOutput,
  CreateLoadSheetInput,
  CreateLoadSheetOutput,
  LoadSheetGetInput,
  LoadSheetGetOutput,
  LoadSheetsListInput,
  LoadSheetsListOutput,
  RecordEwbInput,
  RecordEwbOutput,
  SellerBranding,
} from '@dos/contracts'
import { businessDate, financialYear } from '@dos/domain'
import { deliveryChallans, loadSheets, packConfirmations, withTenant, type Db } from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  nextDocumentNumber,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { BillingService, sellerBranding } from '../billing/index.js'
import { InventoryService } from '../inventory/index.js'
import { OrdersService } from '../orders/index.js'
import {
  activeWarehouseLocation,
  DC_SERIES,
  emitWarehouseEvent,
  ewbThresholdPaise,
  FULFILMENT_READERS,
  gstOn,
  isUniqueViolation,
  loadGstBps,
  loadLots,
  loadVariantInfo,
  PIN_HOLDERS,
  vehicleLocation,
  vehicleRegNos,
  WAREHOUSE_DESK,
  writeAudit,
} from './warehouse.internals.js'
import {
  challanDetail,
  loadSheetDetail,
  loadSheetLots,
  toChallanSummary,
  toLoadSheetSummary,
  type ChallanRow,
  type LoadSheetDeps,
  type LoadSheetRow,
} from './warehouse.mappers.js'

type CreateIn = z.infer<typeof CreateLoadSheetInput>
type CreateOut = z.infer<typeof CreateLoadSheetOutput>
type ListIn = z.infer<typeof LoadSheetsListInput>
type ListOut = z.infer<typeof LoadSheetsListOutput>
type GetIn = z.infer<typeof LoadSheetGetInput>
type GetOut = z.infer<typeof LoadSheetGetOutput>
type ConfirmIn = z.infer<typeof ConfirmLoadSheetInput>
type ConfirmOut = z.infer<typeof ConfirmLoadSheetOutput>
type CancelIn = z.infer<typeof CancelLoadSheetInput>
type CancelOut = z.infer<typeof CancelLoadSheetOutput>
type ChallansIn = z.infer<typeof ChallansListInput>
type ChallansOut = z.infer<typeof ChallansListOutput>
type ChallanIn = z.infer<typeof ChallanGetInput>
type ChallanOut = z.infer<typeof ChallanGetOutput>
type EwbIn = z.infer<typeof RecordEwbInput>
type EwbOut = z.infer<typeof RecordEwbOutput>

/** What DELIVERY needs to know about a load without reading warehouse's tables (coordination §4). */
export interface ConfirmedLoad {
  id: string
  tripId: string | null
  sheetDate: string
  fromLocationId: string
  /** The vehicle location the stock is now sitting at — the crew sells and delivers out of it. */
  toLocationId: string
  orderIds: string[]
  vanStock: { lotId: string; qtyPcs: number }[]
  expectedPackages: number
  countedPackages: number | null
  loadValuePaise: number
  challanNo: string | null
  ewbNo: string | null
  confirmedAt: string | null
}

/**
 * The load-out: what goes onto a vehicle, the blind package count at the gate, the godown → vehicle
 * stock movement, the Rule 55 delivery challan and the order's `packed → dispatched` step.
 *
 * WAREHOUSE DISPATCHES, NOT DELIVERY (coordination §5 item 4). The goods physically leave here, with a
 * numbered challan; `delivery.trips.depart` moves the trip and treats an already-dispatched order as a
 * no-op. And godown → vehicle is `transfer_out` + `transfer_in` (§5 item 5), keyed
 * `load:<sheetId>:<lotId>:out|in`, so a retried confirm moves nothing twice; `van_load` / `van_unload`
 * belong to delivery's on-route movements.
 */
@Injectable()
export class LoadSheetsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly billing: BillingService,
  ) {}

  // -------------------------------------------------------------------------------------------------------------
  // building the sheet

  /**
   * Builds the sheet WITHOUT moving anything. Every order must be packed and have a pack confirmation
   * (so an invoice exists, or has been deliberately deferred) and must not already be on a live sheet.
   * The orders stay IN THE ORDER THE CALLER SUPPLIED — last stop loaded first is the app's job, because
   * reading `trip_stops` would make the godown depend on the delivery module (coordination §4 item 3).
   */
  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const orderIds = [...new Set(input.orderIds)]
        const vehicle = await vehicleLocation(tx, input.toLocationId)
        const fromLocationId = input.fromLocationId ?? (await activeWarehouseLocation(tx))
        if (fromLocationId === vehicle.id)
          throw new ORPCError('BAD_REQUEST', {
            message: 'a load sheet moves stock between two different locations',
          })
        if (orderIds.length === 0 && input.vanStock.length === 0)
          throw new ORPCError('BAD_REQUEST', {
            message: 'a load sheet needs at least one packed order or some van stock',
          })

        const orders = await this.orders.fulfilmentOrders(tx, orderIds)
        const byOrder = new Map(orders.map((o) => [o.orderId, o]))
        const notPacked = orderIds.filter((id) => byOrder.get(id)?.state !== 'packed')
        if (notPacked.length > 0)
          throw new ORPCError('CONFLICT', {
            message: `only a packed order can be loaded; not packed: ${notPacked.join(', ')}`,
          })
        const packs =
          orderIds.length === 0
            ? []
            : await tx
                .select()
                .from(packConfirmations)
                .where(inArray(packConfirmations.orderId, orderIds))
        const packByOrder = new Map(packs.map((p) => [p.orderId, p]))
        const unconfirmed = orderIds.filter((id) => !packByOrder.has(id))
        if (unconfirmed.length > 0)
          throw new ORPCError('CONFLICT', {
            message: `these orders have no pack confirmation: ${unconfirmed.join(', ')}`,
          })
        const clash = await this.onALiveSheet(tx, orderIds)
        if (clash.size > 0)
          throw new ORPCError('CONFLICT', {
            message: `order(s) already on load sheet ${[...new Set(clash.values())].join(', ')}`,
          })

        const invoices = await this.billing.invoiceRefs(
          tx,
          packs.map((p) => p.invoiceId).filter((id): id is string => id !== null),
        )
        const vanStock = await this.valueVanStock(tx, input.vanStock)
        const loadValuePaise =
          [...invoices.values()].reduce((n, i) => n + i.totalPaise, 0) + vanStock.valuePaise
        const threshold = await ewbThresholdPaise(tx)

        const row = await this.insertSheet(tx, {
          id: input.id,
          tripId: input.tripId ?? null,
          sheetDate: input.sheetDate ?? businessDate().date,
          fromLocationId,
          toLocationId: vehicle.id,
          orderIds,
          vanStock: input.vanStock.map((v) => ({ lotId: v.lotId, qtyPcs: v.qtyPcs })),
          expectedPackages: packs.reduce((n, p) => n + p.packages, 0),
          loadValuePaise,
          ewbRequired: loadValuePaise >= threshold,
        })
        return { item: await loadSheetDetail(tx, row, this.deps()) }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(FULFILMENT_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.status ? eq(loadSheets.status, input.status) : undefined,
        input.tripId ? eq(loadSheets.tripId, input.tripId) : undefined,
        input.toLocationId ? eq(loadSheets.toLocationId, input.toLocationId) : undefined,
        input.from ? gte(loadSheets.sheetDate, input.from) : undefined,
        input.to ? lte(loadSheets.sheetDate, input.to) : undefined,
        input.cursor ? lt(loadSheets.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(loadSheets)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(loadSheets.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const regNos = await vehicleRegNos(
        tx,
        page.map((r) => r.toLocationId),
      )
      const last = page[page.length - 1]
      return {
        items: page.map((r) =>
          toLoadSheetSummary(r, regNos.get(r.toLocationId) ?? null, r.orderIds.length),
        ),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(FULFILMENT_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => ({
      item: await loadSheetDetail(tx, await this.findSheet(tx, input.id), this.deps()),
    }))
  }

  // -------------------------------------------------------------------------------------------------------------
  // check-out

  /**
   * The gate. In one transaction: the e-way-bill gate, the crew's blind package count, the van stock
   * replaced by what was actually counted, the `transfer_out`/`transfer_in` pair per lot, the `DC`
   * challan, and every packed order `packed → dispatched`.
   *
   * The manager's PIN is exactly "the caller holds an owner/manager token" (coordination §7 q15); a
   * count that differs from the expectation needs a written reason and records who accepted it. Never
   * auto-accept a variance: the count is the last chance to notice a carton left on the dock.
   */
  async confirm(input: ConfirmIn): Promise<ConfirmOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const sheet = await this.lockSheet(tx, input.id)
        if (sheet.status !== 'draft')
          throw new ORPCError('CONFLICT', {
            message: `load sheet ${sheet.id} is ${sheet.status}; only a draft is checked out`,
          })
        const ewbNo = input.ewbNo ?? sheet.ewbNo
        if (sheet.ewbRequired && !ewbNo)
          throw new ORPCError('BAD_REQUEST', {
            message: `this load is worth ${sheet.loadValuePaise ?? 0} paise and needs an e-way bill number before it leaves`,
            data: { code: 'ewb_required', loadValuePaise: sheet.loadValuePaise ?? 0 },
          })
        if (input.countedPackages !== sheet.expectedPackages && !input.varianceNote)
          throw new ORPCError('BAD_REQUEST', {
            message: `${sheet.expectedPackages} packages were expected and ${input.countedPackages} counted; a variance needs a note`,
            data: {
              code: 'package_variance',
              expected: sheet.expectedPackages,
              counted: input.countedPackages,
            },
          })

        const now = new Date()
        const challanDate = businessDate(now).date
        const vanStock = await this.valueVanStock(tx, input.countedVanStock)
        const counted: LoadSheetRow = {
          ...sheet,
          vanStock: input.countedVanStock.map((v) => ({ lotId: v.lotId, qtyPcs: v.qtyPcs })),
        }
        const lots = await loadSheetLots(tx, counted)
        if (lots.length === 0)
          throw new ORPCError('BAD_REQUEST', {
            message: 'nothing on this sheet has left the rack yet; pack the orders first',
          })

        // Godown → vehicle, keyed per lot and per direction, so a retry is a no-op on the ledger's
        // UNIQUE(tenant_id, idempotency_key) even if this transaction is replayed a dozen times.
        await this.inventory.post(
          tx,
          lots.flatMap((lot) => [
            {
              lotId: lot.lotId,
              locationId: sheet.fromLocationId,
              qtyDelta: -lot.qtyPcs,
              reason: 'transfer_out' as const,
              refType: 'load_sheet',
              refId: sheet.id,
              idempotencyKey: `load:${sheet.id}:${lot.lotId}:out`,
            },
            {
              lotId: lot.lotId,
              locationId: sheet.toLocationId,
              qtyDelta: lot.qtyPcs,
              reason: 'transfer_in' as const,
              refType: 'load_sheet',
              refId: sheet.id,
              idempotencyKey: `load:${sheet.id}:${lot.lotId}:in`,
            },
          ]),
        )

        const vehicle = await vehicleRegNos(tx, [sheet.toLocationId])
        const challan = await this.issueChallan(tx, {
          id: input.challanId,
          sheet,
          challanDate,
          lots,
          vehicleNo: vehicle.get(sheet.toLocationId) ?? null,
          ewbNo: ewbNo ?? null,
          now,
        })

        const dispatched: string[] = []
        for (const orderId of sheet.orderIds) {
          await this.orders.applyFulfilmentEvent(
            tx,
            orderId,
            'dispatch',
            input.deviceId ?? null,
            null,
          )
          dispatched.push(orderId)
        }

        // The declared value follows the COUNTED van stock, not what the sheet was drafted with: the
        // crew may have loaded four cases where the desk planned five.
        const drafted = await this.valueVanStock(tx, sheet.vanStock)
        const confirmed = await this.updateSheet(tx, sheet.id, {
          status: 'confirmed',
          vanStock: counted.vanStock,
          countedPackages: input.countedPackages,
          varianceNote: input.varianceNote ?? null,
          pinVerifiedBy:
            input.countedPackages === sheet.expectedPackages ? sheet.pinVerifiedBy : ctx.actorId,
          loadValuePaise: (sheet.loadValuePaise ?? 0) - drafted.valuePaise + vanStock.valuePaise,
          ewbNo: ewbNo ?? null,
          challanNo: challan.challanNo,
          confirmedBy: ctx.actorId,
          confirmedAt: now,
        })

        await emitWarehouseEvent(tx, 'load_sheet', confirmed.id, 'LoadSheetConfirmed', {
          loadSheetId: confirmed.id,
          tripId: confirmed.tripId,
          vehicleLocationId: confirmed.toLocationId,
          orderIds: confirmed.orderIds,
          challanId: challan.id,
          challanNo: challan.challanNo,
          loadValuePaise: confirmed.loadValuePaise ?? 0,
        })
        await emitWarehouseEvent(tx, 'delivery_challan', challan.id, 'DeliveryChallanIssued', {
          challanId: challan.id,
          challanNo: challan.challanNo,
          loadSheetId: confirmed.id,
          valuePaise: challan.valuePaise,
          ewbNo: challan.ewbNo,
        })

        return {
          item: await loadSheetDetail(tx, confirmed, this.deps()),
          challan: await challanDetail(tx, challan, this.seller),
          dispatched,
        }
      }),
    )
  }

  /**
   * Only while the sheet is a draft. Once it is confirmed the stock has moved and a numbered challan
   * exists; the correction is a return leg in the delivery module, never a cancellation here.
   */
  async cancel(input: CancelIn): Promise<CancelOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const sheet = await this.lockSheet(tx, input.id)
        if (sheet.status === 'cancelled')
          return { item: await loadSheetDetail(tx, sheet, this.deps()) }
        if (sheet.status !== 'draft')
          throw new ORPCError('CONFLICT', {
            message: `load sheet ${sheet.id} is ${sheet.status}; the goods have left with challan ${sheet.challanNo ?? '(none)'} and come back through delivery, not here`,
          })
        const cancelled = await this.updateSheet(tx, sheet.id, {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: input.reason,
        })
        return { item: await loadSheetDetail(tx, cancelled, this.deps()) }
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // challans

  async listChallans(input: ChallansIn): Promise<ChallansOut> {
    requireRole(FULFILMENT_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.from ? gte(deliveryChallans.challanDate, input.from) : undefined,
        input.to ? lte(deliveryChallans.challanDate, input.to) : undefined,
        input.loadSheetId ? eq(deliveryChallans.loadSheetId, input.loadSheetId) : undefined,
        input.cursor ? lt(deliveryChallans.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(deliveryChallans)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(deliveryChallans.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const last = page[page.length - 1]
      return {
        items: page.map(toChallanSummary),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  async getChallan(input: ChallanIn): Promise<ChallanOut> {
    requireRole(FULFILMENT_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => ({
      item: await challanDetail(tx, await this.findChallan(tx, input.id), this.seller),
    }))
  }

  /**
   * The pilot path for the e-way bill: the manager generates it on the government portal and types the
   * number back. 409 once one is recorded — a wrong number is cancelled on the portal and a fresh
   * challan issued, never overwritten here, because the number filed with the government must match
   * the paper the driver is carrying.
   */
  async recordEwb(input: EwbIn): Promise<EwbOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const challan = await this.findChallan(tx, input.id)
        if (challan.ewbNo !== null)
          throw new ORPCError('CONFLICT', {
            message: `challan ${challan.challanNo ?? challan.id} already carries e-way bill ${challan.ewbNo}`,
          })
        const [updated] = await tx
          .update(deliveryChallans)
          .set({ ewbNo: input.ewbNo })
          .where(eq(deliveryChallans.id, challan.id))
          .returning()
        if (challan.loadSheetId !== null)
          await tx
            .update(loadSheets)
            .set({ ewbNo: input.ewbNo, updatedAt: new Date() })
            .where(eq(loadSheets.id, challan.loadSheetId))
        await writeAudit(tx, {
          action: 'warehouse.challans.recordEwb',
          entityType: 'delivery_challan',
          entityId: challan.id,
          after: { ewbNo: input.ewbNo, loadSheetId: challan.loadSheetId },
        })
        return { item: await challanDetail(tx, updated ?? challan, this.seller) }
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // what delivery imports (coordination §4)

  /**
   * The confirmed loads of a trip — read-only, and the ONLY thing delivery asks the warehouse. It is
   * how `delivery.trips.depart` answers "is the load actually out of the godown" without reading
   * `load_sheets` itself, and where the crew's van stock comes from.
   */
  async confirmedForTrip(tx: Db, tripId: string): Promise<ConfirmedLoad[]> {
    const { tenantId } = currentTenant()
    const rows = await tx
      .select()
      .from(loadSheets)
      .where(
        and(
          eq(loadSheets.tenantId, tenantId),
          eq(loadSheets.tripId, tripId),
          eq(loadSheets.status, 'confirmed'),
        ),
      )
      .orderBy(loadSheets.id)
    return rows.map((r) => ({
      id: r.id,
      tripId: r.tripId,
      sheetDate: r.sheetDate,
      fromLocationId: r.fromLocationId,
      toLocationId: r.toLocationId,
      orderIds: r.orderIds,
      vanStock: r.vanStock,
      expectedPackages: r.expectedPackages,
      countedPackages: r.countedPackages,
      loadValuePaise: r.loadValuePaise ?? 0,
      challanNo: r.challanNo,
      ewbNo: r.ewbNo,
      confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    }))
  }

  // -------------------------------------------------------------------------------------------------------------

  private readonly seller = (tx: Db): Promise<SellerBranding> => sellerBranding(tx)

  private deps(): LoadSheetDeps {
    return {
      orders: this.orders,
      invoiceRefs: (tx, ids) => this.billing.invoiceRefs(tx, ids),
      seller: this.seller,
    }
  }

  /**
   * The Rule 55 challan. Each line is DECLARED at the lot's MRP × pieces (warehouse §8.3 — no invoice
   * exists for van stock, and one consistent basis across both sources is what a printed declaration
   * needs), with the GST rate that applied to its HSN on the challan date beside it. `value_paise` is
   * the sheet's own load value — Σ invoice totals plus the van stock — because that is the number the
   * e-way-bill threshold was tested against.
   */
  private async issueChallan(
    tx: Db,
    i: {
      id: string
      sheet: LoadSheetRow
      challanDate: string
      lots: { lotId: string; variantId: string; qtyPcs: number }[]
      vehicleNo: string | null
      ewbNo: string | null
      now: Date
    },
  ): Promise<ChallanRow> {
    const { tenantId, actorId } = currentTenant()
    const lots = await loadLots(
      tx,
      i.lots.map((l) => l.lotId),
    )
    const variants = await loadVariantInfo(
      tx,
      i.lots.map((l) => l.variantId),
    )
    const rates = await loadGstBps(
      tx,
      [...variants.values()].map((v) => v.hsnCode),
      i.challanDate,
    )
    let gstPaise = 0
    const lines = i.lots.map((lot) => {
      const taxableValuePaise = (lots.get(lot.lotId)?.mrpPaise ?? 0) * lot.qtyPcs
      const gstBps = rates.get(variants.get(lot.variantId)?.hsnCode ?? '') ?? 0
      gstPaise += gstOn(taxableValuePaise, gstBps)
      return {
        variantId: lot.variantId,
        lotId: lot.lotId,
        qtyPcs: lot.qtyPcs,
        taxableValuePaise,
        gstBps,
      }
    })
    try {
      const [row] = await tx
        .insert(deliveryChallans)
        .values({
          id: i.id,
          tenantId,
          seriesCode: DC_SERIES,
          challanNo: await nextDocumentNumber(tx, DC_SERIES, i.now),
          fy: financialYear(i.now),
          challanDate: i.challanDate,
          loadSheetId: i.sheet.id,
          fromLocationId: i.sheet.fromLocationId,
          toLocationId: i.sheet.toLocationId,
          vehicleNo: i.vehicleNo,
          lines,
          valuePaise: i.sheet.loadValuePaise ?? 0,
          loadValueGstPaise: gstPaise,
          ewbNo: i.ewbNo,
          issuedBy: actorId,
          issuedAt: i.now,
        })
        .returning()
      if (!row)
        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'challan insert returned nothing' })
      return row
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ORPCError('CONFLICT', {
          message: `challan ${i.id} already exists; generate a new id for this load-out`,
        })
      throw err
    }
  }

  /** Van stock is declared at the lot's MRP (warehouse §8.3); a lot nobody has is a 400, not a zero. */
  private async valueVanStock(
    tx: Db,
    vanStock: readonly { lotId: string; qtyPcs: number }[],
  ): Promise<{ valuePaise: number }> {
    if (vanStock.length === 0) return { valuePaise: 0 }
    const lots = await loadLots(
      tx,
      vanStock.map((v) => v.lotId),
    )
    let valuePaise = 0
    for (const van of vanStock) {
      const lot = lots.get(van.lotId)
      if (!lot) throw new ORPCError('NOT_FOUND', { message: `lot ${van.lotId} not found` })
      valuePaise += lot.mrpPaise * van.qtyPcs
    }
    return { valuePaise }
  }

  /** Which live sheet each of these orders is already on. A confirmed sheet counts: the goods left. */
  private async onALiveSheet(tx: Db, orderIds: readonly string[]): Promise<Map<string, string>> {
    if (orderIds.length === 0) return new Map()
    const { tenantId } = currentTenant()
    const rows = await tx.execute(sql`
      select ls.id, o.value as order_id
        from load_sheets ls, jsonb_array_elements_text(ls.order_ids) o
       where ls.tenant_id = ${tenantId} and ls.status <> 'cancelled'
         and o.value in (${sql.join(
           orderIds.map((id) => sql`${id}`),
           sql`, `,
         )})`)
    return new Map((rows.rows as { id: string; order_id: string }[]).map((r) => [r.order_id, r.id]))
  }

  private async findSheet(tx: Db, id: string): Promise<LoadSheetRow> {
    const [row] = await tx.select().from(loadSheets).where(eq(loadSheets.id, id))
    if (!row) throw new ORPCError('NOT_FOUND', { message: `load sheet ${id} not found` })
    return row
  }

  private async lockSheet(tx: Db, id: string): Promise<LoadSheetRow> {
    const [row] = await tx.select().from(loadSheets).where(eq(loadSheets.id, id)).for('update')
    if (!row) throw new ORPCError('NOT_FOUND', { message: `load sheet ${id} not found` })
    return row
  }

  private async findChallan(tx: Db, id: string): Promise<ChallanRow> {
    const [row] = await tx.select().from(deliveryChallans).where(eq(deliveryChallans.id, id))
    if (!row) throw new ORPCError('NOT_FOUND', { message: `delivery challan ${id} not found` })
    return row
  }

  private async insertSheet(
    tx: Db,
    values: {
      id: string
      tripId: string | null
      sheetDate: string
      fromLocationId: string
      toLocationId: string
      orderIds: string[]
      vanStock: { lotId: string; qtyPcs: number }[]
      expectedPackages: number
      loadValuePaise: number
      ewbRequired: boolean
    },
  ): Promise<LoadSheetRow> {
    const { tenantId } = currentTenant()
    try {
      const [row] = await tx
        .insert(loadSheets)
        .values({ ...values, tenantId, status: 'draft' })
        .returning()
      if (!row)
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'load sheet insert returned nothing',
        })
      return row
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ORPCError('CONFLICT', {
          message: `load sheet ${values.id} already exists; generate a new id`,
        })
      throw err
    }
  }

  private async updateSheet(
    tx: Db,
    id: string,
    values: Partial<typeof loadSheets.$inferInsert>,
  ): Promise<LoadSheetRow> {
    const [row] = await tx
      .update(loadSheets)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(loadSheets.id, id))
      .returning()
    if (!row) throw new ORPCError('NOT_FOUND', { message: `load sheet ${id} not found` })
    return row
  }
}
