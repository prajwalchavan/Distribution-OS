import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, ilike, inArray, lte, notInArray, or, sql, type SQL } from 'drizzle-orm'
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
  orderStateTransitions,
  outboxEvents,
  salesOrders,
  type ActorRole,
  type CreditNotice,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { fulfilPlaceRefusal, reservableLocationId } from '../inventory/index.js'
import { pendingBargainsForOrder, type QuoteService } from '../pricing/index.js'
import {
  checkCredit,
  loadRetailerCredit,
  lockShopCredit,
  type CreditVerdict,
  type RetailerCredit,
} from '../receivables/index.js'
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
  /**
   * Set ONLY by the van sale's own door (`VanSalesService.create`), which serves its order from its trip's van. No
   * contract carries it, so a rep, the desk, the shop's app, a repeat or a device upload never names a van
   * (architect ruling of 2026-09-28, the last stock row).
   */
  vanSale?: boolean | undefined
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
  // QA DOS-352 (ruling 2): an order is packed from a godown, never from the damaged bin, the dock or a shop's floor;
  // and never from a van, unless it is the van sale's own order (architect ruling of 2026-09-28, the last stock
  // row; QA verify 4, N1). Refused before anything is written: 409 for one of this distributor's places that no
  // order is served from, 400 for an id that is not one of its places.
  if (input.fulfilFromLocationId) {
    const refusal = await fulfilPlaceRefusal(tx, input.fulfilFromLocationId, {
      vanSale: input.vanSale === true && input.source === 'van_sale',
    })
    if (refusal)
      throw new ORPCError(refusal.kind === null ? 'BAD_REQUEST' : 'CONFLICT', {
        message: refusal.message,
        data: { code: refusal.code, locationId: refusal.locationId },
      })
  }
  const [clash] = await tx.select().from(salesOrders).where(eq(salesOrders.id, input.id))
  if (clash) throw orderIdTaken(input.id)
  const credit = await loadRetailerCredit(tx, input.retailerId)
  // QA DOS-315: a deactivated shop takes no new order, from any door that drafts one.
  if (!credit.active) throw shopInactive(credit.name)
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

/**
 * AN ORDER STORED WITH A PLACE NO ORDER IS PACKED FROM (QA DOS-352, ruling 2): drafted before the draft check
 * existed — the QA lane's V8 order named the damaged bin, and its twelve damaged pieces were picked, packed and
 * billed — or written by any path that check does not see. Submit and confirm refuse it before a number is
 * allocated or a piece is held; the desk cancels it and places it again, and it is packed from the godown.
 */
export async function assertPackablePlace(
  tx: Db,
  order: OrderRow,
  options: { vanSale?: boolean } = {},
): Promise<void> {
  if (!order.fulfilFromLocationId) return
  // The van sale's own order is submitted and confirmed inside its own door, off its trip's van; any other order
  // naming a van — one drafted before the ruling, or written by a path the draft check does not see — is refused
  // here when it is sent and when it is confirmed (architect ruling of 2026-09-28, the last stock row).
  const refusal = await fulfilPlaceRefusal(tx, order.fulfilFromLocationId, {
    vanSale: options.vanSale === true && order.source === 'van_sale',
  })
  if (!refusal) return
  const which = order.orderNo ? `Order ${order.orderNo}` : 'This order'
  throw new ORPCError('CONFLICT', {
    message: `${which} is set to be packed from ${refusal.name ?? `location ${refusal.locationId}`}: ${refusal.why} Cancel it and place it again without a location; it is then packed from the godown.`,
    data: { code: refusal.code, locationId: refusal.locationId },
  })
}

function orderIdTaken(id: string): ORPCError<'CONFLICT', undefined> {
  return new ORPCError('CONFLICT', { message: `order ${id} already exists` })
}

/**
 * QA DOS-315 (architect ruling 6, 2026-09-28): a shop the owner deactivated takes no new order — from the
 * rep, the desk, the shop's own app, "order again", a van sale or a device upload (which records it as a
 * sync error). The orders it already has can still be billed, delivered or cancelled.
 */
export function shopInactive(name: string): ORPCError<'CONFLICT', { code: 'shop_inactive' }> {
  return new ORPCError('CONFLICT', {
    message: `${name} is deactivated and takes no new order. Its open orders can still be billed, delivered or cancelled; ask the owner to reactivate the shop to order again.`,
    data: { code: 'shop_inactive' },
  })
}

