import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
  IdSchema,
  LocaleSchema,
  MutationBase,
  PaiseSchema,
  QueryBoolSchema,
  QueryIntSchema,
} from './common.js'

/**
 * Notifications — the distributor's and the shopkeeper's only view of "did the message go out"
 * (docs/plans/notifications.md, coordination §1 slot 8). Every WhatsApp template, SMS, push and in-app
 * notice the platform ever sends is ONE row in `messages`, queued in the same transaction as its trigger
 * and dispatched later by the worker (never inline in a request, docs/20 rule 3), retried with backoff
 * and metered by cost. The module owns `templates`, `messages`, `broadcasts`, `whatsapp_windows`,
 * `inbound_messages` and `push_tokens` and nothing else. It CALLS OUT only to
 * `RetailersService.contactPreferences` (phone, opt-in, preferred language of a shop — coordination §3.9
 * / §4) and is called by nobody's write path: every automatic send arrives as an `outbox_events` row
 * (`OrderConfirmed`, `OrderCancelled`, `InvoiceIssued`, `DeliveryRecorded`, `CollectionRecorded`, …)
 * whose JSON payload is the whole source of what the template prints. It never reads `sales_orders`,
 * `invoices`, `deliveries` or `receipts`.
 *
 * WHICH SERVICES MOUNT `notifications` (docs/plans/00-coordination.md §6 table: every role service;
 * `auth-service` mounts nothing):
 *
 *   owner :3001      YES — the whole surface (O23): templates, broadcasts to a beat, the message log with
 *                    cost and provider detail, resend, the inbound triage queue, on-demand `send`
 *   manager :3002    YES — manager + accountant (M18). The MANAGER edits templates and creates broadcasts
 *                    (MANAGEMENT, the same two people coordination §6 calls PIN_HOLDERS); the ACCOUNTANT
 *                    reads templates, broadcasts and the full log, resends a failed row, triages inbound
 *                    texts and sends a bill / receipt / statement to a shop on demand — none of it is a
 *                    price, a scheme, a credit limit, an approval or a setting (docs/22 2026-09-05)
 *   sales :3003      YES — READ ONLY (S13): `messages.list/get/markRead` scoped by the handler to the
 *                    shops on the rep's own beats plus the rep's own in-app notices, `inbound.list /
 *                    markHandled` for "what did my shop text me" (TRIAGE), `pushTokens.register /
 *                    unregister` for its own phone. Never a template, a broadcast, a resend or a `send`
 *   warehouse :3004  YES — its own inbox and push token only (W12): `messages.list/get/markRead`,
 *                    `pushTokens.*`. Everything else refuses the role in PERMISSIONS
 *   delivery :3005   YES — its own inbox and push token (D12), and `messages.send` at the door (D9:
 *                    "send this bill / POD / receipt to the shop now"). The `delivery_today` message a
 *                    trip triggers is SYSTEM-SENT by the worker's 07:00 IST sweep — no endpoint, nothing
 *                    for the crew to press
 *   retailer :3006   YES — ITS INBOX ONLY (R12): `messages.list/get/markRead`. RLS (`messages_read` =
 *                    `tenantOrOwnRetailerPolicy` on `recipient_retailer_id`, migration per coordination
 *                    §2) limits the shop to rows addressed to its own shop; templates, broadcasts,
 *                    inbound, push tokens, resend and send all refuse the role in PERMISSIONS. A shop
 *                    with several distributors sees one inbox per membership, each under that
 *                    distributor's own name
 *
 * FOUNDER ANSWERS (docs/17 §D, docs/22 §8) THAT SHAPE THIS FILE:
 *
 *  1. WHITE-LABEL (§D6, never-list 10): every outbound message carries the DISTRIBUTOR'S OWN NAME, never
 *     "Distribution OS". Two mechanisms, both visible on the wire: (a) `MessageSchema.senderName` is the
 *     tenant's `branding.display_name` (legal name fallback) FROZEN on the row when it is queued, so the
 *     shop's inbox and the WhatsApp/SMS text agree even after a rebrand; (b) `{{distributorName}}` is a
 *     RESERVED template variable (`RESERVED_TEMPLATE_VARIABLES`), always supplied by the service from
 *     `tenancy` branding and never listed in `variables`. A `whatsapp` or `sms` template body — the two
 *     channels that land on a shopkeeper's phone under the PLATFORM's sender identity (brief §8.1: one
 *     shared WhatsApp Business Account for the pilot) — MUST contain `{{distributorName}}`; `templates.
 *     upsert` answers 400 `distributor_name_missing` otherwise. `push` / `in_app` bodies may omit it: the
 *     app chrome and `senderName` carry the name there.
 *  2. ENGLISH ONLY for now (docs/22 §8 2026-09-04, coordination §2: `notifications.default_locale =
 *     'en-IN'`, NOT the brief's `hi-IN`): the template shape is per-language (`locale` is part of the
 *     natural key `(tenantId, key, channel, locale)`, so Hindi and Marathi bodies land later as new rows
 *     with no schema change), but only `en-IN` rows are seeded and `templates.upsert.locale` defaults to
 *     `en-IN`. The locale chain per recipient is `retailer_links.preferred_lang` → the tenant's
 *     `notifications.default_locale` → `en-IN`, and a missing translation falls back to the `en-IN`
 *     template rather than blocking a bill from going out.
 *  3. THE SALESPERSON NEVER COLLECTS (§D4) and here NEVER SENDS: the rep reads what went to its shops and
 *     what they wrote back; the desk and the crew at the door are the only humans who push a document
 *     to a shop's phone (`SHOP_MESSENGERS` in permissions.ts).
 *
 * COORDINATION FACTS THAT SHAPE THIS FILE:
 *
 *  - QUEUE, THEN DISPATCH — never a provider call on the request path. `messages.send`,
 *    `broadcasts.create` and `messages.resend` all answer with a `queued` row; the worker's
 *    `notifications.dispatch` sweep (≤ 200 due rows per tick, cross-tenant) moves it to `sent` /
 *    `failed`, and the provider webhook (a platform route outside this contract, brief §7) to
 *    `delivered` / `read`.
 *  - WHATSAPP NEEDS OPT-IN; SMS IS THE FALLBACK, NEVER A SILENT DROP (docs/17 A6): a recipient without
 *    `whatsapp_optin_at` on its active owner-role link gets the same message by `sms`; a recipient with
 *    no phone at all is a `skipped` row (the DB enum has the value), reported in `broadcasts.create.
 *    skipped` and counted in `skippedCount`, never absent from the total.
 *  - RETRY WITH BACKOFF, THEN TERMINATE: `attempts` caps at 5 (`1m, 5m, 30m, 2h, 12h`); `messages.resend`
 *    requeues a `failed` row WITHOUT resetting `attempts`, so a number that is simply wrong still stops.
 *    A `sent` / `delivered` / `read` row is never resent (409 `already_sent`): a correction is a NEW
 *    message.
 *  - COST AND PROVIDER INTERNALS ARE A BACK-OFFICE FIGURE, the same posture as purchase cost (brief §4.7):
 *    `costPaise`, `providerMessageId` and `error` are OPTIONAL on `MessageSchema` and the mapper OMITS
 *    them for every role but owner / manager / accountant.
 *  - "READ" IS EXPLICIT, NEVER INFERRED (brief §4.11–4.12): `markRead` sets `readAt` on the caller's own
 *    `push` / `in_app` row and refuses (400 `channel_not_markable`) a `whatsapp` / `sms` row, whose read
 *    state comes only from the provider. Opening the inbox marks nothing.
 *  - BOUNDED WORK (docs/20 rule 3): ≤ 500 recipients per broadcast, ≤ 200 rows per list, ≤ 20 variables
 *    and ≤ 1024 characters per template body, one grouped count per broadcast, never a per-message loop.
 *  - DETERMINISTIC IDEMPOTENCY KEYS on `messages` (`UNIQUE(tenant_id, idempotency_key)`): an outbox send is
 *    `<eventType>:<aggregateId>`, a broadcast recipient `<broadcastId>:<retailerId>`, an on-demand send
 *    the caller's `idempotencyKey`. A worker crash and replay can never double-send.
 *  - A MESSAGE ROW IS IMMUTABLE IN SPIRIT once queued: only `status`, `providerMessageId`, `costPaise`,
 *    `error`, `attempts`, `nextAttemptAt`, `sentAt`, `deliveredAt`, `readAt` ever change. `channel`,
 *    `destination`, `templateKey`, `payload`, `senderName` never do.
 *  - DPDP: a shop's phone is read from the tenant's own `retailers.phone` / `retailer_links`, never from
 *    the global `retailer_identities.phone`; nothing here reveals which other distributors share a
 *    shopkeeper. `inbound_messages.media_object_key` is an object key; the wire carries a short-lived
 *    signed `mediaUrl`, never bytes (docs/20 rule 15).
 *
 * DOCS/23 §8.8 GAP CLOSED HERE: `messages.send` — POST `/notifications/messages/send` — the on-demand
 * "send this bill / receipt / statement to the shop now" from a screen (D9, M9, O6). The caller names
 * the template, the shop and the document (`refType` + `refId`) and supplies the template's variables
 * from what is already on its screen (an invoice number, an amount in rupees, the signed PDF URL from
 * `billing.invoices.pdf`); the service resolves the phone, the channel and the locale exactly as a
 * broadcast does and queues ONE row. The module reads no other module's table to build it.
 *
 * Money is integer paise, ids client-generated UUIDv7, timestamps ISO-8601 strings, dates IST
 * (`businessDate()`), every list caps `limit` at 200 and pages on `cursor` = the last row's id (UUIDv7,
 * so newest-first order is the id order). No shape below carries a purchase cost, a landed cost, a PTD
 * or a margin.
 */

