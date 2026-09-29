import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { businessDate, lineTax, uuidv7 } from '@dos/domain'
import {
  bootstrapTenant,
  brands,
  createDb,
  createPool,
  hsnRates,
  invoiceLines,
  invoices,
  locations,
  manufacturers,
  memberships,
  priceListItems,
  priceLists,
  products,
  productVariants,
  retailers,
  returnPolicies,
  schemeAmountFaults,
  schemes,
  suppliers,
  tenantBrands,
  tenants,
  users,
  withTenant,
  type AppliedRule,
  type Db,
  type TenantContext,
} from '@dos/db'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { ClaimsModule } from '../claims/index.js'
import { InventoryModule, InventoryService } from '../inventory/index.js'
import { OrdersModule } from '../orders/index.js'
import { PricingModule } from '../pricing/index.js'
import { ReceivablesModule } from '../receivables/index.js'
import { ReportingModule } from '../reporting/index.js'
import { SyncModule } from '../sync/index.js'
import { WarehouseModule } from '../warehouse/index.js'
import { BillingModule } from './index.js'

/**
 * PRICES AND TAX FROM QUOTE TO BILL (docs/22 §8, 2026-09-28, "Architect rulings, prices and tax"; QA phase 8,
 * QA/findings/16-pricing-tax.md). Every case goes the way the product goes: the rep's quote, the order placed and
 * confirmed, the godown's pack that issues the bill — and then the readers of the bill.
 */

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

interface BillLine {
  id: string
  orderLineId: string | null
  variantId: string
  qtyPcs: number
  freeQtyPcs: number
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  lineTotalPaise: number
  appliedRules: AppliedRule[]
}
interface Bill {
  id: string
  invoiceNo: string | null
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  roundOffPaise: number
  totalPaise: number
  lines: BillLine[]
}
interface OrderLine {
  id: string
  variantId: string
  qtyPcs: number
  discountPaise: number
  taxPaise: number
  lineTotalPaise: number
  appliedRules: AppliedRule[]
}
interface Order {
  id: string
  state: string
  taxPaise: number
  roundOffPaise: number
  totalPaise: number
  lines: OrderLine[]
}
interface Quote {
  lines: { lineId: string; taxPaise: number; lineNetPaise: number }[]
  totals: { netPaise: number; taxPaise: number; roundOffPaise: number; totalPaise: number }
}

