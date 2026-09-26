import { eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  featureFlags,
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
  tenantProductCosts,
  tenantProducts,
  tenants,
  tenantSettings,
  TENANT_SETTING_KEYS,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { loadOut } from '../../testing/load-out.js'
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
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

interface StopBody {
  id: string
  state: string
}
interface TripBody {
  id: string
  tripNo: string | null
  state: string
  vehicleLocationId: string
  stops: StopBody[]
}
interface ApprovalRowBody {
  id: string
  kind: string
  status: string
  entityId: string
  tripSettlement?: {
    tripNo: string | null
    vehicleRegNo: string | null
    expectedCashPaise: number
    handedOverCashPaise: number
    cashVariancePaise: number
    tolerancePaise: number
    cashCollectedPaise: number | null
    stockVariance: {
      lotId: string
      variantName: string
      batchNo: string | null
      expectedPcs: number
      countedPcs: number
      deltaPcs: number
      valuePaise: number | null
    }[]
    stockVarianceValuePaise: number | null
  } | null
}

/**
 * The four hand-offs the business simulation's day 3 found broken (QA DOS-232 … DOS-235), each driven the
 * way the apps drive it, over HTTP, on real bills: a two-bill stop, a van-sales trip whose van also carries
 * another shop's bill, a van whose balance history is mostly zeros, and a settlement the owner approves.
 */
describeDb('delivery road fixes, day 3 (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `6${run}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const driverIds = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()]
  const shopUserA = uuidv7()
  const shopUserB = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driverAt = (i: number): Actor => ({
    tenantId,
    actorId: driverIds[i] ?? '',
    role: 'delivery',
  })

  const ctxOf = (actorId: string, actorRole: TenantContext['actorRole']): TenantContext => ({
    tenantId,
    actorId,
    actorRole,
  })
  const asOwner = <T>(fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctxOf(ownerId, 'owner'), () => withTenant(db, ctxOf(ownerId, 'owner'), fn))

  const retailerA = uuidv7()
  const retailerB = uuidv7()
  const variantA = uuidv7()
  let godown = ''
  let lotA = ''
  let app: NestFastifyApplication
  const today = new Date().toISOString().slice(0, 10)

  const orderState = async (orderId: string): Promise<string> =>
    (
      (await db.execute(sql`select state::text as state from sales_orders where id = ${orderId}`))
        .rows[0] as { state: string }
    ).state

  /** An order confirmed and packed through the real aggregate: a real bill of one case (12 pieces). */
  async function billedOrder(
    retailerId: string,
    tag: string,
  ): Promise<{ orderId: string; invoiceId: string; totalPaise: number; lineId: string }> {
    const orderId = uuidv7()
    const created = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `rf-order-${tag}-${run}`,
      id: orderId,
      retailerId,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'case' }],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const submitted = await call(app, rep, 'POST', `/orders/${orderId}/submit`, {
      idempotencyKey: `rf-submit-${tag}-${run}`,
    })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    const packed = await call<{ invoice: { id: string } | null }>(
      app,
      packer,
      'POST',
      `/warehouse/orders/${orderId}/pack`,
      { idempotencyKey: `rf-pack-${tag}-${run}`, id: uuidv7(), packages: 1 },
    )
    expect(packed.status, JSON.stringify(packed.body)).toBe(200)
    const invoiceId = packed.body.invoice?.id ?? ''
    const bill = await call<{ item: { lines: { id: string }[]; totalPaise: number } }>(
      app,
      manager,
      'GET',
      `/invoices/${invoiceId}`,
    )
    expect(bill.status).toBe(200)
    return {
      orderId,
      invoiceId,
      totalPaise: bill.body.item.totalPaise,
      lineId: bill.body.item.lines[0]?.id ?? '',
    }
  }

  /** A vehicle, the driver's consent, a van-sales trip with these stops, loaded and departed. */
  async function roadTrip(
    tag: string,
    driver: Actor,
    stops: { retailerId: string; bills: { orderId: string; invoiceId: string }[] }[],
    vanStock: { lotId: string; qtyPcs: number }[] = [],
  ): Promise<{ tripId: string; stopIds: string[]; vehicleLocationId: string; tripNo: string }> {
    const vehicleId = uuidv7()
    const tripId = uuidv7()
    const vehicle = await call(app, owner, 'POST', '/delivery/vehicles', {
      idempotencyKey: `rf-vehicle-${tag}-${run}`,
      id: vehicleId,
      regNo: `MH-05-R${tag}-${run.slice(-4)}`,
      name: `Loader ${tag}`,
      kind: 'tempo',
      capacityCases: 120,
    })
    expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(200)
    const consent = await call(app, driver, 'POST', '/delivery/consents', {
      idempotencyKey: `rf-consent-${tag}-${run}`,
      id: uuidv7(),
      granted: true,
      noticeVersion: 'gps-2026-09',
    })
    expect(consent.status, JSON.stringify(consent.body)).toBe(200)
    const stopIds = stops.map(() => uuidv7())
    const planned = await call(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `rf-trip-${tag}-${run}`,
      id: tripId,
      tripDate: today,
      vehicleId,
      driverId: driver.actorId,
      vanSalesEnabled: true,
      openingCashPaise: 0,
      stops: stops.map((stop, i) => ({
        id: stopIds[i],
        sequence: i + 1,
        retailerId: stop.retailerId,
        invoiceIds: stop.bills.map((b) => b.invoiceId),
      })),
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    const loading = await call(app, manager, 'POST', `/delivery/trips/${tripId}/start-loading`, {
      idempotencyKey: `rf-loading-${tag}-${run}`,
    })
    expect(loading.status, JSON.stringify(loading.body)).toBe(200)
    await loadOut(
      app,
      { godown: manager },
      {
        tripId,
        orderIds: stops.flatMap((s) => s.bills.map((b) => b.orderId)),
        vanStock,
        tag: `rf-${tag}-${run}`,
      },
    )
    const departed = await call<{ item: TripBody }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripId}/depart`,
      { idempotencyKey: `rf-depart-${tag}-${run}`, startOdometerKm: 1_000 },
    )
    expect(departed.status, JSON.stringify(departed.body)).toBe(200)
    expect(departed.body.item.state).toBe('active')
    return {
      tripId,
      stopIds,
      vehicleLocationId: departed.body.item.vehicleLocationId,
      tripNo: departed.body.item.tripNo ?? '',
    }
  }

  const arrive = async (driver: Actor, stopId: string, tag: string): Promise<void> => {
    const arrived = await call(app, driver, 'POST', `/delivery/stops/${stopId}/arrive`, {
      idempotencyKey: `rf-arrive-${tag}-${run}`,
    })
    expect(arrived.status, JSON.stringify(arrived.body)).toBe(200)
  }

  /** The doorstep write D4 sends: every piece handed over, a signature as proof. */
  const deliverAll = (
    driver: Actor,
    tripId: string,
    stopId: string,
    bill: { invoiceId: string; lineId: string },
    tag: string,
  ) =>
    call<{ item: { outcome: string }; stop: StopBody }>(
      app,
      driver,
      'POST',
      '/delivery/deliveries',
      {
        idempotencyKey: `rf-deliver-${tag}-${run}`,
        id: uuidv7(),
        tripId,
        stopId,
        invoiceId: bill.invoiceId,
        lines: [
          { id: uuidv7(), invoiceLineId: bill.lineId, deliveredQtyPcs: 12, returnedQtyPcs: 0 },
        ],
        pod: [
          {
            id: uuidv7(),
            kind: 'signature',
            inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
          },
        ],
      },
    )

  const stopState = async (driver: Actor, tripId: string, stopId: string): Promise<string> => {
    const trip = await call<{ item: TripBody }>(app, driver, 'GET', `/delivery/trips/${tripId}`)
    expect(trip.status).toBe(200)
    return trip.body.item.stops.find((s) => s.id === stopId)?.state ?? ''
  }

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `rf-${run}`, legalName: 'Road Fix Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91961${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91961${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91961${run}3`, name: 'Accountant' },
      { id: packerId, phone: `+91961${run}4`, name: 'Packer' },
      { id: repId, phone: `+91961${run}5`, name: 'Rep' },
      ...driverIds.map((id, i) => ({
        id,
        phone: `+91962${run}${String(i)}`,
        name: `Driver ${String(i + 1)}`,
      })),
      { id: shopUserA, phone: `+91963${run}1`, name: 'Shopkeeper A' },
      { id: shopUserB, phone: `+91963${run}2`, name: 'Shopkeeper B' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      ...driverIds.map((userId) => ({
        id: uuidv7(),
        tenantId,
        userId,
        role: 'delivery' as const,
      })),
      { id: uuidv7(), tenantId, userId: shopUserA, role: 'retailer' },
      { id: uuidv7(), tenantId, userId: shopUserB, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    await db
      .insert(tenantSettings)
      .values({
        tenantId,
        key: TENANT_SETTING_KEYS.brandingDisplayName,
        value: 'Road Fix Traders',
      })
      .onConflictDoNothing()
    await db
      .insert(featureFlags)
      .values({ tenantId, flag: 'van_sales', enabled: true })
      .onConflictDoUpdate({
        target: [featureFlags.tenantId, featureFlags.flag],
        set: { enabled: true },
      })

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker rf ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Biscuit', category: 'biscuits' })
    await db.insert(productVariants).values({
      id: variantA,
      productId,
      name: 'Bourbon 100 g',
      netQty: 100,
      netUnit: 'g',
      defaultCaseSize: 12,
      hsnCode: hsn,
      mrpPaise: 1000,
    })
    await db
      .insert(tenantProducts)
      .values({ id: uuidv7(), tenantId, variantId: variantA, caseSizeOverride: 12 })
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1800, cessBps: 0, effectiveFrom: '2020-04-01' })

    const shops: [string, string, string, string][] = [
      [retailerA, shopUserA, 'A', '27AAXPT9021Q1ZQ'],
      [retailerB, shopUserB, 'B', '27AABCU9603R1ZX'],
    ]
    for (const [retailerId, userId, tag, gstin] of shops) {
      const identityId = uuidv7()
      const phone = `+91964${run}${tag === 'A' ? '1' : '2'}`
      await db
        .insert(retailerIdentities)
        .values({ id: identityId, phone, userId, shopName: `Road Shop ${tag} ${run}` })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `RF-${tag}-${run}`,
        name: `Road Shop ${tag} ${run}`,
        ownerName: `Owner ${tag}`,
        phone,
        stateCode: '27',
        gstRegType: 'regular',
        gstin,
        creditDays: 15,
        lat: 19.2437,
        lng: 73.1355,
      })
      await db.insert(retailerLinks).values({
        id: uuidv7(),
        tenantId,
        identityId,
        retailerId,
        userId,
        linkedBy: 'rep_onboarding',
        status: 'active',
      })
    }
    const priceListId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    await db
      .insert(priceListItems)
      .values({ id: uuidv7(), tenantId, priceListId, variantId: variantA, ratePaise: 1000 })

    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''

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
      const a = await inventory.findOrCreateLot(tx, {
        variantId: variantA,
        batchNo: `RF-${run}`,
        mrpPaise: 1000,
        expiryDate: '2028-01-31',
      })
      lotA = a.lot.id
      await inventory.post(tx, [
        {
          lotId: lotA,
          locationId: godown,
          qtyDelta: 1_000,
          reason: 'opening',
          idempotencyKey: `rf-open-${run}`,
        },
      ])
    })
    // What THIS batch cost at its GRN: ₹7.50 a piece, landed.
    await db.insert(tenantProductCosts).values({
      id: uuidv7(),
      tenantId,
      variantId: variantA,
      lotId: lotA,
      purchaseRatePaise: 700,
      landedCostPaise: 750,
    })
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await db.delete(hsnRates).where(eq(hsnRates.hsnCode, hsn))
    await pool.end()
  })

  // -------------------------------------------------------------------------------------------------------------
  // DOS-232

  it('DOS-232 a stop with two bills stays open after the first and ends when the second is recorded', async () => {
    const driver = driverAt(0)
    const bill1 = await billedOrder(retailerA, '232a-1')
    const bill2 = await billedOrder(retailerA, '232a-2')
    const { tripId, stopIds } = await roadTrip('232a', driver, [
      { retailerId: retailerA, bills: [bill1, bill2] },
    ])
    const stopId = stopIds[0] ?? ''
    await arrive(driver, stopId, '232a')

    const first = await deliverAll(driver, tripId, stopId, bill1, '232a-1')
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.item.outcome).toBe('delivered')
    // the second bill is still on the van: the stop is not delivered yet
    expect(first.body.stop.state).toBe('arrived')
    // and the trip the check-in reads agrees: nothing at this shop is finished yet
    expect(await stopState(driver, tripId, stopId)).toBe('arrived')

    const second = await deliverAll(driver, tripId, stopId, bill2, '232a-2')
    expect(second.status, JSON.stringify(second.body)).toBe(200)
    expect(second.body.item.outcome).toBe('delivered')
    expect(second.body.stop.state).toBe('delivered')
    expect(await orderState(bill1.orderId)).toBe('delivered')
    expect(await orderState(bill2.orderId)).toBe('delivered')

    // a third attempt at an already-delivered bill is still refused by name
    const again = await deliverAll(driver, tripId, stopId, bill2, '232a-2-again')
    expect(again.status).toBe(409)
  }, 180_000)

  it('DOS-232 a van that returns with the second bill undelivered: that bill fails, the stop is partial, the desk sees it', async () => {
    const driver = driverAt(1)
    const bill1 = await billedOrder(retailerA, '232b-1')
    const bill2 = await billedOrder(retailerA, '232b-2')
    const { tripId, stopIds } = await roadTrip('232b', driver, [
      { retailerId: retailerA, bills: [bill1, bill2] },
    ])
    const stopId = stopIds[0] ?? ''
    await arrive(driver, stopId, '232b')
    const first = await deliverAll(driver, tripId, stopId, bill1, '232b-1')
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.stop.state).toBe('arrived')

    const returned = await call<{ item: TripBody }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripId}/return`,
      { idempotencyKey: `rf-return-232b-${run}` },
    )
    expect(returned.status, JSON.stringify(returned.body)).toBe(200)
    expect(returned.body.item.stops.find((s) => s.id === stopId)?.state).toBe('partial')
    expect(await orderState(bill1.orderId)).toBe('delivered')
    expect(await orderState(bill2.orderId)).toBe('packed')
    const rows = (
      await db.execute(
        sql`select invoice_id, outcome::text as outcome from deliveries where stop_id = ${stopId}`,
      )
    ).rows as { invoice_id: string; outcome: string }[]
    expect(rows.find((r) => r.invoice_id === bill1.invoiceId)?.outcome).toBe('delivered')
    expect(rows.find((r) => r.invoice_id === bill2.invoiceId)?.outcome).toBe('failed')

    // the desk's Undelivered register names the second bill
    const undelivered = await call<{ items: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/deliveries',
      { undeliveredOnly: 'true', limit: '50' },
    )
    expect(undelivered.status, JSON.stringify(undelivered.body)).toBe(200)
    expect(undelivered.body.items.map((d) => d.invoiceId)).toContain(bill2.invoiceId)
    expect(undelivered.body.items.map((d) => d.invoiceId)).not.toContain(bill1.invoiceId)
  }, 180_000)

  // -------------------------------------------------------------------------------------------------------------
  // DOS-233

  it("DOS-233 the van-sale list is the van less the trip's own bills, and a sale cannot take the next shop's goods", async () => {
    const driver = driverAt(2)
    const billA = await billedOrder(retailerA, '233-a')
    const { tripId, stopIds } = await roadTrip(
      '233',
      driver,
      [{ retailerId: retailerA, bills: [billA] }],
      [{ lotId: lotA, qtyPcs: 24 }],
    )
    const stock = await call<{
      items: { lotId: string; availablePcs: number; heldForBillsPcs: number; variantName: string }[]
      vanSalesAllowed: boolean
    }>(app, driver, 'GET', `/delivery/trips/${tripId}/van-stock`)
    expect(stock.status, JSON.stringify(stock.body)).toBe(200)
    expect(stock.body.vanSalesAllowed).toBe(true)
    const line = stock.body.items.find((i) => i.lotId === lotA)
    // 24 counted out for selling + 12 riding for shop A's bill
    expect(line?.availablePcs).toBe(24)
    expect(line?.heldForBillsPcs).toBe(12)
    expect(line?.variantName).toBe('Bourbon 100 g')
    expect(JSON.stringify(stock.body)).not.toMatch(/cost/i)

    // selling 30 to shop B would eat into shop A's cartons: refused, nothing written
    const tooMany = await call(app, driver, 'POST', '/delivery/van-sales', {
      idempotencyKey: `rf-vs-too-many-${run}`,
      id: uuidv7(),
      tripId,
      retailerId: retailerB,
      invoiceId: uuidv7(),
      deliveryId: uuidv7(),
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 30, enteredUnit: 'piece' }],
    })
    expect(tooMany.status).toBe(400)

    // exactly the free 24 sells
    const sold = await call(app, driver, 'POST', '/delivery/van-sales', {
      idempotencyKey: `rf-vs-ok-${run}`,
      id: uuidv7(),
      tripId,
      retailerId: retailerB,
      invoiceId: uuidv7(),
      deliveryId: uuidv7(),
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 24, enteredUnit: 'piece' }],
    })
    expect(sold.status, JSON.stringify(sold.body)).toBe(200)
    const after = await call<{ items: { lotId: string; availablePcs: number }[] }>(
      app,
      driver,
      'GET',
      `/delivery/trips/${tripId}/van-stock`,
    )
    expect(after.body.items.find((i) => i.lotId === lotA)?.availablePcs ?? 0).toBe(0)
    // the temporary hold was given back: nothing stays reserved on the van
    const [balance] = (
      await db.execute(
        sql`select on_hand, reserved from stock_balances where tenant_id = ${tenantId}
             and lot_id = ${lotA} and location_id = (select location_id from vehicles v
               join trips t on t.vehicle_id = v.id where t.id = ${tripId})`,
      )
    ).rows as { on_hand: number; reserved: number }[]
    expect(Number(balance?.on_hand)).toBe(12)
    expect(Number(balance?.reserved)).toBe(0)

    // and shop A still gets its whole bill
    const stopId = stopIds[0] ?? ''
    await arrive(driver, stopId, '233')
    const delivered = await deliverAll(driver, tripId, stopId, billA, '233-a')
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200)
    expect(delivered.body.item.outcome).toBe('delivered')
  }, 180_000)

  // -------------------------------------------------------------------------------------------------------------
  // DOS-234

  it('DOS-234 balances with nonZero leave out the rows a lot left behind at zero', async () => {
    const inventory = app.get(InventoryService)
    const shelf = uuidv7()
    await db.insert(locations).values({
      id: shelf,
      tenantId,
      kind: 'vehicle',
      name: `Old van ${run}`,
      active: true,
    })
    const lots: string[] = []
    await asOwner(async (tx) => {
      for (let i = 0; i < 5; i++) {
        const made = await inventory.findOrCreateLot(tx, {
          variantId: variantA,
          batchNo: `RF-Z${String(i)}-${run}`,
          mrpPaise: 1000,
          expiryDate: '2028-02-28',
        })
        lots.push(made.lot.id)
        await inventory.post(tx, [
          {
            lotId: made.lot.id,
            locationId: shelf,
            qtyDelta: 10,
            reason: 'opening',
            idempotencyKey: `rf-z-in-${String(i)}-${run}`,
          },
          ...(i < 4
            ? [
                {
                  lotId: made.lot.id,
                  locationId: shelf,
                  qtyDelta: -10,
                  reason: 'damage' as const,
                  idempotencyKey: `rf-z-out-${String(i)}-${run}`,
                },
              ]
            : []),
        ])
      }
    })
    const all = await call<{ items: { lotId: string; onHand: number }[] }>(
      app,
      packer,
      'GET',
      '/inventory/balances',
      { locationId: shelf, limit: '2' },
    )
    expect(all.status, JSON.stringify(all.body)).toBe(200)
    // the first page of two is all zeros: the live lot is past it
    expect(all.body.items.every((r) => r.onHand === 0)).toBe(true)
    const live = await call<{
      items: { lotId: string; onHand: number }[]
      nextCursor: string | null
    }>(app, packer, 'GET', '/inventory/balances', {
      locationId: shelf,
      limit: '2',
      nonZero: 'true',
    })
    expect(live.status, JSON.stringify(live.body)).toBe(200)
    expect(live.body.items).toEqual([expect.objectContaining({ lotId: lots[4], onHand: 10 })])
    expect(live.body.nextCursor).toBeNull()
  }, 120_000)

  // -------------------------------------------------------------------------------------------------------------
  // DOS-235

  it('DOS-235 a red settlement goes to the owner with its figures, and the owner approving it settles the trip', async () => {
    const driver = driverAt(3)
    const bill = await billedOrder(retailerA, '235')
    const { tripId, stopIds, tripNo } = await roadTrip(
      '235',
      driver,
      [{ retailerId: retailerA, bills: [bill] }],
      [{ lotId: lotA, qtyPcs: 12 }],
    )
    const stopId = stopIds[0] ?? ''
    await arrive(driver, stopId, '235')
    const delivered = await deliverAll(driver, tripId, stopId, bill, '235')
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200)
    // ₹300 cash at the door
    const collected = await call(app, driver, 'POST', '/delivery/collections', {
      idempotencyKey: `rf-collect-235-${run}`,
      id: uuidv7(),
      receiptId: uuidv7(),
      tripId,
      stopId,
      retailerId: retailerA,
      mode: 'cash',
      amountPaise: 30_000,
    })
    expect(collected.status, JSON.stringify(collected.body)).toBe(200)
    const returned = await call(app, driver, 'POST', `/delivery/trips/${tripId}/return`, {
      idempotencyKey: `rf-return-235-${run}`,
    })
    expect(returned.status, JSON.stringify(returned.body)).toBe(200)

    // the accountant counts ₹100 in hand (₹200 short) and 10 of the 12 van pieces
    const count = {
      tripId,
      handedOverCashPaise: 10_000,
      counted: [{ lotId: lotA, countedPcs: 10 }],
      note: 'crew says two packets torn',
    }
    const short = await call<{ message: string; data?: { code?: string; approvalId?: string } }>(
      app,
      accountant,
      'POST',
      `/delivery/trips/${tripId}/settle`,
      { ...count, idempotencyKey: `rf-settle-235-a-${run}`, id: uuidv7() },
    )
    expect(short.status, JSON.stringify(short.body)).toBe(409)
    expect(short.body.data?.code).toBe('settlement_needs_owner')
    // DOS-236's words: rupees, short, and the stock said apart
    expect(short.body.message).toContain('₹200.00 short')
    expect(short.body.message).toContain('allowed ₹100.00')
    expect(short.body.message).toContain('2 pieces missing')
    expect(short.body.message).not.toMatch(/paise|-20000/)
    const approvalId = short.body.data?.approvalId ?? ''

    // the same count again answers the same request, never a second one
    const again = await call<{ data?: { approvalId?: string } }>(
      app,
      accountant,
      'POST',
      `/delivery/trips/${tripId}/settle`,
      { ...count, idempotencyKey: `rf-settle-235-b-${run}`, id: uuidv7() },
    )
    expect(again.status).toBe(409)
    expect(again.body.data?.approvalId).toBe(approvalId)

    // the owner's queue names the trip, the cash and the lots with their value at this batch's cost
    const queue = await call<{ items: ApprovalRowBody[] }>(app, owner, 'GET', '/approvals', {
      status: 'pending',
      kind: 'trip_settlement',
    })
    expect(queue.status, JSON.stringify(queue.body)).toBe(200)
    const row = queue.body.items.find((a) => a.id === approvalId)
    expect(row?.tripSettlement?.tripNo).toBe(tripNo)
    expect(row?.tripSettlement?.vehicleRegNo).toContain('MH-05-R235')
    expect(row?.tripSettlement?.expectedCashPaise).toBe(30_000)
    expect(row?.tripSettlement?.cashCollectedPaise).toBe(30_000)
    expect(row?.tripSettlement?.handedOverCashPaise).toBe(10_000)
    expect(row?.tripSettlement?.cashVariancePaise).toBe(-20_000)
    expect(row?.tripSettlement?.tolerancePaise).toBe(10_000)
    expect(row?.tripSettlement?.stockVariance).toEqual([
      expect.objectContaining({
        lotId: lotA,
        variantName: 'Bourbon 100 g',
        batchNo: `RF-${run}`,
        expectedPcs: 12,
        countedPcs: 10,
        deltaPcs: -2,
        valuePaise: -1_500,
      }),
    ])
    expect(row?.tripSettlement?.stockVarianceValuePaise).toBe(-1_500)
    // the value is read at ask time: the stored request carries no cost
    const [stored] = (
      await db.execute(sql`select payload::text as payload from approvals where id = ${approvalId}`)
    ).rows as { payload: string }[]
    expect(stored?.payload).not.toMatch(/cost|valuePaise|750/)

    // a manager may not accept a trip's variance: refused, and the request stays pending
    const byManager = await call(app, manager, 'POST', `/approvals/${approvalId}/decide`, {
      idempotencyKey: `rf-decide-235-m-${run}`,
      decision: 'approve',
    })
    expect(byManager.status).toBe(403)
    const [still] = (
      await db.execute(sql`select status::text as status from approvals where id = ${approvalId}`)
    ).rows as { status: string }[]
    expect(still?.status).toBe('pending')

    // the owner approves: the trip is settled in the same step, signed by the owner, counted by the accountant
    const approved = await call<{
      item: { status: string }
      trip: { id: string; tripNo: string | null; state: string } | null
    }>(app, owner, 'POST', `/approvals/${approvalId}/decide`, {
      idempotencyKey: `rf-decide-235-o-${run}`,
      decision: 'approve',
      note: 'recover ₹200 from the crew',
    })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    expect(approved.body.item.status).toBe('approved')
    expect(approved.body.trip).toEqual({ id: tripId, tripNo, state: 'settled_with_variance' })
    const [settlement] = (
      await db.execute(
        sql`select settled_by, approved_by, has_variance, cash_variance_paise, handed_over_cash_paise
              from trip_settlements where trip_id = ${tripId}`,
      )
    ).rows as {
      settled_by: string
      approved_by: string
      has_variance: boolean
      cash_variance_paise: number
      handed_over_cash_paise: number
    }[]
    expect(settlement?.approved_by).toBe(ownerId)
    expect(settlement?.settled_by).toBe(accountantId)
    expect(settlement?.has_variance).toBe(true)
    expect(Number(settlement?.cash_variance_paise)).toBe(-20_000)
    expect(Number(settlement?.handed_over_cash_paise)).toBe(10_000)
    const [trip] = (
      await db.execute(sql`select state::text as state from trips where id = ${tripId}`)
    ).rows as { state: string }[]
    expect(trip?.state).toBe('settled_with_variance')
    // the two missing pieces written off, the ten counted unloaded: the van is empty
    const [van] = (
      await db.execute(
        sql`select coalesce(sum(b.on_hand), 0)::int as on_hand from stock_balances b
             join vehicles v on v.location_id = b.location_id join trips t on t.vehicle_id = v.id
            where t.id = ${tripId}`,
      )
    ).rows as { on_hand: number }[]
    expect(van?.on_hand).toBe(0)

    // settling again is refused: the trip is settled
    const late = await call(app, accountant, 'POST', `/delivery/trips/${tripId}/settle`, {
      ...count,
      idempotencyKey: `rf-settle-235-c-${run}`,
      id: uuidv7(),
    })
    expect(late.status).toBe(409)
  }, 240_000)

  it('DOS-235 a recount replaces the request the owner sees; figures that moved since are refused and the request stays open', async () => {
    const driver = driverAt(4)
    const { tripId } = await roadTrip('235r', driver, [], [{ lotId: lotA, qtyPcs: 6 }])
    const returned = await call(app, driver, 'POST', `/delivery/trips/${tripId}/return`, {
      idempotencyKey: `rf-return-235r-${run}`,
    })
    expect(returned.status, JSON.stringify(returned.body)).toBe(200)

    const first = await call<{ data?: { approvalId?: string } }>(
      app,
      accountant,
      'POST',
      `/delivery/trips/${tripId}/settle`,
      {
        idempotencyKey: `rf-settle-235r-a-${run}`,
        id: uuidv7(),
        tripId,
        handedOverCashPaise: 0,
        counted: [{ lotId: lotA, countedPcs: 4 }],
      },
    )
    expect(first.status).toBe(409)
    const second = await call<{ data?: { approvalId?: string } }>(
      app,
      accountant,
      'POST',
      `/delivery/trips/${tripId}/settle`,
      {
        idempotencyKey: `rf-settle-235r-b-${run}`,
        id: uuidv7(),
        tripId,
        handedOverCashPaise: 0,
        counted: [{ lotId: lotA, countedPcs: 5 }],
      },
    )
    expect(second.status).toBe(409)
    expect(second.body.data?.approvalId).not.toBe(first.body.data?.approvalId)
    const statuses = (
      await db.execute(
        sql`select id, status::text as status from approvals
             where tenant_id = ${tenantId} and entity_id = ${tripId} order by id`,
      )
    ).rows as { id: string; status: string }[]
    expect(statuses).toEqual([
      { id: first.body.data?.approvalId, status: 'expired' },
      { id: second.body.data?.approvalId, status: 'pending' },
    ])

    // a piece moves onto the van after the count: the owner's approval would settle different figures
    const inventory = app.get(InventoryService)
    const trip = await call<{ item: TripBody }>(app, owner, 'GET', `/delivery/trips/${tripId}`)
    await asOwner((tx) =>
      inventory.post(tx, [
        {
          lotId: lotA,
          locationId: trip.body.item.vehicleLocationId,
          qtyDelta: 1,
          reason: 'opening',
          idempotencyKey: `rf-235r-extra-${run}`,
        },
      ]),
    )
    const moved = await call<{ data?: { code?: string } }>(
      app,
      owner,
      'POST',
      `/approvals/${second.body.data?.approvalId ?? ''}/decide`,
      { idempotencyKey: `rf-decide-235r-${run}`, decision: 'approve' },
    )
    expect(moved.status).toBe(409)
    expect(moved.body.data?.code).toBe('settlement_changed')
    const [open] = (
      await db.execute(
        sql`select status::text as status from approvals where id = ${second.body.data?.approvalId ?? ''}`,
      )
    ).rows as { status: string }[]
    expect(open?.status).toBe('pending')
    const [state] = (
      await db.execute(sql`select state::text as state from trips where id = ${tripId}`)
    ).rows as { state: string }[]
    expect(state?.state).toBe('closing')
  }, 180_000)
})
