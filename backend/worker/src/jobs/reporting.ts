import type { PgBoss } from 'pg-boss'
import type { Db } from '@dos/db'
import { businessDate } from '@dos/domain'
import { ageingNeedsRebuild, rebuildTenantAgeing } from '@dos/core/receivables'
import {
  activeTenantIds,
  registerReportRenderers,
  rollupBehaviour,
  rollupTenantDay,
} from '@dos/core/reporting'
import { logger } from '../logger.js'

/**
 * The reporting rollup on pg-boss (docs/plans/reporting.md §7). Everything the owner's graphs and the
 * dashboards read is a row these jobs wrote — a phone never scans a ledger (docs/20 rule 9).
 *
 *   `reporting.rollup.schedule`  every 15 minutes: lists the ACTIVE tenants and fans out one job per
 *                                tenant. Per-tenant fairness (docs/20 rule 5): one distributor's big
 *                                order book never delays another's dashboard. `singletonKey` is
 *                                `reporting-rollup:<tenantId>:<day>`, so an overlapping tick is never
 *                                doubled up.
 *   `reporting.rollup.tenant`    on demand, bounded concurrency: recomputes that tenant's
 *                                `daily_tenant_stats`, `daily_rep_stats`, `daily_retailer_stats`,
 *                                `daily_owner_stats` and the single `owner_summary` row for the day —
 *                                idempotent by upsert, so a retry reproduces the numbers and never
 *                                doubles one.
 *   `reporting.rollup.finalize`  once daily at 00:20 IST: first queues one `receivables.ageing.rebuild`
 *                                per active tenant, then re-runs YESTERDAY (closing out a device that
 *                                synced after midnight) and recomputes every tenant's
 *                                `retailer_behaviour` over a 30-day window — the one heavy pass,
 *                                deliberately not run every quarter of an hour.
 *
 * THE NIGHTLY AGEING (DOS-117, docs/plans/receivables.md §7). A posting ages only the one shop it
 * touches, on the day it happens, so without these a quiet shop's overdue and buckets freeze on its last
 * posting — and the owner's tiles and the 09:00 dues reminder with them.
 *
 *   `receivables.ageing.rebuild` one tenant: re-dates every shop's dues row to the business date at RUN
 *                                time and writes that day's `ageing_snapshots` (one short transaction per
 *                                page of shops, as the tenant's system actor), then sends the tenant's
 *                                `reporting.rollup.tenant` for today, so `owner_summary` and today's
 *                                `daily_tenant_stats` are recomputed from the re-dated rows. `stately`
 *                                and keyed `receivables-ageing:<tenantId>:<day>`, so a retried finalize
 *                                or N workers never queue one tenant-day twice; a 3 600 s expiry, because
 *                                a job re-fetched at the 900 s default while its first run is still
 *                                paging would double a large tenant's pass.
 *   `receivables.ageing.catchup` sent once on every worker start, because pg-boss never backfills a
 *                                missed 00:20 slot: queues a rebuild only for a tenant with a dues row
 *                                dated before today, or dues rows and no snapshot for today. `stately`
 *                                with no key, so however many workers start, one catch-up waits.
 *
 * The `report_*` CSV / JSON renderers are registered here too, on integrations' ONE `exports.render`
 * queue (coordination §3.5): the registry is per process, so the worker arms it exactly as each
 * service's `ReportingModule` does.
 */
export const REPORTING_ROLLUP_SCHEDULE = 'reporting.rollup.schedule'
export const REPORTING_ROLLUP_TENANT = 'reporting.rollup.tenant'
export const REPORTING_ROLLUP_FINALIZE = 'reporting.rollup.finalize'
export const RECEIVABLES_AGEING_REBUILD = 'receivables.ageing.rebuild'
export const RECEIVABLES_AGEING_CATCHUP = 'receivables.ageing.catchup'

/** Tenants rolled up per tick; a bound, not a target (docs/20 rule 3). */
const TENANTS_PER_TICK = 2_000

interface TenantRollupJob {
  tenantId: string
  day: string
}

function parseJob(value: unknown): TenantRollupJob | null {
  const p = value as Partial<TenantRollupJob> | null
  if (!p || typeof p !== 'object') return null
  if (typeof p.tenantId !== 'string') return null
  return { tenantId: p.tenantId, day: typeof p.day === 'string' ? p.day : businessDate().date }
}

/** Fan out one rollup job per active tenant for a business date. */
export async function scheduleRollups(db: Db, boss: PgBoss, day: string): Promise<number> {
  const tenants = await activeTenantIds(db, TENANTS_PER_TICK)
  for (const tenantId of tenants) {
    await boss.send(
      REPORTING_ROLLUP_TENANT,
      { tenantId, day },
      { singletonKey: `reporting-rollup:${tenantId}:${day}` },
    )
  }
  return tenants.length
}

/**
 * Fan out one ageing rebuild per active tenant for a business date. `onlyStale` (the start-up catch-up)
 * skips a tenant already re-dated for that day; a probe that fails queues the tenant anyway, because the
 * rebuild is idempotent.
 */
