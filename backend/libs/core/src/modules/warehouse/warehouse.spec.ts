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
  vehicles,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { BillingModule } from '../billing/index.js'
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface PickLineBody {
  id: string
  orderId: string
  orderLineId: string
  lotId: string | null
  suggestedLotId: string | null
  batchNo: string | null
  expiryDate: string | null
  caseSize: number | null
  requestedQtyPcs: number
  pickedQtyPcs: number
  freeQtyPcs: number
  shortReason: string | null
  fefoOverride: boolean
}
interface PicklistBody {
  id: string
  picklistNo: string | null
  status: string
  locationId: string
  pickDate: string
  orderCount: number
  requestedQtyPcs: number
  pickedQtyPcs: number
  orders: { orderId: string; state: string }[]
  lines: PickLineBody[]
  consolidated: {
    variantId: string
    requestedQtyPcs: number
    cases: number
    loosePcs: number
    lots: { lotId: string; qtyPcs: number; fefoWarning: boolean; cases: number }[]
  }[]
}
interface PackBody {
  item: {
    id: string
    orderId: string
    packages: number
    invoiceId: string | null
    shortPacked: boolean
  }
  lines: {
    orderLineId: string
    packedQtyPcs: number
    shortQtyPcs: number
    lots: { lotId: string; qtyPcs: number }[]
  }[]
  invoice: { id: string; invoiceNo: string | null; totalPaise: number } | null
}
interface LoadSheetBody {
  id: string
  status: string
  expectedPackages: number
  countedPackages: number | null
  loadValuePaise: number
  ewbRequired: boolean
  ewbNo: string | null
  challanNo: string | null
  pinVerifiedBy: string | null
  approvedBy: string | null
  approvedAt: string | null
  varianceNote: string | null
  vehicleRegNo: string | null
  orders: { orderId: string; invoiceNo: string | null; packages: number }[]
  lots: { lotId: string; qtyPcs: number; source: string; cases: number }[]
  challan: ChallanBody | null
}
interface ChallanBody {
  id: string
  challanNo: string | null
  seriesCode: string
  fy: string
  vehicleNo: string | null
  valuePaise: number
  gstPaise: number
  ewbNo: string | null
  seller: { displayName: string }
  lines: {
    variantId: string
    lotId: string
    qtyPcs: number
    taxableValuePaise: number
    gstBps: number
  }[]
}
type LedgerRow = { reason: string; qty_delta: number; lot_id: string; location_id: string }

