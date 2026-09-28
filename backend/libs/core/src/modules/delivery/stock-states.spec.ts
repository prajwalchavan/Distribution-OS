import { eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
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
  const run = String(Date.now()).slice(-8)
  const hsn = `7${run}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const driverIds = [uuidv7(), uuidv7(), uuidv7(), uuidv7()]

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
  /** Cookies (DOS-351), whitener (DOS-353), tooth brush (the rest), masala (the parked pack of DOS-351). */
  const vB = uuidv7()
  const vE = uuidv7()
  const vG = uuidv7()
  const vP = uuidv7()
  const vehicleIds = [uuidv7(), uuidv7(), uuidv7()]
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
      `Choco Chip Cookies 120 g batch B-EXP-${run} expired on ${expiryPhrase(istDay(-1))}. Expired goods are never sold — set it aside for the expiry bin and pick an in-date batch.`,
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
      `${o.orderNo} cannot be packed: 12 pc of it are Choco Chip Cookies 120 g batch B-EXP-${run}, which expired on ${expiryPhrase(istDay(-1))}. Expired goods are never billed or sent — set those pieces aside for the expiry bin and record the pick again from an in-date batch.`,
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
    const again = await post<{ item: { id: string } }>(packer, '/warehouse/load-sheets', {
      idempotencyKey: `sheet-355-again-${run}`,
      id: uuidv7(),
      toLocationId: vehicleLocs[2],
      orderIds: [o.orderId],
    })
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    const tidy = await post(manager, `/warehouse/load-sheets/${again.body.item.id}/cancel`, {
      idempotencyKey: `cancel-355-again-${run}`,
      reason: 'test tidy',
    })
    expect(tidy.status).toBe(200)
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
    const fresh = await post<{ item: { id: string } }>(packer, '/warehouse/load-sheets', {
      idempotencyKey: `draft-354-fresh-${run}`,
      id: uuidv7(),
      toLocationId: vehicleLocs[1],
      orderIds: [o.orderId],
    })
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(200)
    expect(
      (
        await post(manager, `/warehouse/load-sheets/${fresh.body.item.id}/cancel`, {
          idempotencyKey: `cancel-354-fresh-${run}`,
          reason: 'test tidy',
        })
      ).status,
    ).toBe(200)
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
      /which is being loaded: nothing comes off the van by hand/,
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
        `^MH-05-ST-2${run.slice(-3)} is on trip TRIP-\\d+, which is out on the road: nothing comes off the van by hand until that trip is checked in\\. Check the trip in first; the godown then counts the van off\\.$`,
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
