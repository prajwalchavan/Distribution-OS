import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ConfirmDraftInput,
  ConfirmDraftOutput,
  DraftGetInput,
  DraftGetOutput,
  DraftsListInput,
  DraftsListOutput,
  OrderDraftDetail,
  RejectDraftInput,
  RejectDraftOutput,
} from '@dos/contracts'
import { aiOrderDrafts, withTenant, type Db } from '@dos/db'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import { OrdersService } from '../orders/index.js'
import {
  AI_EVENTS,
  DRAFT_TAKERS,
  DRAFT_TERMINAL,
  emitAiEvent,
  lockDraft,
  ownShopId,
  resolveRetailer,
  type DraftRow,
} from './ai.internals.js'
import {
  orderNumbers,
  retailerNames,
  toDraft,
  toDraftDetail,
  variantIdsOf,
  variantLabels,
} from './ai.mappers.js'

type ListIn = z.infer<typeof DraftsListInput>
type ListOut = z.infer<typeof DraftsListOutput>
type GetIn = z.infer<typeof DraftGetInput>
type GetOut = z.infer<typeof DraftGetOutput>
type ConfirmIn = z.infer<typeof ConfirmDraftInput>
type ConfirmOut = z.infer<typeof ConfirmDraftOutput>
type RejectIn = z.infer<typeof RejectDraftInput>
type RejectOut = z.infer<typeof RejectDraftOutput>

