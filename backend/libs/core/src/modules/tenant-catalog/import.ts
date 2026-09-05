import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  brands,
  productVariants,
  products,
  suppliers,
  tenantBrands,
  tenantProducts,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * The catalog side of the generic importer (coordination §4: integrations → catalog / tenant-catalog:
 * `search`, `upsertListing` — "a bulk import never proposes a global product"). Transaction-scoped
 * plain functions, shared by the API and the worker's commit run; `TenantCatalogService` delegates.
 *
 * Matching reads the GLOBAL catalog (product_variants, products, product_aliases) and this tenant's
 * overlay (`tenant_products.local_alias`); it never writes the global tables. Committing writes only
 * `tenant_products` — the listing, its alias and its case size — and an unmatched item stays with the
 * human (`needs_review`) until the product exists on the catalog screen.
 */

export interface VariantProbe {
  ean?: string | null | undefined
  code?: string | null | undefined
  name?: string | null | undefined
  /** The tenant's own short name for it (`localAlias`), checked before the global name. */
  alias?: string | null | undefined
}

export interface VariantCandidate {
  id: string
  /** "Campa Cola 750 ml · Campa": what the review screen shows. */
  label: string
  scoreBps: number
  by: 'ean' | 'alias' | 'name'
  defaultCaseSize: number
  hsnCode: string
  mrpPaise: number | null
}

export interface VariantMatch {
  match: VariantCandidate | null
  candidates: VariantCandidate[]
}

const NAME_FLOOR = 0.5
const NAME_AUTO = 0.9
const NAME_GAP = 0.15

const cols = {
  id: productVariants.id,
  name: productVariants.name,
  defaultCaseSize: productVariants.defaultCaseSize,
  hsnCode: productVariants.hsnCode,
  mrpPaise: productVariants.mrpPaise,
  brandName: brands.name,
}

type Row = {
  id: string
  name: string
  defaultCaseSize: number
  hsnCode: string
  mrpPaise: number | null
  brandName: string | null
}

const candidate = (r: Row, scoreBps: number, by: VariantCandidate['by']): VariantCandidate => ({
  id: r.id,
  label: r.brandName ? `${r.name} · ${r.brandName}` : r.name,
  scoreBps,
  by,
  defaultCaseSize: r.defaultCaseSize,
  hsnCode: r.hsnCode,
  mrpPaise: r.mrpPaise,
})

