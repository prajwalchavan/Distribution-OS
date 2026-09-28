import { eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { businessDate, uuidv7 } from '@dos/domain'
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
import { LoadSheetsService, WarehouseModule } from '../warehouse/index.js'
import { DeliveryModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

interface Refusal {
  message: string
  data?: { code?: string }
}
interface TripBody {
  id: string
  tripNo: string | null
  state: string
  vehicleLocationId: string
}

/** IST calendar day `offset` days from today, as the tables store one. */
const istDay = (offset: number): string => {
  const today = businessDate()
  return new Date(Date.UTC(today.year, today.month - 1, today.day + offset))
    .toISOString()
    .slice(0, 10)
}

/**
 * VANS AND TRIPS (architect rulings of 2026-09-28, found by the second blind check of the stock-states lane):
 *
 *   (1) a van carries ONE trip at a time — nothing is loaded onto a van another trip holds (on the road, checked in
 *       and not settled, or already loaded), at the approval and at the gate; a van-stock sheet takes nothing FROM
 *       such a van; the trip does not leave with it; nothing is put on it by hand (B1, B2)
 *   (2) a settlement takes off the van only its own trip's pieces (B1, for a van loaded before the rule)
 *   (3) a trip takes only bills that can still go out, and one that already holds a delivered bill is checked in and
 *       settled, the bill skipped with a line in the settlement (M2)
 *   (4) a pack without a bill is undone by the desk — unpack or cancel — its pieces back from the dock, expired ones
 *       into the expiry bin, nothing held (M1)
 *   (6) a wave is not placed at the bin, and a load sheet drawn from the bin is refused when it is made
 *   (7) cancelling a wave never touches the dock hold of an order that is already packed
 *
 * Every case replays the verifier's own road (V-H3, V-G2, V-G3, V-S3h, V-I1, V-F1, V-G1, V-H2) through the same
 * endpoints and roles, in its own tenant, one van per scenario.
 */
describeDb(
  'vans and trips: one trip per van, its own settlement, bills that can go out (DATABASE_URL)',
  () => {
    const pool = createPool(url ?? '')
    const db = createDb(pool)
    const run = String(Date.now()).slice(-8)
    const hsn = `5${run}`

    const tenantId = uuidv7()
    const ownerId = uuidv7()
    const managerId = uuidv7()
    const packerId = uuidv7()
    const repId = uuidv7()
    const driverIds = Array.from({ length: 7 }, () => uuidv7())

    const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
    const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
    const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
    const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
    const drivers: Actor[] = driverIds.map((actorId) => ({ tenantId, actorId, role: 'delivery' }))
    const crew = { godown: packer, approver: manager }
    const driver = (i: number): Actor => drivers[i] as Actor

    const asOwner = <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
      const ctx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
      return tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
    }

    const retailerA = uuidv7()
    const retailerB = uuidv7()
    const shopA = `Van Shop A ${run}`
    const shopB = `Van Shop B ${run}`
    /** Tooth brush (the bills on the vans), garam masala (the parked pack), whitener (the wave). */
    const vG = uuidv7()
    const vU = uuidv7()
    const vW = uuidv7()
    const vehicleIds = Array.from({ length: 7 }, () => uuidv7())
    const vehicleLocs: string[] = []
    const plates: string[] = []
    const lots: Record<string, string> = {}
    let godownId = ''
    let dockId = ''
    let binId = ''
    let binName = ''
    let app: NestFastifyApplication

    const post = <T>(actor: Actor, path: string, body: Record<string, unknown>) =>
      call<T>(app, actor, 'POST', path, body)
    const one = async <T>(query: ReturnType<typeof sql>): Promise<T> =>
      (await db.execute(query)).rows[0] as T
    const balance = async (lotId: string, locationId: string) => {
      const row = await one<{ on_hand: number; reserved: number } | undefined>(
        sql`select on_hand, reserved from stock_balances
           where tenant_id = ${tenantId} and lot_id = ${lotId} and location_id = ${locationId}`,
      )
      return { on_hand: Number(row?.on_hand ?? 0), reserved: Number(row?.reserved ?? 0) }
    }
    const orderState = async (orderId: string): Promise<string> =>
      (
        await one<{ state: string }>(
          sql`select state::text as state from sales_orders where id = ${orderId}`,
        )
      ).state
    const tripNo = async (tripId: string): Promise<string> =>
      (await one<{ trip_no: string }>(sql`select trip_no from trips where id = ${tripId}`)).trip_no

    /** Rep places and submits; with no gate the order confirms and holds FEFO at the godown. */
    async function order(
      retailerId: string,
      variantId: string,
      pcs: number,
      tag: string,
    ): Promise<{ orderId: string; lineId: string; orderNo: string }> {
      const orderId = uuidv7()
      const lineId = uuidv7()
      const created = await post(rep, '/orders', {
        idempotencyKey: `order-${tag}-${run}`,
        id: orderId,
        retailerId,
        source: 'salesperson',
        lines: [{ id: lineId, variantId, enteredQty: pcs, enteredUnit: 'piece' }],
      })
      expect(created.status, JSON.stringify(created.body)).toBe(200)
      const submitted = await post<{ item: { state: string; orderNo: string } }>(
        rep,
        `/orders/${orderId}/submit`,
        { idempotencyKey: `submit-${tag}-${run}` },
      )
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
      expect(submitted.body.item.state).toBe('confirmed')
      return { orderId, lineId, orderNo: submitted.body.item.orderNo }
    }

    const pack = (orderId: string, tag: string, issueInvoice = true) =>
      post<Refusal & { item: { id: string }; invoice: { id: string; invoiceNo: string } | null }>(
        packer,
        `/warehouse/orders/${orderId}/pack`,
        { idempotencyKey: `pack-${tag}-${run}`, id: uuidv7(), packages: 1, issueInvoice },
      )

    /** An order packed off its holds with its bill: what a trip carries. */
    async function billed(
      retailerId: string,
      variantId: string,
      pcs: number,
      tag: string,
    ): Promise<{
      orderId: string
      orderNo: string
      invoiceId: string
      invoiceNo: string
      invoiceLineId: string
    }> {
      const o = await order(retailerId, variantId, pcs, tag)
      const packed = await pack(o.orderId, tag)
      expect(packed.status, JSON.stringify(packed.body)).toBe(200)
      const invoiceId = packed.body.invoice?.id ?? ''
      const line = await one<{ id: string }>(
        sql`select id from invoice_lines where invoice_id = ${invoiceId} order by line_no limit 1`,
      )
      return {
        orderId: o.orderId,
        orderNo: o.orderNo,
        invoiceId,
        invoiceNo: packed.body.invoice?.invoiceNo ?? '',
        invoiceLineId: line.id,
      }
    }

    /** A trip planned by the desk (stop per shop) and put on the dock by the godown. */
    async function trip(
      tag: string,
      day: string,
      driverAt: number,
      vehicleAt: number,
      stops: { retailerId: string; invoiceIds: string[] }[],
    ): Promise<{ id: string; stopIds: string[]; tripNo: string }> {
      const id = uuidv7()
      const stopIds = stops.map(() => uuidv7())
      const planned = await post(manager, '/delivery/trips', {
        idempotencyKey: `trip-${tag}-${run}`,
        id,
        tripDate: day,
        vehicleId: vehicleIds[vehicleAt],
        driverId: driverIds[driverAt],
        openingCashPaise: 0,
        stops: stops.map((s, i) => ({
          id: stopIds[i],
          sequence: i + 1,
          retailerId: s.retailerId,
          invoiceIds: s.invoiceIds,
        })),
      })
      expect(planned.status, JSON.stringify(planned.body)).toBe(200)
      const loading = await post(packer, `/delivery/trips/${id}/start-loading`, {
        idempotencyKey: `loading-${tag}-${run}`,
      })
      expect(loading.status, JSON.stringify(loading.body)).toBe(200)
      return { id, stopIds, tripNo: await tripNo(id) }
    }

    const depart = (tripId: string, driverAt: number, tag: string) =>
      post<Refusal & { item: TripBody }>(driver(driverAt), `/delivery/trips/${tripId}/depart`, {
        idempotencyKey: `depart-${tag}-${run}`,
      })

    const checkIn = (tripId: string, driverAt: number, tag: string) =>
      post<Refusal & { item: TripBody }>(driver(driverAt), `/delivery/trips/${tripId}/return`, {
        idempotencyKey: `return-${tag}-${run}`,
      })

    const settle = (
      tripId: string,
      counted: { lotId: string; countedPcs: number }[],
      tag: string,
    ) =>
      post<Refusal & { tripState: string }>(manager, `/delivery/trips/${tripId}/settle`, {
        idempotencyKey: `settle-${tag}-${run}`,
        id: uuidv7(),
        handedOverCashPaise: 0,
        counted,
      })

    const deliverAll = (
      driverAt: number,
      tripId: string,
      stopId: string,
      bill: { invoiceId: string; invoiceLineId: string },
      pcs: number,
      tag: string,
    ) =>
      post<Refusal & { item: { outcome: string } }>(driver(driverAt), '/delivery/deliveries', {
        idempotencyKey: `deliver-${tag}-${run}`,
        id: uuidv7(),
        tripId,
        stopId,
        invoiceId: bill.invoiceId,
        lines: [
          {
            id: uuidv7(),
            invoiceLineId: bill.invoiceLineId,
            deliveredQtyPcs: pcs,
            returnedQtyPcs: 0,
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

    /** The sheet the godown drafts for a trip (W7), not yet approved or counted out. */
    const draftSheet = (
      tag: string,
      body: {
        toLocationId: string
        fromLocationId?: string
        tripId?: string
        orderIds?: string[]
        vanStock?: { lotId: string; qtyPcs: number }[]
      },
    ) =>
      post<Refusal & { item: { id: string; expectedPackages: number } }>(
        packer,
        '/warehouse/load-sheets',
        {
          idempotencyKey: `sheet-${tag}-${run}`,
          id: uuidv7(),
          orderIds: [],
          vanStock: [],
          ...body,
        },
      )

    /**
     * Pretend the load-out ran before ruling 1 existed: the van check the delivery module registered lets anything
     * through while `fn` runs, and the registered carriage is put back afterwards.
     */
    async function beforeTheRule<T>(fn: () => Promise<T>): Promise<T> {
      type Carriage = Parameters<LoadSheetsService['registerTripCarriage']>[0]
      const sheets = app.get(LoadSheetsService)
      const registered = (sheets as unknown as { carriage: Carriage | null }).carriage
      if (registered === null) throw new Error('the delivery module registered no trip carriage')
      sheets.registerTripCarriage({ ...registered, vanHolder: () => Promise.resolve(null) })
      try {
        return await fn()
      } finally {
        sheets.registerTripCarriage(registered)
      }
    }

    beforeAll(async () => {
      await db.insert(tenants).values({
        id: tenantId,
        slug: `vans-${run}`,
        legalName: 'Vans and Trips Traders',
        stateCode: '27',
      })
      const staff: [string, string, Actor['role']][] = [
        [ownerId, 'Owner', 'owner'],
        [managerId, 'Manager', 'manager'],
        [packerId, 'Packer', 'warehouse'],
        [repId, 'Rep', 'salesperson'],
        ...driverIds.map((id, i): [string, string, Actor['role']] => [
          id,
          `Driver ${String(i)}`,
          'delivery',
        ]),
      ]
      await db
        .insert(users)
        .values(staff.map(([id, name], i) => ({ id, phone: `+91976${run}${String(i)}`, name })))
      await db
        .insert(memberships)
        .values(staff.map(([userId, , role]) => ({ id: uuidv7(), tenantId, userId, role })))
      await bootstrapTenant(db, tenantId)
      await db
        .insert(featureFlags)
        .values({ tenantId, flag: 'van_sales', enabled: true })
        .onConflictDoUpdate({
          target: [featureFlags.tenantId, featureFlags.flag],
          set: { enabled: true },
        })

      const manufacturerId = uuidv7()
      const productId = uuidv7()
      await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker vans ${run}` })
      await db
        .insert(products)
        .values({ id: productId, manufacturerId, name: 'Kirana goods', category: 'staples' })
      const variants: [string, string][] = [
        [vG, 'Tooth Brush'],
        [vU, 'Garam Masala 50 g'],
        [vW, 'Dairy Whitener 500 g'],
      ]
      await db.insert(productVariants).values(
        variants.map(([id, name]) => ({
          id,
          productId,
          name,
          netQty: 100,
          netUnit: 'g' as const,
          defaultCaseSize: 12,
          hsnCode: hsn,
          mrpPaise: 1000,
        })),
      )
      await db
        .insert(tenantProducts)
        .values(variants.map(([variantId]) => ({ id: uuidv7(), tenantId, variantId })))
      await db.insert(hsnRates).values({
        id: uuidv7(),
        hsnCode: hsn,
        gstBps: 1200,
        cessBps: 0,
        effectiveFrom: '2020-04-01',
      })

      for (const [retailerId, tag, name] of [
        [retailerA, 'A', shopA],
        [retailerB, 'B', shopB],
      ] as const) {
        const shopUser = uuidv7()
        const identityId = uuidv7()
        const phone = `+91977${run}${tag === 'A' ? 1 : 2}`
        await db.insert(users).values({ id: shopUser, phone, name: `Shopkeeper ${tag}` })
        await db
          .insert(memberships)
          .values({ id: uuidv7(), tenantId, userId: shopUser, role: 'retailer' })
        await db
          .insert(retailerIdentities)
          .values({ id: identityId, phone, userId: shopUser, shopName: name })
        await db.insert(retailers).values({
          id: retailerId,
          tenantId,
          identityId,
          code: `VT-${tag}-${run}`,
          name,
          ownerName: `Owner ${tag}`,
          phone,
          stateCode: '27',
          gstRegType: 'unregistered',
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
      await db.insert(priceLists).values({
        id: priceListId,
        tenantId,
        name: `Default ${run}`,
        isDefault: true,
        active: true,
      })
      await db.insert(priceListItems).values(
        variants.map(([variantId]) => ({
          id: uuidv7(),
          tenantId,
          priceListId,
          variantId,
          ratePaise: 800,
        })),
      )

      const tenantLocations = await db
        .select()
        .from(locations)
        .where(sql`${locations.tenantId} = ${tenantId}`)
      godownId = tenantLocations.find((l) => l.kind === 'warehouse')?.id ?? ''
      dockId = tenantLocations.find((l) => l.kind === 'in_transit')?.id ?? ''
      const bin = tenantLocations.find((l) => l.kind === 'damaged')
      binId = bin?.id ?? ''
      binName = bin?.name ?? ''

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

      // Tooth brush for the vans; masala U1 (the batch that expires while its pack waits — exactly the one order's
      // twelve, so no later order is held on it) and U2 (in date); whitener for the wave.
      const inventory = app.get(InventoryService)
      await asOwner(async (tx) => {
        for (const [key, variantId, expiryDate, pcs] of [
          ['G1', vG, '2028-01-31', 2_000],
          ['U1', vU, '2027-12-31', 12],
          ['U2', vU, '2028-06-30', 100],
          ['W1', vW, '2028-01-31', 200],
        ] as const) {
          const { lot } = await inventory.findOrCreateLot(tx, {
            variantId,
            batchNo: `${key}-${run}`,
            mrpPaise: 1000,
            expiryDate,
          })
          lots[key] = lot.id
          await inventory.post(tx, [
            {
              lotId: lot.id,
              locationId: godownId,
              qtyDelta: pcs,
              reason: 'opening',
              idempotencyKey: `open-vans-${key}-${run}`,
            },
          ])
        }
      })

      for (const [i, vehicleId] of vehicleIds.entries()) {
        const plate = `MH-05-VT-${String(i)}${run.slice(-3)}`
        const vehicle = await post<{ item: { locationId: string } }>(owner, '/delivery/vehicles', {
          idempotencyKey: `vehicle-vans-${String(i)}-${run}`,
          id: vehicleId,
          regNo: plate,
          name: `Tempo ${String(i)}`,
          kind: 'tempo',
          capacityCases: 120,
        })
        expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(200)
        vehicleLocs.push(vehicle.body.item.locationId)
        plates.push(plate)
      }
      for (const [i, d] of drivers.entries()) {
        const consent = await post(d, '/delivery/consents', {
          idempotencyKey: `consent-vans-${String(i)}-${run}`,
          id: uuidv7(),
          granted: true,
          noticeVersion: 'gps-2026-09',
        })
        expect(consent.status, JSON.stringify(consent.body)).toBe(200)
      }
    }, 180_000)

    afterAll(async () => {
      await app?.close()
      await db.delete(hsnRates).where(eq(hsnRates.hsnCode, hsn))
      await pool.end()
    })

    // ---------------------------------------------------------------------------------------------------------------
    // (1) one trip per van — B1's road

    it("vans and trips 1 (B1): tomorrow's trip is not loaded onto a van today's trip holds — refused at the approval, at the gate, at departure and by hand until today's trip is settled; then it loads", async () => {
      const van = vehicleLocs[0] ?? ''
      const x = await billed(retailerA, vG, 12, 'b1-x')
      const today = await trip('b1-today', istDay(0), 0, 0, [
        { retailerId: retailerA, invoiceIds: [x.invoiceId] },
      ])
      await loadOut(app, crew, { tripId: today.id, orderIds: [x.orderId], tag: `b1-today-${run}` })
      expect((await depart(today.id, 0, 'b1-today')).status).toBe(200)

      // Tomorrow's trip on the same van (the demo seed's own pattern): planned and drafted — that much is allowed.
      const z = await billed(retailerB, vG, 12, 'b1-z')
      const tomorrow = await trip('b1-tomorrow', istDay(1), 1, 0, [
        { retailerId: retailerB, invoiceIds: [z.invoiceId] },
      ])
      const sheet = await draftSheet('b1-tomorrow', {
        toLocationId: van,
        tripId: tomorrow.id,
        orderIds: [z.orderId],
      })
      expect(sheet.status, JSON.stringify(sheet.body)).toBe(200)
      const sheetId = sheet.body.item.id

      const approve = (tag: string) =>
        post<Refusal>(manager, `/warehouse/load-sheets/${sheetId}/approve`, {
          idempotencyKey: `approve-${tag}-${run}`,
        })
      const confirm = (actor: Actor, tag: string) =>
        post<Refusal & { dispatched: string[] }>(
          actor,
          `/warehouse/load-sheets/${sheetId}/confirm`,
          {
            idempotencyKey: `confirm-${tag}-${run}`,
            countedPackages: sheet.body.item.expectedPackages,
            countedVanStock: [],
            challanId: uuidv7(),
          },
        )
      const dockBefore = await balance(lots.G1 ?? '', dockId)

      const pin = await approve('b1-out')
      expect(pin.status, JSON.stringify(pin.body)).toBe(409)
      expect(pin.body.data?.code).toBe('vehicle_on_trip')
      expect(pin.body.message).toBe(
        `${plates[0] ?? ''} is out on the road on trip ${today.tripNo}. A van carries one trip at a time, so nothing is loaded onto it for trip ${tomorrow.tripNo} until that trip is settled: check trip ${today.tripNo} in and settle it first, then approve this sheet.`,
      )
      // The desk counting it out directly is its own approval — refused the same way; nothing moves.
      const desk = await confirm(owner, 'b1-desk')
      expect(desk.status, JSON.stringify(desk.body)).toBe(409)
      expect(desk.body.data?.code).toBe('vehicle_on_trip')
      expect(await orderState(z.orderId)).toBe('packed')
      expect(await balance(lots.G1 ?? '', dockId)).toEqual(dockBefore)
      expect((await balance(lots.G1 ?? '', van)).on_hand).toBe(12)

      // Nor does tomorrow's trip leave with the van, nor does anything go onto it by hand.
      const leave = await depart(tomorrow.id, 1, 'b1-tomorrow-early')
      expect(leave.status, JSON.stringify(leave.body)).toBe(409)
      expect(leave.body.data?.code).toBe('vehicle_on_trip')
      expect(leave.body.message).toBe(
        `${plates[0] ?? ''} is out on the road on trip ${today.tripNo}, so trip ${tomorrow.tripNo} does not leave with it: a van carries one trip at a time. Check trip ${today.tripNo} in and settle it first, then send this trip out.`,
      )
      const byHand = await post<Refusal>(packer, '/inventory/transfers', {
        idempotencyKey: `b1-by-hand-${run}`,
        lotId: lots.G1,
        fromLocationId: godownId,
        toLocationId: van,
        qtyPcs: 12,
      })
      expect(byHand.status, JSON.stringify(byHand.body)).toBe(409)
      expect(byHand.body.data?.code).toBe('vehicle_on_trip')

      // Checked in, not settled: still refused, and the sentence says what is left to do.
      expect((await checkIn(today.id, 0, 'b1-today')).status).toBe(200)
      const closing = await approve('b1-closing')
      expect(closing.status, JSON.stringify(closing.body)).toBe(409)
      expect(closing.body.message).toBe(
        `${plates[0] ?? ''} is back from trip ${today.tripNo}, which is checked in but not settled yet. A van carries one trip at a time, so nothing is loaded onto it for trip ${tomorrow.tripNo} until that trip is settled: settle trip ${today.tripNo} first, then approve this sheet.`,
      )

      // Settled: the van is free, tomorrow's sheet is approved and counted out.
      const settled = await settle(today.id, [{ lotId: lots.G1 ?? '', countedPcs: 12 }], 'b1-today')
      expect(settled.status, JSON.stringify(settled.body)).toBe(200)
      expect((await approve('b1-free')).status).toBe(200)
      const loaded = await confirm(packer, 'b1-free')
      expect(loaded.status, JSON.stringify(loaded.body)).toBe(200)
      expect(loaded.body.dispatched).toEqual([z.orderId])
      expect((await balance(lots.G1 ?? '', van)).on_hand).toBe(12)
    }, 180_000)

    // ---------------------------------------------------------------------------------------------------------------
    // (2) a settlement takes off the van only its own trip's pieces — B1 on a van loaded before the rule

    it("vans and trips 2 (B1): today's settlement takes off the van only today's pieces — tomorrow's bill, loaded before the rule, stays on the van and is delivered", async () => {
      const van = vehicleLocs[1] ?? ''
      const g = lots.G1 ?? ''
      const x = await billed(retailerA, vG, 12, 'b2-x')
      const today = await trip('b2-today', istDay(0), 2, 1, [
        { retailerId: retailerA, invoiceIds: [x.invoiceId] },
      ])
      await loadOut(app, crew, {
        tripId: today.id,
        orderIds: [x.orderId],
        vanStock: [{ lotId: g, qtyPcs: 5 }],
        tag: `b2-today-${run}`,
      })
      expect((await depart(today.id, 2, 'b2-today')).status).toBe(200)

      // V-H3: tomorrow's trip loaded onto the van while today's is out — which only a load-out before ruling 1 did.
      const z = await billed(retailerB, vG, 12, 'b2-z')
      const tomorrow = await trip('b2-tomorrow', istDay(1), 3, 1, [
        { retailerId: retailerB, invoiceIds: [z.invoiceId] },
      ])
      await beforeTheRule(() =>
        loadOut(app, crew, {
          tripId: tomorrow.id,
          orderIds: [z.orderId],
          tag: `b2-tomorrow-${run}`,
        }),
      )
      expect((await balance(g, van)).on_hand).toBe(29)

      // Today's check-in: its bill comes back, and the cockpit expects only today's 12 + 5 on the van.
      expect((await checkIn(today.id, 2, 'b2-today')).status).toBe(200)
      const preview = await call<{ expectedVanStock: { lotId: string; expectedPcs: number }[] }>(
        app,
        manager,
        'GET',
        `/delivery/trips/${today.id}/settlement`,
      )
      expect(preview.status, JSON.stringify(preview.body)).toBe(200)
      expect(preview.body.expectedVanStock.map((l) => [l.lotId, l.expectedPcs])).toEqual([[g, 17]])
      const godownBefore = await balance(g, godownId)
      const dockBefore = await balance(g, dockId)
      const settled = await settle(today.id, [{ lotId: g, countedPcs: 17 }], 'b2-today')
      expect(settled.status, JSON.stringify(settled.body)).toBe(200)
      expect(settled.body.tripState).toBe('settled')
      expect((await balance(g, van)).on_hand, "tomorrow's twelve stay on the van").toBe(12)
      expect((await balance(g, godownId)).on_hand).toBe(godownBefore.on_hand + 5)
      expect((await balance(g, dockId)).on_hand).toBe(dockBefore.on_hand + 12)

      // Tomorrow's trip leaves with its bill on board and delivers it: no "Only 0 pc" at the door.
      expect((await depart(tomorrow.id, 3, 'b2-tomorrow')).status).toBe(200)
      const door = await deliverAll(3, tomorrow.id, tomorrow.stopIds[0] ?? '', z, 12, 'b2-z')
      expect(door.status, JSON.stringify(door.body)).toBe(200)
      expect(door.body.item.outcome).toBe('delivered')
      expect((await balance(g, van)).on_hand).toBe(0)
    }, 180_000)

    // ---------------------------------------------------------------------------------------------------------------
    // (1) a van-stock sheet takes nothing FROM a van whose trip holds it — B2's road

    it('vans and trips 1 (B2): a van-stock sheet is not drawn from a van whose trip is out — refused when it is made, and at the approval and the gate for one drafted before', async () => {
      const from = vehicleLocs[2] ?? ''
      const to = vehicleLocs[3] ?? ''
      const g = lots.G1 ?? ''
      const x = await billed(retailerA, vG, 24, 'b3-x')
      const out = await trip('b3-out', istDay(0), 4, 2, [
        { retailerId: retailerA, invoiceIds: [x.invoiceId] },
      ])
      // Drafted while the van was still free: van to van, twenty-four pieces.
      const early = await draftSheet('b3-early', {
        fromLocationId: from,
        toLocationId: to,
        vanStock: [{ lotId: g, qtyPcs: 24 }],
      })
      expect(early.status, JSON.stringify(early.body)).toBe(200)
      await loadOut(app, crew, { tripId: out.id, orderIds: [x.orderId], tag: `b3-out-${run}` })
      expect((await depart(out.id, 4, 'b3-out')).status).toBe(200)

      const made = await draftSheet('b3-late', {
        fromLocationId: from,
        toLocationId: to,
        vanStock: [{ lotId: g, qtyPcs: 24 }],
      })
      expect(made.status, JSON.stringify(made.body)).toBe(409)
      expect(made.body.data?.code).toBe('vehicle_on_trip')
      expect(made.body.message).toBe(
        `${plates[2] ?? ''} is out on the road on trip ${out.tripNo}: its pieces belong to that trip's bills and van sales, so nothing is taken off it on a load sheet until the trip is settled. Check trip ${out.tripNo} in and settle it first; the godown then counts the van off on Van check-in.`,
      )
      const pin = await post<Refusal>(
        manager,
        `/warehouse/load-sheets/${early.body.item.id}/approve`,
        {
          idempotencyKey: `approve-b3-${run}`,
        },
      )
      expect(pin.status, JSON.stringify(pin.body)).toBe(409)
      expect(pin.body.data?.code).toBe('vehicle_on_trip')
      const gate = await post<Refusal>(
        owner,
        `/warehouse/load-sheets/${early.body.item.id}/confirm`,
        {
          idempotencyKey: `confirm-b3-${run}`,
          countedPackages: 0,
          countedVanStock: [{ lotId: g, qtyPcs: 24 }],
          challanId: uuidv7(),
        },
      )
      expect(gate.status, JSON.stringify(gate.body)).toBe(409)
      expect(gate.body.data?.code).toBe('vehicle_on_trip')
      expect((await balance(g, from)).on_hand).toBe(24)
      expect((await balance(g, to)).on_hand).toBe(0)
      // The bill still leaves the van at its own door.
      const door = await deliverAll(4, out.id, out.stopIds[0] ?? '', x, 24, 'b3-x')
      expect(door.status, JSON.stringify(door.body)).toBe(200)
    }, 180_000)

    // ---------------------------------------------------------------------------------------------------------------
    // (6) nothing is drawn from the bin

    it('ruling 6: a wave is not placed at the damaged / expiry bin, and a load sheet drawn from the bin — or the dock — is refused when it is made, and at the gate for one written before', async () => {
      const o = await order(retailerA, vW, 6, 'r6')
      const wave = await post<Refusal>(packer, '/warehouse/picklists', {
        idempotencyKey: `wave-r6-${run}`,
        id: uuidv7(),
        orderIds: [o.orderId],
        locationId: binId,
      })
      expect(wave.status, JSON.stringify(wave.body)).toBe(409)
      expect(wave.body.data?.code).toBe('damaged_not_for_sale')
      expect(wave.body.message).toBe(
        `A wave is never drawn from ${binName}: pieces in the damaged / expiry bin never go back for sale. They leave the bin only by a write-off or a return to the brand. Wave the orders from the godown.`,
      )
      const fromBin = await draftSheet('r6-bin', {
        fromLocationId: binId,
        toLocationId: vehicleLocs[4] ?? '',
        vanStock: [{ lotId: lots.W1 ?? '', qtyPcs: 1 }],
      })
      expect(fromBin.status, JSON.stringify(fromBin.body)).toBe(409)
      expect(fromBin.body.data?.code).toBe('damaged_not_for_sale')
      const fromDock = await draftSheet('r6-dock', {
        fromLocationId: dockId,
        toLocationId: vehicleLocs[4] ?? '',
        vanStock: [{ lotId: lots.W1 ?? '', qtyPcs: 1 }],
      })
      expect(fromDock.status, JSON.stringify(fromDock.body)).toBe(409)
      expect(fromDock.body.data?.code).toBe('source_not_sellable')

      // A draft written before the rule, drawn from the bin: the gate refuses it and nothing moves.
      const legacy = await draftSheet('r6-legacy', {
        toLocationId: vehicleLocs[4] ?? '',
        vanStock: [{ lotId: lots.W1 ?? '', qtyPcs: 1 }],
      })
      expect(legacy.status, JSON.stringify(legacy.body)).toBe(200)
      await db.execute(
        sql`update load_sheets set from_location_id = ${binId} where id = ${legacy.body.item.id}`,
      )
      const gate = await post<Refusal>(
        owner,
        `/warehouse/load-sheets/${legacy.body.item.id}/confirm`,
        {
          idempotencyKey: `confirm-r6-${run}`,
          countedPackages: 0,
          countedVanStock: [{ lotId: lots.W1 ?? '', qtyPcs: 1 }],
          challanId: uuidv7(),
        },
      )
      expect(gate.status, JSON.stringify(gate.body)).toBe(409)
      expect(gate.body.data?.code).toBe('damaged_not_for_sale')
      expect((await balance(lots.W1 ?? '', vehicleLocs[4] ?? '')).on_hand).toBe(0)
    }, 180_000)

    // ---------------------------------------------------------------------------------------------------------------
    // (4) a pack without a bill is undone by the desk — M1's road

    it('vans and trips 4 (M1): a parked pack whose batch expired is unpacked — its pieces into the expiry bin, nothing held, the order confirmed — then picked and packed from an in-date batch; cancelling another does the same and cancels it; a billed pack names its bill', async () => {
      const u1 = lots.U1 ?? ''
      const u2 = lots.U2 ?? ''
      const u = await order(retailerB, vU, 12, 'm1-u')
      const parked = await pack(u.orderId, 'm1-u', false)
      expect(parked.status, JSON.stringify(parked.body)).toBe(200)
      expect(parked.body.invoice).toBeNull()
      expect(await balance(u1, dockId)).toEqual({ on_hand: 12, reserved: 12 })
      // The batch passes its date while the pack waits for its bill (V-S3h).
      await db.execute(sql`update stock_lots set expiry_date = ${istDay(-1)} where id = ${u1}`)

      const bill = await post<Refusal>(manager, `/warehouse/packs/${parked.body.item.id}/invoice`, {
        idempotencyKey: `bill-m1-u-${run}`,
        id: uuidv7(),
        packId: parked.body.item.id,
      })
      expect(bill.status, JSON.stringify(bill.body)).toBe(409)
      expect(bill.body.data?.code).toBe('batch_expired')
      expect(bill.body.message).toContain(
        'on the billing desk (Packed, not billed) press Unpack, and the order goes back to be picked from an in-date batch, or Cancel the order',
      )
      // A rep is told the route; only the desk undoes a pack.
      const byRep = await post<Refusal>(rep, `/orders/${u.orderId}/cancel`, {
        idempotencyKey: `cancel-m1-rep-${run}`,
        reason: 'shop changed its mind',
      })
      expect(byRep.status, JSON.stringify(byRep.body)).toBe(409)
      expect(byRep.body.data?.code).toBe('cancel_the_bill')

      const binBefore = await balance(u1, binId)
      const godownBefore = await balance(u1, godownId)
      const unpackBody = {
        idempotencyKey: `unpack-m1-u-${run}`,
        orderId: u.orderId,
        reason: 'batch expired while it waited for its bill',
      }
      const unpacked = await post<
        Refusal & {
          orderState: string
          returned: { lotId: string; qtyPcs: number; to: string; locationName: string }[]
        }
      >(manager, `/warehouse/orders/${u.orderId}/unpack`, unpackBody)
      expect(unpacked.status, JSON.stringify(unpacked.body)).toBe(200)
      expect(unpacked.body.orderState).toBe('confirmed')
      expect(unpacked.body.returned.map((r) => [r.lotId, r.qtyPcs, r.to, r.locationName])).toEqual([
        [u1, 12, 'expiry_bin', binName],
      ])
      expect(await balance(u1, dockId), 'off the dock, nothing held there').toEqual({
        on_hand: 0,
        reserved: 0,
      })
      expect((await balance(u1, binId)).on_hand).toBe(binBefore.on_hand + 12)
      expect(await balance(u1, godownId)).toEqual(godownBefore)
      expect(await orderState(u.orderId)).toBe('confirmed')
      const packRows = await one<{ n: number }>(
        sql`select count(*)::int as n from pack_confirmations where order_id = ${u.orderId}`,
      )
      expect(Number(packRows.n)).toBe(0)
      const held = await one<{ n: number }>(
        sql`select count(*)::int as n from reservations where order_line_id = ${u.lineId} and state = 'pending'`,
      )
      expect(Number(held.n), 'nothing stays held').toBe(0)
      // The same press again answers the first reply; a new one finds nothing to undo.
      const replay = await post(manager, `/warehouse/orders/${u.orderId}/unpack`, unpackBody)
      expect(replay.status).toBe(200)
      expect(replay.body).toEqual(unpacked.body)
      const again = await post<Refusal>(manager, `/warehouse/orders/${u.orderId}/unpack`, {
        ...unpackBody,
        idempotencyKey: `unpack-m1-u-again-${run}`,
      })
      expect(again.status, JSON.stringify(again.body)).toBe(409)
      expect(again.body.data?.code).toBe('not_packed')

      // Picked again from the in-date batch, packed and billed: the bill carries U2 only.
      const waveId = uuidv7()
      const waved = await post(packer, '/warehouse/picklists', {
        idempotencyKey: `wave-m1-u-${run}`,
        id: waveId,
        orderIds: [u.orderId],
        locationId: godownId,
      })
      expect(waved.status, JSON.stringify(waved.body)).toBe(200)
      const started = await post<{ item: { lines: { id: string; orderLineId: string }[] } }>(
        packer,
        `/warehouse/picklists/${waveId}/start`,
        { idempotencyKey: `start-m1-u-${run}` },
      )
      expect(started.status, JSON.stringify(started.body)).toBe(200)
      const row = started.body.item.lines.find((l) => l.orderLineId === u.lineId)
      const picked = await post(packer, `/warehouse/picklists/${waveId}/pick`, {
        idempotencyKey: `pick-m1-u-${run}`,
        lines: [{ id: row?.id ?? '', orderLineId: u.lineId, lotId: u2, pickedQtyPcs: 12 }],
      })
      expect(picked.status, JSON.stringify(picked.body)).toBe(200)
      const repacked = await pack(u.orderId, 'm1-u-again')
      expect(repacked.status, JSON.stringify(repacked.body)).toBe(200)
      const billLots = (
        await db.execute(
          sql`select lot_id, (qty_pcs + free_qty_pcs)::int as pcs from invoice_lines where invoice_id = ${repacked.body.invoice?.id ?? ''}`,
        )
      ).rows as { lot_id: string; pcs: number }[]
      expect(billLots.map((l) => [l.lot_id, Number(l.pcs)])).toEqual([[u2, 12]])
      const detail = await call<{ lines: { lots: { lotId: string; qtyPcs: number }[] }[] }>(
        app,
        manager,
        'GET',
        `/warehouse/packs/${repacked.body.item.id}`,
      )
      expect(detail.status, JSON.stringify(detail.body)).toBe(200)
      expect(detail.body.lines.flatMap((l) => l.lots.map((x) => [x.lotId, x.qtyPcs]))).toEqual([
        [u2, 12],
      ])

      // Cancel the order: the same undo, and the order is cancelled; in-date pieces go back to the godown.
      const w = await order(retailerB, vU, 6, 'm1-w')
      expect((await pack(w.orderId, 'm1-w', false)).status).toBe(200)
      const dockW = await balance(u2, dockId)
      const godownW = await balance(u2, godownId)
      const cancelled = await post<Refusal & { item: { state: string } }>(
        owner,
        `/orders/${w.orderId}/cancel`,
        { idempotencyKey: `cancel-m1-w-${run}`, reason: 'the shop no longer wants it' },
      )
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
      expect(cancelled.body.item.state).toBe('cancelled')
      expect(await balance(u2, dockId)).toEqual({
        on_hand: dockW.on_hand - 6,
        reserved: dockW.reserved - 6,
      })
      expect((await balance(u2, godownId)).on_hand).toBe(godownW.on_hand + 6)

      // A billed pack is neither unpacked nor cancelled on its own: the refusal names its bill.
      const y = await billed(retailerA, vU, 6, 'm1-y')
      const noUnpack = await post<Refusal>(manager, `/warehouse/orders/${y.orderId}/unpack`, {
        idempotencyKey: `unpack-m1-y-${run}`,
        orderId: y.orderId,
        reason: 'try',
      })
      expect(noUnpack.status, JSON.stringify(noUnpack.body)).toBe(409)
      expect(noUnpack.body.data?.code).toBe('cancel_the_bill')
      expect(noUnpack.body.message).toContain(y.invoiceNo)
      const noCancel = await post<Refusal>(owner, `/orders/${y.orderId}/cancel`, {
        idempotencyKey: `cancel-m1-y-${run}`,
        reason: 'try',
      })
      expect(noCancel.status, JSON.stringify(noCancel.body)).toBe(409)
      expect(noCancel.body.message).toBe(
        `order ${y.orderNo} is packed and billed (${y.invoiceNo}): cancel the bill and the order goes with it`,
      )
      expect(await orderState(y.orderId)).toBe('packed')
    }, 180_000)

    // ---------------------------------------------------------------------------------------------------------------
    // (3) a trip takes only bills that can still go out — M2's road

    it('vans and trips 3 (M2): a delivered bill is refused at plan, at add-stop and at departure; a trip already out with one is checked in and settled, the bill skipped with a line', async () => {
      const g = lots.G1 ?? ''
      const d = await billed(retailerA, vG, 6, 'm2-d')
      const first = await trip('m2-first', istDay(0), 5, 5, [
        { retailerId: retailerA, invoiceIds: [d.invoiceId] },
      ])
      await loadOut(app, crew, { tripId: first.id, orderIds: [d.orderId], tag: `m2-first-${run}` })
      expect((await depart(first.id, 5, 'm2-first')).status).toBe(200)
      expect((await deliverAll(5, first.id, first.stopIds[0] ?? '', d, 6, 'm2-d')).status).toBe(200)
      expect((await checkIn(first.id, 5, 'm2-first')).status).toBe(200)
      expect((await settle(first.id, [], 'm2-first')).status).toBe(200)
      expect(await orderState(d.orderId)).toBe('delivered')

      const planned = await post<Refusal>(manager, '/delivery/trips', {
        idempotencyKey: `trip-m2-refused-${run}`,
        id: uuidv7(),
        tripDate: istDay(1),
        vehicleId: vehicleIds[6],
        driverId: driverIds[6],
        openingCashPaise: 0,
        stops: [{ id: uuidv7(), sequence: 1, retailerId: retailerA, invoiceIds: [d.invoiceId] }],
      })
      expect(planned.status, JSON.stringify(planned.body)).toBe(409)
      expect(planned.body.data?.code).toBe('bill_cannot_go_out')
      expect(planned.body.message).toBe(
        `${d.invoiceNo} · ${shopA} was already delivered (order ${d.orderNo} is delivered), so it does not go out again. A trip takes only bills that can still go out.`,
      )

      const e = await billed(retailerB, vG, 6, 'm2-e')
      const second = await trip('m2-second', istDay(1), 6, 6, [
        { retailerId: retailerB, invoiceIds: [e.invoiceId] },
      ])
      const added = await post<Refusal>(manager, `/delivery/trips/${second.id}/stops`, {
        idempotencyKey: `stop-m2-${run}`,
        id: second.id,
        stop: { id: uuidv7(), retailerId: retailerA, invoiceIds: [d.invoiceId] },
      })
      expect(added.status, JSON.stringify(added.body)).toBe(409)
      expect(added.body.data?.code).toBe('bill_cannot_go_out')

      // A trip planned before the rule, holding the delivered bill (V-F1): refused at departure, taken off, then it goes.
      const plantStale = async (tag: string): Promise<string> => {
        const stopId = uuidv7()
        await db.execute(sql`insert into trip_stops (id, tenant_id, trip_id, sequence, retailer_id, state, planned_collection_paise)
                            values (${stopId}, ${tenantId}, ${second.id}, ${tag === 'a' ? 7 : 8}, ${retailerA}, 'pending', 0)`)
        await db.execute(sql`insert into deliveries (id, tenant_id, trip_id, stop_id, retailer_id, order_id, invoice_id, outcome, idempotency_key)
                            values (${uuidv7()}, ${tenantId}, ${second.id}, ${stopId}, ${retailerA}, ${d.orderId}, ${d.invoiceId}, null, ${`stale-${tag}-${run}`})`)
        return stopId
      }
      await plantStale('a')
      await loadOut(app, crew, {
        tripId: second.id,
        orderIds: [e.orderId],
        tag: `m2-second-${run}`,
      })
      const refused = await depart(second.id, 6, 'm2-second-early')
      expect(refused.status, JSON.stringify(refused.body)).toBe(409)
      expect(refused.body.data?.code).toBe('bill_cannot_go_out')
      expect(refused.body.message).toBe(
        `${d.invoiceNo} · ${shopA} was already delivered (order ${d.orderNo} is delivered), so it does not go out again. Take it off trip ${second.tripNo} (Take it off, on Trips), then send the trip out.`,
      )
      const off = await post(manager, `/delivery/trips/${second.id}/drop-bill`, {
        idempotencyKey: `drop-m2-${run}`,
        id: second.id,
        invoiceId: d.invoiceId,
        reason: 'already delivered',
      })
      expect(off.status, JSON.stringify(off.body)).toBe(200)
      expect((await depart(second.id, 6, 'm2-second')).status).toBe(200)

      // Old data: the trip on the road holds it again (V-G1). The desk cannot cancel a trip on the road, in words.
      await plantStale('b')
      const cancel = await post<Refusal>(owner, `/delivery/trips/${second.id}/cancel`, {
        idempotencyKey: `cancel-m2-${run}`,
        reason: 'stuck',
      })
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(409)
      expect(cancel.body.message).toBe(
        `Trip ${second.tripNo} is out on the road, so it is not cancelled: check it in when the van is back. Its bills that did not reach a shop come back undelivered, the godown counts the van off, and the desk settles it.`,
      )
      // The check-in goes through: the delivered bill comes off the trip, E comes back undelivered.
      const back = await checkIn(second.id, 6, 'm2-second')
      expect(back.status, JSON.stringify(back.body)).toBe(200)
      expect(back.body.item.state).toBe('closing')
      expect(await orderState(d.orderId)).toBe('delivered')
      expect(await orderState(e.orderId)).toBe('packed')
      const preview = await call<{
        skippedBills?: { invoiceId: string; why: string }[]
        expectedVanStock: { lotId: string; expectedPcs: number }[]
      }>(app, manager, 'GET', `/delivery/trips/${second.id}/settlement`)
      expect(preview.status, JSON.stringify(preview.body)).toBe(200)
      expect(preview.body.skippedBills).toEqual([
        {
          invoiceId: d.invoiceId,
          invoiceNo: d.invoiceNo,
          retailerName: shopA,
          why: `${d.invoiceNo} · ${shopA} was not on this van: order ${d.orderNo} was already delivered, so nothing of it comes back.`,
        },
      ])
      expect(preview.body.expectedVanStock.map((l) => [l.lotId, l.expectedPcs])).toEqual([[g, 6]])
      const settled = await settle(second.id, [{ lotId: g, countedPcs: 6 }], 'm2-second')
      expect(settled.status, JSON.stringify(settled.body)).toBe(200)
      expect(settled.body.tripState).toBe('settled')
    }, 180_000)

    // ---------------------------------------------------------------------------------------------------------------
    // (7) a wave's cancel leaves a packed order's dock hold alone — V-H2

    it('vans and trips 7: cancelling a wave frees the holds of the orders still waiting, and never the dock hold of an order packed off it', async () => {
      const w1 = lots.W1 ?? ''
      const a = await order(retailerA, vW, 12, 'r7-a')
      const b = await order(retailerB, vW, 12, 'r7-b')
      const waveId = uuidv7()
      const waved = await post(packer, '/warehouse/picklists', {
        idempotencyKey: `wave-r7-${run}`,
        id: waveId,
        orderIds: [a.orderId, b.orderId],
        locationId: godownId,
      })
      expect(waved.status, JSON.stringify(waved.body)).toBe(200)
      // A is packed straight off its holds while the wave still stands open (DOS-359's road).
      expect((await pack(a.orderId, 'r7-a')).status).toBe(200)
      const dockBefore = await balance(w1, dockId)
      const cancelled = await post(manager, `/warehouse/picklists/${waveId}/cancel`, {
        idempotencyKey: `cancel-r7-${run}`,
        id: waveId,
        reason: 'wave rebuilt',
      })
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
      const pendingOf = async (lineId: string, locationId: string): Promise<number> =>
        Number(
          (
            await one<{ n: number }>(
              sql`select coalesce(sum(qty), 0)::int as n from reservations
                 where order_line_id = ${lineId} and location_id = ${locationId} and state = 'pending'`,
            )
          ).n,
        )
      expect(await pendingOf(a.lineId, dockId), "A's cartons stay held on the dock").toBe(12)
      expect(await balance(w1, dockId)).toEqual(dockBefore)
      expect(await pendingOf(b.lineId, godownId), "B's godown hold is freed").toBe(0)
    }, 180_000)
  },
)
