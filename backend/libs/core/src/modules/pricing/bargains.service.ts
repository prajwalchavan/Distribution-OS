import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, eq, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
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
import { formatINR, paise } from '@dos/domain'
import {
  bargainRequests,
  repAutoApproveBounds,
  withTenant,
  type ActorRole,
  type Db,
  type TenantContext,
} from '@dos/db'
import {
  ANY_MEMBER,
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  MANAGEMENT,
  requireDb,
  requireRole,
} from '../../platform/index.js'
import { memberLabels } from '../tenancy/index.js'
import { TenantCatalogService, variantNames, type VariantCostRow } from '../tenant-catalog/index.js'
import { QuoteService, todayIst } from './quote.service.js'

/**
 * QA DOS-336 (docs/22 §8, 2026-09-28, ruling 5): who may ask for a rate — the rep, the shopkeeper, the manager
 * and the owner. The same four the permission matrix names; the service says it again for an in-process caller.
 */
export const RATE_ASKERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'salesperson',
  'retailer',
  'system',
]

/** What a desk decision needs to know about a request's item beyond the request itself. */
export interface RateRequestFacts {
  requestId: string
  requestedBy: string
  requestedByName: string | null
  requestedByRole: string | null
  variantId: string
  itemName: string | null
  retailerId: string
  orderId: string | null
  listRatePaise: number
  askedRatePaise: number
  /** Back office only: the purchase cost a piece, null when none is on record. */
  costPaise: number | null
  belowCost: boolean
}

