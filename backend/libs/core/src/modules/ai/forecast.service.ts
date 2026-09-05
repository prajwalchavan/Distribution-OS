import { createHash } from 'node:crypto'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, asc, desc, eq, lt, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ForecastListInput,
  ForecastListOutput,
  ForecastRunInput,
  ForecastRunOutput,
} from '@dos/contracts'
import { AI_DEFAULT_COVER_DAYS } from '@dos/contracts'
import { aiForecasts, locations, outboxEvents, withTenant, type Db } from '@dos/db'
import { businessDate } from '@dos/domain'
import { currentTenant, DB, idempotent, requireDb, requireRole } from '../../platform/index.js'
import {
  AI_EVENTS,
  AI_SETTING_KEYS,
  FORECAST_READERS,
  FORECAST_RUNNERS,
  numberSetting,
  readSettings,
} from './ai.internals.js'
import { toReorderSuggestion, variantLabels, type ForecastRow } from './ai.mappers.js'
import { aiConfig } from './config.js'
import { DEFAULT_HORIZON_DAYS, DEFAULT_LOOKBACK_DAYS, runForecastPass } from './forecast.js'

type RunIn = z.infer<typeof ForecastRunInput>
type RunOut = z.infer<typeof ForecastRunOutput>
type ListIn = z.infer<typeof ForecastListInput>
type ListOut = z.infer<typeof ForecastListOutput>

const defined = <T>(values: (T | undefined)[]): T[] => values.filter((v): v is T => v !== undefined)

/**
 * Reorder suggestions: queue a pass, read the answers.
 *
 * `run` DOES NO WORK ON THE REQUEST PATH (docs/20 rule 3). `ai_forecasts` is written by the `system`
 * role alone, so a request could not write one even if it wanted to: this emits an outbox row and the
 * worker's handler turns it into a pg-boss job. The answer is a RECEIPT, and `created: false` means
 * a pass for the same day, location and horizon was already queued — the day's key is deterministic,
 * so two buyers pressing the button do not start two reads of the same ninety days of history.
 *
 * Specs and a local demo run the pass INLINE (`aiConfig().inlineJobs`, true under `NODE_ENV=test`)
 * so a test can assert on the numbers without a worker; the escalation to `system` for the write is
 * `asSystem`, the same sanctioned pattern `modules/orders` uses.
 *
 * `list` is the buyer's working screen and carries NO MONEY of any kind, which is what lets the
 * godown read it (docs/22 §9). `belowCover` is measured against the `coverDays` the caller asks with,
 * not against a stored threshold, so two people can look at the same rows with different appetites.
 */
@Injectable()
export class ForecastService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  async run(input: RunIn): Promise<RunOut> {
    requireRole(FORECAST_RUNNERS)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const settings = await readSettings(tx, [
          AI_SETTING_KEYS.forecastLookbackDays,
          AI_SETTING_KEYS.forecastCoverDays,
        ])
        const asOfDate = input.asOfDate ?? businessDate().date
        const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS
        const locationId = input.locationId ?? null
        const lookbackDays =
          input.lookbackDays ??
          numberSetting(settings, AI_SETTING_KEYS.forecastLookbackDays, DEFAULT_LOOKBACK_DAYS)
        // One pass per (tenant, day, location, horizon), whoever asks and however often.
        const passKey = createHash('sha256')
          .update(`ai.forecast:${ctx.tenantId}:${asOfDate}:${locationId ?? 'all'}:${horizonDays}`)
          .digest('hex')
          .slice(0, 32)
        const payload = { asOfDate, locationId, horizonDays, lookbackDays, passKey }

        const [existing] = await tx
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.tenantId, ctx.tenantId),
              eq(outboxEvents.eventType, AI_EVENTS.forecastRequested),
              sql`${outboxEvents.payload}->>'passKey' = ${passKey}`,
            ),
          )
          .limit(1)
        if (existing)
          return {
            item: receipt(existing.id, 'queued', payload),
            created: false,
          }

        const [row] = await tx
          .insert(outboxEvents)
          .values({
            id: input.id,
            tenantId: ctx.tenantId,
            aggregateType: 'ai_forecast',
            aggregateId: passKey,
            eventType: AI_EVENTS.forecastRequested,
            payload,
          })
          .onConflictDoNothing()
          .returning({ id: outboxEvents.id })

        if (aiConfig().inlineJobs) {
          await runForecastPass(tx, { asOfDate, locationId, horizonDays, lookbackDays })
          return { item: receipt(row?.id ?? input.id, 'ready', payload), created: true }
        }
        return { item: receipt(row?.id ?? null, 'queued', payload), created: row !== undefined }
      }),
    )
  }

  async list(input: ListIn): Promise<ListOut> {
    requireRole(FORECAST_READERS)
    const db = requireDb(this.db)
    return withTenant(db, currentTenant(), async (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(aiForecasts.horizonDays, input.horizonDays),
        input.locationId ? eq(aiForecasts.locationId, input.locationId) : undefined,
        input.variantId ? eq(aiForecasts.variantId, input.variantId) : undefined,
        input.belowCover === true
          ? sql`(${aiForecasts.daysCover} is not null and ${aiForecasts.daysCover} < ${input.coverDays})`
          : undefined,
        input.belowCover === false
          ? sql`(${aiForecasts.daysCover} is null or ${aiForecasts.daysCover} >= ${input.coverDays})`
          : undefined,
        input.q ? variantSearch(input.q) : undefined,
        input.cursor ? lt(aiForecasts.id, input.cursor) : undefined,
      ]
      const rows: ForecastRow[] = await tx
        .select()
        .from(aiForecasts)
        .where(and(...defined(filters)))
        .orderBy(desc(aiForecasts.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const [variants, locationNames, [newest]] = await Promise.all([
        variantLabels(
          tx,
          page.map((row) => row.variantId),
        ),
        this.locationNames(tx),
        tx
          .select({ computedAt: aiForecasts.computedAt })
          .from(aiForecasts)
          .orderBy(desc(aiForecasts.computedAt))
          .limit(1),
      ])
      const last = page[page.length - 1]
      return {
        items: page.map((row) =>
          toReorderSuggestion(row, {
            variants,
            locationNames,
            coverDays: input.coverDays || AI_DEFAULT_COVER_DAYS,
          }),
        ),
        lastComputedAt: newest?.computedAt.toISOString() ?? null,
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  private async locationNames(tx: Db): Promise<Map<string, string>> {
    const rows = await tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .orderBy(asc(locations.id))
      .limit(500)
    return new Map(rows.map((row) => [row.id, row.name]))
  }
}

/** Name or brand of the variant, matched the way the catalog screen searches. */
function variantSearch(q: string): SQL {
  const like = `%${q.toLowerCase()}%`
  return sql`exists (
    select 1 from product_variants v
    join products p on p.id = v.product_id
    left join brands b on b.id = p.brand_id
    where v.id = ${aiForecasts.variantId}
      and (lower(v.name) like ${like} or lower(p.name) like ${like} or lower(coalesce(b.name, '')) like ${like})
  )`
}

function receipt(
  jobId: string | null,
  status: 'queued' | 'ready',
  payload: { asOfDate: string; locationId: string | null; horizonDays: number },
) {
  return {
    jobId,
    status,
    asOfDate: payload.asOfDate,
    locationId: payload.locationId,
    horizonDays: payload.horizonDays,
    queuedAt: new Date().toISOString(),
    confidenceBps: null,
    needsHumanConfirmation: true as const,
  }
}
