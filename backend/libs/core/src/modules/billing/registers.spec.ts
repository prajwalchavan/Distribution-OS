import { sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  hsnRates,
  locations,
  manufacturers,
  memberships,
  priceListItems,
  priceLists,
  products,
  productVariants,
  retailerIdentities,
  retailerLinks,
  retailers,
  schemes,
  tenantProducts,
  tenants,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { BillingModule } from './index.js'
import { RegistersService } from './registers.service.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface OrderBody {
  id: string
  state: string
  lines: { id: string; variantId: string; qtyPcs: number; freeQtyPcs: number }[]
}
interface PicklistBody {
  id: string
  lines: { id: string; orderLineId: string; lotId: string | null; requestedQtyPcs: number }[]
}
interface PackBody {
  invoice: { id: string } | null
}

/**
 * QA DOS-185, second surface: the scheme-spend register ("what did this scheme cost me") sums `freeQty`
 * over `invoice_lines.applied_rules`. With the gift now a real line of the bill, that line must point back
 * to the rule WITHOUT repeating the quantity the trigger line already carries — or every cross-variant
 * free-goods scheme reports double. Two bills of 126 pc (5 free bottles each) must read as 10, not 20.
 *
 * Driven through the real chain (order → confirm → pick → pack) so the bill's rules are what the engine
 * writes, not what a fixture pretends.
 */
