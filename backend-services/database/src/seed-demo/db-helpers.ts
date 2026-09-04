import type { PgTable } from 'drizzle-orm/pg-core'
import type { Db } from '../client.js'

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
