import { and, eq, inArray } from 'drizzle-orm'
import { memberships, users, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * User id → name, for the members of the CURRENT tenant only. Reporting shows a rep's name beside its
 * numbers (`daily_rep_stats` carries an id) and delivery's register names the driver; tenancy owns
 * `users` and `memberships`, so the lookup lives here and nothing else joins the global table
 * (coordination §4). The `memberships` join is what keeps a name from another distributor's roster out
 * of a report even though `users` is global.
 *
 * A plain exported function: the worker's rollup uses it without Nest DI (coordination §3.9).
 */
export async function userLabels(tx: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter((id) => id.length > 0)
  if (unique.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(and(eq(memberships.tenantId, tenantId), inArray(users.id, unique)))
  return new Map(rows.map((r) => [r.id, r.name]))
}