const rupees = (value: number): string => formatINR(paise(value))

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
    private readonly tenantCatalog: TenantCatalogService,
  ) {}

  async request(input: RequestIn): Promise<RequestOut> {
    requireRole(RATE_ASKERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const retailer = await this.quotes.loadRetailer(tx, ctx, input.retailerId)
        const variants = await this.quotes.loadVariants(tx, ctx, [input.variantId])
        const variant = variants.get(input.variantId)
        if (!variant)
          throw new ORPCError('BAD_REQUEST', { message: `Unknown variant ${input.variantId}` })
        const item = (await variantNames(tx, [input.variantId])).get(input.variantId) ?? 'this item'
        const rules = await this.quotes.loadInputs(tx, ctx, retailer, [input.variantId], {
          pricingDate: todayIst(),
        })
        const listRate = rules.overrides[0]?.ratePaise ?? rules.tierPrices[input.variantId]
        if (listRate === undefined)
          throw new ORPCError('BAD_REQUEST', {
            message: `${item} has no rate on this shop's price list, so there is no rate to ask below; add it to the price list first`,
          })
        // QA DOS-335: nothing is given away for nothing — a mistyped ₹0.01 billed goods at ₹0.00.
        if (input.askedRatePaise <= 0)
          throw new ORPCError('BAD_REQUEST', {
            message: `A rate of ${rupees(input.askedRatePaise)} a piece cannot be asked for ${item}: ask for the rate the shop should pay, above ₹0.00 (its rate today is ${rupees(listRate)})`,
            data: { code: 'rate_not_positive', listRatePaise: listRate },
          })
        if (input.askedRatePaise >= listRate)
          throw new ORPCError('BAD_REQUEST', {
            message: `Asked rate must be below the current rate of ${item} (${rupees(listRate)} a piece)`,
          })

        // QA DOS-335: a rate below what the item cost is approved by the owner alone, and knowingly. Nobody
        // else's ask is approved on the spot below cost — it waits for the owner — and the answer a rep or a
        // shop gets says only that it waits: the cost is read as the system and never leaves this function.
        const cost = await this.costOf(tx, ctx, input.variantId)
        const belowCost = cost !== null && input.askedRatePaise < cost
        if (belowCost && ctx.actorRole === 'owner' && input.confirmBelowCost !== true)
          throw belowCostToConfirm(item, input.askedRatePaise, cost, 'ask')
        const decision = belowCost
          ? ctx.actorRole === 'owner'
            ? 'approved'
            : null
          : await this.autoDecision(tx, ctx, {
              brandId: variant.brandId,
              listRate,
              asked: input.askedRatePaise,
              qtyPcs: input.qtyPcs,
              cost,
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
        return { item: (await this.withFacts(tx, ctx, [toBargain(row)]))[0] ?? toBargain(row) }
      }),
    )
  }

  /**
   * The item's purchase cost a piece — landed, else the purchase rate — or null when none is on record (then
   * the below-cost rule does not apply). `tenant_product_costs` is back office under RLS, so for a rep or a
   * shop the read runs as the system for this one statement; the figure is only compared, never returned to
   * them.
   */
  private async costOf(tx: Db, ctx: TenantContext, variantId: string): Promise<number | null> {
    const read = () => this.tenantCatalog.costsForVariants(tx, [variantId])
    const costs = BACK_OFFICE.includes(ctx.actorRole) ? await read() : await asSystem(tx, ctx, read)
    const row = costs.get(variantId)
    if (!row) return null
    if (row.landedCostPaise > 0) return row.landedCostPaise
    return row.purchaseRatePaise > 0 ? row.purchaseRatePaise : null
  }

  /**
   * QA DOS-336: the facts the desk decides on, for a set of requests — who asked (name and role), the item,
   * and for the back office the cost and whether the asked rate is below it. One lookup per kind for the set.
   */
  async factsFor(
    tx: Db,
    ctx: TenantContext,
    ids: readonly string[],
  ): Promise<Map<string, RateRequestFacts>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map()
    const rows = await tx
      .select()
      .from(bargainRequests)
      .where(and(eq(bargainRequests.tenantId, ctx.tenantId), inArray(bargainRequests.id, unique)))
    const bargains = await this.withFacts(tx, ctx, rows.map(toBargain))
    return new Map(
      bargains.map((b) => [
        b.id,
        {
          requestId: b.id,
          requestedBy: b.requestedBy,
          requestedByName: b.requestedByName ?? null,
          requestedByRole: b.requestedByRole ?? null,
          variantId: b.variantId,
          itemName: b.itemName ?? null,
          retailerId: b.retailerId,
          orderId: b.orderId,
          listRatePaise: b.listRatePaise,
          askedRatePaise: b.askedRatePaise,
          costPaise: b.costPaise ?? null,
          belowCost: b.belowCost ?? false,
        },
      ]),
    )
  }

  /** Names, roles and items on a page of requests; cost and below-cost for the back office only. */
  private async withFacts(tx: Db, ctx: TenantContext, items: Bargain[]): Promise<Bargain[]> {
    if (items.length === 0) return items
    const members = await memberLabels(
      tx,
      items.map((b) => b.requestedBy),
    )
    const names = await variantNames(
      tx,
      items.map((b) => b.variantId),
    )
    const back = BACK_OFFICE.includes(ctx.actorRole)
    const costs = back
      ? await this.tenantCatalog.costsForVariants(
          tx,
          items.map((b) => b.variantId),
        )
      : new Map<string, VariantCostRow>()
    return items.map((b) => {
      const member = members.get(b.requestedBy)
      const facts: Bargain = {
        ...b,
        requestedByName: member?.name ?? null,
        requestedByRole: member?.role ?? null,
        itemName: names.get(b.variantId) ?? null,
      }
      if (!back) return facts
      const row = costs.get(b.variantId)
      const cost =
        row === undefined
          ? null
          : row.landedCostPaise > 0
            ? row.landedCostPaise
            : row.purchaseRatePaise > 0
              ? row.purchaseRatePaise
              : null
      return { ...facts, costPaise: cost, belowCost: cost !== null && b.askedRatePaise < cost }
    })
  }

  /**
   * `approved` for the back office (they could approve it themselves), `auto_approved` for a rep inside its
   * bound (brand-specific bound first, then the general one), otherwise null = needs a decision.
   * A retailer asking for itself always waits.
   */
  private async autoDecision(
    tx: Db,
    ctx: TenantContext,
    p: {
      brandId: string | null
      listRate: number
      asked: number
      qtyPcs: number | undefined
      cost: number | null
    },
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
    // Blind check 1 (minor): where the rep's bound reaches below what the item cost, NO ask on that item is approved
    // on the spot — above cost or below, every one waits for the desk. Deciding per asked rate answered a rep inside
    // the bound "approved" above the cost and "waits" below it, so a few asks told the rep the cost to the paisa.
    const floorRate = p.listRate - Math.floor((bound.maxDiscountBps * p.listRate) / 10_000)
    if (p.cost !== null && floorRate < p.cost) return null
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
        const item = await this.decideInTx(tx, ctx, input)
        if (!item) throw new Error('bargain decision returned nothing')
        return { item: (await this.withFacts(tx, ctx, [item]))[0] ?? item }
      }),
    )
  }

  /**
   * The decision inside the caller's transaction, shared with the approvals queue: a bargain gate
   * (`approvals.entity_type = 'bargain_request'`) decides the request it names with the same answer, so the two
   * records never disagree (DOS-005). The write is a compare-and-set on `status = 'requested'`: neither path
   * locks the request row, and two desks deciding it at once must not both win. `ifStillRequested` is the
   * gate's mode — a request already decided elsewhere keeps that outcome and the answer is null, not a 409.
   */
  async decideInTx(
    tx: Db,
    ctx: TenantContext,
    input: Pick<DecideIn, 'id' | 'decision' | 'approvedRatePaise' | 'note' | 'confirmBelowCost'>,
    opts: { ifStillRequested?: boolean } = {},
  ): Promise<Bargain | null> {
    const [existing] = await tx
      .select()
      .from(bargainRequests)
      .where(and(eq(bargainRequests.tenantId, ctx.tenantId), eq(bargainRequests.id, input.id)))
    if (!existing) throw new ORPCError('NOT_FOUND', { message: `Bargain ${input.id} not found` })
    if (existing.status !== 'requested') {
      if (opts.ifStillRequested) return null
      throw new ORPCError('CONFLICT', { message: `Bargain is already ${existing.status}` })
    }
    const approvedRate = input.approvedRatePaise ?? existing.askedRatePaise
    if (input.decision === 'approve') {
      const item =
        (await variantNames(tx, [existing.variantId])).get(existing.variantId) ?? 'this item'
      if (approvedRate > existing.listRatePaise)
        throw new ORPCError('BAD_REQUEST', {
          message: `The approved rate for ${item} cannot be above the shop's rate of ${rupees(existing.listRatePaise)} a piece; approve that or less, or refuse the request`,
        })
      // QA DOS-335 (ruling 5): never ₹0.00 — refused in words, whoever decides.
      if (approvedRate <= 0)
        throw new ORPCError('BAD_REQUEST', {
          message: `${rupees(approvedRate)} a piece cannot be approved for ${item}: approve a rate above ₹0.00 (the shop asked ${rupees(existing.askedRatePaise)}, its rate is ${rupees(existing.listRatePaise)}), or refuse the request`,
          data: { code: 'rate_not_positive' },
        })
      // Below what the item cost: the owner alone, and only after the screen has said so.
      const cost = await this.costOf(tx, ctx, existing.variantId)
      if (cost !== null && approvedRate < cost) {
        if (ctx.actorRole !== 'owner')
          throw new ORPCError('FORBIDDEN', {
            message: `${rupees(approvedRate)} a piece for ${item} is below what it cost (${rupees(cost)}): only the owner can approve a rate below cost. Leave it for the owner, or approve ${rupees(cost)} or more`,
            data: { code: 'below_cost_owner_only', costPaise: cost },
          })
        if (input.confirmBelowCost !== true) throw belowCostToConfirm(item, approvedRate, cost)
      }
    }
    const now = new Date()
    const [row] = await tx
      .update(bargainRequests)
      .set({
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        approvedRatePaise: input.decision === 'approve' ? approvedRate : null,
        decidedBy: ctx.actorId,
        decidedAt: now,
        note: input.note ?? existing.note,
        updatedAt: now,
      })
      .where(and(eq(bargainRequests.id, existing.id), eq(bargainRequests.status, 'requested')))
      .returning()
    if (row) return toBargain(row)
    // another decision on this request committed between the read above and this write
    if (opts.ifStillRequested) return null
    const [current] = await tx
      .select({ status: bargainRequests.status })
      .from(bargainRequests)
      .where(eq(bargainRequests.id, existing.id))
    throw new ORPCError('CONFLICT', {
      message: `Bargain is already ${current?.status ?? 'decided'}`,
    })
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
      const items = await this.withFacts(tx, ctx, rows.slice(0, input.limit).map(toBargain))
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }
}

