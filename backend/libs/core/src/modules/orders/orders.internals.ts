import { ORPCError } from '@orpc/server'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ApprovalKind,
  CreateOrderInput,
  OrdersListInput,
  OrdersListOutput,
} from '@dos/contracts'
import {
  orderMachine,
  TransitionError,
  uuidv7,
  type OrderEvent,
  type OrderState,
} from '@dos/domain'
import type { salesOrderLines } from '@dos/db'
import {
  bargainRequests,
  locations,
  orderStateTransitions,
  outboxEvents,
  salesOrders,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import type { QuoteService } from '../pricing/index.js'
import { checkCredit, loadRetailerCredit } from '../receivables/index.js'
import { toOrder, type OrderRow } from './orders.mappers.js'
import { ZERO_TOTALS } from './pricing-lines.js'

/** The plumbing every order mutation shares: the machine guard, the approval gates, stock lookup and audit. */

type OrderLineRow = typeof salesOrderLines.$inferSelect

/** `orderMachine` owns the rules; an illegal move is a 409, never a silently ignored write. */
export function transition(from: OrderState, event: OrderEvent): OrderState {
  try {
    return orderMachine.next(from, event)
  } catch (error) {
    if (error instanceof TransitionError)
      throw new ORPCError('CONFLICT', { message: error.message, data: { from, event } })
    throw error
  }
}

export interface DraftInput {
  id: string
  retailerId: string
  source: z.infer<typeof CreateOrderInput>['source']
  pricingDateMode: z.infer<typeof CreateOrderInput>['pricingDateMode']
  paymentTerms?: z.infer<typeof CreateOrderInput>['paymentTerms']
  fulfilFromLocationId?: string | null | undefined
  expectedDeliveryDate?: string | null | undefined
  note?: string | null | undefined
}

/**
 * The draft header. A retailer-role caller may only draft for a shop linked to its own login (ADR 0006);
 * `loadRetailer` turns an unlinked shop into a clear 403 instead of an empty RLS result.
 */
export async function createDraft(
  tx: Db,
  quotes: QuoteService,
  input: DraftInput,
): Promise<OrderRow> {
  const ctx = currentTenant()
  if (ctx.actorRole === 'retailer' && input.source !== 'retailer_app')
    throw new ORPCError('FORBIDDEN', {
      message: 'a retailer may only place orders with source retailer_app',
    })
  await quotes.loadRetailer(tx, ctx, input.retailerId)
  const [clash] = await tx.select().from(salesOrders).where(eq(salesOrders.id, input.id))
  if (clash) throw orderIdTaken(input.id)
  const credit = await loadRetailerCredit(tx, input.retailerId)
  let order: OrderRow | undefined
  try {
    // savepoint: the id may already belong to an order this caller cannot see — a retailer login only reads its
    // own shop's orders (ADR 0006), so the check above cannot find every clash. A primary-key violation here is a
    // duplicate client id, never a server fault, and it must not abort the surrounding transaction.
    await tx.transaction(async (sp) => {
      ;[order] = await sp
        .insert(salesOrders)
        .values({
          id: input.id,
          tenantId: ctx.tenantId,
          retailerId: input.retailerId,
          state: 'draft',
          source: input.source,
          createdBy: ctx.actorId,
          salespersonId: ctx.actorRole === 'salesperson' ? ctx.actorId : null,
          pricingDateMode: input.pricingDateMode,
          paymentTerms: input.paymentTerms ?? credit.paymentTerms,
          fulfilFromLocationId: input.fulfilFromLocationId ?? null,
          expectedDeliveryDate: input.expectedDeliveryDate ?? null,
          note: input.note ?? null,
          ...ZERO_TOTALS,
        })
        .returning()
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw orderIdTaken(input.id)
    throw err
  }
  if (!order)
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'order insert returned nothing' })
  return order
}

function orderIdTaken(id: string): ORPCError<'CONFLICT', undefined> {
  return new ORPCError('CONFLICT', { message: `order ${id} already exists` })
}

/** Drizzle wraps driver errors; the SQLSTATE is on `cause.code`. 23505 = unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23505' || e.cause?.code === '23505'
}

/**
 * The gates that stand between `submitted` and `confirmed` (§6). Empty means the order confirms itself.
 *  - credit_limit: the shop's mode enforces and this order pushes it past its limit
 *  - bargain: a rate on this order is still waiting for a decision
 *  - below_floor: a line is charged under its tier price with nothing approved that explains it
 */
export async function approvalFlags(
  tx: Db,
  order: OrderRow,
  lines: OrderLineRow[],
): Promise<ApprovalKind[]> {
  const flags: ApprovalKind[] = []
  const credit = await checkCredit(tx, order.retailerId, order.totalPaise)
  if (credit.breached) flags.push('credit_limit')
  if (await hasPendingBargain(tx, order, lines)) flags.push('bargain')
  const below = lines.some(
    (l) =>
      l.ratePaise < l.listRatePaise &&
      !l.appliedRules.some((r) => r.kind === 'bargain' || r.kind === 'override'),
  )
  if (below) flags.push('below_floor')
  return flags
}

/** Pricing owns `bargain_requests`; this is a read-only peek until PricingModule exposes a lookup. */
async function hasPendingBargain(tx: Db, order: OrderRow, lines: OrderLineRow[]): Promise<boolean> {
  const variantIds = [...new Set(lines.map((l) => l.variantId))]
  if (variantIds.length === 0) return false
  const [row] = await tx
    .select({ id: bargainRequests.id })
    .from(bargainRequests)
    .where(
      and(
        eq(bargainRequests.retailerId, order.retailerId),
        eq(bargainRequests.status, 'requested'),
        inArray(bargainRequests.variantId, variantIds),
        or(isNull(bargainRequests.orderId), eq(bargainRequests.orderId, order.id)),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** Pieces a location can still promise, from the ATP view (on hand − reserved) that reps also see. */
export async function availablePcs(tx: Db, variantId: string, locationId: string): Promise<number> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select coalesce(sum(available), 0)::bigint as available from sellable_stock
    where tenant_id = ${tenantId} and variant_id = ${variantId} and location_id = ${locationId}`)
  const row = result.rows[0] as { available: string | number } | undefined
  return Number(row?.available ?? 0)
}

/** Where an order ships from when it names no location of its own. */
export async function warehouseLocation(tx: Db): Promise<string> {
  const { tenantId } = currentTenant()
  const [location] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.tenantId, tenantId),
        eq(locations.kind, 'warehouse'),
        eq(locations.active, true),
      ),
    )
    .orderBy(asc(locations.id))
    .limit(1)
  if (!location)
    throw new ORPCError('BAD_REQUEST', {
      message: 'this tenant has no active warehouse location (bootstrap it first)',
    })
  return location.id
}

/**
 * The audit spine: one row per state change, with the device that caused it.
 *
 * `order_state_transitions` is staff-write under RLS (`staffWritePolicy`), yet a retailer cancelling its own
 * draft is a real state change that must still be audited. For that one statement `app.actor_role` becomes
 * `system` and the caller's role is restored immediately, inside the same transaction; `actor_id` still
 * records the retailer. Delete this branch once the schema gives transitions a retailer-write policy.
 */
/**
 * Run `fn` with `app.actor_role = 'system'` for the duration, restoring the caller's role afterwards
 * inside the same transaction. The escalation the retailer paths need: a shop's own submit reserves
 * stock and moves its order to `confirmed` (both staff-only at the database), exactly as a rep's
 * submit does, while `actor_id` keeps recording the shopkeeper. Re-entrant: an inner call inside an
 * escalated transaction is a plain call, so the outer escalation is never dropped half-way.
 */
const escalated = new WeakSet<object>()

export async function asSystem<T>(tx: Db, fn: () => Promise<T>): Promise<T> {
  const ctx = currentTenant()
  if (ctx.actorRole === 'system' || escalated.has(tx)) return fn()
  escalated.add(tx)
  try {
    await tx.execute(sql`select set_config('app.actor_role', 'system', true)`)
    return await fn()
  } finally {
    escalated.delete(tx)
    await tx
      .execute(sql`select set_config('app.actor_role', ${ctx.actorRole}, true)`)
      .catch(() => undefined)
  }
}

export async function recordTransition(
  tx: Db,
  order: OrderRow,
  fromState: OrderState,
  toState: OrderState,
  event: OrderEvent,
  deviceId: string | null,
  reason: string | null,
): Promise<void> {
  const ctx = currentTenant()
  const values = {
    id: uuidv7(),
    tenantId: ctx.tenantId,
    orderId: order.id,
    fromState,
    toState,
    event,
    actorId: ctx.actorId,
    deviceId,
    reason,
  }
  if (ctx.actorRole !== 'retailer') {
    await tx.insert(orderStateTransitions).values(values)
    return
  }
  await asSystem(tx, () => tx.insert(orderStateTransitions).values(values))
}

/**
 * Other modules react to orders through these events, never by reading `sales_orders` (§4.1).
 * `OrderPacked` arrived with the billing slice's `markPacked`; the warehouse slice (coordination §3.9)
 * added `OrderPicking` and `OrderDispatched` with `applyFulfilmentEvent`, which now supersedes it.
 * The delivery slice added the three doorstep outcomes (`applyFulfilmentEvent('deliver_all' |
 * 'deliver_partial' | 'return_undelivered')`); notifications, reporting and incentives consume them.
 */
export type OrderEventType =
  | 'OrderSubmitted'
  | 'OrderConfirmed'
  | 'OrderCancelled'
  | 'OrderPicking'
  | 'OrderPacked'
  | 'OrderDispatched'
  | 'OrderDelivered'
  | 'OrderPartiallyDelivered'
  | 'OrderReturnedUndelivered'

export async function emitOrderEvent(
  tx: Db,
  order: OrderRow,
  eventType: OrderEventType,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    id: uuidv7(),
    tenantId: currentTenant().tenantId,
    aggregateType: 'sales_order',
    aggregateId: order.id,
    eventType,
    payload: {
      orderId: order.id,
      orderNo: order.orderNo,
      retailerId: order.retailerId,
      state: order.state,
      totalPaise: order.totalPaise,
    },
  })
}

const istStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`)
const istEnd = (date: string): Date => new Date(`${date}T23:59:59.999+05:30`)

/** A retailer-role caller sees only its own shops' orders — RLS decides that, this only shapes the query. */
export async function listOrders(
  tx: Db,
  input: z.infer<typeof OrdersListInput>,
): Promise<z.infer<typeof OrdersListOutput>> {
  const filters: (SQL | undefined)[] = [
    input.state ? eq(salesOrders.state, input.state) : undefined,
    input.states && input.states.length > 0 ? inArray(salesOrders.state, input.states) : undefined,
    // "pending undelivered" on the shop card (docs/23 §8.15): still travelling.
    input.openOnly
      ? inArray(salesOrders.state, ['submitted', 'confirmed', 'picking', 'packed', 'dispatched'])
      : undefined,
    input.retailerId ? eq(salesOrders.retailerId, input.retailerId) : undefined,
    input.salespersonId ? eq(salesOrders.salespersonId, input.salespersonId) : undefined,
    input.from ? gte(salesOrders.createdAt, istStart(input.from)) : undefined,
    input.to ? lte(salesOrders.createdAt, istEnd(input.to)) : undefined,
    input.q
      ? or(ilike(salesOrders.orderNo, `%${input.q}%`), ilike(salesOrders.note, `%${input.q}%`))
      : undefined,
    input.cursor ? lt(salesOrders.id, input.cursor) : undefined,
  ]
  const rows = await tx
    .select()
    .from(salesOrders)
    .where(and(...filters.filter((f): f is SQL => f !== undefined)))
    .orderBy(desc(salesOrders.id))
    .limit(input.limit + 1)
  const items = rows.slice(0, input.limit).map(toOrder)
  const last = items[items.length - 1]
  return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
}
