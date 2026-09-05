import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { and, asc, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm'
import type {
  AuthMe,
  AuthOk,
  AuthSession,
  AuthTenant,
  AuthUser,
  ChangePasswordIn,
  LoginIn,
  LogoutIn,
  MembershipSummary,
  RefreshIn,
  RevokeSessionIn,
  SessionsList,
  SwitchTenantIn,
  TokenPair,
} from '@dos/contracts'
import {
  authEvents,
  authSessions,
  devices,
  hashPassword,
  memberships,
  normalizeUsername,
  tenants,
  users,
  validatePassword,
  verifyPassword,
  withSystem,
  type authEventKind,
  type Db,
} from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { DB, loadAuthKeys, requireDb, type AuthKeys } from '../../platform/index.js'
import { SIGN_IN_REQUIRED, type AuthClaims } from './auth-context.js'
import { authTtl, hashRefreshToken, newRefreshToken, signAccessToken } from './tokens.js'

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

/** Where the request came from, recorded on sessions and events. */
export interface ClientInfo {
  ip: string | null
  userAgent: string | null
}

type AuthEventKind = (typeof authEventKind.enumValues)[number]
type UserRow = typeof users.$inferSelect
type SessionRow = typeof authSessions.$inferSelect
type MembershipRow = {
  membership: typeof memberships.$inferSelect
  tenant: typeof tenants.$inferSelect
}

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

  async login(input: LoginIn, client: ClientInfo): Promise<TokenPair> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    const username = normalizeUsername(input.username)
    const outcome = await withSystem(db, async (tx): Promise<Outcome<TokenPair>> => {
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
        client,
      })
      return ok(await issuePair(keys, user, chosen, rows, session, now))
    })
    return unwrap(outcome)
  }

  async refresh(input: RefreshIn, client: ClientInfo): Promise<TokenPair> {
    const db = requireDb(this.db)
    const keys = await loadAuthKeys()
    const outcome = await withSystem(db, async (tx): Promise<Outcome<TokenPair>> => {
      const now = new Date()
      const valid = await validateRefresh(tx, input.refreshToken, input.deviceId, client, now)
      if (!valid.ok) return valid
      const { session, user, rows, presentedHash } = valid.value
      const current = rows.find((r) => r.membership.tenantId === session.tenantId)
      if (!current || current.membership.status !== 'active') {
        await revokeSession(tx, session.id, 'membership_disabled', now)
        return fail(noAccess())
      }
      const refresh = newRefreshToken()
      const rotated = {
        ...session,
        role: current.membership.role,
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
      await logEvent(tx, { userId: user.id, tenantId: session.tenantId, kind: 'refresh', client })
      return ok(await issuePair(keys, user, current, rows, { row: rotated, refresh }, now))
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
      const target = rows.find((r) => r.membership.tenantId === input.tenantId)
      if (!target || target.membership.status !== 'active')
        return fail(noAccess(notAMember(input.tenantId)))
      await revokeSession(tx, session.id, 'tenant_switched', now)
      const next = await createSession(tx, {
        user,
        membership: target,
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
        client,
      })
      return ok(await issuePair(keys, user, target, rows, next, now))
    })
    return unwrap(outcome)
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
        tenant: active ? toAuthTenant(active.tenant) : null,
        role: active?.membership.role ?? null,
        memberships: rows.map(toMembershipSummary),
        session: toAuthSession(session),
      }
    })
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
  ): Promise<AuthOk> {
    const db = requireDb(this.db)
    const problem = validatePassword(input.newPassword)
    if (problem) throw new ORPCError('BAD_REQUEST', { message: problem })
    const outcome = await withSystem(db, async (tx): Promise<Outcome<AuthOk>> => {
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
      return ok({ ok: true as const })
    })
    return unwrap(outcome)
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= hashPassword(uuidv7())
    return this.dummyHash
  }
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
  return tx
    .select({ membership: memberships, tenant: tenants })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt), asc(memberships.id))
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
      role: s.membership.membership.role,
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
): Promise<TokenPair> {
  const { accessTtlSeconds } = authTtl()
  const role = membership.membership.role
  const access = await signAccessToken(
    {
      userId: user.id,
      tenantId: membership.membership.tenantId,
      role,
      sessionId: session.row.id,
      deviceId: session.row.deviceId,
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
    tenant: toAuthTenant(membership.tenant),
    role,
    memberships: rows.map(toMembershipSummary),
  }
}

interface EventInput {
  userId: string | null
  username?: string | null
  tenantId?: string | null
  kind: AuthEventKind
  client: ClientInfo
}

async function logEvent(tx: Db, e: EventInput): Promise<void> {
  await tx.insert(authEvents).values({
    id: uuidv7(),
    userId: e.userId,
    usernameAttempted: e.username ?? null,
    tenantId: e.tenantId ?? null,
    kind: e.kind,
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

function toAuthTenant(row: typeof tenants.$inferSelect): AuthTenant {
  return { id: row.id, slug: row.slug, legalName: row.legalName }
}

function toMembershipSummary(row: MembershipRow): MembershipSummary {
  return {
    tenantId: row.membership.tenantId,
    tenantSlug: row.tenant.slug,
    tenantName: row.tenant.legalName,
    role: row.membership.role,
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
