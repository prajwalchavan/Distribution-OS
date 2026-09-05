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
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `cat-${run}`, legalName: 'Catalog test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91901${run}1`, name: 'Owner' },
      { id: repId, phone: `+91901${run}2`, name: 'Rep' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
    ])
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Reliance Consumer ${run}` })
    await db.insert(brands).values({ id: brandId, manufacturerId, name: `Campa ${run}` })
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
    productName: `Campa Cola ${run}`,
    variantName: `Campa Cola 750 ml ${run}`,
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

    const found = await call<{ items: { variantId: string; brandName: string | null }[] }>(
      app,
      rep,
      'GET',
      '/catalog/variants',
      // search the run-unique name: the global catalog accumulates rows from every past test run
      { q: `campa cola 750 ml ${run}` },
    )
    expect(found.status).toBe(200)
    expect(found.body.items.map((i) => i.variantId)).toContain(variantId)
    expect(found.body.items.find((i) => i.variantId === variantId)?.brandName).toBe(`Campa ${run}`)
  })

  it('owner lists the variant for sale; the rep sees it without any cost field', async () => {
    const listed = await call<{ item: { caseSize: number; listed: boolean } }>(
      app,
      owner,
      'POST',
      '/tenant-catalog/products',
      {
        idempotencyKey: `list-${run}`,
        id: uuidv7(),
        variantId,
        listed: true,
        caseSizeOverride: 12,
        minOrderQty: 12,
        orderIncrement: 12,
      },
    )
    expect(listed.status).toBe(200)
    expect(listed.body.item.caseSize).toBe(12)

    const forRep = await call<{ items: Record<string, unknown>[] }>(
      app,
      rep,
      'GET',
      '/tenant-catalog/products',
      { listedOnly: true },
    )
    expect(forRep.status).toBe(200)
    const row = forRep.body.items.find((i) => i.variantId === variantId)
    expect(row).toBeDefined()
    for (const key of Object.keys(row ?? {}))
      expect(key.toLowerCase()).not.toMatch(/cost|purchase|margin|ptd/)
  })

  it('exposes purchase cost to the owner only', async () => {
    const set = await call<{ item: { purchaseRatePaise: number } }>(
      app,
      owner,
      'POST',
      '/tenant-catalog/costs',
      {
        idempotencyKey: `cost-${run}`,
        id: uuidv7(),
        variantId,
        purchaseRatePaise: 3000,
        landedCostPaise: 3100,
      },
    )
    expect(set.status).toBe(200)
    expect(set.body.item.purchaseRatePaise).toBe(3000)

    const ownerView = await call<{ items: unknown[] }>(app, owner, 'GET', '/tenant-catalog/costs', {
      variantId,
    })
    expect(ownerView.body.items).toHaveLength(1)

    const repView = await call(app, rep, 'GET', '/tenant-catalog/costs', { variantId })
    expect(repView.status).toBe(403)
    const repWrite = await call(app, rep, 'POST', '/tenant-catalog/costs', {
      idempotencyKey: `cost-rep-${run}`,
      id: uuidv7(),
      variantId,
      purchaseRatePaise: 1,
      landedCostPaise: 1,
    })
    expect(repWrite.status).toBe(403)
    // and even at the database level the rep sees no cost row
    const rows = (
      await db.execute(
        sql`select count(*)::int as n from tenant_product_costs where tenant_id = ${tenantId}`,
      )
    ).rows as { n: number }[]
    expect(rows[0]?.n).toBe(1)
  })

  it('keeps the catalog overlay writes with the owner and the manager, never the accountant', async () => {
    // docs/22 2026-09-05: the accountant reads the catalog, the suppliers and the costs, and edits none.
    const accountant: Actor = { tenantId, actorId: ownerId, role: 'accountant' }
    expect(
      (
        await call(app, accountant, 'POST', '/tenant-catalog/costs', {
          idempotencyKey: `cost-acc-${run}`,
          id: uuidv7(),
          variantId,
          purchaseRatePaise: 1,
          landedCostPaise: 1,
        })
      ).status,
    ).toBe(403)
    expect(
      (await call(app, accountant, 'GET', '/tenant-catalog/costs', { variantId })).status,
    ).toBe(200)
  })

  it('sets and lists which brands a rep may sell; the rep reads only its own', async () => {
    const manager: Actor = { tenantId, actorId: ownerId, role: 'manager' }
    const set = await call<{
      items: { userId: string; brandId: string; brandName: string; employedBy: string }[]
    }>(app, manager, 'POST', '/tenant-catalog/rep-authorisations', {
      idempotencyKey: `auth-${run}`,
      userId: repId,
      items: [{ id: uuidv7(), brandId, employedBy: 'manufacturer' }],
    })
    expect(set.status).toBe(200)
    expect(set.body.items).toEqual([
      expect.objectContaining({
        userId: repId,
        brandId,
        brandName: `Campa ${run}`,
        employedBy: 'manufacturer',
      }),
    ])
    // the rep is forced to itself whatever it asks for
    const mine = await call<{ items: { userId: string }[] }>(
      app,
      rep,
      'GET',
      '/tenant-catalog/rep-authorisations',
      {
        userId: ownerId,
      },
    )
    expect(mine.body.items.map((i) => i.userId)).toEqual([repId])
    // REPLACES: an empty list clears the restriction
    const cleared = await call<{ items: unknown[] }>(
      app,
      owner,
      'POST',
      '/tenant-catalog/rep-authorisations',
      {
        idempotencyKey: `auth-clear-${run}`,
        userId: repId,
        items: [],
      },
    )
    expect(cleared.body.items).toEqual([])
    expect(
      (
        await call(app, rep, 'POST', '/tenant-catalog/rep-authorisations', {
          idempotencyKey: `auth-rep-${run}`,
          userId: repId,
          items: [],
        })
      ).status,
    ).toBe(403)
  })

  it('records how the distributor runs a brand and the buy-side pack per supplier', async () => {
    const brand = await call<{
      item: { brandId: string; brandName: string; fulfilmentMode: string; cashDiscountMode: string }
    }>(app, owner, 'POST', '/tenant-catalog/brands', {
      idempotencyKey: `brand-${run}`,
      id: uuidv7(),
      brandId,
      fulfilmentMode: 'brand_dms',
      tallyExportSource: 'brand_dms',
    })
    expect(brand.status).toBe(200)
    expect(brand.body.item).toMatchObject({
      brandId,
      brandName: `Campa ${run}`,
      fulfilmentMode: 'brand_dms',
      cashDiscountMode: 'at_receipt_financial_cn',
    })
    // the natural key is (tenant, brand): a second upsert with a fresh id edits the same row
    const again = await call<{ item: { fulfilmentMode: string } }>(
      app,
      owner,
      'POST',
      '/tenant-catalog/brands',
      {
        idempotencyKey: `brand-2-${run}`,
        id: uuidv7(),
        brandId,
        fulfilmentMode: 'own',
      },
    )
    expect(again.body.item.fulfilmentMode).toBe('own')
    const list = await call<{ items: { brandId: string }[] }>(
      app,
      rep,
      'GET',
      '/tenant-catalog/brands',
    )
    expect(list.status).toBe(200)
    expect(list.body.items.filter((b) => b.brandId === brandId)).toHaveLength(1)

    const supplierId = uuidv7()
    const supplier = await call(app, owner, 'POST', '/tenant-catalog/suppliers', {
      idempotencyKey: `sup-${run}`,
      id: supplierId,
      name: `Guru Kripa ${run}`,
    })
    expect(supplier.status).toBe(200)
    const pack = await call<{
      item: { pcsPerCase: number; supplierCode: string | null; marginBasis: string }
    }>(app, owner, 'POST', '/tenant-catalog/pack-configs', {
      idempotencyKey: `pack-${run}`,
      id: uuidv7(),
      supplierId,
      variantId,
      pcsPerCase: 90,
      supplierCode: 'x90',
    })
    expect(pack.status).toBe(200)
    expect(pack.body.item).toMatchObject({
      pcsPerCase: 90,
      supplierCode: 'x90',
      marginBasis: 'ptd',
    })
    const store: Actor = { tenantId, actorId: ownerId, role: 'warehouse' }
    const packs = await call<{ items: { supplierId: string; pcsPerCase: number }[] }>(
      app,
      store,
      'GET',
      '/tenant-catalog/pack-configs',
      {
        supplierId,
      },
    )
    expect(packs.body.items).toEqual([expect.objectContaining({ supplierId, pcsPerCase: 90 })])
    // a pack config carries no rate, and the rep never reads it anyway
    for (const row of packs.body.items)
      for (const key of Object.keys(row))
        expect(key.toLowerCase()).not.toMatch(/cost|rate|margin_?paise|ptd/)
    expect((await call(app, rep, 'GET', '/tenant-catalog/pack-configs', {})).status).toBe(403)
  })

  it('refuses requests without tenant context', async () => {
    const res = await call(app, null, 'GET', '/catalog/variants', {})
    expect(res.status).toBe(401)
  })
})
