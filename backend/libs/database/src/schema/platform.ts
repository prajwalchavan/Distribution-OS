import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import {
  BACK_OFFICE_ROLES,
  id,
  platformReadPolicy,
  platformWritePolicies,
  roleReadPolicy,
  roleWritePolicies,
  staffReadPolicy,
  STAFF_ROLES,
  tenantPolicy,
  tenantReadPolicy,
  tenantRolePolicy,
  timestamps,
  tz,
  OWNER_ROLES,
} from './columns.js'
import { appRw } from './roles.js'
import { tenants, users } from './tenancy.js'

export const tenantRef = () =>
  text('tenant_id')
    .notNull()
    .references(() => tenants.id)

/**
 * Online idempotency (ADR 0007 / D16): every mutating oRPC call carries an idempotencyKey. The first
 * call stores its response; a retry with the same key and request hash gets the stored response, a
 * different hash gets 409. Rows are pruned after 24 hours — this is the ONLY place 24 hours applies.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    tenantId: tenantRef(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response'),
    /**
     * MODULE 13. True when the row was written by the PLATFORM CONSOLE rather than by somebody who
     * works at this distributorship. It exists because `response` holds the reply that was given, and
     * a console reply is ours, not theirs — `admin.subscriptions.upsert` answers with what the
     * distributor pays US, which its own owner is deliberately not shown (`schema/platform-admin.ts`).
     * Without this flag the tenant policy below, which compares `tenant_id` and nothing else, would
     * hand that reply straight back through the idempotency table.
     */
    platformScoped: boolean('platform_scoped').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.key] }),
    /**
     * The distributor's own replays. Console rows are excluded by `platform_scoped` — see the column.
     * (Replaces the plain `tenantPolicy` this table carried; policy replacement moves no data and is
     * expressible in the schema, so it lands in the generated migration — coordination §2 rule 3.)
     */
    pgPolicy('idempotency_tenant', {
      for: 'all',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND platform_scoped = false`,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND platform_scoped = false`,
    }),
    /**
     * MODULE 13. A platform console mutation (`admin.subscriptions.upsert`, `admin.support.request`,
     * `admin.tenants.suspend`) is a mutation like any other and carries an `idempotencyKey`, so it has
     * to write a row here — but it runs with `app.actor_role = 'platform_admin'` and NO tenant of its
     * own, and `idempotency_tenant` above compares `tenant_id` to `app.tenant_id`, which a console
     * session leaves empty. Without these three the console could only be made idempotent by running
     * its writes under `withSystem()` (BYPASSRLS), which would take the whole of module 13 out from
     * under RLS to buy one row.
     *
     * `tenant_id` still points at a real distributor (the one the mutation names, foreign-keyed to
     * `tenants`), so this widens WHO may write a key, never WHAT the key may be. It reaches no
     * business row: `idempotency_keys` holds a request hash and the reply the console itself produced.
     */
    platformReadPolicy('idempotency_platform_read'),
    ...platformWritePolicies('idempotency_platform'),
  ],
).enableRLS()

/**
 * Offline sync idempotency (ADR 0007): each PowerSync CRUD transaction is identified by (device_id, op_id).
 * Retained >= 180 days because a device can stay offline for days; a replay returns the stored outcome.
 */
