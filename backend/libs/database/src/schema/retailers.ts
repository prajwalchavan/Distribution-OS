import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  doublePrecision,
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
  id,
  ONBOARDER_ROLES,
  paise,
  roleWritePolicies,
  STAFF_ROLES,
  staffReadPolicy,
  staffWritePolicy,
  tenantOrOwnRetailerPolicy,
  tenantPolicy,
  timestamps,
  tz,
} from './columns.js'
import { tenantRef } from './platform.js'
import { appRw } from './roles.js'
import { users } from './tenancy.js'

/** ADR 0006: a retailer's identity is global (phone); each distributor keeps its own private record. */

export const creditMode = pgEnum('credit_mode', ['indicate', 'strict', 'stop'])
export const paymentTerms = pgEnum('payment_terms', ['PRE', 'ON', 'POST_FULFILLMENT'])
export const gstRegType = pgEnum('gst_reg_type', ['unregistered', 'regular', 'composition'])
export const retailerLinkSource = pgEnum('retailer_link_source', [
  'rep_onboarding',
  'directory_optin',
  'import',
])
export const retailerLinkStatus = pgEnum('retailer_link_status', ['pending', 'active', 'blocked'])
export const retailerTier = pgEnum('retailer_tier', ['A', 'B', 'C', 'D'])
export const retailerLinkRole = pgEnum('retailer_link_role', ['owner', 'staff'])

