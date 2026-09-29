import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import type {
  MeOutput,
  MembershipRole,
  MembershipUpdateIn,
  StaffCreateIn,
  StaffCreateOut,
  StaffList,
  StaffMember,
  StaffOk,
  StaffSetPasswordIn,
  StaffSetStatusIn,
  StaffUpdateIn,
} from '@dos/contracts'
import { isGrantableExtraRole } from '@dos/domain'
import {
  authEvents,
  memberships,
  platformAdmins,
  tenants,
  users,
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
  withoutSecrets,
  writeAudit,
} from '../../platform/index.js'
import {
  checkedUsername,
  firstPasswordHash,
  freeUsername,
  isUniqueViolation,
  isUsable,
  noteFirstPassword,
  revokeTenantSessions,
  setFirstPassword,
  signInById,
  signInByPhone,
} from './credentials.js'

/** DOS-400: the person behind a shop's sign-in, as `retailers.signIn.give` asks for it. */
export interface ShopLoginRequest {
  tenantId: string
  /** The shop's mobile: a person is one user across the platform, known by it. */
  phone: string
  /** The name a new user is given, and the seed of a username made for it. */
  name: string
  /** The desk's choice; omitted = made from `name`. */
  username: string | undefined
  /** The client-generated id a NEW user takes. */
  userId: string
  /** The first password's argon2id hash (never the password). */
  passwordHash: string
  /** The login the shop's platform identity already names, which is the shopkeeper whoever linked it. */
  knownUserId: string | null
}

export interface ShopLogin {
  userId: string
  username: string
  /** True when this call (or an earlier attempt of the same request) gave the person its first password. */
  made: boolean
}

/** Said to the desk when the phone is one of its own people: nothing it does not already know. */
const STAFF_PHONE =
  'This mobile number belongs to someone who works for you. A shop needs its own mobile number to sign in.'
/** A console account holds no membership anywhere; the desk is told only to use another number. */
const NOT_A_SHOP_PHONE =
  'This mobile number cannot be given a shop sign-in. Use the shopkeeper’s own mobile number.'
/**
 * A new first password would open every business the login is used with, not only this one: a desk
 * that could reset it could sign in as the shopkeeper at another distributor, or as that distributor's
 * own staff. Only the shopkeeper changes it then. Says nothing about which business.
 */
