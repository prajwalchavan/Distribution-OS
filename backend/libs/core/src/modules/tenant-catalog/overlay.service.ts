import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, eq, gt, inArray, notInArray, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  PackConfigsListInput,
  PackConfigsListOutput,
  RepAuthorisation,
  RepAuthorisationsListInput,
  RepAuthorisationsListOutput,
  SetRepAuthorisationsInput,
  SetRepAuthorisationsOutput,
  SupplierPackConfig,
  TenantBrand,
  TenantBrandsListOutput,
  UpsertPackConfigInput,
  UpsertPackConfigOutput,
  UpsertTenantBrandInput,
  UpsertTenantBrandOutput,
} from '@dos/contracts'
import {
  brands,
  memberships,
  repProductAuthorisations,
  supplierPackConfigs,
  suppliers,
  tenantBrands,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  currentTenant,
  DB,
  idempotent,
  isUniqueViolation,
  MANAGEMENT,
  requireDb,
  requireRole,
  STAFF,
  writeAudit,
} from '../../platform/index.js'

type RepListIn = z.infer<typeof RepAuthorisationsListInput>
type RepListOut = z.infer<typeof RepAuthorisationsListOutput>
type RepSetIn = z.infer<typeof SetRepAuthorisationsInput>
type RepSetOut = z.infer<typeof SetRepAuthorisationsOutput>
type BrandsOut = z.infer<typeof TenantBrandsListOutput>
type BrandIn = z.infer<typeof UpsertTenantBrandInput>
type BrandOut = z.infer<typeof UpsertTenantBrandOutput>
type PackListIn = z.infer<typeof PackConfigsListInput>
type PackListOut = z.infer<typeof PackConfigsListOutput>
type PackIn = z.infer<typeof UpsertPackConfigInput>
type PackOut = z.infer<typeof UpsertPackConfigOutput>

/** Buy-side pack sizes are the receiving side's: the desk plus the gate (docs/23 §8.17). */
const PACK_CONFIG_READERS: readonly ActorRole[] = [
  'owner',
  'manager',
  'accountant',
  'warehouse',
  'system',
]

/**
 * The three overlay tables docs/23 §8.17 found without a procedure: which brands a rep may sell
 * (`rep_product_authorisations`), how the distributor runs each brand (`tenant_brands`, docs/17 A1),
 * and the buy-side pack size per supplier and variant (`supplier_pack_configs`). Every write is the
 * owner's and the manager's (docs/22 2026-09-05); none of the three carries a rate.
 */
