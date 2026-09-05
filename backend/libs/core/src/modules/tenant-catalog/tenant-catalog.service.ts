import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, desc, eq, gt, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  CostsListInput,
  CostsListOutput,
  ProductCostSchema,
  SupplierSchema,
  SuppliersListOutput,
  TenantCatalogListInput,
  TenantCatalogListOutput,
  TenantProduct,
  UpsertCostInput,
  UpsertCostOutput,
  UpsertListingInput,
  UpsertListingOutput,
  UpsertSupplierInput,
  UpsertSupplierOutput,
} from '@dos/contracts'
import {
  brands,
  manufacturers,
  productVariants,
  products,
  suppliers,
  tenantProductCosts,
  tenantProducts,
  withTenant,
  type Db,
} from '@dos/db'
import {
  BACK_OFFICE,
  currentTenant,
  DB,
  idempotent,
  MANAGEMENT,
  requireDb,
  requireRole,
  STAFF,
} from '../../platform/index.js'
import { variantSearchPredicate, variantSummaryColumns } from '../catalog/index.js'
import {
  matchVariant,
  restoreListing,
  sellSidePackSizes,
  supplierLabels,
  tallyExportSourceByVariant,
  unlistListing,
  upsertListingFromImport,
  variantLabels,
  type ListingImportResult,
  type ListingImportValues,
  type ListingSnapshot,
  type VariantMatch,
  type VariantProbe,
} from './import.js'

type ListIn = z.infer<typeof TenantCatalogListInput>
type ListOut = z.infer<typeof TenantCatalogListOutput>
type ListingIn = z.infer<typeof UpsertListingInput>
type ListingOut = z.infer<typeof UpsertListingOutput>
type SuppliersOut = z.infer<typeof SuppliersListOutput>
type SupplierIn = z.infer<typeof UpsertSupplierInput>
type SupplierOut = z.infer<typeof UpsertSupplierOutput>
type Supplier = z.infer<typeof SupplierSchema>
type CostsIn = z.infer<typeof CostsListInput>
type CostsOut = z.infer<typeof CostsListOutput>
type CostIn = z.infer<typeof UpsertCostInput>
type CostOut = z.infer<typeof UpsertCostOutput>
type Cost = z.infer<typeof ProductCostSchema>

const listingColumns = {
  ...variantSummaryColumns,
  tenantProductId: tenantProducts.id,
  listed: sql<boolean>`coalesce(${tenantProducts.listed}, false)`,
  localAlias: tenantProducts.localAlias,
  caseSize: sql<number>`coalesce(${tenantProducts.caseSizeOverride}, ${productVariants.defaultCaseSize})`,
  minOrderQty: sql<number>`coalesce(${tenantProducts.minOrderQty}, 1)`,
  orderIncrement: sql<number>`coalesce(${tenantProducts.orderIncrement}, 1)`,
  maxPerOrder: tenantProducts.maxPerOrder,
  sortOrder: sql<number>`coalesce(${tenantProducts.sortOrder}, 0)`,
}

