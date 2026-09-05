import { and, eq, gt, inArray } from 'drizzle-orm'
import type { MessageRefType } from '@dos/contracts'
import { businessDate } from '@dos/domain'
import { memberships, pushTokens, withTenant, type Db, type TenantContext } from '@dos/db'
import { tenantStorage } from '../../platform/index.js'
import { contactPreferences, contactPreferencesFor } from '../retailers/index.js'
import {
  DUES_REMINDER_COOLDOWN_DAYS,
  latestMessageAt,
  queueShopMessage,
  queueStaffNotice,
  rupees,
  senderIdentity,
  upiPayLink,
  type ShopMessageOutcome,
} from './notifications.internals.js'

/**
 * Outbox → messages (brief §7): the translators the worker registers with the relay. Every fact a
 * template prints comes from the event's own JSON payload — this module never reads `sales_orders`,
 * `invoices`, `deliveries` or `receipts` (the event is the interface). Idempotent by construction:
 * the row's key is `<EventType>:<aggregateId>` and a relay replay finds it already there.
 *
 * Runs as the SYSTEM actor of the event's tenant inside `withTenant` (RLS applies; `system` is
 * admitted everywhere a staff member is), with the tenant context in `AsyncLocalStorage` so the
 * module's own helpers (`currentTenant()`) work exactly as they do on a request.
 */
export interface NotificationEvent {
  tenantId: string
  aggregateType: string
  aggregateId: string
  eventType: string
  payload: unknown
}

/** The event types this module consumes — what `registerOutboxHandler` is called with. */
export const NOTIFICATION_EVENT_TYPES = [
  'OrderConfirmed',
  'OrderCancelled',
  'OrderSubmitted',
  'InvoiceIssued',
  'DeliveryRecorded',
  'ReceiptRecorded',
  'retailer.identity_linked',
] as const
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export interface HandledEvent {
  /** What happened to the message: queued (created), replayed (already there), skipped (why), ignored (not for us). */
  outcome: 'queued' | 'replayed' | 'skipped' | 'ignored'
  reason?: string | undefined
  messageId?: string | undefined
}

export const systemContext = (tenantId: string): TenantContext => ({
  tenantId,
  actorId: 'system',
  actorRole: 'system',
})

/** Run `fn` as the tenant's system actor, context and transaction alike. */
export function asTenantSystem<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  const ctx = systemContext(tenantId)
  return tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function payloadOf(event: NotificationEvent): Record<string, unknown> {
  return event.payload !== null && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : {}
}

function fromOutcome(outcome: ShopMessageOutcome): HandledEvent {
  if (outcome.kind === 'queued')
    return { outcome: outcome.created ? 'queued' : 'replayed', messageId: outcome.row.id }
  return {
    outcome: 'skipped',
    reason:
      outcome.reason === 'variables_missing'
        ? `variables_missing: ${(outcome.missing ?? []).join(', ')}`
        : outcome.reason,
  }
}

/** One shop message for an event: the shop from the payload, the template by event, the key `<type>:<id>`. */
async function shopMessageFor(
  db: Db,
  event: NotificationEvent,
  i: {
    retailerId: string
    templateKey: string
    refType: MessageRefType
    refId: string
    variables: (sender: Awaited<ReturnType<typeof senderIdentity>>) => Record<string, string>
    idempotencyKey?: string | undefined
  },
): Promise<HandledEvent> {
  return asTenantSystem(db, event.tenantId, async (tx) => {
    const sender = await senderIdentity(tx)
    const contact = await contactPreferences(tx, i.retailerId)
    const outcome = await queueShopMessage(
      tx,
      { contact, sender },
      {
        retailerId: i.retailerId,
        templateKey: i.templateKey,
        refType: i.refType,
        refId: i.refId,
        variables: i.variables(sender),
        idempotencyKey: i.idempotencyKey ?? `${event.eventType}:${event.aggregateId}`,
      },
    )
    return fromOutcome(outcome)
  })
}

