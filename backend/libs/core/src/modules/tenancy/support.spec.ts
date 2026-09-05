import { eq } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import {
  auditLog,
  createDb,
  createPool,
  memberships,
  platformAdmins,
  supportGrants,
  tenants,
  users,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { TenancyModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface Grant {
  id: string
  status: string
  scope: string
  requestedHours: number
  requestedBy: string
  requestedByName: string
  decidedBy: string | null
  decisionNote: string | null
  expiresAt: string | null
  revokeReason: string | null
  active: boolean
}

const HOUR_MS = 60 * 60 * 1000

/**
 * The owner's half of platform support access (`tenancy.support.*`, founder decision 2026-09-05 in
 * docs/22 §2 and §8: "time-boxed, owner-approved, audited"). Three procedures were declared in the
 * contract and the permission matrix by the platform-console slice and left with no handler at all,
 * so every route 404'd; these cases are what stops that from coming back, and what pins the three
 * halves of the founder's rule to behaviour rather than to prose.
 */
describeDb('tenancy support access (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)

  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const otherOwnerId = uuidv7()
  const adminUserId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const otherOwner: Actor = { tenantId: otherTenantId, actorId: otherOwnerId, role: 'owner' }

  let app: NestFastifyApplication

  /** A fresh `requested` grant, written the way the console writes one (module 13 will do this). */
  const requestGrant = async (
    hours: number,
    tenant = tenantId,
    scope: 'read' | 'read_write' = 'read',
  ): Promise<string> => {
    const id = uuidv7()
    const requestedAt = new Date()
    await db.insert(supportGrants).values({
      id,
      tenantId: tenant,
      adminUserId,
      requestedAt,
      requestedHours: hours,
      reason: 'Ticket #1: three invoices will not issue and we would like to read the series rows.',
      expiresAt: new Date(requestedAt.getTime() + hours * HOUR_MS),
      scope,
    })
    return id
  }

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `sup-${run}`, legalName: 'Support test', stateCode: '27' },
      {
        id: otherTenantId,
        slug: `sup-o-${run}`,
        legalName: 'Another distributor',
        stateCode: '27',
      },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+919${run}1`, name: 'Owner', username: `s${run}.own` },
      { id: managerId, phone: `+919${run}2`, name: 'Manager', username: `s${run}.mgr` },
      { id: otherOwnerId, phone: `+919${run}3`, name: 'Other owner', username: `s${run}.own2` },
      {
        id: adminUserId,
        phone: `+919${run}4`,
        name: 'Anita Rao (support)',
        username: `s${run}.dos`,
        platformRole: 'support',
      },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId: otherTenantId, userId: otherOwnerId, role: 'owner' },
    ])
    await db.insert(platformAdmins).values({ id: uuidv7(), userId: adminUserId, role: 'support' })
    app = await bootTestApp([TenancyModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('shows the owner the request, the reason and WHO is asking — and nobody else', async () => {
    const id = await requestGrant(4)
    const res = await call<{ items: Grant[] }>(app, owner, 'GET', '/tenancy/support-grants')
    expect(res.status).toBe(200)
    const item = res.body.items.find((g) => g.id === id)
    expect(item?.status).toBe('requested')
    expect(item?.scope).toBe('read_only')
    expect(item?.requestedHours).toBe(4)
    expect(item?.requestedBy).toBe(adminUserId)
    // A platform admin holds no membership here, so `users_visible` hides them from the owner's own
    // transaction; the name still has to reach the card that asks the owner to decide.
    expect(item?.requestedByName).toBe('Anita Rao (support)')
    expect(item?.active).toBe(false)
    expect(item?.expiresAt).toBeNull()

    // Another distributor's owner sees nothing of it: RLS, not a filter.
    const foreign = await call<{ items: Grant[] }>(
      app,
      otherOwner,
      'GET',
      '/tenancy/support-grants',
    )
    expect(foreign.body.items.some((g) => g.id === id)).toBe(false)
    // And the manager is not asked at all — this is the owner's decision (permissions.ts OWNER_ONLY).
    expect((await call(app, manager, 'GET', '/tenancy/support-grants')).status).toBe(403)
    expect((await call(app, null, 'GET', '/tenancy/support-grants')).status).toBe(401)
  })

  it('opens the window the owner approves, and writes it into the tenant audit trail', async () => {
    const id = await requestGrant(6)
    const res = await call<{ item: Grant }>(
      app,
      owner,
      'POST',
      `/tenancy/support-grants/${id}/approve`,
      { id, idempotencyKey: uuidv7(), note: 'Go ahead, read only.' },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('approved')
    expect(res.body.item.active).toBe(true)
    expect(res.body.item.decidedBy).toBe(ownerId)
    expect(res.body.item.decisionNote).toBe('Go ahead, read only.')

    const [row] = await db.select().from(supportGrants).where(eq(supportGrants.id, id))
    expect(row?.approvedBy).toBe(ownerId)
    // Untouched: an owner approves, it does not re-scope or rewrite what was asked.
    expect(row?.scope).toBe('read')
    expect(row?.requestedHours).toBe(6)

    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, id))
    expect(audit.map((a) => a.action)).toContain('support.approve')
    expect(audit[0]?.actorId).toBe(ownerId)
  })

  it('lets the owner SHORTEN the window and refuses to lengthen it', async () => {
    const long = await requestGrant(48)
    const [before] = await db.select().from(supportGrants).where(eq(supportGrants.id, long))
    const shortened = await call<{ item: Grant }>(
      app,
      owner,
      'POST',
      `/tenancy/support-grants/${long}/approve`,
      { id: long, idempotencyKey: uuidv7(), hours: 2 },
    )
    expect(shortened.status).toBe(200)
    const [after] = await db.select().from(supportGrants).where(eq(supportGrants.id, long))
    expect(after?.expiresAt.getTime()).toBeLessThan(before?.expiresAt.getTime() ?? 0)
    expect(after?.expiresAt.getTime()).toBe((before?.requestedAt.getTime() ?? 0) + 2 * HOUR_MS)

    const greedy = await requestGrant(2)
    const refused = await call<{ message?: string }>(
      app,
      owner,
      'POST',
      `/tenancy/support-grants/${greedy}/approve`,
      { id: greedy, idempotencyKey: uuidv7(), hours: 48 },
    )
    expect(refused.status).toBe(400)
    expect(refused.body.message).toMatch(/shortened, never lengthened/i)
    const [untouched] = await db.select().from(supportGrants).where(eq(supportGrants.id, greedy))
    expect(untouched?.approvedAt).toBeNull()
  })

  it('refuses a second decision on a grant that is already answered', async () => {
    const id = await requestGrant(4)
    const first = await call(app, owner, 'POST', `/tenancy/support-grants/${id}/approve`, {
      id,
      idempotencyKey: uuidv7(),
    })
    expect(first.status).toBe(200)
    const second = await call<{ data?: { code?: string } }>(
      app,
      owner,
      'POST',
      `/tenancy/support-grants/${id}/approve`,
      { id, idempotencyKey: uuidv7() },
    )
    expect(second.status).toBe(409)

    const revoked = await call<{ item: Grant }>(
      app,
      owner,
      'POST',
      `/tenancy/support-grants/${id}/revoke`,
      { id, idempotencyKey: uuidv7(), reason: 'Fixed, thanks.' },
    )
    expect(revoked.status).toBe(200)
    // Shut AFTER it opened is a revocation; shut before is a refusal. The row keeps which.
    expect(revoked.body.item.status).toBe('revoked')
    expect(revoked.body.item.active).toBe(false)
    expect(revoked.body.item.revokeReason).toBe('Fixed, thanks.')
    expect(
      (
        await call(app, owner, 'POST', `/tenancy/support-grants/${id}/revoke`, {
          id,
          idempotencyKey: uuidv7(),
        })
      ).status,
    ).toBe(409)
  })

  it('records a refusal as `rejected`, never as an approval', async () => {
    const id = await requestGrant(4)
    const res = await call<{ item: Grant }>(
      app,
      owner,
      'POST',
      `/tenancy/support-grants/${id}/revoke`,
      { id, idempotencyKey: uuidv7(), reason: 'No; send me the query instead.' },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('rejected')
    const [row] = await db.select().from(supportGrants).where(eq(supportGrants.id, id))
    expect(row?.approvedAt).toBeNull()
    expect(row?.revokedBy).toBe(ownerId)
    // A closed request can no longer be opened: the database says so, not just the handler.
    const late = await call(app, owner, 'POST', `/tenancy/support-grants/${id}/approve`, {
      id,
      idempotencyKey: uuidv7(),
    })
    expect(late.status).toBe(409)
  })

  it('cannot be answered by the owner of another distributor, and 404s an unknown id', async () => {
    const id = await requestGrant(4)
    const foreign = await call(app, otherOwner, 'POST', `/tenancy/support-grants/${id}/approve`, {
      id,
      idempotencyKey: uuidv7(),
    })
    expect(foreign.status).toBe(404)
    const [row] = await db.select().from(supportGrants).where(eq(supportGrants.id, id))
    expect(row?.approvedAt).toBeNull()

    const missing = await call(app, owner, 'POST', `/tenancy/support-grants/${uuidv7()}/approve`, {
      id: uuidv7(),
      idempotencyKey: uuidv7(),
    })
    expect(missing.status).toBe(404)
  })

  it('filters the list by status and by "still open"', async () => {
    const openId = await requestGrant(4)
    const closedId = await requestGrant(4)
    await call(app, owner, 'POST', `/tenancy/support-grants/${closedId}/revoke`, {
      id: closedId,
      idempotencyKey: uuidv7(),
    })

    const open = await call<{ items: Grant[] }>(app, owner, 'GET', '/tenancy/support-grants', {
      openOnly: true,
      limit: 200,
    })
    const openIds = open.body.items.map((g) => g.id)
    expect(openIds).toContain(openId)
    expect(openIds).not.toContain(closedId)

    const rejected = await call<{ items: Grant[] }>(app, owner, 'GET', '/tenancy/support-grants', {
      status: 'rejected',
      limit: 200,
    })
    expect(rejected.body.items.map((g) => g.id)).toContain(closedId)
    expect(rejected.body.items.every((g) => g.status === 'rejected')).toBe(true)
  })
})
