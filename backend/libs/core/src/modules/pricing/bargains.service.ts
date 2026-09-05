import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, eq, gt, isNull, or, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  Bargain,
  BargainsListInput,
  BargainsListOutput,
  DecideBargainInput,
  DecideBargainOutput,
  RequestBargainInput,
  RequestBargainOutput,
} from '@dos/contracts'
import {
  bargainRequests,
  repAutoApproveBounds,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import {
  ANY_MEMBER,
  currentTenant,
  DB,
  idempotent,
  MANAGEMENT,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'
import { QuoteService, todayIst } from './quote.service.js'

type RequestIn = z.infer<typeof RequestBargainInput>
type RequestOut = z.infer<typeof RequestBargainOutput>
type DecideIn = z.infer<typeof DecideBargainInput>
type DecideOut = z.infer<typeof DecideBargainOutput>
type ListIn = z.infer<typeof BargainsListInput>
type ListOut = z.infer<typeof BargainsListOutput>

/**
 * A retailer asks for a lower rate. A rep's request within its `rep_auto_approve_bounds` is auto-approved on the
 * spot (the bound is checked server-side, never trusted from the device); anything else waits for the back
 * office. Approved bargains feed `quote` as the last step of the engine (ADR 0008).
 */
@Injectable()
export class BargainsService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    private readonly quotes: QuoteService,
  ) {}

  async request(input: RequestIn): Promise<RequestOut> {
    requireRole([...STAFF, 'retailer'])
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const retailer = await this.quotes.loadRetailer(tx, ctx, input.retailerId)
        const variants = await this.quotes.loadVariants(tx, ctx, [input.variantId])
        const variant = variants.get(input.variantId)
        if (!variant)
          throw new ORPCError('BAD_REQUEST', { message: `Unknown variant ${input.variantId}` })
        const rules = await this.quotes.loadInputs(tx, ctx, retailer, [input.variantId], {
          pricingDate: todayIst(),
        })
        const listRate = rules.overrides[0]?.ratePaise ?? rules.tierPrices[input.variantId]
        if (listRate === undefined)
          throw new ORPCError('BAD_REQUEST', { message: `No price for variant ${input.variantId}` })
        if (input.askedRatePaise >= listRate)
          throw new ORPCError('BAD_REQUEST', {
            message: `Asked rate must be below the current rate (${listRate} paise)`,
          })

        const decision = await this.autoDecision(tx, ctx, {
          brandId: variant.brandId,
          listRate,
          asked: input.askedRatePaise,
          qtyPcs: input.qtyPcs,
        })
        const now = new Date()
        const [row] = await tx
          .insert(bargainRequests)
          .values({
            id: input.id,
            tenantId: ctx.tenantId,
            retailerId: retailer.id,
            variantId: input.variantId,
            orderId: input.orderId ?? null,
            requestedBy: ctx.actorId,
            listRatePaise: listRate,
            askedRatePaise: input.askedRatePaise,
            approvedRatePaise: decision ? input.askedRatePaise : null,
            status: decision ?? 'requested',
            decidedBy: decision ? ctx.actorId : null,
            decidedAt: decision ? now : null,
            note: input.note ?? null,
          })
          .onConflictDoNothing()
          .returning()
        if (!row) throw new ORPCError('CONFLICT', { message: `Bargain ${input.id} already exists` })
        return { item: toBargain(row) }
      }),
    )
  }

  /**
   * `approved` for the back office (they could approve it themselves), `auto_approved` for a rep inside its
   * bound (brand-specific bound first, then the general one), otherwise null = needs a decision.
   * A retailer asking for itself always waits.
   */
  private async autoDecision(
    tx: Db,
    ctx: TenantContext,
    p: { brandId: string | null; listRate: number; asked: number; qtyPcs: number | undefined },
  ): Promise<'approved' | 'auto_approved' | null> {
    // Only the owner and the manager file a bargain already approved (the database's
    // bargain_requests insert policy says the same); the accountant's request waits like a rep's.
    if (MANAGEMENT.includes(ctx.actorRole)) return 'approved'
    if (ctx.actorRole === 'retailer' || ctx.actorRole === 'accountant') return null
    const bounds = await tx
      .select()
      .from(repAutoApproveBounds)
      .where(
        and(
          eq(repAutoApproveBounds.tenantId, ctx.tenantId),
          eq(repAutoApproveBounds.userId, ctx.actorId),
          p.brandId
            ? or(eq(repAutoApproveBounds.brandId, p.brandId), isNull(repAutoApproveBounds.brandId))
            : isNull(repAutoApproveBounds.brandId),
        ),
      )
    const bound = bounds.find((b) => b.brandId !== null) ?? bounds.find((b) => b.brandId === null)
    if (!bound) return null
    const discountBps = Math.ceil(((p.listRate - p.asked) * 10_000) / p.listRate)
    if (discountBps > bound.maxDiscountBps) return null
    if (bound.maxOrderDiscountPaise !== null) {
      if (p.qtyPcs === undefined) return null
      if ((p.listRate - p.asked) * p.qtyPcs > bound.maxOrderDiscountPaise) return null
    }
    return 'auto_approved'
  }

  /** Owner and manager decide (docs/22 2026-09-05: the accountant decides no approval). */
  async decide(input: DecideIn): Promise<DecideOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [existing] = await tx
          .select()
          .from(bargainRequests)
          .where(and(eq(bargainRequests.tenantId, ctx.tenantId), eq(bargainRequests.id, input.id)))
        if (!existing)
          throw new ORPCError('NOT_FOUND', { message: `Bargain ${input.id} not found` })
        if (existing.status !== 'requested')
          throw new ORPCError('CONFLICT', { message: `Bargain is already ${existing.status}` })
        const approvedRate = input.approvedRatePaise ?? existing.askedRatePaise
        if (input.decision === 'approve' && approvedRate > existing.listRatePaise)
          throw new ORPCError('BAD_REQUEST', {
            message: 'Approved rate cannot exceed the list rate',
          })
        const [row] = await tx
          .update(bargainRequests)
          .set({
            status: input.decision === 'approve' ? 'approved' : 'rejected',
            approvedRatePaise: input.decision === 'approve' ? approvedRate : null,
            decidedBy: ctx.actorId,
            decidedAt: new Date(),
            note: input.note ?? existing.note,
            updatedAt: new Date(),
          })
          .where(eq(bargainRequests.id, existing.id))
          .returning()
        if (!row) throw new Error('bargain decision returned nothing')
        return { item: toBargain(row) }
      }),
    )
  }

  /** The shop reads the outcome of its own requests (RLS `bargain_requests_read` narrows it); staff read all. */
  async list(input: ListIn): Promise<ListOut> {
    requireRole(ANY_MEMBER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(bargainRequests.tenantId, ctx.tenantId),
        input.status ? eq(bargainRequests.status, input.status) : undefined,
        input.retailerId ? eq(bargainRequests.retailerId, input.retailerId) : undefined,
        input.cursor ? gt(bargainRequests.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(bargainRequests)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(bargainRequests.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toBargain)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }
}

function toBargain(row: typeof bargainRequests.$inferSelect): Bargain {
  return {
    id: row.id,
    retailerId: row.retailerId,
    variantId: row.variantId,
    orderId: row.orderId,
    requestedBy: row.requestedBy,
    listRatePaise: row.listRatePaise,
    askedRatePaise: row.askedRatePaise,
    approvedRatePaise: row.approvedRatePaise,
    status: row.status,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }
}
