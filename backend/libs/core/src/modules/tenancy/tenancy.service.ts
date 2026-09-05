import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type {
  MeOutput,
  MembershipRole,
  StaffCreateIn,
  StaffCreateOut,
  StaffList,
  StaffMember,
  StaffOk,
  StaffSetPasswordIn,
  StaffSetStatusIn,
  StaffUpdateIn,
} from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  authEvents,
  authSessions,
  hashPassword,
  memberships,
  normalizeUsername,
  tenants,
  users,
  validatePassword,
  validateUsername,
  withSystem,
  withTenant,
  type ActorRole,
  type Db,
} from '@dos/db'
import {
  currentTenant,
  DB,
  idempotent,
  requireDb,
  requireRole,
  writeAudit,
} from '../../platform/index.js'

/** Who may read the staff list: the desk. A rep must not enumerate the people of the business. */
const BACK_OFFICE: readonly ActorRole[] = ['owner', 'manager', 'accountant', 'system']

/** Who may hire, reset a password or disable a membership (docs/17 item 27). */
const ONBOARDERS: readonly ActorRole[] = ['owner', 'manager', 'system']

/**
 * A manager runs the floor, so it may administer the people who work under it — never the desk and
 * never another manager, which would be a quiet escalation to the owner's powers.
 */
const MANAGER_MAY_ADMINISTER: readonly MembershipRole[] = ['salesperson', 'warehouse', 'delivery']

