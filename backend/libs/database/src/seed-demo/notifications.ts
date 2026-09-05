/**
 * Notifications demo data (docs/plans/notifications.md §6, English only): the platform-default
 * templates every tenant starts from, one Tarsun override, the message log of the last fortnight
 * (order confirmations, bills with the pay link, proof of delivery, payments, dues reminders), one
 * scheme broadcast to the Station Road beat, one dead-lettered send for the owner to resend, the
 * staff phones' push tokens, three inbound texts and one open 24-hour window.
 *
 * Every row is keyed with `demoId(...)` and inserted `onConflictDoNothing`, so re-running adds
 * nothing. The payload of every message is what the module writes at queue time — the variables,
 * `distributorName`, `senderName`, the rendered `body`, the provider template name and the positional
 * order — so the seeded log reads exactly like a real one. Runs after sales, delivery and receivables
 * (it points at their orders, bills, stops and receipts); before it, the legacy rows the reporting seed
 * once wrote (Hindi wording, no sender) are removed by id, since a message row is immutable.
 */
import { and, asc, eq, inArray } from 'drizzle-orm'
import { insertMany } from './db-helpers.js'
import {
  broadcasts,
  deliveries,
  inboundMessages,
  messages,
  pushTokens,
  receipts,
  retailerLinks,
  templates,
  tenants,
  tenantSettings,
  whatsappWindows,
} from '../schema/index.js'
import type { Db } from '../client.js'
import { TENANT_SETTING_KEYS } from '../tenant-bootstrap.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import type { SalesResult } from './sales.js'
import type { RetailerRow, RetailersResult } from './retailers.js'
import { atIstTime, daysAgo, isoDate, makeRng, randInt, TODAY } from './util.js'

type Channel = 'whatsapp' | 'sms' | 'push' | 'in_app'
type Status = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped'

/** ₹ from paise the way the module renders it. */
function rupees(paise: number): string {
  const whole = Math.floor(paise / 100)
  return `₹${whole.toLocaleString('en-IN')}.${String(paise % 100).padStart(2, '0')}`
}

const TOKEN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g
function tokens(body: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(TOKEN)) if (m[1] && !out.includes(m[1])) out.push(m[1])
  return out
}
function render(body: string, vars: Record<string, string>): string {
  return body.replace(TOKEN, (whole, name: string) => vars[name] ?? whole)
}

interface PlatformTemplate {
  key: string
  channel: Channel
  body: string
  variables: string[]
}

/**
 * The platform defaults, `tenant_id = null`, `en-IN` (founder: English only). Every WhatsApp / SMS
 * body carries `{{distributorName}}` — the white label — which the service supplies and no template
 * declares. The WhatsApp `provider_template_name` is `<key>_en`, the name the pilot's Meta templates
 * are approved under.
 */
