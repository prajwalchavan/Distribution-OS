import { sql } from 'drizzle-orm'
import { withSystem, type Db } from '@dos/db'
import { logger } from '../logger.js'

export const OUTBOX_RELAY = 'outbox-relay'

/**
 * The transactional-outbox relay (coordination §3.6). Modules register a handler per event type;
 * every tick the relay CLAIMS a batch of unpublished rows with `FOR UPDATE SKIP LOCKED` (so N worker
 * replicas never dispatch the same row twice), runs every handler registered for the row's event
 * type, and stamps `published_at` only when ALL of them resolved. A throwing handler leaves the row
 * unpublished: `attempts` goes up, `next_attempt_at` holds it back with exponential backoff, and after
 * `maxAttempts` the row is parked with `dead_lettered_at` (still unpublished, never retried, visible to
 * an operator who can clear the stamp and `attempts` to replay). One `published_at` means "every
 * handler that exists today saw it" — there is no per-consumer flag and none is being added.
 *
 * Consequences every handler must live with:
 *  - at-least-once: a handler that succeeded next to one that failed runs again on the retry, so
 *    every handler is idempotent (a pg-boss `singletonKey`, an upsert, a status check);
 *  - rows whose event type has NO registered handler are not claimed at all: they wait, unpublished,
 *    until a module registers one (the retention sweep only deletes PUBLISHED rows), so a print
 *    request or a notification is never silently lost;
 *  - handlers run inside the claiming transaction and should be quick (enqueue a job, write a row),
 *    never a network round trip that can take a minute.
 */

export interface OutboxEvent {
  id: string
  tenantId: string
  aggregateType: string
  aggregateId: string
  eventType: string
  payload: unknown
  /** Attempts BEFORE this one (0 on the first delivery). */
  attempts: number
}

export type OutboxHandler = (e: OutboxEvent) => Promise<void>

const handlers = new Map<string, OutboxHandler[]>()

export function registerOutboxHandler(eventType: string, handler: OutboxHandler): void {
  const list = handlers.get(eventType) ?? []
  list.push(handler)
  handlers.set(eventType, list)
}

/** Event types with at least one handler — the only rows the relay claims. */
export function registeredEventTypes(): string[] {
  return [...handlers.keys()].sort()
}

/** For specs: forget every handler. */
export function clearOutboxHandlers(): void {
  handlers.clear()
}

export interface RelayOptions {
  /** Rows claimed per batch. */
  batchSize?: number
  /** Batches per tick, so a backlog drains within a few ticks without one tick running for an hour. */
  maxBatches?: number
  /** Attempts before a row is parked. */
  maxAttempts?: number
  /** Injectable clock for specs. */
  now?: () => Date
  /** Milliseconds to wait before attempt `attempt` (1-based) runs again. */
  backoffMs?: (attempt: number) => number
}

export interface RelayResult {
  claimed: number
  published: number
  failed: number
  deadLettered: number
}

const DEFAULT_BATCH = 100
const DEFAULT_MAX_BATCHES = 10
/** ~30 s, 1 m, 2 m, 4 m, 8 m, 16 m, 32 m, 1 h: about two hours of patience before the dead letter. */
export const DEFAULT_MAX_ATTEMPTS = 8
export const defaultBackoffMs = (attempt: number): number =>
  Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1))

function maxAttemptsFromEnv(): number {
  const n = Number(process.env.OUTBOX_MAX_ATTEMPTS)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_ATTEMPTS
}

type ClaimedRow = Record<string, unknown> & {
  id: string
  tenant_id: string
  aggregate_type: string
  aggregate_id: string
  event_type: string
  payload: unknown
  attempts: number
}

/**
 * One tick. Cross-tenant, so it runs as `app_worker` (BYPASSRLS) through `withSystem`; each batch is
 * its own transaction and the rows stay locked while their handlers run.
 */
export async function relayOutbox(db: Db, opts: RelayOptions = {}): Promise<RelayResult> {
  const result: RelayResult = { claimed: 0, published: 0, failed: 0, deadLettered: 0 }
  const types = registeredEventTypes()
  if (types.length === 0) {
    const pending = await withSystem(db, async (tx) =>
      Number(
        (
          (
            await tx.execute(
              sql`select count(*)::int as n from outbox_events where published_at is null and dead_lettered_at is null`,
            )
          ).rows[0] as { n: number }
        ).n,
      ),
    )
    if (pending > 0)
      logger.info({ count: pending }, 'outbox events pending (no handlers registered)')
    return result
  }
  const batchSize = opts.batchSize ?? DEFAULT_BATCH
  const maxBatches = opts.maxBatches ?? DEFAULT_MAX_BATCHES
  const maxAttempts = opts.maxAttempts ?? maxAttemptsFromEnv()
  const now = opts.now ?? (() => new Date())
  const backoff = opts.backoffMs ?? defaultBackoffMs
  for (let batch = 0; batch < maxBatches; batch++) {
    const done = await withSystem(db, async (tx) => {
      const at = now()
      const claimed = (
        await tx.execute<ClaimedRow>(sql`
          select id, tenant_id, aggregate_type, aggregate_id, event_type, payload, attempts
            from outbox_events
           where published_at is null
             and dead_lettered_at is null
             and (next_attempt_at is null or next_attempt_at <= ${at})
             and event_type in (${sql.join(
               types.map((t) => sql`${t}`),
               sql`, `,
             )})
           order by created_at, id
           limit ${batchSize}
           for update skip locked`)
      ).rows
      for (const row of claimed) {
        result.claimed += 1
        const event: OutboxEvent = {
          id: row.id,
          tenantId: row.tenant_id,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          eventType: row.event_type,
          payload: row.payload,
          attempts: Number(row.attempts),
        }
        try {
          for (const handler of handlers.get(row.event_type) ?? []) await handler(event)
          await tx.execute(
            sql`update outbox_events set published_at = ${now()}, last_error = null, updated_at = ${now()} where id = ${row.id}`,
          )
          result.published += 1
        } catch (error) {
          const attempts = event.attempts + 1
          const message = String(error instanceof Error ? error.message : error).slice(0, 2000)
          if (attempts >= maxAttempts) {
            await tx.execute(
              sql`update outbox_events set attempts = ${attempts}, last_error = ${message}, dead_lettered_at = ${now()}, next_attempt_at = null, updated_at = ${now()} where id = ${row.id}`,
            )
            result.deadLettered += 1
            logger.error(
              { id: row.id, eventType: row.event_type, attempts, err: error },
              'outbox event dead-lettered',
            )
          } else {
            const retryAt = new Date(now().getTime() + backoff(attempts))
            await tx.execute(
              sql`update outbox_events set attempts = ${attempts}, last_error = ${message}, next_attempt_at = ${retryAt}, updated_at = ${now()} where id = ${row.id}`,
            )
            result.failed += 1
            logger.warn(
              { id: row.id, eventType: row.event_type, attempts, retryAt, err: error },
              'outbox handler failed; will retry',
            )
          }
        }
      }
      return claimed.length < batchSize
    })
    if (done) break
  }
  if (result.claimed > 0) logger.info(result, 'outbox relayed')
  return result
}
