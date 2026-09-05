import type { PgBoss } from 'pg-boss'
import type { Db } from '@dos/db'
import { businessDate } from '@dos/domain'
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
 *   `reporting.rollup.finalize`  once daily at 00:20 IST: re-runs YESTERDAY (closing out a device that
 *                                synced after midnight) and recomputes every tenant's
 *                                `retailer_behaviour` over a 30-day window — the one heavy pass,
 *                                deliberately not run every quarter of an hour.
 *
 * The `report_*` CSV / JSON renderers are registered here too, on integrations' ONE `exports.render`
 * queue (coordination §3.5): the registry is per process, so the worker arms it exactly as each
 * service's `ReportingModule` does.
 */
export const REPORTING_ROLLUP_SCHEDULE = 'reporting.rollup.schedule'
export const REPORTING_ROLLUP_TENANT = 'reporting.rollup.tenant'
export const REPORTING_ROLLUP_FINALIZE = 'reporting.rollup.finalize'

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

/** 00:20 IST: yesterday's numbers once more, then every shop's habits. */
export async function finalizeRollups(db: Db, boss: PgBoss): Promise<void> {
  const today = businessDate().date
  const yesterday = new Date(Date.parse(`${today}T00:00:00.000+05:30`) - 86_400_000)
    .toISOString()
    .slice(0, 10)
  const count = await scheduleRollups(db, boss, yesterday)
  const tenants = await activeTenantIds(db, TENANTS_PER_TICK)
  let shops = 0
  for (const tenantId of tenants) shops += await rollupBehaviour(db, tenantId, today)
  logger.info({ tenants: count, shops }, 'reporting: nightly finalize done')
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

  await boss.createQueue(REPORTING_ROLLUP_FINALIZE)
  await boss.work(REPORTING_ROLLUP_FINALIZE, async () => {
    await finalizeRollups(db, boss)
  })
  // 18:50 UTC = 00:20 IST.
  await boss.schedule(REPORTING_ROLLUP_FINALIZE, '50 18 * * *')
}
