import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import {
  SHOP_SIGN_IN_CODES,
  type MeOutput,
  type MembershipRole,
  type MembershipUpdateIn,
  type StaffCreateIn,
  type StaffCreateOut,
  type StaffList,
  type StaffMember,
  type StaffOk,
  type StaffSetPasswordIn,
  type StaffSetStatusIn,
  type StaffUpdateIn,
} from '@dos/contracts'
import { isGrantableExtraRole } from '@dos/domain'
import {
  authEvents,
  memberships,
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
  pgConstraint,
  requireDb,
  requireRole,
  withoutSecrets,
  writeAudit,
} from '../../platform/index.js'
import {
  checkedUsername,
  firstPasswordHash,
  freeUsername,
  usedElsewhere,
  isUniqueViolation,
  isUsable,
  madeByThemselves,
  noteFirstPassword,
  refuseIfShared,
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
  /** The desk typed this number in the dialog, and it is not the shop's own mobile (yet). */
  phoneTyped: boolean
}

export interface ShopLogin {
  userId: string
  username: string
  /** True when this call (or an earlier attempt of the same request) gave the person its first password. */
  made: boolean
  /** The person signs in with a password they chose, not one a desk gave (`must_change_password` false). */
  passwordChosen: boolean
}

/** Said to the desk when the phone is one of its own people: nothing it does not already know. */
const STAFF_PHONE =
  'This mobile number belongs to someone who works for you. A shop needs its own mobile number to sign in.'
/**
 * A number whose sign-in another business made — another distributor's shopkeeper or staff, or a
 * console account (architect's ruling of 2026-09-29, docs/22 §8, R1). One sentence for all three, and
 * the same work to reach it, so the desk learns nothing about where the number is known; it is told
 * what it can do. Until a phone can be proven (sign-in by OTP), a sign-in is never shared between
 * businesses on the strength of a number: whoever made it may still know its first password.
 */
const SHARED_NUMBER =
  'This mobile number already has a Distribution OS sign-in, which cannot be shared yet. Enter another mobile number of the shopkeeper; it will be saved as the shop’s mobile number.'
/** The same, when the number is one the desk typed in the dialog (the shop had none, or it was this one). */
const SHARED_NUMBER_TYPED =
  'This mobile number already has a Distribution OS sign-in, which cannot be shared yet. Enter another mobile number of the shopkeeper.'
/**
 * R3: a person who also belongs to another business keeps the name and the mobile number they have.
 * Nothing about which business; the membership here (role, on or off, beat) is still the desk's.
 */
const NOT_YOURS_ALONE_PROFILE =
  'This person also signs in with another business, so their name and mobile number cannot be changed here. They stay as they are.'
/**
 * Two desks gave the same new number a sign-in at the same moment: whichever person was made first,
 * this request does not attach to it blind. The next try reads it as it is.
 */
const TRY_AGAIN = 'Could not make a sign-in for this shop just now. Try again.'
/**
 * A new first password would open every business the login is used with, not only this one: a desk
 * that could reset it could sign in as the shopkeeper at another distributor, or as that distributor's
 * own staff. Only the shopkeeper changes it then. Says nothing about which business.
 */
const NOT_YOURS_ALONE =
  'This sign-in is not yours alone to reset: the shopkeeper also uses it with another business. Only the shopkeeper can change its password.'
/**
 * The shopkeeper's own account (founder, 2026-09-29): the person made this sign-in themselves, and its password is
 * nobody else's. The desk approved this person's request to join, so it already knows this much and learns nothing.
 */
const THEIR_OWN_SIGN_IN =
  'This shopkeeper made their own sign-in, so only they can change its password. They can reset it from the sign-in screen.'
/**
 * The desk gives a shop's sign-in on a number whose account the shopkeeper made themselves and joined to another of
 * this distributor's shops: a distributor is added to a shopkeeper's account by the shopkeeper's request, never by a
 * desk. Said only when the person is already this distributor's shopkeeper, so it tells the desk nothing new.
 */
const ASK_FROM_THEIR_APP =
  'This mobile number is a shopkeeper’s own sign-in. They can ask to join this shop from their app, with the shop code printed on its bill.'
/** The same refusal on the staff screen, for anybody who is not one of this distributor's shops. */
const NOT_YOURS_ALONE_STAFF =
  'This sign-in is not yours alone to reset: this person also uses it with another business. Only they can change its password.'