/** `OrderConfirmed` / `OrderCancelled` (orders): the shop hears its order went through, or did not. */
export async function handleOrderEvent(db: Db, event: NotificationEvent): Promise<HandledEvent> {
  const p = payloadOf(event)
  const retailerId = str(p.retailerId)
  const orderId = str(p.orderId) ?? event.aggregateId
  if (!retailerId) return { outcome: 'ignored', reason: 'no retailerId in payload' }
  const templateKey = event.eventType === 'OrderCancelled' ? 'order_cancelled' : 'order_confirmed'
  return shopMessageFor(db, event, {
    retailerId,
    templateKey,
    refType: 'order',
    refId: orderId,
    variables: () => ({
      orderNo: str(p.orderNo) ?? orderId.slice(-8).toUpperCase(),
      totalRupees: rupees(num(p.totalPaise) ?? 0),
    }),
  })
}

/**
 * `OrderSubmitted` (orders): a "needs approval" push to every back-office device when the order is
 * waiting on the desk. The payload carries the state; `submitted` means it is waiting (a confirmed
 * order arrives as `OrderConfirmed`). One row per registered device, keyed by device.
 */
export async function handleOrderSubmitted(
  db: Db,
  event: NotificationEvent,
): Promise<HandledEvent> {
  const p = payloadOf(event)
  if (str(p.state) !== 'submitted')
    return { outcome: 'ignored', reason: 'not waiting for approval' }
  const orderId = str(p.orderId) ?? event.aggregateId
  return asTenantSystem(db, event.tenantId, async (tx) => {
    const sender = await senderIdentity(tx)
    const devices = await tx
      .select({ id: pushTokens.id, userId: pushTokens.userId })
      .from(pushTokens)
      .where(
        and(
          eq(pushTokens.tenantId, event.tenantId),
          gt(pushTokens.lastSeenAt, new Date(Date.now() - 90 * 86_400_000)),
        ),
      )
      .limit(200)
    const desk = await backOfficeUserIds(tx, event.tenantId)
    let queued = 0
    for (const device of devices.filter((d) => desk.has(d.userId))) {
      const outcome = await queueStaffNotice(
        tx,
        { sender },
        {
          userId: device.userId,
          channel: 'push',
          to: device.id,
          templateKey: 'order_needs_approval',
          refType: 'order',
          refId: orderId,
          variables: {
            orderNo: str(p.orderNo) ?? orderId.slice(-8).toUpperCase(),
            totalRupees: rupees(num(p.totalPaise) ?? 0),
          },
          idempotencyKey: `${event.eventType}:${event.aggregateId}:${device.id}`,
        },
      )
      if (outcome.kind === 'queued' && outcome.created) queued += 1
    }
    return { outcome: queued > 0 ? 'queued' : 'replayed', reason: `${String(queued)} device(s)` }
  })
}

/** Owner / manager memberships of the tenant — who is told an order waits for a decision. */
async function backOfficeUserIds(tx: Db, tenantId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        inArray(memberships.role, ['owner', 'manager']),
        eq(memberships.status, 'active'),
      ),
    )
  return new Set(rows.map((r) => r.userId))
}

/**
 * `InvoiceIssued` (billing): the bill with the pay link, built from the distributor's own UPI id and
 * name (`tenant_settings`) and the event's amount and number — never a fresh read of `invoices`.
 * Brand-DMS and migrated bills are not "your bill was just issued" moments and are left alone.
 */
