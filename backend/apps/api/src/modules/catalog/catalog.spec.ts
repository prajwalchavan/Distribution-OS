import { sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import { createDb, createPool, memberships, tenants, users, manufacturers, brands } from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { CatalogModule } from './index.js'
import { TenantCatalogModule } from '../tenant-catalog/index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('catalog + tenant catalog (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const repId = uuidv7()
  const manufacturerId = uuidv7()
  const brandId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db.insert(tenants).values({ id: tenantId, slug: `cat-${run}`, legalName: 'Catalog test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91901${run}1`, name: 'Owner' },
      { id: repId, phone: `+91901${run}2`, name: 'Rep' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
    ])
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Reliance Consumer ${run}` })
    await db.insert(brands).values({ id: brandId, manufacturerId, name: 'Campa' })
    app = await bootTestApp([CatalogModule, TenantCatalogModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const productId = uuidv7()
  const variantId = uuidv7()
  const proposal = {
    idempotencyKey: `propose-${run}`,
    productId,
    variantId,
    manufacturerId,
    brandId,
    productName: 'Campa Cola',
    variantName: 'Campa Cola 750 ml',
    netQty: 750,
    netUnit: 'ml',
    defaultCaseSize: 24,
    hsnCode: '22021010',
    mrpPaise: 4000,
  }

  it('lets a rep propose a product and finds it immediately in search', async () => {
    const first = await call<{ status: string }>(app, rep, 'POST', '/catalog/proposals', proposal)
    expect(first.status).toBe(200)
    expect(first.body.status).toBe('proposed')
    // replay with the same key is a no-op returning the same answer
    const again = await call<{ status: string }>(app, rep, 'POST', '/catalog/proposals', proposal)
    expect(again.body).toEqual(first.body)
    // same key, different payload → 409
    const bad = await call(app, rep, 'POST', '/catalog/proposals', { ...proposal, netQty: 500 })
    expect(bad.status).toBe(409)

    const found = await call<{ items: { variantId: string; brandName: string | null }[] }>(app, rep, 'GET', '/catalog/variants', { q: 'campa' })
    expect(found.status).toBe(200)
    expect(found.body.items.map((i) => i.variantId)).toContain(variantId)
    expect(found.body.items.find((i) => i.variantId === variantId)?.brandName).toBe('Campa')
  })

  it('owner lists the variant for sale; the rep sees it without any cost field', async () => {
    const listed = await call<{ item: { caseSize: number; listed: boolean } }>(app, owner, 'POST', '/tenant-catalog/products', {
      idempotencyKey: `list-${run}`,
      id: uuidv7(),
      variantId,
      listed: true,
      caseSizeOverride: 12,
      minOrderQty: 12,
      orderIncrement: 12,
    })
    if (listed.status !== 200) console.error('LISTING ERROR', JSON.stringify(listed.body))
    expect(listed.status).toBe(200)
    expect(listed.body.item.caseSize).toBe(12)

    const forRep = await call<{ items: Record<string, unknown>[] }>(app, rep, 'GET', '/tenant-catalog/products', { listedOnly: true })
    expect(forRep.status).toBe(200)
    const row = forRep.body.items.find((i) => i.variantId === variantId)
    expect(row).toBeDefined()
    for (const key of Object.keys(row ?? {})) expect(key.toLowerCase()).not.toMatch(/cost|purchase|margin|ptd/)
  })

  it('exposes purchase cost to the owner only', async () => {
    const set = await call<{ item: { purchaseRatePaise: number } }>(app, owner, 'POST', '/tenant-catalog/costs', {
      idempotencyKey: `cost-${run}`,
      id: uuidv7(),
      variantId,
      purchaseRatePaise: 3000,
      landedCostPaise: 3100,
    })
    expect(set.status).toBe(200)
    expect(set.body.item.purchaseRatePaise).toBe(3000)

    const ownerView = await call<{ items: unknown[] }>(app, owner, 'GET', '/tenant-catalog/costs', { variantId })
    expect(ownerView.body.items).toHaveLength(1)

    const repView = await call(app, rep, 'GET', '/tenant-catalog/costs', { variantId })
    expect(repView.status).toBe(403)
    const repWrite = await call(app, rep, 'POST', '/tenant-catalog/costs', { idempotencyKey: `cost-rep-${run}`, id: uuidv7(), variantId, purchaseRatePaise: 1, landedCostPaise: 1 })
    expect(repWrite.status).toBe(403)
    // and even at the database level the rep sees no cost row
    const rows = (await db.execute(sql`select count(*)::int as n from tenant_product_costs where tenant_id = ${tenantId}`)).rows as { n: number }[]
    expect(rows[0]?.n).toBe(1)
  })

  it('refuses requests without tenant context', async () => {
    const res = await call(app, null, 'GET', '/catalog/variants', {})
    expect(res.status).toBe(401)
  })
})