/**
 * The hire door (`tenancy.staff.create`) under the same ruling (R1, docs/22 §8, QA DOS-424): a mobile
 * number or a username whose sign-in was made at another business — another distributor's staff or
 * shopkeeper, or a console account — gets no membership here, because whoever made that sign-in may
 * still know its first password. One sentence for the number and one for the username, each the same
 * whatever the other business is; nothing about where. The desk is told what it can do.
 */
const HIRE_SHARED_PHONE =
  'This mobile number already has a Distribution OS sign-in, which cannot be shared yet. Enter another mobile number for this person.'
const HIRE_SHARED_USERNAME =
  'This username already has a Distribution OS sign-in, which cannot be shared yet. Choose another username.'
/**
 * A membership id the app sent is already a row (the app makes a new one for every form, so this is
 * a request sent twice with its content changed, never a desk's mistake). Nothing is saved.
 */
const REPEATED_REQUEST =
  'This could not be saved: it repeats an earlier request. Close this and try again.'

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
   * Users are global (ADR 0006), and RLS hides a person this tenant has never met, so the lookup runs
   * as the system role. It never overwrites an existing person's name or password. A person found by
   * the username or the phone whom another business or the console holds is refused before anything
   * is written (R1 at the hire door, QA DOS-424, `refuseSharedHire`).
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
        .select({
          id: users.id,
          phone: users.phone,
          username: users.username,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(or(eq(users.username, username), eq(users.phone, input.phone)))
        .limit(2)
      if (found.length > 1) {
        throw new ORPCError('CONFLICT', {
          message: 'That username and that phone number belong to two different people',
        })
      }
      const existing = found[0]
      if (existing) {
        await refuseSharedHire(tx, {
          tenantId: ctx.tenantId,
          person: existing,
          byPhone: existing.phone === input.phone,
          requestUserId: input.userId,
        })
        return existing.id
      }
      // Before the person is made: a clashing membership id used to make them, then fail as a 500
      // and leave them behind. (A replay of this very hire finds the person above and never gets here.)
      if (await membershipIdTaken(tx, input.id)) {
        throw new ORPCError('CONFLICT', { message: REPEATED_REQUEST })
      }
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
          await insertMembership(tx, {
            id: input.id,
            tenantId: ctx.tenantId,
            userId,
            role: input.role,
            raced: 'This person is already a member of this distributor',
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
        // Ruling R3 (docs/22 §8, 2026-09-29): the name and the mobile are the PERSON's, global. The
        // edit form sends every field on every save, so only a real change is refused.
        const renames =
          (input.name !== undefined && input.name !== before.name) ||
          (input.phone !== undefined && input.phone !== before.phone)
        try {
          await withSystem(db, async (sys) => {
            if (renames) {
              await refuseIfShared(
                sys,
                { userId: input.userId, tenantId: ctx.tenantId },
                NOT_YOURS_ALONE_PROFILE,
              )
            }
            await sys
              .update(users)
              .set({ ...patch, updatedAt: new Date() })
              .where(eq(users.id, input.userId))
          })
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
          await withSystem(db, async (sys) => {
            const who = { userId: input.userId, tenantId: ctx.tenantId }
            // DOS-400 repair: the same rule the shop's page keeps. A password is global, so one set
            // here for a person who also signs in with another business (as its shopkeeper, its staff
            // or its owner) or to the console would let this desk sign in as them there.
            await refuseIfShared(
              sys,
              who,
              target.role === 'retailer' ? NOT_YOURS_ALONE : NOT_YOURS_ALONE_STAFF,
            )
            await setFirstPassword(sys, { ...who, passwordHash })
          })
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
   * the user with the shop's phone, or a NEW user made with a username and the first password. Runs as
   * the system role, because users are global and RLS hides a person this distributor has never met.
   *
   * Architect's ruling of 2026-09-29 (docs/22 §8, R1): a sign-in is never shared between businesses on
   * the strength of a phone number. A person who works HERE is refused with the desk's own sentence; a
   * person who belongs to ANOTHER business (as its shopkeeper, staff or owner) or holds a console seat
   * is refused with one sentence and the same work whatever they are elsewhere — before anything is
   * written, so no login, link or password is touched. What is left is this distributor's alone:
   *  - its own shopkeeper already (two shops, one number, one login) → `existing`, nothing changed;
   *  - an earlier attempt of THIS request made it → `made` (a retry, the same first password);
   *  - a person nobody can sign in as anywhere — no username, no password, or a login no business
   *    holds (a give that failed half way) → it gets the username and the first password, and the
   *    answer reads like a new user: whatever password it had, nobody keeps it.
   */
  async shopLogin(input: ShopLoginRequest): Promise<ShopLogin> {
    const db = requireDb(this.db)
    const wanted = input.username === undefined ? null : checkedUsername(input.username)
    const shared = input.phoneTyped ? SHARED_NUMBER_TYPED : SHARED_NUMBER
    return withSystem(db, async (sys) => {
      const known = input.knownUserId === null ? null : await signInById(sys, input.knownUserId)
      const person = known ?? (await signInByPhone(sys, input.phone))
      if (person) {
        if (
          (await madeByThemselves(sys, person.id)) &&
          (await shopHere(sys, input.tenantId, person.id))
        ) {
          throw new ORPCError('CONFLICT', {
            message: ASK_FROM_THEIR_APP,
            data: { code: SHOP_SIGN_IN_CODES.numberHasSignIn },
          })
        }
        await refuseForeignSeat(sys, input.tenantId, person.id, shared)
        if (isUsable(person)) {
          // An earlier attempt of the SAME request made the user and failed before its reply.
          if (person.id === input.userId) {
            return {
              userId: person.id,
              username: person.username,
              made: true,
              passwordChosen: false,
            }
          }
          if (await shopHere(sys, input.tenantId, person.id)) {
            return {
              userId: person.id,
              username: person.username,
              made: false,
              passwordChosen: !person.mustChangePassword,
            }
          }
        }
        const username =
          person.username ?? wanted ?? (await freeUsername(sys, input.name, input.phone))
        await giveCredentials(sys, person.id, username, input.passwordHash)
        await noteFirstPassword(sys, { userId: person.id, tenantId: input.tenantId })
        return { userId: person.id, username, made: true, passwordChosen: false }
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
        // Somebody signed the same phone up a moment ago — maybe at another business, whose side of it
        // is not committed yet. Never attached blind: the next try reads the person as they are.
        const racing = await signInByPhone(sys, input.phone)
        throw new ORPCError('CONFLICT', {
          message:
            racing !== null || wanted === null
              ? TRY_AGAIN
              : 'That username is taken. Choose another.',
        })
      }
      await noteFirstPassword(sys, { userId: input.userId, tenantId: input.tenantId })
      return { userId: input.userId, username, made: true, passwordChosen: false }
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
      await insertMembership(tx, {
        id: input.membershipId,
        tenantId: input.tenantId,
        userId: input.userId,
        role: 'retailer',
        raced: 'Another desk gave this shopkeeper a sign-in a moment ago. Try again.',
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
      if (await madeByThemselves(sys, input.userId)) {
        throw new ORPCError('CONFLICT', { message: THEIR_OWN_SIGN_IN })
      }
      await refuseIfShared(sys, input, NOT_YOURS_ALONE)
      await setFirstPassword(sys, input)
    })
  }

  /**
   * A membership id the app sent that is already a row, refused BEFORE anybody is made: the person a
   * shop's sign-in or a hire makes is written in its own transaction first, and a membership insert
   * that failed after it left that person behind with a first password nobody was shown. Read as the
   * system role, because the clashing row may be another distributor's.
   */
  async refuseTakenMembershipId(id: string): Promise<void> {
    const db = requireDb(this.db)
    if (await withSystem(db, (sys) => membershipIdTaken(sys, id))) {
      throw new ORPCError('CONFLICT', { message: REPEATED_REQUEST })
    }
  }

  /**
   * Which of these logins sign in here as a shop right now, with which username, and whether the
   * password in use is one the person chose: an ACTIVE shopkeeper membership of this distributor and a
   * username. Read under the caller's own role.
   */
  async shopUsernames(
    tx: Db,
    tenantId: string,
    userIds: readonly string[],
  ): Promise<Map<string, { username: string; passwordChosen: boolean }>> {
    const out = new Map<string, { username: string; passwordChosen: boolean }>()
    const ids = [...new Set(userIds)]
    if (ids.length === 0) return out
    const rows = await tx
      .select({
        userId: users.id,
        username: users.username,
        mustChangePassword: users.mustChangePassword,
      })
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
    for (const row of rows) {
      if (row.username !== null)
        out.set(row.userId, {
          username: row.username,
          passwordChosen: !row.mustChangePassword,
        })
    }
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

/** Is this membership id already a row, in any distributor (so read as the system role)? */
async function membershipIdTaken(sys: Db, id: string): Promise<boolean> {
  const [taken] = await sys
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.id, id))
    .limit(1)
  return taken !== undefined
}

/**
 * A new membership, with a clash said in words (never a 500): the person already joined a moment ago
 * (`raced`, the unique person-per-distributor index), or the id is already a row (`REPEATED_REQUEST`).
 * Both callers check first; this is what a request that loses a race hears.
 */
async function insertMembership(
  tx: Db,
  input: { id: string; tenantId: string; userId: string; role: MembershipRole; raced: string },
): Promise<void> {
  try {
    await tx.insert(memberships).values({
      id: input.id,
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      status: 'active',
    })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    const constraint = pgConstraint(err)
    throw new ORPCError('CONFLICT', {
      message: constraint === 'memberships_tenant_user_idx' ? input.raced : REPEATED_REQUEST,
    })
  }
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
 * DOS-400 and the ruling of 2026-09-29 (R1): a shop's sign-in may not be a seat the person already holds
 * for another reason. A person who works for THIS distributor signs in here as staff and cannot also be
 * one of its shops (one membership per person per distributor): the desk is told about its own people,
 * which it knows. Anybody else who belongs to another business or to the console is refused with
 * `shared`, the same sentence and the same statement whatever they are there.
 */
async function refuseForeignSeat(
  sys: Db,
  tenantId: string,
  userId: string,
  shared: string,
): Promise<void> {
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
  if (await usedElsewhere(sys, { userId, tenantId })) {
    throw new ORPCError('CONFLICT', {
      message: shared,
      data: { code: SHOP_SIGN_IN_CODES.numberHasSignIn },
    })
  }
}

/**
 * R1 at the hire door (architect's ruling of 2026-09-29, docs/22 §8, item 1 said of `staff.create`
 * too; QA DOS-424). The hire found a person by the username or the phone the desk typed:
 *  - one of THIS distributor's own people (any role, any state) → as before: the membership step says
 *    "already a member", or a replay of the hire gives back its stored answer;
 *  - a person another distributor holds (staff or shopkeeper, switched on or off) or who holds a console
 *    seat → 409 in words, ONE statement (`usedElsewhere`) whatever they are there, so neither the body
 *    nor the work tells the desk which; nothing is written and the login is not touched;
 *  - a sign-in that no business holds (a username and a password, and no membership anywhere) → the
 *    same 409, unless THIS request made it on an earlier attempt that failed before the membership (a
 *    retry: the same `userId`). Such a sign-in is a hire or a give that stopped half way — possibly at
 *    another business, or still on its way to one — so its password may be known to another desk;
 *  - a person nobody can sign in as (no username or no password) → as before: nobody knows a password.
 */
async function refuseSharedHire(
  sys: Db,
  input: {
    tenantId: string
    person: { id: string; username: string | null; passwordHash: string | null }
    byPhone: boolean
    requestUserId: string
  },
): Promise<void> {
  const { person } = input
  const [here] = await sys
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.userId, person.id)))
    .limit(1)
  if (here) return
  const sentence = input.byPhone ? HIRE_SHARED_PHONE : HIRE_SHARED_USERNAME
  await refuseIfShared(sys, { userId: person.id, tenantId: input.tenantId }, sentence)
  const canSignIn = person.username !== null && person.passwordHash !== null
  if (canSignIn && person.id !== input.requestUserId) {
    throw new ORPCError('CONFLICT', { message: sentence })
  }
}

/** Is the person already one of this distributor's shopkeepers (in any state: a stop keeps the row)? */
async function shopHere(sys: Db, tenantId: string, userId: string): Promise<boolean> {
  const [row] = await sys
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.userId, userId),
        eq(memberships.role, 'retailer'),
      ),
    )
    .limit(1)
  return row !== undefined
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
