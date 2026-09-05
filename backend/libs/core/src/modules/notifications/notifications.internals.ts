import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { MessageRefType, NotificationChannel } from '@dos/contracts'
import { RESERVED_TEMPLATE_VARIABLES } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  beatAssignments,
  messages,
  retailers,
  templates,
  tenants,
  tenantSettings,
  TENANT_SETTING_KEYS,
  type Db,
} from '@dos/db'
import { currentTenant } from '../../platform/index.js'
import { loadSettings } from '../tenancy/index.js'
import type { ContactPreferences } from '../retailers/index.js'

/**
 * The plain, transaction-scoped heart of notifications (docs/plans/notifications.md §4): the locale
 * chain, template resolution with its English fallback, `{{token}}` rendering, the one INSERT every
 * send goes through, and the per-shop channel decision (WhatsApp needs opt-in, SMS is the fallback,
 * an opted-out shop gets nothing). No Nest DI here — the API services and the worker's outbox
 * handlers and sweeps call the same functions (coordination §3.9).
 */

export type Locale = 'en-IN' | 'hi-IN' | 'mr-IN'
export const FALLBACK_LOCALE: Locale = 'en-IN'
const LOCALES: readonly Locale[] = ['en-IN', 'hi-IN', 'mr-IN']

/** Retry with backoff, then terminate (brief §4.5): 1 m, 5 m, 30 m, 2 h, 12 h. */
export const MAX_ATTEMPTS = 5
export const RETRY_BACKOFF_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
]
/** Milliseconds to wait after failed attempt number `attempt` (1-based). */
export function retryBackoffMs(attempt: number): number {
  const idx = Math.min(Math.max(attempt, 1), RETRY_BACKOFF_MS.length) - 1
  return RETRY_BACKOFF_MS[idx] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 60_000
}

/** Bounded work everywhere (docs/20 rule 3). */
export const MAX_BROADCAST_RECIPIENTS = 500
export const DISPATCH_BATCH = 200
/** A dues reminder goes to a shop at most once in this many days (coordination §7 q21). */
export const DUES_REMINDER_COOLDOWN_DAYS = 7

/** Message rows carry these keys in `payload` besides the template's own variables; a template may not declare them. */
export const PAYLOAD_KEYS = {
  senderName: 'senderName',
  body: 'body',
  providerTemplateName: 'providerTemplateName',
  variableNames: 'variableNames',
} as const
export const INTERNAL_VARIABLE_NAMES: readonly string[] = [
  ...RESERVED_TEMPLATE_VARIABLES,
  ...Object.values(PAYLOAD_KEYS),
]

export type MessageRow = typeof messages.$inferSelect
export type TemplateRow = typeof templates.$inferSelect

// ---------------------------------------------------------------------------------------------------------------
// locale

/** `mr` → `mr-IN`, `hi-IN` → `hi-IN`, `EN` → `en-IN`; anything else → null (fall through the chain). */
export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (v.length === 0) return null
  const lang = v.split(/[-_]/)[0] ?? ''
  const found = LOCALES.find((l) => l.split('-')[0] === lang)
  return found ?? null
}

/** The first usable value of the chain, else English (founder: English only for now). */
export function resolveLocale(...chain: (string | null | undefined)[]): Locale {
  for (const value of chain) {
    const locale = normalizeLocale(value)
    if (locale) return locale
  }
  return FALLBACK_LOCALE
}

/**
 * Who the message is from, in the shop's eyes (white label, docs/17 §D6): the distributor's display
 * name (legal name fallback), its UPI id for the pay link, and the tenant's default locale.
 */
export interface SenderIdentity {
  displayName: string
  upiVpa: string | null
  defaultLocale: Locale
}

export async function senderIdentity(tx: Db): Promise<SenderIdentity> {
  const { tenantId } = currentTenant()
  const [tenant] = await tx
    .select({ legalName: tenants.legalName })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  const settings = await loadSettings(tx, [
    TENANT_SETTING_KEYS.brandingDisplayName,
    TENANT_SETTING_KEYS.upiVpa,
    TENANT_SETTING_KEYS.notificationsDefaultLocale,
  ])
  const text = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
  return {
    displayName:
      text(settings.get(TENANT_SETTING_KEYS.brandingDisplayName)) ?? tenant?.legalName ?? '',
    upiVpa: text(settings.get(TENANT_SETTING_KEYS.upiVpa)),
    defaultLocale: resolveLocale(
      text(settings.get(TENANT_SETTING_KEYS.notificationsDefaultLocale)),
    ),
  }
}

/**
 * The tenant's own sender phone on the shared WhatsApp Business Account, when it has one (brief §8.1);
 * absent means the platform's number. Read cross-tenant by the dispatch sweep, hence `db`, not a
 * tenant transaction.
 */
