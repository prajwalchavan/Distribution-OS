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
import { ReceivablesModule } from '../receivables/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { DeliveryModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** A 1×1 PNG: the smallest "photo of the signed bill" a spec can hand over inline. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

interface DeliveryRefBody {
  id: string
  invoiceId: string
  invoiceNo: string | null
  invoiceTotalPaise: number
  outcome: string | null
  creditNoteId: string | null
}
interface StopBody {
  id: string
  sequence: number
  retailerId: string
  retailerName: string
  state: string
  failureReason: string | null
  plannedCollectionPaise: number | null
  arrivedLat: number | null
  arrivedLng: number | null
  vehicleRegNo: string | null
  deliveries: DeliveryRefBody[]
}
interface TripBody {
  id: string
  tripNo: string | null
  state: string
  plannedStops: number
  stopsCompleted: number
  vehicleRegNo: string
  vehicleLocationId: string
  openingCashPaise: number
  stops: StopBody[]
  collections: { id: string; mode: string; amountPaise: number; receiptNo: string | null }[]
  expenses: { id: string; kind: string; amountPaise: number; proofObjectKey: string | null }[]
  settlement: { hasVariance: boolean; cashVariancePaise: number } | null
  loadConfirmedAt: string | null
  loadSheetIds: string[]
  vanSalesAllowed: boolean
  expectedCashPaise: number
  policy: { settlementTolerancePaise: number; podRequired: string; geofenceMetres: number }
}
interface DeliveryBody {
  id: string
  stopId: string
  outcome: string | null
  deliveredBy: string | null
  note: string | null
  deviceId: string | null
  shortPcs: number
  creditNoteId: string | null
  podKinds: string[]
  retailerId: string
  invoiceId: string
}
interface DeliveryDetailBody extends DeliveryBody {
  lines: { invoiceLineId: string; deliveredQtyPcs: number; returnedQtyPcs: number }[]
  pod: { kind: string; objectKey: string | null; readUrl: string | null }[]
  creditNote: { id: string; creditNoteNo: string | null; totalPaise: number } | null
}
interface SettlementBody {
  id: string
  expectedCashPaise: number
  handedOverCashPaise: number
  cashVariancePaise: number
  upiCollectedPaise: number
  chequeCollectedPaise: number
  expensesPaise: number
  hasVariance: boolean
  approvedBy: string | null
  stockVariance: { lotId: string; expectedPcs: number; countedPcs: number; deltaPcs: number }[]
}
type LedgerRow = { reason: string; qty_delta: number; lot_id: string; location_id: string }

