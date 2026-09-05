import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import { retailerOutstandingSummary, tripStops, trips, type Db } from '@dos/db'
import { businessDate, uuidv7Time } from '@dos/domain'
import {
  createProviders,
  dispatchDueMessages,
  handleNotificationEvent,
  NOTIFICATION_EVENT_TYPES,
  queueDeliveryToday,
  queueDuesReminders,
  type ProviderSet,
} from '@dos/core/notifications'
import { logger } from '../logger.js'
import { registerOutboxHandler } from './outbox-relay.js'

/**
 * Notifications on pg-boss (docs/plans/notifications.md §7):
 *
 *   outbox handlers          `OrderConfirmed`, `OrderCancelled`, `OrderSubmitted`, `InvoiceIssued`,
 *                            `DeliveryRecorded`, `ReceiptRecorded`, `retailer.identity_linked` → one
 *                            queued `messages` row each (`@dos/core/notifications`); `TripDeparted` →
 *                            a `delivery_today` row per pending stop of the trip
 *   notifications.dispatch   every minute: the due rows (≤ 200) through the channel providers with
 *                            `FOR UPDATE SKIP LOCKED`, backoff 1m/5m/30m/2h/12h, dead letter at five
 *   notifications.deliveryToday   07:00 IST: every stop of a trip dated today that has not left yet
 *   notifications.duesReminder    09:00 IST: every shop with overdue dues, once per shop per 7 days
 *
 * The providers come from the environment (`createProviders`): Meta and MSG91 only with credentials,
 * the deterministic stub otherwise, so a local run never reaches a network. Every per-shop decision
 * (opt-in, opt-out, locale, template, the white-label name) is the core module's; this file only
 * finds WHO — the stops of the day, the overdue shops — reading the owning tables on the worker's
 * own connection, bounded and fair across tenants (one pass, a cap per tenant).
 */
export const NOTIFICATIONS_DISPATCH = 'notifications.dispatch'
export const NOTIFICATIONS_DELIVERY_TODAY = 'notifications.deliveryToday'
export const NOTIFICATIONS_DUES_REMINDER = 'notifications.duesReminder'

/**
 * An event older than this is not announced: a "your order is confirmed" two days late is worse than
 * none (the paper bill has long arrived), and the relay hands over every row a handler has never seen
 * — on a database that ran for days before this module existed, that is thousands of old events. The
 * row is still marked published; nothing is retried. Outbox ids are UUIDv7, so the age is in the id.
 */
const MAX_EVENT_AGE_MS = 48 * 60 * 60_000

/** Shops reminded per tenant per day — a bound, not a target (docs/20 rule 3). */
const DUES_PER_TENANT = 500
/** Stops announced per tenant per day. */
const STOPS_PER_TENANT = 1000

const OPEN_TRIP_STATES = ['planned', 'loading', 'active'] as const
const OPEN_STOP_STATES = ['pending', 'started'] as const

/** `delivery_today` for the pending stops of one trip (the `TripDeparted` hand-off and the sweep share it). */
export async function announceTrip(
  db: Db,
  tenantId: string,
  tripId: string,
): Promise<{ queued: number; skipped: number }> {
  const [trip] = await db
    .select({ id: trips.id, tripDate: trips.tripDate })
    .from(trips)
    .where(and(eq(trips.tenantId, tenantId), eq(trips.id, tripId)))
    .limit(1)
  if (!trip) return { queued: 0, skipped: 0 }
  const stops = await db
    .select({
      stopId: tripStops.id,
      retailerId: tripStops.retailerId,
      sequence: tripStops.sequence,
    })
    .from(tripStops)
    .where(
      and(
        eq(tripStops.tenantId, tenantId),
        eq(tripStops.tripId, trip.id),
        inArray(tripStops.state, [...OPEN_STOP_STATES]),
      ),
    )
    .orderBy(asc(tripStops.sequence))
    .limit(STOPS_PER_TENANT)
  return queueDeliveryToday(
    db,
    tenantId,
    stops.map((s) => ({ ...s, tripDate: trip.tripDate })),
  )
}