export async function handleInvoiceIssued(db: Db, event: NotificationEvent): Promise<HandledEvent> {
  const p = payloadOf(event)
  const retailerId = str(p.retailerId)
  const invoiceId = str(p.invoiceId) ?? event.aggregateId
  if (!retailerId) return { outcome: 'ignored', reason: 'no retailerId in payload' }
  const source = str(p.source)
  if (source === 'brand_dms_import' || source === 'import' || str(p.importJobId))
    return { outcome: 'ignored', reason: `source ${source ?? 'import'}` }
  const totalPaise = num(p.totalPaise) ?? 0
  const invoiceNo = str(p.invoiceNo)
  return shopMessageFor(db, event, {
    retailerId,
    templateKey: 'invoice_issued',
    refType: 'invoice',
    refId: invoiceId,
    variables: (sender) => ({
      invoiceNo: invoiceNo ?? invoiceId.slice(-8).toUpperCase(),
      totalRupees: rupees(totalPaise),
      dueDate: str(p.dueDate) ?? '',
      upiLink: upiPayLink({
        vpa: sender.upiVpa,
        payeeName: sender.displayName,
        amountPaise: totalPaise,
        reference: invoiceNo,
      }),
    }),
  })
}

/** `DeliveryRecorded` (delivery): proof of delivery to the shop; a short delivery names the credit note. */
export async function handleDeliveryRecorded(
  db: Db,
  event: NotificationEvent,
): Promise<HandledEvent> {
  const p = payloadOf(event)
  const retailerId = str(p.retailerId)
  const outcome = str(p.outcome)
  if (!retailerId) return { outcome: 'ignored', reason: 'no retailerId in payload' }
  if (outcome !== 'delivered' && outcome !== 'partial')
    return { outcome: 'ignored', reason: `outcome ${outcome ?? 'unknown'}` }
  const deliveryId = str(p.deliveryId) ?? event.aggregateId
  const shortPcs = num(p.shortPcs) ?? 0
  return shopMessageFor(db, event, {
    retailerId,
    templateKey: 'pod_delivered',
    refType: 'delivery',
    refId: deliveryId,
    variables: () => ({
      outcome:
        outcome === 'partial' ? `partly delivered (${String(shortPcs)} pcs short)` : 'delivered',
      invoiceRef: (str(p.invoiceId) ?? '').slice(-8).toUpperCase(),
    }),
  })
}

/**
 * `ReceiptRecorded` (receivables): "payment received" for every rupee that lands — at the door, at the
 * office desk, or online — so the doorstep `CollectionRecorded` (which records the same receipt) is
 * deliberately not a second trigger. Keyed `PaymentReceived:<receiptId>`.
 */
export async function handleReceiptRecorded(
  db: Db,
  event: NotificationEvent,
): Promise<HandledEvent> {
  const p = payloadOf(event)
  const retailerId = str(p.retailerId)
  const receiptId = str(p.receiptId) ?? event.aggregateId
  if (!retailerId) return { outcome: 'ignored', reason: 'no retailerId in payload' }
  return shopMessageFor(db, event, {
    retailerId,
    templateKey: 'payment_received',
    refType: 'receipt',
    refId: receiptId,
    idempotencyKey: `PaymentReceived:${receiptId}`,
    variables: () => ({
      receiptNo: str(p.receiptNo) ?? receiptId.slice(-8).toUpperCase(),
      amountRupees: rupees(num(p.amountPaise) ?? 0),
    }),
  })
}

/** `retailer.identity_linked` (retailers): a one-time in-app welcome to the login that just claimed the shop. */
export async function handleIdentityLinked(
  db: Db,
  event: NotificationEvent,
): Promise<HandledEvent> {
  const p = payloadOf(event)
  const retailerId = str(p.retailerId) ?? event.aggregateId
  return asTenantSystem(db, event.tenantId, async (tx) => {
    const sender = await senderIdentity(tx)
    const contact = await contactPreferences(tx, retailerId)
    if (!contact?.userId) return { outcome: 'skipped', reason: 'the shop has no login yet' }
    const outcome = await queueShopMessage(
      tx,
      { contact, sender },
      {
        retailerId,
        templateKey: 'welcome',
        refType: 'retailer',
        refId: retailerId,
        channel: 'in_app',
        variables: { shopName: contact.name },
        idempotencyKey: `Welcome:${retailerId}`,
      },
    )
    return fromOutcome(outcome)
  })
}

