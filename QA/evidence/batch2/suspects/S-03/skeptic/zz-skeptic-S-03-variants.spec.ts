// QA SKEPTIC S-03 variants (temporary; deleted after the run). The three doorstep paths the prober only read:
// (1) the delivery app's OFFLINE stop failure (/sync/upload trip_stops PATCH failed), (2) refused at the door
// (/sync/upload deliveries PUT with nothing delivered), (3) trips.return failing a still-open stop. Each bill
// rode on a CONFIRMED load sheet first. Then: can the godown put any of them on a load sheet for the next trip?
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
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/suspects/S-03/skeptic/variants-log.txt'
const log = (label: string, value: unknown): void => {
  const line = `[S-03v] ${label}: ${JSON.stringify(value)}`
  appendFileSync(LOG_FILE, `${line}\n`)
  console.log(line)
}

type TripBody = { state: string; stops: { id: string; deliveries: { id: string; invoiceId: string }[] }[] }
type UploadBody = { accepted: number; rejected: { opId: string; code: string; message?: string }[] }

describeDb('S-03 skeptic variants (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `7${run.slice(-6)}`

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
  ): Promise<{ orderId: string; invoiceId: string; totalPaise: number }> {
    const orderId = uuidv7()
    const created = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `order-${tag}-${run}`,
      id: orderId,
      retailerId,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'case' }],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const submitted = await call(app, rep, 'POST', `/orders/${orderId}/submit`, {
      idempotencyKey: `submit-${tag}-${run}`,
    })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
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
    }
  }

  async function loadOut(tripId: string, orderIds: string[], tag: string): Promise<void> {
    const sheetId = uuidv7()
    const s = await call(app, packer, 'POST', '/warehouse/load-sheets', {
      idempotencyKey: `sheet-${tag}-${run}`,
      id: sheetId,
      toLocationId: vehicleLocation,
      tripId,
      orderIds,
    })
    const a = await call(app, manager, 'POST', `/warehouse/load-sheets/${sheetId}/approve`, {
      idempotencyKey: `approve-${tag}-${run}`,
    })
    const c = await call<{ item: { status: string; challanNo: string | null } }>(
      app,
      packer,
      'POST',
      `/warehouse/load-sheets/${sheetId}/confirm`,
      { idempotencyKey: `confirm-${tag}-${run}`, countedPackages: orderIds.length, challanId: uuidv7() },
    )
    log(`${tag} load-out (create/approve/confirm)`, {
      create: s.status,
      approve: a.status,
      confirm: c.status,
      sheetStatus: c.body.item?.status,
      challanNo: c.body.item?.challanNo,
    })
    expect(c.status, JSON.stringify(c.body)).toBe(200)
  }

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `s03v-${run}`, legalName: 'S03V Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91971${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91971${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91971${run}3`, name: 'Accountant' },
      { id: packerId, phone: `+91971${run}4`, name: 'Packer' },
      { id: repId, phone: `+91971${run}5`, name: 'Rep' },
      { id: driverId, phone: `+91971${run}6`, name: 'Driver' },
      { id: shopUserA, phone: `+91972${run}1`, name: 'Shopkeeper A' },
      { id: shopUserB, phone: `+91972${run}2`, name: 'Shopkeeper B' },
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
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker s03v ${run}` })
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
      const phone = `+91973${run}${tag === 'A' ? 1 : 2}`
      await db
        .insert(retailerIdentities)
        .values({ id: identityId, phone, userId, shopName: `S03V Shop ${tag} ${run}` })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `S03V-${tag}-${run}`,
        name: `S03V Shop ${tag} ${run}`,
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
        batchNo: `S03V-${run}`,
        mrpPaise: 1000,
        expiryDate: '2028-01-31',
      })
      await inventory.post(tx, [
        {
          lotId: a.lot.id,
          locationId: godown,
          qtyDelta: 1_000,
          reason: 'opening',
          idempotencyKey: `open-s03v-${run}`,
        },
      ])
    })

    const vehicle = await call<{ item: { id: string; locationId: string } }>(
      app,
      owner,
      'POST',
      '/delivery/vehicles',
      {
        idempotencyKey: `vehicle-s03v-${run}`,
        id: vehicleId,
        regNo: `MH-05-SV-${run.slice(-4)}`,
        name: 'Tempo S03V',
        kind: 'tempo',
        capacityCases: 120,
      },
    )
    expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(200)
    vehicleLocation = vehicle.body.item.locationId
    const consent = await call(app, driver, 'POST', '/delivery/consents', {
      idempotencyKey: `consent-s03v-${run}`,
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

  it('S-03 variants: offline stop fail, refused at the door, trips.return — each bill then refused by loadSheets.create', async () => {
    log('tenantId', tenantId)
    const g1 = await billedOrder(retailerA, 'g1-offline-fail')
    const g2 = await billedOrder(retailerB, 'g2-refused-door')
    const g3 = await billedOrder(retailerA, 'g3-trip-return')
    log('bills', { g1, g2, g3 })

    // ============ TRIP 1: G1 at shop A, G2 at shop B, loaded on a confirmed sheet, departs
    const trip1 = uuidv7()
    const stopA = uuidv7()
    const stopB = uuidv7()
    const t1 = await call(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `v-trip1-${run}`,
      id: trip1,
      tripDate: today,
      vehicleId,
      driverId,
      openingCashPaise: 0,
      stops: [
        { id: stopA, sequence: 1, retailerId: retailerA, invoiceIds: [g1.invoiceId] },
        { id: stopB, sequence: 2, retailerId: retailerB, invoiceIds: [g2.invoiceId] },
      ],
    })
    expect(t1.status, JSON.stringify(t1.body)).toBe(200)
    expect(
      (await call(app, packer, 'POST', `/delivery/trips/${trip1}/start-loading`, { idempotencyKey: `v-l1-${run}` }))
        .status,
    ).toBe(200)
    await loadOut(trip1, [g1.orderId, g2.orderId], 'trip1')
    const d1 = await call(app, driver, 'POST', `/delivery/trips/${trip1}/depart`, { idempotencyKey: `v-d1-${run}` })
    log('trip1 depart (delivery)', { status: d1.status })
    expect(d1.status, JSON.stringify(d1.body)).toBe(200)

    // What the phone holds for stop B: its planned delivery row and the updated_at the pull delivered.
    const onPhone = await call<{ item: TripBody }>(app, driver, 'GET', `/delivery/trips/${trip1}`)
    const deliveryB = onPhone.body.item.stops.find((s) => s.id === stopB)?.deliveries[0]?.id ?? ''
    const [heldB] = (await db.execute(sql`select updated_at from deliveries where id = ${deliveryB}`)).rows as {
      updated_at: Date | string
    }[]
    const [lineG2] = (
      await db.execute(sql`select id, qty_pcs, free_qty_pcs from invoice_lines where invoice_id = ${g2.invoiceId}`)
    ).rows as { id: string; qty_pcs: number; free_qty_pcs: number }[]
    const at = new Date().toISOString()
    const deviceId = `driver-phone-s03v-${run}`

    // (1) + (2): the delivery app's offline queue, as src/lib/local.ts shapes it
    const up = await call<UploadBody>(app, driver, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId,
      ops: [
        { opId: `v-a-start-${run}`, op: 'PATCH', table: 'trip_stops', id: stopA, data: { state: 'started', occurred_at: at } },
        {
          opId: `v-a-arrive-${run}`,
          op: 'PATCH',
          table: 'trip_stops',
          id: stopA,
          data: { state: 'arrived', occurred_at: at, lat: 19.2437, lng: 73.1355 },
        },
        {
          opId: `v-a-fail-${run}`,
          op: 'PATCH',
          table: 'trip_stops',
          id: stopA,
          data: { state: 'failed', occurred_at: at, failure_reason: 'shop_closed', failure_note: 'shutter down' },
        },
        { opId: `v-b-start-${run}`, op: 'PATCH', table: 'trip_stops', id: stopB, data: { state: 'started', occurred_at: at } },
        {
          opId: `v-b-arrive-${run}`,
          op: 'PATCH',
          table: 'trip_stops',
          id: stopB,
          data: { state: 'arrived', occurred_at: at, lat: 19.2437, lng: 73.1355 },
        },
        {
          opId: `v-b-refused-${run}`,
          op: 'PUT',
          table: 'deliveries',
          id: deliveryB,
          baseUpdatedAt: new Date(heldB?.updated_at ?? 0).toISOString(),
          data: {
            trip_id: trip1,
            stop_id: stopB,
            invoice_id: g2.invoiceId,
            retailer_id: retailerB,
            order_id: g2.orderId,
            delivered_at: at,
            device_id: deviceId,
            lines: [
              {
                id: uuidv7(),
                invoice_line_id: lineG2?.id,
                delivered_qty_pcs: 0,
                returned_qty_pcs: Number(lineG2?.qty_pcs ?? 0) + Number(lineG2?.free_qty_pcs ?? 0),
                returned_saleable: true,
                reason: 'refused',
              },
            ],
            pod: [],
          },
        },
      ],
    })
    log('POST /sync/upload (delivery) offline: stop A fail shop_closed; stop B refused at door', {
      status: up.status,
      accepted: up.body.accepted,
      rejected: up.body.rejected,
    })
    log('   G1 state after offline stop fail', await orderState(g1.orderId))
    log('   G2 state after refused-at-door delivery', await orderState(g2.orderId))
    const r1 = await call<{ item: { state: string } }>(app, driver, 'POST', `/delivery/trips/${trip1}/return`, {
      idempotencyKey: `v-r1-${run}`,
    })
    const s1 = await call<{ tripState: string }>(app, accountant, 'POST', `/delivery/trips/${trip1}/settle`, {
      idempotencyKey: `v-s1-${run}`,
      id: uuidv7(),
      tripId: trip1,
      handedOverCashPaise: 0,
      counted: [],
    })
    log('trip1 return + settle', { return: r1.status, settle: s1.status, tripState: s1.body.tripState, body: s1.status === 200 ? undefined : s1.body })

    // ============ TRIP 1b: G3 at shop A, confirmed sheet, departs, returns with the stop still open
    const trip1b = uuidv7()
    const stopA3 = uuidv7()
    const t1b = await call(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `v-trip1b-${run}`,
      id: trip1b,
      tripDate: today,
      vehicleId,
      driverId,
      openingCashPaise: 0,
      stops: [{ id: stopA3, sequence: 1, retailerId: retailerA, invoiceIds: [g3.invoiceId] }],
    })
    log('trip1b create (manager)', { status: t1b.status, body: t1b.status === 200 ? undefined : t1b.body })
    expect(t1b.status, JSON.stringify(t1b.body)).toBe(200)
    expect(
      (await call(app, packer, 'POST', `/delivery/trips/${trip1b}/start-loading`, { idempotencyKey: `v-l1b-${run}` }))
        .status,
    ).toBe(200)
    await loadOut(trip1b, [g3.orderId], 'trip1b')
    const d1b = await call(app, driver, 'POST', `/delivery/trips/${trip1b}/depart`, { idempotencyKey: `v-d1b-${run}` })
    const r1b = await call(app, driver, 'POST', `/delivery/trips/${trip1b}/return`, { idempotencyKey: `v-r1b-${run}` })
    log('trip1b depart + return with the stop still open (trips.return)', { depart: d1b.status, return: r1b.status })
    log('   G3 state after trips.return', await orderState(g3.orderId))
    const s1b = await call<{ tripState: string }>(app, accountant, 'POST', `/delivery/trips/${trip1b}/settle`, {
      idempotencyKey: `v-s1b-${run}`,
      id: uuidv7(),
      tripId: trip1b,
      handedOverCashPaise: 0,
      counted: [],
    })
    log('trip1b settle', { status: s1b.status, tripState: s1b.body.tripState })

    // ============ The next day's read, as W7 and W10/M7 make it
    const awaiting = await call<{ items: { orderId: string }[] }>(app, packer, 'GET', '/warehouse/packs', {
      status: 'awaiting_load',
      limit: 50,
    })
    log('GET /warehouse/packs?status=awaiting_load (W7)', {
      status: awaiting.status,
      offersG1: awaiting.body.items?.some((p) => p.orderId === g1.orderId),
      offersG2: awaiting.body.items?.some((p) => p.orderId === g2.orderId),
      offersG3: awaiting.body.items?.some((p) => p.orderId === g3.orderId),
      count: awaiting.body.items?.length,
    })
    const board = await call<{ bills: { orderId: string }[] }>(app, manager, 'GET', '/delivery/trip-planning', {
      date: today,
    })
    log('GET /delivery/trip-planning (M7, manager)', {
      status: board.status,
      offersG1: board.body.bills?.some((b) => b.orderId === g1.orderId),
      offersG2: board.body.bills?.some((b) => b.orderId === g2.orderId),
      offersG3: board.body.bills?.some((b) => b.orderId === g3.orderId),
    })

    // ============ TRIP 2: the re-attempt of all three, planned from the board
    const trip2 = uuidv7()
    const t2 = await call(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `v-trip2-${run}`,
      id: trip2,
      tripDate: today,
      vehicleId,
      driverId,
      openingCashPaise: 0,
      stops: [
        { id: uuidv7(), sequence: 1, retailerId: retailerA, invoiceIds: [g1.invoiceId, g3.invoiceId] },
        { id: uuidv7(), sequence: 2, retailerId: retailerB, invoiceIds: [g2.invoiceId] },
      ],
    })
    log('trip2 create (manager) [G1, G3 @A; G2 @B]', { status: t2.status, body: t2.status === 200 ? undefined : t2.body })
    expect(t2.status, JSON.stringify(t2.body)).toBe(200)
    const l2 = await call(app, packer, 'POST', `/delivery/trips/${trip2}/start-loading`, { idempotencyKey: `v-l2-${run}` })
    log('trip2 start-loading (warehouse)', { status: l2.status })

    const tries: Record<string, { status: number; message?: string }> = {}
    for (const [tag, bill] of [
      ['G1-offline-fail', g1],
      ['G2-refused-door', g2],
      ['G3-trip-return', g3],
    ] as const) {
      const res = await call<{ message?: string }>(app, packer, 'POST', '/warehouse/load-sheets', {
        idempotencyKey: `v-sheet2-${tag}-${run}`,
        id: uuidv7(),
        toLocationId: vehicleLocation,
        tripId: trip2,
        orderIds: [bill.orderId],
      })
      tries[tag] = { status: res.status, message: res.body.message }
    }
    log('POST /warehouse/load-sheets (warehouse) trip2, one bill each', tries)

    const d2 = await call<{ item: { state: string; loadSheetIds: string[] } }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${trip2}/depart`,
      { idempotencyKey: `v-d2-${run}` },
    )
    log('trip2 depart (delivery) with no load sheet at all', {
      status: d2.status,
      state: d2.body.item?.state,
      loadSheetIds: d2.body.item?.loadSheetIds,
    })
    const lastMoves = (
      await db.execute(sql`
        select so.order_no, t.event, t.reason from order_state_transitions t join sales_orders so on so.id = t.order_id
         where t.order_id in (${g1.orderId}, ${g2.orderId}, ${g3.orderId}) and t.event in ('dispatch', 'return_undelivered')
         order by so.order_no, t.occurred_at`)
    ).rows
    log('ROWS order_state_transitions dispatch/return_undelivered for G1..G3', lastMoves)
    const sheets = (
      await db.execute(sql`
        select trip_id = ${trip2} as trip2, status::text as status, jsonb_array_length(order_ids) as orders, challan_no
          from load_sheets where tenant_id = ${tenantId} order by id`)
    ).rows
    log('ROWS load_sheets', sheets)

    expect.soft(up.body.rejected, 'offline ops all accepted').toEqual([])
    expect.soft(tries['G1-offline-fail']?.status).toBe(409)
    expect.soft(tries['G2-refused-door']?.status).toBe(409)
    expect.soft(tries['G3-trip-return']?.status).toBe(409)
    expect.soft(d2.status).toBe(200)
  }, 300_000)
})