describeDb('DOS-185 scheme-spend register counts a gift once (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `7${run.slice(-6)}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()

  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }

  const soldVariant = uuidv7()
  const freeVariant = uuidv7()
  const schemeId = uuidv7()
  const shopA = uuidv7()
  const shopB = uuidv7()
  let godown = ''
  let app: NestFastifyApplication

  const ORDERED_PCS = 126
  const FREE_PCS = 5

  const asRole = <T>(role: Actor['role'], actorId: string, fn: (tx: Db) => Promise<T>) => {
    const ctx: TenantContext = { tenantId, actorId, actorRole: role }
    return tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  }

  const today = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
  const day = (offset: number): string =>
    new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10)

  const post = <T>(actor: Actor, path: string, body: Record<string, unknown>) =>
    call<T>(app, actor, 'POST', path, body)

  /** One order of 126 pc, submitted (and so confirmed), picked in full and packed into a bill. */
  async function orderAndBill(retailerId: string, tag: string): Promise<string> {
    const orderId = uuidv7()
    const created = await post<{ item: OrderBody }>(rep, '/orders', {
      idempotencyKey: `order-${tag}-${run}`,
      id: orderId,
      retailerId,
      source: 'salesperson',
      lines: [
        { id: uuidv7(), variantId: soldVariant, enteredQty: ORDERED_PCS, enteredUnit: 'piece' },
      ],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const submitted = await post<{ item: OrderBody }>(rep, `/orders/${orderId}/submit`, {
      idempotencyKey: `submit-${tag}-${run}`,
    })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    expect(submitted.body.item.state).toBe('confirmed')
    const reward = submitted.body.item.lines.find((l) => l.variantId === freeVariant)
    expect(reward?.freeQtyPcs, 'the gift is a line of the order').toBe(FREE_PCS)

    const picklistId = uuidv7()
    const wave = await post<{ item: PicklistBody }>(packer, '/warehouse/picklists', {
      idempotencyKey: `wave-${tag}-${run}`,
      id: picklistId,
      orderIds: [orderId],
    })
    expect(wave.status, JSON.stringify(wave.body)).toBe(200)
    const started = await post<{ item: PicklistBody }>(
      packer,
      `/warehouse/picklists/${picklistId}/start`,
      { idempotencyKey: `start-${tag}-${run}`, assignedTo: packerId },
    )
    expect(started.status, JSON.stringify(started.body)).toBe(200)
    const picked = await post<{ item: PicklistBody }>(
      packer,
      `/warehouse/picklists/${picklistId}/pick`,
      {
        idempotencyKey: `pick-${tag}-${run}`,
        lines: started.body.item.lines.map((l) => ({
          id: l.id,
          orderLineId: l.orderLineId,
          lotId: l.lotId,
          pickedQtyPcs: l.requestedQtyPcs,
        })),
      },
    )
    expect(picked.status, JSON.stringify(picked.body)).toBe(200)
    const packed = await post<PackBody>(packer, `/warehouse/orders/${orderId}/pack`, {
      idempotencyKey: `pack-${tag}-${run}`,
      id: uuidv7(),
      packages: 1,
    })
    expect(packed.status, JSON.stringify(packed.body)).toBe(200)
    const invoiceId = packed.body.invoice?.id ?? ''
    expect(invoiceId).not.toBe('')
    return invoiceId
  }

  beforeAll(async () => {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `dos185r-${run}`,
      legalName: 'Scheme Spend Traders',
      stateCode: '27',
    })
    const staff: [string, string, string, Actor['role']][] = [
      [ownerId, '1', 'Owner', 'owner'],
      [managerId, '2', 'Manager', 'manager'],
      [packerId, '3', 'Packer', 'warehouse'],
      [repId, '4', 'Rep', 'salesperson'],
    ]
    await db
      .insert(users)
      .values(staff.map(([id, n, name]) => ({ id, phone: `+91974${run}${n}`, name })))
    await db
      .insert(memberships)
      .values(staff.map(([userId, , , role]) => ({ id: uuidv7(), tenantId, userId, role })))
    await bootstrapTenant(db, tenantId)

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker dos185r ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Cola', category: 'beverages' })
    await db.insert(productVariants).values([
      {
        id: soldVariant,
        productId,
        name: 'Cola 1 L',
        netQty: 1000,
        netUnit: 'ml',
        defaultCaseSize: 24,
        hsnCode: hsn,
        mrpPaise: 5_000,
      },
      {
        id: freeVariant,
        productId,
        name: 'Cola 750 ml',
        netQty: 750,
        netUnit: 'ml',
        defaultCaseSize: 24,
        hsnCode: hsn,
        mrpPaise: 4_000,
      },
    ])
    await db.insert(tenantProducts).values([
      { id: uuidv7(), tenantId, variantId: soldVariant, caseSizeOverride: 24 },
      { id: uuidv7(), tenantId, variantId: freeVariant, caseSizeOverride: 24 },
    ])
    await db.insert(hsnRates).values({
      id: uuidv7(),
      hsnCode: hsn,
      gstBps: 1_200,
      cessBps: 0,
      effectiveFrom: '2020-04-01',
    })

    for (const [retailerId, tag] of [
      [shopA, 'A'],
      [shopB, 'B'],
    ] as const) {
      const shopUser = uuidv7()
      const identityId = uuidv7()
      const phone = `+91975${run}${tag === 'A' ? 1 : 2}`
      await db.insert(users).values({ id: shopUser, phone, name: `Shopkeeper ${tag}` })
      await db
        .insert(memberships)
        .values({ id: uuidv7(), tenantId, userId: shopUser, role: 'retailer' })
      await db
        .insert(retailerIdentities)
        .values({ id: identityId, phone, userId: shopUser, shopName: `Spend Shop ${tag} ${run}` })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `SS-${tag}-${run}`,
        name: `Spend Shop ${tag} ${run}`,
        ownerName: `Owner ${tag}`,
        phone,
        stateCode: '27',
        gstRegType: 'regular',
        gstin: '27AAXPT9021Q1ZQ',
        creditDays: 15,
        lat: 19.2437,
        lng: 73.1355,
      })
      await db.insert(retailerLinks).values({
        id: uuidv7(),
        tenantId,
        identityId,
        retailerId,
        userId: shopUser,
        linkedBy: 'rep_onboarding',
        status: 'active',
      })
    }

    const priceListId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    await db.insert(priceListItems).values([
      { id: uuidv7(), tenantId, priceListId, variantId: soldVariant, ratePaise: 2_850 },
      { id: uuidv7(), tenantId, priceListId, variantId: freeVariant, ratePaise: 2_200 },
    ])

    // "a bottle free per case": 24 pcs of the 1 L buys one free 750 ml → 126 pc earns 5
    await db.insert(schemes).values({
      id: schemeId,
      tenantId,
      name: `A bottle free per case ${run}`,
      scope: { variantIds: [soldVariant] },
      triggerKind: 'qty',
      triggerMin: 24,
      triggerUnit: 'pcs',
      rewardKind: 'free_qty',
      rewardValue: 1,
      freeVariantId: freeVariant,
      applicability: {},
      validFrom: day(-30),
      validTo: day(30),
      stackable: true,
      final: false,
      fundingSource: 'company',
      claimable: true,
      active: true,
    })

    godown =
      (
        await db
          .select()
          .from(locations)
          .where(sql`${locations.tenantId} = ${tenantId}`)
      ).find((l) => l.kind === 'warehouse')?.id ?? ''

    app = await bootTestApp([
      WarehouseModule,
      BillingModule,
      OrdersModule,
      InventoryModule,
      ReceivablesModule,
    ])

    const inventory = app.get(InventoryService)
    await asRole('owner', ownerId, async (tx) => {
      for (const [variantId, tag, mrpPaise] of [
        [soldVariant, 'SOLD', 5_000],
        [freeVariant, 'FREE', 4_000],
      ] as const) {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId,
          batchNo: `SS-${tag}-${run}`,
          mrpPaise,
          expiryDate: '2028-01-31',
        })
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: 1_000,
            reason: 'opening',
            idempotencyKey: `open-dos185r-${tag}-${run}`,
          },
        ])
      }
    })
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  it('reports the free pieces the two bills actually carry — 10, not 20', async () => {
    const invoiceA = await orderAndBill(shopA, 'a')
    const invoiceB = await orderAndBill(shopB, 'b')

    // what was really given away: the gift lines of the two bills, straight from the table
    const billed = (
      await db.execute(
        sql`select coalesce(sum(free_qty_pcs), 0)::int as pcs
              from invoice_lines
             where invoice_id in (${invoiceA}, ${invoiceB}) and qty_pcs = 0 and free_qty_pcs > 0`,
      )
    ).rows[0] as { pcs: number }
    expect(billed.pcs).toBe(2 * FREE_PCS)

    const registers = app.get(RegistersService)
    const rows = await asRole('manager', managerId, (tx) =>
      registers.schemeSpend(tx, { from: day(-1), to: today() }),
    )
    const spend = rows.find((r) => r.ruleId === schemeId)
    expect(spend, JSON.stringify(rows)).toBeDefined()
    expect(spend?.kind).toBe('scheme')
    expect(spend?.documentCount).toBe(2)
    // THE FINDING: the register must say what the bills say. A reward line that repeats the trigger's
    // freeQty made this 20 — the distributor would have "spent" twice the bottles it gave.
    expect(spend?.freeQtyPcs).toBe(billed.pcs)
    expect(spend?.amountPaise).toBe(0)
  })
})
