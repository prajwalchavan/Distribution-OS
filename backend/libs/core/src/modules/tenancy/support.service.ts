import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm'
import type {
  SupportApproveIn,
  SupportGrant,
  SupportGrantItem,
  SupportGrantStatus,
  SupportList,
  SupportListInput,
  SupportRevokeIn,
} from '@dos/contracts'
import type { z } from 'zod'
import { supportGrants, withTenant, type Db } from '@dos/db'
import {
  currentTenant,
  DB,
  idempotent,
  OWNER,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'

type ListIn = z.infer<typeof SupportListInput>
type GrantRow = typeof supportGrants.$inferSelect

const HOUR_MS = 60 * 60 * 1000

/**
 * THE OWNER'S HALF of platform support access (founder decision 2026-09-05, docs/22 §2 row 7 and §8:
 * "support-access grants — time-boxed, owner-approved, audited"; docs/17 §B [57]).
 *
 * Distribution OS staff can ask to look inside a distributor's books, from the platform console
 * (`admin.support.request`, module 13). NOTHING opens on that ask. This service is the other side of
 * it and the only side that can say yes: the distributor's OWNER sees the request in the owner app,
 * reads the reason our person wrote, and either opens a window — for at most the hours that were
 * asked for, and for fewer if they choose — or shuts it. Both answers are written into the tenant's
 * own `audit_log`, where `tenancy.audit.list` shows them beside every other thing that happened here.
 *
 * WHY IT LIVES IN `modules/tenancy` and not in a platform module: the row belongs to the console, but
 * the DECISION belongs to the distributor, and the decision is reached from the owner app on
 * owner-service. `permissions.ts` grants all three procedures to `OWNER_ONLY`; no manager and no
 * accountant appears, because answering "may a stranger read my ledgers" is not a delegated job.
 *
 * WHAT THIS CODE DOES NOT DECIDE — all of it is enforced in the database by
 * `dos_support_grant_guard()` (migrations 0034 and 0036), so a later endpoint written by someone in a
 * hurry cannot get round it:
 *   - the window is at most 30 days from the request, and it must end after it starts;
 *   - `approved_by` is an ACTIVE OWNER OF THIS VERY TENANT and never the person who asked;
 *   - an owner may touch only the decision columns, under their own id — not the reason, not the
 *     scope, not the tenant;
 *   - the window may be SHORTENED at the moment of approval and never moved afterwards, and never
 *     lengthened;
 *   - an approval is revoked, never un-done; a revoked grant is closed for good.
 *
 * The three refusals below (`grant_closed`, `already_approved`, `request_expired`) exist so the app
 * gets a sentence it can show instead of a constraint error, not because they are the guarantee. The
 * guarantee is the trigger.
 */
@Injectable()
export class SupportAccessService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /** Newest first. Defaults to the grants that still matter: requested, or approved and still live. */
  async list(input: ListIn): Promise<SupportList> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, async (tx) => {
      const where = and(
        eq(supportGrants.tenantId, ctx.tenantId),
        input.openOnly ? openOnly() : undefined,
        input.status ? statusPredicate(input.status) : undefined,
        input.cursor ? lt(supportGrants.id, input.cursor) : undefined,
      )
      const rows = await tx
        .select()
        .from(supportGrants)
        .where(where)
        .orderBy(desc(supportGrants.requestedAt), desc(supportGrants.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const names = await this.requesterNames(tx, page)
      const last = page.at(-1)
      return {
        items: page.map((row) => toGrant(row, names)),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  /**
   * Open the window. `hours` may only SHORTEN what was asked for, and it is measured from the REQUEST,
   * not from the approval — "you asked for four hours, take two" is a smaller window than the one on
   * the card, whereas two hours counted from now could be a longer one than the owner was shown. A
   * window that has already closed by the time the owner gets to it is not approved at all: the
   * console asks again.
   */
  async approve(input: SupportApproveIn): Promise<SupportGrantItem> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const grant = await this.lock(tx, input.id)
        if (grant.revokedAt)
          throw new ORPCError('CONFLICT', {
            message: 'this support request is closed; ask the console to raise a new one',
            data: { code: 'grant_closed' },
          })
        if (grant.approvedAt)
          throw new ORPCError('CONFLICT', {
            message: 'this support window is already open',
            data: { code: 'already_approved' },
          })
        if (input.hours !== undefined && input.hours > grant.requestedHours)
          throw new ORPCError('BAD_REQUEST', {
            message: `support asked for ${String(grant.requestedHours)} hours; a window may be shortened, never lengthened`,
            data: { code: 'window_too_long', requestedHours: grant.requestedHours },
          })

        const now = new Date()
        const expiresAt =
          input.hours === undefined
            ? grant.expiresAt
            : new Date(grant.requestedAt.getTime() + input.hours * HOUR_MS)
        if (expiresAt.getTime() <= now.getTime())
          throw new ORPCError('CONFLICT', {
            message: 'that window has already closed; ask the console to raise a new request',
            data: { code: 'request_expired' },
          })

        const [row] = await tx
          .update(supportGrants)
          .set({
            approvedBy: ctx.actorId,
            approvedAt: now,
            expiresAt,
            decisionNote: input.note ?? null,
            updatedAt: now,
          })
          .where(eq(supportGrants.id, grant.id))
          .returning()
        const saved = row ?? grant
        await writeAudit(tx, {
          action: 'support.approve',
          entityType: 'support_grant',
          entityId: saved.id,
          before: { status: 'requested', expiresAt: grant.expiresAt.toISOString() },
          after: {
            status: 'approved',
            scope: saved.scope,
            expiresAt: saved.expiresAt.toISOString(),
            note: saved.decisionNote,
          },
        })
        return { item: toGrant(saved, await this.requesterNames(tx, [saved])) }
      }),
    )
  }

  /**
   * Shut it — before it opens (a refusal) or while it is open (a revocation). The row keeps which of
   * the two it was: `approved_at` is never cleared, so `rejected` and `revoked` stay distinguishable
   * for ever, and nothing is deleted.
   */
  async revoke(input: SupportRevokeIn): Promise<SupportGrantItem> {
    requireRole(OWNER)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const grant = await this.lock(tx, input.id)
        if (grant.revokedAt)
          throw new ORPCError('CONFLICT', {
            message: 'this support request is already closed',
            data: { code: 'grant_closed' },
          })

        const now = new Date()
        const [row] = await tx
          .update(supportGrants)
          .set({
            revokedBy: ctx.actorId,
            revokedAt: now,
            revokeReason: input.reason ?? null,
            updatedAt: now,
          })
          .where(eq(supportGrants.id, grant.id))
          .returning()
        const saved = row ?? grant
        await writeAudit(tx, {
          action: 'support.revoke',
          entityType: 'support_grant',
          entityId: saved.id,
          before: { status: grant.approvedAt ? 'approved' : 'requested' },
          after: { status: statusOf(saved, now), reason: saved.revokeReason },
        })
        return { item: toGrant(saved, await this.requesterNames(tx, [saved])) }
      }),
    )
  }

  private async lock(tx: Db, id: string): Promise<GrantRow> {
    const ctx = currentTenant()
    const [row] = await tx
      .select()
      .from(supportGrants)
      .where(and(eq(supportGrants.id, id), eq(supportGrants.tenantId, ctx.tenantId)))
      .for('update')
    if (!row) throw new ORPCError('NOT_FOUND', { message: `support request ${id} not found` })
    return row
  }

  /**
   * The name to put on the owner's card. Distribution OS staff hold NO membership of this tenant, so
   * `users_visible` — "yourself, or somebody in your tenant" — hides the very person who is asking,
   * and no actor role changes that (the policy keys on membership, not on role).
   *
   * `dos_support_requester_names()` (migration 0037) is a SECURITY DEFINER function that returns one
   * column, and only for ids that are PLATFORM ADMINISTRATORS. It cannot be pointed at a shopkeeper,
   * a rep or another distributor's owner: the join to `platform_admins` lives inside the function
   * where no caller can drop it. That is deliberately narrower than widening `users_visible`, which
   * would open the whole users table to a predicate about support for the sake of a name on a card.
   */
  private async requesterNames(
    tx: Db,
    rows: readonly GrantRow[],
  ): Promise<ReadonlyMap<string, string>> {
    const ids = [...new Set(rows.map((row) => row.adminUserId))]
    if (ids.length === 0) return new Map()
    const found = await tx.execute<{ user_id: string; display_name: string }>(
      sql`select user_id, display_name from dos_support_requester_names(${sql.param(ids)}::text[])`,
    )
    return new Map(found.rows.map((row) => [row.user_id, row.display_name]))
  }
}

