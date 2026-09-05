import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm'
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
  returnPolicies,
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
  brandLabels,
  matchVariant,
  restoreListing,
  sellSidePackSizes,
  supplierLabels,
  tallyExportSourceByVariant,
  unlistListing,
  upsertListingFromImport,
  variantBrands,
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

/**
 * A brand's claim policy for this distributor as claims (slice 7) reads it (coordination §4:
 * `returnPolicy` / `upsertReturnPolicy`): the `return_policies` row joined with `tenant_brands.claim_channel`
 * and the claim supplier's name. `id` is null for a brand the owner has not configured yet — every claim
 * flag is then false and the channel comes from `tenant_brands` (fallback `dos`).
 */
export interface ReturnPolicyRow {
  id: string | null
  brandId: string
  brandName: string
  claimSupplierId: string | null
  claimSupplierName: string | null
  damageClaimable: boolean
  expiryClaimable: boolean
  claimWindowDays: number | null
  claimSheetFormat: string | null
  claimPeriodKind: 'monthly' | 'fortnightly' | 'quarterly' | 'adhoc'
  claimCutoffDay: number | null
  settlementDays: number | null
  damageValueBasis: 'ptd' | 'landed_cost' | 'mrp' | 'invoice_rate' | 'scheme_amount'
  expiryValueBasis: 'ptd' | 'landed_cost' | 'mrp' | 'invoice_rate' | 'scheme_amount'
  claimChannel: 'dos' | 'brand_dms'
  saleableReturnDays: number
  notes: string | null
}

export interface UpsertReturnPolicyInput {
  /** Client id of the row on first insert; the natural key is (tenant, brand). */
  id: string
  brandId: string
  claimSupplierId?: string | null | undefined
  damageClaimable: boolean
  expiryClaimable: boolean
  claimWindowDays?: number | null | undefined
  claimSheetFormat?: string | null | undefined
  claimPeriodKind: ReturnPolicyRow['claimPeriodKind']
  claimCutoffDay?: number | null | undefined
  settlementDays?: number | null | undefined
  damageValueBasis: ReturnPolicyRow['damageValueBasis']
  expiryValueBasis: ReturnPolicyRow['expiryValueBasis']
  saleableReturnDays?: number | undefined
  notes?: string | null | undefined
}