/**
 * QA DOS-314 (architect ruling 5, 2026-09-28): "stop" means stop. An order on credit for a shop whose
 * credit the owner stopped is refused when it is placed, and a hold already waiting cannot be approved —
 * not by the manager, not by the owner. Only changing the shop's credit mode lifts it.
 */
export function creditStopped(
  name: string,
  orderNo: string | null,
  at: 'place' | 'approve',
): ORPCError<'CONFLICT', { code: 'credit_stopped' }> {
  // The shop's own app carries no credit policy (ADR 0006), and to a shopkeeper "the owner" is himself:
  // it is told what it can do, in its own terms, with the same code.
  if (currentTenant().actorRole === 'retailer')
    return new ORPCError('CONFLICT', {
      message: `Your distributor is not taking orders on credit for ${name} right now. Please call your distributor to place this order.`,
      data: { code: 'credit_stopped' },
    })
  const what =
    at === 'place'
      ? 'no order on credit can be placed for this shop'
      : `${orderNo ?? 'this order'} cannot be approved on credit, by the manager or by the owner`
  const next =
    at === 'place'
      ? 'Only changing the shop’s credit mode lifts it — ask the owner.'
      : 'Reject it, or change the shop’s credit mode first.'
  return new ORPCError('CONFLICT', {
    message: `The owner has stopped credit for ${name}: ${what}. ${next}`,
    data: { code: 'credit_stopped' },
  })
}

/**
 * A pay-on-delivery order of a pay-on-delivery shop (QA DOS-225): the bill says pay on delivery and the
 * crew collects at the stop, so no credit is given. Both must say it — the shop's terms, so a shop on
 * credit cannot slip past its limit by marking one order "on delivery", and the order's, so an order
 * marked for credit is checked as credit. A van sale is the delivery itself: unpaid there is credit.
 */
export function isPayOnDelivery(
  order: Pick<OrderRow, 'paymentTerms' | 'source'>,
  shop: Pick<RetailerCredit, 'paymentTerms'>,
): boolean {
  return order.source !== 'van_sale' && order.paymentTerms === 'ON' && shop.paymentTerms === 'ON'
}

/** Drizzle wraps driver errors; the SQLSTATE is on `cause.code`. 23505 = unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23505' || e.cause?.code === '23505'
}

/**
 * The gates that stand between `submitted` and `confirmed` (§6). Empty means the order confirms itself.
 *  - credit_limit: the shop's mode enforces and this order pushes it past its limit
 *  - bargain: a rate on this order is still waiting for a decision; `bargainIds` lists the requests it waits on,
 *    and submit raises one gate naming each, so deciding the gate decides that request (DOS-005)
 *  - below_floor: a line is charged under its tier price with nothing approved that explains it
 *
 * PAID AT THE DOOR IS NOT CREDIT (QA DOS-240). A van sale whose whole bill is taken there and then in cash
 * or UPI (`paidAtDoorPaise` ≥ the order total) extends the shop no credit: its exposure after the sale is
 * what it was before. The credit gate does not trip for it — a strict shop that is overdue, or a
 * pay-on-delivery counter with credit stopped, may still BUY FOR CASH, which is what "take the money
 * before the goods go in" means (docs/22 2026-09-13, DOS-066). `creditWaived` says the gate would have
 * tripped, so the caller can hold the sale to the full bill; the notice is still recorded as it is for
 * every order. A cheque is not money in hand and never waives the gate; the caller passes nothing for it.
 */
export async function approvalFlags(
  tx: Db,
  order: OrderRow,
  lines: OrderLineRow[],
  options: { paidAtDoorPaise?: number } = {},
): Promise<{
  flags: ApprovalKind[]
  bargainIds: string[]
  creditNotice: CreditNotice | null
  creditWaived: boolean
}> {
  const flags: ApprovalKind[] = []
  // QA DOS-313: one credit decision per shop at a time, so an order placed at the same moment as
  // another counts it (`lockShopCredit`), then the shop as it stands now.
  await lockShopCredit(tx, order.retailerId)
  const shop = await loadRetailerCredit(tx, order.retailerId)
  if (!shop.active) throw shopInactive(shop.name)
  const payOnDelivery = isPayOnDelivery(order, shop)
  const credit = await checkCredit(tx, order.retailerId, order.totalPaise, { payOnDelivery })
  const paidInFull =
    options.paidAtDoorPaise !== undefined &&
    order.totalPaise > 0 &&
    options.paidAtDoorPaise >= order.totalPaise
  // QA DOS-314: credit stopped refuses an order on credit where it is placed. A van sale keeps its own
  // refusal (it holds on the flag below and says "take the money now" in the crew's words), and one
  // paid in full at the door is not credit at all.
  if (credit.creditStopped && !payOnDelivery && !paidInFull && order.source !== 'van_sale')
    throw creditStopped(shop.name, order.orderNo, 'place')
  const creditWaived = credit.breached && paidInFull
  if (credit.breached && !paidInFull) flags.push('credit_limit')
  const creditNotice = creditNoticeOf(credit)
  const bargainIds = await pendingBargainsForOrder(tx, {
    retailerId: order.retailerId,
    orderId: order.id,
    variantIds: [...new Set(lines.map((l) => l.variantId))],
  })
  if (bargainIds.length > 0) flags.push('bargain')
  const below = lines.some(
    (l) =>
      l.ratePaise < l.listRatePaise &&
      !l.appliedRules.some((r) => r.kind === 'bargain' || r.kind === 'override'),
  )
  if (below) flags.push('below_floor')
  return { flags, bargainIds, creditNotice, creditWaived }
}

