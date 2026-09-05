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
  numberingSeries,
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
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { BillingModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface Line {
  id: string
  variantId: string
  lotId: string | null
  qtyPcs: number
  freeQtyPcs: number
  enteredQty: number | null
  enteredUnit: string
  ratePaise: number
  discountPaise: number
  taxablePaise: number
  gstBps: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  lineTotalPaise: number
  appliedRules: { ruleId: string }[]
  batchNo: string | null
  caseSize: number | null
  description: string
}
interface Detail {
  id: string
  invoiceNo: string | null
  seriesCode: string
  fy: string
  state: string
  source: string
  supplyType: string
  buyerGstin: string | null
  placeOfSupplyState: string
  isInterState: boolean
  subtotalPaise: number
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  roundOffPaise: number
  totalPaise: number
  cashDiscountBps: number
  cashDiscountUntil: string | null
  dueDate: string | null
  amountDuePaise: number
  cancelReason: string | null
  upiQrPayload: string | null
  lines: Line[]
  creditNotes: { id: string; creditNoteNo: string | null; totalPaise: number }[]
  seller: { displayName: string; legalName: string; gstin: string | null; upiVpa: string | null }
}
interface CreditNoteDetailBody {
  id: string
  creditNoteNo: string | null
  state: string
  reason: string
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
  lines: { invoiceLineId: string; qtyPcs: number; ratePaise: number; saleable: boolean }[]
  seller: { displayName: string }
}
type LedgerRow = { reason: string; qty_delta: number; lot_id: string; location_id: string }

describeDb('billing (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const hsn = `9${run.slice(-6)}`

  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const warehouseId = uuidv7()
  const repId = uuidv7()
  const driverId = uuidv7()
  const shopUserId = uuidv7()
  const otherOwnerId = uuidv7()

  // 27 -> 27 is intra-state (CGST + SGST); 27 -> 24 is inter-state (IGST only).
  const shopMh = uuidv7()
  const shopGj = uuidv7()
  const shopB2c = uuidv7()
  const variantA = uuidv7()
  const variantB = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const warehouse: Actor = { tenantId, actorId: warehouseId, role: 'warehouse' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const stranger: Actor = { tenantId: otherTenantId, actorId: otherOwnerId, role: 'owner' }

  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))

  let godown = ''
  let damaged = ''
  let van = ''
  let app: NestFastifyApplication

  /** An order confirmed through the real aggregate, so its lines are priced and its stock is held. */
  async function placeOrder(
    actor: Actor,
    retailerId: string,
    lines: { variantId: string; cases: number }[],
    tag: string,
  ): Promise<string> {
    const id = uuidv7()
    const created = await call<{ item: { id: string } }>(app, actor, 'POST', '/orders', {
      idempotencyKey: `order-${tag}-${run}`,
      id,
      retailerId,
      source: 'salesperson',
      lines: lines.map((l) => ({
        id: uuidv7(),
        variantId: l.variantId,
        enteredQty: l.cases,
        enteredUnit: 'case',
      })),
    })
    expect(created.status, `order ${tag}`).toBe(200)
    const submitted = await call<{ item: { state: string } }>(
      app,
      actor,
      'POST',
      `/orders/${id}/submit`,
      { idempotencyKey: `submit-${tag}-${run}` },
    )
    expect(submitted.status, `submit ${tag}`).toBe(200)
    expect(submitted.body.item.state, `submit ${tag}`).toBe('confirmed')
    return id
  }

  async function issueFor(orderId: string, tag: string, actor: Actor = manager) {
    const invoiceId = uuidv7()
    const res = await call<{ item: Detail }>(app, actor, 'POST', '/invoices', {
      idempotencyKey: `issue-${tag}-${run}`,
      id: invoiceId,
      orderId,
    })
    return { invoiceId, res }
  }

  const ledgerFor = async (refId: string): Promise<LedgerRow[]> =>
    (
      await db.execute(
        sql`select reason::text as reason, qty_delta, lot_id, location_id from stock_ledger
             where tenant_id = ${tenantId} and ref_id = ${refId} order by id`,
      )
    ).rows as LedgerRow[]

  const journalSum = async (refType: string, refId: string): Promise<number | null> => {
    const rows = (
      await db.execute(
        sql`select coalesce(sum(l.amount_paise), 0)::bigint as total
              from journal_entries e join journal_lines l on l.entry_id = e.id
             where e.tenant_id = ${tenantId} and e.ref_type = ${refType} and e.ref_id = ${refId}`,
      )
    ).rows as { total: string | number }[]
    return rows[0] ? Number(rows[0].total) : null
  }

  const journalCount = async (refType: string, refId: string): Promise<number> =>
    Number(
      (
        (
          await db.execute(
            sql`select count(*)::int as n from journal_entries
                 where tenant_id = ${tenantId} and ref_type = ${refType} and ref_id = ${refId}`,
          )
        ).rows as { n: number }[]
      )[0]?.n ?? 0,
    )

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `bill-${run}`, legalName: 'Billing Test Traders', stateCode: '27' },
      { id: otherTenantId, slug: `bill-x-${run}`, legalName: 'Other Traders', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+91971${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91971${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91971${run}3`, name: 'Accountant' },
      { id: warehouseId, phone: `+91971${run}4`, name: 'Packer' },
      { id: repId, phone: `+91971${run}5`, name: 'Rep' },
      { id: driverId, phone: `+91971${run}6`, name: 'Driver' },
      { id: shopUserId, phone: `+91971${run}7`, name: 'Shopkeeper' },
      { id: otherOwnerId, phone: `+91971${run}8`, name: 'Other owner' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: warehouseId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId: otherTenantId, userId: otherOwnerId, role: 'owner' },
    ])
    await bootstrapTenant(db, tenantId)
    await bootstrapTenant(db, otherTenantId)

    // THE SERIES IS CONFIGURATION (docs/17 §D1): this distributor prints `TST/` and starts at 501.
    await db
      .update(numberingSeries)
      .set({ prefix: 'TST/', startingNo: 501 })
      .where(
        sql`${numberingSeries.tenantId} = ${tenantId} AND ${numberingSeries.seriesCode} = 'INV'`,
      )
    // `bootstrapTenant` already seeded the display name from the legal name; the UPI id and the FSSAI
    // licence are deliberately absent until a distributor configures them.
    await db
      .insert(tenantSettings)
      .values([
        { tenantId, key: TENANT_SETTING_KEYS.brandingDisplayName, value: 'Billing Test Traders' },
        { tenantId, key: TENANT_SETTING_KEYS.upiVpa, value: `bill${run}@okhdfcbank` },
        { tenantId, key: TENANT_SETTING_KEYS.sellerFssai, value: '11525012000456' },
      ])
      .onConflictDoNothing()

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker bill ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, name: 'Wafers', category: 'namkeen' })
    await db.insert(productVariants).values([
      {
        id: variantA,
        productId,
        name: 'Wafers 45 g',
        netQty: 45,
        netUnit: 'g',
        defaultCaseSize: 24,
        hsnCode: hsn,
        mrpPaise: 1000,
      },
      {
        id: variantB,
        productId,
        name: 'Wafers 90 g',
        netQty: 90,
        netUnit: 'g',
        defaultCaseSize: 24,
        hsnCode: hsn,
        mrpPaise: 2000,
      },
    ])
    // the tenant sells in 12s even though the maker prints 24 (docs/17 B: sell-side pack wins)
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
      phone: `+91972${run}1`,
      userId: shopUserId,
      shopName: `MH Shop ${run}`,
      fssaiLicense: '22522012000111',
    })
    await db.insert(retailers).values([
      {
        id: shopMh,
        tenantId,
        identityId,
        code: `MH-${run}`,
        name: `MH Shop ${run}`,
        phone: `+91972${run}1`,
        stateCode: '27',
        gstRegType: 'regular',
        gstin: '27AAXPT9021Q1ZQ',
        creditDays: 15,
        cashDiscountBps: 200,
        cashDiscountDays: 7,
        address: { area: 'Kalyan West', city: 'Kalyan', pincode: '421301' },
      },
      {
        id: shopGj,
        tenantId,
        code: `GJ-${run}`,
        name: `GJ Shop ${run}`,
        phone: `+91972${run}2`,
        stateCode: '24',
        gstRegType: 'regular',
        gstin: '24AAXPT9021Q1ZK',
        creditDays: 7,
      },
      {
        id: shopB2c,
        tenantId,
        code: `B2C-${run}`,
        name: `Kirana ${run}`,
        phone: `+91972${run}3`,
        stateCode: '27',
        gstRegType: 'unregistered',
      },
    ])
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
    damaged = locs.find((l) => l.kind === 'damaged')?.id ?? ''
    const vanId = uuidv7()
    await db
      .insert(locations)
      .values({ id: vanId, tenantId, kind: 'vehicle', name: `Tempo ${run}`, vehicleId: uuidv7() })
    van = vanId

    app = await bootTestApp([BillingModule, OrdersModule, InventoryModule, ReceivablesModule])

    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      const a = await inventory.findOrCreateLot(tx, {
        variantId: variantA,
        batchNo: `B1-${run}`,
        mrpPaise: 1000,
        expiryDate: '2027-12-31',
      })
      const b = await inventory.findOrCreateLot(tx, {
        variantId: variantB,
        batchNo: `B2-${run}`,
        mrpPaise: 2000,
      })
      await inventory.post(tx, [
        {
          lotId: a.lot.id,
          locationId: godown,
          qtyDelta: 5_000,
          reason: 'opening',
          idempotencyKey: `open-${run}-a`,
        },
        {
          lotId: b.lot.id,
          locationId: godown,
          qtyDelta: 5_000,
          reason: 'opening',
          idempotencyKey: `open-${run}-b`,
        },
        {
          lotId: a.lot.id,
          locationId: van,
          qtyDelta: 60,
          reason: 'transfer_in',
          idempotencyKey: `open-${run}-van`,
        },
      ])
    })
  })

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------------------------------

  let firstInvoiceId = ''
  let firstOrderId = ''

  it('issues a bill from the tenant-configured series and posts a balanced receivable', async () => {
    firstOrderId = await placeOrder(rep, shopMh, [{ variantId: variantA, cases: 2 }], 'first')
    const { invoiceId, res } = await issueFor(firstOrderId, 'first')
    firstInvoiceId = invoiceId
    expect(res.status).toBe(200)
    const bill = res.body.item

    // prefix `TST/` and starting number 501 are the DISTRIBUTOR's configuration, not a constant
    expect(bill.invoiceNo).toBe('TST/0501')
    expect(bill.seriesCode).toBe('INV')
    expect(bill.state).toBe('issued')
    expect(bill.source).toBe('pack')
    // the shop is GST-registered, so the primary document is a B2B tax invoice (docs/17 §D3)
    expect(bill.supplyType).toBe('B2B')
    expect(bill.buyerGstin).toBe('27AAXPT9021Q1ZQ')
    // 24 pcs x ₹10 = ₹240 + 12% = ₹268.80 -> ₹269 with 20 paise to round off
    expect(bill).toMatchObject({
      subtotalPaise: 24_000,
      discountPaise: 0,
      taxablePaise: 24_000,
      cgstPaise: 1_440,
      sgstPaise: 1_440,
      igstPaise: 0,
      roundOffPaise: 20,
      totalPaise: 26_900,
      amountDuePaise: 26_900,
    })
    // cash discount is REPORTED, never deducted (docs/17 §D2)
    expect(bill.cashDiscountBps).toBe(200)
    expect(bill.cashDiscountUntil).not.toBeNull()
    expect(bill.dueDate).not.toBeNull()
    // white label: the seller block and the QR carry the DISTRIBUTOR's own name (docs/17 §D6)
    expect(bill.seller.displayName).toBe('Billing Test Traders')
    expect(bill.seller.upiVpa).toBe(`bill${run}@okhdfcbank`)
    expect(bill.upiQrPayload).toContain('upi://pay?pa=')
    expect(bill.upiQrPayload).toContain('tr=TST-0501')

    expect(bill.lines).toHaveLength(1)
    const line = bill.lines[0]
    expect(line).toMatchObject({
      qtyPcs: 24,
      ratePaise: 1_000,
      taxablePaise: 24_000,
      gstBps: 1_200,
      cgstPaise: 1_440,
      sgstPaise: 1_440,
      igstPaise: 0,
      enteredQty: 2,
      enteredUnit: 'case',
      caseSize: 12,
      description: 'Wafers 45 g',
    })
    expect(line?.batchNo).toBe(`B1-${run}`)
    expect(line?.lotId).not.toBeNull()

    // the order moved to `packed` and the pieces left the godown as `sale` rows
    const order = await call<{ item: { state: string } }>(
      app,
      manager,
      'GET',
      `/orders/${firstOrderId}`,
    )
    expect(order.body.item.state).toBe('packed')
    const ledger = await ledgerFor(invoiceId)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ reason: 'sale', qty_delta: -24, location_id: godown })

    // one balanced AR entry, and receivables owns it
    expect(await journalCount('invoice', invoiceId)).toBe(1)
    expect(await journalSum('invoice', invoiceId)).toBe(0)
  })

  it('replays the same idempotency key instead of issuing a second bill', async () => {
    const replay = await call<{ item: Detail }>(app, manager, 'POST', '/invoices', {
      idempotencyKey: `issue-first-${run}`,
      id: firstInvoiceId,
      orderId: firstOrderId,
    })
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(firstInvoiceId)
    expect(replay.body.item.invoiceNo).toBe('TST/0501')
    const rows = (
      await db.execute(
        sql`select count(*)::int as n from invoices where tenant_id = ${tenantId} and order_id = ${firstOrderId}`,
      )
    ).rows as { n: number }[]
    expect(rows[0]?.n).toBe(1)
    expect(await journalCount('invoice', firstInvoiceId)).toBe(1)
  })

  it('refuses a second bill for an order that already has one', async () => {
    const second = await call<{ message: string }>(app, manager, 'POST', '/invoices', {
      idempotencyKey: `issue-first-again-${run}`,
      id: uuidv7(),
      orderId: firstOrderId,
    })
    expect(second.status).toBe(409)
    expect(second.body.message).toMatch(/already billed/)
  })

  it('takes one number per bill under concurrency, with no gap and no duplicate', async () => {
    const a = await placeOrder(rep, shopMh, [{ variantId: variantA, cases: 1 }], 'race-a')
    const b = await placeOrder(rep, shopMh, [{ variantId: variantA, cases: 1 }], 'race-b')
    const [first, second] = await Promise.all([issueFor(a, 'race-a'), issueFor(b, 'race-b')])
    expect(first.res.status).toBe(200)
    expect(second.res.status).toBe(200)
    const numbers = [first.res.body.item.invoiceNo, second.res.body.item.invoiceNo].sort()
    expect(numbers).toEqual(['TST/0502', 'TST/0503'])
  })

  it('splits GST by place of supply: intra-state halves, inter-state IGST only', async () => {
    const gjOrder = await placeOrder(rep, shopGj, [{ variantId: variantA, cases: 1 }], 'gj')
    const { res } = await issueFor(gjOrder, 'gj')
    expect(res.status).toBe(200)
    const bill = res.body.item
    expect(bill.isInterState).toBe(true)
    expect(bill.placeOfSupplyState).toBe('24')
    // 12 pcs x ₹10 = ₹120 + 12% IGST ₹14.40 = ₹134.40 -> ₹134, 40 paise back to round off
    expect(bill).toMatchObject({
      taxablePaise: 12_000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 1_440,
      totalPaise: 13_400,
      roundOffPaise: -40,
    })
    expect(await journalSum('invoice', bill.id)).toBe(0)

    // and a shop with no GSTIN is B2C on the same intra-state split
    const b2cOrder = await placeOrder(rep, shopB2c, [{ variantId: variantA, cases: 1 }], 'b2c')
    const b2c = await issueFor(b2cOrder, 'b2c')
    expect(b2c.res.body.item.supplyType).toBe('B2C')
    expect(b2c.res.body.item.buyerGstin).toBeNull()
    expect(b2c.res.body.item.isInterState).toBe(false)
    expect(b2c.res.body.item.cgstPaise).toBe(b2c.res.body.item.sgstPaise)
  })

  it('bills only the packed pieces and gives the rest back to the shelf', async () => {
    const orderId = await placeOrder(rep, shopMh, [{ variantId: variantB, cases: 2 }], 'short')
    const detail = await call<{ item: { lines: { id: string }[] } }>(
      app,
      manager,
      'GET',
      `/orders/${orderId}`,
    )
    const orderLineId = detail.body.item.lines[0]?.id ?? ''
    const before = await reservedFor(orderLineId)
    expect(before).toBe(24)

    const res = await call<{ item: Detail }>(app, manager, 'POST', '/invoices', {
      idempotencyKey: `issue-short-${run}`,
      id: uuidv7(),
      orderId,
      lines: [{ orderLineId, qtyPcs: 18 }],
    })
    expect(res.status).toBe(200)
    expect(res.body.item.lines[0]?.qtyPcs).toBe(18)
    // 18 pcs no longer divide into the 12-piece case, so the bill prints honest pieces (docs/17 A3)
    expect(res.body.item.lines[0]?.enteredUnit).toBe('piece')
    expect(res.body.item.lines[0]?.enteredQty).toBe(18)
    expect(res.body.item.taxablePaise).toBe(45_000)
    expect(await reservedFor(orderLineId)).toBe(0)
  })

  it('refuses every edit of an issued bill at the DATABASE, not just in the handler', async () => {
    await expect(
      asOwner((tx) =>
        tx.execute(
          sql`update invoices set total_paise = total_paise + 100 where id = ${firstInvoiceId}`,
        ),
      ),
    ).rejects.toSatisfy((e: unknown) => {
      const err = e as { message?: string; cause?: { message?: string } }
      return /issued and immutable/.test(err.cause?.message ?? err.message ?? '')
    })
    await expect(
      asOwner((tx) =>
        tx.execute(sql`delete from invoice_lines where invoice_id = ${firstInvoiceId}`),
      ),
    ).rejects.toSatisfy((e: unknown) => {
      const err = e as { message?: string; cause?: { message?: string } }
      return /lines are immutable/.test(err.cause?.message ?? err.message ?? '')
    })
  })

  it('cancels before dispatch: the number survives, stock and money come back', async () => {
    const orderId = await placeOrder(rep, shopMh, [{ variantId: variantA, cases: 1 }], 'cancel')
    const { invoiceId, res } = await issueFor(orderId, 'cancel')
    expect(res.status).toBe(200)
    const number = res.body.item.invoiceNo

    expect(
      (
        await call(app, accountant, 'POST', `/invoices/${invoiceId}/cancel`, {
          idempotencyKey: `cancel-403-${run}`,
          reason: 'not allowed',
        })
      ).status,
    ).toBe(403)

    const cancelled = await call<{ item: Detail }>(
      app,
      owner,
      'POST',
      `/invoices/${invoiceId}/cancel`,
      { idempotencyKey: `cancel-${run}`, reason: 'Retailer refused the load before dispatch.' },
    )
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.item.state).toBe('cancelled')
    expect(cancelled.body.item.invoiceNo).toBe(number)
    expect(cancelled.body.item.cancelReason).toBe('Retailer refused the load before dispatch.')
    expect(cancelled.body.item.amountDuePaise).toBe(0)

    const rows = await ledgerFor(invoiceId)
    expect(rows.map((r) => r.reason).sort()).toEqual(['adjustment', 'sale'])
    expect(rows.reduce((s, r) => s + r.qty_delta, 0)).toBe(0)
    expect(await journalSum('invoice_cancel', invoiceId)).toBe(0)

    // the order is back in the billing queue and can be billed again with the NEXT number
    const queue = await call<{ items: { orderId: string }[] }>(
      app,
      manager,
      'GET',
      '/billing/queue',
      {
        limit: 50,
      },
    )
    expect(queue.body.items.map((i) => i.orderId)).toContain(orderId)
    const again = await issueFor(orderId, 'cancel-again')
    expect(again.res.status).toBe(200)
    expect(again.res.body.item.invoiceNo).not.toBe(number)
  })

  it('refuses cancellation once money has been allocated to the bill', async () => {
    const orderId = await placeOrder(rep, shopMh, [{ variantId: variantA, cases: 1 }], 'paid')
    const { invoiceId, res } = await issueFor(orderId, 'paid')
    expect(res.status).toBe(200)
    const receipt = await call<{ item: { id: string } }>(app, accountant, 'POST', '/receipts', {
      idempotencyKey: `receipt-${run}`,
      id: uuidv7(),
      retailerId: shopMh,
      mode: 'cash',
      amountPaise: 100,
      strategy: 'explicit',
      allocations: [{ id: uuidv7(), invoiceId, amountPaise: 100 }],
    })
    expect(receipt.status).toBe(200)
    const refused = await call<{ message: string }>(
      app,
      owner,
      'POST',
      `/invoices/${invoiceId}/cancel`,
      { idempotencyKey: `cancel-paid-${run}`, reason: 'too late' },
    )
    expect(refused.status).toBe(409)
    expect(refused.body.message).toMatch(/credit note/)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // credit notes

  let creditedInvoiceId = ''
  let creditedLineId = ''

  it('credits at the ORIGINAL rate, restocks the pieces and drops what the shop owes', async () => {
    const orderId = await placeOrder(rep, shopMh, [{ variantId: variantA, cases: 2 }], 'credit')
    const { invoiceId, res } = await issueFor(orderId, 'credit')
    expect(res.status).toBe(200)
    creditedInvoiceId = invoiceId
    creditedLineId = res.body.item.lines[0]?.id ?? ''
    const dueBefore = res.body.item.amountDuePaise

    const noteId = uuidv7()
    const created = await call<{ item: CreditNoteDetailBody }>(
      app,
      driver,
      'POST',
      '/credit-notes',
      {
        idempotencyKey: `cn-${run}`,
        id: noteId,
        invoiceId,
        reason: 'short_delivery',
        restockLocationId: godown,
        autoIssue: true,
        lines: [{ id: uuidv7(), invoiceLineId: creditedLineId, qtyPcs: 6, saleable: true }],
      },
    )
    expect(created.status).toBe(200)
    const note = created.body.item
    expect(note.state).toBe('issued')
    expect(note.creditNoteNo).toMatch(/^CN\//)
    expect(note.lines[0]?.ratePaise).toBe(1_000) // the invoiced rate, never today's list
    // 6 x ₹10 = ₹60 + 12% = ₹67.20 -> ₹67
    expect(note).toMatchObject({
      taxablePaise: 6_000,
      cgstPaise: 360,
      sgstPaise: 360,
      totalPaise: 6_700,
    })
    expect(note.seller.displayName).toBe('Billing Test Traders')

    const restocked = await ledgerFor(noteId)
    expect(restocked).toHaveLength(1)
    expect(restocked[0]).toMatchObject({
      reason: 'sale_return_saleable',
      qty_delta: 6,
      location_id: godown,
    })
    expect(await journalSum('credit_note', noteId)).toBe(0)

    // receivables allocated the note to the bill, so the shop owes less and the invoice row is untouched
    const after = await call<{ item: Detail }>(app, manager, 'GET', `/invoices/${invoiceId}`)
    expect(after.body.item.amountDuePaise).toBe(dueBefore - note.totalPaise)
    expect(after.body.item.totalPaise).toBe(res.body.item.totalPaise)
    expect(after.body.item.creditNotes.map((c) => c.id)).toContain(noteId)
  })

  it('never credits more than was invoiced, counting every earlier note', async () => {
    const tooMuch = await call<{ message: string }>(app, accountant, 'POST', '/credit-notes', {
      idempotencyKey: `cn-over-${run}`,
      id: uuidv7(),
      invoiceId: creditedInvoiceId,
      reason: 'return_saleable',
      lines: [{ id: uuidv7(), invoiceLineId: creditedLineId, qtyPcs: 19 }],
    })
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body.message).toMatch(/left to credit/)

    // and never above the invoiced rate
    const tooDear = await call<{ message: string }>(app, accountant, 'POST', '/credit-notes', {
      idempotencyKey: `cn-rate-${run}`,
      id: uuidv7(),
      invoiceId: creditedInvoiceId,
      reason: 'rate_difference',
      lines: [{ id: uuidv7(), invoiceLineId: creditedLineId, qtyPcs: 1, ratePaise: 5_000 }],
    })
    expect(tooDear.status).toBe(400)
    expect(tooDear.body.message).toMatch(/invoiced rate/)
  })

  it('sends a damaged return to the damaged bin and moves nothing for a financial note', async () => {
    const damagedNote = uuidv7()
    const res = await call<{ item: CreditNoteDetailBody }>(
      app,
      accountant,
      'POST',
      '/credit-notes',
      {
        idempotencyKey: `cn-damaged-${run}`,
        id: damagedNote,
        invoiceId: creditedInvoiceId,
        reason: 'return_damaged',
        autoIssue: true,
        lines: [{ id: uuidv7(), invoiceLineId: creditedLineId, qtyPcs: 2, saleable: false }],
      },
    )
    expect(res.status).toBe(200)
    const rows = await ledgerFor(damagedNote)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ reason: 'sale_return_damaged', location_id: damaged })

    const financial = uuidv7()
    const rate = await call<{ item: CreditNoteDetailBody }>(
      app,
      accountant,
      'POST',
      '/credit-notes',
      {
        idempotencyKey: `cn-rate-diff-${run}`,
        id: financial,
        invoiceId: creditedInvoiceId,
        reason: 'rate_difference',
        autoIssue: true,
        lines: [{ id: uuidv7(), invoiceLineId: creditedLineId, qtyPcs: 4, ratePaise: 100 }],
      },
    )
    expect(rate.status).toBe(200)
    expect(rate.body.item.taxablePaise).toBe(400)
    expect(await ledgerFor(financial)).toHaveLength(0)
    expect(await journalSum('credit_note', financial)).toBe(0)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // the other two sources of a bill

  it('bills a van sale from the vehicle location on the tenant’s normal series', async () => {
    const orderId = uuidv7()
    const created = await call<{ item: { id: string } }>(app, driver, 'POST', '/orders', {
      idempotencyKey: `van-order-${run}`,
      id: orderId,
      retailerId: shopMh,
      source: 'van_sale',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 12, enteredUnit: 'piece' }],
    })
    expect(created.status).toBe(200)
    await call(app, manager, 'POST', `/orders/${orderId}/submit`, {
      idempotencyKey: `van-submit-${run}`,
    })

    const res = await call<{ item: Detail }>(app, driver, 'POST', '/invoices/van-sale', {
      idempotencyKey: `van-issue-${run}`,
      id: uuidv7(),
      orderId,
      vehicleLocationId: van,
    })
    expect(res.status).toBe(200)
    expect(res.body.item.source).toBe('van_sale')
    // the SAME series as any other bill (docs/17 §D5): no per-vehicle series, no device number
    expect(res.body.item.seriesCode).toBe('INV')
    expect(res.body.item.invoiceNo).toMatch(/^TST\/05\d\d$/)
    const rows = await ledgerFor(res.body.item.id)
    expect(rows.every((r) => r.location_id === van)).toBe(true)

    // the van holds 60 pieces; asking for more is a 400, never a negative balance
    const bigOrder = uuidv7()
    await call(app, driver, 'POST', '/orders', {
      idempotencyKey: `van-big-${run}`,
      id: bigOrder,
      retailerId: shopMh,
      source: 'van_sale',
      lines: [{ id: uuidv7(), variantId: variantA, enteredQty: 500, enteredUnit: 'piece' }],
    })
    await call(app, manager, 'POST', `/orders/${bigOrder}/submit`, {
      idempotencyKey: `van-big-submit-${run}`,
    })
    const short = await call<{ message: string }>(app, driver, 'POST', '/invoices/van-sale', {
      idempotencyKey: `van-big-issue-${run}`,
      id: uuidv7(),
      orderId: bigOrder,
      vehicleLocationId: van,
    })
    expect(short.status).toBe(400)
    expect(short.body.message).toMatch(/insufficient sellable stock/)
  })

  it('stores a brand-DMS bill verbatim, moves no stock and never imports it twice', async () => {
    const before = await invSeriesNextNo()
    const externalNo = `TY/26-27/${run}`
    const body = {
      idempotencyKey: `dms-${run}`,
      id: uuidv7(),
      retailerId: shopMh,
      externalInvoiceNo: externalNo,
      invoiceDate: '2026-09-01',
      placeOfSupplyState: '27',
      roundOffPaise: 0,
      lines: [
        {
          id: uuidv7(),
          variantId: variantA,
          description: 'Wafers 45 g',
          hsnCode: hsn,
          qtyPcs: 24,
          ratePaise: 900,
          gstBps: 1_200,
        },
      ],
    }
    const res = await call<{ item: Detail }>(app, accountant, 'POST', '/invoices/brand-dms', body)
    expect(res.status).toBe(200)
    expect(res.body.item.source).toBe('brand_dms_import')
    expect(res.body.item.invoiceNo).toBe(externalNo)
    expect(res.body.item.seriesCode).toBe('EXT')
    expect(res.body.item.taxablePaise).toBe(21_600)
    // our own counter never moved, and the goods arrived on the brand's own documents
    expect(await invSeriesNextNo()).toBe(before)
    expect(await ledgerFor(res.body.item.id)).toHaveLength(0)
    expect(await journalSum('invoice', res.body.item.id)).toBe(0)

    const twice = await call<{ message: string }>(app, accountant, 'POST', '/invoices/brand-dms', {
      ...body,
      idempotencyKey: `dms-again-${run}`,
      id: uuidv7(),
    })
    expect(twice.status).toBe(409)
    expect(twice.body.message).toMatch(/imported before/)
  })

  it('answers the e-invoice request with a local stub only when the flag is on', async () => {
    const skipped = await call<{ status: string; reason: string | null }>(
      app,
      accountant,
      'POST',
      `/invoices/${firstInvoiceId}/irn`,
      { idempotencyKey: `irn-off-${run}` },
    )
    expect(skipped.status).toBe(200)
    expect(skipped.body.status).toBe('skipped')

    await db.execute(
      sql`update feature_flags set enabled = true where tenant_id = ${tenantId} and flag = 'e_invoicing'`,
    )
    const stubbed = await call<{ status: string; irn: string | null; ackNo: string | null }>(
      app,
      accountant,
      'POST',
      `/invoices/${firstInvoiceId}/irn`,
      { idempotencyKey: `irn-on-${run}` },
    )
    expect(stubbed.body.status).toBe('stubbed')
    expect(stubbed.body.irn).toHaveLength(64)
    expect(stubbed.body.ackNo).toMatch(/^STUB\d{10}$/)
  })

  it('records an e-way bill and answers queued for a PDF nobody has rendered yet', async () => {
    const ewb = await call<{ item: Detail & { ewayBillNo: string | null } }>(
      app,
      warehouse,
      'POST',
      `/invoices/${firstInvoiceId}/eway-bill`,
      {
        idempotencyKey: `ewb-${run}`,
        ewayBillNo: '123456789012',
        validUntil: '2026-12-31T23:59:59.000Z',
        transportMode: 'road',
        vehicleNo: 'MH04AB1234',
      },
    )
    expect(ewb.status).toBe(200)
    expect(ewb.body.item.ewayBillNo).toBe('123456789012')

    const pdf = await call<{ status: string; url: string | null }>(
      app,
      shop,
      'GET',
      `/invoices/${firstInvoiceId}/pdf`,
    )
    expect(pdf.status).toBe(200)
    expect(pdf.body).toMatchObject({ status: 'queued', url: null })
  })

  // ---------------------------------------------------------------------------------------------------------------
  // registers

  it('aggregates only issued bills, and reports credit notes separately', async () => {
    const window = { from: '2020-01-01', to: '2099-12-31' }
    const summary = await call<{
      rows: { hsnCode: string | null; qtyPcs: number; taxablePaise: number }[]
      totals: { taxablePaise: number; cgstPaise: number; igstPaise: number }
      creditNoteRows: { taxablePaise: number }[]
      creditNoteTotals: { taxablePaise: number }
    }>(app, accountant, 'GET', '/billing/gst-summary', window)
    expect(summary.status).toBe(200)
    expect(summary.body.rows.length).toBeGreaterThan(0)
    expect(summary.body.rows.every((r) => r.hsnCode === hsn)).toBe(true)
    expect(summary.body.totals.taxablePaise).toBe(
      summary.body.rows.reduce((s, r) => s + r.taxablePaise, 0),
    )
    expect(summary.body.creditNoteTotals.taxablePaise).toBeGreaterThan(0)

    const register = await call<{
      items: { id: string; invoiceNo: string | null; state: string; totalPaise: number }[]
      totals: { totalPaise: number; invoiceCount: number }
    }>(app, accountant, 'GET', '/billing/sales-register', { ...window, limit: 200 })
    expect(register.status).toBe(200)
    // a cancelled bill keeps its number in the register and shows zero money
    const cancelledRow = register.body.items.find((i) => i.state === 'cancelled')
    expect(cancelledRow?.invoiceNo).not.toBeNull()
    expect(cancelledRow?.totalPaise).toBe(0)
    expect(register.body.totals.invoiceCount).toBeGreaterThan(0)

    // grouping by rate collapses the HSN column, which is what the owner's tax view wants
    const byRate = await call<{ rows: { hsnCode: string | null; gstBps: number }[] }>(
      app,
      accountant,
      'GET',
      '/billing/gst-summary',
      { ...window, groupBy: 'rate' },
    )
    expect(byRate.body.rows.every((r) => r.hsnCode === null)).toBe(true)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // who may do what — asserted at the API and again at the database, so RLS is the guarantee

  it('keeps a salesperson out of the registers and out of issuing', async () => {
    expect(
      (
        await call(app, rep, 'GET', '/billing/gst-summary', {
          from: '2026-01-01',
          to: '2026-12-31',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, rep, 'GET', '/billing/sales-register', {
          from: '2026-01-01',
          to: '2026-12-31',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call(app, rep, 'POST', '/invoices', {
          idempotencyKey: `rep-${run}`,
          id: uuidv7(),
          orderId: firstOrderId,
        })
      ).status,
    ).toBe(403)
    // a rep may still SEE that a bill exists for a shop it serves — a bill carries no cost
    const seen = await call<{ items: { id: string }[] }>(app, rep, 'GET', '/invoices', { limit: 5 })
    expect(seen.status).toBe(200)
    // …and may not take money through the QR (docs/17 §D4)
    expect((await call(app, rep, 'GET', `/invoices/${firstInvoiceId}/upi-qr`)).status).toBe(403)
  })

  it('lets the warehouse issue but never cancel, and the accountant cancel nothing', async () => {
    const orderId = await placeOrder(rep, shopMh, [{ variantId: variantA, cases: 1 }], 'wh')
    const issued = await issueFor(orderId, 'wh', warehouse)
    expect(issued.res.status).toBe(200)
    expect(
      (
        await call(app, warehouse, 'POST', `/invoices/${issued.invoiceId}/cancel`, {
          idempotencyKey: `wh-cancel-${run}`,
          reason: 'nope',
        })
      ).status,
    ).toBe(403)
    // a delivery actor may not issue a PACK invoice, though the van sale is its own
    expect(
      (
        await call(app, driver, 'POST', '/invoices', {
          idempotencyKey: `driver-${run}`,
          id: uuidv7(),
          orderId,
        })
      ).status,
    ).toBe(403)
  })

  it('shows a shopkeeper its own bills and its own QR, and nothing else', async () => {
    const mine = await call<{ items: { retailerId: string }[] }>(app, shop, 'GET', '/invoices', {
      limit: 200,
    })
    expect(mine.status).toBe(200)
    expect(mine.body.items.length).toBeGreaterThan(0)
    expect(mine.body.items.every((i) => i.retailerId === shopMh)).toBe(true)

    const own = await call<{ payload: string | null; payeeName: string }>(
      app,
      shop,
      'GET',
      `/invoices/${firstInvoiceId}/upi-qr`,
    )
    expect(own.status).toBe(200)
    // the shop pays the DISTRIBUTOR, under the distributor's own name (docs/17 §D4 and §D6)
    expect(own.body.payeeName).toBe('Billing Test Traders')
    expect(own.body.payload).toContain(`pa=bill${run}%40okhdfcbank`)

    // another shop's bill is NOT FOUND, and RLS — not the handler — is what hides it
    const gjInvoice = (
      (
        await db.execute(
          sql`select id from invoices where tenant_id = ${tenantId} and retailer_id = ${shopGj} limit 1`,
        )
      ).rows as { id: string }[]
    )[0]?.id
    expect(gjInvoice).toBeDefined()
    expect((await call(app, shop, 'GET', `/invoices/${gjInvoice ?? ''}`)).status).toBe(404)
    const shopCtx: TenantContext = { tenantId, actorId: shopUserId, actorRole: 'retailer' }
    const visible = await tenantStorage.run(shopCtx, () =>
      withTenant(db, shopCtx, (tx) =>
        tx.execute(sql`select count(*)::int as n from invoices where id = ${gjInvoice ?? ''}`),
      ),
    )
    expect((visible.rows as { n: number }[])[0]?.n).toBe(0)

    // a shop writes nothing here
    expect(
      (
        await call(app, shop, 'POST', '/credit-notes', {
          idempotencyKey: `shop-cn-${run}`,
          id: uuidv7(),
          invoiceId: firstInvoiceId,
          reason: 'other',
          lines: [{ id: uuidv7(), invoiceLineId: creditedLineId, qtyPcs: 1 }],
        })
      ).status,
    ).toBe(403)
  })

  it('hides this tenant’s bills from another distributor, and refuses an anonymous read', async () => {
    expect((await call(app, stranger, 'GET', `/invoices/${firstInvoiceId}`)).status).toBe(404)
    expect((await call(app, null, 'GET', '/invoices', {})).status).toBe(401)
  })

  // ---------------------------------------------------------------------------------------------------------------

  async function reservedFor(orderLineId: string): Promise<number> {
    const rows = (
      await db.execute(
        sql`select coalesce(sum(qty), 0)::int as held from reservations
             where tenant_id = ${tenantId} and order_line_id = ${orderLineId} and state = 'pending'`,
      )
    ).rows as { held: number }[]
    return Number(rows[0]?.held ?? 0)
  }

  async function invSeriesNextNo(): Promise<number> {
    const rows = (
      await db.execute(
        sql`select next_no from numbering_series
             where tenant_id = ${tenantId} and series_code = 'INV'`,
      )
    ).rows as { next_no: number }[]
    return Number(rows[0]?.next_no ?? 0)
  }
})
