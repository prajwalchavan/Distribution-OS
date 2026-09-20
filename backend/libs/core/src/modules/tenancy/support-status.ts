import { and, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import type { SupportGrantStatus } from '@dos/contracts'
import { supportGrants } from '@dos/db'

type GrantRow = typeof supportGrants.$inferSelect

/**
 * WHAT A SUPPORT GRANT IS, in ONE place — in TypeScript for a row already read, and in SQL for a
 * page being read (DOS-110).
 *
 * `status` is DERIVED, never stored, exactly like an invoice's "overdue": a window nobody revoked
 * closes on its own when the clock passes `expires_at`, and no sweep has to run for either side to
 * be told the truth. This module exists because there were TWO copies of that derivation — one in
 * `modules/tenancy` for the owner and one in `modules/platform-admin` for the console — and both had
 * the same hole: an ask nobody answered inside the hours it asked for went on reading `requested`
 * for ever, while `approve` had always refused it with 409 `request_expired`. The console's
 * "Waiting for their owner" therefore listed a hundred rows with nobody waiting on any of them, and
 * two apps grew a clock of their own to tell the difference (`askLapsed`, now deleted from both).
 *
 * THE CLOCK IS THE ROW'S `expires_at`, in TypeScript and in SQL alike. While a grant is unapproved
 * that column holds `requested_at + requested_hours` — what `admin.support.request` wrote and what
 * `tenancy.support.approve` reads when the owner approves without shortening — so nothing here
 * recomputes it, and the two sides can never drift by an hour.
 *
 * The five words, and the one question each answers:
 *   `requested` — asked, unanswered, and their owner can still open it.
 *   `lapsed`    — asked, unanswered, and its own hours have run out. It can never be opened; the
 *                 console raises a new one.
 *   `approved`  — open right now (this, and only this, is `active` on the wire).
 *   `expired`   — was open, closed by the clock.
 *   `rejected`  — the owner said no.  `revoked` — shut while it was open.
 */
export function statusOf(row: GrantRow, now: Date = new Date()): SupportGrantStatus {
  if (row.revokedAt) return row.approvedAt ? 'revoked' : 'rejected'
  if (row.approvedAt) return row.expiresAt.getTime() > now.getTime() ? 'approved' : 'expired'
  return row.expiresAt.getTime() > now.getTime() ? 'requested' : 'lapsed'
}

/**
 * The grants that still matter to whoever is looking: an ask their owner can still answer, or a
 * window that is still open. One predicate for both, because both are "not shut, and not out of
 * time" — `revoked_at IS NULL AND expires_at > now()`.
 */
export function openGrants(): SQL | undefined {
  return and(isNull(supportGrants.revokedAt), sql`${supportGrants.expiresAt} > now()`)
}

/** `?status=` as SQL, the same five words `statusOf` returns. */
export function grantStatusPredicate(status: SupportGrantStatus): SQL | undefined {
  switch (status) {
    case 'requested':
      return and(
        isNull(supportGrants.revokedAt),
        isNull(supportGrants.approvedAt),
        sql`${supportGrants.expiresAt} > now()`,
      )
    case 'lapsed':
      return and(
        isNull(supportGrants.revokedAt),
        isNull(supportGrants.approvedAt),
        sql`${supportGrants.expiresAt} <= now()`,
      )
    case 'approved':
      return and(
        isNull(supportGrants.revokedAt),
        isNotNull(supportGrants.approvedAt),
        sql`${supportGrants.expiresAt} > now()`,
      )
    case 'expired':
      return and(
        isNull(supportGrants.revokedAt),
        isNotNull(supportGrants.approvedAt),
        sql`${supportGrants.expiresAt} <= now()`,
      )
    case 'rejected':
      return and(isNotNull(supportGrants.revokedAt), isNull(supportGrants.approvedAt))
    case 'revoked':
      return and(isNotNull(supportGrants.revokedAt), isNotNull(supportGrants.approvedAt))
  }
}
