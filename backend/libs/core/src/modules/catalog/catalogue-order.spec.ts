import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  brands,
  createDb,
  createPool,
  manufacturers,
  memberships,
  priceListItems,
  priceLists,
  products,
  productVariants,
  tenantProducts,
  tenants,
  users,
} from '@dos/db'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { PricingModule } from '../pricing/index.js'
import { TenantCatalogModule } from '../tenant-catalog/index.js'
import { CatalogModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/**
 * THE CATALOGUE ORDER (architect ruling 2026-09-28 on the simulation's UX-O-8): the catalogue and every
 * price list read by brand A–Z, then item A–Z, then pack size smallest first — case-insensitive, a
 * kilogram after 500 grams — on the owner's, the manager's, the rep's and the shop's lists alike, and a
 * page walked on its cursor reads exactly the same order as one long page.
 */
describeDb('catalogue order: brand, item, pack size (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const repId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const manufacturerId = uuidv7()
  let app: NestFastifyApplication

  // In the order the ruling reads them; inserted shuffled below so no insert order can pass the test.
  const expected = [
    { brand: 'Amul', product: 'Butter', name: 'Amul Butter 100 g', qty: 100, unit: 'g' },
    { brand: 'Amul', product: 'Taaza', name: 'Amul Taaza 500 ml', qty: 500, unit: 'ml' },
    { brand: 'Amul', product: 'Taaza', name: 'Amul Taaza 1 L', qty: 1, unit: 'l' },
    { brand: 'britannia', product: 'Marie Gold', name: 'Marie Gold 250 g', qty: 250, unit: 'g' },
    { brand: 'britannia', product: 'Marie Gold', name: 'Marie Gold 500 g', qty: 500, unit: 'g' },
    { brand: 'britannia', product: 'Marie Gold', name: 'Marie Gold 1 kg', qty: 1, unit: 'kg' },
    // no brand: filed under its maker, "Maker …", after the b's
    { brand: null, product: 'Loose Sugar', name: 'Loose Sugar 1 kg', qty: 1, unit: 'kg' },
  ] as const
  const ids = expected.map(() => uuidv7())

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `cat-${run}`, legalName: 'Catalogue order', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91911${run}1`, name: 'Owner' },
      { id: repId, phone: `+91911${run}2`, name: 'Rep' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
    ])
    await bootstrapTenant(db, tenantId)
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker ${run}` })
    const brandIds = new Map<string, string>()
    for (const name of ['britannia', 'Amul']) {
      const id = uuidv7()
      brandIds.set(name, id)
      await db.insert(brands).values({ id, manufacturerId, name })
    }
    const productIds = new Map<string, string>()
    for (const e of expected) {
      if (productIds.has(e.product)) continue
      const id = uuidv7()
      productIds.set(e.product, id)
      await db.insert(products).values({
        id,
        manufacturerId,
        brandId: e.brand === null ? null : (brandIds.get(e.brand) ?? null),
        name: e.product,
      })
    }
    const shuffled = [6, 2, 5, 0, 3, 1, 4]
    for (const i of shuffled) {
      const e = expected[i]
      const id = ids[i]
      if (!e || !id) continue
      await db.insert(productVariants).values({
        id,
        productId: productIds.get(e.product) ?? '',
        name: e.name,
        netQty: e.qty,
        netUnit: e.unit,
        defaultCaseSize: 12,
        hsnCode: '19053100',
      })
      await db.insert(tenantProducts).values({ id: uuidv7(), tenantId, variantId: id })
    }
    const priceListId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    for (const i of shuffled)
      await db
        .insert(priceListItems)
        .values({ id: uuidv7(), tenantId, priceListId, variantId: ids[i] ?? '', ratePaise: 1_000 })
    app = await bootTestApp([CatalogModule, TenantCatalogModule, PricingModule])
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  const names = expected.map((e) => e.name)

  it('the distributor’s catalogue reads brand, item, pack size — for the owner and the rep', async () => {
    for (const who of [owner, rep]) {
      const res = await call<{ items: { name: string }[] }>(
        app,
        who,
        'GET',
        '/tenant-catalog/products',
        { listedOnly: true },
      )
      expect(res.status).toBe(200)
      expect(res.body.items.map((i) => i.name)).toEqual(names)
    }
  })

  it('a page walked on its cursor reads the same order as one long page, with nothing twice and nothing missed', async () => {
    const walked: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 10; page++) {
      const res: {
        status: number
        body: { items: { name: string }[]; nextCursor: string | null }
      } = await call(app, owner, 'GET', '/tenant-catalog/products', {
        listedOnly: true,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      })
      expect(res.status).toBe(200)
      walked.push(...res.body.items.map((i) => i.name))
      cursor = res.body.nextCursor
      if (!cursor) break
    }
    expect(walked).toEqual(names)
    // an unknown cursor matches nothing rather than restarting the list (the DOS-009 convention)
    const unknown = await call<{ items: unknown[] }>(
      app,
      owner,
      'GET',
      '/tenant-catalog/products',
      {
        listedOnly: true,
        cursor: uuidv7(),
      },
    )
    expect(unknown.body.items).toEqual([])
  })

  it('the global product master, listed without a search term, reads in the same order', async () => {
    const res = await call<{ items: { name: string }[]; nextCursor: string | null }>(
      app,
      owner,
      'GET',
      '/catalog/variants',
      { manufacturerId, limit: 3 },
    )
    expect(res.status).toBe(200)
    expect(res.body.items.map((i) => i.name)).toEqual(names.slice(0, 3))
    const next = await call<{ items: { name: string }[] }>(app, owner, 'GET', '/catalog/variants', {
      manufacturerId,
      limit: 10,
      cursor: res.body.nextCursor ?? '',
    })
    expect(next.body.items.map((i) => i.name)).toEqual(names.slice(3))
  })

  it('a price list’s rates read brand, item, pack size', async () => {
    const res = await call<{ items: { items: { variantName: string }[] }[] }>(
      app,
      owner,
      'GET',
      '/pricing/price-lists',
      { withItems: true },
    )
    expect(res.status).toBe(200)
    expect(res.body.items[0]?.items.map((i) => i.variantName)).toEqual(names)
  })
})
