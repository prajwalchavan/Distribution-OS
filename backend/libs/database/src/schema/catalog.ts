import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { bps, globalCuratedPolicies, id, paise, tenantMatches, timestamps, tz } from './columns.js'
import { appRw } from './roles.js'
import { tenants, users } from './tenancy.js'

/**
 * GLOBAL product master (ADR 0005). No tenant_id: manufacturers, brands, products and variants are shared by
 * every distributor and curated centrally. Tenant-specific facts (listing, alias, cost, case-size override)
 * live in tenant_catalog.ts. Readable by all roles; writable only by curator/system.
 */

export const productStatus = pgEnum('product_status', [
  'active',
  'proposed',
  'merged_into',
  'discontinued',
])
export const packLevel = pgEnum('pack_level', ['piece', 'inner', 'case'])
export const netUnit = pgEnum('net_unit', ['g', 'kg', 'ml', 'l', 'pcs'])

export const manufacturers = pgTable(
  'manufacturers',
  {
    id: id(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    gstin: text('gstin'),
    fssaiLicense: text('fssai_license'),
    website: text('website'),
    ...timestamps,
  },
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('manufacturers_updated_idx').on(t.updatedAt),
    uniqueIndex('manufacturers_name_idx').on(t.name),
    ...globalCuratedPolicies('manufacturers'),
  ],
).enableRLS()

export const brands = pgTable(
  'brands',
  {
    id: id(),
    manufacturerId: text('manufacturer_id')
      .notNull()
      .references(() => manufacturers.id),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('brands_updated_idx').on(t.updatedAt),
    uniqueIndex('brands_manufacturer_name_idx').on(t.manufacturerId, t.name),
    ...globalCuratedPolicies('brands'),
  ],
).enableRLS()

export const products = pgTable(
  'products',
  {
    id: id(),
    manufacturerId: text('manufacturer_id')
      .notNull()
      .references(() => manufacturers.id),
    brandId: text('brand_id').references(() => brands.id),
    name: text('name').notNull(),
    nameHi: text('name_hi'),
    category: text('category'),
    ondcCategory: text('ondc_category'),
    fssaiRelevant: boolean('fssai_relevant').notNull().default(true),
    status: productStatus('status').notNull().default('active'),
    /** Curator merges set this and rewrite aliases/external codes/tenant_products; ledger rows are never rewritten. */
    mergedInto: text('merged_into'),
    /** Set when a distributor proposed the product (status = proposed) so the curation queue knows who to ask. */
    proposedByTenantId: text('proposed_by_tenant_id').references(() => tenants.id),
    ...timestamps,
  },
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('products_updated_idx').on(t.updatedAt),
    index('products_manufacturer_idx').on(t.manufacturerId),
    index('products_status_idx').on(t.status),
    ...globalCuratedPolicies('products'),
    // A distributor may insert its own `proposed` products and use them immediately (ADR 0005).
    pgPolicy('products_tenant_propose', {
      for: 'insert',
      to: appRw,
      withCheck: sql`status = 'proposed' AND ${tenantMatches('proposed_by_tenant_id')}`,
    }),
  ],
).enableRLS()

/** A sellable unit: "Campa Cola 750 ml", "Too Yumm Karare 60 g + 10 g promo". */
export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    name: text('name').notNull(),
    netQty: integer('net_qty').notNull(),
    netUnit: netUnit('net_unit').notNull(),
    promoExtra: integer('promo_extra'),
    /** Pieces per case the manufacturer prints; suppliers may differ (supplier_pack_configs). */
    defaultCaseSize: integer('default_case_size').notNull(),
    hsnCode: text('hsn_code').notNull(),
    ean: text('ean'),
    /** Printed MRP as of curation, in paise; the authoritative MRP for stock is on the lot (ADR 0003). */
    mrpPaise: paise('mrp_paise'),
    shelfLifeDays: integer('shelf_life_days'),
    status: productStatus('status').notNull().default('active'),
    mergedInto: text('merged_into'),
    ...timestamps,
  },
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('product_variants_updated_idx').on(t.updatedAt),
    index('product_variants_product_idx').on(t.productId),
    uniqueIndex('product_variants_ean_idx')
      .on(t.ean)
      .where(sql`ean IS NOT NULL`),
    ...globalCuratedPolicies('product_variants'),
    pgPolicy('product_variants_tenant_propose', {
      for: 'insert',
      to: appRw,
      withCheck: sql`status = 'proposed' AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id AND ${tenantMatches('p.proposed_by_tenant_id')})`,
    }),
  ],
).enableRLS()

