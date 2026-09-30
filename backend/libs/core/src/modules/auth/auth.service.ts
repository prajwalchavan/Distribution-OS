import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type {
  AccountTokenPair,
  AskToJoinIn,
  AuthMe,
  AuthOk,
  JoinableDistributorsIn,
  JoinableDistributorsOut,
  LeaveDistributorIn,
  MyJoinRequest,
  MyJoinRequestOut,
  MyJoinRequestsOut,
  ShopCodeLookupIn,
  ShopCodeLookupOut,
  SignInPair,
  SignUpIn,
  WithdrawJoinIn,
  PlatformAdminLevel,
  PlatformLoginIn,
  PlatformMe,
  PlatformTokenPair,
  SupportPass,
  SupportPassIn,
  AuthSession,
  AuthTenant,
  AuthUser,
  ChangePasswordIn,
  ChangePasswordOut,
  ForgotPasswordIn,
  LoginIn,
  LogoutIn,
  MembershipRole,
  MembershipsSummary,
  MembershipSummary,
  RefreshIn,
  ResetPasswordIn,
  RevokeSessionIn,
  SessionsList,
  SwitchTenantIn,
  TokenPair,
} from '@dos/contracts'
import {
  auditLog,
  authEvents,
  authSessions,
  devices,
  hashPassword,
  memberships,
  normalizeUsername,
  otpRateLimits,
  platformAdmins,
  type shopJoinRequests,
  supportGrants,
  tenants,
  tenantSettings,
  TENANT_SETTING_KEYS,
  users,
  validatePassword,
  validateUsername,
  verifyPassword,
  withSystem,
  type authEventKind,
  type Db,
} from '@dos/db'
import { uuidv7 } from '@dos/domain'
import {
  DB,
  isUniqueViolation,
  loadAuthKeys,
  requireDb,
  SAME_PASSWORD,
  signSupportPass,
  type AuthKeys,
} from '../../platform/index.js'
import { createObjectStorage, ObjectStorageError } from '../../platform/object-storage.js'
import {
  cutShopLinks,
  fileJoinRequest,
  myJoinRequests,
  noSuchCode,
  shopByCode,
  shopNamesOf,
  withdrawJoin,
} from '../retailers/index.js'
import { leaveShopHere } from '../tenancy/index.js'
import { SIGN_IN_REQUIRED, type AuthClaims } from './auth-context.js'
import { electionRefused, electRole } from './election.js'
import { membershipsSummary, type SummaryMembership } from './memberships-summary.js'
import {
  authTtl,
  hashRateKey,
  hashRefreshToken,
  newRefreshToken,
  passwordFingerprint,
  signAccessToken,
  signResetToken,
  verifyResetToken,
} from './tokens.js'

/** Five consecutive failures lock the account for fifteen minutes (design 2026-09-04). */
export const MAX_FAILED_LOGINS = 5
export const LOCK_MINUTES = 15

const INVALID_CREDENTIALS = 'Invalid username or password'
const NO_ACCESS = 'This account is disabled or has no active membership'
const NO_MEMBERSHIP_ANYWHERE =
  'This account is not an active member of any distributor. Ask the owner to add you.'
/** Sent when a tenantId was supplied but the caller is not an active member of THAT distributor. */
const notAMember = (tenantId: string) =>
  `You are not an active member of the distributor ${tenantId}. Omit tenantId to sign in to your own, or send one of the tenantId values from your memberships.`
const SESSION_EXPIRED = 'Session expired. Sign in again.'
/**
 * THE SHOPKEEPER'S OWN ACCOUNT (founder, 2026-09-29, docs/22 §8). A taken username and a number that already has an
 * account get this ONE sentence, with the same work behind both, so the door does not say which of the two it was.
 */
const IN_USE = 'That username or number is already in use. Sign in, or use another.'
const TOO_MANY_SIGN_UPS = 'Too many sign-ups from here. Try again in an hour.'
const TOO_MANY_CODES = 'Too many shop codes tried. Try again in an hour.'
const TOO_MANY_ASKS = 'Too many requests to join a shop. Try again in an hour.'
/** A work login (staff of a distributor) asking to be joined to a shop as a shopkeeper. */
const WORK_LOGIN =
  'This sign-in is for work at a distributor. A shop needs its own account: sign up as a shopkeeper.'
const CODE_NEEDED = 'Type the shop code printed on your bill.'
const DISTRIBUTOR_NEEDED = 'Choose the distributor, and type your shop’s name.'
const NOT_LISTED = 'This distributor is not taking requests by name. Use the shop code on its bill.'
const WORKS_THERE =
  'You work for this distributor, so you cannot also be one of its shops with this sign-in.'
const NOT_JOINED_THERE = 'You are not joined to this distributor.'
/** Module 13: a console account has no membership, so the tenant sign-in has nothing to give it. */
const NOT_A_CONSOLE_USER =
  'This account is not a Distribution OS console account. Sign in at your distributor app instead.'
const CONSOLE_ONLY =
  'This is a Distribution OS console session. It belongs to no distributor, so there is nothing to switch to.'
const USE_CONSOLE_SIGN_IN =
  'This is a Distribution OS console account. Sign in at POST /auth/platform/login.'
/** What a suspended distributor's staff are told, on sign-in and on every refresh (423). */
const tenantSuspended = (tenant: { legalName: string; status: string }) =>
  new ORPCError('LOCKED', {
    status: 423,
    message:
      tenant.status === 'closed'
        ? `${tenant.legalName} is closed on Distribution OS. Contact support@distribution-os.in.`
        : `${tenant.legalName} is suspended on Distribution OS. Contact support@distribution-os.in to reactivate it.`,
    data: { code: 'tenant_suspended', status: tenant.status },
  })

/** Where the request came from, recorded on sessions and events. */
export interface ClientInfo {
  ip: string | null
  userAgent: string | null
}

type AuthEventKind = (typeof authEventKind.enumValues)[number]
type JoinRow = typeof shopJoinRequests.$inferSelect
type UserRow = typeof users.$inferSelect
type SessionRow = typeof authSessions.$inferSelect
type MembershipRow = {
  membership: typeof memberships.$inferSelect
  tenant: typeof tenants.$inferSelect
  /** The distributor's own name and logo (docs/17 §D6), filled by `loadMemberships`. */
  branding: TenantBranding
}

interface TenantBranding {
  displayName: string
  logoUrl: string | null
}

/** How long a logo link in a sign-in reply stays good: a day, like `tenancy.branding.get`. */
const LOGO_URL_TTL_SECONDS = 24 * 60 * 60

/**
 * Failure bookkeeping (failed_login_count, a revoked session, the audit event) must COMMIT even though the
 * caller gets an error, and a throw inside the transaction would roll it back. Transactions therefore
 * return an Outcome and the error is thrown after the commit.
 */
type Outcome<T> = { ok: true; value: T } | { ok: false; error: ORPCError<string, unknown> }
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value })
const fail = <T = never>(error: ORPCError<string, unknown>): Outcome<T> => ({ ok: false, error })
function unwrap<T>(outcome: Outcome<T>): T {
  if (outcome.ok) return outcome.value
  throw outcome.error
}

const invalidCredentials = () => new ORPCError('UNAUTHORIZED', { message: INVALID_CREDENTIALS })
const noAccess = (message: string = NO_ACCESS) => new ORPCError('FORBIDDEN', { message })
const sessionExpired = () => new ORPCError('UNAUTHORIZED', { message: SESSION_EXPIRED })
const signInRequired = () => new ORPCError('UNAUTHORIZED', { message: SIGN_IN_REQUIRED })
function locked(lockedUntil: Date, now: Date) {
  const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000))
  return new ORPCError('LOCKED', {
    status: 423,
    message: `Too many failed attempts. Try again in ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`,
    data: { lockedUntil: lockedUntil.toISOString(), minutes },
  })
}

@Injectable()
export class AuthService {
  /** Verifying a password for a username that does not exist takes as long as for one that does. */
  private dummyHash: Promise<string> | null = null

  constructor(@Optional() @Inject(DB) private readonly db: Db | null) {}

  // ---------------------------------------------------------------- sign-in

