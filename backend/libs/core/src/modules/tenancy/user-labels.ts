import { and, asc, eq, inArray } from 'drizzle-orm'
import { memberships, users, type Db, type membershipRole } from '@dos/db'
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

/**
 * The ACTIVE members of one role in the CURRENT tenant, name-ordered and bounded by `limit`. Delivery's
 * trip planning board (QA DOS-131) names the crew a trip may be given through this and never selects
 * `memberships` itself: tenancy owns `users` and `memberships` (coordination §4), the same scoping rule
 * as `userLabels` above. Ids and names only — no phone, no username. It has no permission of its own:
 * the calling procedure gates who may ask. Read on `memberships_tenant_user_idx`.
 */
export async function activeMembersWithRole(
  tx: Db,
  role: (typeof membershipRole.enumValues)[number],
  limit: number,
): Promise<{ userId: string; name: string }[]> {
  const { tenantId } = currentTenant()
  return tx
    .select({ userId: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.role, role),
        eq(memberships.status, 'active'),
      ),
    )
    .orderBy(asc(users.name), asc(users.id))
    .limit(limit)
}
