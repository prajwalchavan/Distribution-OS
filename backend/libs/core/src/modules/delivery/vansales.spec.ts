import { sql } from 'drizzle-orm'
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
import { BillingModule } from '../billing/index.js'
import { FilesModule } from '../files/index.js'
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { PricingModule } from '../pricing/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { DeliveryModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** The agreed old dues a planner writes on the stop: what is owed at the door before any van sale. */
const OLD_DUES = 50_000

interface QuoteBody {
  lines: { lineId: string; lineNetPaise: number; taxPaise: number; lineTotalPaise: number }[]
  totals: { netPaise: number; taxPaise: number; roundOffPaise: number; totalPaise: number }
}
interface VanSaleBody {
  order: { id: string; state: string }
  invoice: { id: string; invoiceNo: string | null; totalPaise: number }
  delivery: { id: string; stopId: string }
  collection: unknown
}
interface TripBody {
  id: string
  state: string
  stops: { id: string; retailerId: string; state: string; plannedCollectionPaise: number | null }[]
}
interface PullBody {
  changes: { table: string; rows: Record<string, unknown>[]; deleted: string[] }[]
  cursor: string
  hasMore: boolean
  asOf: string
}

/**
 * QA DOS-171. The van sale bills through `BillingService.issueFromLocation`, so its bill carries GST and the
 * round-off; the crew's money screen reads `trip_stops.planned_collection_paise` as "Owed on the bills here".
 * These specs pin the two halves the backend owns: the quote the delivery role gets is the bill's payable
 * figure, and a van sale adds its bill to that column (and moves `updated_at`, so the phone's next delta pull
 * carries it).
 *
 * Fixture (design amendment l): no trip here departs carrying a packed bill. Every trip plans its stop with
 * `invoiceIds: []` and the agreed old dues as the stop's own `plannedCollectionPaise`, and its van stock sits
 * on a sheet the manager creates and confirms before depart — a trip that departs under DOS-172 Rule C too.
 */
