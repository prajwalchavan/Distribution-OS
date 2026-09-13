/**
 * QA skeptic probe S-76 (temporary, never committed). Extends the prober's run with:
 *  A. a FULLY offline doorstep — trip_stops PATCH started + arrived, deliveries PUT (planned row id,
 *     lines + proof inline) and receipts PUT in ONE /sync/upload batch, in the order the delivery app
 *     enqueues them (stop/[id]/index.tsx move, deliver.tsx queueDelivery, collect.tsx queueReceipt) —
 *     then the honest hand-over, the owner's acceptance, and the Day-end banking of the receipt;
 *  B. the kept-cash case followed through to the money desk's banking (does anything catch it later?).
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
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/suspects/S-76/skeptic/skeptic-log.jsonl'
const log = (label: string, value: unknown): void => {
  const line = `SKEPTIC ${label} ${JSON.stringify(value)}`
  console.log(line)
  appendFileSync(EVIDENCE, `${line}\n`)
}
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

interface Preview {
  cashCollectedPaise: number
  expectedCashPaise: number
  collectionsCount: number
  stopsDelivered: number
  expectedVanStock: { lotId: string; expectedPcs: number }[]
}
interface Bill {
  invoiceId: string
  totalPaise: number
  lineId: string
  qtyPcs: number
}

describeDb('S-76 skeptic probe (DATABASE_URL)', () => {
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
  const driverAId = uuidv7()
  const driverBId = uuidv7()
  const shopUserA = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driverA: Actor = { tenantId, actorId: driverAId, role: 'delivery' }
  const driverB: Actor = { tenantId, actorId: driverBId, role: 'delivery' }

  const retailerA = uuidv7()
  const variantA = uuidv7()
  let godown = ''
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
  const books = async () => ({
    CASH_VAN: await balance('CASH_VAN'),
    CASH: await balance('CASH'),
    CASH_SHORT: await balance('CASH_SHORT'),
    BANK: await balance('BANK'),
    AR: await balance('AR'),
  })
  const delta = (a: Record<string, number>, b: Record<string, number>) =>
    Object.fromEntries(Object.keys(b).map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]))
  const journalByRef = async (refType: string, refId: string) =>
    rows(sql`select a.code, l.amount_paise::bigint as amount_paise, l.memo
               from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
              where e.tenant_id = ${tenantId} and e.ref_type = ${refType} and e.ref_id = ${refId} order by a.code`)

  async function billedOrder(tag: string): Promise<Bill> {
    const orderId = uuidv7()
    const created = await call(app, rep, 'POST', '/orders', {
      idempotencyKey: `s76-order-${tag}-${run}`,
      id: orderId,
      retailerId: retailerA,
      source: 'salesperson',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 5, enteredUnit: 'case' }],
    })
    expect(created.status).toBe(200)
    expect(
      (
        await call(app, rep, 'POST', `/orders/${orderId}/submit`, {
          idempotencyKey: `s76-submit-${tag}-${run}`,
        })
      ).status,
    ).toBe(200)
    const packed = await call<{ invoice: { id: string } | null }>(
      app,
      packer,
      'POST',
      `/warehouse/orders/${orderId}/pack`,
      { idempotencyKey: `s76-pack-${tag}-${run}`, id: uuidv7(), packages: 1 },
    )
    expect(packed.status).toBe(200)
    const invoiceId = packed.body.invoice?.id ?? ''
    const bill = await call<{ item: { lines: { id: string }[]; totalPaise: number } }>(
      app,
      manager,
      'GET',
      `/invoices/${invoiceId}`,
    )
    return {
      invoiceId,
      totalPaise: bill.body.item.totalPaise,
      lineId: bill.body.item.lines[0]?.id ?? '',
      qtyPcs: 60,
    }
  }

  async function departedTrip(
    tag: string,
    driver: Actor,
    openingCashPaise: number,
    stopId: string,
    bill: Bill,
  ): Promise<string> {
    const vehicleId = uuidv7()
    expect(
      (
        await call(app, owner, 'POST', '/delivery/vehicles', {
          idempotencyKey: `s76-veh-${tag}-${run}`,
          id: vehicleId,
          regNo: `MH-05-S${tag.toUpperCase()}-${run.slice(-4)}`,
          name: `Tempo ${tag}`,
          kind: 'tempo',
          capacityCases: 120,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call(app, driver, 'POST', '/delivery/consents', {
          idempotencyKey: `s76-consent-${tag}-${run}`,
          id: uuidv7(),
          granted: true,
          noticeVersion: 'gps-2026-09',
        })
      ).status,
    ).toBe(200)
    const tripId = uuidv7()
    const planned = await call(app, manager, 'POST', '/delivery/trips', {
      idempotencyKey: `s76-trip-${tag}-${run}`,
      id: tripId,
      tripDate: today,
      vehicleId,
      driverId: driver.actorId,
      openingCashPaise,
      stops: [{ id: stopId, sequence: 1, retailerId: retailerA, invoiceIds: [bill.invoiceId] }],
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    expect(
      (
        await call(app, packer, 'POST', `/delivery/trips/${tripId}/start-loading`, {
          idempotencyKey: `s76-loading-${tag}-${run}`,
        })
      ).status,
    ).toBe(200)
    const departed = await call(app, driver, 'POST', `/delivery/trips/${tripId}/depart`, {
      idempotencyKey: `s76-depart-${tag}-${run}`,
    })
    expect(departed.status, JSON.stringify(departed.body)).toBe(200)
    return tripId
  }

  const receiptOp = (tag: string, driver: Actor, tripId: string, amountPaise: number, deviceId: string) => {
    const at = new Date().toISOString()
    return {
      opId: uuidv7(),
      op: 'PUT',
      table: 'receipts',
      id: uuidv7(),
      data: {
        retailer_id: retailerA,
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
  }

  const settle = async (
    tag: string,
    actor: Actor,
    tripId: string,
    handedOverCashPaise: number,
    counted: { lotId: string; countedPcs: number }[],
    extra: Record<string, unknown> = {},
  ) => {
    const id = uuidv7()
    const res = await call<{
      tripState?: string
      item?: { cashVariancePaise: number; hasVariance: boolean }
      data?: { code?: string; cashVariancePaise?: number }
    }>(app, actor, 'POST', `/delivery/trips/${tripId}/settle`, {
      idempotencyKey: `s76-settle-${tag}-${actor.role}-${run}`,
      id,
      tripId,
      handedOverCashPaise,
      counted,
      note: `skeptic S-76 ${tag}`,
      ...extra,
    })
    log(`${tag}.settle.${actor.role}`, { status: res.status, body: res.body })
    return { id, res }
  }

  const deposit = async (tag: string, receiptIds: string[]) => {
    const id = uuidv7()
    const res = await call<{ updated?: number; totalPaise?: number; message?: string }>(
      app,
      accountant,
      'POST',
      '/receipts/deposit',
      {
        idempotencyKey: `s76-deposit-${tag}-${run}`,
        id,
        receiptIds,
        depositAccountCode: 'BANK',
        depositedAt: new Date().toISOString(),
        depositRef: `SLIP-${tag}-${run}`,
      },
    )
    log(`${tag}.deposit`, { status: res.status, body: res.body })
    log(`${tag}.deposit.journal`, await journalByRef('deposit', id))
    return res
  }

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `p76s-${run}`, legalName: 'Skeptic Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91971${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91971${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91971${run}3`, name: 'Accountant' },
      { id: packerId, phone: `+91971${run}4`, name: 'Packer' },
      { id: repId, phone: `+91971${run}5`, name: 'Rep' },
      { id: driverAId, phone: `+91971${run}6`, name: 'Driver A' },
      { id: driverBId, phone: `+91971${run}7`, name: 'Driver B' },
      { id: shopUserA, phone: `+91972${run}1`, name: 'Shopkeeper A' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: driverAId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: driverBId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserA, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker s76 ${run}` })
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
    const identityId = uuidv7()
    await db.insert(retailerIdentities).values({
      id: identityId,
      phone: `+91973${run}1`,
      userId: shopUserA,
      shopName: `Skeptic Shop ${run}`,
    })
    await db.insert(retailers).values({
      id: retailerA,
      tenantId,
      identityId,
      code: `S76-A-${run}`,
      name: `Skeptic Shop ${run}`,
      ownerName: 'Owner A',
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
      retailerId: retailerA,
      userId: shopUserA,
      linkedBy: 'rep_onboarding',
      status: 'active',
    })
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
    const ctx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
    await tenantStorage.run(ctx, () =>
      withTenant(db, ctx, async (tx: Db) => {
        const a = await inventory.findOrCreateLot(tx, {
          variantId: variantA,
          batchNo: `S76-${run}`,
          mrpPaise: 1000,
          expiryDate: '2028-01-31',
        })
        await inventory.post(tx, [
          { lotId: a.lot.id, locationId: godown, qtyDelta: 2_000, reason: 'opening', idempotencyKey: `s76-open-${run}` },
        ])
      }),
    )
  }, 180_000)

  afterAll(async () => {
    log('tenant', { tenantId, run })
    await app?.close()
    await pool.end()
  })

  it('A — fully offline doorstep in one upload batch (app enqueue order), honest hand-over, owner accepts, desk banks', async () => {
    const bill = await billedOrder('A')
    const stopId = uuidv7()
    const opening = 30_000
    const tripId = await departedTrip('A', driverA, opening, stopId, bill)
    const planned = (await rows(sql`select id from deliveries where tenant_id = ${tenantId}
                         and stop_id = ${stopId} and invoice_id = ${bill.invoiceId}`)) as { id: string }[]
    log('A.plannedDelivery', planned)
    const deviceId = `skeptic-phone-A-${run}`
    const t0 = new Date().toISOString()
    const ops = [
      {
        opId: uuidv7(),
        op: 'PATCH',
        table: 'trip_stops',
        id: stopId,
        data: { state: 'started', occurred_at: t0, device_id: deviceId, started_at: t0 },
        clientTime: t0,
      },
      {
        opId: uuidv7(),
        op: 'PATCH',
        table: 'trip_stops',
        id: stopId,
        data: { state: 'arrived', occurred_at: t0, device_id: deviceId, arrived_at: t0, lat: 19.2437, arrived_lat: 19.2437, lng: 73.1355, arrived_lng: 73.1355 },
        clientTime: t0,
      },
      {
        opId: uuidv7(),
        op: 'PUT',
        table: 'deliveries',
        id: planned[0]?.id ?? uuidv7(),
        data: {
          trip_id: tripId,
          stop_id: stopId,
          invoice_id: bill.invoiceId,
          retailer_id: retailerA,
          order_id: null,
          delivered_at: t0,
          device_id: deviceId,
          receiver_name: 'Shop owner',
          lines: [
            {
              id: uuidv7(),
              invoice_line_id: bill.lineId,
              delivered_qty_pcs: bill.qtyPcs,
              returned_qty_pcs: 0,
              returned_saleable: true,
            },
          ],
          pod: [
            {
              id: uuidv7(),
              kind: 'photo',
              inline: { mimeType: 'image/png', contentBase64: TINY_PNG },
              captured_at: t0,
            },
          ],
        },
        clientTime: t0,
      },
      receiptOp('A', driverA, tripId, bill.totalPaise, deviceId),
    ]
    const up = await call<{ accepted: number; rejected: unknown[] }>(app, driverA, 'POST', '/sync/upload', {
      protocol: 1,
      deviceId,
      ops,
    })
    log('A.sync.upload', { status: up.status, body: up.body, tables: ops.map((o) => `${o.op} ${o.table}`) })
    expect(up.status).toBe(200)
    const receiptId = ops[3]?.id ?? ''
    log(
      'A.db.stop+delivery',
      await rows(sql`select s.state::text as stop_state, d.outcome::text as outcome from trip_stops s
                      left join deliveries d on d.stop_id = s.id where s.id = ${stopId}`),
    )
    log(
      'A.db.receipts',
      await rows(sql`select id, receipt_no, amount_paise, trip_id from receipts where tenant_id = ${tenantId} and trip_id = ${tripId}`),
    )
    log(
      'A.db.collections',
      await rows(sql`select id, receipt_id from collections where tenant_id = ${tenantId} and trip_id = ${tripId}`),
    )
    const before = await books()
    const ret = await call(app, driverA, 'POST', `/delivery/trips/${tripId}/return`, {
      idempotencyKey: `s76-return-A-${run}`,
    })
    log('A.return', { status: ret.status })
    const preview = await call<Preview>(app, accountant, 'GET', `/delivery/trips/${tripId}/settlement`)
    log('A.preview', preview.body)
    const counted = preview.body.expectedVanStock.map((l) => ({ lotId: l.lotId, countedPcs: l.expectedPcs }))
    const handed = opening + bill.totalPaise
    const desk = await settle('A', accountant, tripId, handed, counted)
    const mgr = await settle('A', manager, tripId, handed, counted)
    const own = await settle('A', owner, tripId, handed, counted, { acceptVariance: true })
    log('A.settlement.journal', await journalByRef('trip_settlement', own.id))
    const office = await call<{ items: { id: string }[] }>(app, accountant, 'GET', '/receipts', {
      tripId,
      status: 'collected',
      mode: 'cash',
      withCrew: false,
      limit: 200,
    })
    log('A.office.cash', { status: office.status, ids: office.body.items.map((r) => r.id) })
    await deposit('A', [receiptId])
    const after = await books()
    log('A.books.delta(before settle -> after deposit)', delta(before, after))
    log('A.books.tenant', after)

    expect(preview.body.cashCollectedPaise).toBe(0)
    expect(desk.res.status).toBe(409)
    expect(mgr.res.status).toBe(409)
    expect(own.res.status).toBe(200)
  }, 300_000)

  it('B — crew keeps the offline cash; the settlement is green; what the money desk does next', async () => {
    const bill = await billedOrder('B')
    const stopId = uuidv7()
    const opening = 20_000
    const tripId = await departedTrip('B', driverB, opening, stopId, bill)
    const deliver = await call(app, driverB, 'POST', '/delivery/deliveries', {
      idempotencyKey: `s76-deliver-B-${run}`,
      id: uuidv7(),
      tripId,
      stopId,
      invoiceId: bill.invoiceId,
      receiverName: 'Shop owner',
      lines: [{ id: uuidv7(), invoiceLineId: bill.lineId, deliveredQtyPcs: bill.qtyPcs, returnedQtyPcs: 0 }],
      pod: [{ id: uuidv7(), kind: 'signature', inline: { mimeType: 'image/png', contentBase64: TINY_PNG } }],
    })
    log('B.deliver', { status: deliver.status })
    const deviceId = `skeptic-phone-B-${run}`
    const op = receiptOp('B', driverB, tripId, bill.totalPaise, deviceId)
    const up = await call(app, driverB, 'POST', '/sync/upload', { protocol: 1, deviceId, ops: [op] })
    log('B.sync.upload', { status: up.status, body: up.body })
    const before = await books()
    expect((await call(app, driverB, 'POST', `/delivery/trips/${tripId}/return`, { idempotencyKey: `s76-return-B-${run}` })).status).toBe(200)
    const preview = await call<Preview>(app, accountant, 'GET', `/delivery/trips/${tripId}/settlement`)
    log('B.preview', preview.body)
    const counted = preview.body.expectedVanStock.map((l) => ({ lotId: l.lotId, countedPcs: l.expectedPcs }))
    const desk = await settle('B', accountant, tripId, opening, counted)
    log('B.approvals', await rows(sql`select status::text from approvals where tenant_id = ${tenantId} and entity_id = ${tripId}`))
    const office = await call<{ items: { id: string; amountPaise: number }[]; totals: unknown }>(
      app,
      accountant,
      'GET',
      '/receipts',
      { status: 'collected', mode: 'cash', withCrew: false, limit: 200 },
    )
    log('B.office.cash(desk register, all trips)', { status: office.status, items: office.body.items, totals: office.body.totals })
    const receiptGet = await call<{ withCrew?: boolean | null }>(app, accountant, 'GET', `/receipts/${op.id}`)
    log('B.receipt.get.withCrew', { status: receiptGet.status, withCrew: receiptGet.body.withCrew })
    await deposit('B', [op.id])
    const after = await books()
    log('B.books.delta(before settle -> after deposit)', delta(before, after))
    log('B.books.tenant', after)
    expect(desk.res.status).toBe(200)
    expect(desk.res.body.item?.cashVariancePaise).toBe(0)
  }, 300_000)
})