export const syncOps = pgTable(
  'sync_ops',
  {
    tenantId: tenantRef(),
    deviceId: text('device_id').notNull(),
    opId: text('op_id').notNull(),
    outcome: jsonb('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.deviceId, t.opId] }),
    tenantPolicy('sync_ops_tenant'),
  ],
).enableRLS()

/**
 * Business rejections of offline writes. The upload endpoint NEVER answers 4xx (it would wedge the
 * device queue); it answers 2xx and writes one of these rows, which syncs back to the device's
 * "Needs attention" tray with a Hindi and an English message.
 */
export const syncErrors = pgTable(
  'sync_errors',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    opId: text('op_id').notNull(),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    code: text('code').notNull(),
    messageHi: text('message_hi').notNull(),
    messageEn: text('message_en').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('sync_errors_user_idx').on(t.tenantId, t.userId, t.createdAt),
    /** `sync.errors.list` by device (docs/23 §8.11): the tray on ONE phone, since a cursor. */
    index('sync_errors_device_idx').on(t.tenantId, t.deviceId, t.createdAt),
    // A rejection belongs to the person whose device sent it: they read and resolve their own, the desk
    // reads and resolves everyone's (support triage). The upload handler writes `user_id = actor`, and
    // the INSERT check pins that so a device can never file a rejection under someone else's name.
    // No DELETE: the retention sweep runs as app_worker.
    pgPolicy('sync_errors_read', {
      for: 'select',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        user_id = (SELECT current_setting('app.actor_id', true))
        OR (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
      )`,
    }),
    pgPolicy('sync_errors_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        user_id = (SELECT current_setting('app.actor_id', true))
        OR (SELECT current_setting('app.actor_role', true)) = 'system'
      )`,
    }),
    pgPolicy('sync_errors_resolve', {
      for: 'update',
      to: appRw,
      using: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        user_id = (SELECT current_setting('app.actor_id', true))
        OR (SELECT current_setting('app.actor_role', true)) IN ('owner', 'manager', 'accountant', 'system')
      )`,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true))`,
    }),
  ],
).enableRLS()

/**
 * The DELETE half of the delta pull (founder decision 2026-09-05, docs/22 §8 and docs/26 §5: offline
 * sync is ours, no PowerSync). `GET /sync/pull` finds a changed row by `updated_at > cursor`; a row
 * that is GONE has no `updated_at` to find, so its disappearance is recorded here instead, by the
 * shared triggers in the 0040 migration (the number the sibling module 13 slice took 0039 from under
 * this comment; the triggers themselves have always been in `0040_sync_delta_guarantees.sql`, with
 * the shop-scoped soft hide added by 0041):
 *
 *  - `dos_sync_tombstone()` on DELETE of any pull-able table — reason `deleted`;
 *  - `dos_sync_soft_hide()` on the few UPDATEs that take a row OUT of a field device's read set
 *    without deleting it: a shop moved off the beat or closed (`beat_changed`, `deactivated`), a beat
 *    assignment ended (`assignment_ended`).
 *
 * A soft hide is per-reader, not per-tenant: the shop that left rep A's beat joined rep B's, so the
 * tombstone says only "this row may have left your set". `sync.pull` therefore sends the tombstoned
 * ids that are NOT in the caller's current read set, and the device applies deletes BEFORE rows, so a
 * row that both moved and is still visible survives.
 *
 * `tenant_id` is a plain column, not a reference: the curated global catalog (products, variants,
 * manufacturers, brands) is on the device too, and a curator deleting one of those rows files the
 * tombstone under the sentinel `'*'`, which every tenant reads. Nothing writes this table through
 * `app_rw` — there is a SELECT policy and no other, so the triggers (SECURITY DEFINER) are the only
 * author; a device can never be told to forget a row by a token that merely holds one.
 * Retained 180 days (`SYNC_TOMBSTONE_RETENTION_DAYS`) by the worker's retention sweep, the same window
 * `sync_ops` gets: a device offline longer than that re-pulls from a null cursor anyway.
 */
