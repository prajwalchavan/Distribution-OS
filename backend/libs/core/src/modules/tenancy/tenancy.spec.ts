import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { StaffCreateInput, StaffSetPasswordInput } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  authEvents,
  authSessions,
  createDb,
  createPool,
  idempotencyKeys,
  memberships,
  platformAdmins,
  tenants,
  users,
  verifyPassword,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withoutSecrets } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { TenancyModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface StaffRow {
  userId: string
  username: string | null
  name: string
  phone: string
  role: string
  status: string
  lastLoginAt: string | null
}
interface CreateBody {
  userId: string
  membershipId: string
  mustChangePassword: boolean
}

describeDb('tenancy staff (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8) // digits only: phones must be +91[6-9] + 9 digits

  const tenantId = uuidv7()
  const foreignTenantId = uuidv7()
  const ownerId = uuidv7()
  const owner2Id = uuidv7()
  const managerId = uuidv7()
  const repId = uuidv7()
  const shopUserId = uuidv7()
  const foreignUserId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }

  const foreignUsername = `x${run}.ext`
  const repLastLogin = new Date('2026-09-01T10:30:00.000Z')
  let foreignPasswordHash = ''
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `staff-${run}`, legalName: 'Staff test', stateCode: '27' },
      {
        id: foreignTenantId,
        slug: `staff-o-${run}`,
        legalName: 'Other distributor',
        stateCode: '27',
      },
    ])
    foreignPasswordHash = `$argon2id$seeded$${run}`
    await db.insert(users).values([
      { id: ownerId, phone: `+919${run}1`, name: 'Owner', username: `x${run}.own` },
      { id: owner2Id, phone: `+919${run}2`, name: 'Second owner', username: `x${run}.own2` },
      { id: managerId, phone: `+919${run}3`, name: 'Manager', username: `x${run}.mgr` },
      { id: repId, phone: `+919${run}4`, name: 'Rep', username: `x${run}.rep` },
      { id: shopUserId, phone: `+919${run}5`, name: 'Shopkeeper', username: `x${run}.shop` },
      // Hired by another distributor: this tenant cannot see the row, only the system role can.
      {
        id: foreignUserId,
        phone: `+919${run}6`,
        name: 'External Person',
        username: foreignUsername,
        passwordHash: foreignPasswordHash,
      },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: owner2Id, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId: foreignTenantId, userId: foreignUserId, role: 'salesperson' },
    ])
    await db.insert(authEvents).values([
      { id: uuidv7(), userId: repId, tenantId, kind: 'login_ok', createdAt: repLastLogin },
      {
        id: uuidv7(),
        userId: repId,
        tenantId,
        kind: 'login_ok',
        createdAt: new Date('2026-08-20T04:00:00.000Z'),
      },
      // another distributor's sign-in by the same person must not leak into this list
      {
        id: uuidv7(),
        userId: repId,
        tenantId: foreignTenantId,
        kind: 'login_ok',
        createdAt: new Date('2026-09-03T09:00:00.000Z'),
      },
    ])
    app = await bootTestApp([TenancyModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('lists the staff of this tenant with the last sign-in, and no shopkeepers or hashes', async () => {
    const res = await call<{ items: StaffRow[] }>(app, owner, 'GET', '/tenancy/staff')
    expect(res.status).toBe(200)
    const byUser = new Map(res.body.items.map((i) => [i.userId, i]))
    expect([...byUser.keys()].sort()).toEqual([ownerId, owner2Id, managerId, repId].sort())
    expect(byUser.has(shopUserId)).toBe(false)
    expect(byUser.get(repId)?.lastLoginAt).toBe(repLastLogin.toISOString())
    expect(byUser.get(ownerId)?.lastLoginAt).toBeNull()
    expect(byUser.get(repId)?.username).toBe(`x${run}.rep`)
    for (const item of res.body.items) {
      expect(Object.keys(item)).not.toContain('passwordHash')
      expect(Object.keys(item)).not.toContain('password_hash')
    }
  })

  it('refuses the staff list to a salesperson and without a session', async () => {
    expect((await call(app, rep, 'GET', '/tenancy/staff')).status).toBe(403)
    expect((await call(app, null, 'GET', '/tenancy/staff')).status).toBe(401)
  })

  const hireMembershipId = uuidv7()
  const hireUserId = uuidv7()
  const hireInput = {
    idempotencyKey: `staff-hire-${run}`,
    id: hireMembershipId,
    userId: hireUserId,
    username: `X${run}.New`, // mixed case on the wire; stored lowercase
    name: 'Nikhil Rane',
    phone: `+919${run}7`,
    role: 'salesperson',
    locale: 'mr-IN',
    temporaryPassword: 'Kalyan2026',
  }

  it('owner hires a salesperson who must change the temporary password', async () => {
    const res = await call<CreateBody>(app, owner, 'POST', '/tenancy/staff', hireInput)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      userId: hireUserId,
      membershipId: hireMembershipId,
      mustChangePassword: true,
    })
    const [user] = await db.select().from(users).where(eq(users.id, hireUserId))
    expect(user?.username).toBe(`x${run}.new`)
    expect(user?.mustChangePassword).toBe(true)
    expect(user?.status).toBe('active')
    expect(await verifyPassword(user?.passwordHash ?? '', 'Kalyan2026')).toBe(true)
    const [membership] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, hireUserId)))
    expect(membership?.id).toBe(hireMembershipId)
    expect(membership?.role).toBe('salesperson')
    expect(membership?.status).toBe('active')
  })

  it('replays the same hire without creating a second membership', async () => {
    const res = await call<CreateBody>(app, owner, 'POST', '/tenancy/staff', hireInput)
    expect(res.status).toBe(200)
    expect(res.body.membershipId).toBe(hireMembershipId)
    const rows = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, hireUserId)))
    expect(rows).toHaveLength(1)
  })

  /**
   * QA DOS-424, R1 at the hire door (docs/22 §8): this used to REUSE the other distributor's login and
   * add a membership here, so whoever knew its password signed in here as this distributor's staff.
   * Refused now, in words, and nothing is written; `hire-door.spec.ts` pins every kind of "elsewhere".
   */
  it('refuses a person another distributor already hired, and writes nothing', async () => {
    const first = await call<CreateBody & { message?: string }>(
      app,
      owner,
      'POST',
      '/tenancy/staff',
      {
        idempotencyKey: `staff-reuse-${run}`,
        id: uuidv7(),
        userId: uuidv7(),
        username: foreignUsername,
        name: 'Someone Else Entirely',
        phone: `+919${run}8`,
        role: 'delivery',
        temporaryPassword: 'Reuse2026',
      },
    )
    expect(first.status, JSON.stringify(first.body)).toBe(409)
    expect(first.body.message).toBe(
      'This username already has a Distribution OS sign-in, which cannot be shared yet. Choose another username.',
    )
    const [kept] = await db.select().from(users).where(eq(users.id, foreignUserId))
    expect(kept?.name).toBe('External Person') // never overwritten
    expect(kept?.passwordHash).toBe(foreignPasswordHash)
    expect(kept?.phone).toBe(`+919${run}6`)
    const here = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, foreignUserId)))
    expect(here).toHaveLength(0)
    const made = await db
      .select()
      .from(users)
      .where(eq(users.phone, `+919${run}8`))
    expect(made).toHaveLength(0)
  })

  it('lets a manager hire a warehouse hand but not an accountant', async () => {
    const warehouseUserId = uuidv7()
    const ok = await call<CreateBody>(app, manager, 'POST', '/tenancy/staff', {
      idempotencyKey: `staff-wh-${run}`,
      id: uuidv7(),
      userId: warehouseUserId,
      username: `x${run}.wh`,
      name: 'Dinesh Patil',
      phone: `+919${run}9`,
      role: 'warehouse',
      temporaryPassword: 'Godown2026',
    })
    expect(ok.status).toBe(200)
    expect(ok.body.userId).toBe(warehouseUserId)

    const refused = await call(app, manager, 'POST', '/tenancy/staff', {
      idempotencyKey: `staff-acc-${run}`,
      id: uuidv7(),
      userId: uuidv7(),
      username: `x${run}.acc`,
      name: 'Books Person',
      phone: `+919${run}0`,
      role: 'accountant',
      temporaryPassword: 'Books2026',
    })
    expect(refused.status).toBe(403)
    const leaked = await db
      .select()
      .from(users)
      .where(eq(users.username, `x${run}.acc`))
    expect(leaked).toHaveLength(0)
  })

  it('resets a password: lockout cleared, sessions revoked, audit written', async () => {
    const lockedUntil = new Date(Date.now() + 900_000)
    await db
      .update(users)
      .set({ failedLoginCount: 5, lockedUntil, mustChangePassword: false })
      .where(eq(users.id, repId))
    const sessionId = uuidv7()
    await db.insert(authSessions).values({
      id: sessionId,
      userId: repId,
      tenantId,
      role: 'salesperson',
      deviceId: uuidv7(),
      refreshTokenHash: `hash-${run}-rep`,
      refreshExpiresAt: new Date(Date.now() + 86_400_000),
    })

    const res = await call<{ ok: boolean }>(app, owner, 'POST', '/tenancy/staff/set-password', {
      idempotencyKey: `staff-pw-${run}`,
      userId: repId,
      temporaryPassword: 'Naya12345',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    const [user] = await db.select().from(users).where(eq(users.id, repId))
    expect(user?.failedLoginCount).toBe(0)
    expect(user?.lockedUntil).toBeNull()
    expect(user?.mustChangePassword).toBe(true)
    expect(await verifyPassword(user?.passwordHash ?? '', 'Naya12345')).toBe(true)

    const [session] = await db.select().from(authSessions).where(eq(authSessions.id, sessionId))
    expect(session?.revokedAt).not.toBeNull()
    expect(session?.revokedReason).toBe('password_reset')

    const audit = await db
      .select()
      .from(authEvents)
      .where(and(eq(authEvents.userId, repId), eq(authEvents.kind, 'password_set_by_admin')))
    expect(audit).toHaveLength(1)
  })

  /**
   * DOS-400: a temporary password is never in the idempotency store. The reply never carried one, so
   * a replay could not give it back; but `request_hash` was a fast, unsalted SHA-256 of the request
   * WITH the password, which anyone who reads the table could guess back offline. Both keys are now
   * filed without it.
   */
  it('files a hire and a reset under keys that hold no password, and replays without one', async () => {
    const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
    const stored = async (key: string) =>
      (
        await db
          .select()
          .from(idempotencyKeys)
          .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.key, key)))
      )[0]
    const hire = StaffCreateInput.parse(hireInput)
    const hired = await stored(hireInput.idempotencyKey)
    expect(hired?.requestHash).not.toBe(sha(hire))
    expect(hired?.requestHash).toBe(sha(withoutSecrets(hire, ['temporaryPassword'])))
    expect(JSON.stringify(hired?.response)).not.toContain(hireInput.temporaryPassword)

    const reset = StaffSetPasswordInput.parse({
      idempotencyKey: `staff-pw-${run}`,
      userId: repId,
      temporaryPassword: 'Naya12345',
    })
    const resetRow = await stored(`staff-pw-${run}`)
    expect(resetRow?.requestHash).not.toBe(sha(reset))
    expect(resetRow?.requestHash).toBe(sha(withoutSecrets(reset, ['temporaryPassword'])))
    expect(JSON.stringify(resetRow?.response)).not.toContain('Naya12345')

    const replay = await call<CreateBody>(app, owner, 'POST', '/tenancy/staff', hireInput)
    expect(replay.status).toBe(200)
    expect(JSON.stringify(replay.body)).not.toContain(hireInput.temporaryPassword)
  })

  it('refuses a manager resetting an owner password', async () => {
    const res = await call(app, manager, 'POST', '/tenancy/staff/set-password', {
      idempotencyKey: `staff-pw-mgr-${run}`,
      userId: owner2Id,
      temporaryPassword: 'Naya12345',
    })
    expect(res.status).toBe(403)
    const [owner2] = await db.select().from(users).where(eq(users.id, owner2Id))
    expect(owner2?.passwordHash).toBeNull()
  })

  /**
   * DOS-400 repair (the blind check's major). A password is global: a desk that may give a new one to
   * a person who also signs in with ANOTHER business may sign in as that person there. The shop's page
   * refused it; the staff screen did not, and it reaches every member here — a shopkeeper a shop's
   * page added, a person the data shares (before DOS-424 `staff.create` took such people over by phone
   * or username), another distributor's own owner. The check ran it end to end: Tarsun's owner reset a
   * Kalyan shopkeeper, then Sai's owner,
   * and signed in there. Refused now, with the password, the sessions and the trail left as they were.
   */
  it('gives no new password to a person who also signs in with another business, nor to a console account', async () => {
    const shared = uuidv7() // a shopkeeper who buys here and from the other distributor
    const theirOwner = uuidv7() // the other distributor's owner
    const consolePerson = uuidv7() // staff of Distribution OS itself
    const hashes = {
      [shared]: `$argon2id$shared$${run}`,
      [theirOwner]: `$argon2id$theirs$${run}`,
      [consolePerson]: `$argon2id$console$${run}`,
      [foreignUserId]: foreignPasswordHash,
    }
    await db.insert(users).values([
      {
        id: shared,
        phone: `+918${run}1`,
        name: 'Shared Shopkeeper',
        username: `x${run}.both`,
        passwordHash: hashes[shared],
      },
      {
        id: theirOwner,
        phone: `+918${run}2`,
        name: 'Their Owner',
        username: `x${run}.theirs`,
        passwordHash: hashes[theirOwner],
      },
      {
        id: consolePerson,
        phone: `+918${run}3`,
        name: 'Console Person',
        username: `x${run}.console`,
        passwordHash: hashes[consolePerson],
      },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: shared, role: 'retailer' },
      { id: uuidv7(), tenantId: foreignTenantId, userId: shared, role: 'retailer' },
      { id: uuidv7(), tenantId: foreignTenantId, userId: theirOwner, role: 'owner' },
      { id: uuidv7(), tenantId, userId: consolePerson, role: 'warehouse' },
    ])
    await db.insert(platformAdmins).values({ id: uuidv7(), userId: consolePerson, role: 'support' })
    const theirSession = uuidv7()
    await db.insert(authSessions).values({
      id: theirSession,
      userId: theirOwner,
      tenantId: foreignTenantId,
      role: 'owner',
      deviceId: uuidv7(),
      refreshTokenHash: `hash-${run}-theirs`,
      refreshExpiresAt: new Date(Date.now() + 86_400_000),
    })

    // The first of the two calls the check made — hire the other distributor's owner by phone — is
    // refused since DOS-424 (`hire-door.spec.ts`), and writes nothing …
    const hired = await call<CreateBody & { message?: string }>(
      app,
      owner,
      'POST',
      '/tenancy/staff',
      {
        idempotencyKey: `staff-take-${run}`,
        id: uuidv7(),
        userId: uuidv7(),
        username: `x${run}.fresh`,
        name: 'Anyone At All',
        phone: `+918${run}2`,
        role: 'delivery',
        temporaryPassword: 'Mine12345',
      },
    )
    expect(hired.status, JSON.stringify(hired.body)).toBe(409)
    expect(hired.body.message).toContain('already has a Distribution OS sign-in')
    // People the DATA already shares with the other distributor, as the demo seed has them: the hire
    // door no longer makes such a person, but the ones there are keep working, and the staff screen
    // reaches them.
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: theirOwner, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: foreignUserId, role: 'delivery' },
    ])

    // … and the second, for each person the staff screen can reach who is not this desk's alone.
    const staffSentence =
      'This sign-in is not yours alone to reset: this person also uses it with another business. Only they can change its password.'
    const shopSentence =
      'This sign-in is not yours alone to reset: the shopkeeper also uses it with another business. Only the shopkeeper can change its password.'
    const cases: [Actor, string, string][] = [
      [owner, theirOwner, staffSentence],
      [owner, shared, shopSentence],
      [owner, foreignUserId, staffSentence], // shared in the data, above
      [manager, foreignUserId, staffSentence], // a delivery hand here: the manager's to administer
      [owner, consolePerson, staffSentence],
    ]
    for (const [actor, userId, sentence] of cases) {
      const res = await call<{ message?: string }>(
        app,
        actor,
        'POST',
        '/tenancy/staff/set-password',
        { idempotencyKey: uuidv7(), userId, temporaryPassword: 'Taken12345' },
      )
      expect(res.status, `${actor.role} → ${userId}: ${JSON.stringify(res.body)}`).toBe(409)
      expect(res.body.message).toBe(sentence)
      const [after] = await db.select().from(users).where(eq(users.id, userId))
      expect(after?.passwordHash).toBe(hashes[userId])
      const noted = await db
        .select()
        .from(authEvents)
        .where(and(eq(authEvents.userId, userId), eq(authEvents.kind, 'password_set_by_admin')))
      expect(noted).toHaveLength(0)
    }
    const [kept] = await db.select().from(authSessions).where(eq(authSessions.id, theirSession))
    expect(kept?.revokedAt).toBeNull()
  })

  /**
   * Ruling R3 (docs/22 §8, 2026-09-29): the name and the mobile number are the PERSON's, global, like the
   * password. A desk of one business may not change them for a person who also belongs to another, or
   * holds a console seat — one shared rule with the password (`refuseIfShared`). What belongs to the
   * membership here stays the desk's: the extra roles, on and off.
   */
  it('keeps the name and the mobile of a person who also belongs to another business; the membership stays the desk’s', async () => {
    const theirs = uuidv7() // works here as delivery, and owns the other distributor
    const shop = uuidv7() // a shopkeeper here and there
    const seat = uuidv7() // works here, and holds a console seat
    const ours = uuidv7() // works here alone
    await db.insert(users).values([
      { id: theirs, phone: `+917${run}1`, name: 'Their Owner Two', username: `r3${run}.theirs` },
      { id: shop, phone: `+917${run}2`, name: 'Both Shops', username: `r3${run}.shop` },
      { id: seat, phone: `+917${run}3`, name: 'Console Two', username: `r3${run}.seat` },
      { id: ours, phone: `+917${run}4`, name: 'Only Here', username: `r3${run}.ours` },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: theirs, role: 'delivery' },
      { id: uuidv7(), tenantId: foreignTenantId, userId: theirs, role: 'owner' },
      { id: uuidv7(), tenantId, userId: shop, role: 'retailer' },
      {
        id: uuidv7(),
        tenantId: foreignTenantId,
        userId: shop,
        role: 'retailer',
        status: 'disabled',
      },
      { id: uuidv7(), tenantId, userId: seat, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: ours, role: 'salesperson' },
    ])
    await db.insert(platformAdmins).values({ id: uuidv7(), userId: seat, role: 'billing' })
    const sentence =
      'This person also signs in with another business, so their name and mobile number cannot be changed here. They stay as they are.'
    const update = (actor: Actor, userId: string, patch: Record<string, unknown>) =>
      call<{ ok?: boolean; message?: string }>(app, actor, 'POST', '/tenancy/staff/update', {
        idempotencyKey: uuidv7(),
        userId,
        ...patch,
      })
    const person = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]
    for (const [actor, userId] of [
      [owner, theirs],
      [manager, theirs], // a delivery hand: the manager's to administer
      [owner, shop],
      [owner, seat],
    ] as const) {
      const before = await person(userId)
      for (const patch of [
        { name: 'Somebody Else' },
        { phone: `+917${run}9` },
        { name: before?.name, phone: `+917${run}8` },
      ]) {
        const res = await update(actor, userId, patch)
        expect(res.status, `${actor.role} → ${userId} ${JSON.stringify(patch)}`).toBe(409)
        expect(res.body.message).toBe(sentence)
      }
      const after = await person(userId)
      expect(after?.name).toBe(before?.name)
      expect(after?.phone).toBe(before?.phone)
      // the form sends every field on every save: the same name and phone with a new language pass
      const same = await update(actor, userId, {
        name: before?.name,
        phone: before?.phone,
        locale: 'mr-IN',
      })
      expect(same.status, JSON.stringify(same.body)).toBe(200)
    }
    // what belongs to the membership here is still the desk's
    const extra = await call<{ ok?: boolean }>(app, owner, 'POST', '/tenancy/memberships/update', {
      idempotencyKey: uuidv7(),
      userId: theirs,
      extraRoles: ['warehouse'],
    })
    expect(extra.status, JSON.stringify(extra.body)).toBe(200)
    const off = await call(app, owner, 'POST', '/tenancy/staff/set-status', {
      idempotencyKey: uuidv7(),
      userId: theirs,
      status: 'disabled',
    })
    expect(off.status).toBe(200)
    const on = await call(app, owner, 'POST', '/tenancy/staff/set-status', {
      idempotencyKey: uuidv7(),
      userId: theirs,
      status: 'active',
    })
    expect(on.status).toBe(200)
    // a person who works here alone is renamed as before
    const renamed = await update(owner, ours, { name: 'Only Here Renamed', phone: `+917${run}7` })
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200)
    expect((await person(ours))?.name).toBe('Only Here Renamed')
    expect((await person(ours))?.phone).toBe(`+917${run}7`)
  })

  it('refuses a clashing membership id in words, not a 500', async () => {
    const [taken] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, repId)))
    const res = await call<{ message?: string }>(app, owner, 'POST', '/tenancy/staff', {
      idempotencyKey: `staff-clash-${run}`,
      id: taken?.id,
      userId: uuidv7(),
      username: `x${run}.clash`,
      name: 'Clash Person',
      phone: `+918${run}4`,
      role: 'salesperson',
      temporaryPassword: 'Clash12345',
    })
    expect(res.status, JSON.stringify(res.body)).toBe(409)
    expect(res.body.message).toBe(
      'This could not be saved: it repeats an earlier request. Close this and try again.',
    )
    // and nobody was made on the way, to be found (and silently reused) by the next try
    const made = await db
      .select()
      .from(users)
      .where(eq(users.username, `x${run}.clash`))
    expect(made).toHaveLength(0)

    // an existing person the hire may still take — nobody can sign in as them (no password) and no
    // business holds them (since DOS-424 anybody another business holds is refused before this) —
    // taken with the same clashing id: the insert itself refuses, in the same words, and no membership
    // is made
    const noSignIn = uuidv7()
    await db.insert(users).values({
      id: noSignIn,
      phone: `+918${run}5`,
      name: 'Hired Elsewhere',
      username: `x${run}.away`,
    })
    const reuse = await call<{ message?: string }>(app, owner, 'POST', '/tenancy/staff', {
      idempotencyKey: `staff-clash-2-${run}`,
      id: taken?.id,
      userId: uuidv7(),
      username: `x${run}.away`,
      name: 'Hired Elsewhere',
      phone: `+918${run}5`,
      role: 'delivery',
      temporaryPassword: 'Clash12345',
    })
    expect(reuse.status, JSON.stringify(reuse.body)).toBe(409)
    expect(reuse.body.message).toBe(
      'This could not be saved: it repeats an earlier request. Close this and try again.',
    )
    const joined = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, noSignIn)))
    expect(joined).toHaveLength(0)
  })

  it('disabling a membership blocks the person here and revokes only this tenant’s sessions', async () => {
    const here = uuidv7()
    const elsewhere = uuidv7()
    await db.insert(authSessions).values([
      {
        id: here,
        userId: managerId,
        tenantId,
        role: 'manager',
        deviceId: uuidv7(),
        refreshTokenHash: `hash-${run}-mgr-here`,
        refreshExpiresAt: new Date(Date.now() + 86_400_000),
      },
      {
        id: elsewhere,
        userId: managerId,
        tenantId: foreignTenantId,
        role: 'manager',
        deviceId: uuidv7(),
        refreshTokenHash: `hash-${run}-mgr-else`,
        refreshExpiresAt: new Date(Date.now() + 86_400_000),
      },
    ])

    const res = await call<{ ok: boolean }>(app, owner, 'POST', '/tenancy/staff/set-status', {
      idempotencyKey: `staff-st-${run}`,
      userId: managerId,
      status: 'disabled',
    })
    expect(res.status).toBe(200)

    const [membership] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, managerId)))
    expect(membership?.status).toBe('disabled')
    const [revoked] = await db.select().from(authSessions).where(eq(authSessions.id, here))
    expect(revoked?.revokedAt).not.toBeNull()
    expect(revoked?.revokedReason).toBe('membership_disabled')
    const [kept] = await db.select().from(authSessions).where(eq(authSessions.id, elsewhere))
    expect(kept?.revokedAt).toBeNull()
  })

  it('keeps one active owner: no self-disable, and the last owner cannot go', async () => {
    const self = await call(app, owner, 'POST', '/tenancy/staff/set-status', {
      idempotencyKey: `staff-self-${run}`,
      userId: ownerId,
      status: 'disabled',
    })
    expect(self.status).toBe(403)

    const other = await call(app, owner, 'POST', '/tenancy/staff/set-status', {
      idempotencyKey: `staff-own2-${run}`,
      userId: owner2Id,
      status: 'disabled',
    })
    expect(other.status).toBe(200)

    const last = await call(app, owner, 'POST', '/tenancy/staff/set-status', {
      idempotencyKey: `staff-last-${run}`,
      userId: ownerId,
      status: 'disabled',
    })
    expect(last.status).toBe(409)
    const [still] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, ownerId)))
    expect(still?.status).toBe('active')
  })

  /**
   * docs/29 §2 extra_roles + staff screen — the owner (and, within its own floor, the manager) says
   * which OTHER role a staff login may also sign in as, so the warehouse man who delivers on Tuesdays
   * can open the delivery app with his own username instead of borrowing the owner's.
   *
   * It is a sideways grant between staff jobs and never a way up: `owner`, `manager`, `retailer` and
   * `platform_admin` are not values the contract will accept, a manager may hand out only the three
   * roles it already administers, and the desk's own memberships carry no extras at all.
   */
  describe('docs/29 §2 extra_roles + staff screen', () => {
    const accountantId = uuidv7()
    const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }

    beforeAll(async () => {
      await db.insert(users).values({
        id: accountantId,
        phone: `+919${run}0`,
        name: 'Accountant',
        username: `x${run}.acc`,
      })
      await db
        .insert(memberships)
        .values({ id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' })
    })

    const extraRolesOf = async (userId: string) => {
      const [row] = await db
        .select({ extraRoles: memberships.extraRoles })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
      return row?.extraRoles ?? null
    }

    it('lets the owner add delivery to a rep, and shows it on the staff list', async () => {
      const res = await call(app, owner, 'POST', '/tenancy/memberships/update', {
        idempotencyKey: `extra-owner-${run}`,
        userId: repId,
        extraRoles: ['delivery'],
      })
      expect(res.status).toBe(200)
      expect(await extraRolesOf(repId)).toEqual(['delivery'])

      const list = await call<{ items: (StaffRow & { extraRoles: string[] })[] }>(
        app,
        owner,
        'GET',
        '/tenancy/staff',
      )
      expect(list.body.items.find((i) => i.userId === repId)?.extraRoles).toEqual(['delivery'])
      // Everyone else still carries none: this is per membership, never a tenant-wide switch.
      expect(list.body.items.find((i) => i.userId === managerId)?.extraRoles).toEqual([])
    })

    it('lets the manager hand out only the three roles it already administers', async () => {
      const ok = await call(app, manager, 'POST', '/tenancy/memberships/update', {
        idempotencyKey: `extra-mgr-ok-${run}`,
        userId: repId,
        extraRoles: ['warehouse', 'delivery'],
      })
      expect(ok.status).toBe(200)
      expect(await extraRolesOf(repId)).toEqual(['warehouse', 'delivery'])

      const denied = await call<{ message: string }>(
        app,
        manager,
        'POST',
        '/tenancy/memberships/update',
        {
          idempotencyKey: `extra-mgr-no-${run}`,
          userId: repId,
          extraRoles: ['accountant'],
        },
      )
      expect(denied.status).toBe(403)
      // and nothing was written
      expect(await extraRolesOf(repId)).toEqual(['warehouse', 'delivery'])
    })

    it('refuses owner, manager, retailer and platform_admin as extra roles', async () => {
      for (const role of ['owner', 'manager', 'retailer', 'platform_admin']) {
        const res = await call(app, owner, 'POST', '/tenancy/memberships/update', {
          idempotencyKey: `extra-bad-${role}-${run}`,
          userId: repId,
          extraRoles: [role],
        })
        expect(res.status).toBe(400)
      }
      expect(await extraRolesOf(repId)).toEqual(['warehouse', 'delivery'])
    })

    it('refuses to put extras on a desk membership, which already elects downward', async () => {
      const res = await call(app, owner, 'POST', '/tenancy/memberships/update', {
        idempotencyKey: `extra-desk-${run}`,
        userId: managerId,
        extraRoles: ['delivery'],
      })
      expect(res.status).toBe(403)
      expect(await extraRolesOf(managerId)).toEqual([])
    })

    it('is the desk’s to set: a rep and the accountant may not', async () => {
      const byRep = await call(app, rep, 'POST', '/tenancy/memberships/update', {
        idempotencyKey: `extra-rep-${run}`,
        userId: repId,
        extraRoles: ['delivery'],
      })
      expect(byRep.status).toBe(403)
      const byAccountant = await call(app, accountant, 'POST', '/tenancy/memberships/update', {
        idempotencyKey: `extra-acc-${run}`,
        userId: repId,
        extraRoles: ['delivery'],
      })
      expect(byAccountant.status).toBe(403)
      expect(await extraRolesOf(repId)).toEqual(['warehouse', 'delivery'])
    })

    it('takes every extra role away again when the list is sent empty', async () => {
      const res = await call(app, owner, 'POST', '/tenancy/memberships/update', {
        idempotencyKey: `extra-clear-${run}`,
        userId: repId,
        extraRoles: [],
      })
      expect(res.status).toBe(200)
      expect(await extraRolesOf(repId)).toEqual([])
    })

    /**
     * The manager's remit is the DELTA, not the set. A rep the owner gave `accountant` to is still a
     * rep on the manager's floor: adding `delivery` to him must save, because the manager touched only
     * `delivery`. Refusing on the whole submitted set locked the manager out of every person the owner
     * had ever granted an accountant extra — a 403 naming a role the manager never touched.
     */
    it('lets the manager add its own role beside an accountant extra the owner granted', async () => {
      const granted = await call(app, owner, 'POST', '/tenancy/memberships/update', {
        idempotencyKey: `extra-owner-acc-${run}`,
        userId: repId,
        extraRoles: ['accountant'],
      })
      expect(granted.status).toBe(200)
      expect(await extraRolesOf(repId)).toEqual(['accountant'])

      const res = await call(app, manager, 'POST', '/tenancy/memberships/update', {
        idempotencyKey: `extra-mgr-delta-${run}`,
        userId: repId,
        extraRoles: ['accountant', 'delivery'],
      })
      expect(res.status).toBe(200)
      expect(await extraRolesOf(repId)).toEqual(['accountant', 'delivery'])
    })

    /** The other half of the same rule: the manager may not REVOKE what the owner granted. */
    it('refuses a manager that drops the owner’s accountant extra', async () => {
      const res = await call<{ message: string }>(
        app,
        manager,
        'POST',
        '/tenancy/memberships/update',
        {
          idempotencyKey: `extra-mgr-drop-${run}`,
          userId: repId,
          extraRoles: ['delivery'],
        },
      )
      expect(res.status).toBe(403)
      expect(res.body.message).toContain('accountant')
      expect(await extraRolesOf(repId)).toEqual(['accountant', 'delivery'])
    })
  })

  it('me() reports the signed-in username', async () => {
    const res = await call<{ user: { username: string | null } }>(app, owner, 'GET', '/tenancy/me')
    expect(res.status).toBe(200)
    expect(res.body.user.username).toBe(`x${run}.own`)
  })
})
