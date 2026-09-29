import { eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  featureFlags,
  hsnRates,
  loadSheets,
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
import { WarehouseModule } from '../warehouse/index.js'
import { DeliveryModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface Refusal {
  message: string
  data?: { code?: string }
}
interface SheetLine {
  id: string
  orderLineId: string
  lotId: string | null
  suggestedLotId: string | null
  requestedQtyPcs: number
  pickedQtyPcs: number
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
 * THE STOCK-STATES LANE (QA phases 10 + 9, architect rulings of 2026-09-28): pick, pack, load and trip.
 *
 *   DOS-351  an expired batch is refused at pick (online and offline) and at pack and billing; short-dated warns
 *   DOS-353  a pick, and a pack, take only the line's own held pieces plus the free ones
 *   DOS-354  a loaded trip is not cancelled, it is checked in; a trip cancelled before its load-out frees its bills
 *   DOS-355  a pack without a bill is not put on a load sheet, nor counted out at the gate
 *   DOS-358  a van whose trip is out is not unloaded by hand
 *   DOS-361  a packed order's pick is not edited, online or offline
 *
 * Every scenario is the QA lane's own (QA/tools/p10), driven through the same endpoints and roles.
 */
describeDb('stock states: pick, pack, load and trip (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  // The clock read half a wrap (50 000 000 ms) ahead: delivery.spec.ts builds the same `7${run}` HSN code from the same
  // eight digits, and the two files started in the same millisecond collided on it when run in parallel. Offset, the
  // suffix of this file can never equal that of a spec that reads the clock at the same moment.
  const run = String(Date.now() + 50_000_000).slice(-8)
  const hsn = `7${run}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const driverIds = Array.from({ length: 9 }, () => uuidv7())

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const drivers: Actor[] = driverIds.map((actorId) => ({ tenantId, actorId, role: 'delivery' }))
  const crew = { godown: packer, approver: manager }

  const asOwner = <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
    const ctx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
    return tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  }

  const retailerA = uuidv7()
  const retailerB = uuidv7()
  /**
   * Cookies (DOS-351), whitener (DOS-353), tooth brush (the rest), masala (the parked pack of DOS-351) and haldi
   * (the bills dated back of DOS-351's verify).
   */
  const vB = uuidv7()
  const vE = uuidv7()
  const vG = uuidv7()
  const vP = uuidv7()
  const vQ = uuidv7()
  /** One vehicle per scenario, so a trip left open by one never holds another's van. */
  const vehicleIds = Array.from({ length: 9 }, () => uuidv7())
  const vehicleLocs: string[] = []
  const lots: Record<string, string> = {}
  let godownId = ''
  let dockId = ''
  let app: NestFastifyApplication

  const post = <T>(actor: Actor, path: string, body: Record<string, unknown>) =>
    call<T>(app, actor, 'POST', path, body)
  const one = async <T>(query: ReturnType<typeof sql>): Promise<T> =>
    (await db.execute(query)).rows[0] as T
  const balance = async (lotId: string, locationId: string) =>
    (await one<{ on_hand: number; reserved: number } | undefined>(
      sql`select on_hand, reserved from stock_balances
           where tenant_id = ${tenantId} and lot_id = ${lotId} and location_id = ${locationId}`,
    )) ?? { on_hand: 0, reserved: 0 }
  const orderState = async (orderId: string): Promise<string> =>
    (
      await one<{ state: string }>(
        sql`select state::text as state from sales_orders where id = ${orderId}`,
      )
    ).state
  const ledgerCount = async (lotId: string): Promise<number> =>
    Number(
      (
        await one<{ n: number }>(
          sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId} and lot_id = ${lotId}`,
        )
      ).n,
    )

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

  /** Wave and start: the sheet's rows, as the picker's phone reads them. */
  async function wave(
    orderIds: string[],
    tag: string,
  ): Promise<{ id: string; lines: SheetLine[] }> {
    const id = uuidv7()
    const created = await post(packer, '/warehouse/picklists', {
      idempotencyKey: `wave-${tag}-${run}`,
      id,
      orderIds,
      locationId: godownId,
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const started = await post<{ item: { lines: SheetLine[] } }>(
      packer,
      `/warehouse/picklists/${id}/start`,
      { idempotencyKey: `start-${tag}-${run}` },
    )
    expect(started.status, JSON.stringify(started.body)).toBe(200)
    return { id, lines: started.body.item.lines }
  }

  const pick = (
    sheetId: string,
    lines: {
      id: string
      orderLineId: string
      lotId: string
      pickedQtyPcs: number
      shortReason?: string
    }[],
    tag: string,
  ) =>
    post<Refusal & { warnings: { code: string }[] }>(
      packer,
      `/warehouse/picklists/${sheetId}/pick`,
      {
        idempotencyKey: `pick-${tag}-${run}`,
        lines,
      },
    )

  const pack = (orderId: string, tag: string, issueInvoice = true) =>
    post<Refusal & { item: { id: string }; invoice: { id: string; invoiceNo: string } | null }>(
      packer,
      `/warehouse/orders/${orderId}/pack`,
      { idempotencyKey: `pack-${tag}-${run}`, id: uuidv7(), packages: 1, issueInvoice },
    )

  /** One offline pick op through the sync upload, as the godown phone queues it. */
  const uploadPick = (
    sheetId: string,
    row: {
      id: string
      orderLineId: string
      lotId: string
      pickedQtyPcs: number
      shortReason?: string
    },
    tag: string,
  ) =>
    post<Upload>(packer, '/sync/upload', {
      protocol: 1,
      deviceId: `dev-${tag}-${run}`,
      ops: [
        {
          opId: `op-${tag}-${run}`,
          op: 'PUT',
          table: 'pick_lines',
          id: row.id,
          data: {
            picklist_id: sheetId,
            order_line_id: row.orderLineId,
            lot_id: row.lotId,
            picked_qty_pcs: row.pickedQtyPcs,
            ...(row.shortReason === undefined ? {} : { short_reason: row.shortReason }),
          },
        },
      ],
    })

  async function trip(
    tag: string,
    day: string,
    driver: number,
    vehicle: number,
    stops: { retailerId: string; invoiceIds: string[] }[],
    opts: { vanSales?: boolean; startLoading?: boolean } = {},
  ): Promise<{ id: string; stopIds: string[] }> {
    const id = uuidv7()
    const stopIds = stops.map(() => uuidv7())
    const planned = await post(manager, '/delivery/trips', {
      idempotencyKey: `trip-${tag}-${run}`,
      id,
      tripDate: day,
      vehicleId: vehicleIds[vehicle],
      driverId: driverIds[driver],
      openingCashPaise: 0,
      ...(opts.vanSales === true ? { vanSalesEnabled: true } : {}),
      stops: stops.map((s, i) => ({
        id: stopIds[i],
        sequence: i + 1,
        retailerId: s.retailerId,
        invoiceIds: s.invoiceIds,
      })),
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    if (opts.startLoading === false) return { id, stopIds }
    const loading = await post(packer, `/delivery/trips/${id}/start-loading`, {
      idempotencyKey: `loading-${tag}-${run}`,
    })
    expect(loading.status, JSON.stringify(loading.body)).toBe(200)
    return { id, stopIds }
  }

  const billLot = async (invoiceId: string): Promise<{ lotId: string; pcs: number }> => {
    const row = await one<{ lot_id: string; pcs: number }>(
      sql`select lot_id, (qty_pcs + free_qty_pcs)::int as pcs from invoice_lines where invoice_id = ${invoiceId} limit 1`,
    )
    return { lotId: row.lot_id, pcs: Number(row.pcs) }
  }

  beforeAll(async () => {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `states-${run}`,
      legalName: 'Stock States Traders',
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
      .values(staff.map(([id, name], i) => ({ id, phone: `+91986${run}${String(i)}`, name })))
    await db
      .insert(memberships)
      .values(staff.map(([userId, , role]) => ({ id: uuidv7(), tenantId, userId, role })))
    await bootstrapTenant(db, tenantId)
    // The van sale of DOS-351's verify needs the tenant's van-sales switch on.
    await db
      .insert(featureFlags)
      .values({ tenantId, flag: 'van_sales', enabled: true })
      .onConflictDoUpdate({
        target: [featureFlags.tenantId, featureFlags.flag],
        set: { enabled: true },
      })

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker states ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Kirana goods', category: 'staples' })
    const variants: [string, string][] = [
      [vB, 'Choco Chip Cookies 120 g'],
      [vE, 'Dairy Whitener 500 g'],
      [vG, 'Tooth Brush'],
      [vP, 'Garam Masala 50 g'],
      [vQ, 'Haldi Powder 100 g'],
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
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, cessBps: 0, effectiveFrom: '2020-04-01' })

    for (const [retailerId, tag] of [
      [retailerA, 'A'],
      [retailerB, 'B'],
    ] as const) {
      const shopUser = uuidv7()
      const identityId = uuidv7()
      const phone = `+91987${run}${tag === 'A' ? 1 : 2}`
      await db.insert(users).values({ id: shopUser, phone, name: `Shopkeeper ${tag}` })
      await db
        .insert(memberships)
        .values({ id: uuidv7(), tenantId, userId: shopUser, role: 'retailer' })
      await db
        .insert(retailerIdentities)
        .values({ id: identityId, phone, userId: shopUser, shopName: `States Shop ${tag} ${run}` })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `ST-${tag}-${run}`,
        name: `States Shop ${tag} ${run}`,
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
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
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

    // The batches, each with its own story: in date, already expired (yesterday), short-dated (5 days, under
    // the 30-day rule), the whitener of DOS-353 (202 pieces), the tooth brush, and the masala of the parked pack.
    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      for (const [key, variantId, expiryDate, pcs] of [
        ['B-G', vB, '2028-06-30', 200],
        ['B-EXP', vB, istDay(-1), 100],
        ['B-SHORT', vB, istDay(5), 100],
        ['E1', vE, '2028-01-31', 202],
        ['G1', vG, '2028-01-31', 1_000],
        ['P1', vP, '2027-12-31', 24],
        ['Q1', vQ, '2027-12-31', 24],
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
            idempotencyKey: `open-states-${key}-${run}`,
          },
        ])
      }
    })

    for (const [i, vehicleId] of vehicleIds.entries()) {
      const vehicle = await post<{ item: { locationId: string } }>(owner, '/delivery/vehicles', {
        idempotencyKey: `vehicle-states-${String(i)}-${run}`,
        id: vehicleId,
        regNo: `MH-05-ST-${String(i)}${run.slice(-3)}`,
        name: `Tempo ${String(i)}`,
        kind: 'tempo',
        capacityCases: 120,
      })
      expect(vehicle.status, JSON.stringify(vehicle.body)).toBe(200)
      vehicleLocs.push(vehicle.body.item.locationId)
    }
    for (const [i, driver] of drivers.entries()) {
      const consent = await post(driver, '/delivery/consents', {
        idempotencyKey: `consent-states-${String(i)}-${run}`,
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
  // DOS-351

  it('DOS-351: an expired batch is refused at pick, online and offline, whatever the sheet suggested; a short-dated one still only warns', async () => {
    const o = await order(retailerA, vB, 24, '351-pick')
    const sheet = await wave([o.orderId], '351-pick')
    const row = sheet.lines.find((l) => l.orderLineId === o.lineId)
    expect(row?.suggestedLotId, 'FEFO within the rule suggests the in-date batch').toBe(lots['B-G'])
    const expired = lots['B-EXP'] ?? ''
    const before = await balance(expired, godownId)

    const online = await pick(
      sheet.id,
      [{ id: row?.id ?? '', orderLineId: o.lineId, lotId: expired, pickedQtyPcs: 24 }],
      '351-exp',
    )
    expect(online.status, JSON.stringify(online.body)).toBe(409)
    expect(online.body.data?.code).toBe('batch_expired')
    expect(online.body.message).toBe(
      `Choco Chip Cookies 120 g batch B-EXP-${run} expired on ${expiryPhrase(istDay(-1))}. Expired goods are never sold — pick an in-date batch, and move the expired pieces into the damaged / expiry bin with Move on the Stock screen.`,
    )

    // Offline: 2xx with a sync error carrying the SAME sentence, never a 4xx that would wedge the phone.
    const offline = await uploadPick(
      sheet.id,
      { id: row?.id ?? '', orderLineId: o.lineId, lotId: expired, pickedQtyPcs: 24 },
      '351-exp',
    )
    expect(offline.status, JSON.stringify(offline.body)).toBe(200)
    expect(offline.body.rejected.map((r) => r.code)).toEqual(['batch_expired'])
    expect(offline.body.rejected[0]?.messageEn).toBe(online.body.message)
    expect(await balance(expired, godownId)).toEqual(before)

    // The short-dated batch (5 days left, under the 30-day rule) is still taken, with its two warnings.
    const short = await pick(
      sheet.id,
      [
        {
          id: row?.id ?? '',
          orderLineId: o.lineId,
          lotId: lots['B-SHORT'] ?? '',
          pickedQtyPcs: 24,
        },
      ],
      '351-short',
    )
    expect(short.status, JSON.stringify(short.body)).toBe(200)
    expect(short.body.warnings.map((w) => w.code).sort()).toEqual([
      'fefo_override',
      'short_shelf_life',
    ])
    const packed = await pack(o.orderId, '351-short')
    expect(packed.status, JSON.stringify(packed.body)).toBe(200)
    expect(await billLot(packed.body.invoice?.id ?? '')).toEqual({
      lotId: lots['B-SHORT'],
      pcs: 24,
    })
  }, 120_000)

  it('DOS-351: a pick recorded before the rule cannot become a bill — the pack refuses the expired batch and moves nothing', async () => {
    const o = await order(retailerA, vB, 12, '351-legacy')
    const sheet = await wave([o.orderId], '351-legacy')
    const row = sheet.lines.find((l) => l.orderLineId === o.lineId)
    const expired = lots['B-EXP'] ?? ''
    // The QA lane's INV/9011: the picker took the expired front carton and the server recorded it.
    await db.execute(
      sql`update pick_lines set lot_id = ${expired}, picked_qty_pcs = 12, picked_at = now(), fefo_override = true
           where id = ${row?.id ?? ''}`,
    )
    const ledgerBefore = await ledgerCount(expired)
    const refused = await pack(o.orderId, '351-legacy')
    expect(refused.status, JSON.stringify(refused.body)).toBe(409)
    expect(refused.body.data?.code).toBe('batch_expired')
    expect(refused.body.message).toBe(
      `${o.orderNo} cannot be packed: 12 pc of it are Choco Chip Cookies 120 g batch B-EXP-${run}, which expired on ${expiryPhrase(istDay(-1))}. Expired goods are never billed or sent — record the pick again from an in-date batch, and move the expired pieces into the damaged / expiry bin with Move on the Stock screen.`,
    )
    expect(await ledgerCount(expired), 'nothing moved').toBe(ledgerBefore)
    expect(await orderState(o.orderId)).toBe('picking')
    const bills = await one<{ n: number }>(
      sql`select count(*)::int as n from invoices where order_id = ${o.orderId}`,
    )
    expect(Number(bills.n)).toBe(0)

    // The picker records it again from the batch the sheet suggested, and the order packs.
    const again = await pick(
      sheet.id,
      [{ id: row?.id ?? '', orderLineId: o.lineId, lotId: lots['B-G'] ?? '', pickedQtyPcs: 12 }],
      '351-legacy-again',
    )
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    const packed = await pack(o.orderId, '351-legacy-again')
    expect(packed.status, JSON.stringify(packed.body)).toBe(200)
  }, 120_000)

  it('DOS-351: a parked pack whose batch has expired since is not billed', async () => {
    const o = await order(retailerB, vP, 12, '351-parked')
    const packed = await pack(o.orderId, '351-parked', false)
    expect(packed.status, JSON.stringify(packed.body)).toBe(200)
    expect(packed.body.invoice).toBeNull()
    // The batch passes its date while the pack waits on the dock for its bill.
    await db.execute(
      sql`update stock_lots set expiry_date = ${istDay(-1)} where id = ${lots.P1 ?? ''}`,
    )
    const billed = await post<Refusal>(manager, `/warehouse/packs/${packed.body.item.id}/invoice`, {
      idempotencyKey: `bill-351-parked-${run}`,
      id: uuidv7(),
    })
    expect(billed.status, JSON.stringify(billed.body)).toBe(409)
    expect(billed.body.data?.code).toBe('batch_expired')
    expect(billed.body.message).toMatch(
      new RegExp(
        `^${o.orderNo} cannot be billed: 12 pc of it are Garam Masala 50 g batch P1-${run}, which expired on`,
      ),
    )
  }, 120_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-353

  it('DOS-353: a short-confirmed order cannot pick the pieces held for an order confirmed before it, and the first order picks and packs in full', async () => {
    const e1 = lots.E1 ?? ''
    const x = await order(retailerA, vE, 150, '353-x')
    const y = await order(retailerB, vE, 100, '353-y')
    expect(await balance(e1, godownId)).toEqual({ on_hand: 202, reserved: 202 })

    const sheet = await wave([y.orderId], '353-y')
    const held = sheet.lines.find((l) => l.lotId === e1)
    const lotless = sheet.lines.find((l) => l.lotId === null)
    expect(held?.requestedQtyPcs).toBe(52)
    expect(lotless?.requestedQtyPcs).toBe(48)

    // The QA lane's S4e: 52 on its own row and the short 48 on a split row of the same batch.
    const split = uuidv7()
    const stolen = await pick(
      sheet.id,
      [
        { id: held?.id ?? '', orderLineId: y.lineId, lotId: e1, pickedQtyPcs: 52 },
        { id: split, orderLineId: y.lineId, lotId: e1, pickedQtyPcs: 48 },
      ],
      '353-steal',
    )
    expect(stolen.status, JSON.stringify(stolen.body)).toBe(409)
    expect(stolen.body.data?.code).toBe('held_for_another_order')
    expect(stolen.body.message).toBe(
      `${y.orderNo} may take 52 pc of Dairy Whitener 500 g batch E1-${run} (52 held for it, none free) and 100 were recorded. The other pieces of that batch are held for ${x.orderNo}: leave them on the rack for that order; record the rest of ${y.orderNo} as short, with a reason.`,
    )

    // Offline, the same rule: the held 52 are taken, the split onto X's pieces is a sync error.
    const own = await uploadPick(
      sheet.id,
      { id: held?.id ?? '', orderLineId: y.lineId, lotId: e1, pickedQtyPcs: 52 },
      '353-own',
    )
    expect(own.body.rejected, JSON.stringify(own.body)).toEqual([])
    const splitOffline = await uploadPick(
      sheet.id,
      { id: split, orderLineId: y.lineId, lotId: e1, pickedQtyPcs: 48 },
      '353-split',
    )
    expect(splitOffline.status).toBe(200)
    expect(splitOffline.body.rejected.map((r) => r.code)).toEqual(['held_for_another_order'])
    expect(splitOffline.body.rejected[0]?.messageEn).toMatch(new RegExp(`held for ${x.orderNo}`))

    // The short is recorded with its reason, Y packs what it holds, and X is untouched.
    const shorted = await pick(
      sheet.id,
      [
        {
          id: lotless?.id ?? '',
          orderLineId: y.lineId,
          lotId: e1,
          pickedQtyPcs: 0,
          shortReason: 'not on the rack',
        },
      ],
      '353-short',
    )
    expect(shorted.status, JSON.stringify(shorted.body)).toBe(200)
    const packedY = await pack(y.orderId, '353-y')
    expect(packedY.status, JSON.stringify(packedY.body)).toBe(200)
    expect(await billLot(packedY.body.invoice?.id ?? '')).toEqual({ lotId: e1, pcs: 52 })
    expect(await balance(e1, godownId)).toEqual({ on_hand: 150, reserved: 150 })

    const sheetX = await wave([x.orderId], '353-x')
    const rowX = sheetX.lines.find((l) => l.orderLineId === x.lineId)
    const pickedX = await pick(
      sheetX.id,
      [{ id: rowX?.id ?? '', orderLineId: x.lineId, lotId: e1, pickedQtyPcs: 150 }],
      '353-x',
    )
    expect(pickedX.status, JSON.stringify(pickedX.body)).toBe(200)
    const packedX = await pack(x.orderId, '353-x')
    expect(packedX.status, JSON.stringify(packedX.body)).toBe(200)
    expect(await billLot(packedX.body.invoice?.id ?? '')).toEqual({ lotId: e1, pcs: 150 })
    expect(await balance(e1, godownId)).toEqual({ on_hand: 0, reserved: 0 })
  }, 180_000)

  it('DOS-353: a pick recorded over the share before the rule is refused at pack, naming the order that holds the pieces', async () => {
    const e2 = await asOwner(async (tx) => {
      const inventory = app.get(InventoryService)
      const { lot } = await inventory.findOrCreateLot(tx, {
        variantId: vE,
        batchNo: `E2-${run}`,
        mrpPaise: 1000,
        expiryDate: '2028-02-28',
      })
      await inventory.post(tx, [
        {
          lotId: lot.id,
          locationId: godownId,
          qtyDelta: 60,
          reason: 'opening',
          idempotencyKey: `open-states-E2-${run}`,
        },
      ])
      return lot.id
    })
    const x = await order(retailerA, vE, 40, '353p-x')
    const y = await order(retailerB, vE, 30, '353p-y')
    const sheet = await wave([y.orderId], '353p-y')
    const held = sheet.lines.find((l) => l.lotId === e2)
    const lotless = sheet.lines.find((l) => l.lotId === null)
    expect(held?.requestedQtyPcs).toBe(20)
    // Recorded before the rule existed: the held 20 and the short 10 from the same batch.
    await db.execute(
      sql`update pick_lines set picked_qty_pcs = 20, picked_at = now() where id = ${held?.id ?? ''}`,
    )
    await db.execute(
      sql`update pick_lines set lot_id = ${e2}, picked_qty_pcs = 10, picked_at = now() where id = ${lotless?.id ?? ''}`,
    )
    const refused = await pack(y.orderId, '353p-y')
    expect(refused.status, JSON.stringify(refused.body)).toBe(409)
    expect(refused.body.data?.code).toBe('held_for_another_order')
    expect(refused.body.message).toBe(
      `${y.orderNo} may take 20 pc of Dairy Whitener 500 g batch E2-${run} (20 held for it, none free) and 30 are packed. The other pieces of that batch are held for ${x.orderNo}: leave them on the rack for that order; record ${y.orderNo}'s pick again with what is really in its carton, and the rest as short with a reason.`,
    )
    expect(await balance(e2, godownId)).toEqual({ on_hand: 60, reserved: 60 })

    // A correction DOWNWARDS is never refused, even on a line that was over its share.
    const corrected = await pick(
      sheet.id,
      [
        {
          id: lotless?.id ?? '',
          orderLineId: y.lineId,
          lotId: e2,
          pickedQtyPcs: 0,
          shortReason: 'not on the rack',
        },
      ],
      '353p-correct',
    )
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200)
    expect((await pack(y.orderId, '353p-y2')).status).toBe(200)
    const sheetX = await wave([x.orderId], '353p-x')
    const rowX = sheetX.lines.find((l) => l.orderLineId === x.lineId)
    expect(
      (
        await pick(
          sheetX.id,
          [{ id: rowX?.id ?? '', orderLineId: x.lineId, lotId: e2, pickedQtyPcs: 40 }],
          '353p-x',
        )
      ).status,
    ).toBe(200)
    expect((await pack(x.orderId, '353p-x')).status).toBe(200)
    expect(await balance(e2, godownId)).toEqual({ on_hand: 0, reserved: 0 })
  }, 180_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-361

  it("DOS-361: a packed order's pick row is not edited, online or offline", async () => {
    const g1 = lots.G1 ?? ''
    const a = await order(retailerA, vG, 12, '361-a')
    const b = await order(retailerB, vG, 12, '361-b')
    const sheet = await wave([a.orderId, b.orderId], '361')
    const rows = sheet.lines.map((l) => ({
      id: l.id,
      orderLineId: l.orderLineId,
      lotId: l.suggestedLotId ?? g1,
      pickedQtyPcs: l.requestedQtyPcs,
    }))
    // A is picked and packed while B is still on the rack, so the wave is still `picking` — the only
    // status the phone may push picks to.
    const rowA = rows.find((r) => r.orderLineId === a.lineId)
    const rowB = rows.find((r) => r.orderLineId === b.lineId)
    expect((await pick(sheet.id, rowA ? [rowA] : [], '361')).status).toBe(200)
    expect((await pack(a.orderId, '361-a')).status).toBe(200)
    const edit = { ...(rowA ?? rows[0]), pickedQtyPcs: 5, shortReason: 'edit after pack' }
    const online = await pick(sheet.id, [edit as (typeof rows)[number]], '361-edit')
    expect(online.status, JSON.stringify(online.body)).toBe(409)
    expect(online.body.data?.code).toBe('order_packed')
    expect(online.body.message).toBe(
      `${a.orderNo} is already packed, so its pick cannot change any more: its bill and its stock were made from what was recorded. If the carton went out wrong, the desk corrects the bill with a credit note.`,
    )
    const offline = await uploadPick(sheet.id, edit as (typeof rows)[number], '361-edit')
    expect(offline.status).toBe(200)
    expect(offline.body.rejected.map((r) => r.code)).toEqual(['order_packed'])
    expect(offline.body.rejected[0]?.messageEn).toBe(online.body.message)
    const stored = await one<{ picked_qty_pcs: number }>(
      sql`select picked_qty_pcs from pick_lines where id = ${rowA?.id ?? ''}`,
    )
    expect(stored.picked_qty_pcs).toBe(12)
    expect((await pick(sheet.id, rowB ? [rowB] : [], '361-b')).status).toBe(200)
    expect((await pack(b.orderId, '361-b')).status).toBe(200)
  }, 120_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-355

  it('DOS-355: a pack with no bill is refused on a load sheet when it is added and again at the gate, and no challan is issued', async () => {
    const o = await order(retailerA, vG, 12, '355')
    const parked = await pack(o.orderId, '355', false)
    expect(parked.status, JSON.stringify(parked.body)).toBe(200)
    const sentence = `${o.orderNo} · States Shop A ${run} is packed but not billed. Goods never leave on a challan without their tax invoice: bill it first on the billing desk (Packed, not billed), then put it on the load sheet.`

    const added = await post<Refusal>(packer, '/warehouse/load-sheets', {
      idempotencyKey: `sheet-355-${run}`,
      id: uuidv7(),
      toLocationId: vehicleLocs[2],
      orderIds: [o.orderId],
    })
    expect(added.status, JSON.stringify(added.body)).toBe(409)
    expect(added.body.data?.code).toBe('pack_not_billed')
    expect(added.body.message).toBe(sentence)

    // A sheet drafted before the rule carries it; the gate refuses it and nothing leaves.
    const legacy = uuidv7()
    await db.insert(loadSheets).values({
      id: legacy,
      tenantId,
      fromLocationId: godownId,
      toLocationId: vehicleLocs[2] ?? '',
      orderIds: [o.orderId],
      expectedPackages: 1,
      loadValuePaise: 0,
    })
    const gate = await post<Refusal>(manager, `/warehouse/load-sheets/${legacy}/confirm`, {
      idempotencyKey: `confirm-355-${run}`,
      countedPackages: 1,
      challanId: uuidv7(),
    })
    expect(gate.status, JSON.stringify(gate.body)).toBe(409)
    expect(gate.body.data?.code).toBe('pack_not_billed')
    expect(gate.body.message).toBe(sentence)
    const challans = await one<{ n: number }>(
      sql`select count(*)::int as n from delivery_challans where load_sheet_id = ${legacy}`,
    )
    expect(Number(challans.n)).toBe(0)
    expect(await orderState(o.orderId)).toBe('packed')

    // Billed, it loads.
    const billed = await post<{ item: { id: string } }>(
      manager,
      `/warehouse/packs/${parked.body.item.id}/invoice`,
      { idempotencyKey: `bill-355-${run}`, id: uuidv7() },
    )
    expect(billed.status, JSON.stringify(billed.body)).toBe(200)
    const cancelled = await post(manager, `/warehouse/load-sheets/${legacy}/cancel`, {
      idempotencyKey: `cancel-355-${run}`,
      reason: 'drafted before the bill',
    })
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
    // Billed and planned on a trip (QA DOS-354 verify: a sheet loads only its own trip's bills), it loads.
    const t = await trip('355', istDay(4), 3, 3, [
      { retailerId: retailerA, invoiceIds: [billed.body.item.id] },
    ])
    const again = await post<{ item: { id: string } }>(packer, '/warehouse/load-sheets', {
      idempotencyKey: `sheet-355-again-${run}`,
      id: uuidv7(),
      toLocationId: vehicleLocs[3],
      tripId: t.id,
      orderIds: [o.orderId],
    })
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    const tidy = await post(manager, `/delivery/trips/${t.id}/cancel`, {
      idempotencyKey: `cancel-355-trip-${run}`,
      reason: 'test tidy',
    })
    expect(tidy.status, JSON.stringify(tidy.body)).toBe(200)
  }, 120_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-354

  it('DOS-354: a loaded trip is not cancelled — it is checked in, its bill comes back to the dock and can be planned again', async () => {
    const day = istDay(1)
    const o = await order(retailerA, vG, 12, '354-loaded')
    const packed = await pack(o.orderId, '354-loaded')
    expect(packed.status, JSON.stringify(packed.body)).toBe(200)
    const invoiceId = packed.body.invoice?.id ?? ''
    const t = await trip('354-loaded', day, 0, 0, [
      { retailerId: retailerA, invoiceIds: [invoiceId] },
    ])
    const out = await loadOut(app, crew, { tripId: t.id, orderIds: [o.orderId], tag: `354-${run}` })
    expect(out.status).toBe('confirmed')
    expect(await orderState(o.orderId)).toBe('dispatched')

    const cancel = await post<Refusal>(manager, `/delivery/trips/${t.id}/cancel`, {
      idempotencyKey: `cancel-354-loaded-${run}`,
      reason: 'van broke down',
    })
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(409)
    expect(cancel.body.data?.code).toBe('trip_loaded')
    expect(cancel.body.message).toMatch(
      new RegExp(
        `^Trip TRIP-\\d+ has already been loaded \\(challan ${out.challanNo ?? ''}; bill\\(s\\) ${packed.body.invoice?.invoiceNo ?? ''}\\), so it is not cancelled: check the vehicle in instead\\.`,
      ),
    )
    expect(
      (await one<{ state: string }>(sql`select state::text as state from trips where id = ${t.id}`))
        .state,
    ).toBe('loading')

    // The check-in the refusal points to: the loaded trip that never left comes back.
    const back = await post<{ item: { state: string } }>(
      manager,
      `/delivery/trips/${t.id}/return`,
      {
        idempotencyKey: `return-354-${run}`,
      },
    )
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    expect(back.body.item.state).toBe('closing')
    expect(await orderState(o.orderId)).toBe('packed')
    const lot = await billLot(invoiceId)
    expect((await balance(lot.lotId, vehicleLocs[0] ?? '')).on_hand).toBe(12)
    const dockBefore = await balance(lot.lotId, dockId)
    const settled = await post(manager, `/delivery/trips/${t.id}/settle`, {
      idempotencyKey: `settle-354-${run}`,
      id: uuidv7(),
      handedOverCashPaise: 0,
      counted: [{ lotId: lot.lotId, countedPcs: 12 }],
    })
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    expect((await balance(lot.lotId, vehicleLocs[0] ?? '')).on_hand).toBe(0)
    expect(await balance(lot.lotId, dockId)).toEqual({
      on_hand: dockBefore.on_hand + 12,
      reserved: dockBefore.reserved + 12,
    })
    const board = await call<{ bills: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/trip-planning',
      { date: day, limit: 200 },
    )
    expect(board.body.bills.map((b) => b.invoiceId)).toContain(invoiceId)
  }, 180_000)

  it('DOS-354: a trip cancelled before its load-out frees every bill — its draft sheet goes with it — and a trip nothing was loaded onto is not checked in', async () => {
    const day = istDay(2)
    const o = await order(retailerB, vG, 12, '354-early')
    const packed = await pack(o.orderId, '354-early')
    const invoiceId = packed.body.invoice?.id ?? ''
    const t = await trip('354-early', day, 1, 1, [
      { retailerId: retailerB, invoiceIds: [invoiceId] },
    ])
    const draft = uuidv7()
    const drafted = await post(packer, '/warehouse/load-sheets', {
      idempotencyKey: `draft-354-${run}`,
      id: draft,
      toLocationId: vehicleLocs[1],
      tripId: t.id,
      orderIds: [o.orderId],
    })
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200)

    const checkIn = await post<Refusal>(manager, `/delivery/trips/${t.id}/return`, {
      idempotencyKey: `return-354-early-${run}`,
    })
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(409)
    expect(checkIn.body.data?.code).toBe('trip_not_loaded')
    expect(checkIn.body.message).toMatch(
      /has not been loaded, so there is nothing to check in: cancel it instead/,
    )

    const cancelled = await post(manager, `/delivery/trips/${t.id}/cancel`, {
      idempotencyKey: `cancel-354-early-${run}`,
      reason: 'driver off sick',
    })
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
    const sheet = await one<{ status: string }>(
      sql`select status::text as status from load_sheets where id = ${draft}`,
    )
    expect(sheet.status).toBe('cancelled')
    const board = await call<{ bills: { invoiceId: string }[] }>(
      app,
      manager,
      'GET',
      '/delivery/trip-planning',
      { date: day, limit: 200 },
    )
    expect(board.body.bills.map((b) => b.invoiceId)).toContain(invoiceId)
    // Free, it is loaded again only once it is planned on a trip again (QA DOS-354 verify).
    const fresh = await post<Refusal>(packer, '/warehouse/load-sheets', {
      idempotencyKey: `draft-354-fresh-${run}`,
      id: uuidv7(),
      toLocationId: vehicleLocs[1],
      orderIds: [o.orderId],
    })
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(409)
    expect(fresh.body.data?.code).toBe('bill_not_planned')
  }, 180_000)

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-358

  it('DOS-358: a van whose trip is out is not unloaded by hand; once the trip is checked in the godown counts it off', async () => {
    const day = istDay(3)
    const o = await order(retailerA, vG, 12, '358')
    const packed = await pack(o.orderId, '358')
    const invoiceId = packed.body.invoice?.id ?? ''
    const t = await trip('358', day, 2, 2, [{ retailerId: retailerA, invoiceIds: [invoiceId] }])
    await loadOut(app, crew, { tripId: t.id, orderIds: [o.orderId], tag: `358-${run}` })
    const lot = await billLot(invoiceId)
    const van = vehicleLocs[2] ?? ''

    const whileLoading = await post<Refusal>(packer, '/inventory/transfers', {
      idempotencyKey: `transfer-358-loading-${run}`,
      lotId: lot.lotId,
      fromLocationId: van,
      toLocationId: godownId,
      qtyPcs: 12,
    })
    expect(whileLoading.status, JSON.stringify(whileLoading.body)).toBe(409)
    expect(whileLoading.body.data?.code).toBe('vehicle_on_trip')
    expect(whileLoading.body.message).toMatch(
      /which is being loaded: nothing on the van is moved, adjusted or counted by hand until that trip is checked in/,
    )

    const left = await post(drivers[2] as Actor, `/delivery/trips/${t.id}/depart`, {
      idempotencyKey: `depart-358-${run}`,
    })
    expect(left.status, JSON.stringify(left.body)).toBe(200)
    const transfer = await post<Refusal>(packer, '/inventory/transfers', {
      idempotencyKey: `transfer-358-${run}`,
      lotId: lot.lotId,
      fromLocationId: van,
      toLocationId: godownId,
      qtyPcs: 12,
    })
    expect(transfer.status, JSON.stringify(transfer.body)).toBe(409)
    expect(transfer.body.data?.code).toBe('vehicle_on_trip')
    expect(transfer.body.message).toMatch(
      new RegExp(
        `^MH-05-ST-2${run.slice(-3)} is on trip TRIP-\\d+, which is out on the road: nothing on the van is moved, adjusted or counted by hand until that trip is checked in\\. Check the trip in first; the godown then counts the van off\\.$`,
      ),
    )
    const unload = await post<Refusal>(packer, '/delivery/van-returns/unload', {
      idempotencyKey: `unload-358-${run}`,
      id: uuidv7(),
      vehicleLocationId: van,
      lotId: lot.lotId,
      qtyPcs: 12,
    })
    expect(unload.status, JSON.stringify(unload.body)).toBe(409)
    expect(unload.body.data?.code).toBe('vehicle_on_trip')
    expect(unload.body.message).toBe(transfer.body.message)
    expect((await balance(lot.lotId, van)).on_hand).toBe(12)

    // The crew checks in; the godown then counts the bill's pieces off onto the dock.
    const back = await post(drivers[2] as Actor, `/delivery/trips/${t.id}/return`, {
      idempotencyKey: `return-358-${run}`,
    })
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    const counted = await post<{ dockPcs: number }>(packer, '/delivery/van-returns/unload', {
      idempotencyKey: `unload-358-after-${run}`,
      id: uuidv7(),
      vehicleLocationId: van,
      lotId: lot.lotId,
      qtyPcs: 12,
    })
    expect(counted.status, JSON.stringify(counted.body)).toBe(200)
    expect(counted.body.dockPcs).toBe(12)
  }, 180_000)

  // ---------------------------------------------------------------------------------------------------------------
  // The repair after the blind check (fix-states verify 1)

  /** Order, pick-free pack and bill of 12 pieces of `variantId`, with the bill's id and number. */
  async function billed(
    retailerId: string,
    variantId: string,
    tag: string,
  ): Promise<{ orderId: string; orderNo: string; invoiceId: string; invoiceNo: string }> {
    const o = await order(retailerId, variantId, 12, tag)
    const packed = await pack(o.orderId, tag)
    expect(packed.status, JSON.stringify(packed.body)).toBe(200)
    return {
      orderId: o.orderId,
      orderNo: o.orderNo,
      invoiceId: packed.body.invoice?.id ?? '',
      invoiceNo: packed.body.invoice?.invoiceNo ?? '',
    }
  }

  const sheetCount = async (): Promise<number> =>
    Number(
      (
        await one<{ n: number }>(
          sql`select count(*)::int as n from load_sheets where tenant_id = ${tenantId}`,
        )
      ).n,
    )

  it("DOS-354 (verify): a bill is loaded only onto the trip that carries it — no sheet of no trip, no bill of another trip — and a sheet that names none is its bills' trip", async () => {
    const day = istDay(5)
    const van = vehicleLocs[4] ?? ''
    const otherVan = vehicleLocs[5] ?? ''
    const r = await billed(retailerA, vG, 'v-r')
    const w = await billed(retailerA, vG, 'v-w')
    const u = await billed(retailerB, vG, 'v-u')
    const sheet = (tag: string, body: Record<string, unknown>) =>
      post<Refusal & { item: { id: string; tripId: string | null } }>(
        packer,
        '/warehouse/load-sheets',
        { idempotencyKey: `sheet-v-${tag}-${run}`, id: uuidv7(), ...body },
      )
    const before = await sheetCount()

    // V-E2: a sheet of no trip, for a bill planned on none, onto a van.
    const noTrip = await sheet('no-trip', { toLocationId: van, orderIds: [r.orderId] })
    expect(noTrip.status, JSON.stringify(noTrip.body)).toBe(409)
    expect(noTrip.body.data?.code).toBe('bill_not_planned')
    expect(noTrip.body.message).toBe(
      `${r.invoiceNo} · States Shop A ${run} is not planned on any trip. A bill is loaded only onto the trip that carries it, so that the trip's check-in brings back whatever does not reach the shop: plan it on a trip first (Trips), then put it on that trip's load sheet.`,
    )

    const t = await trip('v-t', day, 4, 4, [{ retailerId: retailerA, invoiceIds: [w.invoiceId] }])
    await trip('v-t2', day, 5, 5, [{ retailerId: retailerB, invoiceIds: [u.invoiceId] }])
    const tripNo = (
      await one<{ trip_no: string }>(sql`select trip_no from trips where id = ${t.id}`)
    ).trip_no

    // V-F2: the trip's own sheet carrying a bill planned on no trip, or on another trip.
    const unplanned = await sheet('f2-unplanned', {
      toLocationId: van,
      tripId: t.id,
      orderIds: [w.orderId, r.orderId],
    })
    expect(unplanned.status, JSON.stringify(unplanned.body)).toBe(409)
    expect(unplanned.body.data?.code).toBe('bill_not_planned')
    expect(unplanned.body.message).toContain(`plan it on trip ${tripNo} first`)
    const elsewhere = await sheet('f2-elsewhere', {
      toLocationId: van,
      tripId: t.id,
      orderIds: [w.orderId, u.orderId],
    })
    expect(elsewhere.status, JSON.stringify(elsewhere.body)).toBe(409)
    expect(elsewhere.body.data?.code).toBe('bill_not_on_trip')
    expect(elsewhere.body.message).toMatch(
      new RegExp(
        `^${u.invoiceNo} · States Shop B ${run} rides trip TRIP-\\d+, not trip ${tripNo}\\. A bill is loaded only onto the trip that carries it: take it off this sheet and load it on its own trip's sheet\\.$`,
      ),
    )
    // One sheet is one trip's load; and the trip's load goes on the trip's own van.
    const both = await sheet('both', { toLocationId: van, orderIds: [w.orderId, u.orderId] })
    expect(both.status, JSON.stringify(both.body)).toBe(409)
    expect(both.body.data?.code).toBe('bills_on_several_trips')
    const wrongVan = await sheet('wrong-van', {
      toLocationId: otherVan,
      tripId: t.id,
      orderIds: [w.orderId],
    })
    expect(wrongVan.status, JSON.stringify(wrongVan.body)).toBe(409)
    expect(wrongVan.body.data?.code).toBe('wrong_vehicle')
    expect(wrongVan.body.message).toBe(
      `Trip ${tripNo} goes out on MH-05-ST-4${run.slice(-3)}, and this sheet loads MH-05-ST-5${run.slice(-3)}. Build the sheet for the trip's own vehicle, so the crew finds its load on the van it drives.`,
    )
    expect(await sheetCount(), 'no refused sheet was written').toBe(before)

    // The sheet built for the vehicle with no trip on it (DOS-137) is its bill's trip's sheet, and goes out.
    const linked = await sheet('linked', { toLocationId: van, orderIds: [w.orderId] })
    expect(linked.status, JSON.stringify(linked.body)).toBe(200)
    expect(linked.body.item.tripId).toBe(t.id)
    const confirmed = await post<Refusal>(
      manager,
      `/warehouse/load-sheets/${linked.body.item.id}/confirm`,
      { idempotencyKey: `confirm-v-linked-${run}`, countedPackages: 1, challanId: uuidv7() },
    )
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(await orderState(w.orderId)).toBe('dispatched')

    // Refusals on this road name documents, never a row id.
    const sheetCancel = await post<Refusal>(
      manager,
      `/warehouse/load-sheets/${linked.body.item.id}/cancel`,
      { idempotencyKey: `cancel-v-linked-${run}`, reason: 'wrong van' },
    )
    expect(sheetCancel.status).toBe(409)
    expect(sheetCancel.body.message).toMatch(
      new RegExp(`^the load sheet for MH-05-ST-4${run.slice(-3)} on \\d+ \\w+ is confirmed;`),
    )
    const billCancel = await post<Refusal>(manager, `/invoices/${w.invoiceId}/cancel`, {
      idempotencyKey: `cancel-v-bill-${run}`,
      id: w.invoiceId,
      reason: 'shop closed',
    })
    expect(billCancel.status).toBe(409)
    expect(billCancel.body.message).toBe(
      `order ${w.orderNo} is dispatched; after dispatch the only correction is a credit note`,
    )

    // A sheet drafted before the rule — no trip, a bill planned on none — is refused at the gate.
    const legacy = uuidv7()
    await db.insert(loadSheets).values({
      id: legacy,
      tenantId,
      fromLocationId: godownId,
      toLocationId: otherVan,
      orderIds: [r.orderId],
      expectedPackages: 1,
      loadValuePaise: 0,
    })
    const gate = await post<Refusal>(manager, `/warehouse/load-sheets/${legacy}/confirm`, {
      idempotencyKey: `confirm-v-legacy-${run}`,
      countedPackages: 1,
      challanId: uuidv7(),
    })
    expect(gate.status, JSON.stringify(gate.body)).toBe(409)
    expect(gate.body.data?.code).toBe('bill_not_planned')
    const challans = await one<{ n: number }>(
      sql`select count(*)::int as n from delivery_challans where load_sheet_id = ${legacy}`,
    )
    expect(Number(challans.n)).toBe(0)
    expect(await orderState(r.orderId)).toBe('packed')
  }, 180_000)

  it('DOS-354 (verify): a trip does not leave with a bill counted out on another load — it is checked in, and the bill comes back', async () => {
    const q = await billed(retailerA, vG, 'f1-q')
    const t = await trip('f1', istDay(6), 6, 6, [
      { retailerId: retailerA, invoiceIds: [q.invoiceId] },
    ])
    const out = await loadOut(app, crew, { tripId: t.id, orderIds: [q.orderId], tag: `f1-${run}` })
    // The load of old: a sheet built for the vehicle with no trip on it (DOS-137), written before a sheet took
    // only its own trip's bills. The bill is dispatched, and no sheet of this trip carries it.
    await db.execute(sql`update load_sheets set trip_id = null where id = ${out.sheetId}`)
    const tripNo = (
      await one<{ trip_no: string }>(sql`select trip_no from trips where id = ${t.id}`)
    ).trip_no

    const depart = await post<Refusal>(drivers[6] as Actor, `/delivery/trips/${t.id}/depart`, {
      idempotencyKey: `depart-f1-${run}`,
    })
    expect(depart.status, JSON.stringify(depart.body)).toBe(409)
    expect(depart.body.data?.code).toBe('bill_not_on_this_load')
    expect(depart.body.message).toBe(
      `${q.invoiceNo} was counted out at the godown on another load, not on trip ${tripNo}'s own load sheet, so its pieces are not on MH-05-ST-6${run.slice(-3)}. A trip leaves only with the bills loaded for it: check trip ${tripNo} in — the bill comes back undelivered — and load it again from the dock or the godown.`,
    )
    expect(
      (await one<{ state: string }>(sql`select state::text as state from trips where id = ${t.id}`))
        .state,
    ).toBe('loading')

    // The way out the sentence names.
    const back = await post<{ item: { state: string } }>(
      manager,
      `/delivery/trips/${t.id}/return`,
      {
        idempotencyKey: `return-f1-${run}`,
      },
    )
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    expect(back.body.item.state).toBe('closing')
    expect(await orderState(q.orderId)).toBe('packed')
  }, 180_000)

  it('DOS-351 (verify): a parked pack billed with a date before its batch expired is not billed today', async () => {
    const q1 = lots.Q1 ?? ''
    const o = await order(retailerB, vQ, 12, '351v-parked')
    const parked = await pack(o.orderId, '351v-parked', false)
    expect(parked.status, JSON.stringify(parked.body)).toBe(200)
    // Packed three days ago, the batch passes its date yesterday while the pack waits for its bill, and the desk
    // dates the bill the day before that (the QA lane's INV/9017).
    await db.execute(
      sql`update pack_confirmations set packed_at = packed_at - interval '3 days' where id = ${parked.body.item.id}`,
    )
    await db.execute(sql`update stock_lots set expiry_date = ${istDay(-1)} where id = ${q1}`)
    const backdated = await post<Refusal>(
      manager,
      `/warehouse/packs/${parked.body.item.id}/invoice`,
      { idempotencyKey: `bill-351v-parked-${run}`, id: uuidv7(), invoiceDate: istDay(-2) },
    )
    expect(backdated.status, JSON.stringify(backdated.body)).toBe(409)
    expect(backdated.body.data?.code).toBe('batch_expired')
    expect(backdated.body.message).toBe(
      `${o.orderNo} cannot be billed: 12 pc of it are Haldi Powder 100 g batch Q1-${run}, which expired on ${expiryPhrase(istDay(-1))}. Expired goods are never billed or sent — on the billing desk (Packed, not billed) press Unpack, and the order goes back to be picked from an in-date batch, or Cancel the order: either way its pieces come off the dock and the expired ones go into the expiry bin.`,
    )
  }, 180_000)

  it('DOS-351 (verify): a van sale dated back to before its batch expired sells nothing — nothing leaves the van', async () => {
    // Q1 expired yesterday (the test above); the QA lane's INV/9023 put such a batch on a van and dated the sale back.
    const q1 = lots.Q1 ?? ''
    await db.execute(sql`update stock_lots set expiry_date = ${istDay(-1)} where id = ${q1}`)
    const t = await trip('351v-van', istDay(7), 7, 7, [], { vanSales: true })
    const departed = await post(drivers[7] as Actor, `/delivery/trips/${t.id}/depart`, {
      idempotencyKey: `depart-351v-${run}`,
    })
    expect(departed.status, JSON.stringify(departed.body)).toBe(200)
    const van = vehicleLocs[7] ?? ''
    await asOwner((tx) =>
      app.get(InventoryService).post(tx, [
        {
          lotId: q1,
          locationId: godownId,
          qtyDelta: -10,
          reason: 'transfer_out',
          refType: 'transfer',
          idempotencyKey: `van-351v-${run}:out`,
        },
        {
          lotId: q1,
          locationId: van,
          qtyDelta: 10,
          reason: 'transfer_in',
          refType: 'transfer',
          idempotencyKey: `van-351v-${run}:in`,
        },
      ]),
    )
    const invoiceId = uuidv7()
    const sale = await post<Refusal>(drivers[7] as Actor, '/delivery/van-sales', {
      idempotencyKey: `sale-351v-${run}`,
      id: uuidv7(),
      tripId: t.id,
      retailerId: retailerA,
      invoiceId,
      deliveryId: uuidv7(),
      invoiceDate: istDay(-2),
      lines: [{ id: uuidv7(), variantId: vQ, enteredQty: 10, enteredUnit: 'piece' }],
    })
    expect(sale.status, JSON.stringify(sale.body)).toBeGreaterThanOrEqual(400)
    expect(sale.status, JSON.stringify(sale.body)).toBeLessThan(500)
    const bills = await one<{ n: number }>(
      sql`select count(*)::int as n from invoices where id = ${invoiceId}`,
    )
    expect(Number(bills.n)).toBe(0)
    expect((await balance(q1, van)).on_hand).toBe(10)
  }, 180_000)

  it('DOS-358 (verify): nothing on a van is adjusted or counted by hand while its trip is out, nor moved by hand once it is checked in; settled, it is an ordinary place again', async () => {
    const g1 = lots.G1 ?? ''
    const van = vehicleLocs[8] ?? ''
    const plate = `MH-05-ST-8${run.slice(-3)}`
    const w = await billed(retailerA, vG, '358v')
    // A count of the van opened before the trip, as the godown may: it names the batch the van will carry.
    const countId = uuidv7()
    const opened = await post(packer, '/inventory/cycle-counts', {
      idempotencyKey: `count-358v-open-${run}`,
      id: countId,
      locationId: van,
      lotIds: [g1],
    })
    expect(opened.status, JSON.stringify(opened.body)).toBe(200)
    const t = await trip('358v', istDay(8), 8, 8, [
      { retailerId: retailerA, invoiceIds: [w.invoiceId] },
    ])
    await loadOut(app, crew, { tripId: t.id, orderIds: [w.orderId], tag: `358v-${run}` })
    const adjust = (actor: Actor, tag: string, qtyDelta: number, reason: string) =>
      post<Refusal>(actor, '/inventory/adjustments', {
        idempotencyKey: `adjust-358v-${tag}-${run}`,
        lotId: g1,
        locationId: van,
        qtyDelta,
        reason,
      })

    const whileLoading = await adjust(packer, 'loading', -1, 'damage')
    expect(whileLoading.status, JSON.stringify(whileLoading.body)).toBe(409)
    expect(whileLoading.body.data?.code).toBe('vehicle_on_trip')

    const left = await post(drivers[8] as Actor, `/delivery/trips/${t.id}/depart`, {
      idempotencyKey: `depart-358v-${run}`,
    })
    expect(left.status, JSON.stringify(left.body)).toBe(200)
    // The QA lane's V-S6f: a damage of one, and the owner's own correction, while the trip is on the road.
    for (const [actor, tag, qty, reason] of [
      [packer, 'damage', -1, 'damage'],
      [owner, 'owner-add', 1, 'adjustment'],
    ] as const) {
      const refused = await adjust(actor, tag, qty, reason)
      expect(refused.status, JSON.stringify(refused.body)).toBe(409)
      expect(refused.body.data?.code).toBe('vehicle_on_trip')
      expect(refused.body.message).toMatch(
        new RegExp(
          `^${plate} is on trip TRIP-\\d+, which is out on the road: nothing on the van is moved, adjusted or counted by hand until that trip is checked in\\.`,
        ),
      )
    }
    const openOnRoad = await post<Refusal>(packer, '/inventory/cycle-counts', {
      idempotencyKey: `count-358v-road-${run}`,
      id: uuidv7(),
      locationId: van,
    })
    expect(openOnRoad.status, JSON.stringify(openOnRoad.body)).toBe(409)
    expect(openOnRoad.body.data?.code).toBe('vehicle_on_trip')
    // The count opened before it left takes its numbers, but is not posted while the trip is out.
    const counted = await post(packer, `/inventory/cycle-counts/${countId}/count`, {
      idempotencyKey: `count-358v-22-${run}`,
      id: countId,
      lines: [{ lotId: g1, countedPcs: 22 }],
    })
    expect(counted.status, JSON.stringify(counted.body)).toBe(200)
    const posted = await post<Refusal>(manager, `/inventory/cycle-counts/${countId}/post`, {
      idempotencyKey: `count-358v-post-${run}`,
      id: countId,
    })
    expect(posted.status, JSON.stringify(posted.body)).toBe(409)
    expect(posted.body.data?.code).toBe('vehicle_on_trip')
    expect(await balance(g1, van)).toEqual({ on_hand: 12, reserved: 0 })

    // Checked in and not settled: the van is counted off on the van check-in, never moved by hand.
    const back = await post(drivers[8] as Actor, `/delivery/trips/${t.id}/return`, {
      idempotencyKey: `return-358v-${run}`,
    })
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    const handMove = await post<Refusal>(packer, '/inventory/transfers', {
      idempotencyKey: `transfer-358v-closing-${run}`,
      lotId: g1,
      fromLocationId: van,
      toLocationId: godownId,
      qtyPcs: 12,
    })
    expect(handMove.status, JSON.stringify(handMove.body)).toBe(409)
    expect(handMove.body.data?.code).toBe('vehicle_on_trip')
    expect(handMove.body.message).toMatch(
      new RegExp(
        `^${plate} is on trip TRIP-\\d+, which has been checked in and is not settled yet: the godown counts the van off on Van check-in, which puts a returned bill's pieces on the dock for it\\. Nothing on the van is moved, adjusted or counted by hand until that trip is settled\\.$`,
      ),
    )
    expect((await adjust(owner, 'closing', 1, 'adjustment')).status).toBe(409)
    const unloaded = await post<{ dockPcs: number }>(packer, '/delivery/van-returns/unload', {
      idempotencyKey: `unload-358v-${run}`,
      id: uuidv7(),
      vehicleLocationId: van,
      lotId: g1,
      qtyPcs: 12,
    })
    expect(unloaded.status, JSON.stringify(unloaded.body)).toBe(200)
    expect(unloaded.body.dockPcs).toBe(12)
    const settled = await post(manager, `/delivery/trips/${t.id}/settle`, {
      idempotencyKey: `settle-358v-${run}`,
      id: uuidv7(),
      handedOverCashPaise: 0,
      counted: [{ lotId: g1, countedPcs: 0 }],
    })
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)

    // Settled: the van is an ordinary place again.
    expect((await adjust(owner, 'settled-add', 1, 'adjustment')).status).toBe(200)
    expect((await adjust(owner, 'settled-back', -1, 'adjustment')).status).toBe(200)
  }, 180_000)
})

/** `23 Sep 2026`, the way the refusals print an expiry date. */
function expiryPhrase(isoDate: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${String(Number(isoDate.slice(8, 10)))} ${months[Number(isoDate.slice(5, 7)) - 1] ?? ''} ${isoDate.slice(0, 4)}`
}
