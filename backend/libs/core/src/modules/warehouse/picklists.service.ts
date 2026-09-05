import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, inArray, lt, lte, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  CancelPicklistInput,
  CancelPicklistOutput,
  CreatePicklistInput,
  CreatePicklistOutput,
  FulfilmentQueueInput,
  FulfilmentQueueOutput,
  FulfilmentQueueState,
  PickWarning,
  PicklistGetInput,
  PicklistGetOutput,
  PicklistsListInput,
  PicklistsListOutput,
  RecordPickInput,
  RecordPickOutput,
  ReleaseReservationsInput,
  ReleaseReservationsOutput,
  ReservationsListInput,
  ReservationsListOutput,
  StartPicklistInput,
  StartPicklistOutput,
} from '@dos/contracts'
import { businessDate, uuidv7, type OrderState } from '@dos/domain'
import { packConfirmations, pickLines, picklists, withTenant, type Db } from '@dos/db'
import {
  currentTenant,
  DB,
  idempotent,
  nextDocumentNumber,
  requireDb,
  requireRole,
  BACK_OFFICE,
} from '../../platform/index.js'
import { InventoryService } from '../inventory/index.js'
import { OrdersService } from '../orders/index.js'
import {
  fefoLots,
  MAX_PICK_ROWS,
  PICK_SERIES,
  PIN_HOLDERS,
  WAREHOUSE_DESK,
  assertTenantMember,
  isForeignKeyViolation,
  isUniqueViolation,
  loadLots,
  writeAudit,
  emitWarehouseEvent,
} from './warehouse.internals.js'
import {
  picklistDetail,
  picklistTotals,
  pickLinesOf,
  toPicklistSummary,
  type PickLineRow,
  type PicklistRow,
} from './warehouse.mappers.js'

type QueueIn = z.infer<typeof FulfilmentQueueInput>
type QueueOut = z.infer<typeof FulfilmentQueueOutput>
type CreateIn = z.infer<typeof CreatePicklistInput>
type CreateOut = z.infer<typeof CreatePicklistOutput>
type ListIn = z.infer<typeof PicklistsListInput>
type ListOut = z.infer<typeof PicklistsListOutput>
type GetIn = z.infer<typeof PicklistGetInput>
type GetOut = z.infer<typeof PicklistGetOutput>
type StartIn = z.infer<typeof StartPicklistInput>
type StartOut = z.infer<typeof StartPicklistOutput>
type PickIn = z.infer<typeof RecordPickInput>
type PickOut = z.infer<typeof RecordPickOutput>
type CancelIn = z.infer<typeof CancelPicklistInput>
type CancelOut = z.infer<typeof CancelPicklistOutput>
type ReservationsIn = z.infer<typeof ReservationsListInput>
type ReservationsOut = z.infer<typeof ReservationsListOutput>
type ReleaseIn = z.infer<typeof ReleaseReservationsInput>
type ReleaseOut = z.infer<typeof ReleaseReservationsOutput>

/** The only order states the godown floor ever shows, matching `FulfilmentQueueStateSchema`. */
const QUEUE_STATES = new Set<OrderState>(['confirmed', 'picking', 'packed'])

/** A wave that is still someone's work: an order on one of these may not be waved again. */
const LIVE_PICKLIST_STATUSES = ['open', 'picking', 'picked'] as const

/** One recorded pick, as `picklists.pick` and the offline handler both express it. */
export interface RecordedPick {
  id: string
  orderLineId: string
  lotId: string
  pickedQtyPcs: number
  shortReason?: string | undefined
}

/**
 * The queue, the wave and the picking sheet — everything before the cartons are taped shut.
 *
 * NOTHING HERE MOVES STOCK (warehouse §4.4). A picklist is paper: it records what the godown was asked
 * for and what it actually took, so a half-picked wave abandoned at six in the evening leaves the
 * `stock_ledger` untouched. The pieces leave in `packing.service.ts`, once per order, for ever.
 *
 * The order aggregate is reached only through `OrdersService` (queue reads, the `start_picking`
 * transition) and stock only through `InventoryService` (FEFO suggestion, the holds screen, release) —
 * `sales_orders`, `sales_order_lines` and `reservations` are never selected from here (coordination §4).
 */
