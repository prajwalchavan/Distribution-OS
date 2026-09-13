import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, desc, eq, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm'
import type {
  AdminSupportGrant,
  AdminSupportList,
  AdminSupportListInput,
  AdminSupportRevokeIn,
  SupportGrantStatus,
  SupportRequestIn,
} from '@dos/contracts'
import type { z } from 'zod'
import { supportGrants, tenants, type Db } from '@dos/db'
import { DB, platformIdempotent, requireDb } from '../../platform/index.js'
import { statusOf, toSupportGrant } from './support-grants.js'
import {
  platformActorId,
  requireActiveAdminLevel,
  withPlatform,
  writePlatformAudit,
} from './internals.js'

type ListIn = z.infer<typeof AdminSupportListInput>
type GrantRow = typeof supportGrants.$inferSelect

const HOUR_MS = 60 * 60 * 1000

/**
 * THE CONSOLE'S HALF of support access (founder decision 2026-09-05, docs/22 §2 row 7 and §8;
 * docs/17 §B [57]). It can do exactly two things: ASK, and WITHDRAW ITS OWN ASK.
 *
 * There is no `approve` here and there never will be. The window is opened by
 * `tenancy.support.approve`, which only the distributor's own OWNER may call, on owner-service, from
 * their own app — and the database refuses the shortcut even if somebody writes the endpoint:
 * `dos_support_grant_guard()` (migration 0034 §4d) raises `insufficient_privilege` the moment a
 * `platform_admin` actor touches `approved_by` or `approved_at`, on insert or on update. Requesting
 * and approving are two people in two different companies, and that is enforced one layer below this
 * one.
 *
 * An APPROVED grant is still not access: it has to be exchanged for a short-lived signed pass at
 * `auth.supportPass`, and every request made with that pass writes a `platform_audit` row
 * (`platform/support-access.ts`, `service/support-audit.interceptor.ts`). Time-boxed, owner-approved,
 * audited — the founder's three words, one mechanism each.
 */
