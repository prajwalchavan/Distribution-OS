import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ApprovalKind,
  CancelOrderInput,
  CancelOrderOutput,
  ConfirmOrderInput,
  ConfirmOrderOutput,
  CreateOrderInput,
  CreateOrderOutput,
  OrderDetail,
  OrderGetInput,
  OrderGetOutput,
  OrdersListInput,
  OrdersListOutput,
  RepeatLastOrderInput,
  RepeatLastOrderOutput,
  SetOrderLinesInput,
  SetOrderLinesOutput,
  SubmitOrderInput,
  SubmitOrderOutput,
} from '@dos/contracts'
import { uuidv7, type OrderState } from '@dos/domain'
import {
  approvals,
  salesOrderLines,
  salesOrders,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  currentTenant,
  DB,
  idempotent,
  MANAGEMENT,
  nextDocumentNumber,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'
import { InventoryService } from '../inventory/index.js'
import { QuoteService } from '../pricing/index.js'
import {
  approvalFlags,
  asSystem,
  availablePcs,
  createDraft,
  emitOrderEvent,
  isUniqueViolation,
  listOrders,
  recordTransition,
  transition,
  warehouseLocation,
  type DraftInput,
  type OrderEventType,
} from './orders.internals.js'
import {
  fulfilmentLines,
  fulfilmentOrders,
  fulfilmentQueue,
  orderLineOwners,
  recordDelivered,
  recordPick,
  type DeliveredLine,
  type FulfilmentEvent,
  type FulfilmentLine,
  type FulfilmentOrder,
  type FulfilmentQueueFilter,
  type PickedLine,
} from './fulfilment.js'
import {
  fillRateByDay,
  fillRateLines,
  type FillRateFilter,
  type FillRateLineRow,
} from './fill-rate.js'
import { loadDetail, type OrderRow } from './orders.mappers.js'
import { priceOrderLines, type EnteredLine } from './pricing-lines.js'

type CreateIn = z.infer<typeof CreateOrderInput>
type CreateOut = z.infer<typeof CreateOrderOutput>
type SetLinesIn = z.infer<typeof SetOrderLinesInput>
type SetLinesOut = z.infer<typeof SetOrderLinesOutput>
type SubmitIn = z.infer<typeof SubmitOrderInput>
type SubmitOut = z.infer<typeof SubmitOrderOutput>
type ConfirmIn = z.infer<typeof ConfirmOrderInput>
type ConfirmOut = z.infer<typeof ConfirmOrderOutput>
type CancelIn = z.infer<typeof CancelOrderInput>
type CancelOut = z.infer<typeof CancelOrderOutput>
type RepeatIn = z.infer<typeof RepeatLastOrderInput>
type RepeatOut = z.infer<typeof RepeatLastOrderOutput>
type GetIn = z.infer<typeof OrderGetInput>
type GetOut = z.infer<typeof OrderGetOutput>
type ListIn = z.infer<typeof OrdersListInput>
type ListOut = z.infer<typeof OrdersListOutput>

const ORDER_ROLES: readonly ActorRole[] = [...STAFF, 'retailer']
export type Shortage = ConfirmOut['shortages'][number]

/** Where each fulfilment move lands, so a retry on an order already there is a no-op, not a 409. */
const FULFILMENT_TARGET: Readonly<Record<FulfilmentEvent, OrderState>> = {
  start_picking: 'picking',
  pack: 'packed',
  dispatch: 'dispatched',
  deliver_all: 'delivered',
  deliver_partial: 'partially_delivered',
  return_undelivered: 'packed',
}

/** The outbox event each move publishes, in the same transaction as the transition row. */
const FULFILMENT_EVENT_TYPE: Readonly<Record<FulfilmentEvent, OrderEventType>> = {
  start_picking: 'OrderPicking',
  pack: 'OrderPacked',
  dispatch: 'OrderDispatched',
  deliver_all: 'OrderDelivered',
  deliver_partial: 'OrderPartiallyDelivered',
  return_undelivered: 'OrderReturnedUndelivered',
}

/**
 * The Sales Order aggregate (§4.3). Everything a device or the console does to an order goes through here:
 * lines are priced by the engine (`pricing-lines.ts`), states move only through `orderMachine`, every move
 * writes an `order_state_transitions` row and an `outbox_events` row, and stock is only ever touched through
 * `InventoryService`. Approvals gate submitted → confirmed; reservations are a side effect of `confirm`.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly quotes: QuoteService,
    private readonly inventory: InventoryService,
  ) {}

  // -------------------------------------------------------------------------------------------------------------
  // drafting

  async create(input: CreateIn): Promise<CreateOut> {
    requireRole(ORDER_ROLES)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const order = await this.insertDraft(tx, input)
        const priced = await this.writeLines(tx, order, input.lines)
        return { item: await this.detail(tx, priced) }
      }),
    )
  }

  async setLines(input: SetLinesIn): Promise<SetLinesOut> {
    requireRole(ORDER_ROLES)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const order = await this.lockOrder(tx, input.id)
        if (order.state !== 'draft')
          throw new ORPCError('CONFLICT', {
            message: `order ${order.id} is ${order.state}; only a draft can be re-lined`,
          })
        this.assertRetailerOwns(order)
        return { item: await this.detail(tx, await this.writeLines(tx, order, input.lines)) }
      }),
    )
  }

  /** A repeat order is the retailer's last non-cancelled order, re-priced today (docs/06 "Reorder last order"). */
  async repeatLast(input: RepeatIn): Promise<RepeatOut> {
    requireRole(ORDER_ROLES)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        await this.quotes.loadRetailer(tx, ctx, input.retailerId)
        const [previous] = await tx
          .select({ id: salesOrders.id })
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.retailerId, input.retailerId),
              sql`${salesOrders.state} <> 'cancelled'`,
            ),
          )
          .orderBy(desc(salesOrders.id))
          .limit(1)
        if (!previous)
          throw new ORPCError('NOT_FOUND', {
            message: `retailer ${input.retailerId} has no order to repeat`,
          })
        const previousLines = await tx
          .select()
          .from(salesOrderLines)
          .where(eq(salesOrderLines.orderId, previous.id))
          .orderBy(asc(salesOrderLines.lineNo))
        if (previousLines.length === 0)
          throw new ORPCError('BAD_REQUEST', { message: `order ${previous.id} has no lines` })
        const order = await this.insertDraft(tx, {
          id: input.id,
          retailerId: input.retailerId,
          source: input.source,
          pricingDateMode: 'order',
          expectedDeliveryDate: input.expectedDeliveryDate ?? null,
          note: `Repeat of ${previous.id}`,
        })
        const lines: EnteredLine[] = previousLines.map((l) => ({
          id: uuidv7(),
          variantId: l.variantId,
          enteredQty: l.enteredQty,
          enteredUnit: l.enteredUnit,
        }))
        return { item: await this.detail(tx, await this.writeLines(tx, order, lines)) }
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // fulfilment states

  /**
   * Submit: the order number is allocated now (ADR 0001, never at draft), the approval gates run, and an order
   * that trips none is confirmed on the spot so the rep sees `confirmed` on the next sync.
   *
   * THE SHOP SUBMITS ITS OWN DRAFT the same way (docs/22 §4 R1 → S5, docs/23 §8.15): the same server
   * re-pricing happened at `setLines`, the same approval gates run here, and the approvals a shop's
   * order raises stay invisible to it (`loadDetail` strips them). The auto-confirm half reserves stock
   * and moves the order to `confirmed`, both staff-only at the database, so for a retailer it runs
   * under the system role (`asSystem`) while `actor_id` keeps recording the shopkeeper.
   */
  async submit(input: SubmitIn): Promise<SubmitOut> {
    requireRole(ORDER_ROLES)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const order = await this.lockOrder(tx, input.id)
        this.assertRetailerOwns(order)
        const { item } = await this.submitInTx(tx, order, input.deviceId ?? null)
        return { item }
      }),
    )
  }

  /**
   * The transaction-scoped half of `submit`, shared with the delivery module's van sale (coordination
   * §4: delivery → orders): the number, the approval gates, the transition row and the event, then the
   * auto-confirm when no gate tripped. `flags` tells the caller which gates are still waiting — a van
   * sale at the door cannot wait for the owner, so it refuses on a non-empty list.
   */
  async submitInTx(
    tx: Db,
    order: OrderRow,
    deviceId: string | null,
  ): Promise<{ item: OrderDetail; flags: ApprovalKind[] }> {
    const ctx = currentTenant()
    const to = transition(order.state, 'submit')
    const lines = await tx
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, order.id))
    if (lines.length === 0)
      throw new ORPCError('BAD_REQUEST', { message: 'an order needs at least one line' })
    const now = new Date()
    const flags = await approvalFlags(tx, order, lines)
    const [submitted] = await tx
      .update(salesOrders)
      .set({
        state: to,
        orderNo: order.orderNo ?? (await nextDocumentNumber(tx, 'SO', now)),
        approvalFlags: flags,
        submittedAt: now,
        updatedAt: now,
      })
      .where(eq(salesOrders.id, order.id))
      .returning()
    const next = submitted ?? order
    await recordTransition(tx, next, order.state, to, 'submit', deviceId, null)
    await emitOrderEvent(tx, next, 'OrderSubmitted')
    if (flags.length === 0) {
      const confirmed =
        ctx.actorRole === 'retailer'
          ? await asSystem(tx, () => this.confirmInTx(tx, next, deviceId))
          : await this.confirmInTx(tx, next, deviceId)
      return { item: confirmed.item, flags }
    }
    await tx.insert(approvals).values(
      flags.map((kind) => ({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        kind,
        orderId: next.id,
        entityType: 'sales_order',
        entityId: next.id,
        requestedBy: ctx.actorId,
        status: 'pending' as const,
        payload: { orderNo: next.orderNo, totalPaise: next.totalPaise, flag: kind },
      })),
    )
    return { item: await this.detail(tx, next), flags }
  }

  /** Owner and manager confirm (docs/22 2026-09-05): it resolves approvals and reserves stock. */
  async confirm(input: ConfirmIn): Promise<ConfirmOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const order = await this.lockOrder(tx, input.id)
        return this.confirmInTx(tx, order, input.deviceId ?? null)
      }),
    )
  }

  /**
   * Confirm: pending approvals are resolved, then the authoritative stock check runs (the ATP the rep saw was
   * only a hint). A line the location cannot cover is reserved short and reported — never refused, because the
   * warehouse decides what to do with a shortage, not the API.
   */
  async confirmInTx(tx: Db, order: OrderRow, deviceId: string | null): Promise<ConfirmOut> {
    const ctx = currentTenant()
    if (order.state === 'confirmed') return { item: await this.detail(tx, order), shortages: [] }
    const to = transition(order.state, 'confirm')
    const now = new Date()
    await tx
      .update(approvals)
      .set({ status: 'approved', decidedBy: ctx.actorId, decidedAt: now, updatedAt: now })
      .where(and(eq(approvals.orderId, order.id), eq(approvals.status, 'pending')))
    const locationId = order.fulfilFromLocationId ?? (await warehouseLocation(tx))
    const lines = await tx
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, order.id))
      .orderBy(asc(salesOrderLines.lineNo))
    const shortages: Shortage[] = []
    for (const line of lines) {
      // Free pieces of the same variant ship with the order, so they are held too.
      const requested = line.qtyPcs + line.freeQtyPcs
      if (requested <= 0) continue
      const available = await availablePcs(tx, line.variantId, locationId)
      const take = Math.min(requested, available)
      if (take > 0)
        await this.inventory.reserve(tx, {
          orderLineId: line.id,
          variantId: line.variantId,
          locationId,
          qtyPcs: take,
        })
      if (take < requested)
        shortages.push({
          lineId: line.id,
          variantId: line.variantId,
          requestedPcs: requested,
          reservedPcs: take,
          shortQtyPcs: requested - take,
        })
    }
    const [confirmed] = await tx
      .update(salesOrders)
      .set({ state: to, fulfilFromLocationId: locationId, confirmedAt: now, updatedAt: now })
      .where(eq(salesOrders.id, order.id))
      .returning()
    const next = confirmed ?? order
    await recordTransition(tx, next, order.state, to, 'confirm', deviceId, null)
    await emitOrderEvent(tx, next, 'OrderConfirmed')
    return { item: await this.detail(tx, next), shortages }
  }

  async cancel(input: CancelIn): Promise<CancelOut> {
    requireRole(ORDER_ROLES)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const order = await this.lockOrder(tx, input.id)
        this.assertRetailerOwns(order, ['draft', 'submitted'])
        return { item: await this.cancelInTx(tx, order, input.reason, input.deviceId ?? null) }
      }),
    )
  }

  /** Cancelling releases every held piece and expires the approvals that were waiting on the order. */
  async cancelInTx(
    tx: Db,
    order: OrderRow,
    reason: string,
    deviceId: string | null,
  ): Promise<OrderDetail> {
    const to = transition(order.state, 'cancel')
    const now = new Date()
    const lines = await tx
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, order.id))
    for (const line of lines) await this.inventory.releaseReservation(tx, line.id)
    await tx
      .update(approvals)
      .set({ status: 'expired', decisionNote: reason, decidedAt: now, updatedAt: now })
      .where(and(eq(approvals.orderId, order.id), eq(approvals.status, 'pending')))
    const [cancelled] = await tx
      .update(salesOrders)
      .set({ state: to, cancelledAt: now, cancelReason: reason, updatedAt: now })
      .where(eq(salesOrders.id, order.id))
      .returning()
    const next = cancelled ?? order
    await recordTransition(tx, next, order.state, to, 'cancel', deviceId, reason)
    await emitOrderEvent(tx, next, 'OrderCancelled')
    return this.detail(tx, next)
  }

  /**
   * THE ONLY WAY AN ORDER MOVES confirmed → picking → packed → dispatched (coordination §3.9, §4).
   *
   * Warehouse owns those three moves — `picklists.start`, `packs.confirm`, `loadSheets.confirm` — and
   * calls this for each. It exists because the three things that must happen together are easy to get
   * apart: `orderMachine` decides whether the move is legal, `order_state_transitions` records who and
   * which device did it, and the `outbox_events` row tells delivery, notifications and reporting. All
   * three are written inside the caller's transaction, so either every one of them lands or none does.
   * Writing `sales_orders.state` by hand is what this method exists to prevent.
   *
   * Idempotent by state, not by key: a load sheet confirming twenty orders is retried as a whole, and an
   * order already at the target state is left alone rather than raising a 409 the crew cannot act on.
   * An order anywhere else raises the machine's own `TransitionError` as a 409 (`transition()`), which is
   * the correct answer to "pack something that was never picked".
   */
  async applyFulfilmentEvent(
    tx: Db,
    orderId: string,
    event: FulfilmentEvent,
    deviceId: string | null,
    reason: string | null,
  ): Promise<OrderRow> {
    const order = await this.lockOrder(tx, orderId)
    if (order.state === FULFILMENT_TARGET[event]) return order
    const to = transition(order.state, event)
    const [moved] = await tx
      .update(salesOrders)
      .set({ state: to, updatedAt: new Date() })
      .where(eq(salesOrders.id, order.id))
      .returning()
    const next = moved ?? order
    await recordTransition(tx, next, order.state, to, event, deviceId, reason)
    await emitOrderEvent(tx, next, FULFILMENT_EVENT_TYPE[event])
    return next
  }

  /** Warehouse writes back what came off the rack; see `recordPick` for why free pieces are excluded. */
  recordPick(tx: Db, orderId: string, picked: readonly PickedLine[]): Promise<void> {
    return recordPick(tx, orderId, picked)
  }

  /** Delivery writes back what the shop accepted at the door (coordination §3.9); see `recordDelivered`. */
  recordDelivered(tx: Db, orderId: string, delivered: readonly DeliveredLine[]): Promise<void> {
    return recordDelivered(tx, orderId, delivered)
  }

  /**
   * Pieces ordered against pieces picked, per variant, for the orders the godown worked on inside the
   * window (coordination §3.9: reporting's `fillRateLines`). Reporting's register and the rollup's
   * `daily_tenant_stats.ordered_pcs` / `picked_pcs` both come from here — `fill-rate.ts`.
   */
  fillRateLines(tx: Db, filter: FillRateFilter): Promise<FillRateLineRow[]> {
    return fillRateLines(tx, filter)
  }

  /** The same, one row per IST business date: what the rollup writes (`fill-rate.ts`). */
  fillRateByDay(
    tx: Db,
    filter: { from: string; to: string },
  ): Promise<{ day: string; orderedPcs: number; pickedPcs: number }[]> {
    return fillRateByDay(tx, filter)
  }

  /** The warehouse app's order queue: quantities and identity, never money (`fulfilment.ts`). */
  fulfilmentQueue(tx: Db, filter: FulfilmentQueueFilter): Promise<FulfilmentOrder[]> {
    return fulfilmentQueue(tx, filter)
  }

  /** The lines a picklist is snapshotted from, `(orderId, lineNo)` ordered and rate-free. */
  fulfilmentLines(tx: Db, orderIds: readonly string[]): Promise<FulfilmentLine[]> {
    return fulfilmentLines(tx, orderIds)
  }

  /** The same queue row by id, for orders a warehouse screen still names after they left the godown. */
  fulfilmentOrders(tx: Db, orderIds: readonly string[]): Promise<FulfilmentOrder[]> {
    return fulfilmentOrders(tx, orderIds)
  }

  /** Which order each line belongs to — the holds screen has a line id and needs the order. */
  orderLineOwners(
    tx: Db,
    orderLineIds: readonly string[],
  ): Promise<Map<string, { orderId: string; orderNo: string | null }>> {
    return orderLineOwners(tx, orderLineIds)
  }

  /**
   * TEMPORARY ALIAS — dies with `billing.invoices.issue`.
   *
   * Added by the BILLING slice (coordination §3.9 and §4 cycle 2) so billing could bill an order while
   * the warehouse module did not exist. Warehouse's `packs.confirm` now owns the stock-and-state half
   * through `applyFulfilmentEvent`, so this is a thin walk over it: a `confirmed` order still has to pass
   * through `picking`, because `orderMachine` has no `confirmed → packed` edge. Remove it together with
   * billing's temporary `invoices.issue` procedure.
   */
  async markPacked(tx: Db, order: OrderRow, deviceId: string | null): Promise<OrderRow> {
    if (order.state === 'packed') return order
    if (order.state === 'confirmed')
      await this.applyFulfilmentEvent(tx, order.id, 'start_picking', deviceId, null)
    return this.applyFulfilmentEvent(tx, order.id, 'pack', deviceId, null)
  }

  // -------------------------------------------------------------------------------------------------------------
  // reads

  async get(input: GetIn): Promise<GetOut> {
    requireRole(ORDER_ROLES)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, input.id))
      if (!order) throw new ORPCError('NOT_FOUND', { message: `order ${input.id} not found` })
      return { item: await this.detail(tx, order) }
    })
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(ORDER_ROLES)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), (tx) => listOrders(tx, input))
  }

  // -------------------------------------------------------------------------------------------------------------
  // internals shared with the approvals queue and the sync handlers

  async lockOrder(tx: Db, id: string): Promise<OrderRow> {
    const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id)).for('update')
    if (!order) throw new ORPCError('NOT_FOUND', { message: `order ${id} not found` })
    return order
  }

  async findOrder(tx: Db, id: string): Promise<OrderRow | undefined> {
    const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id))
    return order
  }

  detail(tx: Db, order: OrderRow): Promise<OrderDetail> {
    return loadDetail(tx, order, currentTenant().actorRole !== 'retailer')
  }

  /** Creates the draft header (`createDraft`); exposed so the sync handler can draft from a device op. */
  insertDraft(tx: Db, input: DraftInput): Promise<OrderRow> {
    return createDraft(tx, this.quotes, input)
  }

  /** Replaces every line of a draft with the priced result and refreshes the header totals. */
  async writeLines(tx: Db, order: OrderRow, lines: readonly EnteredLine[]): Promise<OrderRow> {
    await tx.delete(salesOrderLines).where(eq(salesOrderLines.orderId, order.id))
    const priced = await priceOrderLines(tx, this.quotes, {
      orderId: order.id,
      retailerId: order.retailerId,
      lines,
      deliveryDate: order.pricingDateMode === 'delivery' ? order.expectedDeliveryDate : null,
    })
    if (priced.lines.length > 0) {
      try {
        // savepoint: the delete above clears the lines of THIS order only, so a client-generated line
        // id that already belongs to another order still collides on the primary key. That is a
        // duplicate id — the client's to fix — not a server fault, and it must not abort the
        // transaction (a retailer login cannot even see the order holding the clashing line).
        await tx.transaction(async (sp) => {
          await sp.insert(salesOrderLines).values(priced.lines)
        })
      } catch (err) {
        if (isUniqueViolation(err))
          throw new ORPCError('CONFLICT', {
            message: `one of these line ids already belongs to another order; generate new ids for the lines`,
          })
        throw err
      }
    }
    const [updated] = await tx
      .update(salesOrders)
      .set({ ...priced.totals, updatedAt: new Date() })
      .where(eq(salesOrders.id, order.id))
      .returning()
    return updated ?? order
  }

  private assertRetailerOwns(order: OrderRow, states: OrderState[] = ['draft']): void {
    const ctx = currentTenant()
    if (ctx.actorRole !== 'retailer') return
    if (order.createdBy !== ctx.actorId || !states.includes(order.state))
      throw new ORPCError('FORBIDDEN', {
        message: `a retailer may only change its own ${states.join('/')} orders`,
      })
  }
}