  async login(input: LoginIn, client: ClientInfo): Promise<SignInPair> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    const username = normalizeUsername(input.username)
    const outcome = await withSystem(db, async (tx): Promise<Outcome<SignInPair>> => {
      const now = new Date()
      const user = await findUserByUsername(tx, username)
      if (!user?.passwordHash) {
        await verifyPassword(await this.dummy(), input.password)
        await logEvent(tx, { userId: user?.id ?? null, username, kind: 'login_failed', client })
        return fail(invalidCredentials())
      }
      if (user.lockedUntil && user.lockedUntil > now) {
        await logEvent(tx, { userId: user.id, username, kind: 'login_failed', client })
        return fail(locked(user.lockedUntil, now))
      }
      if (!(await verifyPassword(user.passwordHash, input.password))) {
        // A lock that has already expired starts a fresh count instead of re-locking on the next slip.
        const count = user.lockedUntil ? 1 : user.failedLoginCount + 1
        const lockedUntil =
          count >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null
        await tx
          .update(users)
          .set({ failedLoginCount: count, lockedUntil, updatedAt: now })
          .where(eq(users.id, user.id))
        await logEvent(tx, { userId: user.id, username, kind: 'login_failed', client })
        if (lockedUntil) {
          await logEvent(tx, { userId: user.id, username, kind: 'locked', client })
          return fail(locked(lockedUntil, now))
        }
        return fail(invalidCredentials())
      }
      if (user.status !== 'active') {
        await logEvent(tx, { userId: user.id, username, kind: 'login_failed', client })
        return fail(noAccess())
      }
      const rows = await loadMemberships(tx, user.id)
      const active = rows.filter((r) => r.membership.status === 'active')
      const chosen = input.tenantId
        ? active.find((r) => r.membership.tenantId === input.tenantId)
        : active[0]
      // Module 13: Distribution OS's own staff hold no membership anywhere, so without this they
      // would be told "you are not a member of any distributor", which is true and unhelpful.
      if (!chosen && (await platformAdminLevel(tx, user.id)) !== null) {
        await logEvent(tx, { userId: user.id, username, kind: 'login_failed', client })
        return fail(noAccess(USE_CONSOLE_SIGN_IN))
      }
      // The shopkeeper's own account that no distributor has joined yet (founder, 2026-09-29): signed in, with
      // no distributor, for an app that asked for it. An app that did not ask is refused below, as before.
      if (
        !chosen &&
        !input.tenantId &&
        input.accountWithoutDistributor === true &&
        isShopkeeperAccount(user, rows)
      ) {
        if (user.failedLoginCount > 0 || user.lockedUntil) {
          await tx
            .update(users)
            .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: now })
            .where(eq(users.id, user.id))
        }
        const session = await openAccountSession(tx, {
          user,
          deviceId: input.deviceId,
          deviceName: input.deviceName ?? null,
          platform: input.platform ?? 'web',
          client,
          now,
        })
        await logEvent(tx, { userId: user.id, username, kind: 'login_ok', client })
        return ok(await issueAccountPair(keys, user, rows, session, now))
      }
      if (!chosen) {
        await logEvent(tx, { userId: user.id, username, kind: 'login_failed', client })
        // The password was right: say which of the two things is actually wrong, or an operator
        // (and every Swagger "Try it out" that keeps the sample tenantId) is left guessing.
        return fail(
          noAccess(
            input.tenantId && active.length > 0
              ? notAMember(input.tenantId)
              : NO_MEMBERSHIP_ANYWHERE,
          ),
        )
      }
      // The platform console's kill switch (`admin.tenants.suspend`, module 13). The password was
      // right and the membership is active; the DISTRIBUTORSHIP is not, so nobody who works there gets
      // in — 423, not 403, because it is a state that will end, and the message says who to call.
      if (chosen.tenant.status !== 'active') {
        await logEvent(tx, {
          userId: user.id,
          username,
          tenantId: chosen.membership.tenantId,
          kind: 'login_failed',
          client,
        })
        return fail(tenantSuspended(chosen.tenant))
      }
      // docs/29 §2: the device asks for the role it needs and only a downward election is granted.
      // A refusal is a 403 with a sentence the person can act on, recorded like any other refused
      // sign-in, and it happens before a device row, a session or a token exists.
      const elected = electRole({
        membershipRole: chosen.membership.role,
        extraRoles: chosen.membership.extraRoles,
        actAs: input.actAs,
        distributor: chosen.branding.displayName,
      })
      if (!elected.ok) {
        await logEvent(tx, {
          userId: user.id,
          username,
          tenantId: chosen.membership.tenantId,
          kind: 'login_failed',
          actedAs: input.actAs ?? null,
          client,
        })
        return fail(elected.error)
      }
      if (user.failedLoginCount > 0 || user.lockedUntil) {
        await tx
          .update(users)
          .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: now })
          .where(eq(users.id, user.id))
      }
      const platform = input.platform ?? 'web'
      await tx
        .insert(devices)
        .values({ id: input.deviceId, userId: user.id, platform, lastSeenAt: now })
        .onConflictDoUpdate({
          target: devices.id,
          set: { userId: user.id, platform, lastSeenAt: now, updatedAt: now },
        })
      // One live session per device and user: signing in again on the same device replaces the old one.
      await tx
        .update(authSessions)
        .set({ revokedAt: now, revokedReason: 'replaced' })
        .where(
          and(
            eq(authSessions.userId, user.id),
            eq(authSessions.deviceId, input.deviceId),
            isNull(authSessions.revokedAt),
          ),
        )
      const session = await createSession(tx, {
        user,
        membership: chosen,
        role: elected.value.role,
        deviceId: input.deviceId,
        deviceName: input.deviceName ?? null,
        platform,
        client,
        now,
      })
      await logEvent(tx, {
        userId: user.id,
        username,
        tenantId: chosen.membership.tenantId,
        kind: 'login_ok',
        actedAs: elected.value.electedRole,
        client,
      })
      return ok(await issuePair(keys, user, chosen, rows, session, now, elected.value.role))
    })
    return unwrap(outcome)
  }

  async refresh(input: RefreshIn, client: ClientInfo): Promise<SignInPair> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    const outcome = await withSystem(db, async (tx): Promise<Outcome<SignInPair>> => {
      const now = new Date()
      const valid = await validateRefresh(tx, input.refreshToken, input.deviceId, client, now)
      if (!valid.ok) return valid
      const { session, user, rows, presentedHash } = valid.value
      if (session.tenantId === null) {
        // A console session has no tenant: it refreshes at /auth/platform/refresh, which re-reads
        // `platform_admins`. Answering it here would hand back a pair with a null tenant.
        if ((await platformAdminLevel(tx, user.id)) !== null) return fail(noAccess(CONSOLE_ONLY))
        // THE SHOPKEEPER'S OWN ACCOUNT (founder, 2026-09-29): the next refresh after a distributor approved lands
        // on that distributor's shop; until then the account's own pair again.
        return refreshAccount(tx, keys, { session, user, rows, presentedHash, client, now })
      }
      const current = rows.find((r) => r.membership.tenantId === session.tenantId)
      if (!current || current.membership.status !== 'active') {
        await revokeSession(tx, session.id, 'membership_disabled', now)
        return fail(noAccess())
      }
      // Suspension bites at the next refresh as well as at sign-in, so a distributor that is switched
      // off stops working within one access-token lifetime rather than at the end of the day.
      if (current.tenant.status !== 'active') {
        await revokeSession(tx, session.id, 'tenant_suspended', now)
        return fail(tenantSuspended(current.tenant))
      }
      // docs/29 §2: a refresh keeps the role this session was ELECTED with — re-checked against the
      // membership as it stands NOW, so an extra role the owner took away this morning stops working
      // within one access-token lifetime. It is never silently swapped for the membership's own role:
      // the session is revoked and the person is told, in the same sentence a refused sign-in gives.
      const held = session.role ?? current.membership.role
      const stillElected = electRole({
        membershipRole: current.membership.role,
        extraRoles: current.membership.extraRoles,
        actAs: held,
        distributor: current.branding.displayName,
      })
      if (!stillElected.ok) {
        // Nothing was disabled: the membership stands and the role it may elect changed under it.
        await revokeSession(tx, session.id, 'election_withdrawn', now)
        return fail(
          electionRefused({
            distributor: current.branding.displayName,
            membershipRole: current.membership.role,
            actAs: held,
          }),
        )
      }
      const refresh = newRefreshToken()
      const rotated = {
        ...session,
        role: stillElected.value.role,
        refreshExpiresAt: refreshExpiry(now),
        lastUsedAt: now,
      }
      await tx
        .update(authSessions)
        .set({
          refreshTokenHash: refresh.hash,
          previousRefreshTokenHash: presentedHash,
          refreshExpiresAt: rotated.refreshExpiresAt,
          lastUsedAt: now,
          role: rotated.role,
          ip: client.ip,
          userAgent: client.userAgent,
        })
        .where(eq(authSessions.id, session.id))
      await logEvent(tx, {
        userId: user.id,
        tenantId: session.tenantId,
        kind: 'refresh',
        actedAs: stillElected.value.electedRole,
        client,
      })
      return ok(
        await issuePair(
          keys,
          user,
          current,
          rows,
          { row: rotated, refresh },
          now,
          stillElected.value.role,
        ),
      )
    })
    return unwrap(outcome)
  }

  async logout(input: LogoutIn, client: ClientInfo): Promise<AuthOk> {
    const db = requireDb(this.db)
    await withSystem(db, async (tx) => {
      const now = new Date()
      const session = await findSessionByHash(tx, hashRefreshToken(input.refreshToken))
      if (!session || session.revokedAt) return
      await revokeSession(tx, session.id, 'logout', now)
      await logEvent(tx, {
        userId: session.userId,
        tenantId: session.tenantId,
        kind: 'logout',
        client,
      })
    })
    return { ok: true }
  }

  async switchTenant(input: SwitchTenantIn, client: ClientInfo): Promise<TokenPair> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    const outcome = await withSystem(db, async (tx): Promise<Outcome<TokenPair>> => {
      const now = new Date()
      const valid = await validateRefresh(tx, input.refreshToken, input.deviceId, client, now)
      if (!valid.ok) return valid
      const { session, user, rows } = valid.value
      // Module 13: a console session is not a membership and has nothing to switch between. Refusing
      // it here is the mirror of `TenantGuard` refusing a `platform_admin` token on the six services. A
      // shopkeeper's account with no distributor yet (tenant null, no console seat) switches like any session.
      if (session.tenantId === null && (await platformAdminLevel(tx, user.id)) !== null)
        return fail(noAccess(CONSOLE_ONLY))
      const target = rows.find((r) => r.membership.tenantId === input.tenantId)
      if (!target || target.membership.status !== 'active')
        return fail(noAccess(notAMember(input.tenantId)))
      if (target.tenant.status !== 'active') return fail(tenantSuspended(target.tenant))
      // The same election as at sign-in, against the membership at the OTHER distributor: a rep who
      // is a driver at one and a salesperson at the next gets the role that distributor granted him,
      // never the one the last one did (docs/29 §2).
      const elected = electRole({
        membershipRole: target.membership.role,
        extraRoles: target.membership.extraRoles,
        actAs: input.actAs,
        distributor: target.branding.displayName,
      })
      if (!elected.ok) return fail(elected.error)
      await revokeSession(tx, session.id, 'tenant_switched', now)
      const next = await createSession(tx, {
        user,
        membership: target,
        role: elected.value.role,
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        platform: session.platform ?? 'web',
        client,
        now,
      })
      await logEvent(tx, {
        userId: user.id,
        tenantId: target.membership.tenantId,
        kind: 'tenant_switched',
        actedAs: elected.value.electedRole,
        client,
      })
      return ok(await issuePair(keys, user, target, rows, next, now, elected.value.role))
    })
    return unwrap(outcome)
  }

  // ---------------------------------------------------------------- the shopkeeper's own account

  /**
   * SIGN UP AS A SHOPKEEPER (founder, 2026-09-29, docs/22 §8 "The shopkeeper is independent"): a person with no
   * distributor, a password they chose (so no first-password wall, and no desk may ever set one for it), signed in
   * at once. Limited per client address and per number, the counters committed on their own so a refusal still
   * counts. A taken username and a number that already has an account get one sentence (`IN_USE`), with both
   * questions always asked, so the answer does not say which.
   */
  async signUp(input: SignUpIn, client: ClientInfo): Promise<AccountTokenPair> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    const username = normalizeUsername(input.username)
    const usernameProblem = validateUsername(username)
    if (usernameProblem) throw new ORPCError('BAD_REQUEST', { message: usernameProblem })
    const passwordProblem = validatePassword(input.password)
    if (passwordProblem) throw new ORPCError('BAD_REQUEST', { message: passwordProblem })
    const allowed = await withSystem(db, async (tx) => {
      const now = new Date()
      const byAddress = await underHourlyLimit(
        tx,
        `signup:ip:${client.ip ?? 'unknown'}`,
        SIGN_UPS_PER_ADDRESS_PER_HOUR,
        now,
      )
      const byNumber = await underHourlyLimit(
        tx,
        `signup:phone:${hashRateKey(input.phone)}`,
        SIGN_UPS_PER_NUMBER_PER_HOUR,
        now,
      )
      return byAddress && byNumber
    })
    if (!allowed) {
      throw new ORPCError('TOO_MANY_REQUESTS', { status: 429, message: TOO_MANY_SIGN_UPS })
    }
    // Hashed before the transaction, as every desk that sets a password does: argon2id is slow on purpose.
    const passwordHash = await hashPassword(input.password)
    const outcome = await withSystem(db, async (tx): Promise<Outcome<AccountTokenPair>> => {
      const now = new Date()
      const inUse = () => fail<AccountTokenPair>(new ORPCError('CONFLICT', { message: IN_USE }))
      // Both questions, always, before either answer is used.
      const byId = await findUserById(tx, input.id)
      const byName = await findUserByUsername(tx, username)
      const [byPhone] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phone, input.phone))
        .limit(1)
      let user: UserRow | undefined
      if (byId) {
        // The same sign-up sent again after a reply that never arrived: the same person, the same password.
        const same =
          byId.signedUpAt !== null &&
          byId.username === username &&
          byId.phone === input.phone &&
          byId.passwordHash !== null &&
          (await verifyPassword(byId.passwordHash, input.password))
        if (!same) return inUse()
        user = byId
      } else {
        if (byName || byPhone) return inUse()
        try {
          // Savepoint: somebody signing the same username or number up at this moment must not abort the rest.
          await tx.transaction(async (sp) => {
            await sp.insert(users).values({
              id: input.id,
              phone: input.phone,
              name: input.name,
              locale: 'hi-IN',
              username,
              passwordHash,
              passwordChangedAt: now,
              mustChangePassword: false,
              status: 'active',
              signedUpAt: now,
              shopName: input.shopName,
            })
          })
        } catch (err) {
          if (isUniqueViolation(err)) return inUse()
          throw err
        }
        user = await findUserById(tx, input.id)
      }
      if (!user) return inUse()
      const rows = await loadMemberships(tx, user.id)
      const session = await openAccountSession(tx, {
        user,
        deviceId: input.deviceId,
        deviceName: input.deviceName ?? null,
        platform: input.platform ?? 'web',
        client,
        now,
      })
      await logEvent(tx, { userId: user.id, username, kind: 'login_ok', client })
      return ok(await issueAccountPair(keys, user, rows, session, now))
    })
    return unwrap(outcome)
  }

  /** `auth.joins.lookup`: which distributor and shop a shop code names, shown back before the account asks. */
  async joinLookup(auth: AuthClaims, input: ShopCodeLookupIn): Promise<ShopCodeLookupOut> {
    const db = requireDb(this.db)
    await withSystem(db, (tx) => this.shopkeeper(tx, auth, new Date()))
    // Counted in its own transaction, so a code that names no shop — the guess this limit is for — still counts.
    await this.withinLimit(`joincode:user:${auth.userId}`, CODES_PER_HOUR, TOO_MANY_CODES)
    return withSystem(db, async (tx) => {
      const shop = await shopByCode(tx, input.code)
      if (!shop) throw noSuchCode()
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, shop.tenantId)).limit(1)
      if (!tenant || tenant.status !== 'active') throw noSuchCode()
      const names = await loadBranding(tx, [tenant])
      return {
        distributor: names.get(tenant.id)?.displayName ?? tenant.legalName,
        shop: shop.shopName,
      }
    })
  }

  /** `auth.joins.distributors`: the distributors a shopkeeper may find by name (those that did not opt out). */
  async joinDistributors(
    auth: AuthClaims,
    input: JoinableDistributorsIn,
  ): Promise<JoinableDistributorsOut> {
    const db = requireDb(this.db)
    return withSystem(db, async (tx) => {
      await this.shopkeeper(tx, auth, new Date())
      return { items: await listedDistributors(tx, input.q ?? '', input.limit) }
    })
  }

  /**
   * `auth.joins.ask`: file the account's request. By code, the shop code names the distributor and the shop; by
   * name, the distributor must be one that takes requests by name. The person must not work for it.
   */
  async joinAsk(auth: AuthClaims, input: AskToJoinIn): Promise<MyJoinRequestOut> {
    const db = requireDb(this.db)
    await withSystem(db, (tx) => this.shopkeeper(tx, auth, new Date()))
    await this.withinLimit(`joinask:user:${auth.userId}`, ASKS_PER_HOUR, TOO_MANY_ASKS)
    if (input.by === 'code') {
      await this.withinLimit(`joincode:user:${auth.userId}`, CODES_PER_HOUR, TOO_MANY_CODES)
    }
    const target = await withSystem(db, async (tx) => {
      const user = await this.shopkeeper(tx, auth, new Date())
      let tenantId: string
      let retailerId: string | null = null
      if (input.by === 'code') {
        if (!input.code) throw new ORPCError('BAD_REQUEST', { message: CODE_NEEDED })
        const shop = await shopByCode(tx, input.code)
        if (!shop) throw noSuchCode()
        tenantId = shop.tenantId
        retailerId = shop.retailerId
      } else {
        if (!input.tenantId || !input.shopName) {
          throw new ORPCError('BAD_REQUEST', { message: DISTRIBUTOR_NEEDED })
        }
        tenantId = input.tenantId
        if (!(await isListed(tx, tenantId))) {
          throw new ORPCError('NOT_FOUND', { message: NOT_LISTED })
        }
      }
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
      if (!tenant || tenant.status !== 'active') {
        throw input.by === 'code'
          ? noSuchCode()
          : new ORPCError('NOT_FOUND', { message: NOT_LISTED })
      }
      const [staff] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, tenantId),
            eq(memberships.userId, user.id),
            ne(memberships.role, 'retailer'),
          ),
        )
        .limit(1)
      if (staff) throw new ORPCError('CONFLICT', { message: WORKS_THERE })
      return { user, tenantId, retailerId }
    })
    const shopName = input.shopName ?? target.user.shopName ?? target.user.name
    const row = await fileJoinRequest(db, {
      id: input.id,
      userId: target.user.id,
      tenantId: target.tenantId,
      via: input.by,
      retailerId: target.retailerId,
      shopName,
      personName: target.user.name,
      personPhone: target.user.phone,
    })
    const [item] = await this.myViews([row])
    if (!item) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'the request vanished' })
    return { item }
  }

  /** `auth.joins.mine`: the account's own requests, newest first. */
  async joinMine(auth: AuthClaims): Promise<MyJoinRequestsOut> {
    const db = requireDb(this.db)
    const user = await withSystem(db, (tx) => this.shopkeeper(tx, auth, new Date()))
    return { items: await this.myViews(await myJoinRequests(db, user.id)) }
  }

  /** `auth.joins.withdraw`: one of the account's own requests that still waits. */
  async joinWithdraw(auth: AuthClaims, input: WithdrawJoinIn): Promise<MyJoinRequestOut> {
    const db = requireDb(this.db)
    const user = await withSystem(db, (tx) => this.shopkeeper(tx, auth, new Date()))
    const row = await withdrawJoin(db, user.id, input.id)
    const [item] = await this.myViews([row])
    if (!item) throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'the request vanished' })
    return { item }
  }

  /**
   * `auth.joins.leave`: the account stops seeing every shop of that distributor, at once (the links that every
   * row-level rule of the shop role reads are cut), its shopkeeper membership there is switched off and its other
   * sessions there are signed out. The session that asked is MOVED — to another active distributor of the account,
   * or to "no distributor yet" — so the app's next `refresh` opens it. The distributor's books stay as they were.
   * Leaving a distributor the account has already left answers ok again.
   */
  async joinLeave(
    auth: AuthClaims,
    input: LeaveDistributorIn,
    client: ClientInfo,
  ): Promise<AuthOk> {
    const db = requireDb(this.db)
    await withSystem(db, async (tx) => {
      const now = new Date()
      const session = await liveSession(tx, auth, now)
      const user = await this.shopkeeper(tx, auth, now)
      const rows = await loadMemberships(tx, user.id)
      const there = rows.find((r) => r.membership.tenantId === input.tenantId)
      if (!there) throw new ORPCError('NOT_FOUND', { message: NOT_JOINED_THERE })
      if (there.membership.role !== 'retailer') {
        throw new ORPCError('CONFLICT', { message: WORKS_THERE })
      }
      const cut = await cutShopLinks(tx, { tenantId: input.tenantId, userId: user.id })
      const left = await leaveShopHere(tx, {
        tenantId: input.tenantId,
        userId: user.id,
        keepSessionId: session.id,
      })
      if (session.tenantId === input.tenantId) {
        const next = rows.find(
          (r) =>
            r.membership.tenantId !== input.tenantId &&
            r.membership.status === 'active' &&
            r.tenant.status === 'active',
        )
        await tx
          .update(authSessions)
          .set({
            tenantId: next ? next.membership.tenantId : null,
            role: next ? next.membership.role : null,
          })
          .where(eq(authSessions.id, session.id))
      }
      if (cut > 0 || there.membership.status === 'active') {
        await tx.insert(auditLog).values({
          id: uuidv7(),
          tenantId: input.tenantId,
          actorId: user.id,
          actorRole: 'retailer',
          action: 'retailer.shop_join.leave',
          entityType: 'user',
          entityId: user.id,
          before: { links: cut, membership: there.membership.status },
          after: { membership: left ? 'disabled' : there.membership.status },
        })
        await logEvent(tx, {
          userId: user.id,
          tenantId: input.tenantId,
          kind: 'session_revoked',
          client,
        })
      }
    })
    return { ok: true }
  }

  /**
   * The signed-in person, when this is a shopkeeper's account — one they made themselves, or one whose every
   * membership is a shop — with a live session. A work login is refused in words.
   */
  private async shopkeeper(tx: Db, auth: AuthClaims, now: Date): Promise<UserRow> {
    await liveSession(tx, auth, now)
    const user = await findUserById(tx, auth.userId)
    if (!user) throw signInRequired()
    if (user.status !== 'active') throw noAccess()
    const rows = await loadMemberships(tx, user.id)
    if (!isShopkeeperAccount(user, rows)) throw noAccess(WORK_LOGIN)
    return user
  }

  /**
   * One more try against an hourly limit, counted in its OWN transaction — committed whatever the call it guards
   * then answers — and a 429 in words past the limit.
   */
  private async withinLimit(key: string, limit: number, message: string): Promise<void> {
    const db = requireDb(this.db)
    const allowed = await withSystem(db, (tx) => underHourlyLimit(tx, key, limit, new Date()))
    if (!allowed) throw new ORPCError('TOO_MANY_REQUESTS', { status: 429, message })
  }

  /** The account's own view of its requests: nothing of a distributor but its name and, by code, the shop's. */
  private async myViews(rows: readonly JoinRow[]): Promise<MyJoinRequest[]> {
    if (rows.length === 0) return []
    const db = requireDb(this.db)
    return withSystem(db, async (tx) => {
      const ids = [...new Set(rows.map((r) => r.tenantId))]
      const found = await tx.select().from(tenants).where(inArray(tenants.id, ids))
      const names = await loadBranding(tx, found)
      const shops = await shopNamesOf(tx, rows)
      return rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        distributor:
          names.get(r.tenantId)?.displayName ??
          found.find((t) => t.id === r.tenantId)?.legalName ??
          '',
        shop:
          r.via === 'code' && r.retailerId !== null
            ? (shops.get(r.retailerId) ?? r.shopName)
            : r.shopName,
        via: r.via,
        state: r.state,
        reason: r.reason,
        askedAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      }))
    })
  }

  // ---------------------------------------------------------------- the platform console (module 13)

  /**
   * Sign in as Distribution OS's OWN staff (founder decision 2026-09-05, docs/22 §2 row 7).
   *
   * It is a separate procedure, not a flag on `login`, because a console account is a different kind
   * of thing: it holds no membership, so there is no distributor to pick, no branding to load and no
   * `memberships` list to answer with. What it shares with `login` — deliberately, because a console
   * account is the most dangerous account on the platform, not the most privileged shortcut — is
   * every protection: the same argon2id verification with a constant-time dummy for an unknown
   * username, the same five-failure fifteen-minute lockout, the same one-live-session-per-device
   * rule, the same rotating refresh token and the same `auth_events` trail.
   *
   * The session row carries `tenant_id = null` and `role = null` (the column is the membership enum,
   * which has no `platform_admin` value on purpose), so what makes it a console session is the
   * `platform_admins` row, re-read on every refresh. Disabling an administrator therefore ends their
   * access at the next refresh without anyone hunting for their sessions.
   */
  async platformLogin(input: PlatformLoginIn, client: ClientInfo): Promise<PlatformTokenPair> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    const username = normalizeUsername(input.username)
    const outcome = await withSystem(db, async (tx): Promise<Outcome<PlatformTokenPair>> => {
      const now = new Date()
      const user = await findUserByUsername(tx, username)
      if (!user?.passwordHash) {
        await verifyPassword(await this.dummy(), input.password)
        await logEvent(tx, { userId: user?.id ?? null, username, kind: 'login_failed', client })
        return fail(invalidCredentials())
      }
      if (user.lockedUntil && user.lockedUntil > now) {
        await logEvent(tx, { userId: user.id, username, kind: 'login_failed', client })
        return fail(locked(user.lockedUntil, now))
      }
      if (!(await verifyPassword(user.passwordHash, input.password))) {
        const count = user.lockedUntil ? 1 : user.failedLoginCount + 1
        const lockedUntil =
          count >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null
        await tx
          .update(users)
          .set({ failedLoginCount: count, lockedUntil, updatedAt: now })
          .where(eq(users.id, user.id))
        await logEvent(tx, { userId: user.id, username, kind: 'login_failed', client })
        if (lockedUntil) {
          await logEvent(tx, { userId: user.id, username, kind: 'locked', client })
          return fail(locked(lockedUntil, now))
        }
        return fail(invalidCredentials())
      }
      if (user.status !== 'active') {
        await logEvent(tx, { userId: user.id, username, kind: 'login_failed', client })
        return fail(noAccess())
      }
      const level = await platformAdminLevel(tx, user.id)
      if (level === null) {
        await logEvent(tx, { userId: user.id, username, kind: 'login_failed', client })
        return fail(noAccess(NOT_A_CONSOLE_USER))
      }
      if (user.failedLoginCount > 0 || user.lockedUntil) {
        await tx
          .update(users)
          .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: now })
          .where(eq(users.id, user.id))
      }
      const platform = input.platform ?? 'web'
      await tx
        .insert(devices)
        .values({ id: input.deviceId, userId: user.id, platform, lastSeenAt: now })
        .onConflictDoUpdate({
          target: devices.id,
          set: { userId: user.id, platform, lastSeenAt: now, updatedAt: now },
        })
      await tx
        .update(authSessions)
        .set({ revokedAt: now, revokedReason: 'replaced' })
        .where(
          and(
            eq(authSessions.userId, user.id),
            eq(authSessions.deviceId, input.deviceId),
            isNull(authSessions.revokedAt),
          ),
        )
      const session = await createPlatformSession(tx, {
        user,
        deviceId: input.deviceId,
        deviceName: input.deviceName ?? null,
        platform,
        client,
        now,
      })
      await logEvent(tx, { userId: user.id, username, kind: 'login_ok', client })
      return ok(await issuePlatformPair(keys, user, session, level, now))
    })
    return unwrap(outcome)
  }

  /**
   * Rotate a console session's refresh token. `platform_admins` is re-read here, so an administrator
   * who was disabled a minute ago is out at the next refresh (at most one access-token lifetime), and
   * a tenant session presented here is refused rather than quietly upgraded.
   */
  async platformRefresh(input: RefreshIn, client: ClientInfo): Promise<PlatformTokenPair> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    const outcome = await withSystem(db, async (tx): Promise<Outcome<PlatformTokenPair>> => {
      const now = new Date()
      const valid = await validateRefresh(tx, input.refreshToken, input.deviceId, client, now)
      if (!valid.ok) return valid
      const { session, user, presentedHash } = valid.value
      if (session.tenantId !== null) return fail(noAccess(NOT_A_CONSOLE_USER))
      const level = await platformAdminLevel(tx, user.id)
      if (level === null) {
        await revokeSession(tx, session.id, 'platform_admin_disabled', now)
        return fail(noAccess(NOT_A_CONSOLE_USER))
      }
      const refresh = newRefreshToken()
      const rotated = { ...session, refreshExpiresAt: refreshExpiry(now), lastUsedAt: now }
      await tx
        .update(authSessions)
        .set({
          refreshTokenHash: refresh.hash,
          previousRefreshTokenHash: presentedHash,
          refreshExpiresAt: rotated.refreshExpiresAt,
          lastUsedAt: now,
          ip: client.ip,
          userAgent: client.userAgent,
        })
        .where(eq(authSessions.id, session.id))
      await logEvent(tx, { userId: user.id, kind: 'refresh', client })
      return ok(await issuePlatformPair(keys, user, { row: rotated, refresh }, level, now))
    })
    return unwrap(outcome)
  }

  /** Who this console session is. Refuses a membership token: it is not a question with an answer. */
  async platformMe(auth: AuthClaims): Promise<PlatformMe> {
    const db = requireDb(this.db)
    return withSystem(db, async (tx) => {
      const now = new Date()
      const session = await liveSession(tx, auth, now)
      if (session.tenantId !== null) throw noAccess(NOT_A_CONSOLE_USER)
      const user = await findUserById(tx, auth.userId)
      if (!user) throw signInRequired()
      if (user.status !== 'active') throw noAccess()
      const level = await platformAdminLevel(tx, user.id)
      if (level === null) throw noAccess(NOT_A_CONSOLE_USER)
      return {
        user: toAuthUser(user),
        role: 'platform_admin',
        level,
        session: toAuthSession(session),
      }
    })
  }

  /**
   * Exchange an OWNER-APPROVED support grant for a short-lived signed pass (docs/22 §8, 2026-09-05:
   * support access is time-boxed, owner-approved, audited). Everything this checks is checked again by
   * the database's own trigger on the way in — what it adds is a clear sentence per refusal and, most
   * of all, the fact that the pass cannot be minted anywhere else: auth-service is the only process
   * that holds the signing key.
   *
   * Five refusals, all deliberate: not an administrator, not the administrator who asked, never
   * approved, revoked, or lapsed. There is no path here that opens a window — only
   * `tenancy.support.approve`, on owner-service, does that, and the distributor's owner is the only
   * role that may call it.
   */
  async supportPass(auth: AuthClaims, input: SupportPassIn): Promise<SupportPass> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    return withSystem(db, async (tx) => {
      const now = new Date()
      const session = await liveSession(tx, auth, now)
      if (session.tenantId !== null) throw noAccess(NOT_A_CONSOLE_USER)
      if ((await platformAdminLevel(tx, auth.userId)) === null) throw noAccess(NOT_A_CONSOLE_USER)
      const [row] = await tx
        .select({ grant: supportGrants, tenant: tenants })
        .from(supportGrants)
        .innerJoin(tenants, eq(tenants.id, supportGrants.tenantId))
        .where(eq(supportGrants.id, input.grantId))
        .limit(1)
      if (!row) throw new ORPCError('NOT_FOUND', { message: 'No such support request' })
      const { grant, tenant } = row
      if (grant.adminUserId !== auth.userId)
        throw noAccess('That support window was granted to another administrator')
      if (!grant.approvedAt)
        throw noAccess(
          `${tenant.legalName} has not approved this request yet. Their owner decides, from their own app.`,
        )
      if (grant.revokedAt) throw noAccess('That support window has been closed')
      if (grant.expiresAt <= now)
        throw noAccess('That support window has expired. Ask for a new one.')
      const scope = grant.scope === 'read_write' ? 'read_write' : 'read_only'
      const signed = await signSupportPass(
        {
          grantId: grant.id,
          tenantId: grant.tenantId,
          adminUserId: auth.userId,
          scope,
          grantExpiresAt: grant.expiresAt,
        },
        keys,
        now,
      )
      return {
        pass: signed.pass,
        tenantId: grant.tenantId,
        tenantSlug: tenant.slug,
        scope,
        expiresAt: signed.expiresAt.toISOString(),
        grantExpiresAt: grant.expiresAt.toISOString(),
      }
    })
  }

  // ---------------------------------------------------------------- behind AccessTokenGuard

  async me(auth: AuthClaims): Promise<AuthMe> {
    const db = requireDb(this.db)
    return withSystem(db, async (tx) => {
      const now = new Date()
      const session = await liveSession(tx, auth, now)
      const user = await findUserById(tx, auth.userId)
      if (!user) throw signInRequired()
      if (user.status !== 'active') throw noAccess()
      const rows = await loadMemberships(tx, user.id)
      const current = rows.find((r) => r.membership.tenantId === session.tenantId)
      const active = current?.membership.status === 'active' ? current : null
      return {
        user: toAuthUser(user),
        tenant: active ? toAuthTenant(active) : null,
        // The role this SESSION acts as (docs/29 §2), not the membership's own: the shell and the
        // token have to agree, or an elected driver is drawn the owner's navigation.
        role: active ? (session.role ?? active.membership.role) : null,
        memberships: rows.map(toMembershipSummary),
        session: toAuthSession(session),
      }
    })
  }

  /**
   * DOS-102: what each of this login's distributors is owed, last billed and is sending.
   *
   * The membership list is read as the system actor (the same cross-tenant read `me` does); every
   * FIGURE is then read inside `withTenant` under the caller's own id and that membership's role, so
   * RLS narrows it exactly as it would after `switchTenant`. Nothing here mints a token, opens a
   * session or writes an `auth_events` row: it is a read.
   */
  async membershipsSummary(auth: AuthClaims): Promise<MembershipsSummary> {
    const db = requireDb(this.db)
    const rows = await withSystem(db, async (tx) => {
      const now = new Date()
      await liveSession(tx, auth, now)
      const user = await findUserById(tx, auth.userId)
      if (!user) throw signInRequired()
      if (user.status !== 'active') throw noAccess()
      return (await loadMemberships(tx, user.id)).map((row): SummaryMembership => ({
        tenantId: row.membership.tenantId,
        tenantSlug: row.tenant.slug,
        displayName: row.branding.displayName,
        logoUrl: row.branding.logoUrl,
        role: row.membership.role,
        extraRoles: wireExtraRoles(row),
        status: row.membership.status,
      }))
    })
    return membershipsSummary(db, auth.userId, rows)
  }

  async sessions(auth: AuthClaims): Promise<SessionsList> {
    const db = requireDb(this.db)
    return withSystem(db, async (tx) => {
      const now = new Date()
      await liveSession(tx, auth, now)
      const rows = await tx
        .select()
        .from(authSessions)
        .where(
          and(
            eq(authSessions.userId, auth.userId),
            isNull(authSessions.revokedAt),
            gt(authSessions.refreshExpiresAt, now),
          ),
        )
        .orderBy(desc(authSessions.lastUsedAt), desc(authSessions.id))
      return {
        items: rows.map((row) => ({ ...toAuthSession(row), current: row.id === auth.sessionId })),
      }
    })
  }

  async revokeSession(
    auth: AuthClaims,
    input: RevokeSessionIn,
    client: ClientInfo,
  ): Promise<AuthOk> {
    const db = requireDb(this.db)
    await withSystem(db, async (tx) => {
      const now = new Date()
      await liveSession(tx, auth, now)
      const [target] = await tx
        .select()
        .from(authSessions)
        .where(and(eq(authSessions.id, input.sessionId), eq(authSessions.userId, auth.userId)))
        .limit(1)
      if (!target) throw new ORPCError('NOT_FOUND', { message: 'No such session on this account' })
      if (target.revokedAt) return
      await revokeSession(tx, target.id, 'user_revoked', now)
      await logEvent(tx, {
        userId: auth.userId,
        tenantId: target.tenantId,
        kind: 'session_revoked',
        client,
      })
    })
    return { ok: true }
  }

  async changePassword(
    auth: AuthClaims,
    input: ChangePasswordIn,
    client: ClientInfo,
  ): Promise<ChangePasswordOut> {
    const db = requireDb(this.db)
    const problem = validatePassword(input.newPassword)
    if (problem) throw new ORPCError('BAD_REQUEST', { message: problem })
    // docs/22 §8 (2026-09-29): keeping the password a desk gave is not choosing one's own — the desk
    // would still know it. The current password is checked below, so equal strings mean the same one.
    if (input.newPassword === input.currentPassword) {
      throw new ORPCError('BAD_REQUEST', { message: SAME_PASSWORD })
    }
    const keys = await loadAuthKeys()
    const outcome = await withSystem(db, async (tx): Promise<Outcome<ChangePasswordOut>> => {
      const now = new Date()
      await liveSession(tx, auth, now)
      const user = await findUserById(tx, auth.userId)
      if (!user?.passwordHash) return fail(signInRequired())
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        return fail(new ORPCError('UNAUTHORIZED', { message: 'Current password is incorrect' }))
      }
      await tx
        .update(users)
        .set({
          passwordHash: await hashPassword(input.newPassword),
          passwordChangedAt: now,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(users.id, user.id))
      // Every OTHER device is signed out; the device that changed the password keeps its session.
      await tx
        .update(authSessions)
        .set({ revokedAt: now, revokedReason: 'password_changed' })
        .where(
          and(
            eq(authSessions.userId, user.id),
            ne(authSessions.id, auth.sessionId),
            isNull(authSessions.revokedAt),
          ),
        )
      await logEvent(tx, {
        userId: user.id,
        tenantId: auth.tenantId,
        kind: 'password_changed',
        client,
      })
      // The token this device held says "must change the password" (platform/first-password.ts);
      // the same session gets one that does not, so the next call goes through without a refresh.
      const { accessTtlSeconds } = authTtl()
      const access = await signAccessToken(
        {
          userId: auth.userId,
          tenantId: auth.tenantId,
          role: auth.role,
          sessionId: auth.sessionId,
          deviceId: auth.deviceId,
          mustChangePassword: false,
        },
        keys,
        accessTtlSeconds,
        now,
      )
      return ok({
        ok: true as const,
        accessToken: access.token,
        tokenType: 'Bearer' as const,
        accessExpiresIn: accessTtlSeconds,
      })
    })
    return unwrap(outcome)
  }

  // ---------------------------------------------------------------- self-service reset (docs/23 §8.12)

  /**
   * Always `ok`: whether the username exists is never revealed on the wire. When it does, a signed
   * reset token (30 minutes, bound to the current password hash so it works exactly once) is handed
   * to the delivery channel. THE CHANNEL IS NOT BUILT YET — SMS / WhatsApp is the OTP layer docs/22 §7
   * defers to the notifications module — so `deliverResetToken` logs the token outside production
   * and does nothing in production. No table is involved (docs/23 §8.12's "hashed token store" is
   * unnecessary: the signature and the password fingerprint give single use without state).
   */
  async forgotPassword(input: ForgotPasswordIn, client: ClientInfo): Promise<AuthOk> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    const username = normalizeUsername(input.username)
    await withSystem(db, async (tx) => {
      const now = new Date()
      // Abuse control on the same table OTPs will use: five requests per username per hour, and per
      // caller IP per hour; past that the call still answers ok and issues nothing.
      const allowed =
        (await underResetLimit(tx, `reset:user:${username}`, now)) &&
        (await underResetLimit(tx, `reset:ip:${client.ip ?? 'unknown'}`, now))
      if (!allowed) return
      const user = await findUserByUsername(tx, username)
      if (!user || user.status !== 'active') return
      const reset = await signResetToken(
        { userId: user.id, passwordHash: user.passwordHash },
        keys,
        now,
      )
      deliverResetToken({
        username,
        phone: user.phone,
        token: reset.token,
        expiresAt: reset.expiresAt,
      })
    })
    return { ok: true }
  }

  /**
   * Exchange a reset token for a new password. The token must verify, be unexpired, and carry the
   * fingerprint of the password that is STILL current — a second use after a successful reset (or a
   * token issued before the owner reset the password by hand) is refused. Every session of the user
   * is revoked; the lockout counter is cleared.
   */
  async resetPassword(input: ResetPasswordIn, client: ClientInfo): Promise<AuthOk> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    const problem = validatePassword(input.newPassword)
    if (problem) throw new ORPCError('BAD_REQUEST', { message: problem })
    // A string that is not even token-shaped is the caller's mistake (400); a well-formed token that
    // fails its signature, has expired or was already used is 401, as the contract says.
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.token))
      throw new ORPCError('BAD_REQUEST', { message: 'token is not a password reset token' })
    const claims = await verifyResetToken(input.token, keys)
    if (!claims) throw resetInvalid()
    const outcome = await withSystem(db, async (tx): Promise<Outcome<AuthOk>> => {
      const now = new Date()
      const user = await findUserById(tx, claims.userId)
      if (!user || user.status !== 'active') return fail(resetInvalid())
      if (passwordFingerprint(user.passwordHash) !== claims.fingerprint) return fail(resetInvalid())
      // The same rule as `changePassword`: a desk's first password cannot be kept by resetting to it.
      if (user.passwordHash && (await verifyPassword(user.passwordHash, input.newPassword)))
        return fail(new ORPCError('BAD_REQUEST', { message: SAME_PASSWORD }))
      await tx
        .update(users)
        .set({
          passwordHash: await hashPassword(input.newPassword),
          passwordChangedAt: now,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: now,
        })
        .where(eq(users.id, user.id))
      await tx
        .update(authSessions)
        .set({ revokedAt: now, revokedReason: 'password_reset' })
        .where(and(eq(authSessions.userId, user.id), isNull(authSessions.revokedAt)))
      await logEvent(tx, {
        userId: user.id,
        username: user.username,
        kind: 'password_changed',
        client,
      })
      return ok({ ok: true as const })
    })
    return unwrap(outcome)
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= hashPassword(uuidv7())
    return this.dummyHash
  }
}

