import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, eq, gt, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  OverridesListInput,
  OverridesListOutput,
  PriceList,
  PriceListItem,
  PriceListsListInput,
  PriceListsListOutput,
  RepBound,
  RetailerPriceOverride,
  SetBoundInput,
  SetBoundOutput,
  SetPriceListItemsInput,
  SetPriceListItemsOutput,
  UpsertOverrideInput,
  UpsertOverrideOutput,
  UpsertPriceListInput,
  UpsertPriceListOutput,
} from '@dos/contracts'
import {
  priceListItems,
  priceLists,
  repAutoApproveBounds,
  retailerPriceOverrides,
  withTenant,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  OWNER,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'
import { todayIst } from './quote.service.js'

type PriceListsIn = z.infer<typeof PriceListsListInput>
type PriceListsOut = z.infer<typeof PriceListsListOutput>
type PriceListIn = z.infer<typeof UpsertPriceListInput>
type PriceListOut = z.infer<typeof UpsertPriceListOutput>
type SetItemsIn = z.infer<typeof SetPriceListItemsInput>
type SetItemsOut = z.infer<typeof SetPriceListItemsOutput>
type OverridesIn = z.infer<typeof OverridesListInput>
type OverridesOut = z.infer<typeof OverridesListOutput>
type OverrideIn = z.infer<typeof UpsertOverrideInput>
type OverrideOut = z.infer<typeof UpsertOverrideOutput>
type BoundIn = z.infer<typeof SetBoundInput>
type BoundOut = z.infer<typeof SetBoundOutput>

/**
 * Price lists, retailer overrides and rep bounds: inputs of the engine (schemes live in SchemesService).
 * Reads are staff-only (a retailer sees prices only through `quote`); writes are back office, bounds owner only.
 */
@Injectable()
export class PricingService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  // ---------------------------------------------------------------------------------------------- price lists

  async listPriceLists(input: PriceListsIn): Promise<PriceListsOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const lists = await tx
        .select()
        .from(priceLists)
        .where(
          and(
            eq(priceLists.tenantId, ctx.tenantId),
            input.activeOnly ? eq(priceLists.active, true) : undefined,
          ),
        )
        .orderBy(asc(priceLists.name))
      const items =
        input.withItems && lists.length > 0
          ? await tx
              .select()
              .from(priceListItems)
              .where(
                inArray(
                  priceListItems.priceListId,
                  lists.map((l) => l.id),
                ),
              )
              .orderBy(asc(priceListItems.variantId))
          : []
      return {
        items: lists.map((l) =>
          toPriceList(
            l,
            items.filter((i) => i.priceListId === l.id),
          ),
        ),
      }
    })
  }

  async upsertPriceList(input: PriceListIn): Promise<PriceListOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        if (input.validFrom && input.validTo && input.validFrom > input.validTo)
          throw new ORPCError('BAD_REQUEST', { message: 'validFrom must not be after validTo' })
        const values = {
          name: input.name,
          tier: input.tier ?? null,
          isDefault: input.isDefault,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
          active: input.active,
        }
        // one default list per tenant
        if (input.isDefault)
          await tx
            .update(priceLists)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                eq(priceLists.tenantId, ctx.tenantId),
                eq(priceLists.isDefault, true),
                ne(priceLists.id, input.id),
              ),
            )
        const [row] = await tx
          .insert(priceLists)
          .values({ id: input.id, tenantId: ctx.tenantId, ...values })
          .onConflictDoUpdate({ target: priceLists.id, set: { ...values, updatedAt: new Date() } })
          .returning()
        if (!row) throw new Error('price list upsert returned nothing')
        const items = await tx
          .select()
          .from(priceListItems)
          .where(eq(priceListItems.priceListId, row.id))
        return { item: toPriceList(row, items) }
      }),
    )
  }

  async setPriceListItems(input: SetItemsIn): Promise<SetItemsOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [list] = await tx
          .select()
          .from(priceLists)
          .where(and(eq(priceLists.tenantId, ctx.tenantId), eq(priceLists.id, input.priceListId)))
        if (!list)
          throw new ORPCError('NOT_FOUND', { message: `Price list ${input.priceListId} not found` })
        const seen = new Set<string>()
        for (const it of input.items) {
          if (seen.has(it.variantId))
            throw new ORPCError('BAD_REQUEST', { message: `Variant ${it.variantId} appears twice` })
          seen.add(it.variantId)
        }
        await tx
          .insert(priceListItems)
          .values(
            input.items.map((it) => ({
              id: it.id,
              tenantId: ctx.tenantId,
              priceListId: list.id,
              variantId: it.variantId,
              ratePaise: it.ratePaise,
              inclusiveOfGst: it.inclusiveOfGst,
            })),
          )
          .onConflictDoUpdate({
            target: [priceListItems.tenantId, priceListItems.priceListId, priceListItems.variantId],
            set: {
              ratePaise: sql`excluded.rate_paise`,
              inclusiveOfGst: sql`excluded.inclusive_of_gst`,
              updatedAt: new Date(),
            },
          })
        const items = await tx
          .select()
          .from(priceListItems)
          .where(eq(priceListItems.priceListId, list.id))
          .orderBy(asc(priceListItems.variantId))
        return { item: toPriceList(list, items) }
      }),
    )
  }

  // ------------------------------------------------------------------------------------------------ overrides

  async listOverrides(input: OverridesIn): Promise<OverridesOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(retailerPriceOverrides.tenantId, ctx.tenantId),
        input.retailerId ? eq(retailerPriceOverrides.retailerId, input.retailerId) : undefined,
        input.variantId ? eq(retailerPriceOverrides.variantId, input.variantId) : undefined,
        input.on ? lte(retailerPriceOverrides.validFrom, input.on) : undefined,
        input.on
          ? or(
              isNull(retailerPriceOverrides.validTo),
              sql`${retailerPriceOverrides.validTo} >= ${input.on}`,
            )
          : undefined,
        input.cursor ? gt(retailerPriceOverrides.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(retailerPriceOverrides)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(retailerPriceOverrides.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toOverride)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  async upsertOverride(input: OverrideIn): Promise<OverrideOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const validFrom = input.validFrom ?? todayIst()
        if (input.validTo && input.validTo < validFrom)
          throw new ORPCError('BAD_REQUEST', { message: 'validTo must not be before validFrom' })
        const values = {
          retailerId: input.retailerId,
          variantId: input.variantId,
          ratePaise: input.ratePaise,
          final: input.final,
          validFrom,
          validTo: input.validTo ?? null,
          approvedBy: ctx.actorId,
          note: input.note ?? null,
        }
        const [row] = await tx
          .insert(retailerPriceOverrides)
          .values({ id: input.id, tenantId: ctx.tenantId, ...values })
          .onConflictDoUpdate({
            target: retailerPriceOverrides.id,
            set: { ...values, updatedAt: new Date() },
          })
          .returning()
        if (!row) throw new Error('override upsert returned nothing')
        return { item: toOverride(row) }
      }),
    )
  }

  // --------------------------------------------------------------------------------------------------- bounds

  /** Owner only: how far a rep may drop below list (bps) without an approval, optionally per brand. */
  async setBound(input: BoundIn): Promise<BoundOut> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const brandId = input.brandId ?? null
        const values = {
          maxDiscountBps: input.maxDiscountBps,
          maxOrderDiscountPaise: input.maxOrderDiscountPaise ?? null,
        }
        const [existing] = await tx
          .select()
          .from(repAutoApproveBounds)
          .where(
            and(
              eq(repAutoApproveBounds.tenantId, ctx.tenantId),
              eq(repAutoApproveBounds.userId, input.userId),
              brandId
                ? eq(repAutoApproveBounds.brandId, brandId)
                : isNull(repAutoApproveBounds.brandId),
            ),
          )
        const [row] = existing
          ? await tx
              .update(repAutoApproveBounds)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(repAutoApproveBounds.id, existing.id))
              .returning()
          : await tx
              .insert(repAutoApproveBounds)
              .values({
                id: input.id,
                tenantId: ctx.tenantId,
                userId: input.userId,
                brandId,
                ...values,
              })
              .returning()
        if (!row) throw new Error('bound upsert returned nothing')
        return { item: toBound(row) }
      }),
    )
  }
}