/** Exact EAN → this tenant's alias → one clear trigram name over the global catalog. Never a new product. */
export async function matchVariant(tx: Db, probe: VariantProbe, limit = 5): Promise<VariantMatch> {
  const { tenantId } = currentTenant()
  const base = () =>
    tx
      .select(cols)
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(brands, eq(brands.id, products.brandId))
  const live = eq(productVariants.status, 'active')

  if (probe.ean) {
    const rows = await base()
      .where(and(live, eq(productVariants.ean, probe.ean)))
      .limit(2)
    if (rows.length === 1 && rows[0]) {
      const c = candidate(rows[0], 10_000, 'ean')
      return { match: c, candidates: [c] }
    }
  }
  // The tenant's own short names: the alias column, the old software's code, then the item name.
  for (const aliasProbe of [probe.alias, probe.code, probe.name]) {
    const text = aliasProbe?.trim()
    if (!text) continue
    const rows = await tx
      .select(cols)
      .from(tenantProducts)
      .innerJoin(productVariants, eq(productVariants.id, tenantProducts.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(
        and(
          eq(tenantProducts.tenantId, tenantId),
          sql`lower(${tenantProducts.localAlias}) = lower(${text})`,
        ),
      )
      .limit(2)
    if (rows.length === 1 && rows[0]) {
      const c = candidate(rows[0], 9_800, 'alias')
      return { match: c, candidates: [c] }
    }
  }
  const candidates: VariantCandidate[] = []
  const q = probe.name?.trim() ?? ''
  if (q.length >= 3) {
    const rows = await tx
      .select({ ...cols, score: sql<number>`similarity(${productVariants.name}, ${q})` })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(and(live, sql`similarity(${productVariants.name}, ${q}) >= ${NAME_FLOOR}`))
      .orderBy(sql`similarity(${productVariants.name}, ${q}) desc`, productVariants.id)
      .limit(limit)
    for (const r of rows)
      candidates.push(candidate(r, Math.round(Number(r.score) * 10_000), 'name'))
    const top = candidates[0]
    const second = candidates[1]
    if (
      top &&
      top.scoreBps >= NAME_AUTO * 10_000 &&
      (second === undefined || top.scoreBps - second.scoreBps >= NAME_GAP * 10_000)
    )
      return { match: top, candidates }
  }
  return { match: null, candidates }
}

/** The pack size the sell side uses for a variant: the tenant's override, else the printed case size. */
export async function sellSidePackSizes(
  tx: Db,
  variantIds: readonly string[],
): Promise<
  Map<
    string,
    { packSize: number; hsnCode: string; mrpPaise: number | null; name: string; listed: boolean }
  >
> {
  const unique = [...new Set(variantIds)]
  if (unique.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      id: productVariants.id,
      name: productVariants.name,
      defaultCaseSize: productVariants.defaultCaseSize,
      hsnCode: productVariants.hsnCode,
      mrpPaise: productVariants.mrpPaise,
      override: tenantProducts.caseSizeOverride,
      listed: tenantProducts.listed,
    })
    .from(productVariants)
    .leftJoin(
      tenantProducts,
      and(eq(tenantProducts.variantId, productVariants.id), eq(tenantProducts.tenantId, tenantId)),
    )
    .where(inArray(productVariants.id, unique))
  return new Map(
    rows.map((r) => [
      r.id,
      {
        packSize: r.override ?? r.defaultCaseSize,
        hsnCode: r.hsnCode,
        mrpPaise: r.mrpPaise,
        name: r.name,
        listed: r.listed ?? false,
      },
    ]),
  )
}

/** What an item-master row may write on the listing; the global variant is never touched. */
export interface ListingImportValues {
  localAlias?: string | null | undefined
  caseSizeOverride?: number | null | undefined
}

export interface ListingSnapshot {
  listed: boolean
  localAlias: string | null
  caseSizeOverride: number | null
}

export interface ListingImportResult {
  /** `tenant_products.id` */
  id: string
  created: boolean
  before: ListingSnapshot | null
}

/** List the variant for this tenant (create) or update the alias / case size of the listing it has (update). */
export async function upsertListingFromImport(
  tx: Db,
  input: { variantId: string; newId: string; values: ListingImportValues },
): Promise<ListingImportResult> {
  const { tenantId } = currentTenant()
  const [existing] = await tx
    .select()
    .from(tenantProducts)
    .where(
      and(eq(tenantProducts.tenantId, tenantId), eq(tenantProducts.variantId, input.variantId)),
    )
    .for('update')
  const v = input.values
  if (existing) {
    const patch: Partial<typeof tenantProducts.$inferInsert> = {
      listed: true,
      updatedAt: new Date(),
    }
    if (v.localAlias != null) patch.localAlias = v.localAlias
    if (v.caseSizeOverride != null) patch.caseSizeOverride = v.caseSizeOverride
    await tx.update(tenantProducts).set(patch).where(eq(tenantProducts.id, existing.id))
    return {
      id: existing.id,
      created: false,
      before: {
        listed: existing.listed,
        localAlias: existing.localAlias,
        caseSizeOverride: existing.caseSizeOverride,
      },
    }
  }
  await tx
    .insert(tenantProducts)
    .values({
      id: input.newId,
      tenantId,
      variantId: input.variantId,
      listed: true,
      localAlias: v.localAlias ?? null,
      caseSizeOverride: v.caseSizeOverride ?? null,
    })
    .onConflictDoNothing()
  return { id: input.newId, created: true, before: null }
}

export async function restoreListing(tx: Db, id: string, before: ListingSnapshot): Promise<void> {
  const { tenantId } = currentTenant()
  await tx
    .update(tenantProducts)
    .set({ ...before, updatedAt: new Date() })
    .where(and(eq(tenantProducts.tenantId, tenantId), eq(tenantProducts.id, id)))
}

/** A rollback of a `create`: the listing is switched off, never deleted (prices may point at it). */
export async function unlistListing(tx: Db, id: string): Promise<void> {
  const { tenantId } = currentTenant()
  await tx
    .update(tenantProducts)
    .set({ listed: false, updatedAt: new Date() })
    .where(and(eq(tenantProducts.tenantId, tenantId), eq(tenantProducts.id, id)))
}

/** Variant → the brand's `tally_export_source` for this tenant (`dos` when the brand is not configured). */
export async function tallyExportSourceByVariant(
  tx: Db,
  variantIds: readonly string[],
): Promise<Map<string, 'dos' | 'brand_dms' | 'none'>> {
  const unique = [...new Set(variantIds)]
  if (unique.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({ id: productVariants.id, source: tenantBrands.tallyExportSource })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(
      tenantBrands,
      and(eq(tenantBrands.brandId, products.brandId), eq(tenantBrands.tenantId, tenantId)),
    )
    .where(inArray(productVariants.id, unique))
  return new Map(rows.map((r) => [r.id, r.source ?? 'dos']))
}

/** Variant names for labels (Tally stock items, entity labels), one query. */
export async function variantLabels(tx: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await tx
    .select({ id: productVariants.id, name: productVariants.name, brandName: brands.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(inArray(productVariants.id, unique))
  return new Map(rows.map((r) => [r.id, r.brandName ? `${r.name} · ${r.brandName}` : r.name]))
}

/** Supplier names and Tally ledger names for the purchase voucher, one query. */
export async function supplierLabels(
  tx: Db,
  ids: readonly string[],
): Promise<Map<string, { name: string; tallyLedgerName: string | null; gstin: string | null }>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      tallyLedgerName: suppliers.tallyLedgerName,
      gstin: suppliers.gstin,
    })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, tenantId), inArray(suppliers.id, unique)))
  return new Map(
    rows.map((r) => [r.id, { name: r.name, tallyLedgerName: r.tallyLedgerName, gstin: r.gstin }]),
  )
}