/** Five reset requests per key per hour (`otp_rate_limits`, the OTP layer's own abuse table). */
const RESET_REQUESTS_PER_HOUR = 5

async function underResetLimit(tx: Db, key: string, now: Date): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000)
  const [row] = await tx
    .insert(otpRateLimits)
    .values({ key, windowStart, attempts: 1 })
    .onConflictDoUpdate({
      target: [otpRateLimits.key, otpRateLimits.windowStart],
      set: { attempts: sql`${otpRateLimits.attempts} + 1` },
    })
    .returning({ attempts: otpRateLimits.attempts })
  return (row?.attempts ?? 1) <= RESET_REQUESTS_PER_HOUR
}

const resetInvalid = () =>
  new ORPCError('UNAUTHORIZED', {
    message: 'This reset link is invalid or has expired. Ask for a new one.',
  })

/**
 * Where a reset token goes. Until the notifications module owns the SMS / WhatsApp channel this is
 * the service log — and only outside production, where a token in a log would be a leak. The shape
 * is the one the channel will take: username, phone, token, expiry.
 */
function deliverResetToken(i: {
  username: string
  phone: string
  token: string
  expiresAt: Date
}): void {
  if (process.env.NODE_ENV === 'production') return
  console.warn(
    `[auth] password reset for ${i.username} (${i.phone}), valid until ${i.expiresAt.toISOString()} — no delivery channel yet; token: ${i.token}`,
  )
}