/** Pack hierarchy: piece -> inner (e.g. 12) -> case (e.g. 4 inners). qty_in_parent is relative to the level above. */
export const productPacks = pgTable(
  'product_packs',
  {
    id: id(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    level: packLevel('level').notNull(),
    qtyInParent: integer('qty_in_parent').notNull(),
    barcode: text('barcode'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('product_packs_variant_level_idx').on(t.variantId, t.level),
    ...globalCuratedPolicies('product_packs'),
  ],
).enableRLS()

/** Codes other systems use for a variant: manufacturer item codes, brand-DMS SKU ids, ONDC ids. */
export const productExternalCodes = pgTable(
  'product_external_codes',
  {
    id: id(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    system: text('system').notNull(),
    code: text('code').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('product_external_codes_idx').on(t.system, t.code),
    ...globalCuratedPolicies('product_external_codes'),
  ],
).enableRLS()

/** Names as they appear on supplier invoices ("CAMPA COLA PET 750ML X 24"), fed by docint corrections. */
export const productAliases = pgTable(
  'product_aliases',
  {
    id: id(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    alias: text('alias').notNull(),
    normalized: text('normalized').notNull(),
    source: text('source').notNull().default('docint'),
    hits: integer('hits').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('product_aliases_normalized_idx').on(t.normalized),
    ...globalCuratedPolicies('product_aliases'),
  ],
).enableRLS()

/** Dated GST rates per HSN so an old invoice re-prints with the rate that applied on its date. */
export const hsnRates = pgTable(
  'hsn_rates',
  {
    id: id(),
    hsnCode: text('hsn_code').notNull(),
    description: text('description'),
    gstBps: bps('gst_bps').notNull(),
    cessBps: bps('cess_bps').notNull().default(0),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    ...timestamps,
  },
  (t) => [
    index('hsn_rates_code_from_idx').on(t.hsnCode, t.effectiveFrom),
    ...globalCuratedPolicies('hsn_rates'),
  ],
).enableRLS()

export const proposalStatus = pgEnum('proposal_status', ['open', 'accepted', 'merged', 'rejected'])

/** Curation queue: a tenant proposes a product/variant or a merge; a curator resolves it. */
export const productProposals = pgTable(
  'product_proposals',
  {
    id: id(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    proposedBy: text('proposed_by')
      .notNull()
      .references(() => users.id),
    kind: text('kind').notNull(),
    productId: text('product_id').references(() => products.id),
    variantId: text('variant_id').references(() => productVariants.id),
    payload: jsonb('payload').notNull(),
    status: proposalStatus('status').notNull().default('open'),
    resolvedBy: text('resolved_by'),
    resolvedAt: tz('resolved_at'),
    resolutionNote: text('resolution_note'),
    ...timestamps,
  },
  (t) => [
    index('product_proposals_status_idx').on(t.status, t.createdAt),
    pgPolicy('product_proposals_tenant', {
      for: 'all',
      to: appRw,
      using: tenantMatches('tenant_id'),
      withCheck: tenantMatches('tenant_id'),
    }),
    pgPolicy('product_proposals_curator', {
      for: 'all',
      to: appRw,
      using: sql`(SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')`,
      withCheck: sql`(SELECT current_setting('app.actor_role', true)) IN ('curator', 'system')`,
    }),
  ],
).enableRLS()
