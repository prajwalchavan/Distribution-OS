import { sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { createDb, createPool, memberships, retailerIdentities, tenants, users } from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { RetailersModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type RetailerRow = Record<string, unknown> & { id: string; name: string; code?: string }
const CREDIT_FIELDS = [
  'code',
  'tier',
  'creditLimitPaise',
  'creditLimitBills',
  'creditDays',
  'creditMode',
  'identityId',
  'onboardedBy',
]

describeDb('retailers (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8) // digits only: phones must be +91[6-9] + 9 digits
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const repId = uuidv7()
  const shopUserId = uuidv7()
  const otherShopUserId = uuidv7()
  const shopPhone = `+919${run}3`
  const otherShopPhone = `+919${run}4`
  const foreignPhone = `+919${run}5`
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const otherShop: Actor = { tenantId, actorId: otherShopUserId, role: 'retailer' }
  const beatId = uuidv7()
  const retailerId = uuidv7()
  const otherRetailerId = uuidv7()
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `ret-${run}`, legalName: 'Retailers test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+919${run}1`, name: 'Owner' },
      { id: repId, phone: `+919${run}2`, name: 'Rep' },
      { id: shopUserId, phone: shopPhone, name: 'Shop login' },
      { id: otherShopUserId, phone: otherShopPhone, name: 'Other shop login' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId, userId: otherShopUserId, role: 'retailer' },
    ])
    // an identity that belongs to another distributor's network and is not linked here
    await db
      .insert(retailerIdentities)
      .values({ id: uuidv7(), phone: foreignPhone, shopName: 'Elsewhere Stores' })
    app = await bootTestApp([RetailersModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const shopInput = {
    idempotencyKey: `ret-${run}`,
    id: retailerId,
    name: 'Sharma Kirana',
    ownerName: 'R. Sharma',
    phone: shopPhone,
    address: { line1: '12 Station Road', city: 'Pune', pincode: '411001' },
    lat: 18.52,
    lng: 73.85,
    beatId,
    stateCode: '27',
    paymentTerms: 'POST_FULFILLMENT',
  }

  it('owner creates a beat and a retailer with a server-assigned R-0001 code', async () => {
    const beat = await call<{ item: { id: string; visitDays: number[] } }>(
      app,
      owner,
      'POST',
      '/beats',
      {
        idempotencyKey: `beat-${run}`,
        id: beatId,
        name: `Station Road ${run}`,
        area: 'Pune East',
        visitDays: [1, 4],
      },
    )
    expect(beat.status).toBe(200)
    expect(beat.body.item.visitDays).toEqual([1, 4])

    const created = await call<{ item: RetailerRow }>(app, owner, 'POST', '/retailers', shopInput)
    expect(created.status).toBe(200)
    expect(created.body.item.code).toBe('R-0001')
    expect(created.body.item.tier).toBe('C')
    expect(created.body.item.creditMode).toBe('indicate')
    expect(created.body.item.onboardedBy).toBe(ownerId)
    expect(created.body.item.address).toEqual(shopInput.address)

    // replay with the same key returns the stored answer, no second code is burnt
    const again = await call<{ item: RetailerRow }>(app, owner, 'POST', '/retailers', shopInput)
    expect(again.body).toEqual(created.body)
    const conflict = await call(app, owner, 'POST', '/retailers', {
      ...shopInput,
      name: 'Different',
    })
    expect(conflict.status).toBe(409)

    const second = await call<{ item: RetailerRow }>(app, owner, 'POST', '/retailers', {
      idempotencyKey: `ret2-${run}`,
      id: otherRetailerId,
      name: 'Gupta General Stores',
      phone: otherShopPhone,
      stateCode: '27',
      tier: 'A',
      creditLimitPaise: 5_000_000,
    })
    expect(second.status).toBe(200)
    expect(second.body.item.code).toBe('R-0002')
    expect(second.body.item.tier).toBe('A')
    expect(second.body.item.creditLimitPaise).toBe(5_000_000)
  })

  it('rep updates non-credit fields but is refused on credit', async () => {
    const updated = await call<{ item: RetailerRow }>(app, rep, 'POST', '/retailers', {
      ...shopInput,
      idempotencyKey: `ret-rep-${run}`,
      ownerName: 'Rajesh Sharma',
      altPhone: `+919${run}9`,
    })
    expect(updated.status).toBe(200)
    expect(updated.body.item.ownerName).toBe('Rajesh Sharma')
    expect(updated.body.item.code).toBe('R-0001')
    expect(updated.body.item.tier).toBe('C')

    const viaUpsert = await call(app, rep, 'POST', '/retailers', {
      ...shopInput,
      idempotencyKey: `ret-rep-credit-${run}`,
      creditLimitPaise: 1,
    })
    expect(viaUpsert.status).toBe(403)
    const viaSetCredit = await call(app, rep, 'POST', `/retailers/${retailerId}/credit`, {
      idempotencyKey: `credit-rep-${run}`,
      tier: 'A',
      creditLimitPaise: 10_000_000,
      creditLimitBills: 3,
      creditDays: 15,
      creditMode: 'strict',
    })
    expect(viaSetCredit.status).toBe(403)

    const byOwner = await call<{ item: RetailerRow }>(
      app,
      owner,
      'POST',
      `/retailers/${retailerId}/credit`,
      {
        idempotencyKey: `credit-owner-${run}`,
        tier: 'B',
        creditLimitPaise: 2_500_000,
        creditLimitBills: 2,
        creditDays: 7,
        creditMode: 'strict',
      },
    )
    expect(byOwner.status).toBe(200)
    expect(byOwner.body.item.tier).toBe('B')
    expect(byOwner.body.item.creditLimitPaise).toBe(2_500_000)
    const audit = (
      await db.execute(
        sql`select count(*)::int as n from audit_log where tenant_id = ${tenantId} and entity_id = ${retailerId} and action = 'retailer.set_credit'`,
      )
    ).rows as { n: number }[]
    expect(audit[0]?.n).toBe(1)
  })

  it('links the retailer to its identity; the shop then sees only itself, without credit fields', async () => {
    const linkInput = { idempotencyKey: `link-${run}`, id: retailerId, phone: shopPhone }
    // a salesperson may not link identities (existence leak, docs/17 item 27)
    const refused = await call(app, rep, 'POST', `/retailers/${retailerId}/link`, linkInput)
    expect(refused.status).toBe(403)
    const linked = await call<{
      link: { userId: string | null; status: string; linkedBy: string }
      identityCreated: boolean
    }>(app, owner, 'POST', `/retailers/${retailerId}/link`, linkInput)
    expect(linked.status).toBe(200)
    expect(linked.body.identityCreated).toBe(true)
    expect(linked.body.link.userId).toBe(shopUserId)
    expect(linked.body.link.status).toBe('active')
    expect(linked.body.link.linkedBy).toBe('rep_onboarding')
    const replay = await call(app, owner, 'POST', `/retailers/${retailerId}/link`, linkInput)
    expect(replay.body).toEqual(linked.body)
    // a fresh key for the same phone is a no-op on the link, not a duplicate
    const relink = await call<{ identityCreated: boolean }>(
      app,
      owner,
      'POST',
      `/retailers/${retailerId}/link`,
      { ...linkInput, idempotencyKey: `link2-${run}` },
    )
    expect(relink.status).toBe(200)
    expect(relink.body.identityCreated).toBe(false)

    const mine = await call<{ items: RetailerRow[] }>(app, shop, 'GET', '/retailers', {})
    expect(mine.status).toBe(200)
    expect(mine.body.items.map((i) => i.id)).toEqual([retailerId])
    for (const key of Object.keys(mine.body.items[0] ?? {}))
      expect(CREDIT_FIELDS).not.toContain(key)
    const me = await call<{ item: RetailerRow }>(app, shop, 'GET', `/retailers/${retailerId}`, {})
    expect(me.status).toBe(200)
    expect(me.body.item.name).toBe('Sharma Kirana')
    expect(me.body.item.paymentTerms).toBe('POST_FULFILLMENT')
    for (const key of CREDIT_FIELDS) expect(me.body.item).not.toHaveProperty(key)

    // another retailer is invisible to this shop, and an unlinked shop user sees nothing
    const notMine = await call(app, shop, 'GET', `/retailers/${otherRetailerId}`, {})
    expect(notMine.status).toBe(404)
    const nothing = await call<{ items: RetailerRow[] }>(app, otherShop, 'GET', '/retailers', {})
    expect(nothing.body.items).toHaveLength(0)

    // staff still get the full record
    const staffView = await call<{ item: RetailerRow }>(
      app,
      rep,
      'GET',
      `/retailers/${retailerId}`,
      {},
    )
    expect(staffView.body.item.code).toBe('R-0001')
    expect(staffView.body.item.identityId).toBeTruthy()
  })

  it('reports a clear conflict when the phone belongs to an identity not linked here', async () => {
    const res = await call<{ message: string }>(
      app,
      owner,
      'POST',
      `/retailers/${otherRetailerId}/link`,
      { idempotencyKey: `link-foreign-${run}`, id: otherRetailerId, phone: foreignPhone },
    )
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/not linked to this distributor/)
  })

  it('lists retailers for staff with search and beat filters', async () => {
    const all = await call<{ items: RetailerRow[]; nextCursor: string | null }>(
      app,
      rep,
      'GET',
      '/retailers',
      { limit: 1 },
    )
    expect(all.body.items).toHaveLength(1)
    expect(all.body.nextCursor).toBe(all.body.items[0]?.id)
    const page2 = await call<{ items: RetailerRow[] }>(app, rep, 'GET', '/retailers', {
      limit: 1,
      cursor: all.body.nextCursor ?? '',
    })
    expect(page2.body.items[0]?.id).not.toBe(all.body.items[0]?.id)
    const byBeat = await call<{ items: RetailerRow[] }>(app, rep, 'GET', '/retailers', { beatId })
    expect(byBeat.body.items.map((i) => i.id)).toEqual([retailerId])
    const byName = await call<{ items: RetailerRow[] }>(app, rep, 'GET', '/retailers', {
      q: 'gupta',
    })
    expect(byName.body.items.map((i) => i.id)).toEqual([otherRetailerId])
  })

  it('assigns the beat to the rep and lists the visits the rep recorded', async () => {
    const assigned = await call<{ item: { userId: string; validTo: string | null } }>(
      app,
      owner,
      'POST',
      `/beats/${beatId}/assign`,
      {
        idempotencyKey: `assign-${run}`,
        assignmentId: uuidv7(),
        userId: repId,
        validFrom: '2026-09-01',
      },
    )
    expect(assigned.status).toBe(200)
    expect(assigned.body.item.userId).toBe(repId)
    expect(assigned.body.item.validTo).toBeNull()
    const stranger = await call(app, owner, 'POST', `/beats/${beatId}/assign`, {
      idempotencyKey: `assign-x-${run}`,
      assignmentId: uuidv7(),
      userId: uuidv7(),
      validFrom: '2026-09-01',
    })
    expect(stranger.status).toBe(400)

    const visitId = uuidv7()
    const visit = {
      idempotencyKey: `visit-${run}`,
      id: visitId,
      retailerId,
      beatId,
      startedAt: '2026-09-04T10:15:00+05:30',
      endedAt: '2026-09-04T10:25:00+05:30',
      outcome: 'no_order',
      reason: 'stock left',
      lat: 18.52,
      lng: 73.85,
    }
    const recorded = await call<{ item: { userId: string; startedAt: string; outcome: string } }>(
      app,
      rep,
      'POST',
      '/visits',
      visit,
    )
    expect(recorded.status).toBe(200)
    expect(recorded.body.item.userId).toBe(repId)
    expect(recorded.body.item.startedAt).toBe('2026-09-04T04:45:00.000Z')
    const replay = await call(app, rep, 'POST', '/visits', visit)
    expect(replay.body).toEqual(recorded.body)

    const listed = await call<{ items: { id: string; userId: string }[] }>(
      app,
      owner,
      'GET',
      '/visits',
      { retailerId, from: '2026-09-04T00:00:00Z', to: '2026-09-05T00:00:00Z' },
    )
    expect(listed.status).toBe(200)
    expect(listed.body.items.map((v) => v.id)).toEqual([visitId])
    const byRep = await call<{ items: { id: string }[] }>(app, owner, 'GET', '/visits', {
      userId: repId,
    })
    expect(byRep.body.items.map((v) => v.id)).toContain(visitId)

    // the retailer role has no business with beats or visits
    expect((await call(app, shop, 'GET', '/visits', {})).status).toBe(403)
    expect((await call(app, shop, 'GET', '/beats', {})).status).toBe(403)
    const beatsForStaff = await call<{ items: { id: string }[] }>(app, rep, 'GET', '/beats', {})
    expect(beatsForStaff.body.items.map((b) => b.id)).toContain(beatId)
  })

  it('refuses requests without tenant context', async () => {
    expect((await call(app, null, 'GET', '/retailers', {})).status).toBe(401)
    expect((await call(app, null, 'POST', '/retailers', shopInput)).status).toBe(401)
  })
})
