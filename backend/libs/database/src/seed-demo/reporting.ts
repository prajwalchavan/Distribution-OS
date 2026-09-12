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
import type { PricingResult } from './pricing.js'
import type { InvoiceRecord, OrderRecord, SalesResult } from './sales.js'
import type { RetailersResult } from './retailers.js'
import type { TenantCatalogResult } from './tenant-catalog.js'
import { sql } from 'drizzle-orm'
import {
  atIstTime,
  daysAgo,
  isoDate,
  isWorkingDay,
  jitter,
  makeRng,
  nth,
  occurred,
  pick,
  randInt,
  TODAY,
  workingDaysBack,
} from './util.js'

export interface SeedReportingOptions {
  historyDays?: number
  pricing?: PricingResult
}

export async function seedReporting(
  db: Db,
  tenantId: string,
  variants: VariantRow[],
  tenantCatalog: TenantCatalogResult,
  retailersRes: RetailersResult,
  sales: SalesResult,
  people: PeopleResult,
  opts: SeedReportingOptions = {},
): Promise<void> {
  const historyDays = opts.historyDays ?? 90
  const rng = makeRng('dos-demo:reporting')
  // A second generator for the day-series columns added with migration 0027, so the draws below that
  // shaped the visits, the approvals and the sync errors on the founder's database stay exactly as they were.
  const seriesRng = makeRng('dos-demo:reporting:series')
  const variantById = new Map(variants.map((v) => [v.id, v]))
  const retailerById = new Map(retailersRes.retailers.map((r) => [r.id, r]))

  // --- visits: every call the reps made on their beats (the sales seed walked them), productive or
  //     not, and a rep's day summed from them. ---
  const workDays = workingDaysBack(historyDays)
  const visitRows: (typeof visits.$inferInsert)[] = []
  const repStatRows: (typeof dailyRepStats.$inferInsert)[] = []
  const orderByIdForVisits = new Map(sales.orders.map((o) => [o.id, o]))
  const repDay = new Map<
    string,
    {
      userId: string
      day: string
      visits: number
      productive: number
      orders: number
      value: number
      lines: number
    }
  >()
  for (const v of sales.visits) {
    const retailer = retailerById.get(v.retailerId)
    visitRows.push({
      id: demoId('visit', v.key),
      tenantId,
      retailerId: v.retailerId,
      userId: v.userId,
      beatId: demoId('beat', retailersRes.beats[v.beatIndex]?.key ?? ''),
      startedAt: occurred(v.startedAt),
      endedAt: occurred(v.endedAt),
      outcome: v.outcome,
      reason: v.reason,
      lat: retailer ? jitter(rng, retailer.lat, 0.0003) : null,
      lng: retailer ? jitter(rng, retailer.lng, 0.0003) : null,
      createdAt: occurred(v.startedAt),
    })
    const key = `${v.userId}:${isoDate(v.day)}`
    const row = repDay.get(key) ?? {
      userId: v.userId,
      day: isoDate(v.day),
      visits: 0,
      productive: 0,
      orders: 0,
      value: 0,
      lines: 0,
    }
    row.visits += 1
    if (v.outcome === 'ordered' && v.orderId) {
      const o = orderByIdForVisits.get(v.orderId)
      row.productive += 1
      row.orders += 1
      row.value += o?.totalPaise ?? 0
      row.lines += o?.lineCount ?? 0
    }
    repDay.set(key, row)
  }
  // the reps who took no call on a day still get a zero row, so the leaderboard has every day;
  // the cash a rep collected is the register's, by the person who took it
  const collectedByRep = new Map<string, number>()
  for (const row of (
    await db.execute(sql`
      select r.received_by as user_id,
             to_char(r.received_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day,
             sum(r.amount_paise)::bigint as paise
        from receipts r
       where r.tenant_id = ${tenantId} and r.status in ('collected', 'deposited')
       group by 1, 2`)
  ).rows as { user_id: string; day: string; paise: string | number }[]) {
    collectedByRep.set(`${row.user_id}|${row.day}`, Number(row.paise))
  }
  const repIds = [
    people.salespeople.rahul.id,
    people.salespeople.amit.id,
    people.salespeople.pooja.id,
    ...people.extra.filter((p) => p.role === 'salesperson').map((p) => p.id),
  ]
  for (const day of workDays) {
    for (const userId of repIds) {
      const key = `${userId}:${isoDate(day)}`
      const row = repDay.get(key)
      repStatRows.push({
        tenantId,
        userId,
        day: isoDate(day),
        visits: row?.visits ?? 0,
        productiveVisits: row?.productive ?? 0,
        ordersCount: row?.orders ?? 0,
        orderValuePaise: row?.value ?? 0,
        linesSold: row?.lines ?? 0,
        collectedPaise: collectedByRep.get(`${userId}|${isoDate(day)}`) ?? 0,
      })
    }
  }
  await insertMany(db, visits, visitRows)
  await upsertMany(
    db,
    dailyRepStats,
    repStatRows,
    [dailyRepStats.tenantId, dailyRepStats.userId, dailyRepStats.day],
    ['visits', 'productiveVisits', 'ordersCount', 'orderValuePaise', 'linesSold', 'collectedPaise'],
  )

  // --- what the day really held, from the tables (2026-09-08 review: the read-models must tie to
  //     the ledgers they summarise — the day book, the receipts register, the stock at cost). ---
  const ordersByDay = new Map<string, OrderRecord[]>()
  for (const o of sales.orders) {
    const key = isoDate(o.day)
    const arr = ordersByDay.get(key) ?? []
    arr.push(o)
    ordersByDay.set(key, arr)
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

  const book = await readDayBook(db, tenantId)
  const dues = outstandingSeries(book, workDays)
  const stockSeries = await stockValueSeries(db, tenantId, tenantCatalog, workDays)

  const tenantStatRows: (typeof dailyTenantStats.$inferInsert)[] = []
  const ownerStatRows: (typeof dailyOwnerStats.$inferInsert)[] = []
  for (const day of workDays) {
    const key = isoDate(day)
    const dayOrders = ordersByDay.get(key) ?? []
    const dayInvoices = invoiceRowsByDay.get(key) ?? []
    const invoicedPaise = book.invoicedByDay.get(key) ?? 0
    const collected = book.collectedByDay.get(key)
    const collectedPaise = collected?.total ?? 0
    const activeRetailers = new Set(dayOrders.map((o) => o.retailerId)).size
    const deliveredStops = dayOrders.filter((o) =>
      ['packed', 'dispatched', 'delivered', 'partially_delivered'].includes(o.state),
    ).length
    const failedStops = dayOrders.filter((o) =>
      o.stops.some((st) => st.outcome === 'failed'),
    ).length

    // --- the day-series columns of 0027: the outstanding trend's overdue line, the last mile's
    //     partial / on-time / POD counters, the fill rate's pieces, and the four mixes. ---
    const due = dues.get(key) ?? { outstanding: 0, overdue: 0 }
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
      }
      for (const [k, paise] of brandsOnInvoice) addMix(byBrand, k, paise)
      for (const [k, paise] of categoriesOnInvoice) addMix(byCategory, k, paise)
    }

    tenantStatRows.push({
      tenantId,
      day: key,
      ordersCount:
        book.orderCountByDay.get(key) ?? dayOrders.filter((o) => o.state !== 'draft').length,
      invoicedPaise,
      collectedPaise,
      outstandingPaise: due.outstanding,
      overduePaise: due.overdue,
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
      byPaymentMode: collected?.byMode ?? {},
    })

    // the cost-bearing half of the day (back office only): net sales ex-GST against landed cost,
    // closing stock at cost, and the scheme spend split by who funds it — all from the tables
    const margin = book.marginByDay.get(key)
    const stockAt = stockSeries.get(key) ?? { stockValuePaise: 0, nearExpiryValuePaise: 0 }
    const spend = book.schemeSpendByDay.get(key)
    ownerStatRows.push({
      tenantId,
      day: key,
      netSalesPaise: margin?.netSalesPaise ?? 0,
      cogsPaise: margin?.cogsPaise ?? 0,
      grossMarginPaise: (margin?.netSalesPaise ?? 0) - (margin?.cogsPaise ?? 0),
      stockValuePaise: stockAt.stockValuePaise,
      nearExpiryValuePaise: stockAt.nearExpiryValuePaise,
      schemeSpendCompanyPaise: spend?.company ?? 0,
      schemeSpendDistributorPaise: spend?.distributor ?? 0,
      byBrand: margin?.byBrand ?? {},
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
  for (const inv of sales.invoices) {
    const row = retailerDayRow(inv.retailerId, isoDate(inv.invoiceDate))
    row.invoicedPaise = (row.invoicedPaise ?? 0) + inv.totalPaise
  }
  // the money on the day it actually came in, from the receipts register
  for (const [k, paise] of book.collectedByRetailerDay) {
    const [retailerId, dayKey] = k.split('|') as [string, string]
    if (!retailerById.has(retailerId)) continue
    const row = retailerDayRow(retailerId, dayKey)
    row.collectedPaise = (row.collectedPaise ?? 0) + paise
  }
  await upsertMany(
    db,
    dailyRetailerStats,
    [...retailerStatByKey.values()],
    [dailyRetailerStats.tenantId, dailyRetailerStats.retailerId, dailyRetailerStats.day],
    ['ordersCount', 'invoicedPaise', 'collectedPaise', 'linesSold'],
  )

  // --- retailer_behaviour: one row per retailer, from the shop's own trail. ---
  const ordersByRetailer = new Map<string, OrderRecord[]>()
  for (const o of sales.orders) {
    if (o.state === 'draft' || o.state === 'cancelled') continue
    const arr = ordersByRetailer.get(o.retailerId) ?? []
    arr.push(o)
    ordersByRetailer.set(o.retailerId, arr)
  }
  const unitsByRetailer30 = new Map<string, number>()
  for (const inv of sales.invoices) {
    if (inv.ageDays > 30) continue
    const pcs = inv.lines.reduce((n, l) => n + l.qtyPcs + l.freeQtyPcs, 0)
    unitsByRetailer30.set(inv.retailerId, (unitsByRetailer30.get(inv.retailerId) ?? 0) + pcs)
  }
  const lastVisitByRetailer = new Map<string, Date>()
  for (const v of sales.visits) {
    const prev = lastVisitByRetailer.get(v.retailerId)
    if (!prev || v.startedAt.getTime() > prev.getTime())
      lastVisitByRetailer.set(v.retailerId, v.startedAt)
  }
  const behaviourRows: (typeof retailerBehaviour.$inferInsert)[] = []
  for (const r of retailersRes.retailers) {
    const rOrders = (ordersByRetailer.get(r.id) ?? []).sort(
      (a, b) => a.day.getTime() - b.day.getTime(),
    )
    const last = rOrders[rOrders.length - 1]
    const recent = rOrders.filter((o) => daysAgo(30).getTime() <= o.day.getTime())
    const valueLast30 = recent.reduce((s, o) => s + o.totalPaise, 0)
    const pay = book.paymentByRetailer.get(r.id)
    const lastVisit = lastVisitByRetailer.get(r.id)
    behaviourRows.push({
      tenantId,
      retailerId: r.id,
      lastOrderAt: last ? occurred(atIstTime(last.day, 12, 0)) : null,
      lastVisitAt: lastVisit ? occurred(lastVisit) : null,
      lastPaymentAt: pay?.lastPaymentAt ?? null,
      ordersLast30: recent.length,
      valueLast30Paise: valueLast30,
      avgDaysToPay: pay?.avgDaysToPay ?? null,
      usualBasket: [],
      lapsedRisk:
        recent.length === 0 ? (rOrders.length === 0 ? 70 : 55) : recent.length < 2 ? 30 : 0,
      unitsLast30: unitsByRetailer30.get(r.id) ?? 0,
    })
  }
  await upsertMany(
    db,
    retailerBehaviour,
    behaviourRows,
    [retailerBehaviour.tenantId, retailerBehaviour.retailerId],
    [
      'lastOrderAt',
      'lastVisitAt',
      'lastPaymentAt',
      'ordersLast30',
      'valueLast30Paise',
      'avgDaysToPay',
      'lapsedRisk',
      'unitsLast30',
    ],
  )

  // --- the approvals matrix (spec §2.9): every kind in every status, hung on the orders and bargain
  //     requests the sales and pricing seeds wrote for exactly this purpose. ---
  const approvalRows: (typeof approvals.$inferInsert)[] = []
  const decidedAt = (ageDays: number) => occurred(atIstTime(daysAgo(ageDays), 12, 30))
  for (const c of sales.approvalCases) {
    const retailer = retailerById.get(c.retailerId)
    const decided = c.status !== 'pending'
    const payload =
      c.kind === 'credit_limit'
        ? {
            currentLimitPaise: retailer?.creditLimitPaise ?? 0,
            requestedLimitPaise: (retailer?.creditLimitPaise ?? 0) + 2_000_000,
            reason: 'Festive season stocking, retailer asked for a temporary bump.',
          }
        : c.kind === 'below_floor'
          ? { note: 'Rep sold below the tier floor; owner to decide.', floorBasis: 'tier_price' }
          : { note: 'Retailer wants ₹2/piece off list.', bargainId: c.bargainId }
    approvalRows.push({
      id: demoId('approval', c.key),
      tenantId,
      kind: c.kind,
      orderId: c.orderId,
      entityType:
        c.kind === 'bargain' ? 'bargain_request' : c.kind === 'credit_limit' ? 'retailer' : 'order',
      entityId:
        c.kind === 'bargain'
          ? (c.bargainId ?? c.orderId)
          : c.kind === 'credit_limit'
            ? c.retailerId
            : c.orderId,
      requestedBy: people.salespeople.rahul.id,
      status: c.status,
      payload,
      decidedBy: decided ? people.owner.id : null,
      decidedAt: decided ? decidedAt(c.ageDays) : null,
      decisionNote: decided
        ? c.status === 'approved'
          ? 'Approved: good payer, festive stocking.'
          : 'Rejected: dues outstanding beyond terms.'
        : null,
      createdAt: occurred(atIstTime(daysAgo(c.ageDays), 10, 30)),
    })
  }
  const bargains = opts.pricing?.bargains ?? []
  bargains
    .filter((b) => b.status === 'requested')
    .forEach((b, i) => {
      approvalRows.push({
        id: demoId('approval', i === 0 ? 'bargain-1' : `bargain-pending-${i + 1}`),
        tenantId,
        kind: 'bargain' as const,
        entityType: 'bargain_request',
        entityId: b.id,
        requestedBy: people.salespeople.rahul.id,
        status: 'pending' as const,
        payload: {
          note: 'Retailer wants ₹2/piece off list.',
          askedRatePaise: b.askedRatePaise,
          listRatePaise: b.listRatePaise,
        },
        createdAt: occurred(atIstTime(daysAgo(b.ageDays), 11, 20)),
      })
    })
  const expiredBargain = bargains.find((b) => b.status === 'expired')
  if (expiredBargain) {
    approvalRows.push({
      id: demoId('approval', 'bargain-expired-1'),
      tenantId,
      kind: 'bargain' as const,
      entityType: 'bargain_request',
      entityId: expiredBargain.id,
      requestedBy: people.salespeople.rahul.id,
      status: 'expired' as const,
      payload: { note: 'Nobody answered; the request lapsed with the order.' },
      // the gate lapsed when the order behind it was withdrawn: the system, not a person, closed it
      decidedBy: people.salespeople.rahul.id,
      decidedAt: atIstTime(daysAgo(expiredBargain.ageDays - 3), 18, 0),
      decisionNote: 'Expired unanswered.',
      createdAt: atIstTime(daysAgo(expiredBargain.ageDays), 11, 20),
    })
  }
  await insertMany(db, approvals, approvalRows)
  // The owner's home tile (`owner_summary`) is written LAST of all, by `seedReportingClose`, from
  // the tables every seed has finished with: the same sums the worker's rollup makes.

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
    createdAt: occurred(atIstTime(daysAgo(randInt(rng, 0, 6)), randInt(rng, 9, 18), 0)),
  }))
  await insertMany(db, syncErrors, syncErrorRows)

  // --- the backdated history the owner's graphs are drawn on. ---
  await seedRollupHistory(
    db,
    tenantId,
    tenantStatRows,
    ownerStatRows,
    repStatRows,
    retailersRes,
    historyDays,
  )

  // --- report exports: two ready files, one still rendering, one that found nothing. ---
  await seedReportExports(db, tenantId, people)

  // WhatsApp notifications and templates moved to seed-demo/notifications.ts (module 8).
}