// ------------------------------------------------------------------ the shopkeeper's own account

/**
 * Sign-ups per client address and per number, per hour. The address limit is loose on purpose: Indian mobile
 * networks put many phones behind one address (carrier NAT), and a market's shops sign up from the same few.
 */
export const SIGN_UPS_PER_ADDRESS_PER_HOUR = 20
export const SIGN_UPS_PER_NUMBER_PER_HOUR = 5
/** Shop codes one account may try per hour: a code only asks, but a guess must not walk the platform's shops. */
export const CODES_PER_HOUR = 30
/** Requests to join one account may file per hour. */
export const ASKS_PER_HOUR = 20

/**
 * One more try under `key` this clock hour (`otp_rate_limits`, the abuse table the reset already uses); true while
 * the count is within `limit`. The caller commits it in a transaction of its own.
 */
async function underHourlyLimit(tx: Db, key: string, limit: number, now: Date): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000)
  const [row] = await tx
    .insert(otpRateLimits)
    .values({ key, windowStart, attempts: 1 })
    .onConflictDoUpdate({
      target: [otpRateLimits.key, otpRateLimits.windowStart],
      set: { attempts: sql`${otpRateLimits.attempts} + 1` },
    })
    .returning({ attempts: otpRateLimits.attempts })
  return (row?.attempts ?? 1) <= limit
}

