import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type {
  AdminAuditList,
  AdminAuditListInput,
  AdminMembership,
  AdminMetrics,
  AdminUser,
  AdminUserDisableIn,
  AdminUserItem,
  AdminUsersList,
  AdminUsersListInput,
} from '@dos/contracts'
import type { z } from 'zod'
import {
  authSessions,
  memberships,
  platformAdmins,
  platformAudit,
  subscriptions,
  tenants,
  users,
  withSystem,
  type Db,
} from '@dos/db'
import { DB, platformIdempotent, requireDb } from '../../platform/index.js'
import { platformCounts } from './counts.js'
import { platformActorId, requireActiveAdmin, statusToWire, withPlatform } from './internals.js'

type UsersIn = z.infer<typeof AdminUsersListInput>
type AuditIn = z.infer<typeof AdminAuditListInput>

/** The window `activeUsers7d` counts over — a week, so "who logged in this week" is one number. */
const ACTIVE_WINDOW_DAYS = 7

/**
 * THE REST OF THE CONSOLE (module 13): the global identity directory, the platform's own numbers, and
 * the trail of everything our staff did.
 *
 * `users.list` is the ONE place in the product where "this phone buys from three distributors" is
 * visible. Every tenant-scoped surface is forbidden from revealing it — a salesperson must never learn
 * whether a phone exists in another distributor's network (docs/17 item 27), which is exactly why
 * `retailers.linkIdentity` is back-office only. The console is the other side of that rule: somebody
 * has to be able to answer "why can this person not sign in", and that somebody is us, on a screen
 * nobody at a distributorship can reach.
 *
 * `metrics.overview` answers COUNTS AND BYTES ONLY. Not one rupee of any distributor's turnover,
 * outstanding, cost or margin appears in its output shape, and the queries behind it (`counts.ts`)
 * cannot produce one — every SELECT there is a COUNT, a MAX or a SUM of file sizes.
 */
