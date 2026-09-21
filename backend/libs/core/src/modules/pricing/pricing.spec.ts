import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bootstrapTenant,
  brands,
  createDb,
  createPool,
  hsnRates,
  manufacturers,
  memberships,
  priceListItems,
  productVariants,
  products,
  retailerIdentities,
  retailerLinks,
  retailers,
  tenantProducts,
  tenants,
  users,
} from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { eq, inArray } from 'drizzle-orm'
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
  const vUnrated = uuidv7() // its HSN has no GST rate on any date (DOS-096)
  const vCess = uuidv7() // DOS-079: 28% GST + 12% compensation cess, ₹22.97 a piece
  const vAerated = uuidv7() // S-176: on the CURATED heading 2202, whose rate the demo catalogue ships
  // Per-run HSN codes so no other spec's rate row can answer for them (8 and 9 are orders' and ai's
  // prefixes). They carry the run's FULL suffix and are deleted in `afterAll`: `hsn_rates` is global,
  // `hsn_rates_code_from_idx` is unique (S-176), and a code built from the clock's last six digits
  // came round again on a long-lived database as a hard INSERT failure, not a flake.
  const hsn = `7${run}` // 18% from 2020-04-01
  const hsnNoRate = `6${run}` // never given an hsn_rates row
  const hsnCess = `5${run}` // 28% + 12% cess from 2020-04-01 (DOS-079)
  /**
   * The CURATED heading of aerated waters with added sugar, whose one live rate the demo catalogue
   * ships (`seed-demo/catalog.ts`) — not a per-run fixture code. S-176 was that this heading carried
   * THREE live rates, so the rate a case of Campa bore was the query plan's choice and changed with
   * the rest of the order; the spec below prices against the real table the app prices against.
   */
  const AERATED_HSN = '2202'
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
        hsnCode: hsn,
      },
      {
        id: v2,
        productId,
        name: 'Peri Peri 60g',
        netQty: 60,
        netUnit: 'g',
        defaultCaseSize: 24,
        hsnCode: hsn,
      },
      {
        id: vUnrated,
        productId,
        name: 'Pudina 12g',
        netQty: 12,
        netUnit: 'g',
        defaultCaseSize: 12,
        hsnCode: hsnNoRate,
      },
      {
        id: vCess,
        productId,
        name: 'Campa Cola 750 ml',
        netQty: 750,
        netUnit: 'ml',
        defaultCaseSize: 12,
        hsnCode: hsnCess,
      },
      {
        id: vAerated,
        productId,
        name: `Aerated 600 ml ${run}`,
        netQty: 600,
        netUnit: 'ml',
        defaultCaseSize: 24,
        hsnCode: AERATED_HSN,
      },
    ])
    // The quote carries GST (DOS-096), so every item it prices needs a dated rate for its HSN.
    await db.insert(hsnRates).values([
      { id: uuidv7(), hsnCode: hsn, gstBps: 1800, effectiveFrom: '2020-04-01' },
      { id: uuidv7(), hsnCode: hsnCess, gstBps: 2800, cessBps: 1200, effectiveFrom: '2020-04-01' },
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
    // The rate rows this run wrote into the GLOBAL table go with it (the pool is the owner connection,
    // and RLS does not apply to `hsn_rates`), so a re-run on the same database inserts them afresh.
    await db.delete(hsnRates).where(inArray(hsnRates.hsnCode, [hsn, hsnNoRate, hsnCess]))
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

  // -------------------------------------------------------------------------------------------------------
  // DOS-013: a price list names what it prices. The owner's Prices screen used to name rows from the
  // tenant's LISTED catalogue, so a variant that is priced but not listed (Chamak Glass Cleaner, priced in
  // all four lists) showed as "1c3586ee". The name belongs on the wire, resolved the way order and invoice
  // lines resolve it (DOS-003): the tenant's local alias, else the global variant name.

  it('DOS-013: priceLists.list names every item — a variant the tenant does not list carries the global variant name, a listed one its local alias', async () => {
    // v1 is listed under the tenant's own word for it; v2 is priced but never listed.
    await db
      .insert(tenantProducts)
      .values({ id: uuidv7(), tenantId, variantId: v1, localAlias: `Makhana Salted ${run}` })

    const lists = await call<{ items: PriceList[] }>(app, owner, 'GET', '/pricing/price-lists', {})
    expect(lists.status).toBe(200)
    const items = lists.body.items.find((l) => l.id === defaultListId)?.items ?? []
    const byVariant = new Map(items.map((i) => [i.variantId, i]))
    expect(byVariant.get(v1)?.variantName).toBe(`Makhana Salted ${run}`)
    expect(byVariant.get(v2)?.variantName).toBe('Peri Peri 60g')
    expect(items.every((i) => i.variantName !== '' && i.variantName !== i.variantId)).toBe(true)
  })

  it('DOS-013: setItems and the price-list upsert answer the same names, and a same-key replay of setItems answers 200 with the stored reply', async () => {
    // the same rates the list already carries: this proves the reply's names, not a price change
    const body = {
      idempotencyKey: `pli-dos013-${run}`,
      priceListId: defaultListId,
      items: [
        { id: uuidv7(), variantId: v1, ratePaise: 1000 },
        { id: uuidv7(), variantId: v2, ratePaise: 2000 },
      ],
    }
    const set = await call<{ item: PriceList }>(
      app,
      owner,
      'POST',
      `/pricing/price-lists/${defaultListId}/items`,
      body,
    )
    expect(set.status).toBe(200)
    const names = new Map(set.body.item.items.map((i) => [i.variantId, i.variantName]))
    expect(names.get(v1)).toBe(`Makhana Salted ${run}`)
    expect(names.get(v2)).toBe('Peri Peri 60g')

    // DOS-160: the stored reply of the first call answers the replay, whatever the schema has since gained.
    const replay = await call<{ item: PriceList }>(
      app,
      owner,
      'POST',
      `/pricing/price-lists/${defaultListId}/items`,
      body,
    )
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual(set.body)

    const upsert = await call<{ item: PriceList }>(app, owner, 'POST', '/pricing/price-lists', {
      idempotencyKey: `pl-dos013-${run}`,
      id: defaultListId,
      name: 'Default',
      isDefault: true,
    })
    expect(upsert.status).toBe(200)
    expect(new Map(upsert.body.item.items.map((i) => [i.variantId, i.variantName]))).toEqual(names)
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

  it('lets a rep read its own auto-approve bound, and the desk everyone bound', async () => {
    const mine = await call<{ items: { userId: string; maxDiscountBps: number }[] }>(
      app,
      rep,
      'GET',
      '/pricing/bounds',
      {
        userId: ownerId,
      },
    )
    expect(mine.status).toBe(200)
    expect(mine.body.items.length).toBeGreaterThan(0)
    expect(mine.body.items.every((b) => b.userId === repId)).toBe(true)
    const desk = await call<{ items: { userId: string }[] }>(app, owner, 'GET', '/pricing/bounds')
    expect(desk.body.items.map((b) => b.userId)).toContain(repId)
    expect((await call(app, shop, 'GET', '/pricing/bounds')).status).toBe(403)
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
    expect((await call(app, shop, 'GET', '/pricing/overrides', {})).status).toBe(403)
    // The shop reads its deals in the PUBLIC shape (docs/23 §8.16): never who funds a scheme or
    // whether it is claimable — and only the schemes whose applicability includes its own shop.
    const deals = await call<{ items: Record<string, unknown>[] }>(
      app,
      shop,
      'GET',
      '/pricing/schemes',
      {},
    )
    expect(deals.status).toBe(200)
    for (const item of deals.body.items) {
      expect(item).not.toHaveProperty('fundingSource')
      expect(item).not.toHaveProperty('claimable')
      expect(item).not.toHaveProperty('sourceRef')
    }
    // ...and the outcome of its own bargain requests, nobody else's (RLS `bargain_requests_read`).
    const asked = await call<{ items: { retailerId: string }[] }>(
      app,
      shop,
      'GET',
      '/pricing/bargains',
      {},
    )
    expect(asked.status).toBe(200)
    expect(asked.body.items.length).toBeGreaterThan(0)
    expect(asked.body.items.every((b) => b.retailerId === shopC)).toBe(true)
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

  it("DOS-096: a shop's quote carries GST at the dated HSN rate and the rupee-rounded amount it will pay", async () => {
    // shopC's auto-approved ₹9.50 bargain on v1 and the 12 + 1 scheme both apply here, so the figures are held
    // to the order's own arithmetic rather than pinned to one basket.
    const q = await quoteFor(shop, shopC, [{ lineId: 'l1', variantId: v1, qtyPcs: 24 }])
    expect(q.status).toBe(200)
    const l1 = q.body.lines[0]
    const net = l1?.lineNetPaise ?? 0
    expect(net).toBeGreaterThan(0)
    expect(l1?.gstBps).toBe(1800)
    expect(l1?.taxPaise).toBe(Math.round((net * 1800) / 10_000))
    expect(l1?.lineTotalPaise).toBe(net + (l1?.taxPaise ?? 0))
    const { totals } = q.body
    expect(totals.taxPaise).toBe(q.body.lines.reduce((n, l) => n + l.taxPaise, 0))
    expect(totals.totalPaise % 100).toBe(0)
    expect(totals.totalPaise).toBe(totals.netPaise + totals.taxPaise + totals.roundOffPaise)
    expect(Math.abs(totals.roundOffPaise)).toBeLessThanOrEqual(50)

    // Dated: a rate that starts later answers only for a quote priced on or after its date.
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 2800, effectiveFrom: '2031-01-01' })
    const later = await call<Quote>(app, rep, 'POST', '/pricing/quote', {
      retailerId: shopA,
      pricingDate: '2031-03-15',
      lines: [{ lineId: 'l2', variantId: v2, qtyPcs: 10 }],
    })
    expect(later.status).toBe(200)
    expect(later.body.lines[0]?.gstBps).toBe(2800)
    expect(later.body.lines[0]?.taxPaise).toBe(5_600) // 28% of ₹200.00
    expect(
      (await quoteFor(rep, shopA, [{ lineId: 'l2', variantId: v2, qtyPcs: 10 }])).body.lines[0]
        ?.gstBps,
    ).toBe(1800)
  })

  it('S-176: prices an aerated drink at the ONE rate its HSN carries — 28% plus 12% cess — alone on the order and beside another HSN', async () => {
    await db.insert(priceListItems).values({
      id: uuidv7(),
      tenantId,
      priceListId: defaultListId,
      variantId: vAerated,
      ratePaise: 2_500,
    })
    /*
     * THE WALK'S FINDING, IN A SPEC. `hsn_rates` held three live rows for heading 2202 — aerated
     * waters at 28% + 12% cess, packaged drinking water at 18%, fruit-juice based drinks at 12% —
     * and every caller takes "the first row" of `effective_from DESC`, which with equal dates is the
     * query PLAN's choice. It was not even a stable wrong answer: `hsn_code IN ('2202')` came back
     * 12% with no cess and `IN ('2202', <another>)` came back 28% + 12%, so a rep who put only
     * aerated drinks on an order quoted the shopkeeper a quarter under the bill he would be handed.
     * One heading now names one rate (migration 0058) and a second live row is refused (0059).
     */
    const alone = await quoteFor(rep, shopA, [{ lineId: 'a1', variantId: vAerated, qtyPcs: 24 }])
    expect(alone.status).toBe(200)
    expect(alone.body.lines[0]).toMatchObject({
      lineNetPaise: 60_000,
      gstBps: 2_800,
      cessBps: 1_200,
      cessPaise: 7_200,
      taxPaise: 24_000, // 28% GST ₹168.00 + 12% cess ₹72.00, cess INSIDE the tax (DOS-079)
    })

    // Beside a line of another HSN — the case that used to resolve differently.
    const beside = await quoteFor(rep, shopA, [
      { lineId: 'a1', variantId: vAerated, qtyPcs: 24 },
      { lineId: 'a2', variantId: v2, qtyPcs: 10 },
    ])
    expect(beside.status).toBe(200)
    const aerated = beside.body.lines.find((l) => l.lineId === 'a1')
    expect(aerated?.gstBps).toBe(alone.body.lines[0]?.gstBps)
    expect(aerated?.cessBps).toBe(alone.body.lines[0]?.cessBps)
    expect(aerated?.taxPaise).toBe(alone.body.lines[0]?.taxPaise)
  })

  it('DOS-079: a quote for a cess item carries cessBps/cessPaise inside taxPaise and the rupee-rounded payable', async () => {
    await db.insert(priceListItems).values({
      id: uuidv7(),
      tenantId,
      priceListId: defaultListId,
      variantId: vCess,
      ratePaise: 2297,
    })
    // 48 pcs at ₹22.97 = ₹1,102.56; 28% GST ₹308.72 + 12% cess ₹132.31 = ₹441.03 of tax.
    const q = await quoteFor(rep, shopA, [{ lineId: 'lc', variantId: vCess, qtyPcs: 48 }])
    expect(q.status).toBe(200)
    expect(q.body.lines[0]).toMatchObject({
      lineNetPaise: 110_256,
      gstBps: 2_800,
      cessBps: 1_200,
      cessPaise: 13_231,
      taxPaise: 44_103,
      lineTotalPaise: 154_359,
    })
    expect(q.body.totals).toMatchObject({
      netPaise: 110_256,
      taxPaise: 44_103,
      cessPaise: 13_231,
      roundOffPaise: 41,
      totalPaise: 154_400,
    })
  })

  it('DOS-096: a quote for an item whose HSN has no GST rate is a 400 naming the HSN, never a silent 0%', async () => {
    await db.insert(priceListItems).values({
      id: uuidv7(),
      tenantId,
      priceListId: defaultListId,
      variantId: vUnrated,
      ratePaise: 500,
    })
    const refused = await call<{ message: string; data?: unknown }>(
      app,
      rep,
      'POST',
      '/pricing/quote',
      {
        retailerId: shopC,
        pricingDate: today,
        lines: [
          { lineId: 'l1', variantId: v1, qtyPcs: 1 },
          { lineId: 'l2', variantId: vUnrated, qtyPcs: 1 },
        ],
      },
    )
    expect(refused.status).toBe(400)
    expect(refused.body.message).toContain(hsnNoRate)
    // The codes travel as data too, so the shop's screen can say which rate is missing (DOS-096 amendment b).
    expect(refused.body.data).toEqual({ hsnCodes: [hsnNoRate], on: today })

    // Item-specific, not a broken fixture: the same shop's rated item still prices.
    const rated = await quoteFor(rep, shopC, [{ lineId: 'l1', variantId: v1, qtyPcs: 1 }])
    expect(rated.status).toBe(200)
    expect(rated.body.lines[0]?.gstBps).toBe(1800)
  })

  it('DOS-075: an order-value scheme saved through the contract with a paise threshold (₹500 = 50_000) applies on quote above it and not below it', async () => {
    // Priced on a 2031 date inside this scheme's own window, so the 2026 "12 + 1" (v1 only) is out of force;
    // shopA's final override is v1 only and shopA has no approved bargain, so v2 prices at the default ₹20.
    const orderValueId = uuidv7()
    const saved = await call<{ item: Scheme }>(app, owner, 'POST', '/pricing/schemes', {
      idempotencyKey: `scheme-dos075-${run}`,
      id: orderValueId,
      name: 'Order value 2% over ₹500',
      scope: { all: true },
      triggerKind: 'value',
      triggerMin: 50_000,
      triggerUnit: 'inr',
      rewardKind: 'order_pct',
      rewardValue: 200,
      validFrom: '2031-03-01',
      validTo: '2031-03-31',
    })
    expect(saved.status).toBe(200)
    expect(saved.body.item.triggerMin).toBe(50_000)

    const quoteIn2031 = (qtyPcs: number) =>
      call<Quote>(app, rep, 'POST', '/pricing/quote', {
        retailerId: shopA,
        pricingDate: '2031-03-15',
        lines: [{ lineId: 'l1', variantId: v2, qtyPcs }],
      })
    const share = {
      ruleId: orderValueId,
      version: 1,
      kind: 'scheme',
      rewardKind: 'order_pct',
      amountPaise: 1_200,
    }

    const above = await quoteIn2031(30) // ₹600
    expect(above.status).toBe(200)
    expect(above.body.totals.grossPaise).toBe(60_000)
    expect(above.body.orderRules).toContainEqual(share)
    expect(above.body.lines[0]?.discountPaise).toBe(1_200)
    expect(above.body.lines[0]?.appliedRules).toContainEqual(share)
    expect(above.body.totals.netPaise).toBe(58_800)

    const below = await quoteIn2031(20) // ₹400
    expect(below.status).toBe(200)
    expect(below.body.totals.grossPaise).toBe(40_000)
    expect(below.body.orderRules).toEqual([])
    expect(below.body.totals.discountPaise).toBe(0)
  })

  it('DOS-087: a per-unit amount saved through the contract takes ₹15 off every case from 2 cases on', async () => {
    // Founder, 2026-09-13: "₹15 off per case on 2+" is ₹15 on EVERY case once two are bought. v2 is a
    // case of 24 at ₹20 and this scheme's window is its own, so nothing else prices these quotes.
    const perCaseId = uuidv7()
    const saved = await call<{ item: Scheme }>(app, owner, 'POST', '/pricing/schemes', {
      idempotencyKey: `scheme-dos087-${run}`,
      id: perCaseId,
      name: '₹15 off per case on 2+',
      scope: { all: true },
      triggerKind: 'qty',
      triggerMin: 2,
      triggerUnit: 'case',
      rewardKind: 'per_unit_amount',
      rewardValue: 1_500,
      validFrom: '2032-03-01',
      validTo: '2032-03-31',
    })
    expect(saved.status).toBe(200)
    expect(saved.body.item.rewardKind).toBe('per_unit_amount')

    const quoteIn2032 = (qtyPcs: number) =>
      call<Quote>(app, rep, 'POST', '/pricing/quote', {
        retailerId: shopA,
        pricingDate: '2032-03-15',
        lines: [{ lineId: 'l1', variantId: v2, qtyPcs }],
      })
    expect((await quoteIn2032(24)).body.totals.discountPaise).toBe(0) // one case: under the trigger
    expect((await quoteIn2032(48)).body.totals.discountPaise).toBe(3_000) // ₹15 × 2
    expect((await quoteIn2032(72)).body.totals.discountPaise).toBe(4_500) // ₹15 × 3
    // 2 cs + 6 loose pieces is two cases: loose pieces never round up.
    expect((await quoteIn2032(54)).body.totals.discountPaise).toBe(3_000)

    // And the contract refuses one with no unit to pay per.
    const refused = await call(app, owner, 'POST', '/pricing/schemes', {
      idempotencyKey: `scheme-dos087-inr-${run}`,
      id: uuidv7(),
      name: '₹15 off per rupee',
      scope: { all: true },
      triggerKind: 'value',
      triggerMin: 50_000,
      triggerUnit: 'inr',
      rewardKind: 'per_unit_amount',
      rewardValue: 1_500,
      validFrom: '2032-03-01',
      validTo: '2032-03-31',
    })
    expect(refused.status).toBe(400)
  })

  it("DOS-076: pricing.quote reports a brand-scoped cash discount on that brand's lines only", async () => {
    // A second brand under this run's manufacturer: Too Yumm Karare 60 g, case of 48, ₹14.75 on the default list.
    const tooYummBrandId = uuidv7()
    const tooYummProductId = uuidv7()
    const v3 = uuidv7()
    await db.insert(brands).values({ id: tooYummBrandId, manufacturerId, name: 'Too Yumm' })
    await db.insert(products).values({
      id: tooYummProductId,
      manufacturerId,
      brandId: tooYummBrandId,
      name: 'Too Yumm Karare',
      category: 'snacks',
    })
    await db.insert(productVariants).values({
      id: v3,
      productId: tooYummProductId,
      name: 'Karare 60g',
      netQty: 60,
      netUnit: 'g',
      defaultCaseSize: 48,
      hsnCode: hsn,
    })
    const priced = await call<{ item: PriceList }>(
      app,
      owner,
      'POST',
      `/pricing/price-lists/${defaultListId}/items`,
      {
        idempotencyKey: `pli-ty-${run}`,
        priceListId: defaultListId,
        items: [{ id: uuidv7(), variantId: v3, ratePaise: 1475 }],
      },
    )
    expect(priced.status).toBe(200)

    const schemeCdId = uuidv7()
    const saved = await call<{ item: Scheme }>(app, owner, 'POST', '/pricing/schemes', {
      idempotencyKey: `scheme-cd-ty-${run}`,
      id: schemeCdId,
      name: 'Too Yumm 2% cash discount',
      brandId: tooYummBrandId,
      scope: { brandIds: [tooYummBrandId] },
      triggerKind: 'value',
      triggerUnit: 'inr',
      triggerMin: 0,
      rewardKind: 'cash_discount_pct',
      rewardValue: 200,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    })
    expect(saved.status).toBe(200)

    // MOM v2 carries shopC's approved ₹16 bargain from the test above; only the Too Yumm line is in scope.
    const q = await quoteFor(rep, shopC, [
      { lineId: 'mom', variantId: v2, qtyPcs: 24 },
      { lineId: 'ty', variantId: v3, qtyPcs: 48 },
    ])
    expect(q.status).toBe(200)
    const mom = q.body.lines.find((l) => l.lineId === 'mom')
    const ty = q.body.lines.find((l) => l.lineId === 'ty')
    expect(mom?.lineNetPaise).toBeGreaterThan(0)
    expect(ty?.lineNetPaise).toBe(70_800)
    expect(ty?.discountPaise).toBe(0)
    // 2% of the Too Yumm line's ₹708.00, not of the whole order; reported, never deducted
    expect(q.body.cashDiscountBps).toBe(200)
    expect(q.body.cashDiscountPaise).toBe(1_416)
    expect(q.body.orderRules).toEqual([
      {
        ruleId: schemeCdId,
        version: 1,
        kind: 'scheme',
        rewardKind: 'cash_discount_pct',
        amountPaise: 1_416,
      },
    ])
    expect(q.body.totals.netPaise).toBe(q.body.lines.reduce((n, l) => n + l.lineNetPaise, 0))
  })

  it('DOS-104: pricing.rates answers one row per listed variant whose ratePaise and listRatePaise equal a qty-1 pricing.quote for the same shop and date — tier list, retailer override, approved bargain and a final override included — answers [] for an empty catalogue, and a retailer login rates only its own shop (403 for another)', async () => {
    interface Rates {
      retailerId: string
      pricingDate: string
      items: { variantId: string; caseSize: number; listRatePaise: number; ratePaise: number }[]
    }
    /*
     * The rate list IS the listed catalogue, so an empty catalogue is an empty list and never an
     * error. The DOS-013 test above lists v1 under the tenant's own alias, so this clause clears
     * the tenant's listings first and rebuilds them below: the claim being proven is about a
     * distributor who has listed nothing, not about which test happened to run before this one.
     * (`tenant_products_idx` is unique on (tenant, variant), so the rebuild would collide anyway.)
     */
    await db.delete(tenantProducts).where(eq(tenantProducts.tenantId, tenantId))
    const empty = await call<Rates>(app, rep, 'GET', '/pricing/rates', {
      retailerId: shopC,
      pricingDate: today,
    })
    expect(empty.status).toBe(200)
    expect(empty.body.items).toEqual([])

    // The DOS-076 test above re-posted the default list with its own single item, so the two rates
    // this spec started with are put back before anything is listed. (`price-lists/{id}/items`
    // replaces the list's items; that is not what this finding is about.)
    const relisted = await call<{ item: PriceList }>(
      app,
      owner,
      'POST',
      `/pricing/price-lists/${defaultListId}/items`,
      {
        idempotencyKey: `pli-rates-${run}`,
        priceListId: defaultListId,
        items: [
          { id: uuidv7(), variantId: v1, ratePaise: 1000 },
          { id: uuidv7(), variantId: v2, ratePaise: 2000 },
        ],
      },
    )
    expect(relisted.status).toBe(200)

    await db.insert(tenantProducts).values([
      { id: uuidv7(), tenantId, variantId: v1, listed: true },
      { id: uuidv7(), tenantId, variantId: v2, listed: true },
      // Unlisted, and its HSN has no rate: it must not be quoted, and must not 400 the whole list.
      { id: uuidv7(), tenantId, variantId: vUnrated, listed: false },
    ])

    // Shop C: tier C, the "buy 12 get 1 free" scheme, and the bargain the owner approved above.
    // Shop A: tier A's own list plus the FINAL retailer override that blocks schemes.
    for (const [actor, retailerId] of [
      [rep, shopC],
      [owner, shopA],
    ] as const) {
      const rates = await call<Rates>(app, actor, 'GET', '/pricing/rates', {
        retailerId,
        pricingDate: today,
      })
      expect(rates.status, retailerId).toBe(200)
      expect(rates.body.retailerId).toBe(retailerId)
      expect(rates.body.pricingDate).toBe(today)
      expect(rates.body.items.map((i) => i.variantId).sort()).toEqual([v1, v2].sort())
      // The projection IS the engine: every figure must equal what a qty-1 quote answers.
      for (const item of rates.body.items) {
        const quoted = await quoteFor(actor, retailerId, [
          { lineId: item.variantId, variantId: item.variantId, qtyPcs: 1 },
        ])
        expect(quoted.status).toBe(200)
        const line = quoted.body.lines[0]
        expect(item.ratePaise, `${retailerId} ${item.variantId} rate`).toBe(line?.ratePaise)
        expect(item.listRatePaise, `${retailerId} ${item.variantId} list`).toBe(line?.listRatePaise)
        expect(item.caseSize, `${retailerId} ${item.variantId} case`).toBe(line?.caseSize)
      }
    }

    // A shop rates its own shop and no other — the same rule `pricing.quote` already enforces.
    expect((await call(app, shop, 'GET', '/pricing/rates', { retailerId: shopC })).status).toBe(200)
    expect((await call(app, shop, 'GET', '/pricing/rates', { retailerId: shopA })).status).toBe(403)
    expect((await call(app, null, 'GET', '/pricing/rates', { retailerId: shopC })).status).toBe(401)
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