const IsoDateSchema = z.iso.date()
/** The phone registering a push token; the same string `auth.login` was given as `deviceId`. */
const DeviceIdSchema = z.string().trim().min(1).max(128)
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

// ---------------------------------------------------------------------------------------------------------------
// enums (mirror the DB enums verbatim: `notification_channel`, `message_status`)

/** WhatsApp / SMS reach the shop; push and in-app reach staff (and the retailer app's own inbox); email is reserved. */
export const NotificationChannelSchema = z.enum(['whatsapp', 'sms', 'push', 'email', 'in_app'])
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>

/**
 * queued → sent (provider accepted) → delivered → read, or failed (retried up to 5 times, then final),
 * or skipped (no phone / no token: nothing to send, still a row so the count is honest).
 */
export const MessageStatusSchema = z.enum([
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'skipped',
])
export type MessageStatus = z.infer<typeof MessageStatusSchema>

/** What a broadcast may go out as: never `push` (staff devices) and never `email` (reserved). */
export const BroadcastChannelSchema = z.enum(['whatsapp', 'sms', 'in_app'])
export type BroadcastChannel = z.infer<typeof BroadcastChannelSchema>

/** Only `whatsapp` / `sms` are on-demand sends to a shop; omitted = resolved from the shop's opt-in. */
export const SendChannelSchema = z.enum(['whatsapp', 'sms'])
export type SendChannel = z.infer<typeof SendChannelSchema>

