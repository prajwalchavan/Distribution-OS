import { and, eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import type {
  CollectionsRegisterOutput,
  DailyRepStatsOutput,
  DailyTenantStatsOutput,
  FillRateOutput,
  Growth,
  LapsedRetailersOutput,
  MultiSeries,
  OwnerDashboard,
  Ranking,
  RepDashboard,
  RepProductivityOutput,
  ReportExportJob,
  RetailerBehaviour,
  RetailerSeries,
  Series,
  StockValueOutput,
} from '@dos/contracts'

type DailyTenant = z.infer<typeof DailyTenantStatsOutput>
type DailyRep = z.infer<typeof DailyRepStatsOutput>
type RepProductivity = z.infer<typeof RepProductivityOutput>
type Lapsed = z.infer<typeof LapsedRetailersOutput>
type StockValue = z.infer<typeof StockValueOutput>
type FillRate = z.infer<typeof FillRateOutput>
type Collections = z.infer<typeof CollectionsRegisterOutput>
import { businessDate, uuidv7 } from '@dos/domain'
import {
  beatAssignments,
  beats,
  bootstrapTenant,
  brands,
  createDb,
  createPool,
  dailyOwnerStats,
  dailyRepStats,
  dailyRetailerStats,
  dailyTenantStats,
  invoiceLines,
  invoices,
  locations,
  manufacturers,
  memberships,
  ownerSummary,
  productVariants,
  products,
  receipts,
  retailerBehaviour,
  retailers,
  salesOrderLines,
  salesOrders,
  schemes,
  stockBalances,
  stockLots,
  supplierInvoiceLines,
  supplierInvoices,
  suppliers,
  tenantProductCosts,
  tenants,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { rollupTenantDay } from './rollup.js'
import { ReportingModule } from './index.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const plusDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

const monthOf = (iso: string): string => `${iso.slice(0, 7)}-01`

describeDb('reporting (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const tenantId = uuidv7()
  const otherTenantId = uuidv7()

  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const rep1Id = uuidv7()
  const rep2Id = uuidv7()
  const storeId = uuidv7()
  const crewId = uuidv7()
  const shopUserId = uuidv7()
  const otherOwnerId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const rep1: Actor = { tenantId, actorId: rep1Id, role: 'salesperson' }
  const store: Actor = { tenantId, actorId: storeId, role: 'warehouse' }
  const crew: Actor = { tenantId, actorId: crewId, role: 'delivery' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const stranger: Actor = { tenantId: otherTenantId, actorId: otherOwnerId, role: 'owner' }

  const beatA = uuidv7()
  const beatB = uuidv7()
  const shopA1 = uuidv7()
  const shopA2 = uuidv7()
  const shopB1 = uuidv7()
  const brandId = uuidv7()
  const variantId = uuidv7()
  /** Ids ascend with creation, so "worst served first" deliberately disagrees with id order here. */
  const variantBigShortId = uuidv7()
  const variantSmallShortId = uuidv7()
  const lotId = uuidv7()
  const schemeCompanyId = uuidv7()
  const schemeDistributorId = uuidv7()
  const supplierId = uuidv7()
  let godown = ''

  const today = businessDate().date
  /** A ten-day window ending yesterday: every day has a rollup row, so a gap is a bug, not a Sunday. */
  const to = plusDays(today, -1)
  const from = plusDays(to, -9)

  let app: NestFastifyApplication

  const ctxFor = (
    role: TenantContext['actorRole'],
    actorId: string,
    tid = tenantId,
  ): TenantContext => ({ tenantId: tid, actorId, actorRole: role })
  const as = <T>(ctx: TenantContext, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))

  /** A day's invoiced paise: a deliberate ramp, so a bucket's sum is checkable by hand. */
  const invoicedOn = (i: number): number => 100_000 + i * 10_000

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `rep-${run}`, legalName: 'Reporting test', stateCode: '27' },
      { id: otherTenantId, slug: `rep-o-${run}`, legalName: 'Other distributor', stateCode: '27' },
    ])
    await db.insert(users).values([
      { id: ownerId, phone: `+91916${run}1`, name: 'Owner' },
      { id: managerId, phone: `+91916${run}2`, name: 'Manager' },
      { id: accountantId, phone: `+91916${run}3`, name: 'Accountant' },
      { id: rep1Id, phone: `+91916${run}4`, name: 'Rep One' },
      { id: rep2Id, phone: `+91916${run}5`, name: 'Rep Two' },
      { id: storeId, phone: `+91916${run}6`, name: 'Store' },
      { id: crewId, phone: `+91916${run}7`, name: 'Crew' },
      { id: shopUserId, phone: `+91916${run}8`, name: 'Shop' },
      { id: otherOwnerId, phone: `+91916${run}9`, name: 'Other owner' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: rep1Id, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: rep2Id, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: storeId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: crewId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId: otherTenantId, userId: otherOwnerId, role: 'owner' },
    ])
    await bootstrapTenant(db, tenantId)
    await bootstrapTenant(db, otherTenantId)

    const manufacturerId = uuidv7()
    const productId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker rep ${run}` })
    await db.insert(brands).values({ id: brandId, manufacturerId, name: `Brand R ${run}` })
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, brandId, name: 'Cola', category: 'Beverages' })
    await db.insert(productVariants).values([
      {
        id: variantId,
        productId,
        name: 'Cola 750 ml',
        netQty: 750,
        netUnit: 'ml',
        defaultCaseSize: 24,
        hsnCode: '2202',
      },
      // Two more served variants so the fill-rate register has three rows whose WORST-FIRST order is
      // not their id order — the shape that made a keyset cursor drop rows (see the paging case).
      {
        id: variantBigShortId,
        productId,
        name: 'Cola 1.25 l',
        netQty: 1_250,
        netUnit: 'ml',
        defaultCaseSize: 12,
        hsnCode: '2202',
      },
      {
        id: variantSmallShortId,
        productId,
        name: 'Cola 300 ml',
        netQty: 300,
        netUnit: 'ml',
        defaultCaseSize: 30,
        hsnCode: '2202',
      },
    ])

    await db.insert(beats).values([
      { id: beatA, tenantId, name: `Beat A ${run}` },
      { id: beatB, tenantId, name: `Beat B ${run}` },
    ])
    await db.insert(retailers).values([
      {
        id: shopA1,
        tenantId,
        code: `A1-${run}`,
        name: `Shop A1 ${run}`,
        phone: `+91915${run}1`,
        stateCode: '27',
        beatId: beatA,
      },
      {
        id: shopA2,
        tenantId,
        code: `A2-${run}`,
        name: `Shop A2 ${run}`,
        phone: `+91915${run}2`,
        stateCode: '27',
        beatId: beatA,
      },
      {
        id: shopB1,
        tenantId,
        code: `B1-${run}`,
        name: `Shop B1 ${run}`,
        phone: `+91915${run}3`,
        stateCode: '27',
        beatId: beatB,
      },
    ])
    // Rep one works beat A for the first half of the window and beat B for the second: a mid-window
    // reassignment must show under BOTH beats, on their own days, never doubled (§5 spec 4).
    await db.insert(beatAssignments).values([
      {
        id: uuidv7(),
        tenantId,
        beatId: beatA,
        userId: rep1Id,
        validFrom: plusDays(from, -30),
        validTo: plusDays(from, 4),
      },
      { id: uuidv7(), tenantId, beatId: beatB, userId: rep1Id, validFrom: plusDays(from, 5) },
      { id: uuidv7(), tenantId, beatId: beatB, userId: rep2Id, validFrom: plusDays(from, -30) },
    ])

    // --- the rollup rows every series and dashboard reads -----------------------------------------
    const tenantRows = []
    const ownerRows = []
    const repRows = []
    const retailerRows = []
    for (let i = 0; i < 10; i++) {
      const day = plusDays(from, i)
      const invoiced = invoicedOn(i)
      tenantRows.push({
        tenantId,
        day,
        ordersCount: 2 + i,
        invoicedPaise: invoiced,
        collectedPaise: 50_000,
        outstandingPaise: 900_000 + i * 1_000,
        overduePaise: 100_000,
        deliveredStops: 8,
        partialStops: 1,
        failedStops: 1,
        onTimeStops: 6,
        podStops: 9,
        orderedPcs: 100,
        pickedPcs: 90,
        activeRetailers: 3,
        byBrand: { [brandId]: { invoicedPaise: invoiced, invoiceCount: 1 } },
        byCategory: { Beverages: { invoicedPaise: invoiced, invoiceCount: 1 } },
        byBeat: {
          [beatA]: { invoicedPaise: Math.round(invoiced * 0.6), invoiceCount: 1 },
          [beatB]: { invoicedPaise: invoiced - Math.round(invoiced * 0.6), invoiceCount: 1 },
        },
        byPaymentMode: { cash: 30_000, upi: 20_000 },
      })
      ownerRows.push({
        tenantId,
        day,
        netSalesPaise: invoiced,
        cogsPaise: Math.round(invoiced * 0.8),
        grossMarginPaise: invoiced - Math.round(invoiced * 0.8),
        stockValuePaise: 5_000_000,
        nearExpiryValuePaise: 100_000,
        schemeSpendCompanyPaise: 1_000,
        schemeSpendDistributorPaise: 500,
        byBrand: {
          [brandId]: {
            cogsPaise: Math.round(invoiced * 0.8),
            grossMarginPaise: invoiced - Math.round(invoiced * 0.8),
          },
        },
      })
      repRows.push(
        {
          tenantId,
          userId: rep1Id,
          day,
          visits: 10,
          productiveVisits: 4,
          ordersCount: 4,
          orderValuePaise: 60_000,
          linesSold: 8,
          collectedPaise: 0,
        },
        {
          tenantId,
          userId: rep2Id,
          day,
          visits: 5,
          productiveVisits: 0,
          ordersCount: 0,
          orderValuePaise: 0,
          linesSold: 0,
          collectedPaise: 0,
        },
      )
      retailerRows.push(
        {
          tenantId,
          retailerId: shopA1,
          day,
          ordersCount: 1,
          invoicedPaise: Math.round(invoiced * 0.7),
          collectedPaise: 1_000,
          linesSold: 3,
        },
        {
          tenantId,
          retailerId: shopB1,
          day,
          ordersCount: 1,
          invoicedPaise: invoiced - Math.round(invoiced * 0.7),
          collectedPaise: 500,
          linesSold: 2,
        },
      )
    }
    // Today's rows too, for the dashboards (which always read the current business date).
    const plainDay = (
      day: string,
      invoicedPaise: number,
      collectedPaise: number,
      ordersCount: number,
    ) => ({
      tenantId,
      day,
      ordersCount,
      invoicedPaise,
      collectedPaise,
      outstandingPaise: 0,
      overduePaise: 0,
      deliveredStops: 0,
      partialStops: 0,
      failedStops: 0,
      onTimeStops: 0,
      podStops: 0,
      orderedPcs: 0,
      pickedPcs: 0,
      activeRetailers: 0,
      byBrand: {},
      byCategory: {},
      byBeat: {},
      byPaymentMode: {},
    })
    tenantRows.push(plainDay(today, 777_000, 55_000, 7))
    repRows.push({
      tenantId,
      userId: rep1Id,
      day: today,
      visits: 12,
      productiveVisits: 6,
      ordersCount: 6,
      orderValuePaise: 90_000,
      linesSold: 11,
      collectedPaise: 0,
    })
    // Month rows one year back and one month back, for MoM and YoY growth at a month boundary.
    const thisMonth = monthOf(today)
    const lastMonth = monthOf(plusDays(thisMonth, -1))
    const lastYearThisMonth = `${String(Number(thisMonth.slice(0, 4)) - 1)}${thisMonth.slice(4)}`
    for (const [day, paise] of [
      [plusDays(lastMonth, 3), 400_000],
      [plusDays(lastYearThisMonth, 3), 250_000],
    ] as [string, number][]) {
      tenantRows.push(plainDay(day, paise, 0, 1))
    }
    await db.insert(dailyTenantStats).values(tenantRows)
    await db.insert(dailyOwnerStats).values(ownerRows)
    await db.insert(dailyRepStats).values(repRows)
    await db.insert(dailyRetailerStats).values(retailerRows)
    await db.insert(retailerBehaviour).values([
      {
        tenantId,
        retailerId: shopA1,
        ordersLast30: 6,
        valueLast30Paise: 500_000,
        unitsLast30: 40,
        lapsedRisk: 10,
        usualBasket: [{ variantId, avgPcs: 24 }],
      },
      { tenantId, retailerId: shopB1, ordersLast30: 0, lapsedRisk: 95 },
    ])
    await db.insert(ownerSummary).values({
      tenantId,
      todayInvoicedPaise: 777_000,
      todayCollectedPaise: 55_000,
      totalOutstandingPaise: 1_200_000,
      overduePaise: 300_000,
      mtdSalesPaise: 2_000_000,
      mtdGrossMarginPaise: 300_000,
      stockValuePaise: 5_000_000,
      nearExpiryValuePaise: 100_000,
      pendingApprovals: 2,
      activeTrips: 1,
      detail: { cashInTransitPaise: 12_500, ageingB0_7: 400_000, ageingB90plus: 200_000 },
    })

    // --- live rows the registers read (they never go through the rollup) --------------------------
    const [loc] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.kind, 'warehouse')))
      .limit(1)
    godown = loc?.id ?? ''
    await db.insert(stockLots).values({
      id: lotId,
      tenantId,
      variantId,
      batchNo: `B-${run}`,
      mrpPaise: 4_000,
      expiryDate: plusDays(today, 30),
    })
    await db
      .insert(stockBalances)
      .values({ tenantId, lotId, locationId: godown, onHand: 100, reserved: 0 })
    await db.insert(tenantProductCosts).values({
      id: uuidv7(),
      tenantId,
      variantId,
      purchaseRatePaise: 2_000,
      landedCostPaise: 2_100,
    })

    const invoiceId = uuidv7()
    await db.insert(invoices).values({
      id: invoiceId,
      tenantId,
      invoiceNo: `INV/${run}/1`,
      seriesCode: 'INV',
      fy: '2026-27',
      invoiceDate: to,
      retailerId: shopA1,
      state: 'issued',
      buyerName: `Shop A1 ${run}`,
      placeOfSupplyState: '27',
      subtotalPaise: 24_000,
      taxablePaise: 24_000,
      totalPaise: 26_880,
    })
    // Two schemes on the same bill: one the brand pays for, one the distributor eats. The register
    // must never add them up into one number (docs/plans/reporting.md §4 rule 8).
    await db.insert(schemes).values([
      {
        id: schemeCompanyId,
        tenantId,
        name: `Brand-funded 12+1 ${run}`,
        brandId,
        scope: { brandIds: [brandId] },
        triggerKind: 'qty',
        triggerMin: 12,
        triggerUnit: 'pcs',
        rewardKind: 'free_qty',
        rewardValue: 1,
        validFrom: from,
        validTo: today,
        fundingSource: 'company',
      },
      {
        id: schemeDistributorId,
        tenantId,
        name: `Our own 2% ${run}`,
        brandId,
        scope: { brandIds: [brandId] },
        triggerKind: 'value',
        triggerMin: 500_000,
        triggerUnit: 'inr',
        rewardKind: 'order_pct',
        rewardValue: 200,
        validFrom: from,
        validTo: today,
        fundingSource: 'distributor',
      },
    ])
    await db.insert(invoiceLines).values({
      id: uuidv7(),
      tenantId,
      invoiceId,
      lineNo: 1,
      variantId,
      description: 'Cola 750 ml',
      hsnCode: '2202',
      qtyPcs: 24,
      ratePaise: 1_000,
      taxablePaise: 24_000,
      gstBps: 1_200,
      cgstPaise: 1_440,
      sgstPaise: 1_440,
      lineTotalPaise: 26_880,
      appliedRules: [
        {
          kind: 'scheme' as const,
          ruleId: schemeCompanyId,
          version: 1,
          rewardKind: 'free_qty',
          amountPaise: 1_200,
          freeQty: 2,
        },
        {
          kind: 'scheme' as const,
          ruleId: schemeDistributorId,
          version: 1,
          rewardKind: 'order_pct',
          amountPaise: 800,
        },
      ],
    })
    // A cancelled bill was reversed: its scheme lines are not spend, and must reach no total.
    const cancelledInvoiceId = uuidv7()
    await db.insert(invoices).values({
      id: cancelledInvoiceId,
      tenantId,
      invoiceNo: `INV/${run}/2`,
      seriesCode: 'INV',
      fy: '2026-27',
      invoiceDate: to,
      retailerId: shopA1,
      state: 'cancelled',
      buyerName: `Shop A1 ${run}`,
      placeOfSupplyState: '27',
      subtotalPaise: 90_000,
      taxablePaise: 90_000,
      totalPaise: 100_800,
    })
    await db.insert(invoiceLines).values({
      id: uuidv7(),
      tenantId,
      invoiceId: cancelledInvoiceId,
      lineNo: 1,
      variantId,
      description: 'Cola 750 ml',
      hsnCode: '2202',
      qtyPcs: 90,
      ratePaise: 1_000,
      taxablePaise: 90_000,
      gstBps: 1_200,
      cgstPaise: 5_400,
      sgstPaise: 5_400,
      lineTotalPaise: 100_800,
      appliedRules: [
        {
          kind: 'scheme' as const,
          ruleId: schemeDistributorId,
          version: 1,
          rewardKind: 'order_pct',
          amountPaise: 50_000,
          freeQty: 9,
        },
      ],
    })

    // --- the inward half of the filing: only a RECEIVED supplier bill is a liability ---------------
    await db.insert(suppliers).values({
      id: supplierId,
      tenantId,
      name: `Depot ${run}`,
      gstin: '27AAAAA0000A1Z5',
      stateCode: '27',
    })
    const receivedInvoiceId = uuidv7()
    const supplierInvoiceRows = (
      [
        [receivedInvoiceId, 'received', 1],
        [uuidv7(), 'extracted', 2],
        [uuidv7(), 'in_review', 3],
        [uuidv7(), 'disputed', 4],
        [uuidv7(), 'cancelled', 5],
      ] as const
    ).map(([id, status, i]) => ({
      id,
      tenantId,
      supplierId,
      source: 'manual' as const,
      status,
      invoiceNo: `SUP/${run}/${String(i)}`,
      invoiceDate: to,
      supplierGstin: '27AAAAA0000A1Z5',
      placeOfSupplyState: '27',
      subtotalPaise: 50_000,
      cgstPaise: 3_000,
      sgstPaise: 3_000,
      totalPaise: 56_000,
    }))
    await db.insert(supplierInvoices).values(supplierInvoiceRows)
    await db.insert(supplierInvoiceLines).values(
      supplierInvoiceRows.map((row) => ({
        id: uuidv7(),
        tenantId,
        supplierInvoiceId: row.id,
        lineNo: 1,
        description: 'Cola 750 ml',
        variantId,
        hsnCode: '2202',
        printedQty: 50,
        qtyPcs: 50,
        ratePaise: 1_000,
        gstBps: 1_200,
        taxablePaise: 50_000,
        taxPaise: 6_000,
        lineTotalPaise: 56_000,
      })),
    )
    await db.insert(receipts).values([
      {
        id: uuidv7(),
        tenantId,
        retailerId: shopA1,
        mode: 'cash',
        amountPaise: 10_000,
        receivedAt: new Date(`${to}T06:00:00.000Z`),
        receivedBy: crewId,
        idempotencyKey: `rcpt-cash-${run}`,
      },
      {
        id: uuidv7(),
        tenantId,
        retailerId: shopA1,
        mode: 'upi',
        amountPaise: 5_000,
        receivedAt: new Date(`${to}T07:00:00.000Z`),
        receivedBy: managerId,
        idempotencyKey: `rcpt-upi-${run}`,
      },
      // A bounced cheque is not money that arrived: it must not appear in the register.
      {
        id: uuidv7(),
        tenantId,
        retailerId: shopA1,
        mode: 'cheque',
        amountPaise: 90_000,
        status: 'bounced',
        receivedAt: new Date(`${to}T08:00:00.000Z`),
        receivedBy: managerId,
        idempotencyKey: `rcpt-bounced-${run}`,
      },
    ])

    const orderId = uuidv7()
    await db.insert(salesOrders).values({
      id: orderId,
      tenantId,
      orderNo: `SO-${run}`,
      retailerId: shopA1,
      state: 'packed',
      source: 'salesperson',
      createdBy: rep1Id,
      salespersonId: rep1Id,
      paymentTerms: 'POST_FULFILLMENT',
      fulfilFromLocationId: godown,
      totalPaise: 26_880,
      createdAt: new Date(`${to}T05:00:00.000Z`),
    })
    // Three lines, each picked at exactly 80%, so the register's total fill rate is 0.8 while the
    // per-variant SHORTFALLS (48 · 24 · 12) rank the rows in the reverse of their id order.
    await db.insert(salesOrderLines).values([
      {
        id: uuidv7(),
        tenantId,
        orderId,
        lineNo: 1,
        variantId,
        enteredQty: 5,
        enteredUnit: 'case',
        packSizeAtEntry: 24,
        qtyPcs: 120,
        pickedQtyPcs: 96,
        listRatePaise: 1_000,
        ratePaise: 1_000,
        gstBps: 1_200,
      },
      {
        id: uuidv7(),
        tenantId,
        orderId,
        lineNo: 2,
        variantId: variantBigShortId,
        enteredQty: 20,
        enteredUnit: 'case',
        packSizeAtEntry: 12,
        qtyPcs: 240,
        pickedQtyPcs: 192,
        listRatePaise: 1_500,
        ratePaise: 1_500,
        gstBps: 1_200,
      },
      {
        id: uuidv7(),
        tenantId,
        orderId,
        lineNo: 3,
        variantId: variantSmallShortId,
        enteredQty: 2,
        enteredUnit: 'case',
        packSizeAtEntry: 30,
        qtyPcs: 60,
        pickedQtyPcs: 48,
        listRatePaise: 500,
        ratePaise: 500,
        gstBps: 1_200,
      },
    ])

    app = await bootTestApp([ReportingModule])
  })

  afterAll(async () => {
    await app?.close()
    await pool.end()
  })

  // ===============================================================================================
  // the graphs
  // ===============================================================================================

  it('a day series covers every bucket of the range with no gaps and sums to the register total', async () => {
    const series = await call<Series>(app, owner, 'GET', '/reporting/series', {
      metric: 'invoiced',
      grain: 'day',
      from,
      to,
    })
    expect(series.status).toBe(200)
    expect(series.body.points).toHaveLength(10)
    expect(series.body.points.map((p) => p.bucket)).toEqual(
      Array.from({ length: 10 }, (_, i) => plusDays(from, i)),
    )
    const expected = Array.from({ length: 10 }, (_, i) => invoicedOn(i)).reduce((a, b) => a + b, 0)
    expect(series.body.points.reduce((s, p) => s + p.value, 0)).toBe(expected)

    const register = await call<DailyTenant>(
      app,
      owner,
      'GET',
      '/reporting/registers/daily-sales',
      { from, to, limit: 200 },
    )
    expect(register.status).toBe(200)
    expect(register.body.totals.invoicedPaise).toBe(expected)
    expect(register.body.items).toHaveLength(10)
  })

  it('a week series has no gaps and sums to the same money as the day series', async () => {
    const day = await call<Series>(app, owner, 'GET', '/reporting/series', {
      metric: 'invoiced',
      grain: 'day',
      from,
      to,
    })
    const week = await call<Series>(app, owner, 'GET', '/reporting/series', {
      metric: 'invoiced',
      grain: 'week',
      from,
      to,
    })
    expect(week.status).toBe(200)
    // Every bucket is a Monday, contiguous, and nothing is lost between the grains.
    for (const point of week.body.points)
      expect(new Date(`${point.bucket}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(week.body.points.reduce((s, p) => s + p.value, 0)).toBe(
      day.body.points.reduce((s, p) => s + p.value, 0),
    )
  })

  it('a grouped series stacks to the ungrouped total and folds the rest into other', async () => {
    const grouped = await call<Series>(app, owner, 'GET', '/reporting/series', {
      metric: 'invoiced',
      grain: 'day',
      from,
      to,
      groupBy: 'beat',
    })
    expect(grouped.status).toBe(200)
    expect(grouped.body.groupBy).toBe('beat')
    const total = grouped.body.points.reduce((s, p) => s + p.value, 0)
    const stacked = grouped.body.groups.flatMap((g) => g.points).reduce((s, p) => s + p.value, 0)
    expect(stacked).toBe(total)
    for (const group of grouped.body.groups) expect(group.points).toHaveLength(10)
  })

  it('refuses a metric the rollup carries no mix for', async () => {
    const bad = await call<{ data?: { code?: string } }>(app, owner, 'GET', '/reporting/series', {
      metric: 'outstanding',
      grain: 'day',
      from,
      to,
      groupBy: 'brand',
    })
    expect(bad.status).toBe(400)
  })

  it('caps the window in points before any handler runs', async () => {
    const wide = await call(app, owner, 'GET', '/reporting/series', {
      metric: 'invoiced',
      grain: 'day',
      from: plusDays(to, -200),
      to,
    })
    expect(wide.status).toBe(400)
  })

  it('outstanding is the end of the bucket, never the sum of its days', async () => {
    const multi = await call<MultiSeries>(app, owner, 'GET', '/reporting/series/outstanding', {
      grain: 'week',
      from,
      to,
    })
    expect(multi.status).toBe(200)
    const outstanding = multi.body.series.find((s) => s.metric === 'outstanding')
    expect(outstanding).toBeDefined()
    // Every value is one day's closing figure, so none can exceed the largest day in the window.
    for (const point of outstanding?.points ?? []) expect(point.value).toBeLessThanOrEqual(909_000)
  })

  it('month-over-month and year-over-year growth are right at a month boundary', async () => {
    const thisMonth = monthOf(today)
    const lastMonth = monthOf(plusDays(thisMonth, -1))
    const mom = await call<Growth>(app, owner, 'GET', '/reporting/series/growth', {
      metric: 'invoiced',
      basis: 'mom',
      from: lastMonth,
      to: today,
    })
    expect(mom.status).toBe(200)
    expect(mom.body.points.map((p) => p.bucket)).toEqual([lastMonth, thisMonth])
    const base = mom.body.points.find((p) => p.bucket === lastMonth)
    const current = mom.body.points.find((p) => p.bucket === thisMonth)
    // The month's base IS the previous month's own value — the boundary, not an approximation.
    expect(current?.previous).toBe(base?.value)
    expect(current?.growthBps).toBe(
      Math.round((((current?.value ?? 0) - (base?.value ?? 0)) / (base?.value ?? 1)) * 10_000),
    )

    const yoy = await call<Growth>(app, owner, 'GET', '/reporting/series/growth', {
      metric: 'invoiced',
      basis: 'yoy',
      from: thisMonth,
      to: today,
    })
    expect(yoy.status).toBe(200)
    // The same month one year back holds exactly one seeded row.
    expect(yoy.body.points.find((p) => p.bucket === thisMonth)?.previous).toBe(250_000)

    // A month whose base month has no rollup row grew from NOTHING, not from zero.
    const empty = await call<Growth>(app, owner, 'GET', '/reporting/series/growth', {
      metric: 'invoiced',
      basis: 'yoy',
      from: lastMonth,
      to: lastMonth,
    })
    expect(empty.body.points[0]?.previous).toBeNull()
    expect(empty.body.points[0]?.growthBps).toBeNull()
  })

  it('a ratio is recomputed from the summed numerator and denominator', async () => {
    const fill = await call<MultiSeries>(app, owner, 'GET', '/reporting/series/fill-rate', {
      grain: 'week',
      from,
      to,
    })
    expect(fill.status).toBe(200)
    // 90 picked of 100 ordered every day → 0.9 at any grain, never an average of averages.
    for (const point of fill.body.series[0]?.points ?? [])
      if (point.value > 0) expect(point.value).toBeCloseTo(0.9, 6)
  })

  it('ranks the top shops with a share of the whole window', async () => {
    const ranking = await call<Ranking>(app, owner, 'GET', '/reporting/series/top-shops', {
      metric: 'invoiced',
      from,
      to,
      top: 10,
    })
    expect(ranking.status).toBe(200)
    expect(ranking.body.items[0]?.key).toBe(shopA1)
    expect(ranking.body.items[0]?.beatId).toBe(beatA)
    expect(ranking.body.items.reduce((s, i) => s + i.value, 0)).toBe(ranking.body.totalValue)
    expect(ranking.body.items[0]?.shareBps).toBeGreaterThan(5_000)
  })

  // ===============================================================================================
  // dashboards and the forced own scope
  // ===============================================================================================

  it('the owner dashboard paints from one read and never 404s for a fresh tenant', async () => {
    const mine = await call<OwnerDashboard>(app, owner, 'GET', '/reporting/dashboard/owner')
    expect(mine.status).toBe(200)
    expect(mine.body.todayInvoicedPaise).toBe(777_000)
    expect(mine.body.cashInTransitPaise).toBe(12_500)
    expect(mine.body.ageing.b0_7).toBe(400_000)
    // DOS-001: the 90+ rung reads detail.ageingB90plus
    expect(mine.body.ageing.b90plus).toBe(200_000)
    expect(mine.body.last7Days.length).toBeGreaterThan(0)

    const fresh = await call<OwnerDashboard>(app, stranger, 'GET', '/reporting/dashboard/owner')
    expect(fresh.status).toBe(200)
    expect(fresh.body.totalOutstandingPaise).toBe(0)
    expect(fresh.body.mtdSalesPaise).toBe(0)
  })

  it('a salesperson asking for another rep is silently scoped to itself', async () => {
    const asked = await call<RepDashboard>(app, rep1, 'GET', '/reporting/dashboard/rep', {
      userId: rep2Id,
    })
    expect(asked.status).toBe(200)
    expect(asked.body.userId).toBe(rep1Id)
    expect(asked.body.visits).toBe(12)
    expect(asked.body.strikeRate).toBeCloseTo(0.5, 6)

    const desk = await call<RepDashboard>(app, manager, 'GET', '/reporting/dashboard/rep', {
      userId: rep2Id,
    })
    expect(desk.status).toBe(200)
    expect(desk.body.userId).toBe(rep2Id)

    // The back office must name a rep; "everyone's day" is not a thing.
    const unnamed = await call(app, manager, 'GET', '/reporting/dashboard/rep')
    expect(unnamed.status).toBe(400)
  })

  it('a rep list is scoped to the caller and the desk sees every rep', async () => {
    const mine = await call<DailyRep>(app, rep1, 'GET', '/reporting/registers/rep-daily', {
      from,
      to,
      userId: rep2Id,
      limit: 200,
    })
    expect(mine.status).toBe(200)
    expect(new Set(mine.body.items.map((i) => i.userId))).toEqual(new Set([rep1Id]))
    expect(mine.body.totals.strikeRate).toBeCloseTo(0.4, 6)

    const desk = await call<DailyRep>(app, accountant, 'GET', '/reporting/registers/rep-daily', {
      from,
      to,
      limit: 200,
    })
    expect(new Set(desk.body.items.map((i) => i.userId))).toEqual(new Set([rep1Id, rep2Id]))
    // visits = 0 for no rep here, but the identity must hold with no NaN anywhere.
    expect(Number.isFinite(desk.body.totals.strikeRate)).toBe(true)
  })

  it('rep productivity splits a mid-window beat reassignment across both beats', async () => {
    const out = await call<RepProductivity>(
      app,
      owner,
      'GET',
      '/reporting/registers/rep-productivity',
      { from, to, userId: rep1Id, limit: 200 },
    )
    expect(out.status).toBe(200)
    const beatsSeen = out.body.items.map((i) => i.beatId)
    expect(new Set(beatsSeen)).toEqual(new Set([beatA, beatB]))
    // Ten days of ten visits, split between the two beats and counted once.
    expect(out.body.items.reduce((s, i) => s + i.visits, 0)).toBe(100)
    expect(out.body.totals.visits).toBe(100)
  })

  it('lapsed shops come back worst first and a rep sees only its own beats', async () => {
    const desk = await call<Lapsed>(app, owner, 'GET', '/reporting/retailers/lapsed', {
      minRisk: 0,
      limit: 50,
    })
    expect(desk.status).toBe(200)
    expect(desk.body.items[0]?.retailerId).toBe(shopB1)
    expect(desk.body.items.map((i) => i.retailerId)).toContain(shopA1)

    // Rep one is on beat B today, so beat A's shop is not on its list.
    const mine = await call<Lapsed>(app, rep1, 'GET', '/reporting/retailers/lapsed', {
      minRisk: 0,
      limit: 50,
    })
    expect(mine.body.items.map((i) => i.retailerId)).toEqual([shopB1])
  })

  it("a shop's behaviour is 404 until the rollup has written it, and its series has no gaps", async () => {
    const known = await call<{ item: RetailerBehaviour }>(
      app,
      owner,
      'GET',
      `/reporting/retailers/${shopA1}/behaviour`,
    )
    expect(known.status).toBe(200)
    expect(known.body.item.usualBasket[0]?.variantId).toBe(variantId)

    const unknown = await call(app, owner, 'GET', `/reporting/retailers/${shopA2}/behaviour`)
    expect(unknown.status).toBe(404)

    const series = await call<RetailerSeries>(
      app,
      owner,
      'GET',
      `/reporting/retailers/${shopA1}/series`,
      { grain: 'week', buckets: 4 },
    )
    expect(series.status).toBe(200)
    expect(series.body.points).toHaveLength(4)
  })

  // ===============================================================================================
  // the live registers
  // ===============================================================================================

  it('stock value prices pieces at landed cost and is refused to the field', async () => {
    const back = await call<StockValue>(app, owner, 'GET', '/reporting/registers/stock-value', {
      nearExpiryDays: 90,
      limit: 50,
    })
    expect(back.status).toBe(200)
    const row = back.body.items.find((i) => i.variantId === variantId)
    expect(row?.avgCostPaise).toBe(2_100)
    expect(row?.valuePaise).toBe(100 * 2_100)
    expect(row?.nearExpiryValuePaise).toBe(100 * 2_100)

    for (const actor of [rep1, store, crew, shop]) {
      const refused = await call(app, actor, 'GET', '/reporting/registers/stock-value', {
        nearExpiryDays: 90,
      })
      expect(refused.status).toBe(403)
    }
  })

  it('the warehouse may read fill rate and nothing else back-office', async () => {
    const fill = await call<FillRate>(app, store, 'GET', '/reporting/registers/fill-rate', {
      from,
      to,
      limit: 50,
    })
    expect(fill.status).toBe(200)
    const row = fill.body.items.find((i) => i.variantId === variantId)
    expect(row?.orderedPcs).toBe(120)
    expect(row?.pickedPcs).toBe(96)
    expect(row?.shortPcs).toBe(24)
    expect(fill.body.totals.fillRate).toBeCloseTo(0.8, 6)

    for (const path of [
      '/reporting/registers/scheme-spend',
      '/reporting/registers/gst-sales',
      '/reporting/registers/collections',
    ]) {
      const refused = await call(app, store, 'GET', path, { from, to })
      expect(refused.status).toBe(403)
    }
  })

  /**
   * The gate found (2026-09-05) that three registers ordered for the READER — worst fill rate first,
   * biggest scheme spend first, trips by date — paged with a keyset cursor on an id the list is not
   * sorted by, so scrolling silently dropped rows: on the demo data fill rate answered 29 variants in
   * one page and 5 when walked, scheme spend 72 against 11. The CSV export walks the same cursor, so
   * the file was short too. Every paged register is walked here, one row at a time.
   */
  it('every register pages one row at a time without losing or repeating a row', async () => {
    const registers: {
      path: string
      query: Record<string, string | number>
      key: string
      /** The fixture guarantees at least this many rows, so the walk is never vacuously true. */
      atLeast: number
    }[] = [
      // Three variants short-picked by 48 / 24 / 12 pieces: worst first, which is NOT id order.
      { path: '/reporting/registers/fill-rate', query: { from, to }, key: 'variantId', atLeast: 3 },
      { path: '/reporting/registers/daily-sales', query: { from, to }, key: 'day', atLeast: 10 },
      { path: '/reporting/registers/rep-daily', query: { from, to }, key: 'day', atLeast: 10 },
      {
        path: '/reporting/registers/rep-productivity',
        query: { from, to },
        key: 'userId',
        atLeast: 2,
      },
      // By collector: the crew and the manager each took money on the same day.
      {
        path: '/reporting/registers/collections',
        query: { from, to, groupBy: 'collector' },
        key: 'bucket',
        atLeast: 2,
      },
      {
        path: '/reporting/registers/stock-value',
        query: { nearExpiryDays: 90 },
        key: 'variantId',
        atLeast: 1,
      },
      { path: '/reporting/retailers/lapsed', query: { minRisk: 0 }, key: 'retailerId', atLeast: 2 },
    ]
    for (const register of registers) {
      const whole = await call<{ items: Record<string, string>[] }>(
        app,
        owner,
        'GET',
        register.path,
        { ...register.query, limit: 200 },
      )
      expect(whole.status, register.path).toBe(200)
      const expected = whole.body.items.map((i) => i[register.key])
      expect(expected.length, `${register.path} has rows to page`).toBeGreaterThanOrEqual(
        register.atLeast,
      )

      const walked: (string | undefined)[] = []
      let cursor: string | null = null
      for (let page = 0; page < expected.length + 5; page++) {
        const one: {
          status: number
          body: { items: Record<string, string>[]; nextCursor: string | null }
        } = await call(app, owner, 'GET', register.path, {
          ...register.query,
          limit: 1,
          ...(cursor === null ? {} : { cursor }),
        })
        expect(one.status, register.path).toBe(200)
        for (const item of one.body.items) walked.push(item[register.key])
        cursor = one.body.nextCursor
        if (cursor === null) break
      }
      // Same rows, in the same order: a cursor may never reorder what one page shows.
      expect(walked, `${register.path} walked`).toEqual(expected)
    }
  })

  it('the collections register reconciles by day and by collector, bounced money excluded', async () => {
    const byDay = await call<Collections>(
      app,
      accountant,
      'GET',
      '/reporting/registers/collections',
      { from, to, groupBy: 'day', limit: 200 },
    )
    const byCollector = await call<Collections>(
      app,
      accountant,
      'GET',
      '/reporting/registers/collections',
      { from, to, groupBy: 'collector', limit: 200 },
    )
    expect(byDay.status).toBe(200)
    expect(byCollector.status).toBe(200)
    expect(byDay.body.totals.totalPaise).toBe(15_000)
    expect(byCollector.body.totals.totalPaise).toBe(byDay.body.totals.totalPaise)
    expect(byDay.body.totals.chequePaise).toBe(0)
    expect(byCollector.body.items.map((i) => i.bucketName)).toContain('Crew')
  })

  /**
   * docs/plans/reporting.md §4 rule 8 and §5.8: a brand-funded scheme is a receivable from the brand
   * and a distributor-funded one is a margin hit today. Collapsing them into one "scheme spend" number
   * would make a fully recoverable scheme look like a loss, so the split is asserted, not assumed.
   */
  it('scheme spend splits company from distributor funding and drops a cancelled bill', async () => {
    const spend = await call<{
      items: { schemeId: string; fundingSource: string; amountPaise: number; qtyPcs: number }[]
      totals: {
        amountPaise: number
        qtyPcs: number
        companyFundedPaise: number
        distributorFundedPaise: number
      }
    }>(app, accountant, 'GET', '/reporting/registers/scheme-spend', { from, to, limit: 50 })
    expect(spend.status).toBe(200)
    const company = spend.body.items.find((i) => i.schemeId === schemeCompanyId)
    const distributor = spend.body.items.find((i) => i.schemeId === schemeDistributorId)
    expect(company?.fundingSource).toBe('company')
    expect(company?.amountPaise).toBe(1_200)
    expect(company?.qtyPcs).toBe(2)
    expect(distributor?.fundingSource).toBe('distributor')
    // 800 from the issued bill; the cancelled bill's 50,000 is not spend and never lands here.
    expect(distributor?.amountPaise).toBe(800)
    expect(spend.body.totals.companyFundedPaise).toBe(1_200)
    expect(spend.body.totals.distributorFundedPaise).toBe(800)
    expect(spend.body.totals.companyFundedPaise + spend.body.totals.distributorFundedPaise).toBe(
      spend.body.totals.amountPaise,
    )

    const onlyOurs = await call<{ items: { schemeId: string }[]; totals: { amountPaise: number } }>(
      app,
      accountant,
      'GET',
      '/reporting/registers/scheme-spend',
      { from, to, fundingSource: 'distributor', limit: 50 },
    )
    expect(onlyOurs.status).toBe(200)
    expect(onlyOurs.body.items.map((i) => i.schemeId)).toEqual([schemeDistributorId])
    expect(onlyOurs.body.totals.amountPaise).toBe(800)
  })

  /**
   * docs/plans/reporting.md §2 and §5.14: a filing shows what actually landed. Four of the five seeded
   * supplier bills are extracted / in review / disputed / cancelled and must contribute nothing.
   */
  it('the GST purchase register counts received supplier bills and nothing else', async () => {
    const purchase = await call<{
      rows: { hsnCode: string | null; taxablePaise: number; invoiceCount: number }[]
      totals: { taxablePaise: number; cgstPaise: number; sgstPaise: number; totalPaise: number }
      supplierRows: { supplierId: string; invoiceCount: number; taxablePaise: number }[]
    }>(app, accountant, 'GET', '/reporting/registers/gst-purchase', { from, to })
    expect(purchase.status).toBe(200)
    // One received bill of ₹500 taxable at 12% intra-state: 6% CGST + 6% SGST, never five bills.
    expect(purchase.body.totals.taxablePaise).toBe(50_000)
    expect(purchase.body.totals.cgstPaise).toBe(3_000)
    expect(purchase.body.totals.sgstPaise).toBe(3_000)
    const supplierRow = purchase.body.supplierRows.find((r) => r.supplierId === supplierId)
    expect(supplierRow?.invoiceCount).toBe(1)
    expect(supplierRow?.taxablePaise).toBe(50_000)
    for (const row of purchase.body.rows) expect(row.invoiceCount).toBe(1)

    for (const actor of [rep1, store, crew, shop]) {
      const refused = await call(app, actor, 'GET', '/reporting/registers/gst-purchase', {
        from,
        to,
      })
      expect(refused.status).toBe(403)
    }
  })

  it("the GST sales register is billing's own document", async () => {
    const wrapped = await call<{ totals: { taxablePaise: number } }>(
      app,
      accountant,
      'GET',
      '/reporting/registers/gst-sales',
      { from, to, groupBy: 'hsn' },
    )
    const direct = await call<{ totals: { taxablePaise: number } }>(
      app,
      accountant,
      'GET',
      '/billing/gst-summary',
      { from, to, groupBy: 'hsn' },
    )
    expect(wrapped.status).toBe(200)
    if (direct.status === 200) expect(wrapped.body).toEqual(direct.body)
    expect(wrapped.body.totals.taxablePaise).toBe(24_000)
  })

  // ===============================================================================================
  // exports
  // ===============================================================================================

  it('an export round-trips to a signed URL and replays to the same job', async () => {
    const id = uuidv7()
    const key = `exp-${run}`
    const first = await call<{ item: ReportExportJob }>(app, owner, 'POST', '/reporting/exports', {
      idempotencyKey: key,
      id,
      register: 'dailySales',
      format: 'csv',
      filters: { from, to },
    })
    expect(first.status).toBe(200)
    expect(first.body.item.kind).toBe('report_dailySales_csv')

    const fetched = await call<{ item: ReportExportJob }>(
      app,
      accountant,
      'GET',
      `/reporting/exports/${id}`,
    )
    expect(fetched.status).toBe(200)
    expect(fetched.body.item.status).toBe('succeeded')
    expect(fetched.body.item.rowCount).toBe(10)
    expect(fetched.body.item.url).not.toBeNull()

    const replay = await call<{ item: ReportExportJob }>(app, owner, 'POST', '/reporting/exports', {
      idempotencyKey: key,
      id,
      register: 'dailySales',
      format: 'csv',
      filters: { from, to },
    })
    expect(replay.status).toBe(200)
    expect(replay.body.item.id).toBe(id)
    const rows = await as(ctxFor('owner', ownerId), (tx) =>
      tx.execute(sql`select count(*)::int as n from export_jobs where tenant_id = ${tenantId}`),
    )
    expect(Number((rows.rows[0] as { n: number }).n)).toBe(1)
  })

  it('refuses an oversized window before a job exists', async () => {
    const refused = await call(app, owner, 'POST', '/reporting/exports', {
      idempotencyKey: `exp-wide-${run}`,
      id: uuidv7(),
      register: 'dailySales',
      format: 'csv',
      filters: { from: plusDays(to, -200), to },
    })
    expect(refused.status).toBe(400)
    const rows = await as(ctxFor('owner', ownerId), (tx) =>
      tx.execute(sql`select count(*)::int as n from export_jobs where tenant_id = ${tenantId}`),
    )
    expect(Number((rows.rows[0] as { n: number }).n)).toBe(1)
  })

  // ===============================================================================================
  // the rollup
  // ===============================================================================================

  it('the rollup job is idempotent: a second run reproduces the same numbers', async () => {
    await rollupTenantDay(db, tenantId, to)
    const read = () =>
      as(ctxFor('owner', ownerId), async (tx) => {
        const rows = await tx.execute(sql`
          select invoiced_paise, collected_paise, ordered_pcs, picked_pcs, orders_count
            from daily_tenant_stats where tenant_id = ${tenantId} and day = ${to}`)
        const reps = await tx.execute(sql`
          select count(*)::int as n from daily_rep_stats where tenant_id = ${tenantId} and day = ${to}`)
        return { day: rows.rows[0], reps: Number((reps.rows[0] as { n: number }).n) }
      })
    const once = await read()
    await rollupTenantDay(db, tenantId, to)
    const twice = await read()
    expect(twice).toEqual(once)
    // It really recomputed from the live rows: the invoice above is the day's money.
    expect(Number((once.day as { invoiced_paise: unknown }).invoiced_paise)).toBe(26_880)
    expect(Number((once.day as { collected_paise: unknown }).collected_paise)).toBe(15_000)
    // The order's three lines, each picked at 80%: 96 + 192 + 48 of 120 + 240 + 60.
    expect(Number((once.day as { ordered_pcs: unknown }).ordered_pcs)).toBe(420)
    expect(Number((once.day as { picked_pcs: unknown }).picked_pcs)).toBe(336)
  })

  // ===============================================================================================
  // roles, RLS and tenant isolation
  // ===============================================================================================

  it('a shopkeeper is refused everywhere, at the guard and at the database', async () => {
    for (const path of [
      '/reporting/dashboard/owner',
      '/reporting/dashboard/rep',
      '/reporting/series',
      '/reporting/registers/daily-sales',
      '/reporting/retailers/lapsed',
    ]) {
      const refused = await call(app, shop, 'GET', path, {
        metric: 'invoiced',
        grain: 'day',
        from,
        to,
      })
      expect(refused.status).toBe(403)
    }
    // RLS is the guarantee, not the guard: a raw session as the shopkeeper sees no rollup row.
    const seen = await as(ctxFor('retailer', shopUserId), async (tx) => {
      const day = await tx.execute(
        sql`select count(*)::int as n from daily_tenant_stats where tenant_id = ${tenantId}`,
      )
      const habits = await tx.execute(
        sql`select count(*)::int as n from retailer_behaviour where tenant_id = ${tenantId}`,
      )
      const cost = await tx.execute(
        sql`select count(*)::int as n from daily_owner_stats where tenant_id = ${tenantId}`,
      )
      return [day, habits, cost].map((r) => Number((r.rows[0] as { n: number }).n))
    })
    expect(seen).toEqual([0, 0, 0])
  })

  it('the margin series is the owner’s route alone', async () => {
    const ownerSeries = await call<Series>(app, owner, 'GET', '/reporting/series/gross-margin', {
      grain: 'month',
      from: monthOf(from),
      to,
    })
    expect(ownerSeries.status).toBe(200)
    for (const actor of [manager, accountant])
      expect(
        (
          await call(app, actor, 'GET', '/reporting/series/gross-margin', {
            grain: 'month',
            from: monthOf(from),
            to,
          })
        ).status,
      ).toBe(403)
    // And the database agrees: a salesperson reads no cost row at all.
    const rows = await as(ctxFor('salesperson', rep1Id), (tx) =>
      tx.execute(
        sql`select count(*)::int as n from daily_owner_stats where tenant_id = ${tenantId}`,
      ),
    )
    expect(Number((rows.rows[0] as { n: number }).n)).toBe(0)
  })

  it("another distributor's owner sees nothing of this tenant", async () => {
    const series = await call<Series>(app, stranger, 'GET', '/reporting/series', {
      metric: 'invoiced',
      grain: 'day',
      from,
      to,
    })
    expect(series.status).toBe(200)
    expect(series.body.points.every((p) => p.value === 0)).toBe(true)
    const register = await call<DailyTenant>(
      app,
      stranger,
      'GET',
      '/reporting/registers/daily-sales',
      { from, to },
    )
    expect(register.body.items).toHaveLength(0)
    expect(register.body.totals.invoicedPaise).toBe(0)
  })

  it('answers 401 with no token', async () => {
    const anon = await call(app, null, 'GET', '/reporting/dashboard/owner')
    expect(anon.status).toBe(401)
  })
})
