import { sql } from 'drizzle-orm'
import { withTenant, type Db, type TenantContext } from '@dos/db'
import { businessDate } from '@dos/domain'
import { tenantStorage } from '../../platform/index.js'
import { AGEING_BATCH, idList, rebuildAgeingPage, retailerIdPage } from './outstanding.js'

/**
 * THE NIGHTLY AGEING REBUILD (DOS-117, docs/plans/receivables.md §7). A shop's dues row is refreshed by
 * every posting and aged against that posting's business date, so on a day the shop has no posting its
 * overdue and its buckets would stay frozen on the last one. The worker re-dates every shop of a tenant
 * once per IST business day: the 00:20 IST finalize fans out one `receivables.ageing.rebuild` job per
 * tenant, and `receivables.ageing.catchup` queues one on start-up for a tenant that missed it.
 *
 * Plain functions for the pg-boss worker (coordination §3.9): no Nest, no request context, no
 * idempotency key. Idempotent by upsert, so a retry or two overlapping runs write the same rows.
 *
 *  - Each page of `AGEING_BATCH` shops is ONE short transaction as the tenant's system actor. Nothing
 *    holds a tenant-wide transaction.
 *  - Each page first locks its shops' existing dues rows `FOR UPDATE`, in retailer_id order, and locks
 *    nothing else. Every posting refreshes exactly one shop's row, last in its own transaction, so a
 *    posting to a shop on the page waits for the page (or the page for it) and the recompute reads the
 *    committed bills: a stale value never overwrites a fresh one, and no lock cycle is possible. Taking
 *    any other lock here breaks that proof.
 *  - The page body is `rebuildAgeingPage`, shared with the owner's `receivables.ageing.rebuild`.
 */

const systemCtx = (tenantId: string): TenantContext => ({
  tenantId,
  actorId: 'system',
  actorRole: 'system',
})

export interface TenantAgeingResult {
  asOf: string
  retailers: number
  outstandingPaise: number
  overduePaise: number
}

/** Re-date every shop of one tenant to `asOf`: dues rows recomputed and the day's snapshot written. */
export async function rebuildTenantAgeing(
  db: Db,
  tenantId: string,
  asOf: string = businessDate().date,
): Promise<TenantAgeingResult> {
  const ctx = systemCtx(tenantId)
  const total: TenantAgeingResult = { asOf, retailers: 0, outstandingPaise: 0, overduePaise: 0 }
  let cursor: string | null = null
  for (;;) {
    const after = cursor
    const page = await tenantStorage.run(ctx, () =>
      withTenant(db, ctx, async (tx) => {
        const ids = await retailerIdPage(tx, after, AGEING_BATCH)
        if (ids.length === 0) return { ids, retailers: 0, outstandingPaise: 0, overduePaise: 0 }
        await tx.execute(sql`
          select retailer_id from retailer_outstanding_summary
           where tenant_id = ${tenantId} and retailer_id in (${idList(ids)})
           order by retailer_id
             for update`)
        return { ids, ...(await rebuildAgeingPage(tx, asOf, ids)) }
      }),
    )
    total.retailers += page.retailers
    total.outstandingPaise += page.outstandingPaise
    total.overduePaise += page.overduePaise
    const last = page.ids.at(-1)
    if (page.ids.length < AGEING_BATCH || last === undefined) break
    cursor = last
  }
  return total
}

/**
 * Whether the tenant still needs the day's rebuild: any dues row dated before `asOf` (the defect itself),
 * or dues rows but no snapshot at all for `asOf`. The owner's one-shop rebuild writes a snapshot for the
 * day and leaves the other shops' rows dated earlier, so the first branch still fires. A shop added after
 * the day's rebuild with no posting yet has no dues row, so it never makes the tenant stale.
 */
export async function ageingNeedsRebuild(
  db: Db,
  tenantId: string,
  asOf: string = businessDate().date,
): Promise<boolean> {
  const ctx = systemCtx(tenantId)
  const result = await tenantStorage.run(ctx, () =>
    withTenant(db, ctx, (tx) =>
      tx.execute(sql`
        select exists (
                 select 1 from retailer_outstanding_summary s
                  where s.tenant_id = ${tenantId} and s.as_of < ${asOf})
            or (exists (
                  select 1 from retailer_outstanding_summary s where s.tenant_id = ${tenantId})
                and not exists (
                  select 1 from ageing_snapshots a
                   where a.tenant_id = ${tenantId} and a.as_of = ${asOf})) as stale`),
    ),
  )
  return result.rows[0]?.stale === true
}