/** The tables' own truth for the live window, read once: the day book the rollups must tie to. */
interface DayBook {
  orderCountByDay: Map<string, number>
  invoicedByDay: Map<string, number>
  collectedByDay: Map<string, { total: number; byMode: DailyPaymentModeMix }>
  collectedByRetailerDay: Map<string, number>
  marginByDay: Map<string, { netSalesPaise: number; cogsPaise: number; byBrand: DailyMarginMix }>
  schemeSpendByDay: Map<string, { company: number; distributor: number }>
  paymentByRetailer: Map<string, { lastPaymentAt: Date | null; avgDaysToPay: number | null }>
  bills: { id: string; invoiceDate: string; dueDate: string; totalPaise: number }[]
  allocationsByInvoice: Map<string, { day: string; paise: number }[]>
}

async function readDayBook(db: Db, tenantId: string): Promise<DayBook> {
  const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
  const orderCountByDay = new Map<string, number>()
  for (const r of (
    await db.execute(sql`
      select to_char((coalesce(o.submitted_at, o.created_at) at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day,
             count(*)::int as n
        from sales_orders o
       where o.tenant_id = ${tenantId} and o.state <> 'draft'
       group by 1`)
  ).rows as { day: string; n: number }[])
    orderCountByDay.set(r.day, n(r.n))
  // every bill of the day, whatever raised it (the worker's rollup counts them the same way)
  const invoicedByDay = new Map<string, number>()
  for (const r of (
    await db.execute(sql`
      select to_char(i.invoice_date, 'YYYY-MM-DD') as day, sum(i.total_paise)::bigint as paise
        from invoices i
       where i.tenant_id = ${tenantId} and i.state not in ('draft', 'cancelled')
       group by 1`)
  ).rows as { day: string; paise: string | number }[])
    invoicedByDay.set(r.day, n(r.paise))
  const collectedByDay = new Map<string, { total: number; byMode: DailyPaymentModeMix }>()
  const collectedByRetailerDay = new Map<string, number>()
  for (const r of (
    await db.execute(sql`
      select to_char(r.received_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day,
             r.mode::text as mode, r.retailer_id, sum(r.amount_paise)::bigint as paise
        from receipts r
       where r.tenant_id = ${tenantId} and r.status in ('collected', 'deposited')
       group by 1, 2, 3`)
  ).rows as { day: string; mode: string; retailer_id: string; paise: string | number }[]) {
    const entry = collectedByDay.get(r.day) ?? { total: 0, byMode: {} }
    entry.total += n(r.paise)
    entry.byMode[r.mode] = (entry.byMode[r.mode] ?? 0) + n(r.paise)
    collectedByDay.set(r.day, entry)
    const k = `${r.retailer_id}|${r.day}`
    collectedByRetailerDay.set(k, (collectedByRetailerDay.get(k) ?? 0) + n(r.paise))
  }
  const marginByDay = new Map<
    string,
    { netSalesPaise: number; cogsPaise: number; byBrand: DailyMarginMix }
  >()
  for (const r of (
    await db.execute(sql`
      with cost as (
        select distinct on (variant_id) variant_id,
               case when landed_cost_paise > 0 then landed_cost_paise else purchase_rate_paise end as unit_cost
          from tenant_product_costs
         where tenant_id = ${tenantId}
         order by variant_id, (lot_id is null) desc, effective_from desc
      )
      select to_char(i.invoice_date, 'YYYY-MM-DD') as day, coalesce(p.brand_id, 'unknown') as brand_id,
             sum(l.taxable_paise)::bigint as net_sales,
             sum((l.qty_pcs + l.free_qty_pcs) * coalesce(c.unit_cost, 0))::bigint as cogs
        from invoice_lines l
        join invoices i on i.id = l.invoice_id and i.tenant_id = l.tenant_id
        join product_variants v on v.id = l.variant_id
        join products p on p.id = v.product_id
        left join cost c on c.variant_id = l.variant_id
       where l.tenant_id = ${tenantId} and i.state not in ('draft', 'cancelled')
       group by 1, 2`)
  ).rows as {
    day: string
    brand_id: string
    net_sales: string | number
    cogs: string | number
  }[]) {
    const entry = marginByDay.get(r.day) ?? { netSalesPaise: 0, cogsPaise: 0, byBrand: {} }
    entry.netSalesPaise += n(r.net_sales)
    entry.cogsPaise += n(r.cogs)
    entry.byBrand[r.brand_id] = {
      cogsPaise: n(r.cogs),
      grossMarginPaise: n(r.net_sales) - n(r.cogs),
    }
    marginByDay.set(r.day, entry)
  }
  const schemeSpendByDay = new Map<string, { company: number; distributor: number }>()
  for (const r of (
    await db.execute(sql`
      select to_char(i.invoice_date, 'YYYY-MM-DD') as day,
             coalesce(s.funding_source::text, 'company') as funding,
             sum(coalesce((rule ->> 'amountPaise')::bigint, 0))::bigint as paise
        from invoice_lines l
        join invoices i on i.id = l.invoice_id and i.tenant_id = l.tenant_id
        cross join lateral jsonb_array_elements(l.applied_rules) as rule
        left join schemes s on s.id = rule ->> 'ruleId' and s.tenant_id = l.tenant_id
       where l.tenant_id = ${tenantId} and i.state not in ('draft', 'cancelled')
         and rule ->> 'ruleId' is not null
       group by 1, 2`)
  ).rows as { day: string; funding: string; paise: string | number }[]) {
    const entry = schemeSpendByDay.get(r.day) ?? { company: 0, distributor: 0 }
    if (r.funding === 'distributor') entry.distributor += Math.max(0, n(r.paise))
    else entry.company += Math.max(0, n(r.paise))
    schemeSpendByDay.set(r.day, entry)
  }
  const paymentByRetailer = new Map<
    string,
    { lastPaymentAt: Date | null; avgDaysToPay: number | null }
  >()
  for (const r of (
    await db.execute(sql`
      select i.retailer_id,
             max(a.allocated_at) as last_payment_at,
             round(avg((a.allocated_at at time zone 'Asia/Kolkata')::date - i.invoice_date))::int as avg_days
        from allocations a
        join invoices i on i.id = a.invoice_id and i.tenant_id = a.tenant_id
       where a.tenant_id = ${tenantId} and a.receipt_id is not null and a.amount_paise > 0
       group by 1`)
  ).rows as {
    retailer_id: string
    last_payment_at: Date | string | null
    avg_days: number | null
  }[]) {
    paymentByRetailer.set(r.retailer_id, {
      lastPaymentAt: r.last_payment_at === null ? null : new Date(r.last_payment_at),
      avgDaysToPay: r.avg_days === null ? null : n(r.avg_days),
    })
  }
  const bills = (
    (
      await db.execute(sql`
        select i.id, to_char(i.invoice_date, 'YYYY-MM-DD') as invoice_date,
               to_char(coalesce(i.due_date, i.invoice_date), 'YYYY-MM-DD') as due_date, i.total_paise
          from invoices i
         where i.tenant_id = ${tenantId} and i.state not in ('draft', 'cancelled')`)
    ).rows as { id: string; invoice_date: string; due_date: string; total_paise: string | number }[]
  ).map((r) => ({
    id: r.id,
    invoiceDate: r.invoice_date,
    dueDate: r.due_date,
    totalPaise: n(r.total_paise),
  }))
  const allocationsByInvoice = new Map<string, { day: string; paise: number }[]>()
  for (const r of (
    await db.execute(sql`
      select a.invoice_id, to_char(a.allocated_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day,
             a.amount_paise
        from allocations a
       where a.tenant_id = ${tenantId}`)
  ).rows as { invoice_id: string; day: string; amount_paise: string | number }[]) {
    const arr = allocationsByInvoice.get(r.invoice_id) ?? []
    arr.push({ day: r.day, paise: n(r.amount_paise) })
    allocationsByInvoice.set(r.invoice_id, arr)
  }
  return {
    orderCountByDay,
    invoicedByDay,
    collectedByDay,
    collectedByRetailerDay,
    marginByDay,
    schemeSpendByDay,
    paymentByRetailer,
    bills,
    allocationsByInvoice,
  }
}

