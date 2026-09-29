import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { GiveShopSignInInput } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  auditLog,
  authEvents,
  authSessions,
  createDb,
  createPool,
  hashPassword,
  idempotencyKeys,
  memberships,
  outboxEvents,
  retailerIdentities,
  retailerLinks,
  retailers,
  tenants,
  users,
  verifyPassword,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withoutSecrets } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { AuthModule } from '../auth/index.js'
import { RetailersModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface SignIn {
  username: string | null
  since: string
}
interface GiveBody {
  outcome: 'created' | 'existing' | 'already'
  signIn: SignIn
  message?: string
}
interface SignInBody {
  signIn: SignIn | null
  message?: string
}
interface Pair {
  accessToken: string
  refreshToken: string
  user: { id: string; username: string | null; mustChangePassword: boolean }
  role: string
  message?: string
}
type ShopView = Record<string, unknown> & { id: string; appSignIn?: SignIn | null }

/**
 * DOS-400 — the desk gives a shop its app sign-in (architect's ruling, 2026-09-29). Every write here is
 * the API the app calls, as the person who calls it; the shopkeeper then signs in through auth-service
 * with the first password and reads its own shop under the row-level rules.
 */
describeDb('retailers.signIn (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8) // digits only: phones are +91[6-9] + 9 digits
  const phone = (n: number) => `+917${run.slice(-7)}${String(n)}`

  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const repId = uuidv7()
  const knownUserId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const store: Actor = { tenantId, actorId: uuidv7(), role: 'warehouse' }
  const crew: Actor = { tenantId, actorId: uuidv7(), role: 'delivery' }
  const aShop: Actor = { tenantId, actorId: uuidv7(), role: 'retailer' }

  const shopNew = uuidv7()
  const shopNoMobile = uuidv7()
  const shopKnown = uuidv7()
  const twinOne = uuidv7()
  const twinTwo = uuidv7()
  const shopStaffPhone = uuidv7()
  const shopClosed = uuidv7()
  const knownUsername = `known.${run}`
  /** What the server makes from the shopkeeper’s name on the shop: its first two words, lower case. */
  const sharmaKirana = `sharma${run}.kirana`
  const knownPassword = 'Known1234'
  let knownHash = ''
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `shop-in-${run}`, legalName: 'Sign-in test', stateCode: '27' },
      { id: otherTenantId, slug: `shop-in-o-${run}`, legalName: 'Another', stateCode: '27' },
    ])
    knownHash = await hashPassword(knownPassword)
    await db.insert(users).values([
      { id: ownerId, phone: phone(11), name: 'Owner' },
      { id: managerId, phone: phone(12), name: 'Manager' },
      { id: accountantId, phone: phone(13), name: 'Accountant' },
      { id: repId, phone: phone(14), name: 'Rep' },
      // A shopkeeper who already buys from ANOTHER distributor and signs in there.
      {
        id: knownUserId,
        phone: phone(21),
        name: 'Known Shopkeeper',
        username: knownUsername,
        passwordHash: knownHash,
      },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId: otherTenantId, userId: knownUserId, role: 'retailer' },
    ])
    const shop = (id: string, code: string, name: string, shopPhone: string, active = true) => ({
      id,
      tenantId,
      code: `S${run}${code}`,
      name,
      ownerName: `${name} owner`,
      phone: shopPhone,
      stateCode: '27',
      active,
    })
    await db
      .insert(retailers)
      .values([
        shop(shopNew, 'A', `Sharma${run} Kirana Stores`, phone(31)),
        shop(shopNoMobile, 'B', `Blank${run} Phone General`, ''),
        shop(shopKnown, 'C', 'Known Traders', phone(21)),
        shop(twinOne, 'D', 'Twin Mart One', phone(41)),
        shop(twinTwo, 'E', 'Twin Mart Two', phone(41)),
        shop(shopStaffPhone, 'F', 'Rep Cousin Store', phone(14)),
        shop(shopClosed, 'G', 'Closed Corner', phone(51), false),
      ])
    app = await bootTestApp([RetailersModule, AuthModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const give = (actor: Actor, shopId: string, extra: Record<string, unknown> = {}) =>
    call<GiveBody>(app, actor, 'POST', `/retailers/${shopId}/sign-in`, {
      idempotencyKey: uuidv7(),
      id: shopId,
      userId: uuidv7(),
      membershipId: uuidv7(),
      firstPassword: 'First4321',
      ...extra,
    })

  const login = (username: string, password: string) =>
    call<Pair>(app, null, 'POST', '/auth/login', {
      username,
      password,
      deviceId: uuidv7(),
      platform: 'web',
    })

  async function asToken<T>(
    token: string,
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<{ status: number; body: T }> {
    const res = await app.inject({
      method,
      url: path,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(method === 'GET'
        ? { query: (payload ?? {}) as Record<string, string> }
        : { payload: JSON.stringify(payload ?? {}) }),
    })
    return { status: res.statusCode, body: res.json() }
  }

  const userByPhone = async (p: string) =>
    (await db.select().from(users).where(eq(users.phone, p))).map((u) => u)

  it('gives a shop with no login a username and a first password it must change, as the rows the seed writes', async () => {
    const firstPassword = 'Kirana2468'
    const body = {
      idempotencyKey: uuidv7(),
      id: shopNew,
      userId: uuidv7(),
      membershipId: uuidv7(),
      firstPassword,
    }
    const res = await call<GiveBody>(app, manager, 'POST', `/retailers/${shopNew}/sign-in`, body)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.outcome).toBe('created')
    expect(res.body.signIn.username).toBe(sharmaKirana)
    expect(Date.parse(res.body.signIn.since)).toBeGreaterThan(Date.now() - 60_000)
    expect(JSON.stringify(res.body)).not.toContain(firstPassword)

    // users: one person, the first password as an argon2id hash, to be changed at the first sign-in
    const [person, ...more] = await userByPhone(phone(31))
    expect(more).toHaveLength(0)
    expect(person?.id).toBe(body.userId)
    expect(person?.username).toBe(sharmaKirana)
    expect(person?.name).toBe(`Sharma${run} Kirana Stores owner`)
    expect(person?.mustChangePassword).toBe(true)
    expect(person?.passwordHash).not.toContain(firstPassword)
    expect(await verifyPassword(person?.passwordHash ?? '', firstPassword)).toBe(true)
    // memberships: a shopkeeper here
    const [member] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, body.userId)))
    expect(member).toMatchObject({ id: body.membershipId, role: 'retailer', status: 'active' })
    // retailer_identities: the shop across the platform, naming that login
    const [identity] = await db
      .select()
      .from(retailerIdentities)
      .where(eq(retailerIdentities.phone, phone(31)))
    expect(identity?.userId).toBe(body.userId)
    // retailer_links: the link the row-level rules read; the shop names its identity
    const links = await db.select().from(retailerLinks).where(eq(retailerLinks.retailerId, shopNew))
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      identityId: identity?.id,
      userId: body.userId,
      status: 'active',
      role: 'owner',
    })
    const [row] = await db.select().from(retailers).where(eq(retailers.id, shopNew))
    expect(row?.identityId).toBe(identity?.id)

    // the trail: an audit row, the auth event, the outbox event — and the password in none of them
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, shopNew), eq(auditLog.action, 'retailer.sign_in.give')))
    expect(audits).toHaveLength(1)
    expect(audits[0]?.actorId).toBe(managerId)
    expect(JSON.stringify(audits)).not.toContain(firstPassword)
    const events = await db
      .select()
      .from(authEvents)
      .where(and(eq(authEvents.userId, body.userId), eq(authEvents.kind, 'password_set_by_admin')))
    expect(events).toHaveLength(1)
    expect(events[0]?.tenantId).toBe(tenantId)
    const outbox = await db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.aggregateId, shopNew), eq(outboxEvents.tenantId, tenantId)))
    expect(outbox.map((e) => e.eventType)).toEqual(['retailer.identity_linked'])
    expect(JSON.stringify(outbox)).not.toContain(firstPassword)

    // the idempotency store: the reply carries no password, and the key is filed WITHOUT it
    const [key] = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, body.idempotencyKey)),
      )
    const parsed = GiveShopSignInInput.parse(body)
    const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
    expect(key?.requestHash).not.toBe(sha(parsed))
    expect(key?.requestHash).toBe(sha(withoutSecrets(parsed, ['firstPassword'])))
    expect(JSON.stringify(key?.response)).not.toContain(firstPassword)

    // a replay answers byte for byte what was answered, and still gives no password back
    const again = await call<GiveBody>(app, manager, 'POST', `/retailers/${shopNew}/sign-in`, body)
    expect(again.status).toBe(200)
    expect(again.body).toEqual(res.body)
  })

  it('answers what exists to a second request for the same shop, and never makes a second user', async () => {
    const res = await give(owner, shopNew, { username: 'another.name' })
    expect(res.status).toBe(200)
    expect(res.body.outcome).toBe('already')
    expect(res.body.signIn.username).toBe(sharmaKirana)
    expect(await userByPhone(phone(31))).toHaveLength(1)
  })

  it('lets the shopkeeper sign in with the first password, be made to change it, and see only its own shop', async () => {
    const first = await login(sharmaKirana, 'Kirana2468')
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.role).toBe('retailer')
    expect(first.body.user.mustChangePassword).toBe(true)

    const own = await asToken<{ items: ShopView[] }>(first.body.accessToken, 'GET', '/retailers', {
      activeOnly: 'false',
    })
    expect(own.status).toBe(200)
    expect(own.body.items.map((s) => s.id)).toEqual([shopNew])
    expect(own.body.items[0]).not.toHaveProperty('code')
    expect(own.body.items[0]).not.toHaveProperty('appSignIn')

    const changed = await asToken<{ ok: boolean }>(
      first.body.accessToken,
      'POST',
      '/auth/change-password',
      { currentPassword: 'Kirana2468', newPassword: 'MyOwn9753' },
    )
    expect(changed.status).toBe(200)
    const second = await login(sharmaKirana, 'MyOwn9753')
    expect(second.status).toBe(200)
    expect(second.body.user.mustChangePassword).toBe(false)
  })

  it('shows the back office whether a shop signs in and as whom, and the field nothing', async () => {
    for (const desk of [owner, manager, accountant]) {
      const list = await call<{ items: ShopView[] }>(app, desk, 'GET', '/retailers', {
        q: `S${run}`,
        activeOnly: 'false',
      })
      expect(list.status).toBe(200)
      const byId = new Map(list.body.items.map((s) => [s.id, s]))
      expect(byId.get(shopNew)?.appSignIn?.username, desk.role).toBe(sharmaKirana)
      expect(byId.get(twinOne)?.appSignIn, desk.role).toBeNull()
      const one = await call<{ item: ShopView }>(app, desk, 'GET', `/retailers/${shopNew}`)
      expect(one.body.item.appSignIn?.username).toBe(sharmaKirana)
      expect(Date.parse(one.body.item.appSignIn?.since ?? '')).toBeGreaterThan(0)
    }
    const field = await call<{ items: ShopView[] }>(app, rep, 'GET', '/retailers', {
      q: `S${run}`,
      activeOnly: 'false',
    })
    expect(field.status).toBe(200)
    for (const item of field.body.items) expect(item).not.toHaveProperty('appSignIn')
  })

  it('asks for a mobile number first when the shop has none, then makes it the shop’s', async () => {
    const refused = await give(owner, shopNoMobile)
    expect(refused.status).toBe(400)
    expect(refused.body.message).toBe(
      'This shop has no mobile number. Enter the shopkeeper’s mobile number first.',
    )
    const res = await give(owner, shopNoMobile, { phone: phone(32) })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.outcome).toBe('created')
    expect(res.body.signIn.username).toBe(`blank${run}.phone`)
    const [row] = await db.select().from(retailers).where(eq(retailers.id, shopNoMobile))
    expect(row?.phone).toBe(phone(32))
    // a shop that has a mobile is not given another behind its back
    const other = await give(owner, twinOne, { phone: phone(99) })
    expect(other.status).toBe(400)
    expect(other.body.message).toContain('change it on the shop first')
  })

  it('adds the shop to a known shopkeeper’s list: no new user, no new password, nothing said about where', async () => {
    const res = await give(owner, shopKnown, { username: 'ignored.name' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.outcome).toBe('existing')
    expect(res.body.signIn.username).toBe(knownUsername)
    expect(JSON.stringify(res.body)).not.toContain(otherTenantId)
    const people = await userByPhone(phone(21))
    expect(people).toHaveLength(1)
    expect(people[0]?.passwordHash).toBe(knownHash)
    expect(people[0]?.mustChangePassword).toBe(false)
    const noted = await db
      .select()
      .from(authEvents)
      .where(and(eq(authEvents.userId, knownUserId), eq(authEvents.kind, 'password_set_by_admin')))
    expect(noted).toHaveLength(0)
    // the shopkeeper's own password now opens this distributor too
    const pair = await login(knownUsername, knownPassword)
    expect(pair.status).toBe(200)
    const both = await db
      .select({ tenantId: memberships.tenantId, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.userId, knownUserId))
    expect(both.map((m) => m.tenantId).sort()).toEqual([tenantId, otherTenantId].sort())
    // …and this desk may not reset a password the shopkeeper also uses elsewhere
    const reset = await call<SignInBody>(
      app,
      owner,
      'POST',
      `/retailers/${shopKnown}/sign-in/password`,
      {
        idempotencyKey: uuidv7(),
        id: shopKnown,
        firstPassword: 'Reset12345',
      },
    )
    expect(reset.status).toBe(409)
    expect(reset.body.message).toBe(
      'This sign-in is not yours alone to reset: the shopkeeper also uses it with another business. Only the shopkeeper can change its password.',
    )
    const [still] = await userByPhone(phone(21))
    expect(still?.passwordHash).toBe(knownHash)
  })

  it('puts two shops of one owner with the same phone on the same login', async () => {
    const one = await give(manager, twinOne)
    expect(one.body.outcome).toBe('created')
    const two = await give(manager, twinTwo)
    expect(two.status).toBe(200)
    expect(two.body.outcome).toBe('existing')
    expect(two.body.signIn.username).toBe(one.body.signIn.username)
    const people = await userByPhone(phone(41))
    expect(people).toHaveLength(1)
    const links = await db
      .select({ retailerId: retailerLinks.retailerId, userId: retailerLinks.userId })
      .from(retailerLinks)
      .where(eq(retailerLinks.userId, people[0]?.id ?? ''))
    expect(links.map((l) => l.retailerId).sort()).toEqual([twinOne, twinTwo].sort())
    const shopkeeperMemberships = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, people[0]?.id ?? '')))
    expect(shopkeeperMemberships).toHaveLength(1)
  })

  it('gives a new first password to a shop that forgot its own: must change, signed out everywhere', async () => {
    const before = await login(sharmaKirana, 'MyOwn9753')
    expect(before.status).toBe(200)
    const [person] = await userByPhone(phone(31))
    const res = await call<SignInBody>(
      app,
      manager,
      'POST',
      `/retailers/${shopNew}/sign-in/password`,
      {
        idempotencyKey: uuidv7(),
        id: shopNew,
        firstPassword: 'Again8642',
      },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.signIn?.username).toBe(sharmaKirana)
    expect(JSON.stringify(res.body)).not.toContain('Again8642')
    const [after] = await userByPhone(phone(31))
    expect(after?.mustChangePassword).toBe(true)
    expect(await verifyPassword(after?.passwordHash ?? '', 'Again8642')).toBe(true)
    const live = await db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.userId, person?.id ?? ''), sql`${authSessions.revokedAt} is null`))
    expect(live).toHaveLength(0)
    expect((await login(sharmaKirana, 'MyOwn9753')).status).toBe(401)
    expect((await login(sharmaKirana, 'Again8642')).body.user.mustChangePassword).toBe(true)
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, shopNew), eq(auditLog.action, 'retailer.sign_in.password')))
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits)).not.toContain('Again8642')
    // a shop with no sign-in has nothing to reset
    const none = await call<SignInBody>(
      app,
      owner,
      'POST',
      `/retailers/${shopClosed}/sign-in/password`,
      {
        idempotencyKey: uuidv7(),
        id: shopClosed,
        firstPassword: 'Again8642',
      },
    )
    expect(none.status).toBe(409)
    expect(none.body.message).toBe('This shop has no sign-in yet. Give it one first.')
  })

  it('stops a shop’s sign-in here only: the other twin, the other distributor and the books stay', async () => {
    const [twin] = await userByPhone(phone(41))
    const twinId = twin?.id ?? ''
    const first = await call<SignInBody>(app, owner, 'POST', `/retailers/${twinOne}/sign-in/stop`, {
      idempotencyKey: uuidv7(),
      id: twinOne,
    })
    expect(first.status).toBe(200)
    expect(first.body.signIn).toBeNull()
    // the other shop is still on the login, so the membership stays
    const [kept] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, twinId)))
    expect(kept?.status).toBe('active')
    const second = await call<SignInBody>(
      app,
      owner,
      'POST',
      `/retailers/${twinTwo}/sign-in/stop`,
      {
        idempotencyKey: uuidv7(),
        id: twinTwo,
      },
    )
    expect(second.body.signIn).toBeNull()
    const [off] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, twinId)))
    expect(off?.status).toBe('disabled')
    const pair = await login(twin?.username ?? '', 'First4321')
    expect(pair.status).toBe(403)
    // the shops, their links and the identity stay; only the login's reach is cut
    const links = await db.select().from(retailerLinks).where(eq(retailerLinks.retailerId, twinOne))
    expect(links).toHaveLength(1)
    expect(links[0]?.userId).toBeNull()
    const [identity] = await db
      .select()
      .from(retailerIdentities)
      .where(eq(retailerIdentities.phone, phone(41)))
    expect(identity?.userId).toBe(twinId)
    // stopping one that is not there answers the same
    const again = await call<SignInBody>(app, owner, 'POST', `/retailers/${twinOne}/sign-in/stop`, {
      idempotencyKey: uuidv7(),
      id: twinOne,
    })
    expect(again.status).toBe(200)
    expect(again.body.signIn).toBeNull()

    // the known shopkeeper stopped here keeps the other distributor
    const known = await call<SignInBody>(
      app,
      manager,
      'POST',
      `/retailers/${shopKnown}/sign-in/stop`,
      {
        idempotencyKey: uuidv7(),
        id: shopKnown,
      },
    )
    expect(known.status).toBe(200)
    const [elsewhere] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, otherTenantId), eq(memberships.userId, knownUserId)))
    expect(elsewhere?.status).toBe('active')
    const [person] = await userByPhone(phone(21))
    expect(person?.passwordHash).toBe(knownHash)

    // given again, the stopped login is the same person: no new user and no new password
    const back = await give(owner, twinOne)
    expect(back.body.outcome).toBe('existing')
    const [on] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, twinId)))
    expect(on?.status).toBe('active')
    expect(await userByPhone(phone(41))).toHaveLength(1)
  })

  it('refuses a number that belongs to someone who works here, and a shop that is switched off', async () => {
    const staff = await give(owner, shopStaffPhone)
    expect(staff.status).toBe(409)
    expect(staff.body.message).toBe(
      'This mobile number belongs to someone who works for you. A shop needs its own mobile number to sign in.',
    )
    const [repRow] = await userByPhone(phone(14))
    expect(repRow?.id).toBe(repId)
    const closed = await give(owner, shopClosed)
    expect(closed.status).toBe(409)
    expect(closed.body.message).toBe(
      'This shop is switched off. Switch it on before giving it a sign-in.',
    )
    const missing = await give(owner, uuidv7())
    expect(missing.status).toBe(404)
    expect(missing.body.message).toBe('This shop is not on your books.')
    const weak = await give(owner, shopClosed, { firstPassword: 'short1' })
    expect(weak.status).toBe(400)
  })

  it('is the owner’s and the manager’s alone: the accountant, the field, the godown, the crew and a shop are refused', async () => {
    for (const actor of [accountant, rep, store, crew, aShop]) {
      const res = await give(actor, twinTwo)
      expect(res.status, actor.role).toBe(403)
      const reset = await call(app, actor, 'POST', `/retailers/${shopNew}/sign-in/password`, {
        idempotencyKey: uuidv7(),
        id: shopNew,
        firstPassword: 'Again8642',
      })
      expect(reset.status, actor.role).toBe(403)
      const stop = await call(app, actor, 'POST', `/retailers/${shopNew}/sign-in/stop`, {
        idempotencyKey: uuidv7(),
        id: shopNew,
      })
      expect(stop.status, actor.role).toBe(403)
    }
  })
})