export const PushPlatformSchema = z.enum(['android', 'ios', 'web'])
export type PushPlatform = z.infer<typeof PushPlatformSchema>

/**
 * What a message is about, so the retailer's timeline and a push tap can deep-link back to it. `refId`
 * is the id of that row: an order, an invoice, a delivery, a receipt, the trip stop of a "delivery
 * today" notice, the shop itself (dues reminder, welcome), or the broadcast header.
 */
export const MessageRefTypeSchema = z.enum([
  'order',
  'invoice',
  'delivery',
  'receipt',
  'trip_stop',
  'retailer',
  'broadcast',
])
export type MessageRefType = z.infer<typeof MessageRefTypeSchema>

/**
 * The platform-default template keys (seeded with `tenantId = null`, `en-IN`, per channel). A tenant
 * may override any of them and may add its own keys for broadcasts; the outbox handlers and the worker
 * sweeps send exactly these.
 */
export const PLATFORM_TEMPLATE_KEYS = [
  'order_confirmed',
  'order_cancelled',
  'order_needs_approval',
  'invoice_issued',
  'pod_delivered',
  'payment_received',
  'dues_reminder',
  'delivery_today',
  'scheme_announcement',
  'welcome',
] as const
export type PlatformTemplateKey = (typeof PLATFORM_TEMPLATE_KEYS)[number]

/** snake_case, 1–60 characters; the stable name a WhatsApp template is approved under, per channel. */
export const TemplateKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, 'snake_case template key')

/** A `{{token}}` name inside a body: camelCase, 1–40 characters, exactly as it appears between the braces. */
export const TemplateVariableNameSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'variable name')

