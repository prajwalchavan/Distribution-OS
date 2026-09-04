import { ORPCError } from '@orpc/server'
import type { Db } from '@dos/db'

/** Services receive `Db | null` (null when DATABASE_URL is unset); procedures that need it fail loudly. */
export function requireDb(db: Db | null): Db {
  if (!db) throw new ORPCError('SERVICE_UNAVAILABLE', { message: 'database is not configured' })
  return db
}
