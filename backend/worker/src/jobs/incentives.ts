import type { PgBoss } from 'pg-boss'
import type { Db } from '@dos/db'
import {
  INCENTIVE_EVENTS,
  parseRecomputePayload,
  recomputeAchievement,
  sweepAchievements,
} from '@dos/core/incentives'
import { logger } from '../logger.js'
import { registerOutboxHandler } from './outbox-relay.js'

/**
 * The incentives achievement cache on pg-boss (docs/plans/incentives.md §7).
 *
 * `achievements` is a WORKER-ONLY table — its RLS write policy names `system` and nothing else, and
 * migration 0030 asserts no desk role can ever be added to it — so this file is the only thing in
 * the system that fills it. A rep's Performance tab, the owner's target list, the leaderboard and
 * every statement read the rows written here rather than scanning the order book (docs/20 rule 9).
 *
 *   `incentives.achievements.sweep`   hourly: every target whose period contains today (IST),
 *                                     recomputed from `sales_orders` / `visits` / `receipts`.
 *                                     Bounded at 5,000 targets per run through a `(tenant_id, id)`
 *                                     cursor, one transaction per distributor (docs/20 rules 3 and
 *                                     5), and it pages on within the same tick while there is more.
 *                                     A CLOSED period is deliberately not re-swept: its numbers
 *                                     cannot change, so re-reading them every hour would be load
 *                                     for nothing. `targets.refresh` is how a closed period is
 *                                     brought up to date before a statement is struck.
 *
 *   the recompute event               `targets.refresh` writes an `IncentiveAchievementRecomputeRequested`
 *                                     outbox row (an API request may not write the cache itself);
 *                                     the relay hands it here and one target is recomputed at once.
 *                                     At-least-once delivery, so the handler is idempotent by upsert
 *                                     and a target deleted since the event was written is a no-op.
 */
export const INCENTIVES_SWEEP = 'incentives.achievements.sweep'

/** Sweep pages inside one tick, so a big hour still finishes; a bound, not a target (docs/20 rule 3). */
const MAX_SWEEP_PAGES = 20

/** One hourly pass over every open target, paging while the cursor says there is more. */
export async function runIncentivesSweep(db: Db): Promise<{ targets: number; tenants: number }> {
  let after: { tenantId: string; id: string } | null = null
  let targets = 0
  const tenants = new Set<string>()
  for (let page = 0; page < MAX_SWEEP_PAGES; page++) {
    const result = await sweepAchievements(db, { after })
    targets += result.targets
    if (result.last) tenants.add(result.last.tenantId)
    if (!result.truncated || !result.last) break
    after = result.last
  }
  return { targets, tenants: tenants.size }
}

export async function registerIncentivesJobs(boss: PgBoss, db: Db): Promise<void> {
  registerOutboxHandler(INCENTIVE_EVENTS.achievementRecompute, async (event) => {
    const payload = parseRecomputePayload(event.payload)
    if (!payload) return
    const figures = await recomputeAchievement(db, payload)
    logger.debug(
      { targetId: payload.targetId, achieved: figures?.achievedValue ?? null },
      'incentives: achievement recomputed',
    )
  })

  await boss.createQueue(INCENTIVES_SWEEP)
  await boss.work(INCENTIVES_SWEEP, async () => {
    const result = await runIncentivesSweep(db)
    if (result.targets > 0) logger.debug({ ...result }, 'incentives: achievements swept')
  })
  // 23 minutes past every hour: off the top of the hour, where every other cron already is.
  await boss.schedule(INCENTIVES_SWEEP, '23 * * * *')
}