@Injectable()
export class PlatformConsoleService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /**
   * Global sign-in identities with every distributor they belong to. Runs under `withSystem` for the
   * same reason `admin.tenants.create` does: `users_visible` is "yourself, or somebody in your
   * tenant", and a console session is in no tenant, so under RLS it would read itself and nothing
   * else. What it returns is deliberately narrow — no password hash, no session, no address, no
   * business row — and it is the directory the console exists to have.
   */
  async listUsers(input: UsersIn): Promise<AdminUsersList> {
    const db = requireDb(this.db)
    await this.assertActive(db)
    return withSystem(db, async (tx) => {
      const q = input.q?.trim()
      const rows = await tx
        .selectDistinct({ user: users })
        .from(users)
        .leftJoin(memberships, eq(memberships.userId, users.id))
        .leftJoin(platformAdmins, eq(platformAdmins.userId, users.id))
        .where(
          and(
            q
              ? or(
                  ilike(users.username, `%${q}%`),
                  ilike(users.name, `%${q}%`),
                  ilike(users.phone, `%${q}%`),
                )
              : undefined,
            input.tenantId ? eq(memberships.tenantId, input.tenantId) : undefined,
            input.role ? eq(memberships.role, input.role) : undefined,
            input.status ? eq(users.status, input.status) : undefined,
            input.platformOnly ? isNull(platformAdmins.disabledAt) : undefined,
            input.platformOnly ? sql`${platformAdmins.id} is not null` : undefined,
            input.cursor ? sql`${users.id} > ${input.cursor}` : undefined,
          ),
        )
        .orderBy(asc(users.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit).map((r) => r.user)
      const ids = page.map((u) => u.id)
      // Sequentially, not `Promise.all`: `tx` is ONE node-postgres client inside a transaction, and
      // two queries in flight on the same client is a documented error ("client is already executing
      // a query"), not a speedup. Three indexed lookups on one page of users cost nothing.
      const links = await this.membershipsOf(tx, ids)
      const admins = await this.platformAdminIds(tx, ids)
      const lastLogins = await this.lastLogins(tx, ids)
      const last = page.at(-1)
      return {
        items: page.map((user) =>
          toAdminUser(
            user,
            links.get(user.id) ?? [],
            admins.has(user.id),
            lastLogins.get(user.id) ?? null,
          ),
        ),
        nextCursor: rows.length > input.limit && last ? last.id : null,
      }
    })
  }

  /**
   * The platform kill switch for ONE sign-in identity: the user is disabled and every live session is
   * revoked, so they are out of every distributor they belong to within seconds, not at the next token
   * expiry. Their memberships are left EXACTLY as they are — removing someone from a distributorship
   * is `tenancy.staff.setStatus`, and it belongs to that distributor's own owner, not to us.
   *
   * `withSystem` again, and for the sharpest version of the same reason: `users_self_update` is the
   * only UPDATE policy on `users` and it names the actor themselves. Nothing is deleted, `reason` is
   * mandatory, and the row in `platform_audit` says who did it and why.
   */
  async disableUser(input: AdminUserDisableIn): Promise<AdminUserItem> {
    const db = requireDb(this.db)
    const actorId = platformActorId()
    await this.assertActive(db)
    return withSystem(db, async (tx) => {
      const [target] = await tx.select().from(users).where(eq(users.id, input.id)).limit(1)
      if (!target) throw new ORPCError('NOT_FOUND', { message: `no user ${input.id}` })
      if (target.id === actorId) {
        throw new ORPCError('CONFLICT', {
          message: 'you cannot lock yourself out of the console; ask another super administrator',
        })
      }
      // The idempotency row needs a tenant that exists; a global identity has none of its own, so it
      // is filed against the first distributor this person belongs to, and against no key at all when
      // they belong to none (a platform account) — in which case the guard below is the idempotency:
      // disabling an already-disabled user is a no-op that returns the same row.
      const [firstMembership] = await tx
        .select({ tenantId: memberships.tenantId })
        .from(memberships)
        .where(eq(memberships.userId, input.id))
        .orderBy(asc(memberships.createdAt))
        .limit(1)
      const run = async (): Promise<AdminUserItem> => {
        const now = new Date()
        const [row] = await tx
          .update(users)
          .set({ status: 'disabled', updatedAt: now })
          .where(eq(users.id, input.id))
          .returning()
        await tx
          .update(authSessions)
          .set({ revokedAt: now, revokedReason: 'platform_disabled' })
          .where(and(eq(authSessions.userId, input.id), isNull(authSessions.revokedAt)))
        await tx.execute(sql`
          insert into platform_audit (id, admin_user_id, action, tenant_id, payload)
          values (gen_random_uuid()::text, ${actorId}, 'user.disabled', ${firstMembership?.tenantId ?? null},
                  ${JSON.stringify({ userId: input.id, username: target.username, reason: input.reason })}::jsonb)
        `)
        const saved = row ?? target
        const links = await this.membershipsOf(tx, [saved.id])
        const admins = await this.platformAdminIds(tx, [saved.id])
        const lastLogins = await this.lastLogins(tx, [saved.id])
        return {
          item: toAdminUser(
            saved,
            links.get(saved.id) ?? [],
            admins.has(saved.id),
            lastLogins.get(saved.id) ?? null,
          ),
        }
      }
      return firstMembership
        ? platformIdempotent(tx, firstMembership.tenantId, input.idempotencyKey, input, run)
        : run()
    })
  }

  /** How the platform as a whole is doing: counts, storage and two daily series ready to chart. */
  async metrics(input: { days: number }): Promise<AdminMetrics> {
    const db = requireDb(this.db)
    const tenantRows = await withPlatform(db, async (tx) => {
      await requireActiveAdmin(tx)
      return {
        byStatus: await tx
          .select({ status: tenants.status, n: sql<string>`count(*)` })
          .from(tenants)
          .groupBy(tenants.status),
        byPlan: await tx
          .select({ plan: tenants.plan, n: sql<string>`count(*)` })
          .from(tenants)
          .groupBy(tenants.plan),
        subs: await tx
          .select({ status: subscriptions.status, n: sql<string>`count(*)` })
          .from(subscriptions)
          .groupBy(subscriptions.status),
      }
    })
    const counts = await platformCounts(db, input.days)
    const statusCount = (name: string): number =>
      Number(tenantRows.byStatus.find((r) => r.status === name)?.n ?? 0)
    return {
      generatedAt: new Date().toISOString(),
      windowDays: input.days,
      tenants: {
        total: tenantRows.byStatus.reduce((sum, r) => sum + Number(r.n), 0),
        active: statusCount('active'),
        suspended: statusCount('suspended'),
        closed: statusCount('closed'),
      },
      tenantsByPlan: tenantRows.byPlan.map((r) => ({ plan: r.plan, count: Number(r.n) })),
      subscriptions: tenantRows.subs.map((r) => ({
        status: statusToWire(r.status),
        count: Number(r.n),
      })),
      activeUsers7d: counts.activeUsers7d,
      storage: { bytes: counts.storageBytes, objects: counts.storageObjects },
      series: { orders: counts.orders, invoices: counts.invoices },
      totals: {
        ordersInWindow: counts.orders.reduce((sum, p) => sum + p.value, 0),
        invoicesInWindow: counts.invoices.reduce((sum, p) => sum + p.value, 0),
      },
    }
  }

  /**
   * Everything our own staff did, newest first: onboarding, suspension, plan changes, support requests
   * and withdrawals, user locks, and one row per request made inside a distributor under an approved
   * support window. Append-only in the database (`platform_audit_append_only`), so this is a read of a
   * record, not of a mutable log.
   *
   * The shape is the tenant-side `AuditEntrySchema` plus the distributor, so the console's screen and
   * the owner app's `tenancy.audit.list` render with the same component. `entityType`/`entityId` come
   * out of the payload where the action put them, because `platform_audit` records an ACTION and its
   * payload rather than a before/after pair — the console changes state, it does not edit rows.
   */
  async audit(input: AuditIn): Promise<AdminAuditList> {
    const db = requireDb(this.db)
    return withPlatform(db, async (tx) => {
      await requireActiveAdmin(tx)
      const from = input.from ? new Date(`${input.from}T00:00:00+05:30`) : null
      const to = input.to ? new Date(`${input.to}T23:59:59.999+05:30`) : null
      const rows = await tx
        .select({ entry: platformAudit, tenant: tenants })
        .from(platformAudit)
        .leftJoin(tenants, eq(tenants.id, platformAudit.tenantId))
        .where(
          and(
            input.tenantId ? eq(platformAudit.tenantId, input.tenantId) : undefined,
            input.actorId ? eq(platformAudit.adminUserId, input.actorId) : undefined,
            input.action ? eq(platformAudit.action, input.action) : undefined,
            from ? gte(platformAudit.createdAt, from) : undefined,
            to ? lte(platformAudit.createdAt, to) : undefined,
            input.cursor ? sql`${platformAudit.id} < ${input.cursor}` : undefined,
          ),
        )
        .orderBy(desc(platformAudit.createdAt), desc(platformAudit.id))
        .limit(input.limit + 1)
      const page = rows.slice(0, input.limit)
      const last = page.at(-1)
      const items = page
        .map((r) => {
          const payload = (r.entry.payload ?? {}) as Record<string, unknown>
          const entityType = r.entry.action.split('.')[0] ?? 'platform'
          const entityId = pickId(payload) ?? r.entry.tenantId ?? r.entry.id
          return {
            id: r.entry.id,
            actorId: r.entry.adminUserId,
            actorRole: 'platform_admin',
            action: r.entry.action,
            entityType,
            entityId,
            before: null,
            after: payload,
            deviceId: null,
            occurredAt: r.entry.createdAt.toISOString(),
            tenantId: r.entry.tenantId,
            tenantSlug: r.tenant?.slug ?? null,
          }
        })
        .filter(
          (item) =>
            (!input.entityType || item.entityType === input.entityType) &&
            (!input.entityId || item.entityId === input.entityId),
        )
      return { items, nextCursor: rows.length > input.limit && last ? last.entry.id : null }
    })
  }

  /** One indexed lookup before any cross-tenant read: a closed console account reads nothing. */
  private async assertActive(db: Db): Promise<void> {
    await withPlatform(db, (tx) => requireActiveAdmin(tx))
  }

  private async membershipsOf(
    tx: Db,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, AdminMembership[]>> {
    const out = new Map<string, AdminMembership[]>()
    if (userIds.length === 0) return out
    const rows = await tx
      .select({ membership: memberships, tenant: tenants })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(inArray(memberships.userId, [...userIds]))
      .orderBy(asc(memberships.createdAt))
    for (const row of rows) {
      const list = out.get(row.membership.userId) ?? []
      list.push({
        tenantId: row.tenant.id,
        tenantSlug: row.tenant.slug,
        tenantName: row.tenant.legalName,
        role: row.membership.role,
        status: row.membership.status,
      })
      out.set(row.membership.userId, list)
    }
    return out
  }

  private async platformAdminIds(tx: Db, userIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (userIds.length === 0) return new Set()
    const rows = await tx
      .select({ userId: platformAdmins.userId })
      .from(platformAdmins)
      .where(and(inArray(platformAdmins.userId, [...userIds]), isNull(platformAdmins.disabledAt)))
    return new Set(rows.map((r) => r.userId))
  }

  /**
   * `users` has no `last_login_at` column, and adding one would mean a write on every sign-in for a
   * figure only this screen reads. `auth_events` already records every successful sign-in, so the
   * answer is a MAX over an indexed `(user_id, created_at)` — the same trick the console's own
   * `activeUsers7d` uses.
   */
  private async lastLogins(
    tx: Db,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, Date | null>> {
    const out = new Map<string, Date | null>()
    if (userIds.length === 0) return out
    const rows = await tx.execute<{ user_id: string; at: Date | string }>(sql`
      select user_id, max(created_at) as at from auth_events
      where kind = 'login_ok' and user_id = any(${sql.param([...userIds])}::text[])
      group by user_id
    `)
    // `tx.execute` hands back what the driver parsed; an aggregate over a timestamptz can arrive as a
    // string rather than a Date depending on the type parser, so it is normalised here once.
    for (const row of rows.rows) out.set(row.user_id, row.at ? new Date(row.at) : null)
    return out
  }
}

function pickId(payload: Record<string, unknown>): string | null {
  for (const key of ['grantId', 'userId', 'subscriptionId', 'ownerUserId']) {
    const value = payload[key]
    if (typeof value === 'string') return value
  }
  return null
}

function toAdminUser(
  row: typeof users.$inferSelect,
  links: AdminMembership[],
  isPlatformAdmin: boolean,
  lastLoginAt: Date | null,
): AdminUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    phone: row.phone,
    locale: row.locale,
    status: row.status,
    platformRole: isPlatformAdmin ? 'platform_admin' : null,
    mustChangePassword: row.mustChangePassword,
    lockedUntil: row.lockedUntil?.toISOString() ?? null,
    lastLoginAt: lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    memberships: links,
  }
}

/** The window `activeUsers7d` counts over; exported so the spec asserts on the same number. */
export { ACTIVE_WINDOW_DAYS }
