import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ApproveLoadSheetInput,
  ApproveLoadSheetOutput,
  CancelLoadSheetInput,
  CancelLoadSheetOutput,
  ChallanGetInput,
  ChallanGetOutput,
  ChallanPdfInput,
  ChallanPdfOutput,
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
  StageDockInput,
  StageDockOutput,
} from '@dos/contracts'
import { businessDate, financialYear } from '@dos/domain'
import { deliveryChallans, loadSheets, packConfirmations, withTenant, type Db } from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  documentRender,
  idempotent,
  isCheckViolation,
  isPrivilegeViolation,
  nextDocumentNumber,
  pgMessage,
  requestDocumentRender,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { istDateWord, istMoment, personWord } from '../../platform/refusal-words.js'
import { BillingService, sellerBranding } from '../billing/index.js'
import {
  coverFromDock,
  dockLocationId,
  InventoryService,
  type DockClaim,
  type DockCover,
  type DockHoldInput,
} from '../inventory/index.js'
import { OrdersService } from '../orders/index.js'
import { userLabels } from '../tenancy/index.js'
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
  placeOf,
  vehicleLocation,
  vehicleRegNos,
  WAREHOUSE_DESK,
  writeAudit,
} from './warehouse.internals.js'
import { sourceRefusal } from './stock-guards.js'
import {
  challanDetail,
  loadSheetDetail,
  loadSheetLots,
  packedLotsByOrder,
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
type ApproveIn = z.infer<typeof ApproveLoadSheetInput>
type ApproveOut = z.infer<typeof ApproveLoadSheetOutput>
type ChallanPdfIn = z.infer<typeof ChallanPdfInput>
type ChallanPdfOut = z.infer<typeof ChallanPdfOutput>
type ConfirmIn = z.infer<typeof ConfirmLoadSheetInput>
type ConfirmOut = z.infer<typeof ConfirmLoadSheetOutput>
type CancelIn = z.infer<typeof CancelLoadSheetInput>
type CancelOut = z.infer<typeof CancelLoadSheetOutput>
type StageDockIn = z.infer<typeof StageDockInput>
type StageDockOut = z.infer<typeof StageDockOutput>
type ChallansIn = z.infer<typeof ChallansListInput>
type ChallansOut = z.infer<typeof ChallansListOutput>
type ChallanIn = z.infer<typeof ChallanGetInput>
type ChallanOut = z.infer<typeof ChallanGetOutput>
type EwbIn = z.infer<typeof RecordEwbInput>
type EwbOut = z.infer<typeof RecordEwbOutput>

/** One bill's cover on the dock for one lot, with the words a refusal names it by (QA DOS-247). */
interface BillCover extends DockCover {
  orderId: string
  orderNo: string | null
  invoiceNo: string | null
  retailerName: string
  variantId: string
  /** The item and its batch: "Annapurna Toor Dal 1 kg (batch B20260909)". */
  label: string
}

/** "INV/9034 · Ekta General Stores": how the godown and the desk name a bill on a refusal. */
function billWords(c: {
  invoiceNo: string | null
  orderNo: string | null
  retailerName: string
}): string {
  const bill = c.invoiceNo ?? c.orderNo ?? 'the bill'
  return c.retailerName === '' ? bill : `${bill} · ${c.retailerName}`
}

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
 * "Which of these bills came back undelivered and still ride a van that has not checked in", as invoice id
 * → that trip (QA DOS-172). Delivery owns trips and deliveries, so it supplies the answer at start-up
 * (`DeliveryModule.onModuleInit` → `registerRoadHold`) and no SQL in warehouse names those tables.
 */
export type RoadHoldLookup = (
  tx: Db,
  invoiceIds: readonly string[],
) => Promise<Map<string, { tripId: string; tripNo: string | null }>>

/** A trip as the load-out names it: number, state and the vehicle location its load goes to (QA DOS-354). */
export interface LoadingTrip {
  tripId: string
  tripNo: string | null
  state: string
  vehicleLocationId: string | null
  vehicle: string | null
}

/**
 * "Which trip carries each of these bills" and "this trip, as the load-out needs it" (QA DOS-354 verify,
 * architect ruling 8). Delivery owns trips and their planned deliveries, so it supplies both at start-up
 * (`DeliveryModule.onModuleInit` → `registerTripCarriage`), the `registerRoadHold` pattern.
 */
export interface TripCarriage {
  /** Invoice id → the not-settled, not-cancelled trip holding an outcome-null delivery of it. */
  bills(tx: Db, invoiceIds: readonly string[]): Promise<Map<string, LoadingTrip>>
  /** One trip, or null; `lock` takes it `FOR UPDATE`. */
  trip(tx: Db, tripId: string, opts: { lock: boolean }): Promise<LoadingTrip | null>
  /**
   * The trip that holds the van at `vehicleLocationId` — on the road, checked in and not settled, or already
   * loaded — other than `exceptTripId`, or null when the van is free (vans and trips 1).
   */
  vanHolder(
    tx: Db,
    vehicleLocationId: string,
    exceptTripId: string | null,
  ): Promise<VanHolder | null>
}

/** A trip that holds a van (vans and trips 1), with the words a refusal names it by. */
export interface VanHolder {
  tripId: string
  tripNo: string | null
  state: string
  /** The registration plate. */
  vehicle: string | null
  /** "out on the road on trip TRIP-0003" */
  words: string
  /** What has to happen first: "check trip TRIP-0003 in and settle it". */
  first: string
}

/** How a refusal names a trip's state: "out on the road", "checked in", … */
const TRIP_STATE_WORDS: Record<string, string> = {
  closing: 'checked in',
  settled: 'settled',
  settled_with_variance: 'settled',
  cancelled: 'cancelled',
}

/**
 * The load-out: what goes onto a vehicle, the blind package count at the gate, the godown → vehicle
 * movement of the counted van stock, the Rule 55 delivery challan and the order's `packed → dispatched`
 * step.
 *
 * WAREHOUSE DISPATCHES, NOT DELIVERY (coordination §5 item 4). The goods physically leave here, with a
 * numbered challan, and nowhere else: `delivery.trips.depart` moves the trip, passes an already-dispatched
 * order and refuses one still packed (QA DOS-172).
 *
 * ONLY A DRAFT SHEET HOLDS AN ORDER (QA DOS-172). A confirmed sheet and its challan are the record of one
 * load-out and are never edited: a bill that came back undelivered is loaded again on a fresh sheet once
 * its trip has checked in, and until then `heldOnTheRoad` keeps it off every sheet and off W7's list.
 *
 * STOCK LEAVES THE GODOWN ONCE (QA DOS-039), AND IT LANDS ON THE VAN (QA DOS-195). The packed orders'
 * pieces already left the rack at pack — `PackingService` moves them onto the DOCK (the tenant's
 * in-transit location), not out of existence — so this never relieves the godown for them a second time.
 * What the confirm does add is the second half of their journey: dock → vehicle, so the goods a crew is
 * about to carry are standing in the vehicle's own location while they ride. Two `transfer_out` +
 * `transfer_in` pairs are posted, both idempotent on the sheet:
 *
 *   * the counted VAN STOCK (free pieces for van sales) godown → vehicle, keyed `load:<sheetId>:<lotId>:out|in`;
 *   * the PACKED ORDERS' lots dock → vehicle, keyed `load:<sheetId>:<lotId>:pack:out|in`.
 *
 * A retried confirm moves nothing twice; `van_load` / `van_unload` belong to delivery's on-route
 * movements, and the vehicle is relieved at the door (`deliveries.record`) or counted back at the
 * check-in (`delivery.settlement`).
 */
@Injectable()
export class LoadSheetsService {
  /** A warehouse with no delivery module has no road, so nothing is held until delivery says otherwise. */
  private roadHold: RoadHoldLookup = () =>
    Promise.resolve(new Map<string, { tripId: string; tripNo: string | null }>())

  /**
   * A warehouse with no delivery module has no trips, so no sheet is held to one until delivery says otherwise.
   * Every service that serves load sheets mounts delivery (pinned by `service/definitions.test.ts`).
   */
  private carriage: TripCarriage | null = null

  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
    private readonly billing: BillingService,
  ) {}

  /**
   * Delivery supplies "which bills still ride a van that has not checked in" at start-up
   * (`DeliveryModule.onModuleInit`, QA DOS-172), the DOS-132 `registerTripPredicates` pattern. Every service
   * that serves load sheets mounts delivery (pinned by `service/definitions.test.ts`), because the empty
   * default would offer a held bill silently.
   */
  registerRoadHold(lookup: RoadHoldLookup): void {
    this.roadHold = lookup
  }

  /** Delivery supplies which trip carries a bill, and the trip itself, at start-up (QA DOS-354 verify). */
  registerTripCarriage(carriage: TripCarriage): void {
    this.carriage = carriage
  }

  /**
   * The bills of `invoiceIds` that came back undelivered and are still out on a trip, as invoice id → that
   * trip (QA DOS-172). `create` refuses them 409 `bill_on_road` and `packs.list?status=awaiting_load` leaves
   * them out; the hold ends when the trip checks in (`trips.return`). Runs inside the caller's transaction.
   */
  heldOnTheRoad(
    tx: Db,
    invoiceIds: readonly string[],
  ): Promise<Map<string, { tripId: string; tripNo: string | null }>> {
    if (invoiceIds.length === 0)
      return Promise.resolve(new Map<string, { tripId: string; tripNo: string | null }>())
    return this.roadHold(tx, invoiceIds)
  }

  // -------------------------------------------------------------------------------------------------------------
  // building the sheet

  /**
   * Builds the sheet WITHOUT moving anything. Every order must be packed and have a pack confirmation
   * (so an invoice exists, or has been deliberately deferred), must not already be on a DRAFT sheet, and
   * its bill must not still ride a van that has not checked in (409 `bill_on_road`, QA DOS-172).
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
        // Ruling 6 and vans and trips 1: a sheet is never drawn from the bin, the dock or a shop's floor, nor from a
        // van another trip holds — refused when it is made, not only at the gate.
        await this.assertLoadSource(tx, fromLocationId)
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
        // QA DOS-355 (architect ruling 8): a pack without a bill is not loaded.
        await this.assertEveryPackBilled(tx, orderIds, packs, byOrder)
        const clash = await this.onADraftSheet(tx, orderIds)
        if (clash.size > 0)
          throw new ORPCError('CONFLICT', {
            message: `order(s) already on load sheet ${[...new Set(clash.values())].join(', ')}`,
          })
        // QA DOS-172: a bill that came back undelivered rides its van until that trip checks in. Asked of
        // delivery through the registered lookup; `confirm` needs no second check, because a held bill can
        // never reach a draft.
        const invoiceOf = new Map(packs.map((p) => [p.orderId, p.invoiceId]))
        const onTheRoad = await this.heldOnTheRoad(
          tx,
          packs.map((p) => p.invoiceId).filter((id): id is string => id !== null),
        )
        const held = orderIds.flatMap((orderId) => {
          const invoiceId = invoiceOf.get(orderId)
          const trip = invoiceId ? onTheRoad.get(invoiceId) : undefined
          return trip ? [{ orderId, trip }] : []
        })
        if (held.length > 0)
          throw new ORPCError('CONFLICT', {
            message: `order(s) ${held.map((h) => byOrder.get(h.orderId)?.orderNo ?? h.orderId).join(', ')} came back undelivered and are still out on trip ${[...new Set(held.map((h) => h.trip.tripNo ?? h.trip.tripId))].join(', ')}; load them after that trip checks in`,
            data: {
              code: 'bill_on_road',
              orderIds: held.map((h) => h.orderId),
              tripIds: [...new Set(held.map((h) => h.trip.tripId))],
            },
          })
        // QA DOS-354 (verify): a bill is loaded only onto the trip that carries it. A sheet that names no trip
        // is the trip's its bills all ride; one that names a trip takes only that trip's bills.
        const tripId = await this.tripThatCarries(
          tx,
          { tripId: input.tripId ?? null, toLocationId: vehicle.id, orderIds },
          invoiceOf,
          byOrder,
          { lock: false },
        )

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
          tripId,
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
   * THE MANAGER'S PIN, given from the manager app (docs/22 decision 2026-09-05, warehouse.ts fact 2b):
   * an owner or manager marks a draft sheet approved — `approved_by` is the approver's own actor id
   * and `approved_at` the moment — so the warehouse phone may then confirm it. The database guard
   * (`dos_load_sheet_approval_guard`, 0013) refuses any other role and any other id; a second approval
   * of an approved sheet is 409 `already_approved`; a cancelled sheet cannot be approved. Audited.
   */
  async approve(input: ApproveIn): Promise<ApproveOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const sheet = await this.lockSheet(tx, input.id)
        if (sheet.status !== 'draft')
          throw new ORPCError('CONFLICT', {
            message: `${await this.sheetWords(tx, sheet)} is ${sheet.status}; only a draft is approved`,
          })
        if (sheet.approvedBy !== null)
          throw new ORPCError('CONFLICT', {
            // A second desk pressing Approve is told which van's sheet and whose approval, in IST (DOS-141).
            message: `${await this.sheetWords(tx, sheet)} was already approved by ${personWord(
              (await userLabels(tx, [sheet.approvedBy])).get(sheet.approvedBy),
            )} on ${istMoment(sheet.approvedAt)}`,
            data: {
              code: 'already_approved',
              approvedBy: sheet.approvedBy,
              approvedAt: sheet.approvedAt,
            },
          })
        // Vans and trips 1: the manager's PIN is not given for a load onto a van another trip still holds, nor for
        // one drawn from such a van (or from the bin); the sentence names the trip and what has to happen first.
        await this.assertLoadSource(tx, sheet.fromLocationId)
        await this.assertVanFree(tx, sheet, await this.ownTripOf(tx, sheet), 'approve')
        const now = new Date()
        let approved: LoadSheetRow
        try {
          approved = await this.updateSheet(tx, sheet.id, {
            approvedBy: ctx.actorId,
            approvedAt: now,
          })
        } catch (error) {
          if (isPrivilegeViolation(error) || isCheckViolation(error))
            throw new ORPCError('FORBIDDEN', { message: pgMessage(error) })
          throw error
        }
        await writeAudit(tx, {
          action: 'load_sheet.approve',
          entityType: 'load_sheet',
          entityId: sheet.id,
          before: { approvedBy: null },
          after: {
            approvedBy: ctx.actorId,
            approvedAt: now.toISOString(),
            note: input.note ?? null,
          },
          deviceId: input.deviceId ?? null,
        })
        await emitWarehouseEvent(tx, 'load_sheet', approved.id, 'LoadSheetApproved', {
          loadSheetId: approved.id,
          tripId: approved.tripId,
          approvedBy: ctx.actorId,
        })
        return { item: await loadSheetDetail(tx, approved, this.deps()) }
      }),
    )
  }

  /**
   * The gate, on the warehouse device. In one transaction: the approval gate (409 `approval_required`
   * until the manager has approved the sheet from the manager app — fact 2b; an owner/manager
   * confirming directly IS the approval, the database fills it in), the e-way-bill gate, the crew's
   * blind package count, the van stock replaced by what was actually counted, the
   * `transfer_out`/`transfer_in` pair per counted van-stock lot (godown → vehicle) AND per packed lot
   * (dock → vehicle — the godown was relieved at pack, the dock holds them until now), the `DC` challan,
   * and every packed order `packed → dispatched`.
   *
   * A count that differs from the expectation needs a written reason and records `pinVerifiedBy =
   * approvedBy`: the manager who approved the load owns its variance in the day-end register. Never
   * auto-accept a variance: the count is the last chance to notice a carton left on the dock.
   */
  async confirm(input: ConfirmIn): Promise<ConfirmOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        // The trip first, then the sheet — the order `trips.cancel` and `trips.depart` take them in — so the
        // trip is neither cancelled nor sent off between the check below and the load (QA DOS-354 verify).
        const peek = await this.findSheet(tx, input.id)
        if (peek.status === 'draft' && peek.tripId !== null && this.carriage !== null)
          await this.carriage.trip(tx, peek.tripId, { lock: true })
        const sheet = await this.lockSheet(tx, input.id)
        if (sheet.status !== 'draft')
          throw new ORPCError('CONFLICT', {
            message: `${await this.sheetWords(tx, sheet)} is ${sheet.status}; only a draft is checked out`,
          })
        // QA DOS-355, again at the gate: a sheet drafted before the rule, or a bill cancelled since the sheet
        // was drafted, never leaves on a challan without its tax invoice. Nothing has moved yet.
        let tripId = sheet.tripId
        if (sheet.orderIds.length > 0) {
          const packs = await tx
            .select()
            .from(packConfirmations)
            .where(inArray(packConfirmations.orderId, sheet.orderIds))
          const orders = await this.orders.fulfilmentOrders(tx, sheet.orderIds)
          const byOrder = new Map(orders.map((o) => [o.orderId, o]))
          await this.assertEveryPackBilled(tx, sheet.orderIds, packs, byOrder)
          // QA DOS-354 (verify), again at the gate: every bill counted out is a bill of THIS sheet's trip, which
          // has not left and loads this vehicle — so no bill is ever dispatched with no trip to bring it back,
          // and no settlement of another trip sweeps its pieces off the van as free stock.
          tripId = await this.tripThatCarries(
            tx,
            sheet,
            new Map(packs.map((p) => [p.orderId, p.invoiceId])),
            byOrder,
            { lock: true },
          )
        }
        // Vans and trips 1, again at the gate and before anything moves: a van carries one trip at a time. Nothing is
        // loaded onto a van another trip holds — its settlement would count this load as its own — and nothing is
        // drawn from one (B2), nor from the bin (ruling 6).
        await this.assertLoadSource(tx, sheet.fromLocationId)
        await this.assertVanFree(tx, sheet, tripId, 'confirm')
        const selfApproving =
          ctx.actorRole === 'owner' || ctx.actorRole === 'manager' || ctx.actorRole === 'system'
        if (sheet.approvedBy === null && !selfApproving)
          throw new ORPCError('CONFLICT', {
            message: `${await this.sheetWords(tx, sheet)} has no manager approval yet; the manager gives the load-out PIN from the manager app first`,
            data: { code: 'approval_required' },
          })
        const approver = sheet.approvedBy ?? ctx.actorId
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

        // Godown → vehicle for the COUNTED VAN STOCK (QA DOS-039): the free pieces the crew may sell off
        // the van, and only those — the packed orders' pieces left the godown at pack and are relieved
        // from the DOCK just below, never from the rack twice. Summed per lot: the contract does not
        // refuse a repeated lotId and the keys are per lot, so a second entry would be dropped.
        // Keyed per lot and per direction, so a retry is a no-op on the ledger's
        // UNIQUE(tenant_id, idempotency_key) even if this transaction is replayed a dozen times.
        const vanByLot = new Map<string, number>()
        for (const van of input.countedVanStock) {
          vanByLot.set(van.lotId, (vanByLot.get(van.lotId) ?? 0) + van.qtyPcs)
        }
        await this.inventory.post(
          tx,
          [...vanByLot].flatMap(([lotId, qtyPcs]) => [
            {
              lotId,
              locationId: sheet.fromLocationId,
              qtyDelta: -qtyPcs,
              reason: 'transfer_out' as const,
              refType: 'load_sheet',
              refId: sheet.id,
              idempotencyKey: `load:${sheet.id}:${lotId}:out`,
            },
            {
              lotId,
              locationId: sheet.toLocationId,
              qtyDelta: qtyPcs,
              reason: 'transfer_in' as const,
              refType: 'load_sheet',
              refId: sheet.id,
              idempotencyKey: `load:${sheet.id}:${lotId}:in`,
            },
          ]),
        )

        // Dock → vehicle for the PACKED ORDERS' lots (QA DOS-195): the cartons the crew is loading are
        // now standing in the vehicle's own location, which is what makes "the goods stay on the van"
        // after a refusal, and what the godown's van check-in counts back. Summed per lot across the
        // orders (two bills may draw on one batch) and keyed per lot, so a replayed confirm moves
        // nothing twice.
        //
        // THE LOAD-OUT NEVER CLAMPS OR SHORT-LOADS (verifier's major on DOS-195, ruling S2). The sheet
        // says the goods went aboard, the challan values them, the e-way bill declares them and the
        // door will sell them off the van: so a dock that holds fewer pieces of a lot than a bill needs
        // is a 409 naming the bill, the lot and the shortfall, and NOTHING moves — no ledger row, no
        // challan, no order dispatched; the transaction rolls back.
        //
        // PER BILL, NOT PER BATCH (QA DOS-247). Each bill is covered by the pieces the dock holds for IT
        // (its pack, its check-in, its "Bring them from the godown") and then by pieces the dock holds for
        // nobody; never by another bill's. On day 6 a bill that came back the day before loaded the toor
        // packed an hour earlier for three of today's shops, and the next three sheets were refused for a
        // shortfall no screen could name.
        const cover = await this.dockCover(tx, sheet.orderIds)
        const short = cover.covers.filter((c) => c.shortPcs > 0)
        if (short.length > 0) {
          const first = short[0] as (typeof short)[number]
          const words = short.map(
            (c) =>
              `${billWords(c)} needs ${String(c.neededPcs)} pc of ${c.label} and only ${String(c.neededPcs - c.shortPcs)} are on the dock for it`,
          )
          const bills = [...new Set(short.map((c) => c.invoiceNo ?? c.orderNo ?? 'the bill'))]
          throw new ORPCError('CONFLICT', {
            // QA DOS-244 / DOS-247: the sentence names the bill and the two ways out the screens offer.
            message: `${words.join('; ')}. If they are in the godown, bring them over and press "Bring them from the godown"; if not, the manager takes ${bills.join(', ')} off the trip — nothing was loaded`,
            data: {
              code: 'dock_short',
              lotId: first.lotId,
              onDockPcs: first.neededPcs - first.shortPcs,
              neededPcs: first.neededPcs,
              shortPcs: first.shortPcs,
              orderId: first.orderId,
              invoiceNo: first.invoiceNo,
              retailerName: first.retailerName,
              bills: short.map((c) => ({
                orderId: c.orderId,
                orderNo: c.orderNo,
                invoiceNo: c.invoiceNo,
                retailerName: c.retailerName,
                lotId: c.lotId,
                label: c.label,
                neededPcs: c.neededPcs,
                onDockPcs: c.neededPcs - c.shortPcs,
                shortPcs: c.shortPcs,
              })),
            },
          })
        }
        const dock = cover.covers.length > 0 ? await dockLocationId(tx) : null
        // The bills' holds end here: their pieces are leaving the dock with them.
        await this.inventory.closeDockHolds(tx, cover.orderLineIds)
        const packedByLot = new Map<string, number>()
        for (const c of cover.covers)
          packedByLot.set(c.lotId, (packedByLot.get(c.lotId) ?? 0) + c.neededPcs)
        const shipping = [...packedByLot].flatMap(([lotId, qtyPcs]) => [
          {
            lotId,
            locationId: dock as string,
            qtyDelta: -qtyPcs,
            reason: 'transfer_out' as const,
            refType: 'load_sheet',
            refId: sheet.id,
            idempotencyKey: `load:${sheet.id}:${lotId}:pack:out`,
          },
          {
            lotId,
            locationId: sheet.toLocationId,
            qtyDelta: qtyPcs,
            reason: 'transfer_in' as const,
            refType: 'load_sheet',
            refId: sheet.id,
            idempotencyKey: `load:${sheet.id}:${lotId}:pack:in`,
          },
        ])
        if (shipping.length > 0) await this.inventory.post(tx, shipping)

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
          tripId,
          vanStock: counted.vanStock,
          countedPackages: input.countedPackages,
          varianceNote: input.varianceNote ?? null,
          pinVerifiedBy:
            input.countedPackages === sheet.expectedPackages ? sheet.pinVerifiedBy : approver,
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
        // The paper that rides with the vehicle is rendered in the background (docs/23 §8.3).
        await requestDocumentRender(tx, { kind: 'challan', id: challan.id })

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
            message: `${await this.sheetWords(tx, sheet)} is ${sheet.status}; the goods have left with challan ${sheet.challanNo ?? '(none)'} and come back through delivery, not here`,
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

  /**
   * PUT THE SHEET'S MISSING PIECES ON THE DOCK (QA DOS-244). `confirm` refuses a packed lot the dock cannot
   * cover (`dock_short`, ruling S2: the load-out never short-loads). When those pieces stand in the godown —
   * a bill that came back was counted onto the rack as free stock before the check-in knew better — the loader
   * brings them over and this records it: per packed lot of the sheet, `min(short on the dock, free in the
   * godown)` moves godown → dock (`transfer_out` / `transfer_in`, `load_sheet` rows keyed per sheet, bill, lot
   * and the call's idempotency key). A batch the godown no longer holds free stays short and is reported, never
   * invented. The same arithmetic `confirm` uses — PER BILL since QA DOS-247 (`dockCover`: the bill's own dock
   * holds, then what the dock holds for nobody) — so what this call leaves at zero short, `confirm` accepts; the
   * pieces it fetches, and the unheld ones it counted, are held for that bill. Only while the sheet is a draft.
   */
  async stageDock(input: StageDockIn): Promise<StageDockOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const sheet = await this.lockSheet(tx, input.id)
        if (sheet.status !== 'draft')
          throw new ORPCError('CONFLICT', {
            message: `${await this.sheetWords(tx, sheet)} is ${sheet.status}; only a draft sheet is staged`,
          })
        // The same arithmetic `confirm` refuses on, bill by bill (QA DOS-247): what the dock holds for the
        // bill, then what it holds for nobody; the rest is fetched from the godown's FREE pieces and held for
        // that bill, so the next bill on the sheet — or on another sheet — cannot take it.
        const cover = await this.dockCover(tx, sheet.orderIds)
        if (cover.covers.length === 0) return { items: [] }
        const dock = await dockLocationId(tx)
        const free = await this.inventory.freeAt(
          tx,
          sheet.fromLocationId,
          cover.covers.map((c) => c.lotId),
        )
        const moves: Parameters<InventoryService['post']>[1] = []
        const holds: DockHoldInput[] = []
        const items: StageDockOut['items'] = []
        for (const c of cover.covers) {
          const stagedPcs = Math.min(c.shortPcs, Math.max(0, free.get(c.lotId) ?? 0))
          free.set(c.lotId, (free.get(c.lotId) ?? 0) - stagedPcs)
          const orderLineId = cover.anchorLine(c.orderId, c.variantId)
          if (stagedPcs > 0 && orderLineId !== null) {
            const note = `staged for load sheet ${sheet.id}: ${billWords(c)}'s packed pieces brought from the godown to the dock`
            const key = `stage-dock:${sheet.id}:${c.orderId}:${c.lotId}:${input.idempotencyKey}`
            moves.push(
              {
                lotId: c.lotId,
                locationId: sheet.fromLocationId,
                qtyDelta: -stagedPcs,
                reason: 'transfer_out',
                refType: 'load_sheet',
                refId: sheet.id,
                idempotencyKey: `${key}:out`,
                note,
              },
              {
                lotId: c.lotId,
                locationId: dock,
                qtyDelta: stagedPcs,
                reason: 'transfer_in',
                refType: 'load_sheet',
                refId: sheet.id,
                idempotencyKey: `${key}:in`,
                note,
              },
            )
          }
          const staged = orderLineId === null ? 0 : stagedPcs
          // The bill now CLAIMS what it found unheld on the dock as well as what was fetched for it.
          if (orderLineId !== null && c.fromUnheldPcs + staged > 0)
            holds.push({ orderLineId, lotId: c.lotId, qtyPcs: c.fromUnheldPcs + staged })
          items.push({
            lotId: c.lotId,
            label: c.label,
            neededPcs: c.neededPcs,
            onDockPcs: c.neededPcs - c.shortPcs,
            stagedPcs: staged,
            shortPcs: c.shortPcs - staged,
            orderId: c.orderId,
            orderNo: c.orderNo,
            invoiceNo: c.invoiceNo,
            retailerName: c.retailerName,
          })
        }
        if (moves.length > 0) await this.inventory.post(tx, moves)
        await this.inventory.holdOnDock(tx, holds)
        return { items }
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
   * The printed Rule 55 challan (docs/23 §8.3). Nothing renders on the request path: a challan whose
   * PDF exists answers a signed link, otherwise the render is queued and the answer is `queued`.
   */
  async challanPdf(input: ChallanPdfIn): Promise<ChallanPdfOut> {
    requireRole(FULFILMENT_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const challan = await this.findChallan(tx, input.id)
      return documentRender(tx, {
        kind: 'challan',
        id: challan.id,
        objectKey: challan.pdfObjectKey,
        format: input.format,
        copy: input.copy,
      })
    })
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

  /**
   * A PACK WITHOUT A BILL IS NOT LOADED (QA DOS-355, architect ruling 8 of 2026-09-28). Goods leave the godown on
   * a Rule 55 challan only beside their tax invoice: a pack parked with `issueInvoice: false`, or one whose bill
   * was cancelled, is refused 409 `pack_not_billed` at the moment it is added to a sheet and again at the gate,
   * naming each order and saying where it is billed. So a challan is never issued for it and its order is never
   * dispatched with no bill, no receivable and no door that could record it.
   */
  private async assertEveryPackBilled(
    tx: Db,
    orderIds: readonly string[],
    packs: readonly { orderId: string; invoiceId: string | null }[],
    orders: ReadonlyMap<string, { orderNo: string | null; retailerName: string }>,
  ): Promise<void> {
    const invoiceOf = new Map(packs.map((p) => [p.orderId, p.invoiceId]))
    const refs = await this.billing.invoiceRefs(
      tx,
      packs.map((p) => p.invoiceId).filter((id): id is string => id !== null),
    )
    const unbilled = orderIds.filter((orderId) => {
      const invoiceId = invoiceOf.get(orderId) ?? null
      const state = invoiceId === null ? undefined : refs.get(invoiceId)?.state
      return state === undefined || state === 'draft' || state === 'cancelled'
    })
    if (unbilled.length === 0) return
    const named = unbilled.map((orderId) => {
      const order = orders.get(orderId)
      const no = order?.orderNo ?? orderId
      return order === undefined || order.retailerName === '' ? no : `${no} · ${order.retailerName}`
    })
    throw new ORPCError('CONFLICT', {
      message: `${named.join(', ')} ${unbilled.length === 1 ? 'is' : 'are'} packed but not billed. Goods never leave on a challan without their tax invoice: bill ${unbilled.length === 1 ? 'it' : 'them'} first on the billing desk (Packed, not billed), then put ${unbilled.length === 1 ? 'it' : 'them'} on the load sheet.`,
      data: { code: 'pack_not_billed', orderIds: unbilled },
    })
  }

  /**
   * A BILL IS LOADED ONLY ONTO THE TRIP THAT CARRIES IT (QA DOS-354 verify, architect ruling 8: "a loaded trip is
   * not cancelled, it is checked in" — which needs every loaded bill to have a trip to check in). A sheet with no
   * trip dispatched INV/9031 with nothing to bring it back; a trip's sheet carrying a bill planned on no trip, or on
   * another, dispatched INV/9034 onto a van whose settlement then counted its pieces back as free godown stock,
   * and the bill stood "dispatched" with nothing on the van or the dock. So, for a sheet that carries bills, at
   * create and again at confirm, 409 before anything moves:
   *
   *   - `bill_not_planned`  a bill planned on no trip: plan it on the trip first;
   *   - `bill_not_on_trip`  a bill planned on another trip than the one the sheet names;
   *   - `bills_on_several_trips`  a sheet that names no trip, whose bills ride different trips (one sheet per trip);
   *   - `trip_left`         the trip is checked in, settled or cancelled: nothing more is loaded for it (a trip on
   *                         the road may still take a late bill its van comes back for — it checks in like any);
   *   - `wrong_vehicle`     the sheet loads another vehicle than the trip's own.
   *
   * A sheet that names no trip belongs to the one trip all its bills ride (the DOS-137 sheet built for a vehicle):
   * the answer is that trip's id, which `create` stores and `confirm` writes, so every confirmed sheet that
   * carries bills names its trip — the trip's cancel, check-in and departure read it from there. A sheet of van
   * stock only is free stock for the crew to sell and keeps whatever trip it names. `lock` takes the trip row
   * `FOR UPDATE` (confirm). With no delivery module mounted there are no trips, and nothing is checked.
   */
  private async tripThatCarries(
    tx: Db,
    sheet: { tripId: string | null; toLocationId: string; orderIds: readonly string[] },
    invoiceOf: ReadonlyMap<string, string | null>,
    orders: ReadonlyMap<string, { orderNo: string | null; retailerName: string }>,
    opts: { lock: boolean },
  ): Promise<string | null> {
    const carriage = this.carriage
    if (carriage === null || sheet.orderIds.length === 0) return sheet.tripId
    const invoiceIds = sheet.orderIds
      .map((orderId) => invoiceOf.get(orderId) ?? null)
      .filter((id): id is string => id !== null)
    const riding = await carriage.bills(tx, invoiceIds)
    const refs = await this.billing.invoiceRefs(tx, invoiceIds)
    const billOf = (orderId: string): string => {
      const invoiceId = invoiceOf.get(orderId) ?? null
      const order = orders.get(orderId)
      const bill =
        (invoiceId === null ? null : refs.get(invoiceId)?.invoiceNo) ?? order?.orderNo ?? orderId
      return order === undefined || order.retailerName === ''
        ? bill
        : `${bill} · ${order.retailerName}`
    }
    const tripOf = (orderId: string): LoadingTrip | undefined => {
      const invoiceId = invoiceOf.get(orderId) ?? null
      return invoiceId === null ? undefined : riding.get(invoiceId)
    }
    const tripName = (t: { tripNo: string | null }): string => t.tripNo ?? 'its trip'
    const them = (n: number, one: string, many: string): string => (n === 1 ? one : many)

    const named =
      sheet.tripId === null ? null : await carriage.trip(tx, sheet.tripId, { lock: opts.lock })
    if (sheet.tripId !== null && named === null)
      throw new ORPCError('NOT_FOUND', {
        message: 'The trip this load sheet names does not exist; build the sheet from its trip.',
        data: { code: 'trip_not_found', tripId: sheet.tripId },
      })

    const unplanned = sheet.orderIds.filter((orderId) => tripOf(orderId) === undefined)
    if (unplanned.length > 0)
      throw new ORPCError('CONFLICT', {
        message: `${unplanned.map(billOf).join(', ')} ${them(unplanned.length, 'is', 'are')} not planned on any trip. A bill is loaded only onto the trip that carries it, so that the trip's check-in brings back whatever does not reach the shop: plan ${them(unplanned.length, 'it', 'them')} on ${named === null ? 'a trip' : `trip ${tripName(named)}`} first (Trips), then put ${them(unplanned.length, 'it', 'them')} on that trip's load sheet.`,
        data: { code: 'bill_not_planned', orderIds: unplanned },
      })

    let trip: LoadingTrip
    if (named !== null) {
      const elsewhere = sheet.orderIds.filter((orderId) => tripOf(orderId)?.tripId !== named.tripId)
      if (elsewhere.length > 0)
        throw new ORPCError('CONFLICT', {
          message: `${elsewhere.map((orderId) => `${billOf(orderId)} rides trip ${tripName(tripOf(orderId) ?? { tripNo: null })}`).join('; ')}, not trip ${tripName(named)}. A bill is loaded only onto the trip that carries it: take ${them(elsewhere.length, 'it', 'them')} off this sheet and load ${them(elsewhere.length, 'it', 'them')} on ${them(elsewhere.length, 'its', 'their')} own trip's sheet.`,
          data: {
            code: 'bill_not_on_trip',
            orderIds: elsewhere,
            tripIds: [...new Set(elsewhere.map((orderId) => tripOf(orderId)?.tripId ?? ''))],
          },
        })
      trip = named
    } else {
      const trips = new Map<string, LoadingTrip>()
      for (const orderId of sheet.orderIds) {
        const t = tripOf(orderId)
        if (t !== undefined) trips.set(t.tripId, t)
      }
      const [only] = [...trips.values()]
      if (trips.size > 1 || only === undefined)
        throw new ORPCError('CONFLICT', {
          message: `The bills on this sheet ride different trips (${sheet.orderIds.map((orderId) => `${billOf(orderId)} on ${tripName(tripOf(orderId) ?? { tripNo: null })}`).join('; ')}). A load sheet is one trip's load: build one sheet per trip.`,
          data: { code: 'bills_on_several_trips', tripIds: [...trips.keys()] },
        })
      trip = opts.lock ? ((await carriage.trip(tx, only.tripId, { lock: true })) ?? only) : only
    }

    if (trip.state !== 'planned' && trip.state !== 'loading' && trip.state !== 'active')
      throw new ORPCError('CONFLICT', {
        message: `Trip ${tripName(trip)} is ${TRIP_STATE_WORDS[trip.state] ?? trip.state}, so nothing more is loaded for it: its check-in has already counted what came back. Plan ${them(sheet.orderIds.length, 'the bill', 'the bills')} on a trip that is still to come back, then build that trip's sheet.`,
        data: { code: 'trip_left', tripId: trip.tripId, tripState: trip.state },
      })
    if (trip.vehicleLocationId !== sheet.toLocationId) {
      const van = (await vehicleRegNos(tx, [sheet.toLocationId])).get(sheet.toLocationId)
      throw new ORPCError('CONFLICT', {
        message: `Trip ${tripName(trip)} goes out on ${trip.vehicle ?? 'another vehicle'}, and this sheet loads ${van ?? 'a different vehicle'}. Build the sheet for the trip's own vehicle, so the crew finds its load on the van it drives.`,
        data: { code: 'wrong_vehicle', tripId: trip.tripId },
      })
    }
    return trip.tripId
  }

  /**
   * WHERE A SHEET DRAWS FROM (ruling 6; vans and trips 1). A godown, or a van that no trip holds: never the damaged
   * / expiry bin, the dock or a shop's floor (`sourceRefusal`), and never a van with a trip on the road, checked in
   * and not settled, or loaded — its pieces belong to that trip's bills and van sales, and a van-to-van sheet took a
   * loaded bill's pieces off it (QA verify 2, B2). 409 `vehicle_on_trip` naming the trip and what has to happen
   * first. Asked at create, at the approval and at the gate, so a sheet drafted before the rule is refused too.
   */
  private async assertLoadSource(tx: Db, fromLocationId: string): Promise<void> {
    const place = await placeOf(tx, fromLocationId)
    const refused = sourceRefusal(place, fromLocationId, 'load sheet')
    if (refused !== null) throw refused
    if (place?.kind !== 'vehicle' || this.carriage === null) return
    const holder = await this.carriage.vanHolder(tx, fromLocationId, null)
    if (holder === null) return
    throw new ORPCError('CONFLICT', {
      message: `${holder.vehicle ?? place.name} is ${holder.words}: its pieces belong to that trip's bills and van sales, so nothing is taken off it on a load sheet until the trip is settled. ${capitalise(holder.first)} first; the godown then counts the van off on Van check-in.`,
      data: {
        code: 'vehicle_on_trip',
        tripId: holder.tripId,
        tripNo: holder.tripNo,
        tripState: holder.state,
      },
    })
  }

  /**
   * A VAN CARRIES ONE TRIP AT A TIME (architect ruling of 2026-09-28, vans and trips 1; QA verify 2, B1). Goods are
   * not loaded onto a van that another trip holds — on the road, checked in and not settled, or already loaded —
   * because that trip's settlement counts everything standing on the van: tomorrow's trip loaded onto the van that
   * was out today had its bill swept into the godown as free stock at today's settlement, and its crew found
   * "Only 0 pc" at the door. And a trip that is over takes no more goods. Refused 409 `vehicle_on_trip` at the
   * approval and again at the gate (nothing has moved), naming the trip and what has to happen first. `ownTripId`
   * is the trip the sheet loads for; the van's own trip on the road may still take a late sheet (QA DOS-148).
   */
  private async assertVanFree(
    tx: Db,
    sheet: { toLocationId: string },
    ownTripId: string | null,
    step: 'approve' | 'confirm',
  ): Promise<void> {
    const carriage = this.carriage
    if (carriage === null) return
    const own = ownTripId === null ? null : await carriage.trip(tx, ownTripId, { lock: false })
    if (
      own !== null &&
      own.state !== 'planned' &&
      own.state !== 'loading' &&
      own.state !== 'active'
    )
      throw new ORPCError('CONFLICT', {
        message: `Trip ${own.tripNo ?? 'of this sheet'} is ${TRIP_STATE_WORDS[own.state] ?? own.state}, so nothing more is loaded for it: build the sheet for a trip that is still to go out.`,
        data: { code: 'trip_left', tripId: own.tripId, tripState: own.state },
      })
    const holder = await carriage.vanHolder(tx, sheet.toLocationId, ownTripId)
    if (holder === null) return
    const forWhat = own === null ? '' : ` for trip ${own.tripNo ?? 'this trip'}`
    throw new ORPCError('CONFLICT', {
      message: `${holder.vehicle ?? 'This vehicle'} is ${holder.words}. A van carries one trip at a time, so nothing is loaded onto it${forWhat} until that trip is settled: ${holder.first} first, then ${step === 'approve' ? 'approve' : 'count out'} this sheet.`,
      data: {
        code: 'vehicle_on_trip',
        tripId: holder.tripId,
        tripNo: holder.tripNo,
        tripState: holder.state,
      },
    })
  }

  /**
   * The trip a draft sheet loads for, as its approval judges it: the trip it names, else the one trip its bills
   * ride (a sheet built for the vehicle before QA DOS-354 may name none), else none.
   */
  private async ownTripOf(
    tx: Db,
    sheet: { tripId: string | null; orderIds: readonly string[] },
  ): Promise<string | null> {
    if (sheet.tripId !== null || this.carriage === null || sheet.orderIds.length === 0)
      return sheet.tripId
    const packs = await tx
      .select({ invoiceId: packConfirmations.invoiceId })
      .from(packConfirmations)
      .where(inArray(packConfirmations.orderId, [...sheet.orderIds]))
    const riding = await this.carriage.bills(
      tx,
      packs.map((p) => p.invoiceId).filter((id): id is string => id !== null),
    )
    const trips = new Set([...riding.values()].map((t) => t.tripId))
    return trips.size === 1 ? ([...trips][0] ?? null) : null
  }

  /**
   * The DRAFT sheets built for a trip that is ending before it was loaded (QA DOS-354): cancelled with the trip's
   * reason, so their bills are free for another sheet and no draft of a dead trip can still be counted out
   * later and dispatch bills with no trip to carry them. Nothing had moved (a draft moves no stock). Asked by
   * `delivery.trips.cancel` and by the check-in of a loaded trip that never left. Returns the sheets cancelled.
   */
  async cancelDraftsForTrip(tx: Db, tripId: string, reason: string): Promise<string[]> {
    const { tenantId } = currentTenant()
    const drafts = await tx
      .select({ id: loadSheets.id })
      .from(loadSheets)
      .where(
        and(
          eq(loadSheets.tenantId, tenantId),
          eq(loadSheets.tripId, tripId),
          eq(loadSheets.status, 'draft'),
        ),
      )
      .orderBy(loadSheets.id)
      .for('update')
    const now = new Date()
    for (const draft of drafts)
      await this.updateSheet(tx, draft.id, {
        status: 'cancelled',
        cancelledAt: now,
        cancelReason: reason.slice(0, 200),
      })
    return drafts.map((d) => d.id)
  }

  // -------------------------------------------------------------------------------------------------------------
  // what delivery imports (coordination §4)

  /**
   * The confirmed loads of a trip — read-only, and one of the two things delivery asks the warehouse
   * (the other is `draftsForTrip`). It is how the trip answers "is the load actually out of the godown"
   * without delivery reading `load_sheets` itself, and where the crew's van stock comes from.
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

  /**
   * The draft load sheets that still hold a trip back — read-only, asked by `delivery.trips.depart`
   * (QA DOS-043): a sheet linked to the trip by `trip_id`, OR one carrying an order planned on one of the
   * trip's stops. The second half matters because a sheet is built for a VEHICLE and the warehouse app
   * may leave `trip_id` empty (DOS-137). Delivery passes the order ids of its own planned deliveries, so
   * neither module reads the other's tables. A confirmed or cancelled sheet never holds a trip back.
   */
  async draftsForTrip(tx: Db, tripId: string, orderIds: readonly string[]): Promise<string[]> {
    const { tenantId } = currentTenant()
    const linked = eq(loadSheets.tripId, tripId)
    const rows = await tx
      .select({ id: loadSheets.id })
      .from(loadSheets)
      .where(
        and(
          eq(loadSheets.tenantId, tenantId),
          eq(loadSheets.status, 'draft'),
          orderIds.length === 0
            ? linked
            : or(
                linked,
                sql`exists (select 1 from jsonb_array_elements_text(${loadSheets.orderIds}) o
                             where o.value in (${sql.join(
                               orderIds.map((id) => sql`${id}`),
                               sql`, `,
                             )}))`,
              ),
        ),
      )
      .orderBy(loadSheets.id)
    return rows.map((r) => r.id)
  }

  // -------------------------------------------------------------------------------------------------------------

  /**
   * QA DOS-247: what each bill on a sheet needs off the dock, lot by lot and in the sheet's own order, against
   * the pieces the dock holds for THAT bill and then the pieces it holds for nobody (`coverFromDock`). The
   * unheld balances are read `FOR UPDATE`, so two sheets cannot both count the same unheld carton. Each row
   * carries the words a refusal needs: the bill number, the shop, the item and its batch.
   */
  private async dockCover(
    tx: Db,
    orderIds: readonly string[],
  ): Promise<{
    covers: BillCover[]
    orderLineIds: string[]
    anchorLine: (orderId: string, variantId: string) => string | null
  }> {
    const packed = await packedLotsByOrder(tx, orderIds)
    const lines = await this.orders.fulfilmentLines(tx, orderIds)
    const linesOf = new Map<string, typeof lines>()
    for (const line of lines) {
      const group = linesOf.get(line.orderId) ?? []
      group.push(line)
      linesOf.set(line.orderId, group)
    }
    const heldByLine = await this.inventory.dockHeldFor(
      tx,
      lines.map((l) => l.orderLineId),
    )
    const lotIds = [...new Set([...packed.values()].flatMap((e) => e.map((x) => x.lotId)))]
    const lotRows = await loadLots(tx, lotIds)
    const variants = await loadVariantInfo(
      tx,
      [...lotRows.values()].map((l) => l.variantId),
    )
    const claims: (DockClaim & { orderId: string })[] = []
    for (const orderId of orderIds) {
      const held = new Map<string, number>()
      for (const line of linesOf.get(orderId) ?? [])
        for (const [lotId, qty] of heldByLine.get(line.orderLineId) ?? [])
          held.set(lotId, (held.get(lotId) ?? 0) + qty)
      for (const entry of packed.get(orderId) ?? [])
        claims.push({
          key: orderId,
          orderId,
          lotId: entry.lotId,
          neededPcs: entry.qtyPcs,
          heldPcs: held.get(entry.lotId) ?? 0,
        })
    }
    const dockNow = await this.inventory.dockBalances(tx, lotIds)
    const orders = await this.orders.fulfilmentOrders(tx, orderIds)
    const byOrder = new Map(orders.map((o) => [o.orderId, o]))
    const packs =
      orderIds.length === 0
        ? []
        : await tx
            .select({ orderId: packConfirmations.orderId, invoiceId: packConfirmations.invoiceId })
            .from(packConfirmations)
            .where(inArray(packConfirmations.orderId, [...orderIds]))
    const invoiceOf = new Map(packs.map((p) => [p.orderId, p.invoiceId]))
    const refs = await this.billing.invoiceRefs(
      tx,
      packs.map((p) => p.invoiceId).filter((id): id is string => id !== null),
    )
    const covers = coverFromDock(claims, dockNow).map((c): BillCover => {
      const lot = lotRows.get(c.lotId)
      const variantId = lot?.variantId ?? ''
      const name = variants.get(variantId)?.variantName ?? `lot ${c.lotId}`
      const invoiceId = invoiceOf.get(c.key) ?? null
      return {
        ...c,
        orderId: c.key,
        orderNo: byOrder.get(c.key)?.orderNo ?? null,
        invoiceNo: invoiceId === null ? null : (refs.get(invoiceId)?.invoiceNo ?? null),
        retailerName: byOrder.get(c.key)?.retailerName ?? '',
        variantId,
        label: lot === undefined || lot.batchNo === '' ? name : `${name} (batch ${lot.batchNo})`,
      }
    })
    return {
      covers,
      orderLineIds: lines.map((l) => l.orderLineId),
      anchorLine: (orderId, variantId) => {
        const group = linesOf.get(orderId) ?? []
        return (group.find((l) => l.variantId === variantId) ?? group[0])?.orderLineId ?? null
      },
    }
  }

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

  /**
   * Which DRAFT sheet each of these orders is on. A confirmed sheet is history (QA DOS-172): its orders
   * were dispatched by `confirm`, so a packed order listed on one came back undelivered and may be loaded
   * again once its trip has checked in (`heldOnTheRoad` answers that half).
   *
   * The same draft-sheet rule exists a second time as `onDraftLoadSheet` in packing.service.ts, which
   * `packs.list?status=awaiting_load` filters with (DOS-133). The DOS-133 spec in warehouse.spec.ts ties
   * the two (create accepts every row that list offers, the bill returned after its confirmed sheet
   * included), so a change to one changes both.
   */
  /** Which of `orderIds` a DRAFT sheet still carries, as order id → sheet id (delivery's `trips.dropBill`, QA DOS-241). */
  async ordersOnADraftSheet(
    tx: Db,
    orderIds: readonly string[],
  ): Promise<{ sheetId: string; tripId: string | null; vehicleRegNo: string | null }[]> {
    const onDraft = await this.onADraftSheet(tx, orderIds)
    const ids = [...new Set(onDraft.values())]
    if (ids.length === 0) return []
    const rows = await tx
      .select({ id: loadSheets.id, tripId: loadSheets.tripId, to: loadSheets.toLocationId })
      .from(loadSheets)
      .where(inArray(loadSheets.id, ids))
      .orderBy(loadSheets.id)
    const regNos = await vehicleRegNos(
      tx,
      rows.map((r) => r.to),
    )
    return rows.map((r) => ({
      sheetId: r.id,
      tripId: r.tripId,
      vehicleRegNo: regNos.get(r.to) ?? null,
    }))
  }

  private async onADraftSheet(tx: Db, orderIds: readonly string[]): Promise<Map<string, string>> {
    if (orderIds.length === 0) return new Map()
    const { tenantId } = currentTenant()
    const rows = await tx.execute(sql`
      select ls.id, o.value as order_id
        from load_sheets ls, jsonb_array_elements_text(ls.order_ids) o
       where ls.tenant_id = ${tenantId} and ls.status = 'draft'
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

  /**
   * A load sheet as the desk names it: "the load sheet for MH-05-CD-5678 on 13 Sep" (DOS-141).
   *
   * Its row id is a UUID, and a refusal built from it ("load sheet 01a0976e-bbaf-… was already
   * approved by a1cbd424-…") tells a manager nothing about which van is waiting at the gate. The
   * vehicle registration and the sheet date are what is written on the sheet itself.
   */
  private async sheetWords(tx: Db, sheet: LoadSheetRow): Promise<string> {
    const regNo = (await vehicleRegNos(tx, [sheet.toLocationId])).get(sheet.toLocationId)
    const van = regNo === undefined || regNo === '' ? '' : ` for ${regNo}`
    return `the load sheet${van} on ${istDateWord(sheet.sheetDate)}`
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

/** The first letter of a sentence part upper-cased: "settle trip TRIP-0003" → "Settle trip TRIP-0003". */
function capitalise(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1)
}