/**
 * Supplied by the service on every send from the tenant's branding, never by the caller and never listed
 * in `variables` (400 `reserved_variable` if a template declares one). `distributorName` is the white
 * label (founder answer 1 above).
 */
export const RESERVED_TEMPLATE_VARIABLES = ['distributorName'] as const
export type ReservedTemplateVariable = (typeof RESERVED_TEMPLATE_VARIABLES)[number]

/** Template variables as sent: string values only, ≤ 200 characters each, ≤ 20 of them. */
export const TemplateVariablesSchema = z
  .record(TemplateVariableNameSchema, z.string().max(200))
  .refine((v) => Object.keys(v).length <= 20, 'at most 20 variables')

// ---------------------------------------------------------------------------------------------------------------
// messages

/**
 * One outbound message. `costPaise`, `providerMessageId` and `error` are present ONLY for owner /
 * manager / accountant callers (the mapper omits the keys for every other role, brief §4.7). `body` is
 * the text as rendered for this recipient (variables substituted, the distributor's name in place);
 * it is null only for a `skipped` row that was never rendered. `senderName` and `body` live inside the
 * row's `payload` (jsonb, written once at queue time and by nobody else), not in columns of their own.
 */
export const MessageSchema = z.object({
  id: IdSchema,
  channel: NotificationChannelSchema,
  templateKey: z.string().nullable(),
  /** E.164 phone for `whatsapp` / `sms`, the push token id for `push`, the recipient id for `in_app`. */
  destination: z.string(),
  recipientUserId: IdSchema.nullable(),
  recipientRetailerId: IdSchema.nullable(),
  /** The shop's name of record when `recipientRetailerId` is set — the owner's log needs no second call. */
  retailerName: z.string().nullable(),
  /** The distributor's display name FROZEN in the payload when the row was queued (white label, founder answer 1). */
  senderName: z.string(),
  locale: LocaleSchema,
  body: z.string().nullable(),
  status: MessageStatusSchema,
  refType: MessageRefTypeSchema.nullable(),
  refId: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
  /** Back office only: what this send cost (₹0.136 per WhatsApp utility template, a flat SMS rate). */
  costPaise: PaiseSchema.nullable().optional(),
  /** Back office only. */
  providerMessageId: z.string().nullable().optional(),
  /** Back office only: the provider's last error, kept verbatim so the owner can read "invalid destination". */
  error: z.string().nullable().optional(),
})
export type Message = z.infer<typeof MessageSchema>

/** The deep-link target of a push / WhatsApp tap: the row plus its variables and retry state. */
export const MessageDetailSchema = MessageSchema.extend({
  /**
   * The row's payload: the variables the template was rendered with, reserved ones included, plus the
   * frozen `senderName` and rendered `body`. Sourced from the event's own JSON or the caller's
   * `variables`, never a fresh query — so never a purchase cost.
   */
  payload: z.record(z.string(), z.unknown()),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string().nullable(),
})
export type MessageDetail = z.infer<typeof MessageDetailSchema>

const MessageItemOutput = z.object({ item: MessageDetailSchema })

/**
 * The message log for staff and the retailer's own inbox in ONE procedure (billing's `invoices.list`
 * pattern). RLS scopes a shop to rows addressed to its own shop; the handler scopes a salesperson to
 * the shops on its own beats plus its own in-app notices; the desk, the godown and the crew read the
 * tenant's log (the godown and the crew normally with `mine = true`). Newest first.
 */
