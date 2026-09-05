import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bootstrapTenant,
  brands,
  createDb,
  createPool,
  manufacturers,
  memberships,
  productVariants,
  products,
  retailerIdentities,
  retailerLinks,
  retailers,
  tenants,
  users,
} from '@dos/db'
import { uuidv7 } from '@dos/domain'
import type { Bargain, PriceList, Quote, Scheme } from '@dos/contracts'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { PricingModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

describeDb('pricing (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const repId = uuidv7()
  const shopUserId = uuidv7()
  const manufacturerId = uuidv7()
  const brandId = uuidv7()
  const productId = uuidv7()
  const v1 = uuidv7() // ₹10 default, ₹9 tier A, case 12
  const v2 = uuidv7() // ₹20 default only, case 24
  const shopA = uuidv7() // tier A, has the final override
  const shopC = uuidv7() // tier C, gets the scheme; linked to the retailer-role user
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const defaultListId = uuidv7()
  const tierAListId = uuidv7()
  const schemeId = uuidv7()
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `pricing-${run}`, legalName: 'Pricing test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91902${run}1`, name: 'Owner' },
      { id: repId, phone: `+91902${run}2`, name: 'Rep' },
      { id: shopUserId, phone: `+91902${run}3`, name: 'Shop' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Guru Kripa ${run}` })
    await db.insert(brands).values({ id: brandId, manufacturerId, name: 'MOM' })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, brandId, name: 'MOM Makhana', category: 'snacks' })
    await db.insert(productVariants).values([
      {
        id: v1,
        productId,
        name: 'Himalayan Salt 12g',
        netQty: 12,
        netUnit: 'g',
        defaultCaseSize: 12,
        hsnCode: '19041090',
      },
      {
        id: v2,
        productId,
        name: 'Peri Peri 60g',
        netQty: 60,
        netUnit: 'g',
        defaultCaseSize: 24,
        hsnCode: '19041090',
      },
    ])
    await db.insert(retailers).values([
      {
        id: shopA,
        tenantId,
        code: `A-${run}`,
        name: 'Shop A',
        phone: `+91903${run}1`,
        stateCode: '27',
        tier: 'A',
      },
      {
        id: shopC,
        tenantId,
        code: `C-${run}`,
        name: 'Shop C',
        phone: `+91903${run}2`,
        stateCode: '27',
        tier: 'C',
      },
    ])
    const identityId = uuidv7()
    await db
      .insert(retailerIdentities)
      .values({ id: identityId, phone: `+91903${run}2`, userId: shopUserId, shopName: 'Shop C' })
    await db.insert(retailerLinks).values({
      id: uuidv7(),
      tenantId,
      identityId,
      retailerId: shopC,
      userId: shopUserId,
      linkedBy: 'rep_onboarding',
    })
    app = await bootTestApp([PricingModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const quoteFor = (
    actor: Actor,
    retailerId: string,
    lines: { lineId: string; variantId: string; qtyPcs: number }[],
  ) => call<Quote>(app, actor, 'POST', '/pricing/quote', { retailerId, pricingDate: today, lines })

  it('owner creates a default list and a tier-A list with rates', async () => {
    const def = await call<{ item: PriceList }>(app, owner, 'POST', '/pricing/price-lists', {
      idempotencyKey: `pl-default-${run}`,
      id: defaultListId,
      name: 'Default',
      isDefault: true,
    })
    expect(def.status).toBe(200)
    expect(def.body.item.isDefault).toBe(true)
    const defItems = await call<{ item: PriceList }>(
      app,
      owner,
      'POST',
      `/pricing/price-lists/${defaultListId}/items`,
      {
        idempotencyKey: `pli-default-${run}`,
        priceListId: defaultListId,
        items: [
          { id: uuidv7(), variantId: v1, ratePaise: 1000 },
          { id: uuidv7(), variantId: v2, ratePaise: 2000 },
        ],
      },
    )
    expect(defItems.status).toBe(200)
    expect(defItems.body.item.items).toHaveLength(2)

    const tierA = await call<{ item: PriceList }>(app, owner, 'POST', '/pricing/price-lists', {
      idempotencyKey: `pl-a-${run}`,
      id: tierAListId,
      name: 'Tier A',
      tier: 'A',
    })
    expect(tierA.status).toBe(200)
    const aItems = await call<{ item: PriceList }>(
      app,
      owner,
      'POST',
      `/pricing/price-lists/${tierAListId}/items`,
      {
        idempotencyKey: `pli-a-${run}`,
        priceListId: tierAListId,
        items: [{ id: uuidv7(), variantId: v1, ratePaise: 900 }],
      },
    )
    expect(aItems.status).toBe(200)

    // re-setting a rate upserts on (list, variant) instead of duplicating
    const again = await call<{ item: PriceList }>(
      app,
      owner,
      'POST',
      `/pricing/price-lists/${tierAListId}/items`,
      {
        idempotencyKey: `pli-a2-${run}`,
        priceListId: tierAListId,
        items: [{ id: uuidv7(), variantId: v1, ratePaise: 950 }],
      },
    )
    expect(again.body.item.items).toHaveLength(1)
    expect(again.body.item.items[0]?.ratePaise).toBe(950)
    const fixed = await call<{ item: PriceList }>(
      app,
      owner,
      'POST',
      `/pricing/price-lists/${tierAListId}/items`,
      {
        idempotencyKey: `pli-a3-${run}`,
        priceListId: tierAListId,
        items: [{ id: uuidv7(), variantId: v1, ratePaise: 900 }],
      },
    )
    expect(fixed.body.item.items[0]?.ratePaise).toBe(900)

    const lists = await call<{ items: PriceList[] }>(app, rep, 'GET', '/pricing/price-lists', {})
    expect(lists.status).toBe(200)
    expect(lists.body.items.map((l) => l.name).sort()).toEqual(['Default', 'Tier A'])
  })

  it('owner creates a "buy 12 get 1 free" scheme; replay is idempotent; economics change bumps the version', async () => {
    const scheme = {
      idempotencyKey: `scheme-${run}`,
      id: schemeId,
      name: '12 + 1 on Makhana',
      brandId,
      scope: { variantIds: [v1] },
      triggerKind: 'qty',
      triggerMin: 12,
      triggerUnit: 'pcs',
      rewardKind: 'free_qty',
      rewardValue: 1,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      claimable: true,
    }
    const first = await call<{ item: Scheme }>(app, owner, 'POST', '/pricing/schemes', scheme)
    expect(first.status).toBe(200)
    expect(first.body.item.version).toBe(1)
    const replay = await call<{ item: Scheme }>(app, owner, 'POST', '/pricing/schemes', scheme)
    expect(replay.body).toEqual(first.body)
    const conflict = await call(app, owner, 'POST', '/pricing/schemes', {
      ...scheme,
      rewardValue: 2,
    })
    expect(conflict.status).toBe(409)

    // renaming is not an economics change
    const renamed = await call<{ item: Scheme }>(app, owner, 'POST', '/pricing/schemes', {
      ...scheme,
      idempotencyKey: `scheme-rename-${run}`,
      name: '12+1 Makhana',
    })
    expect(renamed.body.item.version).toBe(1)
    // changing the reward is
    const bumped = await call<{ item: Scheme }>(app, owner, 'POST', '/pricing/schemes', {
      ...scheme,
      idempotencyKey: `scheme-v2-${run}`,
      rewardValue: 2,
    })
    expect(bumped.body.item.version).toBe(2)
    const back = await call<{ item: Scheme }>(app, owner, 'POST', '/pricing/schemes', {
      ...scheme,
      idempotencyKey: `scheme-v3-${run}`,
    })
    expect(back.body.item.version).toBe(3)

    const listed = await call<{ items: Scheme[] }>(app, rep, 'GET', '/pricing/schemes', {
      activeOnly: true,
      on: today,
    })
    expect(listed.body.items.map((s) => s.id)).toContain(schemeId)
    const notOn = await call<{ items: Scheme[] }>(app, rep, 'GET', '/pricing/schemes', {
      on: '2027-01-01',
    })
    expect(notOn.body.items.map((s) => s.id)).not.toContain(schemeId)
  })

  it('a final override wins over the tier price and blocks the scheme for that shop', async () => {
    const ov = await call<{ item: { ratePaise: number; final: boolean } }>(
      app,
      owner,
      'POST',
      '/pricing/overrides',
      {
        idempotencyKey: `override-${run}`,
        id: uuidv7(),
        retailerId: shopA,
        variantId: v1,
        ratePaise: 850,
        final: true,
      },
    )
    expect(ov.status).toBe(200)
    expect(ov.body.item.final).toBe(true)

    const q = await quoteFor(rep, shopA, [
      { lineId: 'l1', variantId: v1, qtyPcs: 24 },
      { lineId: 'l2', variantId: v2, qtyPcs: 5 },
    ])
    expect(q.status).toBe(200)
    const l1 = q.body.lines[0]
    expect(l1?.listRatePaise).toBe(900) // tier A list
    expect(l1?.ratePaise).toBe(850) // override
    expect(l1?.freeQtyPcs).toBe(0) // final: no scheme
    expect(l1?.caseSize).toBe(12)
    expect(l1?.appliedRules.map((r) => r.kind)).toEqual(['override'])
    expect(l1?.lineNetPaise).toBe(850 * 24)
    const l2 = q.body.lines[1]
    expect(l2?.listRatePaise).toBe(2000) // falls back to the default list
    expect(l2?.ratePaise).toBe(2000)
    expect(q.body.totals.netPaise).toBe(850 * 24 + 2000 * 5)
    expect(q.body.cashDiscountBps).toBe(0)
  })

  it('another shop gets the scheme free quantity from the default list', async () => {
    const q = await quoteFor(rep, shopC, [{ lineId: 'l1', variantId: v1, qtyPcs: 24 }])
    expect(q.status).toBe(200)
    const l1 = q.body.lines[0]
    expect(l1?.listRatePaise).toBe(1000)
    expect(l1?.ratePaise).toBe(1000)
    expect(l1?.freeQtyPcs).toBe(2)
    expect(l1?.appliedRules).toEqual([
      {
        ruleId: schemeId,
        version: 3,
        kind: 'scheme',
        rewardKind: 'free_qty',
        freeQty: 2,
        freeVariantId: v1,
      },
    ])
    expect(q.body.totals.netPaise).toBe(24_000)
  })

  it('a rep bargain within the owner-set bound auto-approves and prices the next quote', async () => {
    const bound = await call<{ item: { maxDiscountBps: number } }>(
      app,
      owner,
      'POST',
      '/pricing/bounds',
      {
        idempotencyKey: `bound-${run}`,
        id: uuidv7(),
        userId: repId,
        maxDiscountBps: 1000,
      },
    )
    expect(bound.status).toBe(200)
    expect(bound.body.item.maxDiscountBps).toBe(1000)

    const bargain = await call<{ item: Bargain }>(app, rep, 'POST', '/pricing/bargains', {
      idempotencyKey: `bargain-in-${run}`,
      id: uuidv7(),
      retailerId: shopC,
      variantId: v1,
      askedRatePaise: 950,
    })
    expect(bargain.status).toBe(200)
    expect(bargain.body.item.status).toBe('auto_approved')
    expect(bargain.body.item.listRatePaise).toBe(1000)
    expect(bargain.body.item.approvedRatePaise).toBe(950)

    const q = await quoteFor(rep, shopC, [{ lineId: 'l1', variantId: v1, qtyPcs: 24 }])
    const l1 = q.body.lines[0]
    expect(l1?.ratePaise).toBe(950)
    expect(l1?.bargainPaise).toBe(50 * 24)
    expect(l1?.freeQtyPcs).toBe(2) // scheme still stacks; the bargain comes last
    expect(l1?.appliedRules.map((r) => r.kind)).toEqual(['scheme', 'bargain'])
    expect(l1?.lineNetPaise).toBe(950 * 24)
  })

  it('a rep bargain outside the bound stays requested until the owner approves it', async () => {
    const id = uuidv7()
    const asked = await call<{ item: Bargain }>(app, rep, 'POST', '/pricing/bargains', {
      idempotencyKey: `bargain-out-${run}`,
      id,
      retailerId: shopC,
      variantId: v2,
      askedRatePaise: 1500, // 25% off ₹20
    })
    expect(asked.status).toBe(200)
    expect(asked.body.item.status).toBe('requested')

    const before = await quoteFor(rep, shopC, [{ lineId: 'l2', variantId: v2, qtyPcs: 10 }])
    expect(before.body.lines[0]?.ratePaise).toBe(2000)

    const repDecides = await call(app, rep, 'POST', `/pricing/bargains/${id}/decide`, {
      idempotencyKey: `decide-rep-${run}`,
      id,
      decision: 'approve',
    })
    expect(repDecides.status).toBe(403)

    const decided = await call<{ item: Bargain }>(
      app,
      owner,
      'POST',
      `/pricing/bargains/${id}/decide`,
      {
        idempotencyKey: `decide-${run}`,
        id,
        decision: 'approve',
        approvedRatePaise: 1600,
      },
    )
    expect(decided.status).toBe(200)
    expect(decided.body.item.status).toBe('approved')
    expect(decided.body.item.approvedRatePaise).toBe(1600)
    expect(decided.body.item.decidedBy).toBe(ownerId)

    const twice = await call(app, owner, 'POST', `/pricing/bargains/${id}/decide`, {
      idempotencyKey: `decide-again-${run}`,
      id,
      decision: 'reject',
    })
    expect(twice.status).toBe(409)

    const after = await quoteFor(rep, shopC, [{ lineId: 'l2', variantId: v2, qtyPcs: 10 }])
    expect(after.body.lines[0]?.ratePaise).toBe(1600)
    expect(after.body.lines[0]?.bargainPaise).toBe(4000)

    const pending = await call<{ items: Bargain[] }>(app, owner, 'GET', '/pricing/bargains', {
      status: 'approved',
      retailerId: shopC,
    })
    expect(pending.body.items.map((b) => b.id)).toContain(id)
  })

  it('refuses a rep on owner/back-office writes', async () => {
    const bounds = await call(app, rep, 'POST', '/pricing/bounds', {
      idempotencyKey: `bound-rep-${run}`,
      id: uuidv7(),
      userId: repId,
      maxDiscountBps: 9000,
    })
    expect(bounds.status).toBe(403)
    const list = await call(app, rep, 'POST', '/pricing/price-lists', {
      idempotencyKey: `pl-rep-${run}`,
      id: uuidv7(),
      name: 'Rep list',
    })
    expect(list.status).toBe(403)
    const scheme = await call(app, rep, 'POST', '/pricing/schemes', {
      idempotencyKey: `scheme-rep-${run}`,
      id: uuidv7(),
      name: 'x',
      scope: { all: true },
      triggerKind: 'qty',
      triggerMin: 1,
      triggerUnit: 'pcs',
      rewardKind: 'line_pct',
      rewardValue: 5000,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    })
    expect(scheme.status).toBe(403)
    // manager is back office: allowed to set an override but not a bound
    const manager: Actor = { tenantId, actorId: ownerId, role: 'manager' }
    const managerBound = await call(app, manager, 'POST', '/pricing/bounds', {
      idempotencyKey: `bound-mgr-${run}`,
      id: uuidv7(),
      userId: repId,
      maxDiscountBps: 100,
    })
    expect(managerBound.status).toBe(403)
  })

  it('a retailer login may only quote and bargain for its own linked shop', async () => {
    const own = await quoteFor(shop, shopC, [{ lineId: 'l1', variantId: v1, qtyPcs: 12 }])
    expect(own.status).toBe(200)
    expect(own.body.lines[0]?.freeQtyPcs).toBe(1)
    for (const key of Object.keys(own.body.lines[0] ?? {}))
      expect(key.toLowerCase()).not.toMatch(/cost|purchase|margin|ptd/)

    const other = await quoteFor(shop, shopA, [{ lineId: 'l1', variantId: v1, qtyPcs: 12 }])
    expect(other.status).toBe(403)

    const ask = await call<{ item: Bargain }>(app, shop, 'POST', '/pricing/bargains', {
      idempotencyKey: `bargain-shop-${run}`,
      id: uuidv7(),
      retailerId: shopC,
      variantId: v2,
      askedRatePaise: 1900,
    })
    expect(ask.status).toBe(200)
    expect(ask.body.item.status).toBe('requested')
    const askOther = await call(app, shop, 'POST', '/pricing/bargains', {
      idempotencyKey: `bargain-shop-other-${run}`,
      id: uuidv7(),
      retailerId: shopA,
      variantId: v2,
      askedRatePaise: 1900,
    })
    expect(askOther.status).toBe(403)

    expect((await call(app, shop, 'GET', '/pricing/price-lists', {})).status).toBe(403)
    expect((await call(app, shop, 'GET', '/pricing/schemes', {})).status).toBe(403)
    expect((await call(app, shop, 'GET', '/pricing/overrides', {})).status).toBe(403)
    expect((await call(app, shop, 'GET', '/pricing/bargains', {})).status).toBe(403)
  })

  it('rejects a quote for an unpriced or unknown variant with a clear 400', async () => {
    const unknown = await quoteFor(rep, shopC, [{ lineId: 'l1', variantId: uuidv7(), qtyPcs: 1 }])
    expect(unknown.status).toBe(400)
    const bad = await call(app, rep, 'POST', '/pricing/quote', {
      retailerId: shopC,
      pricingDate: '4/9/2026',
      lines: [{ lineId: 'l1', variantId: v1, qtyPcs: 1 }],
    })
    expect(bad.status).toBe(400)
  })

  it('refuses requests without tenant context', async () => {
    const res = await call(app, null, 'POST', '/pricing/quote', {
      retailerId: shopC,
      lines: [{ lineId: 'l1', variantId: v1, qtyPcs: 1 }],
    })
    expect(res.status).toBe(401)
    expect((await call(app, null, 'GET', '/pricing/schemes', {})).status).toBe(401)
  })
})
