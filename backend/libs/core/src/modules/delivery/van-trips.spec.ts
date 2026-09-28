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
import { istDateWord } from '../../platform/refusal-words.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { loadOut } from '../../testing/load-out.js'
import { BillingModule } from '../billing/index.js'
import { FilesModule } from '../files/index.js'
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { ProcurementModule } from '../procurement/index.js'
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
 * endpoints and roles, in its own tenant, one van per scenario. The third blind check's races (X1, Y1) are replayed
 * with a connection of the spec's own holding a balance row the load-out's gate needs AFTER its van check, so the
 * two requests are in flight together every time: without the van lock both went through.
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
    const driverIds = Array.from({ length: 11 }, () => uuidv7())

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
    const vehicleIds = Array.from({ length: 11 }, () => uuidv7())
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

    /** A connection of the spec's own runs `statement` in a transaction and keeps what it locked until `release`. */
    const hold = async (
      statement: string,
      params: unknown[],
    ): Promise<{ pid: number; rowCount: number; release: () => Promise<void> }> => {
      const client = await pool.connect()
      let open = true
      await client.query('begin')
      const pid = Number(
        (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid,
      )
      const res = await client.query(statement, params)
      return {
        pid,
        rowCount: res.rowCount ?? 0,
        release: async () => {
          if (!open) return
          open = false
          try {
            await client.query('commit')
          } finally {
            client.release()
          }
        },
      }
    }
    /** The backends waiting on a lock `pid` holds — only this spec's own requests, whatever else runs. */
    const blockedBy = async (pid: number): Promise<number[]> =>
      (
        await pool.query<{ pid: number }>(
          'select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid)) order by pid',
          [pid],
        )
      ).rows.map((r) => Number(r.pid))
    const until = async (what: string, ready: () => Promise<boolean>): Promise<void> => {
      const deadline = Date.now() + 20_000
      while (!(await ready())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    /** Hold the dock's balance row of a batch: a load-out's gate waits on it after its van check, before it moves. */
    const holdDock = (lotId: string) =>
      hold(
        'select 1 from stock_balances where tenant_id = $1 and location_id = $2 and lot_id = $3 for update',
        [tenantId, dockId, lotId],
      )

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
        ProcurementModule,
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
      const staleStop = await plantStale('b')
      // The door refuses it offline in the online words and code (QA verify 3, minor 3: the code was 'conflict').
      const offline = await post<{
        accepted: number
        rejected: { opId: string; code: string; messageEn: string }[]
      }>(driver(6), '/sync/upload', {
        protocol: 1,
        deviceId: `vt-phone-${run}`,
        ops: [
          {
            opId: `door-m2-${run}`,
            op: 'PUT',
            table: 'deliveries',
            id: uuidv7(),
            data: {
              trip_id: second.id,
              stop_id: staleStop,
              invoice_id: d.invoiceId,
              lines: [
                {
                  id: uuidv7(),
                  invoice_line_id: d.invoiceLineId,
                  delivered_qty_pcs: 6,
                  returned_qty_pcs: 0,
                },
              ],
              pod: [],
            },
          },
        ],
      })
      expect(offline.status, JSON.stringify(offline.body)).toBe(200)
      expect(offline.body.accepted).toBe(0)
      expect(offline.body.rejected.map((r) => [r.code, r.messageEn])).toEqual([
        [
          'bill_not_on_van',
          `bill ${d.invoiceNo} was already delivered before this trip, so it is not on this van and nothing of it is handed over here. Fail the stop for it, or leave it: the check-in takes it off the trip.`,
        ],
      ])
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
    // ---------------------------------------------------------------------------------------------------------------
    // (1) one trip per van, under a race — the third blind check's X1 and Y1

    it("vans and trips 1 under a race (X1): an empty van-sales trip that departs while another trip's sheet is being counted onto the same van waits for the count, then is refused; the bill goes out on its own trip", async () => {
      const van = vehicleLocs[7] ?? ''
      const g = lots.G1 ?? ''
      const b = await billed(retailerA, vG, 12, 'x1-b')
      const loaded = await trip('x1-tb', istDay(0), 7, 7, [
        { retailerId: retailerA, invoiceIds: [b.invoiceId] },
      ])
      // The empty van-sales trip on the same van: nothing to load, so it may leave as soon as the van is free.
      const emptyId = uuidv7()
      const planned = await post(manager, '/delivery/trips', {
        idempotencyKey: `trip-x1-ta-${run}`,
        id: emptyId,
        tripDate: istDay(0),
        vehicleId: vehicleIds[7],
        driverId: driverIds[8],
        vanSalesEnabled: true,
        openingCashPaise: 0,
        stops: [],
      })
      expect(planned.status, JSON.stringify(planned.body)).toBe(200)
      expect(
        (
          await post(packer, `/delivery/trips/${emptyId}/start-loading`, {
            idempotencyKey: `loading-x1-ta-${run}`,
          })
        ).status,
      ).toBe(200)
      const emptyNo = await tripNo(emptyId)
      const sheet = await draftSheet('x1-tb', {
        toLocationId: van,
        tripId: loaded.id,
        orderIds: [b.orderId],
      })
      expect(sheet.status, JSON.stringify(sheet.body)).toBe(200)
      const approved = await post(manager, `/warehouse/load-sheets/${sheet.body.item.id}/approve`, {
        idempotencyKey: `approve-x1-tb-${run}`,
      })
      expect(approved.status, JSON.stringify(approved.body)).toBe(200)

      // The godown counts the sheet out and the crew presses Depart at the same moment.
      const gate = await holdDock(g)
      let counted: Awaited<ReturnType<typeof post<Refusal & { dispatched: string[] }>>>
      let left: Awaited<ReturnType<typeof depart>>
      try {
        const counting = post<Refusal & { dispatched: string[] }>(
          packer,
          `/warehouse/load-sheets/${sheet.body.item.id}/confirm`,
          {
            idempotencyKey: `confirm-x1-tb-${run}`,
            countedPackages: sheet.body.item.expectedPackages,
            countedVanStock: [],
            challanId: uuidv7(),
          },
        )
        await until(
          'the count to reach the dock',
          async () => (await blockedBy(gate.pid)).length >= 1,
        )
        const [countPid] = await blockedBy(gate.pid)
        let finished = false
        const leaving = depart(emptyId, 8, 'x1-ta').finally(() => {
          finished = true
        })
        // With the van lock the departure queues behind the count; without it, it went straight through.
        await until(
          'the departure to queue behind the count, or to finish without it',
          async () => finished || (await blockedBy(countPid ?? 0)).length >= 1,
        )
        await gate.release()
        ;[counted, left] = await Promise.all([counting, leaving])
      } finally {
        await gate.release()
      }
      expect(counted.status, JSON.stringify(counted.body)).toBe(200)
      expect(counted.body.dispatched).toEqual([b.orderId])
      expect(left.status, JSON.stringify(left.body)).toBe(409)
      expect(left.body.data?.code).toBe('vehicle_on_trip')
      expect(left.body.message).toBe(
        `${plates[7] ?? ''} is already loaded for trip ${loaded.tripNo} of ${istDateWord(istDay(0))}, so trip ${emptyNo} does not leave with it: a van carries one trip at a time. Send trip ${loaded.tripNo} out and settle it when it is back (or, if it is not going, check it in and settle it) first, then send this trip out.`,
      )
      expect(
        (
          await one<{ state: string }>(
            sql`select state::text as state from trips where id = ${emptyId}`,
          )
        ).state,
      ).toBe('loading')
      expect((await balance(g, van)).on_hand).toBe(12)

      // The bill leaves on its own trip and reaches its shop: no "Only 0 pc" at the door.
      expect((await depart(loaded.id, 7, 'x1-tb')).status).toBe(200)
      const door = await deliverAll(7, loaded.id, loaded.stopIds[0] ?? '', b, 12, 'x1-b')
      expect(door.status, JSON.stringify(door.body)).toBe(200)
      expect(door.body.item.outcome).toBe('delivered')
    }, 180_000)

    it('vans and trips 1 under a race (Y1): two sheets of two trips on one van, counted out at the same moment — the second waits for the first, then is refused naming it; nothing of it moves', async () => {
      const van = vehicleLocs[8] ?? ''
      const g = lots.G1 ?? ''
      const p = await billed(retailerA, vG, 6, 'y1-p')
      const q = await billed(retailerB, vG, 6, 'y1-q')
      const first = await trip('y1-first', istDay(0), 9, 8, [
        { retailerId: retailerA, invoiceIds: [p.invoiceId] },
      ])
      const second = await trip('y1-second', istDay(0), 10, 8, [
        { retailerId: retailerB, invoiceIds: [q.invoiceId] },
      ])
      const sheets: { id: string; packages: number }[] = []
      for (const [tag, t, o] of [
        ['y1-first', first, p],
        ['y1-second', second, q],
      ] as const) {
        const drafted = await draftSheet(tag, {
          toLocationId: van,
          tripId: t.id,
          orderIds: [o.orderId],
        })
        expect(drafted.status, JSON.stringify(drafted.body)).toBe(200)
        // Both approved while neither is loaded: the approval rightly finds the van free.
        const pin = await post(manager, `/warehouse/load-sheets/${drafted.body.item.id}/approve`, {
          idempotencyKey: `approve-${tag}-${run}`,
        })
        expect(pin.status, JSON.stringify(pin.body)).toBe(200)
        sheets.push({ id: drafted.body.item.id, packages: drafted.body.item.expectedPackages })
      }
      const confirm = (at: number, tag: string) =>
        post<Refusal & { dispatched: string[] }>(
          packer,
          `/warehouse/load-sheets/${sheets[at]?.id ?? ''}/confirm`,
          {
            idempotencyKey: `confirm-${tag}-${run}`,
            countedPackages: sheets[at]?.packages ?? 0,
            countedVanStock: [],
            challanId: uuidv7(),
          },
        )
      const dockBefore = await balance(g, dockId)
      const gate = await holdDock(g)
      let one1: Awaited<ReturnType<typeof confirm>>
      let two: Awaited<ReturnType<typeof confirm>>
      try {
        const firstCount = confirm(0, 'y1-first')
        await until(
          'the first count to reach the dock',
          async () => (await blockedBy(gate.pid)).length >= 1,
        )
        const [firstPid] = await blockedBy(gate.pid)
        const secondCount = confirm(1, 'y1-second')
        // With the van lock the second count queues behind the first; without it, both reached the dock.
        await until(
          'the second count to queue behind the first, or at the dock beside it',
          async () =>
            (await blockedBy(firstPid ?? 0)).length >= 1 || (await blockedBy(gate.pid)).length >= 2,
        )
        await gate.release()
        ;[one1, two] = await Promise.all([firstCount, secondCount])
      } finally {
        await gate.release()
      }
      expect(one1.status, JSON.stringify(one1.body)).toBe(200)
      expect(two.status, JSON.stringify(two.body)).toBe(409)
      expect(two.body.data?.code).toBe('vehicle_on_trip')
      expect(two.body.message).toBe(
        `${plates[8] ?? ''} is already loaded for trip ${first.tripNo} of ${istDateWord(istDay(0))}. A van carries one trip at a time, so nothing is loaded onto it for trip ${second.tripNo} until that trip is settled: send trip ${first.tripNo} out and settle it when it is back (or, if it is not going, check it in and settle it) first, then count out this sheet.`,
      )
      expect(await orderState(p.orderId)).toBe('dispatched')
      expect(await orderState(q.orderId), 'the second bill stays on the dock').toBe('packed')
      expect((await balance(g, van)).on_hand).toBe(6)
      expect((await balance(g, dockId)).on_hand).toBe(dockBefore.on_hand - 6)
      // The first trip leaves; the second is not stuck behind a van two trips hold.
      expect((await depart(first.id, 9, 'y1-first')).status).toBe(200)
    }, 180_000)

    // ---------------------------------------------------------------------------------------------------------------
    // (1) and (2) a van sale sells only what is its own trip's — X1 on old data

    it("vans and trips 2 (X1, old data): a van sale on a van another trip's bill was loaded onto before the rule does not sell that bill — the list holds it, the sale is refused, and the other trip delivers it", async () => {
      const van = vehicleLocs[9] ?? ''
      const g = lots.G1 ?? ''
      const own = await billed(retailerA, vG, 6, 'x1o-own')
      const selling = uuidv7()
      const stopId = uuidv7()
      const planned = await post(manager, '/delivery/trips', {
        idempotencyKey: `trip-x1o-sell-${run}`,
        id: selling,
        tripDate: istDay(0),
        vehicleId: vehicleIds[9],
        driverId: driverIds[1],
        vanSalesEnabled: true,
        openingCashPaise: 0,
        stops: [{ id: stopId, sequence: 1, retailerId: retailerA, invoiceIds: [own.invoiceId] }],
      })
      expect(planned.status, JSON.stringify(planned.body)).toBe(200)
      expect(
        (
          await post(packer, `/delivery/trips/${selling}/start-loading`, {
            idempotencyKey: `loading-x1o-sell-${run}`,
          })
        ).status,
      ).toBe(200)
      await loadOut(app, crew, { tripId: selling, orderIds: [own.orderId], tag: `x1o-sell-${run}` })
      expect((await depart(selling, 1, 'x1o-sell')).status).toBe(200)

      // Another trip's bill, loaded onto the same van while it was out — only a load-out before ruling 1 did that.
      const other = await billed(retailerB, vG, 12, 'x1o-other')
      const later = await trip('x1o-other', istDay(1), 2, 9, [
        { retailerId: retailerB, invoiceIds: [other.invoiceId] },
      ])
      await beforeTheRule(() =>
        loadOut(app, crew, {
          tripId: later.id,
          orderIds: [other.orderId],
          tag: `x1o-other-${run}`,
        }),
      )
      expect((await balance(g, van)).on_hand).toBe(18)

      const stock = await call<{
        items: { lotId: string; availablePcs: number; heldForBillsPcs: number }[]
      }>(app, driver(1), 'GET', `/delivery/trips/${selling}/van-stock`)
      expect(stock.status, JSON.stringify(stock.body)).toBe(200)
      expect(
        stock.body.items
          .filter((i) => i.lotId === g)
          .map((i) => [i.availablePcs, i.heldForBillsPcs]),
        "its own bill's 6 and the other trip's 12 are held, none free",
      ).toEqual([[0, 18]])

      const sale = await post<Refusal>(driver(1), '/delivery/van-sales', {
        idempotencyKey: `sale-x1o-${run}`,
        id: uuidv7(),
        tripId: selling,
        retailerId: retailerA,
        invoiceId: uuidv7(),
        deliveryId: uuidv7(),
        lines: [{ id: uuidv7(), variantId: vG, enteredQty: 12, enteredUnit: 'piece' }],
        collect: { id: uuidv7(), receiptId: uuidv7(), mode: 'cash', amountPaise: 20_000 },
      })
      expect(sale.status, JSON.stringify(sale.body)).toBeGreaterThanOrEqual(400)
      expect(sale.status, JSON.stringify(sale.body)).toBeLessThan(500)
      expect((await balance(g, van)).on_hand, 'nothing was sold off the van').toBe(18)

      // Its own bill is delivered at its door; it checks in and settles with nothing of its own left on the van.
      expect((await deliverAll(1, selling, stopId, own, 6, 'x1o-own')).status).toBe(200)
      expect((await checkIn(selling, 1, 'x1o-sell')).status).toBe(200)
      const settled = await settle(selling, [], 'x1o-sell')
      expect(settled.status, JSON.stringify(settled.body)).toBe(200)
      expect((await balance(g, van)).on_hand).toBe(12)
      // The other trip leaves with its bill on board and delivers it.
      expect((await depart(later.id, 2, 'x1o-other')).status).toBe(200)
      const door = await deliverAll(2, later.id, later.stopIds[0] ?? '', other, 12, 'x1o-other')
      expect(door.status, JSON.stringify(door.body)).toBe(200)
      expect(door.body.item.outcome).toBe('delivered')
    }, 180_000)
    it('vans and trips 1 (the other doors): while a trip holds the van nothing goes onto it by a GRN, a bill cancel or a desk credit note, each refused in words; the godown takes them', async () => {
      const van = vehicleLocs[10] ?? ''
      const g = lots.G1 ?? ''
      const x = await billed(retailerA, vG, 6, 'od-x')
      const out = await trip('od-out', istDay(0), 3, 10, [
        { retailerId: retailerA, invoiceIds: [x.invoiceId] },
      ])
      await loadOut(app, crew, { tripId: out.id, orderIds: [x.orderId], tag: `od-out-${run}` })
      expect((await depart(out.id, 3, 'od-out')).status).toBe(200)
      const onTheRoad = `${plates[10] ?? ''} is on trip ${out.tripNo}, which is out on the road: nothing is put on the van by hand while a trip holds it — a van carries one trip at a time. Goods for that trip go on through its load sheet; anything else waits until trip ${out.tripNo} is settled.`

      // A GRN received into the van (QA verify 3, minor 1: GRN-0136 put 10 pc on a van whose trip was out).
      const supplierId = uuidv7()
      const supplierInvoiceId = uuidv7()
      await db.execute(
        sql`insert into suppliers (id, tenant_id, name) values (${supplierId}, ${tenantId}, ${`Supplier ${run}`})`,
      )
      await db.execute(sql`insert into supplier_invoices (id, tenant_id, supplier_id, source, status, invoice_no, invoice_date)
                          values (${supplierInvoiceId}, ${tenantId}, ${supplierId}, 'manual', 'approved', ${`SUP-${run}`}, ${istDay(0)})`)
      await db.execute(sql`insert into supplier_invoice_lines (id, tenant_id, supplier_invoice_id, line_no, description, variant_id, batch_no, expiry_date, mrp_paise, printed_qty, qty_pcs, rate_paise)
                          values (${uuidv7()}, ${tenantId}, ${supplierInvoiceId}, 1, 'Tooth Brush', ${vG}, ${`G1-${run}`}, '2028-01-31', 1000, 10, 10, 500)`)
      const grn = await post<Refusal>(owner, '/procurement/grns', {
        idempotencyKey: `grn-od-${run}`,
        id: uuidv7(),
        supplierInvoiceId,
        locationId: van,
      })
      expect(grn.status, JSON.stringify(grn.body)).toBe(409)
      expect(grn.body.data?.code).toBe('vehicle_on_trip')
      expect(grn.body.message).toBe(onTheRoad)

      // A bill cancelled with its pieces sent to the van (minor 1: 6 pc onto the van).
      const y = await billed(retailerB, vG, 6, 'od-y')
      const cancelOnto = await post<Refusal>(owner, `/invoices/${y.invoiceId}/cancel`, {
        idempotencyKey: `cancel-od-y-van-${run}`,
        id: y.invoiceId,
        reason: 'shop cancelled',
        restockLocationId: van,
      })
      expect(cancelOnto.status, JSON.stringify(cancelOnto.body)).toBe(409)
      expect(cancelOnto.body.data?.code).toBe('vehicle_on_trip')
      expect(cancelOnto.body.message).toBe(onTheRoad)
      expect((await balance(g, van)).on_hand, 'nothing went onto the van').toBe(6)

      // A desk credit note that would put a return back onto the van.
      const credit = await post<Refusal>(owner, '/credit-notes', {
        idempotencyKey: `credit-od-${run}`,
        id: uuidv7(),
        invoiceId: x.invoiceId,
        reason: 'return_saleable',
        restockLocationId: van,
        autoIssue: true,
        lines: [{ id: uuidv7(), invoiceLineId: x.invoiceLineId, qtyPcs: 1 }],
      })
      expect(credit.status, JSON.stringify(credit.body)).toBe(409)
      expect(credit.body.data?.code).toBe('vehicle_on_trip')
      expect((await balance(g, van)).on_hand).toBe(6)

      // The godown takes what the van may not: the bill is cancelled back into the godown.
      const godownBefore = await balance(g, godownId)
      const cancelled = await post<Refusal>(owner, `/invoices/${y.invoiceId}/cancel`, {
        idempotencyKey: `cancel-od-y-${run}`,
        id: y.invoiceId,
        reason: 'shop cancelled',
      })
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
      expect((await balance(g, godownId)).on_hand).toBe(godownBefore.on_hand + 6)
      // The bill on the road still reaches its shop.
      const door = await deliverAll(3, out.id, out.stopIds[0] ?? '', x, 6, 'od-x')
      expect(door.status, JSON.stringify(door.body)).toBe(200)
    }, 180_000)
    it('the smaller doors (QA verify 3, minors 3, 4, 5): a cancelled bill is refused at plan with a code; a draft sheet holding an order cancelled since names what the order is; a wave is placed only where its orders ship from, never on a van', async () => {
      // Minor 3: a cancelled bill at plan — the same code as a delivered one.
      const c = await billed(retailerA, vG, 6, 'mn-c')
      const cancelled = await post(owner, `/invoices/${c.invoiceId}/cancel`, {
        idempotencyKey: `cancel-mn-c-${run}`,
        id: c.invoiceId,
        reason: 'shop cancelled',
      })
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
      const plan = await post<Refusal>(manager, '/delivery/trips', {
        idempotencyKey: `trip-mn-c-${run}`,
        id: uuidv7(),
        tripDate: istDay(1),
        vehicleId: vehicleIds[4],
        driverId: driverIds[5],
        openingCashPaise: 0,
        stops: [{ id: uuidv7(), sequence: 1, retailerId: retailerA, invoiceIds: [c.invoiceId] }],
      })
      expect(plan.status, JSON.stringify(plan.body)).toBe(409)
      expect(plan.body.data?.code).toBe('bill_cannot_go_out')
      expect(plan.body.message).toBe(
        `${c.invoiceNo} · ${shopA} was cancelled, so it does not go out. A trip takes only bills that can still go out.`,
      )

      // Minor 4: a draft drawn up while the order was packed, the order cancelled since (old data, through SQL).
      const k = await billed(retailerB, vG, 6, 'mn-k')
      const kTrip = await trip('mn-k', istDay(1), 5, 4, [
        { retailerId: retailerB, invoiceIds: [k.invoiceId] },
      ])
      const drafted = await draftSheet('mn-k', {
        toLocationId: vehicleLocs[4] ?? '',
        tripId: kTrip.id,
        orderIds: [k.orderId],
      })
      expect(drafted.status, JSON.stringify(drafted.body)).toBe(200)
      await db.execute(sql`update sales_orders set state = 'cancelled' where id = ${k.orderId}`)
      const gate = await post<Refusal>(
        owner,
        `/warehouse/load-sheets/${drafted.body.item.id}/confirm`,
        {
          idempotencyKey: `confirm-mn-k-${run}`,
          countedPackages: drafted.body.item.expectedPackages,
          countedVanStock: [],
          challanId: uuidv7(),
        },
      )
      expect(gate.status, JSON.stringify(gate.body)).toBe(409)
      expect(gate.body.data?.code).toBe('order_not_packed')
      expect(gate.body.message).toBe(
        `${k.orderNo} · ${shopB} is cancelled — only a packed order is loaded, so this sheet is not counted out as drafted. Cancel the sheet and draft it again without that order.`,
      )
      await db.execute(sql`update sales_orders set state = 'packed' where id = ${k.orderId}`)

      // Minor 5: a wave is placed where its orders ship from — not at a second godown, not on a van.
      const o = await order(retailerA, vW, 6, 'mn-w')
      const otherGodown = uuidv7()
      await db.execute(
        sql`insert into locations (id, tenant_id, kind, name) values (${otherGodown}, ${tenantId}, 'warehouse', ${`Back Godown ${run}`})`,
      )
      const godownName = (
        await one<{ name: string }>(sql`select name from locations where id = ${godownId}`)
      ).name
      for (const [tag, locationId, words] of [
        [
          'elsewhere',
          otherGodown,
          `This order ships from ${godownName}, not Back Godown ${run}: a wave is picked where its orders ship from. Wave it from ${godownName}.`,
        ],
        [
          'van',
          vehicleLocs[4] ?? '',
          `A wave is picked in the godown, not on Vehicle ${plates[4] ?? ''}: a van carries its trip's bills and van stock. Wave the orders from ${godownName}.`,
        ],
      ] as const) {
        const wave = await post<Refusal>(packer, '/warehouse/picklists', {
          idempotencyKey: `wave-mn-${tag}-${run}`,
          id: uuidv7(),
          orderIds: [o.orderId],
          locationId,
        })
        expect(wave.status, JSON.stringify(wave.body)).toBe(409)
        expect(wave.body.data?.code).toBe('wave_not_where_orders_ship')
        expect(wave.body.message).toBe(words)
      }
      await db.execute(sql`update locations set active = false where id = ${otherGodown}`)
      const home = await post(packer, '/warehouse/picklists', {
        idempotencyKey: `wave-mn-home-${run}`,
        id: uuidv7(),
        orderIds: [o.orderId],
        locationId: godownId,
      })
      expect(home.status, JSON.stringify(home.body)).toBe(200)
    }, 180_000)
  },
)