/**
 * A SHOPKEEPER'S ACCOUNT: one the person made themselves (`signUp`), or one whose every membership is a shop's (a
 * desk-given shopkeeper sign-in, which the person now owns). Such an account may sign in with no distributor, ask to
 * be joined to shops and leave distributors; a work login may not.
 */
function isShopkeeperAccount(user: UserRow, rows: readonly MembershipRow[]): boolean {
  if (rows.some((r) => r.membership.role !== 'retailer')) return false
  return user.signedUpAt !== null || rows.length > 0
}

/** Is this distributor one a shopkeeper may find by name (`shops.listed_for_joining` not switched off)? */
async function isListed(tx: Db, tenantId: string): Promise<boolean> {
  const [off] = await tx
    .select({ value: tenantSettings.value })
    .from(tenantSettings)
    .where(
      and(
        eq(tenantSettings.tenantId, tenantId),
        eq(tenantSettings.key, TENANT_SETTING_KEYS.shopsListedForJoining),
      ),
    )
    .limit(1)
  return off?.value !== false
}

/**
 * The distributors a shopkeeper may find by name: active, and not switched off from the list; by the name the
 * distributor shows (`branding.display_name`, else its legal name), filtered by `q`, bounded by `limit`.
 */
async function listedDistributors(
  tx: Db,
  q: string,
  limit: number,
): Promise<{ tenantId: string; name: string }[]> {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const result = await tx.execute(
    sql`SELECT t.id AS "tenantId",
               COALESCE(NULLIF(btrim(d.value #>> '{}'), ''), t.legal_name) AS "name"
          FROM tenants t
          LEFT JOIN tenant_settings d
            ON d.tenant_id = t.id AND d.key = ${TENANT_SETTING_KEYS.brandingDisplayName}
          LEFT JOIN tenant_settings l
            ON l.tenant_id = t.id AND l.key = ${TENANT_SETTING_KEYS.shopsListedForJoining}
         WHERE t.status = 'active'
           AND (l.value IS NULL OR l.value <> 'false'::jsonb)
           AND COALESCE(NULLIF(btrim(d.value #>> '{}'), ''), t.legal_name) ILIKE ${pattern}
         ORDER BY 2, 1
         LIMIT ${limit}`,
  )
  return (result.rows as { tenantId: string; name: string }[]).map((r) => ({
    tenantId: r.tenantId,
    name: r.name,
  }))
}