export const syncTombstones = pgTable(
  'sync_tombstones',
  {
    /** The row's tenant, or `'*'` for a row of the global curated catalog. */
    tenantId: text('tenant_id').notNull(),
    tableName: text('table_name').notNull(),
    /** The deleted row's `id`; for the two composite-key tables, its key parts joined by `:`. */
    rowId: text('row_id').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** `deleted` · `beat_changed` · `deactivated` · `assignment_ended`. */
    reason: text('reason').notNull().default('deleted'),
  },
  (t) => [
    // Re-deleting the same key updates the row rather than adding a second one (the trigger upserts).
    primaryKey({ columns: [t.tenantId, t.tableName, t.rowId] }),
    /** The pull: everything this tenant lost since the cursor, in one range scan. */
    index('sync_tombstones_pull_idx').on(t.tenantId, t.deletedAt),
    /** The pull of ONE table, and the retention sweep's per-tenant slice. */
    index('sync_tombstones_table_idx').on(t.tenantId, t.tableName, t.deletedAt),
    /**
     * Read only, and deliberately no write policy of any kind: see the header.
     *
     * Staff of the tenant read every tombstone of the tenant, plus the global catalog's (`'*'`). A
     * SHOPKEEPER reads only the tables a shop's device actually holds, and — for the two tables keyed
     * by a retailer id — only its OWN shops. Without the second half a shopkeeper's token would be told
     * the ids of visits, beats, trips, picklists and stock rows the distributorship deleted: not much,
     * but a shop is a customer of the business, not a member of it (never-list 9, docs/22 §9), and the
     * shop read set is a closed list, so there is no reason to hand it anything outside it. Deleted
     * rows cannot be joined to (they are gone), which is exactly why the ownership test is on `row_id`.
     */
    pgPolicy('sync_tombstones_read', {
      for: 'select',
      to: appRw,
      using: sql`(tenant_id = (SELECT current_setting('app.tenant_id', true)) OR tenant_id = '*') AND (
        (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        OR (
          table_name IN (
            'retailers', 'retailer_links', 'sales_orders', 'sales_order_lines', 'price_lists',
            'price_list_items', 'schemes', 'invoices', 'invoice_lines', 'credit_notes',
            'credit_note_lines', 'receipts', 'retailer_outstanding_summary', 'tenant_products',
            'products', 'product_variants', 'manufacturers', 'brands'
          )
          AND (
            table_name NOT IN ('retailers', 'retailer_outstanding_summary')
            OR row_id IN (
              SELECT l.retailer_id FROM retailer_links l
              WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
                AND l.user_id = (SELECT current_setting('app.actor_id', true))
                AND l.status = 'active'
            )
          )
        )
      )`,
    }),
  ],
).enableRLS()

/**
 * How long a tombstone is kept, in days — the worker's retention sweep drops older rows. It matches
 * `sync_ops`: a device that has been away longer than this must pull from a null cursor, which
 * rebuilds its tables from scratch and needs no tombstone at all.
 */
export const SYNC_TOMBSTONE_RETENTION_DAYS = 180

/**
 * ADR 0001: human-facing numbers (GL/1686, GRN-0042, TRIP-2026-09-04-01) are server-assigned at commit
 * from a per-tenant, per-series, per-financial-year counter taken under SELECT ... FOR UPDATE.
 * Invoice numbers stay <= 16 characters and unique per series per FY so they are IRN-ready.
 *
 * THE POLICY BELOW IS DELIBERATELY WIDE and the guarantee lives in a trigger. `nextDocumentNumber()`
 * bumps `next_no` as whoever issues the document — a rep submitting an order, a crew issuing a van-sale
 * bill, a shop submitting its own reorder — so every member must be able to UPDATE the counter.
 * What must NOT be any member's to touch is the configuration (docs/17 §D1: prefix and starting number
 * are the distributor's own, "changeable until the first invoice is issued"), and `next_no` must never
 * move backwards through an endpoint (a GST number is never reissued). Both are enforced by
 * `dos_numbering_series_guard()` in migration 0013: config columns change only while `next_no = 1` and
 * only under an owner/system actor; a rewind is refused for every app actor (the owner connection and
 * the system role may heal a counter). The trigger, not this policy, is what the owner app's numbering
 * screen leans on.
 */
export const allocationMode = pgEnum('allocation_mode', ['server', 'device', 'external'])

