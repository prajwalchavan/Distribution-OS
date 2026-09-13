// QA PROBE S-106 (temporary, never committed): the manager billing desk's "left to bill" header adds the two
// replies the screen reads — GET /billing/queue {limit:200} and GET /warehouse/packs {invoiced:false, limit:50}.
// A PARKED pack (packs.confirm issueInvoice:false) is BOTH a packed order with no live bill AND a pack with no
// invoice_id, so the probe checks whether it is in both replies and what the screen's own arithmetic makes of it.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
import { OrdersModule } from '../orders/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { BillingModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip
const LOG_FILE =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/suspects/S-106/probe-log.txt'
const log = (label: string, value: unknown) => {
  const line = `[S-106] ${label}: ${JSON.stringify(value)}`
  console.log(line)
  appendFileSync(LOG_FILE, `${line}\n`)
}

// ---- the screen's own count helpers, copied VERBATIM from frontend/manager-app/src/lib/ui.tsx (pagedCount,
// countText, addCounts). The spec below asserts the source still carries these exact bodies, so the copy is
// the screen's arithmetic and not a guess at it.
interface PagedCount {
  count: number | undefined
  more: boolean
}
function pagedCount(result: {
  data?: { items: readonly unknown[]; nextCursor?: string | null | undefined } | undefined
}): PagedCount {
  const items = result.data?.items
  if (items === undefined) return { count: undefined, more: false }
  const cursor = result.data?.nextCursor
  return { count: items.length, more: cursor !== null && cursor !== undefined && cursor !== '' }
}
function countText(of: PagedCount, none: string): string {
  return of.count === undefined ? none : `${String(of.count)}${of.more ? '+' : ''}`
}
function addCounts(a: PagedCount, b: PagedCount): PagedCount {
  if (a.count === undefined && b.count === undefined) return { count: undefined, more: false }
  return { count: (a.count ?? 0) + (b.count ?? 0), more: a.more || b.more }
}

type QueueBody = {
  items: { orderId: string; orderNo: string | null; state: string; hasDraftInvoice: boolean }[]
  nextCursor: string | null
}
type PacksBody = {
  items: { id: string; orderId: string; orderNo: string | null; invoiceId: string | null; retailerName: string }[]
  nextCursor: string | null
}

