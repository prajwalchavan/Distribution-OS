import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { businessDate, lineTax, shareOut, uuidv7 } from '@dos/domain'
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
  retailerIdentities,
  retailerLinks,
  retailers,
  returnPolicies,
  schemeAmountFaults,
  schemes,
  suppliers,
  tenantBrands,
  tenantProductCosts,
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
  const accountantId = uuidv7()
  const shopUserId = uuidv7()
  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }
  const shopkeeper: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
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
    /** QA N05 / N09: Sunbake Marie, ₹22.45 on the list, landed at ₹20.37. */
    marie: uuidv7(),
    /** QA's priority probe: Garam Masala at ₹74.54. */
    masala: uuidv7(),
    /** QA F04: Sunbake Glucose at ₹7.44 with 12 + 1 and 5 % off, in batches of 48, 65 and 17. */
    glucose: uuidv7(),
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
    marie: 2245,
    masala: 7454,
    glucose: 744,
  }
  const MARIE_LANDED = 2037
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

  /** A shop whose own login (`shopkeeper`) is linked to it, so the shop can ask for its own rate. */
  async function linkedShop(tag: string): Promise<string> {
    const id = await newShop(tag)
    const identityId = uuidv7()
    await db.insert(retailerIdentities).values({
      id: identityId,
      phone: `+91976${run}${String(shopOf.size).padStart(2, '0')}`,
      userId: shopUserId,
      shopName: `Shop ${tag} ${run}`,
    })
    await db.update(retailers).set({ identityId }).where(eq(retailers.id, id))
    await db.insert(retailerLinks).values({
      id: uuidv7(),
      tenantId,
      identityId,
      retailerId: id,
      userId: shopUserId,
      linkedBy: 'rep_onboarding',
      status: 'active',
    })
    return id
  }

  interface Bargain {
    id: string
    status: string
    requestedByName?: string | null
    requestedByRole?: string | null
    itemName?: string | null
    costPaise?: number | null
    belowCost?: boolean
  }
  const ask = (
    actor: Actor,
    retailerId: string,
    variantId: string,
    askedRatePaise: number,
    tag: string,
    extra: Record<string, unknown> = {},
  ) =>
    call<{ item: Bargain; message?: string }>(app, actor, 'POST', '/pricing/bargains', {
      idempotencyKey: `ask-${tag}-${run}`,
      id: uuidv7(),
      retailerId,
      variantId,
      askedRatePaise,
      ...extra,
    })
  const decideRate = (actor: Actor, id: string, tag: string, extra: Record<string, unknown> = {}) =>
    call<{ item: Bargain; message?: string; data?: { code?: string } }>(
      app,
      actor,
      'POST',
      `/pricing/bargains/${id}/decide`,
      { idempotencyKey: `decide-${tag}-${run}`, id, decision: 'approve', ...extra },
    )

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
    await db.insert(tenants).values({
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
      { id: accountantId, phone: `+91974${run}6`, name: 'Accountant' },
      { id: shopUserId, phone: `+91974${run}7`, name: 'Shopkeeper' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
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
        variant(v.marie, 'Marie 250 g', hsn.g18),
        variant(v.masala, 'Garam Masala 100 g', hsn.g18),
        variant(v.glucose, 'Glucose 55 g', hsn.g12),
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
        item(v.marie, RATE.marie),
        item(v.masala, RATE.masala),
        item(v.glucose, RATE.glucose),
      ])
    await db.insert(tenantProductCosts).values({
      id: uuidv7(),
      tenantId,
      variantId: v.marie,
      purchaseRatePaise: 2007,
      landedCostPaise: MARIE_LANDED,
    })
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
      for (const [i, qty] of [48, 65, 17].entries()) {
        const { lot } = await inventory.findOrCreateLot(tx, {
          variantId: v.glucose,
          batchNo: `GL${String(i)}-${run}`,
          mrpPaise: 1_000,
          expiryDate: `2027-0${String(i + 1)}-20`,
        })
        await inventory.post(tx, [
          {
            lotId: lot.id,
            locationId: godown,
            qtyDelta: qty,
            reason: 'opening',
            idempotencyKey: `open-glucose-${String(i)}-${run}`,
          },
        ])
      }
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
        v.marie,
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

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-336 and DOS-335 (ruling 5): who asks for a rate, what the desk is shown, and never below zero or cost blind

  it('DOS-336: only the rep, the shop, the manager and the owner ask; the gate names who asked, the item, both rates and what it gives away', async () => {
    const shop = await linkedShop('N336')
    for (const [actor, tag] of [
      [accountant, 'acc'],
      [store, 'store'],
      [driver, 'crew'],
    ] as const) {
      const refused = await ask(actor, shop, v.marie, 1256, `336-${tag}`)
      expect(refused.status, `${tag}: ${JSON.stringify(refused.body)}`).toBe(403)
    }
    // the SHOP asks; the REP places the order the ask then gates
    const asked = await ask(shopkeeper, shop, v.marie, 2100, '336-shop')
    expect(asked.status, JSON.stringify(asked.body)).toBe(200)
    expect(asked.body.item.status).toBe('requested')
    const order = await placeOrder(shop, [{ variantId: v.marie, qtyPcs: 10 }], '336')
    expect(order.state).toBe('submitted')

    const queue = await call<{
      items: {
        id: string
        requestedBy: string
        bargain?: {
          requestedBy: string
          requestedByName: string | null
          requestedByRole: string | null
          itemName: string | null
          listRatePaise: number
          askedRatePaise: number
          qtyPcs: number | null
          givesAwayPaise: number | null
          costPaise: number | null
          belowCost: boolean
        } | null
      }[]
    }>(app, owner, 'GET', '/approvals', { status: 'pending', kind: 'bargain', orderId: order.id })
    expect(queue.status, JSON.stringify(queue.body)).toBe(200)
    const gate = queue.body.items[0]
    // the gate was raised by whoever placed the order; the rate was asked by the shop — the queue says so
    expect(gate?.requestedBy).toBe(repId)
    expect(gate?.bargain).toMatchObject({
      requestedBy: shopUserId,
      requestedByName: 'Shopkeeper',
      requestedByRole: 'retailer',
      itemName: 'Marie 250 g',
      listRatePaise: 2245,
      askedRatePaise: 2100,
      qtyPcs: 10,
      givesAwayPaise: 1450,
      costPaise: MARIE_LANDED,
      belowCost: false,
    })

    const decided = await call<{ order: Order | null }>(
      app,
      owner,
      'POST',
      `/approvals/${gate?.id ?? ''}/decide`,
      { idempotencyKey: `336-gate-${run}`, id: gate?.id, decision: 'approve' },
    )
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)
    expect(decided.body.order?.state).toBe('confirmed')
  })

  it('DOS-335: a rate at or below ₹0 is refused in words; below cost only the owner, knowingly; the rep learns only the outcome', async () => {
    const shop = await newShop('N335')
    for (const rate of [0, -100]) {
      const refused = await ask(rep, shop, v.marie, rate, `335-zero-${String(rate)}`)
      expect(refused.status).toBe(400)
      expect(refused.body.message).toMatch(/cannot be asked for Marie 250 g: ask for the rate/)
      expect(refused.body.message).not.toMatch(/20\.37/)
    }
    // a rep bound of 20 % would approve ₹20.00 on the spot — but it is below cost, so it waits for the owner
    const bound = await call(app, owner, 'POST', '/pricing/bounds', {
      idempotencyKey: `335-bound-${run}`,
      id: uuidv7(),
      userId: repId,
      maxDiscountBps: 2000,
    })
    expect(bound.status, JSON.stringify(bound.body)).toBe(200)
    const below = await ask(rep, shop, v.marie, 2000, '335-below')
    expect(below.status).toBe(200)
    expect(below.body.item.status).toBe('requested')
    const above = await ask(rep, shop, v.marie, 2100, '335-above')
    expect(above.body.item.status).toBe('auto_approved')
    // purchase cost never reaches the rep, whatever the request
    const mine = await call<{ items: Bargain[] }>(app, rep, 'GET', '/pricing/bargains', {
      retailerId: shop,
    })
    expect(mine.body.items.length).toBeGreaterThan(0)
    for (const item of mine.body.items) {
      expect('costPaise' in item).toBe(false)
      expect('belowCost' in item).toBe(false)
    }
    expect(JSON.stringify(mine.body)).not.toMatch(/2037/)

    // the manager is refused with the sentence that sends it to the owner
    const byManager = await decideRate(manager, below.body.item.id, '335-mgr')
    expect(byManager.status).toBe(403)
    expect(byManager.body.message).toBe(
      '₹20.00 a piece for Marie 250 g is below what it cost (₹20.37): only the owner can approve a rate below cost. Leave it for the owner, or approve ₹20.37 or more',
    )
    // the owner must say so
    const blind = await decideRate(owner, below.body.item.id, '335-owner-blind')
    expect(blind.status).toBe(409)
    expect(blind.body.message).toMatch(/below what it cost \(₹20\.37\).*sell below cost/)
    const knowingly = await decideRate(owner, below.body.item.id, '335-owner', {
      confirmBelowCost: true,
    })
    expect(knowingly.status, JSON.stringify(knowingly.body)).toBe(200)
    expect(knowingly.body.item.status).toBe('approved')
    // what the rep reads afterwards: approved, and nothing about why
    const after = await call<{ items: Bargain[] }>(app, rep, 'GET', '/pricing/bargains', {
      retailerId: shop,
    })
    expect(after.body.items.find((b) => b.id === below.body.item.id)?.status).toBe('approved')

    // ₹0.00 approved over a request: refused in words, owner or not
    const another = await ask(rep, shop, v.marie, 1950, '335-another')
    expect(another.body.item.status).toBe('requested')
    const zero = await decideRate(owner, another.body.item.id, '335-zero-approve', {
      approvedRatePaise: 0,
      confirmBelowCost: true,
    })
    expect(zero.status).toBe(400)
    expect(zero.body.message).toMatch(/^₹0\.00 a piece cannot be approved for Marie 250 g/)

    // an item with no cost on record: the below-cost rule does not apply
    const noCost = await ask(rep, shop, v.t0at1001, 1, '335-nocost')
    expect(noCost.body.item.status).toBe('requested')
    const allowed = await decideRate(manager, noCost.body.item.id, '335-nocost')
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200)
  })

  it('DOS-335: approving a bargain GATE below cost is the owner’s alone, with the same confirmation', async () => {
    const shop = await linkedShop('N335g')
    const asked = await ask(shopkeeper, shop, v.marie, 1900, '335g-shop')
    expect(asked.body.item.status).toBe('requested')
    const order = await placeOrder(shop, [{ variantId: v.marie, qtyPcs: 5 }], '335g')
    const queue = await call<{ items: { id: string; bargain?: { belowCost: boolean } | null }[] }>(
      app,
      owner,
      'GET',
      '/approvals',
      { status: 'pending', kind: 'bargain', orderId: order.id },
    )
    const gate = queue.body.items[0]
    expect(gate?.bargain?.belowCost).toBe(true)
    const byManager = await call<{ message: string }>(
      app,
      manager,
      'POST',
      `/approvals/${gate?.id ?? ''}/decide`,
      { idempotencyKey: `335g-mgr-${run}`, id: gate?.id, decision: 'approve' },
    )
    expect(byManager.status).toBe(403)
    expect(byManager.body.message).toMatch(/only the owner can approve a rate below cost/)
    const blind = await call<{ message: string }>(
      app,
      owner,
      'POST',
      `/approvals/${gate?.id ?? ''}/decide`,
      { idempotencyKey: `335g-blind-${run}`, id: gate?.id, decision: 'approve' },
    )
    expect(blind.status).toBe(409)
    const knowingly = await call<{ order: Order | null }>(
      app,
      owner,
      'POST',
      `/approvals/${gate?.id ?? ''}/decide`,
      {
        idempotencyKey: `335g-owner-${run}`,
        id: gate?.id,
        decision: 'approve',
        confirmBelowCost: true,
      },
    )
    expect(knowingly.status, JSON.stringify(knowingly.body)).toBe(200)
    expect(knowingly.body.order?.state).toBe('confirmed')
    // the order is charged the approved rate
    expect(knowingly.body.order?.lines[0]?.lineTotalPaise).toBe(
      5 * 1900 + lineTax(5 * 1900, { gstBps: 1800, cessBps: 0 }, false).taxPaise,
    )
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-334 (ruling 4): the owner sets which scheme applies first; DOS-338 (ruling 9): the free-goods flag is ignored

  it('DOS-334: priority is accepted, returned and applied (priority, then id); a scheme saved without it keeps its own', async () => {
    const scheme = (id: string, name: string, extra: Record<string, unknown>) => ({
      idempotencyKey: `scheme-${name}-${run}`,
      id,
      name: `${name} ${run}`,
      scope: { variantIds: [v.masala] },
      triggerKind: 'qty',
      triggerMin: 1,
      triggerUnit: 'pcs',
      validFrom: '2020-01-01',
      validTo: '2099-12-31',
      stackable: true,
      fundingSource: 'distributor',
      ...extra,
    })
    const flat = uuidv7()
    const pct = uuidv7()
    // made in this order and never ordered: the flat ₹5 a piece applies first, as today
    const madeFlat = await call<{ item: { priority?: number; gstOnFreeGoods: boolean } }>(
      app,
      owner,
      'POST',
      '/pricing/schemes',
      scheme(flat, 'flat5', {
        rewardKind: 'per_unit_amount',
        rewardValue: 500,
        gstOnFreeGoods: true,
      }),
    )
    expect(madeFlat.status, JSON.stringify(madeFlat.body)).toBe(200)
    expect(madeFlat.body.item.priority).toBe(0)
    // DOS-338: the flag is accepted without an error and changes nothing, so it is not kept
    expect(madeFlat.body.item.gstOnFreeGoods).toBe(false)
    await call(
      app,
      owner,
      'POST',
      '/pricing/schemes',
      scheme(pct, 'pct10', {
        rewardKind: 'line_pct',
        rewardValue: 1000,
      }),
    )
    const shop = await newShop('P334')
    const before = await quote(shop, [{ variantId: v.masala, qtyPcs: 48 }])
    // ₹3,577.92: ₹240 flat first, then 10 % of ₹3,337.92 = ₹333.79 → ₹573.79 (QA's probe)
    expect(before.lines[0]?.lineNetPaise).toBe(357_792 - 57_379)

    // the owner puts the 10 % first
    const ordered = await call<{ item: { priority?: number } }>(
      app,
      owner,
      'POST',
      '/pricing/schemes',
      scheme(flat, 'flat5-ordered', {
        rewardKind: 'per_unit_amount',
        rewardValue: 500,
        priority: 50,
      }),
    )
    expect(ordered.body.item.priority).toBe(50)
    await call(
      app,
      owner,
      'POST',
      '/pricing/schemes',
      scheme(pct, 'pct10-ordered', {
        rewardKind: 'line_pct',
        rewardValue: 1000,
        priority: 1,
      }),
    )
    const after = await quote(shop, [{ variantId: v.masala, qtyPcs: 48 }])
    // 10 % first = ₹357.79, then ₹240 → ₹597.79, the owner's order
    expect(after.lines[0]?.lineNetPaise).toBe(357_792 - 59_779)

    // saved again without a priority: it keeps its own (50), and the list reads it back
    await call(
      app,
      owner,
      'POST',
      '/pricing/schemes',
      scheme(flat, 'flat5-again', {
        rewardKind: 'per_unit_amount',
        rewardValue: 500,
        name: `flat5 renamed ${run}`,
      }),
    )
    const listed = await call<{ items: { id: string; priority?: number }[] }>(
      app,
      owner,
      'GET',
      '/pricing/schemes',
      { limit: 200 },
    )
    const byId = new Map(listed.body.items.map((i) => [i.id, i.priority]))
    expect(byId.get(flat)).toBe(50)
    expect(byId.get(pct)).toBe(1)
    // switch both off so no later case prices masala with them
    for (const id of [flat, pct])
      await db.update(schemes).set({ active: false }).where(eq(schemes.id, id))
  })

  it('DOS-338: a free item carries its own GST rate on the order line and the bill line, at no value and no tax', async () => {
    const gift = uuidv7()
    const made = await call<{ item: { gstOnFreeGoods: boolean } }>(
      app,
      owner,
      'POST',
      '/pricing/schemes',
      {
        idempotencyKey: `scheme-gift-${run}`,
        id: gift,
        name: `2 soaps free per case ${run}`,
        scope: { variantIds: [v.t12at1025] },
        triggerKind: 'qty',
        triggerMin: 12,
        triggerUnit: 'pcs',
        rewardKind: 'free_qty',
        rewardValue: 2,
        freeVariantId: v.t18at1025,
        validFrom: '2020-01-01',
        validTo: '2099-12-31',
        fundingSource: 'distributor',
        gstOnFreeGoods: true,
      },
    )
    expect(made.status, JSON.stringify(made.body)).toBe(200)
    expect(made.body.item.gstOnFreeGoods).toBe(false)
    const shop = await newShop('F05')
    const order = await placeOrder(shop, [{ variantId: v.t12at1025, qtyPcs: 12 }], 'f05')
    const orderReward = order.lines.find((l) => l.variantId === v.t18at1025) as
      (OrderLine & { gstBps: number; freeQtyPcs: number }) | undefined
    expect(orderReward).toMatchObject({ qtyPcs: 0, freeQtyPcs: 2, gstBps: 1800, taxPaise: 0 })
    const bill = await pack(order.id, 'f05')
    const billReward = bill.lines.find((l) => l.variantId === v.t18at1025) as
      (BillLine & { gstBps: number }) | undefined
    expect(billReward).toMatchObject({
      qtyPcs: 0,
      freeQtyPcs: 2,
      gstBps: 1800,
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
    })
    expect(bill.totalPaise).toBe(order.totalPaise)
    await db.update(schemes).set({ active: false }).where(eq(schemes.id, gift))
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-219: "On its own" means no other scheme at all, the bill-level one included (QA X04)

  it('DOS-219: an "On its own" line takes no share of the bill scheme; quote, order and bill agree', async () => {
    const shop = await newShop('X04')
    const alone = uuidv7()
    const bill2 = uuidv7()
    const base = {
      applicability: { retailerIds: [shop] },
      validFrom: '2020-01-01',
      validTo: '2099-12-31',
      fundingSource: 'distributor',
    }
    for (const body of [
      {
        idempotencyKey: `x04-alone-${run}`,
        id: alone,
        name: `X04 on its own 10 % ${run}`,
        scope: { variantIds: [v.t12at1025] },
        triggerKind: 'qty',
        triggerMin: 1,
        triggerUnit: 'pcs',
        rewardKind: 'line_pct',
        rewardValue: 1000,
        stackable: false,
        ...base,
      },
      {
        idempotencyKey: `x04-bill-${run}`,
        id: bill2,
        name: `X04 bill 2 % ${run}`,
        scope: { all: true },
        triggerKind: 'value',
        triggerMin: 10_000,
        triggerUnit: 'inr',
        rewardKind: 'order_pct',
        rewardValue: 200,
        ...base,
      },
    ]) {
      const made = await call(app, owner, 'POST', '/pricing/schemes', body)
      expect(made.status, JSON.stringify(made.body)).toBe(200)
    }
    const lines = [
      { variantId: v.t12at1025, qtyPcs: 23 },
      { variantId: v.t0at1001, qtyPcs: 5 },
    ]
    const quoted = await quote(shop, lines)
    const q = quoted as Quote & {
      lines: { lineId: string; discountPaise: number; appliedRules: { ruleId: string }[] }[]
    }
    // 23 × ₹10.25 = ₹235.75, 10 % on its own = ₹23.58 and nothing else; the dahi's ₹50.05 takes 2 % = ₹1.00
    expect(q.lines[0]?.appliedRules.map((r) => r.ruleId)).toEqual([alone])
    expect(q.lines[0]?.discountPaise).toBe(2358)
    expect(q.lines[1]?.appliedRules.map((r) => r.ruleId)).toEqual([bill2])
    expect(q.lines[1]?.discountPaise).toBe(100)
    const order = await placeOrder(shop, lines, 'x04')
    expect(order.totalPaise).toBe(quoted.totals.totalPaise)
    const bill = await pack(order.id, 'x04')
    expect(bill.totalPaise).toBe(quoted.totals.totalPaise)
    expect(bill.discountPaise).toBe(2358 + 100)
  })

  // ---------------------------------------------------------------------------------------------------------------
  // DOS-337 (ruling 10): returned pieces are valued on the order line

  it('DOS-337: free pieces follow the batches; a returned piece is worth the same on every batch line; all of them credit exactly what was billed', async () => {
    const shop = await newShop('F04')
    const base = {
      scope: { variantIds: [v.glucose] },
      triggerKind: 'qty',
      triggerUnit: 'pcs',
      applicability: { retailerIds: [shop] },
      validFrom: '2020-01-01',
      validTo: '2099-12-31',
      fundingSource: 'distributor',
    }
    for (const body of [
      {
        id: uuidv7(),
        name: `F04 12 + 1 ${run}`,
        triggerMin: 12,
        rewardKind: 'free_qty',
        rewardValue: 1,
      },
      {
        id: uuidv7(),
        name: `F04 5 % ${run}`,
        triggerMin: 1,
        rewardKind: 'line_pct',
        rewardValue: 500,
      },
    ]) {
      const made = await call(app, owner, 'POST', '/pricing/schemes', {
        idempotencyKey: `f04-${body.name}`,
        ...base,
        ...body,
      })
      expect(made.status, JSON.stringify(made.body)).toBe(200)
    }
    const order = await placeOrder(shop, [{ variantId: v.glucose, qtyPcs: 120 }], 'f04')
    const bill = await pack(order.id, 'f04')
    const lines = bill.lines.filter((l) => l.variantId === v.glucose)
    // the pack took 48, 65 and 17 pieces; the 10 free now follow them in proportion (4, 5, 1), not all on the last
    expect(lines.map((l) => [l.qtyPcs, l.freeQtyPcs])).toEqual([
      [44, 4],
      [60, 5],
      [16, 1],
    ])
    const creditAll = await call<{
      item: { taxablePaise: number; cgstPaise: number; sgstPaise: number }
    }>(app, manager, 'POST', '/credit-notes', {
      idempotencyKey: `f04-cn-all-${run}`,
      id: uuidv7(),
      invoiceId: bill.id,
      reason: 'return_saleable',
      lines: lines.map((l) => ({
        id: uuidv7(),
        invoiceLineId: l.id,
        qtyPcs: l.qtyPcs + l.freeQtyPcs,
      })),
    })
    expect(creditAll.status, JSON.stringify(creditAll.body)).toBe(200)
    expect(creditAll.body.item.taxablePaise).toBe(bill.taxablePaise)
    expect(creditAll.body.item.cgstPaise).toBe(bill.cgstPaise)
    expect(creditAll.body.item.sgstPaise).toBe(bill.sgstPaise)

    // The same order line billed BEFORE the ruling: all ten free on the last batch, each batch's tax its own.
    const oldId = uuidv7()
    const [issued] = await db.select().from(invoices).where(eq(invoices.id, bill.id))
    if (!issued) throw new Error('bill not found')
    const oldShape = [
      { qty: 48, free: 0 },
      { qty: 65, free: 0 },
      { qty: 7, free: 10 },
    ]
    const discounts = shareOut(
      lines.reduce((s, l) => s + l.discountPaise, 0),
      oldShape.map((o) => o.qty),
    )
    const oldLines = oldShape.map((o, i) => {
      const taxable = o.qty * RATE.glucose - (discounts[i] ?? 0)
      const tax = lineTax(taxable, { gstBps: 1200, cessBps: 0 }, false)
      const template = lines[i]
      return {
        id: uuidv7(),
        tenantId,
        invoiceId: oldId,
        lineNo: i + 1,
        orderLineId: template?.orderLineId ?? null,
        variantId: v.glucose,
        description: 'Glucose 55 g',
        hsnCode: hsn.g12,
        qtyPcs: o.qty,
        freeQtyPcs: o.free,
        ratePaise: RATE.glucose,
        discountPaise: discounts[i] ?? 0,
        taxablePaise: taxable,
        gstBps: 1200,
        cgstPaise: tax.cgstPaise,
        sgstPaise: tax.sgstPaise,
        lineTotalPaise: taxable + tax.taxPaise,
        appliedRules: [],
      }
    })
    await db.insert(invoices).values({
      ...issued,
      id: oldId,
      invoiceNo: `OLD-F04/${run}`,
      seriesCode: 'OLD',
      orderId: null,
      upiQrPayload: null,
      taxablePaise: oldLines.reduce((s, l) => s + l.taxablePaise, 0),
    })
    await db.insert(invoiceLines).values(oldLines)
    const groupTaxable = oldLines.reduce((s, l) => s + l.taxablePaise, 0)
    // QA's return: a third of each batch line — 16 of 48, 21 of 65, 2 paid + 2 free of the last
    const third = await call<{
      item: { lines: { invoiceLineId: string; qtyPcs: number; taxablePaise: number }[] }
    }>(app, manager, 'POST', '/credit-notes', {
      idempotencyKey: `f04-cn-third-${run}`,
      id: uuidv7(),
      invoiceId: oldId,
      reason: 'return_saleable',
      lines: [
        { id: uuidv7(), invoiceLineId: oldLines[0]?.id, qtyPcs: 16 },
        { id: uuidv7(), invoiceLineId: oldLines[1]?.id, qtyPcs: 21 },
        { id: uuidv7(), invoiceLineId: oldLines[2]?.id, qtyPcs: 4 },
      ],
    })
    expect(third.status, JSON.stringify(third.body)).toBe(200)
    // one value a piece whichever batch the crew marked (CN/9005 credited ₹7.07 and ₹2.91)
    for (const l of third.body.item.lines)
      expect(Math.abs(l.taxablePaise / l.qtyPcs - groupTaxable / 130)).toBeLessThan(1)
    // the rest of every piece: all together exactly what was billed, never more
    const rest = await call<{ item: { taxablePaise: number; cgstPaise: number } }>(
      app,
      manager,
      'POST',
      '/credit-notes',
      {
        idempotencyKey: `f04-cn-rest-${run}`,
        id: uuidv7(),
        invoiceId: oldId,
        reason: 'return_saleable',
        lines: [
          { id: uuidv7(), invoiceLineId: oldLines[0]?.id, qtyPcs: 32 },
          { id: uuidv7(), invoiceLineId: oldLines[1]?.id, qtyPcs: 44 },
          { id: uuidv7(), invoiceLineId: oldLines[2]?.id, qtyPcs: 13 },
        ],
      },
    )
    expect(rest.status, JSON.stringify(rest.body)).toBe(200)
    const thirdTaxable = third.body.item.lines.reduce((s, l) => s + l.taxablePaise, 0)
    expect(thirdTaxable + rest.body.item.taxablePaise).toBe(groupTaxable)
    const billedCgst = oldLines.reduce((s, l) => s + l.cgstPaise, 0)
    const thirdCgst = (
      (
        await db.execute(sql`select coalesce(sum(cgst_paise), 0)::bigint as c from credit_notes
                              where invoice_id = ${oldId}`)
      ).rows[0] as { c: string }
    ).c
    expect(Number(thirdCgst)).toBe(billedCgst)
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
    ).toBe(2)
  })
})
