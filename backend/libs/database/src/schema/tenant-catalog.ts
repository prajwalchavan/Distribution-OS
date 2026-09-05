import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  BACK_OFFICE_ROLES,
  backOfficeOrOwnRowPolicy,
  bps,
  id,
  INBOUND_ROLES,
  ONBOARDER_ROLES,
  paise,
  PRICE_SETTER_ROLES,
  roleWritePolicies,
  staffReadPolicy,
  staffWritePolicy,
  tenantPolicy,
  tenantReadPolicy,
  tenantRolePolicy,
  timestamps,
  tz,
} from './columns.js'
import { brands, productVariants } from './catalog.js'
import { tenantRef } from './platform.js'
import { users } from './tenancy.js'

/**
 * Tenant overlay on the global catalog (ADR 0005).
 *
 * RLS (migration 0012, docs/23 §8.17 + docs/22 §8 2026-09-05): the listing (`tenant_products`) and the
 * per-brand mode (`tenant_brands`) are read by every member — the shop's catalog is built from them —
 * and written by staff / the price setters respectively (a brand's cash-discount mode IS a pricing
 * rule). Suppliers and pack configs are the buying side: staff read, the desk and the floor write,
 * a shop never sees who the distributor buys from. A rep's brand authorisation is its own row to read
 * and the onboarders' to set. Purchase cost stays exactly where it was: back office only.
 */

export const marginBasis = pgEnum('margin_basis', ['ptd', 'mrp', 'net'])
export const fulfilmentMode = pgEnum('fulfilment_mode', ['own', 'brand_dms'])
export const tallyExportSource = pgEnum('tally_export_source', ['dos', 'brand_dms', 'none'])
export const cashDiscountMode = pgEnum('cash_discount_mode', [
  'on_invoice',
  'at_receipt_financial_cn',
])
export const claimChannel = pgEnum('claim_channel', ['dos', 'brand_dms'])

/**
 * Per-brand operating mode for this distributor (docs/17 A1). Too Yumm is billed in FieldAssist: our reps must
 * not see it as orderable, Tally must not receive it twice, claims settle inside the brand DMS, and its cash
 * discount prints on the invoice rather than being realised at receipt.
 */
export const tenantBrands = pgTable(
  'tenant_brands',
  {
    id: id(),
    tenantId: tenantRef(),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.id),
    fulfilmentMode: fulfilmentMode('fulfilment_mode').notNull().default('own'),
    tallyExportSource: tallyExportSource('tally_export_source').notNull().default('dos'),
    cashDiscountMode: cashDiscountMode('cash_discount_mode')
      .notNull()
      .default('at_receipt_financial_cn'),
    claimChannel: claimChannel('claim_channel').notNull().default('dos'),
    /** Who sells this brand for the distributor: the brand's own employees or the distributor's reps. */
    salesForce: text('sales_force').notNull().default('distributor'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tenant_brands_idx').on(t.tenantId, t.brandId),
    tenantReadPolicy('tenant_brands_read'),
    ...roleWritePolicies('tenant_brands_write', PRICE_SETTER_ROLES),
  ],
).enableRLS()

/** Who the distributor buys from: the manufacturer's depot, a CFA/super-stockist, or a small local supplier. */
export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    tenantId: tenantRef(),
    name: text('name').notNull(),
    gstin: text('gstin'),
    stateCode: text('state_code'),
    manufacturerId: text('manufacturer_id'),
    phone: text('phone'),
    email: text('email'),
    address: jsonb('address'),
    /** Manufacturers that e-invoice (IRN + QR on every invoice) versus small suppliers that do not. */
    eInvoicing: boolean('e_invoicing').notNull().default(false),
    paymentTermsDays: integer('payment_terms_days'),
    tallyLedgerName: text('tally_ledger_name'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('suppliers_tenant_idx').on(t.tenantId, t.name),
    staffReadPolicy('suppliers_read'),
    ...roleWritePolicies('suppliers_write', INBOUND_ROLES),
  ],
).enableRLS()

