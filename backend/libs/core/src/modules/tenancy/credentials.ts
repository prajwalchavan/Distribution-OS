import { and, eq, isNull, sql } from 'drizzle-orm'
import { ORPCError } from '@orpc/server'
import { uuidv7 } from '@dos/domain'
import {
  authEvents,
  authSessions,
  hashPassword,
  normalizeUsername,
  users,
  validatePassword,
  validateUsername,
  type Db,
} from '@dos/db'

/**
 * WHAT A DESK MAY DO TO A PERSON'S SIGN-IN: make one with a first password, give a new first password,
 * sign the person out of one distributor. One copy for the two desks that do it — the staff screen
 * (`tenancy.staff.*`) and the shop's page (`retailers.signIn.*`, DOS-400) — so a shopkeeper's login
 * is made exactly as a staff login is: the same username rules, the same password rules, the same
 * argon2id hash, the same "choose your own at the first sign-in", the same `auth_events`.
 *
 * `users`, `auth_sessions` and `auth_events` are global tables an onboarder cannot write for somebody
 * else under `app_rw` (`users_self_update`, `auth_sessions_own`), so every function here takes a
 * SYSTEM transaction (`withSystem`), opened only after the caller has checked who may do it.
 *
 * A first password arrives in the request and leaves this file only as a hash: it is never returned,
 * never logged, never put in an audit row, an outbox event or the idempotency store.
 */

/** The password rules every login shares; a 400 with the rule the desk broke. Hashed off any transaction. */
export async function firstPasswordHash(plain: string): Promise<string> {
  const problem = validatePassword(plain)
  if (problem) throw new ORPCError('BAD_REQUEST', { message: problem })
  return hashPassword(plain)
}

/** The username rules every login shares, normalised; a 400 with the rule the desk broke. */
export function checkedUsername(raw: string): string {
  const username = normalizeUsername(raw)
  const problem = validateUsername(username)
  if (problem) throw new ORPCError('BAD_REQUEST', { message: problem })
  return username
}

export interface SignInRow {
  id: string
  username: string | null
  hasPassword: boolean
  status: 'active' | 'disabled'
}

const signInColumns = {
  id: users.id,
  username: users.username,
  passwordHash: users.passwordHash,
  status: users.status,
}

function toSignIn(row: {
  id: string
  username: string | null
  passwordHash: string | null
  status: 'active' | 'disabled'
}): SignInRow {
  return {
    id: row.id,
    username: row.username,
    hasPassword: row.passwordHash !== null,
    status: row.status,
  }
}

export async function signInByPhone(sys: Db, phone: string): Promise<SignInRow | null> {
  const [row] = await sys.select(signInColumns).from(users).where(eq(users.phone, phone)).limit(1)
  return row ? toSignIn(row) : null
}

export async function signInById(sys: Db, id: string): Promise<SignInRow | null> {
  const [row] = await sys.select(signInColumns).from(users).where(eq(users.id, id)).limit(1)
  return row ? toSignIn(row) : null
}

/** A person who can actually sign in: a username and a password. */
export function isUsable(row: SignInRow | null): row is SignInRow & { username: string } {
  return row !== null && row.username !== null && row.hasPassword
}

/**
 * A free username made from a name (DOS-400, when the desk does not choose one): the shopkeeper's name
 * on the shop, else the shop's own — the first two words, lower case, joined by a dot, the way staff
 * usernames read: `Ramesh Gupta` → `ramesh.gupta`, then `ramesh.gupta2` … when taken. A name with no
 * Latin letters (written in Devanagari) falls back to `shop.` and the last four digits of the phone.
 * Always inside the username rules.
 */
export async function freeUsername(sys: Db, name: string, phone: string): Promise<string> {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
  let base = words.slice(0, 2).join('.').slice(0, 24).replace(/\.+$/, '')
  if (base.length < 3) base = `shop.${phone.slice(-4)}`
  const candidates = [base, ...Array.from({ length: 8 }, (_, i) => `${base}${String(i + 2)}`)]
  for (let tries = 0; tries < 5; tries += 1) {
    candidates.push(`${base}${String(100 + Math.floor(Math.random() * 900))}`)
  }
  for (const candidate of candidates) {
    if (validateUsername(candidate) !== null) continue
    const [taken] = await sys
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${candidate}`)
      .limit(1)
    if (!taken) return candidate
  }
  throw new ORPCError('CONFLICT', {
    message: 'Could not find a free username for this shop. Enter one and try again.',
  })
}

/**
 * Record that a desk set this person's password (`password_set_by_admin`), for the tenant it was set
 * from. The event carries who and where, never the password.
 */
export async function noteFirstPassword(
  sys: Db,
  input: { userId: string; tenantId: string },
): Promise<void> {
  await sys.insert(authEvents).values({
    id: uuidv7(),
    userId: input.userId,
    tenantId: input.tenantId,
    kind: 'password_set_by_admin',
  })
}

/**
 * A new first password (they forgot theirs, or the phone was lost): clears the lockout counter,
 * forces a change at the next sign-in and signs the person out EVERYWHERE, so a stolen refresh token
 * dies here. The event says a desk did it.
 */
export async function setFirstPassword(
  sys: Db,
  input: { userId: string; tenantId: string; passwordHash: string },
): Promise<void> {
  const now = new Date()
  await sys
    .update(users)
    .set({
      passwordHash: input.passwordHash,
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
  await noteFirstPassword(sys, input)
}

/**
 * Sign a person out of ONE distributor: every live session of theirs for this tenant is revoked, and
 * the trail records it when there was one to revoke. Their sessions with any other distributor stay.
 */
export async function revokeTenantSessions(
  sys: Db,
  input: { userId: string; tenantId: string },
): Promise<void> {
  const now = new Date()
  const revoked = await sys
    .update(authSessions)
    .set({ revokedAt: now, revokedReason: 'membership_disabled' })
    .where(
      and(
        eq(authSessions.userId, input.userId),
        eq(authSessions.tenantId, input.tenantId),
        isNull(authSessions.revokedAt),
      ),
    )
    .returning({ id: authSessions.id })
  if (revoked.length > 0) {
    await sys.insert(authEvents).values({
      id: uuidv7(),
      userId: input.userId,
      tenantId: input.tenantId,
      kind: 'session_revoked',
    })
  }
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e.code === '23505' || e.cause?.code === '23505'
}
