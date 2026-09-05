import { and, eq } from 'drizzle-orm'
import { decodeProtectedHeader, jwtVerify } from 'jose'
import { uuidv7 } from '@dos/domain'
import {
  authEvents,
  authSessions,
  createDb,
  createPool,
  hashPassword,
  memberships,
  tenants,
  tenantSettings,
  users,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AUTH_AUDIENCE, AUTH_ISSUER, loadAuthKeys } from '../../platform/index.js'
import { bootTestApp, call } from '../../testing/app.js'
import { AuthModule } from './index.js'
import { signResetToken } from './tokens.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface Pair {
  accessToken: string
  tokenType: string
  accessExpiresIn: number
  refreshToken: string
  refreshExpiresAt: string
  user: { id: string; username: string | null; mustChangePassword: boolean }
  tenant: { id: string; slug: string; legalName: string }
  role: string
  memberships: { tenantId: string; role: string; status: string }[]
}
interface ErrorBody {
  message: string
  code?: string
  status?: number
}

describeDb('auth (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const password = 'Secret123'
  const tenantA = uuidv7()
  const tenantB = uuidv7()
  const aliceId = uuidv7()
  const bobId = uuidv7()
  const carolId = uuidv7()
  const alice = `alice.${run}`
  const bob = `bob.${run}`
  const carol = `carol.${run}`
  const bobMembershipId = uuidv7()
  const deviceOne = uuidv7()
  const deviceTwo = uuidv7()
  let app: NestFastifyApplication

  beforeAll(async () => {
    const passwordHash = await hashPassword(password)
    await db.insert(tenants).values([
      { id: tenantA, slug: `auth-a-${run}`, legalName: 'Auth Tenant A', stateCode: '27' },
      { id: tenantB, slug: `auth-b-${run}`, legalName: 'Auth Tenant B', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: aliceId, phone: `+919${run}1`, name: 'Alice', username: alice, passwordHash },
      { id: bobId, phone: `+919${run}2`, name: 'Bob', username: bob, passwordHash },
      { id: carolId, phone: `+919${run}3`, name: 'Carol', username: carol, passwordHash },
    ])
    // alice's oldest membership is tenant A (owner); tenant B (manager) came later
    const t0 = new Date(Date.now() - 60_000)
    const t1 = new Date(Date.now() - 30_000)
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId: tenantA, userId: aliceId, role: 'owner', createdAt: t0 },
      { id: uuidv7(), tenantId: tenantB, userId: aliceId, role: 'manager', createdAt: t1 },
      { id: bobMembershipId, tenantId: tenantA, userId: bobId, role: 'salesperson' },
      { id: uuidv7(), tenantId: tenantA, userId: carolId, role: 'delivery' },
    ])
    app = await bootTestApp([AuthModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const login = (username: string, pass: string, extra: Record<string, unknown> = {}) =>
    call<Pair & ErrorBody>(app, null, 'POST', '/auth/login', {
      username,
      password: pass,
      deviceId: deviceOne,
      deviceName: 'Test phone',
      platform: 'android',
      ...extra,
    })

  const refresh = (refreshToken: string, deviceId = deviceOne) =>
    call<Pair & ErrorBody>(app, null, 'POST', '/auth/refresh', { refreshToken, deviceId })

  /** The harness's `call` only knows placeholder actor headers; auth endpoints carry a Bearer token. */
  async function bearer<T>(
    token: string | null,
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token !== null) headers.authorization = `Bearer ${token}`
    const res = await app.inject({
      method,
      url: path,
      headers,
      ...(method === 'POST' ? { payload: JSON.stringify(payload ?? {}) } : {}),
    })
    return { status: res.statusCode, body: res.json<T>() }
  }

  it('signs alice in, returns a token pair, the first membership and every membership', async () => {
    const res = await login(alice, password)
    expect(res.status).toBe(200)
    expect(res.body.tokenType).toBe('Bearer')
    expect(res.body.accessExpiresIn).toBeGreaterThan(0)
    expect(res.body.user.id).toBe(aliceId)
    expect(res.body.user.username).toBe(alice)
    expect(res.body.user.mustChangePassword).toBe(false)
    expect(res.body.tenant.id).toBe(tenantA) // oldest membership wins when no tenant is asked for
    expect(res.body.role).toBe('owner')
    expect(res.body.memberships.map((m) => m.tenantId).sort()).toEqual([tenantA, tenantB].sort())
    expect(res.body.refreshToken).toHaveLength(43)
    expect(new Date(res.body.refreshExpiresAt).getTime()).toBeGreaterThan(Date.now())

    const keys = await loadAuthKeys()
    const { payload } = await jwtVerify(res.body.accessToken, keys.publicKey, {
      issuer: AUTH_ISSUER,
      audience: AUTH_AUDIENCE,
      algorithms: ['EdDSA'],
    })
    expect(payload.sub).toBe(aliceId)
    expect(payload.tid).toBe(tenantA)
    expect(payload.role).toBe('owner')
    expect(payload.did).toBe(deviceOne)
    expect(typeof payload.sid).toBe('string')
    expect(typeof payload.jti).toBe('string')
    expect(decodeProtectedHeader(res.body.accessToken).kid).toBe(keys.kid)

    // the session row holds only the sha256 of the refresh token, never the token
    const [session] = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.id, payload.sid as string))
    expect(session?.refreshTokenHash).toHaveLength(64)
    expect(session?.refreshTokenHash).not.toBe(res.body.refreshToken)
    expect(session?.deviceName).toBe('Test phone')
    expect(session?.platform).toBe('android')

    const events = await db
      .select()
      .from(authEvents)
      .where(and(eq(authEvents.userId, aliceId), eq(authEvents.kind, 'login_ok')))
    expect(events.length).toBeGreaterThan(0)
  })

  it('normalises the username and can sign into a chosen tenant', async () => {
    const res = await login(`  ${alice.toUpperCase()} `, password, { tenantId: tenantB })
    expect(res.status).toBe(200)
    expect(res.body.tenant.id).toBe(tenantB)
    expect(res.body.role).toBe('manager')
  })

  it('names the real problem when tenantId is a distributor the user does not belong to', async () => {
    // The sample uuid an API console pre-fills into the optional tenantId used to come back as
    // "this account is disabled", which sends the operator hunting the wrong fault.
    const stranger = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
    const res = await login(alice, password, { tenantId: stranger })
    expect(res.status).toBe(403)
    expect(res.body.message).toContain(stranger)
    expect(res.body.message).toContain('Omit tenantId')
    expect(res.body.message).not.toContain('disabled')
    // and the same credentials without tenantId still work
    expect((await login(alice, password)).status).toBe(200)
  })

  it('answers a wrong password and an unknown username with the same 401', async () => {
    const wrong = await login(alice, 'Nope12345')
    const unknown = await login(`nobody.${run}`, password)
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.body.message).toBe('Invalid username or password')
    expect(unknown.body.message).toBe(wrong.body.message)
    // the failed attempt for an unknown name is still on record, with what was typed
    const [event] = await db
      .select()
      .from(authEvents)
      .where(eq(authEvents.usernameAttempted, `nobody.${run}`))
    expect(event?.kind).toBe('login_failed')
    expect(event?.userId).toBeNull()
  })

  it('locks the account after five consecutive failures (423) and refuses even the right password', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await login(carol, 'Wrong1234')
      expect(res.status).toBe(401)
    }
    const fifth = await login(carol, 'Wrong1234')
    expect(fifth.status).toBe(423)
    expect(fifth.body.message).toMatch(/Try again in \d+ minutes?/)
    const stillLocked = await login(carol, password)
    expect(stillLocked.status).toBe(423)
    const [row] = await db.select().from(users).where(eq(users.id, carolId))
    expect(row?.failedLoginCount).toBe(5)
    expect(row?.lockedUntil?.getTime()).toBeGreaterThan(Date.now())
    const lockedEvents = await db
      .select()
      .from(authEvents)
      .where(and(eq(authEvents.userId, carolId), eq(authEvents.kind, 'locked')))
    expect(lockedEvents).toHaveLength(1)

    // an expired lock lets the right password in and resets the counter
    await db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, carolId))
    const back = await login(carol, password)
    expect(back.status).toBe(200)
    const [reset] = await db.select().from(users).where(eq(users.id, carolId))
    expect(reset?.failedLoginCount).toBe(0)
    expect(reset?.lockedUntil).toBeNull()
  })

  it('rotates the refresh token; reusing the old one revokes the whole session', async () => {
    const first = await login(alice, password)
    const second = await refresh(first.body.refreshToken)
    expect(second.status).toBe(200)
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken)
    expect(second.body.accessToken).not.toBe(first.body.accessToken)
    expect(second.body.tenant.id).toBe(tenantA)

    // the same device id is required
    const wrongDevice = await refresh(second.body.refreshToken, uuidv7())
    expect(wrongDevice.status).toBe(401)

    // presenting the already-rotated token is reuse: the session dies, the fresh token dies with it
    const reuse = await refresh(first.body.refreshToken)
    expect(reuse.status).toBe(401)
    expect(reuse.body.message).toBe('Session expired. Sign in again.')
    const after = await refresh(second.body.refreshToken)
    expect(after.status).toBe(401)
    const reuseEvents = await db
      .select()
      .from(authEvents)
      .where(and(eq(authEvents.userId, aliceId), eq(authEvents.kind, 'refresh_reuse_detected')))
    expect(reuseEvents.length).toBeGreaterThan(0)
    const me = await bearer<ErrorBody>(second.body.accessToken, 'GET', '/auth/me')
    expect(me.status).toBe(401) // the access token names a revoked session
  })

  it('logout revokes the session so the refresh token stops working; a second logout is harmless', async () => {
    const pair = await login(alice, password)
    const out = await call<{ ok: boolean }>(app, null, 'POST', '/auth/logout', {
      refreshToken: pair.body.refreshToken,
    })
    expect(out.status).toBe(200)
    expect(out.body.ok).toBe(true)
    const again = await refresh(pair.body.refreshToken)
    expect(again.status).toBe(401)
    const twice = await call<{ ok: boolean }>(app, null, 'POST', '/auth/logout', {
      refreshToken: pair.body.refreshToken,
    })
    expect(twice.body.ok).toBe(true)
    const unknown = await call<{ ok: boolean }>(app, null, 'POST', '/auth/logout', {
      refreshToken: 'x'.repeat(43),
    })
    expect(unknown.body.ok).toBe(true)
  })

  it('serves /auth/me with the access token and refuses without one', async () => {
    const pair = await login(alice, password)
    const me = await bearer<{
      user: { id: string }
      tenant: { id: string } | null
      role: string | null
      memberships: unknown[]
      session: { deviceId: string; platform: string }
    }>(pair.body.accessToken, 'GET', '/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user.id).toBe(aliceId)
    expect(me.body.tenant?.id).toBe(tenantA)
    expect(me.body.role).toBe('owner')
    expect(me.body.memberships).toHaveLength(2)
    expect(me.body.session.deviceId).toBe(deviceOne)

    const missing = await bearer<ErrorBody>(null, 'GET', '/auth/me')
    expect(missing.status).toBe(401)
    const garbage = await bearer<ErrorBody>('not.a.jwt', 'GET', '/auth/me')
    expect(garbage.status).toBe(401)
    const refreshAsAccess = await bearer<ErrorBody>(pair.body.refreshToken, 'GET', '/auth/me')
    expect(refreshAsAccess.status).toBe(401)
    // placeholder actor headers mean nothing here
    const headers = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { 'x-tenant-id': tenantA, 'x-actor-id': aliceId, 'x-actor-role': 'owner' },
    })
    expect(headers.statusCode).toBe(401)
  })

  it('lists sessions and lets the user sign out another device', async () => {
    const phone = await login(alice, password)
    const laptop = await login(alice, password, { deviceId: deviceTwo, platform: 'web' })
    const list = await bearer<{ items: { id: string; deviceId: string; current: boolean }[] }>(
      laptop.body.accessToken,
      'GET',
      '/auth/sessions',
    )
    expect(list.status).toBe(200)
    const ids = list.body.items.map((s) => s.deviceId)
    expect(ids).toContain(deviceOne)
    expect(ids).toContain(deviceTwo)
    expect(list.body.items.filter((s) => s.current).map((s) => s.deviceId)).toEqual([deviceTwo])

    const phoneSession = list.body.items.find((s) => s.deviceId === deviceOne)
    const revoked = await bearer<{ ok: boolean }>(
      laptop.body.accessToken,
      'POST',
      '/auth/sessions/revoke',
      { sessionId: phoneSession?.id },
    )
    expect(revoked.status).toBe(200)
    expect((await refresh(phone.body.refreshToken)).status).toBe(401)
    expect((await refresh(laptop.body.refreshToken, deviceTwo)).status).toBe(200)

    // a session id that is not yours
    const foreign = await bearer<ErrorBody>(
      (await login(bob, password)).body.accessToken,
      'POST',
      '/auth/sessions/revoke',
      { sessionId: phoneSession?.id },
    )
    expect(foreign.status).toBe(404)
  })

  it('changePassword keeps this session, revokes every other one and rejects the old password', async () => {
    const phone = await login(alice, password)
    const laptop = await login(alice, password, { deviceId: deviceTwo, platform: 'web' })
    const newPassword = 'Changed456'

    const wrongCurrent = await bearer<ErrorBody>(
      phone.body.accessToken,
      'POST',
      '/auth/change-password',
      { currentPassword: 'Nope12345', newPassword },
    )
    expect(wrongCurrent.status).toBe(401)
    const weak = await bearer<ErrorBody>(phone.body.accessToken, 'POST', '/auth/change-password', {
      currentPassword: password,
      newPassword: 'short',
    })
    expect(weak.status).toBe(400)

    const changed = await bearer<{ ok: boolean }>(
      phone.body.accessToken,
      'POST',
      '/auth/change-password',
      { currentPassword: password, newPassword },
    )
    expect(changed.status).toBe(200)
    expect((await refresh(laptop.body.refreshToken, deviceTwo)).status).toBe(401)
    expect((await refresh(phone.body.refreshToken)).status).toBe(200)
    expect((await login(alice, password)).status).toBe(401)
    const fresh = await login(alice, newPassword)
    expect(fresh.status).toBe(200)
    const [row] = await db.select().from(users).where(eq(users.id, aliceId))
    expect(row?.passwordChangedAt).not.toBeNull()
    expect(row?.mustChangePassword).toBe(false)

    // put the shared password back for the remaining tests
    const revert = await bearer<{ ok: boolean }>(
      fresh.body.accessToken,
      'POST',
      '/auth/change-password',
      { currentPassword: newPassword, newPassword: password },
    )
    expect(revert.status).toBe(200)
  })

  it('switches to another membership: new session and tokens, the old refresh token is dead', async () => {
    const pair = await login(alice, password)
    const switched = await call<Pair & ErrorBody>(app, null, 'POST', '/auth/switch-tenant', {
      refreshToken: pair.body.refreshToken,
      deviceId: deviceOne,
      tenantId: tenantB,
    })
    expect(switched.status).toBe(200)
    expect(switched.body.tenant.id).toBe(tenantB)
    expect(switched.body.role).toBe('manager')
    expect(switched.body.refreshToken).not.toBe(pair.body.refreshToken)
    const keys = await loadAuthKeys()
    const { payload } = await jwtVerify(switched.body.accessToken, keys.publicKey)
    expect(payload.tid).toBe(tenantB)
    expect(payload.role).toBe('manager')
    expect(payload.sid).not.toBe(
      (await jwtVerify(pair.body.accessToken, keys.publicKey)).payload.sid,
    )

    expect((await refresh(pair.body.refreshToken)).status).toBe(401)
    expect((await refresh(switched.body.refreshToken)).status).toBe(200)

    // bob has no membership in tenant B
    const bobPair = await login(bob, password)
    const denied = await call<ErrorBody>(app, null, 'POST', '/auth/switch-tenant', {
      refreshToken: bobPair.body.refreshToken,
      deviceId: deviceOne,
      tenantId: tenantB,
    })
    expect(denied.status).toBe(403)
  })

  it('carries the distributor display name and logo on the sign-in reply (white label, docs/17 §D6)', async () => {
    await db
      .insert(tenantSettings)
      .values({ tenantId: tenantA, key: 'branding.display_name', value: `Alice & Co ${run}` })
      .onConflictDoNothing()
    const res = await login(alice, password)
    expect(res.status).toBe(200)
    expect(res.body.tenant).toMatchObject({
      legalName: 'Auth Tenant A',
      displayName: `Alice & Co ${run}`,
      logoUrl: null,
    })
    const b = res.body.memberships.find((m) => m.tenantId === tenantB)
    expect(b).toMatchObject({
      tenantName: 'Auth Tenant B',
      displayName: 'Auth Tenant B',
      logoUrl: null,
    })
    const me = await bearer<{ tenant: { displayName: string } }>(
      res.body.accessToken,
      'GET',
      '/auth/me',
    )
    expect(me.body.tenant.displayName).toBe(`Alice & Co ${run}`)
  })

  it('resets a forgotten password with a single-use signed token and revokes every session', async () => {
    // forgotPassword never reveals whether the username exists
    expect(
      (await call(app, null, 'POST', '/auth/forgot-password', { username: `nobody.${run}` })).body,
    ).toEqual({ ok: true })
    const first = await login(carol, password)
    expect(first.status).toBe(200)
    expect(
      (await call(app, null, 'POST', '/auth/forgot-password', { username: carol })).body,
    ).toEqual({ ok: true })
    // the token travels by a channel that does not exist yet; here it is minted the way the service does
    const keys = await loadAuthKeys()
    const [row] = await db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, carolId))
    const { token } = await signResetToken(
      { userId: carolId, passwordHash: row?.hash ?? null },
      keys,
    )
    const malformed = await call<ErrorBody>(app, null, 'POST', '/auth/reset-password', {
      token: 'not-a-token-at-all-not-a-token-at-all',
      newPassword: 'Another123',
    })
    expect(malformed.status).toBe(400)
    const forged = await call<ErrorBody>(app, null, 'POST', '/auth/reset-password', {
      token: `${token.split('.')[0] ?? ''}.${'A'.repeat(86)}`,
      newPassword: 'Another123',
    })
    expect(forged.status).toBe(401)
    const reset = await call<ErrorBody>(app, null, 'POST', '/auth/reset-password', {
      token,
      newPassword: 'Another123',
    })
    expect(reset.body.message ?? '').toBe('')
    expect(reset.status).toBe(200)
    // every session is gone, the old password no longer works, the new one does
    expect((await refresh(first.body.refreshToken)).status).toBe(401)
    expect((await login(carol, password)).status).toBe(401)
    expect((await login(carol, 'Another123')).status).toBe(200)
    // single use: the fingerprint moved with the hash, so the same token is refused
    const again = await call(app, null, 'POST', '/auth/reset-password', {
      token,
      newPassword: 'Third123',
    })
    expect(again.status).toBe(401)
    expect((await login(carol, 'Another123')).status).toBe(200)
  })

  it('publishes the verifying key at /.well-known/jwks.json', async () => {
    const res = await call<{ keys: { kid: string; kty: string; alg: string; d?: string }[] }>(
      app,
      null,
      'GET',
      '/.well-known/jwks.json',
    )
    expect(res.status).toBe(200)
    const keys = await loadAuthKeys()
    expect(res.body.keys).toHaveLength(1)
    expect(res.body.keys[0]?.kid).toBe(keys.kid)
    expect(res.body.keys[0]?.kty).toBe('OKP')
    expect(res.body.keys[0]?.alg).toBe('EdDSA')
    expect(res.body.keys[0]?.d).toBeUndefined() // never the private half
  })

  it('refuses to refresh once the membership is disabled (403) and once the user is disabled', async () => {
    const pair = await login(bob, password)
    await db
      .update(memberships)
      .set({ status: 'disabled' })
      .where(eq(memberships.id, bobMembershipId))
    const denied = await refresh(pair.body.refreshToken)
    expect(denied.status).toBe(403)
    expect(denied.body.message).toBe('This account is disabled or has no active membership')
    // the session was revoked, not just refused
    expect((await refresh(pair.body.refreshToken)).status).toBe(401)
    // and a fresh sign-in is refused too: no active membership anywhere
    expect((await login(bob, password)).status).toBe(403)

    await db
      .update(memberships)
      .set({ status: 'active' })
      .where(eq(memberships.id, bobMembershipId))
    const again = await login(bob, password)
    expect(again.status).toBe(200)
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, bobId))
    expect((await refresh(again.body.refreshToken)).status).toBe(403)
    expect((await login(bob, password)).status).toBe(403)
    expect((await bearer<ErrorBody>(again.body.accessToken, 'GET', '/auth/me')).status).toBe(401)
  })
})
