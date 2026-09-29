import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
  salesOrders,
  stockLots,
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
import { ProcurementModule } from '../procurement/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { DeliveryModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** `backend/tools/check-stranded.mts`, the release check that names a stranded document. */
const CHECK_STRANDED = fileURLToPath(
  new URL('../../../../../tools/check-stranded.mts', import.meta.url),
)
const BACKEND = fileURLToPath(new URL('../../../../../', import.meta.url))

interface Refusal {
  message: string
  data?: { code?: string }
}
interface Upload {
  accepted: number
  rejected: { opId: string; code: string; messageEn: string }[]
}

/** IST calendar day `offset` days from today, as the tables store one. */
const istDay = (offset: number): string => {
  const today = businessDate()
  return new Date(Date.UTC(today.year, today.month - 1, today.day + offset))
    .toISOString()
    .slice(0, 10)
}

/**
 * AN ORDER IS NEVER SERVED FROM A VAN (architect ruling of 2026-09-28, the last stock row; the fourth blind check of
 * the stock-states lane, N1). A rep's order naming van C held, at confirm, the pieces of trip TX's loaded bill on
 * that van; the godown's pack then took them off while TX was on the road, and TX's door found "Only 0 pc". Undoing
 * such a pack, or cancelling its bill, put the pieces back ONTO a van another trip held.
 *
 *   made        the rep, the desk, the shop's own app and a device upload naming a van: 409 / a sync rejection, in
 *               words, nothing drafted; a repeat never names a van
 *   sent        a draft already stored with a van (drafted before the ruling): refused at submit, nothing held
 *   confirmed   an order held for an approval, since pointed at a van: the desk's confirm and the last approval
 *               refuse it, nothing held
 *   picked      an order already confirmed on a van: the wave is refused, and a wave already picking refuses the
 *               pick online and offline
 *   packed      the same order: the desk's pack is refused, and the other trip's pieces stay on the van for its
 *               bill, which is delivered
 *   undone      a pack taken off a van before the ruling, unpacked while another trip holds the van: its pieces go
 *               to the godown, never onto the van
 *   cancelled   the bill of such a pack: without a place its pieces go to the godown (expired ones to the damaged
 *               bin), and a van named as the place is refused
 *   van-sale    the billing door that bills a van-sale order off a van bills nothing while a trip holds it; the van
 *               sale's own door on its own trip still sells
 *   stranded    `pnpm check:stranded` names an order that names a van
 *
 * A state "from before the ruling" is written the way the verifier wrote it: the order's place set through SQL, and
 * where the order must also have HELD or PACKED on the van, the van's location reads as a godown for exactly that one
 * call (`beforeTheRule`), so every row is the product's own.
 */