/** 07:00 IST: every open trip dated today, tenant by tenant. */
export async function sweepDeliveryToday(db: Db): Promise<{ trips: number; queued: number }> {
  const today = businessDate().date
  const open = await db
    .select({ id: trips.id, tenantId: trips.tenantId })
    .from(trips)
    .where(and(eq(trips.tripDate, today), inArray(trips.state, [...OPEN_TRIP_STATES])))
    .orderBy(asc(trips.tenantId), asc(trips.id))
    .limit(2000)
  let queued = 0
  for (const trip of open) {
    const r = await announceTrip(db, trip.tenantId, trip.id)
    queued += r.queued
  }
  if (open.length > 0)
    logger.info({ trips: open.length, queued }, 'notifications: delivery-today swept')
  return { trips: open.length, queued }
}

/**
 * 09:00 IST: every shop whose rollup says it is overdue (receivables' `retailer_outstanding_summary`,
 * refreshed on every receipt and bill), largest dues first, a bound per tenant. The seven-day cooldown
 * is the core module's.
 */
export async function sweepDuesReminders(
  db: Db,
): Promise<{ tenants: number; queued: number; cooled: number }> {
  const tenantRows = await db
    .selectDistinct({ tenantId: retailerOutstandingSummary.tenantId })
    .from(retailerOutstandingSummary)
    .where(gt(retailerOutstandingSummary.overduePaise, 0))
    .limit(1000)
  let queued = 0
  let cooled = 0
  for (const { tenantId } of tenantRows) {
    const overdue = await db
      .select({
        retailerId: retailerOutstandingSummary.retailerId,
        overduePaise: retailerOutstandingSummary.overduePaise,
        oldestDueDate: retailerOutstandingSummary.oldestDueDate,
      })
      .from(retailerOutstandingSummary)
      .where(
        and(
          eq(retailerOutstandingSummary.tenantId, tenantId),
          gt(retailerOutstandingSummary.overduePaise, 0),
        ),
      )
      .orderBy(sql`${retailerOutstandingSummary.overduePaise} desc`)
      .limit(DUES_PER_TENANT)
    const r = await queueDuesReminders(db, tenantId, overdue)
    queued += r.queued
    cooled += r.cooled
  }
  if (tenantRows.length > 0)
    logger.info(
      { tenants: tenantRows.length, queued, cooled },
      'notifications: dues reminders swept',
    )
  return { tenants: tenantRows.length, queued, cooled }
}

/** Register the outbox translators, the three queues and their schedules. Called once by `main.ts`. */
export async function registerNotificationsJobs(
  boss: PgBoss,
  db: Db,
  providers: ProviderSet = createProviders(),
): Promise<void> {
  const stale = (id: string): boolean => {
    const at = uuidv7Time(id)
    return Number.isFinite(at) && at > 0 && Date.now() - at > MAX_EVENT_AGE_MS
  }
  for (const eventType of NOTIFICATION_EVENT_TYPES) {
    registerOutboxHandler(eventType, async (e) => {
      if (stale(e.id)) return
      const result = await handleNotificationEvent(db, e)
      if (result.outcome === 'skipped')
        logger.info({ id: e.id, eventType, reason: result.reason }, 'notifications: event skipped')
    })
  }
  registerOutboxHandler('TripDeparted', async (e) => {
    if (stale(e.id)) return
    await announceTrip(db, e.tenantId, e.aggregateId)
  })

  await boss.createQueue(NOTIFICATIONS_DISPATCH)
  await boss.work(NOTIFICATIONS_DISPATCH, async () => {
    const result = await dispatchDueMessages(db, providers)
    if (result.claimed > 0) logger.info(result, 'notifications: dispatched')
  })
  await boss.schedule(NOTIFICATIONS_DISPATCH, '* * * * *')

  await boss.createQueue(NOTIFICATIONS_DELIVERY_TODAY)
  await boss.work(NOTIFICATIONS_DELIVERY_TODAY, async () => {
    await sweepDeliveryToday(db)
  })
  await boss.schedule(NOTIFICATIONS_DELIVERY_TODAY, '0 7 * * *', null, { tz: 'Asia/Kolkata' })

  await boss.createQueue(NOTIFICATIONS_DUES_REMINDER)
  await boss.work(NOTIFICATIONS_DUES_REMINDER, async () => {
    await sweepDuesReminders(db)
  })
  await boss.schedule(NOTIFICATIONS_DUES_REMINDER, '0 9 * * *', null, { tz: 'Asia/Kolkata' })
  logger.info(
    { whatsapp: providers.whatsapp.name, sms: providers.sms.name, push: providers.push.name },
    'notifications: providers',
  )
}