/**
 * The requests an order's bargain gate waits on: still `requested`, for this shop and a variant on the order, and
 * asked for this order or for no order at all (a standalone ask applies to every order of the shop). A plain
 * function over the caller's transaction — the pattern orders already uses for receivables' credit check — so
 * submit names each request on its gate without reading pricing's table itself (DOS-005).
 *
 * `bargain_requests.order_id` is a plain id with no foreign key ON PURPOSE (DOS-090): the rep asks for a rate
 * while the order is still a draft on the phone, and `orders.create` writes that id later. The request simply
 * WAITS for that order — it prices no other order of the shop, and `orders.get` answers 404 for its id until
 * the draft is placed, which is what the office screens must say rather than offering a link to nothing.
 */
export async function pendingBargainsForOrder(
  tx: Db,
  p: { retailerId: string; orderId: string; variantIds: readonly string[] },
): Promise<string[]> {
  if (p.variantIds.length === 0) return []
  const rows = await tx
    .select({ id: bargainRequests.id })
    .from(bargainRequests)
    .where(
      and(
        eq(bargainRequests.retailerId, p.retailerId),
        eq(bargainRequests.status, 'requested'),
        inArray(bargainRequests.variantId, [...p.variantIds]),
        or(isNull(bargainRequests.orderId), eq(bargainRequests.orderId, p.orderId)),
      ),
    )
    .orderBy(asc(bargainRequests.id))
  return rows.map((r) => r.id)
}

/**
 * The owner approves (or asks for) a rate below cost without having said so: the sentence that asks her to. An ask is
 * not a decision on a request, so it is worded as an ask (blind check 1, minor).
 */
function belowCostToConfirm(
  item: string,
  rate: number,
  cost: number,
  as: 'approve' | 'ask' = 'approve',
): ORPCError<string, unknown> {
  const again =
    as === 'ask'
      ? `To sell it below cost, ask again saying you mean to sell below cost; or ask ${rupees(cost)} or more`
      : `To sell below cost, approve it again with "sell below cost" ticked; or approve ${rupees(cost)} or more`
  return new ORPCError('CONFLICT', {
    message: `${rupees(rate)} a piece for ${item} is below what it cost (${rupees(cost)}), ${rupees(cost - rate)} a piece under cost. ${again}`,
    data: { code: 'below_cost_confirm', costPaise: cost, ratePaise: rate },
  })
}

/**
 * `app.actor_role = 'system'` for one read, the caller's role restored at once in the same transaction — the
 * pattern `orders.internals.asSystem` uses, here so pricing can compare a rep's ask with a cost the rep may
 * not read. Re-entrant.
 */
const escalated = new WeakSet<object>()
async function asSystem<T>(tx: Db, ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
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
