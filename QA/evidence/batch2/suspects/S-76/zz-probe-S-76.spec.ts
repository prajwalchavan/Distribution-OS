/**
 * QA probe S-76 / S-09 (temporary, never committed): an offline doorstep receipt uploaded through
 * /sync/upload `receipts` (frontend/delivery-app/src/lib/queue.ts useQueueReceipt) lands without a
 * `collections` row; does the trip settlement count its cash?
 */
import { appendFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { businessDate, uuidv7 } from '@dos/domain'
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
const EVIDENCE =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/suspects/S-76/probe-log.jsonl'
const log = (label: string, value: unknown): void => {
  const line = `PROBE ${label} ${JSON.stringify(value)}`
  console.log(line)
  appendFileSync(EVIDENCE, `${line}\n`)
}
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

interface Preview {
  tripState: string
  openingCashPaise: number
  cashCollectedPaise: number
  expensesPaise: number
  expectedCashPaise: number
  tolerancePaise: number
  collectionsCount: number
  stopsDelivered: number
  expectedVanStock: { lotId: string; expectedPcs: number }[]
}
interface Bill {
  orderId: string
  invoiceId: string
  totalPaise: number
  lineId: string
  qtyPcs: number
}

describeDb('S-76 probe (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `8${run.slice(-6)}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const driver1Id = uuidv7()
  const driver2Id = uuidv7()
  const driver3Id = uuidv7()
  const shopUserA = uuidv7()
  const shopUserB = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver1: Actor = { tenantId, actorId: driver1Id, role: 'delivery' }
  const driver2: Actor = { tenantId, actorId: driver2Id, role: 'delivery' }
  const driver3: Actor = { tenantId, actorId: driver3Id, role: 'delivery' }

  const ctxOf = (actorId: string, actorRole: TenantContext['actorRole']): TenantContext => ({
    tenantId,
    actorId,
    actorRole,
  })
  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))

  const retailerA = uuidv7()
  const retailerB = uuidv7()
  const variantA = uuidv7()
  let godown = ''
  let lotA = ''
  let app: NestFastifyApplication
  const today = businessDate(new Date()).date

  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows
  const balance = async (code: string): Promise<number> =>
    Number(
      (
        (await rows(sql`select coalesce(sum(l.amount_paise), 0)::bigint as n from journal_lines l
             join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
            where e.tenant_id = ${tenantId} and a.code = ${code}`)) as { n: string }[]
      )[0]?.n ?? 0,
    )
  const journalOf = async (refType: string, refIds: string[]) =>
    rows(sql`select e.ref_type::text as ref_type, e.ref_id, a.code, l.amount_paise::bigint as amount_paise
               from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
              where e.tenant_id = ${tenantId} and e.ref_type = ${refType}
                and e.ref_id in (${sql.join(
                  refIds.map((id) => sql`${id}`),
                  sql`, `,
                )})
              order by e.ref_id, a.code`)
  const books = async () => ({
    CASH_VAN: await balance('CASH_VAN'),
    CASH: await balance('CASH'),
    CASH_SHORT: await balance('CASH_SHORT'),
    TRIP_EXPENSES: await balance('TRIP_EXPENSES'),
  })

  async function billedOrder(retailerId: string, tag: string): Promise<Bill> {
    const orderId = uuidv7()
    const created = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `p76-order-${tag}-${run}`,
      id: orderId,
      retailerId,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 5, enteredUnit: 'case' }],
    })
    expect(created.status, `order ${tag}`).toBe(200)
    const submitted = await call<{ item: { state: string } }>(
      app,
      rep,
      'POST',
      `/orders/${orderId}/submit`,
      { idempotencyKey: `p76-submit-${tag}-${run}` },
    )
    expect(submitted.status, `submit ${tag}`).toBe(200)
    const packed = await call<{ invoice: { id: string } | null }>(
      app,
      packer,
      'POST',
      `/warehouse/orders/${orderId}/pack`,
      { idempotencyKey: `p76-pack-${tag}-${run}`, id: uuidv7(), packages: 1 },
    )
    expect(packed.status, `pack ${tag}`).toBe(200)
    const invoiceId = packed.body.invoice?.id ?? ''
    const bill = await call<{
      item: { lines: { id: string; qtyPcs?: number }[]; totalPaise: number }
    }>(app, manager, 'GET', `/invoices/${invoiceId}`)
    expect(bill.status).toBe(200)
    return {
      orderId,
      invoiceId,
      totalPaise: bill.body.item.totalPaise,
      lineId: bill.body.item.lines[0]?.id ?? '',
      qtyPcs: 60,
    }
  }

  /** vehicle + consent + planned trip with the given stops, loaded and departed by the driver. */
  async function departedTrip(
    tag: string,
    driver: Actor,
    openingCashPaise: number,
    stops: { id: string; retailerId: string; bill: Bill }[],
  ): Promise<string> {
    const vehicleId = uuidv7()
    const veh = await call(app, owner, 'POST', '/delivery/vehicles', {
      idempotencyKey: `p76-veh-${tag}-${run}`,
      id: vehicleId,
      regNo: `MH-05-P${tag.toUpperCase()}-${run.slice(-4)}`,
      name: `Tempo ${tag}`,
      kind: 'tempo',
      capacityCases: 120,
    })
    expect(veh.status, `vehicle ${tag}`).toBe(200)
    const consent = await call(app, driver, 'POST', '/delivery/consents', {
      idempotencyKey: `p76-consent-${tag}-${run}`,
      id: uuidv7(),
      granted: true,
      noticeVersion: 'gps-2026-09',
    })
    expect(consent.status, `consent ${tag}`).toBe(200)
    const tripId = uuidv7()
    const planned = await call<{ item: { tripNo: string | null } }>(
      app,
      manager,
      'POST',
      '/delivery/trips',
      {
        idempotencyKey: `p76-trip-${tag}-${run}`,
        id: tripId,
        tripDate: today,
        vehicleId,
        driverId: driver.actorId,
        openingCashPaise,
        stops: stops.map((s, i) => ({
          id: s.id,
          sequence: i + 1,
          retailerId: s.retailerId,
          invoiceIds: [s.bill.invoiceId],
        })),
      },
    )
    expect(planned.status, `plan ${tag}: ${JSON.stringify(planned.body)}`).toBe(200)
    const loading = await call(app, packer, 'POST', `/delivery/trips/${tripId}/start-loading`, {
      idempotencyKey: `p76-loading-${tag}-${run}`,
    })
    expect(loading.status, `loading ${tag}`).toBe(200)
    const departed = await call<{ item: { state: string } }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripId}/depart`,
      { idempotencyKey: `p76-depart-${tag}-${run}` },
    )
    expect(departed.status, `depart ${tag}: ${JSON.stringify(departed.body)}`).toBe(200)
    log(`${tag}.trip`, {
      tripId,
      tripNo: planned.body.tripNo ?? planned.body.item.tripNo,
      state: departed.body.item.state,
      openingCashPaise,
    })
    return tripId
  }

  /** The online doorstep delivery, so the stop is really delivered before the money is taken. */
  async function deliver(tag: string, driver: Actor, tripId: string, stopId: string, bill: Bill) {
    const res = await call<{ item?: { outcome: string | null }; message?: string }>(
      app,
      driver,
      'POST',
      '/delivery/deliveries',
      {
        idempotencyKey: `p76-deliver-${tag}-${run}`,
        id: uuidv7(),
        tripId,
        stopId,
        invoiceId: bill.invoiceId,
        receiverName: 'Shop owner',
        lines: [
          {
            id: uuidv7(),
            invoiceLineId: bill.lineId,
            deliveredQtyPcs: bill.qtyPcs,
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
      },
    )
    log(`${tag}.delivery`, { status: res.status, outcome: res.body.item?.outcome ?? null, message: res.body.message })
  }

  /** EXACTLY the wire op useQueueReceipt enqueues and engine.toWireOp sends. */
  async function offlineReceipt(
    tag: string,
    driver: Actor,
    tripId: string,
    retailerId: string,
    amountPaise: number,
  ): Promise<string> {
    const id = uuidv7()
    const at = new Date().toISOString()
    const deviceId = `probe-phone-${tag}-${run}`
    const op = {
      opId: uuidv7(),
      op: 'PUT',
      table: 'receipts',
      id,
      data: {
        retailer_id: retailerId,
        trip_id: tripId,
        mode: 'cash',
        amount_paise: amountPaise,
        received_at: at,
        received_by: driver.actorId,
        device_id: deviceId,
        status: 'collected',
        client_receipt_no: `BOOK-${tag}-${run}`,
      },
      clientTime: at,
    }
    const res = await call<{ accepted: number; rejected: unknown[] }>(
      app,
      driver,
      'POST',
      '/sync/upload',
      { protocol: 1, deviceId, ops: [op] },
    )
    log(`${tag}.sync.upload.request`, op)
    log(`${tag}.sync.upload.response`, { status: res.status, body: res.body })
    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(1)
    return id
  }

  const tripMoney = async (tag: string, tripId: string) => {
    log(
      `${tag}.db.receipts`,
      await rows(sql`select id, receipt_no, mode::text as mode, amount_paise, trip_id, device_id, client_receipt_no, status::text as status
                      from receipts where tenant_id = ${tenantId} and trip_id = ${tripId} order by id`),
    )
    log(
      `${tag}.db.collections`,
      await rows(sql`select id, receipt_id, mode::text as mode, amount_paise from collections
                      where tenant_id = ${tenantId} and trip_id = ${tripId} order by id`),
    )
  }

  const settleAs = async (
    tag: string,
    actor: Actor,
    tripId: string,
    handedOverCashPaise: number,
    counted: { lotId: string; countedPcs: number }[],
    extra: Record<string, unknown> = {},
  ) => {
    const id = uuidv7()
    const res = await call<{
      item?: { cashVariancePaise: number; expectedCashPaise: number; hasVariance: boolean }
      tripState?: string
      data?: { code?: string; approvalId?: string; cashVariancePaise?: number }
      message?: string
    }>(app, actor, 'POST', `/delivery/trips/${tripId}/settle`, {
      idempotencyKey: `p76-settle-${tag}-${run}`,
      id,
      tripId,
      handedOverCashPaise,
      counted,
      note: `probe S-76 ${tag}`,
      ...extra,
    })
    log(`${tag}.settle.${actor.role}`, { status: res.status, body: res.body, settlementId: id })
    return { id, res }
  }

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `p76-${run}`, legalName: 'Probe Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91961${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91961${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91961${run}3`, name: 'Accountant' },
      { id: packerId, phone: `+91961${run}4`, name: 'Packer' },
      { id: repId, phone: `+91961${run}5`, name: 'Rep' },
      { id: driver1Id, phone: `+91961${run}6`, name: 'Driver 1' },
      { id: driver2Id, phone: `+91961${run}7`, name: 'Driver 2' },
      { id: driver3Id, phone: `+91961${run}8`, name: 'Driver 3' },
      { id: shopUserA, phone: `+91962${run}1`, name: 'Shopkeeper A' },
      { id: shopUserB, phone: `+91962${run}2`, name: 'Shopkeeper B' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: driver1Id, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: driver2Id, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: driver3Id, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserA, role: 'retailer' },
      { id: uuidv7(), tenantId, userId: shopUserB, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker p76 ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Namkeen', category: 'namkeen' })
    await db.insert(productVariants).values({
      id: variantA,
      productId,
      name: 'Namkeen 50 g',
      netQty: 50,
      netUnit: 'g',
      defaultCaseSize: 12,
      hsnCode: hsn,
      mrpPaise: 1000,
    })
    await db
      .insert(tenantProducts)
      .values({ id: uuidv7(), tenantId, variantId: variantA, caseSizeOverride: 12 })
    await db
      .insert(hsnRates)
      .values({ id: uuidv7(), hsnCode: hsn, gstBps: 1200, cessBps: 0, effectiveFrom: '2020-04-01' })

    const shops: [string, string, string][] = [
      [retailerA, shopUserA, 'A'],
      [retailerB, shopUserB, 'B'],
    ]
    for (const [retailerId, userId, tag] of shops) {
      const identityId = uuidv7()
      await db.insert(retailerIdentities).values({
        id: identityId,
        phone: `+91963${run}${tag === 'A' ? 1 : 2}`,
        userId,
        shopName: `Probe Shop ${tag} ${run}`,
      })
      await db.insert(retailers).values({
        id: retailerId,
        tenantId,
        identityId,
        code: `P76-${tag}-${run}`,
        name: `Probe Shop ${tag} ${run}`,
        ownerName: `Owner ${tag}`,
        phone: `+91963${run}${tag === 'A' ? 1 : 2}`,
        stateCode: '27',
        gstRegType: 'regular',
        gstin: tag === 'A' ? '27AAXPT9021Q1ZQ' : '27AABCU9603R1ZX',
        creditDays: 15,
        lat: 19.2437,
        lng: 73.1355,
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
    await db
      .insert(priceLists)
      .values({ id: priceListId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    await db
      .insert(priceListItems)
      .values({ id: uuidv7(), tenantId, priceListId, variantId: variantA, ratePaise: 1000 })

    const locs = await db
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${tenantId}`)
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''

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
    const inventory = app.get(InventoryService)
    await as(ctxOf(ownerId, 'owner'), async (tx) => {
      const a = await inventory.findOrCreateLot(tx, {
        variantId: variantA,
        batchNo: `P76-${run}`,
        mrpPaise: 1000,
        expiryDate: '2028-01-31',
      })
      lotA = a.lot.id
      await inventory.post(tx, [
        {
          lotId: lotA,
          locationId: godown,
          qtyDelta: 2_000,
          reason: 'opening',
          idempotencyKey: `p76-open-${run}`,
        },
      ])
    })
  }, 180_000)

  afterAll(async () => {
    log('tenant', { tenantId, run })
    await app?.close()
    await pool.end()
  })

  it('TRIP 1 — one ONLINE collection (stop A) + one OFFLINE receipt through /sync/upload (stop B); the crew hands over BOTH', async () => {
    const billA = await billedOrder(retailerA, 'a1')
    const billB = await billedOrder(retailerB, 'b1')
    log('t1.bills', { billA, billB })
    const stopA = uuidv7()
    const stopB = uuidv7()
    const opening = 50_000
    const tripId = await departedTrip('t1', driver1, opening, [
      { id: stopA, retailerId: retailerA, bill: billA },
      { id: stopB, retailerId: retailerB, bill: billB },
    ])

    // what the delivery phone is allowed to queue offline
    const manifest = await call<{ tables?: { table: string; writable: boolean }[] }>(
      app,
      driver1,
      'GET',
      '/sync/manifest',
    )
    log('t1.manifest.delivery', {
      status: manifest.status,
      receipts: manifest.body.tables?.find((t) => t.table === 'receipts') ?? null,
      collections: manifest.body.tables?.find((t) => t.table === 'collections') ?? null,
      writableTables: manifest.body.tables?.filter((t) => t.writable).map((t) => t.table),
    })

    await deliver('t1.stopA', driver1, tripId, stopA, billA)
    await deliver('t1.stopB', driver1, tripId, stopB, billB)

    // stop A with a signal: delivery.collections.record (collect.tsx, status.online)
    const onlineReceiptId = uuidv7()
    const online = await call<{ receipt?: { id: string; receiptNo: string | null } }>(
      app,
      driver1,
      'POST',
      '/delivery/collections',
      {
        idempotencyKey: `p76-col-online-${run}`,
        id: uuidv7(),
        receiptId: onlineReceiptId,
        tripId,
        stopId: stopA,
        retailerId: retailerA,
        mode: 'cash',
        amountPaise: billA.totalPaise,
        collectedAt: new Date().toISOString(),
        deviceId: `probe-phone-t1-${run}`,
      },
    )
    log('t1.online.collection', { status: online.status, receipt: online.body.receipt })
    expect(online.status).toBe(200)

    // stop B with no signal: useQueueReceipt -> outbox -> /sync/upload table receipts
    const offlineReceiptId = await offlineReceipt('t1', driver1, tripId, retailerB, billB.totalPaise)

    await tripMoney('t1', tripId)
    log('t1.journal.receipts', await journalOf('receipt', [onlineReceiptId, offlineReceiptId]))
    log('t1.books.beforeSettle', await books())

    const returned = await call<{ item: { state: string } }>(
      app,
      driver1,
      'POST',
      `/delivery/trips/${tripId}/return`,
      { idempotencyKey: `p76-return-t1-${run}` },
    )
    log('t1.return', { status: returned.status, state: returned.body.item.state })
    expect(returned.status).toBe(200)

    const preview = await call<Preview>(
      app,
      accountant,
      'GET',
      `/delivery/trips/${tripId}/settlement`,
    )
    log('t1.settlementPreview', { status: preview.status, body: preview.body })
    const receiptsList = await call<{ items: { id: string }[]; totals: { countedPaise: number } }>(
      app,
      accountant,
      'GET',
      '/receipts',
      { tripId, status: 'collected', mode: 'cash', limit: 200 },
    )
    log('t1.receiptsList.tripCash', {
      status: receiptsList.status,
      count: receiptsList.body.items.length,
      totals: receiptsList.body.totals,
    })

    const counted = preview.body.expectedVanStock.map((l) => ({
      lotId: l.lotId,
      countedPcs: l.expectedPcs,
    }))
    const handed = opening + billA.totalPaise + billB.totalPaise
    log('t1.handedOver', {
      opening,
      online: billA.totalPaise,
      offline: billB.totalPaise,
      handedOverCashPaise: handed,
    })
    const desk = await settleAs('t1', accountant, tripId, handed, counted)
    log(
      't1.db.approvals.afterAccountant',
      await rows(sql`select id, kind::text as kind, status::text as status, requested_by, payload
                      from approvals where tenant_id = ${tenantId} and entity_id = ${tripId}`),
    )
    const own = await settleAs('t1', owner, tripId, handed, counted, { acceptVariance: true })
    log(
      't1.db.approvals.afterOwner',
      await rows(sql`select id, kind::text as kind, status::text as status, decided_by
                      from approvals where tenant_id = ${tenantId} and entity_id = ${tripId}`),
    )
    log(
      't1.db.trip_settlements',
      await rows(sql`select id, expected_cash_paise, handed_over_cash_paise, cash_variance_paise, has_variance, approved_by
                      from trip_settlements where trip_id = ${tripId}`),
    )
    log(
      't1.db.trip',
      await rows(sql`select state::text as state from trips where id = ${tripId}`),
    )
    log('t1.journal.settlement', await journalOf('trip_settlement', [own.id]))
    log('t1.books.afterSettle', await books())

    // the defect shape as described
    expect(preview.body.cashCollectedPaise).toBe(billA.totalPaise)
    expect(desk.res.status).toBe(409)
    expect(desk.res.body.data?.cashVariancePaise).toBe(billB.totalPaise)
    expect(own.res.status).toBe(200)
    expect(await balance('CASH_VAN')).toBe(billB.totalPaise)
  }, 300_000)

  it('TRIP 2 — OFFLINE receipt only; the crew hands over just the float and keeps the shop cash', async () => {
    const vanBefore = await balance('CASH_VAN')
    const shortBefore = await balance('CASH_SHORT')
    const billC = await billedOrder(retailerA, 'c1')
    log('t2.bill', billC)
    const stopC = uuidv7()
    const opening = 20_000
    const tripId = await departedTrip('t2', driver2, opening, [
      { id: stopC, retailerId: retailerA, bill: billC },
    ])
    await deliver('t2.stopC', driver2, tripId, stopC, billC)
    const offlineReceiptId = await offlineReceipt('t2', driver2, tripId, retailerA, billC.totalPaise)
    await tripMoney('t2', tripId)
    log('t2.journal.receipt', await journalOf('receipt', [offlineReceiptId]))
    log(
      't2.db.invoice',
      await rows(sql`select state::text as state, total_paise from invoices where id = ${billC.invoiceId}`),
    )
    const returned = await call<{ item: { state: string } }>(
      app,
      driver2,
      'POST',
      `/delivery/trips/${tripId}/return`,
      { idempotencyKey: `p76-return-t2-${run}` },
    )
    expect(returned.status).toBe(200)
    const preview = await call<Preview>(
      app,
      accountant,
      'GET',
      `/delivery/trips/${tripId}/settlement`,
    )
    log('t2.settlementPreview', { status: preview.status, body: preview.body })
    const counted = preview.body.expectedVanStock.map((l) => ({
      lotId: l.lotId,
      countedPcs: l.expectedPcs,
    }))
    const desk = await settleAs('t2', accountant, tripId, opening, counted)
    log(
      't2.db.approvals',
      await rows(sql`select id, status::text as status from approvals where tenant_id = ${tenantId} and entity_id = ${tripId}`),
    )
    log('t2.journal.settlement', await journalOf('trip_settlement', [desk.id]))
    const inHand = await call<{ items: { id: string }[]; totals: { countedPaise: number } }>(
      app,
      accountant,
      'GET',
      '/receipts',
      { tripId, status: 'collected', mode: 'cash', limit: 200, withCrew: false },
    )
    log('t2.receiptsList.inHand(withCrew=false)', {
      status: inHand.status,
      ids: inHand.body.items.map((r) => r.id),
      totals: inHand.body.totals,
    })
    const after = await books()
    log('t2.books.afterSettle', after)
    log('t2.bookDelta', {
      CASH_VAN: after.CASH_VAN - vanBefore,
      CASH_SHORT: after.CASH_SHORT - shortBefore,
    })

    expect(desk.res.status).toBe(200)
    expect(desk.res.body.tripState).toBe('settled')
    expect(desk.res.body.item?.cashVariancePaise).toBe(0)
    expect(after.CASH_VAN - vanBefore).toBe(billC.totalPaise)
  }, 300_000)

  it('TRIP 3 — is there a desk workaround? the accountant records a collection that names the offline receipt', async () => {
    const vanBefore = await balance('CASH_VAN')
    const billD = await billedOrder(retailerB, 'd1')
    const stopD = uuidv7()
    const tripId = await departedTrip('t3', driver3, 0, [
      { id: stopD, retailerId: retailerB, bill: billD },
    ])
    await deliver('t3.stopD', driver3, tripId, stopD, billD)
    const offlineReceiptId = await offlineReceipt('t3', driver3, tripId, retailerB, billD.totalPaise)
    const attempts: { who: Actor; withStop: boolean }[] = [
      { who: accountant, withStop: true },
      { who: manager, withStop: true },
      { who: accountant, withStop: false },
    ]
    for (const [i, a] of attempts.entries()) {
      const attach = await call<{ receipt?: { id: string }; message?: string }>(
        app,
        a.who,
        'POST',
        '/delivery/collections',
        {
          idempotencyKey: `p76-col-attach-${i}-${run}`,
          id: uuidv7(),
          receiptId: offlineReceiptId,
          tripId,
          ...(a.withStop ? { stopId: stopD } : {}),
          retailerId: retailerB,
          mode: 'cash',
          amountPaise: billD.totalPaise,
        },
      )
      log(`t3.desk.attachCollection.${a.who.role}.withStop=${String(a.withStop)}`, {
        status: attach.status,
        receiptId: attach.body.receipt?.id ?? null,
        message: attach.body.message,
      })
      if (attach.status === 200) break
    }
    await tripMoney('t3', tripId)
    log('t3.journal.receipt', await journalOf('receipt', [offlineReceiptId]))
    const returned = await call(app, driver3, 'POST', `/delivery/trips/${tripId}/return`, {
      idempotencyKey: `p76-return-t3-${run}`,
    })
    expect(returned.status).toBe(200)
    const preview = await call<Preview>(
      app,
      accountant,
      'GET',
      `/delivery/trips/${tripId}/settlement`,
    )
    log('t3.settlementPreview', { status: preview.status, body: preview.body })
    const counted = preview.body.expectedVanStock.map((l) => ({
      lotId: l.lotId,
      countedPcs: l.expectedPcs,
    }))
    const desk = await settleAs('t3', accountant, tripId, billD.totalPaise, counted)
    log('t3.journal.settlement', await journalOf('trip_settlement', [desk.id]))
    log('t3.bookDelta', { CASH_VAN: (await balance('CASH_VAN')) - vanBefore })
  }, 300_000)
})
