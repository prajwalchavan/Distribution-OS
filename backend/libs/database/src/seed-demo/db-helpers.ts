import { and, eq, getTableColumns, sql, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Db } from '../client.js'
import { numberingSeries } from '../schema/index.js'
import { FY } from './util.js'

/**
 * The prefix this distributor's own documents carry, e.g. `INV/` for the pilot and `SAI/` for Sai
 * Distributors. The invoice series is per-tenant configuration and never hard-coded (docs/17 §D1),
 * so the seeded history has to read it rather than assume one — otherwise every distributor's bills
 * would print with the pilot's numbers on a screen that shows its own name and logo.
 */
export async function seriesPrefix(
  db: Db,
  tenantId: string,
  seriesCode: string,
  fallback: string,
): Promise<string> {
  const [row] = await db
    .select({ prefix: numberingSeries.prefix })
    .from(numberingSeries)
    .where(
      and(
        eq(numberingSeries.tenantId, tenantId),
        eq(numberingSeries.seriesCode, seriesCode),
        eq(numberingSeries.fy, FY),
      ),
    )
    .limit(1)
  return row?.prefix ?? fallback
}

/**
 * `db.insert(table).values([])` throws ("values() must be called with at least one value"), and several
 * of this seed's row arrays are legitimately empty depending on the deterministic random draw. This skips
 * the round trip instead of every call site needing its own length check.
 */
export async function insertMany<T extends PgTable>(
  db: Db,
  table: T,
  rows: T['$inferInsert'][],
): Promise<void> {
  if (rows.length === 0) return
  await db.insert(table).values(rows).onConflictDoNothing()
}

/**
 * The rollup tables (`daily_*`, `retailer_behaviour`, `owner_summary`) are DERIVED rows the worker
 * rewrites by upsert on their primary key (docs/plans/reporting.md §4 rule 4), never business records,
 * so the seed treats them the same way: an existing row is brought up to what this seed computes (a
 * column added by a later migration gets its value on the founder's already-seeded database), a missing
 * one is inserted. Still idempotent — the same seed produces the same values. `columns` names the
 * columns to refresh; everything else (the key, `computed_at` defaults) is left alone.
 */
export async function upsertMany<T extends PgTable>(
  db: Db,
  table: T,
  rows: T['$inferInsert'][],
  target: PgColumn[],
  columns: (keyof T['_']['columns'] & string)[],
): Promise<void> {
  if (rows.length === 0) return
  const all = getTableColumns(table) as Record<string, PgColumn>
  const set: Record<string, SQL> = {}
  for (const key of columns) {
    const column = all[key]
    if (!column) throw new Error(`upsertMany: ${String(key)} is not a column of the table`)
    set[key] = sql.raw(`excluded."${column.name}"`)
  }
  await db.insert(table).values(rows).onConflictDoUpdate({ target, set })
}