export const MessagesListInput = z.object({
  channel: NotificationChannelSchema.optional(),
  status: MessageStatusSchema.optional(),
  refType: MessageRefTypeSchema.optional(),
  refId: IdSchema.optional(),
  /** Staff filter: one shop's timeline. Ignored for a retailer caller (RLS already decides). */
  retailerId: IdSchema.optional(),
  /** Only rows addressed to ME: `recipientUserId = actor` for staff; implied for a retailer caller. */
  mine: QueryBoolSchema.optional(),
  /** Only `push` / `in_app` rows with `readAt IS NULL` — the inbox badge. */
  unreadOnly: QueryBoolSchema.optional(),
  /** Created on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export type MessagesListIn = z.infer<typeof MessagesListInput>

/** `unreadCount` = the CALLER's own `push` / `in_app` rows with `readAt IS NULL`, whatever the filters (0 when reading another's log). */
export const MessagesListOutput = z.object({
  items: z.array(MessageSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
})
export type MessagesList = z.infer<typeof MessagesListOutput>

/** A row of another tenant, another shop or another rep's beat is NOT_FOUND — never a 403 that confirms it exists. */
export const MessageGetInput = z.object({ id: IdSchema })
export const MessageGetOutput = MessageItemOutput

/**
 * Requeue a `failed` row (or a `queued` one stuck past `nextAttemptAt`): `status = queued`,
 * `nextAttemptAt = now`, `attempts` UNCHANGED. 409 `already_sent` on `sent` / `delivered` / `read`;
 * 409 `nothing_to_send` on `skipped` (there was never a phone).
 */
export const MessageResendInput = MutationBase.extend({ id: IdSchema })
export const MessageResendOutput = MessageItemOutput

/**
 * Mark the caller's own `push` / `in_app` row read. Idempotent (a second call is a no-op). 400
 * `channel_not_markable` on `whatsapp` / `sms`; NOT_FOUND for a row that is not the caller's.
 */
export const MessageMarkReadInput = MutationBase.extend({ id: IdSchema })
export const MessageMarkReadOutput = MessageItemOutput

/**
 * On-demand send to one shop from a screen (docs/23 §8.8: D9, M9, O6). `variables` must cover every
 * variable the resolved template declares (400 `variables_missing` naming them); reserved ones are
 * filled by the service. `channel` omitted = WhatsApp if the shop opted in, else SMS; `channel:
 * 'whatsapp'` for a shop that never opted in is DOWNGRADED to SMS, never refused and never sent
 * (docs/17 A6). A shop with no phone is 409 `no_phone`. The row is `queued`; the worker sends it.
 */
export const MessageSendInput = MutationBase.extend({
  /** The message id. */
  id: IdSchema,
  retailerId: IdSchema,
  templateKey: TemplateKeySchema,
  refType: MessageRefTypeSchema,
  refId: IdSchema,
  channel: SendChannelSchema.optional(),
  locale: LocaleSchema.optional(),
  variables: TemplateVariablesSchema.default({}),
})
export type MessageSendIn = z.infer<typeof MessageSendInput>
export const MessageSendOutput = MessageItemOutput

// ---------------------------------------------------------------------------------------------------------------
// templates

/**
 * One approved wording per `(tenantId, key, channel, locale)`. `tenantId = null` is a platform default;
 * `isOverride = true` is this tenant's own row, which `templates.list` shows INSTEAD of the default for
 * the same key / channel / locale. `providerTemplateName` is the name Meta approved the WhatsApp
 * template under (null for SMS / push / in-app). `variables` is the contract of the body: every
 * `{{token}}` in it, reserved ones excluded.
 */
export const TemplateSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema.nullable(),
  key: z.string(),
  channel: NotificationChannelSchema,
  locale: LocaleSchema,
  providerTemplateName: z.string().nullable(),
  body: z.string(),
  variables: z.array(z.string()),
  active: z.boolean(),
  isOverride: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Template = z.infer<typeof TemplateSchema>

/** Platform defaults plus this tenant's overrides, an override hiding its default. Ordered `key, channel, locale`. */
export const TemplatesListInput = z.object({
  key: TemplateKeySchema.optional(),
  channel: NotificationChannelSchema.optional(),
  locale: LocaleSchema.optional(),
  activeOnly: QueryBoolSchema.default(true),
  ...CursorInput,
})
export type TemplatesListIn = z.infer<typeof TemplatesListInput>
export const TemplatesListOutput = z.object({
  items: z.array(TemplateSchema),
  nextCursor: z.string().nullable(),
})
export type TemplatesList = z.infer<typeof TemplatesListOutput>

/**
 * Create or replace THIS tenant's wording for `(key, channel, locale)`. The service always writes
 * `tenantId = ctx.tenantId` — a platform-default row is never addressable here (RLS `templates_write`
 * is the backstop) — and upserts on the natural key, so `id` is used only when the row is new
 * (`created: true`). Rules, all 400: every `{{token}}` in `body` must be in `variables`
 * (`unknown_variable`); `variables` may not name a reserved one (`reserved_variable`); a `whatsapp` /
 * `sms` body must contain `{{distributorName}}` (`distributor_name_missing`, the white label).
 * `active: false` retires the override, and the platform default shows again.
 */
export const TemplateUpsertInput = MutationBase.extend({
  id: IdSchema,
  key: TemplateKeySchema,
  channel: NotificationChannelSchema,
  /** English only is populated today; other locales are accepted as new rows (founder answer 2). */
  locale: LocaleSchema.default('en-IN'),
  providerTemplateName: z.string().trim().min(1).max(128).nullable().optional(),
  body: z.string().trim().min(1).max(1024),
  variables: z.array(TemplateVariableNameSchema).max(20).default([]),
  active: z.boolean().default(true),
})
export type TemplateUpsertIn = z.infer<typeof TemplateUpsertInput>
export const TemplateUpsertOutput = z.object({ item: TemplateSchema, created: z.boolean() })
export type TemplateUpsert = z.infer<typeof TemplateUpsertOutput>

// ---------------------------------------------------------------------------------------------------------------
// broadcasts

/**
 * The header of an owner / manager's ad-hoc send to a beat or a hand-picked list (a scheme
 * announcement, a holiday notice). The counts are message-status counts over its rows: `queuedCount`
 * + `sentCount` + `deliveredCount` + `failedCount` + `skippedCount` = `totalRecipients`, where
 * `deliveredCount` covers `delivered` AND `read` (the shop got it) and `skippedCount` is the remainder
 * — the shops with no phone, `totalRecipients − (queued + sent + delivered + failed)`, exactly the four
 * counters `broadcasts` stores and the worker refreshes as sends move, so `list` never re-aggregates.
 */
export const BroadcastSchema = z.object({
  id: IdSchema,
  channel: BroadcastChannelSchema,
  templateKey: z.string(),
  locale: LocaleSchema.nullable(),
  beatId: IdSchema.nullable(),
  beatName: z.string().nullable(),
  variables: z.record(z.string(), z.string()),
  totalRecipients: z.number().int().nonnegative(),
  queuedCount: z.number().int().nonnegative(),
  sentCount: z.number().int().nonnegative(),
  /** `delivered` or `read`. */
  deliveredCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  /** Derived: shops with nothing to send to. */
  skippedCount: z.number().int().nonnegative(),
  createdBy: IdSchema,
  createdByName: z.string(),
  createdAt: z.string(),
})
export type Broadcast = z.infer<typeof BroadcastSchema>

/** Every active shop on the beat, or exactly the shops named (≤ 500, docs/20 rule 3). One or the other, never both. */
export const BroadcastAudienceInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('beat'), beatId: IdSchema }),
  z.object({ kind: z.literal('retailers'), retailerIds: z.array(IdSchema).min(1).max(500) }),
])
export type BroadcastAudienceIn = z.infer<typeof BroadcastAudienceInput>