describeDb('an order is never served from a van (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `2${run}`
  const slug = `van-orders-${run}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const shopUserId = uuidv7()
  const driverIds = Array.from({ length: 4 }, () => uuidv7())

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const shopApp: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const drivers: Actor[] = driverIds.map((actorId) => ({ tenantId, actorId, role: 'delivery' }))
  const driver = (i: number): Actor => drivers[i] as Actor
  const crew = { godown: packer, approver: manager }

  const asOwner = <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
    const ctx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
    return tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  }

  /** A: the trips' shop and the van sale's; B: the shop with its own app; C: strict credit, ₹10 limit. */
  const retailerA = uuidv7()
  const retailerB = uuidv7()
  const retailerC = uuidv7()
  /** Tooth brush on every van; a biscuit batch E1 that expires while its bill waits. */
  const vG = uuidv7()
  const vE = uuidv7()
  const vehicleIds = Array.from({ length: 4 }, () => uuidv7())
  const vans: { id: string; name: string; plate: string }[] = []
  const lots: Record<string, string> = {}
  let godownId = ''
  let godownName = ''
  let dockId = ''
  let binId = ''
  let app: NestFastifyApplication

  const post = <T>(actor: Actor, path: string, body: Record<string, unknown>) =>
    call<T>(app, actor, 'POST', path, body)
  const one = async <T>(query: ReturnType<typeof sql>): Promise<T> =>
    (await db.execute(query)).rows[0] as T
  const onHand = async (lotId: string, locationId: string): Promise<number> =>
    Number(
      (
        await one<{ on_hand: number } | undefined>(
          sql`select on_hand from stock_balances
             where tenant_id = ${tenantId} and lot_id = ${lotId} and location_id = ${locationId}`,
        )
      )?.on_hand ?? 0,
    )
  const heldAt = async (orderId: string, locationId: string): Promise<number> =>
    Number(
      (
        await one<{ n: number }>(
          sql`select coalesce(sum(r.qty), 0)::int as n from reservations r
             join sales_order_lines l on l.id = r.order_line_id
             where l.order_id = ${orderId} and r.state = 'pending' and r.location_id = ${locationId}`,
        )
      ).n,
    )
  const orderRow = async (orderId: string) =>
    one<{ state: string; fulfil_from_location_id: string | null } | undefined>(
      sql`select state::text as state, fulfil_from_location_id from sales_orders where id = ${orderId}`,
    )
  const ledgerRows = async (): Promise<number> =>
    Number(
      (
        await one<{ n: number }>(
          sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId}`,
        )
      ).n,
    )
  const pointAt = (orderId: string, locationId: string) =>
    db
      .update(salesOrders)
      .set({ fulfilFromLocationId: locationId })
      .where(eq(salesOrders.id, orderId))

  /**
   * Pretend `fn` ran before the ruling, when an order could name a van: for that one call the van's location reads as
   * a godown, so the product's own confirm and pack hold and move on it; it is a van again afterwards.
   */
  async function beforeTheRule<T>(vanLocationId: string, fn: () => Promise<T>): Promise<T> {
    await db.update(locations).set({ kind: 'warehouse' }).where(eq(locations.id, vanLocationId))
    try {
      return await fn()
    } finally {
      await db.update(locations).set({ kind: 'vehicle' }).where(eq(locations.id, vanLocationId))
    }
  }

  /** The draft a placer makes with no place: it is served from the godown. */
  async function draft(
    actor: Actor,
    retailerId: string,
    lines: { variantId: string; pcs: number }[],
    tag: string,
    source = 'salesperson',
  ): Promise<{ orderId: string; lineIds: string[] }> {
    const orderId = uuidv7()
    const lineIds = lines.map(() => uuidv7())
    const created = await post(actor, '/orders', {
      idempotencyKey: `order-${tag}-${run}`,
      id: orderId,
      retailerId,
      source,
      lines: lines.map((l, i) => ({
        id: lineIds[i],
        variantId: l.variantId,
        enteredQty: l.pcs,
        enteredUnit: 'piece',
      })),
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    return { orderId, lineIds }
  }

  const submit = (actor: Actor, orderId: string, tag: string) =>
    post<Refusal & { item: { state: string; orderNo: string } }>(
      actor,
      `/orders/${orderId}/submit`,
      { idempotencyKey: `submit-${tag}-${run}` },
    )

  /** Placed and confirmed from the godown. */
  async function confirmed(
    retailerId: string,
    lines: { variantId: string; pcs: number }[],
    tag: string,
  ): Promise<{ orderId: string; orderNo: string; lineIds: string[] }> {
    const d = await draft(rep, retailerId, lines, tag)
    const sent = await submit(rep, d.orderId, tag)
    expect(sent.status, JSON.stringify(sent.body)).toBe(200)
    expect(sent.body.item.state).toBe('confirmed')
    return { ...d, orderNo: sent.body.item.orderNo }
  }

  /** Placed and confirmed ON the van, the way a rep's order naming it was before the ruling. */
  async function confirmedOnVan(
    van: string,
    lines: { variantId: string; pcs: number }[],
    tag: string,
    source = 'salesperson',
  ): Promise<{ orderId: string; orderNo: string }> {
    const d = await draft(rep, retailerB, lines, tag, source)
    await pointAt(d.orderId, van)
    const sent = await beforeTheRule(van, () => submit(rep, d.orderId, tag))
    expect(sent.status, JSON.stringify(sent.body)).toBe(200)
    expect(sent.body.item.state).toBe('confirmed')
    return { orderId: d.orderId, orderNo: sent.body.item.orderNo }
  }

  const pack = (orderId: string, tag: string, issueInvoice = true) =>
    post<Refusal & { item: { id: string }; invoice: { id: string; invoiceNo: string } | null }>(
      packer,
      `/warehouse/orders/${orderId}/pack`,
      { idempotencyKey: `pack-${tag}-${run}`, id: uuidv7(), packages: 1, issueInvoice },
    )

  /** An order packed off its godown holds with its bill: what a trip carries. */
  async function billed(
    retailerId: string,
    pcs: number,
    tag: string,
  ): Promise<{ orderId: string; invoiceId: string; invoiceLineId: string }> {
    const o = await confirmed(retailerId, [{ variantId: vG, pcs }], tag)
    const packed = await pack(o.orderId, tag)
    expect(packed.status, JSON.stringify(packed.body)).toBe(200)
    const invoiceId = packed.body.invoice?.id ?? ''
    const line = await one<{ id: string }>(
      sql`select id from invoice_lines where invoice_id = ${invoiceId} order by line_no limit 1`,
    )
    return { orderId: o.orderId, invoiceId, invoiceLineId: line.id }
  }

  /** A trip on van `vehicleAt` with one stop for `bill`, loaded (with `vanStock`) and on the road. */
  async function tripOut(
    tag: string,
    at: number,
    bill: { orderId: string; invoiceId: string },
    vanStock: { lotId: string; qtyPcs: number }[] = [],
  ): Promise<{ id: string; stopId: string }> {
    const id = uuidv7()
    const stopId = uuidv7()
    const planned = await post(manager, '/delivery/trips', {
      idempotencyKey: `trip-${tag}-${run}`,
      id,
      tripDate: istDay(0),
      vehicleId: vehicleIds[at],
      driverId: driverIds[at],
      vanSalesEnabled: true,
      openingCashPaise: 0,
      stops: [{ id: stopId, sequence: 1, retailerId: retailerA, invoiceIds: [bill.invoiceId] }],
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    const loading = await post(packer, `/delivery/trips/${id}/start-loading`, {
      idempotencyKey: `loading-${tag}-${run}`,
    })
    expect(loading.status, JSON.stringify(loading.body)).toBe(200)
    await loadOut(app, crew, {
      tripId: id,
      orderIds: [bill.orderId],
      vanStock,
      tag: `${tag}-${run}`,
    })
    const departed = await post(driver(at), `/delivery/trips/${id}/depart`, {
      idempotencyKey: `depart-${tag}-${run}`,
    })
    expect(departed.status, JSON.stringify(departed.body)).toBe(200)
    return { id, stopId }
  }

  const deliverAll = (
    at: number,
    trip: { id: string; stopId: string },
    bill: { invoiceId: string; invoiceLineId: string },
    pcs: number,
    tag: string,
  ) =>
    post<Refusal & { item: { outcome: string } }>(driver(at), '/delivery/deliveries', {
      idempotencyKey: `deliver-${tag}-${run}`,
      id: uuidv7(),
      tripId: trip.id,
      stopId: trip.stopId,
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

  const onto = (van: number, lotId: string, pcs: number, tag: string) =>
    post(owner, '/inventory/transfers', {
      idempotencyKey: `onto-${tag}-${run}`,
      lotId,
      fromLocationId: godownId,
      toLocationId: vans[van]?.id,
      qtyPcs: pcs,
      note: 'van stock',
    })

  const cancelOrder = (orderId: string, tag: string) =>
    post<Refusal>(manager, `/orders/${orderId}/cancel`, {
      idempotencyKey: `cancel-${tag}-${run}`,
      reason: 'served from the godown instead',
    })

  /** The sentences of the ruling, as a person reads them. */
  const notMadeOn = (van: string) =>
    `An order is packed from a godown, not from ${van}: a van carries its own trip’s bills and van stock, and sells from it only through a van sale on that trip. Place the order without a location and it is packed from the godown.`
  const notSentFrom = (which: string, van: string) =>
    `${which} is set to be packed from ${van}: a van carries its own trip’s bills and van stock, and sells from it only through a van sale on that trip. Cancel it and place it again without a location; it is then packed from the godown.`
  const notServed = (orderNo: string, van: string, at: 'picked' | 'packed') =>
    `${orderNo} is set to be served from ${van}, so it is not ${at}: a van carries its own trip’s bills and van stock, and sells from it only through a van sale on that trip. An order is served from a godown: cancel it and place it again without a location; it is then picked and packed from the godown.`

  beforeAll(async () => {
    await db.insert(tenants).values({
      id: tenantId,
      slug,
      legalName: 'Van Orders Traders',
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
      .values(staff.map(([id, name], i) => ({ id, phone: `+91921${run}${String(i)}`, name })))
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
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker van orders ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Kirana goods', category: 'staples' })
    const variants: [string, string][] = [
      [vG, 'Tooth Brush'],
      [vE, 'Glucose Biscuit 100 g'],
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

    for (const [retailerId, tag, userId, credit] of [
      [retailerA, 'A', uuidv7(), {}],
      [retailerB, 'B', shopUserId, {}],
      [retailerC, 'C', uuidv7(), { creditMode: 'strict' as const, creditLimitPaise: 1_000 }],
    ] as const) {
      const identityId = uuidv7()
      const phone = `+91922${run}${tag === 'A' ? 1 : tag === 'B' ? 2 : 3}`
      await db.insert(users).values({ id: userId, phone, name: `Shopkeeper ${tag}` })
      await db.insert(memberships).values({ id: uuidv7(), tenantId, userId, role: 'retailer' })
      await db
        .insert(retailerIdentities)
        .values({ id: identityId, phone, userId, shopName: `Van Orders Shop ${tag} ${run}` })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `VO-${tag}-${run}`,
        name: `Van Orders Shop ${tag} ${run}`,
        ownerName: `Owner ${tag}`,
        phone,
        stateCode: '27',
        gstRegType: 'unregistered',
        creditDays: 15,
        lat: 19.2437,
        lng: 73.1355,
        ...credit,
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
    const godown = tenantLocations.find((l) => l.kind === 'warehouse')
    godownId = godown?.id ?? ''
    godownName = godown?.name ?? ''
    dockId = tenantLocations.find((l) => l.kind === 'in_transit')?.id ?? ''
    binId = tenantLocations.find((l) => l.kind === 'damaged')?.id ?? ''

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

    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      for (const [key, variantId, pcs] of [
        ['G1', vG, 2_000],
        ['E1', vE, 60],
      ] as const) {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId,
          batchNo: `${key}-${run}`,
          mrpPaise: 1000,
          expiryDate: '2028-01-31',
        })
        lots[key] = lot.id
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godownId,
            qtyDelta: pcs,
            reason: 'opening',
            idempotencyKey: `open-van-orders-${key}-${run}`,
          },
        ])
      }
    })

    for (const [i, vehicleId] of vehicleIds.entries()) {
      const plate = `MH-05-VO-${String(i)}${run.slice(-3)}`
      const vehicle = await post<{ item: { locationId: string } }>(owner, '/delivery/vehicles', {
        idempotencyKey: `vehicle-van-orders-${String(i)}-${run}`,
        id: vehicleId,
        regNo: plate,
        name: `Tempo ${String(i)}`,
        kind: 'tempo',
        capacityCases: 120,
      })
      expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(200)
      vans.push({ id: vehicle.body.item.locationId, name: `Vehicle ${plate}`, plate })
    }
    for (const [i, d] of drivers.entries()) {
      const consent = await post(d, '/delivery/consents', {
        idempotencyKey: `consent-van-orders-${String(i)}-${run}`,
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

  it('made: the rep, the owner, the manager and the shop’s own app cannot place an order served from a van — 409 in words, nothing drafted; the godown is still a place to name', async () => {
    const van = vans[3] as { id: string; name: string }
    const placers: [Actor, string, string][] = [
      [rep, 'rep', 'salesperson'],
      [owner, 'owner', 'salesperson'],
      [manager, 'manager', 'salesperson'],
      [shopApp, 'shop', 'retailer_app'],
    ]
    for (const [actor, tag, source] of placers) {
      const id = uuidv7()
      const res = await post<Refusal>(actor, '/orders', {
        idempotencyKey: `made-${tag}-${run}`,
        id,
        retailerId: retailerB,
        source,
        fulfilFromLocationId: van.id,
        lines: [{ id: uuidv7(), variantId: vG, enteredQty: 12, enteredUnit: 'piece' }],
      })
      expect(res.status, `${tag}: ${JSON.stringify(res.body)}`).toBe(409)
      expect(res.body.data?.code).toBe('fulfil_location_not_sellable')
      expect(res.body.message).toBe(notMadeOn(van.name))
      expect(await orderRow(id)).toBeUndefined()
    }

    // naming the godown is still an order's place
    const fromGodown = uuidv7()
    const res = await post(owner, '/orders', {
      idempotencyKey: `made-godown-${run}`,
      id: fromGodown,
      retailerId: retailerB,
      source: 'salesperson',
      fulfilFromLocationId: godownId,
      lines: [{ id: uuidv7(), variantId: vG, enteredQty: 12, enteredUnit: 'piece' }],
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect((await orderRow(fromGodown))?.fulfil_from_location_id).toBe(godownId)
  }, 120_000)

  it('made offline: a device upload drafting an order served from a van, or re-heading a draft onto one, is rejected with the same code and sentence, and nothing changes', async () => {
    const van = vans[3] as { id: string; name: string }
    const opId = `made-upload-${run}`
    const uploadedId = uuidv7()
    const own = await draft(rep, retailerB, [{ variantId: vG, pcs: 12 }], 'made-own')
    const reheadId = `made-rehead-${run}`
    const uploaded = await post<Upload>(rep, '/sync/upload', {
      protocol: 1,
      deviceId: `van-orders-device-${run}`,
      ops: [
        {
          opId,
          op: 'PUT',
          table: 'sales_orders',
          id: uploadedId,
          data: { retailer_id: retailerB, state: 'draft', fulfil_from_location_id: van.id },
        },
        {
          opId: reheadId,
          op: 'PUT',
          table: 'sales_orders',
          id: own.orderId,
          data: { retailer_id: retailerB, state: 'draft', fulfil_from_location_id: van.id },
        },
      ],
    })
    expect(uploaded.status).toBe(200)
    expect(uploaded.body.accepted).toBe(0)
    expect(uploaded.body.rejected.map((r) => [r.opId, r.code, r.messageEn])).toEqual([
      [opId, 'fulfil_location_not_sellable', notMadeOn(van.name)],
      [reheadId, 'fulfil_location_not_sellable', notMadeOn(van.name)],
    ])
    expect(await orderRow(uploadedId)).toBeUndefined()
    expect(await orderRow(own.orderId)).toEqual({ state: 'draft', fulfil_from_location_id: null })
  }, 120_000)

  it('sent: a draft stored with a van as its place (drafted before the ruling) is not submitted — 409 in words, it stays a draft and holds nothing on the van', async () => {
    const van = vans[3] as { id: string; name: string }
    // pieces on the van, so a submit that went through would hold them there
    expect((await onto(3, lots.G1 ?? '', 12, 'sent')).status).toBe(200)
    const legacy = await draft(rep, retailerB, [{ variantId: vG, pcs: 12 }], 'sent')
    await pointAt(legacy.orderId, van.id)
    const sent = await submit(rep, legacy.orderId, 'sent')
    expect(sent.status, JSON.stringify(sent.body)).toBe(409)
    expect(sent.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(sent.body.message).toBe(notSentFrom('This order', van.name))
    expect((await orderRow(legacy.orderId))?.state).toBe('draft')
    expect(await heldAt(legacy.orderId, van.id)).toBe(0)
    const cancelled = await cancelOrder(legacy.orderId, 'sent')
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
  }, 120_000)

  /** An order held for credit (shop C's ₹10 limit) and then pointed at a van, as a row from before the ruling. */
  let held = { orderId: '', orderNo: '' }

  it('confirmed by the desk: an order held for credit and since pointed at a van is not confirmed by the desk — 409 in words, nothing held on the van', async () => {
    const van = vans[3] as { id: string; name: string }
    const d = await draft(rep, retailerC, [{ variantId: vG, pcs: 12 }], 'held')
    const sent = await submit(rep, d.orderId, 'held')
    expect(sent.status, JSON.stringify(sent.body)).toBe(200)
    expect(sent.body.item.state).toBe('submitted')
    held = { orderId: d.orderId, orderNo: sent.body.item.orderNo }
    await pointAt(d.orderId, van.id)

    const byDesk = await post<Refusal>(manager, `/orders/${d.orderId}/confirm`, {
      idempotencyKey: `confirm-held-${run}`,
    })
    expect(byDesk.status, JSON.stringify(byDesk.body)).toBe(409)
    expect(byDesk.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(byDesk.body.message).toBe(notSentFrom(`Order ${held.orderNo}`, van.name))
    expect((await orderRow(d.orderId))?.state).toBe('submitted')
    expect(await heldAt(d.orderId, van.id)).toBe(0)
  }, 120_000)

  it('confirmed by an approval: the approval that would release that order is refused in words, stays pending, and nothing is held on the van', async () => {
    const van = vans[3] as { id: string; name: string }
    const gate = await one<{ id: string }>(
      sql`select id from approvals where order_id = ${held.orderId} and status = 'pending' limit 1`,
    )
    const released = await post<Refusal>(manager, `/approvals/${gate.id}/decide`, {
      idempotencyKey: `decide-held-${run}`,
      decision: 'approve',
    })
    expect(released.status, JSON.stringify(released.body)).toBe(409)
    expect(released.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(released.body.message).toBe(notSentFrom(`Order ${held.orderNo}`, van.name))
    expect((await orderRow(held.orderId))?.state).toBe('submitted')
    expect(await heldAt(held.orderId, van.id)).toBe(0)
    const still = await one<{ status: string }>(
      sql`select status::text as status from approvals where id = ${gate.id}`,
    )
    expect(still.status).toBe('pending')
  }, 120_000)

  /** N1's road: trip TX out on van C with bill X, and a rep's order confirmed on van C before the ruling. */
  let n1 = {
    x: { orderId: '', invoiceId: '', invoiceLineId: '' },
    tx: { id: '', stopId: '' },
    legacy: { orderId: '', orderNo: '' },
  }

  it('picked (N1, V4-VANORDER): an order confirmed on van C while trip TX carries its loaded bill there is not waved — 409 in words, nothing moves', async () => {
    const vanC = vans[0] as { id: string; name: string }
    const x = await billed(retailerA, 12, 'n1-x')
    const tx = await tripOut('n1-tx', 0, x)
    expect(await onHand(lots.G1 ?? '', vanC.id)).toBe(12)
    // the rep's order naming van C, confirmed before the ruling: it holds TX's twelve on the van
    const legacy = await confirmedOnVan(vanC.id, [{ variantId: vG, pcs: 12 }], 'n1-order')
    expect(await heldAt(legacy.orderId, vanC.id)).toBe(12)
    n1 = { x, tx, legacy }
    const rows = await ledgerRows()

    const waved = await post<Refusal>(packer, '/warehouse/picklists', {
      idempotencyKey: `n1-wave-${run}`,
      id: uuidv7(),
      orderIds: [legacy.orderId],
      locationId: godownId,
    })
    expect(waved.status, JSON.stringify(waved.body)).toBe(409)
    expect(waved.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(waved.body.message).toBe(notServed(legacy.orderNo, vanC.name, 'picked'))
    expect(await ledgerRows()).toBe(rows)
  }, 180_000)

  it('packed (N1, V4-VANORDER): the desk’s pack of that order is refused in words — TX’s twelve stay on van C, no bill is made', async () => {
    const vanC = vans[0] as { id: string; name: string }
    const rows = await ledgerRows()
    const packed = await pack(n1.legacy.orderId, 'n1-order')
    expect(packed.status, JSON.stringify(packed.body)).toBe(409)
    expect(packed.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(packed.body.message).toBe(notServed(n1.legacy.orderNo, vanC.name, 'packed'))
    expect(await ledgerRows()).toBe(rows)
    expect(await onHand(lots.G1 ?? '', vanC.id)).toBe(12)
    expect((await orderRow(n1.legacy.orderId))?.state).toBe('confirmed')
    const bills = await one<{ n: number }>(
      sql`select count(*)::int as n from invoices where order_id = ${n1.legacy.orderId}`,
    )
    expect(bills.n).toBe(0)
  }, 120_000)

  it('stranded (N1): pnpm check:stranded names the order that names van C, with what it holds there', async () => {
    const vanC = vans[0] as { id: string; name: string }
    const checked = spawnSync(
      process.execPath,
      ['--import', 'tsx', CHECK_STRANDED, '--tenant', slug, '--json'],
      { cwd: BACKEND, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' },
    )
    expect(checked.status, checked.stderr).toBe(1)
    const findings = JSON.parse(checked.stdout) as {
      kind: string
      tenant: string
      document: string
      detail: string
    }[]
    expect(findings).toContainEqual({
      kind: 'order-not-from-godown',
      tenant: slug,
      document: n1.legacy.orderNo,
      detail: `order is confirmed and set to be served from ${vanC.name} (vehicle), not a godown; it holds 12 pc there: cancel it and place it again without a location`,
    })
  }, 120_000)

  it('the way out (N1): the desk cancels that order, which frees its hold on van C, and TX’s door hands its own bill over, all twelve', async () => {
    const vanC = vans[0] as { id: string; name: string }
    const cancelled = await cancelOrder(n1.legacy.orderId, 'n1-order')
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
    expect(await heldAt(n1.legacy.orderId, vanC.id)).toBe(0)
    const delivered = await deliverAll(0, n1.tx, n1.x, 12, 'n1-x')
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200)
    expect(delivered.body.item.outcome).toBe('delivered')
    expect(await onHand(lots.G1 ?? '', vanC.id)).toBe(0)
  }, 120_000)

  /** A wave already picking an order, that order then pointed at van C (a row from before the ruling). */
  async function pickingOnVan(tag: string) {
    const vanC = vans[0] as { id: string; name: string }
    const o = await confirmed(retailerA, [{ variantId: vG, pcs: 12 }], tag)
    const waveId = uuidv7()
    const waved = await post<
      Refusal & { item: { lines: { id: string; orderLineId: string; lotId: string }[] } }
    >(packer, '/warehouse/picklists', {
      idempotencyKey: `wave-${tag}-${run}`,
      id: waveId,
      orderIds: [o.orderId],
    })
    expect(waved.status, JSON.stringify(waved.body)).toBe(200)
    const started = await post(packer, `/warehouse/picklists/${waveId}/start`, {
      idempotencyKey: `start-${tag}-${run}`,
      assignedTo: packerId,
    })
    expect(started.status, JSON.stringify(started.body)).toBe(200)
    await pointAt(o.orderId, vanC.id)
    const row = waved.body.item.lines[0] as { id: string; orderLineId: string; lotId: string }
    const pickedOn = async (): Promise<number> =>
      (
        await one<{ n: number }>(
          sql`select coalesce(sum(picked_qty_pcs), 0)::int as n from pick_lines where picklist_id = ${waveId}`,
        )
      ).n
    return { ...o, waveId, row, vanC, pickedOn }
  }

  it('picked online: a wave already picking an order since pointed at a van refuses its pick — 409 in words, nothing recorded', async () => {
    const p = await pickingOnVan('pick-online')
    const picked = await post<Refusal>(packer, `/warehouse/picklists/${p.waveId}/pick`, {
      idempotencyKey: `pick-online-${run}`,
      lines: [
        { id: p.row.id, orderLineId: p.row.orderLineId, lotId: p.row.lotId, pickedQtyPcs: 12 },
      ],
    })
    expect(picked.status, JSON.stringify(picked.body)).toBe(409)
    expect(picked.body.data?.code).toBe('fulfil_location_not_sellable')
    expect(picked.body.message).toBe(notServed(p.orderNo, p.vanC.name, 'picked'))
    expect(await p.pickedOn()).toBe(0)
    expect((await cancelOrder(p.orderId, 'pick-online')).status).toBe(200)
  }, 120_000)

  it('picked offline: the godown phone’s pick of such an order is rejected with the same code and sentence, and nothing is recorded', async () => {
    const p = await pickingOnVan('pick-offline')
    const opId = `pick-upload-${run}`
    const uploaded = await post<Upload>(packer, '/sync/upload', {
      protocol: 1,
      deviceId: `van-orders-godown-${run}`,
      ops: [
        {
          opId,
          op: 'PUT',
          table: 'pick_lines',
          id: p.row.id,
          data: {
            picklist_id: p.waveId,
            order_line_id: p.row.orderLineId,
            lot_id: p.row.lotId,
            picked_qty_pcs: 12,
          },
        },
      ],
    })
    expect(uploaded.status).toBe(200)
    expect(uploaded.body.rejected.map((r) => [r.opId, r.code, r.messageEn])).toEqual([
      [opId, 'fulfil_location_not_sellable', notServed(p.orderNo, p.vanC.name, 'picked')],
    ])
    expect(await p.pickedOn()).toBe(0)
    expect((await cancelOrder(p.orderId, 'pick-offline')).status).toBe(200)
  }, 120_000)

  it('undone (V4-DOORS2): a pack taken off van D before the ruling, unpacked while trip TY holds van D, puts its pieces in the godown, never onto the van; TY’s bill is delivered', async () => {
    const vanD = vans[1] as { id: string; name: string }
    expect((await onto(1, lots.G1 ?? '', 12, 'undo')).status).toBe(200)
    const u = await confirmedOnVan(vanD.id, [{ variantId: vG, pcs: 12 }], 'undo-u')
    const parked = await beforeTheRule(vanD.id, () => pack(u.orderId, 'undo-u', false))
    expect(parked.status, JSON.stringify(parked.body)).toBe(200)
    expect(await onHand(lots.G1 ?? '', vanD.id)).toBe(0)
    expect(await onHand(lots.G1 ?? '', dockId)).toBe(12)

    const y = await billed(retailerA, 12, 'undo-y')
    const ty = await tripOut('undo-ty', 1, y)
    expect(await onHand(lots.G1 ?? '', vanD.id)).toBe(12)
    const godownBefore = await onHand(lots.G1 ?? '', godownId)

    const unpacked = await post<
      Refusal & {
        orderState: string
        returned: {
          lotId: string
          qtyPcs: number
          to: string
          locationId: string
          locationName: string
        }[]
      }
    >(manager, `/warehouse/orders/${u.orderId}/unpack`, {
      idempotencyKey: `unpack-${run}`,
      reason: 'packed off a van',
    })
    expect(unpacked.status, JSON.stringify(unpacked.body)).toBe(200)
    expect(unpacked.body.orderState).toBe('confirmed')
    expect(
      unpacked.body.returned.map((r) => [r.lotId, r.qtyPcs, r.to, r.locationId, r.locationName]),
    ).toEqual([[lots.G1, 12, 'godown', godownId, godownName]])
    expect(await onHand(lots.G1 ?? '', vanD.id)).toBe(12)
    expect(await onHand(lots.G1 ?? '', godownId)).toBe(godownBefore + 12)
    expect(await onHand(lots.G1 ?? '', dockId)).toBe(0)

    const delivered = await deliverAll(1, ty, y, 12, 'undo-y')
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200)
    expect(await onHand(lots.G1 ?? '', vanD.id)).toBe(0)
    expect((await cancelOrder(u.orderId, 'undo-u')).status).toBe(200)
  }, 180_000)

  /** Two bills packed off van E before the ruling, and trip TZ out on van E with its own bill and six to sell. */
  let e = {
    k1: { invoiceId: '', invoiceNo: '' },
    k2: { invoiceId: '', invoiceNo: '' },
    z: { orderId: '', invoiceId: '', invoiceLineId: '' },
    tz: { id: '', stopId: '' },
  }

  it('cancelled onto a van (V4-CANCELONTO): a bill packed off van E is not cancelled onto a van — an idle van named as the place is refused in words, van E (trip TZ out) is refused as held; nothing moves', async () => {
    const vanE = vans[2] as { id: string; name: string }
    const vanF = vans[3] as { id: string; name: string }
    expect((await onto(2, lots.G1 ?? '', 24, 'cancel-g')).status).toBe(200)
    expect((await onto(2, lots.E1 ?? '', 6, 'cancel-e')).status).toBe(200)
    const k1 = await confirmedOnVan(vanE.id, [{ variantId: vG, pcs: 12 }], 'cancel-k1')
    const k2 = await confirmedOnVan(
      vanE.id,
      [
        { variantId: vG, pcs: 12 },
        { variantId: vE, pcs: 6 },
      ],
      'cancel-k2',
    )
    const billedK1 = await beforeTheRule(vanE.id, () => pack(k1.orderId, 'cancel-k1'))
    expect(billedK1.status, JSON.stringify(billedK1.body)).toBe(200)
    const billedK2 = await beforeTheRule(vanE.id, () => pack(k2.orderId, 'cancel-k2'))
    expect(billedK2.status, JSON.stringify(billedK2.body)).toBe(200)
    expect(await onHand(lots.G1 ?? '', vanE.id)).toBe(0)
    expect(await onHand(lots.E1 ?? '', vanE.id)).toBe(0)
    // E1 expires while its bill waits on the dock
    await db
      .update(stockLots)
      .set({ expiryDate: istDay(-1) })
      .where(eq(stockLots.id, lots.E1 ?? ''))
    const z = await billed(retailerA, 12, 'cancel-z')
    const tz = await tripOut('cancel-tz', 2, z, [{ lotId: lots.G1 ?? '', qtyPcs: 6 }])
    expect(await onHand(lots.G1 ?? '', vanE.id)).toBe(18)
    e = {
      k1: {
        invoiceId: billedK1.body.invoice?.id ?? '',
        invoiceNo: billedK1.body.invoice?.invoiceNo ?? '',
      },
      k2: {
        invoiceId: billedK2.body.invoice?.id ?? '',
        invoiceNo: billedK2.body.invoice?.invoiceNo ?? '',
      },
      z,
      tz,
    }

    const rows = await ledgerRows()
    const ontoIdleVan = await post<Refusal>(owner, `/invoices/${e.k1.invoiceId}/cancel`, {
      idempotencyKey: `cancel-k1-onto-f-${run}`,
      reason: 'not sent',
      restockLocationId: vanF.id,
    })
    expect(ontoIdleVan.status, JSON.stringify(ontoIdleVan.body)).toBe(409)
    expect(ontoIdleVan.body.data?.code).toBe('restock_not_on_van')
    expect(ontoIdleVan.body.message).toBe(
      `The pieces of bill ${e.k1.invoiceNo} go back to the godown, not onto ${vanF.name}: a cancelled bill's pieces stand on the dock, and a van carries only its own trip's bills and van stock. Cancel the bill without a place — the godown takes them and expired ones go into the damaged / expiry bin — or name the godown.`,
    )
    const ontoHeldVan = await post<Refusal>(owner, `/invoices/${e.k1.invoiceId}/cancel`, {
      idempotencyKey: `cancel-k1-onto-e-${run}`,
      reason: 'not sent',
      restockLocationId: vanE.id,
    })
    expect(ontoHeldVan.status, JSON.stringify(ontoHeldVan.body)).toBe(409)
    expect(ontoHeldVan.body.data?.code).toBe('vehicle_on_trip')
    expect(await ledgerRows()).toBe(rows)
    const k1State = await one<{ state: string }>(
      sql`select state::text as state from invoices where id = ${e.k1.invoiceId}`,
    )
    expect(k1State.state).toBe('issued')
  }, 240_000)

  it('cancelled with no place (V4-CANCELONTO): the bill’s in-date pieces go from the dock to the godown and its expired ones to the damaged bin; van E, which trip TZ holds, is untouched', async () => {
    const vanE = vans[2] as { id: string; name: string }
    const godownG = await onHand(lots.G1 ?? '', godownId)
    const godownE = await onHand(lots.E1 ?? '', godownId)
    const binE = await onHand(lots.E1 ?? '', binId)
    const dockG = await onHand(lots.G1 ?? '', dockId)
    const cancelled = await post<Refusal & { item: { state: string } }>(
      owner,
      `/invoices/${e.k2.invoiceId}/cancel`,
      { idempotencyKey: `cancel-k2-${run}`, reason: 'not sent' },
    )
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
    expect(cancelled.body.item.state).toBe('cancelled')
    expect(await onHand(lots.G1 ?? '', vanE.id)).toBe(18)
    expect(await onHand(lots.E1 ?? '', vanE.id)).toBe(0)
    expect(await onHand(lots.G1 ?? '', godownId)).toBe(godownG + 12)
    expect(await onHand(lots.E1 ?? '', godownId)).toBe(godownE)
    expect(await onHand(lots.E1 ?? '', binId)).toBe(binE + 6)
    expect(await onHand(lots.G1 ?? '', dockId)).toBe(dockG - 12)
    expect(await onHand(lots.E1 ?? '', dockId)).toBe(0)
  }, 120_000)

  it('the billing door of a van-sale order bills nothing off van E while trip TZ holds it — 409 in words, nothing moves', async () => {
    const vanE = vans[2] as { id: string; name: string }
    const v = await confirmedOnVan(vanE.id, [{ variantId: vG, pcs: 3 }], 'door-v', 'van_sale')
    const rows = await ledgerRows()
    const door = await post<Refusal>(driver(2), '/invoices/van-sale', {
      idempotencyKey: `door-v-${run}`,
      id: uuidv7(),
      orderId: v.orderId,
      vehicleLocationId: vanE.id,
    })
    expect(door.status, JSON.stringify(door.body)).toBe(409)
    expect(door.body.data?.code).toBe('vehicle_on_trip')
    expect(door.body.message).toContain(`${vans[2]?.plate ?? ''} is on trip`)
    expect(await ledgerRows()).toBe(rows)
    expect(await onHand(lots.G1 ?? '', vanE.id)).toBe(18)
    expect((await cancelOrder(v.orderId, 'door-v')).status).toBe(200)
  }, 120_000)

  it('the van sale keeps its own door: the crew of trip TZ sells off van E (its own bill held out), the order names the van, and a repeat of that sale names no van; TZ’s bill is delivered', async () => {
    const vanE = vans[2] as { id: string; name: string }
    const saleId = uuidv7()
    const sale = await post<Refusal & { order: { state: string; fulfilFromLocationId: string } }>(
      driver(2),
      '/delivery/van-sales',
      {
        idempotencyKey: `van-sale-${run}`,
        id: saleId,
        tripId: e.tz.id,
        retailerId: retailerA,
        invoiceId: uuidv7(),
        deliveryId: uuidv7(),
        lines: [{ id: uuidv7(), variantId: vG, enteredQty: 2, enteredUnit: 'piece' }],
      },
    )
    expect(sale.status, JSON.stringify(sale.body)).toBe(200)
    expect(sale.body.order.state).toBe('delivered')
    expect(sale.body.order.fulfilFromLocationId).toBe(vanE.id)
    expect(await onHand(lots.G1 ?? '', vanE.id)).toBe(16)
    // what the crew may still sell: the six of van stock less the two sold; TZ's own twelve are held out
    const listed = await call<{ items: { lotId: string; availablePcs: number }[] }>(
      app,
      driver(2),
      'GET',
      `/delivery/trips/${e.tz.id}/van-stock`,
    )
    expect(listed.status, JSON.stringify(listed.body)).toBe(200)
    expect(listed.body.items.find((i) => i.lotId === lots.G1)?.availablePcs).toBe(4)

    // the desk repeats the shop's last placed order, which is that van sale: the repeat is served from the godown
    const again = await post<{ item: { fulfilFromLocationId: string | null; note: string } }>(
      owner,
      '/orders/repeat-last',
      { idempotencyKey: `repeat-${run}`, id: uuidv7(), retailerId: retailerA },
    )
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    expect(again.body.item.note).toBe(`Repeat of ${saleId}`)
    expect(again.body.item.fulfilFromLocationId).toBeNull()

    const delivered = await deliverAll(2, e.tz, e.z, 12, 'cancel-z')
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200)
  }, 120_000)
})