const NOT_YOURS_ALONE =
  'This sign-in is not yours alone to reset: the shopkeeper also uses it with another business. Only the shopkeeper can change its password.'

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
          extraRoles: memberships.extraRoles,
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
      extraRoles: row.extraRoles.filter(isGrantableExtraRole),
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
    const username = checkedUsername(input.username)
    const passwordHash = await firstPasswordHash(input.temporaryPassword)
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

    // DOS-400: the key is filed WITHOUT the temporary password (see `withoutSecrets`); the reply never
    // carried one, so a replay cannot give it back, and now the stored request hash cannot either.
    return withTenant(db, ctx, (tx) =>
      idempotent(
        tx,
        input.idempotencyKey,
        withoutSecrets(input, ['temporaryPassword']),
        async () => {
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
        },
      ),
    )
  }

  /**
   * Edit a staff member's profile (docs/23 §8.13 `staff.update`): name, phone, locale — never the
   * role (disable and re-create) and never a credential. `users` is global and `users_self_update`
   * only lets a person edit itself under app_rw, so the write escalates once the membership and the
   * manager's remit have been checked inside the tenant transaction. A phone is unique platform-wide.
   */
  /**
   * THE EXTRA ROLES on one membership (docs/29 §2, founder 2026-09-21) — what this login may ALSO
   * sign in as, so the warehouse man who delivers on Tuesdays opens the delivery app with his own
   * username instead of borrowing the owner's.
   *
   * The whole set is sent, so `[]` takes every one away. Three narrowings, none of which the schema
   * alone can make: only the four staff roles may CARRY extras (the desk already elects downward from
   * the fixed table, and a shopkeeper never elects anything); a manager may hand out only the three
   * roles it already administers; and a manager may still only touch the people it already
   * administers. Taking a role away bites at the person's next refresh, which re-checks the election.
   */
  async updateMembership(input: MembershipUpdateIn): Promise<StaffOk> {
    requireRole(ONBOARDERS)
    const ctx = currentTenant()
    const db = requireDb(this.db)
    return withTenant(db, ctx, (tx) =>
      idempotent(tx, input.idempotencyKey, input, async () => {
        const target = await loadMember(tx, ctx.tenantId, input.userId)
        assertMayAdminister(ctx.actorRole, target.role)
        if (!isGrantableExtraRole(target.role)) {
          throw new ORPCError('FORBIDDEN', {
            message: `${target.role === 'owner' ? 'An' : 'A'} ${target.role} membership carries no extra roles: it already signs in downward from its own role.`,
          })
        }
        // The membership's own role is not an "extra": keeping it out means the column always reads
        // as the list of OTHER jobs this person may do.
        const next = [...new Set(input.extraRoles)].filter((r) => r !== target.role)
        const [before] = await tx
          .select({ extraRoles: memberships.extraRoles })
          .from(memberships)
          .where(eq(memberships.id, target.id))
          .limit(1)
        const held: readonly string[] = before?.extraRoles ?? []
        if (ctx.actorRole === 'manager') {
          // A manager's remit is the DELTA, not the submitted set. The whole set is sent every time,
          // so a rep the OWNER gave `accountant` to carries it in every manager save; judging the set
          // refused all of them, naming a role the manager never touched. Stripping it in the app
          // would have been worse — a silent revocation of the owner's grant. So compare what
          // actually moved: the manager may add and take away only the three roles it administers,
          // and an owner's grant it does not touch passes through untouched.
          const touched = [...new Set([...held, ...next])].filter(
            (r) => held.includes(r) !== (next as readonly string[]).includes(r),
          )
          const beyond = touched.filter(
            (r) => !(MANAGER_MAY_ADMINISTER as readonly string[]).includes(r),
          )
          if (beyond.length > 0) {
            throw new ORPCError('FORBIDDEN', {
              message: `A manager may only grant ${MANAGER_MAY_ADMINISTER.join(', ')}. Ask the owner for ${beyond.join(', ')}.`,
            })
          }
        }
        await tx
          .update(memberships)
          .set({ extraRoles: next, updatedAt: new Date() })
          .where(eq(memberships.id, target.id))
        await writeAudit(tx, {
          action: 'membership.extraRoles',
          entityType: 'membership',
          entityId: target.id,
          before: { extraRoles: held },
          after: { extraRoles: next },
        })
        return { ok: true as const }
      }),
    )
  }

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
    const passwordHash = await firstPasswordHash(input.temporaryPassword)
    const db = requireDb(this.db)
    return withTenant(db, ctx, (tx) =>
      idempotent(
        tx,
        input.idempotencyKey,
        withoutSecrets(input, ['temporaryPassword']),
        async () => {
          const target = await loadMember(tx, ctx.tenantId, input.userId)
          assertMayAdminister(ctx.actorRole, target.role)
          // users / auth_sessions / auth_events are global tables an admin cannot write for someone
          // else under app_rw (users_self_update, auth_sessions_own), so the credential work escalates.
          await withSystem(db, (sys) =>
            setFirstPassword(sys, { userId: input.userId, tenantId: ctx.tenantId, passwordHash }),
          )
          return { ok: true as const }
        },
      ),
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
          await withSystem(db, (sys) =>
            revokeTenantSessions(sys, { userId: input.userId, tenantId: ctx.tenantId }),
          )
        }
        return { ok: true as const }
      }),
    )
  }

  // ------------------------------------------------------------------------------------------------
  // THE SHOPKEEPER'S LOGIN (DOS-400, architect's ruling 2026-09-29). `retailers.signIn.*` owns the shop
  // and its link and calls these for what tenancy owns: the person's sign-in and the membership. The
  // login is made exactly as `createStaff` makes a staff login (`./credentials.ts`).

  /** The password rules every login shares (a 400 naming the rule), then its argon2id hash. */
  hashFirstPassword(plain: string): Promise<string> {
    return firstPasswordHash(plain)
  }

  /**
   * The person a shop's sign-in belongs to: the login the shop's platform identity already names, or
   * the user with the shop's phone, or a NEW user made with a username and the first password. A person
   * who already signs in is NEVER given a new user or a new password. Runs as the system role, because
   * users are global and RLS hides a person this distributor has never met; the caller learns only the
   * username and whether a first password was set, never where else the person is known.
   */
  async shopLogin(input: ShopLoginRequest): Promise<ShopLogin> {
    const db = requireDb(this.db)
    const wanted = input.username === undefined ? null : checkedUsername(input.username)
    return withSystem(db, async (sys) => {
      const known = input.knownUserId === null ? null : await signInById(sys, input.knownUserId)
      const person = known ?? (await signInByPhone(sys, input.phone))
      if (person) {
        await refuseForeignSeat(sys, input.tenantId, person.id)
        // Already signs in: this shop joins that person's list. `made` stays true for an earlier
        // attempt of the SAME request that made the user and then failed before its reply.
        if (isUsable(person)) {
          return { userId: person.id, username: person.username, made: person.id === input.userId }
        }
        // On the platform but unable to sign in (no username or no password): nothing usable is
        // overwritten by giving it the first password, and the answer reads exactly like a new user.
        const username =
          person.username ?? wanted ?? (await freeUsername(sys, input.name, input.phone))
        await giveCredentials(sys, person.id, username, input.passwordHash)
        await noteFirstPassword(sys, { userId: person.id, tenantId: input.tenantId })
        return { userId: person.id, username, made: true }
      }
      const username = wanted ?? (await freeUsername(sys, input.name, input.phone))
      try {
        // Savepoint: a unique violation must not abort the system transaction.
        await sys.transaction(async (sp) => {
          await sp.insert(users).values({
            id: input.userId,
            phone: input.phone,
            name: input.name,
            locale: 'hi-IN',
            username,
            passwordHash: input.passwordHash,
            passwordChangedAt: new Date(),
            mustChangePassword: true,
            status: 'active',
          })
        })
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        // Somebody signed the same phone up a moment ago: that person is the shopkeeper.
        const racing = await signInByPhone(sys, input.phone)
        if (racing && isUsable(racing)) {
          await refuseForeignSeat(sys, input.tenantId, racing.id)
          return { userId: racing.id, username: racing.username, made: false }
        }
        throw new ORPCError('CONFLICT', {
          message:
            wanted === null
              ? 'Could not make a sign-in for this shop just now. Try again.'
              : 'That username is taken. Choose another.',
        })
      }
      await noteFirstPassword(sys, { userId: input.userId, tenantId: input.tenantId })
      return { userId: input.userId, username, made: true }
    })
  }

  /**
   * This distributor's shopkeeper membership for the login, inside the caller's tenant transaction:
   * made, or switched back on after a stop. One membership per person per distributor, so a second
   * shop of the same shopkeeper adds nothing here; a person who WORKS here cannot also be a shop here.
   */
  async joinAsShop(
    tx: Db,
    input: { tenantId: string; userId: string; membershipId: string },
  ): Promise<void> {
    const [row] = await tx
      .select({ id: memberships.id, role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, input.userId)))
      .limit(1)
    if (!row) {
      await tx.insert(memberships).values({
        id: input.membershipId,
        tenantId: input.tenantId,
        userId: input.userId,
        role: 'retailer',
        status: 'active',
      })
      return
    }
    if (row.role !== 'retailer') throw new ORPCError('CONFLICT', { message: STAFF_PHONE })
    if (row.status !== 'active') {
      await tx
        .update(memberships)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(memberships.id, row.id))
    }
  }

  /**
   * The login no longer signs in to this distributor as a shop — its LAST shop here was stopped: the
   * membership is switched off and its sessions HERE are revoked, as `setStaffStatus` does for staff.
   * The person, its password and its other distributors are untouched.
   */
  async leaveAsShop(tx: Db, input: { tenantId: string; userId: string }): Promise<void> {
    const db = requireDb(this.db)
    await tx
      .update(memberships)
      .set({ status: 'disabled', updatedAt: new Date() })
      .where(
        and(
          eq(memberships.tenantId, input.tenantId),
          eq(memberships.userId, input.userId),
          eq(memberships.role, 'retailer'),
        ),
      )
    await withSystem(db, (sys) => revokeTenantSessions(sys, input))
  }

  /**
   * A new first password for a shop's login, as `setStaffPassword` gives staff one — but only when this
   * distributor is the ONLY place the login is used. A person who also signs in with another business
   * (as its shopkeeper or its staff) or to the platform console changes its own password: a desk that
   * could reset it could sign in as that person there.
   */
  async resetShopPassword(input: {
    tenantId: string
    userId: string
    passwordHash: string
  }): Promise<void> {
    const db = requireDb(this.db)
    await withSystem(db, async (sys) => {
      const [elsewhere] = await sys
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, input.userId), ne(memberships.tenantId, input.tenantId)))
        .limit(1)
      const [consoleSeat] = await sys
        .select({ id: platformAdmins.id })
        .from(platformAdmins)
        .where(eq(platformAdmins.userId, input.userId))
        .limit(1)
      if (elsewhere || consoleSeat) throw new ORPCError('CONFLICT', { message: NOT_YOURS_ALONE })
      await setFirstPassword(sys, input)
    })
  }

  /**
   * Which of these logins sign in here as a shop right now, and with which username: an ACTIVE
   * shopkeeper membership of this distributor and a username. Read under the caller's own role.
   */
  async shopUsernames(
    tx: Db,
    tenantId: string,
    userIds: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const ids = [...new Set(userIds)]
    if (ids.length === 0) return out
    const rows = await tx
      .select({ userId: users.id, username: users.username })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          inArray(memberships.userId, ids),
          eq(memberships.role, 'retailer'),
          eq(memberships.status, 'active'),
        ),
      )
    for (const row of rows) if (row.username !== null) out.set(row.userId, row.username)
    return out
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

/**
 * DOS-400: a shop's sign-in may not be a seat the person already holds for another reason. A console
 * account holds no membership anywhere by design; a person who works for THIS distributor signs in
 * here as staff and cannot also be one of its shops (one membership per person per distributor). The
 * second sentence tells the desk only about its own people.
 */
async function refuseForeignSeat(sys: Db, tenantId: string, userId: string): Promise<void> {
  const [consoleSeat] = await sys
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1)
  if (consoleSeat) throw new ORPCError('CONFLICT', { message: NOT_A_SHOP_PHONE })
  const [staff] = await sys
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.userId, userId),
        ne(memberships.role, 'retailer'),
      ),
    )
    .limit(1)
  if (staff) throw new ORPCError('CONFLICT', { message: STAFF_PHONE })
}

/** A username and a first password for a person on the platform who has no way to sign in yet. */
async function giveCredentials(
  sys: Db,
  userId: string,
  username: string,
  passwordHash: string,
): Promise<void> {
  const now = new Date()
  try {
    await sys.transaction(async (sp) => {
      await sp
        .update(users)
        .set({
          username,
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(users.id, userId))
    })
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ORPCError('CONFLICT', { message: 'That username is taken. Choose another.' })
    throw err
  }
}
