/**
 * QA DOS-424 — R1 at the hire door (architect's ruling of 2026-09-29, docs/22 §8, item 1 said of
 * `tenancy.staff.create` too). The blind check made a login at one distributor and kept its first
 * password, then hired "a person" at a second distributor with that login's mobile, and again with a
 * login's username: each time the hire silently reused the login, so the first desk signed in at the
 * second distributor as its staff with the password it had kept, and read that distributor's shops. A
 * sign-in is never shared between businesses on the strength of a number or a name until a phone can
 * be proven (OTP, later).
 *
 * What is pinned here, as each desk (owner, manager) would send it:
 *  - a phone or a username whose sign-in another distributor (staff or shopkeeper, on or off) or the
 *    console holds, or that no business holds (a hire left half way): 409, one body per field whatever
 *    it is elsewhere, nothing written (users, memberships, auth_events, audit_log, idempotency_keys),
 *    and the existing login untouched (hash, first-password flag, lockout, name, phone, sessions);
 *  - the same request replayed with its key: the same 409, still nothing written;
 *  - one of this distributor's own people: as before ("already a member");
 *  - a wholly new person: made as before, and its replay gives back the same answer;
 *  - a hire left half way can be retried by the request that made it, and by nobody else.
 */
import { randomInt } from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import {
  authSessions,
  createDb,
  createPool,
  memberships,
  platformAdmins,
  tenants,
  users,
  verifyPassword,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { TenancyModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const PHONE_SENTENCE =
  'This mobile number already has a Distribution OS sign-in, which cannot be shared yet. Enter another mobile number for this person.'
const USERNAME_SENTENCE =
  'This username already has a Distribution OS sign-in, which cannot be shared yet. Choose another username.'

interface CreateBody {
  userId?: string
  membershipId?: string
  mustChangePassword?: boolean
  message?: string
}

/** A mobile the contract accepts, unlikely to be any other spec's: +91 6/7/8/9 and nine random digits. */
function phone(): string {
  return `+91${String(randomInt(6, 10))}${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`
}

describeDb('the hire door refuses a sign-in another business holds (R1, QA DOS-424)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = `${String(Date.now()).slice(-6)}${String(randomInt(0, 1000)).padStart(3, '0')}`

  const ours = uuidv7() // the distributor that hires ("Tarsun")
  const theirs = uuidv7() // another distributor ("Kalyan")
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const theirOwnerId = uuidv7()
  const owner: Actor = { tenantId: ours, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId: ours, actorId: managerId, role: 'manager' }
  const theirOwner: Actor = { tenantId: theirs, actorId: theirOwnerId, role: 'owner' }

  interface Person {
    key: string
    id: string
    phone: string
    username: string
    name: string
    hash: string
  }
  const person = (key: string): Person => ({
    key,
    id: uuidv7(),
    phone: phone(),
    username: `hd${run}.${key}`,
    name: `Person ${key}`,
    hash: `$argon2id$hire-door$${key}$${run}`,
  })
  /** Everyone a desk here must NOT be able to take: each "somewhere else" there is. */
  const theirManager = person('mgr') // the other distributor's manager, on a desk's first password
  const theirRep = person('rep') // the other distributor's salesperson
  const theirShop = person('shop') // the other distributor's shopkeeper
  const theirOff = person('off') // switched off at the other distributor
  const consoleSeat = person('seat') // Distribution OS staff: a console seat and no membership
  const halfWay = person('half') // a sign-in no business holds: a hire that stopped half way
  const foreign = [theirManager, theirRep, theirShop, theirOff, consoleSeat, halfWay]
  const ourRep = person('ours') // works here, and only here
  const nobody = person('none') // a person with no password: nobody can sign in as them

  let app: NestFastifyApplication

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: ours, slug: `hire-${run}`, legalName: 'Hiring distributor', stateCode: '27' },
      { id: theirs, slug: `hire-o-${run}`, legalName: 'Other distributor', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: phone(), name: 'Owner', username: `hd${run}.own` },
      { id: managerId, phone: phone(), name: 'Manager', username: `hd${run}.boss` },
      { id: theirOwnerId, phone: phone(), name: 'Their owner', username: `hd${run}.them` },
      ...[...foreign, ourRep].map((p) => ({
        id: p.id,
        phone: p.phone,
        name: p.name,
        username: p.username,
        passwordHash: p.hash,
        passwordChangedAt: new Date('2026-09-20T05:00:00.000Z'),
        mustChangePassword: p === theirManager,
      })),
      { id: nobody.id, phone: nobody.phone, name: nobody.name, username: null },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId: ours, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId: ours, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId: theirs, userId: theirOwnerId, role: 'owner' },
      { id: uuidv7(), tenantId: theirs, userId: theirManager.id, role: 'manager' },
      { id: uuidv7(), tenantId: theirs, userId: theirRep.id, role: 'salesperson' },
      { id: uuidv7(), tenantId: theirs, userId: theirShop.id, role: 'retailer' },
      {
        id: uuidv7(),
        tenantId: theirs,
        userId: theirOff.id,
        role: 'delivery',
        status: 'disabled',
      },
      { id: uuidv7(), tenantId: ours, userId: ourRep.id, role: 'salesperson' },
    ])
    await db
      .insert(platformAdmins)
      .values({ id: uuidv7(), userId: consoleSeat.id, role: 'support' })
    // The other distributor's manager is signed in: the refusal must not touch the session.
    await db.insert(authSessions).values({
      id: uuidv7(),
      userId: theirManager.id,
      tenantId: theirs,
      role: 'manager',
      deviceId: uuidv7(),
      refreshTokenHash: `hash-${run}-mgr`,
      refreshExpiresAt: new Date(Date.now() + 86_400_000),
    })
    app = await bootTestApp([TenancyModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  /**
   * Everything a hire could write, scoped to this file's two distributors and the people it names (the
   * other spec files write to the same tables at the same time): the row counts, and each named login
   * as it stands — hash, first-password flag, lockout, name, phone, username, status — with its sessions.
   */
  async function snapshot(named: { ids: string[]; phones: string[]; usernames: string[] }) {
    const ids = named.ids
    const count = async (query: ReturnType<typeof sql>) => {
      const result = await db.execute(query)
      return Number((result.rows[0] as { n: unknown }).n)
    }
    const tenantsSql = sql`(${ours}, ${theirs})`
    const idList =
      ids.length > 0
        ? sql.join(
            ids.map((i) => sql`${i}`),
            sql`, `,
          )
        : sql`NULL`
    const phoneList = sql.join(
      named.phones.map((p) => sql`${p}`),
      sql`, `,
    )
    const nameList = sql.join(
      named.usernames.map((u) => sql`${u}`),
      sql`, `,
    )
    return {
      users: await count(
        sql`SELECT count(*) AS n FROM users WHERE id IN (${idList}) OR phone IN (${phoneList}) OR lower(username) IN (${nameList})`,
      ),
      memberships: await count(
        sql`SELECT count(*) AS n FROM memberships WHERE tenant_id IN ${tenantsSql} OR user_id IN (${idList})`,
      ),
      authEvents: await count(
        sql`SELECT count(*) AS n FROM auth_events WHERE tenant_id IN ${tenantsSql} OR user_id IN (${idList})`,
      ),
      auditLog: await count(
        sql`SELECT count(*) AS n FROM audit_log WHERE tenant_id IN ${tenantsSql} OR entity_id IN (${idList})`,
      ),
      idempotencyKeys: await count(
        sql`SELECT count(*) AS n FROM idempotency_keys WHERE tenant_id IN ${tenantsSql}`,
      ),
      logins: await db
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          mustChangePassword: users.mustChangePassword,
          passwordChangedAt: users.passwordChangedAt,
          failedLoginCount: users.failedLoginCount,
          lockedUntil: users.lockedUntil,
          name: users.name,
          phone: users.phone,
          username: users.username,
          status: users.status,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(ids.length > 0 ? inArray(users.id, ids) : sql`false`)
        .orderBy(users.id),
      sessions: await db
        .select({ id: authSessions.id, revokedAt: authSessions.revokedAt })
        .from(authSessions)
        .where(ids.length > 0 ? inArray(authSessions.userId, ids) : sql`false`)
        .orderBy(authSessions.id),
    }
  }

  const hire = (actor: Actor, body: Record<string, unknown>) =>
    call<CreateBody>(app, actor, 'POST', '/tenancy/staff', body)

  const request = (fields: { phone: string; username: string }) => ({
    idempotencyKey: uuidv7(),
    id: uuidv7(),
    userId: uuidv7(),
    username: fields.username,
    name: 'Anyone At All',
    phone: fields.phone,
    role: 'salesperson',
    temporaryPassword: 'Hired12345',
  })

  it('refuses the phone of anybody another business or the console holds: one body, nothing written, the login untouched', async () => {
    const bodies: unknown[] = []
    for (const actor of [owner, manager]) {
      for (const p of foreign) {
        const body = request({ phone: p.phone, username: `hd${run}.n${String(bodies.length)}` })
        const named = {
          ids: [p.id, body.userId],
          phones: [p.phone],
          usernames: [body.username],
        }
        const before = await snapshot(named)
        const res = await hire(actor, body)
        expect(res.status, `${actor.role} → ${p.key}: ${JSON.stringify(res.body)}`).toBe(409)
        expect(res.body.message).toBe(PHONE_SENTENCE)
        // nothing about who or where: not the login's id, username or name, not the other business
        const text = JSON.stringify(res.body)
        for (const secret of [
          p.id,
          p.username,
          p.name,
          theirs,
          `hire-o-${run}`,
          'Other distributor',
        ])
          expect(text).not.toContain(secret)
        bodies.push(res.body)
        // the same request again, with its key: the same answer, still nothing written
        const again = await hire(actor, body)
        expect(again.status).toBe(409)
        expect(again.body).toEqual(res.body)
        expect(await snapshot(named)).toEqual(before)
      }
    }
    // ONE body for every kind of "elsewhere", from either desk
    for (const b of bodies) expect(b).toEqual(bodies[0])
  })

  it('refuses the username of anybody another business or the console holds, the same way', async () => {
    const bodies: unknown[] = []
    for (const actor of [owner, manager]) {
      for (const p of foreign) {
        const body = request({ phone: phone(), username: p.username.toUpperCase() })
        const named = { ids: [p.id, body.userId], phones: [body.phone], usernames: [p.username] }
        const before = await snapshot(named)
        const res = await hire(actor, body)
        expect(res.status, `${actor.role} → ${p.key}: ${JSON.stringify(res.body)}`).toBe(409)
        expect(res.body.message).toBe(USERNAME_SENTENCE)
        const text = JSON.stringify(res.body)
        for (const secret of [p.id, p.name, p.phone, theirs, 'Other distributor'])
          expect(text).not.toContain(secret)
        bodies.push(res.body)
        const again = await hire(actor, body)
        expect(again.status).toBe(409)
        expect(again.body).toEqual(res.body)
        expect(await snapshot(named)).toEqual(before)
      }
    }
    for (const b of bodies) expect(b).toEqual(bodies[0])
    // and the other distributor's people still belong only where they did
    const theirRows = await db
      .select({ userId: memberships.userId, tenantId: memberships.tenantId })
      .from(memberships)
      .where(
        inArray(
          memberships.userId,
          foreign.map((p) => p.id),
        ),
      )
    expect(theirRows.every((r) => r.tenantId === theirs)).toBe(true)
  })

  it('answers one of this distributor’s own people as before: already a member, nothing written', async () => {
    for (const fields of [
      { phone: ourRep.phone, username: `hd${run}.fresh1` },
      { phone: phone(), username: ourRep.username },
    ]) {
      const body = request(fields)
      const named = {
        ids: [ourRep.id, body.userId],
        phones: [fields.phone],
        usernames: [fields.username],
      }
      const before = await snapshot(named)
      const res = await hire(owner, body)
      expect(res.status, JSON.stringify(res.body)).toBe(409)
      expect(res.body.message).toBe('This person is already a member of this distributor')
      expect(await snapshot(named)).toEqual(before)
    }
  })

  it('makes a wholly new person as before, and a replay gives back the same answer', async () => {
    const body = { ...request({ phone: phone(), username: `hd${run}.newbie` }), role: 'delivery' }
    const res = await hire(manager, body)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toEqual({
      userId: body.userId,
      membershipId: body.id,
      mustChangePassword: true,
    })
    const [made] = await db.select().from(users).where(eq(users.id, body.userId))
    expect(made?.mustChangePassword).toBe(true)
    expect(await verifyPassword(made?.passwordHash ?? '', 'Hired12345')).toBe(true)
    const replay = await hire(manager, body)
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(res.body)
    const rows = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, ours), eq(memberships.userId, body.userId)))
    expect(rows).toHaveLength(1)
  })

  /**
   * The other way to a shared sign-in: a desk leaves a login with a password it knows and NO membership
   * (a key sent again with another request makes the person, then refuses the membership), and waits for
   * another distributor to hire that name or number. Refused; the request that made it may still finish.
   */
  it('refuses a sign-in another desk left half way, and lets only the request that made it finish', async () => {
    const planted = { phone: phone(), username: `hd${run}.planted` }
    const key = uuidv7()
    const first = await hire(theirOwner, {
      ...request({ phone: phone(), username: `hd${run}.first` }),
      idempotencyKey: key,
    })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    const second = { ...request(planted), idempotencyKey: key }
    const reused = await hire(theirOwner, second)
    expect(reused.status).toBe(409)
    const [left] = await db.select().from(users).where(eq(users.id, second.userId))
    expect(left?.username).toBe(planted.username) // a login, with the other desk's password …
    expect(
      await db.select().from(memberships).where(eq(memberships.userId, second.userId)),
    ).toHaveLength(0) // … and no membership anywhere

    for (const [fields, sentence] of [
      [{ phone: planted.phone, username: `hd${run}.mine` }, PHONE_SENTENCE],
      [{ phone: phone(), username: planted.username }, USERNAME_SENTENCE],
    ] as const) {
      const body = request(fields)
      const named = {
        ids: [second.userId, body.userId],
        phones: [fields.phone],
        usernames: [fields.username],
      }
      const before = await snapshot(named)
      const res = await hire(owner, body)
      expect(res.status, JSON.stringify(res.body)).toBe(409)
      expect(res.body.message).toBe(sentence)
      expect(await snapshot(named)).toEqual(before)
    }

    // The desk that made it retries that very request (the same user id) under a fresh key: it finishes.
    const retry = await hire(theirOwner, { ...second, idempotencyKey: uuidv7() })
    expect(retry.status, JSON.stringify(retry.body)).toBe(200)
    expect(retry.body.userId).toBe(second.userId)
  })

  it('takes a person nobody can sign in as (no password) as before', async () => {
    const body = request({ phone: nobody.phone, username: `hd${run}.nobody` })
    const res = await hire(owner, body)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.userId).toBe(nobody.id)
    const [kept] = await db.select().from(users).where(eq(users.id, nobody.id))
    expect(kept?.name).toBe(nobody.name) // never overwritten
    expect(kept?.passwordHash).toBeNull()
  })

  it('leaves the other distributor’s manager signed in and on the password it had', async () => {
    const [login] = await db
      .select({ hash: users.passwordHash, first: users.mustChangePassword })
      .from(users)
      .where(eq(users.id, theirManager.id))
    expect(login).toEqual({ hash: theirManager.hash, first: true })
    const live = await db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.userId, theirManager.id), isNull(authSessions.revokedAt)))
    expect(live).toHaveLength(1)
  })
})
