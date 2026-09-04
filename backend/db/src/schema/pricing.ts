import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { bps, id, paise, tenantPolicy, timestamps, tz } from './columns.js'
import { productVariants } from './catalog.js'
import { tenantRef } from './platform.js'
import { retailers, retailerTier } from './retailers.js'
import { users } from './tenancy.js'

/**
 * ADR 0008: resolvePrice() order is fixed — price list tier → retailer override wins → schemes stack unless
 * `final` → approved bargain last → cash discount realised at receipt. All rules here are inputs to that pure
 * function in shared/domain; the engine never reads anything else.
 */

/** One price list per tier (A/B/C/D) or a named list; items carry the selling rate per variant. */
export const priceLists = pgTable(
  'price_lists',
  {
    id: id(),
    tenantId: tenantRef(),
    name: text('name').notNull(),
    tier: retailerTier('tier'),
    isDefault: boolean('is_default').notNull().default(false),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('price_lists_tenant_name_idx').on(t.tenantId, t.name),
    tenantPolicy('price_lists_tenant'),
  ],
).enableRLS()

export const priceListItems = pgTable(
  'price_list_items',
  {
    id: id(),
    tenantId: tenantRef(),
    priceListId: text('price_list_id')
      .notNull()
      .references(() => priceLists.id),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    /** Selling rate per piece before GST, in paise. */
    ratePaise: paise('rate_paise').notNull(),
    /** Whether rate_paise already includes GST (MRP-based trades) — printed accordingly. */
    inclusiveOfGst: boolean('inclusive_of_gst').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('price_list_items_idx').on(t.tenantId, t.priceListId, t.variantId),
    tenantPolicy('price_list_items_tenant'),
  ],
).enableRLS()

/** A negotiated rate for one retailer and variant. `final` = schemes do not stack on top. */
export const retailerPriceOverrides = pgTable(
  'retailer_price_overrides',
  {
    id: id(),
    tenantId: tenantRef(),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    ratePaise: paise('rate_paise').notNull(),
    final: boolean('final').notNull().default(false),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    approvedBy: text('approved_by').references(() => users.id),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('retailer_price_overrides_idx').on(t.tenantId, t.retailerId, t.variantId),
    tenantPolicy('retailer_price_overrides_tenant'),
  ],
).enableRLS()

export const schemeTriggerKind = pgEnum('scheme_trigger_kind', ['qty', 'value', 'mix'])
export const schemeRewardKind = pgEnum('scheme_reward_kind', [
  'free_qty',
  'line_pct',
  'order_pct',
  'cash_discount_pct',
  'net_scheme_amount',
])
export const fundingSource = pgEnum('funding_source', ['company', 'distributor'])
export const pricingDateMode = pgEnum('pricing_date_mode', ['order', 'delivery'])

export interface SchemeScope {
  all?: boolean
  brandIds?: string[]
  categories?: string[]
  variantIds?: string[]
}
export interface SchemeSlab {
  min: number
  value: number
  freeVariantId?: string
}
export interface SchemeApplicability {
  tiers?: string[]
  retailerIds?: string[]
  beatIds?: string[]
}

/** THE single schemes table (ADR 0008): read by the pricing engine and referenced by claims. */
export const schemes = pgTable(
  'schemes',
  {
    id: id(),
    tenantId: tenantRef(),
    name: text('name').notNull(),
    brandId: text('brand_id'),
    scope: jsonb('scope').$type<SchemeScope>().notNull(),
    triggerKind: schemeTriggerKind('trigger_kind').notNull(),
    triggerMin: integer('trigger_min').notNull(),
    /** 'pcs' | 'case' | 'inr' */
    triggerUnit: text('trigger_unit').notNull(),
    slabs: jsonb('slabs').$type<SchemeSlab[]>(),
    rewardKind: schemeRewardKind('reward_kind').notNull(),
    /** free pieces, bps for pct kinds, or paise for net_scheme_amount */
    rewardValue: integer('reward_value').notNull(),
    freeVariantId: text('free_variant_id').references(() => productVariants.id),
    applicability: jsonb('applicability')
      .$type<SchemeApplicability>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }).notNull(),
    version: integer('version').notNull().default(1),
    stackable: boolean('stackable').notNull().default(true),
    final: boolean('final').notNull().default(false),
    fundingSource: fundingSource('funding_source').notNull().default('company'),
    claimable: boolean('claimable').notNull().default(false),
    claimWindowDays: integer('claim_window_days'),
    gstOnFreeGoods: boolean('gst_on_free_goods').notNull().default(false),
    pricingDateMode: pricingDateMode('pricing_date_mode').notNull().default('order'),
    /** Brand circular / scheme letter reference, for claims. */
    sourceRef: text('source_ref'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('schemes_tenant_valid_idx').on(t.tenantId, t.validFrom, t.validTo),
    tenantPolicy('schemes_tenant'),
  ],
).enableRLS()

export const bargainStatus = pgEnum('bargain_status', [
  'requested',
  'auto_approved',
  'approved',
  'rejected',
  'expired',
])

/** Retailer asks for a lower rate; rep auto-approves within bounds, else owner decides. */
export const bargainRequests = pgTable(
  'bargain_requests',
  {
    id: id(),
    tenantId: tenantRef(),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id),
    /** Plain id: orders is downstream of pricing. */
    orderId: text('order_id'),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    listRatePaise: paise('list_rate_paise').notNull(),
    askedRatePaise: paise('asked_rate_paise').notNull(),
    approvedRatePaise: paise('approved_rate_paise'),
    status: bargainStatus('status').notNull().default('requested'),
    decidedBy: text('decided_by').references(() => users.id),
    decidedAt: tz('decided_at'),
    expiresAt: tz('expires_at'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('bargain_requests_status_idx').on(t.tenantId, t.status, t.createdAt),
    tenantPolicy('bargain_requests_tenant'),
  ],
).enableRLS()

/** How far a rep may drop below list without asking (bps), per rep and optionally per brand. */
export const repAutoApproveBounds = pgTable(
  'rep_auto_approve_bounds',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    brandId: text('brand_id'),
    maxDiscountBps: bps('max_discount_bps').notNull().default(0),
    maxOrderDiscountPaise: paise('max_order_discount_paise'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('rep_auto_approve_bounds_idx').on(
      t.tenantId,
      t.userId,
      sql`coalesce(brand_id, '')`,
    ),
    tenantPolicy('rep_auto_approve_bounds_tenant'),
  ],
).enableRLS()