/**
 * Resolve the audience, then per shop resolve channel / locale / opt-in exactly as the outbox handlers
 * do (WhatsApp requested but not opted in → SMS; no phone → a `skipped` row) and queue one `messages`
 * row per shop (`refType = 'broadcast'`, `refId` = this id, idempotency key `<id>:<retailerId>`) plus
 * the header, in one transaction. A beat with no active shop is 400 `empty_audience`; an unknown
 * template key for the channel is 400 `template_not_found`; every declared variable must be in
 * `variables` (400 `variables_missing`). `idempotent()` replay returns the same header.
 */
export const BroadcastCreateInput = MutationBase.extend({
  /** The broadcast id. */
  id: IdSchema,
  channel: BroadcastChannelSchema,
  templateKey: TemplateKeySchema,
  /** Forces one locale for every recipient; omitted = each shop's own chain (founder answer 2). */
  locale: LocaleSchema.optional(),
  /** Broadcast-wide values for the template's variables (the scheme name, the date). */
  variables: TemplateVariablesSchema.default({}),
  audience: BroadcastAudienceInput,
})
export type BroadcastCreateIn = z.infer<typeof BroadcastCreateInput>

export const BroadcastSkippedRecipientSchema = z.object({
  retailerId: IdSchema,
  retailerName: z.string().nullable(),
  /** `no_phone`: nothing to send to; `inactive`: a named shop that is not active; `not_found`: a named id that is not this tenant's shop. */
  reason: z.enum(['no_phone', 'inactive', 'not_found']),
})
export type BroadcastSkippedRecipient = z.infer<typeof BroadcastSkippedRecipientSchema>

export const BroadcastCreateOutput = z.object({
  item: BroadcastSchema,
  skipped: z.array(BroadcastSkippedRecipientSchema),
})
export type BroadcastCreate = z.infer<typeof BroadcastCreateOutput>