describeDb('prices and tax, quote to bill (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  // `hsn_rates` is global and unique on (code, date): a random part keeps two runs in parallel apart.
  const rnd = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
  const hsn = { g12: `41${rnd}`, g18: `42${rnd}`, g0: `43${rnd}` }
  const today = businessDate().date

  const tenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const repId = uuidv7()
  const storeId = uuidv7()
  const driverId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }
  const ownerCtx: TenantContext = { tenantId, actorId: ownerId, actorRole: 'owner' }
  const asOwner = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ownerCtx, () => withTenant(db, ownerCtx, fn))

  const brandX = uuidv7()
  const supplierId = uuidv7()
  const gheeScheme = uuidv7()
  const v = {
    ghee: uuidv7(),
    t12at1025: uuidv7(),
    t0at1001: uuidv7(),
    t0at1010: uuidv7(),
    t18at1025: uuidv7(),
    t0at1040: uuidv7(),
    t0at1011: uuidv7(),
    t18at1050: Array.from({ length: 6 }, () => uuidv7()),
  }
  const RATE = {
    ghee: 31_738,
    t12at1025: 1025,
    t0at1001: 1001,
    t0at1010: 1010,
    t18at1025: 1025,
    t0at1040: 1040,
    t0at1011: 1011,
    t18at1050: 1050,
  }
  /** A fresh shop per case, so no credit decision or earlier order of another case reaches it. */
  const shopOf = new Map<string, string>()
  let godown = ''
  let van = ''
  let app: NestFastifyApplication

  async function newShop(tag: string, stateCode = '27'): Promise<string> {
    const id = uuidv7()
    await db.insert(retailers).values({
      id,
      tenantId,
      code: `${tag}-${run}`,
      name: `Shop ${tag} ${run}`,
      phone: `+91975${run}${String(shopOf.size).padStart(2, '0')}`,
      stateCode,
      gstRegType: 'unregistered',
      creditDays: 7,
    })
    shopOf.set(tag, id)
    return id
  }

  async function quote(retailerId: string, lines: { variantId: string; qtyPcs: number }[]) {
    const res = await call<Quote>(app, rep, 'POST', '/pricing/quote', {
      retailerId,
      lines: lines.map((l, i) => ({ lineId: `l${String(i)}`, ...l })),
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body
  }

  async function placeOrder(
    retailerId: string,
    lines: { variantId: string; qtyPcs: number }[],
    tag: string,
    actor: Actor = rep,
    source = 'salesperson',
  ): Promise<Order> {
    const id = uuidv7()
    const created = await call<{ item: Order }>(app, actor, 'POST', '/orders', {
      idempotencyKey: `order-${tag}-${run}`,
      id,
      retailerId,
      source,
      lines: lines.map((l) => ({
        id: uuidv7(),
        variantId: l.variantId,
        enteredQty: l.qtyPcs,
        enteredUnit: 'piece',
      })),
    })
    expect(created.status, `order ${tag}: ${JSON.stringify(created.body)}`).toBe(200)
    const submitted = await call<{ item: Order }>(app, actor, 'POST', `/orders/${id}/submit`, {
      idempotencyKey: `submit-${tag}-${run}`,
    })
    expect(submitted.status, `submit ${tag}: ${JSON.stringify(submitted.body)}`).toBe(200)
    return submitted.body.item
  }

  async function pack(orderId: string, tag: string): Promise<Bill> {
    const packed = await call<{ invoice: { id: string } | null; message?: string }>(
      app,
      manager,
      'POST',
      `/warehouse/orders/${orderId}/pack`,
      { idempotencyKey: `pack-${tag}-${run}`, id: uuidv7(), packages: 1 },
    )
    expect(packed.status, `pack ${tag}: ${JSON.stringify(packed.body)}`).toBe(200)
    const bill = await call<{ item: Bill }>(
      app,
      manager,
      'GET',
      `/invoices/${packed.body.invoice?.id ?? ''}`,
    )
    expect(bill.status).toBe(200)
    return bill.body.item
  }

  const taxOf = (b: Pick<Bill, 'cgstPaise' | 'sgstPaise' | 'igstPaise' | 'cessPaise'>): number =>
    b.cgstPaise + b.sgstPaise + b.igstPaise + b.cessPaise

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({
        id: tenantId,
        slug: `ptax-${run}`,
        legalName: 'Prices Tax Traders',
        stateCode: '27',
      })
    await db.insert(users).values([
      { id: ownerId, phone: `+91974${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91974${run}2`, name: 'Manager' },
      { id: repId, phone: `+91974${run}3`, name: 'Rep' },
      { id: storeId, phone: `+91974${run}4`, name: 'Store' },
      { id: driverId, phone: `+91974${run}5`, name: 'Driver' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
    ])
    await bootstrapTenant(db, tenantId)
    await db.insert(hsnRates).values([
      { id: uuidv7(), hsnCode: hsn.g12, gstBps: 1200, cessBps: 0, effectiveFrom: '2020-04-01' },
      { id: uuidv7(), hsnCode: hsn.g18, gstBps: 1800, cessBps: 0, effectiveFrom: '2020-04-01' },
      { id: uuidv7(), hsnCode: hsn.g0, gstBps: 0, cessBps: 0, effectiveFrom: '2020-04-01' },
    ])
    const manufacturerId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker ptax ${run}` })
    await db.insert(brands).values({ id: brandX, manufacturerId, name: `Godavari ${run}` })
    const productId = uuidv7()
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, brandId: brandX, name: 'Ghee', category: 'dairy' })
    const variant = (id: string, name: string, hsnCode: string) => ({
      id,
      productId,
      name,
      netQty: 1,
      netUnit: 'pcs' as const,
      defaultCaseSize: 12,
      hsnCode,
    })
    await db
      .insert(productVariants)
      .values([
        variant(v.ghee, 'Cow Ghee 500 ml', hsn.g12),
        variant(v.t12at1025, 'Bhujia 200 g', hsn.g12),
        variant(v.t0at1001, 'Dahi 200 g', hsn.g0),
        variant(v.t0at1010, 'Dahi 400 g', hsn.g0),
        variant(v.t18at1025, 'Soap 100 g', hsn.g18),
        variant(v.t0at1040, 'Paneer 100 g', hsn.g0),
        variant(v.t0at1011, 'Milk 500 ml', hsn.g0),
        ...v.t18at1050.map((id, i) => variant(id, `Biscuit ${String(i + 1)}`, hsn.g18)),
      ])
    const listId = uuidv7()
    await db
      .insert(priceLists)
      .values({ id: listId, tenantId, name: `Default ${run}`, isDefault: true, active: true })
    const item = (variantId: string, ratePaise: number) => ({
      id: uuidv7(),
      tenantId,
      priceListId: listId,
      variantId,
      ratePaise,
    })
    await db
      .insert(priceListItems)
      .values([
        item(v.ghee, RATE.ghee),
        item(v.t12at1025, RATE.t12at1025),
        item(v.t0at1001, RATE.t0at1001),
        item(v.t0at1010, RATE.t0at1010),
        item(v.t18at1025, RATE.t18at1025),
        item(v.t0at1040, RATE.t0at1040),
        item(v.t0at1011, RATE.t0at1011),
        ...v.t18at1050.map((id) => item(id, RATE.t18at1050)),
      ])
    // X05: the brand's 6 % on ghee, company-funded and claimable, "on its own".
    await db.insert(schemes).values({
      id: gheeScheme,
      tenantId,
      name: `Godavari Ghee 6 % ${run}`,
      brandId: brandX,
      scope: { variantIds: [v.ghee] },
      triggerKind: 'qty',
      triggerMin: 1,
      triggerUnit: 'pcs',
      rewardKind: 'line_pct',
      rewardValue: 600,
      applicability: {},
      validFrom: '2020-01-01',
      validTo: '2099-12-31',
      stackable: false,
      final: false,
      fundingSource: 'company',
      claimable: true,
      claimChannel: 'dos',
      active: true,
    })
    await db.insert(suppliers).values({ id: supplierId, tenantId, name: `Godavari depot ${run}` })
    await db.insert(tenantBrands).values({ id: uuidv7(), tenantId, brandId: brandX })
    await db.insert(returnPolicies).values({
      id: uuidv7(),
      tenantId,
      brandId: brandX,
      claimSupplierId: supplierId,
      claimWindowDays: 90,
    })
    const locs = await db.select().from(locations).where(eq(locations.tenantId, tenantId))
    godown = locs.find((l) => l.kind === 'warehouse')?.id ?? ''
    van = uuidv7()
    await db
      .insert(locations)
      .values({ id: van, tenantId, kind: 'vehicle', name: `Tempo ${run}`, vehicleId: uuidv7() })

    app = await bootTestApp([
      BillingModule,
      WarehouseModule,
      OrdersModule,
      InventoryModule,
      ReceivablesModule,
      PricingModule,
      ClaimsModule,
      ReportingModule,
      SyncModule,
    ])

    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      // X05: the ghee stands in five batches of 1, 3, 3, 3 and 2 pieces, so FEFO picks 12 from all five.
      const gheeLots = [1, 3, 3, 3, 2]
      for (const [i, qty] of gheeLots.entries()) {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId: v.ghee,
          batchNo: `G${String(i)}-${run}`,
          mrpPaise: 36_000,
          expiryDate: `2027-0${String(i + 1)}-15`,
        })
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: qty,
            reason: 'opening',
            idempotencyKey: `open-ghee-${String(i)}-${run}`,
          },
        ])
      }
      const others = [
        v.t12at1025,
        v.t0at1001,
        v.t0at1010,
        v.t18at1025,
        v.t0at1040,
        v.t0at1011,
        ...v.t18at1050,
      ]
      for (const [i, variantId] of others.entries()) {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId,
          batchNo: `B${String(i)}-${run}`,
          mrpPaise: 2_000,
          expiryDate: '2027-12-31',
        })
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: 500,
            reason: 'opening',
            idempotencyKey: `open-${String(i)}-${run}`,
          },
          {
            lotId: lot.id,
            locationId: van,
            qtyDelta: 20,
            reason: 'opening',
            idempotencyKey: `open-van-${String(i)}-${run}`,
          },
        ])
      }
    })
  })

  afterAll(async () => {
    await app.close()
    await db.delete(hsnRates).where(inArray(hsnRates.hsnCode, Object.values(hsn)))
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-330 (ruling 1): a scheme is counted once per order line

  it('DOS-330: a scheme over five batches is claimed and reported once — on a bill written now and on one written before with whole copies', async () => {
    const shop = await newShop('X05')
    const order = await placeOrder(shop, [{ variantId: v.ghee, qtyPcs: 12 }], 'x05')
    expect(order.state).toBe('confirmed')
    const orderLine = order.lines[0]
    const given = orderLine?.discountPaise ?? 0
    // 6 % of 12 × ₹317.38 = ₹228.51, exactly what QA's X05 was given
    expect(given).toBe(22_851)

    const bill = await pack(order.id, 'x05')
    const gheeLines = bill.lines.filter((l) => l.variantId === v.ghee)
    expect(gheeLines).toHaveLength(5)
    const ruleSum = (lines: readonly BillLine[]) =>
      lines.reduce(
        (s, l) =>
          s +
          l.appliedRules
            .filter((r) => r.ruleId === gheeScheme)
            .reduce((n, r) => n + (r.amountPaise ?? 0), 0),
        0,
      )
    // the bill written now: each batch line carries its SHARE, and the shares are the discount
    expect(ruleSum(gheeLines)).toBe(given)
    expect(gheeLines.reduce((s, l) => s + l.discountPaise, 0)).toBe(given)
    for (const l of gheeLines) {
      const share = l.appliedRules.find((r) => r.ruleId === gheeScheme)
      expect(share?.batchShare).toBe(true)
      expect(share?.amountPaise).toBe(l.discountPaise)
    }

    // A bill written BEFORE the ruling: the same lines, each carrying the order line's whole rule (INV/9059's
    // shape). An issued bill is never rewritten, so the readers must count it once.
    const oldId = uuidv7()
    const oldNo = `OLD/${run}`
    const [issued] = await db.select().from(invoices).where(eq(invoices.id, bill.id))
    if (!issued) throw new Error('bill not found')
    await db.insert(invoices).values({
      ...issued,
      id: oldId,
      invoiceNo: oldNo,
      seriesCode: 'OLD',
      orderId: null,
      upiQrPayload: null,
    })
    const rows = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, bill.id))
    await db.insert(invoiceLines).values(
      rows.map((r) => ({
        ...r,
        id: uuidv7(),
        invoiceId: oldId,
        appliedRules: orderLine?.appliedRules ?? [],
      })),
    )
    const copied = (
      await db.execute(sql`
        select coalesce(sum((rule ->> 'amountPaise')::bigint), 0)::bigint as amount
          from invoice_lines l cross join lateral jsonb_array_elements(l.applied_rules) rule
         where l.invoice_id = ${oldId}`)
    ).rows[0] as { amount: string }
    expect(Number(copied.amount)).toBe(5 * given) // what the readers used to add up

    // the owner's scheme-spend register: both bills, each counted once
    const spend = await call<{
      items: { schemeId: string; amountPaise: number; invoiceCount: number }[]
    }>(app, owner, 'GET', '/reporting/registers/scheme-spend', { from: today, to: today })
    expect(spend.status, JSON.stringify(spend.body)).toBe(200)
    const row = spend.body.items.find((i) => i.schemeId === gheeScheme)
    expect(row?.amountPaise).toBe(2 * given)
    expect(row?.invoiceCount).toBe(2)

    // the brand claim: what was given, never × the batches
    const claimId = uuidv7()
    const opened = await call(app, manager, 'POST', '/claims', {
      idempotencyKey: `claim-open-${run}`,
      id: claimId,
      supplierId,
      brandId: brandX,
      kind: 'scheme',
      periodFrom: today,
      periodTo: today,
    })
    expect(opened.status, JSON.stringify(opened.body)).toBe(200)
    const built = await call<{ item: { claimedPaise: number; lines: { amountPaise: number }[] } }>(
      app,
      manager,
      'POST',
      `/claims/${claimId}/build`,
      { idempotencyKey: `claim-build-${run}`, id: claimId },
    )
    expect(built.status, JSON.stringify(built.body)).toBe(200)
    expect(built.body.item.lines).toHaveLength(10) // one per batch line of each bill
    expect(built.body.item.claimedPaise).toBe(2 * given)

    // the release check names the old bill as copies (read once), and not the bill written now
    const faults = await schemeAmountFaults(db, tenantId)
    expect(faults.map((f) => [f.invoiceNo, f.status, f.readPaise, f.storedPaise])).toEqual([
      [oldNo, 'copies', given, 5 * given],
    ])
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-332 (ruling 2): one GST rule from quote to bill

  const T_CASES: {
    tag: string
    state: string
    lines: { variantId: string; qtyPcs: number }[]
    tax: number
    total: number
  }[] = [
    // ₹10.25 at 12 % + ₹10.01 at 0 %: halves 61.5 p → 62 + 62 = 124 p; ₹21.50 → ₹22 on the order AND the bill
    {
      tag: 'T01',
      state: '27',
      lines: [
        { variantId: v.t12at1025, qtyPcs: 1 },
        { variantId: v.t0at1001, qtyPcs: 1 },
      ],
      tax: 124,
      total: 2200,
    },
    // ₹10.50 at 18 % + ₹10.10: 94.5 → 95 twice = 190; ₹22.50 → ₹23
    {
      tag: 'T02',
      state: '27',
      lines: [
        { variantId: v.t18at1050[0] ?? '', qtyPcs: 1 },
        { variantId: v.t0at1010, qtyPcs: 1 },
      ],
      tax: 190,
      total: 2300,
    },
    // ₹10.25 at 18 % + ₹10.40: 92.25 → 92 twice = 184; ₹22.49 → ₹22
    {
      tag: 'T03',
      state: '27',
      lines: [
        { variantId: v.t18at1025, qtyPcs: 1 },
        { variantId: v.t0at1040, qtyPcs: 1 },
      ],
      tax: 184,
      total: 2200,
    },
    // six ₹10.50 18 % lines + ₹10.11: 6 × 190 = 1140; ₹84.51 → ₹85 (the combined rate said ₹84 on the order)
    {
      tag: 'T04',
      state: '27',
      lines: [
        ...v.t18at1050.map((variantId) => ({ variantId, qtyPcs: 1 })),
        { variantId: v.t0at1011, qtyPcs: 1 },
      ],
      tax: 1140,
      total: 8500,
    },
    // the same as T02 for a Gujarat shop: IGST whole, 189; ₹22.49 → ₹22
    {
      tag: 'T05',
      state: '24',
      lines: [
        { variantId: v.t18at1050[0] ?? '', qtyPcs: 1 },
        { variantId: v.t0at1010, qtyPcs: 1 },
      ],
      tax: 189,
      total: 2200,
    },
  ]

  for (const c of T_CASES) {
    it(`DOS-332 ${c.tag}: the quote, the order and the bill carry the same tax to the paisa and the same total to the rupee`, async () => {
      const shop = await newShop(c.tag, c.state)
      const quoted = await quote(shop, c.lines)
      expect(quoted.totals.taxPaise).toBe(c.tax)
      expect(quoted.totals.totalPaise).toBe(c.total)
      const order = await placeOrder(shop, c.lines, c.tag)
      expect(order.taxPaise).toBe(c.tax)
      expect(order.totalPaise).toBe(c.total)
      const bill = await pack(order.id, c.tag)
      expect(taxOf(bill)).toBe(c.tax)
      expect(bill.totalPaise).toBe(c.total)
      expect(bill.roundOffPaise).toBe(order.roundOffPaise)
      if (c.state === '24') expect(bill.cgstPaise + bill.sgstPaise).toBe(0)
      else expect(bill.cgstPaise).toBe(bill.sgstPaise)
      // each order line's tax is its bill lines' tax
      for (const line of order.lines) {
        const onBill = bill.lines.filter((l) => l.orderLineId === line.id)
        expect(onBill.reduce((s, l) => s + taxOf(l), 0)).toBe(line.taxPaise)
      }
    })
  }

  it('DOS-332: the ghee split over five batches bills exactly the order line’s tax', async () => {
    const shop = await newShop('X05b')
    // the five batches were emptied by the first case: stock them again the same way
    const inventory = app.get(InventoryService)
    await asOwner(async (tx) => {
      for (const [i, qty] of [1, 3, 3, 3, 2].entries()) {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId: v.ghee,
          batchNo: `G${String(i)}-${run}`,
          mrpPaise: 36_000,
          expiryDate: `2027-0${String(i + 1)}-15`,
        })
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: qty,
            reason: 'opening',
            idempotencyKey: `restock-ghee-${String(i)}-${run}`,
          },
        ])
      }
    })
    const order = await placeOrder(shop, [{ variantId: v.ghee, qtyPcs: 12 }], 'x05b')
    const bill = await pack(order.id, 'x05b')
    const line = order.lines[0]
    const expected = lineTax(
      (line?.lineTotalPaise ?? 0) - (line?.taxPaise ?? 0),
      { gstBps: 1200, cessBps: 0 },
      false,
    )
    expect(line?.taxPaise).toBe(expected.taxPaise)
    expect(bill.lines.filter((l) => l.variantId === v.ghee)).toHaveLength(5)
    expect(bill.cgstPaise).toBe(expected.cgstPaise)
    expect(bill.sgstPaise).toBe(expected.sgstPaise)
    expect(bill.totalPaise).toBe(order.totalPaise)
  })

  it('DOS-332: repeat-last, an offline upload and a van sale price through the same rule', async () => {
    const shop = shopOf.get('T01') ?? ''
    // repeat-last re-prices the T01 order today: the same 124 p
    const repeatId = uuidv7()
    const repeated = await call<{ item: Order }>(app, rep, 'POST', '/orders/repeat-last', {
      idempotencyKey: `repeat-${run}`,
      id: repeatId,
      retailerId: shop,
      source: 'salesperson',
    })
    expect(repeated.status, JSON.stringify(repeated.body)).toBe(200)
    expect(repeated.body.item.taxPaise).toBe(124)
    expect(repeated.body.item.totalPaise).toBe(2200)

    // the rep's phone drafts the same order offline and uploads it
    const syncOrder = uuidv7()
    const uploaded = await call<{ accepted: number; rejected: unknown[] }>(
      app,
      rep,
      'POST',
      '/sync/upload',
      {
        protocol: 1,
        deviceId: `ptax-device-${run}`,
        ops: [
          {
            opId: `ptax-so-${run}`,
            op: 'PUT',
            table: 'sales_orders',
            id: syncOrder,
            data: { retailer_id: shop, source: 'salesperson', state: 'draft' },
          },
          ...[v.t12at1025, v.t0at1001].map((variantId, i) => ({
            opId: `ptax-sol-${String(i)}-${run}`,
            op: 'PUT',
            table: 'sales_order_lines',
            id: uuidv7(),
            data: {
              order_id: syncOrder,
              variant_id: variantId,
              entered_qty: 1,
              entered_unit: 'piece',
            },
          })),
        ],
      },
    )
    expect(uploaded.status).toBe(200)
    expect(uploaded.body.rejected).toEqual([])
    const synced = await call<{ item: Order }>(app, rep, 'GET', `/orders/${syncOrder}`)
    expect(synced.body.item.taxPaise).toBe(124)
    expect(synced.body.item.totalPaise).toBe(2200)

    // the desk drafts a van order and the crew bills it off the van: the same 124 p and ₹22
    const vanOrder = await placeOrder(
      shop,
      [
        { variantId: v.t12at1025, qtyPcs: 1 },
        { variantId: v.t0at1001, qtyPcs: 1 },
      ],
      'van',
      manager,
      'van_sale',
    )
    expect(vanOrder.taxPaise).toBe(124)
    const sold = await call<{ item: Bill }>(app, driver, 'POST', '/invoices/van-sale', {
      idempotencyKey: `van-sale-${run}`,
      id: uuidv7(),
      orderId: vanOrder.id,
      vehicleLocationId: van,
    })
    expect(sold.status, JSON.stringify(sold.body)).toBe(200)
    expect(taxOf(sold.body.item)).toBe(124)
    expect(sold.body.item.totalPaise).toBe(2200)
  })

  it('the release check is clean for this distributor’s bills written now', async () => {
    const faults = await schemeAmountFaults(db, tenantId)
    expect(faults.filter((f) => f.status === 'differs')).toEqual([])
    // and the bills are what the journal took: no bill of this spec was written without its lines
    const [{ n } = { n: 0 }] = (
      await db.execute(
        sql`select count(*)::int as n from invoices i where i.tenant_id = ${tenantId}
             and not exists (select 1 from invoice_lines l where l.invoice_id = i.id)`,
      )
    ).rows as { n: number }[]
    expect(n).toBe(0)
    expect(
      (
        await db
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(eq(invoices.tenantId, tenantId), eq(invoices.seriesCode, 'OLD')))
      ).length,
    ).toBe(1)
  })
})