describeDb('warehouse (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const hsn = `8${run.slice(-6)}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const driverId = uuidv7()
  const shopUserId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }

  const ctxOf = (actorId: string, actorRole: TenantContext['actorRole']): TenantContext => ({
    tenantId,
    actorId,
    actorRole,
  })
  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) => as(ctxOf(ownerId, 'owner'), fn)

  const shopMh = uuidv7()
  const variantA = uuidv7()
  const variantB = uuidv7()
  let godown = ''
  let van = ''
  let lotEarly = ''
  let lotLate = ''
  let lotB = ''
  let app: NestFastifyApplication

  const ledgerFor = async (refId: string): Promise<LedgerRow[]> =>
    (
      await db.execute(
        sql`select reason::text as reason, qty_delta, lot_id, location_id from stock_ledger
             where tenant_id = ${tenantId} and ref_id = ${refId} order by id`,
      )
    ).rows as LedgerRow[]

  const balanceOf = async (lotId: string, locationId: string) =>
    (
      (
        await db.execute(
          sql`select on_hand, reserved from stock_balances
               where tenant_id = ${tenantId} and lot_id = ${lotId} and location_id = ${locationId}`,
        )
      ).rows as { on_hand: number; reserved: number }[]
    )[0] ?? { on_hand: 0, reserved: 0 }

  const outboxTypes = async (aggregateId: string): Promise<string[]> =>
    (
      (
        await db.execute(
          sql`select event_type from outbox_events
               where tenant_id = ${tenantId} and aggregate_id = ${aggregateId} order by id`,
        )
      ).rows as { event_type: string }[]
    ).map((r) => r.event_type)

  /** An order confirmed through the real aggregate, so its lines are priced and its stock is held. */
  async function placeOrder(
    lines: { variantId: string; cases: number }[],
    tag: string,
    submit = true,
  ): Promise<string> {
    const id = uuidv7()
    const created = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `order-${tag}-${run}`,
      id,
      retailerId: shopMh,
      source: 'salesperson',
      lines: lines.map((l) => ({
        id: uuidv7(),
        variantId: l.variantId,
        enteredQty: l.cases,
        enteredUnit: 'case',
      })),
    })
    expect(created.status, `order ${tag}`).toBe(200)
    if (!submit) return id
    const submitted = await call<{ item: { state: string } }>(
      app,
      rep,
      'POST',
      `/orders/${id}/submit`,
      { idempotencyKey: `submit-${tag}-${run}` },
    )
    expect(submitted.status, `submit ${tag}`).toBe(200)
    expect(submitted.body.item.state, `submit ${tag}`).toBe('confirmed')
    return id
  }

  const orderState = async (orderId: string): Promise<string> =>
    (await call<{ item: { state: string } }>(app, manager, 'GET', `/orders/${orderId}`)).body.item
      .state

  async function wave(orderIds: string[], tag: string) {
    const id = uuidv7()
    const res = await call<{ item: PicklistBody }>(app, packer, 'POST', '/warehouse/picklists', {
      idempotencyKey: `wave-${tag}-${run}`,
      id,
      orderIds,
    })
    return { id, res }
  }

  async function packOrder(orderId: string, tag: string, actor: Actor = packer, packages = 2) {
    const id = uuidv7()
    const res = await call<PackBody>(app, actor, 'POST', `/warehouse/orders/${orderId}/pack`, {
      idempotencyKey: `pack-${tag}-${run}`,
      id,
      packages,
    })
    return { id, res }
  }

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `wh-${run}`, legalName: 'Godown Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91961${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91961${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91961${run}3`, name: 'Accountant' },
      { id: packerId, phone: `+91961${run}4`, name: 'Packer' },
      { id: repId, phone: `+91961${run}5`, name: 'Rep' },
      { id: driverId, phone: `+91961${run}6`, name: 'Driver' },
      { id: shopUserId, phone: `+91961${run}7`, name: 'Shopkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    await db
      .insert(tenantSettings)
      .values({ tenantId, key: TENANT_SETTING_KEYS.brandingDisplayName, value: 'Godown Traders' })
      .onConflictDoNothing()

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker wh ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Chips', category: 'namkeen' })
    await db.insert(productVariants).values([
      {
        id: variantA,
        productId,
        name: 'Chips 45 g',
        netQty: 45,
        netUnit: 'g',
        defaultCaseSize: 24,
        hsnCode: hsn,
        mrpPaise: 1000,
      },
      {
        id: variantB,
        productId,
        name: 'Chips 90 g',
        netQty: 90,
        netUnit: 'g',
        defaultCaseSize: 24,
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

    const identityId = uuidv7()
    await db.insert(retailerIdentities).values({
      id: identityId,
      phone: `+91962${run}1`,
      userId: shopUserId,
      shopName: `Godown Shop ${run}`,
    })
    await db.insert(retailers).values({
      id: shopMh,
      tenantId,
      identityId,
      code: `WH-${run}`,
      name: `Godown Shop ${run}`,
      phone: `+91962${run}1`,
      stateCode: '27',
      gstRegType: 'regular',
      gstin: '27AAXPT9021Q1ZQ',
      creditDays: 15,
    })
    await db.insert(retailerLinks).values({
      id: uuidv7(),
      tenantId,
      identityId,
      retailerId: shopMh,
      userId: shopUserId,
      linkedBy: 'rep_onboarding',
      status: 'active',
    })

    const priceListId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    await db.insert(priceListItems).values([
      { id: uuidv7(), tenantId, priceListId, variantId: variantA, ratePaise: 1000 },
      { id: uuidv7(), tenantId, priceListId, variantId: variantB, ratePaise: 2500 },
    ])

    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    van = uuidv7()
    const vehicleId = uuidv7()
    await db
      .insert(locations)
      .values({ id: van, tenantId, kind: 'vehicle', name: `Tempo ${run}`, vehicleId })
    await db.insert(vehicles).values({
      id: vehicleId,
      tenantId,
      regNo: `MH-05-WH-${run.slice(-4)}`,
      name: 'Tempo 1',
      locationId: van,
    })

    app = await bootTestApp([
      WarehouseModule,
      BillingModule,
      OrdersModule,
      InventoryModule,
      ReceivablesModule,
      SyncModule,
    ])

    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      // Two batches of the same product: the EARLIER expiry is what FEFO must propose.
      const early = await inventory.findOrCreateLot(tx, {
        variantId: variantA,
        batchNo: `EARLY-${run}`,
        mrpPaise: 1000,
        expiryDate: '2027-01-31',
      })
      const late = await inventory.findOrCreateLot(tx, {
        variantId: variantA,
        batchNo: `LATE-${run}`,
        mrpPaise: 1000,
        expiryDate: '2028-12-31',
      })
      const b = await inventory.findOrCreateLot(tx, {
        variantId: variantB,
        batchNo: `B-${run}`,
        mrpPaise: 2000,
        expiryDate: '2029-06-30',
      })
      lotEarly = early.lot.id
      lotLate = late.lot.id
      lotB = b.lot.id
      // The lot's OWN case size differs from the sell-side pack (docs/17 A2): a promo batch of 6.
      await tx.execute(sql`update stock_lots set case_size = 6 where id = ${lotEarly}`)
      await inventory.post(tx, [
        {
          lotId: lotEarly,
          locationId: godown,
          qtyDelta: 240,
          reason: 'opening',
          idempotencyKey: `open-${run}-early`,
        },
        {
          lotId: lotLate,
          locationId: godown,
          qtyDelta: 5_000,
          reason: 'opening',
          idempotencyKey: `open-${run}-late`,
        },
        {
          lotId: lotB,
          locationId: godown,
          qtyDelta: 50_000,
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

  let queueOrderId = ''
  let draftOrderId = ''
  let picklistId = ''
  let pickRowId = ''
  let orderLineId = ''

  it('queues confirmed orders with quantities and no money, and hides a draft', async () => {
    queueOrderId = await placeOrder([{ variantId: variantA, cases: 2 }], 'queue')
    draftOrderId = await placeOrder([{ variantId: variantA, cases: 1 }], 'draft', false)

    const res = await call<{
      items: { orderId: string; totalQtyPcs: number; picklistId: string | null; state: string }[]
    }>(app, packer, 'GET', '/warehouse/queue', { limit: 50 })
    expect(res.status).toBe(200)
    const mine = res.body.items.find((i) => i.orderId === queueOrderId)
    expect(mine).toBeDefined()
    expect(mine?.totalQtyPcs).toBe(24)
    expect(mine?.picklistId).toBeNull()
    expect(mine?.state).toBe('confirmed')
    expect(res.body.items.map((i) => i.orderId)).not.toContain(draftOrderId)
    // A PICKER MUST NOT BE ABLE TO BACK A RATE OFF A SCREEN (ADR 0002, warehouse §4.9).
    expect(JSON.stringify(res.body)).not.toMatch(/ratePaise|costPaise|totalPaise|marginBps/)
  })

  it('waves the orders into a PICK-numbered sheet with FEFO lots and leaves the order confirmed', async () => {
    const { id, res } = await wave([queueOrderId], 'first')
    picklistId = id
    expect(res.status).toBe(200)
    const sheet = res.body.item
    expect(sheet.picklistNo).toBe('PICK-0001')
    expect(sheet.status).toBe('open')
    expect(sheet.locationId).toBe(godown)
    expect(sheet.orderCount).toBe(1)
    expect(sheet.requestedQtyPcs).toBe(24)

    // FEFO: the earliest-expiry batch first, and it only holds 240 pcs so the whole ask fits in it
    expect(sheet.lines).toHaveLength(1)
    const line = sheet.lines[0]
    expect(line?.suggestedLotId).toBe(lotEarly)
    expect(line?.lotId).toBe(lotEarly)
    expect(line?.requestedQtyPcs).toBe(24)
    expect(line?.batchNo).toBe(`EARLY-${run}`)
    // the LOT's own case size (6), not the sell-side pack (12) — docs/17 A2
    expect(line?.caseSize).toBe(6)
    pickRowId = line?.id ?? ''
    orderLineId = line?.orderLineId ?? ''

    const consolidated = sheet.consolidated[0]
    expect(consolidated?.variantId).toBe(variantA)
    expect(consolidated?.cases).toBe(2) // 24 pcs in the SELL pack of 12
    expect(consolidated?.lots[0]?.cases).toBe(4) // …but 4 cases of the lot's own 6

    // THE ORDER STATE IS NOT TOUCHED AT CREATE, so the shop can still cancel (warehouse §4.5)
    expect(await orderState(queueOrderId)).toBe('confirmed')
    expect(await ledgerFor(picklistId)).toHaveLength(0)
  })

  it('replays create with the same key instead of drafting a second sheet', async () => {
    const replay = await call<{ item: PicklistBody }>(app, packer, 'POST', '/warehouse/picklists', {
      idempotencyKey: `wave-first-${run}`,
      id: picklistId,
      orderIds: [queueOrderId],
    })
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(picklistId)
    const rows = (
      await db.execute(sql`select count(*)::int as n from picklists where tenant_id = ${tenantId}`)
    ).rows as { n: number }[]
    expect(rows[0]?.n).toBe(1)
  })

  it('refuses an order that is not confirmed and one already on a live sheet', async () => {
    const notConfirmed = await wave([draftOrderId], 'draft')
    expect(notConfirmed.res.status).toBe(409)
    const again = await wave([queueOrderId], 'again')
    expect(again.res.status).toBe(409)
  })

  it('start moves every order to picking and writes the transition and the event', async () => {
    const started = await call<{ item: PicklistBody }>(
      app,
      packer,
      'POST',
      `/warehouse/picklists/${picklistId}/start`,
      { idempotencyKey: `start-${run}`, assignedTo: packerId },
    )
    expect(started.status).toBe(200)
    expect(started.body.item.status).toBe('picking')
    expect(await orderState(queueOrderId)).toBe('picking')
    const transitions = (
      await db.execute(
        sql`select event from order_state_transitions
             where tenant_id = ${tenantId} and order_id = ${queueOrderId} order by id`,
      )
    ).rows as { event: string }[]
    expect(transitions.map((t) => t.event)).toContain('start_picking')
    expect(await outboxTypes(queueOrderId)).toContain('OrderPicking')
    expect(await outboxTypes(picklistId)).toEqual(['PicklistStarted'])
  })

  it('records a later-expiry batch as a warning and writes no ledger row', async () => {
    const before = await ledgerFor(queueOrderId)
    const picked = await call<{ item: PicklistBody; warnings: { code: string }[] }>(
      app,
      packer,
      'POST',
      `/warehouse/picklists/${picklistId}/pick`,
      {
        idempotencyKey: `pick-override-${run}`,
        lines: [{ id: pickRowId, orderLineId, lotId: lotLate, pickedQtyPcs: 24 }],
      },
    )
    expect(picked.status).toBe(200)
    expect(picked.body.warnings.map((w) => w.code)).toContain('fefo_override')
    const line = picked.body.item.lines.find((l) => l.id === pickRowId)
    expect(line?.fefoOverride).toBe(true)
    expect(line?.lotId).toBe(lotLate)
    expect(picked.body.item.status).toBe('picked')
    // NOTHING LEAVES STOCK BEFORE PACK (warehouse §4.4)
    expect(await ledgerFor(queueOrderId)).toEqual(before)
  })

  it('refuses more pieces than the sheet asked for', async () => {
    const tooMany = await call<{ message: string }>(
      app,
      packer,
      'POST',
      `/warehouse/picklists/${picklistId}/pick`,
      {
        idempotencyKey: `pick-toomany-${run}`,
        lines: [{ id: pickRowId, orderLineId, lotId: lotLate, pickedQtyPcs: 25 }],
      },
    )
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.message).toMatch(/asks for 24/)
  })

  it('splits one order line across two lots', async () => {
    const splitId = uuidv7()
    const split = await call<{ item: PicklistBody }>(
      app,
      packer,
      'POST',
      `/warehouse/picklists/${picklistId}/pick`,
      {
        idempotencyKey: `pick-split-${run}`,
        lines: [
          { id: pickRowId, orderLineId, lotId: lotLate, pickedQtyPcs: 18 },
          { id: splitId, orderLineId, lotId: lotEarly, pickedQtyPcs: 6 },
        ],
      },
    )
    expect(split.status).toBe(200)
    const rows = split.body.item.lines.filter((l) => l.orderLineId === orderLineId)
    expect(rows).toHaveLength(2)
    expect(rows.reduce((n, r) => n + r.pickedQtyPcs, 0)).toBe(24)
    // the ask still lives on the wave's own row; the split row asks for nothing of its own
    expect(rows.reduce((n, r) => n + r.requestedQtyPcs, 0)).toBe(24)
  })

  // ---------------------------------------------------------------------------------------------------------------

  let packId = ''
  let invoiceId = ''

  it('packs: the sale rows, the holds, the order state and the invoice all move once', async () => {
    const { id, res } = await packOrder(queueOrderId, 'first')
    packId = id
    expect(res.status).toBe(200)
    expect(res.body.item.orderId).toBe(queueOrderId)
    expect(res.body.item.shortPacked).toBe(false)
    expect(res.body.invoice).not.toBeNull()
    invoiceId = res.body.invoice?.id ?? ''

    // ONE `sale` ledger row per line-and-lot, and nothing more
    const ledger = await ledgerFor(queueOrderId)
    expect(ledger.filter((r) => r.reason === 'sale')).toHaveLength(2)
    expect(ledger.every((r) => r.qty_delta < 0 && r.location_id === godown)).toBe(true)
    const ledgerByLot = new Map(ledger.map((r) => [r.lot_id, -r.qty_delta]))
    expect(ledgerByLot.get(lotLate)).toBe(18)
    expect(ledgerByLot.get(lotEarly)).toBe(6)

    // …AND THE INVOICE LINES EQUAL THOSE LEDGER ROWS, to the piece
    const bill = await call<{
      item: { lines: { lotId: string | null; qtyPcs: number; freeQtyPcs: number }[] }
    }>(app, manager, 'GET', `/invoices/${invoiceId}`)
    expect(bill.status).toBe(200)
    const billed = new Map(
      bill.body.item.lines.map((l) => [l.lotId ?? '', l.qtyPcs + l.freeQtyPcs]),
    )
    expect(billed.get(lotLate)).toBe(ledgerByLot.get(lotLate))
    expect(billed.get(lotEarly)).toBe(ledgerByLot.get(lotEarly))

    // holds closed, balances moved, order packed
    expect((await balanceOf(lotEarly, godown)).reserved).toBe(0)
    expect((await balanceOf(lotLate, godown)).reserved).toBe(0)
    expect((await balanceOf(lotEarly, godown)).on_hand).toBe(234)
    expect(await orderState(queueOrderId)).toBe('packed')
    expect(await outboxTypes(queueOrderId)).toContain('OrderPacked')
    const picked = (
      await db.execute(sql`select picked_qty_pcs from sales_order_lines where id = ${orderLineId}`)
    ).rows as { picked_qty_pcs: number }[]
    expect(picked[0]?.picked_qty_pcs).toBe(24)
  })

  it('replays a pack instead of issuing a second invoice number', async () => {
    const before = (await ledgerFor(queueOrderId)).length
    const replay = await call<PackBody>(
      app,
      packer,
      'POST',
      `/warehouse/orders/${queueOrderId}/pack`,
      { idempotencyKey: `pack-first-${run}`, id: packId, packages: 2 },
    )
    expect(replay.status).toBe(200)
    expect(replay.body.invoice?.id).toBe(invoiceId)
    expect((await ledgerFor(queueOrderId)).length).toBe(before)
  })

  it('refuses a second pack of the same order', async () => {
    const second = await packOrder(queueOrderId, 'second')
    expect(second.res.status).toBe(409)
    expect((second.res.body as unknown as { message: string }).message).toMatch(/already packed/)
    const rows = (
      await db.execute(
        sql`select count(*)::int as n from pack_confirmations
             where tenant_id = ${tenantId} and order_id = ${queueOrderId}`,
      )
    ).rows as { n: number }[]
    expect(rows[0]?.n).toBe(1)
  })

  it('bills a short pick smaller and never edits the order line', async () => {
    const shortOrderId = await placeOrder([{ variantId: variantB, cases: 2 }], 'short')
    const waved = await wave([shortOrderId], 'short')
    expect(waved.res.status).toBe(200)
    const row = waved.res.body.item.lines[0]
    await call(app, packer, 'POST', `/warehouse/picklists/${waved.id}/start`, {
      idempotencyKey: `start-short-${run}`,
    })
    const picked = await call<{ warnings: { code: string }[] }>(
      app,
      packer,
      'POST',
      `/warehouse/picklists/${waved.id}/pick`,
      {
        idempotencyKey: `pick-short-${run}`,
        lines: [
          {
            id: row?.id ?? '',
            orderLineId: row?.orderLineId ?? '',
            lotId: row?.lotId ?? '',
            pickedQtyPcs: 18,
            shortReason: 'stock not found on rack',
          },
        ],
      },
    )
    expect(picked.body.warnings.map((w) => w.code)).toContain('short_pick')

    const { res } = await packOrder(shortOrderId, 'short')
    expect(res.status).toBe(200)
    expect(res.body.item.shortPacked).toBe(true)
    expect(res.body.lines[0]?.packedQtyPcs).toBe(18)
    expect(res.body.lines[0]?.shortQtyPcs).toBe(6)
    // the ASK is untouched: a short pick is a smaller bill, never an edit (warehouse §4.6)
    const line = (
      await db.execute(
        sql`select qty_pcs, picked_qty_pcs from sales_order_lines
             where id = ${row?.orderLineId ?? ''}`,
      )
    ).rows as { qty_pcs: number; picked_qty_pcs: number }[]
    expect(line[0]?.qty_pcs).toBe(24)
    expect(line[0]?.picked_qty_pcs).toBe(18)
  })

  it('bills a PARKED pack later through billing.invoices.issueForPack, from the pieces that actually left', async () => {
    // docs/23 §8.2: a pack confirmed with issueInvoice:false had no HTTP path to be billed.
    const parkedOrderId = await placeOrder([{ variantId: variantB, cases: 1 }], 'park-bill')
    const packId = uuidv7()
    const packed = await call<PackBody>(
      app,
      packer,
      'POST',
      `/warehouse/orders/${parkedOrderId}/pack`,
      {
        idempotencyKey: `pack-park-bill-${run}`,
        id: packId,
        packages: 1,
        issueInvoice: false,
      },
    )
    expect(packed.status).toBe(200)
    expect(packed.body.invoice).toBeNull()
    expect(await orderState(parkedOrderId)).toBe('packed')
    const ledgerBefore = (
      await db.execute(
        sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId} and ref_type = 'pack' and ref_id = ${parkedOrderId}`,
      )
    ).rows[0] as { n: number }
    expect(ledgerBefore.n).toBeGreaterThan(0)

    // the packer may not bill a parked pack? It may: BILLING_ISSUERS includes the warehouse.
    const invoiceId = uuidv7()
    const billed = await call<{
      item: {
        id: string
        invoiceNo: string | null
        state: string
        lines: { qtyPcs: number; lotId: string | null }[]
        totalPaise: number
      }
    }>(app, accountant, 'POST', `/warehouse/packs/${packId}/invoice`, {
      idempotencyKey: `bill-park-${run}`,
      id: invoiceId,
      packId,
    })
    expect(billed.status).toBe(200)
    expect(billed.body.item.state).toBe('issued')
    expect(billed.body.item.invoiceNo).not.toBeNull()
    expect(billed.body.item.lines.reduce((n, l) => n + l.qtyPcs, 0)).toBe(12) // one case of 12
    expect(billed.body.item.lines.every((l) => l.lotId !== null)).toBe(true)
    // the document only: the ledger did not move again, the pack row now points at the bill
    const ledgerAfter = (
      await db.execute(
        sql`select count(*)::int as n from stock_ledger where tenant_id = ${tenantId} and ref_type = 'pack' and ref_id = ${parkedOrderId}`,
      )
    ).rows[0] as { n: number }
    expect(ledgerAfter.n).toBe(ledgerBefore.n)
    const [pack] = (
      await db.execute(sql`select invoice_id from pack_confirmations where id = ${packId}`)
    ).rows as { invoice_id: string | null }[]
    expect(pack?.invoice_id).toBe(invoiceId)
    // a second bill for the same pack is 409, a replay of the same call is the same bill
    const twice = await call<{ data?: { code?: string } }>(
      app,
      accountant,
      'POST',
      `/warehouse/packs/${packId}/invoice`,
      {
        idempotencyKey: `bill-park-2-${run}`,
        id: uuidv7(),
        packId,
      },
    )
    expect(twice.status).toBe(409)
    expect(twice.body.data?.code).toBe('already_invoiced')
    const replay = await call<{ item: { id: string } }>(
      app,
      accountant,
      'POST',
      `/warehouse/packs/${packId}/invoice`,
      {
        idempotencyKey: `bill-park-${run}`,
        id: invoiceId,
        packId,
      },
    )
    expect(replay.body.item.id).toBe(invoiceId)
    // the crew may never bill (BILLING_ISSUERS), and the print of the bill is queued for the worker
    expect(
      (
        await call(app, driver, 'POST', `/warehouse/packs/${packId}/invoice`, {
          idempotencyKey: `bill-park-crew-${run}`,
          id: uuidv7(),
          packId,
        })
      ).status,
    ).toBe(403)
    const pdf = await call<{ status: string }>(app, packer, 'GET', `/invoices/${invoiceId}/pdf`)
    expect(pdf.body.status).toBe('queued')
    const requests = (
      await db.execute(
        sql`select count(*)::int as n from outbox_events where tenant_id = ${tenantId} and event_type = 'DocumentRenderRequested' and aggregate_id = ${`invoice:${invoiceId}:a4:original`}`,
      )
    ).rows[0] as { n: number }
    expect(requests.n).toBe(1)

    // A second parked pack billed under an invoice id that already names a bill (the desk pressed
    // the same documented example twice) is refused by name, and the pack stays unbilled.
    const secondOrderId = await placeOrder([{ variantId: variantB, cases: 1 }], 'park-bill-2')
    const secondPackId = uuidv7()
    const secondPacked = await call<PackBody>(
      app,
      packer,
      'POST',
      `/warehouse/orders/${secondOrderId}/pack`,
      {
        idempotencyKey: `pack-park-bill-2-${run}`,
        id: secondPackId,
        packages: 1,
        issueInvoice: false,
      },
    )
    expect(secondPacked.status).toBe(200)
    const clash = await call<{ message: string }>(
      app,
      accountant,
      'POST',
      `/warehouse/packs/${secondPackId}/invoice`,
      { idempotencyKey: `bill-park-clash-${run}`, id: invoiceId, packId: secondPackId },
    )
    expect(clash.status).toBe(409)
    expect(clash.body.message).toBe(`invoice ${invoiceId} already exists`)
    const [secondPack] = (
      await db.execute(sql`select invoice_id from pack_confirmations where id = ${secondPackId}`)
    ).rows as { invoice_id: string | null }[]
    expect(secondPack?.invoice_id).toBeNull()
  })

  it('cancels an unstarted wave and gives every held piece back', async () => {
    const parked = await placeOrder([{ variantId: variantB, cases: 1 }], 'parked')
    const held = (await balanceOf(lotB, godown)).reserved
    expect(held).toBeGreaterThan(0)
    const waved = await wave([parked], 'parked')
    expect(waved.res.status).toBe(200)
    const cancelled = await call<{ item: PicklistBody }>(
      app,
      manager,
      'POST',
      `/warehouse/picklists/${waved.id}/cancel`,
      { idempotencyKey: `cancel-wave-${run}`, reason: 'shop shut for a wedding' },
    )
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.item.status).toBe('cancelled')
    expect((await balanceOf(lotB, godown)).reserved).toBe(0)
    // a started wave can never be cancelled: the order machine has no way back from `picking`
    const started = await placeOrder([{ variantId: variantB, cases: 1 }], 'started')
    const w2 = await wave([started], 'started')
    await call(app, packer, 'POST', `/warehouse/picklists/${w2.id}/start`, {
      idempotencyKey: `start-started-${run}`,
    })
    const refused = await call(app, manager, 'POST', `/warehouse/picklists/${w2.id}/cancel`, {
      idempotencyKey: `cancel-started-${run}`,
      reason: 'too late',
    })
    expect(refused.status).toBe(409)
  })

  // ---------------------------------------------------------------------------------------------------------------

  let sheetId = ''
  let challanId = ''

  it('builds a load sheet with the expected packages, the load value and the EWB flag', async () => {
    sheetId = uuidv7()
    const res = await call<{ item: LoadSheetBody }>(app, packer, 'POST', '/warehouse/load-sheets', {
      idempotencyKey: `sheet-${run}`,
      id: sheetId,
      toLocationId: van,
      orderIds: [queueOrderId],
      vanStock: [{ lotId: lotB, qtyPcs: 12 }],
    })
    expect(res.status).toBe(200)
    const sheet = res.body.item
    expect(sheet.status).toBe('draft')
    expect(sheet.expectedPackages).toBe(2)
    expect(sheet.vehicleRegNo).toBe(`MH-05-WH-${run.slice(-4)}`)
    expect(sheet.orders[0]?.invoiceNo).not.toBeNull()
    // Σ invoice totals + van stock at MRP (warehouse §8.3); under ₹1,00,000 so no e-way bill
    expect(sheet.loadValuePaise).toBeGreaterThan(24_000)
    expect(sheet.ewbRequired).toBe(false)
    expect(sheet.lots.find((l) => l.source === 'van')?.lotId).toBe(lotB)
    expect(
      sheet.lots
        .filter((l) => l.source === 'order')
        .map((l) => l.lotId)
        .sort(),
    ).toEqual([lotEarly, lotLate].sort())
    expect(await orderState(queueOrderId)).toBe('packed')
    expect(await ledgerFor(sheetId)).toHaveLength(0)
  })

  it('is confirmed on the warehouse phone only after the manager approved it from the manager app', async () => {
    // docs/22 decision 2026-09-05 (warehouse.ts fact 2b): the PIN is given in the MANAGER app.
    const unapproved = await call<{ data?: { code?: string } }>(
      app,
      packer,
      'POST',
      `/warehouse/load-sheets/${sheetId}/confirm`,
      {
        idempotencyKey: `packer-confirm-early-${run}`,
        countedPackages: 2,
        challanId: uuidv7(),
        countedVanStock: [{ lotId: lotB, qtyPcs: 12 }],
      },
    )
    expect(unapproved.status).toBe(409)
    expect(unapproved.body.data?.code).toBe('approval_required')
    expect(await ledgerFor(sheetId)).toHaveLength(0)

    const approved = await call<{ item: LoadSheetBody }>(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${sheetId}/approve`,
      { idempotencyKey: `approve-${run}`, note: 'checked the sheet' },
    )
    expect(approved.status).toBe(200)
    expect(approved.body.item.status).toBe('draft')
    expect(approved.body.item.approvedBy).toBe(managerId)
    expect(approved.body.item.approvedAt).not.toBeNull()
    // The database recorded WHO and WHEN, signed by the approver's own actor id (0013 trigger).
    const [row] = (
      await db.execute(sql`select approved_by, approved_at from load_sheets where id = ${sheetId}`)
    ).rows as { approved_by: string; approved_at: string }[]
    expect(row?.approved_by).toBe(managerId)
    expect(row?.approved_at).not.toBeNull()
    const again = await call<{ data?: { code?: string } }>(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${sheetId}/approve`,
      { idempotencyKey: `approve-again-${run}` },
    )
    expect(again.status).toBe(409)
    expect(again.body.data?.code).toBe('already_approved')
    expect(
      (
        await db.execute(
          sql`select 1 from audit_log where entity_id = ${sheetId} and action = 'load_sheet.approve'`,
        )
      ).rows,
    ).toHaveLength(1)
  })

  it('refuses a count that differs from the expectation without a note', async () => {
    const res = await call<{ message: string; data?: { code: string } }>(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${sheetId}/confirm`,
      {
        idempotencyKey: `confirm-variance-${run}`,
        countedPackages: 1,
        challanId: uuidv7(),
        countedVanStock: [{ lotId: lotB, qtyPcs: 12 }],
      },
    )
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/variance needs a note/)
    expect(await ledgerFor(sheetId)).toHaveLength(0)
  })

  it('confirms: stock moves godown to vehicle once, DC-0001 is issued and the orders dispatch', async () => {
    challanId = uuidv7()
    const res = await call<{ item: LoadSheetBody; challan: ChallanBody; dispatched: string[] }>(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${sheetId}/confirm`,
      {
        idempotencyKey: `confirm-${run}`,
        countedPackages: 1,
        varianceNote: 'one carton left on the dock',
        challanId,
        countedVanStock: [{ lotId: lotB, qtyPcs: 12 }],
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.item.status).toBe('confirmed')
    expect(res.body.item.countedPackages).toBe(1)
    expect(res.body.item.varianceNote).toBe('one carton left on the dock')
    expect(res.body.item.pinVerifiedBy).toBe(managerId)
    expect(res.body.dispatched).toEqual([queueOrderId])
    expect(await orderState(queueOrderId)).toBe('dispatched')
    expect(await outboxTypes(queueOrderId)).toContain('OrderDispatched')

    const challan = res.body.challan
    expect(challan.challanNo).toBe('DC-0001')
    expect(challan.seriesCode).toBe('DC')
    expect(challan.fy).toMatch(/^\d{4}-\d{2}$/)
    expect(challan.vehicleNo).toBe(`MH-05-WH-${run.slice(-4)}`)
    // WHITE LABEL: the challan carries the DISTRIBUTOR's own name (docs/17 §D6)
    expect(challan.seller.displayName).toBe('Godown Traders')
    expect(challan.lines).toHaveLength(3)
    expect(challan.lines.every((l) => l.gstBps === 1200)).toBe(true)
    expect(challan.gstPaise).toBeGreaterThan(0)

    // exactly one transfer_out and one transfer_in per lot
    const rows = await ledgerFor(sheetId)
    expect(rows.filter((r) => r.reason === 'transfer_out')).toHaveLength(3)
    expect(rows.filter((r) => r.reason === 'transfer_in')).toHaveLength(3)
    expect(rows.reduce((n, r) => n + r.qty_delta, 0)).toBe(0)
    expect((await balanceOf(lotB, van)).on_hand).toBe(12)
    expect((await balanceOf(lotLate, van)).on_hand).toBe(18)
    expect(await outboxTypes(sheetId)).toEqual(['LoadSheetApproved', 'LoadSheetConfirmed'])
    expect(await outboxTypes(challanId)).toEqual(['DeliveryChallanIssued'])
  })

  it('does not move the stock twice when the confirm is retried', async () => {
    const before = await ledgerFor(sheetId)
    const replay = await call<{ challan: ChallanBody }>(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${sheetId}/confirm`,
      {
        idempotencyKey: `confirm-${run}`,
        countedPackages: 1,
        varianceNote: 'one carton left on the dock',
        challanId,
        countedVanStock: [{ lotId: lotB, qtyPcs: 12 }],
      },
    )
    expect(replay.status).toBe(200)
    expect(replay.body.challan.challanNo).toBe('DC-0001')
    expect(await ledgerFor(sheetId)).toHaveLength(before.length)
    expect((await balanceOf(lotB, van)).on_hand).toBe(12)
  })

  it('never cancels a confirmed sheet', async () => {
    const res = await call(app, manager, 'POST', `/warehouse/load-sheets/${sheetId}/cancel`, {
      idempotencyKey: `cancel-sheet-${run}`,
      reason: 'changed my mind',
    })
    expect(res.status).toBe(409)
  })

  it('refuses to load a lakh of goods without an e-way bill number', async () => {
    const bigOrderId = await placeOrder([{ variantId: variantB, cases: 400 }], 'big')
    const waved = await wave([bigOrderId], 'big')
    expect(waved.res.status).toBe(200)
    const packed = await packOrder(bigOrderId, 'big', packer, 40)
    expect(packed.res.status).toBe(200)
    const bigSheetId = uuidv7()
    const built = await call<{ item: LoadSheetBody }>(
      app,
      packer,
      'POST',
      '/warehouse/load-sheets',
      {
        idempotencyKey: `sheet-big-${run}`,
        id: bigSheetId,
        toLocationId: van,
        orderIds: [bigOrderId],
      },
    )
    expect(built.status).toBe(200)
    // 4800 pcs x ₹25 + 12% > ₹1,00,000, and the threshold is a tenant_settings row, never a constant
    expect(built.body.item.loadValuePaise).toBeGreaterThanOrEqual(10_000_000)
    expect(built.body.item.ewbRequired).toBe(true)

    const refused = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${bigSheetId}/confirm`,
      {
        idempotencyKey: `confirm-big-noewb-${run}`,
        countedPackages: 40,
        challanId: uuidv7(),
      },
    )
    expect(refused.status).toBe(400)
    expect(refused.body.message).toMatch(/e-way bill/)
    expect(await ledgerFor(bigSheetId)).toHaveLength(0)

    const confirmed = await call<{ challan: ChallanBody }>(
      app,
      manager,
      'POST',
      `/warehouse/load-sheets/${bigSheetId}/confirm`,
      {
        idempotencyKey: `confirm-big-${run}`,
        countedPackages: 40,
        challanId: uuidv7(),
        ewbNo: '381012345678',
      },
    )
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.challan.ewbNo).toBe('381012345678')
  })

  it('records an e-way bill number on the challan and its sheet, once', async () => {
    const first = await call<{ item: ChallanBody }>(
      app,
      manager,
      'POST',
      `/warehouse/challans/${challanId}/ewb`,
      { idempotencyKey: `ewb-${run}`, ewbNo: '111122223333' },
    )
    expect(first.status).toBe(200)
    expect(first.body.item.ewbNo).toBe('111122223333')
    const sheet = await call<{ item: LoadSheetBody }>(
      app,
      manager,
      'GET',
      `/warehouse/load-sheets/${sheetId}`,
    )
    expect(sheet.body.item.ewbNo).toBe('111122223333')
    const second = await call(app, manager, 'POST', `/warehouse/challans/${challanId}/ewb`, {
      idempotencyKey: `ewb-again-${run}`,
      ewbNo: '999988887777',
    })
    expect(second.status).toBe(409)
    const audit = (
      await db.execute(
        sql`select count(*)::int as n from audit_log
             where tenant_id = ${tenantId} and entity_id = ${challanId}
               and action = 'warehouse.challans.recordEwb'`,
      )
    ).rows as { n: number }[]
    expect(audit[0]?.n).toBe(1)
  })

  it('frees the holds of a confirmed order and refuses one that is already picking', async () => {
    const parked = await placeOrder([{ variantId: variantB, cases: 1 }], 'release')
    const freed = await call<{ released: number; freedQtyPcs: number }>(
      app,
      manager,
      'POST',
      '/warehouse/reservations/release',
      { idempotencyKey: `release-${run}`, orderId: parked, reason: 'shop shut' },
    )
    expect(freed.status).toBe(200)
    expect(freed.body.released).toBeGreaterThan(0)
    expect(freed.body.freedQtyPcs).toBe(12)
    const audit = (
      await db.execute(
        sql`select count(*)::int as n from audit_log
             where tenant_id = ${tenantId} and entity_id = ${parked}
               and action = 'warehouse.reservations.release'`,
      )
    ).rows as { n: number }[]
    expect(audit[0]?.n).toBe(1)

    const picking = await placeOrder([{ variantId: variantB, cases: 1 }], 'release-picking')
    const w = await wave([picking], 'release-picking')
    await call(app, packer, 'POST', `/warehouse/picklists/${w.id}/start`, {
      idempotencyKey: `start-release-${run}`,
    })
    const refused = await call(app, manager, 'POST', '/warehouse/reservations/release', {
      idempotencyKey: `release-picking-${run}`,
      orderId: picking,
      reason: 'too late',
    })
    expect(refused.status).toBe(409)
  })

  it('lists the holds with the order they are for', async () => {
    const res = await call<{
      items: { orderId: string | null; orderLineId: string; qtyPcs: number; state: string }[]
    }>(app, packer, 'GET', '/warehouse/reservations', { limit: 50 })
    expect(res.status).toBe(200)
    expect(res.body.items.every((i) => i.state === 'pending')).toBe(true)
    expect(res.body.items.every((i) => i.orderId !== null)).toBe(true)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // offline

  it('accepts a pick from a device and never answers 4xx', async () => {
    const target = await placeOrder([{ variantId: variantB, cases: 1 }], 'sync')
    const waved = await wave([target], 'sync')
    const row = waved.res.body.item.lines[0]
    const deviceId = `dev-${run}`

    // a wave nobody has started is closed to the device: 2xx with a sync_errors row, never a 4xx
    const closed = await call<{ accepted: number; rejected: { code: string }[] }>(
      app,
      packer,
      'POST',
      '/sync/upload',
      {
        protocol: 1,
        deviceId,
        ops: [
          {
            opId: `op-closed-${run}`,
            op: 'PUT',
            table: 'pick_lines',
            id: row?.id ?? '',
            data: {
              picklist_id: waved.id,
              order_line_id: row?.orderLineId ?? '',
              lot_id: row?.lotId ?? '',
              picked_qty_pcs: 12,
            },
          },
        ],
      },
    )
    expect(closed.status).toBe(200)
    expect(closed.body.rejected.map((r) => r.code)).toEqual(['picklist_closed'])

    await call(app, packer, 'POST', `/warehouse/picklists/${waved.id}/start`, {
      idempotencyKey: `start-sync-${run}`,
    })
    const good = await call<{ accepted: number; rejected: { code: string }[] }>(
      app,
      packer,
      'POST',
      '/sync/upload',
      {
        protocol: 1,
        deviceId,
        ops: [
          {
            opId: `op-good-${run}`,
            op: 'PUT',
            table: 'pick_lines',
            id: row?.id ?? '',
            data: {
              picklist_id: waved.id,
              order_line_id: row?.orderLineId ?? '',
              lot_id: row?.lotId ?? '',
              picked_qty_pcs: 12,
            },
          },
        ],
      },
    )
    expect(good.status).toBe(200)
    expect(good.body.accepted).toBe(1)
    const stored = (
      await db.execute(sql`select picked_qty_pcs from pick_lines where id = ${row?.id ?? ''}`)
    ).rows as { picked_qty_pcs: number }[]
    expect(stored[0]?.picked_qty_pcs).toBe(12)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // roles: refused at the API AND at the database, so RLS is the guarantee

  it('keeps a salesperson off the godown floor, at the API and in Postgres', async () => {
    expect((await call(app, rep, 'GET', '/warehouse/queue', { limit: 5 })).status).toBe(403)
    expect(
      (
        await call(app, rep, 'POST', '/warehouse/picklists', {
          idempotencyKey: `rep-wave-${run}`,
          id: uuidv7(),
          orderIds: [queueOrderId],
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, rep, 'POST', `/warehouse/orders/${queueOrderId}/pack`, {
          idempotencyKey: `rep-pack-${run}`,
          id: uuidv7(),
          packages: 1,
        })
      ).status,
    ).toBe(403)
    await expect(
      as(ctxOf(repId, 'salesperson'), (tx) =>
        tx.execute(sql`insert into pick_lines
          (id, tenant_id, picklist_id, order_id, order_line_id, variant_id, requested_qty_pcs)
          values (${uuidv7()}, ${tenantId}, ${picklistId}, ${queueOrderId}, ${orderLineId}, ${variantA}, 1)`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
  })

  it('keeps a shopkeeper out of the godown entirely — RLS returns nothing, not a filtered view', async () => {
    expect((await call(app, shop, 'GET', '/warehouse/load-sheets', { limit: 5 })).status).toBe(403)
    expect((await call(app, shop, 'GET', '/warehouse/queue', { limit: 5 })).status).toBe(403)
    const shopCtx = ctxOf(shopUserId, 'retailer')
    expect(await as(shopCtx, (tx) => tx.execute(sql`select id from picklists`))).toMatchObject({
      rows: [],
    })
    expect(await as(shopCtx, (tx) => tx.execute(sql`select id from load_sheets`))).toMatchObject({
      rows: [],
    })
    expect(
      await as(shopCtx, (tx) => tx.execute(sql`select id from delivery_challans`)),
    ).toMatchObject({ rows: [] })
    // …but the shop still watches its own order move, through the ORDER, which is where state lives
    const mine = await call<{ item: { state: string } }>(
      app,
      shop,
      'GET',
      `/orders/${queueOrderId}`,
    )
    expect(mine.status).toBe(200)
    expect(mine.body.item.state).toBe('dispatched')
  })

  it('lets the crew read its load and its paperwork, and write nothing', async () => {
    expect((await call(app, driver, 'GET', `/warehouse/load-sheets/${sheetId}`)).status).toBe(200)
    expect((await call(app, driver, 'GET', `/warehouse/challans/${challanId}`)).status).toBe(200)
    expect((await call(app, driver, 'GET', '/warehouse/packs', { limit: 5 })).status).toBe(200)
    expect(
      (
        await call(app, driver, 'POST', '/warehouse/picklists', {
          idempotencyKey: `driver-wave-${run}`,
          id: uuidv7(),
          orderIds: [queueOrderId],
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, driver, 'POST', `/warehouse/load-sheets/${sheetId}/confirm`, {
          idempotencyKey: `driver-confirm-${run}`,
          countedPackages: 1,
          challanId: uuidv7(),
        })
      ).status,
    ).toBe(403)
    await expect(
      as(ctxOf(driverId, 'delivery'), (tx) =>
        tx.execute(sql`insert into load_sheets (id, tenant_id, from_location_id, to_location_id)
          values (${uuidv7()}, ${tenantId}, ${godown}, ${van})`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
  })

  it('lets the accountant read the paperwork and touch none of it', async () => {
    expect((await call(app, accountant, 'GET', '/warehouse/packs', { limit: 5 })).status).toBe(200)
    expect(
      (
        await call(app, accountant, 'POST', `/warehouse/orders/${queueOrderId}/pack`, {
          idempotencyKey: `acc-pack-${run}`,
          id: uuidv7(),
          packages: 1,
        })
      ).status,
    ).toBe(403)
    // An UPDATE the policy does not permit touches NO ROWS (the USING clause filters them out) rather
    // than raising; an INSERT trips the WITH CHECK and raises 42501. Both are the guarantee.
    const touched = await as(ctxOf(accountantId, 'accountant'), (tx) =>
      tx.execute(sql`update pick_lines set picked_qty_pcs = 1 where id = ${pickRowId}`),
    )
    expect(touched.rowCount).toBe(0)
    await expect(
      as(ctxOf(accountantId, 'accountant'), (tx) =>
        tx.execute(sql`insert into pick_lines
          (id, tenant_id, picklist_id, order_id, order_line_id, variant_id, requested_qty_pcs)
          values (${uuidv7()}, ${tenantId}, ${picklistId}, ${queueOrderId}, ${orderLineId}, ${variantA}, 1)`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } })
  })

  it('never lets a picker learn a purchase rate', async () => {
    expect((await call(app, packer, 'GET', '/tenant-catalog/costs', { limit: 5 })).status).not.toBe(
      200,
    )
    expect(
      await as(ctxOf(packerId, 'warehouse'), (tx) =>
        tx.execute(sql`select variant_id from tenant_product_costs`),
      ),
    ).toMatchObject({ rows: [] })
  })

  it('keeps the manager PIN steps away from the godown floor', async () => {
    // The warehouse phone confirms a load-out only after the manager app approved it (the test
    // above); it never gives the approval itself, cancels a wave or frees a hold.
    expect(
      (
        await call(app, packer, 'POST', `/warehouse/load-sheets/${sheetId}/approve`, {
          idempotencyKey: `packer-approve-${run}`,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, packer, 'POST', `/warehouse/picklists/${picklistId}/cancel`, {
          idempotencyKey: `packer-cancel-${run}`,
          reason: 'nope',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, packer, 'POST', '/warehouse/reservations/release', {
          idempotencyKey: `packer-release-${run}`,
          orderId: queueOrderId,
          reason: 'nope',
        })
      ).status,
    ).toBe(403)
  })

  it('answers 401 with no token and hides another tenant', async () => {
    expect((await call(app, null, 'GET', '/warehouse/queue', { limit: 5 })).status).toBe(401)
    const stranger: Actor = { tenantId: uuidv7(), actorId: uuidv7(), role: 'owner' }
    expect((await call(app, stranger, 'GET', `/warehouse/picklists/${picklistId}`)).status).toBe(
      404,
    )
    expect((await call(app, owner, 'GET', `/warehouse/picklists/${picklistId}`)).status).toBe(200)
  })
})
