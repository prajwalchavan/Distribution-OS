import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
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
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  nextDocumentNumber,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'
import { InventoryService } from '../inventory/index.js'
import { QuoteService } from '../pricing/index.js'
import {
  approvalFlags,
  availablePcs,
  createDraft,
  emitOrderEvent,
  listOrders,
  recordTransition,
  transition,
  warehouseLocation,
  type DraftInput,
} from './orders.internals.js'
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
   */
  async submit(input: SubmitIn): Promise<SubmitOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const order = await this.lockOrder(tx, input.id)
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
        await recordTransition(tx, next, order.state, to, 'submit', input.deviceId ?? null, null)
        await emitOrderEvent(tx, next, 'OrderSubmitted')
        if (flags.length === 0) {
          const confirmed = await this.confirmInTx(tx, next, input.deviceId ?? null)
          return { item: confirmed.item }
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
        return { item: await this.detail(tx, next) }
      }),
    )
  }

  async confirm(input: ConfirmIn): Promise<ConfirmOut> {
    requireRole(BACK_OFFICE)
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
    if (priced.lines.length > 0) await tx.insert(salesOrderLines).values(priced.lines)
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