export async function whatsappSenderIds(
  tx: Db,
  tenantIds: readonly string[],
): Promise<Map<string, string>> {
  if (tenantIds.length === 0) return new Map()
  const rows = await tx
    .select({ tenantId: tenantSettings.tenantId, value: tenantSettings.value })
    .from(tenantSettings)
    .where(
      and(
        inArray(tenantSettings.tenantId, [...tenantIds]),
        eq(tenantSettings.key, TENANT_SETTING_KEYS.whatsappPhoneNumberId),
      ),
    )
  const out = new Map<string, string>()
  for (const r of rows)
    if (typeof r.value === 'string' && r.value.length > 0) out.set(r.tenantId, r.value)
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// templates

const TOKEN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

/** Every `{{token}}` of a body, in order of first appearance, each once — the provider's positional order. */
export function templateTokens(body: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of body.matchAll(TOKEN)) {
    const name = m[1] ?? ''
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

export function renderTemplate(body: string, variables: Record<string, string>): string {
  return body.replace(TOKEN, (whole, name: string) => variables[name] ?? whole)
}

/** The declared variables the caller did not supply (reserved and internal names are the service's). */
export function missingVariables(
  template: Pick<TemplateRow, 'variables' | 'body'>,
  variables: Record<string, string>,
): string[] {
  const declared = new Set<string>([...template.variables, ...templateTokens(template.body)])
  return [...declared].filter(
    (name) => !INTERNAL_VARIABLE_NAMES.includes(name) && variables[name] === undefined,
  )
}

export interface ResolvedTemplate {
  template: TemplateRow
  /** The locale actually used: the wanted one, else English (a missing translation never blocks a bill). */
  locale: Locale
  fellBack: boolean
}

/**
 * This tenant's active override for `(key, channel, locale)`, else the platform default, else the same
 * pair for `en-IN`. One indexed query over at most four rows.
 */
export async function resolveTemplate(
  tx: Db,
  key: string,
  channel: NotificationChannel,
  locale: Locale,
): Promise<ResolvedTemplate | null> {
  const { tenantId } = currentTenant()
  const locales = locale === FALLBACK_LOCALE ? [locale] : [locale, FALLBACK_LOCALE]
  const rows = await tx
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.key, key),
        eq(templates.channel, channel),
        eq(templates.active, true),
        inArray(templates.locale, locales),
        or(eq(templates.tenantId, tenantId), isNull(templates.tenantId)),
      ),
    )
  const pick = (loc: Locale): TemplateRow | undefined =>
    rows.find((r) => r.locale === loc && r.tenantId === tenantId) ??
    rows.find((r) => r.locale === loc && r.tenantId === null)
  const wanted = pick(locale)
  if (wanted) return { template: wanted, locale, fellBack: false }
  const fallback = locale === FALLBACK_LOCALE ? undefined : pick(FALLBACK_LOCALE)
  if (fallback) return { template: fallback, locale: FALLBACK_LOCALE, fellBack: true }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// the one insert

export interface QueueMessageInput {
  id?: string | undefined
  channel: NotificationChannel
  templateKey: string | null
  to: string
  recipientUserId?: string | null | undefined
  recipientRetailerId?: string | null | undefined
  locale: Locale
  /** The template's variables plus the reserved and internal keys (`PAYLOAD_KEYS`). Immutable after insert. */
  payload: Record<string, unknown>
  refType: MessageRefType | null
  refId: string | null
  /** `<eventType>:<aggregateId>`, `<broadcastId>:<retailerId>`, or the caller's key (brief §4.18). */
  idempotencyKey: string
  scheduledAt?: Date | null | undefined
}

/**
 * Queue one row; a second call with the same key returns the first row untouched
 * (`UNIQUE(tenant_id, idempotency_key)` + `onConflictDoNothing`) — a relay replay never double-sends.
 */
export async function insertMessage(
  tx: Db,
  input: QueueMessageInput,
): Promise<{ row: MessageRow; created: boolean }> {
  const { tenantId } = currentTenant()
  const [inserted] = await tx
    .insert(messages)
    .values({
      id: input.id ?? uuidv7(),
      tenantId,
      channel: input.channel,
      templateKey: input.templateKey,
      to: input.to,
      recipientUserId: input.recipientUserId ?? null,
      recipientRetailerId: input.recipientRetailerId ?? null,
      locale: input.locale,
      payload: input.payload,
      status: 'queued',
      refType: input.refType,
      refId: input.refId,
      scheduledAt: input.scheduledAt ?? null,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: [messages.tenantId, messages.idempotencyKey] })
    .returning()
  if (inserted) return { row: inserted, created: true }
  const [existing] = await tx
    .select()
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.idempotencyKey, input.idempotencyKey)))
    .limit(1)
  if (!existing) throw new Error(`message ${input.idempotencyKey} vanished after insert`)
  return { row: existing, created: false }
}

