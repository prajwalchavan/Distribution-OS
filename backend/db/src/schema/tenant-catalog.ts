import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  BACK_OFFICE_ROLES,
  bps,
  id,
  paise,
  tenantPolicy,
  tenantRolePolicy,
  timestamps,
  tz,
} from './columns.js'
import { brands, productVariants } from './catalog.js'
import { tenantRef } from './platform.js'
import { users } from './tenancy.js'

/** Tenant overlay on the global catalog (ADR 0005). */

export const marginBasis = pgEnum('margin_basis', ['ptd', 'mrp', 'net'])

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
  (t) => [index('suppliers_tenant_idx').on(t.tenantId, t.name), tenantPolicy('suppliers_tenant')],
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
    tenantPolicy('tenant_products_tenant'),
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
    tenantPolicy('supplier_pack_configs_tenant'),
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
    tenantPolicy('rep_product_authorisations_tenant'),
  ],
).enableRLS()
