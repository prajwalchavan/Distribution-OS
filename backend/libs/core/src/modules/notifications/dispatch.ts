import { sql } from 'drizzle-orm'
import { withSystem, type Db } from '@dos/db'
import type { ProviderSendRequest, ProviderSet } from './adapters/index.js'
import {
  DISPATCH_BATCH,
  MAX_ATTEMPTS,
  PAYLOAD_KEYS,
  retryBackoffMs,
  whatsappSenderIds,
  type Locale,
  type MessageRow,
} from './notifications.internals.js'

/**
 * `notifications.dispatch` — the worker's minute sweep (brief §7, §4.5). Cross-tenant, so it runs as
 * `app_worker` through `withSystem`. Each batch is one transaction: the due rows are CLAIMED with
 * `FOR UPDATE SKIP LOCKED` (N worker replicas never send the same row twice), each is handed to its
 * channel's provider, and its outcome is written back before the batch commits:
 *
 *   sent      → `sent`, `sent_at`, the provider id and the cost
 *   failed    → `failed`, `attempts + 1`, `next_attempt_at = now + backoff(attempts)`; after the fifth
 *               failure (or a permanent provider refusal) `next_attempt_at` is null and the row is a
 *               DEAD LETTER: the sweep never picks a `failed` row at the cap again. A human
 *               `messages.resend` sets it back to `queued` for exactly one more try — `attempts` is
 *               kept, so a number that is simply wrong still terminates.
 *   in_app    → `delivered` at once: the row IS the delivery, the app reads it.
 *
 * Due = `status = 'queued'` (fresh, or requeued by a human), or `status = 'failed' AND attempts < 5`,
 * with `next_attempt_at` null or past — the `messages_dispatch_idx` partial index. Bounded: ≤ 200 rows
 * per tick in batches of 25, oldest due first, so one tenant's burst never starves another (docs/20).
 * The parent `broadcasts` counters are refreshed for every broadcast touched in the batch.
 */
export interface DispatchOptions {
  batchSize?: number | undefined
  maxRows?: number | undefined
  maxAttempts?: number | undefined
  now?: (() => Date) | undefined
  backoffMs?: ((attempt: number) => number) | undefined
}

export interface DispatchResult {
  claimed: number
  sent: number
  delivered: number
  failed: number
  deadLettered: number
}

const DEFAULT_BATCH = 25

export async function dispatchDueMessages(
  db: Db,
  providers: ProviderSet,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, sent: 0, delivered: 0, failed: 0, deadLettered: 0 }
  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH, DISPATCH_BATCH))
  const maxRows = options.maxRows ?? DISPATCH_BATCH
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
  const now = options.now ?? (() => new Date())
  const backoff = options.backoffMs ?? retryBackoffMs
  while (result.claimed < maxRows) {
    const limit = Math.min(batchSize, maxRows - result.claimed)
    const done = await withSystem(db, async (tx) => {
      const at = now()
      const claimed = (
        await tx.execute<ClaimedRowRaw>(sql`
          select id, tenant_id, channel, template_key, "to", recipient_user_id, recipient_retailer_id,
                 locale, payload, status, attempts, ref_type, ref_id
            from messages
           where (status = 'queued' or (status = 'failed' and attempts < ${maxAttempts}))
             and (next_attempt_at is null or next_attempt_at <= ${at})
           order by next_attempt_at asc nulls first, created_at asc, id asc
           limit ${limit}
           for update skip locked`)
      ).rows
      if (claimed.length === 0) return true
      const senders = await whatsappSenderIds(tx, [...new Set(claimed.map((r) => r.tenant_id))])
      const touchedBroadcasts = new Map<string, Set<string>>()
      for (const raw of claimed) {
        result.claimed += 1
        const row = fromRaw(raw)
        if (row.refType === 'broadcast' && row.refId) {
          const set = touchedBroadcasts.get(row.tenantId) ?? new Set<string>()
          set.add(row.refId)
          touchedBroadcasts.set(row.tenantId, set)
        }
        const outcome = await sendOne(row, providers, senders.get(row.tenantId) ?? null)
        const attempts = row.attempts + 1
        const stamp = now()
        if (outcome.kind === 'delivered') {
          await tx.execute(sql`
            update messages set status = 'delivered', attempts = ${attempts}, next_attempt_at = null,
                   error = null, cost_paise = 0, sent_at = coalesce(sent_at, ${stamp}),
                   delivered_at = ${stamp}, updated_at = ${stamp}
             where id = ${row.id}`)
          result.delivered += 1
        } else if (outcome.kind === 'sent') {
          await tx.execute(sql`
            update messages set status = 'sent', attempts = ${attempts}, next_attempt_at = null,
                   error = null, provider_message_id = ${outcome.providerMessageId},
                   cost_paise = ${outcome.costPaise}, sent_at = ${stamp}, updated_at = ${stamp}
             where id = ${row.id}`)
          result.sent += 1
        } else {
          const dead = !outcome.retryable || attempts >= maxAttempts
          const retryAt = dead ? null : new Date(stamp.getTime() + backoff(attempts))
          await tx.execute(sql`
            update messages set status = 'failed', attempts = ${attempts},
                   next_attempt_at = ${retryAt}, error = ${outcome.error.slice(0, 1000)},
                   cost_paise = coalesce(${outcome.costPaise ?? null}::int, cost_paise), updated_at = ${stamp}
             where id = ${row.id}`)
          if (dead) result.deadLettered += 1
          else result.failed += 1
        }
      }
      for (const [tenantId, ids] of touchedBroadcasts) {
        await refreshBroadcastCounters(tx, tenantId, [...ids])
      }
      return claimed.length < limit
    })
    if (done) break
  }
  return result
}