@Injectable()
export class TenancyService {
  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  /** Resolves the caller's user, tenant and membership inside the tenant-scoped transaction. */
  async me(): Promise<MeOutput | null> {
    if (!this.db) return null
    const ctx = currentTenant()
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx
        .select({ user: users, tenant: tenants, membership: memberships })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ctx.actorId)))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      return {
        user: {
          id: row.user.id,
          username: row.user.username,
          phone: row.user.phone,
          name: row.user.name,
          locale: row.user.locale as 'en-IN' | 'hi-IN' | 'mr-IN',
        },
        tenant: {
          id: row.tenant.id,
          slug: row.tenant.slug,
          legalName: row.tenant.legalName,
          gstin: row.tenant.gstin,
          stateCode: row.tenant.stateCode,
          plan: row.tenant.plan,
          status: row.tenant.status,
        },
        membership: {
          id: row.membership.id,
          tenantId: row.membership.tenantId,
          userId: row.membership.userId,
          role: row.membership.role,
          status: row.membership.status,
        },
      }
    })
  }

  /**
   * The people who work in this distributor. Retailer memberships are deliberately left out: a shop
   * arrives through `retailers.linkIdentity`, there can be thousands of them, and this list is
   * unpaginated on purpose (a distributor has tens of staff, not lakhs).
   */
  async listStaff(): Promise<StaffList> {
    requireRole(BACK_OFFICE)
    const db = requireDb(this.db)
    const ctx = currentTenant()
    const rows = await withTenant(db, ctx, (tx) =>
      tx
        .select({
          userId: users.id,
          username: users.username,
          name: users.name,
          phone: users.phone,
          role: memberships.role,
          status: memberships.status,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, ctx.tenantId), ne(memberships.role, 'retailer')))
        .orderBy(users.name),
    )
    const lastLogins = await this.lastLoginAt(
      db,
      ctx.tenantId,
      rows.map((r) => r.userId),
    )
    const items: StaffMember[] = rows.map((row) => ({
      userId: row.userId,
      username: row.username,
      name: row.name,
      phone: row.phone,
      role: row.role,
      status: row.status,
      lastLoginAt: lastLogins.get(row.userId) ?? null,
    }))
    return { items }
  }

  /**
   * Hire someone and hand them a temporary password they must replace at first sign-in.
   *
   * Users are global (ADR 0006): the same person may already exist because another distributor hired
   * them, and RLS hides that row from this tenant. The lookup-or-create therefore runs as the system
   * role and never overwrites an existing person's name or password — only the membership is added.
   */
  async createStaff(input: StaffCreateIn): Promise<StaffCreateOut> {
    requireRole(ONBOARDERS)
    const ctx = currentTenant()
    assertMayAdminister(ctx.actorRole, input.role)
    const username = normalizeUsername(input.username)
    const badUsername = validateUsername(username)
    if (badUsername) throw new ORPCError('BAD_REQUEST', { message: badUsername })
    const badPassword = validatePassword(input.temporaryPassword)
    if (badPassword) throw new ORPCError('BAD_REQUEST', { message: badPassword })
    const db = requireDb(this.db)

    const userId = await withSystem(db, async (tx) => {
      const found = await tx
        .select({ id: users.id })
        .from(users)
        .where(or(eq(users.username, username), eq(users.phone, input.phone)))
        .limit(2)
      if (found.length > 1) {
        throw new ORPCError('CONFLICT', {
          message: 'That username and that phone number belong to two different people',
        })
      }
      const existing = found[0]
      if (existing) return existing.id
      const passwordHash = await hashPassword(input.temporaryPassword)
      try {
        await tx.insert(users).values({
          id: input.userId,
          phone: input.phone,
          name: input.name,
          locale: input.locale ?? 'hi-IN',
          username,
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: true,
          status: 'active',
        })
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ORPCError('CONFLICT', {
            message: 'That username or phone number is already taken',
          })
        }
        throw err
      }
      return input.userId
    })

    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const [already] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)))
        if (already) {
          throw new ORPCError('CONFLICT', {
            message: 'This person is already a member of this distributor',
          })
        }
        await tx.insert(memberships).values({
          id: input.id,
          tenantId: ctx.tenantId,
          userId,
          role: input.role,
          status: 'active',
        })
        return { userId, membershipId: input.id, mustChangePassword: true as const }
      }),
    )
  }

  /**
   * Edit a staff member's profile (docs/23 §8.13 `staff.update`): name, phone, locale — never the
   * role (disable and re-create) and never a credential. `users` is global and `users_self_update`
   * only lets a person edit itself under app_rw, so the write escalates once the membership and the
   * manager's remit have been checked inside the tenant transaction. A phone is unique platform-wide.
   */
  async updateStaff(input: StaffUpdateIn): Promise<StaffOk> {
    requireRole(ONBOARDERS)
    const ctx = currentTenant()
    const db = requireDb(this.db)
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const target = await loadMember(tx, ctx.tenantId, input.userId)
        assertMayAdminister(ctx.actorRole, target.role)
        const [before] = await tx
          .select({ name: users.name, phone: users.phone, locale: users.locale })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1)
        if (!before) throw new ORPCError('NOT_FOUND', { message: 'user not found' })
        const patch = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
        }
        try {
          await withSystem(db, (sys) =>
            sys
              .update(users)
              .set({ ...patch, updatedAt: new Date() })
              .where(eq(users.id, input.userId)),
          )
        } catch (err) {
          if (isUniqueViolation(err))
            throw new ORPCError('CONFLICT', {
              message: 'That phone number belongs to another person',
            })
          throw err
        }
        await writeAudit(tx, {
          action: 'staff.update',
          entityType: 'user',
          entityId: input.userId,
          before,
          after: { ...before, ...patch },
        })
        return { ok: true as const }
      }),
    )
  }

  /**
   * Reset a staff password (they forgot it, or the phone was lost). Clears the lockout counter, forces
   * a change at next sign-in and signs the person out everywhere, so a stolen refresh token dies here.
   */
  async setStaffPassword(input: StaffSetPasswordIn): Promise<StaffOk> {
    requireRole(ONBOARDERS)
    const ctx = currentTenant()
    const badPassword = validatePassword(input.temporaryPassword)
    if (badPassword) throw new ORPCError('BAD_REQUEST', { message: badPassword })
    const db = requireDb(this.db)
    const passwordHash = await hashPassword(input.temporaryPassword)
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const target = await loadMember(tx, ctx.tenantId, input.userId)
        assertMayAdminister(ctx.actorRole, target.role)
        // users / auth_sessions / auth_events are global tables an admin cannot write for someone
        // else under app_rw (users_self_update, auth_sessions_own), so the credential work escalates.
        await withSystem(db, async (sys) => {
          const now = new Date()
          await sys
            .update(users)
            .set({
              passwordHash,
              passwordChangedAt: now,
              mustChangePassword: true,
              failedLoginCount: 0,
              lockedUntil: null,
              updatedAt: now,
            })
            .where(eq(users.id, input.userId))
          await sys
            .update(authSessions)
            .set({ revokedAt: now, revokedReason: 'password_reset' })
            .where(and(eq(authSessions.userId, input.userId), isNull(authSessions.revokedAt)))
          await sys.insert(authEvents).values({
            id: uuidv7(),
            userId: input.userId,
            tenantId: ctx.tenantId,
            kind: 'password_set_by_admin',
          })
        })
        return { ok: true as const }
      }),
    )
  }

  /**
   * Enable or disable a membership. The user row itself stays untouched — the person may still work
   * for another distributor — but their sessions for THIS tenant are revoked immediately.
   */
  async setStaffStatus(input: StaffSetStatusIn): Promise<StaffOk> {
    requireRole(ONBOARDERS)
    const ctx = currentTenant()
    const db = requireDb(this.db)
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const target = await loadMember(tx, ctx.tenantId, input.userId)
        assertMayAdminister(ctx.actorRole, target.role)
        if (input.status === 'disabled' && target.role === 'owner') {
          const activeOwners = await tx
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(
              and(
                eq(memberships.tenantId, ctx.tenantId),
                eq(memberships.role, 'owner'),
                eq(memberships.status, 'active'),
              ),
            )
          if (activeOwners.length <= 1) {
            throw new ORPCError('CONFLICT', {
              message: 'The last active owner cannot be disabled',
            })
          }
        }
        // Checked after the owner rule so a sole owner locking themselves out gets the real reason.
        if (input.userId === ctx.actorId) {
          throw new ORPCError('FORBIDDEN', {
            message: 'You cannot change your own membership status',
          })
        }
        await tx
          .update(memberships)
          .set({ status: input.status, updatedAt: new Date() })
          .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, input.userId)))
        if (input.status === 'disabled') {
          await withSystem(db, async (sys) => {
            const now = new Date()
            const revoked = await sys
              .update(authSessions)
              .set({ revokedAt: now, revokedReason: 'membership_disabled' })
              .where(
                and(
                  eq(authSessions.userId, input.userId),
                  eq(authSessions.tenantId, ctx.tenantId),
                  isNull(authSessions.revokedAt),
                ),
              )
              .returning({ id: authSessions.id })
            if (revoked.length > 0) {
              await sys.insert(authEvents).values({
                id: uuidv7(),
                userId: input.userId,
                tenantId: ctx.tenantId,
                kind: 'session_revoked',
              })
            }
          })
        }
        return { ok: true as const }
      }),
    )
  }

  /**
   * Last successful sign-in per user for this tenant. `auth_events` is readable only by its own user
   * (or the system role), so this one read escalates instead of joining inside the tenant query.
   */
  private async lastLoginAt(
    db: Db,
    tenantId: string,
    userIds: readonly string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    if (userIds.length === 0) return map
    const rows = await withSystem(db, (tx) =>
      tx
        .select({
          userId: authEvents.userId,
          at: sql<Date | string | null>`max(${authEvents.createdAt})`,
        })
        .from(authEvents)
        .where(
          and(
            eq(authEvents.kind, 'login_ok'),
            eq(authEvents.tenantId, tenantId),
            inArray(authEvents.userId, [...userIds]),
          ),
        )
        .groupBy(authEvents.userId),
    )
    for (const row of rows) {
      const iso = toIso(row.at)
      if (row.userId && iso) map.set(row.userId, iso)
    }
    return map
  }
}

async function loadMember(
  tx: Db,
  tenantId: string,
  userId: string,
): Promise<{ id: string; role: MembershipRole; status: 'invited' | 'active' | 'disabled' }> {
  const [row] = await tx
    .select({ id: memberships.id, role: memberships.role, status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
  if (!row) {
    throw new ORPCError('NOT_FOUND', {
      message: 'That person is not a member of this distributor',
    })
  }
  return row
}

function assertMayAdminister(actorRole: ActorRole, targetRole: MembershipRole): void {
  if (actorRole !== 'manager') return
  if (!MANAGER_MAY_ADMINISTER.includes(targetRole)) {
    throw new ORPCError('FORBIDDEN', {
      message: `A manager may only administer ${MANAGER_MAY_ADMINISTER.join(', ')} members`,
    })
  }
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23505' || e.cause?.code === '23505'
}