describeDb('delivery (DATABASE_URL)', () => {
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
  const helperId = uuidv7()
  const otherDriverId = uuidv7()
  const shopUserA = uuidv7()
  const shopUserB = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }
  const helper: Actor = { tenantId, actorId: helperId, role: 'delivery' }
  const otherDriver: Actor = { tenantId, actorId: otherDriverId, role: 'delivery' }
  const shopA: Actor = { tenantId, actorId: shopUserA, role: 'retailer' }

  const ctxOf = (actorId: string, actorRole: TenantContext['actorRole']): TenantContext => ({
    tenantId,
    actorId,
    actorRole,
  })
  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) => as(ctxOf(ownerId, 'owner'), fn)
  const countAs = async (role: TenantContext['actorRole'], actorId: string, table: string) =>
    Number(
      (
        (
          await as(ctxOf(actorId, role), (tx) =>
            tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`),
          )
        ).rows[0] as { n: number }
      ).n,
    )

  const retailerA = uuidv7()
  const retailerB = uuidv7()
  const variantA = uuidv7()
  const variantB = uuidv7()
  let godown = ''
  let damaged = ''
  let lotA = ''
  let lotB = ''
  let app: NestFastifyApplication
  const vehicleId = uuidv7()
  let vehicleLocation = ''
  const today = new Date().toISOString().slice(0, 10)

  const ledgerFor = async (refId: string): Promise<LedgerRow[]> =>
    (
      await db.execute(
        sql`select reason::text as reason, qty_delta, lot_id, location_id from stock_ledger
             where tenant_id = ${tenantId} and ref_id = ${refId} order by id`,
      )
    ).rows as LedgerRow[]
  const balanceOf = async (lotId: string, locationId: string) =>
    Number(
      (
        (
          await db.execute(
            sql`select coalesce(on_hand, 0)::int as on_hand from stock_balances
                 where tenant_id = ${tenantId} and lot_id = ${lotId} and location_id = ${locationId}`,
          )
        ).rows[0] as { on_hand: number } | undefined
      )?.on_hand ?? 0,
    )
  const outboxTypes = async (aggregateId: string): Promise<string[]> =>
    (
      (
        await db.execute(
          sql`select event_type from outbox_events
               where tenant_id = ${tenantId} and aggregate_id = ${aggregateId} order by id`,
        )
      ).rows as { event_type: string }[]
    ).map((r) => r.event_type)
  const orderState = async (orderId: string): Promise<string> =>
    (
      (await db.execute(sql`select state::text as state from sales_orders where id = ${orderId}`))
        .rows[0] as { state: string }
    ).state

  /** An order confirmed through the real aggregate and packed by the godown, so a real bill exists. */
  async function billedOrder(
    retailerId: string,
    variantId: string,
    tag: string,
  ): Promise<{ orderId: string; invoiceId: string; totalPaise: number; lineId: string }> {
    const orderId = uuidv7()
    const created = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `order-${tag}-${run}`,
      id: orderId,
      retailerId,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId, enteredQty: 1, enteredUnit: 'case' }],
    })
    expect(created.status, `order ${tag}`).toBe(200)
    const submitted = await call<{ item: { state: string } }>(
      app,
      rep,
      'POST',
      `/orders/${orderId}/submit`,
      { idempotencyKey: `submit-${tag}-${run}` },
    )
    expect(submitted.status, `submit ${tag}`).toBe(200)
    expect(submitted.body.item.state).toBe('confirmed')
    const packed = await call<{
      invoice: { id: string; totalPaise: number } | null
    }>(app, packer, 'POST', `/warehouse/orders/${orderId}/pack`, {
      idempotencyKey: `pack-${tag}-${run}`,
      id: uuidv7(),
      packages: 1,
    })
    expect(packed.status, `pack ${tag}`).toBe(200)
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

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `dl-${run}`, legalName: 'Van Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91971${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91971${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91971${run}3`, name: 'Accountant' },
      { id: packerId, phone: `+91971${run}4`, name: 'Packer' },
      { id: repId, phone: `+91971${run}5`, name: 'Rep' },
      { id: driverId, phone: `+91971${run}6`, name: 'Driver' },
      { id: helperId, phone: `+91971${run}7`, name: 'Helper' },
      { id: otherDriverId, phone: `+91971${run}8`, name: 'Other driver' },
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
      { id: uuidv7(), tenantId, userId: helperId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: otherDriverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserA, role: 'retailer' },
      { id: uuidv7(), tenantId, userId: shopUserB, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    await db
      .insert(tenantSettings)
      .values({ tenantId, key: TENANT_SETTING_KEYS.brandingDisplayName, value: 'Van Traders' })
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
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker dl ${run}` })
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
      [retailerA, shopUserA, 'A'],
      [retailerB, shopUserB, 'B'],
    ]
    for (const [retailerId, userId, tag] of shops) {
      const identityId = uuidv7()
      await db.insert(retailerIdentities).values({
        id: identityId,
        phone: `+91973${run}${tag === 'A' ? 1 : 2}`,
        userId,
        shopName: `Van Shop ${tag} ${run}`,
      })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `DL-${tag}-${run}`,
        name: `Van Shop ${tag} ${run}`,
        ownerName: `Owner ${tag}`,
        phone: `+91973${run}${tag === 'A' ? 1 : 2}`,
        stateCode: '27',
        gstRegType: 'regular',
        gstin: tag === 'A' ? '27AAXPT9021Q1ZQ' : '27AABCU9603R1ZX',
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
    await db.insert(priceListItems).values([
      { id: uuidv7(), tenantId, priceListId, variantId: variantA, ratePaise: 1000 },
      { id: uuidv7(), tenantId, priceListId, variantId: variantB, ratePaise: 2000 },
    ])

    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    damaged = locs.find((l) => l.kind === 'damaged')?.id ?? ''

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
        batchNo: `A-${run}`,
        mrpPaise: 1000,
        expiryDate: '2028-01-31',
      })
      const b = await inventory.findOrCreateLot(tx, {
        variantId: variantB,
        batchNo: `B-${run}`,
        mrpPaise: 2000,
        expiryDate: '2028-06-30',
      })
      lotA = a.lot.id
      lotB = b.lot.id
      await inventory.post(tx, [
        {
          lotId: lotA,
          locationId: godown,
          qtyDelta: 1_000,
          reason: 'opening',
          idempotencyKey: `open-${run}-a`,
        },
        {
          lotId: lotB,
          locationId: godown,
          qtyDelta: 1_000,
          reason: 'opening',
          idempotencyKey: `open-${run}-b`,
        },
      ])
    })
  })

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------------------------------
  // fleet and consent

  it('creates a vehicle with its stock location, and refuses a second plate', async () => {
    const res = await call<{
      item: { id: string; locationId: string; regNo: string }
      created: boolean
    }>(app, owner, 'POST', '/delivery/vehicles', {
      idempotencyKey: `vehicle-${run}`,
      id: vehicleId,
      regNo: `MH-05-DL-${run.slice(-4)}`,
      name: 'Tempo 1',
      kind: 'tempo',
      capacityCases: 120,
    })
    expect(res.status).toBe(200)
    expect(res.body.created).toBe(true)
    vehicleLocation = res.body.item.locationId
    const [loc] = (
      await db.execute(
        sql`select kind::text as kind, vehicle_id from locations where id = ${vehicleLocation}`,
      )
    ).rows as { kind: string; vehicle_id: string }[]
    expect(loc?.kind).toBe('vehicle')
    expect(loc?.vehicle_id).toBe(vehicleId)
    const dup = await call(app, owner, 'POST', '/delivery/vehicles', {
      idempotencyKey: `vehicle-dup-${run}`,
      id: uuidv7(),
      regNo: `MH-05-DL-${run.slice(-4)}`,
    })
    expect(dup.status).toBe(409)
    // the godown may read the fleet, never add to it
    expect((await call(app, packer, 'GET', '/delivery/vehicles')).status).toBe(200)
    expect(
      (
        await call(app, packer, 'POST', '/delivery/vehicles', {
          idempotencyKey: `vehicle-packer-${run}`,
          id: uuidv7(),
          regNo: 'MH-05-XX-0001',
        })
      ).status,
    ).toBe(403)
  })

  it("records the driver's own location consent, never someone else's", async () => {
    const res = await call<{ item: { userId: string; granted: boolean; noticeVersion: string } }>(
      app,
      driver,
      'POST',
      '/delivery/consents',
      {
        idempotencyKey: `consent-${run}`,
        id: uuidv7(),
        granted: true,
        noticeVersion: 'gps-2026-09',
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.userId).toBe(driverId)
    expect(res.body.item.granted).toBe(true)
    const mine = await call<{ item: { userId: string } | null }>(
      app,
      driver,
      'GET',
      '/delivery/consents',
    )
    expect(mine.body.item?.userId).toBe(driverId)
    // a crew member cannot read another's; the desk can
    expect(
      (await call(app, helper, 'GET', '/delivery/consents', { userId: driverId })).status,
    ).toBe(403)
    const desk = await call<{ item: { granted: boolean } | null }>(
      app,
      manager,
      'GET',
      '/delivery/consents',
      {
        userId: driverId,
      },
    )
    expect(desk.status).toBe(200)
    expect(desk.body.item?.granted).toBe(true)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // the plan

  const tripId = uuidv7()
  const stopA1 = uuidv7()
  const stopB1 = uuidv7()
  const stopA2 = uuidv7()
  const stopB2 = uuidv7()
  let billA1: Awaited<ReturnType<typeof billedOrder>>
  let billB1: Awaited<ReturnType<typeof billedOrder>>
  let billA2: Awaited<ReturnType<typeof billedOrder>>
  let billB2: Awaited<ReturnType<typeof billedOrder>>
  let billB3: Awaited<ReturnType<typeof billedOrder>>

  // The five bills the two trips carry are fixtures, not the test. Packing one runs the whole
  // order → submit → pack → invoice chain (four requests, each a multi-statement transaction), and
  // under the full `turbo run … test` — twenty spec files plus the seven watching services on one
  // machine — a request runs forty to seventy times slower than alone: four bills inside one `it`
  // crossed the 30 s test budget at the delivery gate (2026-09-05). A hook has its own budget, and
  // the tests below then measure the trip, not the godown.
  beforeAll(async () => {
    billA1 = await billedOrder(retailerA, variantA, 'a1')
    billB1 = await billedOrder(retailerB, variantB, 'b1')
    billA2 = await billedOrder(retailerA, variantB, 'a2')
    billB2 = await billedOrder(retailerB, variantA, 'b2')
    billB3 = await billedOrder(retailerB, variantA, 'b3')
  }, 180_000)

  it('plans a trip from the godown with stops, planned deliveries and a TRIP number', async () => {
    const res = await call<{ item: TripBody }>(app, packer, 'POST', '/delivery/trips', {
      idempotencyKey: `trip-${run}`,
      id: tripId,
      tripDate: today,
      vehicleId,
      driverId,
      helperId,
      vanSalesEnabled: true,
      openingCashPaise: 200_000,
      stops: [
        { id: stopA1, sequence: 1, retailerId: retailerA, invoiceIds: [billA1.invoiceId] },
        { id: stopB1, sequence: 2, retailerId: retailerB, invoiceIds: [billB1.invoiceId] },
        { id: stopA2, sequence: 3, retailerId: retailerA, invoiceIds: [billA2.invoiceId] },
        { id: stopB2, sequence: 4, retailerId: retailerB, invoiceIds: [billB2.invoiceId] },
      ],
    })
    expect(res.status).toBe(200)
    const trip = res.body.item
    expect(trip.state).toBe('planned')
    expect(trip.tripNo).toBe('TRIP-0001')
    expect(trip.plannedStops).toBe(4)
    expect(trip.vehicleRegNo).toBe(`MH-05-DL-${run.slice(-4)}`)
    expect(trip.vehicleLocationId).toBe(vehicleLocation)
    expect(trip.vanSalesAllowed).toBe(true)
    expect(trip.stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4])
    expect(trip.stops[0]?.plannedCollectionPaise).toBe(billA1.totalPaise)
    // the godown plans the trip but never reads a doorstep row (`deliveries_read`): the desk sees the bills
    expect(trip.stops[0]?.deliveries).toEqual([])
    const desk = await call<{ item: TripBody }>(app, manager, 'GET', `/delivery/trips/${tripId}`)
    expect(desk.status).toBe(200)
    expect(desk.body.item.stops[0]?.deliveries[0]?.invoiceId).toBe(billA1.invoiceId)
    expect(desk.body.item.stops[0]?.deliveries[0]?.invoiceNo).not.toBeNull()
    expect(desk.body.item.stops[0]?.deliveries[0]?.outcome).toBeNull()
    expect(trip.policy.podRequired).toBe('credit_only')
    expect(trip.policy.settlementTolerancePaise).toBe(10_000)
    expect(trip.loadConfirmedAt).toBeNull()
    expect(await outboxTypes(tripId)).toEqual(['TripPlanned'])

    const replay = await call<{ item: TripBody }>(app, packer, 'POST', '/delivery/trips', {
      idempotencyKey: `trip-${run}`,
      id: tripId,
      tripDate: today,
      vehicleId,
      driverId,
      helperId,
      vanSalesEnabled: true,
      openingCashPaise: 200_000,
      stops: [
        { id: stopA1, sequence: 1, retailerId: retailerA, invoiceIds: [billA1.invoiceId] },
        { id: stopB1, sequence: 2, retailerId: retailerB, invoiceIds: [billB1.invoiceId] },
        { id: stopA2, sequence: 3, retailerId: retailerA, invoiceIds: [billA2.invoiceId] },
        { id: stopB2, sequence: 4, retailerId: retailerB, invoiceIds: [billB2.invoiceId] },
      ],
    })
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(tripId)
    expect(replay.body.item.tripNo).toBe('TRIP-0001')

    // the same driver twice on one day, and a bill that is already riding on a trip
    const busy = await call(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `trip-busy-${run}`,
      id: uuidv7(),
      tripDate: today,
      vehicleId,
      driverId,
      stops: [{ id: uuidv7(), sequence: 1, retailerId: retailerA, invoiceIds: [] }],
    })
    expect(busy.status).toBe(409)
  })

  it('loads, confirms the van stock on a load sheet, and departs with consent; bills dispatch at depart', async () => {
    const loading = await call<{ item: TripBody }>(
      app,
      packer,
      'POST',
      `/delivery/trips/${tripId}/start-loading`,
      { idempotencyKey: `loading-${run}` },
    )
    expect(loading.status).toBe(200)
    expect(loading.body.item.state).toBe('loading')

    // the godown's own paperwork: free van stock for the van sale later on
    const sheetId = uuidv7()
    const sheet = await call<{ item: { status: string } }>(
      app,
      manager,
      'POST',
      '/warehouse/load-sheets',
      {
        idempotencyKey: `sheet-${run}`,
        id: sheetId,
        toLocationId: vehicleLocation,
        tripId,
        vanStock: [{ lotId: lotB, qtyPcs: 48 }],
      },
    )
    expect(sheet.status).toBe(200)
    const confirmed = await call<{ item: { status: string } }>(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${sheetId}/confirm`,
      {
        idempotencyKey: `sheet-confirm-${run}`,
        countedPackages: 0,
        challanId: uuidv7(),
        countedVanStock: [{ lotId: lotB, qtyPcs: 48 }],
      },
    )
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.item.status).toBe('confirmed')
    expect(await balanceOf(lotB, vehicleLocation)).toBe(48)

    // the helper departs: the DRIVER's consent is what counts
    const departed = await call<{ item: TripBody }>(
      app,
      helper,
      'POST',
      `/delivery/trips/${tripId}/depart`,
      {
        idempotencyKey: `depart-${run}`,
        startOdometerKm: 41_200,
      },
    )
    expect(departed.status).toBe(200)
    expect(departed.body.item.state).toBe('active')
    expect(departed.body.item.loadConfirmedAt).not.toBeNull()
    expect(departed.body.item.loadSheetIds).toEqual([sheetId])
    expect(departed.body.item.expectedCashPaise).toBe(200_000)
    for (const bill of [billA1, billB1, billA2, billB2])
      expect(await orderState(bill.orderId)).toBe('dispatched')
    expect(await outboxTypes(tripId)).toEqual(['TripPlanned', 'TripLoading', 'TripDeparted'])
  })

  // ---------------------------------------------------------------------------------------------------------------
  // the road

  it('answers the next stop with the shop, starts, arrives with the geofence distance, tolerates an old op', async () => {
    const next = await call<{
      item: StopBody | null
      retailer: { phone: string; name: string } | null
      remaining: number
    }>(app, driver, 'GET', `/delivery/trips/${tripId}/next-stop`)
    expect(next.status).toBe(200)
    expect(next.body.item?.id).toBe(stopA1)
    expect(next.body.retailer?.name).toContain('Van Shop A')
    expect(next.body.remaining).toBe(4)
    expect(JSON.stringify(next.body)).not.toMatch(/creditLimit|purchaseRate|costPaise|margin/)

    const started = await call<{ item: StopBody }>(
      app,
      driver,
      'POST',
      `/delivery/stops/${stopA1}/start`,
      {
        idempotencyKey: `start-a1-${run}`,
        occurredAt: new Date().toISOString(),
      },
    )
    expect(started.status).toBe(200)
    expect(started.body.item.state).toBe('started')

    const arrived = await call<{ item: StopBody; distanceM: number | null }>(
      app,
      driver,
      'POST',
      `/delivery/stops/${stopA1}/arrive`,
      { idempotencyKey: `arrive-a1-${run}`, lat: 19.2445, lng: 73.1355 },
    )
    expect(arrived.status).toBe(200)
    expect(arrived.body.item.state).toBe('arrived')
    expect(arrived.body.distanceM).toBeGreaterThan(50)
    expect(arrived.body.distanceM).toBeLessThan(150)

    // an offline batch replaying an older `start` on a stop already past it: the current row, 200
    const late = await call<{ item: StopBody }>(
      app,
      driver,
      'POST',
      `/delivery/stops/${stopA1}/start`,
      {
        idempotencyKey: `start-a1-late-${run}`,
        occurredAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      },
    )
    expect(late.status).toBe(200)
    expect(late.body.item.state).toBe('arrived')
  })

  let deliveryA1 = ''

  it('a full delivery advances the order to delivered and writes proof of delivery', async () => {
    deliveryA1 = uuidv7()
    const podId = uuidv7()
    const payload = {
      idempotencyKey: `deliver-a1-${run}`,
      id: deliveryA1,
      tripId,
      stopId: stopA1,
      invoiceId: billA1.invoiceId,
      receiverName: 'Owner A',
      lines: [
        { id: uuidv7(), invoiceLineId: billA1.lineId, deliveredQtyPcs: 12, returnedQtyPcs: 0 },
      ],
      pod: [
        {
          id: podId,
          kind: 'signature',
          inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
        },
      ],
    }
    const res = await call<{
      item: DeliveryDetailBody
      stop: StopBody
      creditNoteId: string | null
    }>(app, driver, 'POST', '/delivery/deliveries', payload)
    expect(res.status).toBe(200)
    // the planned row created with the stop is the one completed, whatever id the device sent
    deliveryA1 = res.body.item.id
    expect(res.body.item.outcome).toBe('delivered')
    expect(res.body.item.shortPcs).toBe(0)
    expect(res.body.item.podKinds).toEqual(['signature'])
    expect(res.body.item.pod[0]?.objectKey).toMatch(/^tenant\/.*\/pod\//)
    expect(res.body.item.pod[0]?.readUrl).toContain('/storage/')
    expect(res.body.creditNoteId).toBeNull()
    expect(res.body.stop.state).toBe('delivered')
    expect(await orderState(billA1.orderId)).toBe('delivered')
    expect(await outboxTypes(deliveryA1)).toEqual(['DeliveryRecorded'])
    expect(await outboxTypes(billA1.orderId)).toContain('OrderDelivered')
    const [line] = (
      await db.execute(
        sql`select delivered_qty_pcs from sales_order_lines where order_id = ${billA1.orderId}`,
      )
    ).rows as { delivered_qty_pcs: number }[]
    expect(line?.delivered_qty_pcs).toBe(12)

    // idempotent replay: same body, same answer, one row; a different body under the key is 409
    const replay = await call<{ item: DeliveryDetailBody }>(
      app,
      driver,
      'POST',
      '/delivery/deliveries',
      payload,
    )
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(deliveryA1)
    const changed = await call(app, driver, 'POST', '/delivery/deliveries', {
      ...payload,
      receiverName: 'Somebody else',
    })
    expect(changed.status).toBe(409)
    const rows = (
      await db.execute(sql`select count(*)::int as n from deliveries where stop_id = ${stopA1}`)
    ).rows as { n: number }[]
    expect(rows[0]?.n).toBe(1)
  })

  let deliveryB1 = ''

  it('a partial delivery raises ONE credit note at the original rate and returns the pieces into the vehicle', async () => {
    const before = await balanceOf(lotB, vehicleLocation)
    const res = await call<{
      item: DeliveryDetailBody
      stop: StopBody
      creditNoteId: string | null
    }>(app, driver, 'POST', '/delivery/deliveries', {
      idempotencyKey: `deliver-b1-${run}`,
      id: uuidv7(),
      tripId,
      stopId: stopB1,
      invoiceId: billB1.invoiceId,
      lines: [
        {
          id: uuidv7(),
          invoiceLineId: billB1.lineId,
          deliveredQtyPcs: 6,
          returnedQtyPcs: 6,
          returnedSaleable: true,
          reason: 'refused',
        },
      ],
      pod: [
        { id: uuidv7(), kind: 'photo', inline: { mimeType: 'image/png', contentBase64: TINY_PNG } },
      ],
    })
    expect(res.status).toBe(200)
    deliveryB1 = res.body.item.id
    expect(res.body.item.outcome).toBe('partial')
    expect(res.body.item.shortPcs).toBe(6)
    expect(res.body.creditNoteId).not.toBeNull()
    expect(res.body.item.creditNote?.creditNoteNo).toMatch(/^CN/)
    expect(res.body.stop.state).toBe('partial')
    expect(await orderState(billB1.orderId)).toBe('partially_delivered')
    // the note is at the ORIGINAL rate of the bill line, and tied to this delivery
    const [note] = (
      await db.execute(
        sql`select n.delivery_id, n.state::text as state, n.reason::text as reason, l.rate_paise, i.rate_paise as invoiced
               from credit_notes n join credit_note_lines l on l.credit_note_id = n.id
               join invoice_lines i on i.id = l.invoice_line_id
              where n.id = ${res.body.creditNoteId}`,
      )
    ).rows as {
      delivery_id: string
      state: string
      reason: string
      rate_paise: number
      invoiced: number
    }[]
    expect(note?.delivery_id).toBe(deliveryB1)
    expect(note?.state).toBe('issued')
    expect(note?.reason).toBe('return_saleable')
    expect(Number(note?.rate_paise)).toBe(Number(note?.invoiced))
    // the six pieces went back INTO THE VEHICLE
    const ledger = await ledgerFor(res.body.creditNoteId ?? '')
    expect(ledger).toHaveLength(1)
    expect(ledger[0]?.reason).toBe('sale_return_saleable')
    expect(ledger[0]?.location_id).toBe(vehicleLocation)
    expect(ledger[0]?.qty_delta).toBe(6)
    expect(await balanceOf(lotB, vehicleLocation)).toBe(before + 6)
  })

  it('a damaged return goes to the damaged bin, and proof is required for a shop on credit', async () => {
    const vanBefore = await balanceOf(lotB, vehicleLocation)
    const noProof = await call<{ data?: { code?: string } }>(
      app,
      driver,
      'POST',
      '/delivery/deliveries',
      {
        idempotencyKey: `deliver-a2-noproof-${run}`,
        id: uuidv7(),
        tripId,
        stopId: stopA2,
        invoiceId: billA2.invoiceId,
        lines: [
          { id: uuidv7(), invoiceLineId: billA2.lineId, deliveredQtyPcs: 12, returnedQtyPcs: 0 },
        ],
      },
    )
    expect(noProof.status).toBe(400)
    expect(noProof.body.data?.code).toBe('pod_required')

    const res = await call<{ item: DeliveryDetailBody; creditNoteId: string | null }>(
      app,
      driver,
      'POST',
      '/delivery/deliveries',
      {
        idempotencyKey: `deliver-a2-${run}`,
        id: uuidv7(),
        tripId,
        stopId: stopA2,
        invoiceId: billA2.invoiceId,
        lines: [
          {
            id: uuidv7(),
            invoiceLineId: billA2.lineId,
            deliveredQtyPcs: 9,
            returnedQtyPcs: 3,
            returnedSaleable: false,
            reason: 'damaged',
          },
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
    expect(res.status).toBe(200)
    expect(res.body.item.outcome).toBe('partial')
    const ledger = await ledgerFor(res.body.creditNoteId ?? '')
    expect(ledger).toHaveLength(1)
    expect(ledger[0]?.reason).toBe('sale_return_damaged')
    expect(ledger[0]?.location_id).toBe(damaged)
    expect(await balanceOf(lotB, vehicleLocation)).toBe(vanBefore)
  })

  it('a failed stop records the reason, returns the bill to packed and keeps the stock on the van', async () => {
    const ledgerBefore = (
      await db.execute(
        sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId}`,
      )
    ).rows as { n: number }[]
    const res = await call<{ item: StopBody; deliveries: DeliveryBody[] }>(
      app,
      driver,
      'POST',
      `/delivery/stops/${stopB2}/fail`,
      { idempotencyKey: `fail-b2-${run}`, failureReason: 'shop_closed' },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.state).toBe('failed')
    expect(res.body.item.failureReason).toBe('shop_closed')
    expect(res.body.deliveries).toHaveLength(1)
    expect(res.body.deliveries[0]?.outcome).toBe('failed')
    expect(await orderState(billB2.orderId)).toBe('packed')
    const ledgerAfter = (
      await db.execute(
        sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId}`,
      )
    ).rows as { n: number }[]
    expect(ledgerAfter[0]?.n).toBe(ledgerBefore[0]?.n)
    expect(await outboxTypes(tripId)).toContain('StopFailed')
    // `other` needs a note
    const other = await call(app, driver, 'POST', `/delivery/stops/${stopB2}/fail`, {
      idempotencyKey: `fail-b2-other-${run}`,
      failureReason: 'other',
    })
    expect(other.status).toBe(400)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // money at the door

  let cashCollected = 0
  let upiCollected = 0

  it('a doorstep cash receipt posts balanced lines through receivables and shows in the shop outstanding at once', async () => {
    const dueBefore = await call<{ outstandingPaise: number }>(
      app,
      manager,
      'GET',
      `/receivables/outstanding/${retailerA}`,
    )
    expect(dueBefore.status).toBe(200)
    const receiptId = uuidv7()
    const res = await call<{
      item: { id: string; receiptNo: string | null; mode: string; amountPaise: number }
      receipt: { id: string; receiptNo: string | null }
      allocations: { invoiceId: string; amountPaise: number }[]
      outstanding: { outstandingPaise: number }
      cashDiscountPaise: number
    }>(app, driver, 'POST', '/delivery/collections', {
      idempotencyKey: `collect-a1-${run}`,
      id: uuidv7(),
      receiptId,
      tripId,
      stopId: stopA1,
      retailerId: retailerA,
      mode: 'cash',
      amountPaise: billA1.totalPaise,
    })
    expect(res.status).toBe(200)
    cashCollected += billA1.totalPaise
    expect(res.body.receipt.id).toBe(receiptId)
    expect(res.body.item.receiptNo).toMatch(/^RCPT/)
    expect(res.body.allocations.reduce((n, a) => n + a.amountPaise, 0)).toBe(billA1.totalPaise)
    expect(res.body.allocations[0]?.invoiceId).toBe(billA1.invoiceId)
    expect(res.body.outstanding.outstandingPaise).toBe(
      dueBefore.body.outstandingPaise - billA1.totalPaise,
    )
    // the book: one entry, balanced, cash in CASH_VAN until the settlement
    const lines = (
      await db.execute(
        sql`select a.code, l.amount_paise from journal_lines l
              join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
             where e.tenant_id = ${tenantId} and e.ref_type = 'receipt' and e.ref_id = ${receiptId}`,
      )
    ).rows as { code: string; amount_paise: number }[]
    expect(lines.reduce((n, l) => n + Number(l.amount_paise), 0)).toBe(0)
    expect(Number(lines.find((l) => l.code === 'CASH_VAN')?.amount_paise)).toBe(billA1.totalPaise)
    const [receipt] = (
      await db.execute(sql`select trip_id, received_by from receipts where id = ${receiptId}`)
    ).rows as { trip_id: string; received_by: string }[]
    expect(receipt?.trip_id).toBe(tripId)
    expect(receipt?.received_by).toBe(driverId)
    const dueAfter = await call<{ outstandingPaise: number }>(
      app,
      manager,
      'GET',
      `/receivables/outstanding/${retailerA}`,
    )
    expect(dueAfter.body.outstandingPaise).toBe(res.body.outstanding.outstandingPaise)
    expect(await outboxTypes(res.body.item.id)).toEqual(['CollectionRecorded'])

    // UPI needs its UTR
    const noUtr = await call(app, driver, 'POST', '/delivery/collections', {
      idempotencyKey: `collect-b1-noutr-${run}`,
      id: uuidv7(),
      receiptId: uuidv7(),
      tripId,
      retailerId: retailerB,
      mode: 'upi',
      amountPaise: 50_000,
    })
    expect(noUtr.status).toBe(400)
    const upi = await call<{ item: { mode: string } }>(
      app,
      driver,
      'POST',
      '/delivery/collections',
      {
        idempotencyKey: `collect-b1-${run}`,
        id: uuidv7(),
        receiptId: uuidv7(),
        tripId,
        stopId: stopB1,
        retailerId: retailerB,
        mode: 'upi',
        amountPaise: 50_000,
        reference: `UTR${run}`,
      },
    )
    expect(upi.status).toBe(200)
    upiCollected += 50_000
    const list = await call<{ items: unknown[]; totals: { cashPaise: number; upiPaise: number } }>(
      app,
      driver,
      'GET',
      '/delivery/collections',
      { tripId },
    )
    expect(list.status).toBe(200)
    expect(list.body.items).toHaveLength(2)
    expect(list.body.totals.cashPaise).toBe(cashCollected)
    expect(list.body.totals.upiPaise).toBe(upiCollected)
  })

  it('a van sale bills from the normal series and moves the pieces off the vehicle', async () => {
    const vanBefore = await balanceOf(lotB, vehicleLocation)
    const orderId = uuidv7()
    const invoiceId = uuidv7()
    const res = await call<{
      order: { id: string; source: string; state: string }
      invoice: {
        id: string
        invoiceNo: string | null
        source: string
        seriesCode: string
        seller: { displayName: string }
      }
      delivery: DeliveryBody
      collection: { mode: string; amountPaise: number } | null
      receipt: { receiptNo: string | null } | null
    }>(app, driver, 'POST', '/delivery/van-sales', {
      idempotencyKey: `van-sale-${run}`,
      id: orderId,
      tripId,
      retailerId: retailerA,
      invoiceId,
      deliveryId: uuidv7(),
      lines: [{ id: uuidv7(), variantId: variantB, enteredQty: 12, enteredUnit: 'piece' }],
      collect: { id: uuidv7(), receiptId: uuidv7(), mode: 'cash', amountPaise: 20_000 },
    })
    expect(res.status).toBe(200)
    expect(res.body.order.source).toBe('van_sale')
    expect(res.body.order.state).toBe('delivered')
    expect(res.body.invoice.source).toBe('van_sale')
    // THE NORMAL SERIES, never a per-vehicle one (docs/17 §D5), and the distributor's own name on it
    expect(res.body.invoice.seriesCode).toBe('INV')
    expect(res.body.invoice.invoiceNo).toMatch(/^INV/)
    expect(res.body.invoice.seller.displayName).toBe('Van Traders')
    expect(res.body.delivery.outcome).toBe('delivered')
    expect(res.body.collection?.mode).toBe('cash')
    expect(res.body.receipt?.receiptNo).toMatch(/^RCPT/)
    cashCollected += 20_000
    // the pieces left the VEHICLE as `sale`
    const sale = (await ledgerFor(invoiceId)).filter((r) => r.reason === 'sale')
    expect(sale).toHaveLength(1)
    expect(sale[0]?.location_id).toBe(vehicleLocation)
    expect(sale[0]?.qty_delta).toBe(-12)
    expect(await balanceOf(lotB, vehicleLocation)).toBe(vanBefore - 12)
    expect(await outboxTypes(res.body.delivery.id)).toContain('VanSaleInvoiced')
    // sold at the shop's own stop of this trip (the crew was just there): no new stop appears
    const trip = await call<{ item: TripBody }>(app, driver, 'GET', `/delivery/trips/${tripId}`)
    expect(trip.body.item.stops).toHaveLength(4)
    expect(res.body.delivery.stopId).toBe(stopA1)

    // beyond van stock: refused, never negative
    const tooMany = await call(app, driver, 'POST', '/delivery/van-sales', {
      idempotencyKey: `van-sale-big-${run}`,
      id: uuidv7(),
      tripId,
      retailerId: retailerA,
      invoiceId: uuidv7(),
      deliveryId: uuidv7(),
      lines: [{ id: uuidv7(), variantId: variantB, enteredQty: 1_000, enteredUnit: 'piece' }],
    })
    expect(tooMany.status).toBe(400)
    expect(await balanceOf(lotB, vehicleLocation)).toBe(vanBefore - 12)
  })

  it('records a diesel expense with its proof, which reduces the expected cash', async () => {
    const res = await call<{
      item: { kind: string; amountPaise: number; proofObjectKey: string | null }
    }>(app, driver, 'POST', '/delivery/expenses', {
      idempotencyKey: `expense-${run}`,
      id: uuidv7(),
      tripId,
      kind: 'diesel',
      amountPaise: 30_000,
      inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
    })
    expect(res.status).toBe(200)
    expect(res.body.item.proofObjectKey).toMatch(/\/expense\//)
    const trip = await call<{ item: TripBody }>(app, driver, 'GET', `/delivery/trips/${tripId}`)
    expect(trip.body.item.expectedCashPaise).toBe(200_000 + cashCollected - 30_000)
    const list = await call<{ totalPaise: number }>(app, accountant, 'GET', '/delivery/expenses', {
      tripId,
    })
    expect(list.status).toBe(200)
    expect(list.body.totalPaise).toBe(30_000)
  })

  it('accepts the offline queue: an expense and a doorstep collection land, an impossible stop move is rejected 2xx', async () => {
    const res = await call<{
      accepted: number
      rejected: { opId: string; code: string; messageEn: string }[]
    }>(app, driver, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId: `driver-phone-${run}`,
      ops: [
        {
          opId: `exp-${run}`,
          op: 'PUT',
          table: 'trip_expenses',
          id: uuidv7(),
          data: { trip_id: tripId, kind: 'toll', amount_paise: 5_000 },
        },
        {
          opId: `col-${run}`,
          op: 'PUT',
          table: 'collections',
          id: uuidv7(),
          data: {
            receipt_id: uuidv7(),
            trip_id: tripId,
            retailer_id: retailerB,
            mode: 'cash',
            amount_paise: 1_000,
          },
        },
        {
          opId: `stop-${run}`,
          op: 'PATCH',
          table: 'trip_stops',
          id: stopA1,
          data: { state: 'failed', failure_reason: 'shop_closed' },
        },
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(2)
    expect(res.body.rejected).toHaveLength(1)
    expect(res.body.rejected[0]?.opId).toBe(`stop-${run}`)
    expect(res.body.rejected[0]?.code).toBe('conflict')
    cashCollected += 1_000
    const trip = await call<{ item: TripBody }>(app, driver, 'GET', `/delivery/trips/${tripId}`)
    expect(trip.body.item.expenses.map((e) => e.kind).sort()).toEqual(['diesel', 'toll'])
    expect(trip.body.item.collections).toHaveLength(4)
    expect(trip.body.item.expectedCashPaise).toBe(200_000 + cashCollected - 35_000)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // breadcrumbs

  it('gps: a batch with duplicates and one stale point is 2xx and stores exactly the new ones', async () => {
    const now = Date.now()
    const points = [0, 30, 60].map((s) => ({
      recordedAt: new Date(now - 300_000 + s * 1000).toISOString(),
      lat: 19.24 + s / 100_000,
      lng: 73.13,
      accuracyM: 8,
      speedMps: 4,
      battery: 80,
    }))
    const stale = {
      recordedAt: new Date(now - 6 * 60 * 60_000).toISOString(),
      lat: 19.2,
      lng: 73.1,
    }
    const first = await call<{
      accepted: number
      duplicates: number
      dropped: number
      positionUpdated: boolean
    }>(app, helper, 'POST', '/gps/points', {
      idempotencyKey: `gps-1-${run}`,
      tripId,
      deviceId: `helper-phone-${run}`,
      points: [...points, stale],
    })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({
      accepted: 3,
      duplicates: 0,
      dropped: 1,
      positionUpdated: true,
    })
    const again = await call<{ accepted: number; duplicates: number; dropped: number }>(
      app,
      helper,
      'POST',
      '/gps/points',
      {
        idempotencyKey: `gps-2-${run}`,
        tripId,
        deviceId: `helper-phone-${run}`,
        points: [...points, stale],
      },
    )
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 3, dropped: 1 })
    const stored = (
      await db.execute(
        sql`select count(*)::int as n, max(user_id) as user_id from trip_points where trip_id = ${tripId}`,
      )
    ).rows as { n: number; user_id: string }[]
    expect(stored[0]?.n).toBe(3)
    expect(stored[0]?.user_id).toBe(helperId)
    const [position] = (
      await db.execute(
        sql`select recorded_at, trip_id from vehicle_positions where vehicle_id = ${vehicleId}`,
      )
    ).rows as { recorded_at: Date; trip_id: string }[]
    expect(new Date(position?.recorded_at ?? 0).toISOString()).toBe(points[2]?.recordedAt)
    expect(position?.trip_id).toBe(tripId)

    // the owner's live map and replay are audited; the accountant gets neither
    const map = await call<{ items: { vehicleId: string; stale: boolean; stopsDone: number }[] }>(
      app,
      owner,
      'GET',
      '/delivery/vehicle-positions',
    )
    expect(map.status).toBe(200)
    const mine = map.body.items.find((i) => i.vehicleId === vehicleId)
    expect(mine?.stale).toBe(false)
    expect(mine?.stopsDone).toBe(4)
    const trace = await call<{ items: { deviceId: string }[]; truncated: boolean }>(
      app,
      owner,
      'GET',
      `/delivery/trips/${tripId}/trace`,
      { everyNth: 1 },
    )
    expect(trace.status).toBe(200)
    expect(trace.body.items).toHaveLength(3)
    expect(trace.body.items[0]?.deviceId).toBe(`helper-phone-${run}`)
    const audits = (
      await db.execute(
        sql`select action from audit_log where tenant_id = ${tenantId} and action in ('gps.trace_read', 'gps.live_map_read')`,
      )
    ).rows as { action: string }[]
    expect(audits.map((a) => a.action).sort()).toEqual(['gps.live_map_read', 'gps.trace_read'])
    expect((await call(app, accountant, 'GET', `/delivery/trips/${tripId}/trace`)).status).toBe(403)
    expect((await call(app, accountant, 'GET', '/delivery/vehicle-positions')).status).toBe(403)
    // a crew that is not on the trip is refused; a batch for a trip that is not out is dropped, not refused
    expect(
      (
        await call(app, otherDriver, 'POST', '/gps/points', {
          idempotencyKey: `gps-other-${run}`,
          tripId,
          deviceId: 'x',
          points: points.slice(0, 1),
        })
      ).status,
    ).toBe(403)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // check-in

  let settlementId = ''

  it('returns, previews the cockpit and settles within tolerance: the trip closes and the book balances', async () => {
    const returned = await call<{ item: TripBody }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripId}/return`,
      {
        idempotencyKey: `return-${run}`,
        endOdometerKm: 41_260,
      },
    )
    expect(returned.status).toBe(200)
    expect(returned.body.item.state).toBe('closing')
    expect(returned.body.item.stopsCompleted).toBe(4)

    const preview = await call<{
      expectedCashPaise: number
      cashCollectedPaise: number
      upiCollectedPaise: number
      expensesPaise: number
      tolerancePaise: number
      expectedVanStock: { lotId: string; expectedPcs: number; cases: number; loosePcs: number }[]
      stopsDelivered: number
      stopsPartial: number
      stopsFailed: number
    }>(app, driver, 'GET', `/delivery/trips/${tripId}/settlement`)
    expect(preview.status).toBe(200)
    expect(preview.body.cashCollectedPaise).toBe(cashCollected)
    expect(preview.body.upiCollectedPaise).toBe(upiCollected)
    expect(preview.body.expensesPaise).toBe(35_000)
    expect(preview.body.expectedCashPaise).toBe(200_000 + cashCollected - 35_000)
    expect(preview.body.tolerancePaise).toBe(10_000)
    expect(preview.body.stopsDelivered).toBe(1)
    expect(preview.body.stopsPartial).toBe(2)
    expect(preview.body.stopsFailed).toBe(1)
    const onVan = preview.body.expectedVanStock
    expect(onVan.length).toBeGreaterThan(0)
    const vanB = onVan.find((l) => l.lotId === lotB)
    expect(vanB?.expectedPcs).toBe(await balanceOf(lotB, vehicleLocation))

    // the crew never settles; the accountant does, and within tolerance (₹50 short) it closes green
    expect(
      (
        await call(app, driver, 'POST', `/delivery/trips/${tripId}/settle`, {
          idempotencyKey: `settle-crew-${run}`,
          id: uuidv7(),
          tripId,
          handedOverCashPaise: preview.body.expectedCashPaise,
        })
      ).status,
    ).toBe(403)
    settlementId = uuidv7()
    const res = await call<{
      item: SettlementBody
      tripState: string
      stockAdjustments: unknown[]
    }>(app, accountant, 'POST', `/delivery/trips/${tripId}/settle`, {
      idempotencyKey: `settle-${run}`,
      id: settlementId,
      tripId,
      handedOverCashPaise: preview.body.expectedCashPaise - 5_000,
      counted: onVan.map((l) => ({ lotId: l.lotId, countedPcs: l.expectedPcs })),
      note: 'counted with the crew',
    })
    expect(res.status).toBe(200)
    expect(res.body.tripState).toBe('settled')
    expect(res.body.item.hasVariance).toBe(false)
    expect(res.body.item.cashVariancePaise).toBe(-5_000)
    expect(res.body.item.upiCollectedPaise).toBe(upiCollected)
    expect(res.body.item.expensesPaise).toBe(35_000)
    expect(res.body.item.approvedBy).toBeNull()
    expect(res.body.stockAdjustments).toEqual([])
    // every counted lot went back to the godown; the van is empty
    const rows = await ledgerFor(settlementId)
    expect(rows.filter((r) => r.reason === 'van_unload')).toHaveLength(onVan.length)
    expect(rows.filter((r) => r.reason === 'transfer_in')).toHaveLength(onVan.length)
    expect(rows.filter((r) => r.reason === 'cycle_count')).toHaveLength(0)
    for (const l of onVan) expect(await balanceOf(l.lotId, vehicleLocation)).toBe(0)
    // the book: one balanced entry, the shortfall on CASH_SHORT, the van's cash cleared
    const lines = (
      await db.execute(
        sql`select a.code, l.amount_paise from journal_lines l
              join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
             where e.tenant_id = ${tenantId} and e.ref_type = 'trip_settlement' and e.ref_id = ${settlementId}`,
      )
    ).rows as { code: string; amount_paise: number }[]
    expect(lines.reduce((n, l) => n + Number(l.amount_paise), 0)).toBe(0)
    expect(Number(lines.find((l) => l.code === 'CASH_SHORT')?.amount_paise)).toBe(5_000)
    expect(Number(lines.find((l) => l.code === 'CASH_VAN')?.amount_paise)).toBe(-cashCollected)
    expect(Number(lines.find((l) => l.code === 'TRIP_EXPENSES')?.amount_paise)).toBe(35_000)
    expect(await outboxTypes(tripId)).toContain('TripSettled')
    // nothing more is collected or spent on a settled trip
    expect(
      (
        await call(app, driver, 'POST', '/delivery/expenses', {
          idempotencyKey: `expense-late-${run}`,
          id: uuidv7(),
          tripId,
          kind: 'toll',
          amountPaise: 5_000,
        })
      ).status,
    ).toBe(409)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // the other crew's trip: consent gate, trip return failing open stops, the red settlement

  const trip2 = uuidv7()
  const stopB3 = uuidv7()

  it('refuses to depart without the driver consent, returns with an open stop failed, and needs the owner for a red settlement', async () => {
    const created = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `trip2-${run}`,
      id: trip2,
      tripDate: today,
      vehicleId,
      driverId: otherDriverId,
      openingCashPaise: 0,
      stops: [{ id: stopB3, sequence: 1, retailerId: retailerB, invoiceIds: [billB3.invoiceId] }],
    })
    expect(created.status).toBe(200)
    expect(created.body.item.tripNo).toBe('TRIP-0002')
    expect(
      (
        await call(app, otherDriver, 'POST', `/delivery/trips/${trip2}/start-loading`, {
          idempotencyKey: `loading2-${run}`,
        })
      ).status,
    ).toBe(200)
    const blocked = await call<{ data?: { code?: string } }>(
      app,
      otherDriver,
      'POST',
      `/delivery/trips/${trip2}/depart`,
      {
        idempotencyKey: `depart2-early-${run}`,
      },
    )
    expect(blocked.status).toBe(403)
    expect(blocked.body.data?.code).toBe('gps_consent_missing')
    expect(
      (
        await call(app, otherDriver, 'POST', '/delivery/consents', {
          idempotencyKey: `consent2-${run}`,
          id: uuidv7(),
          granted: true,
          noticeVersion: 'gps-2026-09',
        })
      ).status,
    ).toBe(200)
    const departed = await call<{ item: TripBody }>(
      app,
      otherDriver,
      'POST',
      `/delivery/trips/${trip2}/depart`,
      {
        idempotencyKey: `depart2-${run}`,
      },
    )
    expect(departed.status).toBe(200)
    expect(departed.body.item.state).toBe('active')
    expect(departed.body.item.vanSalesAllowed).toBe(false)
    expect(await orderState(billB3.orderId)).toBe('dispatched')
    // no van sales on this trip
    expect(
      (
        await call(app, otherDriver, 'POST', '/delivery/van-sales', {
          idempotencyKey: `van-sale-off-${run}`,
          id: uuidv7(),
          tripId: trip2,
          retailerId: retailerB,
          invoiceId: uuidv7(),
          deliveryId: uuidv7(),
          lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
        })
      ).status,
    ).toBe(403)
    // put a little stock on this van so the count can be short by one piece
    const inventory = app.get(InventoryService)
    await asOwner((tx) =>
      inventory.post(tx, [
        {
          lotId: lotA,
          locationId: godown,
          qtyDelta: -10,
          reason: 'transfer_out',
          idempotencyKey: `van2-${run}-out`,
        },
        {
          lotId: lotA,
          locationId: vehicleLocation,
          qtyDelta: 10,
          reason: 'transfer_in',
          idempotencyKey: `van2-${run}-in`,
        },
      ]),
    )

    // the crew comes back without visiting the shop: the stop fails, the bill goes back to packed
    const returned = await call<{ item: TripBody }>(
      app,
      otherDriver,
      'POST',
      `/delivery/trips/${trip2}/return`,
      {
        idempotencyKey: `return2-${run}`,
      },
    )
    expect(returned.status).toBe(200)
    expect(returned.body.item.state).toBe('closing')
    expect(returned.body.item.stops[0]?.state).toBe('failed')
    expect(returned.body.item.stops[0]?.failureReason).toBe('other')
    expect(await orderState(billB3.orderId)).toBe('packed')

    // the manager settles ₹500 short and one piece short: 409 + an approvals row for the owner
    const short = await call<{ data?: { code?: string; approvalId?: string } }>(
      app,
      manager,
      'POST',
      `/delivery/trips/${trip2}/settle`,
      {
        idempotencyKey: `settle2-manager-${run}`,
        id: uuidv7(),
        tripId: trip2,
        handedOverCashPaise: 0,
        counted: [{ lotId: lotA, countedPcs: 9 }],
      },
    )
    expect(short.status).toBe(409)
    expect(short.body.data?.code).toBe('settlement_needs_owner')
    const [approval] = (
      await db.execute(
        sql`select id, status::text as status, kind::text as kind from approvals
             where tenant_id = ${tenantId} and entity_id = ${trip2} and kind = 'trip_settlement'`,
      )
    ).rows as { id: string; status: string; kind: string }[]
    expect(approval?.status).toBe('pending')
    expect(approval?.id).toBe(short.body.data?.approvalId)
    expect(
      (await db.execute(sql`select 1 from trip_settlements where trip_id = ${trip2}`)).rows,
    ).toHaveLength(0)
    // the owner without acceptVariance is refused the same way; with it the trip closes red
    expect(
      (
        await call(app, owner, 'POST', `/delivery/trips/${trip2}/settle`, {
          idempotencyKey: `settle2-owner-no-${run}`,
          id: uuidv7(),
          tripId: trip2,
          handedOverCashPaise: 0,
          counted: [{ lotId: lotA, countedPcs: 9 }],
        })
      ).status,
    ).toBe(409)
    const redId = uuidv7()
    const red = await call<{
      item: SettlementBody
      tripState: string
      stockAdjustments: { lotId: string; deltaPcs: number }[]
    }>(app, owner, 'POST', `/delivery/trips/${trip2}/settle`, {
      idempotencyKey: `settle2-owner-${run}`,
      id: redId,
      tripId: trip2,
      handedOverCashPaise: 0,
      counted: [{ lotId: lotA, countedPcs: 9 }],
      acceptVariance: true,
      note: 'crew paid diesel from the float; one piece missing',
    })
    expect(red.status).toBe(200)
    expect(red.body.tripState).toBe('settled_with_variance')
    expect(red.body.item.hasVariance).toBe(true)
    expect(red.body.item.approvedBy).toBe(ownerId)
    expect(red.body.stockAdjustments).toEqual([
      { lotId: lotA, expectedPcs: 10, countedPcs: 9, deltaPcs: -1 },
    ])
    const rows = await ledgerFor(redId)
    expect(rows.find((r) => r.reason === 'cycle_count')?.qty_delta).toBe(-1)
    expect(rows.find((r) => r.reason === 'van_unload')?.qty_delta).toBe(-9)
    expect(await balanceOf(lotA, vehicleLocation)).toBe(0)
    const [decided] = (
      await db.execute(
        sql`select status::text as status, decided_by from approvals where id = ${approval?.id}`,
      )
    ).rows as { status: string; decided_by: string }[]
    expect(decided?.status).toBe('approved')
    expect(decided?.decided_by).toBe(ownerId)
    expect(await outboxTypes(trip2)).toContain('TripSettlementVariance')
  })

  // ---------------------------------------------------------------------------------------------------------------
  // who sees what

  it('a salesperson is refused every delivery write and every collection, at the API and in Postgres', async () => {
    expect((await call(app, rep, 'GET', '/delivery/trips')).status).toBe(403)
    expect((await call(app, rep, 'GET', '/delivery/vehicle-positions')).status).toBe(403)
    expect(
      (
        await call(app, rep, 'POST', '/gps/points', {
          idempotencyKey: `gps-rep-${run}`,
          tripId,
          deviceId: 'rep-phone',
          points: [{ recordedAt: new Date().toISOString(), lat: 19.2, lng: 73.1 }],
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, rep, 'POST', '/delivery/collections', {
          idempotencyKey: `collect-rep-${run}`,
          id: uuidv7(),
          receiptId: uuidv7(),
          tripId,
          retailerId: retailerA,
          mode: 'cash',
          amountPaise: 100,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, rep, 'POST', '/delivery/deliveries', {
          idempotencyKey: `deliver-rep-${run}`,
          id: uuidv7(),
          tripId,
          stopId: stopA1,
          invoiceId: billA1.invoiceId,
          lines: [{ id: uuidv7(), invoiceLineId: billA1.lineId, deliveredQtyPcs: 12 }],
        })
      ).status,
    ).toBe(403)
    expect((await call(app, rep, 'GET', `/delivery/trips/${tripId}/settlement`)).status).toBe(403)
    // RLS is the guarantee: a rep sees no trip and no money even with raw SQL
    expect(await countAs('salesperson', repId, 'trips')).toBe(0)
    expect(await countAs('salesperson', repId, 'collections')).toBe(0)
    expect(await countAs('salesperson', repId, 'trip_settlements')).toBe(0)
    expect(await countAs('salesperson', repId, 'deliveries')).toBe(0)
    // the rep still sees stop status ("where is my shop's order") — every stop, no coordinates needed
    const stops = await call<{ items: StopBody[] }>(app, rep, 'GET', '/delivery/stops', { tripId })
    expect(stops.status).toBe(200)
    expect(stops.body.items.length).toBeGreaterThan(0)
  })

  it('a retailer sees its own delivery status — an ETA and its proof — and nothing else', async () => {
    const stops = await call<{ items: StopBody[] }>(app, shopA, 'GET', '/delivery/stops', {
      limit: 50,
    })
    expect(stops.status).toBe(200)
    expect(stops.body.items.length).toBeGreaterThan(0)
    expect(stops.body.items.every((s) => s.retailerId === retailerA)).toBe(true)
    expect(stops.body.items.every((s) => s.arrivedLat === null && s.arrivedLng === null)).toBe(true)
    expect(
      stops.body.items.every((s) => s.plannedCollectionPaise === null && s.vehicleRegNo === null),
    ).toBe(true)
    const deliveries = await call<{ items: DeliveryBody[] }>(
      app,
      shopA,
      'GET',
      '/delivery/deliveries',
      { limit: 50 },
    )
    expect(deliveries.status).toBe(200)
    expect(deliveries.body.items.length).toBeGreaterThan(0)
    expect(deliveries.body.items.every((d) => d.retailerId === retailerA)).toBe(true)
    expect(deliveries.body.items.every((d) => d.deliveredBy === null && d.deviceId === null)).toBe(
      true,
    )
    const own = await call<{ item: DeliveryDetailBody }>(
      app,
      shopA,
      'GET',
      `/delivery/deliveries/${deliveryA1}`,
    )
    expect(own.status).toBe(200)
    expect(own.body.item.pod[0]?.readUrl).not.toBeNull()
    expect((await call(app, shopA, 'GET', `/delivery/deliveries/${deliveryB1}`)).status).toBe(404)
    expect((await call(app, shopA, 'GET', '/delivery/trips')).status).toBe(403)
    expect((await call(app, shopA, 'GET', '/delivery/collections')).status).toBe(403)
    expect((await call(app, shopA, 'GET', `/delivery/trips/${tripId}`)).status).toBe(403)
    expect(
      (
        await call(app, shopA, 'POST', '/delivery/deliveries', {
          idempotencyKey: `deliver-shop-${run}`,
          id: uuidv7(),
          tripId,
          stopId: stopA1,
          invoiceId: billA1.invoiceId,
          lines: [{ id: uuidv7(), invoiceLineId: billA1.lineId, deliveredQtyPcs: 12 }],
        })
      ).status,
    ).toBe(403)
    for (const table of [
      'trips',
      'collections',
      'trip_settlements',
      'vehicle_positions',
      'trip_points',
    ])
      expect(await countAs('retailer', shopUserA, table), table).toBe(0)
    const shopsDeliveries = (
      await as(ctxOf(shopUserA, 'retailer'), (tx) =>
        tx.execute(sql`select distinct retailer_id from deliveries`),
      )
    ).rows as { retailer_id: string }[]
    expect(shopsDeliveries.map((r) => r.retailer_id)).toEqual([retailerA])
  })

  it('the crew reads only its own trips, and no delivery answer carries a cost', async () => {
    const list = await call<{ items: { id: string }[] }>(app, driver, 'GET', '/delivery/trips', {
      limit: 50,
    })
    expect(list.status).toBe(200)
    expect(list.body.items.map((t) => t.id)).toContain(tripId)
    expect(list.body.items.map((t) => t.id)).not.toContain(trip2)
    expect((await call(app, driver, 'GET', `/delivery/trips/${trip2}`)).status).toBe(404)
    expect((await call(app, driver, 'GET', `/delivery/trips/${trip2}/settlement`)).status).toBe(404)
    const bodies = [
      await call(app, driver, 'GET', `/delivery/trips/${tripId}`),
      await call(app, driver, 'GET', '/delivery/deliveries', { tripId }),
      await call(app, driver, 'GET', '/delivery/collections', { tripId }),
      await call(app, driver, 'GET', `/delivery/trips/${tripId}/settlement`),
      await call(app, driver, 'GET', '/delivery/vehicles'),
    ]
    for (const b of bodies) {
      expect(b.status).toBe(200)
      expect(JSON.stringify(b.body)).not.toMatch(
        /purchaseRate|landedCost|costPaise|ptdPaise|margin/,
      )
    }
    expect(await countAs('delivery', driverId, 'trips')).toBe(1)
    expect(await countAs('delivery', otherDriverId, 'trips')).toBe(1)
  })

  it('the accountant settles and reads the money but never writes a doorstep; the godown plans but never touches money', async () => {
    expect((await call(app, accountant, 'GET', '/delivery/collections', { tripId })).status).toBe(
      200,
    )
    expect(
      (
        await call(app, accountant, 'POST', `/delivery/stops/${stopA1}/arrive`, {
          idempotencyKey: `arrive-acc-${run}`,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, accountant, 'POST', '/delivery/deliveries', {
          idempotencyKey: `deliver-acc-${run}`,
          id: uuidv7(),
          tripId,
          stopId: stopA1,
          invoiceId: billA1.invoiceId,
          lines: [{ id: uuidv7(), invoiceLineId: billA1.lineId, deliveredQtyPcs: 12 }],
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, packer, 'POST', '/delivery/collections', {
          idempotencyKey: `collect-packer-${run}`,
          id: uuidv7(),
          receiptId: uuidv7(),
          tripId,
          retailerId: retailerA,
          mode: 'cash',
          amountPaise: 100,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, packer, 'POST', `/delivery/trips/${tripId}/settle`, {
          idempotencyKey: `settle-packer-${run}`,
          id: uuidv7(),
          tripId,
          handedOverCashPaise: 0,
        })
      ).status,
    ).toBe(403)
    expect(await countAs('warehouse', packerId, 'collections')).toBe(0)
    expect(await countAs('accountant', accountantId, 'trip_points')).toBe(0)
  })

  it('answers 401 with no token and hides another tenant', async () => {
    expect((await call(app, null, 'GET', '/delivery/trips')).status).toBe(401)
    const otherTenant = uuidv7()
    const otherOwner = uuidv7()
    await db
      .insert(tenants)
      .values({ id: otherTenant, slug: `dl2-${run}`, legalName: 'Other', stateCode: '27' })
    await db.insert(users).values({ id: otherOwner, phone: `+91974${run}1`, name: 'Other owner' })
    await db
      .insert(memberships)
      .values({ id: uuidv7(), tenantId: otherTenant, userId: otherOwner, role: 'owner' })
    await bootstrapTenant(db, otherTenant)
    const stranger: Actor = { tenantId: otherTenant, actorId: otherOwner, role: 'owner' }
    expect((await call(app, stranger, 'GET', `/delivery/trips/${tripId}`)).status).toBe(404)
    const list = await call<{ items: { id: string }[] }>(app, stranger, 'GET', '/delivery/trips')
    expect(list.status).toBe(200)
    expect(list.body.items).toHaveLength(0)
    expect((await call(app, stranger, 'GET', '/delivery/vehicles')).body).toEqual({ items: [] })
  })
})