export const numberingSeries = pgTable(
  'numbering_series',
  {
    tenantId: tenantRef(),
    seriesCode: text('series_code').notNull(),
    fy: text('fy').notNull(),
    prefix: text('prefix').notNull().default(''),
    nextNo: integer('next_no').notNull().default(1),
    /** server = FOR UPDATE at issue; device = one issuing device per vehicle series (van sales offline); external = numbers from a brand DMS (docs/17 A5). */
    allocationMode: allocationMode('allocation_mode').notNull().default('server'),
    startingNo: integer('starting_no').notNull().default(1),
    deviceId: text('device_id'),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.seriesCode, t.fy] }),
    tenantPolicy('numbering_series_tenant'),
  ],
).enableRLS()

/**
 * Transactional outbox: domain events are inserted in the same transaction as the state change and
 * relayed by the worker. Modules integrate through these events, never through each other's tables.
 *
 * The relay (`backend/worker/src/jobs/outbox-relay.ts`, coordination §3.6) claims unpublished rows
 * with `FOR UPDATE SKIP LOCKED`, runs every handler registered for the event type and stamps
 * `published_at` only when all of them resolved. A throwing handler leaves the row unpublished:
 * `attempts` counts the tries, `next_attempt_at` holds it back with exponential backoff, `last_error`
 * keeps the newest failure for support, and after the last permitted attempt `dead_lettered_at` parks
 * the row (still unpublished, never retried, visible to an operator). One `published_at` means "every
 * handler that exists today saw it" — there is no per-consumer flag and none is being added.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    tenantId: tenantRef(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    /** Relay attempts so far (a handler threw, or the process died mid-batch). */
    attempts: integer('attempts').notNull().default(0),
    /** Not before this instant: the relay's exponential backoff after a failed attempt. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
    /** The newest handler failure, truncated; cleared when the row finally publishes. */
    lastError: text('last_error'),
    /** Parked after the last permitted attempt; an operator resets it (and `attempts`) to replay. */
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (t) => [
    index('outbox_unpublished_idx')
      .on(t.createdAt)
      .where(sql`published_at IS NULL`),
    index('outbox_aggregate_idx').on(t.aggregateType, t.aggregateId),
    tenantPolicy('outbox_tenant'),
  ],
).enableRLS()

/**
 * Per-tenant settings the owner edits in the console: the white-label branding every document carries
 * (`branding.display_name`, `branding.logo_object_key`, `branding.invoice_footer`), `upi_vpa` behind the
 * invoice QR, thresholds and policy text. Key names and defaults live in `src/tenant-bootstrap.ts`.
 *
 * THIS TABLE HAS TWO POLICIES THAT ARE NOT DECLARED HERE. Migration `0009_billing_guards.sql`
 * hand-writes `tenant_settings_staff_read`: SELECT for every role except `retailer`, on every key not
 * named `secret.%`. Migration `0013_platform_gaps_guarantees.sql` hand-writes
 * `tenant_settings_retailer_branding_read`: SELECT for the `retailer` role on `branding.%` keys only —
 * the white-label name and logo the shop's own app chrome shows (docs/22 §7, docs/23 §7), never
 * `upi_vpa`, never a threshold, never `secret.%`. Writes stay owner-only through `tenant_settings_owner`
 * below. Neither is declared in this file so `pnpm db:generate` does not emit them a second time
 * (docs/plans/00-coordination.md §2 rule 3 and §5.1) — read 0009 and 0013 before changing anything
 * about this table's row level security, and keep every credential or token under a `secret.` key so
 * widening reads can never leak one.
 */
export const tenantSettings = pgTable(
  'tenant_settings',
  {
    tenantId: tenantRef(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.key] }),
    tenantRolePolicy('tenant_settings_owner', OWNER_ROLES),
  ],
).enableRLS()

