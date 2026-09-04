import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { id, tenantPolicy, timestamps, tz } from './columns.js'
import { tenantRef } from './platform.js'
import { appRw } from './roles.js'
import { users } from './tenancy.js'

/** WhatsApp/SMS first for retailers, push for staff. Every send is a row with its cost. */

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
    locale: text('locale').notNull().default('hi-IN'),
    payload: jsonb('payload').notNull(),
    status: messageStatus('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    costPaise: integer('cost_paise'),
    error: text('error'),
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
    tenantPolicy('messages_tenant'),
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
    tenantPolicy('whatsapp_windows_tenant'),
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
    tenantPolicy('inbound_messages_tenant'),
  ],
).enableRLS()

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
    tenantPolicy('push_tokens_tenant'),
  ],
).enableRLS()