describeDb('QA probe S-106: a parked pack counted twice in the billing desk "left to bill"', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `7${run.slice(-6)}`
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const shopUser = uuidv7()
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const retailerId = uuidv7()
  const variantId = uuidv7()
  let godown = ''
  let app: NestFastifyApplication
  let headerTemplate = ''

  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `s106-${run}`, legalName: 'Probe Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91971${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91971${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91971${run}3`, name: 'Accountant' },
      { id: packerId, phone: `+91971${run}4`, name: 'Packer' },
      { id: repId, phone: `+91971${run}5`, name: 'Rep' },
      { id: shopUser, phone: `+91972${run}1`, name: 'Shopkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: shopUser, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker s106 ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Namkeen', category: 'namkeen' })
    await db.insert(productVariants).values({
      id: variantId,
      productId,
      name: 'Namkeen 50 g',
      netQty: 50,
      netUnit: 'g',
      defaultCaseSize: 12,
      hsnCode: hsn,
      mrpPaise: 1000,
    })
    await db.insert(tenantProducts).values({ id: uuidv7(), tenantId, variantId, caseSizeOverride: 12 })
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, cessBps: 0, effectiveFrom: '2020-04-01' })
    const identityId = uuidv7()
    await db.insert(retailerIdentities).values({
      id: identityId,
      phone: `+91973${run}1`,
      userId: shopUser,
      shopName: `Probe Shop ${run}`,
    })
    await db.insert(retailers).values({
      id: retailerId,
      tenantId,
      identityId,
      code: `S106-${run}`,
      name: `Probe Shop ${run}`,
      ownerName: 'Owner',
      phone: `+91973${run}1`,
      stateCode: '27',
      gstRegType: 'regular',
      gstin: '27AAXPT9021Q1ZQ',
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
    const priceListId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    await db
      .insert(priceListItems)
      .values({ id: uuidv7(), tenantId, priceListId, variantId, ratePaise: 1000 })
    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''

    app = await bootTestApp([
      BillingModule,
      WarehouseModule,
      OrdersModule,
      InventoryModule,
      ReceivablesModule,
    ])
    const inventory = app.get(InventoryService)
    await as({ tenantId, actorId: ownerId, actorRole: 'owner' }, async (tx) => {
      const lot = await inventory.findOrCreateLot(tx, {
        variantId,
        batchNo: `S106-${run}`,
        mrpPaise: 1000,
        expiryDate: '2028-01-31',
      })
      await inventory.post(tx, [
        {
          lotId: lot.lot.id,
          locationId: godown,
          qtyDelta: 1_000,
          reason: 'opening',
          idempotencyKey: `open-s106-${run}`,
        },
      ])
    })
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  const placeOrder = async (tag: string): Promise<string> => {
    const orderId = uuidv7()
    const created = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `order-s106-${tag}-${run}`,
      id: orderId,
      retailerId,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId, enteredQty: 1, enteredUnit: 'case' }],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    const submitted = await call(app, rep, 'POST', `/orders/${orderId}/submit`, {
      idempotencyKey: `sub-s106-${tag}-${run}`,
    })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200)
    return orderId
  }

  const pack = async (orderId: string, tag: string, issueInvoice: boolean) => {
    const packId = uuidv7()
    const res = await call<{ item: { id: string; invoiceId: string | null }; invoice: { id: string } | null }>(
      app,
      packer,
      'POST',
      `/warehouse/orders/${orderId}/pack`,
      { idempotencyKey: `pack-s106-${tag}-${run}`, id: packId, packages: 1, issueInvoice },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return { packId, invoiceId: res.body.invoice?.id ?? null }
  }

  /** Exactly the two reads the billing desk makes, and exactly its arithmetic over the replies. */
  const deskReads = async (actor: Actor, label: string) => {
    const queue = await call<QueueBody>(app, actor, 'GET', '/billing/queue', { limit: 200 })
    const packs = await call<PacksBody>(app, actor, 'GET', '/warehouse/packs', { invoiced: false, limit: 50 })
    expect(queue.status, JSON.stringify(queue.body)).toBe(200)
    expect(packs.status, JSON.stringify(packs.body)).toBe(200)
    const queueCount = pagedCount({ data: queue.body })
    const packsCount = pagedCount({ data: packs.body })
    const remaining = addCounts(queueCount, packsCount)
    const header = headerTemplate.replace('{count}', countText(remaining, 'none'))
    const queueOrders = queue.body.items.map((i) => i.orderId)
    const packOrders = packs.body.items.map((i) => i.orderId)
    const inBoth = queueOrders.filter((o) => packOrders.includes(o))
    const distinctOrders = new Set([...queueOrders, ...packOrders]).size
    // the truth from the book, independent of both lists: orders still needing a bill
    const truth = (
      await db.execute(sql`
        select count(*)::int as n from (
          select so.id from sales_orders so
           where so.tenant_id = ${tenantId} and so.state = 'packed'
             and not exists (select 1 from invoices i where i.tenant_id = so.tenant_id and i.order_id = so.id
                              and i.state not in ('cancelled', 'draft'))
          union
          select pc.order_id from pack_confirmations pc
           where pc.tenant_id = ${tenantId} and pc.invoice_id is null
        ) u`)
    ).rows[0] as { n: number }
    log(`${label} [${actor.role}] GET /billing/queue {limit:200}`, {
      status: queue.status,
      items: queue.body.items.map((i) => ({ orderId: i.orderId, orderNo: i.orderNo, state: i.state })),
      nextCursor: queue.body.nextCursor,
    })
    log(`${label} [${actor.role}] GET /warehouse/packs {invoiced:false,limit:50}`, {
      status: packs.status,
      items: packs.body.items.map((i) => ({
        packId: i.id,
        orderId: i.orderId,
        orderNo: i.orderNo,
        invoiceId: i.invoiceId,
      })),
      nextCursor: packs.body.nextCursor,
    })
    log(`${label} [${actor.role}] screen arithmetic`, {
      pagedCountQueue: queueCount,
      pagedCountPacks: packsCount,
      remaining,
      header,
      queuePanelMeta: countText(queueCount, 'none'),
      packsPanelMeta: countText(packsCount, 'none'),
      ordersInBothLists: inBoth,
      distinctOrdersAcrossBothReplies: distinctOrders,
      sqlOrdersNeedingABill: truth.n,
    })
    return { queue: queue.body, packs: packs.body, remaining, header, inBoth, distinctOrders, truth: truth.n }
  }

  it('reads the desk around a parked pack and compares the header to the true count', async () => {
    // ---- 0. the code under test is the code the probe copies
    const root = resolve(process.cwd(), '../../..')
    const screenPath = resolve(root, 'frontend/manager-app/app/billing/index.tsx')
    const uiPath = resolve(root, 'frontend/manager-app/src/lib/ui.tsx')
    const stringsPath = resolve(root, 'frontend/manager-app/src/strings.ts')
    expect(existsSync(screenPath) && existsSync(uiPath) && existsSync(stringsPath)).toBe(true)
    const screen = readFileSync(screenPath, 'utf8')
    const ui = readFileSync(uiPath, 'utf8')
    const strings = readFileSync(stringsPath, 'utf8')
    const screenLines = [
      "api.api.billing.invoices.queue({ limit: 200 })",
      'api.api.warehouse.packs.list({ invoiced: false, limit: 50 })',
      'const remaining = addCounts(pagedCount(queue), pagedCount(unbilledPacks))',
      "context={t('m6.remaining', { count: countText(remaining, t('app.none')) })}",
      'api.api.warehouse.packs.list({ orderId: row.orderId, limit: 1 })',
    ]
    const uiLines = [
      "return { count: items.length, more: cursor !== null && cursor !== undefined && cursor !== '' }",
      'return { count: (a.count ?? 0) + (b.count ?? 0), more: a.more || b.more }',
      "return of.count === undefined ? none : `${String(of.count)}${of.more ? '+' : ''}`",
    ]
    for (const l of screenLines) expect(screen.includes(l), `screen carries: ${l}`).toBe(true)
    for (const l of uiLines) expect(ui.includes(l), `ui.tsx carries: ${l}`).toBe(true)
    const m = /'m6\.remaining': '([^']+)'/.exec(strings)
    headerTemplate = m?.[1] ?? ''
    log('source guards', {
      screenLinesFound: screenLines.length,
      uiLinesFound: uiLines.length,
      m6remaining: headerTemplate,
    })

    // ---- 1. P: packed and PARKED (issueInvoice:false); N: packed and billed normally (control)
    const orderP = await placeOrder('parked')
    const packedP = await pack(orderP, 'parked', false)
    expect(packedP.invoiceId).toBeNull()
    const orderN = await placeOrder('normal')
    const packedN = await pack(orderN, 'normal', true)
    expect(packedN.invoiceId).not.toBeNull()
    log('fixture 1', { orderP, packP: packedP.packId, orderN, packN: packedN.packId, invoiceN: packedN.invoiceId })
    log(
      'SQL orders + packs after fixture 1',
      (
        await db.execute(sql`
          select so.id as order_id, so.order_no, so.state, pc.id as pack_id, pc.invoice_id,
                 (select string_agg(i.state::text, ',') from invoices i where i.tenant_id = so.tenant_id and i.order_id = so.id) as invoice_states
            from sales_orders so left join pack_confirmations pc on pc.order_id = so.id and pc.tenant_id = so.tenant_id
           where so.tenant_id = ${tenantId} order by so.created_at`)
      ).rows,
    )

    const r1 = await deskReads(manager, 'READ 1 (parked P + billed N)')
    expect(r1.inBoth).toEqual([orderP])
    const r1acc = await deskReads(accountant, 'READ 1 (parked P + billed N)')

    // the queue row's own "open" lookup (openQueueRow) lands on the SAME pack the panel row bills
    const lookup = await call<PacksBody>(app, manager, 'GET', '/warehouse/packs', { orderId: orderP, limit: 1 })
    log('openQueueRow lookup GET /warehouse/packs {orderId:P,limit:1}', {
      status: lookup.status,
      packId: lookup.body.items[0]?.id,
      panelRowPackId: r1.packs.items.find((i) => i.orderId === orderP)?.id,
    })

    // ---- 2. C: packed, billed, then the bill cancelled (queue-only row: the pack keeps the cancelled invoiceId)
    const orderC = await placeOrder('cancelled')
    const packedC = await pack(orderC, 'cancelled', true)
    const cancelled = await call<{ item: { state: string } }>(
      app,
      manager,
      'POST',
      `/invoices/${packedC.invoiceId ?? ''}/cancel`,
      { idempotencyKey: `cancel-s106-${run}`, id: packedC.invoiceId, reason: 'wrong shop on the bill' },
    )
    log('cancel C bill', { status: cancelled.status, state: cancelled.body.item?.state })
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200)
    const r2 = await deskReads(manager, 'READ 2 (parked P + cancelled-bill C + billed N)')

    // ---- 3. the desk bills P ONCE from the packs panel (billing.invoices.issueForPack)
    const billP = await call<{ item: { id: string; invoiceNo: string | null; state: string } }>(
      app,
      manager,
      'POST',
      `/warehouse/packs/${packedP.packId}/invoice`,
      { idempotencyKey: `bill-p-s106-${run}`, id: uuidv7(), packId: packedP.packId },
    )
    log('issueForPack P (one press)', { status: billP.status, invoiceNo: billP.body.item?.invoiceNo, state: billP.body.item?.state })
    expect(billP.status, JSON.stringify(billP.body)).toBe(200)
    const r3 = await deskReads(manager, 'READ 3 (after billing P once)')

    // a stale second listing of P (the queue row, opened before the refresh) cannot bill it a second time
    const lookP = await call<PacksBody>(app, manager, 'GET', '/warehouse/packs', { orderId: orderP, limit: 1 })
    const billPAgain = await call<{ data?: { code?: string }; message?: string }>(
      app,
      manager,
      'POST',
      `/warehouse/packs/${lookP.body.items[0]?.id ?? ''}/invoice`,
      { idempotencyKey: `bill-p-again-s106-${run}`, id: uuidv7(), packId: lookP.body.items[0]?.id },
    )
    const liveBillsP = (
      await db.execute(
        sql`select count(*)::int as n from invoices where tenant_id = ${tenantId} and order_id = ${orderP} and state <> 'cancelled'`,
      )
    ).rows[0] as { n: number }
    log('issueForPack P again via the queue-row path', {
      status: billPAgain.status,
      code: billPAgain.body.data?.code,
      message: billPAgain.body.message,
      liveBillsForP: liveBillsP.n,
    })

    // ---- 4. the desk bills C from the queue row (lookup by order, then issueForPack)
    const lookC = await call<PacksBody>(app, manager, 'GET', '/warehouse/packs', { orderId: orderC, limit: 1 })
    const billC = await call<{ item: { invoiceNo: string | null; state: string } }>(
      app,
      manager,
      'POST',
      `/warehouse/packs/${lookC.body.items[0]?.id ?? ''}/invoice`,
      { idempotencyKey: `bill-c-s106-${run}`, id: uuidv7(), packId: lookC.body.items[0]?.id },
    )
    log('issueForPack C via queue row', { status: billC.status, invoiceNo: billC.body.item?.invoiceNo })
    expect(billC.status, JSON.stringify(billC.body)).toBe(200)
    const r4 = await deskReads(manager, 'READ 4 (after billing C)')

    log('SUMMARY', [
      { read: 1, header: r1.header, distinctOrders: r1.distinctOrders, sqlTruth: r1.truth, accountantHeader: r1acc.header },
      { read: 2, header: r2.header, distinctOrders: r2.distinctOrders, sqlTruth: r2.truth },
      { read: 3, header: r3.header, distinctOrders: r3.distinctOrders, sqlTruth: r3.truth },
      { read: 4, header: r4.header, distinctOrders: r4.distinctOrders, sqlTruth: r4.truth },
    ])

    // observations of this run, stated as assertions (the suspect's claim)
    expect(r1.remaining.count).toBe(2)
    expect(r1.truth).toBe(1)
    expect(r1acc.remaining.count).toBe(2)
    expect(lookup.body.items[0]?.id).toBe(packedP.packId)
    expect(r2.inBoth).toEqual([orderP])
    expect(r2.remaining.count).toBe(3)
    expect(r2.truth).toBe(2)
    expect(billPAgain.status).toBe(409)
    expect(liveBillsP.n).toBe(1)
    expect(r3.remaining.count).toBe(1)
    expect(r3.truth).toBe(1)
    expect(r4.remaining.count).toBe(0)
    expect(r4.truth).toBe(0)
  }, 180_000)
})
