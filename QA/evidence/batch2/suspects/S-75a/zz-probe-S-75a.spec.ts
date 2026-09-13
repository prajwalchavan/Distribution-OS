// QA PROBE S-75a (temporary, never committed): a trip CASH receipt reversed by the desk AFTER its trip settled.
// Drives the real endpoints in the app order: plan trip -> load -> depart -> deliver -> collect cash at the door
// -> return -> settle (accountant) -> reverse the receipt (accountant, desk) and reads the book before and after.
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
import { DeliveryModule } from '../delivery/index.js'
import { FilesModule } from '../files/index.js'
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { ReceivablesModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const log = (label: string, value: unknown) =>
  console.log(`[S-75a] ${label}: ${JSON.stringify(value)}`)

describeDb('QA probe S-75a: undo a trip cash receipt after the trip settled', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `6${run.slice(-6)}`
  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const packerId = uuidv7()
  const repId = uuidv7()
  const driverId = uuidv7()
  const shopUser = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }
  const retailerId = uuidv7()
  const variantId = uuidv7()
  let godown = ''
  let app: NestFastifyApplication
  const today = businessDate(new Date()).date

  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))

  /** Account balances straight from the book: sum of every journal line of the tenant per account code. */
  const book = async (): Promise<Record<string, number>> =>
    Object.fromEntries(
      (
        (
          await db.execute(sql`
            select a.code, coalesce(sum(l.amount_paise), 0)::bigint as bal
              from accounts a
              left join journal_lines l on l.account_id = a.id and l.tenant_id = a.tenant_id
             where a.tenant_id = ${tenantId} and a.code in ('CASH', 'CASH_VAN', 'AR', 'BANK')
             group by a.code order by a.code`)
        ).rows as { code: string; bal: string }[]
      ).map((r) => [r.code, Number(r.bal)]),
    )
  /** The same balances as the desk reads them: GET /receivables/accounts (trial balance). */
  const deskBalances = async (): Promise<Record<string, number>> => {
    const res = await call<{ items: { code: string; balancePaise: number }[] }>(
      app,
      accountant,
      'GET',
      '/receivables/accounts',
    )
    expect(res.status).toBe(200)
    return Object.fromEntries(
      res.body.items
        .filter((i) => ['CASH', 'CASH_VAN', 'AR', 'BANK'].includes(i.code))
        .map((i) => [i.code, i.balancePaise]),
    )
  }
  const entryLines = async (refType: string, refId: string) =>
    (
      (
        await db.execute(sql`
          select a.code, l.amount_paise::bigint as amount
            from journal_lines l
            join journal_entries e on e.id = l.entry_id and e.tenant_id = l.tenant_id
            join accounts a on a.id = l.account_id
           where e.tenant_id = ${tenantId} and e.ref_type = ${refType} and e.ref_id = ${refId}
           order by a.code`)
      ).rows as { code: string; amount: string }[]
    ).map((r) => ({ code: r.code, amount: Number(r.amount) }))

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `s75a-${run}`, legalName: 'Probe Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91961${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91961${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91961${run}3`, name: 'Accountant' },
      { id: packerId, phone: `+91961${run}4`, name: 'Packer' },
      { id: repId, phone: `+91961${run}5`, name: 'Rep' },
      { id: driverId, phone: `+91961${run}6`, name: 'Driver' },
      { id: shopUser, phone: `+91962${run}1`, name: 'Shopkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUser, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker s75a ${run}` })
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
      phone: `+91963${run}1`,
      userId: shopUser,
      shopName: `Probe Shop ${run}`,
    })
    await db.insert(retailers).values({
      id: retailerId,
      tenantId,
      identityId,
      code: `S75-${run}`,
      name: `Probe Shop ${run}`,
      ownerName: 'Owner',
      phone: `+91963${run}1`,
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
    await as({ tenantId, actorId: ownerId, actorRole: 'owner' }, async (tx) => {
      const lot = await inventory.findOrCreateLot(tx, {
        variantId,
        batchNo: `S75-${run}`,
        mrpPaise: 1000,
        expiryDate: '2028-01-31',
      })
      await inventory.post(tx, [
        {
          lotId: lot.lot.id,
          locationId: godown,
          qtyDelta: 1_000,
          reason: 'opening',
          idempotencyKey: `open-s75-${run}`,
        },
      ])
    })
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  it('reverses a settled trip cash receipt and shows which cash account the reversal credits', async () => {
    // --- a real bill: order -> submit -> pack (invoice issued at pack)
    const orderId = uuidv7()
    expect(
      (
        await call(app, rep, 'POST', '/orders', {
          idempotencyKey: `order-s75-${run}`,
          id: orderId,
          retailerId,
          source: 'salesperson',
          lines: [{ id: uuidv7(), variantId, enteredQty: 1, enteredUnit: 'case' }],
        })
      ).status,
    ).toBe(200)
    expect(
      (await call(app, rep, 'POST', `/orders/${orderId}/submit`, { idempotencyKey: `sub-s75-${run}` }))
        .status,
    ).toBe(200)
    const packed = await call<{ invoice: { id: string } | null }>(
      app,
      packer,
      'POST',
      `/warehouse/orders/${orderId}/pack`,
      { idempotencyKey: `pack-s75-${run}`, id: uuidv7(), packages: 1 },
    )
    expect(packed.status).toBe(200)
    const invoiceId = packed.body.invoice?.id ?? ''
    const bill = await call<{ item: { lines: { id: string }[]; totalPaise: number } }>(
      app,
      manager,
      'GET',
      `/invoices/${invoiceId}`,
    )
    expect(bill.status).toBe(200)
    const billTotal = bill.body.item.totalPaise
    log('bill', { invoiceId, totalPaise: billTotal })

    // --- vehicle + driver consent + trip
    const vehicle = await call<{ item: { id: string } }>(app, owner, 'POST', '/delivery/vehicles', {
      idempotencyKey: `veh-s75-${run}`,
      id: uuidv7(),
      regNo: `MH-05-SV-${run.slice(-4)}`,
      name: 'Tempo',
      kind: 'tempo',
    })
    expect(vehicle.status).toBe(200)
    expect(
      (
        await call(app, driver, 'POST', '/delivery/consents', {
          idempotencyKey: `consent-s75-${run}`,
          id: uuidv7(),
          granted: true,
          noticeVersion: 'gps-2026-09',
        })
      ).status,
    ).toBe(200)
    const tripId = uuidv7()
    const stopId = uuidv7()
    const planned = await call<{ item: { state: string; tripNo: string } }>(
      app,
      packer,
      'POST',
      '/delivery/trips',
      {
        idempotencyKey: `trip-s75-${run}`,
        id: tripId,
        tripDate: today,
        vehicleId: vehicle.body.item.id,
        driverId,
        openingCashPaise: 0,
        stops: [{ id: stopId, sequence: 1, retailerId, invoiceIds: [invoiceId] }],
      },
    )
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    expect(
      (
        await call(app, packer, 'POST', `/delivery/trips/${tripId}/start-loading`, {
          idempotencyKey: `load-s75-${run}`,
        })
      ).status,
    ).toBe(200)
    const departed = await call<{ item: { state: string } }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripId}/depart`,
      { idempotencyKey: `depart-s75-${run}`, startOdometerKm: 1000 },
    )
    expect(departed.status, JSON.stringify(departed.body)).toBe(200)
    expect(departed.body.item.state).toBe('active')

    // --- at the door: start, arrive, deliver, collect CASH for the bill
    expect(
      (
        await call(app, driver, 'POST', `/delivery/stops/${stopId}/start`, {
          idempotencyKey: `start-s75-${run}`,
          occurredAt: new Date().toISOString(),
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await call(app, driver, 'POST', `/delivery/stops/${stopId}/arrive`, {
          idempotencyKey: `arrive-s75-${run}`,
          lat: 19.2437,
          lng: 73.1355,
        })
      ).status,
    ).toBe(200)
    const delivered = await call(app, driver, 'POST', '/delivery/deliveries', {
      idempotencyKey: `deliver-s75-${run}`,
      id: uuidv7(),
      tripId,
      stopId,
      invoiceId,
      receiverName: 'Owner',
      lines: [
        {
          id: uuidv7(),
          invoiceLineId: bill.body.item.lines[0]?.id ?? '',
          deliveredQtyPcs: 12,
          returnedQtyPcs: 0,
        },
      ],
      pod: [
        { id: uuidv7(), kind: 'signature', inline: { mimeType: 'image/png', contentBase64: TINY_PNG } },
      ],
    })
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200)
    const receiptId = uuidv7()
    const collected = await call<{ item: { receiptNo: string | null } }>(
      app,
      driver,
      'POST',
      '/delivery/collections',
      {
        idempotencyKey: `collect-s75-${run}`,
        id: uuidv7(),
        receiptId,
        tripId,
        stopId,
        retailerId,
        mode: 'cash',
        amountPaise: billTotal,
      },
    )
    expect(collected.status, JSON.stringify(collected.body)).toBe(200)
    log('receipt journal lines (collection)', await entryLines('receipt', receiptId))
    const afterCollect = await book()
    log('book after collection', afterCollect)

    // --- check-in: return, preview, settle as the accountant with exactly the expected cash
    const returned = await call<{ item: { state: string } }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripId}/return`,
      { idempotencyKey: `return-s75-${run}`, endOdometerKm: 1010 },
    )
    expect(returned.status).toBe(200)
    expect(returned.body.item.state).toBe('closing')
    const preview = await call<{
      expectedCashPaise: number
      cashCollectedPaise: number
      expectedVanStock: { lotId: string; expectedPcs: number }[]
    }>(app, accountant, 'GET', `/delivery/trips/${tripId}/settlement`)
    expect(preview.status).toBe(200)
    log('settlement preview', {
      expectedCashPaise: preview.body.expectedCashPaise,
      cashCollectedPaise: preview.body.cashCollectedPaise,
      expectedVanStock: preview.body.expectedVanStock,
    })
    const settlementId = uuidv7()
    const settled = await call<{ tripState: string; item: { hasVariance: boolean } }>(
      app,
      accountant,
      'POST',
      `/delivery/trips/${tripId}/settle`,
      {
        idempotencyKey: `settle-s75-${run}`,
        id: settlementId,
        tripId,
        handedOverCashPaise: preview.body.expectedCashPaise,
        counted: preview.body.expectedVanStock.map((l) => ({
          lotId: l.lotId,
          countedPcs: l.expectedPcs,
        })),
      },
    )
    expect(settled.status, JSON.stringify(settled.body)).toBe(200)
    log('settle response', { tripState: settled.body.tripState, hasVariance: settled.body.item.hasVariance })
    log('settlement journal lines', await entryLines('trip_settlement', settlementId))
    const afterSettle = await book()
    const deskAfterSettle = await deskBalances()
    log('book after settle (SQL)', afterSettle)
    log('desk trial balance after settle (GET /receivables/accounts)', deskAfterSettle)

    // the desk's view of the receipt: in hand (withCrew=false), still collected, not deposited
    const before = await call<{
      item: { status: string; tripId: string | null; depositedAt: string | null; receiptNo: string | null }
      withCrew: boolean | null
    }>(app, accountant, 'GET', `/receipts/${receiptId}`)
    expect(before.status).toBe(200)
    log('receipt before undo (desk GET /receipts/{id})', {
      receiptNo: before.body.item.receiptNo,
      status: before.body.item.status,
      tripId: before.body.item.tripId,
      depositedAt: before.body.item.depositedAt,
      withCrew: before.body.withCrew,
    })

    // --- the desk undoes the receipt (wrong receipt entered / shop disputes it) AFTER the settlement
    const reversalId = uuidv7()
    const reversed = await call<{ item: { amountPaise: number; status: string }; original: { status: string } }>(
      app,
      accountant,
      'POST',
      `/receipts/${receiptId}/reverse`,
      { idempotencyKey: `reverse-s75-${run}`, id: receiptId, reversalId, reason: 'entered against the wrong shop' },
    )
    log('reverse response', { status: reversed.status, body: reversed.body })
    expect(reversed.status).toBe(200)
    const reversalLines = await entryLines('receipt_reversal', reversalId)
    log('reversal journal lines', reversalLines)
    const afterUndo = await book()
    const deskAfterUndo = await deskBalances()
    log('book after undo (SQL)', afterUndo)
    log('desk trial balance after undo (GET /receivables/accounts)', deskAfterUndo)
    log('delta CASH_VAN (undo)', (afterUndo.CASH_VAN ?? 0) - (afterSettle.CASH_VAN ?? 0))
    log('delta CASH (undo)', (afterUndo.CASH ?? 0) - (afterSettle.CASH ?? 0))

    // what the suspect claims, stated as observations of this run
    expect(afterSettle.CASH_VAN).toBe(0)
    expect(afterSettle.CASH).toBe(billTotal)
    expect(reversalLines.find((l) => l.code === 'CASH_VAN')?.amount).toBe(-billTotal)
    expect(reversalLines.find((l) => l.code === 'CASH')).toBeUndefined()
    expect(afterUndo.CASH_VAN).toBe(-billTotal)
    expect(afterUndo.CASH).toBe(billTotal)
  }, 180_000)
})
