import { sql } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * How many beat calls a rep actually MADE in a window (coordination §3.9: "10 incentives →
 * `modules/retailers` `visitCount(tx, {userId, from, to})`, plain function").
 *
 * `visits` is retailers' table, so incentives never joins it (coordination §4); and the definition
 * of "a visit that counts" belongs next to the table rather than inside a target's aggregate.
 *
 * A COMPLETED VISIT ONLY. A row is written when the rep checks IN; `ended_at` is stamped at check-out
 * and `outcome` records what came of it. A call still open on the phone — or one abandoned when the
 * app was killed on the doorstep — is not a call made, so `ended_at is not null` is the whole
 * definition. `outcome` is deliberately NOT part of it: "shop closed" and "no order — stocked up" are
 * real visits a rep should be credited with; a `visits` target measures coverage of the beat, not
 * conversion (that is `outlets`, which counts the shops actually billed).
 *
 * WINDOW: `started_at` inside `[from 00:00 IST, to+1 00:00 IST)` — the call belongs to the day the
 * rep walked in, and the instant comparison keeps `visits_user_day_idx` in play.
 */

export interface VisitCountFilter {
  userId: string
  /** IST business dates, inclusive. */
  from: string
  to: string
}

export interface VisitCountRow {
  /** Completed calls in the window. */
  visits: number
  /** Distinct shops among them — not a target dimension today, but free on the same scan. */
  shops: number
}

/** IST midnight of a business date as an instant, `plusDays` later. */
function istInstant(isoDate: string, plusDays = 0): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00.000+05:30`) + plusDays * 86_400_000)
}

/**
 * Plain exported function, so the incentives worker sweep uses it without Nest DI (coordination §3.9
 * worker rule). Runs inside the caller's transaction, so RLS scopes it — `visits_read` is
 * `staffReadPolicy`, and the sweep runs as `system` for one tenant.
 */
export async function visitCount(tx: Db, filter: VisitCountFilter): Promise<VisitCountRow> {
  const { tenantId } = currentTenant()
  const result = await tx.execute(sql`
    select count(*)::int                      as visits,
           count(distinct v.retailer_id)::int as shops
      from visits v
     where v.tenant_id = ${tenantId}
       and v.user_id = ${filter.userId}
       and v.ended_at is not null
       and v.started_at >= ${istInstant(filter.from)}
       and v.started_at < ${istInstant(filter.to, 1)}`)
  const row: Record<string, unknown> = result.rows[0] ?? {}
  const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
  return { visits: n(row.visits), shops: n(row.shops) }
}