/** Dispatch by event type; unknown types are ignored, never an error (the relay marks them published). */
export async function handleNotificationEvent(
  db: Db,
  event: NotificationEvent,
): Promise<HandledEvent> {
  switch (event.eventType) {
    case 'OrderConfirmed':
    case 'OrderCancelled':
      return handleOrderEvent(db, event)
    case 'OrderSubmitted':
      return handleOrderSubmitted(db, event)
    case 'InvoiceIssued':
      return handleInvoiceIssued(db, event)
    case 'DeliveryRecorded':
      return handleDeliveryRecorded(db, event)
    case 'ReceiptRecorded':
      return handleReceiptRecorded(db, event)
    case 'retailer.identity_linked':
      return handleIdentityLinked(db, event)
    default:
      return { outcome: 'ignored', reason: `no translator for ${event.eventType}` }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the two sweeps' per-shop work (the worker finds the shops; this module writes the rows)

/** `delivery_today`: one row per stop of a trip leaving today, keyed by the stop (brief §7). */
export async function queueDeliveryToday(
  db: Db,
  tenantId: string,
  stops: readonly { stopId: string; retailerId: string; tripDate: string; sequence: number }[],
): Promise<{ queued: number; skipped: number }> {
  if (stops.length === 0) return { queued: 0, skipped: 0 }
  return asTenantSystem(db, tenantId, async (tx) => {
    const sender = await senderIdentity(tx)
    const contacts = await contactPreferencesFor(
      tx,
      stops.map((s) => s.retailerId),
    )
    let queued = 0
    let skipped = 0
    for (const stop of stops) {
      const outcome = await queueShopMessage(
        tx,
        { contact: contacts.get(stop.retailerId) ?? null, sender },
        {
          retailerId: stop.retailerId,
          templateKey: 'delivery_today',
          refType: 'trip_stop',
          refId: stop.stopId,
          variables: { deliveryDate: stop.tripDate, stopNo: String(stop.sequence) },
          idempotencyKey: `DeliveryToday:${stop.stopId}`,
        },
      )
      if (outcome.kind === 'queued') {
        if (outcome.created) queued += 1
      } else skipped += 1
    }
    return { queued, skipped }
  })
}

/**
 * `dues_reminder`: at most once per shop per seven days (coordination §7 q21), keyed by shop and IST
 * business date so the daily sweep replays harmlessly. The worker supplies who is overdue and by how
 * much (receivables' rollup); the cooldown is checked here against the latest reminder row.
 */
export async function queueDuesReminders(
  db: Db,
  tenantId: string,
  overdue: readonly { retailerId: string; overduePaise: number; oldestDueDate: string | null }[],
): Promise<{ queued: number; cooled: number; skipped: number }> {
  if (overdue.length === 0) return { queued: 0, cooled: 0, skipped: 0 }
  return asTenantSystem(db, tenantId, async (tx) => {
    const sender = await senderIdentity(tx)
    const today = businessDate().date
    const contacts = await contactPreferencesFor(
      tx,
      overdue.map((o) => o.retailerId),
    )
    const cutoff = Date.now() - DUES_REMINDER_COOLDOWN_DAYS * 86_400_000
    let queued = 0
    let cooled = 0
    let skipped = 0
    for (const shop of overdue) {
      if (shop.overduePaise <= 0) continue
      const last = await latestMessageAt(tx, shop.retailerId, 'dues_reminder')
      if (last && last.getTime() > cutoff) {
        cooled += 1
        continue
      }
      const outcome = await queueShopMessage(
        tx,
        { contact: contacts.get(shop.retailerId) ?? null, sender },
        {
          retailerId: shop.retailerId,
          templateKey: 'dues_reminder',
          refType: 'retailer',
          refId: shop.retailerId,
          variables: {
            overdueRupees: rupees(shop.overduePaise),
            oldestDueDate: shop.oldestDueDate ?? '',
          },
          idempotencyKey: `DuesReminder:${shop.retailerId}:${today}`,
        },
      )
      if (outcome.kind === 'queued') {
        if (outcome.created) queued += 1
      } else skipped += 1
    }
    return { queued, cooled, skipped }
  })
}