// ------------------------------------------------------------------------------------------------------ mappers

/** Drops undefined keys so zod-optional inputs fit the exact jsonb column types. */

function toPriceListItem(row: typeof priceListItems.$inferSelect): PriceListItem {
  return {
    id: row.id,
    priceListId: row.priceListId,
    variantId: row.variantId,
    ratePaise: row.ratePaise,
    inclusiveOfGst: row.inclusiveOfGst,
  }
}

function toPriceList(
  row: typeof priceLists.$inferSelect,
  items: (typeof priceListItems.$inferSelect)[],
): PriceList {
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    isDefault: row.isDefault,
    validFrom: row.validFrom,
    validTo: row.validTo,
    active: row.active,
    items: items.map(toPriceListItem),
  }
}

function toOverride(row: typeof retailerPriceOverrides.$inferSelect): RetailerPriceOverride {
  return {
    id: row.id,
    retailerId: row.retailerId,
    variantId: row.variantId,
    ratePaise: row.ratePaise,
    final: row.final,
    validFrom: row.validFrom,
    validTo: row.validTo,
    approvedBy: row.approvedBy,
    note: row.note,
  }
}

function toBound(row: typeof repAutoApproveBounds.$inferSelect): RepBound {
  return {
    id: row.id,
    userId: row.userId,
    brandId: row.brandId,
    maxDiscountBps: row.maxDiscountBps,
    maxOrderDiscountPaise: row.maxOrderDiscountPaise,
  }
}