interface NewAccountSession {
  user: UserRow
  deviceId: string
  deviceName: string | null
  platform: 'web' | 'android' | 'ios'
  client: ClientInfo
  now: Date
}

/**
 * A session of the shopkeeper's account with no distributor: `tenant_id` and `role` null, as a console session's
 * are — what tells the two apart is the `platform_admins` row a console account has and a shopkeeper does not. One
 * live session per device and person, as at every sign-in.
 */
async function openAccountSession(tx: Db, s: NewAccountSession): Promise<CreatedSession> {
  await tx
    .insert(devices)
    .values({ id: s.deviceId, userId: s.user.id, platform: s.platform, lastSeenAt: s.now })
    .onConflictDoUpdate({
      target: devices.id,
      set: { userId: s.user.id, platform: s.platform, lastSeenAt: s.now, updatedAt: s.now },
    })
  await tx
    .update(authSessions)
    .set({ revokedAt: s.now, revokedReason: 'replaced' })
    .where(
      and(
        eq(authSessions.userId, s.user.id),
        eq(authSessions.deviceId, s.deviceId),
        isNull(authSessions.revokedAt),
      ),
    )
  return createPlatformSession(tx, s)
}

/** The account's own pair: no `tid` and no `role` in the token, `tenant` and `role` null on the reply. */
async function issueAccountPair(
  keys: AuthKeys,
  user: UserRow,
  rows: readonly MembershipRow[],
  session: CreatedSession,
  now: Date,
): Promise<AccountTokenPair> {
  const { accessTtlSeconds } = authTtl()
  const access = await signAccessToken(
    {
      userId: user.id,
      tenantId: null,
      role: null,
      sessionId: session.row.id,
      deviceId: session.row.deviceId,
      mustChangePassword: user.mustChangePassword,
    },
    keys,
    accessTtlSeconds,
    now,
  )
  return {
    accessToken: access.token,
    tokenType: 'Bearer',
    accessExpiresIn: accessTtlSeconds,
    refreshToken: session.refresh.token,
    refreshExpiresAt: session.row.refreshExpiresAt.toISOString(),
    user: toAuthUser(user),
    tenant: null,
    role: null,
    memberships: rows.map(toMembershipSummary),
  }
}