const istStart = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`)
const istEnd = (date: string): Date => new Date(`${date}T23:59:59.999+05:30`)
const defined = <T>(values: (T | undefined)[]): T[] => values.filter((v): v is T => v !== undefined)

/**
 * The draft queue, and the one door from a draft into the order book.
 *
 * `confirm` is the whole point of the module: it runs `orders.create` → `setLines` → `submit` in ONE
 * transaction through `OrdersService`'s transaction-scoped helpers (coordination §4 lets `ai` reach
 * orders through its `index.ts`), so the price engine, the credit verdict, the minimum order value
 * and the approval queue all behave exactly as they do for an order a rep typed. There is no second,
 * softer path into `sales_orders`, and the draft is marked `confirmed` only with a reviewer, a review
 * time and the order id on the row — which `dos_ai_draft_review_guard` (migration 0032) then insists
 * on at the database, so no future code path can confirm a draft without a human.
 *
 * WHO SEES WHICH DRAFT is RLS's decision, not this file's: the desk sees every one, a rep sees the
 * drafts of the shops on its own beats plus whatever it captured itself, and a shop sees only its
 * own. The filters below only shape a query the policy has already narrowed.
 */
@Injectable()
export class DraftsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly orders: OrdersService,
  ) {}

  async list(input: ListIn): Promise<ListOut> {
    requireRole(DRAFT_TAKERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        input.status ? eq(aiOrderDrafts.status, input.status) : undefined,
        input.retailerId ? eq(aiOrderDrafts.retailerId, input.retailerId) : undefined,
        input.source ? eq(aiOrderDrafts.source, input.source) : undefined,
        input.from ? gte(aiOrderDrafts.createdAt, istStart(input.from)) : undefined,
        input.to ? lte(aiOrderDrafts.createdAt, istEnd(input.to)) : undefined,
        input.mine ? eq(aiOrderDrafts.createdBy, ctx.actorId) : undefined,
        input.cursor ? lt(aiOrderDrafts.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(aiOrderDrafts)
        .where(and(...defined(filters)))
        .orderBy(desc(aiOrderDrafts.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const deps = await depsFor(tx, page)
      const last = page[page.length - 1]
      return {
        items: page.map((row) => toDraft(row, deps)),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  async get(input: GetIn): Promise<GetOut> {
    requireRole(DRAFT_TAKERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const [row] = await tx
        .select()
        .from(aiOrderDrafts)
        .where(eq(aiOrderDrafts.id, input.id))
        .limit(1)
      if (!row) throw new ORPCError('NOT_FOUND', { message: `draft ${input.id} not found` })
      return { item: await detailOf(tx, row) }
    })
  }

  /**
   * Confirm the corrected lines: creates and SUBMITS a normal sales order. The lines are the human's,
   * not the parser's — a line the reviewer deleted simply does not appear, and one they added carries
   * no `draftLineNo`. A second confirm with the same key answers the stored result; a confirm on a
   * draft that already became an order is a 409 naming that order.
   */
  async confirm(input: ConfirmIn): Promise<ConfirmOut> {
    requireRole(DRAFT_TAKERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const draft = await lockDraft(tx, input.id)
        if (DRAFT_TERMINAL.has(draft.status))
          throw new ORPCError('CONFLICT', {
            message: `draft ${draft.id} is ${draft.status}`,
            data: { code: 'draft_closed', orderId: draft.createdOrderId },
          })
        const own = await ownShopId(tx)
        if (own && draft.retailerId && draft.retailerId !== own)
          throw new ORPCError('FORBIDDEN', {
            message: 'a shop may only confirm its own draft',
            data: { code: 'not_your_shop' },
          })
        const retailerId = await resolveRetailer(tx, input.retailerId ?? draft.retailerId)
        if (!retailerId)
          throw new ORPCError('BAD_REQUEST', {
            message: 'this draft names no shop; send retailerId with the confirmation',
            data: { code: 'retailer_required' },
          })

        // The order, through the orders module and nothing else: same engine, same gates, same queue.
        const order = await this.orders.insertDraft(tx, {
          id: input.orderId,
          retailerId,
          source: orderSourceFor(draft.source, ctx.actorRole),
          pricingDateMode: 'order',
          expectedDeliveryDate: input.expectedDeliveryDate ?? null,
          note: input.note ?? `From ${draft.source} draft ${draft.id}`,
        })
        const lined = await this.orders.writeLines(
          tx,
          order,
          input.lines.map((line) => ({
            id: line.id,
            variantId: line.variantId,
            enteredQty: line.enteredQty,
            enteredUnit: line.enteredUnit,
          })),
        )
        const submitted = await this.orders.submitInTx(tx, lined, input.deviceId ?? null)

        const now = new Date()
        const [updated] = await tx
          .update(aiOrderDrafts)
          .set({
            status: 'confirmed',
            retailerId,
            createdOrderId: order.id,
            reviewedBy: ctx.actorId,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(eq(aiOrderDrafts.id, draft.id))
          .returning()
        const row = updated ?? draft
        await emitAiEvent(tx, 'ai_order_draft', row.id, AI_EVENTS.draftConfirmed, {
          draftId: row.id,
          orderId: order.id,
          retailerId,
          lineCount: input.lines.length,
        })
        return { item: await detailOf(tx, row), order: submitted.item }
      }),
    )
  }

  /** Throw the draft away, with the reason the database insists on. Nothing is erased. */
  async reject(input: RejectIn): Promise<RejectOut> {
    requireRole(DRAFT_TAKERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const draft = await lockDraft(tx, input.id)
        if (DRAFT_TERMINAL.has(draft.status))
          throw new ORPCError('CONFLICT', {
            message: `draft ${draft.id} is ${draft.status}`,
            data: { code: 'draft_closed' },
          })
        const now = new Date()
        const [updated] = await tx
          .update(aiOrderDrafts)
          .set({
            status: 'rejected',
            rejectReason: input.reason,
            reviewedBy: ctx.actorId,
            reviewedAt: now,
            updatedAt: now,
          })
          .where(eq(aiOrderDrafts.id, draft.id))
          .returning()
        return { item: await detailOf(tx, updated ?? draft) }
      }),
    )
  }
}

/**
 * The order source the confirmed order carries: what the words arrived by, unless a shopkeeper is
 * confirming its own draft in its own app, which is a `retailer_app` order however it arrived.
 */
export function orderSourceFor(
  draftSource: 'whatsapp' | 'voice' | 'text',
  actorRole: string,
): 'salesperson' | 'retailer_app' | 'whatsapp' | 'phone' {
  if (actorRole === 'retailer') return 'retailer_app'
  if (draftSource === 'whatsapp') return 'whatsapp'
  return actorRole === 'salesperson' ? 'salesperson' : 'phone'
}

/** One draft with its lines, names and pack sizes. Shared by every procedure that answers a draft. */
export async function detailOf(tx: Db, row: DraftRow): Promise<OrderDraftDetail> {
  return toDraftDetail(row, await depsFor(tx, [row]))
}

async function depsFor(tx: Db, rows: readonly DraftRow[]) {
  const [names, numbers, variants] = await Promise.all([
    retailerNames(
      tx,
      rows.map((row) => row.retailerId).filter((id): id is string => Boolean(id)),
    ),
    orderNumbers(
      tx,
      rows.map((row) => row.createdOrderId).filter((id): id is string => Boolean(id)),
    ),
    variantLabels(tx, variantIdsOf(rows)),
  ])
  return { retailerNames: names, orderNumbers: numbers, variants }
}
