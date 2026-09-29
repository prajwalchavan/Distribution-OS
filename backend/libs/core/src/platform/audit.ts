import { and, eq, inArray, sql } from 'drizzle-orm'
import { auditLog, type Db } from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { currentTenant } from './tenant-context.js'

/**
 * One `audit_log` row for a named sensitive action (a price, a credit limit, an approval, a setting,
 * an export, a GPS trace read). Written inside the caller's transaction by whoever did the thing:
 * the table's INSERT policy pins `actor_id` to the session actor, so the trail cannot be forged.
 * `tenancy.audit.list` reads it back for the desk (docs/23 §8.13).
 */
export interface AuditEntryInput {
  /** Dotted verb, e.g. `setting.set`, `numbering.upsert`, `retailer.update_own`. */
  action: string
  entityType: string
  entityId: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  deviceId?: string | null
}

export async function writeAudit(tx: Db, entry: AuditEntryInput): Promise<void> {
  const ctx = currentTenant()
  await tx.insert(auditLog).values({
    id: uuidv7(),
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    actorRole: ctx.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    deviceId: entry.deviceId ?? null,
  })
}

/**
 * When `action` last happened to each of `entityIds` in this tenant (DOS-400: since when a shop has
 * its app sign-in). One grouped read on `audit_log_entity_time_idx`; an entity with no such row is
 * absent from the map. Read under the caller's own role, so only the back office gets answers.
 */
export async function lastAuditAt(
  tx: Db,
  input: { entityType: string; action: string; entityIds: readonly string[] },
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  const ids = [...new Set(input.entityIds)]
  if (ids.length === 0) return out
  const rows = await tx
    .select({
      entityId: auditLog.entityId,
      at: sql<Date | string>`max(${auditLog.occurredAt})`,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.tenantId, currentTenant().tenantId),
        eq(auditLog.entityType, input.entityType),
        inArray(auditLog.entityId, ids),
        eq(auditLog.action, input.action),
      ),
    )
    .groupBy(auditLog.entityId)
  for (const row of rows) {
    const at = row.at instanceof Date ? row.at : new Date(row.at)
    if (!Number.isNaN(at.getTime())) out.set(row.entityId, at)
  }
  return out
}
