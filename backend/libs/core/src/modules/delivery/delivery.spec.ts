import { eq, sql, type SQL } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { financialYear, uuidv7 } from '@dos/domain'
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
  tripDate: string
  state: string
  startedAt: string | null
  /** DOS-043: the vehicle left before `tripDate`. */
  departedEarly: boolean
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
  policy: {
    settlementTolerancePaise: number
    podRequired: string
    geofenceMetres: number
    /** DOS-071: the amount at or above which an expense must carry a photo of its bill. */
    expenseProofMinPaise: number
  }
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
interface PlanningBody {
  date: string
  crew: { userId: string; name: string; onTripId: string | null; onTripNo: string | null }[]
  bills: {
    invoiceId: string
    invoiceNo: string | null
    invoiceTotalPaise: number
    orderId: string
    orderNo: string | null
    retailerId: string
    retailerName: string
    beatId: string | null
    beatName: string | null
  }[]
  nextCursor: string | null
}
type LedgerRow = { reason: string; qty_delta: number; lot_id: string; location_id: string }

describeDb('delivery (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  // The run's FULL suffix, and deleted in `afterAll`: `hsn_rates` is global and unique on (code, date)
  // since S-176, so a code built from six digits of the clock came round again as a hard INSERT
  // failure on a long-lived database.
  const hsn = `7${run}`

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
    // The rate row this run wrote into the GLOBAL table goes with it (owner connection, no RLS).
    await db.delete(hsnRates).where(eq(hsnRates.hsnCode, hsn))
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
    // DOS-071: the expense-proof amount rides on the trip, so the phone can say why the button is off.
    expect(trip.policy.expenseProofMinPaise).toBe(20_000)
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

  it('loads, confirms the van stock on a load sheet, and departs with consent; bills dispatch at the load-out', async () => {
    const loading = await call<{ item: TripBody }>(
      app,
      packer,
      'POST',
      `/delivery/trips/${tripId}/start-loading`,
      { idempotencyKey: `loading-${run}` },
    )
    expect(loading.status).toBe(200)
    expect(loading.body.item.state).toBe('loading')

    // the godown's own paperwork: the four bills on the stops, and free van stock for the van sale later
    // on. A bill leaves the godown only on a confirmed load sheet (QA DOS-172).
    const sheetId = uuidv7()
    const loadedBills = [billA1, billB1, billA2, billB2].map((bill) => bill.orderId)
    const sheet = await call<{ item: { status: string; expectedPackages: number } }>(
      app,
      manager,
      'POST',
      '/warehouse/load-sheets',
      {
        idempotencyKey: `sheet-${run}`,
        id: sheetId,
        toLocationId: vehicleLocation,
        tripId,
        orderIds: loadedBills,
        vanStock: [{ lotId: lotB, qtyPcs: 48 }],
      },
    )
    expect(sheet.status).toBe(200)
    expect(sheet.body.item.expectedPackages).toBe(4)
    const confirmed = await call<{ item: { status: string }; dispatched: string[] }>(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${sheetId}/confirm`,
      {
        idempotencyKey: `sheet-confirm-${run}`,
        countedPackages: 4,
        challanId: uuidv7(),
        countedVanStock: [{ lotId: lotB, qtyPcs: 48 }],
      },
    )
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.item.status).toBe('confirmed')
    expect(confirmed.body.dispatched).toEqual(loadedBills)
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

  it('DOS-058: a return marked damaged or past its date is refused as saleable (400 return_not_saleable, online and from the offline queue) and nothing is written', async () => {
    const vanBefore = await balanceOf(lotB, vehicleLocation)
    const binBefore = await balanceOf(lotB, damaged)

    // online: the driver taps "Damaged" / "Past its date" but the line still says it can be sold again
    for (const reason of ['damaged', 'expired'] as const) {
      const res = await call<{
        message?: string
        data?: { code?: string; invoiceLineId?: string; reason?: string }
      }>(app, driver, 'POST', '/delivery/deliveries', {
        idempotencyKey: `deliver-a2-dos058-${reason}-${run}`,
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
            returnedSaleable: true,
            reason,
          },
        ],
        pod: [
          {
            id: uuidv7(),
            kind: 'signature',
            inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
          },
        ],
      })
      expect(res.status, reason).toBe(400)
      expect(res.body.data?.code, reason).toBe('return_not_saleable')
      expect(res.body.data?.invoiceLineId, reason).toBe(billA2.lineId)
      expect(res.body.data?.reason, reason).toBe(reason)
    }

    // offline: the same contradiction from the queue is a readable 2xx rejection, never a restock. A geo
    // pod keeps the op free of proof bytes; the pod policy runs after the line check, so only the
    // message tells this refusal from `pod_required`.
    const queued = await call<{
      accepted: number
      rejected: { opId: string; code: string; messageEn: string }[]
    }>(app, driver, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId: `driver-phone-dos058-${run}`,
      ops: [
        {
          opId: `dos058-${run}`,
          op: 'PUT',
          table: 'deliveries',
          id: uuidv7(),
          data: {
            trip_id: tripId,
            stop_id: stopA2,
            invoice_id: billA2.invoiceId,
            lines: [
              {
                id: uuidv7(),
                invoice_line_id: billA2.lineId,
                delivered_qty_pcs: 9,
                returned_qty_pcs: 3,
                returned_saleable: true,
                reason: 'expired',
              },
            ],
            pod: [{ id: uuidv7(), kind: 'geo', lat: 19.24, lng: 73.13 }],
          },
        },
      ],
    })
    expect(queued.status).toBe(200)
    expect(queued.body.accepted).toBe(0)
    expect(queued.body.rejected).toHaveLength(1)
    expect(queued.body.rejected[0]?.opId).toBe(`dos058-${run}`)
    expect(queued.body.rejected[0]?.code).toBe('bad_request')
    expect(queued.body.rejected[0]?.messageEn).toMatch(/damaged bin/)

    // nothing was written: no credit note, the planned delivery still unattempted, no lines, no stock moved
    const notes = (
      await db.execute(
        sql`select count(*)::int as n from credit_notes where invoice_id = ${billA2.invoiceId}`,
      )
    ).rows as { n: number }[]
    expect(notes[0]?.n).toBe(0)
    const planned = (
      await db.execute(
        sql`select outcome::text as outcome from deliveries where stop_id = ${stopA2}`,
      )
    ).rows as { outcome: string | null }[]
    expect(planned.map((r) => r.outcome)).toEqual([null])
    const written = (
      await db.execute(
        sql`select count(*)::int as n from delivery_lines dl join deliveries d on d.id = dl.delivery_id
             where d.stop_id = ${stopA2}`,
      )
    ).rows as { n: number }[]
    expect(written[0]?.n).toBe(0)
    expect(await balanceOf(lotB, vehicleLocation)).toBe(vanBefore)
    expect(await balanceOf(lotB, damaged)).toBe(binBefore)
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

  it("DOS-057: a doorstep cash collection queues the receipt's A5 paper for the renderer", async () => {
    // The two collections the test above took at the door, both through POST /delivery/collections.
    const taken = (
      await db.execute(
        sql`select c.receipt_id, c.mode, count(o.id)::int as requests
              from collections c
              left join outbox_events o
                on o.tenant_id = c.tenant_id and o.event_type = 'DocumentRenderRequested'
               and o.aggregate_type = 'document'
               and o.aggregate_id = 'receipt:' || c.receipt_id || ':a5:original'
             where c.tenant_id = ${tenantId} and c.trip_id = ${tripId}
             group by c.receipt_id, c.mode`,
      )
    ).rows as { receipt_id: string; mode: string; requests: number }[]
    expect(taken.map((row) => row.mode).sort()).toEqual(['cash', 'upi'])
    // One request per receipt: the shop's paper is being made before the crew reaches the next door.
    expect(taken.map((row) => row.requests)).toEqual([1, 1])

    const cash = taken.find((row) => row.mode === 'cash')
    const [request] = (
      await db.execute(
        sql`select payload from outbox_events
             where tenant_id = ${tenantId} and event_type = 'DocumentRenderRequested'
               and aggregate_id = ${`receipt:${cash?.receipt_id ?? ''}:a5:original`}`,
      )
    ).rows as { payload: Record<string, unknown> }[]
    expect(request?.payload).toMatchObject({
      tenantId,
      kind: 'receipt',
      id: cash?.receipt_id,
      format: 'a5',
      copy: 'original',
      requestedBy: driverId,
    })
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

  /**
   * DOS-071 — "Photograph the bill" was an optional button with no policy behind it, and a ₹500 diesel
   * went in with `proofObjectKey` null. The founder's rule (2026-09-13): a photo at or above a
   * per-distributor amount, ₹200 by default, 0 for every expense. It runs on the SERVER, in
   * `recordExpenseInTx`, so the crew and the desk meet the same rule and `/sync/upload` agrees.
   */
  it('DOS-071: an expense at or above the distributor’s amount needs a photo of its bill, and a small one does not', async () => {
    // The two expenses this case DOES record are removed again at the end: the trip's cash story is
    // read by the settlement cases below, and this one is about the rule, not about the money.
    const recorded: string[] = []
    /*
     * The threshold is a TENANT setting: every case after this one reads it. An assertion that
     * fails inside the block below used to leave it at 0, which turns every later expense in
     * this file into `expense_proof_required` and hides the real failure behind a cascade.
     */
    try {
      const noProof = await call(app, driver, 'POST', '/delivery/expenses', {
        idempotencyKey: `expense-dos071-a-${run}`,
        id: uuidv7(),
        tripId,
        kind: 'diesel',
        amountPaise: 50_000,
      })
      expect(noProof.status).toBe(400)
      expect((noProof.body as { data?: { code?: string } }).data?.code).toBe(
        'expense_proof_required',
      )

      const proofId = uuidv7()
      recorded.push(proofId)
      const withProof = await call(app, driver, 'POST', '/delivery/expenses', {
        idempotencyKey: `expense-dos071-b-${run}`,
        id: proofId,
        tripId,
        kind: 'diesel',
        amountPaise: 50_000,
        inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
      })
      expect(withProof.status).toBe(200)

      // A ₹150 parking slip is under the amount: nothing is asked for.
      const smallId = uuidv7()
      recorded.push(smallId)
      const small = await call(app, driver, 'POST', '/delivery/expenses', {
        idempotencyKey: `expense-dos071-c-${run}`,
        id: smallId,
        tripId,
        kind: 'parking',
        amountPaise: 15_000,
      })
      expect(small.status).toBe(200)

      // The owner may ask for one on every rupee: 0 refuses the same ₹150.
      await db
        .insert(tenantSettings)
        .values({ tenantId, key: TENANT_SETTING_KEYS.deliveryExpenseProofMinPaise, value: 0 })
        .onConflictDoUpdate({
          target: [tenantSettings.tenantId, tenantSettings.key],
          set: { value: 0 },
        })
      const everyRupee = await call(app, driver, 'POST', '/delivery/expenses', {
        idempotencyKey: `expense-dos071-d-${run}`,
        id: uuidv7(),
        tripId,
        kind: 'parking',
        amountPaise: 15_000,
      })
      expect(everyRupee.status).toBe(400)
      expect((everyRupee.body as { data?: { code?: string } }).data?.code).toBe(
        'expense_proof_required',
      )
    } finally {
      await db
        .insert(tenantSettings)
        .values({
          tenantId,
          key: TENANT_SETTING_KEYS.deliveryExpenseProofMinPaise,
          value: 20_000,
        })
        .onConflictDoUpdate({
          target: [tenantSettings.tenantId, tenantSettings.key],
          set: { value: 20_000 },
        })
      // Nothing recorded (an assertion failed before the first one landed) is nothing to delete:
      // `sql.join` of an empty list is not valid SQL.
      if (recorded.length > 0)
        await db.execute(
          sql`delete from trip_expenses where tenant_id = ${tenantId} and id in (${sql.join(
            recorded.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
    }
  })

  it('DOS-071: the same rule reaches the offline queue as a 2xx rejection, and writes no expense row', async () => {
    const opId = `exp-dos071-${run}`
    const expenseId = uuidv7()
    const res = await call<{
      accepted: number
      rejected: { opId: string; code: string; messageEn: string }[]
    }>(app, driver, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId: `driver-phone-${run}`,
      ops: [
        {
          opId,
          op: 'PUT',
          table: 'trip_expenses',
          id: expenseId,
          data: { trip_id: tripId, kind: 'diesel', amount_paise: 50_000 },
        },
      ],
    })
    // `/sync/upload` NEVER answers 4xx (ADR 0007): the refusal is a row in `rejected`.
    expect(res.status).toBe(200)
    expect(res.body.rejected.map((r) => r.opId)).toEqual([opId])
    expect(res.body.rejected[0]?.code).toBe('bad_request')
    const rows = await db.execute(
      sql`select id from trip_expenses where tenant_id = ${tenantId} and id = ${expenseId}`,
    )
    expect(rows.rows).toEqual([])
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

  it('DOS-059: a doorstep collection drawn onto a receipt number already on the register takes the next free number: one receipt, one collection, and the counter past the register', async () => {
    const fy = financialYear()
    const series = sql`tenant_id = ${tenantId} and series_code = 'RCPT' and fy = ${fy}`
    const counter = async (): Promise<{ prefix: string; nextNo: number }> => {
      const [row] = (
        await db.execute(sql`select prefix, next_no from numbering_series where ${series}`)
      ).rows as { prefix: string; next_no: number }[]
      return { prefix: row?.prefix ?? '', nextNo: Number(row?.next_no ?? 1) }
    }
    const numbered = async (receiptNo: string): Promise<number> =>
      (
        (
          await db.execute(
            sql`select count(*)::int as n from receipts where tenant_id = ${tenantId} and receipt_no = ${receiptNo}`,
          )
        ).rows[0] as { n: number }
      ).n
    const before = await counter()
    const { prefix } = before
    // the collections above drew their numbers from this counter, so its newest number is on the register
    const taken = `${prefix}${String(before.nextNo - 1).padStart(4, '0')}`
    expect(await numbered(taken)).toBe(1)
    // a counter stepped back onto it (a restored backup, a reseed); the owner connection may rewind (0013)
    await db.execute(sql`update numbering_series set next_no = next_no - 1 where ${series}`)
    try {
      const [top] = (
        await db.execute(sql`
          select coalesce(max(substring(receipt_no from ${prefix.length + 1}::int)::bigint), 0) as n
            from receipts
           where tenant_id = ${tenantId}
             and left(receipt_no, ${prefix.length}::int) = ${prefix}
             and substring(receipt_no from ${prefix.length + 1}::int) ~ '^[0-9]{1,18}$'`)
      ).rows as { n: string }[]
      const highest = Number(top?.n ?? 0)
      const healed = `${prefix}${String(highest + 1).padStart(4, '0')}`
      const collectionId = uuidv7()
      const receiptId = uuidv7()
      const res = await call<{ receipt: { id: string; receiptNo: string | null } }>(
        app,
        driver,
        'POST',
        '/delivery/collections',
        {
          idempotencyKey: `collect-dos059-${run}`,
          id: collectionId,
          receiptId,
          tripId,
          retailerId: retailerB,
          mode: 'cash',
          amountPaise: 1_000,
        },
      )
      expect(res.status).toBe(200)
      cashCollected += 1_000
      expect(res.body.receipt.receiptNo).not.toBe(taken)
      expect(res.body.receipt.receiptNo).toBe(healed)
      expect(await numbered(taken)).toBe(1)
      expect(await numbered(healed)).toBe(1)
      const [written] = (
        await db.execute(sql`
          select (select count(*) from receipts where id = ${receiptId})::int as receipts,
                 (select count(*) from collections
                   where id = ${collectionId} and receipt_id = ${receiptId})::int as collections`)
      ).rows as { receipts: number; collections: number }[]
      expect(written).toEqual({ receipts: 1, collections: 1 })
      expect((await counter()).nextNo).toBe(highest + 2)
      const audit = (
        await db.execute(sql`
          select actor_id, entity_type, entity_id, before, after from audit_log
           where tenant_id = ${tenantId} and action = 'numbering.heal'
             and after->>'receiptId' = ${receiptId}`)
      ).rows
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        actor_id: driverId,
        entity_type: 'numbering_series',
        entity_id: `RCPT/${fy}`,
        before: { collidedNo: taken },
        after: { receiptNo: healed },
      })
    } finally {
      await db.execute(
        sql`update numbering_series set next_no = greatest(next_no, ${before.nextNo}) where ${series}`,
      )
    }
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
  // the trip's cash is still with the crew (DOS-132)

  interface ReceiptListBody {
    items: { id: string; receiptNo: string | null; status: string; tripId: string | null }[]
    totals: { countedPaise: number }
  }
  /** Every cash receipt the crew took on the trip and still holds: what the settlement counts as cash collected. */
  const tripCash = { tripId, status: 'collected', mode: 'cash', limit: 200 }
  const tripStateOf = async (id: string): Promise<string> =>
    (
      (await db.execute(sql`select state::text as state from trips where id = ${id}`)).rows[0] as {
        state: string
      }
    ).state

  it('DOS-132: cash taken on a trip still on the road is not in hand — receipts.list withCrew=false leaves it out of the rows and the totals (withCrew=true lists it), receipts.get says withCrew to the desk and null to the crew, and receipts.deposit refuses it 409 trip_cash_not_settled with nothing banked', async () => {
    expect(await tripStateOf(tripId)).toBe('active')

    // the control: no filter lists every cash receipt of the trip, and they add up to the settlement's cash figure
    const all = await call<ReceiptListBody>(app, accountant, 'GET', '/receipts', tripCash)
    expect(all.status).toBe(200)
    expect(all.body.items.length).toBeGreaterThan(0)
    expect(all.body.items.every((r) => r.tripId === tripId && r.status === 'collected')).toBe(true)
    expect(all.body.totals.countedPaise).toBe(cashCollected)
    const ids = all.body.items.map((r) => r.id).sort()

    const onTheRoad = await call<ReceiptListBody>(app, accountant, 'GET', '/receipts', {
      ...tripCash,
      withCrew: true,
    })
    expect(onTheRoad.status).toBe(200)
    expect(onTheRoad.body.items.map((r) => r.id).sort()).toEqual(ids)
    expect(onTheRoad.body.totals.countedPaise).toBe(cashCollected)

    // the office does not hold it: neither the rows nor the totals behind "Cash to bank" carry it
    const inHand = await call<ReceiptListBody>(app, accountant, 'GET', '/receipts', {
      ...tripCash,
      withCrew: false,
    })
    expect(inHand.status).toBe(200)
    expect(inHand.body.totals.countedPaise).toBe(0)
    expect(inHand.body.items).toEqual([])

    // the doorstep cash receipt of the first stop: the desk's banking gate says "with the crew"; the crew is told nothing
    const [doorstep] = (
      await db.execute(
        sql`select receipt_id from collections
             where tenant_id = ${tenantId} and trip_id = ${tripId} and stop_id = ${stopA1} and mode = 'cash'
             order by id limit 1`,
      )
    ).rows as { receipt_id: string }[]
    const receiptId = doorstep?.receipt_id ?? ''
    expect(ids).toContain(receiptId)
    const desk = await call<{
      item: { receiptNo: string | null; status: string }
      withCrew: boolean | null
    }>(app, accountant, 'GET', `/receipts/${receiptId}`)
    expect(desk.status).toBe(200)
    expect(desk.body.withCrew).toBe(true)
    const crew = await call<{ withCrew: boolean | null }>(
      app,
      driver,
      'GET',
      `/receipts/${receiptId}`,
    )
    expect(crew.status).toBe(200)
    expect(crew.body.withCrew).toBeNull()

    // banking it is refused: the receipt stays in hand and nothing is posted
    const batch = uuidv7()
    const refused = await call<{
      message: string
      data?: { code?: string; receiptIds?: string[] }
    }>(app, accountant, 'POST', '/receipts/deposit', {
      idempotencyKey: `dep-132-crew-${run}`,
      id: batch,
      receiptIds: [receiptId],
      depositedAt: new Date().toISOString(),
    })
    expect(refused.status).toBe(409)
    expect(refused.body.data?.code).toBe('trip_cash_not_settled')
    expect(refused.body.data?.receiptIds).toEqual([receiptId])
    expect(refused.body.message).toBe(
      `receipt ${desk.body.item.receiptNo ?? receiptId} was taken on a trip that is not settled yet; bank it after the trip's cash is handed over at Day-end`,
    )
    const after = await call<{ item: { status: string } }>(
      app,
      accountant,
      'GET',
      `/receipts/${receiptId}`,
    )
    expect(after.body.item.status).toBe('collected')
    const [posted] = (
      await db.execute(
        sql`select count(*)::int as n from journal_entries
             where tenant_id = ${tenantId} and ref_type = 'deposit' and ref_id = ${batch}`,
      )
    ).rows as { n: number }[]
    expect(posted?.n).toBe(0)
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

  it("DOS-132: once the trip is settled its cash is in hand and banks from CASH (Dr BANK / Cr CASH, no CASH_VAN line), so CASH_VAN over the trip's receipts, its settlement and the deposit nets to zero", async () => {
    expect(settlementId).not.toBe('')
    expect(await tripStateOf(tripId)).toBe('settled')

    const all = await call<ReceiptListBody>(app, accountant, 'GET', '/receipts', tripCash)
    expect(all.status).toBe(200)
    expect(all.body.totals.countedPaise).toBe(cashCollected)
    const ids = all.body.items.map((r) => r.id).sort()
    expect(ids.length).toBeGreaterThan(0)

    // the settlement handed the cash over: all of it is in hand now, in the rows and in the totals
    const inHand = await call<ReceiptListBody>(app, accountant, 'GET', '/receipts', {
      ...tripCash,
      withCrew: false,
    })
    expect(inHand.status).toBe(200)
    expect(inHand.body.items.map((r) => r.id).sort()).toEqual(ids)
    expect(inHand.body.totals.countedPaise).toBe(cashCollected)

    // every cash receipt of the trip posted Dr CASH_VAN when the crew took it
    const vanNet = async (refs: SQL): Promise<number> =>
      Number(
        (
          (
            await db.execute(sql`
              select coalesce(sum(l.amount_paise), 0)::bigint as net
                from journal_lines l
                join journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
                join accounts a on a.id = l.account_id
               where e.tenant_id = ${tenantId} and a.code = 'CASH_VAN' and (${refs})`)
          ).rows[0] as { net: string }
        ).net,
      )
    const ofReceipts = sql`e.ref_type = 'receipt' and e.ref_id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`
    expect(await vanNet(ofReceipts)).toBe(cashCollected)

    const batch = uuidv7()
    const banked = await call<{ updated: number; journalEntryId: string; totalPaise: number }>(
      app,
      accountant,
      'POST',
      '/receipts/deposit',
      {
        idempotencyKey: `dep-132-settled-${run}`,
        id: batch,
        receiptIds: ids,
        depositedAt: new Date().toISOString(),
        depositRef: `DEP-132-${run}`,
      },
    )
    expect(banked.status).toBe(200)
    expect(banked.body).toMatchObject({ updated: ids.length, totalPaise: cashCollected })
    // the deposit takes the money out of CASH, where the settlement put it — never out of CASH_VAN a second time
    const deposit = Object.fromEntries(
      (
        (
          await db.execute(sql`
            select a.code, sum(l.amount_paise)::bigint as amount
              from journal_lines l
              join journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
              join accounts a on a.id = l.account_id
             where e.tenant_id = ${tenantId} and e.ref_type = 'deposit' and e.ref_id = ${batch}
             group by a.code`)
        ).rows as { code: string; amount: string }[]
      ).map((row) => [row.code, Number(row.amount)]),
    )
    expect(deposit).toEqual({ BANK: cashCollected, CASH: -cashCollected })
    // the van account over this money: the receipts' debits, the settlement's credit and the deposit net to zero
    expect(
      await vanNet(
        sql`(${ofReceipts})
            or (e.ref_type = 'trip_settlement' and e.ref_id = ${settlementId})
            or (e.ref_type = 'deposit' and e.ref_id = ${batch})`,
      ),
    ).toBe(0)

    // banked, and nothing of the trip's money reads as still with the crew
    const onTheRoad = await call<ReceiptListBody>(app, accountant, 'GET', '/receipts', {
      tripId,
      mode: 'cash',
      limit: 200,
      withCrew: true,
    })
    expect(onTheRoad.status).toBe(200)
    expect(onTheRoad.body.items).toEqual([])
    expect(onTheRoad.body.totals.countedPaise).toBe(0)
    for (const id of ids) {
      const got = await call<{ item: { status: string }; withCrew: boolean | null }>(
        app,
        accountant,
        'GET',
        `/receipts/${id}`,
      )
      expect(got.status).toBe(200)
      expect(got.body.item.status).toBe('deposited')
      expect(got.body.withCrew).toBe(false)
    }
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
    // The godown counts the bill out on a confirmed sheet first: no trip departs with a bill no sheet
    // counted out (QA DOS-172), and that refusal comes before the consent check below.
    expect(
      (
        await loadOut(
          app,
          { godown: packer, approver: manager },
          { tripId: trip2, orderIds: [billB3.orderId], tag: `trip2-${run}` },
        )
      ).dispatched,
    ).toEqual([billB3.orderId])
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
  // QA DOS-176 / DOS-177: a client id somebody else already holds, on a row RLS hides from this caller

  it('DOS-176 proof of delivery under an evidence id another crew already holds is refused with a message, never a 500', async () => {
    // The proof id is the client's. `addPod` looks for it first, but that look-up runs under RLS: a row on
    // ANOTHER crew's delivery is invisible, the insert then hits the primary key, and the crew was told
    // "proof insert returned nothing" — a 500 on a delivery it cannot close.
    const podId = uuidv7()
    const evidence = {
      id: podId,
      kind: 'geo',
      payload: { distanceM: 40 },
      lat: 19.2437,
      lng: 73.1355,
    }
    const mine = await call<{ item: { id: string } }>(
      app,
      driver,
      'POST',
      `/delivery/deliveries/${deliveryA1}/pod`,
      { idempotencyKey: `pod-176-a-${run}`, id: deliveryA1, evidence },
    )
    expect(mine.status, JSON.stringify(mine.body)).toBe(200)

    // the same id again, from the same crew: the row IS visible, so it replays
    const again = await call<{ item: { id: string } }>(
      app,
      driver,
      'POST',
      `/delivery/deliveries/${deliveryA1}/pod`,
      { idempotencyKey: `pod-176-b-${run}`, id: deliveryA1, evidence },
    )
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect(again.body.item.id).toBe(podId)

    // the other crew, on its own delivery, reusing that id: refused, and told why
    const [theirs] = (
      await db.execute(
        sql`select id from deliveries where tenant_id = ${tenantId} and trip_id = ${trip2} limit 1`,
      )
    ).rows as { id: string }[]
    expect(theirs?.id).toBeDefined()
    const clash = await call<{ message: string; data?: { code?: string } }>(
      app,
      otherDriver,
      'POST',
      `/delivery/deliveries/${theirs?.id ?? ''}/pod`,
      { idempotencyKey: `pod-176-c-${run}`, id: theirs?.id ?? '', evidence },
    )
    expect(clash.status, JSON.stringify(clash.body)).toBe(409)
    expect(clash.body.data?.code).toBe('pod_id_taken')
    expect(clash.body.message).toContain(podId)
    // and nothing of the other crew's was touched
    const [row] = (await db.execute(sql`select delivery_id from pod_evidence where id = ${podId}`))
      .rows as { delivery_id: string }[]
    expect(row?.delivery_id).toBe(deliveryA1)

    // The DESK is shown the whole tenant's proof (`pod_evidence_read`), so an id-only look-up handed the
    // owner ANOTHER delivery's row back as a 200 "proof recorded" — the app then says the proof is on this
    // delivery when it is on that one (never-list #12). A foreign row this caller CAN see is refused the
    // same way an invisible one is: the answer depends on whose row it is, never on who may look at it.
    const deskClash = await call<{ message: string; data?: { code?: string } }>(
      app,
      owner,
      'POST',
      `/delivery/deliveries/${theirs?.id ?? ''}/pod`,
      { idempotencyKey: `pod-176-d-${run}`, id: theirs?.id ?? '', evidence },
    )
    expect(deskClash.status, JSON.stringify(deskClash.body)).toBe(409)
    expect(deskClash.body.data?.code).toBe('pod_id_taken')
    expect(deskClash.body.message).toContain(podId)
    const [still] = (
      await db.execute(sql`select delivery_id from pod_evidence where id = ${podId}`)
    ).rows as { delivery_id: string }[]
    expect(still?.delivery_id).toBe(deliveryA1)
    // the desk adding proof to its own delivery under a fresh id is untouched by the narrowing
    const deskOwn = await call<{ item: { id: string } }>(
      app,
      owner,
      'POST',
      `/delivery/deliveries/${theirs?.id ?? ''}/pod`,
      {
        idempotencyKey: `pod-176-e-${run}`,
        id: theirs?.id ?? '',
        evidence: { ...evidence, id: uuidv7() },
      },
    )
    expect(deskOwn.status, JSON.stringify(deskOwn.body)).toBe(200)
  })

  it('DOS-177 a location consent under an id another person already holds is refused with a message, never a 500', async () => {
    // Same shape as DOS-176 and the same silence: `location_consents_rw` shows a crew member only its OWN
    // rows, so the look-up missed the owner's row, the insert hit the primary key, and the driver got a
    // 500 with no message at all — on the one gate a trip cannot depart without.
    const consentId = uuidv7()
    const body = { granted: true, noticeVersion: 'gps-2026-09', locale: 'en-IN' }
    const first = await call<{ item: { id: string; userId: string } }>(
      app,
      owner,
      'POST',
      '/delivery/consents',
      { idempotencyKey: `consent-177-a-${run}`, id: consentId, ...body },
    )
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.item.userId).toBe(ownerId)

    const clash = await call<{ message: string; data?: { code?: string } }>(
      app,
      otherDriver,
      'POST',
      '/delivery/consents',
      { idempotencyKey: `consent-177-b-${run}`, id: consentId, ...body },
    )
    expect(clash.status, JSON.stringify(clash.body)).toBe(409)
    expect(clash.body.data?.code).toBe('consent_id_taken')
    expect(clash.body.message).toContain(consentId)
    // the owner's answer is untouched, and the driver's own consent still stands
    const [row] = (
      await db.execute(sql`select user_id from location_consents where id = ${consentId}`)
    ).rows as { user_id: string }[]
    expect(row?.user_id).toBe(ownerId)
    const theirs = await call<{ item: { granted: boolean } | null }>(
      app,
      otherDriver,
      'GET',
      '/delivery/consents',
    )
    expect(theirs.status).toBe(200)
    expect(theirs.body.item?.granted).toBe(true)

    // The desk is shown every consent row (`location_consents_rw`), so the id-only look-up replayed the
    // DRIVER's answer to the owner as the owner's own — against this method's own rule, "Always the
    // CALLER's own row". A row this caller can see is refused like one it cannot.
    const driversConsent = uuidv7()
    const drivers = await call<{ item: { userId: string } }>(
      app,
      driver,
      'POST',
      '/delivery/consents',
      { idempotencyKey: `consent-177-c-${run}`, id: driversConsent, ...body },
    )
    expect(drivers.status, JSON.stringify(drivers.body)).toBe(200)
    expect(drivers.body.item.userId).toBe(driverId)

    const deskClash = await call<{ message: string; data?: { code?: string } }>(
      app,
      owner,
      'POST',
      '/delivery/consents',
      { idempotencyKey: `consent-177-d-${run}`, id: driversConsent, ...body },
    )
    expect(deskClash.status, JSON.stringify(deskClash.body)).toBe(409)
    expect(deskClash.body.data?.code).toBe('consent_id_taken')
    // the driver's answer stands, still current, and the owner's own answer was not closed on the way:
    // the refused call wrote nothing at all.
    const [driversRow] = (
      await db.execute(
        sql`select user_id, withdrawn_at from location_consents where id = ${driversConsent}`,
      )
    ).rows as { user_id: string; withdrawn_at: string | null }[]
    expect(driversRow?.user_id).toBe(driverId)
    expect(driversRow?.withdrawn_at).toBeNull()
    const [ownersRow] = (
      await db.execute(sql`select withdrawn_at from location_consents where id = ${consentId}`)
    ).rows as { withdrawn_at: string | null }[]
    expect(ownersRow?.withdrawn_at).toBeNull()
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

  // ---------------------------------------------------------------------------------------------------------------
  // QA DOS-043: the godown loads, the crew departs, and never past a load sheet that is still a draft

  it('DOS-043: the godown starts loading but cannot send a trip off, nobody departs past a draft load sheet, and both moves are audited', async () => {
    // Tomorrow, so the driver's own trip of today never clashes (the busy check is per trip date). The
    // bill is packed inside this test, not in a hook, so no earlier test sees one more open bill.
    const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10)
    const trip3 = uuidv7()
    const bill = await billedOrder(retailerB, variantA, 'dos043')
    const created = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `dos043-trip-${run}`,
      id: trip3,
      tripDate: tomorrow,
      vehicleId,
      driverId,
      openingCashPaise: 0,
      stops: [{ id: uuidv7(), sequence: 1, retailerId: retailerB, invoiceIds: [bill.invoiceId] }],
    })
    expect(created.status).toBe(200)
    expect(created.body.item.state).toBe('planned')

    const auditRows = async (action: string) =>
      (
        await db.execute(
          sql`select actor_id, actor_role, after from audit_log
               where tenant_id = ${tenantId} and entity_type = 'trip' and entity_id = ${trip3}
                 and action = ${action}
               order by occurred_at, id`,
        )
      ).rows as { actor_id: string; actor_role: string; after: Record<string, unknown> }[]
    const stateOf = async () =>
      (await call<{ item: TripBody }>(app, manager, 'GET', `/delivery/trips/${trip3}`)).body.item
        .state

    // The godown puts the trip into loading, and the move is on the record under its own name.
    const loading = await call<{ item: TripBody }>(
      app,
      packer,
      'POST',
      `/delivery/trips/${trip3}/start-loading`,
      { idempotencyKey: `dos043-loading-${run}` },
    )
    expect(loading.status).toBe(200)
    expect(loading.body.item.state).toBe('loading')
    // Pressed again under a new key, the trip is already loading: no second row.
    expect(
      (
        await call(app, packer, 'POST', `/delivery/trips/${trip3}/start-loading`, {
          idempotencyKey: `dos043-loading-again-${run}`,
        })
      ).status,
    ).toBe(200)
    expect(
      (await auditRows('trip.start_loading')).map((r) => [r.actor_id, r.actor_role, r.after.state]),
    ).toEqual([[packerId, 'warehouse', 'loading']])

    // It never sends the vehicle off: departing is the crew's step (docs/23 D2).
    const godownDepart = await call(app, packer, 'POST', `/delivery/trips/${trip3}/depart`, {
      idempotencyKey: `dos043-depart-godown-${run}`,
    })
    expect(godownDepart.status).toBe(403)
    expect(await stateOf()).toBe('loading')
    expect(await outboxTypes(trip3)).not.toContain('TripDeparted')

    // Two draft sheets hold the load back: one built FOR the trip (van stock only), and one built for
    // the vehicle with no trip on it, the way the warehouse app builds it (DOS-137), that carries the
    // bill riding on this trip's stop.
    const linked = uuidv7()
    const unlinked = uuidv7()
    const linkedSheet = await call<{ item: { status: string } }>(
      app,
      manager,
      'POST',
      '/warehouse/load-sheets',
      {
        idempotencyKey: `dos043-sheet-linked-${run}`,
        id: linked,
        toLocationId: vehicleLocation,
        tripId: trip3,
        vanStock: [{ lotId: lotB, qtyPcs: 1 }],
      },
    )
    expect(linkedSheet.status).toBe(200)
    expect(linkedSheet.body.item.status).toBe('draft')
    const unlinkedSheet = await call<{ item: { status: string } }>(
      app,
      manager,
      'POST',
      '/warehouse/load-sheets',
      {
        idempotencyKey: `dos043-sheet-unlinked-${run}`,
        id: unlinked,
        toLocationId: vehicleLocation,
        orderIds: [bill.orderId],
      },
    )
    expect(unlinkedSheet.status).toBe(200)
    expect(unlinkedSheet.body.item.status).toBe('draft')

    const depart = (tag: string) =>
      call<{
        item: TripBody
        data?: { code?: string; loadSheetIds?: string[]; orderIds?: string[] }
      }>(app, driver, 'POST', `/delivery/trips/${trip3}/depart`, {
        idempotencyKey: `dos043-depart-${tag}-${run}`,
        startOdometerKm: 41_900,
      })
    const cancelSheet = async (sheetId: string) =>
      (
        await call(app, manager, 'POST', `/warehouse/load-sheets/${sheetId}/cancel`, {
          idempotencyKey: `dos043-cancel-${sheetId}`,
          id: sheetId,
          reason: 'DOS-043',
        })
      ).status

    const both = await depart('a')
    expect(both.status).toBe(409)
    expect(both.body.data?.code).toBe('load_sheet_not_confirmed')
    expect(both.body.data?.loadSheetIds).toEqual([linked, unlinked].sort())
    expect(await stateOf()).toBe('loading')
    expect(await orderState(bill.orderId)).toBe('packed')
    expect(await outboxTypes(trip3)).not.toContain('TripDeparted')

    // With the linked sheet cancelled, the unlinked one alone, found through the bill on the stop,
    // still holds the trip.
    expect(await cancelSheet(linked)).toBe(200)
    const unlinkedOnly = await depart('b')
    expect(unlinkedOnly.status).toBe(409)
    expect(unlinkedOnly.body.data?.code).toBe('load_sheet_not_confirmed')
    expect(unlinkedOnly.body.data?.loadSheetIds).toEqual([unlinked])
    expect(await stateOf()).toBe('loading')

    // No draft left, yet nobody has counted the bill out: the crew still waits (QA DOS-172), and the
    // refusal writes no audit row and no event.
    expect(await cancelSheet(unlinked)).toBe(200)
    const uncounted = await depart('c')
    expect(uncounted.status, JSON.stringify(uncounted.body)).toBe(409)
    expect(uncounted.body.data?.code).toBe('bill_not_loaded')
    expect(uncounted.body.data?.orderIds).toEqual([bill.orderId])
    expect(await stateOf()).toBe('loading')
    expect(await orderState(bill.orderId)).toBe('packed')
    expect(await outboxTypes(trip3)).not.toContain('TripDeparted')
    expect(await auditRows('trip.depart')).toEqual([])

    // The godown counts it out on a confirmed sheet: the crew departs, the bill left with that sheet, and
    // the departure is audited once.
    await loadOut(
      app,
      { godown: packer, approver: manager },
      { tripId: trip3, orderIds: [bill.orderId], tag: `dos043-${run}` },
    )
    const departed = await depart('d')
    expect(departed.status).toBe(200)
    expect(departed.body.item.state).toBe('active')
    expect(await orderState(bill.orderId)).toBe('dispatched')
    expect(await outboxTypes(trip3)).toEqual(['TripPlanned', 'TripLoading', 'TripDeparted'])
    expect(
      (await auditRows('trip.depart')).map((r) => [
        r.actor_id,
        r.actor_role,
        r.after.state,
        r.after.startOdometerKm,
      ]),
    ).toEqual([[driverId, 'delivery', 'active', 41_900]])
  }, 180_000)

  /*
   * QA DOS-043, founder 2026-09-20: a trip MAY depart before its planned date, and the early departure is
   * RECORDED — the trip carries the date it was planned for and "departed early" beside it. Refusing an
   * early departure only pushes the desk to rewrite the plan, which destroys the record of what was
   * planned. Two van-sales runs carrying no bills, so the load-out gates of the test above are not what is
   * measured here: one leaves two days early, one leaves on the day it was planned for.
   */
  it('DOS-043: a trip leaves before its planned date, the date it was planned for stands, and the trip says it departed early', async () => {
    const day = (offset: number): string =>
      new Date(Date.parse(today) + offset * 86_400_000).toISOString().slice(0, 10)
    const plan = async (id: string, tripDate: string, tag: string): Promise<TripBody> => {
      const created = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
        idempotencyKey: `dos043e-plan-${tag}-${run}`,
        id,
        tripDate,
        vehicleId,
        driverId,
        // no stops and no bills: a van-sales round, so only the DATE stands between it and the road
        vanSalesEnabled: true,
        openingCashPaise: 0,
        stops: [],
      })
      expect(created.status, JSON.stringify(created.body)).toBe(200)
      // planned -> loading -> active: the godown puts the vehicle on the dock, as on any other trip
      const loading = await call(app, packer, 'POST', `/delivery/trips/${id}/start-loading`, {
        idempotencyKey: `dos043e-loading-${tag}-${run}`,
      })
      expect(loading.status, JSON.stringify(loading.body)).toBe(200)
      return created.body.item
    }
    const depart = (id: string, tag: string, occurredAt?: string) =>
      call<{ item: TripBody; data?: { code?: string } }>(
        app,
        driver,
        'POST',
        `/delivery/trips/${id}/depart`,
        {
          idempotencyKey: `dos043e-depart-${tag}-${run}`,
          ...(occurredAt === undefined ? {} : { occurredAt }),
        },
      )

    const earlyId = uuidv7()
    const planned = await plan(earlyId, day(2), 'early')
    expect(planned.tripDate).toBe(day(2))
    // Nothing has left yet, so nothing has left early.
    expect(planned.departedEarly).toBe(false)

    // Two days early, standing at the godown today: the vehicle goes.
    const left = await depart(earlyId, 'early')
    expect(left.status, JSON.stringify(left.body)).toBe(200)
    expect(left.body.item.state).toBe('active')
    // The plan is not rewritten to fit the departure: the date it was planned for stands...
    expect(left.body.item.tripDate).toBe(day(2))
    // ...and every reader is told it left early, not only the reply that sent it.
    expect(left.body.item.departedEarly).toBe(true)
    const read = await call<{ item: TripBody }>(app, manager, 'GET', `/delivery/trips/${earlyId}`)
    expect(read.status).toBe(200)
    expect(read.body.item.tripDate).toBe(day(2))
    expect(read.body.item.departedEarly).toBe(true)
    const listed = await call<{
      items: { id: string; tripDate: string; departedEarly: boolean }[]
    }>(app, manager, 'GET', '/delivery/trips', { from: day(2), to: day(2), limit: 50 })
    expect(listed.status).toBe(200)
    expect(listed.body.items.find((t) => t.id === earlyId)).toMatchObject({
      tripDate: day(2),
      departedEarly: true,
    })

    // The audit row carries it too, beside the date the trip was planned for.
    const audited = (
      await db.execute(
        sql`select after from audit_log
             where tenant_id = ${tenantId} and entity_type = 'trip' and entity_id = ${earlyId}
               and action = 'trip.depart'
             order by occurred_at, id`,
      )
    ).rows as { after: Record<string, unknown> }[]
    expect(audited.map((r) => [r.after.tripDate, r.after.departedEarly])).toEqual([[day(2), true]])

    // The control: a trip that leaves ON the day it was planned for left early of nothing.
    const onDayId = uuidv7()
    const onDayPlan = await plan(onDayId, day(3), 'onday')
    expect(onDayPlan.tripDate).toBe(day(3))
    const onDay = await depart(onDayId, 'onday', `${day(3)}T06:00:00.000Z`)
    expect(onDay.status, JSON.stringify(onDay.body)).toBe(200)
    expect(onDay.body.item.state).toBe('active')
    expect(onDay.body.item.departedEarly).toBe(false)
  }, 120_000)

  /*
   * QA DOS-023, founder 2026-09-20: "every list in every app orders by SERVER time, newest first, with the
   * record id only as a tie-break". A stop id is minted on the device that planned it, which offline is not
   * when the office saw it, so the two orders are made to disagree here: the stop added SECOND carries the
   * LOWER id. The route order of one trip is `sequence` and is read from the trip, never from this list.
   */
  it('DOS-023: stops.list is newest first by the time the office saw the stop, the row id only breaking a tie', async () => {
    const tripS = uuidv7()
    const created = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `dos023-trip-${run}`,
      id: tripS,
      tripDate: new Date(Date.parse(today) + 4 * 86_400_000).toISOString().slice(0, 10),
      vehicleId,
      driverId,
      vanSalesEnabled: true,
      openingCashPaise: 0,
      stops: [],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)

    // Minted in this order, so `lowerId < higherId`; ADDED the other way round, one call each, so the
    // office saw `lowerId` LAST.
    const lowerId = uuidv7()
    const higherId = uuidv7()
    expect(lowerId < higherId).toBe(true)
    const addStop = async (stopId: string, retailerId: string, tag: string) => {
      const res = await call(app, manager, 'POST', `/delivery/trips/${tripS}/stops`, {
        idempotencyKey: `dos023-stop-${tag}-${run}`,
        id: tripS,
        stop: { id: stopId, retailerId },
      })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
    }
    await addStop(higherId, retailerA, 'first')
    await addStop(lowerId, retailerB, 'second')

    interface StopPage {
      items: { id: string }[]
      nextCursor: string | null
    }
    const page = (query: Record<string, unknown>) =>
      call<StopPage>(app, manager, 'GET', '/delivery/stops', query)

    // The stop the office saw LAST is on top, though its id is the lower of the two.
    const both = await page({ tripId: tripS, limit: 50 })
    expect(both.status, JSON.stringify(both.body)).toBe(200)
    expect(both.body.items.map((s) => s.id)).toEqual([lowerId, higherId])

    // and the cursor walks that same order, each stop once
    const first = await page({ tripId: tripS, limit: 1 })
    expect(first.body.items.map((s) => s.id)).toEqual([lowerId])
    expect(first.body.nextCursor).toBe(lowerId)
    const second = await page({ tripId: tripS, limit: 1, cursor: first.body.nextCursor })
    expect(second.body.items.map((s) => s.id)).toEqual([higherId])
    const third = await page({ tripId: tripS, limit: 1, cursor: second.body.nextCursor })
    expect(third.body.items).toEqual([])
  }, 120_000)

  // ---------------------------------------------------------------------------------------------------------------
  // QA DOS-131: the godown and the desk plan a trip from one planning board, and the double-plan guard is role-proof

  /** Five days out and beyond, so no other test's trip shares the crew's day (the busy check is per trip date). */
  const planDay = (offset: number): string =>
    new Date(Date.parse(today) + (5 + offset) * 86_400_000).toISOString().slice(0, 10)
  const tripP = uuidv7()
  let p1: Awaited<ReturnType<typeof billedOrder>>
  let p2: Awaited<ReturnType<typeof billedOrder>>
  /** Planned rows of one bill, whatever trip they are on (the owner connection reads through RLS). */
  const outcomeNullRows = async (invoiceId: string): Promise<number> =>
    (
      (
        await db.execute(
          sql`select count(*)::int as n from deliveries
               where tenant_id = ${tenantId} and invoice_id = ${invoiceId} and outcome is null`,
        )
      ).rows[0] as { n: number }
    ).n

  it('DOS-131: the planning board names the crew and who is on a trip that day, and lists only packed bills not yet on an open trip, for the godown and the desk, never the crew, the accountant, a rep or a shop', async () => {
    // Packed inside the test, not in a hook, so no earlier test sees two more open bills.
    p1 = await billedOrder(retailerA, variantA, 'dos131-p1')
    p2 = await billedOrder(retailerB, variantB, 'dos131-p2')
    const day = planDay(0)
    const planned = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `dos131-trip-${run}`,
      id: tripP,
      tripDate: day,
      vehicleId,
      driverId: otherDriverId,
      stops: [{ id: uuidv7(), sequence: 1, retailerId: retailerA, invoiceIds: [p1.invoiceId] }],
    })
    expect(planned.status).toBe(200)
    const tripNo = planned.body.item.tripNo
    expect(tripNo).not.toBeNull()

    // The godown reads the board: every active member of the crew, and who is already on a trip that day.
    const board = await call<PlanningBody>(app, packer, 'GET', '/delivery/trip-planning', {
      date: day,
      limit: 200,
    })
    expect(board.status).toBe(200)
    expect(board.body.date).toBe(day)
    const crew = new Map(board.body.crew.map((member) => [member.userId, member]))
    expect(crew.get(otherDriverId)).toEqual({
      userId: otherDriverId,
      name: 'Other driver',
      onTripId: tripP,
      onTripNo: tripNo,
    })
    expect(crew.get(driverId)).toEqual({
      userId: driverId,
      name: 'Driver',
      onTripId: null,
      onTripNo: null,
    })
    expect([...crew.keys()].sort()).toEqual([driverId, helperId, otherDriverId].sort())
    for (const person of [ownerId, managerId, accountantId, packerId, repId, shopUserA, shopUserB])
      expect(crew.has(person), person).toBe(false)
    // No phone and no username leave through the board.
    for (const member of board.body.crew)
      expect(Object.keys(member).sort()).toEqual(['name', 'onTripId', 'onTripNo', 'userId'])

    // The bills: packed, a live bill, and on no open trip. Sale values only.
    const bill = board.body.bills.find((b) => b.invoiceId === p2.invoiceId)
    expect(bill).toMatchObject({
      invoiceId: p2.invoiceId,
      orderId: p2.orderId,
      retailerId: retailerB,
      retailerName: `Van Shop B ${run}`,
      invoiceTotalPaise: p2.totalPaise,
    })
    expect(bill?.invoiceNo).not.toBeNull()
    for (const item of board.body.bills)
      expect(Object.keys(item).sort()).toEqual([
        'beatId',
        'beatName',
        'invoiceId',
        'invoiceNo',
        'invoiceTotalPaise',
        'orderId',
        'orderNo',
        'retailerId',
        'retailerName',
      ])
    const billIds = board.body.bills.map((b) => b.invoiceId)
    // Planned on tripP a moment ago, and delivered earlier in this file.
    expect(billIds).not.toContain(p1.invoiceId)
    expect(billIds).not.toContain(billA1.invoiceId)
    expect(board.body.nextCursor).toBeNull()

    // The desk reads the same board.
    const desk = await call<PlanningBody>(app, manager, 'GET', '/delivery/trip-planning', {
      date: day,
      limit: 200,
    })
    expect(desk.status).toBe(200)
    expect(desk.body.bills.map((b) => b.invoiceId)).toEqual(billIds)

    // The crew, the accountant, a rep and a shop never read it.
    for (const actor of [driver, accountant, rep, shopA])
      expect(
        (await call(app, actor, 'GET', '/delivery/trip-planning', { date: day })).status,
        actor.role,
      ).toBe(403)

    // No widening: the godown still reads no doorstep row of the trip it planned.
    const packerView = await call<{ item: TripBody }>(
      app,
      packer,
      'GET',
      `/delivery/trips/${tripP}`,
    )
    expect(packerView.status).toBe(200)
    expect(packerView.body.item.stops[0]?.deliveries).toEqual([])
  }, 180_000)

  it('DOS-131: the godown plans a trip and adds a late bill, and a bill already riding on an open trip, or carried twice in one plan, is refused 409 for the godown as for the desk', async () => {
    // A bill riding on tripP, planned again by the godown (whose RLS hides the planned row): 409.
    const again = await call<{ message?: string }>(app, packer, 'POST', '/delivery/trips', {
      idempotencyKey: `dos131-again-${run}`,
      id: uuidv7(),
      tripDate: planDay(1),
      vehicleId,
      driverId: helperId,
      stops: [{ id: uuidv7(), sequence: 1, retailerId: retailerA, invoiceIds: [p1.invoiceId] }],
    })
    expect(again.status).toBe(409)
    expect(again.body.message).toContain('already planned on trip')
    expect(await outcomeNullRows(p1.invoiceId)).toBe(1)

    // One plan carrying the same bill on two stops: 409, and nothing of it is left behind.
    const twice = await call<{ message?: string }>(app, packer, 'POST', '/delivery/trips', {
      idempotencyKey: `dos131-twice-${run}`,
      id: uuidv7(),
      tripDate: planDay(2),
      vehicleId,
      driverId: helperId,
      stops: [
        { id: uuidv7(), sequence: 1, retailerId: retailerB, invoiceIds: [p2.invoiceId] },
        { id: uuidv7(), sequence: 2, retailerId: retailerB, invoiceIds: [p2.invoiceId] },
      ],
    })
    expect(twice.status).toBe(409)
    expect(twice.body.message).toContain('already planned on trip')
    expect(await outcomeNullRows(p2.invoiceId)).toBe(0)

    // The desk is refused the same way.
    const deskAgain = await call<{ message?: string }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `dos131-desk-again-${run}`,
      id: uuidv7(),
      tripDate: planDay(1),
      vehicleId,
      driverId: helperId,
      stops: [{ id: uuidv7(), sequence: 1, retailerId: retailerA, invoiceIds: [p1.invoiceId] }],
    })
    expect(deskAgain.status).toBe(409)
    expect(deskAgain.body.message).toContain('already planned on trip')

    // The godown adds the late bill to the planned trip.
    const late = await call<{ item: TripBody }>(
      app,
      packer,
      'POST',
      `/delivery/trips/${tripP}/stops`,
      {
        idempotencyKey: `dos131-late-${run}`,
        id: tripP,
        stop: { id: uuidv7(), retailerId: retailerB, invoiceIds: [p2.invoiceId] },
      },
    )
    expect(late.status).toBe(200)
    expect(late.body.item.plannedStops).toBe(2)
    expect(await outcomeNullRows(p2.invoiceId)).toBe(1)

    // ...and cannot plan it a second time on another trip.
    const lateAgain = await call<{ message?: string }>(app, packer, 'POST', '/delivery/trips', {
      idempotencyKey: `dos131-late-again-${run}`,
      id: uuidv7(),
      tripDate: planDay(1),
      vehicleId,
      driverId: helperId,
      stops: [{ id: uuidv7(), sequence: 1, retailerId: retailerB, invoiceIds: [p2.invoiceId] }],
    })
    expect(lateAgain.status).toBe(409)
    expect(lateAgain.body.message).toContain('already planned on trip')
    expect(await outcomeNullRows(p2.invoiceId)).toBe(1)

    // A cancelled trip keeps its outcome-null rows and blocks nothing: the board offers both bills
    // again, its driver is free, and a fresh plan takes the bill (why no partial unique index exists).
    const cancelled = await call<{ item: TripBody }>(
      app,
      manager,
      'POST',
      `/delivery/trips/${tripP}/cancel`,
      { idempotencyKey: `dos131-cancel-${run}`, id: tripP, reason: 'DOS-131' },
    )
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.item.state).toBe('cancelled')
    const reopened = await call<PlanningBody>(app, packer, 'GET', '/delivery/trip-planning', {
      date: planDay(0),
      limit: 200,
    })
    expect(reopened.status).toBe(200)
    expect(reopened.body.bills.map((b) => b.invoiceId)).toEqual(
      expect.arrayContaining([p1.invoiceId, p2.invoiceId]),
    )
    expect(
      reopened.body.crew.find((member) => member.userId === otherDriverId)?.onTripId,
    ).toBeNull()
    const replan = uuidv7()
    const replanned = await call<{ item: TripBody }>(app, packer, 'POST', '/delivery/trips', {
      idempotencyKey: `dos131-replan-${run}`,
      id: replan,
      tripDate: planDay(3),
      vehicleId,
      driverId: helperId,
      stops: [{ id: uuidv7(), sequence: 1, retailerId: retailerA, invoiceIds: [p1.invoiceId] }],
    })
    expect(replanned.status).toBe(200)
    expect(await outcomeNullRows(p1.invoiceId)).toBe(2)
    expect(
      (
        await call(app, manager, 'POST', `/delivery/trips/${replan}/cancel`, {
          idempotencyKey: `dos131-replan-cancel-${run}`,
          id: replan,
          reason: 'DOS-131',
        })
      ).status,
    ).toBe(200)
  }, 180_000)

  it('DOS-131: two planners adding the same bill to two trips at the same instant take turns on the bill: one stop lands, the other is refused 409', async () => {
    const tripX = uuidv7()
    const tripY = uuidv7()
    for (const [id, driverOfTrip] of [
      [tripX, driverId],
      [tripY, otherDriverId],
    ] as const)
      expect(
        (
          await call(app, manager, 'POST', '/delivery/trips', {
            idempotencyKey: `dos131-race-${id}`,
            id,
            tripDate: planDay(4),
            vehicleId,
            driverId: driverOfTrip,
            vanSalesEnabled: true,
            stops: [],
          })
        ).status,
      ).toBe(200)
    const add = (tripOf: string) =>
      call<{ message?: string }>(app, packer, 'POST', `/delivery/trips/${tripOf}/stops`, {
        idempotencyKey: `dos131-race-add-${tripOf}`,
        id: tripOf,
        stop: { id: uuidv7(), retailerId: retailerB, invoiceIds: [p2.invoiceId] },
      })
    const results = await Promise.all([add(tripX), add(tripY)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(results.find((r) => r.status === 409)?.body.message).toContain('already planned on trip')
    const onOpenTrips = await db.execute(
      sql`select count(*)::int as n from deliveries d join trips t on t.id = d.trip_id
           where d.tenant_id = ${tenantId} and d.invoice_id = ${p2.invoiceId} and d.outcome is null
             and t.state not in ('settled', 'settled_with_variance', 'cancelled')`,
    )
    expect(onOpenTrips.rows[0]).toEqual({ n: 1 })
    for (const id of [tripX, tripY])
      expect(
        (
          await call(app, manager, 'POST', `/delivery/trips/${id}/cancel`, {
            idempotencyKey: `dos131-race-cancel-${id}`,
            id,
            reason: 'DOS-131',
          })
        ).status,
      ).toBe(200)
  }, 180_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-056: the doorstep write made with no signal

  const tripOffline = uuidv7()
  const stopOffline = uuidv7()

  interface UploadBody {
    accepted: number
    replayed: number
    rejected: { opId: string; code: string; messageEn: string }[]
  }

  it('DOS-056 an offline delivery for a credit shop, queued with its photo inline after an offline arrival, is accepted from /sync/upload and pod_evidence holds only an object key', async () => {
    // Trips 1 and 2 are settled by now, so the driver and the van are free for a third round today.
    const bill = await billedOrder(retailerA, variantB, 'a3')
    const planned = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `trip3-${run}`,
      id: tripOffline,
      tripDate: today,
      vehicleId,
      driverId,
      stops: [
        { id: stopOffline, sequence: 1, retailerId: retailerA, invoiceIds: [bill.invoiceId] },
      ],
    })
    expect(planned.status).toBe(200)
    expect(planned.body.item.tripNo).toMatch(/^TRIP-\d{4}$/)
    expect(
      (
        await call(app, packer, 'POST', `/delivery/trips/${tripOffline}/start-loading`, {
          idempotencyKey: `loading3-${run}`,
        })
      ).status,
    ).toBe(200)
    // A bill leaves the godown only on a confirmed load sheet (QA DOS-172).
    await loadOut(
      app,
      { godown: packer, approver: manager },
      { tripId: tripOffline, orderIds: [bill.orderId], tag: `dos056-${run}` },
    )
    const departed = await call<{ item: TripBody }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripOffline}/depart`,
      { idempotencyKey: `depart3-${run}` },
    )
    expect(departed.status).toBe(200)
    expect(departed.body.item.state).toBe('active')

    // What the phone holds: the PLANNED delivery row and the `updated_at` its pull delivered.
    const onPhone = await call<{ item: TripBody }>(
      app,
      driver,
      'GET',
      `/delivery/trips/${tripOffline}`,
    )
    const deliveryId = onPhone.body.item.stops[0]?.deliveries[0]?.id ?? ''
    expect(deliveryId).not.toBe('')
    const [held] = (
      await db.execute(sql`select updated_at from deliveries where id = ${deliveryId}`)
    ).rows as { updated_at: Date | string }[]
    const baseUpdatedAt = new Date(held?.updated_at ?? 0).toISOString()

    // A dead spot: "I am at the shop", then the delivery with the photo of the signed bill INLINE.
    const deviceId = `driver-phone-dos056-${run}`
    const at = new Date().toISOString()
    const res = await call<UploadBody>(app, driver, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId,
      ops: [
        {
          opId: `dos056-arrive-${run}`,
          op: 'PATCH',
          table: 'trip_stops',
          id: stopOffline,
          data: { state: 'arrived', occurred_at: at, lat: 19.2441, lng: 73.1356 },
        },
        {
          opId: `dos056-deliver-${run}`,
          op: 'PUT',
          table: 'deliveries',
          id: deliveryId,
          baseUpdatedAt,
          data: {
            trip_id: tripOffline,
            stop_id: stopOffline,
            invoice_id: bill.invoiceId,
            retailer_id: retailerA,
            order_id: bill.orderId,
            delivered_at: at,
            device_id: deviceId,
            lines: [
              {
                id: uuidv7(),
                invoice_line_id: bill.lineId,
                delivered_qty_pcs: 12,
                returned_qty_pcs: 0,
                returned_saleable: true,
              },
            ],
            pod: [
              {
                id: uuidv7(),
                kind: 'photo',
                inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
                captured_at: at,
              },
            ],
          },
        },
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body.rejected).toEqual([])
    expect(res.body.accepted).toBe(2)

    const detail = await call<{ item: DeliveryDetailBody }>(
      app,
      driver,
      'GET',
      `/delivery/deliveries/${deliveryId}`,
    )
    expect(detail.status).toBe(200)
    expect(detail.body.item.outcome).toBe('delivered')
    const photo = detail.body.item.pod.find((p) => p.kind === 'photo')
    expect(photo?.objectKey).toMatch(/^tenant\/.*\/pod\//)
    expect(photo?.objectKey).toContain(deliveryId)
    const after = await call<{ item: TripBody }>(
      app,
      driver,
      'GET',
      `/delivery/trips/${tripOffline}`,
    )
    expect(after.body.item.stops[0]?.state).toBe('delivered')
    expect(await orderState(bill.orderId)).toBe('delivered')

    // The bytes went to object storage through the files platform; the row holds the KEY and nothing
    // else, so no pull can ever carry a photo back to a phone.
    const pods = (
      await db.execute(
        sql`select kind::text as kind, object_key, payload from pod_evidence where delivery_id = ${deliveryId}`,
      )
    ).rows as { kind: string; object_key: string | null; payload: unknown }[]
    expect(pods).toHaveLength(1)
    expect(pods[0]?.kind).toBe('photo')
    expect(pods[0]?.object_key).toBe(photo?.objectKey)
    expect(pods[0]?.payload).toBeNull()
    expect(JSON.stringify(pods)).not.toContain(TINY_PNG)
    const files = (
      await db.execute(
        sql`select status::text as status from file_objects where tenant_id = ${tenantId} and object_key = ${pods[0]?.object_key ?? ''}`,
      )
    ).rows as { status: string }[]
    expect(files.map((f) => f.status)).toEqual(['uploaded'])
    const outcomes = (
      await db.execute(
        sql`select outcome from sync_ops where tenant_id = ${tenantId} and device_id = ${deviceId} order by op_id`,
      )
    ).rows as { outcome: unknown }[]
    expect(outcomes.map((o) => o.outcome)).toEqual([{ ok: true }, { ok: true }])
  }, 120_000)

  it("DOS-056 a malformed offline delivery is refused row_invalid in the rule's own sentence, never as a Zod JSON array", async () => {
    const res = await call<UploadBody>(app, driver, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId: `driver-phone-dos056-bad-${run}`,
      ops: [
        {
          opId: `dos056-bad-${run}`,
          op: 'PUT',
          table: 'deliveries',
          id: uuidv7(),
          data: {
            trip_id: uuidv7(),
            stop_id: uuidv7(),
            invoice_id: uuidv7(),
            lines: [
              {
                id: uuidv7(),
                invoice_line_id: uuidv7(),
                delivered_qty_pcs: 12,
                returned_qty_pcs: 0,
              },
            ],
            // a photo that carries neither a key nor its bytes
            pod: [{ id: uuidv7(), kind: 'photo' }],
          },
        },
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(0)
    expect(res.body.rejected).toHaveLength(1)
    expect(res.body.rejected[0]?.code).toBe('row_invalid')
    expect(res.body.rejected[0]?.messageEn).toBe(
      'a photo or signature carries exactly one of objectKey / inline; an otp or geo carries neither',
    )
    expect(res.body.rejected[0]?.messageEn.startsWith('[')).toBe(false)
  })

  it('DOS-056 an oversize offline op is refused row_too_large as a 2xx sync_error, never a 413, and the rest of the batch still lands', async () => {
    const deviceId = `driver-phone-dos056-big-${run}`
    // Four doorstep writes that each swallowed an uncompressed photo: ~1.7 MiB of JSON apiece, ~7 MiB
    // for the whole body — far past Fastify's 1 MiB default, inside the sync route's 8 MiB.
    const uncompressed = 'A'.repeat(1_800_000)
    const oversize = [1, 2, 3, 4].map((n) => ({
      opId: `dos056-big-${n}-${run}`,
      op: 'PUT',
      table: 'deliveries',
      id: uuidv7(),
      data: {
        trip_id: tripOffline,
        stop_id: stopOffline,
        invoice_id: uuidv7(),
        lines: [
          { id: uuidv7(), invoice_line_id: uuidv7(), delivered_qty_pcs: 1, returned_qty_pcs: 0 },
        ],
        pod: [
          {
            id: uuidv7(),
            kind: 'photo',
            inline: { mimeType: 'image/jpeg', contentBase64: uncompressed },
          },
        ],
      },
    }))
    const expenseId = uuidv7()
    const res = await call<UploadBody>(app, driver, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId,
      ops: [
        ...oversize,
        {
          opId: `dos056-toll-${run}`,
          op: 'PUT',
          table: 'trip_expenses',
          id: expenseId,
          data: { trip_id: tripOffline, kind: 'toll', amount_paise: 2_500 },
        },
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(1)
    expect(res.body.rejected.map((r) => r.code)).toEqual([
      'row_too_large',
      'row_too_large',
      'row_too_large',
      'row_too_large',
    ])
    expect(res.body.rejected[0]?.messageEn).toMatch(/too large/)
    const errors = (
      await db.execute(
        sql`select code from sync_errors where tenant_id = ${tenantId} and device_id = ${deviceId}`,
      )
    ).rows as { code: string }[]
    expect(errors.map((e) => e.code)).toEqual([
      'row_too_large',
      'row_too_large',
      'row_too_large',
      'row_too_large',
    ])
    const expenses = (
      await db.execute(sql`select kind::text as kind from trip_expenses where id = ${expenseId}`)
    ).rows as { kind: string }[]
    expect(expenses.map((e) => e.kind)).toEqual(['toll'])
  }, 60_000)

  // ---------------------------------------------------------------------------------------------------------------
  // QA DOS-112: the Day-end settle exactly as the apps put it on the wire

  /**
   * A trip with no stops, on a vehicle of its own, walked planned → loading → active → closing for the other
   * driver, `daysAhead` days out so the busy check (one open trip per driver per date) never meets another
   * test's trip. Nothing is collected, spent or loaded, so the cockpit expects the opening float and an empty
   * van: handing the float over settles green with no `counted` list, which is what the Day-end screen sends.
   */
  const closingTrip = async (label: string, daysAhead: number, plate: string): Promise<string> => {
    const vehicle = uuidv7()
    expect(
      (
        await call(app, owner, 'POST', '/delivery/vehicles', {
          idempotencyKey: `${label}-vehicle-${run}`,
          id: vehicle,
          regNo: `MH-05-${plate}-${run.slice(-4)}`,
          name: `Tempo ${plate}`,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call(app, otherDriver, 'POST', '/delivery/consents', {
          idempotencyKey: `${label}-consent-${run}`,
          id: uuidv7(),
          granted: true,
          noticeVersion: 'gps-2026-09',
        })
      ).status,
    ).toBe(200)
    const trip = uuidv7()
    const created = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `${label}-trip-${run}`,
      id: trip,
      tripDate: new Date(Date.parse(today) + daysAhead * 86_400_000).toISOString().slice(0, 10),
      vehicleId: vehicle,
      driverId: otherDriverId,
      // a trip with no stops is a van-sales run; this one never sells, so the van stays empty
      vanSalesEnabled: true,
      openingCashPaise: 50_000,
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    for (const step of ['start-loading', 'depart', 'return']) {
      const moved = await call(app, otherDriver, 'POST', `/delivery/trips/${trip}/${step}`, {
        idempotencyKey: `${label}-${step}-${run}`,
      })
      expect(moved.status, `${step} → ${JSON.stringify(moved.body)}`).toBe(200)
    }
    expect(await tripStateOf(trip)).toBe('closing')
    return trip
  }

  it('DOS-112 Day-end settle as the apps send it is accepted', async () => {
    const trip = await closingTrip('dos112-settle', 40, 'SA')

    // The route stays under the guard's path/body check: a hand-built body naming another trip than the
    // path is refused before any handler runs, and the trip is untouched.
    const otherTrip = uuidv7()
    const mismatch = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/delivery/trips/${trip}/settle`,
      {
        idempotencyKey: `dos112-settle-mismatch-${run}`,
        id: uuidv7(),
        tripId: otherTrip,
        handedOverCashPaise: 50_000,
      },
    )
    expect(mismatch.status).toBe(400)
    expect(mismatch.body.message).toContain(otherTrip)
    expect(await tripStateOf(trip)).toBe('closing')

    // The request @dos/api-client's OpenAPILink builds from manager-app/app/money/day-end.tsx's input
    // (frontend/libs/api-client/src/client.test.ts pins it): the trip fills the path, the new settlement's
    // own id stays in the body, and `tripId` has left the body for the path.
    const settlementId = uuidv7()
    const wire = {
      id: settlementId,
      idempotencyKey: `dos112-settle-${run}`,
      handedOverCashPaise: 50_000,
      acceptVariance: false,
      note: 'counted with the crew',
    }
    const res = await call<{
      item: SettlementBody & { tripId: string }
      tripState: string
      stockAdjustments: unknown[]
    }>(app, manager, 'POST', `/delivery/trips/${trip}/settle`, wire)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.tripState).toBe('settled')
    expect(res.body.item.id).toBe(settlementId)
    expect(res.body.item.tripId).toBe(trip)
    expect(res.body.item.hasVariance).toBe(false)
    expect(res.body.stockAdjustments).toEqual([])
    expect(await tripStateOf(trip)).toBe('settled')

    // The same tap retried replays the stored reply; the trip still has exactly one settlement row.
    const replay = await call<{ item: SettlementBody }>(
      app,
      manager,
      'POST',
      `/delivery/trips/${trip}/settle`,
      wire,
    )
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(settlementId)
    const rows = (
      await db.execute(
        sql`select id, trip_id, handed_over_cash_paise, settled_by from trip_settlements
             where tenant_id = ${tenantId} and trip_id = ${trip}`,
      )
    ).rows as { id: string; trip_id: string; handed_over_cash_paise: number; settled_by: string }[]
    expect(
      rows.map((r) => [r.id, r.trip_id, Number(r.handed_over_cash_paise), r.settled_by]),
    ).toEqual([[settlementId, trip, 50_000, managerId]])
  })

  /**
   * DOS-148 — A BILL THAT NEVER LEFT THE GODOWN IS REFUSED IN WORDS THE DRIVER CAN ACT ON.
   *
   * Measured on the Pixel 7: a stop offered "Deliver this bill" for INV/0831, whose order was still
   * `packed` and on no confirmed load sheet. The crew pressed `−`, chose a reason, photographed the
   * signed bill and pressed Record — and only THEN did the office answer 409
   * `order: cannot apply "deliver_partial" in state "packed"`. That is the order machine's own
   * `TransitionError` printed in red at a shop door: a driver holding a signed bill for goods that were
   * never on his van, and developer text telling him nothing about whose mistake it was.
   *
   * A stop like that is reached by `trips.addStop` — the late bill the godown adds to a trip already on
   * the road, which the depart gate (QA DOS-043 / DOS-172) never sees. So the refusal belongs in
   * `deliveries.record`, before `assertPodPolicy` asks for a photograph and long before
   * `applyFulfilmentEvent` is allowed to raise the machine's sentence.
   */
  it('DOS-148 a bill whose order never left the godown is refused before the photo, in a sentence a driver can act on, and nothing is written', async () => {
    // Issued at pack and dispatched by nobody: exactly INV/0831.
    const stranded = await billedOrder(retailerA, variantA, 'dos148')
    expect(await orderState(stranded.orderId)).toBe('packed')

    // A van-sales trip of its own so no other test's stops move. It departs EMPTY — which is why the
    // load-out gate has nothing to refuse — and the godown adds the stranded bill once it is on the road.
    const vehicle = uuidv7()
    expect(
      (
        await call(app, owner, 'POST', '/delivery/vehicles', {
          idempotencyKey: `dos148-vehicle-${run}`,
          id: vehicle,
          regNo: `MH-05-ND-${run.slice(-4)}`,
          name: 'Tempo ND',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call(app, otherDriver, 'POST', '/delivery/consents', {
          idempotencyKey: `dos148-consent-${run}`,
          id: uuidv7(),
          granted: true,
          noticeVersion: 'gps-2026-09',
        })
      ).status,
    ).toBe(200)
    const trip = uuidv7()
    const created = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `dos148-trip-${run}`,
      id: trip,
      tripDate: new Date(Date.parse(today) + 55 * 86_400_000).toISOString().slice(0, 10),
      vehicleId: vehicle,
      driverId: otherDriverId,
      vanSalesEnabled: true,
      openingCashPaise: 0,
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    for (const step of ['start-loading', 'depart']) {
      const moved = await call(app, otherDriver, 'POST', `/delivery/trips/${trip}/${step}`, {
        idempotencyKey: `dos148-${step}-${run}`,
      })
      expect(moved.status, `${step} → ${JSON.stringify(moved.body)}`).toBe(200)
    }
    expect(await tripStateOf(trip)).toBe('active')

    const stopId = uuidv7()
    const added = await call<{ item: TripBody }>(
      app,
      manager,
      'POST',
      `/delivery/trips/${trip}/stops`,
      {
        idempotencyKey: `dos148-stop-${run}`,
        id: trip,
        stop: { id: stopId, retailerId: retailerA, invoiceIds: [stranded.invoiceId] },
      },
    )
    expect(added.status, JSON.stringify(added.body)).toBe(200)
    const onTheRoad = await call<{ item: TripBody }>(app, manager, 'GET', `/delivery/trips/${trip}`)
    const plannedId =
      onTheRoad.body.item.stops.find((s) => s.id === stopId)?.deliveries[0]?.id ?? ''
    expect(plannedId).not.toBe('')

    const lines = [
      { id: uuidv7(), invoiceLineId: stranded.lineId, deliveredQtyPcs: 8, returnedQtyPcs: 4 },
    ]
    const body = {
      idempotencyKey: `dos148-deliver-${run}`,
      id: plannedId,
      tripId: trip,
      stopId,
      invoiceId: stranded.invoiceId,
      receiverName: 'Owner A',
      lines,
      pod: [],
    }

    // BEFORE THE PHOTO. Van Shop A pays after delivery, so `credit_only` would otherwise refuse this
    // body 400 pod_required and send the driver to the camera for a bill he can never record.
    const refused = await call<{ message: string; data?: { code?: string; orderState?: string } }>(
      app,
      otherDriver,
      'POST',
      '/delivery/deliveries',
      body,
    )
    expect(refused.status, JSON.stringify(refused.body)).toBe(409)
    expect(refused.body.message).toContain('was not loaded on this van')
    expect(refused.body.message).toContain('the office')
    expect(refused.body.data?.code).toBe('order_not_dispatched')
    expect(refused.body.data?.orderState).toBe('packed')
    // Never the order machine's own words at a shop door.
    expect(refused.body.message).not.toContain('deliver_partial')
    expect(refused.body.message).not.toContain('cannot apply')

    // The same call with the photograph the crew took anyway reads the same sentence, not pod_required.
    const withPhoto = await call<{ message: string }>(
      app,
      otherDriver,
      'POST',
      '/delivery/deliveries',
      {
        ...body,
        idempotencyKey: `dos148-deliver-photo-${run}`,
        pod: [
          {
            id: uuidv7(),
            kind: 'photo',
            inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
          },
        ],
      },
    )
    expect(withPhoto.status).toBe(409)
    expect(withPhoto.body.message).toContain('was not loaded on this van')

    // Nothing of either attempt is left behind: the planned row, the order, the proof and the books.
    expect(await orderState(stranded.orderId)).toBe('packed')
    const [row] = (
      await db.execute(sql`select outcome::text as outcome from deliveries where id = ${plannedId}`)
    ).rows as { outcome: string | null }[]
    expect(row?.outcome).toBeNull()
    const [proof] = (
      await db.execute(
        sql`select count(*)::int as n from pod_evidence where delivery_id = ${plannedId}`,
      )
    ).rows as { n: number }[]
    expect(proof?.n).toBe(0)
    const [notes] = (
      await db.execute(
        sql`select count(*)::int as n from credit_notes where tenant_id = ${tenantId} and invoice_id = ${stranded.invoiceId}`,
      )
    ).rows as { n: number }[]
    expect(notes?.n).toBe(0)
    expect(await outboxTypes(plannedId)).toEqual([])

    // And the bill the godown DID load is delivered at the same stop, so the gate refuses only the
    // bill that is not on the van.
    const loaded = await billedOrder(retailerA, variantA, 'dos148-ok')
    await loadOut(
      app,
      { godown: packer, approver: manager },
      { tripId: trip, orderIds: [loaded.orderId], tag: `dos148-ok-${run}` },
    )
    expect(await orderState(loaded.orderId)).toBe('dispatched')
    const okStop = uuidv7()
    expect(
      (
        await call(app, manager, 'POST', `/delivery/trips/${trip}/stops`, {
          idempotencyKey: `dos148-ok-stop-${run}`,
          id: trip,
          stop: { id: okStop, retailerId: retailerA, invoiceIds: [loaded.invoiceId] },
        })
      ).status,
    ).toBe(200)
    const okTrip = await call<{ item: TripBody }>(app, manager, 'GET', `/delivery/trips/${trip}`)
    const okDelivery = okTrip.body.item.stops.find((s) => s.id === okStop)?.deliveries[0]?.id ?? ''
    const done = await call<{ item: DeliveryDetailBody }>(
      app,
      otherDriver,
      'POST',
      '/delivery/deliveries',
      {
        idempotencyKey: `dos148-ok-deliver-${run}`,
        id: okDelivery,
        tripId: trip,
        stopId: okStop,
        invoiceId: loaded.invoiceId,
        lines: [
          { id: uuidv7(), invoiceLineId: loaded.lineId, deliveredQtyPcs: 12, returnedQtyPcs: 0 },
        ],
        pod: [
          {
            id: uuidv7(),
            kind: 'photo',
            inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
          },
        ],
      },
    )
    expect(done.status, JSON.stringify(done.body)).toBe(200)
    expect(done.body.item.outcome).toBe('delivered')
  })

  /**
   * DOS-148 (merge review minor 3) — "NOTHING DELIVERED" ON A BILL THAT NEVER LEFT THE GODOWN IS
   * TAKEN, NOT REFUSED.
   *
   * The gate above lets exactly one case through on purpose. `return_undelivered` takes a DISPATCHED
   * order back to `packed` (`orderMachine.transitions.dispatched`), so an order that is still `packed`
   * is already where that move would put it, and `applyFulfilmentEvent` has always answered such a
   * retry with the order untouched (`FULFILMENT_TARGET`, orders.service.ts). That is deliberate: a crew
   * that cannot record "Nothing delivered" cannot clear the stop, and a stop that will not clear holds
   * up the whole van — a worse day than the one DOS-148 was filed about. The crew hands nothing over
   * and the office gets its bill back.
   *
   * Until now it was pinned only by the app-side test (`dos-148-not-on-the-van.test.ts`), so a later
   * tightening of `assertOnTheVan` could take it away with every backend spec still green. This is
   * that case: accepted, the stop cleared, and nothing moved — no transition, no credit note, no stock.
   */
  it('DOS-148 “Nothing delivered” on a bill still in the godown is accepted, clears the stop and moves nothing', async () => {
    const stranded = await billedOrder(retailerA, variantA, 'dos148b')
    expect(await orderState(stranded.orderId)).toBe('packed')

    const vehicle = uuidv7()
    expect(
      (
        await call(app, owner, 'POST', '/delivery/vehicles', {
          idempotencyKey: `dos148b-vehicle-${run}`,
          id: vehicle,
          regNo: `MH-05-NE-${run.slice(-4)}`,
          name: 'Tempo NE',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call(app, otherDriver, 'POST', '/delivery/consents', {
          idempotencyKey: `dos148b-consent-${run}`,
          id: uuidv7(),
          granted: true,
          noticeVersion: 'gps-2026-09',
        })
      ).status,
    ).toBe(200)
    const trip = uuidv7()
    const created = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `dos148b-trip-${run}`,
      id: trip,
      tripDate: new Date(Date.parse(today) + 56 * 86_400_000).toISOString().slice(0, 10),
      vehicleId: vehicle,
      driverId: otherDriverId,
      vanSalesEnabled: true,
      openingCashPaise: 0,
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    for (const step of ['start-loading', 'depart']) {
      const moved = await call(app, otherDriver, 'POST', `/delivery/trips/${trip}/${step}`, {
        idempotencyKey: `dos148b-${step}-${run}`,
      })
      expect(moved.status, `${step} → ${JSON.stringify(moved.body)}`).toBe(200)
    }

    // The same late bill as above: added to a trip already on the road, so the load-out gate never saw it.
    const stopId = uuidv7()
    const added = await call(app, manager, 'POST', `/delivery/trips/${trip}/stops`, {
      idempotencyKey: `dos148b-stop-${run}`,
      id: trip,
      stop: { id: stopId, retailerId: retailerA, invoiceIds: [stranded.invoiceId] },
    })
    expect(added.status, JSON.stringify(added.body)).toBe(200)
    const onTheRoad = await call<{ item: TripBody }>(app, manager, 'GET', `/delivery/trips/${trip}`)
    const plannedId =
      onTheRoad.body.item.stops.find((s) => s.id === stopId)?.deliveries[0]?.id ?? ''
    expect(plannedId).not.toBe('')

    // Every piece comes back and none goes in: `outcomeOf` reads that as `failed`, the event as
    // `return_undelivered`, and the gate as "the order is already where that would leave it".
    const recorded = await call<{
      item: DeliveryDetailBody
      stop: { state: string }
      creditNoteId: string | null
    }>(app, otherDriver, 'POST', '/delivery/deliveries', {
      idempotencyKey: `dos148b-deliver-${run}`,
      id: plannedId,
      tripId: trip,
      stopId,
      invoiceId: stranded.invoiceId,
      lines: [
        { id: uuidv7(), invoiceLineId: stranded.lineId, deliveredQtyPcs: 0, returnedQtyPcs: 12 },
      ],
      pod: [],
    })
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200)
    expect(recorded.body.item.outcome).toBe('failed')
    expect(recorded.body.creditNoteId).toBeNull()
    // The stop is cleared, so the van moves on.
    expect(recorded.body.stop.state).toBe('failed')

    // And nothing moved. The order stands exactly where the godown left it, with no transition row…
    expect(await orderState(stranded.orderId)).toBe('packed')
    expect(await outboxTypes(stranded.orderId)).not.toContain('OrderReturnedUndelivered')
    const [moves] = (
      await db.execute(
        sql`select count(*)::int as n from order_state_transitions
             where tenant_id = ${tenantId} and order_id = ${stranded.orderId} and event = 'return_undelivered'`,
      )
    ).rows as { n: number }[]
    expect(moves?.n).toBe(0)
    // …nothing is credited for goods that were never handed over…
    const [notes] = (
      await db.execute(
        sql`select count(*)::int as n from credit_notes where tenant_id = ${tenantId} and invoice_id = ${stranded.invoiceId}`,
      )
    ).rows as { n: number }[]
    expect(notes?.n).toBe(0)
    // …and no stock was restocked from a van it was never on.
    expect(await ledgerFor(plannedId)).toEqual([])
    // QA DOS-197: and the shop is not billed for goods that never left the godown — the bill is flagged
    // undelivered and one message goes out naming it.
    expect(await outboxTypes(plannedId)).toEqual(['DeliveryFailed', 'DeliveryRecorded'])
  })

  /*
   * QA DOS-203 — A REFUSAL AT THE DOOR LEAVES THE STOP WITH A CAUSE.
   *
   * Two stops failed through the fail sheet carried `shop_closed` and `other`; a shop that refused the
   * whole bill on the deliver screen — "Nothing from this bill" — left `trip_stops.failure_reason` and
   * `failure_note` NULL, so the word "refused" existed only on the delivery line and every desk register
   * over the stop showed a failure with no cause. The words are read off the lines the crew tapped.
   */
  it('DOS-203: "Nothing from this bill" writes the stop\u2019s reason and the crew\u2019s note, the same as the fail sheet', async () => {
    const refusedBill = await billedOrder(retailerA, variantA, 'dos203')
    const trip = uuidv7()
    const created = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `dos203-trip-${run}`,
      id: trip,
      tripDate: new Date(Date.parse(today) + 59 * 86_400_000).toISOString().slice(0, 10),
      vehicleId,
      driverId,
      vanSalesEnabled: true,
      openingCashPaise: 0,
      stops: [],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    for (const step of ['start-loading', 'depart']) {
      const moved = await call(app, driver, 'POST', `/delivery/trips/${trip}/${step}`, {
        idempotencyKey: `dos203-${step}-${run}`,
      })
      expect(moved.status, `${step} \u2192 ${JSON.stringify(moved.body)}`).toBe(200)
    }
    const stopId = uuidv7()
    expect(
      (
        await call(app, manager, 'POST', `/delivery/trips/${trip}/stops`, {
          idempotencyKey: `dos203-stop-${run}`,
          id: trip,
          stop: { id: stopId, retailerId: retailerA, invoiceIds: [refusedBill.invoiceId] },
        })
      ).status,
    ).toBe(200)
    const onTheRoad = await call<{ item: TripBody }>(app, manager, 'GET', `/delivery/trips/${trip}`)
    const plannedId =
      onTheRoad.body.item.stops.find((s) => s.id === stopId)?.deliveries[0]?.id ?? ''
    expect(plannedId).not.toBe('')

    const note =
      'Owner says he never ordered soft drink this week; refused the whole bill at the door.'
    const recorded = await call<{ item: DeliveryDetailBody; stop: StopBody }>(
      app,
      driver,
      'POST',
      '/delivery/deliveries',
      {
        idempotencyKey: `dos203-record-${run}`,
        id: plannedId,
        tripId: trip,
        stopId,
        invoiceId: refusedBill.invoiceId,
        receiverName: 'Laxmi Narayan',
        note,
        lines: [
          {
            id: uuidv7(),
            invoiceLineId: refusedBill.lineId,
            deliveredQtyPcs: 0,
            returnedQtyPcs: 12,
            returnedSaleable: true,
            reason: 'refused',
          },
        ],
        pod: [],
      },
    )
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200)
    expect(recorded.body.item.outcome).toBe('failed')
    // the stop the desk reads says WHY, in the crew's own words, on the reply and in the row
    expect(recorded.body.stop.state).toBe('failed')
    expect(recorded.body.stop.failureReason).toBe('refused')
    const [row] = (
      await db.execute(
        sql`select failure_reason::text as reason, failure_note from trip_stops where id = ${stopId}`,
      )
    ).rows as { reason: string | null; failure_note: string | null }[]
    expect(row?.reason).toBe('refused')
    expect(row?.failure_note).toBe(note)
  }, 240_000)

  it('DOS-009: trips.list is newest first by trip_date then id — a trip planned for a later day tops a trip for an earlier day created after it; the cursor walks each once; the crew’s list is still forced to its own trips', async () => {
    interface TripPage {
      items: { id: string; tripDate: string; driverId: string | null; helperId: string | null }[]
      nextCursor: string | null
    }
    // Two days nobody else in this file plans on, and further out than every other trip it plans (56 is
    // the furthest), so the "driver already on a trip" check never fires and these two are the top rows.
    const laterDay = new Date(Date.parse(today) + 70 * 86_400_000).toISOString().slice(0, 10)
    const earlierDay = new Date(Date.parse(today) + 69 * 86_400_000).toISOString().slice(0, 10)

    const plan = async (tag: string, tripDate: string): Promise<string> => {
      const id = uuidv7()
      const res = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
        idempotencyKey: `dos009-${tag}-${run}`,
        id,
        tripDate,
        vehicleId,
        driverId,
        // a trip with no stops is a van-sale round; only the ORDER of the two rows is under test here
        vanSalesEnabled: true,
        openingCashPaise: 0,
        stops: [],
      })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      return id
    }
    // The pre-planned trip is made FIRST, so its id is the LOWER of the two; the nearer trip is minted
    // after it and sorts above it by id alone.
    const later = await plan('later', laterDay)
    const earlier = await plan('earlier', earlierDay)
    expect(earlier > later).toBe(true)

    const page = (actor: Actor, query: Record<string, unknown>) =>
      call<TripPage>(app, actor, 'GET', '/delivery/trips', query)

    // (a) the trip planned for the later day is the top row, even though its id is lower
    const top = await page(manager, { limit: 1 })
    expect(top.status, JSON.stringify(top.body)).toBe(200)
    expect(top.body.items[0]?.id).toBe(later)

    /** Follows `nextCursor` to the end and returns every trip in the order the pages gave them. */
    const walk = async (
      actor: Actor,
      query: Record<string, unknown>,
      limit: number,
    ): Promise<TripPage['items']> => {
      const seen: TripPage['items'] = []
      let cursor: string | undefined
      for (let pages = 0; pages < 2000; pages += 1) {
        const got = await page(actor, { ...query, limit, cursor })
        expect(got.status, JSON.stringify(got.body)).toBe(200)
        seen.push(...got.body.items)
        if (got.body.nextCursor === null) return seen
        cursor = got.body.nextCursor
      }
      throw new Error('trips.list never ended its cursor walk')
    }
    const expectEachOnceNewestFirst = (items: TripPage['items']): void => {
      const ids = items.map((i) => i.id)
      expect(new Set(ids).size, 'no trip comes back twice').toBe(ids.length)
      items.forEach((item, i) => {
        const before = items[i - 1]
        if (before !== undefined)
          expect(
            item.tripDate <= before.tripDate,
            `${item.id} (${item.tripDate}) after ${before.id} (${before.tripDate})`,
          ).toBe(true)
      })
    }
    const countOf = async (): Promise<number> =>
      (
        (await db.execute(sql`select count(*)::int as n from trips where tenant_id = ${tenantId}`))
          .rows as { n: number }[]
      )[0]?.n ?? 0

    const all = await walk(manager, {}, 1)
    expectEachOnceNewestFirst(all)
    expect(all).toHaveLength(await countOf())
    const at = (id: string) => all.findIndex((i) => i.id === id)
    expect(at(later)).toBeLessThan(at(earlier))

    // (b) the crew's list is still its own, in the same order
    const crewSees = await walk(driver, {}, 2)
    expectEachOnceNewestFirst(crewSees)
    expect(crewSees.length).toBeGreaterThan(0)
    expect(crewSees.every((t) => t.driverId === driverId || t.helperId === driverId)).toBe(true)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-197 — a bill that came back undelivered is not the shop's money yet

  const undeliveredTrip = uuidv7()
  const undeliveredStop = uuidv7()
  const redeliveryTrip = uuidv7()
  const redeliveryStop = uuidv7()
  /**
   * Two days nobody else in this file plans on, so the "driver already on a trip" check never fires,
   * and INSIDE the 69/70 the DOS-009 ordering test reserves as the furthest out of every trip here.
   */
  const failDay = new Date(Date.parse(today) + 57 * 86_400_000).toISOString().slice(0, 10)
  const againDay = new Date(Date.parse(today) + 58 * 86_400_000).toISOString().slice(0, 10)

  interface DuesBody {
    outstandingPaise: number
    overduePaise: number
    undeliveredPaise: number
    openBills: number
    unallocatedCreditPaise: number
    buckets: Record<string, number>
    bills: { id: string; invoiceNo: string | null }[]
  }
  const duesOf = async (retailerId: string): Promise<DuesBody> => {
    const res = await call<DuesBody>(
      app,
      manager,
      'GET',
      `/receivables/outstanding/${retailerId}`,
      { includeBills: true },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body
  }
  /** The debtor balance the books hold for one shop: the number the rollup must still account for. */
  const arOf = async (retailerId: string): Promise<number> =>
    Number(
      (
        (
          await db.execute(sql`
        select coalesce(sum(jl.amount_paise), 0) as ar
          from journal_lines jl join accounts a on a.id = jl.account_id
         where jl.tenant_id = ${tenantId} and a.code = 'AR'
           and jl.party_type = 'retailer' and jl.party_id = ${retailerId}`)
        ).rows[0] as { ar: string }
      ).ar,
    )
  const undeliveredAtOf = async (invoiceId: string): Promise<string | null> =>
    (
      (
        await db.execute(
          sql`select undelivered_at from invoices where tenant_id = ${tenantId} and id = ${invoiceId}`,
        )
      ).rows[0] as { undelivered_at: string | null } | undefined
    )?.undelivered_at ?? null

  let billU: Awaited<ReturnType<typeof billedOrder>>
  let duesBefore: DuesBody

  it('DOS-197: a stop that fails takes its bill out of the shop’s dues and out of the ageing, and says so by bill number', async () => {
    billU = await billedOrder(retailerA, variantA, 'u197')
    duesBefore = await duesOf(retailerA)
    expect(duesBefore.bills.some((b) => b.id === billU.invoiceId)).toBe(true)
    const arBefore = await arOf(retailerA)

    const planned = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `u197-trip-${run}`,
      id: undeliveredTrip,
      tripDate: failDay,
      vehicleId,
      driverId,
      openingCashPaise: 0,
      stops: [
        {
          id: undeliveredStop,
          sequence: 1,
          retailerId: retailerA,
          invoiceIds: [billU.invoiceId],
        },
      ],
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    expect(
      (
        await call(app, manager, 'POST', `/delivery/trips/${undeliveredTrip}/start-loading`, {
          idempotencyKey: `u197-loading-${run}`,
        })
      ).status,
    ).toBe(200)
    await loadOut(
      app,
      { godown: packer, approver: manager },
      { tripId: undeliveredTrip, orderIds: [billU.orderId], tag: `u197-${run}` },
    )
    expect(
      (
        await call(app, driver, 'POST', `/delivery/trips/${undeliveredTrip}/depart`, {
          idempotencyKey: `u197-depart-${run}`,
        })
      ).status,
    ).toBe(200)

    const failed = await call<{ item: StopBody; deliveries: DeliveryBody[] }>(
      app,
      driver,
      'POST',
      `/delivery/stops/${undeliveredStop}/fail`,
      {
        idempotencyKey: `u197-fail-${run}`,
        failureReason: 'shop_closed',
        failureNote: 'Shutter down at 11, neighbour says back after 4.',
      },
    )
    expect(failed.status, JSON.stringify(failed.body)).toBe(200)
    expect(failed.body.item.state).toBe('failed')

    // the bill is issued and will be re-attempted: it is NOT cancelled, it is flagged undelivered
    const state = (
      (
        await db.execute(
          sql`select state::text as state from invoices where id = ${billU.invoiceId}`,
        )
      ).rows[0] as { state: string }
    ).state
    expect(state).toBe('issued')
    expect(await undeliveredAtOf(billU.invoiceId)).not.toBeNull()

    // the shop's dues and its ageing leave it out, and its own bill list no longer carries it
    const after = await duesOf(retailerA)
    expect(after.outstandingPaise).toBe(duesBefore.outstandingPaise - billU.totalPaise)
    expect(after.openBills).toBe(duesBefore.openBills - 1)
    expect(after.undeliveredPaise).toBe(duesBefore.undeliveredPaise + billU.totalPaise)
    expect(after.bills.some((b) => b.id === billU.invoiceId)).toBe(false)
    const bucketTotal = (d: DuesBody): number => Object.values(d.buckets).reduce((s, n) => s + n, 0)
    expect(bucketTotal(after)).toBe(bucketTotal(duesBefore) - billU.totalPaise)

    // and the books are still provable: the debtor stands, and the rollup names where it went
    expect(await arOf(retailerA)).toBe(arBefore)
    expect(after.outstandingPaise + after.undeliveredPaise - after.unallocatedCreditPaise).toBe(
      await arOf(retailerA),
    )

    // ONE event for the shop's message, carrying the bill NUMBER and never an id fragment
    const events = (
      await db.execute(sql`
        select payload from outbox_events
         where tenant_id = ${tenantId} and event_type = 'DeliveryFailed'
           and payload->>'invoiceId' = ${billU.invoiceId}`)
    ).rows as { payload: Record<string, unknown> }[]
    expect(events).toHaveLength(1)
    expect(events[0]?.payload.invoiceNo).toBe(
      (
        (await db.execute(sql`select invoice_no from invoices where id = ${billU.invoiceId}`))
          .rows[0] as { invoice_no: string }
      ).invoice_no,
    )
    expect(events[0]?.payload.retailerId).toBe(retailerA)
  }, 240_000)

  it('DOS-196: the desk reads one Undelivered register — the bill, the shop, the reason, the note and the trip it is still riding', async () => {
    interface UndeliveredRow {
      invoiceId: string
      invoiceNo: string | null
      invoiceTotalPaise: number
      retailerId: string
      retailerName: string
      outcome: string | null
      tripId: string
      tripNo: string | null
      tripState: string
      stopFailureReason: string | null
      stopFailureNote: string | null
    }
    const res = await call<{ items: UndeliveredRow[]; nextCursor: string | null }>(
      app,
      manager,
      'GET',
      '/delivery/deliveries',
      { undeliveredOnly: true, limit: 50 },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const row = res.body.items.find((r) => r.invoiceId === billU.invoiceId)
    expect(row, 'the bill that came back is not on the desk register').toBeDefined()
    expect(row?.invoiceNo).not.toBeNull()
    expect(row?.invoiceTotalPaise).toBe(billU.totalPaise)
    expect(row?.retailerName).toContain('Van Shop A')
    expect(row?.outcome).toBe('failed')
    // the reason and the note the crew gave, and the trip the bill is still riding
    expect(row?.stopFailureReason).toBe('shop_closed')
    expect(row?.stopFailureNote).toBe('Shutter down at 11, neighbour says back after 4.')
    expect(row?.tripId).toBe(undeliveredTrip)
    expect(row?.tripNo).not.toBeNull()
    expect(row?.tripState).toBe('active')
    // a bill that was handed over is not on this register
    expect(res.body.items.some((r) => r.invoiceId === billA1.invoiceId)).toBe(false)
    // and every row on it is a failed attempt
    expect(res.body.items.every((r) => r.outcome === 'failed')).toBe(true)
  })

  it('DOS-197: delivering it on the next trip puts the bill back into the shop’s dues', async () => {
    expect(
      (
        await call(app, driver, 'POST', `/delivery/trips/${undeliveredTrip}/return`, {
          idempotencyKey: `u197-return-${run}`,
        })
      ).status,
    ).toBe(200)
    const planned = await call<{ item: TripBody }>(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `u197-trip2-${run}`,
      id: redeliveryTrip,
      tripDate: againDay,
      vehicleId,
      driverId,
      openingCashPaise: 0,
      stops: [
        { id: redeliveryStop, sequence: 1, retailerId: retailerA, invoiceIds: [billU.invoiceId] },
      ],
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    expect(
      (
        await call(app, manager, 'POST', `/delivery/trips/${redeliveryTrip}/start-loading`, {
          idempotencyKey: `u197-loading2-${run}`,
        })
      ).status,
    ).toBe(200)
    await loadOut(
      app,
      { godown: packer, approver: manager },
      { tripId: redeliveryTrip, orderIds: [billU.orderId], tag: `u197b-${run}` },
    )
    expect(
      (
        await call(app, driver, 'POST', `/delivery/trips/${redeliveryTrip}/depart`, {
          idempotencyKey: `u197-depart2-${run}`,
        })
      ).status,
    ).toBe(200)
    const delivered = await call<{ item: DeliveryDetailBody; stop: StopBody }>(
      app,
      driver,
      'POST',
      '/delivery/deliveries',
      {
        idempotencyKey: `u197-deliver-${run}`,
        id: uuidv7(),
        tripId: redeliveryTrip,
        stopId: redeliveryStop,
        invoiceId: billU.invoiceId,
        receiverName: 'Owner A',
        lines: [
          { id: uuidv7(), invoiceLineId: billU.lineId, deliveredQtyPcs: 12, returnedQtyPcs: 0 },
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
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200)
    expect(delivered.body.item.outcome).toBe('delivered')
    expect(await undeliveredAtOf(billU.invoiceId)).toBeNull()
    const after = await duesOf(retailerA)
    expect(after.undeliveredPaise).toBe(duesBefore.undeliveredPaise)
    expect(after.outstandingPaise).toBe(duesBefore.outstandingPaise)
    expect(after.bills.some((b) => b.id === billU.invoiceId)).toBe(true)
    // DOS-196: and it leaves the desk's Undelivered register the moment it is handed over
    const register = await call<{ items: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/deliveries',
      { undeliveredOnly: true, limit: 50 },
    )
    expect(register.status).toBe(200)
    expect(register.body.items.some((r) => r.invoiceId === billU.invoiceId)).toBe(false)
  }, 240_000)
})