describeDb('delivery van sales (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `4${run.slice(-6)}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const packerId = uuidv7()
  const shopUserA = uuidv7()
  const shopUserB = uuidv7()
  // one driver per test: a driver is on one open trip a day, and each test reads its own stop's figure
  const driverIds = [uuidv7(), uuidv7(), uuidv7(), uuidv7()]

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const drivers: Actor[] = driverIds.map((actorId) => ({ tenantId, actorId, role: 'delivery' }))
  const driverAt = (i: number): Actor => {
    const driver = drivers[i]
    if (!driver) throw new Error(`no driver ${String(i)}`)
    return driver
  }

  const ctxOf = (actorId: string, actorRole: TenantContext['actorRole']): TenantContext => ({
    tenantId,
    actorId,
    actorRole,
  })
  const asOwner = <T>(fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctxOf(ownerId, 'owner'), () => withTenant(db, ctxOf(ownerId, 'owner'), fn))

  const retailerA = uuidv7()
  const retailerB = uuidv7()
  const variantId = uuidv7()
  let godown = ''
  let lot = ''
  let app: NestFastifyApplication
  const today = new Date().toISOString().slice(0, 10)

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `vs-${run}`, legalName: 'Van Door Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91981${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91981${run}2`, name: 'Manager' },
      { id: packerId, phone: `+91981${run}3`, name: 'Packer' },
      ...driverIds.map((id, i) => ({
        id,
        phone: `+91981${run}${String(4 + i)}`,
        name: `Driver ${String(i + 1)}`,
      })),
      { id: shopUserA, phone: `+91982${run}1`, name: 'Shopkeeper A' },
      { id: shopUserB, phone: `+91982${run}2`, name: 'Shopkeeper B' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
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
      .values({ tenantId, key: TENANT_SETTING_KEYS.brandingDisplayName, value: 'Van Door Traders' })
      .onConflictDoNothing()
    await db
      .insert(featureFlags)
      .values({ tenantId, flag: 'van_sales', enabled: true })
      .onConflictDoUpdate({
        target: [featureFlags.tenantId, featureFlags.flag],
        set: { enabled: true },
      })

    // S-28's item: 12 % GST, no cess, ₹18.45 a piece — 12 pieces quote ₹221.40 before GST and bill ₹248.00
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker vs ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Namkeen', category: 'namkeen' })
    await db.insert(productVariants).values({
      id: variantId,
      productId,
      name: 'Namkeen 200 g',
      netQty: 200,
      netUnit: 'g',
      defaultCaseSize: 12,
      hsnCode: hsn,
      mrpPaise: 2500,
    })
    await db
      .insert(tenantProducts)
      .values({ id: uuidv7(), tenantId, variantId, caseSizeOverride: 12 })
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, cessBps: 0, effectiveFrom: '2020-04-01' })

    const shops: [string, string, string, string][] = [
      [retailerA, shopUserA, 'A', '27AAXPT9021Q1ZQ'],
      [retailerB, shopUserB, 'B', '27AABCU9603R1ZX'],
    ]
    for (const [retailerId, userId, tag, gstin] of shops) {
      const identityId = uuidv7()
      const phone = `+91983${run}${tag === 'A' ? '1' : '2'}`
      await db
        .insert(retailerIdentities)
        .values({ id: identityId, phone, userId, shopName: `Door Shop ${tag} ${run}` })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `VS-${tag}-${run}`,
        name: `Door Shop ${tag} ${run}`,
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
      .values({ id: uuidv7(), tenantId, priceListId, variantId, ratePaise: 1845 })

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
      PricingModule,
      InventoryModule,
      ReceivablesModule,
      FilesModule,
      SyncModule,
    ])
    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      const a = await inventory.findOrCreateLot(tx, {
        variantId,
        batchNo: `VS-${run}`,
        mrpPaise: 2500,
        expiryDate: '2028-01-31',
      })
      lot = a.lot.id
      await inventory.post(tx, [
        {
          lotId: lot,
          locationId: godown,
          qtyDelta: 1_000,
          reason: 'opening',
          idempotencyKey: `vs-open-${run}`,
        },
      ])
    })
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  /**
   * Fixture (l): a van-sales trip for `driver` with ONE stop for shop A, planned with no bill and the agreed
   * old dues as its own figure, 48 pieces of van stock on a confirmed sheet, departed. Shop B has no stop.
   */
  async function roadTrip(tag: string, driver: Actor): Promise<{ tripId: string; stopId: string }> {
    const vehicleId = uuidv7()
    const tripId = uuidv7()
    const stopId = uuidv7()
    const vehicle = await call<{ item: { locationId: string } }>(
      app,
      owner,
      'POST',
      '/delivery/vehicles',
      {
        idempotencyKey: `vs-vehicle-${tag}-${run}`,
        id: vehicleId,
        regNo: `MH-05-V${tag}-${run.slice(-4)}`,
        name: `Tempo ${tag}`,
        kind: 'tempo',
        capacityCases: 120,
      },
    )
    expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(200)
    const consent = await call(app, driver, 'POST', '/delivery/consents', {
      idempotencyKey: `vs-consent-${tag}-${run}`,
      id: uuidv7(),
      granted: true,
      noticeVersion: 'gps-2026-09',
    })
    expect(consent.status, JSON.stringify(consent.body)).toBe(200)
    const planned = await call(app, packer, 'POST', '/delivery/trips', {
      idempotencyKey: `vs-trip-${tag}-${run}`,
      id: tripId,
      tripDate: today,
      vehicleId,
      driverId: driver.actorId,
      vanSalesEnabled: true,
      openingCashPaise: 0,
      stops: [
        {
          id: stopId,
          sequence: 1,
          retailerId: retailerA,
          invoiceIds: [],
          plannedCollectionPaise: OLD_DUES,
        },
      ],
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    const loading = await call(app, packer, 'POST', `/delivery/trips/${tripId}/start-loading`, {
      idempotencyKey: `vs-loading-${tag}-${run}`,
    })
    expect(loading.status, JSON.stringify(loading.body)).toBe(200)
    const sheetId = uuidv7()
    const sheet = await call(app, manager, 'POST', '/warehouse/load-sheets', {
      idempotencyKey: `vs-sheet-${tag}-${run}`,
      id: sheetId,
      toLocationId: vehicle.body.item.locationId,
      tripId,
      vanStock: [{ lotId: lot, qtyPcs: 48 }],
    })
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(200)
    const confirmed = await call(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${sheetId}/confirm`,
      {
        idempotencyKey: `vs-sheet-confirm-${tag}-${run}`,
        countedPackages: 0,
        challanId: uuidv7(),
        countedVanStock: [{ lotId: lot, qtyPcs: 48 }],
      },
    )
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    const departed = await call<{ item: { state: string; vanSalesAllowed: boolean } }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripId}/depart`,
      { idempotencyKey: `vs-depart-${tag}-${run}`, startOdometerKm: 1_000 },
    )
    expect(departed.status, JSON.stringify(departed.body)).toBe(200)
    expect(departed.body.item.state).toBe('active')
    expect(departed.body.item.vanSalesAllowed).toBe(true)
    return { tripId, stopId }
  }

  /** The body D6 (`van-sale.tsx`) sends: the stop it was opened from, piece lines, no `collect`. */
  const d6Sale = (
    tag: string,
    tripId: string,
    stopId: string | undefined,
    retailerId: string,
    pieces: number,
  ): Record<string, unknown> => ({
    idempotencyKey: `vs-sale-${tag}-${run}`,
    id: uuidv7(),
    tripId,
    ...(stopId === undefined ? {} : { stopId }),
    retailerId,
    invoiceId: uuidv7(),
    deliveryId: uuidv7(),
    deviceId: uuidv7(),
    lines: [{ id: uuidv7(), variantId, enteredQty: pieces, enteredUnit: 'piece' }],
  })

  const sell = async (driver: Actor, body: Record<string, unknown>): Promise<VanSaleBody> => {
    const res = await call<VanSaleBody>(app, driver, 'POST', '/delivery/van-sales', body)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body
  }

  const stopsOfTrip = async (driver: Actor, tripId: string): Promise<TripBody['stops']> => {
    const res = await call<{ item: TripBody }>(app, driver, 'GET', `/delivery/trips/${tripId}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body.item.stops
  }

  const owedAt = async (driver: Actor, tripId: string, stopId: string): Promise<number | null> =>
    (await stopsOfTrip(driver, tripId)).find((s) => s.id === stopId)?.plannedCollectionPaise ?? null

  /** The crew phone's delta pull of `trip_stops`, as `@dos/offline` asks for it. */
  const pullStops = async (driver: Actor, deviceId: string, since?: string): Promise<PullBody> => {
    const res = await call<PullBody>(app, driver, 'GET', '/sync/pull', {
      deviceId,
      'tables[0]': 'trip_stops',
      ...(since === undefined ? {} : { since }),
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.hasMore).toBe(false)
    return res.body
  }
  const stopRowIn = (pull: PullBody, stopId: string): Record<string, unknown> | undefined =>
    pull.changes.find((c) => c.table === 'trip_stops')?.rows.find((r) => r.id === stopId)

  it("DOS-171 the delivery role's quote for a van sale is the bill's payable total", async () => {
    const driver = driverAt(0)
    const { tripId, stopId } = await roadTrip('q', driver)

    // exactly what D6 asks the price check for (van-sale.tsx: lineId = variantId, qtyPcs = the pieces)
    const quote = await call<QuoteBody>(app, driver, 'POST', '/pricing/quote', {
      retailerId: retailerA,
      lines: [{ lineId: variantId, variantId, qtyPcs: 12 }],
    })
    expect(quote.status, JSON.stringify(quote.body)).toBe(200)
    expect(quote.body.totals.taxPaise).toBeGreaterThan(0)

    const sale = await sell(driver, d6Sale('q', tripId, stopId, retailerA, 12))
    expect(sale.collection).toBeNull()
    // the figure the crew must read at the door is the quote's payable total, never the before-GST net
    expect(sale.invoice.totalPaise).toBe(quote.body.totals.totalPaise)
    expect(sale.invoice.totalPaise).not.toBe(quote.body.totals.netPaise)
  }, 120_000)

  it('DOS-171 a van sale adds its bill to what is owed at that door', async () => {
    const driver = driverAt(1)
    const { tripId, stopId } = await roadTrip('owed', driver)
    expect(await owedAt(driver, tripId, stopId)).toBe(OLD_DUES)

    // sale 1 at the planned stop: the bill joins the agreed old dues
    const sale1 = await sell(driver, d6Sale('owed-1', tripId, stopId, retailerA, 12))
    expect(sale1.delivery.stopId).toBe(stopId)
    expect(sale1.invoice.totalPaise).toBeGreaterThan(0)
    expect(await owedAt(driver, tripId, stopId)).toBe(OLD_DUES + sale1.invoice.totalPaise)

    // sale 2 at the same stop, which the first sale already finished: its bill is added too
    const sale2 = await sell(driver, d6Sale('owed-2', tripId, stopId, retailerA, 6))
    expect(sale2.delivery.stopId).toBe(stopId)
    const stops = await stopsOfTrip(driver, tripId)
    expect(stops.find((s) => s.id === stopId)?.state).toBe('delivered')
    expect(stops.find((s) => s.id === stopId)?.plannedCollectionPaise).toBe(
      OLD_DUES + sale1.invoice.totalPaise + sale2.invoice.totalPaise,
    )

    // sale 3 for shop B, which has no stop on this trip: the stop the sale creates owes exactly its bill
    const sale3 = await sell(driver, d6Sale('owed-3', tripId, undefined, retailerB, 4))
    const created = (await stopsOfTrip(driver, tripId)).find((s) => s.retailerId === retailerB)
    expect(created?.id).toBe(sale3.delivery.stopId)
    expect(created?.plannedCollectionPaise).toBe(sale3.invoice.totalPaise)
    // and shop A's door is untouched by shop B's bill
    expect(await owedAt(driver, tripId, stopId)).toBe(
      OLD_DUES + sale1.invoice.totalPaise + sale2.invoice.totalPaise,
    )
  }, 120_000)

  it("DOS-171 the device's next pull carries the new figure", async () => {
    const driver = driverAt(2)
    const { tripId, stopId } = await roadTrip('pull', driver)
    const deviceId = uuidv7()

    const before = await pullStops(driver, deviceId)
    expect(Number(stopRowIn(before, stopId)?.planned_collection_paise)).toBe(OLD_DUES)

    const sale1 = await sell(driver, d6Sale('pull-1', tripId, stopId, retailerA, 12))
    const afterSale1 = await pullStops(driver, deviceId, before.cursor)
    const row1 = stopRowIn(afterSale1, stopId)
    expect(row1, 'the stop the first sale finished is in the next pull').toBeDefined()
    expect(Number(row1?.planned_collection_paise)).toBe(OLD_DUES + sale1.invoice.totalPaise)

    // sale 2 at a stop that is already finished: no stop move touches the row, so only the sale's own write
    // can move `updated_at` past the previous pull, or the phone never hears of the new figure. The pull's
    // 5 s overlap could hand back an untouched row too, which is why the instant is asserted, not presence.
    const sale2 = await sell(driver, d6Sale('pull-2', tripId, stopId, retailerA, 6))
    const afterSale2 = await pullStops(driver, deviceId, afterSale1.cursor)
    const row2 = stopRowIn(afterSale2, stopId)
    expect(row2, 'the finished stop is in the pull after the second sale').toBeDefined()
    expect(Number(row2?.planned_collection_paise)).toBe(
      OLD_DUES + sale1.invoice.totalPaise + sale2.invoice.totalPaise,
    )
    expect(new Date(String(row2?.updated_at)).getTime()).toBeGreaterThan(
      new Date(afterSale1.asOf).getTime(),
    )
  }, 120_000)

  it('DOS-171 a replayed van sale adds once', async () => {
    const driver = driverAt(3)
    const { tripId, stopId } = await roadTrip('replay', driver)

    const body = d6Sale('replay', tripId, stopId, retailerA, 12)
    const first = await sell(driver, body)
    const owed = OLD_DUES + first.invoice.totalPaise
    expect(await owedAt(driver, tripId, stopId)).toBe(owed)

    // the phone retries the same intent (same body, same idempotencyKey): the same bill, added once
    const again = await sell(driver, body)
    expect(again.invoice.id).toBe(first.invoice.id)
    expect(again.invoice.invoiceNo).toBe(first.invoice.invoiceNo)
    expect(again.invoice.totalPaise).toBe(first.invoice.totalPaise)
    expect(await owedAt(driver, tripId, stopId)).toBe(owed)
  }, 120_000)
})
