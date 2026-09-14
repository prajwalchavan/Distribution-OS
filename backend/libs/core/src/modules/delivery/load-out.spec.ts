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

interface TripBody {
  id: string
  tripNo: string | null
  state: string
  loadSheetIds: string[]
  stops: { id: string; state: string; deliveries: { id: string; invoiceId: string }[] }[]
}
interface PlanningBillBody {
  invoiceId: string
  invoiceNo: string | null
  invoiceTotalPaise: number
  orderId: string
  orderNo: string | null
  retailerId: string
  retailerName: string
}
interface PlanningBody {
  bills: PlanningBillBody[]
  held: (PlanningBillBody & { onTripId: string; onTripNo: string | null })[]
  nextCursor: string | null
}
interface RefusalBody {
  message: string
  data?: { code?: string; orderIds?: string[]; tripIds?: string[]; tripId?: string }
}
interface UploadBody {
  accepted: number
  rejected: { opId: string; code: string }[]
}

/**
 * QA DOS-172: a bill that comes back undelivered waits on its van until check-in, then goes out again on a
 * fresh load sheet for its next trip — and no trip departs carrying a bill no confirmed sheet counted out.
 * The fixture is the S-03 probe's (QA/evidence/batch2/suspects/S-03) plus the skeptic's doorstep variants,
 * driven through the same endpoints, roles and order the apps use.
 */