/** Global: one row per shop identity, independent of any distributor. */
export const retailerIdentities = pgTable(
  'retailer_identities',
  {
    id: id(),
    phone: text('phone').notNull(),
    userId: text('user_id').references(() => users.id),
    shopName: text('shop_name').notNull(),
    gstin: text('gstin'),
    fssaiLicense: text('fssai_license'),
    consentVersion: text('consent_version'),
    consentedAt: tz('consented_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('retailer_identities_phone_idx').on(t.phone),
    // readable by staff of any tenant that links it, and by the identity's own user
    pgPolicy('retailer_identities_read', {
      for: 'select',
      to: appRw,
      using: sql`user_id = (SELECT current_setting('app.actor_id', true)) OR EXISTS (
        SELECT 1 FROM retailer_links l WHERE l.identity_id = retailer_identities.id AND l.tenant_id = (SELECT current_setting('app.tenant_id', true))
      )`,
    }),
    pgPolicy('retailer_identities_insert', { for: 'insert', to: appRw, withCheck: sql`true` }),
    pgPolicy('retailer_identities_update', {
      for: 'update',
      to: appRw,
      using: sql`user_id = (SELECT current_setting('app.actor_id', true)) OR (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'salesperson', 'system')`,
    }),
  ],
).enableRLS()

export const beats = pgTable(
  'beats',
  {
    id: id(),
    tenantId: tenantRef(),
    name: text('name').notNull(),
    area: text('area'),
    /** ISO weekday numbers this beat is normally visited, e.g. [1,4]. */
    visitDays: jsonb('visit_days')
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('beats_updated_idx').on(t.tenantId, t.updatedAt),
    uniqueIndex('beats_tenant_name_idx').on(t.tenantId, t.name),
    // Staff read the beat plan; a shop has no business with it. Only the onboarders draw it
    // (docs/23 §8.14: `beats.upsert`/`assign` move from STAFF to ONBOARDERS — a rep could create a beat
    // and assign himself to it).
    staffReadPolicy('beats_read'),
    ...roleWritePolicies('beats_write', ONBOARDER_ROLES),
  ],
).enableRLS()

/**
 * The distributor's private record of a retailer. Credit, tier, band and code are NEVER writable by the
 * retailer role and are absent from retailer-role contracts.
 *
 * Two guards, one in this file and one in migration 0013:
 *  - `retailers_retailer_update` lets the shop edit ITS OWN row — `retailers.updateOwn` (docs/23
 *    §8.14: name, owner name, alt phone, address, GSTIN) — and nothing else's;
 *  - `dos_retailers_guard()` (trigger) refuses the columns a self-edit may never touch (code, tier,
 *    beat, every credit term, cash discount, Tally name, external ids, merge, active, identity) when
 *    the actor is the retailer role, and refuses a change to the four CREDIT TERMS (`setCredit`) from
 *    any actor but an owner, a manager or the system — the accountant sets no credit limit (docs/22 §8,
 *    2026-09-05). Column-level rules cannot be written as RLS, which is why it is a trigger.
 */
export const retailers = pgTable(
  'retailers',
  {
    id: id(),
    tenantId: tenantRef(),
    identityId: text('identity_id').references(() => retailerIdentities.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    ownerName: text('owner_name'),
    phone: text('phone').notNull(),
    altPhone: text('alt_phone'),
    address: jsonb('address'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    beatId: text('beat_id').references(() => beats.id),
    tier: retailerTier('tier').notNull().default('C'),
    gstRegType: gstRegType('gst_reg_type').notNull().default('unregistered'),
    gstin: text('gstin'),
    stateCode: text('state_code').notNull(),
    creditLimitPaise: paise('credit_limit_paise').notNull().default(0),
    creditLimitBills: integer('credit_limit_bills').notNull().default(0),
    creditDays: integer('credit_days').notNull().default(0),
    creditMode: creditMode('credit_mode').notNull().default('indicate'),
    paymentTerms: paymentTerms('payment_terms').notNull().default('POST_FULFILLMENT'),
    /** Cash discount offered if paid within N days (bps), realised at receipt (ADR 0004). */
    cashDiscountBps: integer('cash_discount_bps').notNull().default(0),
    cashDiscountDays: integer('cash_discount_days').notNull().default(0),
    tallyLedgerName: text('tally_ledger_name'),
    /** Ids in brand DMSs (FieldAssist outlet code etc.) so brand invoices link to the same retailer. */
    externalIds: jsonb('external_ids')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    onboardedBy: text('onboarded_by'),
    /** Duplicates are merged like products: links/codes rewritten, ledger rows never (docs/17 A6). */
    mergedInto: text('merged_into'),
    pan: text('pan'),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('retailers_tenant_code_idx').on(t.tenantId, t.code),
    index('retailers_tenant_beat_idx').on(t.tenantId, t.beatId),
    index('retailers_tenant_phone_idx').on(t.tenantId, t.phone),
    /** Delta download for the offline rep (docs/23 §8.11): shops changed since the last open. */
    index('retailers_updated_idx').on(t.tenantId, t.updatedAt),
    tenantOrOwnRetailerPolicy('retailers_read', 'id'),
    ...staffWritePolicy('retailers_write'),
    pgPolicy('retailers_retailer_update', {
      for: 'update',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )`,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )`,
    }),
  ],
).enableRLS()

export const retailerLinks = pgTable(
  'retailer_links',
  {
    id: id(),
    tenantId: tenantRef(),
    identityId: text('identity_id')
      .notNull()
      .references(() => retailerIdentities.id),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    /** Copy of retailer_identities.user_id, maintained by the retailers service when an identity claims a login.
     *  Exists so RLS on tenant tables can scope the retailer role without joining retailer_identities. */
    userId: text('user_id').references(() => users.id),
    /** Person ≠ shop: a shop has an owner and counter staff; one person may own several shops (docs/17 A6). */
    role: retailerLinkRole('role').notNull().default('owner'),
    linkedBy: retailerLinkSource('linked_by').notNull(),
    status: retailerLinkStatus('status').notNull().default('active'),
    preferredLang: text('preferred_lang'),
    /** DPDP consent is per fiduciary (per distributor), so it lives on the link, not the identity. */
    consentVersion: text('consent_version'),
    consentedAt: tz('consented_at'),
    whatsappOptinAt: tz('whatsapp_optin_at'),
    ...timestamps,
  },
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('retailer_links_updated_idx').on(t.tenantId, t.updatedAt),
    uniqueIndex('retailer_links_idx').on(t.tenantId, t.identityId, t.retailerId),
    index('retailer_links_identity_idx').on(t.identityId),
    index('retailer_links_user_idx').on(t.userId),
    // staff of the tenant, plus the identity's own user (so the retailer app can list its distributors)
    pgPolicy('retailer_links_read', {
      for: 'select',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) OR user_id = (SELECT current_setting('app.actor_id', true))`,
    }),
    ...staffWritePolicy('retailer_links_write'),
  ],
).enableRLS()

/** Which salesperson covers which beat. Read by staff (`beats.assignments.list` tells the rep today's beat), drawn by the onboarders. */
export const beatAssignments = pgTable(
  'beat_assignments',
  {
    id: id(),
    tenantId: tenantRef(),
    beatId: text('beat_id')
      .notNull()
      .references(() => beats.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    ...timestamps,
  },
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('beat_assignments_updated_idx').on(t.tenantId, t.updatedAt),
    index('beat_assignments_user_idx').on(t.tenantId, t.userId, t.validFrom),
    index('beat_assignments_beat_idx').on(t.tenantId, t.beatId, t.validFrom),
    staffReadPolicy('beat_assignments_read'),
    ...roleWritePolicies('beat_assignments_write', ONBOARDER_ROLES),
  ],
).enableRLS()

/** Permanent journey plan: the ordered list of retailers a rep visits on a beat day. */
export const pjp = pgTable(
  'pjp',
  {
    id: id(),
    tenantId: tenantRef(),
    beatId: text('beat_id')
      .notNull()
      .references(() => beats.id),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    sequence: integer('sequence').notNull(),
    ...timestamps,
  },
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('pjp_updated_idx').on(t.tenantId, t.updatedAt),
    uniqueIndex('pjp_beat_retailer_idx').on(t.tenantId, t.beatId, t.retailerId),
    staffReadPolicy('pjp_read'),
    ...roleWritePolicies('pjp_write', ONBOARDER_ROLES),
  ],
).enableRLS()

export const visitOutcome = pgEnum('visit_outcome', [
  'ordered',
  'no_order',
  'closed',
  'not_found',
  'payment_only',
])

/** A rep's visit to a shop: productive or not, with the reason, from the salesperson app (offline-first). */
export const visits = pgTable(
  'visits',
  {
    id: id(),
    tenantId: tenantRef(),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    beatId: text('beat_id').references(() => beats.id),
    startedAt: tz('started_at').notNull(),
    endedAt: tz('ended_at'),
    outcome: visitOutcome('outcome'),
    reason: text('reason'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    /** Delta pull for the offline device: rows changed since its cursor (own sync, docs/22 §8). */
    index('visits_updated_idx').on(t.tenantId, t.updatedAt),
    index('visits_user_day_idx').on(t.tenantId, t.userId, t.startedAt),
    index('visits_retailer_idx').on(t.tenantId, t.retailerId),
    // A visit is the rep's note about a shop ("closed", "owner away", "no order — stocked up"): staff
    // read and write it, the shop being written about never reads it.
    staffReadPolicy('visits_read'),
    ...roleWritePolicies('visits_write', STAFF_ROLES),
  ],
).enableRLS()

/** A retailer opting in to be discoverable by (or to discover) distributors in the directory. */
export const directoryOptins = pgTable(
  'directory_optins',
  {
    id: id(),
    identityId: text('identity_id')
      .notNull()
      .references(() => retailerIdentities.id),
    /** NULL = the retailer is discoverable by all; set = opt-in to one distributor. */
    tenantId: text('tenant_id'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    categories: jsonb('categories')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('directory_optins_identity_idx').on(t.identityId),
    pgPolicy('directory_optins_own', {
      for: 'all',
      to: appRw,
      using: sql`EXISTS (SELECT 1 FROM retailer_identities ri WHERE ri.id = directory_optins.identity_id AND ri.user_id = (SELECT current_setting('app.actor_id', true)))`,
      withCheck: sql`EXISTS (SELECT 1 FROM retailer_identities ri WHERE ri.id = directory_optins.identity_id AND ri.user_id = (SELECT current_setting('app.actor_id', true)))`,
    }),
    pgPolicy('directory_optins_tenant_read', {
      for: 'select',
      to: appRw,
      using: sql`active AND (tenant_id IS NULL OR tenant_id = (SELECT current_setting('app.tenant_id', true)))`,
    }),
  ],
).enableRLS()

/** Ids other systems use for a retailer (FieldAssist outlet code, TradeEzee party code) — docs/17 A7. */
export const externalPartyCodes = pgTable(
  'external_party_codes',
  {
    id: id(),
    tenantId: tenantRef(),
    system: text('system').notNull(),
    code: text('code').notNull(),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('external_party_codes_idx').on(t.tenantId, t.system, t.code),
    index('external_party_codes_retailer_idx').on(t.tenantId, t.retailerId),
    tenantPolicy('external_party_codes_tenant'),
  ],
).enableRLS()

/** Migrated bill lines from TradeEzee/FieldAssist (no ledger effect) so suggested orders have history on day one — docs/17 A11. */
export const retailerPurchaseHistory = pgTable(
  'retailer_purchase_history',
  {
    id: id(),
    tenantId: tenantRef(),
    retailerId: text('retailer_id')
      .notNull()
      .references(() => retailers.id),
    variantId: text('variant_id').notNull(),
    invoiceNo: text('invoice_no'),
    invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
    qtyPcs: integer('qty_pcs').notNull(),
    ratePaise: paise('rate_paise'),
    source: text('source').notNull().default('migration'),
    importJobId: text('import_job_id'),
  },
  (t) => [
    index('retailer_purchase_history_idx').on(t.tenantId, t.retailerId, t.invoiceDate),
    tenantPolicy('retailer_purchase_history_tenant'),
  ],
).enableRLS()