/** The current default purchase cost of a variant (the `lot_id IS NULL` row, else the latest lot's). Back office only under RLS. */
export interface VariantCostRow {
  variantId: string
  purchaseRatePaise: number
  landedCostPaise: number
  ptdPaise: number | null
  /** Exact per-piece cost when the supplier billed per case (numeric(14,4) as a string) — docs/17 A4. */
  perPieceCost: string | null
  effectiveFrom: Date
}

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

  /** variant → brand id, for reporting's stock and margin registers (`import.ts`). */
  variantBrands(tx: Db, ids: readonly string[]): Promise<Map<string, string | null>> {
    return variantBrands(tx, ids)
  }

  brandLabels(tx: Db, ids: readonly string[]): Promise<Map<string, string>> {
    return brandLabels(tx, ids)
  }

  // =============================================================================================================
  // the surface claims (slice 7) calls — inside the caller's transaction (coordination §4)
  // =============================================================================================================

  /**
   * Every brand this distributor operates (`tenant_brands`) or has a policy for, with the policy where
   * one exists. Cursor = the last brand id; bounded by `limit` (≤ 200). Read under the caller's role:
   * `return_policies` is back-office readable (0021), so the field sees nothing here.
   */
  async returnPolicies(
    tx: Db,
    filter: { brandId?: string | undefined; limit: number; cursor?: string | undefined },
  ): Promise<{ items: ReturnPolicyRow[]; nextCursor: string | null }> {
    const { tenantId } = currentTenant()
    const limit = Math.min(filter.limit, 200)
    const result = await tx.execute(sql`
      WITH brand_ids AS (
        SELECT brand_id FROM tenant_brands WHERE tenant_id = ${tenantId}
        UNION
        SELECT brand_id FROM return_policies WHERE tenant_id = ${tenantId}
      )
      SELECT b.id AS brand_id, b.name AS brand_name,
             rp.id, rp.claim_supplier_id, s.name AS claim_supplier_name,
             rp.damage_claimable, rp.expiry_claimable, rp.claim_window_days, rp.claim_sheet_format,
             rp.claim_period_kind::text AS claim_period_kind, rp.claim_cutoff_day, rp.settlement_days,
             rp.damage_value_basis::text AS damage_value_basis, rp.expiry_value_basis::text AS expiry_value_basis,
             rp.saleable_return_days, rp.notes,
             tb.claim_channel::text AS claim_channel
        FROM brand_ids bi
        JOIN brands b ON b.id = bi.brand_id
        LEFT JOIN return_policies rp ON rp.tenant_id = ${tenantId} AND rp.brand_id = b.id
        LEFT JOIN tenant_brands tb ON tb.tenant_id = ${tenantId} AND tb.brand_id = b.id
        LEFT JOIN suppliers s ON s.id = rp.claim_supplier_id AND s.tenant_id = ${tenantId}
       WHERE (${filter.brandId ?? null}::text IS NULL OR b.id = ${filter.brandId ?? null})
         AND (${filter.cursor ?? null}::text IS NULL OR b.id > ${filter.cursor ?? null})
       ORDER BY b.id ASC
       LIMIT ${limit + 1}`)
    const rows = result.rows.map((r: Record<string, unknown>) => toReturnPolicy(r))
    const items = rows.slice(0, limit)
    const last = items[items.length - 1]
    return { items, nextCursor: rows.length > limit && last ? last.brandId : null }
  }

  /** One brand's policy (unconfigured brands answer defaults); null only when the brand does not exist at all. */
  async returnPolicy(tx: Db, brandId: string): Promise<ReturnPolicyRow | null> {
    const { tenantId } = currentTenant()
    const result = await tx.execute(sql`
      SELECT b.id AS brand_id, b.name AS brand_name,
             rp.id, rp.claim_supplier_id, s.name AS claim_supplier_name,
             rp.damage_claimable, rp.expiry_claimable, rp.claim_window_days, rp.claim_sheet_format,
             rp.claim_period_kind::text AS claim_period_kind, rp.claim_cutoff_day, rp.settlement_days,
             rp.damage_value_basis::text AS damage_value_basis, rp.expiry_value_basis::text AS expiry_value_basis,
             rp.saleable_return_days, rp.notes,
             tb.claim_channel::text AS claim_channel
        FROM brands b
        LEFT JOIN return_policies rp ON rp.tenant_id = ${tenantId} AND rp.brand_id = b.id
        LEFT JOIN tenant_brands tb ON tb.tenant_id = ${tenantId} AND tb.brand_id = b.id
        LEFT JOIN suppliers s ON s.id = rp.claim_supplier_id AND s.tenant_id = ${tenantId}
       WHERE b.id = ${brandId}
       LIMIT 1`)
    const row = result.rows[0]
    return row ? toReturnPolicy(row) : null
  }

  /** Upsert on (tenant, brand). The caller (claims, owner only) audits and answers; no state, no journal. */
  async upsertReturnPolicy(tx: Db, input: UpsertReturnPolicyInput): Promise<ReturnPolicyRow> {
    const { tenantId } = currentTenant()
    const values = {
      claimSupplierId: input.claimSupplierId ?? null,
      damageClaimable: input.damageClaimable,
      expiryClaimable: input.expiryClaimable,
      claimWindowDays: input.claimWindowDays ?? null,
      claimSheetFormat: input.claimSheetFormat ?? null,
      claimPeriodKind: input.claimPeriodKind,
      claimCutoffDay: input.claimCutoffDay ?? null,
      settlementDays: input.settlementDays ?? null,
      damageValueBasis: input.damageValueBasis,
      expiryValueBasis: input.expiryValueBasis,
      notes: input.notes ?? null,
    }
    await tx
      .insert(returnPolicies)
      .values({
        id: input.id,
        tenantId,
        brandId: input.brandId,
        saleableReturnDays: input.saleableReturnDays ?? 0,
        ...values,
      })
      .onConflictDoUpdate({
        target: [returnPolicies.tenantId, returnPolicies.brandId],
        set: {
          ...values,
          ...(input.saleableReturnDays === undefined
            ? {}
            : { saleableReturnDays: input.saleableReturnDays }),
          updatedAt: new Date(),
        },
      })
    const row = await this.returnPolicy(tx, input.brandId)
    if (!row) throw new Error('return policy vanished after upsert')
    return row
  }

  /**
   * The current default cost per variant: the `lot_id IS NULL` row when there is one (the manufacturer's
   * circular / the owner's entry), else the most recent lot cost the last GRN wrote. One query, one row
   * per variant. RLS makes this empty for anyone but the back office, which is the guarantee (ADR 0002).
   */
  async costsForVariants(
    tx: Db,
    variantIds: readonly string[],
  ): Promise<Map<string, VariantCostRow>> {
    const { tenantId } = currentTenant()
    const unique = [...new Set(variantIds)]
    if (unique.length === 0) return new Map()
    const rows = await tx
      .select({
        variantId: tenantProductCosts.variantId,
        lotId: tenantProductCosts.lotId,
        purchaseRatePaise: tenantProductCosts.purchaseRatePaise,
        landedCostPaise: tenantProductCosts.landedCostPaise,
        ptdPaise: tenantProductCosts.ptdPaise,
        perPieceCost: tenantProductCosts.perPieceCost,
        effectiveFrom: tenantProductCosts.effectiveFrom,
      })
      .from(tenantProductCosts)
      .where(
        and(
          eq(tenantProductCosts.tenantId, tenantId),
          inArray(tenantProductCosts.variantId, unique),
        ),
      )
      .orderBy(
        asc(tenantProductCosts.variantId),
        sql`(${tenantProductCosts.lotId} IS NULL) DESC`,
        desc(tenantProductCosts.effectiveFrom),
      )
    const out = new Map<string, VariantCostRow>()
    for (const r of rows) {
      if (out.has(r.variantId)) continue
      out.set(r.variantId, {
        variantId: r.variantId,
        purchaseRatePaise: r.purchaseRatePaise,
        landedCostPaise: r.landedCostPaise,
        ptdPaise: r.ptdPaise,
        perPieceCost: r.perPieceCost,
        effectiveFrom: r.effectiveFrom,
      })
    }
    return out
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

function toReturnPolicy(r: Record<string, unknown>): ReturnPolicyRow {
  const text = (v: unknown): string | null =>
    typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null
  const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
  return {
    id: text(r.id),
    brandId: String(r.brand_id),
    brandName: String(r.brand_name),
    claimSupplierId: text(r.claim_supplier_id),
    claimSupplierName: text(r.claim_supplier_name),
    damageClaimable: r.damage_claimable === true,
    expiryClaimable: r.expiry_claimable === true,
    claimWindowDays: int(r.claim_window_days),
    claimSheetFormat: text(r.claim_sheet_format),
    claimPeriodKind: (text(r.claim_period_kind) ?? 'monthly') as ReturnPolicyRow['claimPeriodKind'],
    claimCutoffDay: int(r.claim_cutoff_day),
    settlementDays: int(r.settlement_days),
    damageValueBasis: (text(r.damage_value_basis) ?? 'ptd') as ReturnPolicyRow['damageValueBasis'],
    expiryValueBasis: (text(r.expiry_value_basis) ?? 'ptd') as ReturnPolicyRow['expiryValueBasis'],
    claimChannel: (text(r.claim_channel) ?? 'dos') as ReturnPolicyRow['claimChannel'],
    saleableReturnDays: int(r.saleable_return_days) ?? 0,
    notes: text(r.notes),
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
