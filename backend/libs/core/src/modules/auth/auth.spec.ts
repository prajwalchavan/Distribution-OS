import { and, desc, eq } from 'drizzle-orm'
import { decodeProtectedHeader, jwtVerify } from 'jose'
import { uuidv7 } from '@dos/domain'
import {
  authEvents,
  authSessions,
  createDb,
  createPool,
  hashPassword,
  invoices,
  locations,
  memberships,
  retailerIdentities,
  retailerLinks,
  retailerOutstandingSummary,
  retailers,
  tenants,
  tenantSettings,
  tripStops,
  trips,
  users,
  vehicles,
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
  tenant: { id: string; slug: string; legalName: string; displayName: string }
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

  // -------------------------------------------------------------------------------------------------------------
  // DOS-102 — one home for every distributor this login buys from

  interface DuesRow {
    tenantId: string
    tenantSlug: string
    displayName: string
    role: string
    outstandingPaise: number
    overduePaise: number
    openBills: number
    lastReceiptAt: string | null
    lastReceiptPaise: number | null
    lastBill: { invoiceNo: string | null; invoiceDate: string; totalPaise: number } | null
    onTheWay: { stops: number; state: string; etaAt: string | null } | null
  }
  interface SummaryBody {
    items: DuesRow[]
    totalOutstandingPaise: number
    totalOverduePaise: number
  }

  const shopUser = `shop.${run}`
  const shopId = uuidv7()
  const tP = uuidv7()
  const tQ = uuidv7()
  const tR = uuidv7()
  const tS = uuidv7()
  const tX = uuidv7()
  const rP = uuidv7()
  const rP2 = uuidv7()
  const rQ = uuidv7()
  const rX = uuidv7()

  /**
   * DOS-102 fixtures: one shopkeeper login that buys from two distributors (P and Q), works at a
   * third (R, as a manager), was cut off by a fourth (S, membership disabled) and has nothing at all
   * to do with a fifth (X, which carries its own dues for its own shop).
   *
   * Inside P there is also a SECOND shop (rP2) this login is not linked to — the neighbour on the
   * same street, on the same distributor's book and even on the same van. Everything about it is
   * bigger and newer than this shop's, so any read that forgot to scope WITHIN the tenant shows up
   * as a wrong number rather than as nothing at all.
   */
  async function seedMembershipsSummaryFixtures(): Promise<void> {
    const passwordHash = await hashPassword(password)
    const base = Date.now() - 300_000
    await db.insert(tenants).values([
      { id: tP, slug: `ms-p-${run}`, legalName: 'Pilot Distributors', stateCode: '27' },
      { id: tQ, slug: `ms-q-${run}`, legalName: 'Quay Traders', stateCode: '27' },
      { id: tR, slug: `ms-r-${run}`, legalName: 'Rampart Agencies', stateCode: '27' },
      { id: tS, slug: `ms-s-${run}`, legalName: 'Sunset Traders', stateCode: '27' },
      { id: tX, slug: `ms-x-${run}`, legalName: 'Xavier Stores', stateCode: '27' },
    ])
    await db.insert(users).values({
      id: shopId,
      phone: `+919${run}7`,
      name: 'Ramesh',
      username: shopUser,
      passwordHash,
    })
    await db.insert(memberships).values([
      {
        id: uuidv7(),
        tenantId: tP,
        userId: shopId,
        role: 'retailer',
        createdAt: new Date(base),
      },
      {
        id: uuidv7(),
        tenantId: tQ,
        userId: shopId,
        role: 'retailer',
        createdAt: new Date(base + 1_000),
      },
      {
        id: uuidv7(),
        tenantId: tR,
        userId: shopId,
        role: 'manager',
        createdAt: new Date(base + 2_000),
      },
      {
        id: uuidv7(),
        tenantId: tS,
        userId: shopId,
        role: 'retailer',
        status: 'disabled',
        createdAt: new Date(base + 3_000),
      },
    ])
    await db.insert(retailers).values([
      {
        id: rP,
        tenantId: tP,
        code: `MS${run}P`,
        name: 'Ramesh Kirana',
        phone: `+919${run}7`,
        stateCode: '27',
      },
      {
        id: rP2,
        tenantId: tP,
        code: `MS${run}P2`,
        name: 'Neighbour Stores',
        phone: `+919${run}9`,
        stateCode: '27',
      },
      {
        id: rQ,
        tenantId: tQ,
        code: `MS${run}Q`,
        name: 'Ramesh Kirana',
        phone: `+919${run}7`,
        stateCode: '27',
      },
      {
        id: rX,
        tenantId: tX,
        code: `MS${run}X`,
        name: 'Someone else',
        phone: `+919${run}8`,
        stateCode: '27',
      },
    ])
    const identity = uuidv7()
    await db
      .insert(retailerIdentities)
      .values({ id: identity, phone: `+919${run}7`, userId: shopId, shopName: 'Ramesh Kirana' })
    await db.insert(retailerLinks).values([
      {
        id: uuidv7(),
        tenantId: tP,
        identityId: identity,
        retailerId: rP,
        userId: shopId,
        role: 'owner',
        linkedBy: 'rep_onboarding',
        status: 'active',
      },
      {
        id: uuidv7(),
        tenantId: tQ,
        identityId: identity,
        retailerId: rQ,
        userId: shopId,
        role: 'owner',
        linkedBy: 'rep_onboarding',
        status: 'active',
      },
    ])
    await db.insert(retailerOutstandingSummary).values([
      {
        tenantId: tP,
        retailerId: rP,
        outstandingPaise: 3_584_300,
        overduePaise: 2_000_000,
        openBills: 4,
        lastReceiptAt: new Date('2026-09-09T06:30:00.000Z'),
        lastReceiptPaise: 500_000,
        asOf: '2026-09-13',
      },
      // The neighbour's book, inside the SAME distributor. Nothing of it may reach this login.
      {
        tenantId: tP,
        retailerId: rP2,
        outstandingPaise: 7_777_700,
        overduePaise: 7_777_700,
        openBills: 9,
        lastReceiptAt: new Date('2026-09-12T06:30:00.000Z'),
        lastReceiptPaise: 900_000,
        asOf: '2026-09-13',
      },
      {
        tenantId: tQ,
        retailerId: rQ,
        outstandingPaise: 2_647_000,
        overduePaise: 0,
        openBills: 7,
        asOf: '2026-09-13',
      },
      // The tenant this login has nothing to do with: its dues must never reach the summary.
      {
        tenantId: tX,
        retailerId: rX,
        outstandingPaise: 9_999_900,
        overduePaise: 9_999_900,
        openBills: 11,
        asOf: '2026-09-13',
      },
    ])
    await db.insert(invoices).values([
      {
        id: uuidv7(),
        tenantId: tP,
        invoiceNo: `MS/${run}/1`,
        fy: '2026-27',
        invoiceDate: '2026-09-10',
        retailerId: rP,
        state: 'issued',
        buyerName: 'Ramesh Kirana',
        placeOfSupplyState: '27',
        totalPaise: 123_400,
      },
      // A draft bill is not a bill the shop has: newer, and it must NOT be answered as the last one.
      {
        id: uuidv7(),
        tenantId: tP,
        invoiceNo: null,
        fy: '2026-27',
        invoiceDate: '2026-09-12',
        retailerId: rP,
        state: 'draft',
        buyerName: 'Ramesh Kirana',
        placeOfSupplyState: '27',
        totalPaise: 777_700,
      },
      // The neighbour's bill: issued, newer and larger, so an unscoped "latest bill" answers IT.
      {
        id: uuidv7(),
        tenantId: tP,
        invoiceNo: `MS/${run}/2`,
        fy: '2026-27',
        invoiceDate: '2026-09-11',
        retailerId: rP2,
        state: 'issued',
        buyerName: 'Neighbour Stores',
        placeOfSupplyState: '27',
        totalPaise: 4_560_000,
      },
    ])
    const locationId = uuidv7()
    const vehicleId = uuidv7()
    const tripId = uuidv7()
    await db
      .insert(locations)
      .values({ id: locationId, tenantId: tP, kind: 'vehicle', name: `Tempo ${run}` })
    await db
      .insert(vehicles)
      .values({ id: vehicleId, tenantId: tP, regNo: `MH-${run}`, locationId })
    await db
      .insert(trips)
      .values({ id: tripId, tenantId: tP, tripDate: '2026-09-13', vehicleId, state: 'active' })
    await db.insert(tripStops).values([
      {
        id: uuidv7(),
        tenantId: tP,
        tripId,
        sequence: 1,
        retailerId: rP,
        state: 'started',
        etaAt: new Date('2026-09-13T09:00:00.000Z'),
      },
      // A stop that has already been delivered is not "on the way".
      {
        id: uuidv7(),
        tenantId: tP,
        tripId,
        sequence: 2,
        retailerId: rP,
        state: 'delivered',
      },
      // The neighbour is on the SAME van and further along ('arrived' beats 'started'), so an
      // unscoped read would tell this shop a van is at its door.
      {
        id: uuidv7(),
        tenantId: tP,
        tripId,
        sequence: 3,
        retailerId: rP2,
        state: 'arrived',
        etaAt: new Date('2026-09-13T08:00:00.000Z'),
      },
    ])
  }

  it('DOS-102: memberships.summary answers dues, last bill and on-the-way per active membership, totals them, answers zeros for a staff membership, omits a disabled membership, and never a tenant the user does not belong to', async () => {
    await seedMembershipsSummaryFixtures()
    const pair = await login(shopUser, password, { deviceId: deviceTwo })
    expect(pair.status).toBe(200)
    const res = await bearer<SummaryBody>(pair.body.accessToken, 'GET', '/auth/memberships/summary')
    expect(res.status).toBe(200)
    const slugs = res.body.items.map((i) => i.tenantSlug)
    expect(slugs).toEqual([`ms-p-${run}`, `ms-q-${run}`, `ms-r-${run}`])

    const p = res.body.items.find((i) => i.tenantId === tP)
    expect(p?.displayName).toBe('Pilot Distributors')
    expect(p?.role).toBe('retailer')
    expect(p?.outstandingPaise).toBe(3_584_300)
    expect(p?.overduePaise).toBe(2_000_000)
    expect(p?.openBills).toBe(4)
    expect(p?.lastReceiptPaise).toBe(500_000)
    expect(p?.lastBill).toEqual({
      invoiceNo: `MS/${run}/1`,
      invoiceDate: '2026-09-10',
      totalPaise: 123_400,
    })
    expect(p?.onTheWay?.stops).toBe(1)
    expect(p?.onTheWay?.state).toBe('started')
    expect(p?.onTheWay?.etaAt).not.toBeNull()

    const q = res.body.items.find((i) => i.tenantId === tQ)
    expect(q?.outstandingPaise).toBe(2_647_000)
    expect(q?.openBills).toBe(7)
    expect(q?.lastBill).toBeNull()
    expect(q?.onTheWay).toBeNull()
    expect(q?.lastReceiptAt).toBeNull()

    // A membership that is not a shop's answers nothing about money: a manager does not "owe" its tenant.
    const r = res.body.items.find((i) => i.tenantId === tR)
    expect(r?.role).toBe('manager')
    expect(r?.outstandingPaise).toBe(0)
    expect(r?.overduePaise).toBe(0)
    expect(r?.openBills).toBe(0)
    expect(r?.lastBill).toBeNull()
    expect(r?.onTheWay).toBeNull()

    // The totals are the shop's own, across its distributors, and nothing else's.
    expect(res.body.totalOutstandingPaise).toBe(3_584_300 + 2_647_000)
    expect(res.body.totalOverduePaise).toBe(2_000_000)
    expect(res.body.items.some((i) => i.tenantId === tX)).toBe(false)
    expect(res.body.items.some((i) => i.tenantId === tS)).toBe(false)
  })

  it("DOS-102: inside one distributor the summary reads only this login's own shop — the neighbour's dues, bill and van never leak", async () => {
    /*
     * THE GUARANTEE THE WHOLE READ RESTS ON.
     *
     * `membershipsSummary` runs each tenant's three reads under the caller's own actor id and the
     * role of THAT membership, so RLS (tenantOrOwnRetailerPolicy via retailer_links.user_id) narrows
     * them to the shops this login is actually linked to. Tenant isolation is not enough here: the
     * neighbour shop lives in the SAME tenant, on the same book and the same van. If the composer
     * ever passed a back-office role, or a helper took the tenant's totals instead of the caller's,
     * every assertion below moves — the shop would be shown someone else's money.
     */
    const pair = await login(shopUser, password, { deviceId: deviceTwo })
    expect(pair.status).toBe(200)
    const res = await bearer<SummaryBody>(pair.body.accessToken, 'GET', '/auth/memberships/summary')
    expect(res.status).toBe(200)

    // The neighbour's rows really are there to be leaked — otherwise this test passes on nothing.
    const neighbour = await db
      .select()
      .from(retailerOutstandingSummary)
      .where(
        and(
          eq(retailerOutstandingSummary.tenantId, tP),
          eq(retailerOutstandingSummary.retailerId, rP2),
        ),
      )
    expect(neighbour).toHaveLength(1)
    expect(neighbour[0]?.outstandingPaise).toBe(7_777_700)

    const p = res.body.items.find((i) => i.tenantId === tP)
    // Money: this shop's own book, not the two shops summed (which would read 1,13,620.00).
    expect(p?.outstandingPaise).toBe(3_584_300)
    expect(p?.overduePaise).toBe(2_000_000)
    expect(p?.openBills).toBe(4)
    expect(p?.lastReceiptPaise).toBe(500_000)
    // The last bill is this shop's, not the neighbour's newer, larger one.
    expect(p?.lastBill?.invoiceNo).toBe(`MS/${run}/1`)
    expect(p?.lastBill?.totalPaise).toBe(123_400)
    // The van: one stop, still on its way — not the neighbour's 'arrived'.
    expect(p?.onTheWay?.stops).toBe(1)
    expect(p?.onTheWay?.state).toBe('started')
    // And the totals carry the same narrowed figures.
    expect(res.body.totalOutstandingPaise).toBe(3_584_300 + 2_647_000)
    expect(res.body.totalOverduePaise).toBe(2_000_000)
  })

  it('DOS-102: the summary needs a Bearer access token (401 without) and writes no session or auth event', async () => {
    const anonymous = await bearer<ErrorBody>(null, 'GET', '/auth/memberships/summary')
    expect(anonymous.status).toBe(401)
    const pair = await login(shopUser, password, { deviceId: deviceTwo })
    const sessionsBefore = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, shopId))
    const eventsBefore = await db.select().from(authEvents).where(eq(authEvents.userId, shopId))
    expect((await bearer(pair.body.accessToken, 'GET', '/auth/memberships/summary')).status).toBe(
      200,
    )
    const sessionsAfter = await db
      .select()
      .from(authSessions)
      .where(eq(authSessions.userId, shopId))
    const eventsAfter = await db.select().from(authEvents).where(eq(authEvents.userId, shopId))
    expect(sessionsAfter).toHaveLength(sessionsBefore.length)
    expect(eventsAfter).toHaveLength(eventsBefore.length)
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

  /**
   * docs/29 §2 actAs at login and switch-tenant — role election, downward only (founder 2026-09-21).
   *
   * The device asks for the role it needs; the auth service grants it only downward. What is proven
   * here is the whole of the auth half: the token claim, the session row, the audit row, the refusal
   * sentence, what a refresh does with an elected role, and that `sub` never stops being the person.
   */
  describe('docs/29 §2 actAs at login and switch-tenant', () => {
    // Its own people: every user above has had its password changed, its account locked or its
    // membership disabled by an earlier test, and an election test must not depend on which.
    const driverId = uuidv7()
    const driver = `driver.${run}`
    /** What the refusal sentence names: the distributor's own white-label name, as the app shows it. */
    let brandA = ''
    let brandB = ''

    beforeAll(async () => {
      await db.insert(users).values({
        id: driverId,
        phone: `+919${run}4`,
        name: 'Driver',
        username: driver,
        passwordHash: await hashPassword(password),
      })
      await db
        .insert(memberships)
        .values({ id: uuidv7(), tenantId: tenantA, userId: driverId, role: 'delivery' })
      await db
        .update(memberships)
        .set({ status: 'active', extraRoles: [] })
        .where(eq(memberships.id, bobMembershipId))
      const a = await login(bob, password, { deviceId: uuidv7() })
      brandA = a.body.tenant.displayName
      const b = await login(alice, password, { tenantId: tenantB, deviceId: uuidv7() })
      brandB = b.body.tenant.displayName
    })

    const claims = async (accessToken: string) => {
      const keys = await loadAuthKeys()
      const { payload } = await jwtVerify(accessToken, keys.publicKey, {
        issuer: AUTH_ISSUER,
        audience: AUTH_AUDIENCE,
        algorithms: ['EdDSA'],
      })
      return payload
    }

    it('gives the owner who drives today a DELIVERY token, still signed as himself', async () => {
      const device = uuidv7()
      const res = await login(alice, password, { actAs: 'delivery', deviceId: device })
      expect(res.status).toBe(200)
      expect(res.body.role).toBe('delivery')

      const payload = await claims(res.body.accessToken)
      expect(payload.role).toBe('delivery')
      // The person never changes: every actor id, audit row, receipt and delivery is still alice's.
      expect(payload.sub).toBe(aliceId)
      expect(payload.tid).toBe(tenantA)

      // The session row carries the elected role, which is what a refresh reads back.
      const [session] = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.id, payload.sid as string))
      expect(session?.role).toBe('delivery')

      // The membership is untouched: the staff list still shows an owner.
      expect(res.body.memberships.find((m) => m.tenantId === tenantA)?.role).toBe('owner')

      // The owner can see it happened.
      const [event] = await db
        .select()
        .from(authEvents)
        .where(and(eq(authEvents.userId, aliceId), eq(authEvents.kind, 'login_ok')))
        .orderBy(desc(authEvents.createdAt))
        .limit(1)
      expect(event?.actedAs).toBe('delivery')
    })

    it('refuses a salesperson who asks for delivery, with the sentence docs/29 §2 states', async () => {
      const device = uuidv7()
      await db
        .update(memberships)
        .set({ status: 'active' })
        .where(eq(memberships.id, bobMembershipId))
      const res = await login(bob, password, { actAs: 'delivery', deviceId: device })
      expect(res.status).toBe(403)
      expect(res.body.message).toBe(
        `Your login at ${brandA} is a salesperson; ask the owner to add delivery to it.`,
      )
      // Never a silent downgrade: no session was opened at all.
      expect(res.body.accessToken).toBeUndefined()
      const [event] = await db
        .select()
        .from(authEvents)
        .where(and(eq(authEvents.userId, bobId), eq(authEvents.kind, 'login_failed')))
        .orderBy(desc(authEvents.createdAt))
        .limit(1)
      expect(event?.actedAs).toBe('delivery')
    })

    it('grants it once the owner adds delivery to that membership, and takes it back again', async () => {
      const device = uuidv7()
      await db
        .update(memberships)
        .set({ extraRoles: ['delivery'] })
        .where(eq(memberships.id, bobMembershipId))
      const granted = await login(bob, password, { actAs: 'delivery', deviceId: device })
      expect(granted.status).toBe(200)
      expect(granted.body.role).toBe('delivery')
      expect((await claims(granted.body.accessToken)).sub).toBe(bobId)

      // A refresh keeps the elected role rather than quietly handing back the membership's own.
      const rolled = await refresh(granted.body.refreshToken, device)
      expect(rolled.status).toBe(200)
      expect(rolled.body.role).toBe('delivery')

      // The owner takes the extra role away: the session stops at the next refresh, and says why.
      await db
        .update(memberships)
        .set({ extraRoles: [] })
        .where(eq(memberships.id, bobMembershipId))
      const stopped = await refresh(rolled.body.refreshToken, device)
      expect(stopped.status).toBe(403)
      expect(stopped.body.message).toBe(
        `Your login at ${brandA} is a salesperson; ask the owner to add delivery to it.`,
      )
      expect((await refresh(rolled.body.refreshToken, device)).status).toBe(401)
    })

    it('never elects upward, sideways out of the table, or out of the shop', async () => {
      const refused = async (username: string, actAs: string) => {
        const res = await login(username, password, { actAs, deviceId: uuidv7() })
        return res.status
      }
      // A manager may not become the accountant (the table's second row stops at the three field roles).
      expect(await refused(alice, 'retailer')).toBe(403)
      // The driver may not become the manager.
      expect(await refused(driver, 'manager')).toBe(403)
      expect(await refused(driver, 'accountant')).toBe(403)
      // Its own role is always granted, with or without the field.
      const own = await login(driver, password, { actAs: 'delivery', deviceId: uuidv7() })
      expect(own.status).toBe(200)
      expect(own.body.role).toBe('delivery')
      const [event] = await db
        .select()
        .from(authEvents)
        .where(and(eq(authEvents.userId, driverId), eq(authEvents.kind, 'login_ok')))
        .orderBy(desc(authEvents.createdAt))
        .limit(1)
      // Asking for the role you already are is not an election: nothing to show the owner.
      expect(event?.actedAs).toBeNull()
    })

    it('elects against the membership of the distributor being switched TO', async () => {
      const device = uuidv7()
      const start = await login(alice, password, { deviceId: device })
      expect(start.body.role).toBe('owner')
      // alice is a MANAGER at tenant B, so there she may elect salesperson but not accountant.
      const switched = await call<Pair & ErrorBody>(app, null, 'POST', '/auth/switch-tenant', {
        refreshToken: start.body.refreshToken,
        deviceId: device,
        tenantId: tenantB,
        actAs: 'salesperson',
      })
      expect(switched.status).toBe(200)
      expect(switched.body.role).toBe('salesperson')
      expect(switched.body.tenant.id).toBe(tenantB)
      expect((await claims(switched.body.accessToken)).sub).toBe(aliceId)

      const back = await login(alice, password, { deviceId: device })
      const denied = await call<Pair & ErrorBody>(app, null, 'POST', '/auth/switch-tenant', {
        refreshToken: back.body.refreshToken,
        deviceId: device,
        tenantId: tenantB,
        actAs: 'accountant',
      })
      expect(denied.status).toBe(403)
      expect(denied.body.message).toBe(
        `Your login at ${brandB} is a manager; ask the owner to add accountant to it.`,
      )
    })

    it('tells /auth/me the role the session ACTS AS, so the shell and the token agree', async () => {
      const device = uuidv7()
      const res = await login(alice, password, { actAs: 'warehouse', deviceId: device })
      expect(res.body.role).toBe('warehouse')
      const me = await bearer<{ role: string; memberships: { tenantId: string; role: string }[] }>(
        res.body.accessToken,
        'GET',
        '/auth/me',
      )
      expect(me.status).toBe(200)
      expect(me.body.role).toBe('warehouse')
      expect(me.body.memberships.find((m) => m.tenantId === tenantA)?.role).toBe('owner')
    })
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