// ---------------------------------------------------------------------------------------------------------------
// a message to a shop

export type ShopChannel = 'whatsapp' | 'sms' | 'in_app'

export interface ShopMessageRequest {
  /** The message id (client-generated on an on-demand send; minted here otherwise). */
  id?: string | undefined
  retailerId: string
  templateKey: string
  refType: MessageRefType
  refId: string
  /** Requested channel; omitted = WhatsApp if the shop opted in, else SMS. WhatsApp without opt-in is downgraded to SMS. */
  channel?: ShopChannel | undefined
  /** Forces a locale; omitted = the shop's `preferred_lang` → the tenant default → English. */
  locale?: Locale | undefined
  variables: Record<string, string>
  idempotencyKey: string
}

export type SkipReason =
  'not_found' | 'inactive' | 'opted_out' | 'no_phone' | 'template_not_found' | 'variables_missing'

export type ShopMessageOutcome =
  | { kind: 'queued'; row: MessageRow; created: boolean; fellBack: boolean }
  | { kind: 'skipped'; reason: SkipReason; missing?: string[] | undefined }

export interface ShopDestination {
  channel: ShopChannel
  to: string
  recipientUserId: string | null
}

/**
 * Where a shop's message goes (brief §4.2, §4.19): WhatsApp only with `whatsapp_optin_at`, else SMS to
 * the phone of record; `in_app` needs the shop's own login; a blocked link means opted out; no phone
 * means nothing to send to — reported, never silently absent.
 */
export function shopDestination(
  contact: ContactPreferences | null,
  requested: ShopChannel | undefined,
): { ok: true; destination: ShopDestination } | { ok: false; reason: SkipReason } {
  if (!contact) return { ok: false, reason: 'not_found' }
  if (contact.optedOut) return { ok: false, reason: 'opted_out' }
  if (!contact.active) return { ok: false, reason: 'inactive' }
  if (requested === 'in_app') {
    if (!contact.userId) return { ok: false, reason: 'no_phone' }
    return {
      ok: true,
      destination: { channel: 'in_app', to: contact.userId, recipientUserId: contact.userId },
    }
  }
  if (!contact.phone) return { ok: false, reason: 'no_phone' }
  const whatsapp = contact.whatsappOptinAt !== null && requested !== 'sms'
  return {
    ok: true,
    destination: {
      channel: whatsapp ? 'whatsapp' : 'sms',
      to: contact.phone,
      recipientUserId: contact.userId,
    },
  }
}

export interface ShopMessageDeps {
  contact: ContactPreferences | null
  sender: SenderIdentity
}

/**
 * Resolve destination, locale and template, render the body with the distributor's name in place,
 * and queue ONE row. Everything the shop will read is frozen in `payload` now (the row is immutable
 * after insert, migration 0025); the worker only sends it.
 */
export async function queueShopMessage(
  tx: Db,
  deps: ShopMessageDeps,
  req: ShopMessageRequest,
): Promise<ShopMessageOutcome> {
  const dest = shopDestination(deps.contact, req.channel)
  if (!dest.ok) return { kind: 'skipped', reason: dest.reason }
  const contact = deps.contact
  if (!contact) return { kind: 'skipped', reason: 'not_found' }
  const locale = req.locale ?? resolveLocale(contact.preferredLang, deps.sender.defaultLocale)
  const resolved = await resolveTemplate(tx, req.templateKey, dest.destination.channel, locale)
  if (!resolved) return { kind: 'skipped', reason: 'template_not_found' }
  const missing = missingVariables(resolved.template, req.variables)
  if (missing.length > 0) return { kind: 'skipped', reason: 'variables_missing', missing }
  const { row, created } = await insertMessage(tx, {
    id: req.id,
    channel: dest.destination.channel,
    templateKey: req.templateKey,
    to: dest.destination.to,
    recipientUserId: dest.destination.recipientUserId,
    recipientRetailerId: contact.retailerId,
    locale: resolved.locale,
    payload: buildPayload(resolved.template, req.variables, deps.sender),
    refType: req.refType,
    refId: req.refId,
    idempotencyKey: req.idempotencyKey,
  })
  return { kind: 'queued', row, created, fellBack: resolved.fellBack }
}