@Injectable()
export class PicklistsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
    private readonly inventory: InventoryService,
  ) {}

  // -------------------------------------------------------------------------------------------------------------
  // the queue

  /**
   * The warehouse app's opening screen. Quantities and identity only — `OrdersService.fulfilmentQueue`
   * is deliberately money-free, so no rate reaches a picker's phone.
   *
   * `unpicklistedOnly` filters AFTER the page is read, so a page can come back shorter than `limit`;
   * `nextCursor` is still the last RAW row's id, which is what keeps paging from skipping an order.
   */
  async queue(input: QueueIn): Promise<QueueOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const rows = await this.orders.fulfilmentQueue(tx, {
        locationId: input.locationId,
        beatId: input.beatId,
        state: input.state,
        expectedDeliveryDate: input.expectedDeliveryDate,
        limit: input.limit + 1,
        cursor: input.cursor,
      })
      const page = rows.slice(0, input.limit)
      const last = page[page.length - 1]
      const live = await this.livePicklistByOrder(
        tx,
        page.map((o) => o.orderId),
      )
      const items = page
        // `fulfilmentQueue` narrows to the three godown states already; this keeps the wire shape
        // honest if a caller ever passes a state the contract does not sanction.
        .filter((o): o is typeof o & { state: FulfilmentQueueState } => QUEUE_STATES.has(o.state))
        .map((o) => ({ ...o, picklistId: live.get(o.orderId) ?? null }))
        .filter((o) => !input.unpicklistedOnly || o.picklistId === null)
      return {
        items,
        nextCursor: rows.length > input.limit && last ? last.orderId : null,
      }
    })
  }

  // -------------------------------------------------------------------------------------------------------------
  // the wave

  /**
   * Waves the chosen orders into a picking sheet and NOTHING ELSE: the order state is untouched, so a
   * shop that rings back can still cancel until someone starts picking (warehouse §4.5).
   *
   * The suggested lots come from the holds the order already has — `InventoryService.reserve` allocated
   * them FEFO at confirm, so re-deriving them from `sellable_stock` would both duplicate that decision
   * and skip the very lots this order is holding. Anything the order was short of at confirm is
   * suggested from `sellable_stock` now, and a line nothing can cover gets a lot-less row the picker
   * fills in.
   */
  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const orderIds = [...new Set(input.orderIds)]
        const orders = await this.orders.fulfilmentOrders(tx, orderIds)
        if (orders.length !== orderIds.length) {
          const found = new Set(orders.map((o) => o.orderId))
          const missing = orderIds.filter((id) => !found.has(id))
          throw new ORPCError('NOT_FOUND', { message: `order(s) not found: ${missing.join(', ')}` })
        }
        const notConfirmed = orders.filter((o) => o.state !== 'confirmed')
        if (notConfirmed.length > 0)
          throw new ORPCError('CONFLICT', {
            message: `only a confirmed order can be waved; ${notConfirmed
              .map((o) => `${o.orderNo ?? o.orderId} is ${o.state}`)
              .join(', ')}`,
          })
        const alreadyWaved = await this.livePicklistByOrder(tx, orderIds)
        if (alreadyWaved.size > 0)
          throw new ORPCError('CONFLICT', {
            message: `order(s) already on a live picklist: ${[...alreadyWaved.keys()].join(', ')}`,
          })

        const locationId = this.singleLocation(orders, input.locationId)
        const lines = await this.orders.fulfilmentLines(tx, orderIds)
        if (lines.length === 0)
          throw new ORPCError('BAD_REQUEST', { message: 'these orders have no lines to pick' })

        const held = await this.inventory.listReservations(tx, {
          orderLineIds: lines.map((l) => l.orderLineId),
          state: 'pending',
          limit: MAX_PICK_ROWS,
        })
        const heldByLine = new Map<string, { lotId: string; qtyPcs: number }[]>()
        for (const hold of [...held].reverse()) {
          if (hold.lotId === null) continue
          const group = heldByLine.get(hold.orderLineId) ?? []
          group.push({ lotId: hold.lotId, qtyPcs: hold.qtyPcs })
          heldByLine.set(hold.orderLineId, group)
        }

        const now = new Date()
        const rows: (typeof pickLines.$inferInsert)[] = []
        for (const line of lines) {
          const requested = line.qtyPcs + line.freeQtyPcs
          if (requested <= 0) continue
          const allocations = await this.suggestLots(
            tx,
            line.variantId,
            locationId,
            requested,
            heldByLine.get(line.orderLineId) ?? [],
          )
          const lots = await loadLots(
            tx,
            allocations.map((a) => a.lotId).filter((id): id is string => id !== null),
          )
          // Paid pieces come off the rack first and the free goods travel behind them, so a short pick
          // costs the shop its free case before it costs it a billed one.
          let paidLeft = line.qtyPcs
          for (const allocation of allocations) {
            const paid = Math.min(paidLeft, allocation.qtyPcs)
            paidLeft -= paid
            const lot = allocation.lotId === null ? undefined : lots.get(allocation.lotId)
            rows.push({
              id: uuidv7(),
              tenantId: ctx.tenantId,
              picklistId: input.id,
              orderId: line.orderId,
              orderLineId: line.orderLineId,
              variantId: line.variantId,
              lineNo: line.lineNo,
              lotId: allocation.lotId,
              suggestedLotId: allocation.lotId,
              requestedQtyPcs: allocation.qtyPcs,
              pickedQtyPcs: 0,
              freeQtyPcs: allocation.qtyPcs - paid,
              caseSize: lot?.caseSize ?? line.sellCaseSize,
              fefoOverride: false,
            })
          }
        }
        if (rows.length > MAX_PICK_ROWS)
          throw new ORPCError('BAD_REQUEST', {
            message: `a wave is at most ${MAX_PICK_ROWS} pick rows; these orders need ${rows.length}. Split them.`,
          })

        const picklist = await this.insertPicklist(tx, {
          id: input.id,
          locationId,
          orderIds,
          pickDate: input.pickDate ?? businessDate(now).date,
          tripId: input.tripId ?? null,
          beatId: input.beatId ?? null,
          note: input.note ?? null,
          picklistNo: await nextDocumentNumber(tx, PICK_SERIES, now),
        })
        if (rows.length > 0) await tx.insert(pickLines).values(rows)
        return { item: await picklistDetail(tx, picklist, this.orders) }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.status ? eq(picklists.status, input.status) : undefined,
        input.locationId ? eq(picklists.locationId, input.locationId) : undefined,
        input.assignedTo ? eq(picklists.assignedTo, input.assignedTo) : undefined,
        input.tripId ? eq(picklists.tripId, input.tripId) : undefined,
        input.from ? gte(picklists.pickDate, input.from) : undefined,
        input.to ? lte(picklists.pickDate, input.to) : undefined,
        input.cursor ? lt(picklists.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(picklists)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(desc(picklists.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const totals = await picklistTotals(
        tx,
        page.map((p) => p.id),
      )
      const last = page[page.length - 1]
      return {
        items: page.map((p) =>
          toPicklistSummary(
            p,
            totals.get(p.id) ?? {
              orderCount: p.orderIds.length,
              lineCount: 0,
              requestedQtyPcs: 0,
              pickedQtyPcs: 0,
            },
          ),
        ),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => ({
      item: await picklistDetail(tx, await this.findPicklist(tx, input.id), this.orders),
    }))
  }

  /**
   * Hand the sheet to a picker. Every order on it moves `confirmed → picking` through
   * `OrdersService.applyFulfilmentEvent`, which writes the transition row and the `OrderPicking` outbox
   * event in this transaction — the rep's "where is my shop's order" answer comes from there, not from
   * a warehouse endpoint. A replay on a sheet already picking returns it unchanged.
   */
  async start(input: StartIn): Promise<StartOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const sheet = await this.lockPicklist(tx, input.id)
        if (sheet.status === 'cancelled')
          throw new ORPCError('CONFLICT', { message: `picklist ${input.id} is cancelled` })
        if (sheet.status !== 'open' && sheet.status !== 'picking')
          throw new ORPCError('CONFLICT', {
            message: `picklist ${input.id} is ${sheet.status}; only an open sheet is started`,
          })
        if (input.assignedTo !== undefined) await assertTenantMember(tx, input.assignedTo)
        const deviceId = input.deviceId ?? null
        for (const orderId of sheet.orderIds)
          await this.orders.applyFulfilmentEvent(tx, orderId, 'start_picking', deviceId, null)
        const started =
          sheet.status === 'picking' && input.assignedTo === undefined
            ? sheet
            : await this.updatePicklist(tx, sheet.id, {
                status: 'picking',
                startedAt: sheet.startedAt ?? new Date(),
                assignedTo: input.assignedTo ?? sheet.assignedTo,
              })
        await emitWarehouseEvent(tx, 'picklist', started.id, 'PicklistStarted', {
          picklistId: started.id,
          picklistNo: started.picklistNo,
          locationId: started.locationId,
          orderIds: started.orderIds,
          assignedTo: started.assignedTo,
        })
        return { item: await picklistDetail(tx, started, this.orders) }
      }),
    )
  }

  async pick(input: PickIn): Promise<PickOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const sheet = await this.lockPicklist(tx, input.id)
        const warnings = await this.applyPicks(tx, sheet, input.lines)
        return {
          item: await picklistDetail(tx, await this.findPicklist(tx, sheet.id), this.orders),
          warnings,
        }
      }),
    )
  }

  /**
   * Only while the sheet is still `open`. Once an order has entered `picking` there is no way back —
   * `orderMachine` has no `picking → confirmed` edge — so a started wave is finished or short-picked,
   * never cancelled (warehouse §4.5).
   *
   * Cancelling FREES THE HOLDS of every line on the sheet, which is the point: the wave was raised
   * because those orders were going out today, and abandoning it must put the pieces back on the shelf
   * for whoever needs them next. The orders stay `confirmed` and are re-reserved when they are waved
   * again (or at pack, which reserves what it is about to post).
   */
  async cancel(input: CancelIn): Promise<CancelOut> {
    requireRole(PIN_HOLDERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const sheet = await this.lockPicklist(tx, input.id)
        if (sheet.status === 'cancelled')
          return { item: await picklistDetail(tx, sheet, this.orders) }
        if (sheet.status !== 'open')
          throw new ORPCError('CONFLICT', {
            message: `picklist ${sheet.picklistNo ?? sheet.id} is ${sheet.status}; only a sheet nobody has started can be cancelled`,
          })
        const lines = await pickLinesOf(tx, sheet.id)
        for (const orderLineId of new Set(lines.map((l) => l.orderLineId)))
          await this.inventory.releaseReservation(tx, orderLineId)
        const cancelled = await this.updatePicklist(tx, sheet.id, {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: input.reason,
        })
        return { item: await picklistDetail(tx, cancelled, this.orders) }
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // reservations (the "why can I not sell this" screen)

  async listReservations(input: ReservationsIn): Promise<ReservationsOut> {
    requireRole(WAREHOUSE_DESK)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const orderLineIds = input.orderId
        ? (await this.orders.fulfilmentLines(tx, [input.orderId])).map((l) => l.orderLineId)
        : undefined
      if (orderLineIds !== undefined && orderLineIds.length === 0)
        return { items: [], nextCursor: null }
      const rows = await this.inventory.listReservations(tx, {
        orderLineIds,
        locationId: input.locationId,
        variantId: input.variantId,
        state: input.state,
        limit: input.limit + 1,
        cursor: input.cursor,
      })
      const page = rows.slice(0, input.limit)
      const owners = await this.orders.orderLineOwners(
        tx,
        page.map((r) => r.orderLineId),
      )
      const last = page[page.length - 1]
      return {
        items: page.map((r) => ({
          id: r.id,
          orderId: owners.get(r.orderLineId)?.orderId ?? null,
          orderNo: owners.get(r.orderLineId)?.orderNo ?? null,
          orderLineId: r.orderLineId,
          variantId: r.variantId,
          variantName: r.variantName,
          lotId: r.lotId,
          batchNo: r.batchNo === '' ? null : r.batchNo,
          locationId: r.locationId,
          qtyPcs: r.qtyPcs,
          state: r.state,
          createdAt: r.createdAt,
        })),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  /**
   * Frees every pending hold of an order that will not be picked — a shop shut for a wedding, an order
   * parked. Only while the order is still `confirmed`: once it is `picking` the pieces are on their way
   * out and giving them back would let the same case be sold twice.
   */
  async releaseReservations(input: ReleaseIn): Promise<ReleaseOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [order] = await this.orders.fulfilmentOrders(tx, [input.orderId])
        if (!order)
          throw new ORPCError('NOT_FOUND', { message: `order ${input.orderId} not found` })
        if (order.state !== 'confirmed')
          throw new ORPCError('CONFLICT', {
            message: `order ${order.orderNo ?? order.orderId} is ${order.state}; holds are only freed while it is confirmed`,
          })
        const lines = await this.orders.fulfilmentLines(tx, [input.orderId])
        const held = await this.inventory.listReservations(tx, {
          orderLineIds: lines.map((l) => l.orderLineId),
          state: 'pending',
          limit: MAX_PICK_ROWS,
        })
        const freedQtyPcs = held.reduce((n, r) => n + r.qtyPcs, 0)
        let released = 0
        for (const line of lines)
          released += await this.inventory.releaseReservation(tx, line.orderLineId)
        await writeAudit(tx, {
          action: 'warehouse.reservations.release',
          entityType: 'sales_order',
          entityId: input.orderId,
          after: { reason: input.reason, released, freedQtyPcs },
        })
        return { released, orderId: input.orderId, freedQtyPcs }
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // shared with the offline handler

  /**
   * Records what came off the rack. The rules are the same whether the pick arrives over HTTP or out of
   * a device's offline queue, which is why the handler in `warehouse.sync.ts` calls exactly this:
   *
   *  - an `id` already on the sheet UPDATES that row; a new id ADDS one for the same order line, which
   *    is how a split across two lots is recorded;
   *  - Σ picked per order line may never exceed Σ requested (400) — over-picking is a counting mistake,
   *    not a business decision;
   *  - a later-expiry lot is recorded with `fefo_override` and a WARNING, never a refusal;
   *  - a short line with a reason is complete; a short line without one leaves the sheet `picking`,
   *    because the picker has not finished walking the rack yet.
   */
  async applyPicks(
    tx: Db,
    sheet: PicklistRow,
    input: readonly RecordedPick[],
  ): Promise<PickWarning[]> {
    // A wave is open to corrections until the cartons are taped shut: `picking` is the normal case and
    // `picked` is the picker fixing a batch or a count they got wrong on the way back. `open` (nobody
    // has started), `packed` and `cancelled` are closed — the pieces have either not been asked for yet
    // or have already left. The OFFLINE handler is stricter and accepts only `picking`, because a device
    // that has been off the network for an hour must not silently re-open a sheet the desk has moved on.
    if (sheet.status !== 'picking' && sheet.status !== 'picked')
      throw new ORPCError('CONFLICT', {
        message: `picklist ${sheet.picklistNo ?? sheet.id} is ${sheet.status}; ${
          sheet.status === 'open' ? 'start it before picking' : 'it is no longer being picked'
        }`,
      })
    const ctx = currentTenant()
    const existing = await pickLinesOf(tx, sheet.id)
    const byId = new Map(existing.map((r) => [r.id, r]))
    const byOrderLine = new Map<string, PickLineRow[]>()
    for (const row of existing) {
      const group = byOrderLine.get(row.orderLineId) ?? []
      group.push(row)
      byOrderLine.set(row.orderLineId, group)
    }
    const lots = await loadLots(
      tx,
      input.map((l) => l.lotId),
    )
    const now = new Date()
    const warnings: PickWarning[] = []
    const inserts: (typeof pickLines.$inferInsert)[] = []
    const updates: { id: string; values: Partial<typeof pickLines.$inferInsert> }[] = []
    const working = new Map(existing.map((r) => [r.id, { ...r }]))
    const fefoCache = new Map<string, string | null>()

    for (const pick of input) {
      const template = byId.get(pick.id) ?? byOrderLine.get(pick.orderLineId)?.[0]
      if (!template)
        throw new ORPCError('BAD_REQUEST', {
          message: `line ${pick.orderLineId} is not on picklist ${sheet.picklistNo ?? sheet.id}`,
        })
      if (byId.has(pick.id) && template.orderLineId !== pick.orderLineId)
        throw new ORPCError('BAD_REQUEST', {
          message: `pick row ${pick.id} belongs to line ${template.orderLineId}, not ${pick.orderLineId}`,
        })
      const lot = lots.get(pick.lotId)
      if (!lot) throw new ORPCError('NOT_FOUND', { message: `lot ${pick.lotId} not found` })
      if (lot.variantId !== template.variantId)
        throw new ORPCError('BAD_REQUEST', {
          message: `lot ${pick.lotId} is a different product from line ${pick.orderLineId}`,
        })
      const override = await this.isFefoOverride(
        tx,
        template,
        pick.lotId,
        sheet.locationId,
        fefoCache,
      )
      const values = {
        lotId: pick.lotId,
        pickedQtyPcs: pick.pickedQtyPcs,
        shortReason: pick.shortReason ?? null,
        fefoOverride: override,
        caseSize: lot.caseSize ?? template.caseSize,
        pickedBy: ctx.actorId,
        pickedAt: now,
        updatedAt: now,
      }
      const current = working.get(pick.id)
      if (current) {
        Object.assign(current, values)
        updates.push({ id: pick.id, values })
      } else {
        const row = {
          id: pick.id,
          tenantId: ctx.tenantId,
          picklistId: sheet.id,
          orderId: template.orderId,
          orderLineId: template.orderLineId,
          variantId: template.variantId,
          lineNo: template.lineNo,
          suggestedLotId: null,
          // The ASK lives on the rows the wave created. An extra row records a second lot for the same
          // line, so it asks for nothing of its own and the per-line total stays the order's total.
          requestedQtyPcs: 0,
          freeQtyPcs: 0,
          ...values,
        }
        inserts.push(row)
        working.set(row.id, { ...template, ...row, createdAt: now })
      }
      if (override)
        warnings.push({
          pickLineId: pick.id,
          code: 'fefo_override',
          message: `lot ${lot.batchNo || pick.lotId} was taken while an earlier-expiry batch still had stock`,
        })
    }

    this.assertNotOverPicked(working, sheet)
    if (inserts.length > 0) {
      try {
        await tx.insert(pickLines).values(inserts)
      } catch (err) {
        if (isUniqueViolation(err))
          throw new ORPCError('CONFLICT', {
            message: 'one of these pick row ids already exists; generate a new id for the split',
          })
        throw err
      }
    }
    for (const update of updates)
      await tx.update(pickLines).set(update.values).where(eq(pickLines.id, update.id))

    for (const [orderLineId, total] of this.perLineTotals(working)) {
      if (total.picked < total.requested && total.shortReason)
        warnings.push({
          pickLineId: total.rowId,
          code: 'short_pick',
          message: `line ${orderLineId} is short by ${total.requested - total.picked} pcs: ${total.shortReason}`,
        })
    }
    await this.refreshCompletion(tx, sheet, working)
    return warnings
  }

  async findPicklist(tx: Db, id: string): Promise<PicklistRow> {
    const [row] = await tx.select().from(picklists).where(eq(picklists.id, id))
    if (!row) throw new ORPCError('NOT_FOUND', { message: `picklist ${id} not found` })
    return row
  }

  async lockPicklist(tx: Db, id: string): Promise<PicklistRow> {
    const [row] = await tx.select().from(picklists).where(eq(picklists.id, id)).for('update')
    if (!row) throw new ORPCError('NOT_FOUND', { message: `picklist ${id} not found` })
    return row
  }

  /** The live wave each of these orders is on, if any — the queue's `picklistId` and the wave guard. */
  async livePicklistByOrder(tx: Db, orderIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(orderIds)]
    if (ids.length === 0) return new Map()
    const rows = await tx
      .select({ orderId: pickLines.orderId, picklistId: pickLines.picklistId })
      .from(pickLines)
      .innerJoin(picklists, eq(picklists.id, pickLines.picklistId))
      .where(
        and(
          inArray(pickLines.orderId, ids),
          inArray(picklists.status, [...LIVE_PICKLIST_STATUSES]),
        ),
      )
    return new Map(rows.map((r) => [r.orderId, r.picklistId]))
  }

  /** Every order on a wave ships from ONE location; a mixed wave is a 409, not a silent split. */
  private singleLocation(
    orders: readonly { orderId: string; fulfilFromLocationId: string | null }[],
    given: string | undefined,
  ): string {
    const locations = new Set(
      orders.map((o) => o.fulfilFromLocationId).filter((id): id is string => id !== null),
    )
    if (locations.size > 1)
      throw new ORPCError('CONFLICT', {
        message: `these orders ship from ${locations.size} different locations; wave them separately`,
      })
    const locationId = given ?? [...locations][0]
    if (!locationId)
      throw new ORPCError('BAD_REQUEST', {
        message: 'these orders name no fulfilment location; pass locationId',
      })
    return locationId
  }

  /**
   * Which batches to take, in FEFO order: the pieces this order already holds first (they were chosen
   * FEFO at confirm), then whatever `sellable_stock` can still offer for the remainder, then one
   * lot-less row for anything the location simply cannot cover — the picker names the batch.
   */
  private async suggestLots(
    tx: Db,
    variantId: string,
    locationId: string,
    requested: number,
    held: readonly { lotId: string; qtyPcs: number }[],
  ): Promise<{ lotId: string | null; qtyPcs: number }[]> {
    const out: { lotId: string | null; qtyPcs: number }[] = []
    let remaining = requested
    for (const hold of held) {
      if (remaining <= 0) break
      const take = Math.min(remaining, hold.qtyPcs)
      if (take <= 0) continue
      out.push({ lotId: hold.lotId, qtyPcs: take })
      remaining -= take
    }
    if (remaining > 0) {
      for (const candidate of await fefoLots(tx, variantId, locationId)) {
        if (remaining <= 0) break
        const take = Math.min(remaining, candidate.available)
        if (take <= 0) continue
        out.push({ lotId: candidate.lotId, qtyPcs: take })
        remaining -= take
      }
    }
    if (remaining > 0) out.push({ lotId: null, qtyPcs: remaining })
    return out
  }

  /**
   * A pick is an override when it is not the batch the server proposed, or — for a row the wave could
   * suggest nothing for — when an earlier-expiry batch at the same location still has stock.
   */
  private async isFefoOverride(
    tx: Db,
    row: PickLineRow,
    lotId: string,
    locationId: string,
    cache: Map<string, string | null>,
  ): Promise<boolean> {
    if (row.suggestedLotId !== null) return row.suggestedLotId !== lotId
    if (!cache.has(row.variantId)) {
      const candidates = await fefoLots(tx, row.variantId, locationId)
      cache.set(row.variantId, candidates[0]?.lotId ?? null)
    }
    const earliest = cache.get(row.variantId) ?? null
    return earliest !== null && earliest !== lotId
  }

  private perLineTotals(
    working: Map<string, PickLineRow>,
  ): Map<string, { rowId: string; requested: number; picked: number; shortReason: string | null }> {
    const totals = new Map<
      string,
      { rowId: string; requested: number; picked: number; shortReason: string | null }
    >()
    for (const row of working.values()) {
      const current = totals.get(row.orderLineId) ?? {
        rowId: row.id,
        requested: 0,
        picked: 0,
        shortReason: null,
      }
      current.requested += row.requestedQtyPcs
      current.picked += row.pickedQtyPcs
      current.shortReason = current.shortReason ?? row.shortReason
      totals.set(row.orderLineId, current)
    }
    return totals
  }

  private assertNotOverPicked(working: Map<string, PickLineRow>, sheet: PicklistRow): void {
    for (const [orderLineId, total] of this.perLineTotals(working)) {
      if (total.picked > total.requested)
        throw new ORPCError('BAD_REQUEST', {
          message: `line ${orderLineId} on ${sheet.picklistNo ?? sheet.id} asks for ${total.requested} pcs; ${total.picked} were picked`,
        })
    }
  }

  /** `picked` once every order line is either fully picked or explained; otherwise still `picking`. */
  private async refreshCompletion(
    tx: Db,
    sheet: PicklistRow,
    working: Map<string, PickLineRow>,
  ): Promise<void> {
    const totals = [...this.perLineTotals(working).values()]
    const done =
      totals.length > 0 &&
      totals.every((t) => t.picked >= t.requested || (t.picked > 0 && t.shortReason !== null))
    if (!done || sheet.status === 'picked') return
    await this.updatePicklist(tx, sheet.id, { status: 'picked', completedAt: new Date() })
  }

  private async insertPicklist(
    tx: Db,
    values: {
      id: string
      locationId: string
      orderIds: string[]
      pickDate: string
      tripId: string | null
      beatId: string | null
      note: string | null
      picklistNo: string
    },
  ): Promise<PicklistRow> {
    const { tenantId } = currentTenant()
    try {
      const [row] = await tx
        .insert(picklists)
        .values({ ...values, tenantId, status: 'open' })
        .returning()
      if (!row)
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'picklist insert returned nothing',
        })
      return row
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ORPCError('CONFLICT', {
          message: `picklist ${values.id} already exists, or its number is taken; generate a new id`,
        })
      if (isForeignKeyViolation(err))
        throw new ORPCError('BAD_REQUEST', {
          message: `this wave names a location, beat or trip that does not exist in this distributor`,
        })
      throw err
    }
  }

  private async updatePicklist(
    tx: Db,
    id: string,
    values: Partial<typeof picklists.$inferInsert>,
  ): Promise<PicklistRow> {
    const [row] = await tx
      .update(picklists)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(picklists.id, id))
      .returning()
    if (!row) throw new ORPCError('NOT_FOUND', { message: `picklist ${id} not found` })
    return row
  }

  /** Marks a wave `packed` once every order on it has been confirmed into cartons. */
  async markPackedIfComplete(tx: Db, picklistId: string): Promise<void> {
    const sheet = await this.findPicklist(tx, picklistId)
    if (sheet.status !== 'picked' && sheet.status !== 'picking') return
    if (sheet.orderIds.length === 0) return
    const packed = await tx
      .select({ orderId: packConfirmations.orderId })
      .from(packConfirmations)
      .where(inArray(packConfirmations.orderId, sheet.orderIds))
    const done = new Set(packed.map((p) => p.orderId))
    if (!sheet.orderIds.every((id) => done.has(id))) return
    await this.updatePicklist(tx, picklistId, {
      status: 'packed',
      completedAt: sheet.completedAt ?? new Date(),
    })
  }
}