export async function scheduleAgeingRebuilds(
  db: Db,
  boss: PgBoss,
  day: string,
  options: { onlyStale: boolean },
): Promise<{ tenants: number; queued: number }> {
  const tenants = await activeTenantIds(db, TENANTS_PER_TICK)
  let queued = 0
  for (const tenantId of tenants) {
    if (options.onlyStale) {
      let stale = true
      try {
        stale = await ageingNeedsRebuild(db, tenantId, day)
      } catch (err) {
        logger.warn({ err, tenantId }, 'receivables: ageing probe failed, rebuilding anyway')
      }
      if (!stale) continue
    }
    await boss.send(
      RECEIVABLES_AGEING_REBUILD,
      { tenantId, day },
      { singletonKey: `receivables-ageing:${tenantId}:${day}` },
    )
    queued += 1
  }
  return { tenants: tenants.length, queued }
}

/**
 * One tenant's ageing rebuild. It ages to the business date at RUN time, never to the day in the job's
 * payload (that feeds only the key and the log), so a late or retried job cannot re-date rows backwards.
 * The tenant's rollup for today is sent only after every page has committed. Errors propagate, so pg-boss
 * retries this tenant alone.
 */
export async function runTenantAgeingJob(db: Db, boss: PgBoss, tenantId: string): Promise<void> {
  const today = businessDate().date
  const result = await rebuildTenantAgeing(db, tenantId, today)
  await boss.send(
    REPORTING_ROLLUP_TENANT,
    { tenantId, day: today },
    { singletonKey: `reporting-rollup:${tenantId}:${today}` },
  )
  logger.info({ tenantId, ...result }, 'receivables: ageing rebuilt')
}

/** 00:20 IST: every tenant's ageing queued, yesterday's numbers once more, then every shop's habits. */
export async function finalizeRollups(db: Db, boss: PgBoss): Promise<void> {
  const today = businessDate().date
  const yesterday = new Date(Date.parse(`${today}T00:00:00.000+05:30`) - 86_400_000)
    .toISOString()
    .slice(0, 10)
  // Yesterday's rollup keeps its stored closing dues, so it does not wait for today's ageing; each
  // rebuild sends its own tenant's rollup for today once the re-dated rows are committed.
  const ageing = await scheduleAgeingRebuilds(db, boss, today, { onlyStale: false })
  const count = await scheduleRollups(db, boss, yesterday)
  const tenants = await activeTenantIds(db, TENANTS_PER_TICK)
  let shops = 0
  for (const tenantId of tenants) shops += await rollupBehaviour(db, tenantId, today)
  logger.info(
    { tenants: count, shops, ageingQueued: ageing.queued },
    'reporting: nightly finalize done',
  )
}

export async function registerReportingJobs(boss: PgBoss, db: Db): Promise<void> {
  registerReportRenderers()

  await boss.createQueue(REPORTING_ROLLUP_TENANT)
  await boss.work(REPORTING_ROLLUP_TENANT, { batchSize: 1 }, async ([job]) => {
    const parsed = parseJob(job?.data)
    if (!parsed) return
    const result = await rollupTenantDay(db, parsed.tenantId, parsed.day)
    logger.debug({ ...result }, 'reporting: tenant rollup')
  })

  await boss.createQueue(REPORTING_ROLLUP_SCHEDULE)
  await boss.work(REPORTING_ROLLUP_SCHEDULE, async () => {
    const count = await scheduleRollups(db, boss, businessDate().date)
    if (count > 0) logger.debug({ tenants: count }, 'reporting: rollups scheduled')
  })
  await boss.schedule(REPORTING_ROLLUP_SCHEDULE, '*/15 * * * *')

  await boss.createQueue(RECEIVABLES_AGEING_REBUILD, {
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 300,
    retryBackoff: true,
    expireInSeconds: 3600,
  })
  await boss.work(RECEIVABLES_AGEING_REBUILD, { batchSize: 1 }, async ([job]) => {
    const data = job?.data as { tenantId?: unknown } | null | undefined
    if (!data || typeof data.tenantId !== 'string') return
    await runTenantAgeingJob(db, boss, data.tenantId)
  })

  await boss.createQueue(RECEIVABLES_AGEING_CATCHUP, {
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
  })
  await boss.work(RECEIVABLES_AGEING_CATCHUP, async () => {
    const result = await scheduleAgeingRebuilds(db, boss, businessDate().date, { onlyStale: true })
    logger.info(result, 'receivables: ageing catch-up')
  })

  await boss.createQueue(REPORTING_ROLLUP_FINALIZE)
  await boss.work(REPORTING_ROLLUP_FINALIZE, async () => {
    await finalizeRollups(db, boss)
  })
  // 18:50 UTC = 00:20 IST.
  await boss.schedule(REPORTING_ROLLUP_FINALIZE, '50 18 * * *')

  // pg-boss never backfills a missed 00:20 slot: every start probes for tenants still dated before today.
  await boss.send(RECEIVABLES_AGEING_CATCHUP, { reason: 'startup' })
}