export const PLATFORM_TEMPLATES: readonly PlatformTemplate[] = [
  {
    key: 'order_confirmed',
    channel: 'whatsapp',
    body: 'Your order {{orderNo}} of {{totalRupees}} is confirmed and will be delivered on the next beat day. Thank you! — {{distributorName}}',
    variables: ['orderNo', 'totalRupees'],
  },
  {
    key: 'order_confirmed',
    channel: 'sms',
    body: 'Order {{orderNo}} of {{totalRupees}} confirmed. Delivery on the next beat day. {{distributorName}}',
    variables: ['orderNo', 'totalRupees'],
  },
  {
    key: 'order_cancelled',
    channel: 'whatsapp',
    body: 'Your order {{orderNo}} of {{totalRupees}} has been cancelled. Call us if this is a mistake. — {{distributorName}}',
    variables: ['orderNo', 'totalRupees'],
  },
  {
    key: 'order_cancelled',
    channel: 'sms',
    body: 'Order {{orderNo}} of {{totalRupees}} cancelled. Call us if this is a mistake. {{distributorName}}',
    variables: ['orderNo', 'totalRupees'],
  },
  {
    key: 'order_needs_approval',
    channel: 'push',
    body: 'Order {{orderNo}} of {{totalRupees}} is waiting for your approval.',
    variables: ['orderNo', 'totalRupees'],
  },
  {
    key: 'order_needs_approval',
    channel: 'in_app',
    body: 'Order {{orderNo}} of {{totalRupees}} is waiting for your approval.',
    variables: ['orderNo', 'totalRupees'],
  },
  {
    key: 'invoice_issued',
    channel: 'whatsapp',
    body: 'Your bill {{invoiceNo}} for {{totalRupees}} is ready, due by {{dueDate}}. Pay by UPI: {{upiLink}} — {{distributorName}}',
    variables: ['invoiceNo', 'totalRupees', 'dueDate', 'upiLink'],
  },
  {
    key: 'invoice_issued',
    channel: 'sms',
    body: 'Bill {{invoiceNo}} for {{totalRupees}} issued, due {{dueDate}}. Pay by UPI: {{upiLink}} {{distributorName}}',
    variables: ['invoiceNo', 'totalRupees', 'dueDate', 'upiLink'],
  },
  {
    key: 'pod_delivered',
    channel: 'whatsapp',
    body: 'Your goods against bill {{invoiceRef}} were {{outcome}} today. Thank you for your business! — {{distributorName}}',
    variables: ['invoiceRef', 'outcome'],
  },
  {
    key: 'pod_delivered',
    channel: 'sms',
    body: 'Goods against bill {{invoiceRef}} {{outcome}} today. {{distributorName}}',
    variables: ['invoiceRef', 'outcome'],
  },
  {
    key: 'pod_delivered',
    channel: 'in_app',
    body: 'Your goods against bill {{invoiceRef}} were {{outcome}} today.',
    variables: ['invoiceRef', 'outcome'],
  },
  {
    key: 'payment_received',
    channel: 'whatsapp',
    body: 'Received {{amountRupees}}, receipt {{receiptNo}}. Thank you! — {{distributorName}}',
    variables: ['receiptNo', 'amountRupees'],
  },
  {
    key: 'payment_received',
    channel: 'sms',
    body: 'Received {{amountRupees}}, receipt {{receiptNo}}. Thank you. {{distributorName}}',
    variables: ['receiptNo', 'amountRupees'],
  },
  {
    key: 'dues_reminder',
    channel: 'whatsapp',
    body: 'A gentle reminder: {{overdueRupees}} is overdue on your account since {{oldestDueDate}}. Please pay on the next visit or by UPI. — {{distributorName}}',
    variables: ['overdueRupees', 'oldestDueDate'],
  },
  {
    key: 'dues_reminder',
    channel: 'sms',
    body: 'Reminder: {{overdueRupees}} overdue since {{oldestDueDate}}. Please pay on the next visit or by UPI. {{distributorName}}',
    variables: ['overdueRupees', 'oldestDueDate'],
  },
  {
    key: 'delivery_today',
    channel: 'whatsapp',
    body: 'Our vehicle is on its way: your delivery is scheduled today, {{deliveryDate}} (stop {{stopNo}}). Please keep the payment ready. — {{distributorName}}',
    variables: ['deliveryDate', 'stopNo'],
  },
  {
    key: 'delivery_today',
    channel: 'sms',
    body: 'Delivery today {{deliveryDate}}, stop {{stopNo}}. Please keep the payment ready. {{distributorName}}',
    variables: ['deliveryDate', 'stopNo'],
  },
  {
    key: 'scheme_announcement',
    channel: 'whatsapp',
    body: 'New offer: {{schemeName}}, valid till {{validTill}}. Ask your salesperson or order from the app. — {{distributorName}}',
    variables: ['schemeName', 'validTill'],
  },
  {
    key: 'scheme_announcement',
    channel: 'sms',
    body: 'Offer: {{schemeName}} till {{validTill}}. Ask your salesperson. {{distributorName}}',
    variables: ['schemeName', 'validTill'],
  },
  {
    key: 'scheme_announcement',
    channel: 'in_app',
    body: 'New offer: {{schemeName}}, valid till {{validTill}}.',
    variables: ['schemeName', 'validTill'],
  },
  {
    key: 'welcome',
    channel: 'in_app',
    body: 'Welcome, {{shopName}}! Your bills, dues and orders with {{distributorName}} now live here.',
    variables: ['shopName'],
  },
]

