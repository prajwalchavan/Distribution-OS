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
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] }), tenantPolicy('idempotency_tenant')],
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
