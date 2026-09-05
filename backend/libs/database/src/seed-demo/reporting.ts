/** Visits, pre-aggregated stats, approvals, audit trail, sync errors and notifications. */
import { insertMany } from './db-helpers.js'
import {
  approvals,
  auditLog,
  dailyRepStats,
  dailyTenantStats,
  messages,
  ownerSummary,
  retailerBehaviour,
  syncErrors,
  templates,
  visits,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { OrderRecord, SalesResult } from './sales.js'
import type { RetailerRow, RetailersResult } from './retailers.js'
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
  retailersRes: RetailersResult,
  sales: SalesResult,
  people: PeopleResult,
): Promise<void> {
  const rng = makeRng('dos-demo:reporting')
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

  const tenantStatRows: (typeof dailyTenantStats.$inferInsert)[] = []
  for (const day of workDays) {
    const key = isoDate(day)
    const dayOrders = ordersByDay.get(key) ?? []
    const invoicedPaise = invoicesByDay.get(key) ?? 0
    const ageDays = Math.round((TODAY.getTime() - day.getTime()) / 86_400_000)
    const collectedPaise = ageDays >= 2 ? Math.round(invoicedPaise * (0.5 + rng() * 0.3)) : 0
    const activeRetailers = new Set(dayOrders.map((o) => o.retailerId)).size
    const deliveredStops = dayOrders.filter((o) =>
      ['packed', 'dispatched', 'delivered', 'closed'].includes(o.state),
    ).length
    tenantStatRows.push({
      tenantId,
      day: key,
      ordersCount: dayOrders.length,
      invoicedPaise,
      collectedPaise,
      outstandingPaise: Math.max(0, invoicedPaise - collectedPaise),
      deliveredStops,
      failedStops: deliveredStops > 0 && randChance(rng, 0.2) ? 1 : 0,
      activeRetailers,
    })
  }
  await insertMany(db, dailyTenantStats, tenantStatRows)

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

  // --- WhatsApp notifications for a sample of recent invoices, and the invoice_issued templates. ---
  const recentInvoices = sales.invoices.slice(0, 10)
  const messageRows = recentInvoices.map((inv, i) => {
    const retailer = retailerById.get(inv.retailerId)
    return {
      id: demoId('message', inv.id),
      tenantId,
      channel: 'whatsapp' as const,
      templateKey: 'invoice_issued',
      to: retailer?.phone ?? '+919800000000',
      recipientRetailerId: inv.retailerId,
      locale: 'hi-IN',
      payload: {
        invoiceNo: inv.invoiceNo,
        amountPaise: inv.totalPaise,
        retailerName: retailer?.name ?? '',
      },
      status: i < 8 ? ('delivered' as const) : ('sent' as const),
      costPaise: 35,
      refType: 'invoice',
      refId: inv.id,
      sentAt: atIstTime(inv.invoiceDate, 18, 35),
      deliveredAt: i < 8 ? atIstTime(inv.invoiceDate, 18, 36) : null,
      idempotencyKey: `whatsapp:invoice_issued:${inv.id}`,
    }
  })
  await insertMany(db, messages, messageRows)

  await insertMany(db, templates, [
    {
      id: demoId('template', 'invoice_issued:hi'),
      tenantId,
      key: 'invoice_issued',
      channel: 'whatsapp' as const,
      locale: 'hi-IN',
      providerTemplateName: 'invoice_issued_hi',
      body: 'नमस्ते {{retailerName}}, आपका बिल {{invoiceNo}} राशि ₹{{amount}} जारी हो गया है। धन्यवाद - Tarsun Enterprises',
      variables: ['retailerName', 'invoiceNo', 'amount'],
    },
    {
      id: demoId('template', 'invoice_issued:en'),
      tenantId,
      key: 'invoice_issued',
      channel: 'whatsapp' as const,
      locale: 'en-IN',
      providerTemplateName: 'invoice_issued_en',
      body: 'Hi {{retailerName}}, your invoice {{invoiceNo}} for ₹{{amount}} has been issued. Thank you - Tarsun Enterprises',
      variables: ['retailerName', 'invoiceNo', 'amount'],
    },
  ])
}