type ClaimedRowRaw = Record<string, unknown> & {
  id: string
  tenant_id: string
  channel: MessageRow['channel']
  template_key: string | null
  to: string
  recipient_user_id: string | null
  recipient_retailer_id: string | null
  locale: string
  payload: unknown
  status: MessageRow['status']
  attempts: number
  ref_type: string | null
  ref_id: string | null
}

interface ClaimedMessage {
  id: string
  tenantId: string
  channel: MessageRow['channel']
  templateKey: string | null
  to: string
  locale: Locale
  payload: Record<string, unknown>
  attempts: number
  refType: string | null
  refId: string | null
}

function fromRaw(raw: ClaimedRowRaw): ClaimedMessage {
  return {
    id: raw.id,
    tenantId: raw.tenant_id,
    channel: raw.channel,
    templateKey: raw.template_key,
    to: raw.to,
    locale: (raw.locale as Locale) || 'en-IN',
    payload:
      raw.payload !== null && typeof raw.payload === 'object'
        ? (raw.payload as Record<string, unknown>)
        : {},
    attempts: Number(raw.attempts),
    refType: raw.ref_type,
    refId: raw.ref_id,
  }
}

type SendOutcome =
  | { kind: 'delivered' }
  | { kind: 'sent'; providerMessageId: string; costPaise: number }
  | { kind: 'failed'; error: string; retryable: boolean; costPaise?: number | undefined }

/** One row to its provider. Never throws: a thrown adapter is a retryable failure. */
async function sendOne(
  row: ClaimedMessage,
  providers: ProviderSet,
  senderId: string | null,
): Promise<SendOutcome> {
  if (row.channel === 'in_app') return { kind: 'delivered' }
  if (row.channel === 'email') {
    return {
      kind: 'failed',
      error: 'email: no provider is configured for this channel',
      retryable: false,
    }
  }
  const provider = providers[row.channel]
  const request = providerRequest(row, senderId)
  try {
    const res = await provider.send(request)
    if (res.ok)
      return { kind: 'sent', providerMessageId: res.providerMessageId, costPaise: res.costPaise }
    return { kind: 'failed', error: res.error, retryable: res.retryable, costPaise: res.costPaise }
  } catch (error) {
    return {
      kind: 'failed',
      error: `${provider.name}: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    }
  }
}

/** The frozen payload → what the provider needs: the body, the approved template name, the positional values. */
export function providerRequest(row: ClaimedMessage, senderId: string | null): ProviderSendRequest {
  const payload = row.payload
  const body =
    typeof payload[PAYLOAD_KEYS.body] === 'string' ? (payload[PAYLOAD_KEYS.body] as string) : null
  const providerTemplateName =
    typeof payload[PAYLOAD_KEYS.providerTemplateName] === 'string'
      ? (payload[PAYLOAD_KEYS.providerTemplateName] as string)
      : null
  const names = Array.isArray(payload[PAYLOAD_KEYS.variableNames])
    ? (payload[PAYLOAD_KEYS.variableNames] as unknown[]).filter(
        (n): n is string => typeof n === 'string',
      )
    : []
  const parameters = names.map((name) => {
    const value = payload[name]
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return ''
  })
  return {
    messageId: row.id,
    tenantId: row.tenantId,
    channel: row.channel === 'whatsapp' || row.channel === 'sms' ? row.channel : 'push',
    to: row.to,
    locale: row.locale,
    body,
    providerTemplateName,
    parameters,
    senderId,
  }
}

/**
 * The four stored counters of a broadcast from its rows (`deliveredCount` = delivered or read); the
 * derived `skippedCount` is the remainder to `total_recipients` (contract). One grouped statement.
 */
export async function refreshBroadcastCounters(
  tx: Db,
  tenantId: string,
  broadcastIds: readonly string[],
): Promise<void> {
  if (broadcastIds.length === 0) return
  await tx.execute(sql`
    update broadcasts b
       set queued_count = c.queued, sent_count = c.sent, delivered_count = c.delivered,
           failed_count = c.failed, updated_at = now()
      from (
        select ref_id,
               count(*) filter (where status = 'queued')::int as queued,
               count(*) filter (where status = 'sent')::int as sent,
               count(*) filter (where status in ('delivered', 'read'))::int as delivered,
               count(*) filter (where status = 'failed')::int as failed
          from messages
         where tenant_id = ${tenantId} and ref_type = 'broadcast'
           and ref_id in (${sql.join(
             broadcastIds.map((id) => sql`${id}`),
             sql`, `,
           )})
         group by ref_id
      ) c
     where b.tenant_id = ${tenantId} and b.id = c.ref_id`)
}