describeDb('DOS-172 load-out (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `8${run.slice(-6)}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const driverId = uuidv7()
  const otherDriverId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }
  const otherDriver: Actor = { tenantId, actorId: otherDriverId, role: 'delivery' }
  const crew = { godown: packer, approver: manager }

  const asOwner = <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
    const ctx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
    return tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  }

  const retailerA = uuidv7()
  const retailerB = uuidv7()
  const retailerC = uuidv7()
  const variantA = uuidv7()
  const variantB = uuidv7()
  const vehicleId = uuidv7()
  let vehicleLocation = ''
  let app: NestFastifyApplication

  /** IST business days from today; each test takes its own, so the one-trip-a-day crew check never meets another's. */
  const tripDay = (offset: number): string =>
    new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10)

  const orderState = async (orderId: string): Promise<string> =>
    (
      (await db.execute(sql`select state::text as state from sales_orders where id = ${orderId}`))
        .rows[0] as { state: string }
    ).state
  const tripState = async (tripId: string): Promise<string> =>
    (
      (await db.execute(sql`select state::text as state from trips where id = ${tripId}`))
        .rows[0] as { state: string }
    ).state
  /** The order's newest move, as `order_state_transitions` records it. */
  const lastTransition = async (orderId: string) =>
    (
      await db.execute(
        sql`select event, reason from order_state_transitions
             where order_id = ${orderId} order by occurred_at desc, id desc limit 1`,
      )
    ).rows[0] as { event: string; reason: string | null }
  const outboxTypes = async (aggregateId: string): Promise<string[]> =>
    (
      (
        await db.execute(
          sql`select event_type from outbox_events
               where tenant_id = ${tenantId} and aggregate_id = ${aggregateId} order by id`,
        )
      ).rows as { event_type: string }[]
    ).map((r) => r.event_type)
  const departAudits = async (tripId: string): Promise<number> =>
    Number(
      (
        (
          await db.execute(
            sql`select count(*)::int as n from audit_log
                 where tenant_id = ${tenantId} and entity_type = 'trip' and entity_id = ${tripId}
                   and action = 'trip.depart'`,
          )
        ).rows[0] as { n: number }
      ).n,
    )

  /** An order placed by the rep, confirmed, and packed by the godown, so a real bill exists. */
  async function billedOrder(
    retailerId: string,
    variantId: string,
    tag: string,
  ): Promise<{ orderId: string; invoiceId: string; totalPaise: number; orderNo: string | null }> {
    const orderId = uuidv7()
    const created = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `order-${tag}-${run}`,
      id: orderId,
      retailerId,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId, enteredQty: 1, enteredUnit: 'case' }],
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

  /** A trip planned by the desk for `driverOf`, then put on the dock by the godown. */
  async function loadingTrip(
    tag: string,
    day: string,
    driverOf: string,
    stops: { stopId: string; retailerId: string; invoiceIds: string[] }[],
  ): Promise<TripBody> {
    const tripId = uuidv7()
    const planned = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `trip-${tag}-${run}`,
      id: tripId,
      tripDate: day,
      vehicleId,
      driverId: driverOf,
      openingCashPaise: 0,
      stops: stops.map((s, i) => ({
        id: s.stopId,
        sequence: i + 1,
        retailerId: s.retailerId,
        invoiceIds: s.invoiceIds,
      })),
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    const loading = await call<{ item: TripBody }>(
      app,
      packer,
      'POST',
      `/delivery/trips/${tripId}/start-loading`,
      { idempotencyKey: `loading-${tag}-${run}` },
    )
    expect(loading.status, JSON.stringify(loading.body)).toBe(200)
    return loading.body.item
  }

  async function post<T>(actor: Actor, path: string, body: Record<string, unknown>) {
    return call<T>(app, actor, 'POST', path, body)
  }

  /** The crew at a shop that is closed: start, arrive, fail. The order goes back to `packed`. */
  async function shopClosed(stopId: string, tag: string): Promise<void> {
    for (const [step, body] of [
      ['start', {}],
      ['arrive', { lat: 19.2437, lng: 73.1355 }],
      ['fail', { failureReason: 'shop_closed' }],
    ] as const) {
      const res = await post(driver, `/delivery/stops/${stopId}/${step}`, {
        idempotencyKey: `${step}-${tag}-${run}`,
        ...body,
      })
      expect(res.status, `${step} → ${JSON.stringify(res.body)}`).toBe(200)
    }
  }

  const planning = async (day: string): Promise<PlanningBody> => {
    const board = await call<PlanningBody>(app, packer, 'GET', '/delivery/trip-planning', {
      date: day,
      limit: 200,
    })
    expect(board.status, JSON.stringify(board.body)).toBe(200)
    return board.body
  }

  /** W7's "Packed orders", every page to the end; `sparse` counts pages shorter than `limit` with a cursor. */
  async function walkAwaiting(
    limit: number,
  ): Promise<{ orderIds: string[]; sparse: number; pages: number }> {
    const orderIds: string[] = []
    let sparse = 0
    let cursor: string | undefined
    for (let pages = 1; pages <= 500; pages += 1) {
      const page = await call<{ items: { orderId: string }[]; nextCursor: string | null }>(
        app,
        packer,
        'GET',
        '/warehouse/packs',
        { status: 'awaiting_load', limit, cursor },
      )
      expect(page.status, JSON.stringify(page.body)).toBe(200)
      orderIds.push(...page.body.items.map((p) => p.orderId))
      if (page.body.nextCursor === null) return { orderIds, sparse, pages }
      if (page.body.items.length < limit) sparse += 1
      cursor = page.body.nextCursor
    }
    throw new Error('packs.list?status=awaiting_load never ended its cursor walk')
  }

  const newSheet = (actor: Actor, orderIds: string[], tag: string, tripId?: string) =>
    post<RefusalBody & { item: { status: string } }>(actor, '/warehouse/load-sheets', {
      idempotencyKey: `sheet-${tag}-${run}`,
      id: uuidv7(),
      toLocationId: vehicleLocation,
      ...(tripId === undefined ? {} : { tripId }),
      orderIds,
    })

  beforeAll(async () => {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `dos172-${run}`,
      legalName: 'Load Out Traders',
      stateCode: '27',
    })
    const staff: [string, string, string, Actor['role']][] = [
      [ownerId, '1', 'Owner', 'owner'],
      [managerId, '2', 'Manager', 'manager'],
      [accountantId, '3', 'Accountant', 'accountant'],
      [packerId, '4', 'Packer', 'warehouse'],
      [repId, '5', 'Rep', 'salesperson'],
      [driverId, '6', 'Driver', 'delivery'],
      [otherDriverId, '7', 'Other driver', 'delivery'],
    ]
    await db
      .insert(users)
      .values(staff.map(([id, n, name]) => ({ id, phone: `+91981${run}${n}`, name })))
    await db
      .insert(memberships)
      .values(staff.map(([userId, , , role]) => ({ id: uuidv7(), tenantId, userId, role })))
    await bootstrapTenant(db, tenantId)

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker dos172 ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Namkeen', category: 'namkeen' })
    await db.insert(productVariants).values([
      {
        id: variantA,
        productId,
        name: 'Namkeen 50 g',
        netQty: 50,
        netUnit: 'g',
        defaultCaseSize: 12,
        hsnCode: hsn,
        mrpPaise: 1000,
      },
      {
        id: variantB,
        productId,
        name: 'Namkeen 100 g',
        netQty: 100,
        netUnit: 'g',
        defaultCaseSize: 12,
        hsnCode: hsn,
        mrpPaise: 2000,
      },
    ])
    await db.insert(tenantProducts).values([
      { id: uuidv7(), tenantId, variantId: variantA, caseSizeOverride: 12 },
      { id: uuidv7(), tenantId, variantId: variantB, caseSizeOverride: 12 },
    ])
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, cessBps: 0, effectiveFrom: '2020-04-01' })

    const shops: [string, string, string][] = [
      [retailerA, 'A', '27AAXPT9021Q1ZQ'],
      [retailerB, 'B', '27AABCU9603R1ZX'],
      [retailerC, 'C', '27AAXPT9021Q1ZQ'],
    ]
    for (const [retailerId, tag, gstin] of shops) {
      const shopUser = uuidv7()
      const identityId = uuidv7()
      const phone = `+91983${run}${tag === 'A' ? 1 : tag === 'B' ? 2 : 3}`
      await db.insert(users).values({ id: shopUser, phone, name: `Shopkeeper ${tag}` })
      await db
        .insert(memberships)
        .values({ id: uuidv7(), tenantId, userId: shopUser, role: 'retailer' })
      await db
        .insert(retailerIdentities)
        .values({ id: identityId, phone, userId: shopUser, shopName: `Load Shop ${tag} ${run}` })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `LO-${tag}-${run}`,
        name: `Load Shop ${tag} ${run}`,
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
      { id: uuidv7(), tenantId, priceListId, variantId: variantA, ratePaise: 1000 },
      { id: uuidv7(), tenantId, priceListId, variantId: variantB, ratePaise: 2000 },
    ])

    const godown =
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
        [variantA, 'A', 1000],
        [variantB, 'B', 2000],
      ] as const) {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId,
          batchNo: `LO-${tag}-${run}`,
          mrpPaise,
          expiryDate: '2028-01-31',
        })
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: 1_000,
            reason: 'opening',
            idempotencyKey: `open-dos172-${tag}-${run}`,
          },
        ])
      }
    })

    const vehicle = await post<{ item: { locationId: string } }>(owner, '/delivery/vehicles', {
      idempotencyKey: `vehicle-dos172-${run}`,
      id: vehicleId,
      regNo: `MH-05-LO-${run.slice(-4)}`,
      name: 'Tempo DOS-172',
      kind: 'tempo',
      capacityCases: 120,
    })
    expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(200)
    vehicleLocation = vehicle.body.item.locationId
    for (const [actor, tag] of [
      [driver, 'driver'],
      [otherDriver, 'other'],
    ] as const) {
      const consent = await post(actor, '/delivery/consents', {
        idempotencyKey: `consent-dos172-${tag}-${run}`,
        id: uuidv7(),
        granted: true,
        noticeVersion: 'gps-2026-09',
      })
      expect(consent.status, JSON.stringify(consent.body)).toBe(200)
    }
  }, 180_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  it('DOS-172: a bill that came back undelivered goes out again on a new sheet for its next trip', async () => {
    const day = tripDay(0)
    const billR = await billedOrder(retailerA, variantA, 'a-r')
    const billF = await billedOrder(retailerB, variantB, 'a-f')

    // Trip 1 takes R out on a confirmed sheet; the shop is closed; the van checks in and the desk settles.
    const stop1 = uuidv7()
    const trip1 = await loadingTrip('a-1', day, driverId, [
      { stopId: stop1, retailerId: retailerA, invoiceIds: [billR.invoiceId] },
    ])
    const first = await loadOut(app, crew, {
      tripId: trip1.id,
      orderIds: [billR.orderId],
      tag: `a-1-${run}`,
    })
    expect(first.dispatched).toEqual([billR.orderId])
    const out1 = await post(driver, `/delivery/trips/${trip1.id}/depart`, {
      idempotencyKey: `depart-a-1-${run}`,
    })
    expect(out1.status, JSON.stringify(out1.body)).toBe(200)
    await shopClosed(stop1, 'a-1')
    expect(await orderState(billR.orderId)).toBe('packed')
    const back1 = await post(driver, `/delivery/trips/${trip1.id}/return`, {
      idempotencyKey: `return-a-1-${run}`,
    })
    expect(back1.status, JSON.stringify(back1.body)).toBe(200)
    const settled = await post<{ tripState: string }>(
      accountant,
      `/delivery/trips/${trip1.id}/settle`,
      { idempotencyKey: `settle-a-1-${run}`, id: uuidv7(), handedOverCashPaise: 0, counted: [] },
    )
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)

    // The next day's read: W7 offers R again, and the board plans it; nothing is held.
    const offered = await walkAwaiting(200)
    expect(offered.orderIds, 'W7 offers the bill that came back').toContain(billR.orderId)
    const board = await planning(day)
    expect(board.bills.map((b) => b.invoiceId)).toContain(billR.invoiceId)
    expect(board.held).toEqual([])

    // Trip 2 carries R again with the fresh F; the two together reach the e-way bill threshold.
    const [previous] = (
      await db.execute(
        sql`select value from tenant_settings
             where tenant_id = ${tenantId} and key = ${TENANT_SETTING_KEYS.ewbIntraStateThreshold}`,
      )
    ).rows as { value: unknown }[]
    const setThreshold = (value: unknown) =>
      db
        .insert(tenantSettings)
        .values({ tenantId, key: TENANT_SETTING_KEYS.ewbIntraStateThreshold, value })
        .onConflictDoUpdate({
          target: [tenantSettings.tenantId, tenantSettings.key],
          set: { value },
        })
    const loadValue = billR.totalPaise + billF.totalPaise
    await setThreshold(loadValue)
    try {
      const trip2 = await loadingTrip('a-2', day, driverId, [
        { stopId: uuidv7(), retailerId: retailerA, invoiceIds: [billR.invoiceId] },
        { stopId: uuidv7(), retailerId: retailerB, invoiceIds: [billF.invoiceId] },
      ])
      const sheet2 = uuidv7()
      const created = await post<{
        item: {
          status: string
          loadValuePaise: number
          ewbRequired: boolean
          expectedPackages: number
        }
      }>(packer, '/warehouse/load-sheets', {
        idempotencyKey: `sheet-a-2-${run}`,
        id: sheet2,
        toLocationId: vehicleLocation,
        tripId: trip2.id,
        orderIds: [billR.orderId, billF.orderId],
      })
      expect(created.status, JSON.stringify(created.body)).toBe(200)
      expect(created.body.item).toMatchObject({
        status: 'draft',
        loadValuePaise: loadValue,
        ewbRequired: true,
        expectedPackages: 2,
      })

      // Only a draft sheet holds a bill: while this one is a draft, a second sheet carrying R is refused.
      const again = await newSheet(packer, [billR.orderId], 'a-2-again', trip2.id)
      expect(again.status, JSON.stringify(again.body)).toBe(409)
      expect(again.body.message).toMatch(/already on load sheet/)

      const approved = await post(manager, `/warehouse/load-sheets/${sheet2}/approve`, {
        idempotencyKey: `approve-a-2-${run}`,
      })
      expect(approved.status, JSON.stringify(approved.body)).toBe(200)
      const noEwb = await post<RefusalBody>(packer, `/warehouse/load-sheets/${sheet2}/confirm`, {
        idempotencyKey: `confirm-a-2-noewb-${run}`,
        countedPackages: 2,
        challanId: uuidv7(),
      })
      expect(noEwb.status, JSON.stringify(noEwb.body)).toBe(400)
      expect(noEwb.body.data?.code).toBe('ewb_required')
      const confirmed = await post<{
        dispatched: string[]
        challan: { valuePaise: number; ewbNo: string | null; lines: { variantId: string }[] }
      }>(packer, `/warehouse/load-sheets/${sheet2}/confirm`, {
        idempotencyKey: `confirm-a-2-${run}`,
        countedPackages: 2,
        challanId: uuidv7(),
        ewbNo: '123456789012',
      })
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
      expect(confirmed.body.dispatched).toEqual([billR.orderId, billF.orderId])
      expect(confirmed.body.challan.valuePaise).toBe(loadValue)
      expect(confirmed.body.challan.ewbNo).toBe('123456789012')
      expect(confirmed.body.challan.lines.map((l) => l.variantId).sort()).toEqual(
        [variantA, variantB].sort(),
      )

      const out2 = await post<{ item: TripBody }>(driver, `/delivery/trips/${trip2.id}/depart`, {
        idempotencyKey: `depart-a-2-${run}`,
      })
      expect(out2.status, JSON.stringify(out2.body)).toBe(200)
      expect(out2.body.item.loadSheetIds).toEqual([sheet2])
      // R left with the sheet's count and challan, never quietly with the trip.
      expect(await lastTransition(billR.orderId)).toEqual({ event: 'dispatch', reason: null })
    } finally {
      await setThreshold(previous?.value ?? 10_000_000)
    }
  }, 180_000)

  it('DOS-172: a returned bill is held on its trip until the van checks in, at planning and at the godown', async () => {
    const day = tripDay(1)
    // A packed bill no trip carries, packed first so the held bill is the newest pack on W7's list.
    const waiting = await billedOrder(retailerB, variantB, 'b-waiting')
    const billR = await billedOrder(retailerA, variantA, 'b-r')
    const stop1 = uuidv7()
    const trip1 = await loadingTrip('b-1', day, driverId, [
      { stopId: stop1, retailerId: retailerA, invoiceIds: [billR.invoiceId] },
    ])
    await loadOut(app, crew, { tripId: trip1.id, orderIds: [billR.orderId], tag: `b-1-${run}` })
    const out1 = await post(driver, `/delivery/trips/${trip1.id}/depart`, {
      idempotencyKey: `depart-b-1-${run}`,
    })
    expect(out1.status, JSON.stringify(out1.body)).toBe(200)
    await shopClosed(stop1, 'b-1')
    expect(await orderState(billR.orderId)).toBe('packed')

    // The van is still out: the board lists R under `held` with its trip, never under `bills`.
    const board = await planning(day)
    const heldR: unknown = expect.objectContaining({
      invoiceId: billR.invoiceId,
      orderId: billR.orderId,
      retailerId: retailerA,
      invoiceTotalPaise: billR.totalPaise,
      onTripId: trip1.id,
      onTripNo: trip1.tripNo,
    })
    expect(board.held).toEqual(expect.arrayContaining([heldR]))
    expect(board.held.filter((h) => h.invoiceId === billR.invoiceId)).toEqual([heldR])
    expect(board.bills.map((b) => b.invoiceId)).not.toContain(billR.invoiceId)

    // No plan takes it: not a new trip, not a stop added to the very trip it rides.
    const replanned = await post<RefusalBody>(manager, '/delivery/trips', {
      idempotencyKey: `trip-b-replan-${run}`,
      id: uuidv7(),
      tripDate: day,
      vehicleId,
      driverId: otherDriverId,
      openingCashPaise: 0,
      stops: [{ id: uuidv7(), sequence: 1, retailerId: retailerA, invoiceIds: [billR.invoiceId] }],
    })
    expect(replanned.status, JSON.stringify(replanned.body)).toBe(409)
    expect(replanned.body.data?.code).toBe('bill_on_road')
    expect(replanned.body.message).toContain(trip1.tripNo ?? trip1.id)
    const added = await post<RefusalBody>(manager, `/delivery/trips/${trip1.id}/stops`, {
      idempotencyKey: `stop-b-add-${run}`,
      id: trip1.id,
      stop: { id: uuidv7(), retailerId: retailerA, invoiceIds: [billR.invoiceId] },
    })
    expect(added.status, JSON.stringify(added.body)).toBe(409)
    expect(added.body.data).toMatchObject({ code: 'bill_on_road', tripId: trip1.id })

    // The godown never offers it, page after page, and refuses to load it for the warehouse and the desk.
    const walked = await walkAwaiting(1)
    expect(walked.orderIds).not.toContain(billR.orderId)
    expect(walked.orderIds).toContain(waiting.orderId)
    expect(walked.sparse, 'a page may hold fewer packs than limit while nextCursor is set').toBe(1)
    for (const [actor, tag] of [
      [packer, 'warehouse'],
      [manager, 'manager'],
    ] as const) {
      const refused = await newSheet(actor, [billR.orderId], `b-held-${tag}`)
      expect(refused.status, JSON.stringify(refused.body)).toBe(409)
      expect(refused.body.data).toEqual({
        code: 'bill_on_road',
        orderIds: [billR.orderId],
        tripIds: [trip1.id],
      })
      expect(refused.body.message).toContain('came back undelivered')
    }

    // Check-in frees it at once, before any settlement.
    const back1 = await post(driver, `/delivery/trips/${trip1.id}/return`, {
      idempotencyKey: `return-b-1-${run}`,
    })
    expect(back1.status, JSON.stringify(back1.body)).toBe(200)
    expect(await tripState(trip1.id)).toBe('closing')
    const after = await planning(day)
    expect(after.bills.map((b) => b.invoiceId)).toContain(billR.invoiceId)
    expect(after.held.filter((h) => h.invoiceId === billR.invoiceId)).toEqual([])
    expect((await walkAwaiting(200)).orderIds).toContain(billR.orderId)
    const trip2 = await loadingTrip('b-2', day, otherDriverId, [
      { stopId: uuidv7(), retailerId: retailerA, invoiceIds: [billR.invoiceId] },
    ])
    const loaded = await newSheet(packer, [billR.orderId], 'b-2', trip2.id)
    expect(loaded.status, JSON.stringify(loaded.body)).toBe(200)
    expect(loaded.body.item.status).toBe('draft')
  }, 180_000)

  it('DOS-172: no trip departs with a bill nobody counted out', async () => {
    const day = tripDay(2)
    const billR = await billedOrder(retailerA, variantA, 'c-r')
    const trip = await loadingTrip('c', day, driverId, [
      { stopId: uuidv7(), retailerId: retailerA, invoiceIds: [billR.invoiceId] },
    ])

    const refused = await post<RefusalBody>(driver, `/delivery/trips/${trip.id}/depart`, {
      idempotencyKey: `depart-c-early-${run}`,
    })
    expect(refused.status, JSON.stringify(refused.body)).toBe(409)
    expect(refused.body.data).toEqual({ code: 'bill_not_loaded', orderIds: [billR.orderId] })
    expect(refused.body.message).toContain('have not been counted out at the godown')
    expect(await tripState(trip.id)).toBe('loading')
    expect(await orderState(billR.orderId)).toBe('packed')
    expect(await outboxTypes(trip.id)).not.toContain('TripDeparted')
    expect(await departAudits(trip.id)).toBe(0)

    const loaded = await loadOut(app, crew, {
      tripId: trip.id,
      orderIds: [billR.orderId],
      tag: `c-${run}`,
    })
    expect(loaded.dispatched).toEqual([billR.orderId])
    const departed = await post<{ item: TripBody }>(driver, `/delivery/trips/${trip.id}/depart`, {
      idempotencyKey: `depart-c-${run}`,
    })
    expect(departed.status, JSON.stringify(departed.body)).toBe(200)
    expect(departed.body.item.state).toBe('active')
    expect(departed.body.item.loadSheetIds).toEqual([loaded.sheetId])
    expect(await lastTransition(billR.orderId)).toEqual({ event: 'dispatch', reason: null })
    expect(await departAudits(trip.id)).toBe(1)
  }, 180_000)

  it('DOS-172: the three doorstep paths hold and release alike', async () => {
    const day = tripDay(3)
    const g1 = await billedOrder(retailerA, variantA, 'd-g1-offline-fail')
    const g2 = await billedOrder(retailerB, variantA, 'd-g2-refused-door')
    const g3 = await billedOrder(retailerC, variantB, 'd-g3-open-at-return')
    const [stop1, stop2, stop3] = [uuidv7(), uuidv7(), uuidv7()]
    const trip1 = await loadingTrip('d-1', day, driverId, [
      { stopId: stop1, retailerId: retailerA, invoiceIds: [g1.invoiceId] },
      { stopId: stop2, retailerId: retailerB, invoiceIds: [g2.invoiceId] },
      { stopId: stop3, retailerId: retailerC, invoiceIds: [g3.invoiceId] },
    ])
    const all = [g1.orderId, g2.orderId, g3.orderId]
    expect(
      (await loadOut(app, crew, { tripId: trip1.id, orderIds: all, tag: `d-1-${run}` })).dispatched,
    ).toEqual(all)
    const out1 = await post(driver, `/delivery/trips/${trip1.id}/depart`, {
      idempotencyKey: `depart-d-1-${run}`,
    })
    expect(out1.status, JSON.stringify(out1.body)).toBe(200)

    // The delivery app's offline queue, as src/lib/local.ts shapes it: shop A closed, shop B refuses it all.
    const onPhone = await call<{ item: TripBody }>(
      app,
      driver,
      'GET',
      `/delivery/trips/${trip1.id}`,
    )
    const deliveryG2 = onPhone.body.item.stops.find((s) => s.id === stop2)?.deliveries[0]?.id ?? ''
    const [planned] = (
      await db.execute(sql`select updated_at from deliveries where id = ${deliveryG2}`)
    ).rows as { updated_at: Date | string }[]
    const [lineG2] = (
      await db.execute(
        sql`select id, qty_pcs, free_qty_pcs from invoice_lines where invoice_id = ${g2.invoiceId}`,
      )
    ).rows as { id: string; qty_pcs: number; free_qty_pcs: number }[]
    const at = new Date().toISOString()
    const deviceId = `driver-phone-dos172-${run}`
    const stopOp = (stopId: string, state: string, extra: Record<string, unknown> = {}) => ({
      opId: `d-${stopId}-${state}-${run}`,
      op: 'PATCH',
      table: 'trip_stops',
      id: stopId,
      data: { state, occurred_at: at, ...extra },
    })
    const upload = await post<UploadBody>(driver, '/sync/upload', {
      protocol: 1,
      deviceId,
      ops: [
        stopOp(stop1, 'started'),
        stopOp(stop1, 'arrived', { lat: 19.2437, lng: 73.1355 }),
        stopOp(stop1, 'failed', { failure_reason: 'shop_closed', failure_note: 'shutter down' }),
        stopOp(stop2, 'started'),
        stopOp(stop2, 'arrived', { lat: 19.2437, lng: 73.1355 }),
        {
          opId: `d-refused-${run}`,
          op: 'PUT',
          table: 'deliveries',
          id: deliveryG2,
          baseUpdatedAt: new Date(planned?.updated_at ?? 0).toISOString(),
          data: {
            trip_id: trip1.id,
            stop_id: stop2,
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
    expect(upload.status, JSON.stringify(upload.body)).toBe(200)
    expect(upload.body.rejected).toEqual([])
    expect(upload.body.accepted).toBe(6)
    expect(await orderState(g1.orderId)).toBe('packed')
    expect(await orderState(g2.orderId)).toBe('packed')
    expect(await orderState(g3.orderId)).toBe('dispatched')

    // Both are held on trip 1 while the van is out, whichever door sent them back.
    const awaiting = (await walkAwaiting(200)).orderIds
    expect(awaiting).not.toContain(g1.orderId)
    expect(awaiting).not.toContain(g2.orderId)
    for (const bill of [g1, g2]) {
      const refused = await newSheet(packer, [bill.orderId], `d-held-${bill.orderId}`)
      expect(refused.status, JSON.stringify(refused.body)).toBe(409)
      expect(refused.body.data?.code, JSON.stringify(refused.body)).toBe('bill_on_road')
    }
    const board = await planning(day)
    expect(board.held).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ invoiceId: g1.invoiceId, onTripId: trip1.id }),
        expect.objectContaining({ invoiceId: g2.invoiceId, onTripId: trip1.id }),
      ]),
    )
    expect(board.held.filter((h) => h.onTripId === trip1.id)).toHaveLength(2)
    expect(board.bills.map((b) => b.invoiceId)).not.toContain(g1.invoiceId)
    expect(board.bills.map((b) => b.invoiceId)).not.toContain(g2.invoiceId)

    // Check-in with G3's stop still open fails that stop too, and frees all three at once.
    const back1 = await post(driver, `/delivery/trips/${trip1.id}/return`, {
      idempotencyKey: `return-d-1-${run}`,
    })
    expect(back1.status, JSON.stringify(back1.body)).toBe(200)
    expect(await orderState(g3.orderId)).toBe('packed')
    const freed = await planning(day)
    expect(freed.bills.map((b) => b.invoiceId)).toEqual(
      expect.arrayContaining([g1.invoiceId, g2.invoiceId, g3.invoiceId]),
    )
    expect(freed.held.filter((h) => h.onTripId === trip1.id)).toEqual([])
    expect((await walkAwaiting(200)).orderIds).toEqual(expect.arrayContaining(all))

    // One sheet for the next trip takes all three, and its count dispatches them.
    const trip2 = await loadingTrip('d-2', day, otherDriverId, [
      { stopId: uuidv7(), retailerId: retailerA, invoiceIds: [g1.invoiceId] },
      { stopId: uuidv7(), retailerId: retailerB, invoiceIds: [g2.invoiceId] },
      { stopId: uuidv7(), retailerId: retailerC, invoiceIds: [g3.invoiceId] },
    ])
    const second = await loadOut(app, crew, { tripId: trip2.id, orderIds: all, tag: `d-2-${run}` })
    expect(second.dispatched).toEqual(all)
    for (const orderId of all) expect(await orderState(orderId)).toBe('dispatched')
  }, 180_000)
})
