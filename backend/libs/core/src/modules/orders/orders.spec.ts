import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { ORPCError } from '@orpc/server'
import { permissionFor, SYNC_REJECTION_CODES, type Quote } from '@dos/contracts'
import { businessDate, uuidv7 } from '@dos/domain'
import {
  approvals,
  auditLog,
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
  salesOrderLines,
  salesOrders,
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
import { SyncModule, SyncRejection } from '../sync/index.js'
import { OrdersModule, OrdersService } from './index.js'
import { ORDER_PLACERS } from './orders.internals.js'
import { requirePlacer } from './orders.sync.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type Line = {
  id: string
  lineNo: number
  variantId: string
  variantName: string
  enteredQty: number
  enteredUnit: string
  packSizeAtEntry: number
  qtyPcs: number
  gstBps: number
  cessBps: number
  cessPaise: number
  taxPaise: number
  lineTotalPaise: number
  listRatePaise: number
  ratePaise: number
  discountBps: number
  discountPaise: number
  appliedRules: { ruleId: string; kind: string; amountPaise?: number }[]
  priceLocked: boolean
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
  cessPaise: number
  taxPaise: number
  roundOffPaise: number
  totalPaise: number
  approvalFlags: string[]
  stockShortages: Shortage[]
  creditNotice: {
    creditMode: string
    reasons: string[]
    outstandingPaise: number
    creditLimitPaise: number
    headroomPaise: number
    overdueDays: number
    orderTotalPaise: number
  } | null
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
type Shortage = {
  lineId: string
  variantId: string
  requestedPcs: number
  reservedPcs: number
  shortQtyPcs: number
}
/** The device side of the same aggregate: what `sync.manifest` publishes and what `sync.pull` sends. */
type Manifest = { tables: { table: string; columns: { name: string }[] }[] }
type Pull = { changes: { table: string; rows: Record<string, unknown>[] }[] }

describeDb('orders (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const hsn = `8${Date.now().toString().slice(-6)}`
  /** DOS-079: aerated waters — 28% GST plus 12% compensation cess, the rate Campa Cola is billed at. */
  const cessHsn = `9${Date.now().toString().slice(-6)}`
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const repId = uuidv7()
  const shopUserId = uuidv7()
  const managerId = uuidv7()
  const retailerA = uuidv7() // credit mode `indicate`, linked to shopUserId
  const retailerB = uuidv7() // credit mode `strict` with a ₹10 limit
  const retailerC = uuidv7() // credit mode `stop` with a ₹10 limit (DOS-020)
  const retailerD = uuidv7() // DOS-081: `indicate` with room to spare — no notice at all
  const variantA = uuidv7() // 100 pcs in the godown
  const variantB = uuidv7() // no stock at all
  const variantCess = uuidv7() // DOS-079: on `cessHsn`, 28% GST + 12% cess, ₹22.97 a piece
  const variantShort = uuidv7() // DOS-078: 120 pcs (10 cs) in the godown and nothing more
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
  const strictOrderDos004 = uuidv7() // DOS-004: a second over-limit order for Shop B, left pending
  const tripApprovalDos004 = uuidv7() // DOS-004: an approval with no order behind it
  const strictOrderDos006 = uuidv7() // DOS-006: an over-limit order released by its gate
  const strictOrderDos006Next = uuidv7() // DOS-006: the shop's next order, gated again
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
      // `+91904${run}4` is the DOS-073 block's second rep, `6` and `7` the DOS-115 block's godown and crew,
      // `8` the DOS-098 block's rep with no order; phones are unique platform-wide
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
      {
        id: variantCess,
        productId,
        name: 'Campa Cola 750 ml (cess)',
        netQty: 750,
        netUnit: 'ml',
        defaultCaseSize: 24,
        hsnCode: cessHsn,
        mrpPaise: 4000,
      },
      {
        id: variantShort,
        productId,
        name: 'Neelam Sandal Soap 3x100 g',
        netQty: 300,
        netUnit: 'g',
        defaultCaseSize: 24,
        hsnCode: hsn,
        mrpPaise: 3000,
      },
    ])
    // the tenant sells in 12s even though the manufacturer prints 24 (docs/17 B: sell-side pack wins)
    await db.insert(tenantProducts).values([
      { id: uuidv7(), tenantId, variantId: variantA, caseSizeOverride: 12 },
      { id: uuidv7(), tenantId, variantId: variantB, caseSizeOverride: 12 },
      { id: uuidv7(), tenantId, variantId: variantCess, caseSizeOverride: 12 },
      { id: uuidv7(), tenantId, variantId: variantShort, caseSizeOverride: 12 },
    ])
    await db.insert(hsnRates).values([
      { id: uuidv7(), hsnCode: hsn, gstBps: 1200, effectiveFrom: '2020-04-01' },
      { id: uuidv7(), hsnCode: cessHsn, gstBps: 2800, cessBps: 1200, effectiveFrom: '2020-04-01' },
    ])

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
      {
        id: retailerD,
        tenantId,
        code: `R4-${run}`,
        name: `Shop D ${run}`,
        phone: `+91905${run}4`,
        stateCode: '27',
        tier: 'C',
        creditMode: 'indicate',
        creditLimitPaise: 10_000_000,
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
      { id: uuidv7(), tenantId, priceListId, variantId: variantCess, ratePaise: 2297 },
      { id: uuidv7(), tenantId, priceListId, variantId: variantShort, ratePaise: 1000 },
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

  it('DOS-160: a stored reply survives an additive output-schema change instead of answering 500 on replay', async () => {
    // simulates a reply stored before DOS-003 added the required `variantName` field to every order line: the
    // client already holds this exact body (or would, on a lost reply), so a same-key, same-payload retry must
    // hand it back untouched rather than being re-validated against the contract as it stands today.
    const id = uuidv7()
    const lineId = uuidv7()
    const key = `dos160-replay-${run}`
    const body = {
      idempotencyKey: key,
      id,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [{ id: lineId, variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
    }
    const created = await call<{ item: Detail }>(app, rep, 'POST', '/orders', body)
    expect(created.status).toBe(200)
    expect(created.body.item.lines[0]?.variantName).toBeTruthy()

    await db.execute(sql`
      update idempotency_keys
      set response = jsonb_set(response, '{item,lines,0}', (response #> '{item,lines,0}') - 'variantName')
      where tenant_id = ${tenantId} and key = ${key}
    `)

    const replay = await call<{ item: Detail }>(app, rep, 'POST', '/orders', body)
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(id)
    // the stale, field-missing row comes back byte-for-byte — that is what "replay" means — not a fresh detail
    expect((replay.body.item.lines[0] as { variantName?: string }).variantName).toBeUndefined()
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

  // -----------------------------------------------------------------------------------------------------
  // DOS-004: the approvals queue names the shop, the order number and the order total, read from the
  // approval's own order when the list is asked, never from its payload (the demo seed and older rows shape
  // the payload differently). An approval with no order behind it lists with all four fields null.

  type QueueItem = {
    id: string
    kind: string
    orderId: string | null
    payload: Record<string, unknown>
    orderNo: string | null
    orderTotalPaise: number | null
    retailerId: string | null
    retailerName: string | null
  }

  it('DOS-004: the approvals queue names the shop, the order number and the total of an order approval', async () => {
    const drafted = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-dos004-${run}`,
      id: strictOrderDos004,
      retailerId: retailerB,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantB, enteredQty: 1, enteredUnit: 'case' }],
    })
    expect(drafted.status).toBe(200)
    const submitted = await call<{ item: Detail }>(
      app,
      rep,
      'POST',
      `/orders/${strictOrderDos004}/submit`,
      { idempotencyKey: `submit-dos004-${run}` },
    )
    expect(submitted.status).toBe(200)
    expect(submitted.body.item.state).toBe('submitted')
    expect(submitted.body.item.approvalFlags).toEqual(['credit_limit'])
    expect(submitted.body.item.orderNo).toMatch(/^SO-/)

    const queue = await call<{ items: QueueItem[] }>(app, owner, 'GET', '/approvals', {
      status: 'pending',
    })
    expect(queue.status).toBe(200)
    const item = queue.body.items.find((a) => a.orderId === strictOrderDos004)
    expect(item).toMatchObject({
      kind: 'credit_limit',
      orderNo: submitted.body.item.orderNo,
      orderTotalPaise: submitted.body.item.totalPaise,
      retailerId: retailerB,
      retailerName: `Shop B ${run}`,
    })
  })

  it('DOS-004: an approval whose payload carries no order number still names the order and shop from its order', async () => {
    const order = await call<{ item: Detail }>(app, owner, 'GET', `/orders/${strictOrderDos004}`)
    expect(order.status).toBe(200)
    expect(order.body.item.orderNo).toMatch(/^SO-/)
    // the demo seed's shape: a retailer entity asking for a limit, with no orderNo or totalPaise in the payload
    const seedShaped = uuidv7()
    await db.insert(approvals).values({
      id: seedShaped,
      tenantId,
      kind: 'credit_limit',
      orderId: strictOrderDos004,
      entityType: 'retailer',
      entityId: retailerB,
      requestedBy: repId,
      status: 'pending',
      payload: { currentLimitPaise: 1000, requestedLimitPaise: 3000, reason: 'DOS-004 seed shape' },
    })

    const queue = await call<{ items: QueueItem[] }>(app, owner, 'GET', '/approvals', {
      status: 'pending',
      kind: 'credit_limit',
    })
    expect(queue.status).toBe(200)
    const item = queue.body.items.find((a) => a.id === seedShaped)
    expect(item?.payload.orderNo).toBeUndefined()
    expect(item).toMatchObject({
      orderNo: order.body.item.orderNo,
      orderTotalPaise: order.body.item.totalPaise,
      retailerId: retailerB,
      retailerName: `Shop B ${run}`,
    })
  })

  it('DOS-004: an approval that is not on an order lists with null shop and order fields', async () => {
    await db.insert(approvals).values({
      id: tripApprovalDos004,
      tenantId,
      kind: 'trip_settlement',
      orderId: null,
      entityType: 'trip',
      entityId: uuidv7(),
      requestedBy: ownerId,
      status: 'pending',
      payload: { cashVariancePaise: -500 },
    })

    const queue = await call<{ items: QueueItem[] }>(app, owner, 'GET', '/approvals', {
      kind: 'trip_settlement',
    })
    expect(queue.status).toBe(200)
    const item = queue.body.items.find((a) => a.id === tripApprovalDos004)
    expect(item).toBeDefined()
    expect(item?.orderNo).toBeNull()
    expect(item?.orderTotalPaise).toBeNull()
    expect(item?.retailerId).toBeNull()
    expect(item?.retailerName).toBeNull()
  })

  // -----------------------------------------------------------------------------------------------------
  // DOS-006: an "Over credit limit" approval RELEASES THE ORDER; it does not change the shop's limit.
  // Founder, 2026-09-13 (docs/22 §8): approving lets only that one order through, and the limit is a
  // setting changed on the shop's page (`retailers.setCredit`, audited). This guard pins the semantics
  // so the alternative — approve also raises the limit — cannot arrive without a decision to allow it.

  it('DOS-006: approving an over-limit gate lets only that order through — the limit is unchanged, no set_credit is audited, and the next order raises a fresh gate', async () => {
    const [before] = await db
      .select({ limit: retailers.creditLimitPaise })
      .from(retailers)
      .where(eq(retailers.id, retailerB))
    expect(before?.limit).toBe(1000)

    await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-dos006-${run}`,
      id: strictOrderDos006,
      retailerId: retailerB,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantB, enteredQty: 1, enteredUnit: 'case' }],
    })
    const submitted = await call<{ item: Detail }>(
      app,
      rep,
      'POST',
      `/orders/${strictOrderDos006}/submit`,
      { idempotencyKey: `submit-dos006-${run}` },
    )
    expect(submitted.status).toBe(200)
    expect(submitted.body.item.approvalFlags).toEqual(['credit_limit'])

    // The gate production raises names the ORDER it releases, and asks for no limit at all.
    const [gate] = await asOwner((tx) =>
      tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.orderId, strictOrderDos006), eq(approvals.kind, 'credit_limit'))),
    )
    expect(gate?.entityType).toBe('sales_order')
    expect(gate?.entityId).toBe(strictOrderDos006)
    expect(gate?.payload).toEqual({
      orderNo: submitted.body.item.orderNo,
      totalPaise: submitted.body.item.totalPaise,
      flag: 'credit_limit',
    })

    const decided = await call<{ item: { status: string }; order: Detail | null }>(
      app,
      owner,
      'POST',
      `/approvals/${gate?.id ?? ''}/decide`,
      { idempotencyKey: `decide-dos006-${run}`, decision: 'approve', note: 'festive stocking' },
    )
    expect(decided.status).toBe(200)
    expect(decided.body.item.status).toBe('approved')
    expect(decided.body.order?.state).toBe('confirmed')

    // The shop is exactly where it was: same limit, and nothing claims a limit was set.
    const [after] = await db
      .select({ limit: retailers.creditLimitPaise })
      .from(retailers)
      .where(eq(retailers.id, retailerB))
    expect(after?.limit).toBe(before?.limit)
    const credits = await asOwner((tx) =>
      tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.action, 'retailer.set_credit'), eq(auditLog.entityId, retailerB))),
    )
    expect(credits).toEqual([])

    // So the shop's next over-limit order is gated again, exactly as the first one was.
    await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-dos006-next-${run}`,
      id: strictOrderDos006Next,
      retailerId: retailerB,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantB, enteredQty: 1, enteredUnit: 'case' }],
    })
    const next = await call<{ item: Detail }>(
      app,
      rep,
      'POST',
      `/orders/${strictOrderDos006Next}/submit`,
      { idempotencyKey: `submit-dos006-next-${run}` },
    )
    expect(next.status).toBe(200)
    expect(next.body.item.state).toBe('submitted')
    expect(next.body.item.approvalFlags).toEqual(['credit_limit'])
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
    /*
     * The THIRD door for the two office-only fields, beside `GET /orders/{id}` and `sync.pull`:
     * the shop's own submit reply. `confirmInTx` runs under `asSystem`, which flips the DATABASE
     * setting `app.actor_role` and not `currentTenant()`, so `detail()` inside it still maps for a
     * retailer — but only a test says so. Shop A is `indicate` with a limit of 0 (fixture :250), so
     * the very same submit made by the rep carries a `limit_exceeded` notice (DOS-081 below).
     */
    expect(submitted.body.item.creditNotice).toBeNull()
    expect(submitted.body.item.stockShortages).toEqual([])
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
    // DOS-078: the desk's own confirm records the same list on the order, and a second confirm reads
    // it back instead of answering an empty one — the record is history, not a one-off reply.
    expect(confirmed.body.item.stockShortages).toEqual(confirmed.body.shortages)
    const again = await call<{ item: Detail; shortages: Shortage[] }>(
      app,
      owner,
      'POST',
      `/orders/${id}/confirm`,
      { idempotencyKey: `confirm-short-again-${run}` },
    )
    expect(again.status).toBe(200)
    expect(again.body.item.stockShortages).toEqual(confirmed.body.shortages)
    expect(again.body.shortages).toEqual(confirmed.body.shortages)
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

  const shortOrder = uuidv7()
  const shortLineA = uuidv7()
  const shortLineB = uuidv7()

  it("DOS-078: a rep's order beyond the godown's stock confirms short and the shortage is recorded on the order", async () => {
    // Exactly 10 cases of 12 in the godown, opened here rather than in `beforeAll`: the earlier tests
    // count the godown's balance ROWS, and a second item would be a second row for them.
    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      const { lot } = await inventory.findOrCreateLot(tx, {
        variantId: variantShort,
        batchNo: 'OPENING',
        mrpPaise: 3000,
      })
      await inventory.post(tx, [
        {
          lotId: lot.id,
          locationId: godown,
          qtyDelta: 120,
          reason: 'opening',
          idempotencyKey: `open-${run}-short`,
        },
      ])
    })
    const created = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-dos078-${run}`,
      id: shortOrder,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [
        // 12 cs of an item the godown holds 10 cs of, and 1 cs of one it holds none of.
        { id: shortLineA, variantId: variantShort, enteredQty: 12, enteredUnit: 'case' },
        { id: shortLineB, variantId: variantB, enteredQty: 1, enteredUnit: 'case' },
      ],
    })
    expect(created.status).toBe(200)
    const submitted = await call<{ item: Detail }>(
      app,
      rep,
      'POST',
      `/orders/${shortOrder}/submit`,
      {
        idempotencyKey: `submit-dos078-${run}`,
      },
    )
    expect(submitted.status).toBe(200)
    // Over-available is accepted, never blocked (UX-00 §6.4): it confirms, short, and says so.
    expect(submitted.body.item.state).toBe('confirmed')
    const expected = [
      {
        lineId: shortLineA,
        variantId: variantShort,
        requestedPcs: 144,
        reservedPcs: 120,
        shortQtyPcs: 24,
      },
      {
        lineId: shortLineB,
        variantId: variantB,
        requestedPcs: 12,
        reservedPcs: 0,
        shortQtyPcs: 12,
      },
    ]
    expect(submitted.body.item.stockShortages).toEqual(expected)

    // The desk reads the same record on the order and in its list.
    const read = await call<{ item: Detail }>(app, manager, 'GET', `/orders/${shortOrder}`)
    expect(read.status).toBe(200)
    expect(read.body.item.stockShortages).toEqual(expected)
    const listed = await call<{ items: Detail[] }>(app, manager, 'GET', '/orders?limit=50')
    expect(listed.status).toBe(200)
    expect(listed.body.items.find((o) => o.id === shortOrder)?.stockShortages).toEqual(expected)
  })

  it('DOS-078: the shop reads no shortage on its order', async () => {
    // Office-only, like `approvals`: what the godown is short of is not the shopkeeper's business.
    const read = await call<{ item: Detail }>(app, shop, 'GET', `/orders/${shortOrder}`)
    expect(read.status).toBe(200)
    expect(read.body.item.stockShortages).toEqual([])
    const listed = await call<{ items: Detail[] }>(app, shop, 'GET', '/orders?limit=50')
    expect(listed.status).toBe(200)
    expect(listed.body.items.find((o) => o.id === shortOrder)?.stockShortages).toEqual([])
    // The `[]` is the mapping, not an empty column: the record itself is still on the row.
    const stored = (
      await db.execute(
        sql`select jsonb_array_length(stock_shortages)::int as n from sales_orders where id = ${shortOrder}`,
      )
    ).rows as { n: number }[]
    expect(stored[0]?.n).toBe(2)
  })

  it('DOS-081: an indicate-mode shop over its limit confirms and the order carries a credit notice the desk reads', async () => {
    // Shop A is "Warn at the limit" with a ₹0 limit, so this order takes it past it. Founder, 2026-09-13:
    // the order GOES THROUGH and the office sees a notice on it; only strict and stop are held.
    const id = uuidv7()
    const created = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-dos081-${run}`,
      id,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
    })
    expect(created.status).toBe(200)
    const submitted = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${id}/submit`, {
      idempotencyKey: `submit-dos081-${run}`,
    })
    expect(submitted.status).toBe(200)
    expect(submitted.body.item.state).toBe('confirmed')
    // A warn-mode breach is NOT a gate: `approval_flags` still means "waiting on somebody".
    expect(submitted.body.item.approvalFlags).toEqual([])
    expect(submitted.body.item.creditNotice).toMatchObject({
      creditMode: 'indicate',
      reasons: ['limit_exceeded'],
      creditLimitPaise: 0,
      orderTotalPaise: submitted.body.item.totalPaise,
    })
    // Office-only, like the approvals and the shortage record.
    const asShop = await call<{ item: Detail }>(app, shop, 'GET', `/orders/${id}`)
    expect(asShop.status).toBe(200)
    expect(asShop.body.item.creditNotice).toBeNull()

    // A strict shop over its limit still carries BOTH: the gate that holds it and the same notice.
    const held = uuidv7()
    await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-dos081b-${run}`,
      id: held,
      retailerId: retailerB,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 30, enteredUnit: 'piece' }],
    })
    const heldRes = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${held}/submit`, {
      idempotencyKey: `submit-dos081b-${run}`,
    })
    expect(heldRes.status).toBe(200)
    expect(heldRes.body.item.state).toBe('submitted')
    expect(heldRes.body.item.approvalFlags).toContain('credit_limit')
    expect(heldRes.body.item.creditNotice).toMatchObject({
      creditMode: 'strict',
      reasons: ['limit_exceeded'],
    })

    // A shop within its limit gets no notice at all.
    const clean = uuidv7()
    await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-dos081c-${run}`,
      id: clean,
      retailerId: retailerD,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
    })
    const cleanRes = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${clean}/submit`, {
      idempotencyKey: `submit-dos081c-${run}`,
    })
    expect(cleanRes.status).toBe(200)
    expect(cleanRes.body.item.state).toBe('confirmed')
    expect(cleanRes.body.item.creditNotice).toBeNull()
  })

  it("DOS-078/DOS-081: the shop's DEVICE holds neither the shortage record nor the credit notice", async () => {
    /*
     * THE OTHER DOOR. `toOrder(row, office)` blanks both fields on the oRPC path, but `sales_orders`
     * is ALSO a sync pull table and the retailer role holds it (its own bills and orders, docs/07 §0).
     * `sync.pull` is `select *`, so a column nobody strips there is on the shopkeeper's phone however
     * carefully `GET /orders/{id}` hides it — the exact shape of QA DOS-072, whose note stands: "no
     * screen draws it" is not the same as "it is not on the phone". The manifest and the rows are one
     * `omit`, so both halves are checked, and the rep keeps both: it warns against the limit offline
     * (DOS-081) and tells the shopkeeper what the godown could not fill (DOS-078).
     */
    const OFFICE_ONLY = ['stock_shortages', 'credit_notice']
    const deviceId = uuidv7()
    const columnsOf = async (actor: Actor) => {
      const manifest = await call<Manifest>(app, actor, 'GET', '/sync/manifest')
      expect(manifest.status).toBe(200)
      return manifest.body.tables
        .find((t) => t.table === 'sales_orders')
        ?.columns.map((c) => c.name)
    }
    const rowsOf = async (actor: Actor) => {
      const pulled = await call<Pull>(app, actor, 'GET', '/sync/pull', {
        deviceId,
        limit: '500',
        'tables[0]': 'sales_orders',
      })
      expect(pulled.status).toBe(200)
      return pulled.body.changes.find((c) => c.table === 'sales_orders')?.rows ?? []
    }

    const shopColumns = await columnsOf(shop)
    expect(shopColumns).toBeDefined()
    expect(shopColumns).toContain('total_paise')
    for (const key of OFFICE_ONLY) expect(shopColumns, key).not.toContain(key)

    const shopRows = await rowsOf(shop)
    // The two orders this block built for shop A: one short, one over a warn-mode limit.
    expect(shopRows.map((r) => r.id)).toContain(shortOrder)
    expect(shopRows.length).toBeGreaterThan(0)
    for (const row of shopRows)
      for (const key of OFFICE_ONLY) expect(Object.keys(row), key).not.toContain(key)

    // The rep's copy is untouched: it is the office side of both facts.
    const repColumns = await columnsOf(rep)
    for (const key of OFFICE_ONLY) expect(repColumns, key).toContain(key)
    const repRows = await rowsOf(rep)
    expect(repRows.map((r) => r.id)).toContain(shortOrder)
    for (const key of OFFICE_ONLY) expect(Object.keys(repRows[0] ?? {}), key).toContain(key)
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

  it('DOS-079: an order line on a 28% + 12% cess HSN stores cess inside its tax and the header carries the cess share', async () => {
    const line = uuidv7()
    const placed = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `create-dos079-${run}`,
      id: uuidv7(),
      retailerId: retailerA,
      source: 'salesperson',
      // 4 cs of 12 = 48 pcs at ₹22.97 = ₹1,102.56 taxable; 28% GST ₹308.72 + 12% cess ₹132.31 = ₹441.03
      lines: [{ id: line, variantId: variantCess, enteredQty: 4, enteredUnit: 'case' }],
    })
    expect(placed.status).toBe(200)
    const order = placed.body.item
    const [only] = order.lines
    if (!only) throw new Error('DOS-079: the order lost its only line')
    expect(only).toMatchObject({
      qtyPcs: 48,
      ratePaise: 2_297,
      gstBps: 2_800,
      cessBps: 1_200,
      cessPaise: 13_231,
      taxPaise: 44_103,
      lineTotalPaise: 154_359,
    })
    // Amendment (a): `tax_paise` IS GST + cess, so every consumer that reads the taxable as
    // `lineTotalPaise − taxPaise` (billing, repricing, the retailer app) still reads the net.
    expect(only.lineTotalPaise - only.taxPaise).toBe(110_256)
    expect(order).toMatchObject({
      subtotalPaise: 110_256,
      discountPaise: 0,
      cessPaise: 13_231,
      taxPaise: 44_103,
      roundOffPaise: 41,
      totalPaise: 154_400,
    })
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

  it('DOS-090: a rate asked on a draft still on the phone waits for that draft and gates exactly one order', async () => {
    /*
     * The rep asks for a rate while the order is still a DRAFT ON THE PHONE, so `bargain_requests.order_id`
     * names an order the server has never seen — by design (`orders.create` later writes that very id).
     * What must hold: the request waits for THAT order and prices no other order of the shop, and when the
     * draft is finally placed it raises exactly one gate. No FK, no nullable-until-submit, no timed lapse.
     */
    const phoneDraftId = uuidv7()
    const bargainId = uuidv7()
    const asked = await call<{ item: { status: string; orderId: string | null } }>(
      app,
      rep,
      'POST',
      '/pricing/bargains',
      {
        idempotencyKey: `dos090-ask-${run}`,
        id: bargainId,
        retailerId: retailerA,
        variantId: variantA,
        askedRatePaise: 900,
        qtyPcs: 12,
        orderId: phoneDraftId,
      },
    )
    expect(asked.status).toBe(200)
    expect(asked.body.item.status).toBe('requested')
    expect(asked.body.item.orderId).toBe(phoneDraftId)
    // The office cannot open it: there is no such order yet. This is what the screens must say.
    expect((await call(app, manager, 'GET', `/orders/${phoneDraftId}`)).status).toBe(404)

    // Another order of the SAME shop and item, with its own id, is untouched by that request.
    const otherId = uuidv7()
    await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `dos090-other-${run}`,
      id: otherId,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'case' }],
    })
    const other = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${otherId}/submit`, {
      idempotencyKey: `dos090-other-submit-${run}`,
    })
    expect(other.status).toBe(200)
    expect(other.body.item.approvalFlags).toEqual([])
    expect(other.body.item.lines[0]).toMatchObject({ ratePaise: 1_000 })

    // And when the draft is placed under its own id, it raises exactly one gate, naming that request.
    await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `dos090-place-${run}`,
      id: phoneDraftId,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'case' }],
    })
    const placed = await call<{ item: Detail }>(
      app,
      rep,
      'POST',
      `/orders/${phoneDraftId}/submit`,
      {
        idempotencyKey: `dos090-place-submit-${run}`,
      },
    )
    expect(placed.status).toBe(200)
    expect(placed.body.item.approvalFlags).toEqual(['bargain'])
    const gates = await call<{ items: Gate[] }>(app, owner, 'GET', '/approvals', {
      status: 'pending',
      orderId: phoneDraftId,
    })
    expect(gates.body.items).toHaveLength(1)
    expect(gates.body.items[0]).toMatchObject({
      kind: 'bargain',
      entityType: 'bargain_request',
      entityId: bargainId,
    })
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

  // -----------------------------------------------------------------------------------------------------
  // DOS-028: a manager's approval decisions, and the confirm the last one triggers, leave no audit trail today —
  // only the owner's set-credit and exports write `audit_log`. An owner must later be able to see who released
  // a credit-stopped shop or approved a below-floor sale.

  it("DOS-028: deciding both approvals of a held order audits each decision and the confirm the last one triggers, with the manager's id", async () => {
    const orderId = uuidv7()
    const bargainA = uuidv7()
    const bargainB = uuidv7()
    const drafted = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `dos028-create-${run}`,
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
      for (const ask of [
        { id: bargainA, variantId: variantA, askedRatePaise: 900 },
        { id: bargainB, variantId: variantB, askedRatePaise: 2_300 },
      ]) {
        const asked = await call<{ item: { status: string } }>(
          app,
          rep,
          'POST',
          '/pricing/bargains',
          {
            idempotencyKey: `dos028-ask-${ask.id}`,
            ...ask,
            retailerId: retailerA,
            qtyPcs: 1,
            orderId,
          },
        )
        expect(asked.status).toBe(200)
      }

      const submitted = await call<{ item: Detail }>(
        app,
        rep,
        'POST',
        `/orders/${orderId}/submit`,
        { idempotencyKey: `dos028-submit-${run}` },
      )
      expect(submitted.status).toBe(200)
      expect(submitted.body.item.approvalFlags).toEqual(['bargain'])

      // red: today, nothing a manager does with an approval reaches audit_log
      const before = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityId, orderId)))
      expect(before).toEqual([])

      const queue = await call<{ items: Gate[] }>(app, manager, 'GET', '/approvals', {
        status: 'pending',
        orderId,
      })
      expect(queue.status).toBe(200)
      expect(queue.body.items).toHaveLength(2)

      const gateIds = queue.body.items.map((g) => g.id)
      for (const gateId of gateIds) {
        const decided = await call<Decided>(app, manager, 'POST', `/approvals/${gateId}/decide`, {
          idempotencyKey: `dos028-decide-${gateId}`,
          decision: 'approve',
        })
        expect(decided.status).toBe(200)
      }

      // green: one approval.decide row per approval, actor = the manager who decided (scoped to THESE two
      // gates — other tests in this file decide their own approvals against the same shared tenant)
      const decisions = await db
        .select({
          action: auditLog.action,
          entityType: auditLog.entityType,
          actorId: auditLog.actorId,
        })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), inArray(auditLog.entityId, gateIds)))
      expect(decisions).toHaveLength(2)
      expect(
        decisions.every(
          (r) =>
            r.action === 'approval.decide' &&
            r.entityType === 'approval' &&
            r.actorId === managerId,
        ),
      ).toBe(true)

      // and one order.confirm row for the confirm the last decision triggered, before/after state included
      const confirms = await db
        .select({
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          actorId: auditLog.actorId,
          before: auditLog.before,
          after: auditLog.after,
        })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.entityId, orderId)))
      expect(confirms).toHaveLength(1)
      expect(confirms[0]).toMatchObject({
        action: 'order.confirm',
        entityType: 'sales_order',
        entityId: orderId,
        actorId: managerId,
        before: { state: 'submitted' },
        after: { state: 'confirmed' },
      })
    } finally {
      await call(app, owner, 'POST', `/orders/${orderId}/cancel`, {
        idempotencyKey: `dos028-cleanup-${run}`,
        reason: 'test cleanup',
      })
    }
  })

  // -----------------------------------------------------------------------------------------------------
  // DOS-127: a shop's own cancel must expire the approvals waiting on it exactly as a rep's cancel does, and
  // a decision that arrives after the order went terminal by some other path must not answer 409 forever.

  it('DOS-127: a shop cancelling its own held order expires the bargain gate waiting on it, and it leaves the pending queue', async () => {
    const orderId = uuidv7()
    const bargainId = uuidv7()
    const drafted = await call<{ item: Detail }>(app, shop, 'POST', '/orders', {
      idempotencyKey: `dos127-create-${run}`,
      id: orderId,
      retailerId: retailerA,
      source: 'retailer_app',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'case' }],
    })
    expect(drafted.status).toBe(200)

    const asked = await call<{ item: { status: string } }>(app, shop, 'POST', '/pricing/bargains', {
      idempotencyKey: `dos127-ask-${run}`,
      id: bargainId,
      retailerId: retailerA,
      variantId: variantA,
      askedRatePaise: 900,
      qtyPcs: 12,
      orderId,
    })
    expect(asked.status).toBe(200)
    expect(asked.body.item.status).toBe('requested')

    const submitted = await call<{ item: Detail }>(app, shop, 'POST', `/orders/${orderId}/submit`, {
      idempotencyKey: `dos127-submit-${run}`,
    })
    expect(submitted.status).toBe(200)
    expect(submitted.body.item.state).toBe('submitted')
    expect(submitted.body.item.approvalFlags).toEqual(['bargain'])

    const cancelled = await call<{ item: Detail }>(app, shop, 'POST', `/orders/${orderId}/cancel`, {
      idempotencyKey: `dos127-cancel-${run}`,
      reason: 'ordered by mistake',
    })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.item.state).toBe('cancelled')

    // `approvals_read` hides the queue from the retailer role, so the shop's own cancel used to leave the gate
    // 'pending' forever — the owner's queue must not still list it, and the row itself must read 'expired'.
    const queue = await call<{ items: Gate[] }>(app, owner, 'GET', '/approvals', {
      status: 'pending',
      orderId,
    })
    expect(queue.status).toBe(200)
    expect(queue.body.items).toEqual([])

    const [row] = await asOwner((tx) =>
      tx.select({ status: approvals.status }).from(approvals).where(eq(approvals.orderId, orderId)),
    )
    expect(row?.status).toBe('expired')
  })

  it('DOS-127: deciding a pending gate whose order is already cancelled expires it instead of answering 409', async () => {
    const orderId = uuidv7()
    const approvalId = uuidv7()
    // simulates a gate left behind by some other path (a stale dos_qa row, or a race): the order is already
    // terminal, so `confirmInTx`/`cancelInTx` would refuse the move `orderMachine` no longer allows.
    await db.insert(salesOrders).values({
      id: orderId,
      tenantId,
      retailerId: retailerA,
      state: 'cancelled',
      source: 'salesperson',
      createdBy: repId,
      salespersonId: repId,
      paymentTerms: 'ON',
      approvalFlags: ['bargain'],
      cancelledAt: new Date(),
      cancelReason: 'test setup: cancelled by another path',
    })
    await db.insert(approvals).values({
      id: approvalId,
      tenantId,
      kind: 'bargain',
      orderId,
      entityType: 'sales_order',
      entityId: orderId,
      requestedBy: repId,
      status: 'pending',
      payload: {},
    })

    const decided = await call<Decided>(app, owner, 'POST', `/approvals/${approvalId}/decide`, {
      idempotencyKey: `dos127-stale-decide-${run}`,
      decision: 'approve',
    })
    expect(decided.status).toBe(200)
    expect(decided.body.item.status).toBe('expired')
    expect(decided.body.order).toMatchObject({ state: 'cancelled' })
  })

  // -----------------------------------------------------------------------------------------------------
  // DOS-003: an order line names its item the way the bill line does — the tenant's alias first, the global
  // variant name otherwise — read when the order is fetched, so an item delisted after ordering keeps its name.
  // Its own variants and listings, and last in the file, so no other test sees a listing switched off.

  it('DOS-003: order lines carry variantName — tenant alias first, global name otherwise, and an item delisted after ordering is still named (create reply, owner GET, retailer GET)', async () => {
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    const aliased = uuidv7()
    const plain = uuidv7()
    const plainListing = uuidv7()
    const orderId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker dos003 ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Snacks', category: 'snacks' })
    await db.insert(productVariants).values([
      {
        id: aliased,
        productId,
        name: 'Kurkure Masala Munch 90 g',
        netQty: 90,
        netUnit: 'g',
        defaultCaseSize: 60,
        hsnCode: hsn,
        mrpPaise: 2000,
      },
      {
        id: plain,
        productId,
        name: 'Lays Classic 52 g',
        netQty: 52,
        netUnit: 'g',
        defaultCaseSize: 48,
        hsnCode: hsn,
        mrpPaise: 2000,
      },
    ])
    await db.insert(tenantProducts).values([
      { id: uuidv7(), tenantId, variantId: aliased, localAlias: 'Kurkure 90' },
      { id: plainListing, tenantId, variantId: plain },
    ])
    // `priceListId` is local to beforeAll; bootstrapTenant creates no price list, so the spec's is the only one
    const [priceList] = await db
      .select()
      .from(priceLists)
      .where(sql`${priceLists.tenantId} = ${tenantId}`)
    expect(priceList).toBeDefined()
    await db.insert(priceListItems).values([
      {
        id: uuidv7(),
        tenantId,
        priceListId: priceList?.id ?? '',
        variantId: aliased,
        ratePaise: 1800,
      },
      {
        id: uuidv7(),
        tenantId,
        priceListId: priceList?.id ?? '',
        variantId: plain,
        ratePaise: 1800,
      },
    ])
    const expected = [
      [1, aliased, 'Kurkure 90'],
      [2, plain, 'Lays Classic 52 g'],
    ]
    const named = (lines: Line[]) => lines.map((l) => [l.lineNo, l.variantId, l.variantName])

    const created = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `dos003-create-${run}`,
      id: orderId,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [
        { id: uuidv7(), variantId: aliased, enteredQty: 1, enteredUnit: 'piece' },
        { id: uuidv7(), variantId: plain, enteredQty: 1, enteredUnit: 'piece' },
      ],
    })
    expect(created.status).toBe(200)
    expect(named(created.body.item.lines)).toEqual(expected)

    // the Lays listing is switched off after the order was taken (the owner pool bypasses RLS)
    await db
      .update(tenantProducts)
      .set({ listed: false })
      .where(eq(tenantProducts.id, plainListing))

    for (const actor of [owner, shop]) {
      const got = await call<{ item: Detail }>(app, actor, 'GET', `/orders/${orderId}`)
      expect(got.status).toBe(200)
      expect(named(got.body.item.lines)).toEqual(expected)
    }
  })

  // -----------------------------------------------------------------------------------------------------
  // DOS-098: "Order again" repeats the shop's most recently PLACED order — by when it was placed
  // (`coalesce(submitted_at, created_at)`), never a draft, and never an older order whose id happens to sort
  // higher (a seeded or imported id is not a date). `GET /orders/last-placed` names that order without writing
  // anything, so the retailer app builds the basket on the device. Stock-neutral: every order placed here is on
  // variant B (no stock, so nothing is held), and the draft and the hand-written delivered order hold nothing
  // either, so no later block's reservation or shortage arithmetic moves. No test uses another test's ids.

  describe('DOS-098 Order again repeats the most recently placed order', () => {
    const pieces = (lines: readonly Line[]) => lines.map((l) => [l.variantId, l.qtyPcs])

    /** Draft and submit a one-line order on Shop A; it leaves draft (Shop A is `indicate`). */
    const place = async (actor: Actor, tag: string, variantId: string, qty: number) => {
      const id = uuidv7()
      const drafted = await call<{ item: Detail }>(app, actor, 'POST', '/orders', {
        idempotencyKey: `dos098-create-${tag}-${run}`,
        id,
        retailerId: retailerA,
        source: actor.role === 'retailer' ? 'retailer_app' : 'salesperson',
        lines: [{ id: uuidv7(), variantId, enteredQty: qty, enteredUnit: 'piece' }],
      })
      expect(drafted.status, tag).toBe(200)
      const submitted = await call<{ item: Detail }>(app, actor, 'POST', `/orders/${id}/submit`, {
        idempotencyKey: `dos098-submit-${tag}-${run}`,
      })
      expect(submitted.status, tag).toBe(200)
      expect(['submitted', 'confirmed'], tag).toContain(submitted.body.item.state)
      return id
    }

    it("DOS-098: repeat-last copies the shop's most recently placed order, never a newer draft and never an older order with a higher id", async () => {
      // (a) the shop's newest PLACED order: 3 pieces of variant B
      await place(rep, 'placed', variantB, 3)

      // (b) a draft started after it, so the highest id this shop has, that nobody has sent
      const draft = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
        idempotencyKey: `dos098-draft-${run}`,
        id: uuidv7(),
        retailerId: retailerA,
        source: 'salesperson',
        lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 5, enteredUnit: 'piece' }],
      })
      expect(draft.status).toBe(200)
      expect(draft.body.item.state).toBe('draft')

      // (c) Order again copies the placed order, not the draft
      const first = await call<{ item: Detail }>(app, rep, 'POST', '/orders/repeat-last', {
        idempotencyKey: `dos098-repeat-1-${run}`,
        id: uuidv7(),
        retailerId: retailerA,
        source: 'salesperson',
      })
      expect(first.status).toBe(200)
      expect(first.body.item.state).toBe('draft')
      expect(pieces(first.body.item.lines)).toEqual([[variantB, 3]])

      // (d) a delivered order placed 45 days ago whose id sorts above every real one, as seeded and imported
      // ids do, written straight to the table (the owner pool bypasses RLS)
      const oldId = `ffffffff-ffff-7fff-bfff-0000${run}`
      const placedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
      await db.insert(salesOrders).values({
        id: oldId,
        tenantId,
        orderNo: `SO-D098-${run}`,
        retailerId: retailerA,
        state: 'delivered',
        source: 'salesperson',
        createdBy: repId,
        salespersonId: repId,
        paymentTerms: 'ON',
        submittedAt: placedAt,
        createdAt: placedAt,
      })
      await db.insert(salesOrderLines).values({
        id: uuidv7(),
        tenantId,
        orderId: oldId,
        lineNo: 1,
        variantId: variantA,
        enteredQty: 40,
        enteredUnit: 'piece',
        packSizeAtEntry: 1,
        qtyPcs: 40,
        listRatePaise: 1000,
        ratePaise: 1000,
        gstBps: 1200,
      })

      // (e) still the placed order: not the older order with the higher id, and not (c)'s own draft
      const again = await call<{ item: Detail }>(app, rep, 'POST', '/orders/repeat-last', {
        idempotencyKey: `dos098-repeat-2-${run}`,
        id: uuidv7(),
        retailerId: retailerA,
        source: 'salesperson',
      })
      expect(again.status).toBe(200)
      expect(pieces(again.body.item.lines)).toEqual([[variantB, 3]])
    })

    it("DOS-098: GET /orders/last-placed answers the shop's newest placed order with its lines, writes nothing, and keeps a salesperson to its own orders", async () => {
      // the rep's own order first, then the shop's: the shop's is the newest placed order of Shop A
      const repPlaced = await place(rep, 'lp-rep', variantB, 1)
      const shopPlaced = await place(shop, 'lp-shop', variantB, 2)

      // a salesperson with no order on Shop A, and a shop with no order at all
      const rep3Id = uuidv7()
      const rep3: Actor = { tenantId, actorId: rep3Id, role: 'salesperson' }
      await db.insert(users).values({ id: rep3Id, phone: `+91904${run}8`, name: 'Third rep' })
      await db
        .insert(memberships)
        .values({ id: uuidv7(), tenantId, userId: rep3Id, role: 'salesperson' })
      const quiet = uuidv7()
      await db.insert(retailers).values({
        id: quiet,
        tenantId,
        code: `R9-${run}`,
        name: `Shop Q ${run}`,
        phone: `+91905${run}9`,
        stateCode: '27',
        tier: 'C',
        creditMode: 'indicate',
        creditLimitPaise: 0,
      })

      const counts = async () =>
        (
          await db.execute(
            sql`select (select count(*) from sales_orders where tenant_id = ${tenantId})::int as orders,
                       (select count(*) from sales_order_lines where tenant_id = ${tenantId})::int as lines`,
          )
        ).rows[0] as { orders: number; lines: number }
      const before = await counts()
      const lastPlaced = (actor: Actor, retailerId: string) =>
        call<{ item: Detail | null }>(app, actor, 'GET', '/orders/last-placed', { retailerId })

      // the shop reads its newest placed order with its lines, and none of the approvals
      const mine = await lastPlaced(shop, retailerA)
      expect(mine.status).toBe(200)
      expect(mine.body.item?.id).toBe(shopPlaced)
      expect(pieces(mine.body.item?.lines ?? [])).toEqual([[variantB, 2]])
      expect(mine.body.item?.approvals).toEqual([])

      // the desk reads the same order; a rep reads only an order credited to it (DOS-073), else nothing
      const desk = await lastPlaced(owner, retailerA)
      expect(desk.status).toBe(200)
      expect(desk.body.item?.id).toBe(shopPlaced)
      const own = await lastPlaced(rep, retailerA)
      expect(own.status).toBe(200)
      expect(own.body.item?.id).toBe(repPlaced)
      expect(pieces(own.body.item?.lines ?? [])).toEqual([[variantB, 1]])
      const none = await lastPlaced(rep3, retailerA)
      expect(none.status).toBe(200)
      expect(none.body).toEqual({ item: null })

      // a shop with no placed order, a shop that does not exist, and a shop not linked to this login
      const quietShop = await lastPlaced(owner, quiet)
      expect(quietShop.status).toBe(200)
      expect(quietShop.body).toEqual({ item: null })
      expect((await lastPlaced(owner, uuidv7())).status).toBe(404)
      expect((await lastPlaced(shop, retailerB)).status).toBe(403)

      // the static route did not shadow the param route: GET /orders/{id} still answers the same order
      const got = await call<{ item: Detail }>(app, shop, 'GET', `/orders/${shopPlaced}`)
      expect(got.status).toBe(200)
      expect(got.body.item.id).toBe(shopPlaced)
      expect(got.body.item).toEqual(mine.body.item)

      // none of those reads wrote an order or a line
      expect(await counts()).toEqual(before)
    })
  })

  it('DOS-138: the desk cancels an order mid-pick — the manager gets 200 cancelled with the reason, every held piece is released and an OrderCancelled event is written; the rep is 409 "only the desk", and a shop is still limited to draft and submitted', async () => {
    const orders = app.get(OrdersService)
    const orderId = uuidv7()
    const lineId = uuidv7()
    const created = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `dos138-create-${run}`,
      id: orderId,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [{ id: lineId, variantId: variantA, enteredQty: 2, enteredUnit: 'piece' }],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const submitted = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${orderId}/submit`, {
      idempotencyKey: `dos138-submit-${run}`,
    })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    expect(submitted.body.item.state).toBe('confirmed')
    await asOwner((tx) =>
      orders.applyFulfilmentEvent(tx, orderId, 'start_picking', null, 'DOS-138 spec'),
    )

    const heldFor = async (): Promise<number> =>
      Number(
        (
          (
            await db.execute(
              sql`select coalesce(sum(qty), 0)::int as held from reservations
                   where tenant_id = ${tenantId} and order_line_id = ${lineId} and state = 'pending'`,
            )
          ).rows as { held: number }[]
        )[0]?.held ?? 0,
      )
    expect(await heldFor()).toBeGreaterThan(0)

    // the rep may not cancel what the floor is already picking — the desk is in the loop or nobody is
    const byRep = await call<{ message?: string }>(app, rep, 'POST', `/orders/${orderId}/cancel`, {
      idempotencyKey: `dos138-rep-${run}`,
      reason: 'shop phoned me',
    })
    expect(byRep.status, JSON.stringify(byRep.body)).toBe(409)
    expect(byRep.body.message).toMatch(/only the desk can cancel it now/)
    expect(await heldFor()).toBeGreaterThan(0)

    // the manager does, and the hold goes with it
    const byDesk = await call<{ item: Detail }>(app, manager, 'POST', `/orders/${orderId}/cancel`, {
      idempotencyKey: `dos138-desk-${run}`,
      reason: 'Shop shut for a wedding.',
    })
    expect(byDesk.status, JSON.stringify(byDesk.body)).toBe(200)
    expect(byDesk.body.item.state).toBe('cancelled')
    expect(byDesk.body.item.cancelReason).toBe('Shop shut for a wedding.')
    expect(await heldFor()).toBe(0)
    expect(byDesk.body.item.transitions.map((t) => [t.event, t.toState])).toContainEqual([
      'cancel',
      'cancelled',
    ])
    const events = (
      await db.execute(
        sql`select event_type from outbox_events
             where tenant_id = ${tenantId} and aggregate_id = ${orderId} and event_type = 'OrderCancelled'`,
      )
    ).rows as { event_type: string }[]
    expect(events).toHaveLength(1)

    // a shop's reach did not widen with the desk's: it still cancels only its own draft or submitted order
    const shopOrderId = uuidv7()
    const shopDraft = await call<{ item: Detail }>(app, shop, 'POST', '/orders', {
      idempotencyKey: `dos138-shop-create-${run}`,
      id: shopOrderId,
      retailerId: retailerA,
      source: 'retailer_app',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
    })
    expect(shopDraft.status, JSON.stringify(shopDraft.body)).toBe(200)
    await call(app, shop, 'POST', `/orders/${shopOrderId}/submit`, {
      idempotencyKey: `dos138-shop-submit-${run}`,
    })
    await asOwner((tx) =>
      orders.applyFulfilmentEvent(tx, shopOrderId, 'start_picking', null, 'DOS-138 spec'),
    )
    const byShop = await call<{ message?: string }>(
      app,
      shop,
      'POST',
      `/orders/${shopOrderId}/cancel`,
      { idempotencyKey: `dos138-shop-${run}`, reason: 'changed my mind' },
    )
    // A shop cannot reach a picking order at all: its UPDATE policy on `sales_orders` stops at
    // `submitted`, so the row cannot even be locked — answered as an id it cannot see, never 200.
    expect([404, 409], JSON.stringify(byShop.body)).toContain(byShop.status)
    const [shopState] = (
      await db.execute(sql`select state::text as s from sales_orders where id = ${shopOrderId}`)
    ).rows as { s: string }[]
    expect(shopState?.s).toBe('picking')
  })

  it('DOS-139: orders.cancel on a packed order is 409 "cancel the bill and the order goes with it" for every role, and writes nothing', async () => {
    const orders = app.get(OrdersService)
    const orderId = uuidv7()
    const created = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `dos139-create-${run}`,
      id: orderId,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const submitted = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${orderId}/submit`, {
      idempotencyKey: `dos139-submit-${run}`,
    })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    expect(submitted.body.item.state).toBe('confirmed')
    await asOwner((tx) =>
      orders.applyFulfilmentEvent(tx, orderId, 'start_picking', null, 'DOS-139 spec'),
    )
    await asOwner((tx) => orders.applyFulfilmentEvent(tx, orderId, 'pack', null, 'DOS-139 spec'))

    const stateOf = async (): Promise<string> =>
      (
        (await db.execute(sql`select state::text as s from sales_orders where id = ${orderId}`))
          .rows as { s: string }[]
      )[0]?.s ?? 'missing'
    const transitionsOf = async (): Promise<number> =>
      (
        (
          await db.execute(
            sql`select count(*)::int as n from order_state_transitions where order_id = ${orderId}`,
          )
        ).rows as { n: number }[]
      )[0]?.n ?? 0
    expect(await stateOf()).toBe('packed')
    const before = await transitionsOf()

    // The packed → cancelled edge exists for ONE caller, `billing.invoices.cancel`; the procedure
    // names the route instead of taking it, for the desk and the rep alike.
    for (const [who, actor] of [
      ['owner', owner],
      ['manager', manager],
      ['rep', rep],
    ] as const) {
      const refused = await call<{ message?: string }>(
        app,
        actor,
        'POST',
        `/orders/${orderId}/cancel`,
        { idempotencyKey: `dos139-cancel-${who}-${run}`, reason: 'shop changed its mind' },
      )
      expect(refused.status, `${who}: ${JSON.stringify(refused.body)}`).toBe(409)
      expect(refused.body.message, who).toMatch(/cancel the bill and the order goes with it/)
    }
    expect(await stateOf()).toBe('packed')
    expect(await transitionsOf()).toBe(before)
  })

  it("DOS-009: orders.list is newest first by creation time — an order back-dated by a day with an id that sorts higher lands below today's orders; with limit=1 the cursor walks every order of the tenant exactly once in (created_at, id) order, with and without the from/to window; a rep still sees only its own orders and a shop only its own", async () => {
    interface OrderPage {
      items: { id: string; createdAt: string; salespersonId: string | null; retailerId: string }[]
      nextCursor: string | null
    }
    /*
     * An order shaped like the demo seed's and like an import: its id sorts above every real UUIDv7 (a
     * seeded id is a hash with no time in it) but it was created a day ago. Written straight to the table
     * on the owner pool, which bypasses RLS — the DOS-023/DOS-098 precedent.
     */
    const olderId = `ffffffff-ffff-7fff-bfff-0009${run}`
    const yesterday = new Date(Date.now() - 86_400_000)
    await db.insert(salesOrders).values({
      id: olderId,
      tenantId,
      orderNo: `SO-D009-${run}`,
      retailerId: retailerA,
      state: 'delivered',
      source: 'salesperson',
      createdBy: repId,
      salespersonId: repId,
      paymentTerms: 'ON',
      submittedAt: yesterday,
      createdAt: yesterday,
    })

    // today's newest order, drafted now, so the lowest id of the three newest but the youngest row
    const newest = uuidv7()
    const drafted = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
      idempotencyKey: `dos009-create-${run}`,
      id: newest,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
    })
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200)

    const page = (actor: Actor, query: Record<string, unknown>) =>
      call<OrderPage>(app, actor, 'GET', '/orders', query)

    // (a) the back-dated order with the higher id is NOT the top row; today's order is
    const top = await page(owner, { limit: 1 })
    expect(top.status, JSON.stringify(top.body)).toBe(200)
    expect(top.body.items[0]?.id).toBe(newest)

    /** Follows `nextCursor` to the end and returns every order in the order the pages gave them. */
    const walk = async (
      actor: Actor,
      query: Record<string, unknown>,
      limit: number,
    ): Promise<OrderPage['items']> => {
      const seen: OrderPage['items'] = []
      let cursor: string | undefined
      for (let pages = 0; pages < 2000; pages += 1) {
        const got = await page(actor, { ...query, limit, cursor })
        expect(got.status, JSON.stringify(got.body)).toBe(200)
        seen.push(...got.body.items)
        if (got.body.nextCursor === null) return seen
        cursor = got.body.nextCursor
      }
      throw new Error('orders.list never ended its cursor walk')
    }
    const expectEachOnceNewestFirst = (items: OrderPage['items']): void => {
      const ids = items.map((i) => i.id)
      expect(new Set(ids).size, 'no order comes back twice').toBe(ids.length)
      items.forEach((item, i) => {
        const before = items[i - 1]
        if (before !== undefined)
          expect(Date.parse(item.createdAt), `${item.id} after ${before.id}`).toBeLessThanOrEqual(
            Date.parse(before.createdAt),
          )
      })
    }
    const countOf = async (): Promise<number> =>
      (
        (
          await db.execute(
            sql`select count(*)::int as n from sales_orders where tenant_id = ${tenantId}`,
          )
        ).rows as { n: number }[]
      )[0]?.n ?? 0

    // (b) one row at a time, the whole tenant, each order exactly once and newest first
    const all = await walk(owner, {}, 1)
    expectEachOnceNewestFirst(all)
    expect(all).toHaveLength(await countOf())
    expect(all[0]?.id).toBe(newest)
    // the back-dated row sits below every order made today, whatever its id says
    const olderAt = all.findIndex((i) => i.id === olderId)
    expect(olderAt).toBeGreaterThan(0)
    expect(Date.parse(all[olderAt - 1]?.createdAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(yesterday.toISOString()),
    )

    // (c) the same walk inside the from/to window the desk uses: the window filters the same column
    const today = businessDate().date
    const windowed = await walk(owner, { from: today, to: today }, 2)
    expectEachOnceNewestFirst(windowed)
    expect(windowed.some((i) => i.id === newest)).toBe(true)
    expect(windowed.some((i) => i.id === olderId)).toBe(false)

    // (d) the reach rules are untouched by the new order: a rep sees only its own, a shop only its own
    const repSees = await walk(rep, {}, 3)
    expectEachOnceNewestFirst(repSees)
    expect(repSees.every((i) => i.salespersonId === repId)).toBe(true)
    const shopSees = await walk(shop, {}, 3)
    expectEachOnceNewestFirst(shopSees)
    expect(shopSees.every((i) => i.retailerId === retailerA)).toBe(true)
  })

  // -----------------------------------------------------------------------------------------------------
  // DOS-115: an order is placed, re-lined, repeated, submitted and cancelled by the owner, the manager, the rep
  // and the shop (ORDER_PLACERS). The godown and the crew take no order — the crew sells from the van through
  // `delivery.vanSales.create` — so the gate refuses them the five procedures, the handler refuses them again in
  // process, the upload door answers them 2xx `role_not_allowed` (DOS-166) before any handler, and the handlers'
  // `requirePlacer` stays behind it as defence in depth (`forbidden`). Both still read orders. Last in the file:
  // its own opening stock cannot move an earlier test's reservation or shortage arithmetic.

  describe('DOS-115 the godown and the crew take no order', () => {
    const storeId = uuidv7()
    const crewId = uuidv7()
    const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }
    const crew: Actor = { tenantId, actorId: crewId, role: 'delivery' }
    const confirmed = uuidv7() // the rep's order on Shop A, submitted and confirmed, one piece held
    const confirmedLine = uuidv7()
    const linesDraft = uuidv7() // the rep's three drafts the intruders try to re-line, submit and cancel
    const submitDraft = uuidv7()
    const cancelDraft = uuidv7()
    const intruders = [store, crew].map((actor) => ({
      actor,
      tag: `${actor.role}-${run}`,
      created: uuidv7(), // what a refused POST /orders would have drafted
      repeated: uuidv7(), // what a refused POST /orders/repeat-last would have drafted
      uploaded: uuidv7(), // what a refused sales_orders PUT would have drafted
    }))
    const attempted = intruders.flatMap((i) => [i.created, i.repeated, i.uploaded])
    const orderIds = [confirmed, linesDraft, submitDraft, cancelDraft, ...attempted]

    beforeAll(async () => {
      await db.insert(users).values([
        { id: storeId, phone: `+91904${run}6`, name: 'Godown' },
        { id: crewId, phone: `+91904${run}7`, name: 'Van driver' },
      ])
      await db.insert(memberships).values([
        { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
        { id: uuidv7(), tenantId, userId: crewId, role: 'delivery' },
      ])
      // Five pieces of its own, so the confirmed order's held piece exists whatever the earlier tests hold.
      const inventory = app.get(InventoryService)
      await asOwner(async (tx) => {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId: variantA,
          batchNo: `DOS115-${run}`,
          mrpPaise: 4000,
        })
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: 5,
            reason: 'opening',
            idempotencyKey: `open-${run}-dos115`,
          },
        ])
      })
      // the rep's confirmed order (Shop A is `indicate`, so submit confirms it and holds the piece)…
      const drafted = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
        idempotencyKey: `dos115-create-confirmed-${run}`,
        id: confirmed,
        retailerId: retailerA,
        source: 'salesperson',
        lines: [{ id: confirmedLine, variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
      })
      expect(drafted.status).toBe(200)
      const submitted = await call<{ item: Detail }>(
        app,
        rep,
        'POST',
        `/orders/${confirmed}/submit`,
        { idempotencyKey: `dos115-submit-confirmed-${run}` },
      )
      expect(submitted.body.item.state).toBe('confirmed')
      // …and three one-line drafts, so a wrongful re-line, submit or cancel would be a real write
      for (const id of [linesDraft, submitDraft, cancelDraft]) {
        const draft = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
          idempotencyKey: `dos115-create-draft-${id}`,
          id,
          retailerId: retailerA,
          source: 'salesperson',
          lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' }],
        })
        expect(draft.body.item.state).toBe('draft')
      }
    })

    /** Everything a wrongful create, re-line, repeat, submit, cancel or upload would change or add. */
    const snapshot = async () => {
      const orders = (
        await db.execute(
          sql`select id, state, order_no, cancelled_at, cancel_reason, note, total_paise, updated_at
                from sales_orders where id in ${orderIds} order by id`,
        )
      ).rows as { id: string; state: string; cancelled_at: unknown }[]
      const lines = (
        await db.execute(
          sql`select id, order_id, qty_pcs from sales_order_lines
               where order_id in ${orderIds} order by id`,
        )
      ).rows as { id: string; order_id: string }[]
      const held = (
        await db.execute(
          sql`select r.order_line_id, r.qty, r.state from reservations r
                join sales_order_lines l on l.id = r.order_line_id
               where l.order_id in ${orderIds} order by r.id`,
        )
      ).rows as { order_line_id: string; qty: number; state: string }[]
      const transitions = (
        await db.execute(
          sql`select order_id, event, actor_id from order_state_transitions
               where order_id in ${orderIds} order by id`,
        )
      ).rows as { order_id: string; event: string; actor_id: string }[]
      const events = (
        await db.execute(
          sql`select aggregate_id, event_type from outbox_events
               where aggregate_id in ${orderIds} order by id`,
        )
      ).rows as { aggregate_id: string; event_type: string }[]
      return { orders, lines, held, transitions, events }
    }

    it('DOS-115: a warehouse or delivery login cannot create, re-line, repeat, submit or cancel an order — 403 at the gate, refused in the handler, nothing written', async () => {
      const before = await snapshot()
      const oneLine = () => [
        { id: uuidv7(), variantId: variantA, enteredQty: 1, enteredUnit: 'piece' },
      ]

      // every write path, for both roles, on the rep's confirmed order and on its drafts; the gate names the
      // route by its Nest pattern (`POST /orders/:id/cancel`)
      const answers: { call: string; status: number; message: string | null; gate: string }[] = []
      for (const { actor, tag, created, repeated } of intruders) {
        const probes: [url: string, route: string, body: Record<string, unknown>][] = [
          [
            '/orders',
            '/orders',
            {
              idempotencyKey: `dos115-create-${tag}`,
              id: created,
              retailerId: retailerA,
              source: 'salesperson',
              lines: oneLine(),
            },
          ],
          [
            `/orders/${linesDraft}/lines`,
            '/orders/:id/lines',
            { idempotencyKey: `dos115-lines-${tag}`, lines: oneLine() },
          ],
          [
            '/orders/repeat-last',
            '/orders/repeat-last',
            {
              idempotencyKey: `dos115-repeat-${tag}`,
              id: repeated,
              retailerId: retailerA,
              source: 'salesperson',
            },
          ],
          [
            `/orders/${submitDraft}/submit`,
            '/orders/:id/submit',
            { idempotencyKey: `dos115-submit-${tag}` },
          ],
          [
            `/orders/${confirmed}/cancel`,
            '/orders/:id/cancel',
            {
              idempotencyKey: `dos115-cancel-confirmed-${tag}`,
              reason: 'DOS-115 probe: cancelling a rep’s confirmed order',
            },
          ],
          [
            `/orders/${cancelDraft}/cancel`,
            '/orders/:id/cancel',
            {
              idempotencyKey: `dos115-cancel-draft-${tag}`,
              reason: 'DOS-115 probe: cancelling a rep’s draft',
            },
          ],
        ]
        for (const [url, route, body] of probes) {
          const res = await call<{ message?: string }>(app, actor, 'POST', url, body)
          answers.push({
            call: `${actor.role} POST ${url}`,
            status: res.status,
            message: res.body.message ?? null,
            gate: `the ${actor.role} role may not call POST ${route}`,
          })
        }
      }
      expect(answers).toHaveLength(12)
      expect(answers.map(({ call: c, status, message }) => ({ call: c, status, message }))).toEqual(
        answers.map(({ call: c, gate }) => ({ call: c, status: 403, message: gate })),
      )

      // nothing written: no order under an attempted id, the drafts and the confirmed order as they were
      const after = await snapshot()
      expect(after).toEqual(before)
      for (const id of attempted)
        expect(
          after.orders.find((o) => o.id === id),
          id,
        ).toBeUndefined()
      const row = (id: string) => after.orders.find((o) => o.id === id)
      expect(row(confirmed)).toMatchObject({ state: 'confirmed', cancelled_at: null })
      for (const id of [linesDraft, submitDraft, cancelDraft])
        expect(row(id), id).toMatchObject({ state: 'draft', cancelled_at: null })
      expect(after.held).toEqual([{ order_line_id: confirmedLine, qty: 1, state: 'pending' }])
      expect(after.transitions.filter((t) => [storeId, crewId].includes(t.actor_id))).toEqual([])
      expect(after.events.map((e) => e.event_type)).not.toContain('OrderCancelled')

      // The handler refuses too (over HTTP the gate answers first): `cancel` called in process under a
      // warehouse context is FORBIDDEN, and still nothing is written.
      const orders = app.get(OrdersService)
      const storeCtx: TenantContext = { tenantId, actorId: storeId, actorRole: 'warehouse' }
      const refused = await tenantStorage
        .run(storeCtx, () =>
          orders.cancel({
            id: cancelDraft,
            idempotencyKey: `dos115-cancel-in-process-${run}`,
            reason: 'DOS-115 probe: in process, past the gate',
          }),
        )
        .then(
          () => null,
          (error: unknown) => error,
        )
      expect(refused).toBeInstanceOf(ORPCError)
      expect(refused).toMatchObject({ code: 'FORBIDDEN' })
      expect(await snapshot()).toEqual(before)
    })

    it('DOS-115: a warehouse or delivery device upload cannot draft or re-line an order — rejected forbidden, nothing written', async () => {
      const before = await snapshot()
      type Uploaded = {
        accepted: number
        replayed: number
        rejected: { opId: string; code: string }[]
      }
      for (const { actor, tag, uploaded } of intruders) {
        // No baseUpdatedAt: `vetoIfStale` runs before the handler and would answer `stale` first.
        const res = await call<Uploaded>(app, actor, 'POST', '/sync/upload', {
          protocol: 1,
          deviceId: `dos115-device-${tag}`,
          ops: [
            {
              opId: `dos115-so-${tag}`,
              op: 'PUT',
              table: 'sales_orders',
              id: uploaded,
              data: { retailer_id: retailerA, state: 'draft', note: 'DOS-115 device draft' },
            },
            {
              opId: `dos115-sol-${tag}`,
              op: 'PUT',
              table: 'sales_order_lines',
              id: uuidv7(),
              data: {
                order_id: linesDraft,
                variant_id: variantA,
                entered_qty: 2,
                entered_unit: 'piece',
              },
            },
          ],
        })
        expect(res.status, actor.role).toBe(200)
        // The upload door (DOS-166, `SyncRegistry.mayUploadTable`) refuses a non-placer before the savepoint,
        // so over upload the handlers' `requirePlacer` is never reached; it is pinned directly below.
        expect(
          {
            accepted: res.body.accepted,
            rejected: res.body.rejected.map((r) => [r.opId, r.code]),
          },
          actor.role,
        ).toEqual({
          accepted: 0,
          rejected: [
            [`dos115-so-${tag}`, SYNC_REJECTION_CODES.roleNotAllowed],
            [`dos115-sol-${tag}`, SYNC_REJECTION_CODES.roleNotAllowed],
          ],
        })
      }

      const after = await snapshot()
      expect(after).toEqual(before)
      for (const { uploaded } of intruders)
        expect(
          after.orders.find((o) => o.id === uploaded),
          uploaded,
        ).toBeUndefined()
      // the device's "needs attention" tray holds the four refusals
      const trays = intruders.map((i) => `dos115-device-${i.tag}`)
      const errors = (
        await db.execute(
          sql`select device_id, table_name, code from sync_errors
               where tenant_id = ${tenantId} and device_id in ${trays}`,
        )
      ).rows as { device_id: string; table_name: string; code: string }[]
      expect(errors.map((e) => `${e.device_id} ${e.table_name} ${e.code}`).sort()).toEqual(
        trays
          .flatMap((t) => [
            `${t} sales_order_lines ${SYNC_REJECTION_CODES.roleNotAllowed}`,
            `${t} sales_orders ${SYNC_REJECTION_CODES.roleNotAllowed}`,
          ])
          .sort(),
      )

      // Defence in depth: the handlers' own rule still refuses the godown `forbidden` and lets a rep through.
      const storeCtx: TenantContext = { tenantId, actorId: storeId, actorRole: 'warehouse' }
      const thrown = (() => {
        try {
          tenantStorage.run(storeCtx, () => requirePlacer())
          return null
        } catch (error: unknown) {
          return error
        }
      })()
      expect(thrown).toBeInstanceOf(SyncRejection)
      expect(thrown).toMatchObject({ code: 'forbidden' })
      expect(() =>
        tenantStorage.run({ ...storeCtx, actorRole: 'salesperson' }, () => requirePlacer()),
      ).not.toThrow()
    })

    it('DOS-115: the godown and the crew still read an order, a rep still cancels its own draft, and ORDER_PLACERS equals the matrix plus system', async () => {
      for (const actor of [store, crew]) {
        const got = await call<{ item: Detail }>(app, actor, 'GET', `/orders/${confirmed}`)
        expect(got.status, actor.role).toBe(200)
        expect(
          got.body.item.lines.map((l) => l.id),
          actor.role,
        ).toEqual([confirmedLine])
        const listed = await call<{ items: { id: string }[] }>(app, actor, 'GET', '/orders', {
          retailerId: retailerA,
          limit: 200,
        })
        expect(listed.status, actor.role).toBe(200)
      }

      // the rep the drafts belong to still cancels one
      const own = await call<{ item: Detail }>(app, rep, 'POST', `/orders/${cancelDraft}/cancel`, {
        idempotencyKey: `dos115-cancel-own-${run}`,
        reason: 'shop changed its mind',
      })
      expect(own.status).toBe(200)
      expect(own.body.item.state).toBe('cancelled')

      // one core tuple for the five procedures and the device doors, pinned to the matrix the gate enforces
      expect(ORDER_PLACERS).toContain('system')
      const placers = ORDER_PLACERS.filter((role) => role !== 'system')
      for (const path of [
        'orders.create',
        'orders.setLines',
        'orders.repeatLast',
        'orders.submit',
        'orders.cancel',
      ])
        expect(permissionFor(path), path).toEqual(placers)
    })
  })

  // -----------------------------------------------------------------------------------------------------
  // DOS-126: a rate approved after the draft is charged when the order confirms. A line is priced only while the
  // order is a draft, so confirm prices the stored lines again through the engine on the caller's transaction (a
  // rate approved by the very decision that confirms is visible to it), on the draft's date, and changes only a
  // line that approval prices lower; every other line keeps its drafted money. One case of variant A (12 pcs at
  // ₹10, GST 12%) asked at ₹9: 10 800 + 1 296 GST = 12 096 and the order ₹121.00 (+4 paise); at list it stays
  // 12 000 + 1 440 = 13 440 and ₹134.00 (−40). After DOS-115's block, with its own opening stock; every rep ask
  // names its order, the shop's standalone ask is expired afterwards and every order is cancelled, so nothing
  // here moves another test's rate, reservation or shortage.

  describe('DOS-126 an approved rate is charged at confirm', () => {
    type Placed = { orderId: string; lineId: string; bargainId: string }
    type GateKind = 'bargain' | 'credit_limit'
    type Refused = { message: string; data?: { code?: string } }

    /** The line and header of 1 cs of variant A charged at the approved ₹9. */
    const CHARGED_LINE = {
      qtyPcs: 12,
      listRatePaise: 1_000,
      ratePaise: 900,
      discountPaise: 1_200,
      discountBps: 1_000,
      gstBps: 1_200,
      taxPaise: 1_296,
      lineTotalPaise: 12_096,
      priceLocked: true,
    }
    const CHARGED_ORDER = {
      subtotalPaise: 12_000,
      discountPaise: 1_200,
      taxPaise: 1_296,
      roundOffPaise: 4,
      totalPaise: 12_100,
    }
    const bargainRule = (bargainId: string): unknown =>
      expect.objectContaining({ kind: 'bargain', ruleId: bargainId, amountPaise: 1_200 })
    const ids = (): Placed => ({ orderId: uuidv7(), lineId: uuidv7(), bargainId: uuidv7() })

    beforeAll(async () => {
      // The shortage test holds variant A's first 100 pieces: 60 of its own, so every order here holds its 12.
      const inventory = app.get(InventoryService)
      await asOwner(async (tx) => {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId: variantA,
          batchNo: `DOS126-${run}`,
          mrpPaise: 4000,
        })
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: 60,
            reason: 'opening',
            idempotencyKey: `open-${run}-dos126`,
          },
        ])
      })
    })

    /**
     * The sales app's order (DOS-005 network trace): the rep asks ₹9 for 1 cs naming the draft — it has no bound
     * here, so the desk decides — drafts it (with any `extra` lines), runs `afterCreate`, and submits. The draft is
     * priced at list, because the ask is still waiting.
     */
    const placeHeld = async (
      tag: string,
      retailerId: string,
      p: Placed,
      opts: {
        extra?: { id: string; variantId: string; enteredQty: number; enteredUnit: string }[]
        afterCreate?: () => Promise<void>
      } = {},
    ): Promise<Detail> => {
      const asked = await call<{ item: { status: string } }>(
        app,
        rep,
        'POST',
        '/pricing/bargains',
        {
          idempotencyKey: `dos126-ask-${tag}-${run}`,
          id: p.bargainId,
          retailerId,
          variantId: variantA,
          askedRatePaise: 900,
          qtyPcs: 12,
          orderId: p.orderId,
        },
      )
      expect(asked.status, tag).toBe(200)
      expect(asked.body.item.status, tag).toBe('requested')
      const created = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
        idempotencyKey: `dos126-create-${tag}-${run}`,
        id: p.orderId,
        retailerId,
        source: 'salesperson',
        lines: [
          { id: p.lineId, variantId: variantA, enteredQty: 1, enteredUnit: 'case' },
          ...(opts.extra ?? []),
        ],
      })
      expect(created.status, tag).toBe(200)
      expect(
        created.body.item.lines.find((l) => l.id === p.lineId),
        tag,
      ).toMatchObject({ qtyPcs: 12, ratePaise: 1_000, lineTotalPaise: 13_440, appliedRules: [] })
      await opts.afterCreate?.()
      const submitted = await call<{ item: Detail }>(
        app,
        rep,
        'POST',
        `/orders/${p.orderId}/submit`,
        { idempotencyKey: `dos126-submit-${tag}-${run}` },
      )
      expect(submitted.status, tag).toBe(200)
      return submitted.body.item
    }

    const gate = async (orderId: string, kind: GateKind): Promise<string> => {
      const rows = await db
        .select({ id: approvals.id })
        .from(approvals)
        .where(
          and(
            eq(approvals.orderId, orderId),
            eq(approvals.kind, kind),
            eq(approvals.status, 'pending'),
          ),
        )
      expect(rows, `pending ${kind} gate`).toHaveLength(1)
      return rows[0]?.id ?? ''
    }

    /** Owner, Approvals tab: approve the order's pending gate of this kind. */
    const approveGate = async (tag: string, orderId: string, kind: GateKind) =>
      call<Decided>(app, owner, 'POST', `/approvals/${await gate(orderId, kind)}/decide`, {
        idempotencyKey: `dos126-gate-${kind}-${tag}-${run}`,
        decision: 'approve',
        note: `DOS-126 ${tag}`,
      })

    /** Owner, Rate requests tab: approve the request at the asked rate. */
    const approveAsk = async (tag: string, bargainId: string): Promise<void> => {
      const res = await call<{ item: { status: string; approvedRatePaise: number | null } }>(
        app,
        owner,
        'POST',
        `/pricing/bargains/${bargainId}/decide`,
        { idempotencyKey: `dos126-rate-${tag}-${run}`, id: bargainId, decision: 'approve' },
      )
      expect(res.status, tag).toBe(200)
      expect(res.body.item, tag).toMatchObject({ status: 'approved', approvedRatePaise: 900 })
    }

    const heldOn = async (lineId: string): Promise<number> => {
      const rows = (
        await db.execute(
          sql`select coalesce(sum(qty), 0)::int as held from reservations
               where tenant_id = ${tenantId} and order_line_id = ${lineId} and state = 'pending'`,
        )
      ).rows as { held: number }[]
      return Number(rows[0]?.held ?? 0)
    }

    /** `totalPaise` of every `OrderConfirmed` event the order published. */
    const confirmedTotals = async (orderId: string): Promise<number[]> => {
      const rows = (
        await db.execute(
          sql`select payload->>'totalPaise' as total from outbox_events
               where tenant_id = ${tenantId} and aggregate_id = ${orderId} and event_type = 'OrderConfirmed'
               order by id`,
        )
      ).rows as { total: string }[]
      return rows.map((r) => Number(r.total))
    }

    /** The reply and the database carry the approved rate: the line, the header, the 12 held pieces, the event. */
    const expectCharged = async (p: Placed, order: Detail | null | undefined): Promise<void> => {
      expect(order?.state).toBe('confirmed')
      expect(order).toMatchObject(CHARGED_ORDER)
      const line = order?.lines.find((l) => l.id === p.lineId)
      expect(line).toMatchObject(CHARGED_LINE)
      expect(line?.appliedRules).toContainEqual(bargainRule(p.bargainId))
      const [stored] = await db
        .select()
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, p.lineId))
      expect(stored).toMatchObject({ orderId: p.orderId, ...CHARGED_LINE })
      expect(stored?.appliedRules).toContainEqual(bargainRule(p.bargainId))
      const [header] = await db.select().from(salesOrders).where(eq(salesOrders.id, p.orderId))
      expect(header).toMatchObject({ state: 'confirmed', ...CHARGED_ORDER })
      expect(await heldOn(p.lineId)).toBe(12)
      expect(await confirmedTotals(p.orderId)).toEqual([12_100])
    }

    /** Gives back whatever a confirm held and closes the order, whatever the test reached. */
    const cancel = (tag: string, orderId: string) =>
      call(app, owner, 'POST', `/orders/${orderId}/cancel`, {
        idempotencyKey: `dos126-cleanup-${tag}-${run}`,
        reason: 'test cleanup',
      })

    it('DOS-126: bargain gate approved first, credit gate last — the order confirms with the line at the approved rate (the SO-0897 walk)', async () => {
      const p = ids()
      try {
        const submitted = await placeHeld('t1', retailerB, p)
        expect(submitted.state).toBe('submitted')
        expect([...submitted.approvalFlags].sort()).toEqual(['bargain', 'credit_limit'])
        const first = await approveGate('t1', p.orderId, 'bargain')
        expect(first.status).toBe(200)
        expect(first.body.order?.state).toBe('submitted')
        const last = await approveGate('t1', p.orderId, 'credit_limit')
        expect(last.status).toBe(200)
        await expectCharged(p, last.body.order)
      } finally {
        await cancel('t1', p.orderId)
      }
    })

    it("DOS-126: credit gate first, bargain gate last — the confirm inside the bargain decision's transaction charges the rate that decision approved", async () => {
      const p = ids()
      try {
        const submitted = await placeHeld('t2', retailerB, p)
        expect([...submitted.approvalFlags].sort()).toEqual(['bargain', 'credit_limit'])
        const first = await approveGate('t2', p.orderId, 'credit_limit')
        expect(first.status).toBe(200)
        expect(first.body.order?.state).toBe('submitted')
        // still `requested`: only the decision below approves it, in the transaction that confirms
        expect(await bargainRow(p.bargainId)).toMatchObject({
          status: 'requested',
          approvedRatePaise: null,
        })
        const last = await approveGate('t2', p.orderId, 'bargain')
        expect(last.status).toBe(200)
        await expectCharged(p, last.body.order)
      } finally {
        await cancel('t2', p.orderId)
      }
    })

    it('DOS-126: a rate approved on Rate requests is charged when the Approvals gates later confirm the order', async () => {
      const p = ids()
      try {
        const submitted = await placeHeld('t3', retailerB, p)
        expect([...submitted.approvalFlags].sort()).toEqual(['bargain', 'credit_limit'])
        await approveAsk('t3', p.bargainId)
        // the gate keeps the request's own outcome (DOS-005 `ifStillRequested`); the credit gate still waits
        const bargainGate = await approveGate('t3', p.orderId, 'bargain')
        expect(bargainGate.status).toBe(200)
        expect(bargainGate.body.order?.state).toBe('submitted')
        const last = await approveGate('t3', p.orderId, 'credit_limit')
        expect(last.status).toBe(200)
        await expectCharged(p, last.body.order)
      } finally {
        await cancel('t3', p.orderId)
      }
    })

    it('DOS-126: a bargain that is the only gate confirms at the approved rate (indicate shop)', async () => {
      const p = ids()
      try {
        const submitted = await placeHeld('t4', retailerA, p)
        expect(submitted.state).toBe('submitted')
        expect(submitted.approvalFlags).toEqual(['bargain'])
        const last = await approveGate('t4', p.orderId, 'bargain')
        expect(last.status).toBe(200)
        await expectCharged(p, last.body.order)
      } finally {
        await cancel('t4', p.orderId)
      }
    })

    it("DOS-126: a rate approved after the draft and before submit is charged at confirm — through the credit gate and through submit's own auto-confirm", async () => {
      const auto = ids()
      const held = ids()
      try {
        // Shop A (`indicate`): nothing waits once the rate is approved, so submit's own auto-confirm charges it
        const submittedA = await placeHeld('t5a', retailerA, auto, {
          afterCreate: () => approveAsk('t5a', auto.bargainId),
        })
        expect(submittedA.approvalFlags).toEqual([])
        await expectCharged(auto, submittedA)
        // Shop B (`strict`, over its limit): the credit gate's approval confirms and charges it
        const submittedB = await placeHeld('t5b', retailerB, held, {
          afterCreate: () => approveAsk('t5b', held.bargainId),
        })
        expect(submittedB.state).toBe('submitted')
        expect(submittedB.approvalFlags).toEqual(['credit_limit'])
        const last = await approveGate('t5b', held.orderId, 'credit_limit')
        expect(last.status).toBe(200)
        await expectCharged(held, last.body.order)
      } finally {
        await cancel('t5a', auto.orderId)
        await cancel('t5b', held.orderId)
      }
    })

    it('DOS-126: confirm changes only the line the approval priced — another line keeps its drafted rate and is not rewritten after an office price edit', async () => {
      const p = ids()
      const other = uuidv7()
      const variantBItem = and(
        eq(priceListItems.tenantId, tenantId),
        eq(priceListItems.variantId, variantB),
      )
      const touchedAt = async (): Promise<string | undefined> =>
        (
          (
            await db.execute(
              sql`select updated_at::text as at from sales_order_lines where id = ${other}`,
            )
          ).rows as { at: string }[]
        )[0]?.at
      const untouched = {
        listRatePaise: 2_500,
        ratePaise: 2_500,
        discountPaise: 0,
        taxPaise: 300,
        lineTotalPaise: 2_800,
        appliedRules: [],
        priceLocked: false,
      }
      // 14 500 gross − 1 200 + 1 596 GST = 14 896 → ₹149.00 (at list ₹162.00; a full re-price would say ₹150.00)
      const totals = {
        subtotalPaise: 14_500,
        discountPaise: 1_200,
        taxPaise: 1_596,
        roundOffPaise: 4,
        totalPaise: 14_900,
      }
      try {
        const submitted = await placeHeld('t6', retailerA, p, {
          extra: [{ id: other, variantId: variantB, enteredQty: 1, enteredUnit: 'piece' }],
          // the office edits variant B's list rate in place between the draft and the decision
          afterCreate: async () => {
            await db.update(priceListItems).set({ ratePaise: 2_600 }).where(variantBItem)
          },
        })
        expect(submitted.approvalFlags).toEqual(['bargain'])
        expect(submitted.totalPaise).toBe(16_200)
        const before = await touchedAt()
        expect(before).toBeDefined()

        const last = await approveGate('t6', p.orderId, 'bargain')
        expect(last.status).toBe(200)
        const order = last.body.order
        expect(order?.state).toBe('confirmed')
        expect(order?.lines.find((l) => l.id === p.lineId)).toMatchObject(CHARGED_LINE)
        expect(order?.lines.find((l) => l.id === other)).toMatchObject(untouched)
        const [stored] = await db
          .select()
          .from(salesOrderLines)
          .where(eq(salesOrderLines.id, other))
        expect(stored).toMatchObject(untouched)
        expect(await touchedAt()).toBe(before)
        expect(order).toMatchObject(totals)
        const [header] = await db.select().from(salesOrders).where(eq(salesOrders.id, p.orderId))
        expect(header).toMatchObject(totals)
        expect(await confirmedTotals(p.orderId)).toEqual([14_900])
      } finally {
        await db.update(priceListItems).set({ ratePaise: 2_500 }).where(variantBItem)
        await cancel('t6', p.orderId)
      }
    })

    it("DOS-126: a shop's own order confirms at the rate the office approved on its standalone ask (auto-confirm under the system role)", async () => {
      const p = ids()
      try {
        const drafted = await call<{ item: Detail }>(app, shop, 'POST', '/orders', {
          idempotencyKey: `dos126-create-t7-${run}`,
          id: p.orderId,
          retailerId: retailerA,
          source: 'retailer_app',
          lines: [{ id: p.lineId, variantId: variantA, enteredQty: 1, enteredUnit: 'case' }],
        })
        expect(drafted.status).toBe(200)
        expect(drafted.body.item.lines[0]).toMatchObject({
          qtyPcs: 12,
          ratePaise: 1_000,
          lineTotalPaise: 13_440,
        })
        // the retailer app asks with no order id (order.tsx): a standalone ask for the shop and the item
        const asked = await call<{ item: { status: string; orderId: string | null } }>(
          app,
          shop,
          'POST',
          '/pricing/bargains',
          {
            idempotencyKey: `dos126-ask-t7-${run}`,
            id: p.bargainId,
            retailerId: retailerA,
            variantId: variantA,
            askedRatePaise: 900,
            qtyPcs: 12,
          },
        )
        expect(asked.status).toBe(200)
        expect(asked.body.item).toMatchObject({ status: 'requested', orderId: null })
        await approveAsk('t7', p.bargainId)

        const submitted = await call<{ item: Detail }>(
          app,
          shop,
          'POST',
          `/orders/${p.orderId}/submit`,
          { idempotencyKey: `dos126-submit-t7-${run}` },
        )
        expect(submitted.status).toBe(200)
        expect(submitted.body.item.approvalFlags).toEqual([])
        await expectCharged(p, submitted.body.item)
      } finally {
        // an approved standalone rate would price every later order of Shop A for variant A
        await db
          .update(bargainRequests)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(bargainRequests.id, p.bargainId))
        await cancel('t7', p.orderId)
      }
    })

    it('DOS-126: an approved rate the engine cannot price on the draft date refuses the approval with reprice_failed — the decision rolls back and the order still waits', async () => {
      const p = ids()
      const activeLists = (
        await db
          .select({ id: priceLists.id })
          .from(priceLists)
          .where(and(eq(priceLists.tenantId, tenantId), eq(priceLists.active, true)))
      ).map((l) => l.id)
      expect(activeLists.length).toBeGreaterThan(0)
      try {
        const submitted = await placeHeld('te', retailerA, p)
        expect(submitted.approvalFlags).toEqual(['bargain'])
        const gateId = await gate(p.orderId, 'bargain')
        // the office switches the price list off before the decision: the draft's item has no price any more
        await db
          .update(priceLists)
          .set({ active: false })
          .where(inArray(priceLists.id, activeLists))

        const refused = await call<Refused>(app, owner, 'POST', `/approvals/${gateId}/decide`, {
          idempotencyKey: `dos126-gate-bargain-te-${run}`,
          decision: 'approve',
        })
        expect(refused.status).toBe(400)
        expect(refused.body.message).toBe(
          `${submitted.orderNo ?? ''} holds an approved rate that cannot be priced today (No price for variant ${variantA} (line ${p.lineId})); fix the price list or reject the rate request`,
        )
        expect(refused.body.data?.code).toBe('reprice_failed')

        // nothing of the decision stuck: the gate and the request still wait, and the order holds nothing
        const [stillPending] = await db.select().from(approvals).where(eq(approvals.id, gateId))
        expect(stillPending?.status).toBe('pending')
        expect(await bargainRow(p.bargainId)).toMatchObject({
          status: 'requested',
          approvedRatePaise: null,
        })
        const [header] = await db.select().from(salesOrders).where(eq(salesOrders.id, p.orderId))
        expect(header).toMatchObject({ state: 'submitted', totalPaise: 13_400 })
        const [line] = await db
          .select()
          .from(salesOrderLines)
          .where(eq(salesOrderLines.id, p.lineId))
        expect(line).toMatchObject({ ratePaise: 1_000, lineTotalPaise: 13_440, appliedRules: [] })
        expect(await heldOn(p.lineId)).toBe(0)
      } finally {
        await db.update(priceLists).set({ active: true }).where(inArray(priceLists.id, activeLists))
        await cancel('te', p.orderId)
      }
    })
  })
  /**
   * DOS-141 — a refused decision has to say WHICH gate and WHOSE decision it is about.
   *
   * Two desks open the queue, both press Approve, and the second one was told "approval
   * 01a09766-114f-73f5-b1fc-9d9cab81e82e was already approved": a row id, no order, no name, no time.
   */
  describe('DOS-141 a refused decision is written for the desk that pressed', () => {
    it('DOS-141: a gate already decided names the order, the approver and the IST time, and carries no id', async () => {
      const orderId = uuidv7()
      const lineId = uuidv7()
      const draft = await call<{ item: Detail }>(app, rep, 'POST', '/orders', {
        idempotencyKey: `dos141-create-${run}`,
        id: orderId,
        retailerId: retailerA,
        source: 'salesperson',
        lines: [{ id: lineId, variantId: variantA, enteredQty: 1, enteredUnit: 'case' }],
      })
      expect(draft.status).toBe(200)
      const submitted = await call<{ item: Detail }>(
        app,
        rep,
        'POST',
        `/orders/${orderId}/submit`,
        { idempotencyKey: `dos141-submit-${run}` },
      )
      expect(submitted.status).toBe(200)
      const orderNo = submitted.body.item.orderNo ?? ''
      expect(orderNo).not.toBe('')

      // The gate the first desk has already approved, decided at 4:20 pm IST on 13 September.
      const approvalId = uuidv7()
      await db.insert(approvals).values({
        id: approvalId,
        tenantId,
        kind: 'credit_limit',
        orderId,
        entityType: 'sales_order',
        entityId: orderId,
        requestedBy: repId,
        status: 'approved',
        payload: {},
        decidedBy: ownerId,
        decidedAt: new Date('2026-09-13T10:50:00.000Z'),
      })

      const refused = await call<{ message: string }>(
        app,
        manager,
        'POST',
        `/approvals/${approvalId}/decide`,
        { idempotencyKey: `dos141-decide-${run}`, decision: 'approve' },
      )
      expect(refused.status).toBe(409)
      expect(refused.body.message).toBe(
        `the credit limit gate on ${orderNo} was already approved by Owner on 13 Sep, 4:20 pm`,
      )
      expect(refused.body.message).not.toContain(approvalId)
      expect(refused.body.message).not.toContain(ownerId)
      expect(refused.body.message).not.toContain('T10:50')
    })
  })
})
