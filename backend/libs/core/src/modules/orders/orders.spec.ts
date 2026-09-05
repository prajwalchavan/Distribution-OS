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
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { SyncModule } from '../sync/index.js'
import { OrdersModule, OrdersService } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type Line = {
  id: string
  variantId: string
  enteredQty: number
  enteredUnit: string
  packSizeAtEntry: number
  qtyPcs: number
  gstBps: number
  taxPaise: number
  lineTotalPaise: number
  listRatePaise: number
  ratePaise: number
  discountPaise: number
}
type Detail = {
  id: string
  orderNo: string | null
  state: string
  retailerId: string
  source: string
  paymentTerms: string
  subtotalPaise: number
  discountPaise: number
  taxPaise: number
  roundOffPaise: number
  totalPaise: number
  approvalFlags: string[]
  cancelReason: string | null
  lines: Line[]
  transitions: { event: string; toState: string; actorId: string; deviceId: string | null }[]
  approvals: { id: string; kind: string; status: string }[]
}
type Shortage = { lineId: string; requestedPcs: number; reservedPcs: number; shortQtyPcs: number }

describeDb('orders (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const hsn = `8${Date.now().toString().slice(-6)}`
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const repId = uuidv7()
  const shopUserId = uuidv7()
  const retailerA = uuidv7() // credit mode `indicate`, linked to shopUserId
  const retailerB = uuidv7() // credit mode `strict` with a ₹10 limit
  const variantA = uuidv7() // 100 pcs in the godown
  const variantB = uuidv7() // no stock at all
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))

  const orderOne = uuidv7()
  const lineOne = uuidv7()
  const repeatOrder = uuidv7()
  const strictOrder = uuidv7()
  const shopOrder = uuidv7()
  const syncOrder = uuidv7()
  let godown = ''
  let app: NestFastifyApplication

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `ord-${run}`, legalName: 'Orders test', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91904${run}1`, name: 'Owner' },
      { id: repId, phone: `+91904${run}2`, name: 'Rep' },
      { id: shopUserId, phone: `+91904${run}3`, name: 'Shopkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker ord ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Campa', category: 'beverages' })
    await db.insert(productVariants).values([
      {
        id: variantA,
        productId,
        name: 'Campa Cola 750 ml',
        netQty: 750,
        netUnit: 'ml',
        defaultCaseSize: 24,
        hsnCode: hsn,
        mrpPaise: 4000,
      },
      {
        id: variantB,
        productId,
        name: 'Sure Water 1 L',
        netQty: 1,
        netUnit: 'l',
        defaultCaseSize: 24,
        hsnCode: hsn,
        mrpPaise: 2000,
      },
    ])
    // the tenant sells in 12s even though the manufacturer prints 24 (docs/17 B: sell-side pack wins)
    await db.insert(tenantProducts).values([
      { id: uuidv7(), tenantId, variantId: variantA, caseSizeOverride: 12 },
      { id: uuidv7(), tenantId, variantId: variantB, caseSizeOverride: 12 },
    ])
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, effectiveFrom: '2020-04-01' })

    const identityId = uuidv7()
    await db.insert(retailerIdentities).values({
      id: identityId,
      phone: `+91905${run}1`,
      userId: shopUserId,
      shopName: `Shop A ${run}`,
    })
    await db.insert(retailers).values([
      {
        id: retailerA,
        tenantId,
        identityId,
        code: `R1-${run}`,
        name: `Shop A ${run}`,
        phone: `+91905${run}1`,
        stateCode: '27',
        tier: 'C',
        creditMode: 'indicate',
        creditLimitPaise: 0,
      },
      {
        id: retailerB,
        tenantId,
        code: `R2-${run}`,
        name: `Shop B ${run}`,
        phone: `+91905${run}2`,
        stateCode: '27',
        tier: 'C',
        creditMode: 'strict',
        creditLimitPaise: 1000,
      },
    ])
    await db.insert(retailerLinks).values({
      id: uuidv7(),
      tenantId,
      identityId,
      retailerId: retailerA,
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
    app = await bootTestApp([OrdersModule, InventoryModule, SyncModule])

    // opening stock: 100 pieces of variant A in the godown, nothing of variant B
    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      const { lot } = await inventory.findOrCreateLot(tx, {
        variantId: variantA,
        batchNo: 'OPENING',
        mrpPaise: 4000,
      })
      await inventory.post(tx, [
        {
          lotId: lot.id,
          locationId: godown,
          qtyDelta: 100,
          reason: 'opening',
          idempotencyKey: `open-${run}-a`,
        },
      ])
    })
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const create = { idempotencyKey: `create-${run}` }

  it('prices a draft in cases: 2 cs = 24 pcs at the tenant pack size, GST from the dated HSN rate', async () => {
    const res = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      ...create,
      id: orderOne,
      retailerId: retailerA,
      source: 'salesperson',
      deviceId: `dev-${run}`,
      lines: [{ id: lineOne, variantId: variantA, enteredQty: 2, enteredUnit: 'case' }],
    })
    expect(res.status).toBe(200)
    expect(res.body.item).toMatchObject({
      state: 'draft',
      orderNo: null,
      retailerId: retailerA,
      source: 'salesperson',
      paymentTerms: 'POST_FULFILLMENT',
      // 24 x ₹10 = ₹240 + 12% GST ₹28.80 = ₹268.80, rounded to ₹269 with 20 paise to Round Off
      subtotalPaise: 24_000,
      discountPaise: 0,
      taxPaise: 2_880,
      roundOffPaise: 20,
      totalPaise: 26_900,
      approvalFlags: [],
    })
    expect(res.body.item.lines).toHaveLength(1)
    expect(res.body.item.lines[0]).toMatchObject({
      id: lineOne,
      variantId: variantA,
      enteredQty: 2,
      enteredUnit: 'case',
      packSizeAtEntry: 12,
      qtyPcs: 24,
      listRatePaise: 1_000,
      ratePaise: 1_000,
      discountPaise: 0,
      gstBps: 1_200,
      taxPaise: 2_880,
      lineTotalPaise: 26_880,
    })
  })

  it('replays create with the same key instead of drafting a second order', async () => {
    const first = await call<{ item: Detail }>(app, rep, 'GET', `/orders/${orderOne}`)
    const replay = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      ...create,
      id: orderOne,
      retailerId: retailerA,
      source: 'salesperson',
      deviceId: `dev-${run}`,
      lines: [{ id: lineOne, variantId: variantA, enteredQty: 2, enteredUnit: 'case' }],
    })
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(orderOne)
    expect(replay.body.item.lines).toHaveLength(1)
    expect(first.body.item.totalPaise).toBe(replay.body.item.totalPaise)
  })

  it('submits: SO-0001, no flags so it confirms itself, and the 24 pieces are held', async () => {
    const res = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${orderOne}/submit`, {
      idempotencyKey: `submit-${run}`,
      deviceId: `dev-${run}`,
    })
    expect(res.status).toBe(200)
    expect(res.body.item.orderNo).toBe('SO-0001')
    expect(res.body.item.approvalFlags).toEqual([])
    expect(res.body.item.state).toBe('confirmed')
    expect(res.body.item.transitions.map((t) => t.event)).toEqual(['submit', 'confirm'])
    expect(res.body.item.transitions[0]?.deviceId).toBe(`dev-${run}`)

    const balances = (
      await db.execute(
        sql`select on_hand, reserved from stock_balances where tenant_id = ${tenantId} and location_id = ${godown}`,
      )
    ).rows as { on_hand: number; reserved: number }[]
    expect(balances).toHaveLength(1)
    expect(balances[0]).toMatchObject({ on_hand: 100, reserved: 24 })

    const held = (
      await db.execute(
        sql`select qty, state from reservations where tenant_id = ${tenantId} and order_line_id = ${lineOne}`,
      )
    ).rows as { qty: number; state: string }[]
    expect(held).toEqual([{ qty: 24, state: 'pending' }])

    const events = (
      await db.execute(
        sql`select event_type from outbox_events where tenant_id = ${tenantId} and aggregate_id = ${orderOne} order by id`,
      )
    ).rows as { event_type: string }[]
    expect(events.map((e) => e.event_type)).toEqual(['OrderSubmitted', 'OrderConfirmed'])
  })

  it('repeats the last order for the shop, re-priced today', async () => {
    const res = await call<{ item: Detail }>(app, rep, 'POST', '/orders/repeat-last', {
      idempotencyKey: `repeat-${run}`,
      id: repeatOrder,
      retailerId: retailerA,
      source: 'salesperson',
    })
    expect(res.status).toBe(200)
    expect(res.body.item.state).toBe('draft')
    expect(res.body.item.lines).toHaveLength(1)
    expect(res.body.item.lines[0]).toMatchObject({
      variantId: variantA,
      enteredQty: 2,
      enteredUnit: 'case',
      qtyPcs: 24,
    })
    expect(res.body.item.lines[0]?.id).not.toBe(lineOne)
    expect(res.body.item.totalPaise).toBe(26_900)
  })

  it('holds a strict retailer over its credit limit at submitted with a pending approval', async () => {
    const line = uuidv7()
    const draft = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-strict-${run}`,
      id: strictOrder,
      retailerId: retailerB,
      source: 'salesperson',
      lines: [{ id: line, variantId: variantB, enteredQty: 1, enteredUnit: 'case' }],
    })
    expect(draft.status).toBe(200)
    expect(draft.body.item.totalPaise).toBeGreaterThan(1_000)

    const submitted = await call<{ item: Detail }>(
      app,
      rep,
      'POST',
      `/orders/${strictOrder}/submit`,
      { idempotencyKey: `submit-strict-${run}` },
    )
    expect(submitted.status).toBe(200)
    expect(submitted.body.item.state).toBe('submitted')
    expect(submitted.body.item.approvalFlags).toEqual(['credit_limit'])

    const queue = await call<{ items: { id: string; kind: string; orderId: string }[] }>(
      app,
      owner,
      'GET',
      '/approvals',
      { status: 'pending' },
    )
    expect(queue.status).toBe(200)
    const pending = queue.body.items.find((a) => a.orderId === strictOrder)
    expect(pending?.kind).toBe('credit_limit')
    expect((await call(app, rep, 'GET', '/approvals', { status: 'pending' })).status).toBe(403)

    const decided = await call<{ item: { status: string }; order: Detail | null }>(
      app,
      owner,
      'POST',
      `/approvals/${pending?.id ?? ''}/decide`,
      { idempotencyKey: `decide-${run}`, decision: 'approve', note: 'owner ok' },
    )
    expect(decided.status).toBe(200)
    expect(decided.body.item.status).toBe('approved')
    expect(decided.body.order?.state).toBe('confirmed')
    // variant B has no stock: the line is reserved short rather than refused
    const held = (
      await db.execute(
        sql`select count(*)::int as n from reservations where tenant_id = ${tenantId} and order_line_id = ${line}`,
      )
    ).rows as { n: number }[]
    expect(held[0]?.n).toBe(0)
  })

  it('lets the rep cancel a draft', async () => {
    const res = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${repeatOrder}/cancel`, {
      idempotencyKey: `cancel-${run}`,
      reason: 'shop changed its mind',
      deviceId: `dev-${run}`,
    })
    expect(res.status).toBe(200)
    expect(res.body.item.state).toBe('cancelled')
    expect(res.body.item.cancelReason).toBe('shop changed its mind')
    expect(res.body.item.transitions.at(-1)).toMatchObject({
      event: 'cancel',
      toState: 'cancelled',
    })
  })

  it('lets a retailer draft for its own shop and shows it nothing else', async () => {
    const res = await call<{ item: Detail }>(app, shop, 'POST', '/orders', {
      idempotencyKey: `create-shop-${run}`,
      id: shopOrder,
      retailerId: retailerA,
      source: 'retailer_app',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 6, enteredUnit: 'piece' }],
    })
    expect(res.status).toBe(200)
    expect(res.body.item).toMatchObject({ state: 'draft', source: 'retailer_app' })
    expect(res.body.item.lines[0]).toMatchObject({ qtyPcs: 6, packSizeAtEntry: 1 })

    const wrongShop = await call<{ message: string }>(app, shop, 'POST', '/orders', {
      idempotencyKey: `create-shop-bad-${run}`,
      id: uuidv7(),
      retailerId: retailerB,
      source: 'retailer_app',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
    })
    expect(wrongShop.status).toBe(403)

    const mine = await call<{ items: { id: string; retailerId: string }[] }>(
      app,
      shop,
      'GET',
      '/orders',
      {},
    )
    expect(mine.status).toBe(200)
    expect(mine.body.items.every((o) => o.retailerId === retailerA)).toBe(true)
    expect(mine.body.items.map((o) => o.id)).not.toContain(strictOrder)
    const all = await call<{ items: { id: string }[] }>(app, owner, 'GET', '/orders', {})
    expect(all.body.items.map((o) => o.id)).toContain(strictOrder)
    expect(all.body.items.length).toBeGreaterThan(mine.body.items.length)
  })

  it('answers 409, never 500, when the client id belongs to an order the shop cannot see', async () => {
    // `strictOrder` is retailerB's; RLS hides it from this shop, so the duplicate only surfaces at the primary
    // key. Both entry points must turn that into a conflict rather than letting the driver error escape.
    const drafted = await call<{ message: string }>(app, shop, 'POST', '/orders', {
      idempotencyKey: `create-shop-clash-${run}`,
      id: strictOrder,
      retailerId: retailerA,
      source: 'retailer_app',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
    })
    expect(drafted.status).toBe(409)
    expect(drafted.body.message).toContain('already exists')

    const repeated = await call<{ message: string }>(app, shop, 'POST', '/orders/repeat-last', {
      idempotencyKey: `repeat-shop-clash-${run}`,
      id: strictOrder,
      retailerId: retailerA,
      source: 'retailer_app',
    })
    expect(repeated.status).toBe(409)
    expect(repeated.body.message).toContain('already exists')

    // the hidden order is untouched and still belongs to retailerB
    const [row] = (
      await db.execute(
        sql`select retailer_id from sales_orders where tenant_id = ${tenantId} and id = ${strictOrder}`,
      )
    ).rows as { retailer_id: string }[]
    expect(row?.retailer_id).toBe(retailerB)
  })

  it('lets a retailer cancel its own draft and still writes the audit transition', async () => {
    const id = uuidv7()
    await call(app, shop, 'POST', '/orders', {
      idempotencyKey: `create-shop2-${run}`,
      id,
      retailerId: retailerA,
      source: 'retailer_app',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
    })
    const res = await call<{ item: Detail }>(app, shop, 'POST', `/orders/${id}/cancel`, {
      idempotencyKey: `cancel-shop-${run}`,
      reason: 'ordered by mistake',
    })
    expect(res.status).toBe(200)
    expect(res.body.item.state).toBe('cancelled')
    expect(res.body.item.transitions.at(-1)).toMatchObject({
      event: 'cancel',
      toState: 'cancelled',
      actorId: shopUserId,
    })
    // the escalation used to write that row must not leak into the rest of the transaction
    expect(
      (
        await call(app, shop, 'GET', '/approvals', {
          status: 'pending',
        })
      ).status,
    ).toBe(403)
  })

  it('refuses an illegal transition and a request without tenant context', async () => {
    const bad = await call<{ message: string }>(
      app,
      owner,
      'POST',
      `/orders/${shopOrder}/confirm`,
      {
        idempotencyKey: `confirm-bad-${run}`,
      },
    )
    expect(bad.status).toBe(409)
    expect(bad.body.message).toMatch(/cannot apply "confirm"/)
    expect((await call(app, null, 'GET', '/orders', {})).status).toBe(401)
  })

  it('accepts a draft uploaded from a device and replays the same batch', async () => {
    const deviceId = `device-${run}`
    const lineId = uuidv7()
    const ops = [
      {
        opId: `so-${run}`,
        op: 'PUT',
        table: 'sales_orders',
        id: syncOrder,
        data: { retailer_id: retailerA, source: 'salesperson', state: 'draft', note: 'from beat' },
      },
      {
        opId: `sol-${run}`,
        op: 'PUT',
        table: 'sales_order_lines',
        id: lineId,
        data: {
          order_id: syncOrder,
          variant_id: variantA,
          entered_qty: 3,
          entered_unit: 'case',
        },
      },
    ]
    const first = await call<{ accepted: number; replayed: number; rejected: unknown[] }>(
      app,
      rep,
      'POST',
      '/sync/upload',
      { protocol: 1, deviceId, ops },
    )
    expect(first.status).toBe(200)
    expect(first.body.rejected).toEqual([])
    expect(first.body.accepted).toBe(2)

    const uploaded = await call<{ item: Detail }>(app, rep, 'GET', `/orders/${syncOrder}`)
    expect(uploaded.body.item.state).toBe('draft')
    expect(uploaded.body.item.lines[0]).toMatchObject({
      id: lineId,
      qtyPcs: 36,
      packSizeAtEntry: 12,
    })
    expect(uploaded.body.item.totalPaise).toBe(40_300) // ₹360 + 12% = ₹403.20 -> ₹403

    const again = await call<{ accepted: number; replayed: number }>(
      app,
      rep,
      'POST',
      '/sync/upload',
      { protocol: 1, deviceId, ops },
    )
    expect(again.body.replayed).toBe(2)
    const lines = (
      await db.execute(
        sql`select count(*)::int as n from sales_order_lines where tenant_id = ${tenantId} and order_id = ${syncOrder}`,
      )
    ).rows as { n: number }[]
    expect(lines[0]?.n).toBe(1)
  })

  it('reserves what exists and reports the shortage instead of refusing the order', async () => {
    // retailer B is `strict` and over its limit, so this one waits at `submitted` for an explicit confirm
    const id = uuidv7()
    const line = uuidv7()
    const draft = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-short-${run}`,
      id,
      retailerId: retailerB,
      source: 'salesperson',
      lines: [{ id: line, variantId: variantA, enteredQty: 90, enteredUnit: 'piece' }],
    })
    expect(draft.status).toBe(200)
    const submitted = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${id}/submit`, {
      idempotencyKey: `submit-short-${run}`,
    })
    expect(submitted.body.item.state).toBe('submitted')

    expect(
      (await call(app, rep, 'POST', `/orders/${id}/confirm`, { idempotencyKey: `c-rep-${run}` }))
        .status,
    ).toBe(403)
    const confirmed = await call<{ item: Detail; shortages: Shortage[] }>(
      app,
      owner,
      'POST',
      `/orders/${id}/confirm`,
      { idempotencyKey: `confirm-short-${run}` },
    )
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.item.state).toBe('confirmed')
    // 100 on hand with 24 already held: 76 pieces are reserved, 14 are reported short
    expect(confirmed.body.shortages).toEqual([
      { lineId: line, variantId: variantA, requestedPcs: 90, reservedPcs: 76, shortQtyPcs: 14 },
    ])
    expect(confirmed.body.item.approvals.every((a) => a.status === 'approved')).toBe(true)
    const balances = (
      await db.execute(
        sql`select reserved from stock_balances where tenant_id = ${tenantId} and location_id = ${godown}`,
      )
    ).rows as { reserved: number }[]
    expect(balances[0]?.reserved).toBe(100)
  })

  // -----------------------------------------------------------------------------------------------------
  // The fulfilment surface warehouse works through (coordination §3.9 and §4). These four functions are the
  // ONLY way confirmed -> picking -> packed -> dispatched happens; nothing outside this module writes
  // `sales_orders.state` or `sales_order_lines.picked_qty_pcs`.

  const fulfilOrder = uuidv7()
  const fulfilLine = uuidv7()

  it('moves an order through picking, packed and dispatched, writing the transition and the event together', async () => {
    await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-fulfil-${run}`,
      id: fulfilOrder,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [{ id: fulfilLine, variantId: variantA, enteredQty: 2, enteredUnit: 'piece' }],
    })
    const submitted = await call<{ item: Detail }>(
      app,
      rep,
      'POST',
      `/orders/${fulfilOrder}/submit`,
      {
        idempotencyKey: `submit-fulfil-${run}`,
      },
    )
    expect(submitted.body.item.state).toBe('confirmed')

    const orders = app.get(OrdersService)
    const apply = (event: 'start_picking' | 'pack' | 'dispatch', deviceId: string | null) =>
      asOwner((tx) => orders.applyFulfilmentEvent(tx, fulfilOrder, event, deviceId, null))

    expect((await apply('start_picking', `pick-${run}`)).state).toBe('picking')
    // A load sheet retries as a whole, so an order already at the target state is a no-op, not a 409.
    expect((await apply('start_picking', `pick-${run}`)).state).toBe('picking')
    expect((await apply('pack', `pack-${run}`)).state).toBe('packed')

    // packed -> picking has no edge on `orderMachine`: the machine's own error, surfaced as a 409.
    const before = await countRows(fulfilOrder)
    await expect(apply('start_picking', null)).rejects.toThrow(/cannot apply "start_picking"/)
    expect(await countRows(fulfilOrder)).toEqual(before)

    expect((await apply('dispatch', `load-${run}`)).state).toBe('dispatched')

    const transitions = (
      await db.execute(
        sql`select event, from_state, to_state, device_id from order_state_transitions
            where tenant_id = ${tenantId} and order_id = ${fulfilOrder} order by id`,
      )
    ).rows as { event: string; from_state: string; to_state: string; device_id: string | null }[]
    expect(transitions.map((t) => t.event)).toEqual([
      'submit',
      'confirm',
      'start_picking',
      'pack',
      'dispatch',
    ])
    expect(transitions.at(-1)).toMatchObject({
      from_state: 'packed',
      to_state: 'dispatched',
      device_id: `load-${run}`,
    })
    // One outbox row per accepted move, written in the same transaction as its transition row: the
    // no-op replay added neither, and the refused move added neither.
    const events = (
      await db.execute(
        sql`select event_type from outbox_events where tenant_id = ${tenantId} and aggregate_id = ${fulfilOrder} order by id`,
      )
    ).rows as { event_type: string }[]
    expect(events.map((e) => e.event_type)).toEqual([
      'OrderSubmitted',
      'OrderConfirmed',
      'OrderPicking',
      'OrderPacked',
      'OrderDispatched',
    ])
  })

  it('records the picked quantity on the order line and refuses a quantity the order never had', async () => {
    const orders = app.get(OrdersService)
    await asOwner((tx) =>
      orders.recordPick(tx, fulfilOrder, [{ orderLineId: fulfilLine, pickedQtyPcs: 1 }]),
    )
    const picked = (
      await db.execute(
        sql`select picked_qty_pcs, qty_pcs from sales_order_lines where id = ${fulfilLine}`,
      )
    ).rows as { picked_qty_pcs: number; qty_pcs: number }[]
    // A short pick is a smaller invoice: `qty_pcs` is never edited to match what came off the rack.
    expect(picked[0]).toEqual({ picked_qty_pcs: 1, qty_pcs: 2 })

    await expect(
      asOwner((tx) =>
        orders.recordPick(tx, fulfilOrder, [{ orderLineId: fulfilLine, pickedQtyPcs: 9 }]),
      ),
    ).rejects.toThrow(/which ordered 2/)
    await expect(
      asOwner((tx) =>
        orders.recordPick(tx, fulfilOrder, [{ orderLineId: uuidv7(), pickedQtyPcs: 1 }]),
      ),
    ).rejects.toThrow(/does not belong to order/)
  })

  it('shows the warehouse queue and the pick lines with quantities and no money at all', async () => {
    const orders = app.get(OrdersService)
    const queue = await asOwner((tx) => orders.fulfilmentQueue(tx, { limit: 50 }))
    const packedOrder = queue.find((o) => o.orderId === fulfilOrder)
    // `dispatched` is out of the godown's hands, so the default filter does not carry it…
    expect(packedOrder).toBeUndefined()
    const confirmed = await asOwner((tx) =>
      orders.fulfilmentQueue(tx, { limit: 50, state: 'confirmed' }),
    )
    expect(confirmed.every((o) => o.state === 'confirmed')).toBe(true)
    const first = confirmed[0]
    expect(typeof first?.retailerName).toBe('string')
    expect(typeof first?.lineCount).toBe('number')
    // The picking screen must never let a rate — let alone a purchase cost — be read off it.
    expect(JSON.stringify(confirmed)).not.toMatch(/[Pp]aise|[Rr]ate|cost/)

    const lines = await asOwner((tx) => orders.fulfilmentLines(tx, [fulfilOrder]))
    expect(lines).toEqual([
      {
        orderId: fulfilOrder,
        orderLineId: fulfilLine,
        lineNo: 1,
        variantId: variantA,
        qtyPcs: 2,
        freeQtyPcs: 0,
        pickedQtyPcs: 1,
        sellCaseSize: 12,
      },
    ])
    expect(await asOwner((tx) => orders.fulfilmentLines(tx, []))).toEqual([])
  })

  const countRows = async (orderId: string) => {
    const rows = (
      await db.execute(
        sql`select
              (select count(*) from order_state_transitions where order_id = ${orderId})::int as transitions,
              (select count(*) from outbox_events where aggregate_id = ${orderId})::int as events`,
      )
    ).rows as { transitions: number; events: number }[]
    return rows[0]
  }
})
