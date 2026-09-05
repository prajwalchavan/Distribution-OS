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
import {
  APPROVER_ROLES,
  backOfficeOrOwnRowPolicy,
  bps,
  id,
  OWNER_ROLES,
  paise,
  PRICE_SETTER_ROLES,
  roleUpdatePolicy,
  roleWritePolicies,
  tenantOrOwnRetailerPolicy,
  tenantReadPolicy,
  timestamps,
  tz,
} from './columns.js'
import { productVariants } from './catalog.js'
import { tenantRef } from './platform.js'
import { appRw } from './roles.js'
import { claimChannel } from './tenant-catalog.js'
import { retailers, retailerTier } from './retailers.js'
import { users } from './tenancy.js'

/**
 * ADR 0008: resolvePrice() order is fixed — price list tier → retailer override wins → schemes stack unless
 * `final` → approved bargain last → cash discount realised at receipt. All rules here are inputs to that pure
 * function in shared/domain; the engine never reads anything else.
 *
 * RLS (migration 0012, founder decision 2026-09-05 in docs/22 §8): every member READS the price list and
 * the schemes — the engine runs on the rep's phone and in the shop's own app — and only the owner and
 * the manager WRITE them (`PRICE_SETTER_ROLES`). The accountant is a money desk and sets no price; the
 * old FOR ALL policies let any member, the shopkeeper included, insert a rate. A retailer's negotiated
 * override and its bargains are its own rows: `tenantOrOwnRetailerPolicy`, so one shop never learns
 * another's rate.
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
    tenantReadPolicy('price_lists_read'),
    ...roleWritePolicies('price_lists_write', PRICE_SETTER_ROLES),
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
    /** Delta download for the offline rep (docs/23 §8.11 `updatedAfter`): what changed since the last open. */
    index('price_list_items_updated_idx').on(t.tenantId, t.updatedAt),
    tenantReadPolicy('price_list_items_read'),
    ...roleWritePolicies('price_list_items_write', PRICE_SETTER_ROLES),
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
    index('retailer_price_overrides_updated_idx').on(t.tenantId, t.updatedAt),
    tenantOrOwnRetailerPolicy('retailer_price_overrides_read', 'retailer_id'),
    ...roleWritePolicies('retailer_price_overrides_write', PRICE_SETTER_ROLES),
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
export const rewardUnit = pgEnum('reward_unit', ['pcs', 'case'])
export const floorBasis = pgEnum('floor_basis', ['tier_price', 'ptr'])

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
    /** Unit of a free_qty reward (docs/17 A9). */
    rewardUnit: rewardUnit('reward_unit').notNull().default('pcs'),
    /** Application order among stacked rules, asc; ties by id (review item 14). */
    priority: integer('priority').notNull().default(0),
    /** Where the claim for this scheme is raised: by us, or inside the brand's DMS (Too Yumm). */
    claimChannel: claimChannel('claim_channel').notNull().default('dos'),
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
    index('schemes_updated_idx').on(t.tenantId, t.updatedAt),
    tenantReadPolicy('schemes_read'),
    ...roleWritePolicies('schemes_write', PRICE_SETTER_ROLES),
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
    /** The bound basis this request was evaluated against, frozen (docs/17 A10). */
    evaluatedBasis: text('evaluated_basis'),
    decidedBy: text('decided_by').references(() => users.id),
    decidedAt: tz('decided_at'),
    expiresAt: tz('expires_at'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    index('bargain_requests_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('bargain_requests_retailer_idx').on(t.tenantId, t.retailerId, t.createdAt),
    // Staff read every request; a shop reads the ones asked for it, so it learns the answer (docs/23 §8.16).
    tenantOrOwnRetailerPolicy('bargain_requests_read', 'retailer_id'),
    // Who may ASK, and with what starting status. An owner/manager may file one already `approved`;
    // a rep files `requested` or, inside its bound, `auto_approved`; a shop files `requested` for
    // itself only. Nobody outside APPROVER_ROLES can write `approved` — that is the decision.
    pgPolicy('bargain_requests_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'system')
        OR ((SELECT current_setting('app.actor_role', true)) NOT IN ('retailer', 'owner', 'manager', 'system')
            AND status IN ('requested', 'auto_approved')
            AND requested_by = (SELECT current_setting('app.actor_id', true)))
        OR ((SELECT current_setting('app.actor_role', true)) = 'retailer'
            AND status = 'requested'
            AND requested_by = (SELECT current_setting('app.actor_id', true))
            AND retailer_id IN (
              SELECT l.retailer_id FROM retailer_links l
              WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
                AND l.user_id = (SELECT current_setting('app.actor_id', true))
                AND l.status = 'active'
            ))
      )`,
    }),
    // The decision: owner and manager only. The nightly expiry runs as the worker (system). No DELETE.
    roleUpdatePolicy('bargain_requests_decide', APPROVER_ROLES),
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
    /** What the % is measured against (docs/17 A10). */
    floorBasis: floorBasis('floor_basis').notNull().default('tier_price'),
    maxPerPiecePaise: paise('max_per_piece_paise'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('rep_auto_approve_bounds_idx').on(
      t.tenantId,
      t.userId,
      sql`coalesce(brand_id, '')`,
    ),
    // A rep reads its OWN bound (the on-device auto-approve, `pricing.bounds.list` docs/23 §8.16), the
    // desk reads everyone's; the owner alone sets one (`pricing.bounds.set` is OWNER_ONLY).
    backOfficeOrOwnRowPolicy('rep_auto_approve_bounds_read', 'user_id'),
    ...roleWritePolicies('rep_auto_approve_bounds_write', OWNER_ROLES),
  ],
).enableRLS()
