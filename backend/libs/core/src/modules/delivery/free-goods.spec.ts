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
import { BillingModule } from '../billing/index.js'
import { FilesModule } from '../files/index.js'
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { DeliveryModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

interface OrderLineBody {
  id: string
  lineNo: number
  variantId: string
  variantName: string
  qtyPcs: number
  freeQtyPcs: number
  deliveredQtyPcs: number
  listRatePaise: number
  ratePaise: number
  discountPaise: number
  taxPaise: number
  lineTotalPaise: number
  appliedRules: {
    ruleId: string
    kind: string
    rewardKind?: string
    freeQty?: number
    freeVariantId?: string
  }[]
}
interface OrderBody {
  id: string
  orderNo: string | null
  state: string
  subtotalPaise: number
  roundOffPaise: number
  totalPaise: number
  lines: OrderLineBody[]
}
interface PickLineBody {
  id: string
  orderLineId: string
  variantId: string
  lotId: string | null
  requestedQtyPcs: number
  pickedQtyPcs: number
  freeQtyPcs: number
}
interface PicklistBody {
  id: string
  status: string
  lines: PickLineBody[]
}
interface InvoiceLineBody {
  id: string
  orderLineId: string | null
  variantId: string
  qtyPcs: number
  freeQtyPcs: number
  ratePaise: number
  taxablePaise: number
  gstBps: number
  cessPaise: number
  lineTotalPaise: number
}
interface PackBody {
  invoice: { id: string; invoiceNo: string | null; totalPaise: number } | null
}
interface TripBody {
  id: string
  state: string
  stops: { id: string; retailerId: string }[]
}

/**
 * QA DOS-185: a free-goods scheme that rewards ANOTHER variant ("a bottle free per case") is computed by
 * `priceOrder()` into the triggering line's `applied_rules` — and used to stop there: no line, no
 * reservation, no pick row, no invoice line, nothing at the door. The shop was promised five bottles and
 * got none, on every screen, silently.
 *
 * The chain's own case, scaled to this fixture: 126 pc of Cola 1 L, trigger 24 pcs, one free Cola 750 ml per
 * trigger → floor(126/24) = 5 free bottles, followed hand to hand through the endpoints the apps call.
 */
describeDb('DOS-185 free goods down the chain (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `7${run.slice(-6)}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const driverId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }

  /** Cola 1 L: what the shop buys. Cola 750 ml: what the scheme gives. */
  const soldVariant = uuidv7()
  const freeVariant = uuidv7()
  const schemeId = uuidv7()
  const shopA = uuidv7()
  const shopB = uuidv7()
  const vehicleId = uuidv7()
  let vehicleLocation = ''
  let godown = ''
  let app: NestFastifyApplication

  const RATE_PAISE = 2_850
  const ORDERED_PCS = 126
  const FREE_PCS = 5

  const asOwner = <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
    const ctx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
    return tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  }

  const today = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
  const day = (offset: number): string =>
    new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10)

  const post = <T>(actor: Actor, path: string, body: Record<string, unknown>) =>
    call<T>(app, actor, 'POST', path, body)

  /** One order of 126 pc, submitted (and so confirmed: this shop trips no approval). */
  async function placeOrder(retailerId: string, tag: string): Promise<OrderBody> {
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
    return submitted.body.item
  }

  /** The wave the godown builds, picked at full quantity, then packed and billed. */
  async function pickAndPack(
    orderId: string,
    tag: string,
  ): Promise<{ picklist: PicklistBody; invoiceId: string }> {
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
    return { picklist: picked.body.item, invoiceId: packed.body.invoice?.id ?? '' }
  }

  const invoiceLines = async (invoiceId: string): Promise<InvoiceLineBody[]> => {
    const res = await call<{ item: { lines: InvoiceLineBody[] } }>(
      app,
      manager,
      'GET',
      `/invoices/${invoiceId}`,
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.item.lines
  }

  const orderLines = async (orderId: string): Promise<OrderLineBody[]> => {
    const res = await call<{ item: OrderBody }>(app, manager, 'GET', `/orders/${orderId}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.item.lines
  }

  beforeAll(async () => {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `dos185-${run}`,
      legalName: 'Free Goods Traders',
      stateCode: '27',
    })
    const staff: [string, string, string, Actor['role']][] = [
      [ownerId, '1', 'Owner', 'owner'],
      [managerId, '2', 'Manager', 'manager'],
      [packerId, '3', 'Packer', 'warehouse'],
      [repId, '4', 'Rep', 'salesperson'],
      [driverId, '5', 'Driver', 'delivery'],
    ]
    await db
      .insert(users)
      .values(staff.map(([id, n, name]) => ({ id, phone: `+91971${run}${n}`, name })))
    await db
      .insert(memberships)
      .values(staff.map(([userId, , , role]) => ({ id: uuidv7(), tenantId, userId, role })))
    await bootstrapTenant(db, tenantId)

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker dos185 ${run}` })
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
    // A taxed HSN on purpose: a free line must still come out at zero tax, not at 28% + 12% cess.
    await db.insert(hsnRates).values({
      id: uuidv7(),
      hsnCode: hsn,
      gstBps: 2_800,
      cessBps: 1_200,
      effectiveFrom: '2020-04-01',
    })

    for (const [retailerId, tag] of [
      [shopA, 'A'],
      [shopB, 'B'],
    ] as const) {
      const shopUser = uuidv7()
      const identityId = uuidv7()
      const phone = `+91973${run}${tag === 'A' ? 1 : 2}`
      await db.insert(users).values({ id: shopUser, phone, name: `Shopkeeper ${tag}` })
      await db
        .insert(memberships)
        .values({ id: uuidv7(), tenantId, userId: shopUser, role: 'retailer' })
      await db
        .insert(retailerIdentities)
        .values({ id: identityId, phone, userId: shopUser, shopName: `Free Shop ${tag} ${run}` })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `FG-${tag}-${run}`,
        name: `Free Shop ${tag} ${run}`,
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
      { id: uuidv7(), tenantId, priceListId, variantId: soldVariant, ratePaise: RATE_PAISE },
      { id: uuidv7(), tenantId, priceListId, variantId: freeVariant, ratePaise: 2_200 },
    ])

    // "Cola 750 ml / 1 L — a bottle free per case": 24 pcs of the 1 L buys one free 750 ml.
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
      DeliveryModule,
      WarehouseModule,
      BillingModule,
      OrdersModule,
      InventoryModule,
      ReceivablesModule,
      FilesModule,
      SyncModule,
    ])

    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      for (const [variantId, tag, mrpPaise] of [
        [soldVariant, 'SOLD', 5_000],
        [freeVariant, 'FREE', 4_000],
      ] as const) {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId,
          batchNo: `FG-${tag}-${run}`,
          mrpPaise,
          expiryDate: '2028-01-31',
        })
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: 1_000,
            reason: 'opening',
            idempotencyKey: `open-dos185-${tag}-${run}`,
          },
        ])
      }
    })

    const vehicle = await post<{ item: { locationId: string } }>(owner, '/delivery/vehicles', {
      idempotencyKey: `vehicle-dos185-${run}`,
      id: vehicleId,
      regNo: `MH-05-FG-${run.slice(-4)}`,
      name: 'Tempo DOS-185',
      kind: 'tempo',
      capacityCases: 200,
    })
    expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(200)
    vehicleLocation = vehicle.body.item.locationId
    const consent = await post(driver, '/delivery/consents', {
      idempotencyKey: `consent-dos185-${run}`,
      id: uuidv7(),
      granted: true,
      noticeVersion: 'gps-2026-09',
    })
    expect(consent.status, JSON.stringify(consent.body)).toBe(200)
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  let orderA: OrderBody
  let freeLineIdA = ''
  let invoiceA = ''
  let picklistA: PicklistBody

  it('hop 1 — the free bottles are a line on the order, at zero, pointing at the scheme', async () => {
    orderA = await placeOrder(shopA, 'a')
    const lines = orderA.lines
    const sold = lines.find((l) => l.variantId === soldVariant)
    const free = lines.find((l) => l.variantId === freeVariant)
    expect(sold?.qtyPcs).toBe(ORDERED_PCS)
    // THE FINDING: the engine's reward is on the order as goods, not only as a note in applied_rules.
    expect(
      free,
      `the order has no line for the free variant: ${JSON.stringify(lines)}`,
    ).toBeDefined()
    freeLineIdA = free?.id ?? ''
    expect(free?.freeQtyPcs).toBe(FREE_PCS)
    expect(free?.qtyPcs).toBe(0)
    expect(free?.ratePaise).toBe(0)
    expect(free?.discountPaise).toBe(0)
    // A gift is not taxed and not charged: the shop's total is the sold line alone.
    expect(free?.taxPaise).toBe(0)
    expect(free?.lineTotalPaise).toBe(0)
    // the gift adds nothing to what the shop pays: the sold line, rounded to the rupee, IS the order
    expect(orderA.totalPaise).toBe((sold?.lineTotalPaise ?? 0) + orderA.roundOffPaise)
    const rule = free?.appliedRules.find((r) => r.ruleId === schemeId)
    expect(rule?.kind).toBe('scheme')
    expect(rule?.rewardKind).toBe('free_qty')
    expect(rule?.freeQty).toBe(FREE_PCS)
    expect(rule?.freeVariantId).toBe(freeVariant)
  })

  it('hop 1b — editing the draft from a device never turns the gift into a sale', async () => {
    /*
     * The offline path re-lines the WHOLE order from what is stored (`applyLineSync`), so a reward line
     * read back as a line the rep typed would be sold to the shop at the price list — the opposite of
     * the bug, and worse. The draft keeps one reward line, priced at nothing.
     */
    const draftId = uuidv7()
    const created = await post<{ item: OrderBody }>(rep, '/orders', {
      idempotencyKey: `order-draft-${run}`,
      id: draftId,
      retailerId: shopA,
      source: 'salesperson',
      lines: [
        { id: uuidv7(), variantId: soldVariant, enteredQty: ORDERED_PCS, enteredUnit: 'piece' },
      ],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const uploaded = await post<{ accepted: number; rejected: { code: string }[] }>(
      rep,
      '/sync/upload',
      {
        protocol: 1,
        deviceId: `device-dos185-${run}`,
        ops: [
          {
            opId: `line-${run}`,
            op: 'PUT',
            table: 'sales_order_lines',
            id: uuidv7(),
            data: {
              order_id: draftId,
              variant_id: freeVariant,
              entered_qty: 1,
              entered_unit: 'case',
            },
          },
        ],
      },
    )
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200)
    expect(uploaded.body.rejected).toEqual([])
    const lines = await orderLines(draftId)
    const rewards = lines.filter((l) => l.qtyPcs === 0 && l.freeQtyPcs > 0)
    expect(rewards).toHaveLength(1)
    expect(rewards[0]?.variantId).toBe(freeVariant)
    expect(rewards[0]?.freeQtyPcs).toBe(FREE_PCS)
    // the case the rep really typed IS sold; the gift beside it is not
    const sold = lines.filter((l) => l.variantId === freeVariant && l.qtyPcs > 0)
    expect(sold).toHaveLength(1)
    expect(sold[0]?.qtyPcs).toBe(24)
    expect(lines).toHaveLength(3)
  })

  it('hop 2 — confirm holds the free bottles in the godown too', async () => {
    const held = (
      await db.execute(
        sql`select coalesce(sum(r.qty), 0)::int as pcs
              from reservations r
              join sales_order_lines l on l.id = r.order_line_id
             where l.order_id = ${orderA.id} and l.variant_id = ${freeVariant}
               and r.state = 'pending'`,
      )
    ).rows[0] as { pcs: number }
    expect(held.pcs).toBe(FREE_PCS)
  })

  it('hop 3 — the picker is asked for the free bottles, FEFO, like any other line', async () => {
    const out = await pickAndPack(orderA.id, 'a')
    picklistA = out.picklist
    invoiceA = out.invoiceId
    const freeRows = picklistA.lines.filter((l) => l.variantId === freeVariant)
    expect(freeRows.length).toBeGreaterThan(0)
    expect(freeRows.reduce((n, l) => n + l.requestedQtyPcs, 0)).toBe(FREE_PCS)
    expect(freeRows.reduce((n, l) => n + l.freeQtyPcs, 0)).toBe(FREE_PCS)
    expect(freeRows.every((l) => l.lotId !== null)).toBe(true)
    expect(
      picklistA.lines.reduce((n, l) => n + l.requestedQtyPcs, 0),
      'the sheet asks for the sold pieces AND the free ones',
    ).toBe(ORDERED_PCS + FREE_PCS)
  })

  it('hop 4 — the bill carries the free bottles at ₹0, with no tax invented on a gift', async () => {
    const lines = await invoiceLines(invoiceA)
    const free = lines.filter((l) => l.variantId === freeVariant)
    expect(free.length).toBeGreaterThan(0)
    expect(free.reduce((n, l) => n + l.freeQtyPcs, 0)).toBe(FREE_PCS)
    for (const line of free) {
      expect(line.qtyPcs).toBe(0)
      expect(line.ratePaise).toBe(0)
      expect(line.taxablePaise).toBe(0)
      expect(line.cessPaise).toBe(0)
      expect(line.lineTotalPaise).toBe(0)
      // the item's own dated HSN rate is still on the line; it simply has nothing to act on
      expect(line.gstBps).toBe(2_800)
    }
    const sold = lines.filter((l) => l.variantId === soldVariant)
    const total = [...sold, ...free].reduce((n, l) => n + l.lineTotalPaise, 0)
    expect(total).toBe(sold.reduce((n, l) => n + l.lineTotalPaise, 0))
  })

  let tripId = ''
  let stopA = ''
  let stopB = ''
  let orderB: OrderBody
  let invoiceB = ''

  it('hop 5 — the crew hands the free bottles over, and the order says they were delivered', async () => {
    orderB = await placeOrder(shopB, 'b')
    const packedB = await pickAndPack(orderB.id, 'b')
    invoiceB = packedB.invoiceId

    tripId = uuidv7()
    stopA = uuidv7()
    stopB = uuidv7()
    const planned = await post<{ item: TripBody }>(manager, '/delivery/trips', {
      idempotencyKey: `trip-dos185-${run}`,
      id: tripId,
      tripDate: today(),
      vehicleId,
      driverId,
      openingCashPaise: 0,
      stops: [
        { id: stopA, sequence: 1, retailerId: shopA, invoiceIds: [invoiceA] },
        { id: stopB, sequence: 2, retailerId: shopB, invoiceIds: [invoiceB] },
      ],
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    const loading = await post(packer, `/delivery/trips/${tripId}/start-loading`, {
      idempotencyKey: `loading-dos185-${run}`,
    })
    expect(loading.status, JSON.stringify(loading.body)).toBe(200)
    const sheet = await post<{ item: { id: string } }>(packer, '/warehouse/load-sheets', {
      idempotencyKey: `sheet-dos185-${run}`,
      id: uuidv7(),
      toLocationId: vehicleLocation,
      tripId,
      orderIds: [orderA.id, orderB.id],
    })
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(200)
    const approved = await post(manager, `/warehouse/load-sheets/${sheet.body.item.id}/approve`, {
      idempotencyKey: `approve-dos185-${run}`,
    })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    const checkedOut = await post(packer, `/warehouse/load-sheets/${sheet.body.item.id}/confirm`, {
      idempotencyKey: `checkout-dos185-${run}`,
      countedPackages: 2,
      challanId: uuidv7(),
    })
    expect(checkedOut.status, JSON.stringify(checkedOut.body)).toBe(200)
    const departed = await post(driver, `/delivery/trips/${tripId}/depart`, {
      idempotencyKey: `depart-dos185-${run}`,
      startOdometerKm: 1_000,
    })
    expect(departed.status, JSON.stringify(departed.body)).toBe(200)

    for (const step of ['start', 'arrive'] as const) {
      const res = await post(driver, `/delivery/stops/${stopA}/${step}`, {
        idempotencyKey: `${step}-a-dos185-${run}`,
        ...(step === 'arrive' ? { lat: 19.2437, lng: 73.1355 } : {}),
      })
      expect(res.status, `${step} → ${JSON.stringify(res.body)}`).toBe(200)
    }
    const billed = await invoiceLines(invoiceA)
    const delivered = await post<{ item: { outcome: string; shortPcs: number } }>(
      driver,
      '/delivery/deliveries',
      {
        idempotencyKey: `deliver-a-dos185-${run}`,
        id: uuidv7(),
        tripId,
        stopId: stopA,
        invoiceId: invoiceA,
        receiverName: 'Owner A',
        lines: billed.map((l) => ({
          id: uuidv7(),
          invoiceLineId: l.id,
          deliveredQtyPcs: l.qtyPcs + l.freeQtyPcs,
          returnedQtyPcs: 0,
        })),
        pod: [
          {
            id: uuidv7(),
            kind: 'signature',
            inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
          },
        ],
      },
    )
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200)
    expect(delivered.body.item.outcome).toBe('delivered')
    const free = (await orderLines(orderA.id)).find((l) => l.id === freeLineIdA)
    expect(free?.deliveredQtyPcs).toBe(FREE_PCS)
  })

  it('hop 5b — free bottles left on the van are credited as goods, never as money', async () => {
    for (const step of ['start', 'arrive'] as const) {
      const res = await post(driver, `/delivery/stops/${stopB}/${step}`, {
        idempotencyKey: `${step}-b-dos185-${run}`,
        ...(step === 'arrive' ? { lat: 19.2437, lng: 73.1355 } : {}),
      })
      expect(res.status, `${step} → ${JSON.stringify(res.body)}`).toBe(200)
    }
    const billed = await invoiceLines(invoiceB)
    const res = await post<{
      item: { outcome: string; shortPcs: number }
      creditNoteId: string | null
    }>(driver, '/delivery/deliveries', {
      idempotencyKey: `deliver-b-dos185-${run}`,
      id: uuidv7(),
      tripId,
      stopId: stopB,
      invoiceId: invoiceB,
      receiverName: 'Owner B',
      lines: billed.map((l) => ({
        id: uuidv7(),
        invoiceLineId: l.id,
        // only the free bottles come back
        deliveredQtyPcs: l.variantId === freeVariant ? 0 : l.qtyPcs + l.freeQtyPcs,
        returnedQtyPcs: l.variantId === freeVariant ? l.qtyPcs + l.freeQtyPcs : 0,
        ...(l.variantId === freeVariant
          ? { returnedSaleable: true, reason: 'refused' as const }
          : {}),
      })),
      pod: [
        { id: uuidv7(), kind: 'photo', inline: { mimeType: 'image/png', contentBase64: TINY_PNG } },
      ],
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.item.shortPcs).toBe(FREE_PCS)
    expect(res.body.creditNoteId).not.toBeNull()
    const note = (
      await db.execute(
        sql`select taxable_paise, total_paise from credit_notes where id = ${res.body.creditNoteId ?? ''}`,
      )
    ).rows[0] as { taxable_paise: number; total_paise: number }
    // the shop paid nothing for them, so nothing is refunded: the note moves goods, not rupees
    expect(Number(note.taxable_paise)).toBe(0)
    expect(Number(note.total_paise)).toBe(0)
  })
})
