import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
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
  BACK_OFFICE_ROLES,
  id,
  MANAGEMENT_ROLES,
  roleReadPolicy,
  roleWritePolicies,
  STAFF_ROLES,
  staffReadPolicy,
  staffWritePolicy,
  tenantOrOwnRetailerPolicy,
  tenantRolePolicy,
  timestamps,
  tz,
} from './columns.js'
import { tenantRef } from './platform.js'
import { beats } from './retailers.js'
import { appRw } from './roles.js'
import { users } from './tenancy.js'

/**
 * WhatsApp/SMS first for retailers, push for staff. Every send is a row with its cost.
 *
 * Who reads and writes what (migrations 0024/0025, docs/plans/notifications.md §3, coordination §5.3):
 *  - `messages`: staff read the whole log; a shopkeeper reads only the rows addressed to ITS OWN shop
 *    (`recipient_retailer_id` through the denormalised `retailer_links.user_id`, never a join on
 *    `retailer_identities`). Staff write. The one write a shop may make is the read receipt on its own
 *    in-app / push row (`messages.markRead`, docs/23 R12): `messages_retailer_read_receipt` admits
 *    the row, and `dos_messages_guard()` (0025) admits the `read_at` column and nothing else. For
 *    every actor the columns of §4.17 (`channel`, `to`, `template_key`, `payload`, the recipient, the
 *    ref, the idempotency key) never change after insert: a correction is a fresh message.
 *  - `inbound_messages`, `whatsapp_windows`: staff-only operational state; a shop's own texts come
 *    back to it through the retailer app's timeline, never by reading this table.
 *  - `push_tokens`: every staff member reads the tenant's device list (admin visibility); a token is
 *    written only by the user it belongs to, or the worker — a co-worker cannot overwrite or delete
 *    someone else's device. The shop has no push (docs/06: WhatsApp / PWA first).
 *  - `broadcasts`: the owner and the manager send; the accountant reads the history (its "reads and
 *    exports everything" seat, docs/22 §8 2026-09-05); the worker refreshes the counters.
 */

export const channel = pgEnum('notification_channel', [
  'whatsapp',
  'sms',
  'push',
  'email',
  'in_app',
])
export const messageStatus = pgEnum('message_status', [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'skipped',
])

/** Approved message templates per locale (hi / en / mr). WhatsApp template names must match Meta's approval. */
export const templates = pgTable(
  'templates',
  {
    id: id(),
    /** NULL = platform default; tenants may override wording. */
    tenantId: text('tenant_id'),
    key: text('key').notNull(),
    channel: channel('channel').notNull(),
    locale: text('locale').notNull(),
    providerTemplateName: text('provider_template_name'),
    body: text('body').notNull(),
    variables: jsonb('variables')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('templates_key_idx').on(sql`coalesce(tenant_id, '')`, t.key, t.channel, t.locale),
    pgPolicy('templates_read', {
      for: 'select',
      to: appRw,
      using: sql`tenant_id IS NULL OR tenant_id = (SELECT current_setting('app.tenant_id', true))`,
    }),
    pgPolicy('templates_write', {
      for: 'all',
      to: appRw,
      using: sql`(tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')) OR (tenant_id IS NULL AND (SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'))`,
      withCheck: sql`(tenant_id = (SELECT current_setting('app.tenant_id', true)) AND (SELECT current_setting('app.actor_role', true)) IN ('owner', 'system')) OR (tenant_id IS NULL AND (SELECT current_setting('app.actor_role', true)) IN ('curator', 'system'))`,
    }),
  ],
).enableRLS()

/**
 * The shopkeeper's own in-app / push row: the `tenantOrOwnRetailerPolicy` shape narrowed to the
 * retailer role and to the two channels whose read state a client may set. Kept as one string so
 * USING and WITH CHECK are the same predicate (an update may not move a row out of the shop's inbox).
 */
const RETAILER_OWN_INBOX_ROW = `tenant_id = (SELECT current_setting('app.tenant_id', true))
        AND (SELECT current_setting('app.actor_role', true)) = 'retailer'
        AND channel IN ('in_app', 'push')
        AND recipient_retailer_id IN (
          SELECT l.retailer_id FROM retailer_links l
          WHERE l.tenant_id = (SELECT current_setting('app.tenant_id', true))
            AND l.user_id = (SELECT current_setting('app.actor_id', true))
            AND l.status = 'active'
        )`

