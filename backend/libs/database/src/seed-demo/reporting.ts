/** Visits, pre-aggregated stats, approvals, audit trail and sync errors (notifications: seed-demo/notifications.ts). */
import { insertMany, upsertMany } from './db-helpers.js'
import {
  approvals,
  auditLog,
  dailyOwnerStats,
  dailyRepStats,
  dailyRetailerStats,
  dailyTenantStats,
  ownerSummary,
  retailerBehaviour,
  syncErrors,
  visits,
  type DailyMarginMix,
  type DailyMix,
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

  // WhatsApp notifications and templates moved to seed-demo/notifications.ts (module 8).
}
