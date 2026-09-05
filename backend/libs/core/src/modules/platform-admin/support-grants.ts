import type { SupportGrant, SupportGrantStatus } from '@dos/contracts'
import type { supportGrants } from '@dos/db'

type GrantRow = typeof supportGrants.$inferSelect

/**
 * The console's view of a support grant, in the SAME shape the owner sees in their own app
 * (`SupportGrantSchema`, declared in `contracts/tenancy.ts` and imported by `admin.ts`). One schema,
 * two readers, so a distributor and Distribution OS can never be looking at two different accounts of
 * what was asked for and what was agreed.
 *
 * `status` is DERIVED, never stored — exactly like an invoice's "overdue". A window nobody revoked
 * closes on its own when the clock passes `expires_at`, and no sweep has to run for either side to be
 * told the truth. `rejected` is a request shut before it ever opened; `revoked` is one shut after.
 *
 * The scope is `read` in the column and `read_only` on the wire: "read only" is what the owner is
 * being asked to agree to, and the word has to say so on the button they press.
 */
export function statusOf(row: GrantRow, now: Date = new Date()): SupportGrantStatus {
  if (row.revokedAt) return row.approvedAt ? 'revoked' : 'rejected'
  if (!row.approvedAt) return 'requested'
  return row.expiresAt.getTime() > now.getTime() ? 'approved' : 'expired'
}

export function toSupportGrant(
  row: GrantRow,
  requesterName = 'Distribution OS support',
  now: Date = new Date(),
): SupportGrant {
  const status = statusOf(row, now)
  return {
    id: row.id,
    status,
    scope: row.scope === 'read_write' ? 'read_write' : 'read_only',
    reason: row.reason,
    requestedHours: row.requestedHours,
    requestedBy: row.adminUserId,
    requestedByName: requesterName,
    requestedAt: row.requestedAt.toISOString(),
    decidedBy: row.approvedBy ?? row.revokedBy ?? null,
    decidedAt: (row.approvedAt ?? row.revokedAt)?.toISOString() ?? null,
    decisionNote: row.decisionNote ?? row.revokeReason ?? null,
    expiresAt: row.approvedAt ? row.expiresAt.toISOString() : null,
    revokedBy: row.revokedBy ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokeReason: row.revokeReason ?? null,
    active: status === 'approved',
  }
}
