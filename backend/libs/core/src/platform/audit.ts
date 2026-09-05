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
