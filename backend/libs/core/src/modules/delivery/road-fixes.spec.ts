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
  const driverIds = Array.from({ length: 17 }, () => uuidv7())
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

  /**
   * What the godown's check-in screen did before QA DOS-244: every piece off the checked-in van back to the godown
   * as free stock, by hand. The hand transfer is refused now until the trip is settled (QA DOS-358 verify, 409
   * `vehicle_on_trip`), so the rows are written as that screen wrote them, to build the day these fixes met.
   */
  const oldCheckIn = async (
    lotId: string,
    fromLocationId: string,
    qtyPcs: number,
    key: string,
  ): Promise<void> => {
    const refused = await call<{ data?: { code?: string } }>(
      app,
      packer,
      'POST',
      '/inventory/transfers',
      { idempotencyKey: key, lotId, fromLocationId, toLocationId: godown, qtyPcs },
    )
    expect(refused.status, JSON.stringify(refused.body)).toBe(409)
    expect(refused.body.data?.code).toBe('vehicle_on_trip')
    await asOwner((tx) =>
      app.get(InventoryService).post(tx, [
        {
          lotId,
          locationId: fromLocationId,
          qtyDelta: -qtyPcs,
          reason: 'transfer_out',
          refType: 'transfer',
          refId: key,
          idempotencyKey: `${key}:out`,
        },
        {
          lotId,
          locationId: godown,
          qtyDelta: qtyPcs,
          reason: 'transfer_in',
          refType: 'transfer',
          refId: key,
          idempotencyKey: `${key}:in`,
        },
      ]),
    )
  }

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
        phone: `+9197${String(10 + i)}${run}`,
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
    expect(stored?.payload).not.toMatch(/cost|valuePaise/)
    // …and no number in it is the lot's cost (a regex on the text matched a random UUID's "…b37508f5", QA verify 3)
    const numbersIn = (v: unknown): number[] =>
      typeof v === 'number'
        ? [v]
        : v !== null && typeof v === 'object'
          ? Object.values(v).flatMap(numbersIn)
          : []
    expect(numbersIn(JSON.parse(stored?.payload ?? '{}')).map(Math.abs)).not.toContain(750)

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

  // -------------------------------------------------------------------------------------------------------------
  // DOS-237

  /** The shape DOS-232 left behind before its fix: a two-bill stop walked to `delivered` on its first bill. */
  const endStopEarly = async (stopId: string): Promise<void> => {
    await db.execute(sql`update trip_stops set state = 'delivered' where id = ${stopId}`)
  }

  const deliveryOf = async (
    invoiceId: string,
  ): Promise<{ id: string; outcome: string | null } | undefined> =>
    (
      await db.execute(
        sql`select id, outcome::text as outcome from deliveries where invoice_id = ${invoiceId}`,
      )
    ).rows[0] as { id: string; outcome: string | null } | undefined

  const balanceAt = async (locationId: string): Promise<number> => {
    const [row] = (
      await db.execute(
        sql`select coalesce(sum(on_hand), 0)::int as on_hand from stock_balances
             where lot_id = ${lotA} and location_id = ${locationId}`,
      )
    ).rows as { on_hand: number }[]
    return Number(row?.on_hand ?? 0)
  }

  it('DOS-237 the check-in fails a bill still unrecorded on a stop that had already ended', async () => {
    const driver = driverAt(5)
    const bill1 = await billedOrder(retailerA, '237a-1')
    const bill2 = await billedOrder(retailerA, '237a-2')
    const { tripId, stopIds } = await roadTrip('237a', driver, [
      { retailerId: retailerA, bills: [bill1, bill2] },
    ])
    const stopId = stopIds[0] ?? ''
    await arrive(driver, stopId, '237a')
    const first = await deliverAll(driver, tripId, stopId, bill1, '237a-1')
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    await endStopEarly(stopId)

    const returned = await call(app, driver, 'POST', `/delivery/trips/${tripId}/return`, {
      idempotencyKey: `rf-return-237a-${run}`,
    })
    expect(returned.status, JSON.stringify(returned.body)).toBe(200)
    // the second bill is said to have come back, whatever the stop had ended as
    expect((await deliveryOf(bill2.invoiceId))?.outcome).toBe('failed')
    expect(await orderState(bill2.orderId)).toBe('packed')
    expect(await orderState(bill1.orderId)).toBe('delivered')
    const register = await call<{ items: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/deliveries',
      { undeliveredOnly: 'true', limit: '50' },
    )
    expect(register.status).toBe(200)
    expect(register.body.items.map((d) => d.invoiceId)).toContain(bill2.invoiceId)
    // and nothing is left unrecorded on the trip for the desk to chase
    const unrecorded = await call<{ items: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/deliveries',
      { unrecordedOnly: 'true', tripId, limit: '50' },
    )
    expect(unrecorded.status).toBe(200)
    expect(unrecorded.body.items).toEqual([])
  }, 180_000)

  it('DOS-237 a paid bill left unrecorded on a settled trip: the desk brings it back, on the register and the board, its goods on the dock', async () => {
    const driver = driverAt(6)
    const bill1 = await billedOrder(retailerB, '237b-1')
    const bill2 = await billedOrder(retailerB, '237b-2')
    const { tripId, stopIds, tripNo } = await roadTrip('237b', driver, [
      { retailerId: retailerB, bills: [bill1, bill2] },
    ])
    const stopId = stopIds[0] ?? ''
    await arrive(driver, stopId, '237b')
    // the shop pays the second bill by UPI at the door (INV/9017 was paid by RCPT-9009)
    const paid = await call(app, driver, 'POST', '/delivery/collections', {
      idempotencyKey: `rf-collect-237b-${run}`,
      id: uuidv7(),
      receiptId: uuidv7(),
      tripId,
      stopId,
      retailerId: retailerB,
      mode: 'upi',
      reference: `UTR237${run}`,
      amountPaise: bill2.totalPaise,
      allocations: [{ id: uuidv7(), invoiceId: bill2.invoiceId, amountPaise: bill2.totalPaise }],
    })
    expect(paid.status, JSON.stringify(paid.body)).toBe(200)
    const first = await deliverAll(driver, tripId, stopId, bill1, '237b-1')
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    // what the day-3 database holds: the stop ended on the first bill, and the check-in ran before the fix,
    // so the trip closed with the second bill's delivery NULL and its 12 pieces still on the van
    await endStopEarly(stopId)
    await db.execute(sql`update trips set state = 'closing', ended_at = now() where id = ${tripId}`)
    expect((await deliveryOf(bill2.invoiceId))?.outcome).toBeNull()

    // the accountant counts the 12 pieces back and settles: they go to the godown as free stock
    const settled = await call(app, accountant, 'POST', `/delivery/trips/${tripId}/settle`, {
      idempotencyKey: `rf-settle-237b-${run}`,
      id: uuidv7(),
      tripId,
      handedOverCashPaise: 0,
      counted: [{ lotId: lotA, countedPcs: 12 }],
    })
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    expect(await orderState(bill2.orderId)).toBe('dispatched')

    // the desk finds it: went out, never recorded
    const unrecorded = await call<{
      items: { id: string; invoiceId: string; tripNo: string | null }[]
    }>(app, manager, 'GET', '/delivery/deliveries', { unrecordedOnly: 'true', limit: '50' })
    expect(unrecorded.status, JSON.stringify(unrecorded.body)).toBe(200)
    const row = unrecorded.body.items.find((d) => d.invoiceId === bill2.invoiceId)
    expect(row?.tripNo).toBe(tripNo)
    const deliveryId = row?.id ?? ''

    const dock = (
      (
        await db.execute(
          sql`select id from locations where tenant_id = ${tenantId} and kind = 'in_transit' limit 1`,
        )
      ).rows[0] as { id: string }
    ).id
    const dockBefore = await balanceAt(dock)
    const godownBefore = await balanceAt(godown)

    // the accountant reads the road but does not decide it
    const byAccountant = await call(
      app,
      accountant,
      'POST',
      `/delivery/deliveries/${deliveryId}/came-back`,
      { idempotencyKey: `rf-came-back-237b-acc-${run}` },
    )
    expect(byAccountant.status).toBe(403)

    const back = await call<{
      item: { outcome: string; invoiceId: string }
      staged: { lotId: string; neededPcs: number; stagedPcs: number; onVanPcs: number }[]
    }>(app, manager, 'POST', `/delivery/deliveries/${deliveryId}/came-back`, {
      idempotencyKey: `rf-came-back-237b-${run}`,
      note: 'goods found in the godown after check-in',
    })
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    expect(back.body.item.outcome).toBe('failed')
    expect(back.body.staged).toEqual([
      expect.objectContaining({ lotId: lotA, neededPcs: 12, stagedPcs: 12, onVanPcs: 0 }),
    ])
    expect(await orderState(bill2.orderId)).toBe('packed')
    const [invoice] = (
      await db.execute(
        sql`select state::text as state, undelivered_at from invoices where id = ${bill2.invoiceId}`,
      )
    ).rows as { state: string; undelivered_at: Date | null }[]
    expect(invoice?.state).toBe('paid')
    expect(invoice?.undelivered_at).not.toBeNull()
    // its goods moved godown → dock, ready for the next load sheet
    expect(await balanceAt(dock)).toBe(dockBefore + 12)
    expect(await balanceAt(godown)).toBe(godownBefore - 12)

    // the paid bill is on the Undelivered register and back on the planning board
    const register = await call<{ items: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/deliveries',
      { undeliveredOnly: 'true', limit: '50' },
    )
    expect(register.body.items.map((d) => d.invoiceId)).toContain(bill2.invoiceId)
    const board = await call<{ bills: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/trip-planning',
      { date: today, limit: '200' },
    )
    expect(board.status, JSON.stringify(board.body)).toBe(200)
    expect(board.body.bills.map((b) => b.invoiceId)).toContain(bill2.invoiceId)

    // a lost reply retried answers the same; a second decision is refused by name
    const replay = await call<{ item: { outcome: string } }>(
      app,
      manager,
      'POST',
      `/delivery/deliveries/${deliveryId}/came-back`,
      {
        idempotencyKey: `rf-came-back-237b-${run}`,
        note: 'goods found in the godown after check-in',
      },
    )
    expect(replay.status).toBe(200)
    expect(await balanceAt(dock)).toBe(dockBefore + 12)
    const twice = await call<{ data?: { code?: string } }>(
      app,
      owner,
      'POST',
      `/delivery/deliveries/${deliveryId}/came-back`,
      { idempotencyKey: `rf-came-back-237b-2-${run}` },
    )
    expect(twice.status).toBe(409)
    expect(twice.body.data?.code).toBe('delivery_recorded')
    const after = await call<{ items: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/deliveries',
      { unrecordedOnly: 'true', limit: '50' },
    )
    expect(after.body.items.map((d) => d.invoiceId)).not.toContain(bill2.invoiceId)
  }, 240_000)

  it('DOS-237 a batch the godown no longer holds free is reported short, never invented', async () => {
    const driver = driverAt(7)
    const bill1 = await billedOrder(retailerA, '237c-1')
    const bill2 = await billedOrder(retailerA, '237c-2')
    const { tripId, stopIds } = await roadTrip('237c', driver, [
      { retailerId: retailerA, bills: [bill1, bill2] },
    ])
    const stopId = stopIds[0] ?? ''
    await arrive(driver, stopId, '237c')
    const first = await deliverAll(driver, tripId, stopId, bill1, '237c-1')
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    await endStopEarly(stopId)
    await db.execute(sql`update trips set state = 'closing', ended_at = now() where id = ${tripId}`)
    const settled = await call(app, accountant, 'POST', `/delivery/trips/${tripId}/settle`, {
      idempotencyKey: `rf-settle-237c-${run}`,
      id: uuidv7(),
      tripId,
      handedOverCashPaise: 0,
      counted: [{ lotId: lotA, countedPcs: 12 }],
    })
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    const deliveryId = (await deliveryOf(bill2.invoiceId))?.id ?? ''

    // the godown has since promised all but 5 of this batch to other orders (INV/9017's oil went to Ekta)
    const [held] = (
      await db.execute(
        sql`select on_hand, reserved from stock_balances where lot_id = ${lotA} and location_id = ${godown}`,
      )
    ).rows as { on_hand: number; reserved: number }[]
    await db.execute(
      sql`update stock_balances set reserved = on_hand - 5 where lot_id = ${lotA} and location_id = ${godown}`,
    )
    try {
      const back = await call<{
        staged: { lotId: string; neededPcs: number; stagedPcs: number; onVanPcs: number }[]
      }>(app, owner, 'POST', `/delivery/deliveries/${deliveryId}/came-back`, {
        idempotencyKey: `rf-came-back-237c-${run}`,
      })
      expect(back.status, JSON.stringify(back.body)).toBe(200)
      expect(back.body.staged).toEqual([
        expect.objectContaining({ lotId: lotA, neededPcs: 12, stagedPcs: 5, onVanPcs: 0 }),
      ])
      // the bill is still said to have come back, so the desk can decide it
      expect((await deliveryOf(bill2.invoiceId))?.outcome).toBe('failed')
      expect(await orderState(bill2.orderId)).toBe('packed')
    } finally {
      await db.execute(
        sql`update stock_balances set reserved = ${Number(held?.reserved ?? 0)}
             where lot_id = ${lotA} and location_id = ${godown}`,
      )
    }
  }, 240_000)

  // -------------------------------------------------------------------------------------------------------------
  // day 5: DOS-244 (the godown's check-in and the dock) and DOS-241 (a bill that cannot be loaded)

  const dockId = async (): Promise<string> =>
    (
      (
        await db.execute(
          sql`select id from locations where tenant_id = ${tenantId} and kind = 'in_transit' limit 1`,
        )
      ).rows[0] as { id: string }
    ).id
  const onHandOf = async (lotId: string, locationId: string): Promise<number> => {
    const [row] = (
      await db.execute(
        sql`select coalesce(sum(on_hand), 0)::int as on_hand from stock_balances
             where lot_id = ${lotId} and location_id = ${locationId}`,
      )
    ).rows as { on_hand: number }[]
    return Number(row?.on_hand ?? 0)
  }
  /** The crew finds the shop shut: nothing delivered, the bill comes back on the van (INV/9028, day 5). */
  const failAtDoor = async (driver: Actor, stopId: string, tag: string): Promise<void> => {
    const failed = await call(app, driver, 'POST', `/delivery/stops/${stopId}/fail`, {
      idempotencyKey: `rf-fail-${tag}-${run}`,
      failureReason: 'shop_closed',
      failureNote: 'shutter down',
    })
    expect(failed.status, JSON.stringify(failed.body)).toBe(200)
  }
  const returnTrip = async (driver: Actor, tripId: string, tag: string): Promise<void> => {
    const back = await call(app, driver, 'POST', `/delivery/trips/${tripId}/return`, {
      idempotencyKey: `rf-return-${tag}-${run}`,
    })
    expect(back.status, JSON.stringify(back.body)).toBe(200)
  }
  /** A trip for these bills, planned and `loading`, with nothing counted out yet. */
  async function plannedTrip(
    tag: string,
    driver: Actor,
    stops: { retailerId: string; bills: { invoiceId: string }[] }[],
  ): Promise<{ tripId: string; stopIds: string[]; vehicleLocationId: string }> {
    const vehicleId = uuidv7()
    const tripId = uuidv7()
    const vehicle = await call(app, owner, 'POST', '/delivery/vehicles', {
      idempotencyKey: `rf-vehicle-${tag}-${run}`,
      id: vehicleId,
      regNo: `MH-05-P${tag}-${run.slice(-4)}`,
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
    const planned = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `rf-trip-${tag}-${run}`,
      id: tripId,
      tripDate: today,
      vehicleId,
      driverId: driver.actorId,
      vanSalesEnabled: false,
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
    return { tripId, stopIds, vehicleLocationId: planned.body.item.vehicleLocationId }
  }

  it('DOS-244 the godown counts a failed bill back onto the dock, the rest onto the rack, and the bill goes out again', async () => {
    const driver = driverAt(8)
    const bill = await billedOrder(retailerA, '244a')
    const { tripId, stopIds, vehicleLocationId } = await roadTrip(
      '244a',
      driver,
      [{ retailerId: retailerA, bills: [bill] }],
      [{ lotId: lotA, qtyPcs: 10 }],
    )
    const dock = await dockId()
    await arrive(driver, stopIds[0] ?? '', '244a')
    await failAtDoor(driver, stopIds[0] ?? '', '244a')
    await returnTrip(driver, tripId, '244a')
    expect(await onHandOf(lotA, vehicleLocationId)).toBe(22)

    // the check-in screen asks first: 12 of the 22 are the bill's, and says so on the row
    const byRep = await call(app, rep, 'GET', '/delivery/van-returns', { vehicleLocationId })
    expect(byRep.status).toBe(403)
    const asked = await call<{
      tripId: string | null
      items: { lotId: string; invoiceId: string; retailerName: string; pcs: number }[]
    }>(app, packer, 'GET', '/delivery/van-returns', { vehicleLocationId })
    expect(asked.status, JSON.stringify(asked.body)).toBe(200)
    expect(asked.body.tripId).toBe(tripId)
    expect(asked.body.items).toEqual([
      expect.objectContaining({
        lotId: lotA,
        invoiceId: bill.invoiceId,
        retailerName: `Road Shop A ${run}`,
        pcs: 12,
      }),
    ])

    // a count above what the van holds is refused by name, and nothing moves
    const over = await call<{ data?: { code?: string } }>(
      app,
      packer,
      'POST',
      '/delivery/van-returns/unload',
      {
        idempotencyKey: `rf-unload-over-244a-${run}`,
        id: uuidv7(),
        vehicleLocationId,
        lotId: lotA,
        qtyPcs: 23,
      },
    )
    expect(over.status).toBe(409)
    expect(over.body.data?.code).toBe('van_short')

    const dockBefore = await onHandOf(lotA, dock)
    const rackBefore = await onHandOf(lotA, godown)
    const unloaded = await call<{
      dockPcs: number
      rackPcs: number
      bills: { retailerName: string }[]
    }>(app, packer, 'POST', '/delivery/van-returns/unload', {
      idempotencyKey: `rf-unload-244a-${run}`,
      id: uuidv7(),
      vehicleLocationId,
      lotId: lotA,
      qtyPcs: 22,
    })
    expect(unloaded.status, JSON.stringify(unloaded.body)).toBe(200)
    expect(unloaded.body).toMatchObject({ dockPcs: 12, rackPcs: 10 })
    expect(unloaded.body.bills.map((b) => b.retailerName)).toEqual([`Road Shop A ${run}`])
    expect(await onHandOf(lotA, dock)).toBe(dockBefore + 12)
    expect(await onHandOf(lotA, godown)).toBe(rackBefore + 10)
    expect(await onHandOf(lotA, vehicleLocationId)).toBe(0)
    const nothingLeft = await call<{ items: unknown[] }>(
      app,
      packer,
      'GET',
      '/delivery/van-returns',
      {
        vehicleLocationId,
      },
    )
    expect(nothingLeft.body.items).toEqual([])

    // the desk settles the empty van: the dock is not staged a second time
    const settled = await call(app, accountant, 'POST', `/delivery/trips/${tripId}/settle`, {
      idempotencyKey: `rf-settle-244a-${run}`,
      id: uuidv7(),
      tripId,
      handedOverCashPaise: 0,
      counted: [],
    })
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    expect(await onHandOf(lotA, dock)).toBe(dockBefore + 12)

    // and the bill goes out again on a fresh trip: the load-out finds its pieces on the dock
    const next = await plannedTrip('244a2', driverAt(9), [{ retailerId: retailerA, bills: [bill] }])
    const loaded = await loadOut(
      app,
      { godown: packer, approver: manager },
      { tripId: next.tripId, orderIds: [bill.orderId], tag: `rf-244a2-${run}` },
    )
    expect(loaded.dispatched).toEqual([bill.orderId])
  }, 240_000)

  it('DOS-244 a failed bill already counted onto the rack: the godown puts it on the dock and the sheet goes out', async () => {
    // A batch of its own, first by expiry, so this bill's lot rides on nobody else's sheet.
    const lotB = await asOwner(async (tx) => {
      const inventory = app.get(InventoryService)
      const b = await inventory.findOrCreateLot(tx, {
        variantId: variantA,
        batchNo: `RF-B-${run}`,
        mrpPaise: 1000,
        expiryDate: '2027-12-31',
      })
      await inventory.post(tx, [
        {
          lotId: b.lot.id,
          locationId: godown,
          qtyDelta: 30,
          reason: 'opening',
          idempotencyKey: `rf-open-b-${run}`,
        },
      ])
      return b.lot.id
    })
    const driver = driverAt(10)
    const bill = await billedOrder(retailerB, '244b')
    const { tripId, stopIds, vehicleLocationId } = await roadTrip('244b', driver, [
      { retailerId: retailerB, bills: [bill] },
    ])
    await arrive(driver, stopIds[0] ?? '', '244b')
    await failAtDoor(driver, stopIds[0] ?? '', '244b')
    await returnTrip(driver, tripId, '244b')
    expect(await onHandOf(lotB, vehicleLocationId)).toBe(12)
    // what the check-in screen did before the fix: every piece back to the godown as free stock (day 5, row 30)
    await oldCheckIn(lotB, vehicleLocationId, 12, `rf-old-checkin-244b-${run}`)
    const settled = await call(app, accountant, 'POST', `/delivery/trips/${tripId}/settle`, {
      idempotencyKey: `rf-settle-244b-${run}`,
      id: uuidv7(),
      tripId,
      handedOverCashPaise: 0,
      counted: [],
    })
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    const dock = await dockId()
    expect(await onHandOf(lotB, dock)).toBe(0)

    // TRIP-0008: the sheet is built and approved, and the load-out is refused dock_short
    const next = await plannedTrip('244b2', driverAt(11), [
      { retailerId: retailerB, bills: [bill] },
    ])
    const sheetId = uuidv7()
    const created = await call<{ item: { expectedPackages: number } }>(
      app,
      packer,
      'POST',
      '/warehouse/load-sheets',
      {
        idempotencyKey: `rf-sheet-244b-${run}`,
        id: sheetId,
        toLocationId: next.vehicleLocationId,
        tripId: next.tripId,
        orderIds: [bill.orderId],
        vanStock: [],
      },
    )
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const approved = await call(app, manager, 'POST', `/warehouse/load-sheets/${sheetId}/approve`, {
      idempotencyKey: `rf-approve-244b-${run}`,
    })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    const confirm = (key: string) =>
      call<{ data?: { code?: string }; dispatched?: string[] }>(
        app,
        packer,
        'POST',
        `/warehouse/load-sheets/${sheetId}/confirm`,
        {
          idempotencyKey: key,
          countedPackages: created.body.item.expectedPackages,
          countedVanStock: [],
          challanId: uuidv7(),
        },
      )
    const refused = await confirm(`rf-confirm-244b-1-${run}`)
    expect(refused.status).toBe(409)
    expect(refused.body.data).toMatchObject({ code: 'dock_short', onDockPcs: 0, neededPcs: 12 })

    // "Put the pieces on the dock": the godown still holds them, so all 12 go
    const byRep = await call(app, rep, 'POST', `/warehouse/load-sheets/${sheetId}/stage-dock`, {
      idempotencyKey: `rf-stage-rep-244b-${run}`,
    })
    expect(byRep.status).toBe(403)
    const rackBefore = await onHandOf(lotB, godown)
    const staged = await call<{
      items: {
        lotId: string
        neededPcs: number
        onDockPcs: number
        stagedPcs: number
        shortPcs: number
      }[]
    }>(app, packer, 'POST', `/warehouse/load-sheets/${sheetId}/stage-dock`, {
      idempotencyKey: `rf-stage-244b-${run}`,
    })
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    expect(staged.body.items).toEqual([
      expect.objectContaining({
        lotId: lotB,
        neededPcs: 12,
        onDockPcs: 0,
        stagedPcs: 12,
        shortPcs: 0,
      }),
    ])
    expect(await onHandOf(lotB, dock)).toBe(12)
    expect(await onHandOf(lotB, godown)).toBe(rackBefore - 12)
    // pressed again: nothing is short, nothing more moves
    const twice = await call<{ items: { stagedPcs: number; shortPcs: number }[] }>(
      app,
      packer,
      'POST',
      `/warehouse/load-sheets/${sheetId}/stage-dock`,
      { idempotencyKey: `rf-stage-244b-2-${run}` },
    )
    expect(twice.body.items).toEqual([expect.objectContaining({ stagedPcs: 0, shortPcs: 0 })])
    expect(await onHandOf(lotB, dock)).toBe(12)

    const sent = await confirm(`rf-confirm-244b-2-${run}`)
    expect(sent.status, JSON.stringify(sent.body)).toBe(200)
    expect(sent.body.dispatched).toEqual([bill.orderId])
    expect(await onHandOf(lotB, dock)).toBe(0)
  }, 240_000)

  it('DOS-241 a bill that cannot be loaded comes off the trip, and the rest of the trip leaves', async () => {
    const stuck = await billedOrder(retailerA, '241-stuck')
    const loadedBill = await billedOrder(retailerB, '241-ok')
    const driver = driverAt(12)
    const { tripId, stopIds, vehicleLocationId } = await plannedTrip('241', driver, [
      { retailerId: retailerA, bills: [stuck] },
      { retailerId: retailerB, bills: [loadedBill] },
    ])
    // a draft sheet still carrying the stuck bill holds it on the trip
    const draftId = uuidv7()
    const draft = await call(app, packer, 'POST', '/warehouse/load-sheets', {
      idempotencyKey: `rf-draft-241-${run}`,
      id: draftId,
      toLocationId: vehicleLocationId,
      tripId,
      orderIds: [stuck.orderId, loadedBill.orderId],
      vanStock: [],
    })
    expect(draft.status, JSON.stringify(draft.body)).toBe(200)
    const drop = (actor: Actor, key: string, invoiceId = stuck.invoiceId) =>
      call<{ item?: TripBody; data?: { code?: string } }>(
        app,
        actor,
        'POST',
        `/delivery/trips/${tripId}/drop-bill`,
        { idempotencyKey: key, invoiceId, reason: 'SIM D5: its batches were sold on day 4' },
      )
    const onDraft = await drop(manager, `rf-drop-241-draft-${run}`)
    expect(onDraft.status).toBe(409)
    expect(onDraft.body.data?.code).toBe('bill_on_draft_sheet')
    const cancelled = await call(app, manager, 'POST', `/warehouse/load-sheets/${draftId}/cancel`, {
      idempotencyKey: `rf-cancel-241-${run}`,
      reason: 'rebuild without the stuck bill',
    })
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)

    // the godown rebuilds the sheet without it and sends the vehicle out: the trip still cannot start
    await loadOut(
      app,
      { godown: packer, approver: manager },
      { tripId, orderIds: [loadedBill.orderId], tag: `rf-241-${run}` },
    )
    const blocked = await call<{ data?: { code?: string } }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripId}/depart`,
      { idempotencyKey: `rf-depart-241-1-${run}`, startOdometerKm: 1_000 },
    )
    expect(blocked.status).toBe(409)
    expect(blocked.body.data?.code).toBe('bill_not_loaded')

    // the accountant and the godown do not decide the road; a loaded bill does not come off here
    expect((await drop(accountant, `rf-drop-241-acc-${run}`)).status).toBe(403)
    expect((await drop(packer, `rf-drop-241-wh-${run}`)).status).toBe(403)
    const loadedOff = await drop(manager, `rf-drop-241-loaded-${run}`, loadedBill.invoiceId)
    expect(loadedOff.status).toBe(409)
    expect(loadedOff.body.data?.code).toBe('bill_loaded')

    const dropped = await drop(manager, `rf-drop-241-${run}`)
    expect(dropped.status, JSON.stringify(dropped.body)).toBe(200)
    expect(dropped.body.item?.stops.find((s) => s.id === stopIds[0])?.state).toBe('skipped')
    expect(await orderState(stuck.orderId)).toBe('packed')
    // a lost reply retried answers the same; the bill is on the planning board again
    expect((await drop(manager, `rf-drop-241-${run}`)).status).toBe(200)
    const board = await call<{ bills: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/trip-planning',
      { date: today, limit: '200' },
    )
    expect(board.body.bills.map((b) => b.invoiceId)).toContain(stuck.invoiceId)

    const departed = await call<{ item: TripBody }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripId}/depart`,
      { idempotencyKey: `rf-depart-241-2-${run}`, startOdometerKm: 1_000 },
    )
    expect(departed.status, JSON.stringify(departed.body)).toBe(200)
    expect(departed.body.item.state).toBe('active')
    // once it has left, nothing comes off it here
    const late = await drop(manager, `rf-drop-241-late-${run}`, loadedBill.invoiceId)
    expect(late.status).toBe(409)
    expect(late.body.data?.code).toBe('trip_left')
  }, 240_000)

  // -------------------------------------------------------------------------------------------------------------
  // day 6: DOS-247 (the dock is per bill, not per batch) and DOS-248 (a bill that can never be sent)

  it('DOS-247 a bill that came back cannot load the cartons packed for today’s shop; every refusal names the bill, and the desk credits it whole', async () => {
    // A batch of its own, first by expiry, one case in the godown: the whole day-6 story fits in it.
    const lotC = await asOwner(async (tx) => {
      const inventory = app.get(InventoryService)
      const c = await inventory.findOrCreateLot(tx, {
        variantId: variantA,
        batchNo: `B20260909-${run}`,
        mrpPaise: 1000,
        expiryDate: '2027-06-30',
      })
      await inventory.post(tx, [
        {
          lotId: c.lot.id,
          locationId: godown,
          qtyDelta: 12,
          reason: 'opening',
          idempotencyKey: `rf-open-c-${run}`,
        },
      ])
      return c.lot.id
    })
    const lotOf = async (invoiceId: string): Promise<string> =>
      (
        await call<{ item: { lines: { lotId: string | null }[] } }>(
          app,
          manager,
          'GET',
          `/invoices/${invoiceId}`,
        )
      ).body.item.lines[0]?.lotId ?? ''
    const invoiceNoOf = async (invoiceId: string): Promise<string> =>
      (await call<{ item: { invoiceNo: string } }>(app, manager, 'GET', `/invoices/${invoiceId}`))
        .body.item.invoiceNo
    const dock = await dockId()

    // Day 5: INV/9028 goes out, Patel is shut, and the check-in of old counts it back onto the RACK.
    const stale = await billedOrder(retailerA, '247-stale')
    expect(await lotOf(stale.invoiceId)).toBe(lotC)
    const driver = driverAt(13)
    const road = await roadTrip('247a', driver, [{ retailerId: retailerA, bills: [stale] }])
    await arrive(driver, road.stopIds[0] ?? '', '247a')
    await failAtDoor(driver, road.stopIds[0] ?? '', '247a')
    await returnTrip(driver, road.tripId, '247a')
    await oldCheckIn(lotC, road.vehicleLocationId, 12, `rf-old-checkin-247-${run}`)
    const settled = await call(app, accountant, 'POST', `/delivery/trips/${road.tripId}/settle`, {
      idempotencyKey: `rf-settle-247-${run}`,
      id: uuidv7(),
      tripId: road.tripId,
      handedOverCashPaise: 0,
      counted: [],
    })
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)

    // Day 6: FEFO sells those very pieces to today's shop; packed, they stand on the dock held for ITS bill.
    const fresh = await billedOrder(retailerB, '247-fresh')
    expect(await lotOf(fresh.invoiceId)).toBe(lotC)
    expect(await onHandOf(lotC, dock)).toBe(12)
    const staleNo = await invoiceNoOf(stale.invoiceId)
    // Held for today's bill, those cartons cannot be walked off the dock by hand either.
    const byHand = await call<{ data?: { code?: string; freePcs?: number } }>(
      app,
      packer,
      'POST',
      '/inventory/transfers',
      {
        idempotencyKey: `rf-hand-247-${run}`,
        lotId: lotC,
        fromLocationId: dock,
        toLocationId: godown,
        qtyPcs: 12,
      },
    )
    expect(byHand.status).toBe(409)
    expect(byHand.body.data).toMatchObject({ code: 'dock_held', freePcs: 0 })

    // The stale bill's sheet is refused by NAME and loads nothing; today's pieces stay where they are.
    const next = await plannedTrip('247b', driverAt(14), [
      { retailerId: retailerA, bills: [stale] },
    ])
    const sheetId = uuidv7()
    const created = await call<{ item: { expectedPackages: number } }>(
      app,
      packer,
      'POST',
      '/warehouse/load-sheets',
      {
        idempotencyKey: `rf-sheet-247-${run}`,
        id: sheetId,
        toLocationId: next.vehicleLocationId,
        tripId: next.tripId,
        orderIds: [stale.orderId],
        vanStock: [],
      },
    )
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const approved = await call(app, manager, 'POST', `/warehouse/load-sheets/${sheetId}/approve`, {
      idempotencyKey: `rf-approve-247-${run}`,
    })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    const refused = await call<{
      message: string
      data?: {
        code?: string
        invoiceNo?: string
        bills?: { invoiceNo: string; retailerName: string; shortPcs: number }[]
      }
    }>(app, packer, 'POST', `/warehouse/load-sheets/${sheetId}/confirm`, {
      idempotencyKey: `rf-confirm-247-${run}`,
      countedPackages: created.body.item.expectedPackages,
      countedVanStock: [],
      challanId: uuidv7(),
    })
    expect(refused.status).toBe(409)
    expect(refused.body.data?.code).toBe('dock_short')
    expect(refused.body.data?.invoiceNo).toBe(staleNo)
    expect(refused.body.data?.bills).toEqual([
      expect.objectContaining({
        invoiceNo: staleNo,
        retailerName: `Road Shop A ${run}`,
        shortPcs: 12,
      }),
    ])
    expect(refused.body.message).toContain(`${staleNo} · Road Shop A ${run} needs 12 pc`)
    expect(refused.body.message).toContain(`the manager takes ${staleNo} off the trip`)
    expect(await onHandOf(lotC, dock)).toBe(12)

    // "Bring them from the godown" names the bill too, and invents nothing: the batch is gone.
    const staged = await call<{
      items: {
        orderId?: string
        invoiceNo?: string | null
        retailerName?: string
        neededPcs: number
        onDockPcs: number
        stagedPcs: number
        shortPcs: number
      }[]
    }>(app, packer, 'POST', `/warehouse/load-sheets/${sheetId}/stage-dock`, {
      idempotencyKey: `rf-stage-247-${run}`,
    })
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    expect(staged.body.items).toEqual([
      expect.objectContaining({
        orderId: stale.orderId,
        invoiceNo: staleNo,
        retailerName: `Road Shop A ${run}`,
        neededPcs: 12,
        onDockPcs: 0,
        stagedPcs: 0,
        shortPcs: 12,
      }),
    ])
    expect(await onHandOf(lotC, dock)).toBe(12)

    // Today's bill loads, whole, from its own pieces.
    const out = await plannedTrip('247c', driverAt(15), [{ retailerId: retailerB, bills: [fresh] }])
    const loaded = await loadOut(
      app,
      { godown: packer, approver: manager },
      { tripId: out.tripId, orderIds: [fresh.orderId], tag: `rf-247c-${run}` },
    )
    expect(loaded.dispatched).toEqual([fresh.orderId])
    expect(await onHandOf(lotC, dock)).toBe(0)

    // DOS-248: the desk cannot credit a bill still on a trip; off the trip, it credits it WHOLE — nothing
    // moves (its pieces went back to the rack on day 5 and were sold), and its order closes.
    const creditWhole = (key: string) =>
      call<{ item?: { state: string; note: string | null }; data?: { code?: string } }>(
        app,
        manager,
        'POST',
        '/credit-notes',
        {
          idempotencyKey: key,
          id: uuidv7(),
          invoiceId: stale.invoiceId,
          reason: 'short_delivery',
          autoIssue: true,
          lines: [{ id: uuidv7(), invoiceLineId: stale.lineId, qtyPcs: 12 }],
        },
      )
    const onTrip = await creditWhole(`rf-cn-247-1-${run}`)
    expect(onTrip.status).toBe(409)
    expect(onTrip.body.data?.code).toBe('bill_on_trip')
    const cancelled = await call(app, manager, 'POST', `/warehouse/load-sheets/${sheetId}/cancel`, {
      idempotencyKey: `rf-cancel-247-${run}`,
      reason: 'its batch is gone',
    })
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
    const dropped = await call(app, manager, 'POST', `/delivery/trips/${next.tripId}/drop-bill`, {
      idempotencyKey: `rf-drop-247-${run}`,
      invoiceId: stale.invoiceId,
      reason: 'its batch was sold on day 5',
    })
    expect(dropped.status, JSON.stringify(dropped.body)).toBe(200)
    const godownBefore = await onHandOf(lotC, godown)
    const credited = await creditWhole(`rf-cn-247-2-${run}`)
    expect(credited.status, JSON.stringify(credited.body)).toBe(200)
    expect(credited.body.item?.state).toBe('issued')
    expect(credited.body.item?.note).toMatch(/Not on the dock, so nothing moved for: 12 pc/)
    expect(await onHandOf(lotC, godown)).toBe(godownBefore)
    expect(await onHandOf(lotC, dock)).toBe(0)
    expect(await orderState(stale.orderId)).toBe('cancelled')
    // and it has left the planning board
    const board = await call<{ bills: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/trip-planning',
      { date: today, limit: '200' },
    )
    expect(board.body.bills.map((b) => b.invoiceId)).not.toContain(stale.invoiceId)
  }, 240_000)
})