/**
 * Refresh a session of the shopkeeper's account with no distributor. When a distributor has approved since, the
 * session MOVES onto it (the first active one, in the order the memberships were made) and the answer is a pair on
 * that distributor's shop — "the next sign-in or refresh lands on the shop front". Otherwise the account's own pair,
 * rotated like every refresh. A person who is no longer a shopkeeper's account is signed out.
 */
async function refreshAccount(
  tx: Db,
  keys: AuthKeys,
  a: {
    session: SessionRow
    user: UserRow
    rows: MembershipRow[]
    presentedHash: string
    client: ClientInfo
    now: Date
  },
): Promise<Outcome<SignInPair>> {
  const { session, user, rows, now } = a
  if (!isShopkeeperAccount(user, rows)) {
    await revokeSession(tx, session.id, 'membership_disabled', now)
    return fail(noAccess())
  }
  const next = rows.find((r) => r.membership.status === 'active' && r.tenant.status === 'active')
  const refresh = newRefreshToken()
  const rotated = {
    ...session,
    tenantId: next ? next.membership.tenantId : null,
    role: next ? next.membership.role : null,
    refreshExpiresAt: refreshExpiry(now),
    lastUsedAt: now,
  }
  await tx
    .update(authSessions)
    .set({
      tenantId: rotated.tenantId,
      role: rotated.role,
      refreshTokenHash: refresh.hash,
      previousRefreshTokenHash: a.presentedHash,
      refreshExpiresAt: rotated.refreshExpiresAt,
      lastUsedAt: now,
      ip: a.client.ip,
      userAgent: a.client.userAgent,
    })
    .where(eq(authSessions.id, session.id))
  await logEvent(tx, {
    userId: user.id,
    tenantId: rotated.tenantId,
    kind: 'refresh',
    client: a.client,
  })
  if (next) {
    return ok(
      await issuePair(keys, user, next, rows, { row: rotated, refresh }, now, next.membership.role),
    )
  }
  return ok(await issueAccountPair(keys, user, rows, { row: rotated, refresh }, now))
}

// ------------------------------------------------------------------ transaction helpers