/**
 * Dues at the close of each day: every bill raised by then less the money matched to it by then —
 * the stock the outstanding trend draws (docs/plans/reporting.md §7: a past day is never zeroed).
 */
function outstandingSeries(
  book: DayBook,
  days: readonly Date[],
): Map<string, { outstanding: number; overdue: number }> {
  const out = new Map<string, { outstanding: number; overdue: number }>()
  for (const day of days) {
    const key = isoDate(day)
    let outstanding = 0
    let overdue = 0
    for (const bill of book.bills) {
      if (bill.invoiceDate > key) continue
      const paid = (book.allocationsByInvoice.get(bill.id) ?? []).reduce(
        (s, a) => (a.day <= key ? s + a.paise : s),
        0,
      )
      const open = bill.totalPaise - paid
      if (open <= 0) continue
      outstanding += open
      if (bill.dueDate < key) overdue += open
    }
    out.set(key, { outstanding, overdue })
  }
  return out
}

/**
 * Closing stock at cost (landed cost, else purchase rate) at the end of each day, replayed from the
 * ledger, and the part of it expiring within ninety days — the same sums `rollupOwnerDay` makes.
 */
async function stockValueSeries(
  db: Db,
  tenantId: string,
  tenantCatalog: TenantCatalogResult,
  days: readonly Date[],
): Promise<Map<string, { stockValuePaise: number; nearExpiryValuePaise: number }>> {
  const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
  const lots = new Map<string, { variantId: string; expiryDate: string | null }>()
  for (const r of (
    await db.execute(sql`
      select l.id, l.variant_id, to_char(l.expiry_date, 'YYYY-MM-DD') as expiry_date
        from stock_lots l where l.tenant_id = ${tenantId}`)
  ).rows as { id: string; variant_id: string; expiry_date: string | null }[])
    lots.set(r.id, { variantId: r.variant_id, expiryDate: r.expiry_date })
  const moves = (
    (
      await db.execute(sql`
        select l.lot_id, l.location_id, l.qty_delta,
               to_char(l.occurred_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day
          from stock_ledger l where l.tenant_id = ${tenantId}
         order by l.occurred_at, l.id`)
    ).rows as { lot_id: string; location_id: string; qty_delta: string | number; day: string }[]
  ).map((r) => ({
    key: `${r.lot_id}|${r.location_id}`,
    lotId: r.lot_id,
    day: r.day,
    qty: n(r.qty_delta),
  }))
  const unitCost = (variantId: string): number => {
    const c = tenantCatalog.costsByVariantId.get(variantId)
    return c ? c.landedCostPaise || c.purchaseRatePaise : 0
  }
  const balance = new Map<string, { lotId: string; onHand: number }>()
  const out = new Map<string, { stockValuePaise: number; nearExpiryValuePaise: number }>()
  let cursor = 0
  for (const day of days) {
    const key = isoDate(day)
    const horizon = isoDate(new Date(day.getTime() + 90 * 86_400_000))
    while (cursor < moves.length && (moves[cursor]?.day ?? '') <= key) {
      const m = moves[cursor]
      cursor += 1
      if (!m) break
      const b = balance.get(m.key) ?? { lotId: m.lotId, onHand: 0 }
      b.onHand += m.qty
      balance.set(m.key, b)
    }
    let stockValuePaise = 0
    let nearExpiryValuePaise = 0
    for (const b of balance.values()) {
      if (b.onHand <= 0) continue
      const lot = lots.get(b.lotId)
      if (!lot) continue
      const value = b.onHand * unitCost(lot.variantId)
      stockValuePaise += value
      if (lot.expiryDate !== null && lot.expiryDate <= horizon) nearExpiryValuePaise += value
    }
    out.set(key, { stockValuePaise, nearExpiryValuePaise })
  }
  return out
}