/** Tarsun's own wording for the WhatsApp bill (the one override `templates.list` shows as customised). */
const TARSUN_INVOICE_OVERRIDE =
  'Namaste! Bill {{invoiceNo}} of {{totalRupees}} is ready — pay by {{dueDate}} to keep your 2% cash discount. UPI: {{upiLink}} — {{distributorName}}, Kalyan West'

/** Ids the reporting seed once used for its ten Hindi bill messages and two templates; removed before re-seeding. */
function legacyIds(sales: SalesResult): { messages: string[]; templates: string[] } {
  return {
    messages: sales.invoices.slice(0, 10).map((inv) => demoId('message', inv.id)),
    templates: [demoId('template', 'invoice_issued:hi'), demoId('template', 'invoice_issued:en')],
  }
}

export async function seedNotifications(
  db: Db,
  tenantId: string,
  retailersRes: RetailersResult,
  sales: SalesResult,
  people: PeopleResult,
): Promise<void> {
  const rng = makeRng('dos-demo:notifications')
  const retailerById = new Map(retailersRes.retailers.map((r) => [r.id, r]))
  const [tenant] = await db
    .select({ legalName: tenants.legalName })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
  const settings = await db
    .select({ key: tenantSettings.key, value: tenantSettings.value })
    .from(tenantSettings)
    .where(
      and(
        eq(tenantSettings.tenantId, tenantId),
        inArray(tenantSettings.key, [
          TENANT_SETTING_KEYS.brandingDisplayName,
          TENANT_SETTING_KEYS.upiVpa,
        ]),
      ),
    )
  const setting = (key: string): string | null => {
    const v = settings.find((s) => s.key === key)?.value
    return typeof v === 'string' && v.length > 0 ? v : null
  }
  const distributorName =
    setting(TENANT_SETTING_KEYS.brandingDisplayName) ?? tenant?.legalName ?? 'Tarsun Enterprises'
  const upiVpa = setting(TENANT_SETTING_KEYS.upiVpa)
  const links = await db
    .select({
      retailerId: retailerLinks.retailerId,
      userId: retailerLinks.userId,
      whatsappOptinAt: retailerLinks.whatsappOptinAt,
    })
    .from(retailerLinks)
    .where(and(eq(retailerLinks.tenantId, tenantId), eq(retailerLinks.status, 'active')))
  // Several active links can exist for one shop on a long-lived database (the smoke harness links
  // identities daily): the link that holds a login speaks for the shop, then one that opted in.
  const linkOf = new Map<string, (typeof links)[number]>()
  for (const l of links) {
    const current = linkOf.get(l.retailerId)
    const better =
      !current ||
      (current.userId === null && l.userId !== null) ||
      (current.userId === null && current.whatsappOptinAt === null && l.whatsappOptinAt !== null)
    if (better) linkOf.set(l.retailerId, l)
  }

  // 0. The legacy rows of the reporting seed (Hindi wording, no sender in the payload): a message row
  //    is immutable, so they are removed by id and re-created below in the module's shape.
  const legacy = legacyIds(sales)
  await db
    .delete(messages)
    .where(and(inArray(messages.id, legacy.messages), eq(messages.locale, 'hi-IN')))
  await db.delete(templates).where(inArray(templates.id, legacy.templates))

  // 1. Platform defaults + the Tarsun override.
  await insertMany(
    db,
    templates,
    PLATFORM_TEMPLATES.map((t) => ({
      id: demoId('template', `platform:${t.key}:${t.channel}:en-IN`),
      tenantId: null,
      key: t.key,
      channel: t.channel,
      locale: 'en-IN',
      providerTemplateName: t.channel === 'whatsapp' ? `${t.key}_en` : null,
      body: t.body,
      variables: t.variables,
      active: true,
    })),
  )
  await insertMany(db, templates, [
    {
      id: demoId('template', `${tenantId}:invoice_issued:whatsapp:en-IN`),
      tenantId,
      key: 'invoice_issued',
      channel: 'whatsapp',
      locale: 'en-IN',
      providerTemplateName: 'invoice_issued_tarsun_en',
      body: TARSUN_INVOICE_OVERRIDE,
      variables: ['invoiceNo', 'totalRupees', 'dueDate', 'upiLink'],
      active: true,
    },
  ])
  const templateFor = (
    key: string,
    channel: Channel,
  ): { body: string; providerTemplateName: string | null } => {
    if (key === 'invoice_issued' && channel === 'whatsapp')
      return { body: TARSUN_INVOICE_OVERRIDE, providerTemplateName: 'invoice_issued_tarsun_en' }
    const t = PLATFORM_TEMPLATES.find((p) => p.key === key && p.channel === channel)
    if (!t) throw new Error(`no platform template ${key}/${channel}`)
    return { body: t.body, providerTemplateName: channel === 'whatsapp' ? `${key}_en` : null }
  }

  /** The row the module would have queued: channel by opt-in, the frozen payload, the status trail. */
  const shopMessage = (i: {
    id: string
    retailer: RetailerRow
    templateKey: string
    variables: Record<string, string>
    refType: 'order' | 'invoice' | 'delivery' | 'receipt' | 'retailer' | 'broadcast'
    refId: string
    idempotencyKey: string
    at: Date
    status: Status
    error?: string
    attempts?: number
    forceChannel?: Channel
  }): typeof messages.$inferInsert => {
    const link = linkOf.get(i.retailer.id)
    const channel: Channel = i.forceChannel ?? (link?.whatsappOptinAt ? 'whatsapp' : 'sms')
    const t = templateFor(i.templateKey, channel)
    const all = { ...i.variables, distributorName }
    const sent = i.status !== 'queued' && i.status !== 'failed'
    const delivered = i.status === 'delivered' || i.status === 'read'
    return {
      id: i.id,
      tenantId,
      channel,
      templateKey: i.templateKey,
      to: channel === 'in_app' ? (link?.userId ?? i.retailer.id) : i.retailer.phone,
      recipientUserId: link?.userId ?? null,
      recipientRetailerId: i.retailer.id,
      locale: 'en-IN',
      payload: {
        ...all,
        senderName: distributorName,
        body: render(t.body, all),
        providerTemplateName: t.providerTemplateName,
        variableNames: tokens(t.body),
      },
      status: i.status,
      providerMessageId: sent ? `demo-${channel}-${i.id.slice(-12)}` : null,
      costPaise: sent ? (channel === 'whatsapp' ? 14 : channel === 'sms' ? 20 : 0) : null,
      error: i.error ?? null,
      attempts: i.attempts ?? (i.status === 'queued' ? 0 : 1),
      nextAttemptAt: null,
      refType: i.refType,
      refId: i.refId,
      sentAt: sent ? i.at : null,
      deliveredAt: delivered ? new Date(i.at.getTime() + 60_000) : null,
      readAt: i.status === 'read' ? new Date(i.at.getTime() + 25 * 60_000) : null,
      idempotencyKey: i.idempotencyKey,
      createdAt: i.at,
      updatedAt: i.at,
    }
  }

  const rows: (typeof messages.$inferInsert)[] = []
  const spread = (): Status => {
    const r = randInt(rng, 1, 100)
    return r <= 55 ? 'read' : r <= 90 ? 'delivered' : 'sent'
  }

  // 2. Order confirmations: one per confirmed-or-later order of the fortnight (`OrderConfirmed:<orderId>`).
  const confirmed = sales.orders.filter(
    (o) => o.state !== 'draft' && o.state !== 'submitted' && o.state !== 'cancelled',
  )
  confirmed.forEach((o, i) => {
    const retailer = retailerById.get(o.retailerId)
    if (!retailer) return
    rows.push(
      shopMessage({
        id: demoId('message', `order_confirmed:${o.id}`),
        retailer,
        templateKey: 'order_confirmed',
        variables: {
          orderNo: o.orderNo ?? o.id.slice(-8).toUpperCase(),
          totalRupees: rupees(o.totalPaise),
        },
        refType: 'order',
        refId: o.id,
        idempotencyKey: `OrderConfirmed:${o.id}`,
        at: atIstTime(o.day, 11 + (i % 6), randInt(rng, 0, 59)),
        status: i === confirmed.length - 1 ? 'queued' : spread(),
      }),
    )
  })
  const cancelled = sales.orders.filter((o) => o.state === 'cancelled')
  for (const o of cancelled) {
    const retailer = retailerById.get(o.retailerId)
    if (!retailer) continue
    rows.push(
      shopMessage({
        id: demoId('message', `order_cancelled:${o.id}`),
        retailer,
        templateKey: 'order_cancelled',
        variables: {
          orderNo: o.orderNo ?? o.id.slice(-8).toUpperCase(),
          totalRupees: rupees(o.totalPaise),
        },
        refType: 'order',
        refId: o.id,
        idempotencyKey: `OrderCancelled:${o.id}`,
        at: atIstTime(o.day, 17, 5),
        status: 'delivered',
      }),
    )
  }

  // 3. Bills with the pay link: the ten most recent invoices (the ids the legacy seed used, re-created).
  for (const inv of sales.invoices.slice(0, 10)) {
    const retailer = retailerById.get(inv.retailerId)
    if (!retailer) continue
    const dueDate = isoDate(new Date(inv.invoiceDate.getTime() + retailer.creditDays * 86_400_000))
    const upiLink = upiVpa
      ? `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(distributorName)}&am=${(inv.totalPaise / 100).toFixed(2)}&tr=${encodeURIComponent(inv.invoiceNo.replace(/\//g, '-'))}&cu=INR`
      : ''
    rows.push(
      shopMessage({
        id: demoId('message', inv.id),
        retailer,
        templateKey: 'invoice_issued',
        variables: {
          invoiceNo: inv.invoiceNo,
          totalRupees: rupees(inv.totalPaise),
          dueDate,
          upiLink,
        },
        refType: 'invoice',
        refId: inv.id,
        idempotencyKey: `InvoiceIssued:${inv.id}`,
        at: atIstTime(inv.invoiceDate, 18, 35),
        status: inv.ageDays <= 1 ? 'sent' : 'delivered',
      }),
    )
  }

  // 4. Proof of delivery: every recorded delivery of the road seed, from the database.
  const delivered = await db
    .select({
      id: deliveries.id,
      retailerId: deliveries.retailerId,
      invoiceId: deliveries.invoiceId,
      outcome: deliveries.outcome,
      deliveredAt: deliveries.deliveredAt,
    })
    .from(deliveries)
    .where(
      and(eq(deliveries.tenantId, tenantId), inArray(deliveries.outcome, ['delivered', 'partial'])),
    )
    .orderBy(asc(deliveries.deliveredAt))
    .limit(40)
  for (const d of delivered) {
    const retailer = retailerById.get(d.retailerId)
    if (!retailer) continue
    rows.push(
      shopMessage({
        id: demoId('message', `pod:${d.id}`),
        retailer,
        templateKey: 'pod_delivered',
        variables: {
          invoiceRef: d.invoiceId.slice(-8).toUpperCase(),
          outcome: d.outcome === 'partial' ? 'partly delivered' : 'delivered',
        },
        refType: 'delivery',
        refId: d.id,
        idempotencyKey: `DeliveryRecorded:${d.id}`,
        at: new Date((d.deliveredAt ?? TODAY).getTime() + 30_000),
        status: 'delivered',
      }),
    )
  }

  // 5. Payments: the receipts of the fortnight, from the database (`PaymentReceived:<receiptId>`).
  const paid = await db
    .select({
      id: receipts.id,
      receiptNo: receipts.receiptNo,
      retailerId: receipts.retailerId,
      amountPaise: receipts.amountPaise,
      receivedAt: receipts.receivedAt,
    })
    .from(receipts)
    .where(eq(receipts.tenantId, tenantId))
    .orderBy(asc(receipts.receivedAt))
    .limit(30)
  for (const r of paid) {
    const retailer = retailerById.get(r.retailerId)
    if (!retailer || r.amountPaise <= 0) continue
    rows.push(
      shopMessage({
        id: demoId('message', `payment:${r.id}`),
        retailer,
        templateKey: 'payment_received',
        variables: {
          receiptNo: r.receiptNo ?? r.id.slice(-8).toUpperCase(),
          amountRupees: rupees(r.amountPaise),
        },
        refType: 'receipt',
        refId: r.id,
        idempotencyKey: `PaymentReceived:${r.id}`,
        at: new Date(r.receivedAt.getTime() + 45_000),
        status: 'delivered',
      }),
    )
  }

  // 6. Dues reminders to the strict / stop shops, a week apart at most (the sweep's cooldown).
  const strict = retailersRes.retailers.filter((r) => r.creditMode !== 'indicate').slice(0, 3)
  strict.forEach((retailer, i) => {
    const day = daysAgo(2 + i)
    const outstanding = sales.outstandingByRetailer.get(retailer.id)
    const overdue = outstanding?.outstandingPaise ?? 125_000 * (i + 1)
    rows.push(
      shopMessage({
        id: demoId('message', `dues:${retailer.id}:${isoDate(day)}`),
        retailer,
        templateKey: 'dues_reminder',
        variables: {
          overdueRupees: rupees(overdue),
          oldestDueDate: outstanding?.oldestDueDate ?? isoDate(daysAgo(20)),
        },
        refType: 'retailer',
        refId: retailer.id,
        idempotencyKey: `DuesReminder:${retailer.id}:${isoDate(day)}`,
        at: atIstTime(day, 9, 0),
        status: 'delivered',
      }),
    )
  })

  // 7. One scheme broadcast to the Station Road beat (beat 0), by the owner, three days ago.
  const broadcastId = demoId('broadcast', 'campa-12-plus-1:station-road')
  const stationRoad = retailersRes.retailers.filter((r) => r.beatIndex === 0)
  const broadcastAt = atIstTime(daysAgo(3), 10, 30)
  for (const retailer of stationRoad) {
    rows.push(
      shopMessage({
        id: demoId('message', `broadcast:${broadcastId}:${retailer.id}`),
        retailer,
        templateKey: 'scheme_announcement',
        variables: { schemeName: 'Campa 750 ml: buy 12 get 1 free', validTill: '30 Sep 2026' },
        refType: 'broadcast',
        refId: broadcastId,
        idempotencyKey: `${broadcastId}:${retailer.id}`,
        at: new Date(broadcastAt.getTime() + 90_000),
        status: spread(),
      }),
    )
  }

  // 8. One dead-lettered send for the owner's log: five attempts, MSG91's own words.
  const unlucky = retailersRes.retailers[6]
  const unluckyOrder = confirmed.find((o) => o.retailerId === unlucky?.id) ?? confirmed[0]
  if (unlucky && unluckyOrder) {
    rows.push(
      shopMessage({
        id: demoId('message', `dead:${unlucky.id}`),
        retailer: unlucky,
        templateKey: 'payment_received',
        variables: { receiptNo: 'RCPT-FLD-0007', amountRupees: rupees(180_000) },
        refType: 'receipt',
        refId: demoId('receipt', 'dead-letter-demo'),
        idempotencyKey: `PaymentReceived:${demoId('receipt', 'dead-letter-demo')}`,
        at: atIstTime(daysAgo(1), 16, 10),
        status: 'failed',
        error: 'MSG91: invalid destination number',
        attempts: 5,
        forceChannel: 'sms',
      }),
    )
  }

  // 9. An in-app welcome for the two shop logins (`Welcome:<retailerId>`), one already read.
  for (const [i, code] of retailersRes.linkedRetailerCodes.entries()) {
    const retailer = retailersRes.retailers.find((r) => r.code === code)
    const link = retailer ? linkOf.get(retailer.id) : undefined
    if (!retailer || !link?.userId) continue
    rows.push(
      shopMessage({
        id: demoId('message', `welcome:${retailer.id}`),
        retailer,
        templateKey: 'welcome',
        variables: { shopName: retailer.name },
        refType: 'retailer',
        refId: retailer.id,
        idempotencyKey: `Welcome:${retailer.id}`,
        at: atIstTime(daysAgo(12), 9, 15),
        status: i === 0 ? 'read' : 'delivered',
        forceChannel: 'in_app',
      }),
    )
  }
  // 9b. Staff notices in the apps' own inboxes: the desk is told the last submitted order waits for
  //     a decision; the field team is told the offer the owner just broadcast (no deep link).
  const waiting = [...sales.orders].reverse().find((o) => o.state === 'submitted') ?? confirmed[0]
  const staffNotice = (i: {
    key: string
    person: { id: string }
    templateKey: string
    variables: Record<string, string>
    refType: 'order' | null
    refId: string | null
    idempotencyKey: string
    at: Date
  }): typeof messages.$inferInsert => {
    const t = templateFor(i.templateKey, 'in_app')
    const all = { ...i.variables, distributorName }
    return {
      id: demoId('message', `staff:${i.key}`),
      tenantId,
      channel: 'in_app',
      templateKey: i.templateKey,
      to: i.person.id,
      recipientUserId: i.person.id,
      recipientRetailerId: null,
      locale: 'en-IN',
      payload: {
        ...all,
        senderName: distributorName,
        body: render(t.body, all),
        providerTemplateName: null,
        variableNames: tokens(t.body),
      },
      status: 'delivered',
      costPaise: 0,
      attempts: 1,
      refType: i.refType,
      refId: i.refId,
      sentAt: i.at,
      deliveredAt: i.at,
      readAt: null,
      idempotencyKey: i.idempotencyKey,
      createdAt: i.at,
      updatedAt: i.at,
    }
  }
  if (waiting) {
    for (const [key, person] of [
      ['owner', people.owner],
      ['manager', people.manager],
      ['accountant', people.accountant],
    ] as const) {
      rows.push(
        staffNotice({
          key: `approval:${key}`,
          person,
          templateKey: 'order_needs_approval',
          variables: {
            orderNo: waiting.orderNo ?? waiting.id.slice(-8).toUpperCase(),
            totalRupees: rupees(waiting.totalPaise),
          },
          refType: 'order',
          refId: waiting.id,
          idempotencyKey: `OrderSubmitted:${waiting.id}:in_app:${person.id}`,
          at: atIstTime(waiting.day, 12, 5),
        }),
      )
    }
  }
  for (const [key, person] of [
    ['rep-rahul', people.salespeople.rahul],
    ['rep-amit', people.salespeople.amit],
    ['rep-pooja', people.salespeople.pooja],
    ['warehouse-dinesh', people.warehouse],
    ['warehouse-kavita', people.warehouse2],
    ['delivery-ganesh', people.delivery.ganesh],
    ['delivery-raju', people.delivery.raju],
    ['delivery-santosh', people.delivery.santosh],
    ['delivery-iqbal', people.delivery.iqbal],
  ] as const) {
    rows.push(
      staffNotice({
        key: `offer:${key}`,
        person,
        templateKey: 'scheme_announcement',
        variables: { schemeName: 'Campa 750 ml: buy 12 get 1 free', validTill: '30 Sep 2026' },
        refType: null,
        refId: null,
        idempotencyKey: `TeamNotice:${broadcastId}:${person.id}`,
        at: new Date(broadcastAt.getTime() + 120_000),
      }),
    )
  }
  await insertMany(db, messages, rows)

  // The broadcast header, counted from the rows above (the worker refreshes it as sends move).
  const broadcastRows = rows.filter((r) => r.refType === 'broadcast' && r.recipientRetailerId)
  const count = (s: Status[]) => broadcastRows.filter((r) => s.includes(r.status as Status)).length
  await insertMany(db, broadcasts, [
    {
      id: broadcastId,
      tenantId,
      beatId: retailersRes.beats[0]?.id ?? null,
      channel: 'whatsapp',
      templateKey: 'scheme_announcement',
      locale: null,
      variables: { schemeName: 'Campa 750 ml: buy 12 get 1 free', validTill: '30 Sep 2026' },
      createdBy: people.owner.id,
      totalRecipients: stationRoad.length,
      queuedCount: count(['queued']),
      sentCount: count(['sent']),
      deliveredCount: count(['delivered', 'read']),
      failedCount: count(['failed']),
      createdAt: broadcastAt,
      updatedAt: broadcastAt,
    },
  ])

  // 10. Push tokens: one per staff phone, mixed platforms.
  const staff = [
    ['owner', people.owner, 'android'],
    ['manager', people.manager, 'android'],
    ['accountant', people.accountant, 'web'],
    ['warehouse', people.warehouse, 'android'],
    ['rep-rahul', people.salespeople.rahul, 'android'],
    ['rep-amit', people.salespeople.amit, 'ios'],
    ['rep-pooja', people.salespeople.pooja, 'android'],
    ['delivery-ganesh', people.delivery.ganesh, 'android'],
    ['delivery-raju', people.delivery.raju, 'android'],
    ['delivery-santosh', people.delivery.santosh, 'ios'],
    ['delivery-iqbal', people.delivery.iqbal, 'android'],
  ] as const
  await insertMany(
    db,
    pushTokens,
    staff.map(([key, person, platform]) => ({
      id: demoId('push-token', key),
      tenantId,
      userId: person.id,
      deviceId: demoId('device', key),
      token:
        platform === 'web'
          ? `https://fcm.googleapis.com/fcm/send/demo-${key}`
          : `ExponentPushToken[demo-${key}]`,
      platform,
      lastSeenAt: atIstTime(daysAgo(randInt(rng, 0, 3)), 8, 30),
    })),
  )

  // 11. Three inbound texts on the two shops with a login, and the 24-hour window the first opened.
  const [shopOne, shopTwo] = retailersRes.linkedRetailerCodes
    .map((code) => retailersRes.retailers.find((r) => r.code === code))
    .filter((r): r is RetailerRow => r !== undefined && linkOf.get(r.id)?.userId != null)
  if (shopOne && shopTwo) {
    const textAt = atIstTime(daysAgo(0), 8, 42)
    await insertMany(db, inboundMessages, [
      {
        id: demoId('inbound', `${shopOne.id}:order-text`),
        tenantId,
        channel: 'whatsapp',
        from: shopOne.phone,
        retailerId: shopOne.id,
        body: 'bhai 2 case campa 1L kal bhej dena',
        providerMessageId: `wamid.demo.${shopOne.code}.1`,
        receivedAt: textAt,
        handled: false,
      },
      {
        id: demoId('inbound', `${shopTwo.id}:payment-photo`),
        tenantId,
        channel: 'whatsapp',
        from: shopTwo.phone,
        retailerId: shopTwo.id,
        body: 'payment done, see screenshot',
        mediaObjectKey: `tenant/${tenantId}/inbound/${demoId('inbound', `${shopTwo.id}:payment-photo`)}/photo.jpg`,
        providerMessageId: `wamid.demo.${shopTwo.code}.1`,
        receivedAt: atIstTime(daysAgo(1), 19, 5),
        handled: true,
      },
      {
        id: demoId('inbound', `${shopOne.id}:thanks`),
        tenantId,
        channel: 'whatsapp',
        from: shopOne.phone,
        retailerId: shopOne.id,
        body: 'ok thanks',
        providerMessageId: `wamid.demo.${shopOne.code}.2`,
        receivedAt: atIstTime(daysAgo(2), 12, 20),
        handled: true,
      },
    ])
    await insertMany(db, whatsappWindows, [
      {
        tenantId,
        phone: shopOne.phone,
        openedAt: textAt,
        expiresAt: new Date(textAt.getTime() + 24 * 60 * 60_000),
      },
    ])
  }
}
