import { sql } from 'drizzle-orm'
import type { Db } from '@dos/db'
import { logger } from '../logger.js'

export const RETENTION = 'retention'

/**
 * Data-retention sweeps (cross-tenant; runs on the worker role which bypasses RLS):
 *  - idempotency_keys: 24 h (ADR 0007 / D16 — the ONLY 24-hour table)
 *  - sync_ops: 180 days (a device can stay offline for days; replays must stay idempotent)
 *  - trip_points: 90 days (DPDP; stop coordinates and POD evidence are business records and stay with the invoice)
 *  - sync_errors resolved > 90 days ago
 *  - outbox_events published > 30 days ago
 * Each statement is bounded so a backlog never holds locks for long; the job re-runs hourly.
 */
export async function runRetention(db: Db): Promise<Record<string, number>> {
  const sweeps: Record<string, ReturnType<typeof sql>> = {
    idempotency_keys: sql`DELETE FROM idempotency_keys WHERE ctid IN (SELECT ctid FROM idempotency_keys WHERE created_at < now() - interval '24 hours' LIMIT 5000)`,
    sync_ops: sql`DELETE FROM sync_ops WHERE ctid IN (SELECT ctid FROM sync_ops WHERE created_at < now() - interval '180 days' LIMIT 5000)`,
    trip_points: sql`DELETE FROM trip_points WHERE ctid IN (SELECT ctid FROM trip_points WHERE recorded_at < now() - interval '90 days' LIMIT 20000)`,
    sync_errors: sql`DELETE FROM sync_errors WHERE ctid IN (SELECT ctid FROM sync_errors WHERE resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days' LIMIT 5000)`,
    outbox_events: sql`DELETE FROM outbox_events WHERE ctid IN (SELECT ctid FROM outbox_events WHERE published_at IS NOT NULL AND published_at < now() - interval '30 days' LIMIT 5000)`,
  }
  const deleted: Record<string, number> = {}
  for (const [table, statement] of Object.entries(sweeps)) {
    const result = await db.execute(statement)
    deleted[table] = result.rowCount ?? 0
  }
  logger.info({ deleted }, 'retention sweep done')
  return deleted
}
