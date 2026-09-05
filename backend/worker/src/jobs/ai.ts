import type { PgBoss } from 'pg-boss'
import { sql } from 'drizzle-orm'
import { withSystem, type Db } from '@dos/db'
import { AI_EVENTS, aiConfig, parseInboundMessage, runForecastPass } from '@dos/core/ai'
import { logger } from '../logger.js'
import { registerOutboxHandler } from './outbox-relay.js'

/**
 * The `ai` module's background half (founder decision 2026-09-05, docs/22 §8).
 *
 *   `ai.forecast.run`      the demand pass. Ninety days of stock ledger per distributor is not
 *                          request-path work (docs/20 rule 3), and `ai_forecasts` is written by the
 *                          `system` role alone, so a request could not write one even if it tried:
 *                          `ai.forecast.run` emits an `AiForecastRequested` outbox row, the relay
 *                          hands it here, and this queue computes and upserts the rows. A DAILY
 *                          schedule does the same for every tenant at 03:40 IST, so a buyer opening
 *                          the screen in the morning finds numbers computed overnight rather than an
 *                          empty list and a button.
 *
 *   `InboundMessageReceived`  a shop's WhatsApp text becomes a DRAFT ORDER. The message row and this
 *                          event are written by the WhatsApp webhook (docs/plans/notifications.md
 *                          §"WhatsApp status webhook"), which is not built yet — so nothing emits
 *                          this today and the handler simply waits, which is exactly what the relay
 *                          does with an event type nobody produces. The moment the webhook lands,
 *                          shops' texts start appearing in the rep's and the manager's queue with no
 *                          further change here.
 *
 * Every handler is IDEMPOTENT because the relay is at-least-once: the forecast pass upserts on its
 * unique key, and `parseInboundMessage` answers the existing draft when one already exists for the
 * message (and the partial unique index refuses a second even if two workers race).
 *
 * Both run under `withSystem` — role `app_worker`, BYPASSRLS, `actor_role = system` — because there
 * is no human behind either: a relayed message has no session, and a nightly pass has no caller.
 */
export const AI_FORECAST_QUEUE = 'ai.forecast.run'
export const AI_FORECAST_SWEEP = 'ai.forecast.sweep'

/** Tenants one nightly sweep covers. A bound, not a target (docs/20 rules 3 and 5). */
const MAX_TENANTS_PER_SWEEP = 500

export interface ForecastJobData {
  tenantId: string
  asOfDate?: string
  locationId?: string | null
  horizonDays?: number
  lookbackDays?: number
}

/** One pass for one distributor, in its own transaction so a slow tenant never blocks the next. */
export async function runForecastJob(db: Db, data: ForecastJobData): Promise<number> {
  return withSystem(db, async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${data.tenantId}, true)`)
    const result = await runForecastPass(tx, {
      ...(data.asOfDate === undefined ? {} : { asOfDate: data.asOfDate }),
      locationId: data.locationId ?? null,
      ...(data.horizonDays === undefined ? {} : { horizonDays: data.horizonDays }),
      ...(data.lookbackDays === undefined ? {} : { lookbackDays: data.lookbackDays }),
    })
    return result.written
  })
}

/** Every active distributor, every configured horizon. Fair by construction: one job per tenant. */
export async function sweepForecasts(db: Db, boss: PgBoss): Promise<number> {
  const config = aiConfig()
  const tenants = await withSystem(db, async (tx) => {
    const result = await tx.execute(sql`
      select id from tenants where status = 'active' order by id asc limit ${MAX_TENANTS_PER_SWEEP}
    `)
    return result.rows.map((row) => String((row as { id: string }).id))
  })
  let queued = 0
  for (const tenantId of tenants)
    for (const horizonDays of config.horizons) {
      await boss.send(AI_FORECAST_QUEUE, {
        tenantId,
        horizonDays,
        lookbackDays: config.lookbackDays,
      } satisfies ForecastJobData)
      queued += 1
    }
  return queued
}

export async function registerAiJobs(boss: PgBoss, db: Db): Promise<void> {
  // A human pressed "refresh suggestions": the request wrote the outbox row, the pass happens here.
  registerOutboxHandler(AI_EVENTS.forecastRequested, async (event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>
    await boss.send(AI_FORECAST_QUEUE, {
      tenantId: event.tenantId,
      ...(typeof payload.asOfDate === 'string' ? { asOfDate: payload.asOfDate } : {}),
      locationId: typeof payload.locationId === 'string' ? payload.locationId : null,
      ...(typeof payload.horizonDays === 'number' ? { horizonDays: payload.horizonDays } : {}),
      ...(typeof payload.lookbackDays === 'number' ? { lookbackDays: payload.lookbackDays } : {}),
    } satisfies ForecastJobData)
  })

  // A shop texted an order. The draft lands in the rep's and the manager's queue; a human confirms it.
  registerOutboxHandler(AI_EVENTS.inboundText, async (event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>
    const fromPayload = typeof payload.messageId === 'string' ? payload.messageId : ''
    const messageId = event.aggregateId.length > 0 ? event.aggregateId : fromPayload
    if (!messageId) return
    const result = await withSystem(db, async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${event.tenantId}, true)`)
      return parseInboundMessage(tx, messageId)
    })
    if (result?.created)
      logger.debug(
        { draftId: result.draftId, lines: result.lineCount, status: result.status },
        'ai: inbound message read into a draft order',
      )
  })

  await boss.createQueue(AI_FORECAST_QUEUE)
  await boss.work(AI_FORECAST_QUEUE, async ([job]) => {
    const data = job?.data as ForecastJobData | undefined
    if (!data?.tenantId) return
    const written = await runForecastJob(db, data)
    if (written > 0) logger.debug({ tenantId: data.tenantId, written }, 'ai: forecast rows written')
  })

  await boss.createQueue(AI_FORECAST_SWEEP)
  await boss.work(AI_FORECAST_SWEEP, async () => {
    const queued = await sweepForecasts(db, boss)
    if (queued > 0) logger.debug({ queued }, 'ai: nightly forecast passes queued')
  })
  // 22:10 UTC = 03:40 IST: after the day's ledger has settled, before the desk opens.
  await boss.schedule(AI_FORECAST_SWEEP, '10 22 * * *')
}