export const messages = pgTable(
  'messages',
  {
    id: id(),
    tenantId: tenantRef(),
    channel: channel('channel').notNull(),
    templateKey: text('template_key'),
    /** E.164 phone, push token id, or email. */
    to: text('to').notNull(),
    recipientUserId: text('recipient_user_id'),
    recipientRetailerId: text('recipient_retailer_id'),
    /** English only for now (founder, 2026-09-04; coordination ground truth). `LocaleSchema` values. */
    locale: text('locale').notNull().default('en-IN'),
    payload: jsonb('payload').notNull(),
    status: messageStatus('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    costPaise: integer('cost_paise'),
    error: text('error'),
    /**
     * Retry with backoff, then terminate (notifications §4.5): the dispatch sweep sends a row whose
     * `next_attempt_at` is due (or NULL), bumps `attempts` on every failure and schedules the next try;
     * past the cap (5, a constant in the module) the row stays `failed`. A manual `messages.resend`
     * resets `next_attempt_at`, never `attempts`, so a wrong number still terminates.
     */
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: tz('next_attempt_at'),
    /** What this message is about, so the retailer's timeline can link back (invoice, order, receipt). */
    refType: text('ref_type'),
    refId: text('ref_id'),
    scheduledAt: tz('scheduled_at'),
    sentAt: tz('sent_at'),
    deliveredAt: tz('delivered_at'),
    readAt: tz('read_at'),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('messages_idempotency_idx').on(t.tenantId, t.idempotencyKey),
    index('messages_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('messages_ref_idx').on(t.tenantId, t.refType, t.refId),
    /** The worker's dispatch sweep: what is due, by due time, over the small live set only. */
    index('messages_dispatch_idx')
      .on(t.tenantId, t.status, t.nextAttemptAt)
      .where(sql`status IN ('queued', 'failed')`),
    /** The shop's inbox and the `messages_read` predicate both filter on the recipient shop. */
    index('messages_recipient_retailer_idx').on(t.tenantId, t.recipientRetailerId, t.createdAt),
    check('messages_attempts_nonnegative', sql`attempts >= 0`),
    // Staff read every row of the tenant; a shopkeeper reads only the rows addressed to its own shop
    // (a staff-only in-app / push row has a NULL recipient_retailer_id and is invisible to it).
    tenantOrOwnRetailerPolicy('messages_read', 'recipient_retailer_id'),
    ...staffWritePolicy('messages_write'),
    // The shop's read receipt on its own in-app / push notice (`messages.markRead`, docs/23 R12).
    // WhatsApp / SMS read state comes only from the provider webhook, so those channels are outside
    // this policy; which COLUMN the shop may change is `dos_messages_guard()` (0025): `read_at` only.
    pgPolicy('messages_retailer_read_receipt', {
      for: 'update',
      to: appRw,
      using: sql.raw(RETAILER_OWN_INBOX_ROW),
      withCheck: sql.raw(RETAILER_OWN_INBOX_ROW),
    }),
  ],
).enableRLS()

/** 24-hour customer-service windows: a retailer's inbound message opens free-form replies until this expires. */
export const whatsappWindows = pgTable(
  'whatsapp_windows',
  {
    tenantId: tenantRef(),
    phone: text('phone').notNull(),
    openedAt: tz('opened_at').notNull(),
    expiresAt: tz('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('whatsapp_windows_idx').on(t.tenantId, t.phone),
    // Staff-only operational state (notifications §3.3): the shop is not a member of the business.
    tenantRolePolicy('whatsapp_windows_staff', STAFF_ROLES),
  ],
).enableRLS()

/** Inbound WhatsApp/SMS (order text, "payment done" photos) captured for the retailer's timeline and support. */
export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: id(),
    tenantId: tenantRef(),
    channel: channel('channel').notNull(),
    from: text('from').notNull(),
    retailerId: text('retailer_id'),
    body: text('body'),
    mediaObjectKey: text('media_object_key'),
    providerMessageId: text('provider_message_id'),
    receivedAt: tz('received_at').notNull().defaultNow(),
    handled: boolean('handled').notNull().default(false),
  },
  (t) => [
    index('inbound_messages_idx').on(t.tenantId, t.receivedAt),
    uniqueIndex('inbound_messages_provider_idx')
      .on(t.tenantId, t.providerMessageId)
      .where(sql`provider_message_id IS NOT NULL`),
    // Staff-only (notifications §3.3): a rep's triage queue and the desk's support view; the shop's
    // own texts reach it through its timeline, never by reading this table.
    tenantRolePolicy('inbound_messages_staff', STAFF_ROLES),
  ],
).enableRLS()

/**
 * The device's own STAFF user, or the worker, inside the tenant. The retailer role is excluded even
 * for its own user id: the shop registers no push in this slice (notifications §4.10, §8 item 7 — the
 * retailer app is WhatsApp / PWA first), so a shopkeeper token writes nothing here.
 */
const PUSH_TOKEN_OWNER = `tenant_id = (SELECT current_setting('app.tenant_id', true))
        AND (SELECT current_setting('app.actor_role', true)) <> 'retailer'
        AND (
          user_id = (SELECT current_setting('app.actor_id', true))
          OR (SELECT current_setting('app.actor_role', true)) = 'system'
        )`

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: id(),
    tenantId: tenantRef(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id').notNull(),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    lastSeenAt: tz('last_seen_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('push_tokens_device_idx').on(t.tenantId, t.userId, t.deviceId),
    // Every staff member reads the tenant's device list (admin visibility, notifications §3.4); the
    // shop reads none — a device token is a staff credential, and the retailer app has no push.
    staffReadPolicy('push_tokens_read'),
    // A token is written by the staff user it belongs to, or by the worker: `pushTokens.register`
    // always writes `userId = ctx.actorId`, and this is the database's own copy of that rule — a
    // co-worker can neither overwrite nor delete someone else's device, and the shop writes none.
    pgPolicy('push_tokens_own_insert', {
      for: 'insert',
      to: appRw,
      withCheck: sql.raw(PUSH_TOKEN_OWNER),
    }),
    pgPolicy('push_tokens_own_update', {
      for: 'update',
      to: appRw,
      using: sql.raw(PUSH_TOKEN_OWNER),
      withCheck: sql.raw(PUSH_TOKEN_OWNER),
    }),
    pgPolicy('push_tokens_own_delete', {
      for: 'delete',
      to: appRw,
      using: sql.raw(PUSH_TOKEN_OWNER),
    }),
  ],
).enableRLS()