@Injectable()
export class CatalogOverlayService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  // -------------------------------------------------------------------------------------------------------------
  // rep authorisations

  /** A salesperson reads only its own (`userId` forced to the actor, and RLS says the same). No rows = every listed brand. */
  async listRepAuthorisations(input: RepListIn): Promise<RepListOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const userId = ctx.actorRole === 'salesperson' ? ctx.actorId : input.userId
    return withTenant(db, ctx, (tx) => this.readRepAuthorisations(tx, userId))
  }

  private async readRepAuthorisations(tx: Db, userId: string | undefined): Promise<RepListOut> {
    const ctx = currentTenant()
    const rows = await tx
      .select({ row: repProductAuthorisations, brandName: brands.name })
      .from(repProductAuthorisations)
      .innerJoin(brands, eq(brands.id, repProductAuthorisations.brandId))
      .where(
        and(
          eq(repProductAuthorisations.tenantId, ctx.tenantId),
          userId ? eq(repProductAuthorisations.userId, userId) : undefined,
        ),
      )
      .orderBy(asc(repProductAuthorisations.userId), asc(brands.name))
      .limit(500)
    return { items: rows.map((r) => toRepAuthorisation(r.row, r.brandName)) }
  }

  /**
   * REPLACES a rep's set: brands not in `items` are removed, listed ones upserted under their
   * client-generated row ids; an empty list clears the restriction. The user must be a member of this
   * distributor (the roster is readable by every member). Audited (`rep_authorisations.set`).
   */
  async setRepAuthorisations(input: RepSetIn): Promise<RepSetOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [member] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, input.userId)))
          .limit(1)
        if (!member)
          throw new ORPCError('BAD_REQUEST', { message: 'userId is not a member of this tenant' })
        const brandIds = [...new Set(input.items.map((i) => i.brandId))]
        if (brandIds.length !== input.items.length)
          throw new ORPCError('BAD_REQUEST', { message: 'a brand appears twice in items' })
        if (brandIds.length > 0) {
          const known = await tx
            .select({ id: brands.id })
            .from(brands)
            .where(inArray(brands.id, brandIds))
          if (known.length !== brandIds.length)
            throw new ORPCError('BAD_REQUEST', { message: 'unknown brandId in items' })
        }
        const before = await tx
          .select({ brandId: repProductAuthorisations.brandId })
          .from(repProductAuthorisations)
          .where(
            and(
              eq(repProductAuthorisations.tenantId, ctx.tenantId),
              eq(repProductAuthorisations.userId, input.userId),
            ),
          )
        await tx
          .delete(repProductAuthorisations)
          .where(
            and(
              eq(repProductAuthorisations.tenantId, ctx.tenantId),
              eq(repProductAuthorisations.userId, input.userId),
              brandIds.length > 0
                ? notInArray(repProductAuthorisations.brandId, brandIds)
                : undefined,
            ),
          )
        const now = new Date()
        for (const item of input.items) {
          await tx
            .insert(repProductAuthorisations)
            .values({
              id: item.id,
              tenantId: ctx.tenantId,
              userId: input.userId,
              brandId: item.brandId,
              employedBy: item.employedBy,
            })
            .onConflictDoUpdate({
              target: [
                repProductAuthorisations.tenantId,
                repProductAuthorisations.userId,
                repProductAuthorisations.brandId,
              ],
              set: { employedBy: item.employedBy, updatedAt: now },
            })
        }
        await writeAudit(tx, {
          action: 'rep_authorisations.set',
          entityType: 'user',
          entityId: input.userId,
          before: { brandIds: before.map((b) => b.brandId) },
          after: { brandIds },
        })
        return this.readRepAuthorisations(tx, input.userId)
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // tenant brands

  async listBrands(): Promise<BrandsOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const rows = await tx
        .select({
          row: tenantBrands,
          brandName: brands.name,
          manufacturerId: brands.manufacturerId,
        })
        .from(tenantBrands)
        .innerJoin(brands, eq(brands.id, tenantBrands.brandId))
        .where(eq(tenantBrands.tenantId, ctx.tenantId))
        .orderBy(asc(brands.name))
        .limit(500)
      return { items: rows.map((r) => toTenantBrand(r.row, r.brandName, r.manufacturerId)) }
    })
  }

  /** One row per brand per tenant: `brandId` is the natural key; the client id is used on first insert. */
  async upsertBrand(input: BrandIn): Promise<BrandOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [brand] = await tx
          .select({ id: brands.id, name: brands.name, manufacturerId: brands.manufacturerId })
          .from(brands)
          .where(eq(brands.id, input.brandId))
          .limit(1)
        if (!brand)
          throw new ORPCError('NOT_FOUND', { message: `brand ${input.brandId} not found` })
        const values = {
          fulfilmentMode: input.fulfilmentMode,
          tallyExportSource: input.tallyExportSource,
          cashDiscountMode: input.cashDiscountMode,
          claimChannel: input.claimChannel,
          salesForce: input.salesForce,
        }
        const [existing] = await tx
          .select()
          .from(tenantBrands)
          .where(
            and(eq(tenantBrands.tenantId, ctx.tenantId), eq(tenantBrands.brandId, input.brandId)),
          )
          .limit(1)
        const [row] = await tx
          .insert(tenantBrands)
          .values({ id: input.id, tenantId: ctx.tenantId, brandId: input.brandId, ...values })
          .onConflictDoUpdate({
            target: [tenantBrands.tenantId, tenantBrands.brandId],
            set: { ...values, updatedAt: new Date() },
          })
          .returning()
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'tenant brand upsert returned nothing',
          })
        await writeAudit(tx, {
          action: 'tenant_brand.upsert',
          entityType: 'tenant_brand',
          entityId: row.id,
          before: existing
            ? {
                fulfilmentMode: existing.fulfilmentMode,
                tallyExportSource: existing.tallyExportSource,
                cashDiscountMode: existing.cashDiscountMode,
                claimChannel: existing.claimChannel,
                salesForce: existing.salesForce,
              }
            : null,
          after: values,
        })
        return { item: toTenantBrand(row, brand.name, brand.manufacturerId) }
      }),
    )
  }

  // -------------------------------------------------------------------------------------------------------------
  // supplier pack configs

  async listPackConfigs(input: PackListIn): Promise<PackListOut> {
    requireRole(PACK_CONFIG_READERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(supplierPackConfigs.tenantId, ctx.tenantId),
        input.supplierId ? eq(supplierPackConfigs.supplierId, input.supplierId) : undefined,
        input.variantId ? eq(supplierPackConfigs.variantId, input.variantId) : undefined,
        input.cursor ? gt(supplierPackConfigs.id, input.cursor) : undefined,
      ]
      const rows = await tx
        .select()
        .from(supplierPackConfigs)
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(supplierPackConfigs.id))
        .limit(input.limit + 1)
      const items = rows.slice(0, input.limit).map(toPackConfig)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.id : null }
    })
  }

  /** One row per (supplier, variant): the natural key; the client id lands on first insert. */
  async upsertPackConfig(input: PackIn): Promise<PackOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [supplier] = await tx
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.id, input.supplierId)))
          .limit(1)
        if (!supplier)
          throw new ORPCError('NOT_FOUND', { message: `supplier ${input.supplierId} not found` })
        const values = {
          pcsPerCase: input.pcsPerCase,
          supplierCode: input.supplierCode ?? null,
          supplierDescription: input.supplierDescription ?? null,
          marginBasis: input.marginBasis,
        }
        let row: typeof supplierPackConfigs.$inferSelect | undefined
        try {
          ;[row] = await tx
            .insert(supplierPackConfigs)
            .values({
              id: input.id,
              tenantId: ctx.tenantId,
              supplierId: input.supplierId,
              variantId: input.variantId,
              ...values,
            })
            .onConflictDoUpdate({
              target: [
                supplierPackConfigs.tenantId,
                supplierPackConfigs.supplierId,
                supplierPackConfigs.variantId,
              ],
              set: { ...values, updatedAt: new Date() },
            })
            .returning()
        } catch (err) {
          // The natural key is (supplier, variant) and the upsert above handles it. The only unique
          // key left is the primary key: the client reused an `id` that already names ANOTHER
          // supplier/variant row — a client bug, answered as a conflict, never a 500.
          if (isUniqueViolation(err))
            throw new ORPCError('CONFLICT', {
              message: `pack config id ${input.id} already belongs to another supplier/variant pair; send a fresh id`,
            })
          throw err
        }
        if (!row)
          throw new ORPCError('INTERNAL_SERVER_ERROR', {
            message: 'pack config upsert returned nothing',
          })
        return { item: toPackConfig(row) }
      }),
    )
  }
}

function toRepAuthorisation(
  row: typeof repProductAuthorisations.$inferSelect,
  brandName: string,
): RepAuthorisation {
  return {
    id: row.id,
    userId: row.userId,
    brandId: row.brandId,
    brandName,
    employedBy: row.employedBy as RepAuthorisation['employedBy'],
  }
}

function toTenantBrand(
  row: typeof tenantBrands.$inferSelect,
  brandName: string,
  manufacturerId: string,
): TenantBrand {
  return {
    id: row.id,
    brandId: row.brandId,
    brandName,
    manufacturerId,
    fulfilmentMode: row.fulfilmentMode,
    tallyExportSource: row.tallyExportSource,
    cashDiscountMode: row.cashDiscountMode,
    claimChannel: row.claimChannel,
    salesForce: row.salesForce as TenantBrand['salesForce'],
  }
}

function toPackConfig(row: typeof supplierPackConfigs.$inferSelect): SupplierPackConfig {
  return {
    id: row.id,
    supplierId: row.supplierId,
    variantId: row.variantId,
    pcsPerCase: row.pcsPerCase,
    supplierCode: row.supplierCode,
    supplierDescription: row.supplierDescription,
    marginBasis: row.marginBasis,
  }
}
