import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { beatAssignments, beats, retailers, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * Beat reads for reporting (coordination §3.9: "9 reporting → `modules/retailers`
 * `beatAssignmentsFor`"). Retailers owns `beats` and `beat_assignments`; reporting needs to know which
 * beat a rep was on for each day of a window — a rep reassigned mid-window belongs to BOTH beats, on
 * their respective days, and must never be double-counted in one beat's total
 * (docs/plans/reporting.md §5 spec 4).
 *
 * Plain exported functions, so the worker's rollup uses them without Nest DI (coordination §3.9).
 */

export interface BeatAssignmentFilter {
  /** IST business dates, inclusive: every assignment that OVERLAPS this window. */
  from: string
  to: string
  beatId?: string | undefined
  userId?: string | undefined
  userIds?: readonly string[] | undefined
  limit?: number | undefined
}

export interface BeatAssignmentRow {
  beatId: string
  beatName: string
  userId: string
  validFrom: string
  /** Open-ended when null: the rep is still on this beat. */
  validTo: string | null
}

export async function beatAssignmentsFor(
  tx: Db,
  filter: BeatAssignmentFilter,
): Promise<BeatAssignmentRow[]> {
  const { tenantId } = currentTenant()
  if (filter.userIds?.length === 0) return []
  const rows = await tx
    .select({
      beatId: beatAssignments.beatId,
      beatName: beats.name,
      userId: beatAssignments.userId,
      validFrom: beatAssignments.validFrom,
      validTo: beatAssignments.validTo,
    })
    .from(beatAssignments)
    .innerJoin(beats, eq(beats.id, beatAssignments.beatId))
    .where(
      and(
        eq(beatAssignments.tenantId, tenantId),
        filter.beatId ? eq(beatAssignments.beatId, filter.beatId) : undefined,
        filter.userId ? eq(beatAssignments.userId, filter.userId) : undefined,
        filter.userIds ? inArray(beatAssignments.userId, [...filter.userIds]) : undefined,
        sql`${beatAssignments.validFrom} <= ${filter.to}`,
        sql`(${beatAssignments.validTo} is null or ${beatAssignments.validTo} >= ${filter.from})`,
      ),
    )
    .orderBy(asc(beatAssignments.userId), asc(beatAssignments.validFrom))
    .limit(Math.min(filter.limit ?? 1_000, 5_000))
  return rows.map((r) => ({
    beatId: r.beatId,
    beatName: r.beatName,
    userId: r.userId,
    validFrom: r.validFrom,
    validTo: r.validTo,
  }))
}

/** Beat id → name, for a report row that shows the beat a number belongs to. */
export async function beatLabels(tx: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter((id) => id.length > 0)
  if (unique.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({ id: beats.id, name: beats.name })
    .from(beats)
    .where(and(eq(beats.tenantId, tenantId), inArray(beats.id, unique)))
  return new Map(rows.map((r) => [r.id, r.name]))
}

/** The beats a rep is on right now — how a salesperson's report reads are pre-scoped to its own shops. */
export async function currentBeatIdsFor(tx: Db, userId: string, on: string): Promise<string[]> {
  const rows = await beatAssignmentsFor(tx, { from: on, to: on, userId })
  return [...new Set(rows.map((r) => r.beatId))]
}

/** A shop's name and the beat it sits on — the click-through of a "top shops" bar (docs/23 §1.2). */
export interface RetailerRef {
  name: string
  beatId: string | null
}

export async function retailerRefs(
  tx: Db,
  ids: readonly string[],
): Promise<Map<string, RetailerRef>> {
  const unique = [...new Set(ids)].filter((id) => id.length > 0)
  if (unique.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({ id: retailers.id, name: retailers.name, beatId: retailers.beatId })
    .from(retailers)
    .where(and(eq(retailers.tenantId, tenantId), inArray(retailers.id, unique)))
  return new Map(rows.map((r) => [r.id, { name: r.name, beatId: r.beatId }]))
}

/** The shops of one beat (a rep's own list, or the owner's beat filter); bounded like every list. */
export async function retailerIdsOnBeats(
  tx: Db,
  beatIds: readonly string[],
  limit = 5_000,
): Promise<string[]> {
  const unique = [...new Set(beatIds)].filter((id) => id.length > 0)
  if (unique.length === 0) return []
  const { tenantId } = currentTenant()
  const rows = await tx
    .select({ id: retailers.id })
    .from(retailers)
    .where(and(eq(retailers.tenantId, tenantId), inArray(retailers.beatId, unique)))
    .orderBy(asc(retailers.id))
    .limit(limit)
  return rows.map((r) => r.id)
}