/** Return/damage policy per manufacturer brand for this tenant (founder: policy differs per manufacturer). */
export const returnPolicies = pgTable(
  'return_policies',
  {
    id: id(),
    tenantId: tenantRef(),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.id),
    saleableReturnDays: integer('saleable_return_days').notNull().default(0),
    damageClaimable: boolean('damage_claimable').notNull().default(false),
    expiryClaimable: boolean('expiry_claimable').notNull().default(false),
    claimWindowDays: integer('claim_window_days'),
    claimSheetFormat: text('claim_sheet_format'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('return_policies_tenant_brand_idx').on(t.tenantId, t.brandId),
    tenantPolicy('return_policies_tenant'),
  ],
).enableRLS()

/** Which global variants this distributor sells, and the tenant's own ordering rules for each. */
export const tenantProducts = pgTable(
  'tenant_products',
  {
    id: id(),
    tenantId: tenantRef(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    listed: boolean('listed').notNull().default(true),
    localAlias: text('local_alias'),
    caseSizeOverride: integer('case_size_override'),
    minOrderQty: integer('min_order_qty').notNull().default(1),
    orderIncrement: integer('order_increment').notNull().default(1),
    maxPerOrder: integer('max_per_order'),
    /** Sorting/grouping in the rep and retailer catalog screens. */
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tenant_products_idx').on(t.tenantId, t.variantId),
    /** Delta download for the offline rep (docs/23 §8.11): listings changed since the last open. */
    index('tenant_products_updated_idx').on(t.tenantId, t.updatedAt),
    tenantReadPolicy('tenant_products_read'),
    ...staffWritePolicy('tenant_products_write'),
  ],
).enableRLS()

/** Guru Kripa "x 90" vs Guiltfree "_120" vs Reliance "CS1": the same variant packs differently per supplier. */
export const supplierPackConfigs = pgTable(
  'supplier_pack_configs',
  {
    id: id(),
    tenantId: tenantRef(),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    pcsPerCase: integer('pcs_per_case').notNull(),
    supplierCode: text('supplier_code'),
    supplierDescription: text('supplier_description'),
    marginBasis: marginBasis('margin_basis').notNull().default('ptd'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('supplier_pack_configs_idx').on(t.tenantId, t.supplierId, t.variantId),
    staffReadPolicy('supplier_pack_configs_read'),
    ...roleWritePolicies('supplier_pack_configs_write', INBOUND_ROLES),
  ],
).enableRLS()

/**
 * Purchase cost. RLS restricts this table to owner/manager/accountant/system — a salesperson or delivery
 * device can never sync or query it (a competitor leaked margins to reps and staff quit). CI dumps a
 * salesperson device after full sync and asserts no column from here appears.
 */
export const tenantProductCosts = pgTable(
  'tenant_product_costs',
  {
    id: id(),
    tenantId: tenantRef(),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    /** NULL = current default cost for the variant; set = cost of a specific lot (plain id, inventory owns lots). */
    lotId: text('lot_id'),
    supplierId: text('supplier_id').references(() => suppliers.id),
    purchaseRatePaise: paise('purchase_rate_paise').notNull(),
    landedCostPaise: paise('landed_cost_paise').notNull(),
    /** Price-to-distributor from the manufacturer's price circular, when known. */
    ptdPaise: paise('ptd_paise'),
    schemeMarginBps: bps('scheme_margin_bps'),
    /** Exact per-piece cost when the invoiced rate was per case (₹135.43 / 12 is not an integer paise) — docs/17 A4. */
    perPieceCost: numeric('per_piece_cost', { precision: 14, scale: 4 }),
    /** GRN that last updated this row (plain id: procurement is downstream of this module). */
    updatedFromGrnId: text('updated_from_grn_id'),
    effectiveFrom: tz('effective_from').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('tenant_product_costs_variant_idx').on(t.tenantId, t.variantId, t.effectiveFrom),
    tenantRolePolicy('tenant_product_costs_back_office', BACK_OFFICE_ROLES),
  ],
).enableRLS()

/** Which brands each salesperson may sell (brand-employed reps sell only their brand). */
export const repProductAuthorisations = pgTable(
  'rep_product_authorisations',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.id),
    /** 'manufacturer' = employed by the brand, 'distributor' = the distributor's own rep on incentive. */
    employedBy: text('employed_by').notNull().default('distributor'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('rep_product_authorisations_idx').on(t.tenantId, t.userId, t.brandId),
    backOfficeOrOwnRowPolicy('rep_product_authorisations_read', 'user_id'),
    ...roleWritePolicies('rep_product_authorisations_write', ONBOARDER_ROLES),
  ],
).enableRLS()
