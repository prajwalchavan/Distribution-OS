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
 *  - docint derived rows (extraction_checks, sku_match_candidates) of documents rejected/failed > 180
 *    days ago; the page objects and the extraction itself are KEPT (they are the record behind a GRN)
 *  - ai_order_drafts: 180 days (a shop's words and at times its recorded voice; the ORDER a confirmed
 *    draft created is a business record and stays — only the raw capture goes)
 *  - ai_forecasts: 90 days (a cache of a computation; anything older is noise, and the current rows are
 *    rewritten in place by the sweep, so this only removes horizons and locations no longer forecast)
 * Each statement is bounded so a backlog never holds locks for long; the job re-runs hourly.
 */
export async function runRetention(db: Db): Promise<Record<string, number>> {
  const sweeps: Record<string, ReturnType<typeof sql>> = {
    idempotency_keys: sql`DELETE FROM idempotency_keys WHERE ctid IN (SELECT ctid FROM idempotency_keys WHERE created_at < now() - interval '24 hours' LIMIT 5000)`,
    sync_ops: sql`DELETE FROM sync_ops WHERE ctid IN (SELECT ctid FROM sync_ops WHERE created_at < now() - interval '180 days' LIMIT 5000)`,
    trip_points: sql`DELETE FROM trip_points WHERE ctid IN (SELECT ctid FROM trip_points WHERE recorded_at < now() - interval '90 days' LIMIT 20000)`,
    sync_errors: sql`DELETE FROM sync_errors WHERE ctid IN (SELECT ctid FROM sync_errors WHERE resolved_at IS NOT NULL AND resolved_at < now() - interval '90 days' LIMIT 5000)`,
    outbox_events: sql`DELETE FROM outbox_events WHERE ctid IN (SELECT ctid FROM outbox_events WHERE published_at IS NOT NULL AND published_at < now() - interval '30 days' LIMIT 5000)`,
    extraction_checks: sql`DELETE FROM extraction_checks WHERE ctid IN (SELECT c.ctid FROM extraction_checks c JOIN extractions e ON e.id = c.extraction_id JOIN documents d ON d.id = e.document_id WHERE d.status IN ('rejected', 'failed') AND d.updated_at < now() - interval '180 days' LIMIT 5000)`,
    sku_match_candidates: sql`DELETE FROM sku_match_candidates WHERE ctid IN (SELECT c.ctid FROM sku_match_candidates c JOIN extractions e ON e.id = c.extraction_id JOIN documents d ON d.id = e.document_id WHERE d.status IN ('rejected', 'failed') AND d.updated_at < now() - interval '180 days' LIMIT 5000)`,
    ai_order_drafts: sql`DELETE FROM ai_order_drafts WHERE ctid IN (SELECT ctid FROM ai_order_drafts WHERE created_at < now() - interval '180 days' LIMIT 5000)`,
    ai_forecasts: sql`DELETE FROM ai_forecasts WHERE ctid IN (SELECT ctid FROM ai_forecasts WHERE computed_at < now() - interval '90 days' LIMIT 5000)`,
  }
  const deleted: Record<string, number> = {}
  for (const [table, statement] of Object.entries(sweeps)) {
    const result = await db.execute(statement)
    deleted[table] = result.rowCount ?? 0
  }
  logger.info({ deleted }, 'retention sweep done')
  return deleted
}