async function findUserByUsername(tx: Db, username: string): Promise<UserRow | undefined> {
  // lower(username) hits the partial unique index users_username_idx.
  const [row] = await tx
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = ${username}`)
    .limit(1)
  return row
}

async function findUserById(tx: Db, id: string): Promise<UserRow | undefined> {
  const [row] = await tx.select().from(users).where(eq(users.id, id)).limit(1)
  return row
}

/** Every membership of the user with its tenant, oldest first (the default when no tenant is asked for). */
async function loadMemberships(tx: Db, userId: string): Promise<MembershipRow[]> {
  const rows = await tx
    .select({ membership: memberships, tenant: tenants })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt), asc(memberships.id))
  const branding = await loadBranding(
    tx,
    rows.map((r) => r.tenant),
  )
  return rows.map((r) => ({
    ...r,
    branding: branding.get(r.tenant.id) ?? { displayName: r.tenant.legalName, logoUrl: null },
  }))
}

/**
 * The white-label name and logo of each tenant (docs/17 §D6): `branding.display_name` and a signed
 * link to `branding.logo_object_key`, read as the system role because sign-in is not tenant-scoped.
 * One query for every membership, so a shopkeeper linked to three distributors costs three signed
 * URLs and one SELECT. A tenant without a logo answers null; a storage fault never breaks sign-in.
 */
async function loadBranding(
  tx: Db,
  rows: readonly (typeof tenants.$inferSelect)[],
): Promise<Map<string, TenantBranding>> {
  const out = new Map<string, TenantBranding>()
  if (rows.length === 0) return out
  const ids = [...new Set(rows.map((t) => t.id))]
  const settings = await tx
    .select({
      tenantId: tenantSettings.tenantId,
      key: tenantSettings.key,
      value: tenantSettings.value,
    })
    .from(tenantSettings)
    .where(
      and(
        inArray(tenantSettings.tenantId, ids),
        inArray(tenantSettings.key, [
          TENANT_SETTING_KEYS.brandingDisplayName,
          TENANT_SETTING_KEYS.brandingLogoObjectKey,
        ]),
      ),
    )
  const byTenant = new Map<string, Map<string, unknown>>()
  for (const s of settings) {
    const map = byTenant.get(s.tenantId) ?? new Map<string, unknown>()
    map.set(s.key, s.value)
    byTenant.set(s.tenantId, map)
  }
  for (const tenant of rows) {
    if (out.has(tenant.id)) continue
    const map = byTenant.get(tenant.id)
    const displayName =
      asText(map?.get(TENANT_SETTING_KEYS.brandingDisplayName)) ?? tenant.legalName
    const logoKey = asText(map?.get(TENANT_SETTING_KEYS.brandingLogoObjectKey))
    out.set(tenant.id, {
      displayName,
      logoUrl: logoKey === null ? null : await signedLogoUrl(logoKey),
    })
  }
  return out
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

async function signedLogoUrl(key: string): Promise<string | null> {
  try {
    return await createObjectStorage().getUrl(key, LOGO_URL_TTL_SECONDS)
  } catch (error) {
    if (error instanceof ObjectStorageError) return null
    throw error
  }
}

/** Matches the current hash or the previous one, so a rotated-away token can be recognised as reuse. */
async function findSessionByHash(tx: Db, hash: string): Promise<SessionRow | undefined> {
  const [row] = await tx
    .select()
    .from(authSessions)
    .where(
      or(eq(authSessions.refreshTokenHash, hash), eq(authSessions.previousRefreshTokenHash, hash)),
    )
    .limit(1)
  return row
}

interface ValidRefresh {
  session: SessionRow
  user: UserRow
  rows: MembershipRow[]
  presentedHash: string
}

/**
 * Shared by refresh and switchTenant. Reuse of an already-rotated token revokes the whole session
 * (the token leaked, or two copies of the app are racing) and the caller must sign in again.
 */
async function validateRefresh(
  tx: Db,
  refreshToken: string,
  deviceId: string,
  client: ClientInfo,
  now: Date,
): Promise<Outcome<ValidRefresh>> {
  const presentedHash = hashRefreshToken(refreshToken)
  const session = await findSessionByHash(tx, presentedHash)
  if (!session) return fail(sessionExpired())
  if (session.refreshTokenHash !== presentedHash) {
    if (!session.revokedAt) await revokeSession(tx, session.id, 'refresh_reuse', now)
    await logEvent(tx, {
      userId: session.userId,
      tenantId: session.tenantId,
      kind: 'refresh_reuse_detected',
      client,
    })
    return fail(sessionExpired())
  }
  if (session.revokedAt || session.refreshExpiresAt <= now || session.deviceId !== deviceId) {
    return fail(sessionExpired())
  }
  const user = await findUserById(tx, session.userId)
  if (!user) return fail(sessionExpired())
  if (user.status !== 'active') {
    await revokeSession(tx, session.id, 'user_disabled', now)
    return fail(noAccess())
  }
  const rows = await loadMemberships(tx, user.id)
  return ok({ session, user, rows, presentedHash })
}

/** The session named by an access token must still be alive; otherwise the token is as good as expired. */
async function liveSession(tx: Db, auth: AuthClaims, now: Date): Promise<SessionRow> {
  const [session] = await tx
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.id, auth.sessionId), eq(authSessions.userId, auth.userId)))
    .limit(1)
  if (!session || session.revokedAt || session.refreshExpiresAt <= now) throw signInRequired()
  return session
}

async function revokeSession(tx: Db, id: string, reason: string, now: Date): Promise<void> {
  await tx
    .update(authSessions)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(authSessions.id, id), isNull(authSessions.revokedAt)))
}

interface NewSession {
  user: UserRow
  membership: MembershipRow
  /** The ELECTED role (docs/29 §2): the membership's own unless the device asked for another. */
  role: MembershipRole
  deviceId: string
  deviceName: string | null
  platform: 'web' | 'android' | 'ios'
  client: ClientInfo
  now: Date
}

interface CreatedSession {
  row: SessionRow
  refresh: ReturnType<typeof newRefreshToken>
}

async function createSession(tx: Db, s: NewSession): Promise<CreatedSession> {
  const refresh = newRefreshToken()
  const [row] = await tx
    .insert(authSessions)
    .values({
      id: uuidv7(),
      userId: s.user.id,
      tenantId: s.membership.membership.tenantId,
      role: s.role,
      deviceId: s.deviceId,
      deviceName: s.deviceName,
      platform: s.platform,
      refreshTokenHash: refresh.hash,
      previousRefreshTokenHash: null,
      refreshExpiresAt: refreshExpiry(s.now),
      lastUsedAt: s.now,
      ip: s.client.ip,
      userAgent: s.client.userAgent,
      createdAt: s.now,
    })
    .returning()
  if (!row)
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'session insert returned nothing' })
  return { row, refresh }
}

/**
 * Is this global identity one of Distribution OS's own, still working here — and at which console
 * LEVEL (module 13, DOS-106)? Null when it is not an active console account. The level goes on the
 * sign-in and refresh replies and on `platformMe`, never into the access token: admin-service re-reads
 * it on every console call.
 */
async function platformAdminLevel(tx: Db, userId: string): Promise<PlatformAdminLevel | null> {
  const [row] = await tx
    .select({ level: platformAdmins.role })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, userId), isNull(platformAdmins.disabledAt)))
    .limit(1)
  return row?.level ?? null
}

interface NewPlatformSession {
  user: UserRow
  deviceId: string
  deviceName: string | null
  platform: 'web' | 'android' | 'ios'
  client: ClientInfo
  now: Date
}

/**
 * A console session row: same table, same rotation, same revocation — with `tenant_id` and `role`
 * left NULL, because `auth_sessions.role` is the MEMBERSHIP enum and `platform_admin` is deliberately
 * not one of its values. What makes the session a console session is the `platform_admins` row, which
 * every refresh re-reads; nothing about the privilege is cached in this row.
 */
async function createPlatformSession(tx: Db, s: NewPlatformSession): Promise<CreatedSession> {
  const refresh = newRefreshToken()
  const [row] = await tx
    .insert(authSessions)
    .values({
      id: uuidv7(),
      userId: s.user.id,
      tenantId: null,
      role: null,
      deviceId: s.deviceId,
      deviceName: s.deviceName,
      platform: s.platform,
      refreshTokenHash: refresh.hash,
      previousRefreshTokenHash: null,
      refreshExpiresAt: refreshExpiry(s.now),
      lastUsedAt: s.now,
      ip: s.client.ip,
      userAgent: s.client.userAgent,
      createdAt: s.now,
    })
    .returning()
  if (!row)
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'session insert returned nothing' })
  return { row, refresh }
}

/**
 * The console's token pair: `role: 'platform_admin'`, and NO `tid` — the whole point of the shape. The
 * console LEVEL rides on the reply beside the role (DOS-106) and deliberately NOT in the token's claims:
 * admin-service re-reads it on every call, so the token never carries a privilege that could go stale.
 */
async function issuePlatformPair(
  keys: AuthKeys,
  user: UserRow,
  session: CreatedSession,
  level: PlatformAdminLevel,
  now: Date,
): Promise<PlatformTokenPair> {
  const { accessTtlSeconds } = authTtl()
  const access = await signAccessToken(
    {
      userId: user.id,
      tenantId: null,
      role: 'platform_admin',
      sessionId: session.row.id,
      deviceId: session.row.deviceId,
      // A first password is a first password for the console too (platform/first-password.ts).
      mustChangePassword: user.mustChangePassword,
    },
    keys,
    accessTtlSeconds,
    now,
  )
  return {
    accessToken: access.token,
    tokenType: 'Bearer',
    accessExpiresIn: accessTtlSeconds,
    refreshToken: session.refresh.token,
    refreshExpiresAt: session.row.refreshExpiresAt.toISOString(),
    user: toAuthUser(user),
    role: 'platform_admin',
    level,
  }
}

function refreshExpiry(now: Date): Date {
  return new Date(now.getTime() + authTtl().refreshTtlDays * 86_400_000)
}

async function issuePair(
  keys: AuthKeys,
  user: UserRow,
  membership: MembershipRow,
  rows: MembershipRow[],
  session: CreatedSession,
  now: Date,
  /** The ELECTED role (docs/29 §2). `sub` stays the person; this is only what they act as. */
  electedRole: MembershipRole,
): Promise<TokenPair> {
  const { accessTtlSeconds } = authTtl()
  const role = electedRole
  const access = await signAccessToken(
    {
      userId: user.id,
      tenantId: membership.membership.tenantId,
      role,
      sessionId: session.row.id,
      deviceId: session.row.deviceId,
      // Read from the user row at every sign-in, refresh and switch, so the claim follows the
      // password: set while a desk's first password is the one in use, gone once the person chose.
      mustChangePassword: user.mustChangePassword,
    },
    keys,
    accessTtlSeconds,
    now,
  )
  return {
    accessToken: access.token,
    tokenType: 'Bearer',
    accessExpiresIn: accessTtlSeconds,
    refreshToken: session.refresh.token,
    refreshExpiresAt: session.row.refreshExpiresAt.toISOString(),
    user: toAuthUser(user),
    tenant: toAuthTenant(membership),
    role,
    memberships: rows.map(toMembershipSummary),
  }
}

interface EventInput {
  userId: string | null
  username?: string | null
  tenantId?: string | null
  kind: AuthEventKind
  /** docs/29 §2: the role this sign-in elected, when it was not the membership's own. */
  actedAs?: MembershipRole | null
  client: ClientInfo
}

async function logEvent(tx: Db, e: EventInput): Promise<void> {
  await tx.insert(authEvents).values({
    id: uuidv7(),
    userId: e.userId,
    usernameAttempted: e.username ?? null,
    tenantId: e.tenantId ?? null,
    kind: e.kind,
    actedAs: e.actedAs ?? null,
    ip: e.client.ip,
    userAgent: e.client.userAgent,
  })
}

// ------------------------------------------------------------------ mappers

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    locale: row.locale as AuthUser['locale'],
    mustChangePassword: row.mustChangePassword,
  }
}

function toAuthTenant(row: MembershipRow): AuthTenant {
  return {
    id: row.tenant.id,
    slug: row.tenant.slug,
    legalName: row.tenant.legalName,
    displayName: row.branding.displayName,
    logoUrl: row.branding.logoUrl,
  }
}

/**
 * docs/31 ruling B5 — the membership's `extra_roles`, as the device's chooser lists them. The column
 * is what `electRole` grants from, so the list the person is offered and the list the server grants
 * are one list. A retailer membership is always `[]`: the contract refuses an extra role on a shop
 * before the column is written, and the wire says so rather than leaving the field off.
 */
function wireExtraRoles(row: MembershipRow): MembershipSummary['extraRoles'] {
  return row.membership.role === 'retailer' ? [] : [...row.membership.extraRoles]
}

function toMembershipSummary(row: MembershipRow): MembershipSummary {
  return {
    tenantId: row.membership.tenantId,
    tenantSlug: row.tenant.slug,
    tenantName: row.tenant.legalName,
    displayName: row.branding.displayName,
    logoUrl: row.branding.logoUrl,
    role: row.membership.role,
    extraRoles: wireExtraRoles(row),
    status: row.membership.status,
  }
}

function toAuthSession(row: SessionRow): AuthSession {
  return {
    id: row.id,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    platform: row.platform,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
  }
}
