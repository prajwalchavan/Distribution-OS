import { and, eq, inArray } from 'drizzle-orm'
import { tripStops, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * DOS-102 — "is a van coming?" for the shop's cross-distributor home.
 *
 * The stops a shop is still waiting for: `pending`, `started` and `arrived`, exactly the set the
 * retailer app's home already treats as open. No id and no join to `trips`: RLS on `trip_stops`
 * narrows a `retailer` actor to its own shops' stops (`retailer_links.user_id`), while `trips` has a
 * read policy of its own that excludes the retailer role — joining it would answer nothing.
 *
 * Answers the COUNT, the most advanced state among those stops (a van at the door outranks one on the
 * road, which outranks one not started) and the earliest ETA anything carries. Never a coordinate:
 * the shop learns when, never where the driver is standing (docs/22 §9).
 */
export interface OpenStopsForCaller {
  stops: number
  state: 'pending' | 'started' | 'arrived'
  etaAt: Date | null
}

const OPEN_STOP_STATES = ['pending', 'started', 'arrived'] as const
/** Most advanced last: a van AT the shop is further along than one on its way. */
const ADVANCE = ['pending', 'started', 'arrived'] as const

/** Bounded: a shop with more open stops than this in one distributor is not a shop. */
const MAX_OPEN_STOPS = 200

export async function openStopsForCaller(tx: Db): Promise<OpenStopsForCaller | null> {
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({ state: tripStops.state, etaAt: tripStops.etaAt })
    .from(tripStops)
    .where(and(eq(tripStops.tenantId, tenantId), inArray(tripStops.state, OPEN_STOP_STATES)))
    .limit(MAX_OPEN_STOPS)
  if (rows.length === 0) return null
  let rank = 0
  let etaAt: Date | null = null
  for (const row of rows) {
    const at = ADVANCE.indexOf(row.state as (typeof ADVANCE)[number])
    if (at > rank) rank = at
    if (row.etaAt !== null && (etaAt === null || row.etaAt < etaAt)) etaAt = row.etaAt
  }
  return { stops: rows.length, state: ADVANCE[rank] ?? 'pending', etaAt }
}