/**
 * DOS-081 (founder, 2026-09-13): a "warn at the limit" shop's order over its limit goes through and
 * the desk sees a NOTICE on it; strict and stop are held by the `credit_limit` gate and carry the same
 * notice. The flag list keeps meaning gates — an indicate breach adds none, so submit's
 * `flags.length === 0` auto-confirm is untouched. One builder, so the notice written at submit and the
 * one written when a later decision holds the order for credit (QA DOS-313) read alike.
 */
export function creditNoticeOf(credit: CreditVerdict): CreditNotice | null {
  if (credit.reasons.length === 0 && !credit.breached) return null
  return {
    creditMode: credit.creditMode,
    reasons: [...credit.reasons],
    outstandingPaise: credit.outstandingPaise,
    creditLimitPaise: credit.creditLimitPaise,
    headroomPaise: credit.headroomPaise,
    overdueDays: credit.overdueDays,
    orderTotalPaise: credit.orderTotalPaise,
    unbilledOrdersPaise: credit.unbilledOrdersPaise ?? 0,
    unallocatedCreditPaise: credit.unallocatedCreditPaise ?? 0,
    exposurePaise: credit.exposurePaise ?? 0,
    creditStopped: credit.creditStopped ?? false,
    payOnDelivery: credit.payOnDelivery ?? false,
  }
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

/** Where an order ships from when it names no location of its own: inventory's one godown rule (DOS-074). */
export async function warehouseLocation(tx: Db): Promise<string> {
  return reservableLocationId(tx)
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
  | 'OrderUnpacked'

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
      /**
       * Who booked it and what the office said (QA DOS-191). Notifications reads the event and never
       * `sales_orders`, so the rep it has to tell, and the sentence to tell them, travel on it.
       */
      salespersonId: order.salespersonId,
      cancelReason: order.cancelReason,
      refused: order.refusedAt !== null,
    },
  })
}

const istStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`)
const istEnd = (date: string): Date => new Date(`${date}T23:59:59.999+05:30`)

/**
 * Whether the signed-in caller reaches this order through the order procedures (DOS-073). A salesperson
 * reaches only the orders credited to it (`salesperson_id = me`), the same rule as the device pull in
 * `orders.module.ts`. Staff RLS on `sales_orders` is tenant-wide on purpose (billing, warehouse, delivery
 * and reporting read every order), so the rule lives here and not in a policy. No other role changes: a
 * retailer stays with RLS plus `assertRetailerOwns`, the desk reaches the whole tenant. A caller that is
 * not reached is answered exactly as for an id that does not exist.
 */
export function callerReaches(order: Pick<OrderRow, 'salespersonId'>): boolean {
  const ctx = currentTenant()
  return ctx.actorRole !== 'salesperson' || order.salespersonId === ctx.actorId
}

/**
 * Who places, re-lines, repeats, submits and cancels an order through the five order procedures and the
 * device-upload doors (DOS-115): the owner, the manager, the rep and the shop, plus `system` for the worker
 * and the escalation pattern. The godown and the crew take no order — the crew's van sale drafts through
 * `insertDraft` under `delivery.vanSales.create` (DOORSTEP) — and neither does the accountant. It mirrors
 * `ORDER_PLACERS` in `@dos/contracts` permissions.ts, the tuple the gate enforces first; the DOS-115 block
 * of orders.spec.ts pins the two together. Reads (`get`, `list`) stay with every member.
 */
export const ORDER_PLACERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'salesperson',
  'retailer',
  'system',
]

/**
 * A retailer-role caller sees only its own shops' orders — RLS decides that, this only shapes the query.
 * A salesperson's list is always its own (DOS-073, `callerReaches`): its `salespersonId` filter is forced
 * to the caller, so naming a colleague cannot widen it.
 */
export async function listOrders(
  tx: Db,
  input: z.infer<typeof OrdersListInput>,
): Promise<z.infer<typeof OrdersListOutput>> {
  const ctx = currentTenant()
  const salespersonId = ctx.actorRole === 'salesperson' ? ctx.actorId : input.salespersonId
  const filters: (SQL | undefined)[] = [
    /*
     * RLS is the guarantee; the literal is what lets the planner start from the tenant-led
     * `sales_orders_created_idx (tenant_id, created_at, id)` instead of scanning the table (docs/20 rule 8).
     */
    eq(salesOrders.tenantId, ctx.tenantId),
    input.state ? eq(salesOrders.state, input.state) : undefined,
    input.states && input.states.length > 0 ? inArray(salesOrders.state, input.states) : undefined,
    // "pending undelivered" on the shop card (docs/23 §8.15): still travelling.
    input.openOnly
      ? inArray(salesOrders.state, ['submitted', 'confirmed', 'picking', 'packed', 'dispatched'])
      : undefined,
    input.retailerId ? eq(salesOrders.retailerId, input.retailerId) : undefined,
    salespersonId ? eq(salesOrders.salespersonId, salespersonId) : undefined,
    input.from ? gte(salesOrders.createdAt, istStart(input.from)) : undefined,
    input.to ? lte(salesOrders.createdAt, istEnd(input.to)) : undefined,
    input.q
      ? or(ilike(salesOrders.orderNo, `%${input.q}%`), ilike(salesOrders.note, `%${input.q}%`))
      : undefined,
    /*
     * Keyset on the cursor order's own (created_at, id), read inside this tenant's transaction with its
     * own tenant fence, so the comparison keeps Postgres's microseconds and no other distributor's row
     * can anchor a page. An unknown cursor matches nothing (DOS-009, the DOS-023/DOS-133 convention).
     */
    input.cursor
      ? sql`(${salesOrders.createdAt}, ${salesOrders.id}) < (select c.created_at, c.id from sales_orders c where c.tenant_id = ${ctx.tenantId} and c.id = ${input.cursor})`
      : undefined,
  ]
  const rows = await tx
    .select()
    .from(salesOrders)
    .where(and(...filters.filter((f): f is SQL => f !== undefined)))
    /*
     * Newest first by SERVER time (DOS-009), the same column `from`/`to` filters on, so the window and
     * the order never disagree. Ids are minted on the device and the demo seed's are hashes, so id order
     * is not age: a back-dated import sorted above every order placed today.
     */
    .orderBy(desc(salesOrders.createdAt), desc(salesOrders.id))
    .limit(input.limit + 1)
  // DOS-078: the shortage record is office-only, exactly as on `get`.
  const office = ctx.actorRole !== 'retailer'
  const items = rows.slice(0, input.limit).map((row) => toOrder(row, office))
  const last = items[items.length - 1]
  return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
}

/**
 * The shop's most recently PLACED order (DOS-098): by when it was placed, `coalesce(submitted_at, created_at)`,
 * never a draft or a cancelled order, and never by id — a seeded or imported id is not a date, and even a client
 * UUIDv7 is minted when the draft starts, not when it is sent. Any author and any placed source counts. The
 * explicit tenant predicate lets `sales_orders_retailer_idx (tenant_id, retailer_id, created_at)` narrow to one
 * shop before the top-1 sort; RLS still applies through the caller's `withTenant` transaction. `salespersonId`
 * keeps a rep to the orders credited to it (the DOS-073 reach rule of `callerReaches`); `repeatLast` passes none.
 */
export async function lastPlacedOrder(
  tx: Db,
  retailerId: string,
  salespersonId?: string,
): Promise<OrderRow | undefined> {
  const [row] = await tx
    .select()
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.tenantId, currentTenant().tenantId),
        eq(salesOrders.retailerId, retailerId),
        notInArray(salesOrders.state, ['draft', 'cancelled']),
        salespersonId === undefined ? undefined : eq(salesOrders.salespersonId, salespersonId),
      ),
    )
    .orderBy(
      desc(sql`coalesce(${salesOrders.submittedAt}, ${salesOrders.createdAt})`),
      desc(salesOrders.id),
    )
    .limit(1)
  return row
}
