import { sql } from 'drizzle-orm'
import { uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  locations,
  manufacturers,
  memberships,
  products,
  productVariants,
  supplierPackConfigs,
  suppliers,
  tenantProductCosts,
  tenants,
  users,
  withTenant,
} from '@dos/db'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { TenantCatalogModule } from '../tenant-catalog/index.js'
import { ProcurementModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type GrnLine = { id: string; variantId: string; lotId: string | null; expectedQtyPcs: number }
type Grn = {
  id: string
  grnNo: string | null
  status: string
  lines: GrnLine[]
  discrepancies: { kind: string; qtyPcs: number; grnLineId: string }[]
}
type Balance = { lotId: string; locationId: string; onHand: number }

describeDb('procurement (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const repId = uuidv7()
  const supplierId = uuidv7()
  const variantA = uuidv7()
  const variantB = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  let godown = ''
  let damagedBin = ''
  let app: NestFastifyApplication

  const invoiceId = uuidv7()
  const lineA = uuidv7()
  const lineB = uuidv7()
  const grnId = uuidv7()
  const irn = 'a'.repeat(63) + run.slice(-1).replace(/[^0-9a-f]/, '0')

  /** Two lines; B has 12 free pieces and a 5% discount. Header = Σ line totals + round-off 61. */
  const invoice = {
    idempotencyKey: `inv-${run}`,
    id: invoiceId,
    supplierId,
    source: 'docint',
    invoiceNo: `GK/${run}`,
    invoiceDate: '2026-09-01',
    irn,
    subtotalPaise: 316800,
    discountPaise: 8640,
    cgstPaise: 18490,
    sgstPaise: 18489,
    roundOffPaise: 61,
    totalPaise: 345200,
    lines: [
      {
        id: lineA,
        lineNo: 1,
        description: 'MOM Makhana 12g - Himalayan Salt x 90',
        supplierCode: 'MK12',
        variantId: variantA,
        hsnCode: '2008',
        batchNo: 'B1',
        expiryDate: '2027-03-01',
        mrpPaise: 1000,
        printedQty: 2,
        printedUnit: 'cs',
        qtyPcs: 180,
        freeQtyPcs: 0,
        ratePaise: 800,
        gstBps: 1200,
        taxablePaise: 144000,
        taxPaise: 17280,
        lineTotalPaise: 161280,
      },
      {
        id: lineB,
        lineNo: 2,
        description: 'MOM Panchameva 20G Pouch x 144',
        variantId: variantB,
        hsnCode: '2008',
        batchNo: 'P7',
        expiryDate: '2027-01-15',
        mrpPaise: 1500,
        printedQty: 1,
        printedUnit: 'cs',
        qtyPcs: 144,
        freeQtyPcs: 12,
        ratePaise: 1200,
        discountBps: 500,
        discountPaise: 8640,
        gstBps: 1200,
        taxablePaise: 164160,
        taxPaise: 19699,
        lineTotalPaise: 183859,
      },
    ],
  }

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `proc-${run}`, legalName: 'Procurement test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91903${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91903${run}2`, name: 'Manager' },
      { id: repId, phone: `+91903${run}3`, name: 'Rep' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
    ])
    await bootstrapTenant(db, tenantId)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker proc ${run}` })
    await db.insert(products).values({ id: productId, manufacturerId, name: 'MOM Makhana' })
    await db.insert(productVariants).values([
      {
        id: variantA,
        productId,
        name: 'Makhana 12 g Himalayan Salt',
        netQty: 12,
        netUnit: 'g',
        defaultCaseSize: 90,
        hsnCode: '2008',
      },
      {
        id: variantB,
        productId,
        name: 'Panchameva 20 g',
        netQty: 20,
        netUnit: 'g',
        defaultCaseSize: 144,
        hsnCode: '2008',
      },
    ])
    await db.insert(suppliers).values({ id: supplierId, tenantId, name: `Guru Kripa ${run}` })
    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    damagedBin = locs.find((l) => l.kind === 'damaged')?.id ?? ''
    app = await bootTestApp([ProcurementModule, TenantCatalogModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('records a reviewed supplier invoice; header must add up and IRN must be new', async () => {
    const bad = await call<{ message: string }>(
      app,
      owner,
      'POST',
      '/procurement/supplier-invoices',
      {
        ...invoice,
        idempotencyKey: `inv-bad-${run}`,
        id: uuidv7(),
        totalPaise: 345201,
      },
    )
    expect(bad.status).toBe(400)
    expect(bad.body.message).toMatch(/header total/)

    const res = await call<{ item: { status: string; lines: { id: string }[] } }>(
      app,
      owner,
      'POST',
      '/procurement/supplier-invoices',
      invoice,
    )
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('approved')
    expect(res.body.item.lines.map((l) => l.id)).toEqual([lineA, lineB])

    const dup = await call<{ message: string }>(
      app,
      owner,
      'POST',
      '/procurement/supplier-invoices',
      {
        ...invoice,
        idempotencyKey: `inv-dup-${run}`,
        id: uuidv7(),
        invoiceNo: `GK/${run}/2`,
      },
    )
    expect(dup.status).toBe(409)
    expect(dup.body.message).toMatch(/IRN/)

    expect(
      (await call(app, rep, 'GET', `/procurement/supplier-invoices/${invoiceId}`)).status,
    ).toBe(403)
  })

  it('matches an unresolved line and remembers the supplier pack config for the tenant', async () => {
    const pendingId = uuidv7()
    const pendingLine = uuidv7()
    const created = await call<{ item: { status: string } }>(
      app,
      owner,
      'POST',
      '/procurement/supplier-invoices',
      {
        idempotencyKey: `inv-pending-${run}`,
        id: pendingId,
        supplierId,
        source: 'manual',
        invoiceNo: `GK/${run}/P`,
        invoiceDate: '2026-09-02',
        subtotalPaise: 144000,
        cgstPaise: 8640,
        sgstPaise: 8640,
        totalPaise: 161280,
        lines: [
          {
            id: pendingLine,
            lineNo: 1,
            description: 'MOM MAKHANA 12G HIM SALT x 90',
            supplierCode: 'MK12',
            printedQty: 2,
            printedUnit: 'cs',
            qtyPcs: 180,
            ratePaise: 800,
            gstBps: 1200,
            taxablePaise: 144000,
            taxPaise: 17280,
            lineTotalPaise: 161280,
          },
        ],
      },
    )
    expect(created.status).toBe(200)
    expect(created.body.item.status).toBe('in_review')
    const matched = await call<{ item: { status: string; lines: { variantId: string | null }[] } }>(
      app,
      owner,
      'POST',
      `/procurement/supplier-invoices/${pendingId}/lines/${pendingLine}/match`,
      { idempotencyKey: `match-${run}`, variantId: variantA },
    )
    expect(matched.status).toBe(200)
    expect(matched.body.item.status).toBe('approved')
    expect(matched.body.item.lines[0]?.variantId).toBe(variantA)
    const [pack] = await db
      .select()
      .from(supplierPackConfigs)
      .where(
        sql`${supplierPackConfigs.tenantId} = ${tenantId} and ${supplierPackConfigs.variantId} = ${variantA}`,
      )
    expect(pack).toMatchObject({ supplierId, pcsPerCase: 90, supplierCode: 'MK12' })
  })

  it('opens a GRN with expected pieces (billed + free) and no rates; the count is blind', async () => {
    expect(
      (
        await call(app, rep, 'POST', '/procurement/grns', {
          idempotencyKey: `grn-rep-${run}`,
          id: uuidv7(),
          supplierInvoiceId: invoiceId,
          locationId: godown,
        })
      ).status,
    ).toBe(403)
    const res = await call<{ item: Grn }>(app, owner, 'POST', '/procurement/grns', {
      idempotencyKey: `grn-${run}`,
      id: grnId,
      supplierInvoiceId: invoiceId,
      locationId: godown,
    })
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('counting')
    const expected = Object.fromEntries(
      res.body.item.lines.map((l) => [l.variantId, l.expectedQtyPcs]),
    )
    expect(expected).toEqual({ [variantA]: 180, [variantB]: 156 })
    const text = JSON.stringify(res.body)
    expect(text).not.toMatch(/rate|taxable|paise|cost/i)
    // posting before the count is refused
    const early = await call<{ message: string }>(
      app,
      owner,
      'POST',
      `/procurement/grns/${grnId}/post`,
      {
        idempotencyKey: `post-early-${run}`,
      },
    )
    expect(early.status).toBe(400)
  })

  it('lets the manager count: one short line, one with damaged pieces', async () => {
    const before = await call<{ item: Grn }>(app, manager, 'GET', `/procurement/grns/${grnId}`)
    expect(before.status).toBe(200)
    const lineOf = (variantId: string) =>
      before.body.item.lines.find((l) => l.variantId === variantId)?.id ?? ''
    const res = await call<{ item: Grn }>(
      app,
      manager,
      'POST',
      `/procurement/grns/${grnId}/count`,
      {
        idempotencyKey: `count-${run}`,
        lines: [
          { grnLineId: lineOf(variantA), countedQtyPcs: 178 },
          { grnLineId: lineOf(variantB), countedQtyPcs: 154, damagedQtyPcs: 2 },
        ],
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('reconciled')
    expect(res.body.item.discrepancies.map((d) => [d.kind, d.qtyPcs])).toEqual(
      expect.arrayContaining([
        ['short', 2],
        ['damaged', 2],
      ]),
    )
    expect(res.body.item.discrepancies).toHaveLength(2)
  })

  it('posts the GRN once: lots, ledger, balances, per-lot cost, invoice received; replay is a no-op', async () => {
    const post = { idempotencyKey: `post-${run}` }
    const first = await call<{ item: Grn }>(
      app,
      owner,
      'POST',
      `/procurement/grns/${grnId}/post`,
      post,
    )
    expect(first.status).toBe(200)
    expect(first.body.item.status).toBe('posted')
    expect(first.body.item.grnNo).toMatch(/^GRN-\d{4}$/)
    const lotOf = Object.fromEntries(first.body.item.lines.map((l) => [l.variantId, l.lotId ?? '']))
    expect(lotOf[variantA]).toBeTruthy()
    expect(lotOf[variantB]).toBeTruthy()

    const balances = (
      await db.execute(
        sql`select lot_id, location_id, on_hand from stock_balances where tenant_id = ${tenantId}`,
      )
    ).rows as { lot_id: string; location_id: string; on_hand: number }[]
    const bal = (lot: string, loc: string) =>
      balances.find((b) => b.lot_id === lot && b.location_id === loc)?.on_hand
    expect(bal(lotOf[variantA] ?? '', godown)).toBe(178)
    expect(bal(lotOf[variantB] ?? '', godown)).toBe(154)
    expect(bal(lotOf[variantB] ?? '', damagedBin)).toBe(2)

    const ledger = (
      await db.execute(
        sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId} and reason = 'grn'`,
      )
    ).rows as { n: number }[]
    expect(ledger[0]?.n).toBe(3)

    const disc = await call<{ items: { kind: string }[] }>(
      app,
      owner,
      'GET',
      '/procurement/discrepancies',
      {
        grnId,
        kind: 'short',
      },
    )
    expect(disc.body.items).toHaveLength(1)

    // per-lot cost: rate after discount per billed piece, landed spread over billed + free pieces
    const costs = await call<{
      items: { lotId: string | null; purchaseRatePaise: number; landedCostPaise: number }[]
    }>(app, owner, 'GET', '/tenant-catalog/costs', {})
    expect(costs.status).toBe(200)
    const costOf = (lot: string) => costs.body.items.find((c) => c.lotId === lot)
    expect(costOf(lotOf[variantA] ?? '')).toMatchObject({
      purchaseRatePaise: 800,
      landedCostPaise: 800,
    })
    expect(costOf(lotOf[variantB] ?? '')).toMatchObject({
      purchaseRatePaise: 1140,
      landedCostPaise: 1052,
    })
    expect((await call(app, rep, 'GET', '/tenant-catalog/costs', {})).status).toBe(403)
    const repRows = await withTenant(
      db,
      { tenantId, actorId: repId, actorRole: 'salesperson' },
      (tx) => tx.select().from(tenantProductCosts),
    )
    expect(repRows).toHaveLength(0)
    const ownerRows = await withTenant(
      db,
      { tenantId, actorId: ownerId, actorRole: 'owner' },
      (tx) => tx.select().from(tenantProductCosts),
    )
    expect(ownerRows).toHaveLength(2)

    const inv = await call<{ item: { status: string } }>(
      app,
      owner,
      'GET',
      `/procurement/supplier-invoices/${invoiceId}`,
    )
    expect(inv.body.item.status).toBe('received')

    // replay with the same key returns the stored answer; a fresh key on a posted GRN changes nothing either
    const again = await call<{ item: Grn }>(
      app,
      owner,
      'POST',
      `/procurement/grns/${grnId}/post`,
      post,
    )
    expect(again.body).toEqual(first.body)
    const fresh = await call<{ item: Grn }>(app, owner, 'POST', `/procurement/grns/${grnId}/post`, {
      idempotencyKey: `post-again-${run}`,
    })
    expect(fresh.status).toBe(200)
    expect(fresh.body.item.grnNo).toBe(first.body.item.grnNo)
    const after = (
      await db.execute(
        sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId} and reason = 'grn'`,
      )
    ).rows as { n: number }[]
    expect(after[0]?.n).toBe(3)
    const balancesAfter = await call<{ items: Balance[] }>(app, owner, 'GET', '/procurement/grns', {
      status: 'posted',
    })
    expect(balancesAfter.status).toBe(200)
  })

  it('creates and lists a simple purchase order with a server-assigned number', async () => {
    const id = uuidv7()
    const res = await call<{ item: { poNo: string | null; totalPaise: number | null } }>(
      app,
      owner,
      'POST',
      '/procurement/purchase-orders',
      {
        idempotencyKey: `po-${run}`,
        id,
        supplierId,
        lines: [
          { variantId: variantA, qtyPcs: 180, ratePaise: 800 },
          { variantId: variantB, qtyPcs: 144, ratePaise: 1200 },
        ],
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.poNo).toMatch(/^PO-\d{4}$/)
    expect(res.body.item.totalPaise).toBe(180 * 800 + 144 * 1200)
    const list = await call<{ items: { id: string }[] }>(
      app,
      owner,
      'GET',
      '/procurement/purchase-orders',
      {
        supplierId,
      },
    )
    expect(list.body.items.map((p) => p.id)).toContain(id)
    expect((await call(app, rep, 'GET', '/procurement/purchase-orders', {})).status).toBe(403)
  })

  it('refuses requests without tenant context', async () => {
    expect((await call(app, null, 'GET', '/procurement/grns', {})).status).toBe(401)
  })
})