/** `{ ...variables, distributorName, senderName, body, providerTemplateName, variableNames }` (contract: MessageDetail.payload). */
export function buildPayload(
  template: Pick<TemplateRow, 'body' | 'providerTemplateName'>,
  variables: Record<string, string>,
  sender: SenderIdentity,
): Record<string, unknown> {
  const all: Record<string, string> = { ...variables, distributorName: sender.displayName }
  return {
    ...all,
    [PAYLOAD_KEYS.senderName]: sender.displayName,
    [PAYLOAD_KEYS.body]: renderTemplate(template.body, all),
    [PAYLOAD_KEYS.providerTemplateName]: template.providerTemplateName,
    [PAYLOAD_KEYS.variableNames]: templateTokens(template.body),
  }
}

/**
 * A staff notice (`push` / `in_app`) to one user — the approvals desk, a welcome, "needs approval".
 * `to` is the user id for in-app rows and the device token id for push; push fans out to every device
 * the user registered, one row each, so one device failing never hides the notice on another.
 */
export async function queueStaffNotice(
  tx: Db,
  deps: { sender: SenderIdentity },
  req: {
    userId: string
    channel: 'in_app' | 'push'
    to?: string | undefined
    templateKey: string
    refType: MessageRefType
    refId: string
    variables: Record<string, string>
    idempotencyKey: string
    locale?: Locale | undefined
    recipientRetailerId?: string | null | undefined
  },
): Promise<ShopMessageOutcome> {
  const locale = req.locale ?? deps.sender.defaultLocale
  const resolved = await resolveTemplate(tx, req.templateKey, req.channel, locale)
  if (!resolved) return { kind: 'skipped', reason: 'template_not_found' }
  const missing = missingVariables(resolved.template, req.variables)
  if (missing.length > 0) return { kind: 'skipped', reason: 'variables_missing', missing }
  const { row, created } = await insertMessage(tx, {
    channel: req.channel,
    templateKey: req.templateKey,
    to: req.to ?? req.userId,
    recipientUserId: req.userId,
    recipientRetailerId: req.recipientRetailerId ?? null,
    locale: resolved.locale,
    payload: buildPayload(resolved.template, req.variables, deps.sender),
    refType: req.refType,
    refId: req.refId,
    idempotencyKey: req.idempotencyKey,
  })
  return { kind: 'queued', row, created, fellBack: resolved.fellBack }
}

// ---------------------------------------------------------------------------------------------------------------
// small shared helpers

/** ₹ with two decimals from integer paise, for a message body ("₹1,234.50"). */
export function rupees(paise: number): string {
  const abs = Math.abs(paise)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${paise < 0 ? '-' : ''}₹${whole.toLocaleString('en-IN')}.${frac}`
}

/**
 * The `upi://pay` intent for a bill, from the distributor's own VPA and name — the shop taps it and
 * pays the distributor, never us. Empty when the tenant has configured no VPA.
 */
export function upiPayLink(i: {
  vpa: string | null
  payeeName: string
  amountPaise: number
  reference: string | null
}): string {
  if (!i.vpa || i.amountPaise <= 0) return ''
  const params = [
    `pa=${encodeURIComponent(i.vpa)}`,
    `pn=${encodeURIComponent(i.payeeName)}`,
    `am=${(i.amountPaise / 100).toFixed(2)}`,
    ...(i.reference ? [`tr=${encodeURIComponent(i.reference.replace(/\//g, '-'))}`] : []),
    'cu=INR',
  ]
  return `upi://pay?${params.join('&')}`
}

/** IST calendar-day window on a timestamp column (`from` / `to` are `YYYY-MM-DD`). */
export function dayWindow(
  column: SQL | { getSQL(): SQL },
  from: string | undefined,
  to: string | undefined,
): SQL[] {
  const out: SQL[] = []
  if (from) out.push(sql`${column} >= ${new Date(`${from}T00:00:00.000+05:30`)}`)
  if (to) out.push(sql`${column} <= ${new Date(`${to}T23:59:59.999+05:30`)}`)
  return out
}

/**
 * The shops on the salesperson's own beats today (its `beat_assignments`), as a subquery for an `IN`.
 * The handler rule the contract promises (`messages.list`, `inbound.list`): RLS lets staff read the
 * whole tenant log; the rep sees the shops it serves.
 */
export function repShopIds(actorId: string, today: string): SQL {
  return sql`(select r.id from ${retailers} r
    join ${beatAssignments} a on a.tenant_id = r.tenant_id and a.beat_id = r.beat_id and a.user_id = ${actorId}
    where r.tenant_id = (select current_setting('app.tenant_id', true))
      and a.valid_from <= ${today}
      and (a.valid_to is null or a.valid_to >= ${today}))`
}

/** The latest message of a template to a shop, for cooldowns (dues reminders). */
export async function latestMessageAt(
  tx: Db,
  retailerId: string,
  templateKey: string,
): Promise<Date | null> {
  const { tenantId } = currentTenant()
  const [row] = await tx
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.recipientRetailerId, retailerId),
        eq(messages.templateKey, templateKey),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}
