import { and, eq, sql } from 'drizzle-orm'
import { allProcedures, contract } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  accounts,
  createDb,
  createPool,
  hashPassword,
  locations,
  memberships,
  numberingSeries,
  platformAdmins,
  platformAudit,
  retailers,
  subscriptions,
  supportGrants,
  tenants,
  users,
  withTenant,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AuthModule } from '../auth/index.js'
import { RetailersModule } from '../retailers/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { loadAuthKeys, signSupportPass } from '../../platform/index.js'
import { bearer, bootTestApp, call, platformBearer, type Actor } from '../../testing/app.js'
import { PlatformAdminModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const PASSWORD = 'Dos@1234'
const HOUR_MS = 60 * 60 * 1000

interface Grant {
  id: string
  status: string
  scope: string
  active: boolean
  expiresAt: string | null
}

/**
 * MODULE 13 — the platform console (founder decision 2026-09-05, docs/22 §2 row 7 and §8).
 *
 * The cases below are the founder's own words turned into behaviour: a distributor can be ONBOARDED
 * in one call and its owner can sign in to a bootstrapped distributorship; it can be SUSPENDED, and
 * then nobody who works there gets in; support access is TIME-BOXED, OWNER-APPROVED and AUDITED, and
 * every one of those three is provable separately; the console sees COUNTS of a distributor's size and
 * never a rupee of its trade; and the console's own role reaches nothing under a tenant service
 * without a window its owner opened.
 */
describeDb('platform console — module 13 (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)

  const adminUserId = uuidv7()
  const otherAdminUserId = uuidv7()
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const retailerRowId = uuidv7()

  // DOS-106 — the console LEVEL. Its cases act on their own console accounts, distributorship,
  // subscription and victim, under `l${run}.` usernames and `+918${run}N` phones: the `p${run}.`
  // identity case below keeps its exact two ids, and a run before the fix mutates only these rows.
  const billingId = uuidv7()
  const sup2Id = uuidv7()
  const sup3Id = uuidv7()
  const sup4Id = uuidv7()
  const sup5Id = uuidv7()
  const demotedId = uuidv7()
  const victimId = uuidv7()
  const lvlTenantId = uuidv7()
  const lvlSubscriptionId = uuidv7()
  const demotedGrantId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }

  let app: NestFastifyApplication
  let consoleAuth: Record<string, string>

  /** A console request: the platform token, and optionally a support pass beside it. */
  const consoleCall = async <T>(
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, unknown>,
    pass?: string,
  ): Promise<{ status: number; body: T }> => {
    const headers: Record<string, string> = {
      ...consoleAuth,
      'content-type': 'application/json',
      ...(pass ? { 'x-support-grant': pass } : {}),
    }
    const res =
      method === 'GET'
        ? await app.inject({ method, url: path, headers, query: toQuery(payload) })
        : await app.inject({
            method,
            url: path,
            headers,
            payload: JSON.stringify(payload ?? {}),
          })
    return { status: res.statusCode, body: res.json<T>() }
  }

  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD)
    await db.insert(users).values([
      {
        id: adminUserId,
        phone: `+919${run}1`,
        name: 'Console super',
        username: `p${run}.admin`,
        passwordHash,
        passwordChangedAt: new Date(),
      },
      {
        id: otherAdminUserId,
        phone: `+919${run}2`,
        name: 'Console colleague',
        username: `p${run}.other`,
        passwordHash,
        passwordChangedAt: new Date(),
      },
      {
        id: ownerId,
        phone: `+919${run}3`,
        name: 'Distributor owner',
        username: `p${run}.own`,
        passwordHash,
        passwordChangedAt: new Date(),
      },
      {
        id: managerId,
        phone: `+919${run}4`,
        name: 'Distributor manager',
        username: `p${run}.mgr`,
        passwordHash,
        passwordChangedAt: new Date(),
      },
    ])
    await db.insert(platformAdmins).values([
      { id: uuidv7(), userId: adminUserId, role: 'super' },
      { id: uuidv7(), userId: otherAdminUserId, role: 'support' },
    ])
    await db.insert(tenants).values({
      id: tenantId,
      slug: `pa-${run}`,
      legalName: 'Platform console fixture',
      stateCode: '27',
    })
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
    ])
    await db.insert(retailers).values({
      id: retailerRowId,
      tenantId,
      code: `PA-${run}`,
      name: 'Support window shop',
      phone: `+919${run}7`,
      stateCode: '27',
    })

    // DOS-106 fixtures, on the owner connection like the rows above (the 0034 guard binds a named
    // `platform_admin` actor, not the migrating connection).
    await db.insert(users).values([
      {
        id: billingId,
        phone: `+918${run}1`,
        name: 'Console billing',
        username: `l${run}.bill`,
        passwordHash,
        passwordChangedAt: new Date(),
      },
      {
        id: sup2Id,
        phone: `+918${run}2`,
        name: 'Console super two',
        username: `l${run}.sup2`,
        passwordHash,
        passwordChangedAt: new Date(),
      },
      {
        id: sup3Id,
        phone: `+918${run}3`,
        name: 'Console super three',
        username: `l${run}.sup3`,
        passwordHash,
        passwordChangedAt: new Date(),
      },
      { id: victimId, phone: `+918${run}4`, name: 'Level victim', username: `l${run}.victim` },
      { id: sup4Id, phone: `+918${run}5`, name: 'Console super four', username: `l${run}.sup4` },
      { id: sup5Id, phone: `+918${run}6`, name: 'Console super five', username: `l${run}.sup5` },
      { id: demotedId, phone: `+918${run}7`, name: 'Console demoted', username: `l${run}.demo` },
    ])
    await db.insert(platformAdmins).values([
      { id: uuidv7(), userId: billingId, role: 'billing' },
      { id: uuidv7(), userId: sup2Id, role: 'super' },
      { id: uuidv7(), userId: sup3Id, role: 'super' },
      { id: uuidv7(), userId: sup4Id, role: 'super' },
      { id: uuidv7(), userId: sup5Id, role: 'super' },
      { id: uuidv7(), userId: demotedId, role: 'super' },
    ])
    await db.insert(tenants).values({
      id: lvlTenantId,
      slug: `lvl-${run}`,
      legalName: 'Console level fixture',
      stateCode: '27',
    })
    await db.insert(subscriptions).values({
      id: lvlSubscriptionId,
      tenantId: lvlTenantId,
      plan: 'starter',
      status: 'active',
      periodStart: '2026-09-01',
      periodEnd: '2026-10-01',
      pricePaiseMonth: 199_900,
      updatedBy: adminUserId,
    })
    await db
      .insert(memberships)
      .values({ id: uuidv7(), tenantId: lvlTenantId, userId: victimId, role: 'owner' })
    await db.insert(supportGrants).values({
      id: demotedGrantId,
      tenantId: lvlTenantId,
      adminUserId: demotedId,
      requestedAt: new Date(),
      requestedHours: 4,
      reason: 'Asked while this account was still a super administrator.',
      expiresAt: new Date(Date.now() + 4 * HOUR_MS),
      scope: 'read',
    })

    app = await bootTestApp([AuthModule, TenancyModule, PlatformAdminModule, RetailersModule])
    // A REAL console session, not a synthetic token: `auth.supportPass` reads the session row back
    // (a pass must not outlive the session that asked for it), so the spec signs in the way the
    // console does and carries that token through every case below.
    const signIn = await app.inject({
      method: 'POST',
      url: '/auth/platform/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        username: `p${run}.admin`,
        password: PASSWORD,
        deviceId: uuidv7(),
      }),
    })
    consoleAuth = { authorization: `Bearer ${signIn.json<{ accessToken: string }>().accessToken}` }
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  // ---------------------------------------------------------------- sign-in

  it('signs a console account in at its OWN endpoint, with no tenant, and refuses the tenant one', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/platform/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        username: `p${run}.admin`,
        password: PASSWORD,
        deviceId: uuidv7(),
      }),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ role: string; accessToken: string; tenant?: unknown }>()
    expect(body.role).toBe('platform_admin')
    // The shape is the point: no tenant, because a console account is a member of nobody.
    expect(body.tenant).toBeUndefined()

    // The distributor sign-in tells them where to go instead of "you are a member of nothing".
    const wrongDoor = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        username: `p${run}.admin`,
        password: PASSWORD,
        deviceId: uuidv7(),
      }),
    })
    expect(wrongDoor.statusCode).toBe(403)
    expect(wrongDoor.json<{ message: string }>().message).toContain('/auth/platform/login')

    // ...and the mirror: a distributor's own owner is not a console account.
    const notOurs = await app.inject({
      method: 'POST',
      url: '/auth/platform/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: `p${run}.own`, password: PASSWORD, deviceId: uuidv7() }),
    })
    expect(notOurs.statusCode).toBe(403)
    expect(notOurs.json<{ message: string }>().message).toContain('console account')
  })

  // ---------------------------------------------------------------- onboarding

  it('onboards a distributor whose owner can sign in to a bootstrapped distributorship', async () => {
    const newTenantId = uuidv7()
    const body = {
      idempotencyKey: `onboard-${run}`,
      id: newTenantId,
      slug: `onb-${run}`,
      legalName: 'Onboarded Distributors',
      stateCode: '27',
      plan: 'starter',
      owner: {
        userId: uuidv7(),
        membershipId: uuidv7(),
        username: `o${run}.own`,
        name: 'New owner',
        phone: `+919${run}5`,
        temporaryPassword: PASSWORD,
      },
      subscription: { id: uuidv7(), trialDays: 30, amountPaise: 199_900, seats: 10 },
    }
    const res = await consoleCall<{
      tenant: { id: string; slug: string }
      owner: { username: string; mustChangePassword: boolean }
      subscription: { status: string; trialEndDate: string | null }
    }>('POST', '/admin/tenants', body)
    expect(res.status).toBe(200)
    expect(res.body.tenant.slug).toBe(`onb-${run}`)
    expect(res.body.owner.mustChangePassword).toBe(true)
    expect(res.body.subscription.status).toBe('trialing')
    expect(res.body.subscription.trialEndDate).not.toBeNull()

    // A replay of the same call is the same answer, not a second distributorship.
    const replay = await consoleCall<{ tenant: { id: string } }>('POST', '/admin/tenants', body)
    expect(replay.status).toBe(200)
    expect(replay.body.tenant.id).toBe(newTenantId)
    const onboarded = (
      await db.execute<{ n: string }>(
        sql`select count(*) as n from tenants where slug = ${`onb-${run}`}`,
      )
    ).rows[0]
    expect(Number(onboarded?.n)).toBe(1)

    // The distributorship is BOOTSTRAPPED, not merely created: the same chart of accounts, stock
    // locations and numbering series `pnpm db:seed` gives the pilot.
    const counts = await db.execute<{ accounts: string; locations: string; series: string }>(sql`
      select
        (select count(*) from accounts where tenant_id = ${newTenantId}) as accounts,
        (select count(*) from locations where tenant_id = ${newTenantId}) as locations,
        (select count(*) from numbering_series where tenant_id = ${newTenantId}) as series
    `)
    const row = counts.rows[0]
    expect(Number(row?.accounts)).toBeGreaterThan(5)
    expect(Number(row?.locations)).toBeGreaterThan(0)
    expect(Number(row?.series)).toBeGreaterThan(0)

    // And its owner can sign in — the whole point of the handover call.
    const signIn = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        username: `o${run}.own`,
        password: PASSWORD,
        deviceId: uuidv7(),
      }),
    })
    expect(signIn.statusCode).toBe(200)
    const pair = signIn.json<{ role: string; user: { mustChangePassword: boolean } }>()
    expect(pair.role).toBe('owner')
    expect(pair.user.mustChangePassword).toBe(true)

    // A DIFFERENT tenant id reusing the slug is refused, not silently merged.
    const clash = await consoleCall<{ message: string }>('POST', '/admin/tenants', {
      ...body,
      idempotencyKey: `onboard-clash-${run}`,
      id: uuidv7(),
      owner: {
        ...body.owner,
        userId: uuidv7(),
        membershipId: uuidv7(),
        username: `o${run}.own2`,
        phone: `+919${run}6`,
      },
      subscription: { ...body.subscription, id: uuidv7() },
    })
    expect(clash.status).toBe(409)
  })

  // ---------------------------------------------------------------- suspension

  it('suspends a distributorship: every sign-in and refresh answers 423 with a sentence, until it is put back', async () => {
    const deviceId = uuidv7()
    const before = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: `p${run}.own`, password: PASSWORD, deviceId }),
    })
    expect(before.statusCode).toBe(200)
    const refreshToken = before.json<{ refreshToken: string }>().refreshToken

    const suspended = await consoleCall<{ item: { status: string } }>(
      'POST',
      `/admin/tenants/${tenantId}/suspend`,
      {
        idempotencyKey: `suspend-${run}`,
        id: tenantId,
        reason: 'Subscription unpaid for 45 days.',
      },
    )
    expect(suspended.status).toBe(200)
    expect(suspended.body.item.status).toBe('suspended')

    for (const username of [`p${run}.own`, `p${run}.mgr`]) {
      const blocked = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ username, password: PASSWORD, deviceId: uuidv7() }),
      })
      expect(blocked.statusCode, username).toBe(423)
      const message = blocked.json<{ message: string }>().message
      expect(message).toContain('Platform console fixture')
      expect(message).toContain('suspended')
    }

    // A session that was already open stops at its next refresh, not at the end of the day.
    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ refreshToken, deviceId }),
    })
    expect(refreshed.statusCode).toBe(423)

    const back = await consoleCall<{ item: { status: string } }>(
      'POST',
      `/admin/tenants/${tenantId}/reactivate`,
      { idempotencyKey: `reactivate-${run}`, id: tenantId, note: 'Payment received.' },
    )
    expect(back.status).toBe(200)
    expect(back.body.item.status).toBe('active')
    const after = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username: `p${run}.own`, password: PASSWORD, deviceId: uuidv7() }),
    })
    expect(after.statusCode).toBe(200)

    // Both decisions are in the console's own trail, with the reason.
    const trail = await consoleCall<{
      items: { action: string; after: Record<string, unknown> }[]
    }>('GET', '/admin/audit', { tenantId })
    const actions = trail.body.items.map((i) => i.action)
    expect(actions).toContain('tenant.suspended')
    expect(actions).toContain('tenant.reactivated')
  })

  // ---------------------------------------------------------------- support access

  it('asks, waits for the owner, reads only what the owner opened, and writes every read into the trail', async () => {
    const grantId = uuidv7()
    const asked = await consoleCall<{ item: Grant }>('POST', '/admin/support-grants', {
      idempotencyKey: `ask-${run}`,
      id: grantId,
      tenantId,
      reason:
        'Ticket #4310: one shop shows a different outstanding in the app and on the statement.',
      scope: 'read_only',
      hours: 4,
    })
    expect(asked.status).toBe(200)
    expect(asked.body.item.status).toBe('requested')
    expect(asked.body.item.active).toBe(false)

    // ASKING OPENS NOTHING. Until the owner says yes, no pass can be minted.
    const tooEarly = await consoleCall<{ message: string }>('POST', '/auth/platform/support-pass', {
      grantId,
    })
    expect(tooEarly.status).toBe(403)
    expect(tooEarly.body.message).toContain('has not approved')

    // ...and there is no path here that opens it: the console's own contract has no `approve`. This
    // is the founder's rule made structural — requesting and approving are two people in two
    // different companies, and the database refuses the shortcut too (`dos_support_grant_guard`).
    expect(Object.keys(contract.admin.support).sort()).toEqual(['list', 'request', 'revoke'])

    const approved = await call<{ item: Grant }>(
      app,
      owner,
      'POST',
      `/tenancy/support-grants/${grantId}/approve`,
      { idempotencyKey: `approve-${run}`, id: grantId, note: 'Read only please.' },
    )
    expect(approved.status).toBe(200)
    expect(approved.body.item.status).toBe('approved')

    const pass = await consoleCall<{ pass: string; tenantId: string; scope: string }>(
      'POST',
      '/auth/platform/support-pass',
      { grantId },
    )
    expect(pass.status).toBe(200)
    expect(pass.body.tenantId).toBe(tenantId)
    expect(pass.body.scope).toBe('read_only')

    // Without the pass the console reaches nothing of this distributor's, whatever it holds.
    const naked = await consoleCall<{ message: string }>('GET', '/retailers')
    expect(naked.status).toBe(403)

    // With it, the shops the owner opened — and only that distributor's.
    const shops = await consoleCall<{ items: { id: string }[] }>(
      'GET',
      '/retailers',
      undefined,
      pass.body.pass,
    )
    expect(shops.status).toBe(200)
    expect(shops.body.items.some((r) => r.id === retailerRowId)).toBe(true)

    // READ ONLY means read only: a write is refused before the handler runs.
    const write = await consoleCall<{ message: string }>(
      'POST',
      '/retailers',
      {
        idempotencyKey: `sup-write-${run}`,
        id: uuidv7(),
        code: `X-${run}`,
        name: 'Should never exist',
        stateCode: '27',
      },
      pass.body.pass,
    )
    expect(write.status).toBe(403)
    expect(write.body.message).toContain('read-only')

    // Every call under the window is recorded, with the grant, the route and the outcome. The row
    // lands just after the reply (oRPC owns the reply through `@OwnsReply`, so the interceptor cannot
    // hold it — see `support-audit.interceptor.ts`), so this polls rather than assuming.
    const recorded = await waitFor(async () => {
      const rows = await db
        .select()
        .from(platformAudit)
        .where(and(eq(platformAudit.tenantId, tenantId), eq(platformAudit.action, 'support.read')))
      return rows
        .map((row) => row.payload as Record<string, unknown>)
        .some((p) => p.grantId === grantId && p.route === 'GET /retailers' && p.outcome === 'ok')
    })
    expect(recorded).toBe(true)

    // A pass belonging to another administrator is refused even with a valid signature.
    const keys = await loadAuthKeys()
    const borrowed = await signSupportPass(
      {
        grantId,
        tenantId,
        adminUserId: otherAdminUserId,
        scope: 'read_only',
        grantExpiresAt: new Date(Date.now() + HOUR_MS),
      },
      keys,
    )
    const stolen = await consoleCall<{ message: string }>(
      'GET',
      '/retailers',
      undefined,
      borrowed.pass,
    )
    expect(stolen.status).toBe(403)
    expect(stolen.body.message).toContain('another administrator')

    // A window that has closed is a shut door, not a grace period.
    const lapsed = await signSupportPass(
      {
        grantId,
        tenantId,
        adminUserId,
        scope: 'read_only',
        grantExpiresAt: new Date(Date.now() - HOUR_MS),
      },
      keys,
    )
    const expired = await consoleCall<{ message: string }>(
      'GET',
      '/retailers',
      undefined,
      lapsed.pass,
    )
    expect(expired.status).toBe(403)
    expect(expired.body.message).toContain('not open')

    // The owner shuts it, and the console cannot mint another pass from the same grant.
    const revoked = await call<{ item: Grant }>(
      app,
      owner,
      'POST',
      `/tenancy/support-grants/${grantId}/revoke`,
      { idempotencyKey: `revoke-${run}`, id: grantId, reason: 'Finished, thank you.' },
    )
    expect(revoked.status).toBe(200)
    expect(revoked.body.item.status).toBe('revoked')
    const afterRevoke = await consoleCall<{ message: string }>(
      'POST',
      '/auth/platform/support-pass',
      { grantId },
    )
    expect(afterRevoke.status).toBe(403)
  })

  it('refuses a support pass presented by a distributor’s own login', async () => {
    const grantId = uuidv7()
    await db.insert(supportGrants).values({
      id: grantId,
      tenantId,
      adminUserId,
      requestedAt: new Date(),
      requestedHours: 4,
      reason: 'A window the manager should not be able to borrow.',
      approvedBy: ownerId,
      approvedAt: new Date(),
      expiresAt: new Date(Date.now() + HOUR_MS),
      scope: 'read',
    })
    const keys = await loadAuthKeys()
    const { pass } = await signSupportPass(
      {
        grantId,
        tenantId,
        adminUserId,
        scope: 'read_only',
        grantExpiresAt: new Date(Date.now() + HOUR_MS),
      },
      keys,
    )
    const res = await app.inject({
      method: 'GET',
      url: '/retailers',
      headers: { ...(await bearer(manager)), 'x-support-grant': pass },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json<{ message: string }>().message).toContain('console session')
  })

  // ---------------------------------------------------------------- subscriptions, users, metrics

  it('records what a distributor pays us, and keeps the plan on the tenant row in step', async () => {
    const id = uuidv7()
    const body = {
      idempotencyKey: `sub-${run}`,
      id,
      tenantId,
      plan: 'pro',
      status: 'active',
      amountPaise: 499_900,
      billingInterval: 'monthly',
      seats: 25,
      currentPeriodStart: '2026-09-01',
      currentPeriodEnd: '2026-10-01',
      note: 'Pilot customer.',
    }
    const res = await consoleCall<{ item: { plan: string; amountPaise: number; seats: number } }>(
      'POST',
      '/admin/subscriptions',
      body,
    )
    expect(res.status).toBe(200)
    expect(res.body.item.amountPaise).toBe(499_900)
    expect(res.body.item.seats).toBe(25)
    const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
    expect(tenantRow?.plan).toBe('pro')
    const [subRow] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
    expect(subRow?.pricePaiseMonth).toBe(499_900)
    expect(subRow?.updatedBy).toBe(adminUserId)

    // A trial with no end is refused: the database says so too (`dos_subscription_guard`).
    const noEnd = await consoleCall<{ message: string }>('POST', '/admin/subscriptions', {
      ...body,
      idempotencyKey: `sub-bad-${run}`,
      status: 'trialing',
      trialEndDate: undefined,
    })
    expect(noEnd.status).toBe(400)
  })

  it('shows one identity across every distributor it belongs to — the view no tenant surface may have', async () => {
    const res = await consoleCall<{
      items: {
        id: string
        memberships: { tenantId: string; role: string }[]
        platformRole: string | null
      }[]
    }>('GET', '/admin/users', { tenantId })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const found = res.body.items.find((u) => u.id === ownerId)
    expect(found?.memberships.some((m) => m.tenantId === tenantId && m.role === 'owner')).toBe(true)

    // `platformOnly` narrows to Distribution OS's own staff. The developer database holds hundreds of
    // them (every spec that touches module 13 writes one), so the page is also narrowed by `q` to the
    // account this run created — the property under test is the filter, not the ordering.
    const staff = await consoleCall<{ items: { id: string; platformRole: string | null }[] }>(
      'GET',
      '/admin/users',
      { platformOnly: true, q: `p${run}.` },
    )
    expect(staff.status, JSON.stringify(staff.body)).toBe(200)
    expect(staff.body.items.every((u) => u.platformRole === 'platform_admin')).toBe(true)
    expect(staff.body.items.map((u) => u.id).sort()).toEqual([adminUserId, otherAdminUserId].sort())

    // ...and the same page WITHOUT the flag also carries the distributor's own people.
    const everyone = await consoleCall<{ items: { id: string }[] }>('GET', '/admin/users', {
      q: `p${run}.`,
    })
    expect(everyone.body.items.some((u) => u.id === ownerId)).toBe(true)
  })

  it('answers counts that match the tables, and never a rupee of anybody’s trade', async () => {
    // `tenants` is the ONE table in this repo that every other spec file writes to as well —
    // `describeDb` bootstraps a fresh tenant per file and vitest runs the files in parallel — so a
    // cross-tenant COUNT is a moving number and comparing it to a single snapshot taken after the
    // call is a race (it failed 4130 vs 4137 in the gate: seven tenants born between the two reads).
    // Bracket the call instead: whatever the console answered must lie between the count immediately
    // before it and the count immediately after, which is exactly as strong — a hard-coded or
    // filtered number still fails — and is true no matter what the rest of the suite is doing.
    const countTenants = async () => {
      const [r] = (
        await db.execute<{ total: string; active: string }>(
          sql`select count(*) as total, count(*) filter (where status = 'active') as active from tenants`,
        )
      ).rows
      return { total: Number(r?.total), active: Number(r?.active) }
    }
    const before = await countTenants()
    const res = await consoleCall<{
      tenants: { total: number; active: number; suspended: number; closed: number }
      windowDays: number
      series: { orders: { day: string; value: number }[] }
      storage: { bytes: number; objects: number }
    }>('GET', '/admin/metrics', { days: 7 })
    const after = await countTenants()
    expect(res.status).toBe(200)
    expect(res.body.tenants.total).toBeGreaterThanOrEqual(Math.min(before.total, after.total))
    expect(res.body.tenants.total).toBeLessThanOrEqual(Math.max(before.total, after.total))
    expect(res.body.tenants.active).toBeGreaterThanOrEqual(Math.min(before.active, after.active))
    expect(res.body.tenants.active).toBeLessThanOrEqual(Math.max(before.active, after.active))
    // ...and the four numbers are one partition of the same table, not four unrelated queries: this
    // run's own tenant is in there, and `total` is exactly the three statuses added up.
    expect(res.body.tenants.total).toBeGreaterThan(0)
    expect(res.body.tenants.total).toBe(
      res.body.tenants.active + res.body.tenants.suspended + res.body.tenants.closed,
    )
    expect(res.body.windowDays).toBe(7)
    // A day per day of the window, oldest first, gaps filled with zero.
    expect(res.body.series.orders).toHaveLength(7)
    expect(res.body.storage.bytes).toBeGreaterThanOrEqual(0)
    // The shape itself is the guarantee: no turnover, outstanding, cost or margin field exists.
    expect(Object.keys(res.body)).not.toContain('revenue')
  })

  it('reads its own tables under RLS, and NOTHING of a distributor’s', async () => {
    // The console session's own context: `app.tenant_id` is empty, so every tenant policy in the
    // database matches nothing. This is the guarantee behind `withPlatform` — not a filter in code.
    const rows = await withTenant(
      db,
      { tenantId: '', actorId: adminUserId, actorRole: 'platform_admin' },
      async (tx) => ({
        subscriptions: (await tx.select().from(subscriptions)).length,
        retailers: (await tx.select().from(retailers)).length,
        accounts: (await tx.select().from(accounts)).length,
        locations: (await tx.select().from(locations)).length,
        series: (await tx.select().from(numberingSeries)).length,
        grants: (await tx.select().from(supportGrants)).length,
      }),
    )
    expect(rows.subscriptions).toBeGreaterThan(0)
    expect(rows.grants).toBeGreaterThan(0)
    expect(rows.retailers).toBe(0)
    expect(rows.accounts).toBe(0)
    expect(rows.locations).toBe(0)
    expect(rows.series).toBe(0)
  })

  it('refuses a console account that has been closed', async () => {
    const closedUserId = uuidv7()
    await db.insert(users).values({
      id: closedUserId,
      phone: `+919${run}9`,
      name: 'Closed console account',
      username: `p${run}.gone`,
    })
    await db
      .insert(platformAdmins)
      .values({ id: uuidv7(), userId: closedUserId, role: 'support', disabledAt: new Date() })
    const headers = { ...(await platformBearer(closedUserId)), 'content-type': 'application/json' }
    const res = await app.inject({ method: 'GET', url: '/admin/metrics', headers })
    expect(res.statusCode).toBe(403)
    expect(res.json<{ message: string }>().message).toContain('no longer active')
  })

  // ---------------------------------------------------------------- DOS-106: the console level

  type Reply = {
    status: number
    body: { code?: string; message?: string } & Record<string, unknown>
  }
  type Probe = { method: 'GET' | 'POST'; url: string; payload?: Record<string, unknown> }

  /** A console token for one account, minted once and kept: "the token still in hand". */
  const consoleHeaders = async (userId: string): Promise<Record<string, string>> => ({
    ...(await platformBearer(userId)),
    'content-type': 'application/json',
  })

  const asConsole = async (
    headers: Record<string, string>,
    method: 'GET' | 'POST',
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<Reply> => {
    const res =
      method === 'GET'
        ? await app.inject({ method, url, headers, query: toQuery(payload) })
        : await app.inject({ method, url, headers, payload: JSON.stringify(payload ?? {}) })
    return { status: res.statusCode, body: res.json<Reply['body']>() }
  }

  const expectLevelRefusal = (res: Reply, level: string, path: string): void => {
    expect(res.status, `${level} → ${path}: ${JSON.stringify(res.body)}`).toBe(403)
    expect(res.body.code, path).toBe('FORBIDDEN')
    expect(res.body.message, path).toBe(
      `a ${level} console account may not call ${path}; ask a super administrator`,
    )
  }

  const platformSignIn = async (
    username: string,
  ): Promise<{ status: number; deviceId: string; body: Record<string, unknown> }> => {
    const deviceId = uuidv7()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/platform/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ username, password: PASSWORD, deviceId }),
    })
    return { status: res.statusCode, deviceId, body: res.json<Record<string, unknown>>() }
  }

  /** Everything a refused call could have touched, read straight from the tables. */
  const levelSnapshot = async (actorId: string): Promise<Record<string, string | null>> => {
    const [row] = (
      await db.execute<Record<string, string | null>>(sql`
        select
          (select status::text from tenants where id = ${lvlTenantId}) as tenant_status,
          (select plan::text from tenants where id = ${lvlTenantId}) as tenant_plan,
          (select price_paise_month::text from subscriptions where tenant_id = ${lvlTenantId}) as price,
          (select updated_at::text from subscriptions where tenant_id = ${lvlTenantId}) as subscription_updated_at,
          (select status::text from users where id = ${victimId}) as victim_status,
          (select count(*)::text from tenants where slug like ${`lvlx-%-${run}`}) as onboarded,
          (select count(*)::text from support_grants where tenant_id = ${lvlTenantId}) as grants,
          (select count(*)::text from support_grants
            where id = ${demotedGrantId} and revoked_at is not null) as demoted_grant_closed,
          (select count(*)::text from platform_audit where admin_user_id = ${actorId}) as audit_rows
      `)
    ).rows
    return row ?? {}
  }

  const onboardingBody = (tag: string, digit: string): Record<string, unknown> => ({
    idempotencyKey: `lvl-onboard-${tag}-${run}`,
    id: uuidv7(),
    slug: `lvlx-${tag}-${run}`,
    legalName: `Level probe ${tag}`,
    stateCode: '27',
    plan: 'starter',
    owner: {
      userId: uuidv7(),
      membershipId: uuidv7(),
      username: `l${run}.o${tag}`,
      name: 'Level probe owner',
      phone: `+917${run}${digit}`,
      temporaryPassword: PASSWORD,
    },
    subscription: { id: uuidv7(), trialDays: 30, amountPaise: 199_900, seats: 10 },
  })

  const subscriptionBody = (tag: string, amountPaise: number): Record<string, unknown> => ({
    idempotencyKey: `lvl-sub-${tag}-${run}`,
    id: lvlSubscriptionId,
    tenantId: lvlTenantId,
    plan: 'pro',
    status: 'active',
    amountPaise,
    billingInterval: 'monthly',
    currentPeriodStart: '2026-09-01',
    currentPeriodEnd: '2026-10-01',
  })

  /**
   * One VALID request per console procedure, aimed at this run's throwaway rows. Valid matters: input
   * validation runs before the handler, so a malformed body would answer 400 and prove nothing about
   * the handler's own check. Keyed by contract path, and compared with the contract below, so a new
   * `admin.*` procedure cannot slip past the sweep.
   */
  const probes = (tag: string, digit: string): Record<string, Probe> => ({
    'admin.tenants.create': {
      method: 'POST',
      url: '/admin/tenants',
      payload: onboardingBody(tag, digit),
    },
    'admin.tenants.list': { method: 'GET', url: '/admin/tenants' },
    'admin.tenants.get': { method: 'GET', url: `/admin/tenants/${lvlTenantId}` },
    'admin.tenants.suspend': {
      method: 'POST',
      url: `/admin/tenants/${lvlTenantId}/suspend`,
      payload: { idempotencyKey: `lvl-suspend-${tag}-${run}`, id: lvlTenantId, reason: 'Probe.' },
    },
    'admin.tenants.reactivate': {
      method: 'POST',
      url: `/admin/tenants/${lvlTenantId}/reactivate`,
      payload: { idempotencyKey: `lvl-reactivate-${tag}-${run}`, id: lvlTenantId, note: 'Probe.' },
    },
    'admin.subscriptions.upsert': {
      method: 'POST',
      url: '/admin/subscriptions',
      payload: subscriptionBody(tag, 1),
    },
    'admin.subscriptions.list': { method: 'GET', url: '/admin/subscriptions' },
    'admin.subscriptions.get': { method: 'GET', url: `/admin/subscriptions/${lvlSubscriptionId}` },
    'admin.support.request': {
      method: 'POST',
      url: '/admin/support-grants',
      payload: {
        idempotencyKey: `lvl-ask-${tag}-${run}`,
        id: uuidv7(),
        tenantId: lvlTenantId,
        reason: 'Probe: may this account still ask?',
        scope: 'read_only',
        hours: 4,
      },
    },
    'admin.support.list': { method: 'GET', url: '/admin/support-grants' },
    'admin.support.revoke': {
      method: 'POST',
      url: `/admin/support-grants/${demotedGrantId}/revoke`,
      payload: { idempotencyKey: `lvl-revoke-${tag}-${run}`, id: demotedGrantId },
    },
    'admin.users.list': { method: 'GET', url: '/admin/users', payload: { q: `l${run}.` } },
    'admin.users.disable': {
      method: 'POST',
      url: `/admin/users/${victimId}/disable`,
      payload: { idempotencyKey: `lvl-disable-${tag}-${run}`, id: victimId, reason: 'Probe.' },
    },
    'admin.metrics.overview': { method: 'GET', url: '/admin/metrics', payload: { days: 7 } },
    'admin.audit.list': { method: 'GET', url: '/admin/audit', payload: { tenantId: lvlTenantId } },
  })

  it('DOS-106: a support-level console account is refused onboarding, a plan change, suspension, reactivation and locking a login, and nothing changes', async () => {
    const support = await consoleHeaders(otherAdminUserId)
    const before = await levelSnapshot(otherAdminUserId)

    expectLevelRefusal(
      await asConsole(support, 'POST', '/admin/tenants', onboardingBody('sup', '1')),
      'support',
      'admin.tenants.create',
    )
    expectLevelRefusal(
      await asConsole(support, 'POST', '/admin/subscriptions', subscriptionBody('sup', 1)),
      'support',
      'admin.subscriptions.upsert',
    )
    expectLevelRefusal(
      await asConsole(support, 'POST', `/admin/tenants/${lvlTenantId}/suspend`, {
        idempotencyKey: `lvl-sup-suspend-${run}`,
        id: lvlTenantId,
        reason: 'Support tries to switch a distributor off.',
      }),
      'support',
      'admin.tenants.suspend',
    )
    expectLevelRefusal(
      await asConsole(support, 'POST', `/admin/tenants/${lvlTenantId}/reactivate`, {
        idempotencyKey: `lvl-sup-reactivate-${run}`,
        id: lvlTenantId,
        note: 'Support tries to switch a distributor on.',
      }),
      'support',
      'admin.tenants.reactivate',
    )
    expectLevelRefusal(
      await asConsole(support, 'POST', `/admin/users/${victimId}/disable`, {
        idempotencyKey: `lvl-sup-disable-${run}`,
        id: victimId,
        reason: 'Support tries to lock a login.',
      }),
      'support',
      'admin.users.disable',
    )

    // Not one row moved: no new distributorship, the same price and plan, the same login, and
    // nothing in the console's trail under the support account.
    expect(await levelSnapshot(otherAdminUserId)).toEqual(before)
    expect(before.tenant_status).toBe('active')
    expect(before.victim_status).toBe('active')
    expect(before.onboarded).toBe('0')
  })

  it("DOS-106: a lower console level replaying a super's idempotencyKey with the identical body is refused, not handed the stored reply", async () => {
    const suspendBody = {
      idempotencyKey: `lvl-replay-suspend-${run}`,
      id: lvlTenantId,
      reason: 'Replay probe: a super suspends.',
    }
    const bySuper = await consoleCall<{ item: { status: string } }>(
      'POST',
      `/admin/tenants/${lvlTenantId}/suspend`,
      suspendBody,
    )
    expect(bySuper.status).toBe(200)
    expect(bySuper.body.item.status).toBe('suspended')
    const back = await consoleCall<{ item: { status: string } }>(
      'POST',
      `/admin/tenants/${lvlTenantId}/reactivate`,
      { idempotencyKey: `lvl-replay-back-${run}`, id: lvlTenantId },
    )
    expect(back.status).toBe(200)
    expect(back.body.item.status).toBe('active')
    const planBody = subscriptionBody('replay', 249_900)
    const planBySuper = await consoleCall<{ item: { amountPaise: number } }>(
      'POST',
      '/admin/subscriptions',
      planBody,
    )
    expect(planBySuper.status).toBe(200)

    // The byte-identical request under the super's key: the key row exists and the hash matches, so
    // anything that ran the key lookup first would hand back the super's stored 200.
    const support = await consoleHeaders(otherAdminUserId)
    const billing = await consoleHeaders(billingId)
    expectLevelRefusal(
      await asConsole(support, 'POST', `/admin/tenants/${lvlTenantId}/suspend`, suspendBody),
      'support',
      'admin.tenants.suspend',
    )
    expectLevelRefusal(
      await asConsole(billing, 'POST', `/admin/tenants/${lvlTenantId}/suspend`, suspendBody),
      'billing',
      'admin.tenants.suspend',
    )
    expectLevelRefusal(
      await asConsole(support, 'POST', '/admin/subscriptions', planBody),
      'support',
      'admin.subscriptions.upsert',
    )
    const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, lvlTenantId))
    expect(tenantRow?.status).toBe('active')
  })

  it('DOS-106: a support-level console account still reads every console register and can ask for and withdraw support access', async () => {
    const support = await consoleHeaders(otherAdminUserId)
    for (const [path, url, query] of [
      ['admin.tenants.list', '/admin/tenants', { q: `lvl-${run}` }],
      ['admin.tenants.get', `/admin/tenants/${lvlTenantId}`, undefined],
      ['admin.subscriptions.list', '/admin/subscriptions', { tenantId: lvlTenantId }],
      ['admin.subscriptions.get', `/admin/subscriptions/${lvlSubscriptionId}`, undefined],
      ['admin.support.list', '/admin/support-grants', { tenantId: lvlTenantId }],
      ['admin.users.list', '/admin/users', { q: `l${run}.` }],
      ['admin.metrics.overview', '/admin/metrics', { days: 7 }],
      ['admin.audit.list', '/admin/audit', { tenantId: lvlTenantId }],
    ] as const) {
      const res = await asConsole(support, 'GET', url, query)
      expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(200)
    }

    const grantId = uuidv7()
    const asked = await asConsole(support, 'POST', '/admin/support-grants', {
      idempotencyKey: `lvl-sup-ask-${run}`,
      id: grantId,
      tenantId: lvlTenantId,
      reason: 'Ticket: the support desk still asks for a window.',
      scope: 'read_only',
      hours: 4,
    })
    expect(asked.status, JSON.stringify(asked.body)).toBe(200)
    expect((asked.body.item as Grant).status).toBe('requested')
    const withdrawn = await asConsole(support, 'POST', `/admin/support-grants/${grantId}/revoke`, {
      idempotencyKey: `lvl-sup-withdraw-${run}`,
      id: grantId,
      reason: 'Solved on the phone.',
    })
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200)
    expect((withdrawn.body.item as Grant).status).toBe('rejected')
  })

  it('DOS-106: a billing-level console account may change a subscription and is refused suspension, locking a login and asking for support access', async () => {
    const billing = await consoleHeaders(billingId)
    const before = await levelSnapshot(billingId)

    const changed = await asConsole(billing, 'POST', '/admin/subscriptions', {
      ...subscriptionBody('bill', 299_900),
      plan: 'growth',
    })
    expect(changed.status, JSON.stringify(changed.body)).toBe(200)
    expect((changed.body.item as { amountPaise: number }).amountPaise).toBe(299_900)
    const [subRow] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, lvlTenantId))
    expect(subRow?.updatedBy).toBe(billingId)

    expectLevelRefusal(
      await asConsole(billing, 'POST', `/admin/tenants/${lvlTenantId}/suspend`, {
        idempotencyKey: `lvl-bill-suspend-${run}`,
        id: lvlTenantId,
        reason: 'Billing tries to switch a distributor off.',
      }),
      'billing',
      'admin.tenants.suspend',
    )
    expectLevelRefusal(
      await asConsole(billing, 'POST', `/admin/users/${victimId}/disable`, {
        idempotencyKey: `lvl-bill-disable-${run}`,
        id: victimId,
        reason: 'Billing tries to lock a login.',
      }),
      'billing',
      'admin.users.disable',
    )
    expectLevelRefusal(
      await asConsole(billing, 'POST', '/admin/support-grants', {
        idempotencyKey: `lvl-bill-ask-${run}`,
        id: uuidv7(),
        tenantId: lvlTenantId,
        reason: 'Billing tries to ask for a support window.',
        scope: 'read_only',
        hours: 4,
      }),
      'billing',
      'admin.support.request',
    )

    // The plan change landed and is filed under billing; nothing else moved.
    const after = await levelSnapshot(billingId)
    expect(after).toEqual({
      ...before,
      tenant_plan: 'growth',
      price: '299900',
      subscription_updated_at: after.subscription_updated_at,
      audit_rows: String(Number(before.audit_rows) + 1),
    })
  })

  it('DOS-106: the platform sign-in reply and platformMe name the console level', async () => {
    for (const [username, level] of [
      [`p${run}.admin`, 'super'],
      [`p${run}.other`, 'support'],
      [`l${run}.bill`, 'billing'],
    ] as const) {
      const signIn = await platformSignIn(username)
      expect(signIn.status, `${username}: ${JSON.stringify(signIn.body)}`).toBe(200)
      expect(signIn.body.role, username).toBe('platform_admin')
      expect(signIn.body.level, username).toBe(level)

      // The TOKEN stays role-only: the level is re-read from the database on every console call.
      const accessToken = String(signIn.body.accessToken)
      const claims = JSON.parse(
        Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as Record<string, unknown>
      expect(claims.role, username).toBe('platform_admin')
      expect(claims, username).not.toHaveProperty('level')

      const me = await app.inject({
        method: 'GET',
        url: '/auth/platform/me',
        headers: { authorization: `Bearer ${accessToken}` },
      })
      expect(me.statusCode, me.body).toBe(200)
      expect(me.json<{ role: string; level: string }>().level, username).toBe(level)

      const refreshed = await app.inject({
        method: 'POST',
        url: '/auth/platform/refresh',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          refreshToken: signIn.body.refreshToken,
          deviceId: signIn.deviceId,
        }),
      })
      expect(refreshed.statusCode, refreshed.body).toBe(200)
      expect(refreshed.json<{ level: string }>().level, username).toBe(level)
    }
  })

  it('DOS-106: a support-level console account cannot lock a super administrator out, and the super still signs in', async () => {
    const live = await platformSignIn(`l${run}.sup2`)
    expect(live.status).toBe(200)
    const locksOfSup2 = async (): Promise<string | undefined> =>
      (
        await db.execute<{ n: string }>(
          sql`select count(*)::text as n from platform_audit
              where action = 'user.disabled' and payload->>'userId' = ${sup2Id}`,
        )
      ).rows[0]?.n
    const locksBefore = await locksOfSup2()

    const support = await consoleHeaders(otherAdminUserId)
    expectLevelRefusal(
      await asConsole(support, 'POST', `/admin/users/${sup2Id}/disable`, {
        idempotencyKey: `lvl-sup-locks-super-${run}`,
        id: sup2Id,
        reason: 'Support tries to lock the super administrator out.',
      }),
      'support',
      'admin.users.disable',
    )

    const [sup2] = await db.select().from(users).where(eq(users.id, sup2Id))
    expect(sup2?.status).toBe('active')
    expect(await locksOfSup2()).toBe(locksBefore)
    // The super's open session was not revoked: it still refreshes...
    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/platform/refresh',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ refreshToken: live.body.refreshToken, deviceId: live.deviceId }),
    })
    expect(refreshed.statusCode, refreshed.body).toBe(200)
    // ...and a fresh sign-in still works.
    const again = await platformSignIn(`l${run}.sup2`)
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect(again.body.level).toBe('super')
  })

  it('DOS-106: a super whose login was just locked by another super cannot lock that super back with the token still in hand, so an active super always remains', async () => {
    // Both tokens are minted BEFORE the lock: fifteen minutes of validity each.
    const two = await consoleHeaders(sup2Id)
    const three = await consoleHeaders(sup3Id)

    const locked = await asConsole(two, 'POST', `/admin/users/${sup3Id}/disable`, {
      idempotencyKey: `lvl-two-locks-three-${run}`,
      id: sup3Id,
      reason: 'Super two locks super three.',
    })
    expect(locked.status, JSON.stringify(locked.body)).toBe(200)

    const lockBack = await asConsole(three, 'POST', `/admin/users/${sup2Id}/disable`, {
      idempotencyKey: `lvl-three-locks-two-${run}`,
      id: sup2Id,
      reason: 'Super three, already locked, locks super two back.',
    })
    expect(lockBack.status, JSON.stringify(lockBack.body)).toBe(403)
    expect(lockBack.body.message).toBe('This console account is no longer active')

    const [sup2] = await db.select().from(users).where(eq(users.id, sup2Id))
    expect(sup2?.status).toBe('active')
    const signIn = await platformSignIn(`l${run}.sup2`)
    expect(signIn.status, JSON.stringify(signIn.body)).toBe(200)

    // Two supers pressing "Lock this login" on each other at the same instant: the disable locks both
    // identities in id order and re-reads the actor under that lock, so the second one waits, finds
    // its own login locked and is refused — one of the two is always still active.
    const four = await consoleHeaders(sup4Id)
    const five = await consoleHeaders(sup5Id)
    const [a, b] = await Promise.all([
      asConsole(four, 'POST', `/admin/users/${sup5Id}/disable`, {
        idempotencyKey: `lvl-four-locks-five-${run}`,
        id: sup5Id,
        reason: 'Super four locks super five.',
      }),
      asConsole(five, 'POST', `/admin/users/${sup4Id}/disable`, {
        idempotencyKey: `lvl-five-locks-four-${run}`,
        id: sup4Id,
        reason: 'Super five locks super four.',
      }),
    ])
    expect(
      [a.status, b.status].sort(),
      `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`,
    ).toEqual([200, 403])
    const refused = a.status === 403 ? a : b
    expect(refused.body.message).toBe('This console account is no longer active')
    const pair = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(sql`${users.id} in (${sup4Id}, ${sup5Id})`)
    expect(pair.filter((row) => row.status === 'active')).toHaveLength(1)
  })

  it('DOS-106: a demotion or a locked login bites on the very next request with the same token — every admin.* read and mutation re-reads the level and the login', async () => {
    const demoted = await consoleHeaders(demotedId)
    const asSuper = await asConsole(demoted, 'GET', `/admin/tenants/${lvlTenantId}`)
    expect(asSuper.status, JSON.stringify(asSuper.body)).toBe(200)

    // Demoted to support in the database. The token in hand still says `platform_admin`, as it will
    // for up to fifteen minutes; the level is what the NEXT request reads.
    await db
      .update(platformAdmins)
      .set({ role: 'support' })
      .where(eq(platformAdmins.userId, demotedId))
    expectLevelRefusal(
      await asConsole(demoted, 'POST', `/admin/tenants/${lvlTenantId}/suspend`, {
        idempotencyKey: `lvl-demoted-suspend-${run}`,
        id: lvlTenantId,
        reason: 'A demoted super tries to suspend.',
      }),
      'support',
      'admin.tenants.suspend',
    )
    const stillReads = await asConsole(demoted, 'GET', `/admin/tenants/${lvlTenantId}`)
    expect(stillReads.status, JSON.stringify(stillReads.body)).toBe(200)

    // The login is locked (`users.status`), the console row untouched, the same token in hand:
    // every one of the fifteen console procedures refuses, the reads as well as the writes.
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, demotedId))
    const table = probes('locked', '2')
    expect(Object.keys(table).sort()).toEqual(
      allProcedures()
        .map((row) => row.path)
        .filter((path) => path.startsWith('admin.'))
        .sort(),
    )
    const before = await levelSnapshot(demotedId)
    for (const [path, probe] of Object.entries(table)) {
      const res = await asConsole(demoted, probe.method, probe.url, probe.payload)
      expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(403)
      expect(res.body.message, path).toBe('This console account is no longer active')
    }
    expect(await levelSnapshot(demotedId)).toEqual(before)

    // And a console row that was closed (`disabled_at`) on a login that is still active: a read too.
    await db.update(users).set({ status: 'active' }).where(eq(users.id, demotedId))
    await db
      .update(platformAdmins)
      .set({ disabledAt: new Date() })
      .where(eq(platformAdmins.userId, demotedId))
    const closed = await asConsole(demoted, 'GET', '/admin/subscriptions', {
      tenantId: lvlTenantId,
    })
    expect(closed.status, JSON.stringify(closed.body)).toBe(403)
    expect(closed.body.message).toBe('This console account is no longer active')
  })
})

/** Polls a condition for up to two seconds; for the audit row the interceptor writes after the reply. */
async function waitFor(check: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 40; i += 1) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

function toQuery(payload?: Record<string, unknown>): Record<string, string> {
  const q: Record<string, string> = {}
  for (const [k, v] of Object.entries(payload ?? {})) {
    if (v === undefined) continue
    q[k] =
      typeof v === 'string'
        ? v
        : typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : JSON.stringify(v)
  }
  return q
}
