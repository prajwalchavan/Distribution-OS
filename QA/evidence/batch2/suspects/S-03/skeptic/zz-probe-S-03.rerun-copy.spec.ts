// QA PROBE S-03 (temporary; deleted after the run). A bill returned undelivered after its load sheet was
// confirmed: can it be put on a load sheet for its next trip? Drives the same endpoints and roles the apps use.
import { appendFileSync } from 'node:fs'
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
import { ReceivablesModule } from '../receivables/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { DeliveryModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const LOG_FILE =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/suspects/S-03/skeptic/rerun-log.txt'
const log = (label: string, value: unknown): void => {
  const line = `[S-03] ${label}: ${JSON.stringify(value)}`
  appendFileSync(LOG_FILE, `${line}\n`)
  console.log(line)
}

describeDb('S-03 probe (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `6${run.slice(-6)}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const driverId = uuidv7()
  const shopUserA = uuidv7()
  const shopUserB = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }

  const ctxOf = (actorId: string, actorRole: TenantContext['actorRole']): TenantContext => ({
    tenantId,
    actorId,
    actorRole,
  })
  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) => as(ctxOf(ownerId, 'owner'), fn)

  const retailerA = uuidv7()
  const retailerB = uuidv7()
  const variantA = uuidv7()
  let godown = ''
  let lotA = ''
  let app: NestFastifyApplication
  const vehicleId = uuidv7()
  let vehicleLocation = ''
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

  const orderState = async (orderId: string): Promise<string> =>
    (
      (await db.execute(sql`select state::text as state from sales_orders where id = ${orderId}`))
        .rows[0] as { state: string }
    ).state

  async function billedOrder(
    retailerId: string,
    tag: string,
  ): Promise<{ orderId: string; invoiceId: string; totalPaise: number; orderNo: string | null }> {
    const orderId = uuidv7()
    const created = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `order-${tag}-${run}`,
      id: orderId,
      retailerId,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'case' }],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const submitted = await call<{ item: { state: string; orderNo: string | null } }>(
      app,
      rep,
      'POST',
      `/orders/${orderId}/submit`,
      { idempotencyKey: `submit-${tag}-${run}` },
    )
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    expect(submitted.body.item.state).toBe('confirmed')
    const packed = await call<{ invoice: { id: string; totalPaise: number } | null }>(
      app,
      packer,
      'POST',
      `/warehouse/orders/${orderId}/pack`,
      { idempotencyKey: `pack-${tag}-${run}`, id: uuidv7(), packages: 1 },
    )
    expect(packed.status, JSON.stringify(packed.body)).toBe(200)
    return {
      orderId,
      invoiceId: packed.body.invoice?.id ?? '',
      totalPaise: packed.body.invoice?.totalPaise ?? 0,
      orderNo: submitted.body.item.orderNo,
    }
  }

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `s03-${run}`, legalName: 'S03 Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91961${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91961${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91961${run}3`, name: 'Accountant' },
      { id: packerId, phone: `+91961${run}4`, name: 'Packer' },
      { id: repId, phone: `+91961${run}5`, name: 'Rep' },
      { id: driverId, phone: `+91961${run}6`, name: 'Driver' },
      { id: shopUserA, phone: `+91962${run}1`, name: 'Shopkeeper A' },
      { id: shopUserB, phone: `+91962${run}2`, name: 'Shopkeeper B' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserA, role: 'retailer' },
      { id: uuidv7(), tenantId, userId: shopUserB, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker s03 ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Namkeen', category: 'namkeen' })
    await db.insert(productVariants).values({
      id: variantA,
      productId,
      name: 'Namkeen 50 g',
      netQty: 50,
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
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, cessBps: 0, effectiveFrom: '2020-04-01' })

    const shops: [string, string, string, string][] = [
      [retailerA, shopUserA, 'A', '27AAXPT9021Q1ZQ'],
      [retailerB, shopUserB, 'B', '27AABCU9603R1ZX'],
    ]
    for (const [retailerId, userId, tag, gstin] of shops) {
      const identityId = uuidv7()
      const phone = `+91963${run}${tag === 'A' ? 1 : 2}`
      await db
        .insert(retailerIdentities)
        .values({ id: identityId, phone, userId, shopName: `S03 Shop ${tag} ${run}` })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `S03-${tag}-${run}`,
        name: `S03 Shop ${tag} ${run}`,
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
        batchNo: `S03-${run}`,
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
          idempotencyKey: `open-s03-${run}`,
        },
      ])
    })

    const vehicle = await call<{ item: { id: string; locationId: string } }>(
      app,
      owner,
      'POST',
      '/delivery/vehicles',
      {
        idempotencyKey: `vehicle-s03-${run}`,
        id: vehicleId,
        regNo: `MH-05-S3-${run.slice(-4)}`,
        name: 'Tempo S03',
        kind: 'tempo',
        capacityCases: 120,
      },
    )
    expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(200)
    vehicleLocation = vehicle.body.item.locationId
    const consent = await call(app, driver, 'POST', '/delivery/consents', {
      idempotencyKey: `consent-s03-${run}`,
      id: uuidv7(),
      granted: true,
      noticeVersion: 'gps-2026-09',
    })
    expect(consent.status, JSON.stringify(consent.body)).toBe(200)
  }, 180_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  it('S-03: a bill returned undelivered after its CONFIRMED load sheet — can it go on a load sheet for the next trip?', async () => {
    log('tenantId', tenantId)
    log('today (IST)', today)

    // ---- two packed bills: R rides trip 1 and comes back; F is a fresh bill for trip 2
    const billR = await billedOrder(retailerA, 'returned')
    const billF = await billedOrder(retailerB, 'fresh')
    log('billR', billR)
    log('billF', billF)

    // The e-way bill threshold set so ONE bill is below it and BOTH bills together reach it.
    const threshold = billR.totalPaise + billF.totalPaise
    await db
      .insert(tenantSettings)
      .values({ tenantId, key: TENANT_SETTING_KEYS.ewbIntraStateThreshold, value: threshold })
      .onConflictDoUpdate({
        target: [tenantSettings.tenantId, tenantSettings.key],
        set: { value: threshold },
      })
    log('ewb threshold paise (tenant setting)', threshold)

    // ================= TRIP 1: planned, loaded on a confirmed sheet, departs, the shop is closed
    const trip1 = uuidv7()
    const stop1 = uuidv7()
    const t1 = await call<{ item: { state: string; tripNo: string | null } }>(
      app,
      manager,
      'POST',
      '/delivery/trips',
      {
        idempotencyKey: `trip1-${run}`,
        id: trip1,
        tripDate: today,
        vehicleId,
        driverId,
        openingCashPaise: 0,
        stops: [{ id: stop1, sequence: 1, retailerId: retailerA, invoiceIds: [billR.invoiceId] }],
      },
    )
    log('1. POST /delivery/trips (manager) trip1', { status: t1.status, state: t1.body.item?.state, tripNo: t1.body.item?.tripNo })
    expect(t1.status, JSON.stringify(t1.body)).toBe(200)

    const load1 = await call(app, packer, 'POST', `/delivery/trips/${trip1}/start-loading`, {
      idempotencyKey: `loading1-${run}`,
    })
    log('2. POST start-loading trip1 (warehouse)', { status: load1.status })
    expect(load1.status, JSON.stringify(load1.body)).toBe(200)

    const sheet1 = uuidv7()
    const s1 = await call<{ item: { status: string; loadValuePaise: number; ewbRequired: boolean; expectedPackages: number } }>(
      app,
      packer,
      'POST',
      '/warehouse/load-sheets',
      {
        idempotencyKey: `sheet1-${run}`,
        id: sheet1,
        toLocationId: vehicleLocation,
        tripId: trip1,
        orderIds: [billR.orderId],
      },
    )
    log('3. POST /warehouse/load-sheets (warehouse) sheet1 [R]', {
      status: s1.status,
      sheetStatus: s1.body.item?.status,
      loadValuePaise: s1.body.item?.loadValuePaise,
      ewbRequired: s1.body.item?.ewbRequired,
      expectedPackages: s1.body.item?.expectedPackages,
    })
    expect(s1.status, JSON.stringify(s1.body)).toBe(200)

    const a1 = await call(app, manager, 'POST', `/warehouse/load-sheets/${sheet1}/approve`, {
      idempotencyKey: `approve1-${run}`,
    })
    log('4. POST approve sheet1 (manager)', { status: a1.status })
    expect(a1.status, JSON.stringify(a1.body)).toBe(200)

    const c1 = await call<{ item: { status: string; challanNo: string | null }; dispatched: string[] }>(
      app,
      packer,
      'POST',
      `/warehouse/load-sheets/${sheet1}/confirm`,
      { idempotencyKey: `confirm1-${run}`, countedPackages: 1, challanId: uuidv7() },
    )
    log('5. POST confirm sheet1 (warehouse)', {
      status: c1.status,
      sheetStatus: c1.body.item?.status,
      challanNo: c1.body.item?.challanNo,
      dispatched: c1.body.dispatched,
    })
    expect(c1.status, JSON.stringify(c1.body)).toBe(200)
    log('   order R state after confirm', await orderState(billR.orderId))

    const d1 = await call<{ item: { state: string; loadSheetIds: string[] } }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${trip1}/depart`,
      { idempotencyKey: `depart1-${run}` },
    )
    log('6. POST depart trip1 (delivery)', { status: d1.status, state: d1.body.item?.state, loadSheetIds: d1.body.item?.loadSheetIds })
    expect(d1.status, JSON.stringify(d1.body)).toBe(200)

    const st = await call(app, driver, 'POST', `/delivery/stops/${stop1}/start`, {
      idempotencyKey: `start1-${run}`,
    })
    const ar = await call(app, driver, 'POST', `/delivery/stops/${stop1}/arrive`, {
      idempotencyKey: `arrive1-${run}`,
      lat: 19.2437,
      lng: 73.1355,
    })
    const fl = await call<{ item: { state: string; failureReason: string | null } }>(
      app,
      driver,
      'POST',
      `/delivery/stops/${stop1}/fail`,
      { idempotencyKey: `fail1-${run}`, failureReason: 'shop_closed' },
    )
    log('7. POST stop start/arrive/fail shop_closed (delivery)', {
      start: st.status,
      arrive: ar.status,
      fail: fl.status,
      stopState: fl.body.item?.state,
      failureReason: fl.body.item?.failureReason,
    })
    expect(fl.status, JSON.stringify(fl.body)).toBe(200)
    const stateAfterFail = await orderState(billR.orderId)
    log('   order R state after the failed stop', stateAfterFail)

    const rt = await call<{ item: { state: string } }>(app, driver, 'POST', `/delivery/trips/${trip1}/return`, {
      idempotencyKey: `return1-${run}`,
    })
    log('8. POST return trip1 (delivery)', { status: rt.status, state: rt.body.item?.state })
    expect(rt.status, JSON.stringify(rt.body)).toBe(200)

    const se = await call<{ tripState: string; item: { hasVariance: boolean } }>(
      app,
      accountant,
      'POST',
      `/delivery/trips/${trip1}/settle`,
      { idempotencyKey: `settle1-${run}`, id: uuidv7(), tripId: trip1, handedOverCashPaise: 0, counted: [] },
    )
    log('9. POST settle trip1 (accountant)', { status: se.status, tripState: se.body.tripState, hasVariance: se.body.item?.hasVariance, body: se.status === 200 ? undefined : se.body })
    expect(se.status, JSON.stringify(se.body)).toBe(200)
    log('   order R state after settlement', await orderState(billR.orderId))

    // ================= The next day's planning, as W7 / W10 / M7 read it
    const awaiting = await call<{ items: { orderId: string }[] }>(app, packer, 'GET', '/warehouse/packs', {
      status: 'awaiting_load',
      limit: 50,
    })
    log('10. GET /warehouse/packs?status=awaiting_load (W7)', {
      status: awaiting.status,
      offersR: awaiting.body.items?.some((p) => p.orderId === billR.orderId),
      offersF: awaiting.body.items?.some((p) => p.orderId === billF.orderId),
      count: awaiting.body.items?.length,
    })
    const board = await call<{ bills: { invoiceId: string; orderId: string }[] }>(
      app,
      packer,
      'GET',
      '/delivery/trip-planning',
      { date: today },
    )
    log('11. GET /delivery/trip-planning (W10/M7 board)', {
      status: board.status,
      offersR: board.body.bills?.some((b) => b.orderId === billR.orderId),
      offersF: board.body.bills?.some((b) => b.orderId === billF.orderId),
    })

    // ================= TRIP 2: the re-attempt, planned with R and the fresh F
    const trip2 = uuidv7()
    const t2 = await call<{ item: { state: string; tripNo: string | null } }>(
      app,
      packer,
      'POST',
      '/delivery/trips',
      {
        idempotencyKey: `trip2-${run}`,
        id: trip2,
        tripDate: today,
        vehicleId,
        driverId,
        openingCashPaise: 0,
        stops: [
          { id: uuidv7(), sequence: 1, retailerId: retailerA, invoiceIds: [billR.invoiceId] },
          { id: uuidv7(), sequence: 2, retailerId: retailerB, invoiceIds: [billF.invoiceId] },
        ],
      },
    )
    log('12. POST /delivery/trips (warehouse) trip2 [R, F]', { status: t2.status, state: t2.body.item?.state, tripNo: t2.body.item?.tripNo, body: t2.status === 200 ? undefined : t2.body })
    expect(t2.status, JSON.stringify(t2.body)).toBe(200)
    const load2 = await call(app, packer, 'POST', `/delivery/trips/${trip2}/start-loading`, {
      idempotencyKey: `loading2-${run}`,
    })
    log('13. POST start-loading trip2 (warehouse)', { status: load2.status })

    const both = await call<{ message?: string }>(app, packer, 'POST', '/warehouse/load-sheets', {
      idempotencyKey: `sheet2-both-${run}`,
      id: uuidv7(),
      toLocationId: vehicleLocation,
      tripId: trip2,
      orderIds: [billR.orderId, billF.orderId],
    })
    log('14. POST /warehouse/load-sheets (warehouse) trip2 [R, F]', { status: both.status, body: both.body })
    const onlyR = await call<{ message?: string }>(app, packer, 'POST', '/warehouse/load-sheets', {
      idempotencyKey: `sheet2-r-${run}`,
      id: uuidv7(),
      toLocationId: vehicleLocation,
      tripId: trip2,
      orderIds: [billR.orderId],
    })
    log('15. POST /warehouse/load-sheets (warehouse) trip2 [R]', { status: onlyR.status, body: onlyR.body })
    const deskR = await call<{ message?: string }>(app, manager, 'POST', '/warehouse/load-sheets', {
      idempotencyKey: `sheet2-desk-r-${run}`,
      id: uuidv7(),
      toLocationId: vehicleLocation,
      tripId: trip2,
      orderIds: [billR.orderId],
    })
    log('16. POST /warehouse/load-sheets (manager) trip2 [R]', { status: deskR.status, body: deskR.body })
    const cancelOld = await call<{ message?: string }>(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${sheet1}/cancel`,
      { idempotencyKey: `cancel-sheet1-${run}`, reason: 'bill came back, reload it' },
    )
    log('17. POST cancel sheet1 (manager) — the old confirmed sheet', { status: cancelOld.status, body: cancelOld.body })

    // The only sheet the godown CAN build for trip 2 carries F alone.
    const sheet2 = uuidv7()
    const s2 = await call<{ item: { status: string; loadValuePaise: number; ewbRequired: boolean; expectedPackages: number; orderIds?: string[] } }>(
      app,
      packer,
      'POST',
      '/warehouse/load-sheets',
      {
        idempotencyKey: `sheet2-f-${run}`,
        id: sheet2,
        toLocationId: vehicleLocation,
        tripId: trip2,
        orderIds: [billF.orderId],
      },
    )
    log('18. POST /warehouse/load-sheets (warehouse) trip2 [F]', {
      status: s2.status,
      sheetStatus: s2.body.item?.status,
      loadValuePaise: s2.body.item?.loadValuePaise,
      ewbRequired: s2.body.item?.ewbRequired,
      expectedPackages: s2.body.item?.expectedPackages,
    })
    expect(s2.status, JSON.stringify(s2.body)).toBe(200)
    const a2 = await call(app, manager, 'POST', `/warehouse/load-sheets/${sheet2}/approve`, {
      idempotencyKey: `approve2-${run}`,
    })
    const c2 = await call<{ item: { status: string; challanNo: string | null }; dispatched: string[]; challan: { challanNo: string | null; valuePaise: number } }>(
      app,
      packer,
      'POST',
      `/warehouse/load-sheets/${sheet2}/confirm`,
      { idempotencyKey: `confirm2-${run}`, countedPackages: 1, challanId: uuidv7() },
    )
    log('19. approve (manager) + confirm (warehouse) sheet2 [F] with NO e-way bill number', {
      approve: a2.status,
      confirm: c2.status,
      sheetStatus: c2.body.item?.status,
      challanNo: c2.body.challan?.challanNo,
      challanValuePaise: c2.body.challan?.valuePaise,
      dispatched: c2.body.dispatched,
      body: c2.status === 200 ? undefined : c2.body,
    })
    log('   order R state before trip2 departs', await orderState(billR.orderId))

    const d2 = await call<{ item: { state: string; loadSheetIds: string[]; loadConfirmedAt: string | null } }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${trip2}/depart`,
      { idempotencyKey: `depart2-${run}` },
    )
    log('20. POST depart trip2 (delivery)', {
      status: d2.status,
      state: d2.body.item?.state,
      loadSheetIds: d2.body.item?.loadSheetIds,
      body: d2.status === 200 ? undefined : d2.body,
    })
    log('   order R state after trip2 departs', await orderState(billR.orderId))
    log('   order F state after trip2 departs', await orderState(billF.orderId))

    // ================= Rows (owner connection, read-only)
    const sheets = (
      await db.execute(sql`
        select id, trip_id, status::text as status, order_ids, expected_packages, counted_packages,
               load_value_paise, ewb_required, ewb_no, challan_no, approved_by is not null as approved
          from load_sheets where tenant_id = ${tenantId} order by id`)
    ).rows
    log('ROWS load_sheets', sheets)
    const challans = (
      await db.execute(sql`
        select challan_no, load_sheet_id, value_paise, ewb_no, jsonb_array_length(lines) as line_count
          from delivery_challans where tenant_id = ${tenantId} order by challan_no`)
    ).rows
    log('ROWS delivery_challans', challans)
    const dels = (
      await db.execute(sql`
        select d.invoice_id = ${billR.invoiceId} as is_r, d.trip_id = ${trip1} as trip1, d.trip_id = ${trip2} as trip2,
               d.outcome::text as outcome, t.state::text as trip_state
          from deliveries d join trips t on t.id = d.trip_id
         where d.tenant_id = ${tenantId} order by d.id`)
    ).rows
    log('ROWS deliveries (R/F per trip)', dels)
    const orderEvents = (
      await db.execute(sql`
        select event_type from outbox_events
         where tenant_id = ${tenantId} and aggregate_id = ${billR.orderId} order by id`)
    ).rows
    log('ROWS outbox_events for order R', orderEvents)
    const transitions = (
      await db.execute(sql`select * from order_state_transitions where order_id = ${billR.orderId}`)
    ).rows as Record<string, unknown>[]
    log(
      'ROWS order_state_transitions for order R',
      transitions.map((r) => ({
        from: r.from_state,
        to: r.to_state,
        event: r.event,
        reason: r.reason,
        at: r.occurred_at,
      })),
    )
    const onLive = (
      await db.execute(sql`
        select ls.id, ls.status::text as status from load_sheets ls, jsonb_array_elements_text(ls.order_ids) o
         where ls.tenant_id = ${tenantId} and ls.status <> 'cancelled' and o.value = ${billR.orderId}`)
    ).rows
    log('ROWS onALiveSheet query for R (the create guard)', onLive)

    // ================= The suspect's claims, checked softly so every observation above is printed
    expect.soft(stateAfterFail, 'return_undelivered puts R back to packed').toBe('packed')
    expect.soft(awaiting.body.items?.some((p) => p.orderId === billR.orderId), 'W7 does not offer R').toBe(false)
    expect.soft(both.status, 'a sheet with R and F is refused').toBe(409)
    expect.soft(onlyR.status, 'a sheet with R alone is refused').toBe(409)
    expect.soft(deskR.status, 'the desk is refused too').toBe(409)
    expect.soft(cancelOld.status, 'the old confirmed sheet cannot be cancelled').toBe(409)
    expect.soft(d2.status, 'trip2 still departs').toBe(200)
    expect.soft(await orderState(billR.orderId), 'R leaves on trip2 with no sheet').toBe('dispatched')
  }, 300_000)
})