@Injectable()
export class TenantCatalogService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  // =============================================================================================================
  // the surface the generic importer calls (coordination §4: integrations → tenant-catalog), inside the
  // caller's transaction. Thin delegations to `import.ts`; nothing here proposes a global product.
  // =============================================================================================================

  /** Exact EAN → this tenant's alias → one clear trigram name over the global catalog. */
  matchVariant(tx: Db, probe: VariantProbe, limit?: number): Promise<VariantMatch> {
    return matchVariant(tx, probe, limit)
  }

  /** List a variant for the tenant, or update the alias / case size of the listing it has. */
  upsertListingFromImport(
    tx: Db,
    input: { variantId: string; newId: string; values: ListingImportValues },
  ): Promise<ListingImportResult> {
    return upsertListingFromImport(tx, input)
  }

  restoreListing(tx: Db, id: string, before: ListingSnapshot): Promise<void> {
    return restoreListing(tx, id, before)
  }

  unlistListing(tx: Db, id: string): Promise<void> {
    return unlistListing(tx, id)
  }

  /** Sell-side pack size (override else printed case size), HSN and MRP per variant. */
  sellSidePackSizes(tx: Db, variantIds: readonly string[]): ReturnType<typeof sellSidePackSizes> {
    return sellSidePackSizes(tx, variantIds)
  }

  /** Which brands the Tally export must leave out, per variant (`tenant_brands.tally_export_source`). */
  tallyExportSourceByVariant(
    tx: Db,
    variantIds: readonly string[],
  ): Promise<Map<string, 'dos' | 'brand_dms' | 'none'>> {
    return tallyExportSourceByVariant(tx, variantIds)
  }

  variantLabels(tx: Db, ids: readonly string[]): Promise<Map<string, string>> {
    return variantLabels(tx, ids)
  }

  supplierLabels(tx: Db, ids: readonly string[]): ReturnType<typeof supplierLabels> {
    return supplierLabels(tx, ids)
  }

  /** Variants this tenant sells (listedOnly) or the whole catalog with the tenant overlay (for the owner's listing screen). */
  async list(input: ListIn): Promise<ListOut> {
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const filters: (SQL | undefined)[] = [
        variantSearchPredicate(input.q),
        input.brandId ? eq(products.brandId, input.brandId) : undefined,
        input.listedOnly ? eq(tenantProducts.listed, true) : undefined,
        input.cursor ? gt(productVariants.id, input.cursor) : undefined,
      ]
      const base = tx
        .select(listingColumns)
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
        .leftJoin(brands, eq(brands.id, products.brandId))
      const joined = input.listedOnly
        ? base.innerJoin(
            tenantProducts,
            and(
              eq(tenantProducts.variantId, productVariants.id),
              eq(tenantProducts.tenantId, ctx.tenantId),
            ),
          )
        : base.leftJoin(
            tenantProducts,
            and(
              eq(tenantProducts.variantId, productVariants.id),
              eq(tenantProducts.tenantId, ctx.tenantId),
            ),
          )
      const rows = await joined
        .where(and(...filters.filter((f): f is SQL => f !== undefined)))
        .orderBy(asc(productVariants.id))
        .limit(input.limit + 1)
      const items: TenantProduct[] = rows.slice(0, input.limit)
      const last = items[items.length - 1]
      return { items, nextCursor: rows.length > input.limit && last ? last.variantId : null }
    })
  }

  async upsertListing(input: ListingIn): Promise<ListingOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const values = {
          listed: input.listed,
          localAlias: input.localAlias ?? null,
          caseSizeOverride: input.caseSizeOverride ?? null,
          minOrderQty: input.minOrderQty,
          orderIncrement: input.orderIncrement,
          maxPerOrder: input.maxPerOrder ?? null,
          sortOrder: input.sortOrder,
        }
        await tx
          .insert(tenantProducts)
          .values({ id: input.id, tenantId: ctx.tenantId, variantId: input.variantId, ...values })
          .onConflictDoUpdate({
            target: [tenantProducts.tenantId, tenantProducts.variantId],
            set: { ...values, updatedAt: new Date() },
          })
        const [item] = await tx
          .select(listingColumns)
          .from(productVariants)
          .innerJoin(products, eq(products.id, productVariants.productId))
          .innerJoin(manufacturers, eq(manufacturers.id, products.manufacturerId))
          .leftJoin(brands, eq(brands.id, products.brandId))
          .innerJoin(
            tenantProducts,
            and(
              eq(tenantProducts.variantId, productVariants.id),
              eq(tenantProducts.tenantId, ctx.tenantId),
            ),
          )
          .where(eq(productVariants.id, input.variantId))
        if (!item) throw new Error('listing vanished after upsert')
        return { item }
      }),
    )
  }

  async suppliers(): Promise<SuppliersOut> {
    requireRole(STAFF)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const rows = await tx.select().from(suppliers).orderBy(asc(suppliers.name))
      return { items: rows.map(toSupplier) }
    })
  }

  async upsertSupplier(input: SupplierIn): Promise<SupplierOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const values = {
          name: input.name,
          gstin: input.gstin ?? null,
          stateCode: input.stateCode ?? null,
          manufacturerId: input.manufacturerId ?? null,
          phone: input.phone ?? null,
          eInvoicing: input.eInvoicing,
          paymentTermsDays: input.paymentTermsDays ?? null,
          active: input.active,
        }
        const [row] = await tx
          .insert(suppliers)
          .values({ id: input.id, tenantId: ctx.tenantId, ...values })
          .onConflictDoUpdate({ target: suppliers.id, set: { ...values, updatedAt: new Date() } })
          .returning()
        if (!row) throw new Error('supplier upsert returned nothing')
        return { item: toSupplier(row) }
      }),
    )
  }

  /** Owner/manager/accountant only. RLS returns nothing for other roles even if this check were bypassed. */
  async costs(input: CostsIn): Promise<CostsOut> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const rows = await tx
        .select()
        .from(tenantProductCosts)
        .where(input.variantId ? eq(tenantProductCosts.variantId, input.variantId) : undefined)
        .orderBy(desc(tenantProductCosts.effectiveFrom))
        .limit(input.limit)
      return { items: rows.map(toCost) }
    })
  }

  async upsertCost(input: CostIn): Promise<CostOut> {
    requireRole(MANAGEMENT)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [row] = await tx
          .insert(tenantProductCosts)
          .values({
            id: input.id,
            tenantId: ctx.tenantId,
            variantId: input.variantId,
            supplierId: input.supplierId ?? null,
            purchaseRatePaise: input.purchaseRatePaise,
            landedCostPaise: input.landedCostPaise,
            ptdPaise: input.ptdPaise ?? null,
            schemeMarginBps: input.schemeMarginBps ?? null,
          })
          .onConflictDoUpdate({
            target: tenantProductCosts.id,
            set: {
              purchaseRatePaise: input.purchaseRatePaise,
              landedCostPaise: input.landedCostPaise,
              ptdPaise: input.ptdPaise ?? null,
              schemeMarginBps: input.schemeMarginBps ?? null,
              updatedAt: new Date(),
            },
          })
          .returning()
        if (!row) throw new Error('cost upsert returned nothing')
        return { item: toCost(row) }
      }),
    )
  }
}

function toSupplier(row: typeof suppliers.$inferSelect): Supplier {
  return {
    id: row.id,
    name: row.name,
    gstin: row.gstin,
    stateCode: row.stateCode,
    manufacturerId: row.manufacturerId,
    phone: row.phone,
    eInvoicing: row.eInvoicing,
    paymentTermsDays: row.paymentTermsDays,
    active: row.active,
  }
}

function toCost(row: typeof tenantProductCosts.$inferSelect): Cost {
  return {
    id: row.id,
    variantId: row.variantId,
    lotId: row.lotId,
    supplierId: row.supplierId,
    purchaseRatePaise: row.purchaseRatePaise,
    landedCostPaise: row.landedCostPaise,
    ptdPaise: row.ptdPaise,
    schemeMarginBps: row.schemeMarginBps,
    effectiveFrom: row.effectiveFrom.toISOString(),
  }
}