@Injectable()
export class PlatformSupportService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /**
   * Ask one distributor's owner for a window. The row is created `requested` and grants NOTHING. The
   * hours asked for are stored beside the expiry, so when the owner approves a SHORTER window both
   * sides can still see what was asked against what was agreed.
   */
  async request(input: SupportRequestIn): Promise<{ item: AdminSupportGrant }> {
    const db = requireDb(this.db)
    const actorId = platformActorId()
    return withPlatform(db, async (tx) => {
      // The level and the login BEFORE the key: a stored reply is handed back without running anything,
      // so a billing account replaying a support ask with the identical body must be refused here.
      await requireActiveAdminLevel(tx, actorId, 'admin.support.request')
      return platformIdempotent(tx, input.tenantId, input.idempotencyKey, input, async () => {
        const [tenant] = await tx
          .select()
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1)
        if (!tenant) {
          throw new ORPCError('NOT_FOUND', { message: `no distributor ${input.tenantId}` })
        }
        const requestedAt = new Date()
        const [row] = await tx
          .insert(supportGrants)
          .values({
            id: input.id,
            tenantId: input.tenantId,
            adminUserId: actorId,
            requestedAt,
            requestedHours: input.hours,
            reason: input.reason,
            expiresAt: new Date(requestedAt.getTime() + input.hours * HOUR_MS),
            scope: input.scope === 'read_write' ? 'read_write' : 'read',
          })
          .returning()
        if (!row) {
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'support request wrote nothing' })
        }
        await writePlatformAudit(tx, {
          action: 'support.requested',
          tenantId: input.tenantId,
          payload: {
            grantId: row.id,
            hours: input.hours,
            scope: input.scope,
            reason: input.reason,
          },
        })
        return { item: await this.decorate(tx, row) }
      })
    })
  }

  /** Every request and window across every distributor, newest first. */
  async list(input: ListIn): Promise<AdminSupportList> {
    const db = requireDb(this.db)
    return withPlatform(db, async (tx) => {
      await requireActiveAdminLevel(tx, platformActorId(), 'admin.support.list')
      const rows = await tx
        .select({ grant: supportGrants, tenant: tenants })
        .from(supportGrants)
        .innerJoin(tenants, eq(tenants.id, supportGrants.tenantId))
        .where(
          and(
            input.tenantId ? eq(supportGrants.tenantId, input.tenantId) : undefined,
            input.openOnly ? openOnly() : undefined,
            input.status ? statusPredicate(input.status) : undefined,
            input.cursor ? lt(supportGrants.id, input.cursor) : undefined,
          ),
        )
        .orderBy(desc(supportGrants.requestedAt), desc(supportGrants.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const names = await this.requesterNames(
        tx,
        page.map((r) => r.grant),
      )
      const last = page.at(-1)
      return {
        items: page.map((r) => ({
          ...toSupportGrant(r.grant, names.get(r.grant.adminUserId) ?? 'Distribution OS support'),
          tenantId: r.tenant.id,
          tenantSlug: r.tenant.slug,
          tenantName: r.tenant.legalName,
        })),
        nextCursor: rows.length > input.limit && last ? last.grant.id : null,
      }
    })
  }

  /**
   * Give the window back before it lapses, or withdraw a request the owner has not answered. The row
   * keeps which of the two it was: `approved_at` is never cleared, so `rejected` (shut before it
   * opened) and `revoked` (shut after) stay distinguishable for ever, and nothing is deleted.
   */
  async revoke(input: AdminSupportRevokeIn): Promise<{ item: AdminSupportGrant }> {
    const db = requireDb(this.db)
    const actorId = platformActorId()
    return withPlatform(db, async (tx) => {
      // The level and the login first: before the grant is looked up, and before the key.
      await requireActiveAdminLevel(tx, actorId, 'admin.support.revoke')
      const [found] = await tx
        .select()
        .from(supportGrants)
        .where(eq(supportGrants.id, input.id))
        .limit(1)
      if (!found) throw new ORPCError('NOT_FOUND', { message: `no support request ${input.id}` })
      return platformIdempotent(tx, found.tenantId, input.idempotencyKey, input, async () => {
        const [grant] = await tx
          .select()
          .from(supportGrants)
          .where(eq(supportGrants.id, input.id))
          .for('update')
        if (!grant) throw new ORPCError('NOT_FOUND', { message: `no support request ${input.id}` })
        if (grant.adminUserId !== actorId) {
          throw new ORPCError('FORBIDDEN', {
            message:
              'that window belongs to another administrator; they withdraw it, or the owner does',
          })
        }
        if (grant.revokedAt) {
          throw new ORPCError('CONFLICT', {
            message: 'this support request is already closed',
            data: { code: 'grant_closed' },
          })
        }
        const now = new Date()
        const [row] = await tx
          .update(supportGrants)
          .set({
            revokedBy: actorId,
            revokedAt: now,
            revokeReason: input.reason ?? null,
            updatedAt: now,
          })
          .where(eq(supportGrants.id, grant.id))
          .returning()
        const saved = row ?? grant
        await writePlatformAudit(tx, {
          action: 'support.withdrawn',
          tenantId: saved.tenantId,
          payload: {
            grantId: saved.id,
            was: grant.approvedAt ? 'approved' : 'requested',
            now: statusOf(saved, now),
            reason: saved.revokeReason,
          },
        })
        return { item: await this.decorate(tx, saved) }
      })
    })
  }

  private async decorate(tx: Db, row: GrantRow): Promise<AdminSupportGrant> {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, row.tenantId)).limit(1)
    const names = await this.requesterNames(tx, [row])
    return {
      ...toSupportGrant(row, names.get(row.adminUserId) ?? 'Distribution OS support'),
      tenantId: row.tenantId,
      tenantSlug: tenant?.slug ?? '',
      tenantName: tenant?.legalName ?? '',
    }
  }

  /**
   * The names on the console's own cards. `users_visible` — "yourself, or somebody in your tenant" —
   * hides every other administrator from a console session, which holds no membership anywhere; the
   * SECURITY DEFINER function `dos_support_requester_names()` (migration 0037) answers a display name
   * for PLATFORM ADMINISTRATORS ONLY, and the join to `platform_admins` lives inside it where no
   * caller can drop it. Widening `users_visible` to get a name on a card would have opened the whole
   * users table to a predicate about support.
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

/** Requested, or approved and not yet closed: everything still live on our side. */
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