/**
 * An owner or manager's ad-hoc send to a beat or to a named list of shops (`broadcasts.create`): the
 * header row; the per-recipient rows are `messages` with `ref_type = 'broadcast'`, `ref_id = this id`
 * and `idempotency_key = '<broadcastId>:<retailerId>'`. The four counters are denormalised by the
 * dispatch sweep so `broadcasts.list` never re-aggregates a tenant's whole message history; the live
 * grouped query stays the fallback for `get`'s per-recipient drill-down (notifications §2, §3.5).
 * Never `push` or `email`: a broadcast is a message to shops, and shops are reached on WhatsApp, SMS
 * or the retailer app's inbox.
 */
export const broadcasts = pgTable(
  'broadcasts',
  {
    id: id(),
    tenantId: tenantRef(),
    /** NULL for an explicit `retailerIds` broadcast; the beat's tenant is checked by 0025's guard. */
    beatId: text('beat_id').references(() => beats.id),
    channel: channel('channel').notNull(),
    templateKey: text('template_key').notNull(),
    /** Per-recipient locale override; NULL = resolved per recipient (notifications §4.4). */
    locale: text('locale'),
    /** Broadcast-wide template variables, merged under any per-recipient ones. */
    variables: jsonb('variables')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    /** Bounded at 500 by `broadcasts.create` (docs/20 rule 3); the count includes skipped shops. */
    totalRecipients: integer('total_recipients').notNull(),
    queuedCount: integer('queued_count').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('broadcasts_created_idx').on(t.tenantId, t.createdAt),
    index('broadcasts_beat_idx')
      .on(t.tenantId, t.beatId, t.createdAt)
      .where(sql`beat_id IS NOT NULL`),
    check('broadcasts_channel_for_shops', sql`channel IN ('whatsapp', 'sms', 'in_app')`),
    check(
      'broadcasts_counts_nonnegative',
      sql`total_recipients >= 0 AND queued_count >= 0 AND sent_count >= 0 AND delivered_count >= 0 AND failed_count >= 0`,
    ),
    check(
      'broadcasts_counts_within_total',
      sql`queued_count + sent_count + delivered_count + failed_count <= total_recipients`,
    ),
    // The owner and the manager send; the accountant reads the history; the worker refreshes counters.
    roleReadPolicy('broadcasts_read', BACK_OFFICE_ROLES),
    ...roleWritePolicies('broadcasts_write', MANAGEMENT_ROLES),
  ],
).enableRLS()