/**
 * THE LAST WORD ON THE OWNER'S HOME SCREEN. Runs after every other seed has written its stock, its
 * approvals and its trips: the closing stock of the live window is replayed once more from the
 * ledger (the platform-gaps seed moves a few cartons after the rollups were written), and the
 * `owner_summary` row is built from the rollup tables exactly as the worker's `refreshOwnerSummary`
 * builds it — month-to-date sales and margin from the daily rows, dues from the shop rollup, the
 * stock at cost from today's row — so the owner's tiles and the accountant's day book agree.
 */
export async function seedReportingClose(
  db: Db,
  tenantId: string,
  tenantCatalog: TenantCatalogResult,
  opts: { historyDays?: number } = {},
): Promise<void> {
  const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
  const workDays = workingDaysBack(opts.historyDays ?? 90)
  const stockSeries = await stockValueSeries(db, tenantId, tenantCatalog, workDays)
  await upsertMany(
    db,
    dailyOwnerStats,
    workDays.map((day) => ({
      tenantId,
      day: isoDate(day),
      stockValuePaise: stockSeries.get(isoDate(day))?.stockValuePaise ?? 0,
      nearExpiryValuePaise: stockSeries.get(isoDate(day))?.nearExpiryValuePaise ?? 0,
    })),
    [dailyOwnerStats.tenantId, dailyOwnerStats.day],
    ['stockValuePaise', 'nearExpiryValuePaise'],
  )

  const today = isoDate(TODAY)
  const monthStart = `${today.slice(0, 7)}-01`
  const [mtd] = (
    await db.execute(sql`
      select coalesce(sum(invoiced_paise), 0)::bigint as mtd_sales
        from daily_tenant_stats where tenant_id = ${tenantId} and day between ${monthStart} and ${today}`)
  ).rows as { mtd_sales: string | number }[]
  const [margin] = (
    await db.execute(sql`
      select coalesce(sum(gross_margin_paise), 0)::bigint as mtd_margin,
             coalesce(max(stock_value_paise) filter (where day = ${today}), 0)::bigint as stock_value,
             coalesce(max(near_expiry_value_paise) filter (where day = ${today}), 0)::bigint as near_expiry
        from daily_owner_stats where tenant_id = ${tenantId} and day between ${monthStart} and ${today}`)
  ).rows as {
    mtd_margin: string | number
    stock_value: string | number
    near_expiry: string | number
  }[]
  const [todayRow] = (
    await db.execute(sql`
      select invoiced_paise, collected_paise from daily_tenant_stats
       where tenant_id = ${tenantId} and day = ${today}`)
  ).rows as { invoiced_paise: string | number; collected_paise: string | number }[]
  const [dues] = (
    await db.execute(sql`
      select coalesce(sum(outstanding_paise), 0)::bigint as outstanding,
             coalesce(sum(overdue_paise), 0)::bigint as overdue,
             coalesce(sum(bucket_0_7_paise), 0)::bigint as b0_7,
             coalesce(sum(bucket_8_15_paise), 0)::bigint as b8_15,
             coalesce(sum(bucket_16_30_paise), 0)::bigint as b16_30,
             coalesce(sum(bucket_31_60_paise), 0)::bigint as b31_60,
             coalesce(sum(bucket_61_90_paise), 0)::bigint as b61_90,
             coalesce(sum(bucket_90_plus_paise), 0)::bigint as b90_plus
        from retailer_outstanding_summary where tenant_id = ${tenantId}`)
  ).rows as Record<string, string | number>[]
  const [pending] = (
    await db.execute(sql`
      select count(*)::int as pending from approvals where tenant_id = ${tenantId} and status = 'pending'`)
  ).rows as { pending: number }[]
  const [active] = (
    await db.execute(sql`
      select count(*)::int as active from trips
       where tenant_id = ${tenantId} and state in ('planned', 'loading', 'active', 'closing')`)
  ).rows as { active: number }[]
  const [inTransit] = (
    await db.execute(sql`
      select coalesce(sum(r.amount_paise), 0)::bigint as paise
        from receipts r join trips t on t.id = r.trip_id and t.tenant_id = r.tenant_id
       where r.tenant_id = ${tenantId} and r.mode = 'cash' and r.status in ('collected', 'deposited')
         and t.state not in ('settled', 'settled_with_variance', 'cancelled')`)
  ).rows as { paise: string | number }[]
  await db
    .insert(ownerSummary)
    .values({
      tenantId,
      asOf: occurred(atIstTime(TODAY, 18, 0)),
      todayInvoicedPaise: n(todayRow?.invoiced_paise),
      todayCollectedPaise: n(todayRow?.collected_paise),
      totalOutstandingPaise: n(dues?.outstanding),
      overduePaise: n(dues?.overdue),
      mtdSalesPaise: n(mtd?.mtd_sales),
      mtdGrossMarginPaise: n(margin?.mtd_margin),
      stockValuePaise: n(margin?.stock_value),
      nearExpiryValuePaise: n(margin?.near_expiry),
      pendingApprovals: n(pending?.pending),
      activeTrips: n(active?.active),
      detail: {
        cashInTransitPaise: n(inTransit?.paise),
        ageingB0_7: n(dues?.b0_7),
        ageingB8_15: n(dues?.b8_15),
        ageingB16_30: n(dues?.b16_30),
        ageingB31_60: n(dues?.b31_60),
        ageingB61_90: n(dues?.b61_90),
        ageingB90Plus: n(dues?.b90_plus),
      },
    })
    .onConflictDoUpdate({
      target: [ownerSummary.tenantId],
      set: {
        asOf: sql`excluded.as_of`,
        todayInvoicedPaise: sql`excluded.today_invoiced_paise`,
        todayCollectedPaise: sql`excluded.today_collected_paise`,
        totalOutstandingPaise: sql`excluded.total_outstanding_paise`,
        overduePaise: sql`excluded.overdue_paise`,
        mtdSalesPaise: sql`excluded.mtd_sales_paise`,
        mtdGrossMarginPaise: sql`excluded.mtd_gross_margin_paise`,
        stockValuePaise: sql`excluded.stock_value_paise`,
        nearExpiryValuePaise: sql`excluded.near_expiry_value_paise`,
        pendingApprovals: sql`excluded.pending_approvals`,
        activeTrips: sql`excluded.active_trips`,
        detail: sql`excluded.detail`,
      },
    })
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
  /** Where the backdated history stops: the live window of real orders takes over here. */
  liveWindowDays: number,
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

  for (let back = HISTORY_DAYS; back >= liveWindowDays; back--) {
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
      createdAt: occurred(atIstTime(TODAY, 9, 15)),
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