/**
 * Feature flags per tenant (pilot gating: van_sales, brand_dms_import, claims_ui, retailer_app,
 * e_invoicing). Every app hides a feature behind one, so EVERY member reads them — the crew's van-sale
 * button, the shop's app itself (docs/23 §8.13 `tenancy.featureFlags.list`). Only the owner flips one:
 * the old FOR ALL policy let a shopkeeper token switch van sales on for the whole distributor.
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    tenantId: tenantRef(),
    flag: text('flag').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.flag] }),
    tenantReadPolicy('feature_flags_read'),
    ...roleWritePolicies('feature_flags_write', OWNER_ROLES),
  ],
).enableRLS()

/**
 * Append-only audit trail of sensitive actions (price changes, credit limit edits, approvals, exports,
 * settings, GPS trace reads). Written by whoever did the thing, in the same transaction, with
 * `actor_id = app.actor_id` — the INSERT check pins that. Read by the back office only
 * (`tenancy.audit.list`, docs/23 §8.13): the `before`/`after` of a credit-limit edit or a price change
 * is exactly what a rep or a shopkeeper must not see. UPDATE and DELETE have no policy and the 0003
 * trigger refuses them anyway.
 *
 * `audit_log_entity_time_idx` serves "what happened to THIS retailer, newest first" and subsumes the
 * old `audit_log_entity_idx` (same leading columns), which the same migration drops (coordination
 * §5.4); `audit_log_actor_idx` serves "what did THIS person change".
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    tenantId: tenantRef(),
    actorId: text('actor_id').notNull(),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    deviceId: text('device_id'),
    occurredAt: tz('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_time_idx').on(t.tenantId, t.entityType, t.entityId, t.occurredAt),
    index('audit_log_actor_idx').on(t.tenantId, t.actorId, t.occurredAt),
    index('audit_log_time_idx').on(t.tenantId, t.occurredAt),
    roleReadPolicy('audit_log_read', BACK_OFFICE_ROLES),
    pgPolicy('audit_log_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql`tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (
        actor_id = (SELECT current_setting('app.actor_id', true))
        OR (SELECT current_setting('app.actor_role', true)) = 'system'
      )`,
    }),
  ],
).enableRLS()

/** Where an uploaded file belongs; fixes the object-key convention `tenant/{tenantId}/{domain}/{entityId}/…`. */
export const fileDomain = pgEnum('file_domain', [
  'logo',
  'pod',
  'expense',
  'claim',
  'import',
  'damage',
  'docs',
  'invoices',
  'challans',
  'exports',
  'statements',
  'receipts',
])
export const fileObjectStatus = pgEnum('file_object_status', ['pending', 'uploaded', 'deleted'])

/**
 * The registry behind `files.uploadUrl` / `files.readUrl` (docs/23 §8.13): one row per object a member
 * asked to upload, written BEFORE the bytes exist (`pending`), flipped to `uploaded` when they land, so a
 * signed PUT that was never used can be swept and a `readUrl` request can be checked against the domain
 * and entity the key was issued for instead of trusting the caller's string. The bytes themselves never
 * touch the database (scale rule: nothing binary through a service). Staff only: a shopkeeper's reads of
 * a POD photo or a bill PDF go through the owning row (`deliveries`, `invoices`), which RLS already
 * scopes, and the service signs the URL — the registry is the distributor's inventory of its files.
 */
export const fileObjects = pgTable(
  'file_objects',
  {
    id: id(),
    tenantId: tenantRef(),
    domain: fileDomain('domain').notNull(),
    /** The row the file hangs off (a delivery, a claim, an import job, the tenant itself for the logo). */
    entityId: text('entity_id').notNull(),
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256'),
    status: fileObjectStatus('status').notNull().default('pending'),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id),
    uploadedAt: tz('uploaded_at'),
    deletedAt: tz('deleted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('file_objects_key_idx').on(t.tenantId, t.objectKey),
    index('file_objects_entity_idx').on(t.tenantId, t.domain, t.entityId),
    index('file_objects_status_idx').on(t.tenantId, t.status, t.createdAt),
    staffReadPolicy('file_objects_read'),
    ...roleWritePolicies('file_objects_write', STAFF_ROLES),
  ],
).enableRLS()
