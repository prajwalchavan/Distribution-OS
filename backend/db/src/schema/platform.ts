import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { id, tenantPolicy, tenantRolePolicy, timestamps, tz, OWNER_ROLES } from './columns.js'
import { tenants } from './tenancy.js'

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
    tenantPolicy('sync_errors_tenant'),
  ],
).enableRLS()

/**
 * ADR 0001: human-facing numbers (GL/1686, GRN-0042, TRIP-2026-09-04-01) are server-assigned at commit
 * from a per-tenant, per-series, per-financial-year counter taken under SELECT ... FOR UPDATE.
 * Invoice numbers stay <= 16 characters and unique per series per FY so they are IRN-ready.
 */
export const numberingSeries = pgTable(
  'numbering_series',
  {
    tenantId: tenantRef(),
    seriesCode: text('series_code').notNull(),
    fy: text('fy').notNull(),
    prefix: text('prefix').notNull().default(''),
    nextNo: integer('next_no').notNull().default(1),
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

/** Per-tenant settings the owner edits in the console (numbering formats, GPS policy text, credit defaults...). */
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

/** Feature flags per tenant (pilot gating: van_sales, brand_dms_import, claims_ui...). Readable by all members. */
export const featureFlags = pgTable(
  'feature_flags',
  {
    tenantId: tenantRef(),
    flag: text('flag').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.flag] }), tenantPolicy('feature_flags_tenant')],
).enableRLS()

/** Append-only audit trail of sensitive actions (price changes, credit limit edits, approvals, exports). */
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
    index('audit_log_entity_idx').on(t.tenantId, t.entityType, t.entityId),
    index('audit_log_time_idx').on(t.tenantId, t.occurredAt),
    tenantPolicy('audit_log_tenant'),
  ],
).enableRLS()
