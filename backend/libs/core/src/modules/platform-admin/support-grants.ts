import type { SupportGrant } from '@dos/contracts'
import type { supportGrants } from '@dos/db'
import { statusOf } from '../tenancy/index.js'

type GrantRow = typeof supportGrants.$inferSelect

/**
 * The console's view of a support grant, in the SAME shape the owner sees in their own app
 * (`SupportGrantSchema`, declared in `contracts/tenancy.ts` and imported by `admin.ts`). One schema,
 * two readers, so a distributor and Distribution OS can never be looking at two different accounts of
 * what was asked for and what was agreed.
 *
 * `status` is DERIVED, never stored — exactly like an invoice's "overdue" — and it is derived by
 * `statusOf` in `modules/tenancy/support-status.ts`, which the OWNER's half reads too (DOS-110).
 * There is deliberately no second copy here: while there were two, an ask nobody answered inside its
 * own hours read `requested` on both services for ever, and the console counted asks their owners
 * could no longer open.
 *
 * The scope is `read` in the column and `read_only` on the wire: "read only" is what the owner is
 * being asked to agree to, and the word has to say so on the button they press.
 */
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
