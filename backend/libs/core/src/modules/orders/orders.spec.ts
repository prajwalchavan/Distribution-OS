import { eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { Quote } from '@dos/contracts'
import { uuidv7 } from '@dos/domain'
import {
  approvals,
  bargainRequests,
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
  approvals: {
    id: string
    kind: string
    status: string
    decidedBy: string | null
    decisionNote: string | null
  }[]
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
  const managerId = uuidv7()
  const retailerA = uuidv7() // credit mode `indicate`, linked to shopUserId
  const retailerB = uuidv7() // credit mode `strict` with a ₹10 limit
  const retailerC = uuidv7() // credit mode `stop` with a ₹10 limit (DOS-020)
  const variantA = uuidv7() // 100 pcs in the godown
  const variantB = uuidv7() // no stock at all
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
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
      // `+91904${run}4` is the DOS-073 block's second rep; phones are unique platform-wide
      { id: managerId, phone: `+91904${run}5`, name: 'Manager' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
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
      {
        id: retailerC,
        tenantId,
        code: `R3-${run}`,
        name: `Shop C ${run}`,
        phone: `+91905${run}3`,
        stateCode: '27',
        tier: 'C',
        creditMode: 'stop',
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

  it('lets the shop SUBMIT its own draft: same re-pricing, same gates, auto-confirm under the system role', async () => {
    // docs/22 §4 R1 → S5 and docs/23 §8.15: the single most important retailer gap.
    const id = uuidv7()
    const drafted = await call<{ item: Detail }>(app, shop, 'POST', '/orders', {
      idempotencyKey: `create-shop3-${run}`,
      id,
      retailerId: retailerA,
      source: 'retailer_app',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 2, enteredUnit: 'piece' }],
    })
    expect(drafted.status).toBe(200)
    const submitted = await call<{
      item: Detail & { transitions: { event: string; actorId: string }[] }
    }>(app, shop, 'POST', `/orders/${id}/submit`, { idempotencyKey: `submit-shop-${run}` })
    expect(submitted.status).toBe(200)
    // `indicate` mode, inside every limit: confirmed on the spot, exactly as a rep's submit would be
    expect(submitted.body.item.state).toBe('confirmed')
    expect(submitted.body.item.orderNo).toMatch(/^SO-\d{4}$/)
    expect(submitted.body.item.approvalFlags).toEqual([])
    // the audit rows name the shopkeeper, not "system"
    expect(submitted.body.item.transitions.map((t) => t.event)).toEqual(['submit', 'confirm'])
    expect(submitted.body.item.transitions.every((t) => t.actorId === shopUserId)).toBe(true)
    // the pieces are held, and the escalation did not leak past the call
    const held = await db.execute(
      sql`select coalesce(sum(qty_pcs), 0)::int as held from reservations r
            join sales_order_lines l on l.id = r.order_line_id
           where l.order_id = ${id} and r.state = 'pending'`,
    )
    expect((held.rows[0] as { held: number }).held).toBe(2)
    expect((await call(app, shop, 'GET', '/approvals', { status: 'pending' })).status).toBe(403)
    // another shop's draft is never the caller's to submit
    expect(
      (
        await call(app, shop, 'POST', `/orders/${strictOrder}/submit`, {
          idempotencyKey: `submit-shop-other-${run}`,
        })
      ).status,
    ).not.toBe(200)
    // and the "pending undelivered" filter finds it, the states[] filter too
    const open = await call<{ items: { id: string }[] }>(app, shop, 'GET', '/orders', {
      openOnly: true,
    })
    expect(open.body.items.map((o) => o.id)).toContain(id)
    const byStates = await call<{ items: { id: string; state: string }[] }>(
      app,
      owner,
      'GET',
      '/orders',
      {
        'states[0]': 'confirmed',
        'states[1]': 'packed',
        retailerId: retailerA,
      },
    )
    expect(byStates.body.items.map((o) => o.id)).toContain(id)
    expect(byStates.body.items.every((o) => o.state === 'confirmed' || o.state === 'packed')).toBe(
      true,
    )
    // give the two pieces back so the stock arithmetic of the later tests is untouched
    const released = await call<{ item: Detail }>(app, owner, 'POST', `/orders/${id}/cancel`, {
      idempotencyKey: `cancel-shop3-${run}`,
      reason: 'test cleanup',
    })
    expect(released.body.item.state).toBe('cancelled')
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

  it("DOS-020: confirm on a credit-stop shop's order refuses while approvals are pending and decides none of them", async () => {
    // Retailer C is on credit `stop` and over its ₹10 limit, so submit holds the order on a `credit_limit` gate.
    // A second gate (below floor) is written as a fixture row the way the demo seed writes one: the engine in
    // this spec cannot price a line below its floor.
    const id = uuidv7()
    const drafted = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `dos020-create-${run}`,
      id,
      retailerId: retailerC,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
    })
    expect(drafted.status).toBe(200)
    const submitted = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${id}/submit`, {
      idempotencyKey: `dos020-submit-${run}`,
    })
    expect(submitted.status).toBe(200)
    expect(submitted.body.item.state).toBe('submitted')
    expect(submitted.body.item.approvalFlags).toEqual(['credit_limit'])
    const belowFloor = uuidv7()
    await db.insert(approvals).values({
      id: belowFloor,
      tenantId,
      kind: 'below_floor',
      orderId: id,
      entityType: 'order',
      entityId: id,
      requestedBy: repId,
      status: 'pending',
      payload: { flag: 'below_floor' },
    })

    try {
      const gates = async () =>
        (await db.select().from(approvals).where(eq(approvals.orderId, id))).sort((a, b) =>
          a.id.localeCompare(b.id),
        )
      const creditLimit = (await gates()).find((a) => a.kind === 'credit_limit')?.id ?? ''
      expect(creditLimit).not.toBe('')

      const refused = await call<{
        message: string
        data?: { code?: string; approvals?: { id: string; kind: string }[] }
      }>(app, manager, 'POST', `/orders/${id}/confirm`, { idempotencyKey: `dos020-confirm-${run}` })
      expect(refused.status).toBe(409)
      expect(refused.body.data?.code).toBe('approval_required')
      expect(
        [...(refused.body.data?.approvals ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(
        [
          { id: creditLimit, kind: 'credit_limit' },
          { id: belowFloor, kind: 'below_floor' },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      )
      expect(refused.body.message).toMatch(/credit limit/)
      expect(refused.body.message).toMatch(/below floor/)

      // nothing was decided, confirmed, held or announced by the refused call
      const after = await gates()
      expect(after).toHaveLength(2)
      for (const gate of after)
        expect(gate).toMatchObject({
          status: 'pending',
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
        })
      const orderRow = (await db.execute(sql`select state from sales_orders where id = ${id}`))
        .rows as { state: string }[]
      expect(orderRow).toEqual([{ state: 'submitted' }])
      const held = (
        await db.execute(
          sql`select count(*)::int as n from reservations r
                join sales_order_lines l on l.id = r.order_line_id
               where l.order_id = ${id}`,
        )
      ).rows as { n: number }[]
      expect(held[0]?.n).toBe(0)
      const trail = (
        await db.execute(
          sql`select event from order_state_transitions where order_id = ${id} order by occurred_at, id`,
        )
      ).rows as { event: string }[]
      expect(trail.map((t) => t.event)).toEqual(['submit'])
      const events = (
        await db.execute(
          sql`select event_type from outbox_events where aggregate_id = ${id} order by id`,
        )
      ).rows as { event_type: string }[]
      expect(events.map((e) => e.event_type)).not.toContain('OrderConfirmed')

      // the explicit path: each gate is decided by name, with a note, and the last approval confirms the order
      type Decided = { item: { status: string }; order: Detail | null }
      const first = await call<Decided>(app, manager, 'POST', `/approvals/${creditLimit}/decide`, {
        idempotencyKey: `dos020-decide-credit-${run}`,
        decision: 'approve',
        note: 'owner agreed once',
      })
      expect(first.status).toBe(200)
      expect(first.body.item.status).toBe('approved')
      expect(first.body.order?.state).toBe('submitted')

      const last = await call<Decided>(app, manager, 'POST', `/approvals/${belowFloor}/decide`, {
        idempotencyKey: `dos020-decide-floor-${run}`,
        decision: 'approve',
        note: 'rate agreed with the brand',
      })
      expect(last.status).toBe(200)
      expect(last.body.order?.state).toBe('confirmed')
      expect(last.body.order?.transitions.map((t) => t.event)).toEqual(['submit', 'confirm'])
      expect(
        (last.body.order?.approvals ?? [])
          .map(({ kind, status, decidedBy, decisionNote }) => ({
            kind,
            status,
            decidedBy,
            decisionNote,
          }))
          .sort((a, b) => a.kind.localeCompare(b.kind)),
      ).toEqual([
        {
          kind: 'below_floor',
          status: 'approved',
          decidedBy: managerId,
          decisionNote: 'rate agreed with the brand',
        },
        {
          kind: 'credit_limit',
          status: 'approved',
          decidedBy: managerId,
          decisionNote: 'owner agreed once',
        },
      ])
    } finally {
      // give back anything a confirm held, so the shortage arithmetic of the next test is untouched either way
      await call(app, owner, 'POST', `/orders/${id}/cancel`, {
        idempotencyKey: `dos020-cleanup-${run}`,
        reason: 'test cleanup',
      })
    }
  })

  it('reserves what exists and reports the shortage instead of refusing the order (DOS-020: gate decided before confirm)', async () => {
    // Retailer B is `strict` and over its limit, so submit holds this one on a `credit_limit` approval. Confirm
    // never decides an approval (DOS-020) and no product call leaves an order `submitted` with nothing pending,
    // so the gate is marked decided as a fixture: only a direct confirm reports `shortages`.
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
    await db
      .update(approvals)
      .set({
        status: 'approved',
        decidedBy: ownerId,
        decidedAt: new Date(),
        decisionNote: 'decided before confirm',
        updatedAt: new Date(),
      })
      .where(eq(approvals.orderId, id))

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
    // confirm left the gate exactly as it was decided: it decides nothing itself
    expect(
      confirmed.body.item.approvals.map(({ status, decidedBy, decisionNote }) => ({
        status,
        decidedBy,
        decisionNote,
      })),
    ).toEqual([{ status: 'approved', decidedBy: ownerId, decisionNote: 'decided before confirm' }])
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

  it('DOS-096: what the shop is quoted is what its placed order carries — GST per line, rounding and total', async () => {
    const la = uuidv7()
    const lb = uuidv7()
    // The retailer app prices its basket through pricing.quote before "Place order" (R7).
    const quote = await call<Quote>(app, shop, 'POST', '/pricing/quote', {
      retailerId: retailerA,
      lines: [
        { lineId: la, variantId: variantA, qtyPcs: 24 },
        { lineId: lb, variantId: variantB, qtyPcs: 7 },
      ],
    })
    expect(quote.status).toBe(200)
    // 24 × ₹10 + 7 × ₹25 = ₹415.00; 12% GST ₹28.80 + ₹21.00 = ₹49.80; ₹464.80 rounds to ₹465 with +20 paise
    expect(quote.body.totals).toMatchObject({
      grossPaise: 41_500,
      netPaise: 41_500,
      taxPaise: 4_980,
      roundOffPaise: 20,
      totalPaise: 46_500,
    })

    const placed = await call<{ item: Detail }>(app, shop, 'POST', '/orders', {
      idempotencyKey: `create-dos096-${run}`,
      id: uuidv7(),
      retailerId: retailerA,
      source: 'retailer_app',
      lines: [
        { id: la, variantId: variantA, enteredQty: 2, enteredUnit: 'case' },
        { id: lb, variantId: variantB, enteredQty: 7, enteredUnit: 'piece' },
      ],
    })
    expect(placed.status).toBe(200)
    const order = placed.body.item
    expect(order).toMatchObject({
      subtotalPaise: quote.body.totals.grossPaise,
      taxPaise: quote.body.totals.taxPaise,
      roundOffPaise: quote.body.totals.roundOffPaise,
      totalPaise: quote.body.totals.totalPaise,
    })
    const byId = new Map(order.lines.map((line) => [line.id, line]))
    for (const quoted of quote.body.lines)
      expect(byId.get(quoted.lineId)).toMatchObject({
        gstBps: quoted.gstBps,
        taxPaise: quoted.taxPaise,
        lineTotalPaise: quoted.lineTotalPaise,
      })
    expect(byId.get(la)).toMatchObject({ gstBps: 1_200, taxPaise: 2_880, lineTotalPaise: 26_880 })
    expect(byId.get(lb)).toMatchObject({ gstBps: 1_200, taxPaise: 2_100, lineTotalPaise: 19_600 })
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

  // -----------------------------------------------------------------------------------------------------
  // DOS-073: staff RLS on `sales_orders` is tenant-wide on purpose (billing, warehouse, delivery and reporting
  // read it), so the order procedures themselves must keep a salesperson to the orders credited to it — the
  // same `salesperson_id = me` rule the device pull applies. A colleague's order answers exactly like an id
  // nobody holds, before any state check can reveal it, and nothing is written.

  describe('DOS-073 a salesperson reaches only the orders credited to it', () => {
    const rep2Id = uuidv7()
    const rep2: Actor = { tenantId, actorId: rep2Id, role: 'salesperson' }
    const rep2Confirmed = uuidv7()
    const rep2ConfirmedLine = uuidv7()
    const rep2Draft = uuidv7()
    const rep2DraftLine = uuidv7()
    const rep2Orders = [rep2Confirmed, rep2Draft]

    beforeAll(async () => {
      await db.insert(users).values({ id: rep2Id, phone: `+91904${run}4`, name: 'Second rep' })
      await db
        .insert(memberships)
        .values({ id: uuidv7(), tenantId, userId: rep2Id, role: 'salesperson' })
      // Every piece of variant A is held by now (100 of 100), so rep2's order needs stock of its own for its
      // reservation — the thing a wrongful cancel would release — to exist at all.
      const inventory = app.get(InventoryService)
      await asOwner(async (tx) => {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId: variantA,
          batchNo: `DOS073-${run}`,
          mrpPaise: 4000,
        })
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: 5,
            reason: 'opening',
            idempotencyKey: `open-${run}-dos073`,
          },
        ])
      })
      // rep2's confirmed order (retailer A is `indicate`, so submit confirms it and holds the piece)…
      const drafted = await call<{ item: Detail }>(app, rep2, 'POST', '/orders', {
        idempotencyKey: `dos073-create-confirmed-${run}`,
        id: rep2Confirmed,
        retailerId: retailerA,
        source: 'salesperson',
        lines: [
          { id: rep2ConfirmedLine, variantId: variantA, enteredQty: 1, enteredUnit: 'piece' },
        ],
      })
      expect(drafted.status).toBe(200)
      const submitted = await call<{ item: Detail }>(
        app,
        rep2,
        'POST',
        `/orders/${rep2Confirmed}/submit`,
        { idempotencyKey: `dos073-submit-confirmed-${run}` },
      )
      expect(submitted.body.item.state).toBe('confirmed')
      // …and a draft with one line, so a wrongful submit would be a real write rather than a 400
      const draft = await call<{ item: Detail }>(app, rep2, 'POST', '/orders', {
        idempotencyKey: `dos073-create-draft-${run}`,
        id: rep2Draft,
        retailerId: retailerA,
        source: 'salesperson',
        lines: [{ id: rep2DraftLine, variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
      })
      expect(draft.body.item.state).toBe('draft')
    })

    type ErrorBody = { message: string; code?: string; status?: number }

    /** The same call against a random id nobody holds, then against `id`: both must be the same 404. */
    const expectAnswersLikeMissing = async (
      method: 'GET' | 'POST',
      path: (id: string) => string,
      id: string,
      body: (tag: string) => Record<string, unknown> | undefined,
    ) => {
      const missingId = uuidv7()
      const missing = await call<ErrorBody>(app, rep, method, path(missingId), body('missing'))
      const refused = await call<ErrorBody>(app, rep, method, path(id), body('refused'))
      expect(missing.status).toBe(404)
      expect(missing.body.message).toBe(`order ${missingId} not found`)
      expect(refused.status).toBe(404)
      expect(refused.body).toEqual({
        ...missing.body,
        message: missing.body.message.replace(missingId, id),
      })
    }

    /** Everything a wrongful cancel, re-line, submit or re-head would change on rep2's two orders. */
    const snapshot = async () => {
      const orders = (
        await db.execute(
          sql`select id, state, order_no, cancelled_at, cancel_reason, note, total_paise, updated_at
                from sales_orders where id in (${rep2Confirmed}, ${rep2Draft}) order by id`,
        )
      ).rows as { id: string; state: string; cancelled_at: unknown; note: string | null }[]
      const lines = (
        await db.execute(
          sql`select id, order_id, qty_pcs from sales_order_lines
               where order_id in (${rep2Confirmed}, ${rep2Draft}) order by id`,
        )
      ).rows as { id: string; order_id: string }[]
      const held = (
        await db.execute(
          sql`select r.order_line_id, r.qty, r.state from reservations r
                join sales_order_lines l on l.id = r.order_line_id
               where l.order_id in (${rep2Confirmed}, ${rep2Draft}) order by r.id`,
        )
      ).rows as { order_line_id: string; qty: number; state: string }[]
      const transitions = (
        await db.execute(
          sql`select order_id, event, actor_id from order_state_transitions
               where order_id in (${rep2Confirmed}, ${rep2Draft}) order by id`,
        )
      ).rows as { order_id: string; event: string; actor_id: string }[]
      const events = (
        await db.execute(
          sql`select aggregate_id, event_type from outbox_events
               where aggregate_id in (${rep2Confirmed}, ${rep2Draft}) order by id`,
        )
      ).rows as { aggregate_id: string; event_type: string }[]
      return { orders, lines, held, transitions, events }
    }

    it("DOS-073: a salesperson cannot cancel, re-line or submit another rep's order — 404 with the missing-id message, checked before the draft-state 409, nothing written", async () => {
      const before = await snapshot()
      const oneLine = () => [
        { id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' },
      ]

      // the finding's probe: cancel a colleague's CONFIRMED order
      await expectAnswersLikeMissing(
        'POST',
        (id) => `/orders/${id}/cancel`,
        rep2Confirmed,
        (tag) => ({
          idempotencyKey: `dos073-cancel-${tag}-${run}`,
          reason: 'DOS-073 probe: cancelling another rep’s confirmed order',
        }),
      )
      // re-lining a colleague's CONFIRMED order is a 404, not the 409 that would reveal its state
      await expectAnswersLikeMissing(
        'POST',
        (id) => `/orders/${id}/lines`,
        rep2Confirmed,
        (tag) => ({
          idempotencyKey: `dos073-lines-confirmed-${tag}-${run}`,
          lines: oneLine(),
        }),
      )
      // a colleague's DRAFT can be neither re-lined nor submitted
      await expectAnswersLikeMissing(
        'POST',
        (id) => `/orders/${id}/lines`,
        rep2Draft,
        (tag) => ({
          idempotencyKey: `dos073-lines-draft-${tag}-${run}`,
          lines: oneLine(),
        }),
      )
      await expectAnswersLikeMissing(
        'POST',
        (id) => `/orders/${id}/submit`,
        rep2Draft,
        (tag) => ({
          idempotencyKey: `dos073-submit-draft-${tag}-${run}`,
        }),
      )

      // nothing written: states, lines, the held piece, the audit trail and the outbox are all as they were
      const after = await snapshot()
      expect(after).toEqual(before)
      const orderRow = (id: string) => after.orders.find((o) => o.id === id)
      expect(orderRow(rep2Confirmed)).toMatchObject({ state: 'confirmed', cancelled_at: null })
      expect(orderRow(rep2Draft)).toMatchObject({ state: 'draft', cancelled_at: null })
      expect(after.held).toEqual([{ order_line_id: rep2ConfirmedLine, qty: 1, state: 'pending' }])
      expect(after.lines.filter((l) => l.order_id === rep2Draft).map((l) => l.id)).toEqual([
        rep2DraftLine,
      ])
      expect(after.transitions.filter((t) => t.actor_id === repId)).toEqual([])
      expect(after.events.map((e) => e.event_type)).not.toContain('OrderCancelled')

      // positive control: the rep the order is credited to still cancels it, and the held piece goes back
      const own = await call<{ item: Detail }>(
        app,
        rep2,
        'POST',
        `/orders/${rep2Confirmed}/cancel`,
        {
          idempotencyKey: `dos073-cancel-own-${run}`,
          reason: 'shop changed its mind',
        },
      )
      expect(own.status).toBe(200)
      expect(own.body.item.state).toBe('cancelled')
      expect((await snapshot()).held).toEqual([
        { order_line_id: rep2ConfirmedLine, qty: 1, state: 'voided' },
      ])
    })

    it("DOS-073: a salesperson reads only its own orders — get answers 404 and list ignores another rep's salespersonId", async () => {
      for (const id of rep2Orders)
        await expectAnswersLikeMissing(
          'GET',
          (x) => `/orders/${x}`,
          id,
          () => undefined,
        )

      type Listed = { items: { id: string; salespersonId: string | null }[] }
      // asking for the colleague by name does not widen the list
      const asked = await call<Listed>(app, rep, 'GET', '/orders', {
        salespersonId: rep2Id,
        limit: 200,
      })
      expect(asked.status).toBe(200)
      expect(asked.body.items.map((o) => o.id)).toContain(orderOne)
      expect(asked.body.items.every((o) => o.salespersonId === repId)).toBe(true)
      // and the unfiltered list is the rep's own: no colleague's order, no shop order credited to nobody
      const unfiltered = await call<Listed>(app, rep, 'GET', '/orders', { limit: 200 })
      expect(unfiltered.status).toBe(200)
      const ids = unfiltered.body.items.map((o) => o.id)
      expect(ids).toContain(orderOne)
      for (const id of [...rep2Orders, shopOrder]) expect(ids).not.toContain(id)
      expect(unfiltered.body.items.every((o) => o.salespersonId === repId)).toBe(true)

      // positive controls: rep2 reads its own orders, and the desk still lists them by rep
      const ownGet = await call<{ item: Detail }>(app, rep2, 'GET', `/orders/${rep2Draft}`)
      expect(ownGet.status).toBe(200)
      expect(ownGet.body.item.lines.map((l) => l.id)).toEqual([rep2DraftLine])
      const ownList = await call<Listed>(app, rep2, 'GET', '/orders', { limit: 200 })
      expect(ownList.body.items.map((o) => o.id).sort()).toEqual([...rep2Orders].sort())
      const desk = await call<Listed>(app, owner, 'GET', '/orders', {
        salespersonId: rep2Id,
        limit: 200,
      })
      expect(desk.status).toBe(200)
      expect(desk.body.items.map((o) => o.id).sort()).toEqual([...rep2Orders].sort())
    })

    it("DOS-073: a device upload cannot re-head or re-line another rep's draft", async () => {
      const before = await snapshot()
      type Uploaded = {
        accepted: number
        replayed: number
        rejected: { opId: string; code: string }[]
      }
      const res = await call<Uploaded>(app, rep, 'POST', '/sync/upload', {
        protocol: 1,
        deviceId: `dos073-device-${run}`,
        ops: [
          {
            opId: `dos073-so-${run}`,
            op: 'PUT',
            table: 'sales_orders',
            id: rep2Draft,
            data: { retailer_id: retailerA, state: 'draft', note: 'DOS-073 re-head' },
          },
          {
            opId: `dos073-sol-${run}`,
            op: 'PUT',
            table: 'sales_order_lines',
            id: uuidv7(),
            data: {
              order_id: rep2Draft,
              variant_id: variantA,
              entered_qty: 1,
              entered_unit: 'case',
            },
          },
        ],
      })
      expect(res.status).toBe(200)
      expect(res.body.accepted).toBe(0)
      expect(res.body.rejected.map((r) => [r.opId, r.code])).toEqual([
        [`dos073-so-${run}`, 'conflict'],
        [`dos073-sol-${run}`, 'order_not_found'],
      ])
      expect(await snapshot()).toEqual(before)

      // positive control: rep2's own device still edits its own draft, header and lines
      const own = await call<Uploaded>(app, rep2, 'POST', '/sync/upload', {
        protocol: 1,
        deviceId: `dos073-device2-${run}`,
        ops: [
          {
            opId: `dos073-own-so-${run}`,
            op: 'PUT',
            table: 'sales_orders',
            id: rep2Draft,
            data: { retailer_id: retailerA, state: 'draft', note: 'DOS-073 own edit' },
          },
          {
            opId: `dos073-own-sol-${run}`,
            op: 'PUT',
            table: 'sales_order_lines',
            id: uuidv7(),
            data: {
              order_id: rep2Draft,
              variant_id: variantA,
              entered_qty: 1,
              entered_unit: 'piece',
            },
          },
        ],
      })
      expect(own.body.rejected).toEqual([])
      expect(own.body.accepted).toBe(2)
      const edited = await snapshot()
      expect(edited.orders.find((o) => o.id === rep2Draft)?.note).toBe('DOS-073 own edit')
      expect(edited.lines.filter((l) => l.order_id === rep2Draft)).toHaveLength(2)
    })
  })

  // -----------------------------------------------------------------------------------------------------
  // DOS-005: a bargain gate names the bargain request it waits on (`entity_type = 'bargain_request'`, one gate per
  // request, the demo seed's shape), and deciding the gate decides that request in the same transaction. The queue
  // then holds one record per bargain, and an owner's "no" reaches the shop and the rep instead of leaving the
  // request approvable from the Rate requests tab. Retailer A is `indicate` and nothing here prices under the
  // floor, so `bargain` is the only gate these orders raise.

  type Gate = {
    id: string
    kind: string
    orderId: string | null
    entityType: string
    entityId: string
    status: string
    payload: Record<string, unknown>
  }
  type Decided = { item: { status: string; decidedBy: string | null }; order: Detail | null }
  const bargainRow = async (id: string) =>
    (await db.select().from(bargainRequests).where(eq(bargainRequests.id, id)))[0]

  it('DOS-005: a bargain gate names the bargain request it waits on, and rejecting the gate rejects that request', async () => {
    const orderId = uuidv7()
    const bargainId = uuidv7()
    const drafted = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `dos005-create-${run}`,
      id: orderId,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'case' }],
    })
    expect(drafted.status).toBe(200)
    expect(drafted.body.item.lines[0]).toMatchObject({ qtyPcs: 12, ratePaise: 1_000 })

    // the sales app's path: the rep asks a rate for this draft; it has no bound here, so the desk decides
    const asked = await call<{ item: { status: string } }>(app, rep, 'POST', '/pricing/bargains', {
      idempotencyKey: `dos005-ask-${run}`,
      id: bargainId,
      retailerId: retailerA,
      variantId: variantA,
      askedRatePaise: 900,
      qtyPcs: 12,
      orderId,
    })
    expect(asked.status).toBe(200)
    expect(asked.body.item.status).toBe('requested')

    const submitted = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${orderId}/submit`, {
      idempotencyKey: `dos005-submit-${run}`,
    })
    expect(submitted.status).toBe(200)
    expect(submitted.body.item.state).toBe('submitted')
    expect(submitted.body.item.approvalFlags).toEqual(['bargain'])

    const queue = await call<{ items: Gate[] }>(app, owner, 'GET', '/approvals', {
      status: 'pending',
      orderId,
    })
    expect(queue.status).toBe(200)
    expect(queue.body.items).toHaveLength(1)
    const gate = queue.body.items[0]
    expect(gate).toMatchObject({
      kind: 'bargain',
      orderId,
      entityType: 'bargain_request',
      entityId: bargainId,
    })
    expect(typeof gate?.payload.orderNo).toBe('string')

    const decided = await call<Decided>(app, owner, 'POST', `/approvals/${gate?.id ?? ''}/decide`, {
      idempotencyKey: `dos005-reject-${run}`,
      decision: 'reject',
      note: 'list rate holds',
    })
    expect(decided.status).toBe(200)
    expect(decided.body.item.status).toBe('rejected')
    expect(decided.body.order).toMatchObject({
      state: 'cancelled',
      cancelReason: 'approval_rejected',
    })

    // the owner's "no" reached the request itself, which the rep's device and the shop pull
    const bargain = await bargainRow(bargainId)
    expect(bargain).toMatchObject({
      status: 'rejected',
      approvedRatePaise: null,
      decidedBy: ownerId,
      note: 'list rate holds',
    })
    expect(bargain?.decidedAt).not.toBeNull()
    // and its Rate requests copy is closed: it can no longer be granted from the other tab
    const again = await call(app, owner, 'POST', `/pricing/bargains/${bargainId}/decide`, {
      idempotencyKey: `dos005-reapprove-${run}`,
      id: bargainId,
      decision: 'approve',
    })
    expect(again.status).toBe(409)
  })

  it('DOS-005: approving an approval that names a bargain request approves the request at the asked rate and closes its other copy', async () => {
    // The demo seed's standalone gate: it names the request and has no order behind it. The request's order id
    // points at no order, so it gates nothing else in this spec.
    const bargainId = uuidv7()
    const approvalId = uuidv7()
    await db.insert(bargainRequests).values({
      id: bargainId,
      tenantId,
      retailerId: retailerB,
      variantId: variantB,
      orderId: uuidv7(),
      requestedBy: repId,
      listRatePaise: 2_500,
      askedRatePaise: 2_300,
      status: 'requested',
    })
    await db.insert(approvals).values({
      id: approvalId,
      tenantId,
      kind: 'bargain',
      orderId: null,
      entityType: 'bargain_request',
      entityId: bargainId,
      requestedBy: repId,
      status: 'pending',
      payload: {},
    })

    const decided = await call<Decided>(app, owner, 'POST', `/approvals/${approvalId}/decide`, {
      idempotencyKey: `dos005-approve-${run}`,
      decision: 'approve',
    })
    expect(decided.status).toBe(200)
    expect(decided.body.item).toMatchObject({ status: 'approved', decidedBy: ownerId })
    expect(decided.body.order).toBeNull()

    const bargain = await bargainRow(bargainId)
    expect(bargain).toMatchObject({
      status: 'approved',
      approvedRatePaise: 2_300,
      decidedBy: ownerId,
    })
    expect(bargain?.decidedAt).not.toBeNull()

    // neither copy can be decided a second time, and the request has left the Rate requests list
    const twice = await call(app, owner, 'POST', `/approvals/${approvalId}/decide`, {
      idempotencyKey: `dos005-approve-again-${run}`,
      decision: 'reject',
      note: 'changed my mind',
    })
    expect(twice.status).toBe(409)
    const other = await call(app, owner, 'POST', `/pricing/bargains/${bargainId}/decide`, {
      idempotencyKey: `dos005-bargain-again-${run}`,
      id: bargainId,
      decision: 'reject',
    })
    expect(other.status).toBe(409)
    const requested = await call<{ items: { id: string }[] }>(
      app,
      owner,
      'GET',
      '/pricing/bargains',
      { status: 'requested', retailerId: retailerB, limit: 200 },
    )
    expect(requested.status).toBe(200)
    expect(requested.body.items.map((b) => b.id)).not.toContain(bargainId)
  })

  it('DOS-005: two bargains on one order raise two gates, each approval approves its own request, and the order confirms only after both', async () => {
    const orderId = uuidv7()
    const bargainA = uuidv7()
    const bargainB = uuidv7()
    const drafted = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `dos005-two-create-${run}`,
      id: orderId,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [
        { id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' },
        { id: uuidv7(), variantId: variantB, enteredQty: 1, enteredUnit: 'piece' },
      ],
    })
    expect(drafted.status).toBe(200)

    try {
      const asks = [
        { id: bargainA, variantId: variantA, askedRatePaise: 900 }, // list ₹10.00
        { id: bargainB, variantId: variantB, askedRatePaise: 2_300 }, // list ₹25.00
      ]
      for (const ask of asks) {
        const asked = await call<{ item: { status: string } }>(
          app,
          rep,
          'POST',
          '/pricing/bargains',
          {
            idempotencyKey: `dos005-two-ask-${ask.id}`,
            ...ask,
            retailerId: retailerA,
            qtyPcs: 1,
            orderId,
          },
        )
        expect(asked.status).toBe(200)
        expect(asked.body.item.status).toBe('requested')
      }

      const submitted = await call<{ item: Detail }>(
        app,
        rep,
        'POST',
        `/orders/${orderId}/submit`,
        {
          idempotencyKey: `dos005-two-submit-${run}`,
        },
      )
      expect(submitted.status).toBe(200)
      expect(submitted.body.item.state).toBe('submitted')
      expect(submitted.body.item.approvalFlags).toEqual(['bargain'])

      const queue = await call<{ items: Gate[] }>(app, owner, 'GET', '/approvals', {
        status: 'pending',
        orderId,
      })
      expect(queue.status).toBe(200)
      expect(queue.body.items.map((g) => [g.kind, g.entityType])).toEqual([
        ['bargain', 'bargain_request'],
        ['bargain', 'bargain_request'],
      ])
      expect(queue.body.items.map((g) => g.entityId).sort()).toEqual([bargainA, bargainB].sort())
      const gateFor = (bargainId: string) =>
        queue.body.items.find((g) => g.entityId === bargainId)?.id ?? ''

      const first = await call<Decided>(
        app,
        owner,
        'POST',
        `/approvals/${gateFor(bargainA)}/decide`,
        {
          idempotencyKey: `dos005-two-approve-a-${run}`,
          decision: 'approve',
        },
      )
      expect(first.status).toBe(200)
      expect(first.body.order?.state).toBe('submitted')
      expect(await bargainRow(bargainA)).toMatchObject({
        status: 'approved',
        approvedRatePaise: 900,
        decidedBy: ownerId,
      })
      expect(await bargainRow(bargainB)).toMatchObject({ status: 'requested', decidedBy: null })

      const last = await call<Decided>(
        app,
        owner,
        'POST',
        `/approvals/${gateFor(bargainB)}/decide`,
        {
          idempotencyKey: `dos005-two-approve-b-${run}`,
          decision: 'approve',
        },
      )
      expect(last.status).toBe(200)
      expect(last.body.order?.state).toBe('confirmed')
      expect(await bargainRow(bargainB)).toMatchObject({
        status: 'approved',
        approvedRatePaise: 2_300,
        decidedBy: ownerId,
      })
    } finally {
      // give back the piece a confirm held, so nothing after this spec inherits it
      await call(app, owner, 'POST', `/orders/${orderId}/cancel`, {
        idempotencyKey: `dos005-two-cleanup-${run}`,
        reason: 'test cleanup',
      })
    }
  })
})
