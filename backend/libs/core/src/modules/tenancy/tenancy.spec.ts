import { and, eq } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import {
  authEvents,
  authSessions,
  createDb,
  createPool,
  memberships,
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

  it('reuses a person another distributor already hired, then refuses a second membership', async () => {
    const first = await call<CreateBody>(app, owner, 'POST', '/tenancy/staff', {
      idempotencyKey: `staff-reuse-${run}`,
      id: uuidv7(),
      userId: uuidv7(), // ignored: the username resolves to the existing person
      username: foreignUsername,
      name: 'Someone Else Entirely',
      phone: `+919${run}8`,
      role: 'delivery',
      temporaryPassword: 'Reuse2026',
    })
    expect(first.status).toBe(200)
    expect(first.body.userId).toBe(foreignUserId)
    const [reused] = await db.select().from(users).where(eq(users.id, foreignUserId))
    expect(reused?.name).toBe('External Person') // never overwritten
    expect(reused?.passwordHash).toBe(foreignPasswordHash)
    expect(reused?.phone).toBe(`+919${run}6`)

    const second = await call(app, owner, 'POST', '/tenancy/staff', {
      idempotencyKey: `staff-reuse-2-${run}`,
      id: uuidv7(),
      userId: uuidv7(),
      username: foreignUsername,
      name: 'Someone Else Entirely',
      phone: `+919${run}8`,
      role: 'delivery',
      temporaryPassword: 'Reuse2026',
    })
    expect(second.status).toBe(409)
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

  it('me() reports the signed-in username', async () => {
    const res = await call<{ user: { username: string | null } }>(app, owner, 'GET', '/tenancy/me')
    expect(res.status).toBe(200)
    expect(res.body.user.username).toBe(`x${run}.own`)
  })
})
