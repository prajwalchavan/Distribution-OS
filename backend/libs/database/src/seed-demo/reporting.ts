/** Visits, pre-aggregated stats, approvals, audit trail and sync errors (notifications: seed-demo/notifications.ts). */
import { insertMany, upsertMany } from './db-helpers.js'
import {
  approvals,
  auditLog,
  dailyOwnerStats,
  dailyRepStats,
  dailyRetailerStats,
  dailyTenantStats,
  exportJobs,
  ownerSummary,
  retailerBehaviour,
  syncErrors,
  visits,
  type DailyMarginMix,
  type DailyMix,
  type DailyPaymentModeMix,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { brandId, type VariantRow } from './catalog.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { InvoiceRecord, OrderRecord, SalesResult } from './sales.js'
import type { RetailerRow, RetailersResult } from './retailers.js'
import type { TenantCatalogResult } from './tenant-catalog.js'
import {
  atIstTime,
  daysAgo,
  isoDate,
  isWorkingDay,
  jitter,
  makeRng,
  nth,
  pick,
  randChance,
  randInt,
  TODAY,
  workingDaysBack,
} from './util.js'

const NO_ORDER_REASONS = [
  'Shop closed for the day',
  'Owner not available, staff could not decide',
  'Enough stock already, will order next visit',
  'Waiting for previous bill payment before ordering',
]

export async function seedReporting(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  tenantCatalog: TenantCatalogResult,
  retailersRes: RetailersResult,
  sales: SalesResult,
  people: PeopleResult,
): Promise<void> {
  const rng = makeRng('dos-demo:reporting')
  // A second generator for the day-series columns added with migration 0027, so the draws below that
  // shaped the visits, the approvals and the sync errors on the founder's database stay exactly as they were.
  const seriesRng = makeRng('dos-demo:reporting:series')
  const variantById = new Map(variants.map((v) => [v.id, v]))
  const retailerById = new Map(retailersRes.retailers.map((r) => [r.id, r]))
  const beatRetailers: Record<string, RetailerRow[]> = { rahul: [], amit: [], pooja: [] }
  for (const r of retailersRes.retailers) {
    if (r.beatIndex < 2) beatRetailers.rahul?.push(r)
    else beatRetailers.amit?.push(r)
    beatRetailers.pooja?.push(r)
  }

  // --- visits: one per rep-created order (productive), plus a couple of no_order calls a day. ---
  const ordersByRepDay = new Map<string, OrderRecord[]>()
  for (const o of sales.orders) {
    if (o.source !== 'salesperson' || o.state === 'draft') continue
    const repKey =
      o.salespersonId === people.salespeople.rahul.id
        ? 'rahul'
        : o.salespersonId === people.salespeople.amit.id
          ? 'amit'
          : o.salespersonId === people.salespeople.pooja.id
            ? 'pooja'
            : null
    if (!repKey) continue
    const key = `${repKey}:${isoDate(o.day)}`
    const arr = ordersByRepDay.get(key) ?? []
    arr.push(o)
    ordersByRepDay.set(key, arr)
  }

  const workDays = workingDaysBack(14)
  const visitRows: (typeof visits.$inferInsert)[] = []
  const repStatRows: (typeof dailyRepStats.$inferInsert)[] = []
  let visitSeq = 0

  const repNameByKey: Record<'rahul' | 'amit' | 'pooja', { id: string; name: string }> = {
    rahul: people.salespeople.rahul,
    amit: people.salespeople.amit,
    pooja: people.salespeople.pooja,
  }

  for (const repKey of ['rahul', 'amit', 'pooja'] as const) {
    const rep = repNameByKey[repKey]
    const territory = beatRetailers[repKey] ?? []
    for (const day of workDays) {
      const dayKey = `${repKey}:${isoDate(day)}`
      const orders = ordersByRepDay.get(dayKey) ?? []
      let productive = 0
      let linesSold = 0
      let orderValue = 0

      for (const o of orders) {
        const retailer = retailerById.get(o.retailerId)
        visitSeq += 1
        visitRows.push({
          id: demoId('visit', `${dayKey}:${visitSeq}`),
          tenantId,
          retailerId: o.retailerId,
          userId: rep.id,
          beatId: demoId('beat', retailersRes.beats[o.beatIndex]?.key ?? ''),
          startedAt: atIstTime(day, 10 + (visitSeq % 8), randInt(rng, 0, 45)),
          endedAt: atIstTime(day, 10 + (visitSeq % 8), randInt(rng, 46, 59)),
          outcome: 'ordered' as const,
          lat: retailer ? jitter(rng, retailer.lat, 0.0003) : null,
          lng: retailer ? jitter(rng, retailer.lng, 0.0003) : null,
        })
        productive += 1
        linesSold += o.lineCount
        orderValue += o.totalPaise
      }

      const extraCalls = randInt(rng, 1, 3)
      for (let i = 0; i < extraCalls && territory.length > 0; i++) {
        const retailer = pick(rng, territory)
        visitSeq += 1
        visitRows.push({
          id: demoId('visit', `${dayKey}:${visitSeq}`),
          tenantId,
          retailerId: retailer.id,
          userId: rep.id,
          beatId: demoId('beat', retailer.beatKey),
          startedAt: atIstTime(day, 10 + (visitSeq % 8), randInt(rng, 0, 45)),
          endedAt: atIstTime(day, 10 + (visitSeq % 8), randInt(rng, 46, 59)),
          outcome: 'no_order' as const,
          reason: pick(rng, NO_ORDER_REASONS),
          lat: jitter(rng, retailer.lat, 0.0003),
          lng: jitter(rng, retailer.lng, 0.0003),
        })
      }

      repStatRows.push({
        tenantId,
        userId: rep.id,
        day: isoDate(day),
        visits: orders.length + extraCalls,
        productiveVisits: productive,
        ordersCount: orders.length,
        orderValuePaise: orderValue,
        linesSold,
        collectedPaise: 0,
      })
    }
  }
  await insertMany(db, visits, visitRows)
  await insertMany(db, dailyRepStats, repStatRows)

  // --- daily_tenant_stats: one row per working day in the 14-day window. ---
  const ordersByDay = new Map<string, OrderRecord[]>()
  for (const o of sales.orders) {
    const key = isoDate(o.day)
    const arr = ordersByDay.get(key) ?? []
    arr.push(o)
    ordersByDay.set(key, arr)
  }
  const invoicesByDay = new Map<string, number>()
  for (const inv of sales.invoices) {
    const key = isoDate(inv.invoiceDate)
    invoicesByDay.set(key, (invoicesByDay.get(key) ?? 0) + inv.totalPaise)
  }

  const invoiceRowsByDay = new Map<string, InvoiceRecord[]>()
  for (const inv of sales.invoices) {
    const key = isoDate(inv.invoiceDate)
    const arr = invoiceRowsByDay.get(key) ?? []
    arr.push(inv)
    invoiceRowsByDay.set(key, arr)
  }
  const shortInvoiceIds = new Set(sales.shortDeliveries.map((s) => s.invoiceId))
  const beatIdByIndex = retailersRes.beats.map((b) => b.id)
  /** A line's value with GST, from its ex-tax value and the variant's rate — what a mix chart stacks. */
  const lineInclTax = (taxablePaise: number, v: VariantRow | undefined) =>
    taxablePaise + Math.round((taxablePaise * ((v?.gstBps ?? 0) + (v?.cessBps ?? 0))) / 10_000)
  const addMix = (mix: DailyMix, key: string, invoicedPaise: number) => {
    const entry = mix[key] ?? { invoicedPaise: 0, invoiceCount: 0 }
    entry.invoicedPaise += invoicedPaise
    entry.invoiceCount += 1
    mix[key] = entry
  }

  const tenantStatRows: (typeof dailyTenantStats.$inferInsert)[] = []
  const ownerStatRows: (typeof dailyOwnerStats.$inferInsert)[] = []
  const mtdSalesForStock = sales.invoices
    .filter((inv) => isoDate(inv.invoiceDate).startsWith(isoDate(TODAY).slice(0, 7)))
    .reduce((s, inv) => s + inv.totalPaise, 0)
  for (const day of workDays) {
    const key = isoDate(day)
    const dayOrders = ordersByDay.get(key) ?? []
    const dayInvoices = invoiceRowsByDay.get(key) ?? []
    const invoicedPaise = invoicesByDay.get(key) ?? 0
    const ageDays = Math.round((TODAY.getTime() - day.getTime()) / 86_400_000)
    const collectedPaise = ageDays >= 2 ? Math.round(invoicedPaise * (0.5 + rng() * 0.3)) : 0
    const activeRetailers = new Set(dayOrders.map((o) => o.retailerId)).size
    const deliveredStops = dayOrders.filter((o) =>
      ['packed', 'dispatched', 'delivered', 'closed'].includes(o.state),
    ).length
    const failedStops = deliveredStops > 0 && randChance(rng, 0.2) ? 1 : 0

    // --- the day-series columns of 0027: the outstanding trend's overdue line, the last mile's
    //     partial / on-time / POD counters, the fill rate's pieces, and the four mixes. ---
    const outstandingPaise = Math.max(0, invoicedPaise - collectedPaise)
    const overduePaise = ageDays > 7 ? Math.round(outstandingPaise * 0.35) : 0
    const partialStops = Math.min(
      deliveredStops,
      dayInvoices.filter((inv) => shortInvoiceIds.has(inv.id)).length,
    )
    const attemptedStops = deliveredStops + partialStops
    const onTimeStops = Math.round(attemptedStops * (0.8 + seriesRng() * 0.15))
    const podStops = Math.round(attemptedStops * (0.85 + seriesRng() * 0.15))
    let orderedPcs = 0
    let pickedPcs = 0
    const byBrand: DailyMix = {}
    const byCategory: DailyMix = {}
    const byBeat: DailyMix = {}
    // the cost-bearing half of the day, for daily_owner_stats (back office only)
    let netSalesPaise = 0
    let cogsPaise = 0
    let schemeSpendCompanyPaise = 0
    const marginByBrand: DailyMarginMix = {}
    for (const inv of dayInvoices) {
      const beatId = beatIdByIndex[inv.beatIndex]
      if (beatId) addMix(byBeat, beatId, inv.totalPaise)
      const brandsOnInvoice = new Map<string, number>()
      const categoriesOnInvoice = new Map<string, number>()
      for (const line of inv.lines) {
        const v = variantById.get(line.variantId)
        orderedPcs += line.qtyPcs
        pickedPcs += line.pickedQtyPcs
        const incl = lineInclTax(line.taxablePaise, v)
        const brandKey = v ? brandId(v.brandKey) : 'unknown'
        const category = v?.category ?? 'Uncategorised'
        brandsOnInvoice.set(brandKey, (brandsOnInvoice.get(brandKey) ?? 0) + incl)
        categoriesOnInvoice.set(category, (categoriesOnInvoice.get(category) ?? 0) + incl)
        const cost = tenantCatalog.costsByVariantId.get(line.variantId)
        const perPiece = cost ? cost.landedCostPaise || cost.purchaseRatePaise : 0
        // free goods leave at cost and bring in nothing; the brand funds them (the Campa 12+1 scheme)
        const lineCogs = perPiece * (line.qtyPcs + line.freeQtyPcs)
        netSalesPaise += line.taxablePaise
        cogsPaise += lineCogs
        schemeSpendCompanyPaise += line.freeQtyPcs * line.ratePaise
        const m = marginByBrand[brandKey] ?? { cogsPaise: 0, grossMarginPaise: 0 }
        m.cogsPaise += lineCogs
        m.grossMarginPaise += line.taxablePaise - lineCogs
        marginByBrand[brandKey] = m
      }
      for (const [k, paise] of brandsOnInvoice) addMix(byBrand, k, paise)
      for (const [k, paise] of categoriesOnInvoice) addMix(byCategory, k, paise)
    }
    // collections by mode: cash first, UPI second, the rest by cheque — summing exactly to the day's total
    const cashPaise = Math.round(collectedPaise * 0.55)
    const upiPaise = Math.round(collectedPaise * 0.35)
    const byPaymentMode =
      collectedPaise > 0
        ? { cash: cashPaise, upi: upiPaise, cheque: collectedPaise - cashPaise - upiPaise }
        : {}

    tenantStatRows.push({
      tenantId,
      day: key,
      ordersCount: dayOrders.length,
      invoicedPaise,
      collectedPaise,
      outstandingPaise,
      overduePaise,
      deliveredStops,
      partialStops,
      failedStops,
      onTimeStops,
      podStops,
      orderedPcs,
      pickedPcs,
      activeRetailers,
      byBrand,
      byCategory,
      byBeat,
      byPaymentMode,
    })

    // stock at cost drifts a little day to day around the same figure the owner_summary row shows
    const stockValuePaise = Math.round(mtdSalesForStock * 0.4 * (0.92 + seriesRng() * 0.16))
    ownerStatRows.push({
      tenantId,
      day: key,
      netSalesPaise,
      cogsPaise,
      grossMarginPaise: netSalesPaise - cogsPaise,
      stockValuePaise,
      nearExpiryValuePaise: Math.round(stockValuePaise * 0.03),
      schemeSpendCompanyPaise,
      schemeSpendDistributorPaise: 0,
      byBrand: marginByBrand,
    })
  }
  await upsertMany(
    db,
    dailyTenantStats,
    tenantStatRows,
    [dailyTenantStats.tenantId, dailyTenantStats.day],
    [
      'ordersCount',
      'invoicedPaise',
      'collectedPaise',
      'outstandingPaise',
      'overduePaise',
      'deliveredStops',
      'partialStops',
      'failedStops',
      'onTimeStops',
      'podStops',
      'orderedPcs',
      'pickedPcs',
      'activeRetailers',
      'byBrand',
      'byCategory',
      'byBeat',
      'byPaymentMode',
    ],
  )
  await upsertMany(
    db,
    dailyOwnerStats,
    ownerStatRows,
    [dailyOwnerStats.tenantId, dailyOwnerStats.day],
    [
      'netSalesPaise',
      'cogsPaise',
      'grossMarginPaise',
      'stockValuePaise',
      'nearExpiryValuePaise',
      'schemeSpendCompanyPaise',
      'schemeSpendDistributorPaise',
      'byBrand',
    ],
  )

  // --- daily_retailer_stats: one row per shop per day it ordered, plus the day its money came in. ---
  const retailerStatByKey = new Map<string, typeof dailyRetailerStats.$inferInsert>()
  const retailerDayRow = (retailerId: string, dayKey: string) => {
    const k = `${retailerId}:${dayKey}`
    const row = retailerStatByKey.get(k) ?? {
      tenantId,
      retailerId,
      day: dayKey,
      ordersCount: 0,
      invoicedPaise: 0,
      collectedPaise: 0,
      linesSold: 0,
    }
    retailerStatByKey.set(k, row)
    return row
  }
  for (const o of sales.orders) {
    if (o.state === 'draft' || o.state === 'cancelled') continue
    const row = retailerDayRow(o.retailerId, isoDate(o.day))
    row.ordersCount = (row.ordersCount ?? 0) + 1
    row.linesSold = (row.linesSold ?? 0) + o.lineCount
  }
  const todayKey = isoDate(TODAY)
  for (const inv of sales.invoices) {
    const row = retailerDayRow(inv.retailerId, isoDate(inv.invoiceDate))
    row.invoicedPaise = (row.invoicedPaise ?? 0) + inv.totalPaise
    if (inv.state === 'issued') continue
    // paid on the credit terms, never in the future: a paid bill lands its money `creditDays` later
    const creditDays = retailerById.get(inv.retailerId)?.creditDays ?? 0
    const paidOn = new Date(inv.invoiceDate.getTime() + creditDays * 86_400_000)
    const paidKey = paidOn.getTime() < TODAY.getTime() ? isoDate(paidOn) : todayKey
    const collected = inv.state === 'paid' ? inv.totalPaise : Math.round(inv.totalPaise / 2)
    const paidRow = retailerDayRow(inv.retailerId, paidKey)
    paidRow.collectedPaise = (paidRow.collectedPaise ?? 0) + collected
  }
  await upsertMany(
    db,
    dailyRetailerStats,
    [...retailerStatByKey.values()],
    [dailyRetailerStats.tenantId, dailyRetailerStats.retailerId, dailyRetailerStats.day],
    ['ordersCount', 'invoicedPaise', 'collectedPaise', 'linesSold'],
  )

  // --- retailer_behaviour: one row per retailer. ---
  const ordersByRetailer = new Map<string, OrderRecord[]>()
  for (const o of sales.orders) {
    if (o.state === 'draft' || o.state === 'cancelled') continue
    const arr = ordersByRetailer.get(o.retailerId) ?? []
    arr.push(o)
    ordersByRetailer.set(o.retailerId, arr)
  }
  const behaviourRows: (typeof retailerBehaviour.$inferInsert)[] = []
  for (const r of retailersRes.retailers) {
    const rOrders = (ordersByRetailer.get(r.id) ?? []).sort(
      (a, b) => a.day.getTime() - b.day.getTime(),
    )
    const last = rOrders[rOrders.length - 1]
    const valueLast30 = rOrders.reduce((s, o) => s + o.totalPaise, 0)
    const hasPaid = sales.invoices.some((inv) => inv.retailerId === r.id && inv.state === 'paid')
    behaviourRows.push({
      tenantId,
      retailerId: r.id,
      lastOrderAt: last ? atIstTime(last.day, 12, 0) : null,
      lastVisitAt: last ? atIstTime(last.day, 12, 0) : null,
      lastPaymentAt: hasPaid ? atIstTime(daysAgo(randInt(rng, 2, 6)), 17, 0) : null,
      ordersLast30: rOrders.length,
      valueLast30Paise: valueLast30,
      avgDaysToPay: r.creditDays > 0 ? r.creditDays - randInt(rng, 0, 3) : 0,
      usualBasket: [],
      lapsedRisk: rOrders.length === 0 ? 70 : rOrders.length < 2 ? 30 : 0,
      unitsLast30: Math.round(valueLast30 / 3000),
    })
  }
  await insertMany(db, retailerBehaviour, behaviourRows)

  // --- owner_summary: one synced row for the owner's home screen. ---
  const yesterdayKey = isoDate(daysAgo(1))
  const todayInvoiced = invoicesByDay.get(isoDate(TODAY)) ?? 0
  const yesterdayInvoiced = invoicesByDay.get(yesterdayKey) ?? 0
  const totalOutstanding = [...sales.outstandingByRetailer.values()].reduce(
    (s, o) => s + o.outstandingPaise,
    0,
  )
  const overdue = [...sales.outstandingByRetailer.values()].reduce((s, o) => {
    const over = o.items
      .filter(
        (it) =>
          Math.round((daysAgo(1).getTime() - new Date(it.dueDate).getTime()) / 86_400_000) > 7,
      )
      .reduce((ss, it) => ss + it.outstandingPaise, 0)
    return s + over
  }, 0)
  const mtdSales = sales.invoices
    .filter((inv) => isoDate(inv.invoiceDate).startsWith(isoDate(TODAY).slice(0, 7)))
    .reduce((s, inv) => s + inv.totalPaise, 0)

  await insertMany(db, ownerSummary, [
    {
      tenantId,
      todayInvoicedPaise: todayInvoiced,
      todayCollectedPaise: Math.round(yesterdayInvoiced * 0.3),
      totalOutstandingPaise: totalOutstanding,
      overduePaise: overdue,
      mtdSalesPaise: mtdSales,
      mtdGrossMarginPaise: Math.round(mtdSales * 0.12),
      stockValuePaise: Math.round(mtdSales * 0.4),
      nearExpiryValuePaise: Math.round(mtdSales * 0.4 * 0.03),
      pendingApprovals: 3,
      activeTrips: 1,
    },
  ])

  // --- a few pending approvals: one credit-limit request, two bargain requests. ---
  const highOutstanding = [...sales.outstandingByRetailer.entries()].sort(
    (a, b) => b[1].outstandingPaise - a[1].outstandingPaise,
  )
  const creditRetailerId = highOutstanding[0]?.[0] ?? retailersRes.retailers[0]?.id
  const approvalRows: (typeof approvals.$inferInsert)[] = []
  if (creditRetailerId) {
    const retailer = retailerById.get(creditRetailerId)
    approvalRows.push({
      id: demoId('approval', 'credit-limit-1'),
      tenantId,
      kind: 'credit_limit' as const,
      entityType: 'retailer',
      entityId: creditRetailerId,
      requestedBy: people.salespeople.rahul.id,
      status: 'pending' as const,
      payload: {
        currentLimitPaise: retailer?.creditLimitPaise ?? 0,
        requestedLimitPaise: (retailer?.creditLimitPaise ?? 0) + 2_000_000,
        reason: 'Festive season stocking, retailer asked for a temporary bump.',
      },
    })
  }
  approvalRows.push({
    id: demoId('approval', 'bargain-1'),
    tenantId,
    kind: 'bargain' as const,
    entityType: 'bargain_request',
    entityId: demoId('bargain', `${nth(retailersRes.retailers, 1).code}:0`),
    requestedBy: people.salespeople.rahul.id,
    status: 'pending' as const,
    payload: { note: 'Retailer wants ₹2/piece off list on Campa Cola 750 ml.' },
  })
  await insertMany(db, approvals, approvalRows)

  // --- audit log for a few credit-limit changes. ---
  const auditRows: (typeof auditLog.$inferInsert)[] = []
  for (let i = 0; i < 4; i++) {
    const r = nth(retailersRes.retailers, i * 5)
    const before = Math.max(0, r.creditLimitPaise - 1_000_000)
    auditRows.push({
      id: demoId('audit-log', `credit:${r.code}`),
      tenantId,
      actorId: people.owner.id,
      actorRole: 'owner',
      action: 'credit_limit_change',
      entityType: 'retailer',
      entityId: r.id,
      before: { creditLimitPaise: before },
      after: { creditLimitPaise: r.creditLimitPaise },
      occurredAt: atIstTime(daysAgo(randInt(rng, 20, 60)), 12, 0),
    })
  }
  await insertMany(db, auditLog, auditRows)

  // --- sync_errors: a handful of device-sync rejections the app would show in "Needs attention". ---
  const syncErrorDefs = [
    {
      code: 'stale_price',
      hi: 'कीमत बदल गई है, दोबारा जाँचें।',
      en: 'Price changed since you last synced; please recheck.',
    },
    {
      code: 'insufficient_stock',
      hi: 'पर्याप्त स्टॉक उपलब्ध नहीं है।',
      en: 'Not enough stock available for this line.',
    },
    {
      code: 'retailer_credit_blocked',
      hi: 'दुकान की क्रेडिट लिमिट पूरी हो गई है।',
      en: 'This retailer is over its credit limit.',
    },
    { code: 'duplicate_order', hi: 'यह ऑर्डर पहले से मौजूद है।', en: 'This order already exists.' },
    {
      code: 'scheme_expired',
      hi: 'यह स्कीम अब लागू नहीं है।',
      en: 'This scheme is no longer active.',
    },
  ]
  const syncErrorRows = syncErrorDefs.map((e, i) => ({
    id: demoId('sync-error', e.code),
    tenantId,
    userId: people.salespeople.rahul.id,
    deviceId: demoId('device', people.salespeople.rahul.id),
    opId: demoId('sync-op', e.code),
    tableName: 'sales_order_lines',
    rowId: demoId('order-line', `sync-error:${i}`),
    code: e.code,
    messageHi: e.hi,
    messageEn: e.en,
    createdAt: atIstTime(daysAgo(randInt(rng, 0, 6)), randInt(rng, 9, 18), 0),
  }))
  await insertMany(db, syncErrors, syncErrorRows)

  // --- the backdated history the owner's graphs are drawn on. ---
  await seedRollupHistory(db, tenantId, tenantStatRows, ownerStatRows, repStatRows, retailersRes)

  // --- report exports: two ready files, one still rendering, one that found nothing. ---
  await seedReportExports(db, tenantId, people)

  // WhatsApp notifications and templates moved to seed-demo/notifications.ts (module 8).
}

/**
 * THE OWNER'S CURVE (task: "extend the seed so the rollups cover at least 90 days of realistic daily
 * sales and collections, backdated from the existing invoices and receipts, so the owner graphs have a
 * real curve").
 *
 * The live seed writes 14 working days of real orders, bills and receipts — enough for a register, far
 * too short for a TREND, a month-over-month comparison or a year-over-year one (docs/23 §1.2 wants
 * month grain over 24 months and YoY). So the rollup tables are backdated `HISTORY_DAYS` days with
 * DERIVED rows: the LEVEL comes from the real window's own averages and mixes, and the shape from three
 * honest effects — a gentle growth trend, the weekday pattern of an FMCG depot (Monday and Saturday are
 * the big days, Sunday is closed) and the Diwali quarter.
 *
 * These are rollup rows only. No invoice, receipt or order is invented behind them: a register (which
 * reads the live tables) shows the real 14 days, a series (which reads the rollup) shows the year. That
 * is exactly the split the rollup exists for, and it is what a distributor's first year on the product
 * looks like after a data migration too.
 *
 * Deterministic and idempotent: its own RNG stream, and every write is an upsert on the primary key, so
 * `pnpm db:seed` twice produces byte-identical rows and adds nothing.
 */
const HISTORY_DAYS = 400
/** Where the backdated history stops: the live 14-day window takes over here. */
const LIVE_WINDOW_DAYS = 14
/** How much smaller the business was a year ago — the growth the owner's trend chart shows. */
const GROWTH_FLOOR = 0.55
/** Monday … Saturday: an FMCG depot bills hardest at the start and the end of the week. */
const WEEKDAY_WEIGHT = [0, 1.18, 1.02, 0.94, 0.99, 1.06, 1.21]
/** Shops with a rollup row on a backdated day; a bound, not a target. */
const SHOPS_PER_HISTORY_DAY = 8

async function seedRollupHistory(
  db: Db,
  tenantId: string,
  liveTenantRows: (typeof dailyTenantStats.$inferInsert)[],
  liveOwnerRows: (typeof dailyOwnerStats.$inferInsert)[],
  liveRepRows: (typeof dailyRepStats.$inferInsert)[],
  retailersRes: RetailersResult,
): Promise<void> {
  const rng = makeRng('dos-demo:reporting:history')
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : Math.round(values.reduce((s, v) => s + v, 0) / values.length)
  const billed = liveTenantRows.map((r) => r.invoicedPaise ?? 0).filter((v) => v > 0)
  const baseInvoiced = mean(billed)
  if (baseInvoiced === 0) return
  const baseOrders = Math.max(1, mean(liveTenantRows.map((r) => r.ordersCount ?? 0)))
  const baseActive = Math.max(1, mean(liveTenantRows.map((r) => r.activeRetailers ?? 0)))
  const baseStops = Math.max(1, mean(liveTenantRows.map((r) => r.deliveredStops ?? 0)))
  const baseOrderedPcs = Math.max(1, mean(liveTenantRows.map((r) => r.orderedPcs ?? 0)))
  const baseStockValue = Math.max(0, mean(liveOwnerRows.map((r) => r.stockValuePaise ?? 0)))
  const liveNet = liveOwnerRows.reduce((s, r) => s + (r.netSalesPaise ?? 0), 0)
  const liveCogs = liveOwnerRows.reduce((s, r) => s + (r.cogsPaise ?? 0), 0)
  /** The real margin ratio of the live window, so the backdated margin trend is the business's own. */
  const costRatio = liveNet > 0 ? Math.min(0.98, liveCogs / liveNet) : 0.86
  const taxRatio = 1.16

  /** The aggregate share of each key over the live window: the backdated mixes keep the same shape. */
  const shareOf = (
    pickMix: (row: typeof dailyTenantStats.$inferInsert) => DailyMix | undefined,
  ) => {
    const totals = new Map<string, number>()
    let all = 0
    for (const row of liveTenantRows) {
      for (const [key, entry] of Object.entries(pickMix(row) ?? {})) {
        totals.set(key, (totals.get(key) ?? 0) + entry.invoicedPaise)
        all += entry.invoicedPaise
      }
    }
    if (all === 0) return [] as { key: string; share: number }[]
    return [...totals.entries()]
      .map(([key, value]) => ({ key, share: value / all }))
      .sort((a, b) => b.share - a.share)
  }
  const brandShares = shareOf((r) => r.byBrand ?? undefined)
  const categoryShares = shareOf((r) => r.byCategory ?? undefined)
  const beatShares = shareOf((r) => r.byBeat ?? undefined)
  const marginBrandShares = brandShares.length > 0 ? brandShares : [{ key: 'unknown', share: 1 }]

  const repIds = [...new Set(liveRepRows.map((r) => r.userId))]
  const repWeights = repIds.map((_, i) => 0.42 - i * 0.08)
  const shops = retailersRes.retailers

  const tenantRows: (typeof dailyTenantStats.$inferInsert)[] = []
  const ownerRows: (typeof dailyOwnerStats.$inferInsert)[] = []
  const repRows: (typeof dailyRepStats.$inferInsert)[] = []
  const retailerRows: (typeof dailyRetailerStats.$inferInsert)[] = []

  for (let back = HISTORY_DAYS; back >= LIVE_WINDOW_DAYS; back--) {
    const day = daysAgo(back)
    if (!isWorkingDay(day)) continue
    const key = isoDate(day)
    const weekday = WEEKDAY_WEIGHT[day.getUTCDay()] ?? 1
    // Linear growth from `GROWTH_FLOOR` a year and a bit ago to 1.0 at the live window.
    const trend = GROWTH_FLOOR + (1 - GROWTH_FLOOR) * (1 - back / HISTORY_DAYS)
    // The Diwali quarter: October and November move more stock than any other month.
    const month = day.getUTCMonth()
    const festive = month === 9 || month === 10 ? 1.22 : month === 2 ? 1.07 : 1
    const noise = 0.86 + rng() * 0.28
    const factor = weekday * trend * festive * noise

    const invoicedPaise = Math.round(baseInvoiced * factor)
    const ordersCount = Math.max(1, Math.round(baseOrders * factor))
    const activeRetailers = Math.max(1, Math.round(baseActive * factor))
    const collectedPaise = Math.round(invoicedPaise * (0.58 + rng() * 0.3))
    const outstandingPaise = Math.round(invoicedPaise * (2.4 + rng() * 1.1))
    const overduePaise = Math.round(outstandingPaise * (0.18 + rng() * 0.2))
    const deliveredStops = Math.max(1, Math.round(baseStops * factor))
    const partialStops = rng() < 0.35 ? 1 : 0
    const failedStops = rng() < 0.22 ? 1 : 0
    const attempted = deliveredStops + partialStops
    const onTimeStops = Math.round(attempted * (0.78 + rng() * 0.2))
    const podStops = Math.round(attempted * (0.82 + rng() * 0.18))
    const orderedPcs = Math.max(1, Math.round(baseOrderedPcs * factor))
    // Fill rate wanders between 0.90 and 1.00 — a real godown short-picks now and then.
    const pickedPcs = Math.round(orderedPcs * (0.9 + rng() * 0.1))

    const spread = (shares: { key: string; share: number }[], total: number): DailyMix => {
      const mix: DailyMix = {}
      let left = total
      shares.forEach((entry, i) => {
        const paise = i === shares.length - 1 ? left : Math.round(total * entry.share)
        left -= paise
        if (paise > 0)
          mix[entry.key] = {
            invoicedPaise: paise,
            invoiceCount: Math.max(1, Math.round(ordersCount * entry.share)),
          }
      })
      return mix
    }
    const cash = Math.round(collectedPaise * 0.55)
    const upi = Math.round(collectedPaise * 0.35)
    const byPaymentMode: DailyPaymentModeMix =
      collectedPaise > 0 ? { cash, upi, cheque: collectedPaise - cash - upi } : {}

    tenantRows.push({
      tenantId,
      day: key,
      ordersCount,
      invoicedPaise,
      collectedPaise,
      outstandingPaise,
      overduePaise,
      deliveredStops,
      partialStops,
      failedStops,
      onTimeStops,
      podStops,
      orderedPcs,
      pickedPcs,
      activeRetailers,
      byBrand: spread(brandShares, invoicedPaise),
      byCategory: spread(categoryShares, invoicedPaise),
      byBeat: spread(beatShares, invoicedPaise),
      byPaymentMode,
    })

    const netSalesPaise = Math.round(invoicedPaise / taxRatio)
    const cogsPaise = Math.round(netSalesPaise * costRatio)
    const stockValuePaise = Math.round(baseStockValue * (0.85 + rng() * 0.3) * trend)
    const byBrandMargin: DailyMarginMix = {}
    for (const entry of marginBrandShares) {
      const brandNet = Math.round(netSalesPaise * entry.share)
      const brandCogs = Math.round(brandNet * costRatio)
      byBrandMargin[entry.key] = { cogsPaise: brandCogs, grossMarginPaise: brandNet - brandCogs }
    }
    ownerRows.push({
      tenantId,
      day: key,
      netSalesPaise,
      cogsPaise,
      grossMarginPaise: netSalesPaise - cogsPaise,
      stockValuePaise,
      nearExpiryValuePaise: Math.round(stockValuePaise * (0.02 + rng() * 0.03)),
      // Company-funded free goods run all year; the distributor's own 2% order scheme fires on the
      // bigger days only — the split the owner's <StackedMix> exists to show (never collapsed).
      schemeSpendCompanyPaise: Math.round(netSalesPaise * (0.008 + rng() * 0.006)),
      schemeSpendDistributorPaise: factor > 1.05 ? Math.round(netSalesPaise * 0.02) : 0,
      byBrand: byBrandMargin,
    })

    repIds.forEach((userId, i) => {
      const weight = repWeights[i] ?? 0.2
      const orders = Math.max(0, Math.round(ordersCount * weight))
      const visitsCount = orders + randInt(rng, 1, 4)
      repRows.push({
        tenantId,
        userId,
        day: key,
        visits: visitsCount,
        productiveVisits: orders,
        ordersCount: orders,
        orderValuePaise: Math.round(invoicedPaise * weight),
        linesSold: orders * randInt(rng, 2, 5),
        collectedPaise: 0,
      })
    })

    for (let i = 0; i < SHOPS_PER_HISTORY_DAY && shops.length > 0; i++) {
      const shop = pick(rng, shops)
      const shopInvoiced = Math.round((invoicedPaise / SHOPS_PER_HISTORY_DAY) * (0.6 + rng() * 0.8))
      retailerRows.push({
        tenantId,
        retailerId: shop.id,
        day: key,
        ordersCount: 1,
        invoicedPaise: shopInvoiced,
        collectedPaise: rng() < 0.6 ? Math.round(shopInvoiced * (0.5 + rng() * 0.5)) : 0,
        linesSold: randInt(rng, 2, 6),
      })
    }
  }

  // A shop may be drawn twice on the same day; the primary key allows one row, so fold them.
  const foldedRetailer = new Map<string, typeof dailyRetailerStats.$inferInsert>()
  for (const row of retailerRows) {
    const k = `${String(row.retailerId)}:${String(row.day)}`
    const existing = foldedRetailer.get(k)
    if (!existing) foldedRetailer.set(k, row)
    else {
      existing.ordersCount = (existing.ordersCount ?? 0) + (row.ordersCount ?? 0)
      existing.invoicedPaise = (existing.invoicedPaise ?? 0) + (row.invoicedPaise ?? 0)
      existing.collectedPaise = (existing.collectedPaise ?? 0) + (row.collectedPaise ?? 0)
      existing.linesSold = (existing.linesSold ?? 0) + (row.linesSold ?? 0)
    }
  }

  await upsertMany(
    db,
    dailyTenantStats,
    tenantRows,
    [dailyTenantStats.tenantId, dailyTenantStats.day],
    [
      'ordersCount',
      'invoicedPaise',
      'collectedPaise',
      'outstandingPaise',
      'overduePaise',
      'deliveredStops',
      'partialStops',
      'failedStops',
      'onTimeStops',
      'podStops',
      'orderedPcs',
      'pickedPcs',
      'activeRetailers',
      'byBrand',
      'byCategory',
      'byBeat',
      'byPaymentMode',
    ],
  )
  await upsertMany(
    db,
    dailyOwnerStats,
    ownerRows,
    [dailyOwnerStats.tenantId, dailyOwnerStats.day],
    [
      'netSalesPaise',
      'cogsPaise',
      'grossMarginPaise',
      'stockValuePaise',
      'nearExpiryValuePaise',
      'schemeSpendCompanyPaise',
      'schemeSpendDistributorPaise',
      'byBrand',
    ],
  )
  await upsertMany(
    db,
    dailyRepStats,
    repRows,
    [dailyRepStats.tenantId, dailyRepStats.userId, dailyRepStats.day],
    ['visits', 'productiveVisits', 'ordersCount', 'orderValuePaise', 'linesSold', 'collectedPaise'],
  )
  await upsertMany(
    db,
    dailyRetailerStats,
    [...foldedRetailer.values()],
    [dailyRetailerStats.tenantId, dailyRetailerStats.retailerId, dailyRetailerStats.day],
    ['ordersCount', 'invoicedPaise', 'collectedPaise', 'linesSold'],
  )
}

/**
 * `export_jobs` rows with reporting's own `report_<register>_<format>` kinds, so `reporting.exports.get`
 * answers a real job on first load and the owner's Exports screen has a history: two files already
 * rendered, one still queued, and one that failed for a reason a human can read.
 */
async function seedReportExports(db: Db, tenantId: string, people: PeopleResult): Promise<void> {
  const monthStart = `${isoDate(TODAY).slice(0, 7)}-01`
  const today = isoDate(TODAY)
  const rows: (typeof exportJobs.$inferInsert)[] = [
    {
      id: demoId('export-job', 'report-gst-sales-csv'),
      tenantId,
      kind: 'report_gstSalesRegister_csv',
      params: { from: monthStart, to: today, groupBy: 'hsn' },
      status: 'succeeded' as const,
      requestedBy: people.accountant.id,
      objectKey: `tenant/${tenantId}/exports/${demoId('export-job', 'report-gst-sales-csv')}/gst-sales-${monthStart}-to-${today}.csv`,
      rowCount: 12,
      startedAt: atIstTime(daysAgo(1), 11, 5),
      finishedAt: atIstTime(daysAgo(1), 11, 6),
      createdAt: atIstTime(daysAgo(1), 11, 4),
    },
    {
      id: demoId('export-job', 'report-daily-sales-csv'),
      tenantId,
      kind: 'report_dailySales_csv',
      params: { from: isoDate(daysAgo(13)), to: today, limit: 50 },
      status: 'succeeded' as const,
      requestedBy: people.owner.id,
      objectKey: `tenant/${tenantId}/exports/${demoId('export-job', 'report-daily-sales-csv')}/daily-sales-${isoDate(daysAgo(13))}-to-${today}.csv`,
      rowCount: 12,
      startedAt: atIstTime(daysAgo(2), 19, 30),
      finishedAt: atIstTime(daysAgo(2), 19, 31),
      createdAt: atIstTime(daysAgo(2), 19, 29),
    },
    {
      id: demoId('export-job', 'report-stock-value-csv'),
      tenantId,
      kind: 'report_stockValue_csv',
      params: { nearExpiryDays: 90, limit: 50 },
      status: 'queued' as const,
      requestedBy: people.owner.id,
      createdAt: atIstTime(TODAY, 9, 15),
    },
    {
      id: demoId('export-job', 'report-gst-purchase-csv'),
      tenantId,
      kind: 'report_gstPurchaseRegister_csv',
      params: { from: monthStart, to: today },
      status: 'failed' as const,
      requestedBy: people.accountant.id,
      error: 'no supplier invoices were received in this window',
      startedAt: atIstTime(daysAgo(3), 16, 2),
      finishedAt: atIstTime(daysAgo(3), 16, 2),
      createdAt: atIstTime(daysAgo(3), 16, 1),
    },
  ]
  await insertMany(db, exportJobs, rows)
}