export const BroadcastsListInput = z.object({
  beatId: IdSchema.optional(),
  channel: BroadcastChannelSchema.optional(),
  /** Created on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export type BroadcastsListIn = z.infer<typeof BroadcastsListInput>
export const BroadcastsListOutput = z.object({
  items: z.array(BroadcastSchema),
  nextCursor: z.string().nullable(),
})
export type BroadcastsList = z.infer<typeof BroadcastsListOutput>

/** One recipient's outcome, for "who did we miss". `error` is the provider's last error (back-office callers only reach here). */
export const BroadcastRecipientSchema = z.object({
  messageId: IdSchema,
  retailerId: IdSchema,
  retailerName: z.string().nullable(),
  channel: NotificationChannelSchema,
  status: MessageStatusSchema,
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  error: z.string().nullable(),
})
export type BroadcastRecipient = z.infer<typeof BroadcastRecipientSchema>

export const BroadcastGetInput = z.object({ id: IdSchema })
/** The header plus every recipient row (≤ 500, one query, ordered by shop name). */
export const BroadcastGetOutput = z.object({
  item: BroadcastSchema,
  recipients: z.array(BroadcastRecipientSchema),
})
export type BroadcastGet = z.infer<typeof BroadcastGetOutput>

// ---------------------------------------------------------------------------------------------------------------
// push tokens

/** The registration, never the token string itself back (nobody needs it after the PUT). */
export const PushTokenSchema = z.object({
  id: IdSchema,
  /** Always the caller: nobody registers a token for another user. */
  userId: IdSchema,
  deviceId: z.string(),
  platform: PushPlatformSchema,
  lastSeenAt: z.string(),
  createdAt: z.string(),
})
export type PushToken = z.infer<typeof PushTokenSchema>

/**
 * Upsert on `(tenantId, userId = actor, deviceId)`: a re-register from the same phone refreshes `token`
 * and `lastSeenAt` in place (`created: false`), never a second row. Per tenant membership, not per
 * device globally: a user in two distributorships registers once per tenant on the same phone.
 */
export const PushTokenRegisterInput = MutationBase.extend({
  id: IdSchema,
  deviceId: DeviceIdSchema,
  /** The Expo / FCM / APNs / web-push token, as the platform SDK gave it. */
  token: z.string().trim().min(1).max(512),
  platform: PushPlatformSchema,
})
export type PushTokenRegisterIn = z.infer<typeof PushTokenRegisterInput>
export const PushTokenRegisterOutput = z.object({ item: PushTokenSchema, created: z.boolean() })
export type PushTokenRegister = z.infer<typeof PushTokenRegisterOutput>

/** Delete the caller's own row (sign-out, uninstall). A token that is not the caller's is NOT_FOUND. */
export const PushTokenUnregisterInput = MutationBase.extend({ id: IdSchema })
export const PushTokenUnregisterOutput = z.object({ ok: z.literal(true) })

// ---------------------------------------------------------------------------------------------------------------
// inbound triage

/**
 * A text or photo a shop sent to the distributor's number ("bhai 2 case campa 1L kal", a "payment done"
 * screenshot). Captured raw for a human to act on; this module never turns it into an order (the AI
 * intake module does, always human-confirmed). `mediaUrl` is a short-lived signed read URL for
 * `mediaObjectKey`, built by the service; the wire never carries bytes.
 */
export const InboundMessageSchema = z.object({
  id: IdSchema,
  channel: NotificationChannelSchema,
  fromPhone: z.string(),
  /** Resolved from the tenant's own `retailers.phone`; null when the number is not a known shop. */
  retailerId: IdSchema.nullable(),
  retailerName: z.string().nullable(),
  body: z.string().nullable(),
  mediaObjectKey: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  receivedAt: z.string(),
  handled: z.boolean(),
})
export type InboundMessage = z.infer<typeof InboundMessageSchema>

/**
 * The support triage queue and the rep's "what did my shop text me" view: the handler scopes a
 * salesperson to the shops on its own beats (an unknown number is the desk's alone). Newest first.
 */
export const InboundListInput = z.object({
  retailerId: IdSchema.optional(),
  channel: NotificationChannelSchema.optional(),
  handled: QueryBoolSchema.optional(),
  /** Received on or after / on or before this IST calendar date. */
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  ...CursorInput,
})
export type InboundListIn = z.infer<typeof InboundListInput>

/** `unhandledCount` = open rows in the caller's scope, whatever the filters — the triage badge. */
export const InboundListOutput = z.object({
  items: z.array(InboundMessageSchema),
  nextCursor: z.string().nullable(),
  unhandledCount: z.number().int().nonnegative(),
})
export type InboundList = z.infer<typeof InboundListOutput>

/** Sets `handled = true` and nothing else: the raw text is never edited. Idempotent. */
export const InboundMarkHandledInput = MutationBase.extend({ id: IdSchema })
export const InboundMarkHandledOutput = z.object({ item: InboundMessageSchema })

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `notifications: notificationsContract` in contract.ts

export const notificationsContract = {
  messages: {
    list: oc
      .route({
        method: 'GET',
        path: '/notifications/messages',
        summary: 'Message log (staff) and inbox (a shop sees only messages to its own shop)',
      })
      .input(MessagesListInput)
      .output(MessagesListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/notifications/messages/{id}',
        summary:
          'One message with its variables and retry state (a push / WhatsApp tap lands here)',
      })
      .input(MessageGetInput)
      .output(MessageGetOutput),
    send: oc
      .route({
        method: 'POST',
        path: '/notifications/messages/send',
        summary: 'Send a bill, receipt or statement to one shop now (queued; the worker sends it)',
      })
      .input(MessageSendInput)
      .output(MessageSendOutput),
    resend: oc
      .route({
        method: 'POST',
        path: '/notifications/messages/{id}/resend',
        summary: 'Requeue a failed message (attempts are kept; a delivered one is never resent)',
      })
      .input(MessageResendInput)
      .output(MessageResendOutput),
    markRead: oc
      .route({
        method: 'POST',
        path: '/notifications/messages/{id}/read',
        summary: 'Mark my own push / in-app notice read (never a WhatsApp or SMS row)',
      })
      .input(MessageMarkReadInput)
      .output(MessageMarkReadOutput),
  },
  templates: {
    list: oc
      .route({
        method: 'GET',
        path: '/notifications/templates',
        summary:
          'Platform defaults plus this distributor’s overrides, per key, channel and language',
      })
      .input(TemplatesListInput)
      .output(TemplatesListOutput),
    upsert: oc
      .route({
        method: 'POST',
        path: '/notifications/templates',
        summary: 'Set this distributor’s own wording for a key, channel and language',
      })
      .input(TemplateUpsertInput)
      .output(TemplateUpsertOutput),
  },
  broadcasts: {
    create: oc
      .route({
        method: 'POST',
        path: '/notifications/broadcasts',
        summary: 'Send a template to every shop on a beat or a named list (queued per shop)',
      })
      .input(BroadcastCreateInput)
      .output(BroadcastCreateOutput),
    list: oc
      .route({
        method: 'GET',
        path: '/notifications/broadcasts',
        summary: 'Broadcast history with delivery counts',
      })
      .input(BroadcastsListInput)
      .output(BroadcastsListOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/notifications/broadcasts/{id}',
        summary: 'One broadcast with counts and every recipient’s outcome',
      })
      .input(BroadcastGetInput)
      .output(BroadcastGetOutput),
  },
  pushTokens: {
    register: oc
      .route({
        method: 'POST',
        path: '/notifications/push-tokens',
        summary: 'Register or refresh this device’s push token for the signed-in staff member',
      })
      .input(PushTokenRegisterInput)
      .output(PushTokenRegisterOutput),
    unregister: oc
      .route({
        method: 'POST',
        path: '/notifications/push-tokens/{id}/unregister',
        summary: 'Remove my own device’s push token (sign-out)',
      })
      .input(PushTokenUnregisterInput)
      .output(PushTokenUnregisterOutput),
  },
  inbound: {
    list: oc
      .route({
        method: 'GET',
        path: '/notifications/inbound',
        summary: 'Texts and photos shops sent us, for triage (a rep sees its own beats’ shops)',
      })
      .input(InboundListInput)
      .output(InboundListOutput),
    markHandled: oc
      .route({
        method: 'POST',
        path: '/notifications/inbound/{id}/handled',
        summary: 'Mark an inbound message handled (the text itself is never edited)',
      })
      .input(InboundMarkHandledInput)
      .output(InboundMarkHandledOutput),
  },
}
