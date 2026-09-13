/**
 * QA PROBE S-28 (temporary, never committed). The van-sale screen (delivery-app D6) shows
 * `pricing.quote` totals.netPaise under "Sale total". This probe runs the exact calls the screen makes,
 * as the delivery role, on a GST-bearing line, and compares that figure with what the van sale bills.
 */
import { sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  createDb,
  createPool,
  featureFlags,
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
import { PricingModule } from '../pricing/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { DeliveryModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip
const log = (label: string, value: unknown): void => {
  console.log(`[S-28] ${label}: ${JSON.stringify(value)}`)
}

describeDb('S-28 probe: van sale "Sale total" vs the bill', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `8${run.slice(-6)}`

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const packerId = uuidv7()
  const driverId = uuidv7()
  const shopUser = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const packer: Actor = { tenantId, actorId: packerId, role: 'warehouse' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }

  const retailerId = uuidv7()
  const variantId = uuidv7()
  const vehicleId = uuidv7()
  const tripId = uuidv7()
  const stopId = uuidv7()
  let godown = ''
  let lot = ''
  let vehicleLocation = ''
  let app: NestFastifyApplication
  const today = new Date().toISOString().slice(0, 10)

  const ctxOf = (actorId: string, actorRole: TenantContext['actorRole']): TenantContext => ({
    tenantId,
    actorId,
    actorRole,
  })
  const asOwner = <T>(fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctxOf(ownerId, 'owner'), () => withTenant(db, ctxOf(ownerId, 'owner'), fn))

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `s28-${run}`, legalName: 'Probe Traders', stateCode: '27' })
    await db.insert(users).values([
      { id: ownerId, phone: `+91961${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91961${run}2`, name: 'Manager' },
      { id: packerId, phone: `+91961${run}3`, name: 'Packer' },
      { id: driverId, phone: `+91961${run}4`, name: 'Driver' },
      { id: shopUser, phone: `+91962${run}1`, name: 'Shopkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: packerId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUser, role: 'retailer' },
    ])
    await bootstrapTenant(db, tenantId)
    await db
      .insert(tenantSettings)
      .values({ tenantId, key: TENANT_SETTING_KEYS.brandingDisplayName, value: 'Probe Traders' })
      .onConflictDoNothing()
    await db
      .insert(featureFlags)
      .values({ tenantId, flag: 'van_sales', enabled: true })
      .onConflictDoUpdate({
        target: [featureFlags.tenantId, featureFlags.flag],
        set: { enabled: true },
      })

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker s28 ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Namkeen', category: 'namkeen' })
    await db.insert(productVariants).values({
      id: variantId,
      productId,
      name: 'Namkeen 200 g',
      netQty: 200,
      netUnit: 'g',
      defaultCaseSize: 12,
      hsnCode: hsn,
      mrpPaise: 2500,
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
      code: `S28-${run}`,
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
      .values({ id: uuidv7(), tenantId, priceListId, variantId, ratePaise: 1845 })

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
      PricingModule,
      InventoryModule,
      ReceivablesModule,
      FilesModule,
      SyncModule,
    ])
    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      const a = await inventory.findOrCreateLot(tx, {
        variantId,
        batchNo: `S28-${run}`,
        mrpPaise: 2500,
        expiryDate: '2028-01-31',
      })
      lot = a.lot.id
      await inventory.post(tx, [
        {
          lotId: lot,
          locationId: godown,
          qtyDelta: 1_000,
          reason: 'opening',
          idempotencyKey: `s28-open-${run}`,
        },
      ])
    })
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  it('the figure under "Sale total" is not what the van sale bills', async () => {
    // fleet, consent, trip with van sales on, van stock on a confirmed load sheet, departed
    const vehicle = await call<{ item: { locationId: string } }>(app, owner, 'POST', '/delivery/vehicles', {
      idempotencyKey: `s28-vehicle-${run}`,
      id: vehicleId,
      regNo: `MH-05-SV-${run.slice(-4)}`,
      name: 'Tempo S28',
      kind: 'tempo',
      capacityCases: 120,
    })
    expect(vehicle.status).toBe(200)
    vehicleLocation = vehicle.body.item.locationId
    expect(
      (
        await call(app, driver, 'POST', '/delivery/consents', {
          idempotencyKey: `s28-consent-${run}`,
          id: uuidv7(),
          granted: true,
          noticeVersion: 'gps-2026-09',
        })
      ).status,
    ).toBe(200)
    const planned = await call<{ item: { state: string } }>(app, packer, 'POST', '/delivery/trips', {
      idempotencyKey: `s28-trip-${run}`,
      id: tripId,
      tripDate: today,
      vehicleId,
      driverId,
      vanSalesEnabled: true,
      openingCashPaise: 0,
      stops: [{ id: stopId, sequence: 1, retailerId, invoiceIds: [] }],
    })
    expect(planned.status, JSON.stringify(planned.body)).toBe(200)
    expect(
      (
        await call(app, packer, 'POST', `/delivery/trips/${tripId}/start-loading`, {
          idempotencyKey: `s28-loading-${run}`,
        })
      ).status,
    ).toBe(200)
    const sheetId = uuidv7()
    const sheet = await call(app, manager, 'POST', '/warehouse/load-sheets', {
      idempotencyKey: `s28-sheet-${run}`,
      id: sheetId,
      toLocationId: vehicleLocation,
      tripId,
      vanStock: [{ lotId: lot, qtyPcs: 48 }],
    })
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(200)
    const confirmed = await call(app, manager, 'POST', `/warehouse/load-sheets/${sheetId}/confirm`, {
      idempotencyKey: `s28-sheet-confirm-${run}`,
      countedPackages: 0,
      challanId: uuidv7(),
      countedVanStock: [{ lotId: lot, qtyPcs: 48 }],
    })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    const departed = await call<{ item: { state: string; vanSalesAllowed: boolean } }>(
      app,
      driver,
      'POST',
      `/delivery/trips/${tripId}/depart`,
      { idempotencyKey: `s28-depart-${run}`, startOdometerKm: 1000 },
    )
    expect(departed.status, JSON.stringify(departed.body)).toBe(200)
    log('trip after depart', { state: departed.body.item.state, vanSalesAllowed: departed.body.item.vanSalesAllowed })

    // 1. the quote EXACTLY as van-sale.tsx:150-157 sends it (lineId = variantId, qtyPcs = the pieces)
    const quote = await call<{
      lines: {
        lineId: string
        qtyPcs: number
        ratePaise: number
        lineNetPaise: number
        gstBps: number
        taxPaise: number
        lineTotalPaise: number
      }[]
      totals: {
        grossPaise: number
        discountPaise: number
        bargainPaise: number
        netPaise: number
        taxPaise: number
        roundOffPaise: number
        totalPaise: number
      }
    }>(app, driver, 'POST', '/pricing/quote', {
      retailerId,
      lines: [{ lineId: variantId, variantId, qtyPcs: 12 }],
    })
    expect(quote.status, JSON.stringify(quote.body)).toBe(200)
    log('pricing.quote status', quote.status)
    log('pricing.quote lines', quote.body.lines)
    log('pricing.quote totals', quote.body.totals)
    // van-sale.tsx:193 + :217 — the value the screen renders under 'Sale total'
    const shownSaleTotal = quote.body.totals.netPaise
    log('screen "Sale total" (totals.netPaise)', shownSaleTotal)

    // 2. the van sale EXACTLY as van-sale.tsx:163-178 sends it (no `collect`)
    const sale = await call<{
      order: { id: string; totalPaise?: number; state: string }
      invoice: {
        id: string
        invoiceNo: string | null
        subtotalPaise: number
        taxablePaise: number
        cgstPaise: number
        sgstPaise: number
        igstPaise: number
        roundOffPaise: number
        totalPaise: number
        upiQrPayload?: string | null
      }
      collection: unknown
    }>(app, driver, 'POST', '/delivery/van-sales', {
      idempotencyKey: `s28-van-sale-${run}`,
      id: uuidv7(),
      tripId,
      stopId,
      retailerId,
      invoiceId: uuidv7(),
      deliveryId: uuidv7(),
      deviceId: uuidv7(),
      lines: [{ id: uuidv7(), variantId, enteredQty: 12, enteredUnit: 'piece' }],
    })
    expect(sale.status, JSON.stringify(sale.body)).toBe(200)
    const inv = sale.body.invoice
    log('van sale status', sale.status)
    log('van sale order', { state: sale.body.order.state, totalPaise: sale.body.order.totalPaise })
    log('van sale invoice', {
      invoiceNo: inv.invoiceNo,
      subtotalPaise: inv.subtotalPaise,
      taxablePaise: inv.taxablePaise,
      cgstPaise: inv.cgstPaise,
      sgstPaise: inv.sgstPaise,
      igstPaise: inv.igstPaise,
      roundOffPaise: inv.roundOffPaise,
      totalPaise: inv.totalPaise,
      upiQrPayload: inv.upiQrPayload,
    })
    log('van sale collection (screen sends no collect)', sale.body.collection)

    // read-only SQL: the stored bill, the order header, the shop's dues, the event
    const [dbInvoice] = (
      await db.execute(
        sql`select invoice_no, source::text as source, subtotal_paise, taxable_paise, cgst_paise, sgst_paise,
                   round_off_paise, total_paise from invoices where id = ${inv.id}`,
      )
    ).rows
    log('SQL invoices row', dbInvoice)
    const [dbOrder] = (
      await db.execute(
        sql`select state::text as state, total_paise from sales_orders where id = ${sale.body.order.id}`,
      )
    ).rows
    log('SQL sales_orders row', dbOrder)
    const [dues] = (
      await db.execute(
        sql`select outstanding_paise, open_bills from retailer_outstanding_summary
             where tenant_id = ${tenantId} and retailer_id = ${retailerId}`,
      )
    ).rows
    log('SQL retailer_outstanding_summary after sale', dues)
    const [event] = (
      await db.execute(
        sql`select event_type, payload->>'totalPaise' as total_paise from outbox_events
             where tenant_id = ${tenantId} and event_type = 'VanSaleInvoiced'`,
      )
    ).rows
    log('SQL outbox VanSaleInvoiced', event)

    // 3. the crew takes exactly the figure the screen showed, through the doorstep collection call
    const collected = await call<{ item: { amountPaise: number }; receipt: { receiptNo: string | null } }>(
      app,
      driver,
      'POST',
      '/delivery/collections',
      {
        idempotencyKey: `s28-collect-${run}`,
        id: uuidv7(),
        receiptId: uuidv7(),
        tripId,
        stopId,
        retailerId,
        mode: 'cash',
        amountPaise: shownSaleTotal,
        collectedAt: new Date().toISOString(),
        deviceId: uuidv7(),
      },
    )
    log('collections.record status', collected.status)
    log('collections.record', collected.status === 200 ? { amountPaise: collected.body.item.amountPaise, receiptNo: collected.body.receipt.receiptNo } : collected.body)
    const [duesAfter] = (
      await db.execute(
        sql`select outstanding_paise, open_bills from retailer_outstanding_summary
             where tenant_id = ${tenantId} and retailer_id = ${retailerId}`,
      )
    ).rows
    log('SQL retailer_outstanding_summary after collecting the shown figure', duesAfter)
    const [invAfter] = (
      await db.execute(
        sql`select total_paise, state::text as state from invoices where id = ${inv.id}`,
      )
    ).rows
    log('SQL invoice after collecting the shown figure', invAfter)

    // the defect, as assertions: these PASS when S-28 holds
    expect(quote.body.totals.taxPaise).toBeGreaterThan(0)
    expect(shownSaleTotal).toBeLessThan(quote.body.totals.totalPaise)
    expect(inv.totalPaise).toBe(quote.body.totals.totalPaise)
    expect(inv.totalPaise).not.toBe(shownSaleTotal)
    log('gap between the bill and "Sale total" (paise)', inv.totalPaise - shownSaleTotal)
  }, 180_000)
})
