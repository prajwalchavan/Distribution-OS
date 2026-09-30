import { and, eq } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import {
  auditLog,
  authSessions,
  createDb,
  createPool,
  hashPassword,
  memberships,
  retailerIdentities,
  retailerLinks,
  retailers,
  shopJoinRequests,
  tenants,
  tenantSettings,
  users,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { AuthModule } from '../auth/index.js'
import { TenancyModule } from '../tenancy/index.js'
import { RetailersModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface Pair {
  accessToken: string
  refreshToken: string
  user: { id: string; username: string | null; mustChangePassword: boolean }
  tenant: { id: string; displayName: string } | null
  role: string | null
  memberships: { tenantId: string; role: string; status: string }[]
  message?: string
}
interface Mine {
  id: string
  tenantId: string
  distributor: string
  shop: string
  via: 'code' | 'name'
  state: string
  reason: string | null
}
interface DeskRequest {
  id: string
  personName: string
  personPhone: string
  shopName: string
  via: string
  shop: { id: string; name: string; code: string; shopCode: string } | null
  state: string
  reason: string | null
}
interface Refusal {
  message?: string
  code?: string
}

const IN_USE = 'That username or number is already in use. Sign in, or use another.'
const NO_SUCH_CODE = 'No shop has this code. Check the code on your bill.'
const NOT_JOINED_YET =
  'This account is not joined to a distributor yet. Ask to join a distributor’s shop from the app; you can use this once they approve.'

/**
 * THE SHOPKEEPER IS INDEPENDENT (founder, 2026-09-29, docs/22 §8). Every step is the API the apps call, as the
 * person who calls it: the shopkeeper signs up and asks through auth-service with the account's own token; the desk
 * reads and decides through the retailers procedures with the owner's, the manager's (or a stranger's) token.
 */
describeDb('the shopkeeper signs up, asks to join a shop, the desk decides (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const phone = (n: number) =>
    `+918${run.slice(-7)}${String(n).padStart(2, '0').slice(-2)}`.slice(0, 13)
  /** Each run signs up from its own addresses, so the per-address limit of one run never meets another's. */
  const address = (n: number) => `10.${String(Number(run.slice(-3)) % 250)}.${String(n)}.7`

  const tenantA = uuidv7()
  const tenantB = uuidv7()
  const ownerA: Actor = { tenantId: tenantA, actorId: uuidv7(), role: 'owner' }
  const managerA: Actor = { tenantId: tenantA, actorId: uuidv7(), role: 'manager' }
  const accountantA: Actor = { tenantId: tenantA, actorId: uuidv7(), role: 'accountant' }
  const repA: Actor = { tenantId: tenantA, actorId: uuidv7(), role: 'salesperson' }
  const ownerB: Actor = { tenantId: tenantB, actorId: uuidv7(), role: 'owner' }
  const shopOne = uuidv7()
  const shopTwo = uuidv7()
  const shopWithLogin = uuidv7()
  const shopOff = uuidv7()
  const shopMatchingNumber = uuidv7()
  const shopThree = uuidv7()
  const shopFour = uuidv7()
  const shopB = uuidv7()
  const codes = new Map<string, string>()
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db.insert(tenants).values([
      {
        id: tenantA,
        slug: `join-a-${run}`,
        legalName: `Alpha Distributors ${run}`,
        stateCode: '27',
      },
      { id: tenantB, slug: `join-b-${run}`, legalName: `Beta Agencies ${run}`, stateCode: '27' },
    ])
    const staff = [ownerA, managerA, accountantA, repA, ownerB]
    const repHash = await hashPassword('Rep24680')
    await db.insert(users).values(
      staff.map((a, i) => ({
        id: a.actorId,
        phone: phone(60 + i),
        name: `Staff ${String(i)}`,
        ...(a === repA ? { username: `rep.${run}`, passwordHash: repHash } : {}),
      })),
    )
    await db
      .insert(memberships)
      .values(
        staff.map((a) => ({ id: uuidv7(), tenantId: a.tenantId, userId: a.actorId, role: a.role })),
      )
    const shop = (
      id: string,
      tenantId: string,
      code: string,
      name: string,
      p: string,
      active = true,
    ) => ({
      id,
      tenantId,
      code: `J${run}${code}`,
      name,
      phone: p,
      stateCode: '27',
      active,
    })
    await db
      .insert(retailers)
      .values([
        shop(shopOne, tenantA, 'A', `Gupta${run} Kirana`, phone(70)),
        shop(shopTwo, tenantA, 'B', `Patil${run} General`, phone(71)),
        shop(shopWithLogin, tenantA, 'C', `Desk${run} Given Stores`, phone(72)),
        shop(shopOff, tenantA, 'D', `Closed${run} Corner`, phone(73), false),
        shop(shopMatchingNumber, tenantA, 'E', `Same${run} Number Mart`, phone(3)),
        shop(shopThree, tenantA, 'G', `Third${run} Provisions`, phone(75)),
        shop(shopFour, tenantA, 'H', `Fourth${run} Stores`, phone(76)),
        shop(shopB, tenantB, 'F', `Beta${run} Side Shop`, phone(74)),
      ])
    for (const row of await db
      .select({ id: retailers.id, code: retailers.shopCode })
      .from(retailers)) {
      codes.set(row.id, row.code)
    }
    app = await bootTestApp([RetailersModule, AuthModule, TenancyModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const code = (shopId: string): string => codes.get(shopId) ?? ''

  async function asAccount<T>(
    token: string | null,
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, unknown>,
    ip = '127.0.0.1',
  ): Promise<{ status: number; body: T }> {
    const res = await app.inject({
      method,
      url: path,
      remoteAddress: ip,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
      },
      ...(method === 'GET'
        ? {
            query: Object.fromEntries(
              Object.entries(payload ?? {}).map(([k, v]) => [k, String(v)]),
            ),
          }
        : { payload: JSON.stringify(payload ?? {}) }),
    })
    return { status: res.statusCode, body: res.json() }
  }

  const signUp = (n: number, extra: Record<string, unknown> = {}, ip = address(1)) =>
    asAccount<Pair>(
      null,
      'POST',
      '/auth/sign-up',
      {
        id: uuidv7(),
        phone: phone(n),
        username: `shopper${String(n)}.${run}`,
        password: 'OwnWay2468',
        name: `Shopkeeper ${String(n)}`,
        shopName: `My Shop ${String(n)}`,
        deviceId: uuidv7(),
        platform: 'web',
        ...extra,
      },
      ip,
    )

  const login = (username: string, password: string, extra: Record<string, unknown> = {}) =>
    asAccount<Pair>(null, 'POST', '/auth/login', {
      username,
      password,
      deviceId: uuidv7(),
      platform: 'web',
      ...extra,
    })

  const refresh = (pair: { refreshToken: string }, deviceId: string) =>
    asAccount<Pair>(null, 'POST', '/auth/refresh', { refreshToken: pair.refreshToken, deviceId })

  const ask = (token: string, body: Record<string, unknown>) =>
    asAccount<{ item: Mine } & Refusal>(token, 'POST', '/auth/joins', {
      idempotencyKey: uuidv7(),
      id: uuidv7(),
      ...body,
    })

  const deskList = (actor: Actor, state = 'waiting') =>
    call<{ items: DeskRequest[] } & Refusal>(app, actor, 'GET', '/shop-joins', { state })

  const approve = (actor: Actor, id: string, extra: Record<string, unknown> = {}) =>
    call<{ item: DeskRequest } & Refusal>(app, actor, 'POST', `/shop-joins/${id}/approve`, {
      idempotencyKey: uuidv7(),
      id,
      membershipId: uuidv7(),
      ...extra,
    })

  /** Sign up on a device, and keep that device's id for the refreshes that follow. */
  async function account(n: number): Promise<{ pair: Pair; deviceId: string; username: string }> {
    const deviceId = uuidv7()
    const res = await signUp(n, { deviceId }, address(2))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return { pair: res.body, deviceId, username: `shopper${String(n)}.${run}` }
  }

  it('makes an account of the shopkeeper’s own, with no distributor, and signs it in', async () => {
    const id = uuidv7()
    const res = await signUp(1, { id })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.tenant).toBeNull()
    expect(res.body.role).toBeNull()
    expect(res.body.user).toMatchObject({
      id,
      username: `shopper1.${run}`,
      mustChangePassword: false,
    })
    expect(res.body.memberships).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain('OwnWay2468')
    const [person] = await db.select().from(users).where(eq(users.id, id))
    expect(person?.signedUpAt).not.toBeNull()
    expect(person?.shopName).toBe('My Shop 1')
    expect(person?.mustChangePassword).toBe(false)
    expect(await db.select().from(memberships).where(eq(memberships.userId, id))).toEqual([])
    const sessions = await db.select().from(authSessions).where(eq(authSessions.userId, id))
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ tenantId: null, role: null })
  })

  it('refuses a taken username and a taken number with the same one sentence', async () => {
    const takenName = await signUp(2, { username: `shopper1.${run}` })
    const takenNumber = await signUp(1, { username: `fresh2.${run}` })
    expect(takenName.status).toBe(409)
    expect(takenNumber.status).toBe(409)
    expect((takenName.body as Refusal).message).toBe(IN_USE)
    expect((takenNumber.body as Refusal).message).toBe(IN_USE)
    // A staff member's number is somebody's account too, and gets the same sentence.
    const staffNumber = await signUp(60, { username: `fresh60.${run}` })
    expect((staffNumber.body as Refusal).message).toBe(IN_USE)
  })

  it('holds the password rules of every login', async () => {
    const weak = await signUp(4, { password: 'short1' })
    expect(weak.status).toBe(400)
    const noDigit = await signUp(4, { password: 'onlyletters' })
    expect(noDigit.status).toBe(400)
  })

  it('answers a username or a password that breaks a rule with the rule, in a sentence (M1)', async () => {
    // What a shopkeeper actually types: a space, a hyphen, a leading dot. The schema used to refuse these first,
    // with "Input validation failed", before the handler's sentences could answer.
    const chars =
      'Username may use only lowercase letters, digits, dots and underscores, and must start with a letter or digit'
    for (const username of ['ravi kumar', 'ravi-kumar', '.ravi']) {
      const res = await signUp(16, { username })
      expect(res.status, username).toBe(400)
      expect((res.body as Refusal).message, username).toBe(chars)
    }
    const short = await signUp(16, { username: 'ab' })
    expect((short.body as Refusal).message).toBe('Username must be 3–32 characters')
    const weak = await signUp(16, { password: 'short1' })
    expect((weak.body as Refusal).message).toBe('Password must be at least 8 characters')
    const noDigit = await signUp(16, { password: 'onlyletters' })
    expect((noDigit.body as Refusal).message).toBe('Password must contain at least one digit')
    const noLetter = await signUp(16, { password: '1234567890' })
    expect((noLetter.body as Refusal).message).toBe('Password must contain at least one letter')
    // Upper case and spaces around it are the same username, as at sign-in; nothing was made by the refusals.
    const fine = await signUp(16, { username: `  Ravi.Kumar${run} ` })
    expect(fine.status, JSON.stringify(fine.body)).toBe(200)
    expect(fine.body.user.username).toBe(`ravi.kumar${run}`)
  })

  it('signs in instead of refusing when the same sign-up is sent again', async () => {
    const id = uuidv7()
    const first = await signUp(5, { id })
    expect(first.status).toBe(200)
    const again = await signUp(5, { id })
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect(again.body.user.id).toBe(id)
    const wrongPassword = await signUp(5, { id, password: 'Another2468' })
    expect((wrongPassword.body as Refusal).message).toBe(IN_USE)
  })

  it('limits sign-ups per number and per client address, in words', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await signUp(6, { username: `burst${String(i)}.${run}` }, address(100 + i))
      statuses.push(res.status)
      if (i === 5)
        expect((res.body as Refusal).message).toBe(
          'Too many sign-ups from here. Try again in an hour.',
        )
    }
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true)
    expect(statuses[5]).toBe(429)
    const fromOne: number[] = []
    for (let i = 0; i < 21; i++) {
      const res = await signUp(20 + i, { username: `crowd${String(i)}.${run}` }, address(200))
      fromOne.push(res.status)
    }
    expect(fromOne.slice(0, 20).every((s) => s === 200)).toBe(true)
    expect(fromOne[20]).toBe(429)
  })

  it('signs the account in with no distributor only for an app that asks for it', async () => {
    const { username } = await account(7)
    const old = await login(username, 'OwnWay2468')
    expect(old.status).toBe(403)
    const now = await login(username, 'OwnWay2468', { accountWithoutDistributor: true })
    expect(now.status, JSON.stringify(now.body)).toBe(200)
    expect(now.body.tenant).toBeNull()
    expect(now.body.role).toBeNull()
  })

  it('answers every distributor procedure 403 in words, and the account’s own things work', async () => {
    const { pair } = await account(8)
    const shops = await asAccount<Refusal>(pair.accessToken, 'GET', '/retailers')
    expect(shops.status).toBe(403)
    expect(shops.body.message).toBe(NOT_JOINED_YET)
    const me = await asAccount<{ tenant: unknown; role: unknown }>(
      pair.accessToken,
      'GET',
      '/auth/me',
    )
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ tenant: null, role: null })
    const mine = await asAccount<{ items: unknown[] }>(pair.accessToken, 'GET', '/auth/joins')
    expect(mine.body.items).toEqual([])
    const changed = await asAccount<{ ok: boolean }>(
      pair.accessToken,
      'POST',
      '/auth/change-password',
      {
        currentPassword: 'OwnWay2468',
        newPassword: 'NewWay1357',
      },
    )
    expect(changed.status, JSON.stringify(changed.body)).toBe(200)
  })

  it('finds a distributor and a shop by the shop code, and nothing for any other code', async () => {
    const { pair } = await account(9)
    const found = await asAccount<{ distributor: string; shop: string }>(
      pair.accessToken,
      'GET',
      '/auth/joins/code',
      { code: code(shopOne).toLowerCase().replace('-', ' ') },
    )
    expect(found.status, JSON.stringify(found.body)).toBe(200)
    expect(found.body).toEqual({
      distributor: `Alpha Distributors ${run}`,
      shop: `Gupta${run} Kirana`,
    })
    for (const wrong of ['ZZZZ-ZZZZ', code(shopOff), 'K7MQ-4P20']) {
      const miss = await asAccount<Refusal>(pair.accessToken, 'GET', '/auth/joins/code', {
        code: wrong,
      })
      expect(miss.status, wrong).toBe(404)
      expect(miss.body.message).toBe(NO_SUCH_CODE)
    }
  })

  it('keeps a work login out of the shopkeeper’s doors', async () => {
    const rep = await login(`rep.${run}`, 'Rep24680')
    expect(rep.status, JSON.stringify(rep.body)).toBe(200)
    for (const [method, path] of [
      ['GET', '/auth/joins'],
      ['GET', '/auth/joins/distributors'],
    ] as const) {
      const res = await asAccount<Refusal>(rep.body.accessToken, method, path)
      expect(res.status, path).toBe(403)
      expect(res.body.message).toBe(
        'This sign-in is for work at a distributor. A shop needs its own account: sign up as a shopkeeper.',
      )
    }
    const asked = await ask(rep.body.accessToken, { by: 'code', code: code(shopOne) })
    expect(asked.status).toBe(403)
  })

  describe('the request and the decision', () => {
    let first: { pair: Pair; deviceId: string; username: string }
    let requestId = ''

    beforeAll(async () => {
      first = await account(10)
    })

    it('files one waiting request by code, and answers the same request when asked again', async () => {
      const one = await ask(first.pair.accessToken, { by: 'code', code: code(shopOne) })
      expect(one.status, JSON.stringify(one.body)).toBe(200)
      expect(one.body.item).toMatchObject({
        tenantId: tenantA,
        distributor: `Alpha Distributors ${run}`,
        shop: `Gupta${run} Kirana`,
        via: 'code',
        state: 'waiting',
      })
      requestId = one.body.item.id
      const two = await ask(first.pair.accessToken, { by: 'code', code: code(shopOne) })
      expect(two.body.item.id).toBe(requestId)
      const rows = await db
        .select()
        .from(shopJoinRequests)
        .where(eq(shopJoinRequests.userId, first.pair.user.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        personName: 'Shopkeeper 10',
        personPhone: phone(10),
        shopName: 'My Shop 10',
        retailerId: shopOne,
      })
    })

    it('shows the desk who asks; another distributor, the accountant and the rep see nothing', async () => {
      for (const desk of [ownerA, managerA]) {
        const list = await deskList(desk)
        expect(list.status).toBe(200)
        const row = list.body.items.find((r) => r.id === requestId)
        expect(row).toMatchObject({
          personName: 'Shopkeeper 10',
          personPhone: phone(10),
          shopName: 'My Shop 10',
          via: 'code',
          shop: {
            id: shopOne,
            name: `Gupta${run} Kirana`,
            code: `J${run}A`,
            shopCode: code(shopOne),
          },
        })
      }
      const other = await deskList(ownerB)
      expect(other.status).toBe(200)
      expect(other.body.items.find((r) => r.id === requestId)).toBeUndefined()
      expect((await deskList(accountantA)).status).toBe(403)
      expect((await deskList(repA)).status).toBe(403)
    })

    it('refuses an approval by another distributor’s desk, by the accountant and by the rep', async () => {
      const stranger = await approve(ownerB, requestId)
      expect(stranger.status).toBe(404)
      expect(stranger.body.message).toBe('This request is not on your list.')
      expect((await approve(accountantA, requestId)).status).toBe(403)
      expect((await approve(repA, requestId)).status).toBe(403)
      const [row] = await db
        .select()
        .from(shopJoinRequests)
        .where(eq(shopJoinRequests.id, requestId))
      expect(row?.state).toBe('waiting')
    })

    it('joins the account to the shop with the rows a desk-given sign-in writes; the next refresh lands there', async () => {
      const done = await approve(managerA, requestId)
      expect(done.status, JSON.stringify(done.body)).toBe(200)
      expect(done.body.item.state).toBe('approved')
      const userId = first.pair.user.id
      const [member] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantA), eq(memberships.userId, userId)))
      expect(member).toMatchObject({ role: 'retailer', status: 'active' })
      const [identity] = await db
        .select()
        .from(retailerIdentities)
        .where(eq(retailerIdentities.phone, phone(10)))
      expect(identity?.userId).toBe(userId)
      const links = await db
        .select()
        .from(retailerLinks)
        .where(and(eq(retailerLinks.retailerId, shopOne), eq(retailerLinks.userId, userId)))
      expect(links).toHaveLength(1)
      expect(links[0]).toMatchObject({ identityId: identity?.id, status: 'active', role: 'owner' })
      const audits = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.entityId, shopOne), eq(auditLog.action, 'retailer.shop_join.approve')),
        )
      expect(audits).toHaveLength(1)
      expect(audits[0]?.actorId).toBe(managerA.actorId)

      const next = await refresh(first.pair, first.deviceId)
      expect(next.status, JSON.stringify(next.body)).toBe(200)
      expect(next.body.tenant?.id).toBe(tenantA)
      expect(next.body.role).toBe('retailer')
      first.pair = next.body
      const shops = await asAccount<{ items: { id: string }[] }>(
        next.body.accessToken,
        'GET',
        '/retailers',
      )
      expect(shops.status).toBe(200)
      expect(shops.body.items.map((s) => s.id)).toEqual([shopOne])
      const mine = await asAccount<{ items: Mine[] }>(next.body.accessToken, 'GET', '/auth/joins')
      expect(mine.body.items[0]).toMatchObject({ id: requestId, state: 'approved' })
      // Asked again for the same shop: already joined, in words.
      const again = await ask(next.body.accessToken, { by: 'code', code: code(shopOne) })
      expect(again.status).toBe(409)
      expect(again.body.message).toBe('You are already joined to this shop.')
    })

    it('keeps a shop’s existing sign-in when a second account is approved for it', async () => {
      const given = await call<{ outcome: string; signIn: { username: string } }>(
        app,
        ownerA,
        'POST',
        `/retailers/${shopWithLogin}/sign-in`,
        {
          idempotencyKey: uuidv7(),
          id: shopWithLogin,
          userId: uuidv7(),
          membershipId: uuidv7(),
          firstPassword: 'First4321',
        },
      )
      expect(given.status, JSON.stringify(given.body)).toBe(200)
      const second = await account(11)
      const asked = await ask(second.pair.accessToken, { by: 'code', code: code(shopWithLogin) })
      const done = await approve(ownerA, asked.body.item.id)
      expect(done.status, JSON.stringify(done.body)).toBe(200)
      const links = await db
        .select()
        .from(retailerLinks)
        .where(and(eq(retailerLinks.retailerId, shopWithLogin), eq(retailerLinks.status, 'active')))
      expect(links.filter((l) => l.userId !== null)).toHaveLength(2)
      // The desk-given sign-in still signs in and still reaches its shop.
      const desk = await login(given.body.signIn.username, 'First4321')
      expect(desk.status, JSON.stringify(desk.body)).toBe(200)
      const shopPage = await call<{ item: { appSignIn?: { username: string } | null } }>(
        app,
        ownerA,
        'GET',
        `/retailers/${shopWithLogin}`,
      )
      expect(shopPage.body.item.appSignIn?.username).toBeTruthy()
      const next = await refresh(second.pair, second.deviceId)
      const shops = await asAccount<{ items: { id: string }[] }>(
        next.body.accessToken,
        'GET',
        '/retailers',
      )
      expect(shops.body.items.map((s) => s.id)).toEqual([shopWithLogin])
    })

    it('lets the desk refuse with a line the shopkeeper reads, and the shopkeeper withdraw', async () => {
      const third = await account(12)
      const asked = await ask(third.pair.accessToken, { by: 'code', code: code(shopTwo) })
      const refused = await call<{ item: DeskRequest }>(
        app,
        ownerA,
        'POST',
        `/shop-joins/${asked.body.item.id}/refuse`,
        { idempotencyKey: uuidv7(), id: asked.body.item.id, reason: 'We do not know this number.' },
      )
      expect(refused.status, JSON.stringify(refused.body)).toBe(200)
      const mine = await asAccount<{ items: Mine[] }>(third.pair.accessToken, 'GET', '/auth/joins')
      expect(mine.body.items[0]).toMatchObject({
        state: 'refused',
        reason: 'We do not know this number.',
      })
      const late = await approve(ownerA, asked.body.item.id)
      expect(late.status).toBe(409)
      expect(late.body.message).toBe('This request was refused already.')

      const again = await ask(third.pair.accessToken, { by: 'code', code: code(shopTwo) })
      expect(again.body.item.id).not.toBe(asked.body.item.id)
      const withdrawn = await asAccount<{ item: Mine }>(
        third.pair.accessToken,
        'POST',
        `/auth/joins/${again.body.item.id}/withdraw`,
        { idempotencyKey: uuidv7(), id: again.body.item.id },
      )
      expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200)
      expect(withdrawn.body.item.state).toBe('withdrawn')
      expect((await approve(ownerA, again.body.item.id)).body.message).toBe(
        'The shopkeeper withdrew this request.',
      )
      // Nothing of the distributor was ever readable by this account.
      const next = await refresh(third.pair, third.deviceId)
      expect(next.body.tenant).toBeNull()
    })

    it('answers a withdraw sent again with the request as it is, and an approved one with how to leave (m1)', async () => {
      const own = await account(17)
      const token = own.pair.accessToken
      const withdraw = (id: string) =>
        asAccount<{ item: Mine } & Refusal>(token, 'POST', `/auth/joins/${id}/withdraw`, {
          idempotencyKey: uuidv7(),
          id,
        })
      const asked = await ask(token, { by: 'code', code: code(shopFour) })
      expect(asked.status, JSON.stringify(asked.body)).toBe(200)
      const first = await withdraw(asked.body.item.id)
      expect(first.status, JSON.stringify(first.body)).toBe(200)
      expect(first.body.item.state).toBe('withdrawn')
      // A retry of the same withdraw (a reply that never arrived) is not "not one of yours".
      const retry = await withdraw(asked.body.item.id)
      expect(retry.status, JSON.stringify(retry.body)).toBe(200)
      expect(retry.body.item).toMatchObject({ id: asked.body.item.id, state: 'withdrawn' })

      // Asking again for the same shop is a NEW request (the app sends a new id for it, M2) and it waits.
      const again = await ask(token, { by: 'code', code: code(shopFour) })
      expect(again.status, JSON.stringify(again.body)).toBe(200)
      expect(again.body.item.id).not.toBe(asked.body.item.id)
      expect(again.body.item.state).toBe('waiting')
      // The same id sent again answers the request it made, as it is now: withdrawn, never "sent".
      const replay = await ask(token, { by: 'code', code: code(shopFour), id: asked.body.item.id })
      expect(replay.status, JSON.stringify(replay.body)).toBe(200)
      expect(replay.body.item).toMatchObject({ id: asked.body.item.id, state: 'withdrawn' })

      const approved = await approve(managerA, again.body.item.id)
      expect(approved.status, JSON.stringify(approved.body)).toBe(200)
      const late = await withdraw(again.body.item.id)
      expect(late.status, JSON.stringify(late.body)).toBe(409)
      expect(late.body.message).toBe(
        'This distributor has already joined you to the shop. To stop seeing it, leave the distributor from Settings.',
      )
      // Another account's request is still not one of yours.
      const stranger = await account(18)
      const theirs = await asAccount<Refusal>(
        stranger.pair.accessToken,
        'POST',
        `/auth/joins/${asked.body.item.id}/withdraw`,
        { idempotencyKey: uuidv7(), id: asked.body.item.id },
      )
      expect(theirs.status).toBe(404)
      expect(theirs.body.message).toBe('This request is not one of yours.')
    })

    it('by name: lists the distributors that allow it, and the desk picks the shop', async () => {
      await db.insert(tenantSettings).values({
        tenantId: tenantB,
        key: 'shops.listed_for_joining',
        value: false,
      })
      const fourth = await account(13)
      const listed = await asAccount<{ items: { tenantId: string; name: string }[] }>(
        fourth.pair.accessToken,
        'GET',
        '/auth/joins/distributors',
        { q: run },
      )
      expect(listed.status, JSON.stringify(listed.body)).toBe(200)
      expect(listed.body.items).toEqual([{ tenantId: tenantA, name: `Alpha Distributors ${run}` }])
      const unlisted = await ask(fourth.pair.accessToken, {
        by: 'name',
        tenantId: tenantB,
        shopName: 'Patil Stores',
      })
      expect(unlisted.status).toBe(404)
      const asked = await ask(fourth.pair.accessToken, {
        by: 'name',
        tenantId: tenantA,
        shopName: 'Patil General Stores',
      })
      expect(asked.status, JSON.stringify(asked.body)).toBe(200)
      expect(asked.body.item).toMatchObject({ via: 'name', shop: 'Patil General Stores' })
      const noShop = await approve(ownerA, asked.body.item.id)
      expect(noShop.status).toBe(400)
      expect(noShop.body.message).toBe('Choose which of your shops this is before approving.')
      const done = await approve(ownerA, asked.body.item.id, { retailerId: shopTwo })
      expect(done.status, JSON.stringify(done.body)).toBe(200)
      expect(done.body.item.shop?.id).toBe(shopTwo)
      await db
        .delete(tenantSettings)
        .where(
          and(
            eq(tenantSettings.tenantId, tenantB),
            eq(tenantSettings.key, 'shops.listed_for_joining'),
          ),
        )
    })

    it('adds a second distributor to the switcher; leaving and the desk’s stop each cut one distributor', async () => {
      const both = await account(14)
      const atA = await ask(both.pair.accessToken, { by: 'code', code: code(shopThree) })
      expect((await approve(managerA, atA.body.item.id)).status).toBe(200)
      const atB = await ask(both.pair.accessToken, { by: 'code', code: code(shopB) })
      expect((await approve(ownerB, atB.body.item.id)).status).toBe(200)
      const onA = await refresh(both.pair, both.deviceId)
      expect(onA.body.tenant?.id).toBe(tenantA)
      expect(onA.body.memberships.map((m) => m.tenantId).sort()).toEqual([tenantA, tenantB].sort())
      const onB = await asAccount<Pair>(null, 'POST', '/auth/switch-tenant', {
        refreshToken: onA.body.refreshToken,
        deviceId: both.deviceId,
        tenantId: tenantB,
      })
      expect(onB.status, JSON.stringify(onB.body)).toBe(200)
      const bShops = await asAccount<{ items: { id: string }[] }>(
        onB.body.accessToken,
        'GET',
        '/retailers',
      )
      expect(bShops.body.items.map((s) => s.id)).toEqual([shopB])

      // The shopkeeper leaves B while signed in at B: the session moves to A, and B's shop is gone at once.
      const left = await asAccount<{ ok: boolean }>(
        onB.body.accessToken,
        'POST',
        '/auth/joins/leave',
        {
          idempotencyKey: uuidv7(),
          tenantId: tenantB,
        },
      )
      expect(left.status, JSON.stringify(left.body)).toBe(200)
      const stale = await asAccount<{ items: unknown[] }>(onB.body.accessToken, 'GET', '/retailers')
      expect(stale.body.items).toEqual([])
      const back = await refresh(onB.body, both.deviceId)
      expect(back.status, JSON.stringify(back.body)).toBe(200)
      expect(back.body.tenant?.id).toBe(tenantA)
      const aShops = await asAccount<{ items: { id: string }[] }>(
        back.body.accessToken,
        'GET',
        '/retailers',
      )
      expect(aShops.body.items.map((s) => s.id)).toEqual([shopThree])
      const [atBMember] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantB), eq(memberships.userId, both.pair.user.id)))
      expect(atBMember?.status).toBe('disabled')
      const again = await asAccount<{ ok: boolean }>(
        back.body.accessToken,
        'POST',
        '/auth/joins/leave',
        {
          idempotencyKey: uuidv7(),
          tenantId: tenantB,
        },
      )
      expect(again.status).toBe(200)

      // Joined to B again; then A's desk stops the shop's sign-in (the existing stop): A is cut, B stays.
      const reAsk = await ask(back.body.accessToken, { by: 'code', code: code(shopB) })
      expect((await approve(ownerB, reAsk.body.item.id)).status).toBe(200)
      const stopped = await call<{ signIn: null }>(
        app,
        ownerA,
        'POST',
        `/retailers/${shopThree}/sign-in/stop`,
        { idempotencyKey: uuidv7(), id: shopThree },
      )
      expect(stopped.status, JSON.stringify(stopped.body)).toBe(200)
      const signIn = await login(both.username, 'OwnWay2468', { accountWithoutDistributor: true })
      expect(signIn.status, JSON.stringify(signIn.body)).toBe(200)
      expect(signIn.body.tenant?.id).toBe(tenantB)
      const onlyB = await asAccount<{ items: { id: string }[] }>(
        signIn.body.accessToken,
        'GET',
        '/retailers',
      )
      expect(onlyB.body.items.map((s) => s.id)).toEqual([shopB])
      // And when every distributor has let the account go, it signs in with none again.
      const leftB = await asAccount<{ ok: boolean }>(
        signIn.body.accessToken,
        'POST',
        '/auth/joins/leave',
        {
          idempotencyKey: uuidv7(),
          tenantId: tenantB,
        },
      )
      expect(leftB.status).toBe(200)
      const none = await login(both.username, 'OwnWay2468', { accountWithoutDistributor: true })
      expect(none.status, JSON.stringify(none.body)).toBe(200)
      expect(none.body.tenant).toBeNull()
    })

    it('never lets a desk set a password on, or give a sign-in on the number of, a shopkeeper’s own account', async () => {
      const own = await account(3)
      // The shop whose mobile is the account's own number: the desk's give is refused, nothing written.
      const give = await call<Refusal & { data?: { code?: string } }>(
        app,
        ownerA,
        'POST',
        `/retailers/${shopMatchingNumber}/sign-in`,
        {
          idempotencyKey: uuidv7(),
          id: shopMatchingNumber,
          userId: uuidv7(),
          membershipId: uuidv7(),
          firstPassword: 'First4321',
        },
      )
      expect(give.status).toBe(409)
      const [person] = await db.select().from(users).where(eq(users.id, own.pair.user.id))
      expect(person?.mustChangePassword).toBe(false)
      // Joined by approval, a new first password from the desk is refused.
      const asked = await ask(own.pair.accessToken, { by: 'code', code: code(shopMatchingNumber) })
      expect((await approve(ownerA, asked.body.item.id)).status).toBe(200)
      const reset = await call<Refusal>(
        app,
        ownerA,
        'POST',
        `/retailers/${shopMatchingNumber}/sign-in/password`,
        {
          idempotencyKey: uuidv7(),
          id: shopMatchingNumber,
          firstPassword: 'Reset9753',
        },
      )
      expect(reset.status).toBe(409)
      expect(reset.body.message).toBe(
        'This shopkeeper made their own sign-in, so only they can change its password. They can reset it from the sign-in screen.',
      )
      // The hire door refuses the account's number and username too.
      const hire = await call<Refusal>(app, ownerA, 'POST', '/tenancy/staff', {
        idempotencyKey: uuidv7(),
        id: uuidv7(),
        userId: uuidv7(),
        username: `hired.${run}`,
        name: 'Hired',
        phone: phone(9),
        role: 'salesperson',
        temporaryPassword: 'Temp24680',
      })
      expect(hire.status).toBe(409)
    })

    it('limits the shop codes one account may try, in words', async () => {
      const guesser = await account(15)
      let last = 0
      let message = ''
      for (let i = 0; i < 31; i++) {
        const res = await asAccount<Refusal>(guesser.pair.accessToken, 'GET', '/auth/joins/code', {
          code: 'ZZZZ-ZZZZ',
        })
        last = res.status
        message = res.body.message ?? ''
      }
      expect(last).toBe(429)
      expect(message).toBe('Too many shop codes tried. Try again in an hour.')
    })
  })
})