/** Requested, or approved and not yet closed: the grants an owner still has to think about. */
function openOnly(): SQL | undefined {
  return and(
    isNull(supportGrants.revokedAt),
    sql`(${supportGrants.approvedAt} IS NULL OR ${supportGrants.expiresAt} > now())`,
  )
}

function statusPredicate(status: SupportGrantStatus): SQL | undefined {
  switch (status) {
    case 'requested':
      return and(isNull(supportGrants.revokedAt), isNull(supportGrants.approvedAt))
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

/**
 * `status` is DERIVED, never stored, exactly like an invoice's "overdue": a window that nobody
 * revoked closes on its own when the clock passes `expires_at`, and no sweep has to run for the owner
 * to be told the truth. `rejected` is a grant shut before it ever opened; `revoked` is one shut after.
 */
function statusOf(row: GrantRow, now: Date): SupportGrantStatus {
  if (row.revokedAt) return row.approvedAt ? 'revoked' : 'rejected'
  if (!row.approvedAt) return 'requested'
  return row.expiresAt.getTime() > now.getTime() ? 'approved' : 'expired'
}

function toGrant(row: GrantRow, names: ReadonlyMap<string, string>): SupportGrant {
  const status = statusOf(row, new Date())
  return {
    id: row.id,
    status,
    // The database calls the narrow scope `read`; the wire calls it `read_only`, because "read only"
    // is what the owner is being asked to agree to and the word has to say so on the button.
    scope: row.scope === 'read_write' ? 'read_write' : 'read_only',
    reason: row.reason,
    requestedHours: row.requestedHours,
    requestedBy: row.adminUserId,
    requestedByName: names.get(row.adminUserId) ?? 'Distribution OS support',
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
