import { and, eq, sql } from 'drizzle-orm'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@dos/domain'
import {
  beatAssignments,
  beats,
  bootstrapTenant,
  broadcasts,
  createDb,
  createPool,
  inboundMessages,
  memberships,
  messages,
  retailerIdentities,
  retailerLinks,
  retailers,
  templates,
  tenants,
  tenantSettings,
  TENANT_SETTING_KEYS,
  users,
  withTenant,
  type Db,
  type TenantContext,
} from '@dos/db'
import { tenantStorage } from '../../platform/index.js'
import { bootTestApp, call, type Actor } from '../../testing/app.js'
import { RetailersModule } from '../retailers/index.js'
import { stubProviders } from './adapters/index.js'
import { dispatchDueMessages } from './dispatch.js'
import { handleNotificationEvent, queueDuesReminders } from './events.js'
import { NotificationsModule } from './index.js'
import { MAX_ATTEMPTS, RETRY_BACKOFF_MS } from './notifications.internals.js'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

type MessageOut = Record<string, unknown> & {
  id: string
  channel: string
  status: string
  locale: string
  senderName: string
  body: string | null
  retailerName: string | null
  recipientRetailerId: string | null
  costPaise?: number | null
  providerMessageId?: string | null
  error?: string | null
  attempts?: number
  nextAttemptAt?: string | null
  readAt: string | null
}

describeDb('notifications (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const tenantId = uuidv7()
  const otherTenantId = uuidv7()
  const ownerId = uuidv7()
  const managerId = uuidv7()
  const accountantId = uuidv7()
  const repId = uuidv7()
  const otherRepId = uuidv7()
  const godownId = uuidv7()
  const driverId = uuidv7()
  const shopUserId = uuidv7()
  const otherShopUserId = uuidv7()
  const otherOwnerId = uuidv7()

  const owner: Actor = { tenantId, actorId: ownerId, role: 'owner' }
  const manager: Actor = { tenantId, actorId: managerId, role: 'manager' }
  const accountant: Actor = { tenantId, actorId: accountantId, role: 'accountant' }
  const rep: Actor = { tenantId, actorId: repId, role: 'salesperson' }
  const otherRep: Actor = { tenantId, actorId: otherRepId, role: 'salesperson' }
  const godown: Actor = { tenantId, actorId: godownId, role: 'warehouse' }
  const driver: Actor = { tenantId, actorId: driverId, role: 'delivery' }
  const shop: Actor = { tenantId, actorId: shopUserId, role: 'retailer' }
  const otherShop: Actor = { tenantId, actorId: otherShopUserId, role: 'retailer' }
  const otherOwner: Actor = { tenantId: otherTenantId, actorId: otherOwnerId, role: 'owner' }

  const beatA = uuidv7()
  const beatB = uuidv7()
  /** Opted in to WhatsApp, Marathi, with a login: the shop the retailer actor owns. */
  const shopA = uuidv7()
  /** No link at all: SMS fallback. */
  const shopB = uuidv7()
  /** Blocked link: opted out, gets nothing. */
  const shopC = uuidv7()
  /** No phone: skipped. */
  const shopD = uuidv7()
  /** On beat B, the other rep's shop, owned by the other retailer login. */
  const shopE = uuidv7()
  const shopPhoneA = `+919${run}1`
  const shopPhoneB = `+919${run}2`
  const shopPhoneC = `+919${run}3`
  const shopPhoneE = `+919${run}5`
  let app: NestFastifyApplication

  const ctxOf = (actor: Actor): TenantContext => ({
    tenantId: actor.tenantId,
    actorId: actor.actorId,
    actorRole: actor.role,
  })
  const as = <T>(actor: Actor, fn: (tx: Db) => Promise<T>): Promise<T> =>
    tenantStorage.run(ctxOf(actor), () => withTenant(db, ctxOf(actor), fn))
  const messageRow = async (id: string) =>
    (await db.select().from(messages).where(eq(messages.id, id)))[0]
  const messagesByKey = async (key: string) =>
    db
      .select()
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.idempotencyKey, key)))

  const platformTemplate = (
    key: string,
    channel: 'whatsapp' | 'sms' | 'in_app' | 'push',
    body: string,
    variables: string[],
    locale = 'en-IN',
  ) => ({
    id: uuidv7(),
    tenantId: null,
    key,
    channel,
    locale,
    providerTemplateName: channel === 'whatsapp' ? `${key}_${locale.slice(0, 2)}` : null,
    body,
    variables,
    active: true,
  })

  beforeAll(async () => {
    await db.insert(tenants).values([
      { id: tenantId, slug: `ntf-${run}`, legalName: 'Notify Test Traders', stateCode: '27' },
      { id: otherTenantId, slug: `ntf-o-${run}`, legalName: 'Elsewhere Traders', stateCode: '27' },
    ])
    await bootstrapTenant(db, tenantId)
    await bootstrapTenant(db, otherTenantId)
    await db
      .insert(tenantSettings)
      .values([
        { tenantId, key: TENANT_SETTING_KEYS.brandingDisplayName, value: 'Notify Traders' },
        { tenantId, key: TENANT_SETTING_KEYS.upiVpa, value: `notify${run}@okhdfcbank` },
      ])
      .onConflictDoUpdate({
        target: [tenantSettings.tenantId, tenantSettings.key],
        set: { value: sql`excluded.value` },
      })
    await db.insert(users).values([
      { id: ownerId, phone: `+919${run}11`, name: 'Owner' },
      { id: managerId, phone: `+919${run}12`, name: 'Manager' },
      { id: accountantId, phone: `+919${run}13`, name: 'Accountant' },
      { id: repId, phone: `+919${run}14`, name: 'Rep A' },
      { id: otherRepId, phone: `+919${run}15`, name: 'Rep B' },
      { id: godownId, phone: `+919${run}16`, name: 'Godown' },
      { id: driverId, phone: `+919${run}17`, name: 'Driver' },
      { id: shopUserId, phone: shopPhoneA, name: 'Shop A login' },
      { id: otherShopUserId, phone: shopPhoneE, name: 'Shop E login' },
      { id: otherOwnerId, phone: `+919${run}19`, name: 'Other owner' },
    ])
    await db.insert(memberships).values([
      { id: uuidv7(), tenantId, userId: ownerId, role: 'owner' },
      { id: uuidv7(), tenantId, userId: managerId, role: 'manager' },
      { id: uuidv7(), tenantId, userId: accountantId, role: 'accountant' },
      { id: uuidv7(), tenantId, userId: repId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: otherRepId, role: 'salesperson' },
      { id: uuidv7(), tenantId, userId: godownId, role: 'warehouse' },
      { id: uuidv7(), tenantId, userId: driverId, role: 'delivery' },
      { id: uuidv7(), tenantId, userId: shopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId, userId: otherShopUserId, role: 'retailer' },
      { id: uuidv7(), tenantId: otherTenantId, userId: otherOwnerId, role: 'owner' },
    ])
    await db.insert(beats).values([
      { id: beatA, tenantId, name: `Station Road ${run}` },
      { id: beatB, tenantId, name: `Market ${run}` },
    ])
    await db.insert(beatAssignments).values([
      { id: uuidv7(), tenantId, beatId: beatA, userId: repId, validFrom: '2020-01-01' },
      { id: uuidv7(), tenantId, beatId: beatB, userId: otherRepId, validFrom: '2020-01-01' },
    ])
    const shopRow = (id: string, code: string, name: string, phone: string, beatId: string) => ({
      id,
      tenantId,
      code,
      name,
      phone,
      stateCode: '27',
      beatId,
    })
    await db
      .insert(retailers)
      .values([
        shopRow(shopA, `N${run}-A`, 'Alpha Kirana', shopPhoneA, beatA),
        shopRow(shopB, `N${run}-B`, 'Beta Stores', shopPhoneB, beatA),
        shopRow(shopC, `N${run}-C`, 'Gamma Traders', shopPhoneC, beatA),
        shopRow(shopD, `N${run}-D`, 'Delta Provision', '', beatA),
        shopRow(shopE, `N${run}-E`, 'Epsilon Mart', shopPhoneE, beatB),
      ])
    const identityA = uuidv7()
    const identityC = uuidv7()
    const identityE = uuidv7()
    await db.insert(retailerIdentities).values([
      { id: identityA, phone: shopPhoneA, userId: shopUserId, shopName: 'Alpha Kirana' },
      { id: identityC, phone: shopPhoneC, shopName: 'Gamma Traders' },
      { id: identityE, phone: shopPhoneE, userId: otherShopUserId, shopName: 'Epsilon Mart' },
    ])
    await db.insert(retailerLinks).values([
      {
        id: uuidv7(),
        tenantId,
        identityId: identityA,
        retailerId: shopA,
        userId: shopUserId,
        role: 'owner',
        linkedBy: 'rep_onboarding',
        status: 'active',
        preferredLang: 'mr',
        whatsappOptinAt: new Date(),
        consentedAt: new Date(),
      },
      {
        id: uuidv7(),
        tenantId,
        identityId: identityC,
        retailerId: shopC,
        role: 'owner',
        linkedBy: 'directory_optin',
        status: 'blocked',
        whatsappOptinAt: new Date(),
      },
      {
        id: uuidv7(),
        tenantId,
        identityId: identityE,
        retailerId: shopE,
        userId: otherShopUserId,
        role: 'owner',
        linkedBy: 'rep_onboarding',
        status: 'active',
        whatsappOptinAt: new Date(),
      },
    ])
    // Platform defaults (English only): the keys the handlers and the broadcast use.
    await db
      .insert(templates)
      .values([
        platformTemplate(
          'order_confirmed',
          'whatsapp',
          'Order {{orderNo}} of {{totalRupees}} confirmed. — {{distributorName}}',
          ['orderNo', 'totalRupees'],
        ),
        platformTemplate(
          'order_confirmed',
          'sms',
          'Order {{orderNo}} of {{totalRupees}} confirmed. {{distributorName}}',
          ['orderNo', 'totalRupees'],
        ),
        platformTemplate(
          'invoice_issued',
          'whatsapp',
          'Bill {{invoiceNo}} for {{totalRupees}}, due {{dueDate}}. Pay: {{upiLink}} — {{distributorName}}',
          ['invoiceNo', 'totalRupees', 'dueDate', 'upiLink'],
        ),
        platformTemplate(
          'invoice_issued',
          'sms',
          'Bill {{invoiceNo}} for {{totalRupees}}, due {{dueDate}}. Pay: {{upiLink}} {{distributorName}}',
          ['invoiceNo', 'totalRupees', 'dueDate', 'upiLink'],
        ),
        platformTemplate(
          'scheme_announcement',
          'whatsapp',
          '{{schemeName}} till {{validTill}}. — {{distributorName}}',
          ['schemeName', 'validTill'],
        ),
        platformTemplate(
          'scheme_announcement',
          'sms',
          '{{schemeName}} till {{validTill}}. {{distributorName}}',
          ['schemeName', 'validTill'],
        ),
        platformTemplate(
          'dues_reminder',
          'sms',
          '{{overdueRupees}} overdue since {{oldestDueDate}}. {{distributorName}}',
          ['overdueRupees', 'oldestDueDate'],
        ),
        platformTemplate(
          'dues_reminder',
          'whatsapp',
          '{{overdueRupees}} overdue since {{oldestDueDate}}. — {{distributorName}}',
          ['overdueRupees', 'oldestDueDate'],
        ),
        platformTemplate('welcome', 'in_app', 'Welcome, {{shopName}}!', ['shopName']),
      ])
      .onConflictDoNothing()
    app = await bootTestApp([NotificationsModule, RetailersModule])
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  // -------------------------------------------------------------------------------------------------------------
  // outbox → messages

  const invoiceId = uuidv7()
  const invoiceEvent = {
    tenantId,
    aggregateType: 'invoice',
    aggregateId: invoiceId,
    eventType: 'InvoiceIssued',
    payload: {
      invoiceId,
      invoiceNo: `INV/26-27/${run}`,
      retailerId: shopA,
      source: 'pack',
      totalPaise: 123_450,
      dueDate: '2026-09-20',
    },
  }

  it('turns an InvoiceIssued event into ONE queued WhatsApp message carrying the UPI link and the distributor name', async () => {
    const first = await handleNotificationEvent(db, invoiceEvent)
    expect(first.outcome).toBe('queued')
    const again = await handleNotificationEvent(db, invoiceEvent)
    expect(again.outcome).toBe('replayed')
    const rows = await messagesByKey(`InvoiceIssued:${invoiceId}`)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.channel).toBe('whatsapp') // opted in
    expect(row?.status).toBe('queued')
    expect(row?.to).toBe(shopPhoneA)
    expect(row?.recipientRetailerId).toBe(shopA)
    expect(row?.refType).toBe('invoice')
    expect(row?.refId).toBe(invoiceId)
    // Marathi preferred, no Marathi wording: the English template, and the row says so.
    expect(row?.locale).toBe('en-IN')
    const payload = row?.payload as Record<string, unknown>
    expect(payload.senderName).toBe('Notify Traders')
    expect(payload.distributorName).toBe('Notify Traders')
    expect(payload.upiLink).toContain(`upi://pay?pa=notify${run}%40okhdfcbank`)
    expect(payload.upiLink).toContain('am=1234.50')
    expect(payload.body).toContain('₹1,234.50')
    expect(payload.body).toContain('Notify Traders')
    expect(payload.body).not.toContain('{{')
    expect(payload.providerTemplateName).toBe('invoice_issued_en')
    expect(payload.variableNames).toEqual([
      'invoiceNo',
      'totalRupees',
      'dueDate',
      'upiLink',
      'distributorName',
    ])
  })

  it('falls back to SMS for a shop that never opted in, and sends NOTHING to an opted-out shop', async () => {
    const orderB = uuidv7()
    const smsOutcome = await handleNotificationEvent(db, {
      tenantId,
      aggregateType: 'sales_order',
      aggregateId: orderB,
      eventType: 'OrderConfirmed',
      payload: {
        orderId: orderB,
        orderNo: `SO-${run}-B`,
        retailerId: shopB,
        state: 'confirmed',
        totalPaise: 50_000,
      },
    })
    expect(smsOutcome.outcome).toBe('queued')
    expect((await messagesByKey(`OrderConfirmed:${orderB}`))[0]?.channel).toBe('sms')

    const orderC = uuidv7()
    const blocked = await handleNotificationEvent(db, {
      tenantId,
      aggregateType: 'sales_order',
      aggregateId: orderC,
      eventType: 'OrderConfirmed',
      payload: {
        orderId: orderC,
        orderNo: `SO-${run}-C`,
        retailerId: shopC,
        state: 'confirmed',
        totalPaise: 50_000,
      },
    })
    expect(blocked).toEqual({ outcome: 'skipped', reason: 'opted_out' })
    expect(await messagesByKey(`OrderConfirmed:${orderC}`)).toHaveLength(0)

    const orderD = uuidv7()
    const noPhone = await handleNotificationEvent(db, {
      tenantId,
      aggregateType: 'sales_order',
      aggregateId: orderD,
      eventType: 'OrderConfirmed',
      payload: {
        orderId: orderD,
        orderNo: `SO-${run}-D`,
        retailerId: shopD,
        state: 'confirmed',
        totalPaise: 50_000,
      },
    })
    expect(noPhone).toEqual({ outcome: 'skipped', reason: 'no_phone' })
  })

  it('a brand-DMS or migrated bill is never announced as a new bill', async () => {
    const imported = uuidv7()
    const outcome = await handleNotificationEvent(db, {
      ...invoiceEvent,
      aggregateId: imported,
      payload: { ...invoiceEvent.payload, invoiceId: imported, source: 'brand_dms_import' },
    })
    expect(outcome.outcome).toBe('ignored')
    expect(await messagesByKey(`InvoiceIssued:${imported}`)).toHaveLength(0)
  })

  // -------------------------------------------------------------------------------------------------------------
  // the dispatch sweep

  it('sends a queued message through the stub adapter, recording the provider id and the cost', async () => {
    const [row] = await messagesByKey(`InvoiceIssued:${invoiceId}`)
    expect(row?.status).toBe('queued')
    const result = await dispatchDueMessages(db, stubProviders(), { batchSize: 50 })
    expect(result.claimed).toBeGreaterThanOrEqual(1)
    const sent = await messageRow(row?.id ?? '')
    expect(sent?.status).toBe('sent')
    expect(sent?.attempts).toBe(1)
    expect(sent?.providerMessageId).toMatch(/^stub-whatsapp-/)
    expect(sent?.costPaise).toBe(14)
    expect(sent?.sentAt).not.toBeNull()
    expect(sent?.nextAttemptAt).toBeNull()
    // a second tick finds nothing due for this row
    const idle = await dispatchDueMessages(db, stubProviders(), { batchSize: 50 })
    expect(await messageRow(row?.id ?? '')).toMatchObject({ status: 'sent', attempts: 1 })
    expect(idle.claimed).toBe(0)
  })

  it('backs off a failing send on 1m/5m/30m/2h/12h and dead-letters after five attempts', async () => {
    const orderF = uuidv7()
    await handleNotificationEvent(db, {
      tenantId,
      aggregateType: 'sales_order',
      aggregateId: orderF,
      eventType: 'OrderConfirmed',
      payload: {
        orderId: orderF,
        orderNo: `SO-${run}-F`,
        retailerId: shopB,
        state: 'confirmed',
        totalPaise: 700,
      },
    })
    const [row] = await messagesByKey(`OrderConfirmed:${orderF}`)
    const id = row?.id ?? ''
    const failing = stubProviders({ fail: () => 'MSG91: invalid destination number' })
    let clock = Date.now()
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const at = new Date(clock)
      const result = await dispatchDueMessages(db, failing, { batchSize: 50, now: () => at })
      expect(result.claimed).toBeGreaterThanOrEqual(1)
      const after = await messageRow(id)
      expect(after?.status).toBe('failed')
      expect(after?.attempts).toBe(attempt)
      expect(after?.error).toBe('MSG91: invalid destination number')
      if (attempt < MAX_ATTEMPTS) {
        const expected = RETRY_BACKOFF_MS[attempt - 1] ?? 0
        expect(after?.nextAttemptAt?.getTime()).toBe(at.getTime() + expected)
        // not due yet: a tick a second later leaves it alone
        const early = await dispatchDueMessages(db, failing, {
          batchSize: 50,
          now: () => new Date(clock + 1000),
        })
        expect((await messageRow(id))?.attempts).toBe(attempt)
        expect(early.claimed).toBe(0)
        clock += expected + 1
      } else {
        expect(after?.nextAttemptAt).toBeNull()
        expect(result.deadLettered).toBeGreaterThanOrEqual(1)
      }
    }
    // dead: a sixth tick, a year later, touches nothing
    const sixth = await dispatchDueMessages(db, failing, {
      batchSize: 50,
      now: () => new Date(clock + 365 * 86_400_000),
    })
    expect(sixth.claimed).toBe(0)
    expect((await messageRow(id))?.attempts).toBe(MAX_ATTEMPTS)

    // a human resend gives it exactly one more try, attempts kept
    const resend = await call<{ item: MessageOut }>(
      app,
      owner,
      'POST',
      `/notifications/messages/${id}/resend`,
      {
        idempotencyKey: `resend-${run}`,
      },
    )
    expect(resend.status).toBe(200)
    expect(resend.body.item.status).toBe('queued')
    expect(resend.body.item.attempts).toBe(MAX_ATTEMPTS)
    const ok = await dispatchDueMessages(db, stubProviders(), { batchSize: 50 })
    expect(ok.sent).toBeGreaterThanOrEqual(1)
    expect(await messageRow(id)).toMatchObject({ status: 'sent', attempts: MAX_ATTEMPTS + 1 })
    // and a delivered row is never resent
    const again = await call(app, owner, 'POST', `/notifications/messages/${id}/resend`, {
      idempotencyKey: `resend2-${run}`,
    })
    expect(again.status).toBe(409)
  })

  // -------------------------------------------------------------------------------------------------------------
  // broadcasts

  const broadcastId = uuidv7()

  it('a broadcast to a beat creates one message per reachable shop, resolves the channel per opt-in and counts them', async () => {
    const res = await call<{
      item: Record<string, unknown> & {
        totalRecipients: number
        queuedCount: number
        skippedCount: number
        beatName: string
      }
      skipped: { retailerId: string; reason: string }[]
    }>(app, manager, 'POST', '/notifications/broadcasts', {
      idempotencyKey: `bc-${run}`,
      id: broadcastId,
      channel: 'whatsapp',
      templateKey: 'scheme_announcement',
      variables: { schemeName: 'Campa 12+1', validTill: '30 Sep' },
      audience: { kind: 'beat', beatId: beatA },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    // A (whatsapp), B (sms), C (opted out), D (no phone) on beat A
    expect(res.body.item.totalRecipients).toBe(4)
    expect(res.body.item.queuedCount).toBe(2)
    expect(res.body.item.skippedCount).toBe(2)
    expect(res.body.item.beatName).toBe(`Station Road ${run}`)
    expect(res.body.skipped.map((s) => s.retailerId).sort()).toEqual([shopC, shopD].sort())
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.refType, 'broadcast'),
          eq(messages.refId, broadcastId),
        ),
      )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.recipientRetailerId === shopA)?.channel).toBe('whatsapp')
    expect(rows.find((r) => r.recipientRetailerId === shopB)?.channel).toBe('sms')
    expect(
      rows.every((r) => r.idempotencyKey === `${broadcastId}:${r.recipientRetailerId ?? ''}`),
    ).toBe(true)

    // replay: same header, no new rows
    const replay = await call<{ item: { id: string } }>(
      app,
      manager,
      'POST',
      '/notifications/broadcasts',
      {
        idempotencyKey: `bc-${run}`,
        id: broadcastId,
        channel: 'whatsapp',
        templateKey: 'scheme_announcement',
        variables: { schemeName: 'Campa 12+1', validTill: '30 Sep' },
        audience: { kind: 'beat', beatId: beatA },
      },
    )
    expect(replay.body.item.id).toBe(broadcastId)
    expect(await db.select().from(broadcasts).where(eq(broadcasts.id, broadcastId))).toHaveLength(1)

    // the sweep sends them and refreshes the counters
    await dispatchDueMessages(db, stubProviders(), { batchSize: 50 })
    const got = await call<{
      item: { sentCount: number; queuedCount: number }
      recipients: { status: string }[]
    }>(app, accountant, 'GET', `/notifications/broadcasts/${broadcastId}`)
    expect(got.status).toBe(200)
    expect(got.body.item.sentCount).toBe(2)
    expect(got.body.item.queuedCount).toBe(0)
    expect(got.body.recipients).toHaveLength(2)
    expect(got.body.recipients.every((r) => r.status === 'sent')).toBe(true)
  })

  it('refuses a broadcast whose variables do not cover the template, an unknown template, and an empty beat', async () => {
    const missing = await call<{ message: string }>(
      app,
      owner,
      'POST',
      '/notifications/broadcasts',
      {
        idempotencyKey: `bc-missing-${run}`,
        id: uuidv7(),
        channel: 'sms',
        templateKey: 'scheme_announcement',
        variables: { schemeName: 'Campa' },
        audience: { kind: 'retailers', retailerIds: [shopB] },
      },
    )
    expect(missing.status).toBe(400)
    expect(missing.body.message).toContain('variables_missing')
    const unknown = await call<{ message: string }>(
      app,
      owner,
      'POST',
      '/notifications/broadcasts',
      {
        idempotencyKey: `bc-unknown-${run}`,
        id: uuidv7(),
        channel: 'sms',
        templateKey: 'no_such_template',
        variables: {},
        audience: { kind: 'retailers', retailerIds: [shopB] },
      },
    )
    expect(unknown.status).toBe(400)
    expect(unknown.body.message).toContain('template_not_found')
    const emptyBeat = uuidv7()
    await db.insert(beats).values({ id: emptyBeat, tenantId, name: `Empty ${run}` })
    const empty = await call<{ message: string }>(app, owner, 'POST', '/notifications/broadcasts', {
      idempotencyKey: `bc-empty-${run}`,
      id: uuidv7(),
      channel: 'sms',
      templateKey: 'scheme_announcement',
      variables: { schemeName: 'Campa', validTill: 'Sep' },
      audience: { kind: 'beat', beatId: emptyBeat },
    })
    expect(empty.status).toBe(400)
    expect(empty.body.message).toContain('empty_audience')
  })

  // -------------------------------------------------------------------------------------------------------------
  // the inbox and the role rules

  it('a retailer lists only the messages addressed to its own shop, without cost or provider fields', async () => {
    const mine = await call<{ items: MessageOut[]; unreadCount: number }>(
      app,
      shop,
      'GET',
      '/notifications/messages',
    )
    expect(mine.status).toBe(200)
    expect(mine.body.items.length).toBeGreaterThanOrEqual(2) // the bill and the broadcast
    expect(mine.body.items.every((m) => m.recipientRetailerId === shopA)).toBe(true)
    expect(mine.body.items.every((m) => m.senderName === 'Notify Traders')).toBe(true)
    expect(
      mine.body.items.every(
        (m) => !('costPaise' in m) && !('providerMessageId' in m) && !('error' in m),
      ),
    ).toBe(true)
    // the other shop's login sees none of shop A's rows, even asking for them by shop
    const theirs = await call<{ items: MessageOut[] }>(
      app,
      otherShop,
      'GET',
      '/notifications/messages',
      {
        retailerId: shopA,
      },
    )
    expect(theirs.status).toBe(200)
    expect(theirs.body.items.filter((m) => m.recipientRetailerId === shopA)).toHaveLength(0)
    // RLS is the guarantee, not the handler: a direct select as the other shop returns nothing of A's
    const direct = await as(otherShop, (tx) =>
      tx.select({ id: messages.id }).from(messages).where(eq(messages.recipientRetailerId, shopA)),
    )
    expect(direct).toHaveLength(0)
    // the owner sees the same rows with the back-office fields
    const ownerView = await call<{ items: MessageOut[] }>(
      app,
      owner,
      'GET',
      '/notifications/messages',
      {
        retailerId: shopA,
      },
    )
    expect(ownerView.body.items.length).toBeGreaterThanOrEqual(2)
    expect(ownerView.body.items.every((m) => 'costPaise' in m && 'providerMessageId' in m)).toBe(
      true,
    )
    expect(ownerView.body.items.some((m) => m.retailerName === 'Alpha Kirana')).toBe(true)
  })

  it('a salesperson reads the shops on its own beats and nothing of another beat, and cannot broadcast or edit a template', async () => {
    const mine = await call<{ items: MessageOut[] }>(app, rep, 'GET', '/notifications/messages')
    expect(mine.status).toBe(200)
    expect(mine.body.items.length).toBeGreaterThanOrEqual(2)
    expect(mine.body.items.every((m) => [shopA, shopB].includes(m.recipientRetailerId ?? ''))).toBe(
      true,
    )
    expect(mine.body.items.every((m) => !('costPaise' in m))).toBe(true)
    // the other rep (beat B) sees none of beat A's rows
    const theirs = await call<{ items: MessageOut[] }>(
      app,
      otherRep,
      'GET',
      '/notifications/messages',
    )
    expect(
      theirs.body.items.filter((m) => [shopA, shopB].includes(m.recipientRetailerId ?? '')),
    ).toHaveLength(0)
    const [aRow] = await messagesByKey(`InvoiceIssued:${invoiceId}`)
    expect(
      (await call(app, otherRep, 'GET', `/notifications/messages/${aRow?.id ?? ''}`)).status,
    ).toBe(404)
    expect((await call(app, rep, 'GET', `/notifications/messages/${aRow?.id ?? ''}`)).status).toBe(
      200,
    )

    const broadcast = await call(app, rep, 'POST', '/notifications/broadcasts', {
      idempotencyKey: `bc-rep-${run}`,
      id: uuidv7(),
      channel: 'sms',
      templateKey: 'scheme_announcement',
      variables: { schemeName: 'x', validTill: 'y' },
      audience: { kind: 'beat', beatId: beatA },
    })
    expect(broadcast.status).toBe(403)
    const template = await call(app, rep, 'POST', '/notifications/templates', {
      idempotencyKey: `tpl-rep-${run}`,
      id: uuidv7(),
      key: 'order_confirmed',
      channel: 'sms',
      body: 'x {{distributorName}}',
    })
    expect(template.status).toBe(403)
    // and the database agrees: a rep cannot insert a broadcast header even by hand
    await expect(
      as(rep, (tx) =>
        tx.insert(broadcasts).values({
          id: uuidv7(),
          tenantId,
          channel: 'sms',
          templateKey: 'scheme_announcement',
          createdBy: repId,
          totalRecipients: 0,
        }),
      ),
    ).rejects.toThrow()
    // the same refusals for the godown, the crew, the accountant and the shop
    for (const [actor, label] of [
      [godown, 'warehouse'],
      [driver, 'delivery'],
      [accountant, 'accountant'],
      [shop, 'retailer'],
    ] as const) {
      const res = await call(app, actor, 'POST', '/notifications/broadcasts', {
        idempotencyKey: `bc-${label}-${run}`,
        id: uuidv7(),
        channel: 'sms',
        templateKey: 'scheme_announcement',
        variables: { schemeName: 'x', validTill: 'y' },
        audience: { kind: 'beat', beatId: beatA },
      })
      expect(res.status, label).toBe(403)
    }
    expect((await call(app, shop, 'GET', '/notifications/inbound')).status).toBe(403)
    expect((await call(app, driver, 'GET', '/notifications/inbound')).status).toBe(403)
    expect((await call(app, accountant, 'GET', '/notifications/templates')).status).toBe(200)
    expect((await call(app, accountant, 'GET', '/notifications/broadcasts')).status).toBe(200)
  })

  it('another tenant never sees or resends this tenant’s message', async () => {
    const [row] = await messagesByKey(`InvoiceIssued:${invoiceId}`)
    expect(
      (await call(app, otherOwner, 'GET', `/notifications/messages/${row?.id ?? ''}`)).status,
    ).toBe(404)
    const resend = await call(
      app,
      otherOwner,
      'POST',
      `/notifications/messages/${row?.id ?? ''}/resend`,
      {
        idempotencyKey: `resend-other-${run}`,
      },
    )
    expect(resend.status).toBe(404)
  })

  it('401 without a token', async () => {
    expect((await call(app, null, 'GET', '/notifications/messages')).status).toBe(401)
  })

  // -------------------------------------------------------------------------------------------------------------
  // the on-demand send, the read receipt, templates, push tokens, inbound

  it('messages.send queues a bill to a shop on demand; the salesperson never may', async () => {
    const id = uuidv7()
    const res = await call<{ item: MessageOut }>(
      app,
      driver,
      'POST',
      '/notifications/messages/send',
      {
        idempotencyKey: `send-${run}`,
        id,
        retailerId: shopB,
        templateKey: 'invoice_issued',
        refType: 'invoice',
        refId: invoiceId,
        channel: 'whatsapp',
        variables: {
          invoiceNo: 'INV/1',
          totalRupees: '₹10.00',
          dueDate: '2026-09-30',
          upiLink: 'upi://pay?pa=x',
        },
      },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.item.id).toBe(id)
    expect(res.body.item.channel).toBe('sms') // asked WhatsApp, shop B never opted in: downgraded, never dropped
    expect(res.body.item.status).toBe('queued')
    expect(res.body.item.body).toContain('Notify Traders')
    const repSend = await call(app, rep, 'POST', '/notifications/messages/send', {
      idempotencyKey: `send-rep-${run}`,
      id: uuidv7(),
      retailerId: shopB,
      templateKey: 'invoice_issued',
      refType: 'invoice',
      refId: invoiceId,
      variables: { invoiceNo: 'INV/1', totalRupees: '₹10.00', dueDate: '2026-09-30', upiLink: '' },
    })
    expect(repSend.status).toBe(403)
    const noPhone = await call(app, owner, 'POST', '/notifications/messages/send', {
      idempotencyKey: `send-nophone-${run}`,
      id: uuidv7(),
      retailerId: shopD,
      templateKey: 'invoice_issued',
      refType: 'invoice',
      refId: invoiceId,
      variables: { invoiceNo: 'INV/1', totalRupees: '₹10.00', dueDate: '2026-09-30', upiLink: '' },
    })
    expect(noPhone.status).toBe(409)
  })

  it('a shop marks its own in-app notice read and nothing else; a WhatsApp row is not markable', async () => {
    const welcome = await handleNotificationEvent(db, {
      tenantId,
      aggregateType: 'retailer',
      aggregateId: shopA,
      eventType: 'retailer.identity_linked',
      payload: { retailerId: shopA, userId: shopUserId },
    })
    expect(welcome.outcome).toBe('queued')
    const [notice] = await messagesByKey(`Welcome:${shopA}`)
    expect(notice?.channel).toBe('in_app')
    const unread = await call<{ items: MessageOut[]; unreadCount: number }>(
      app,
      shop,
      'GET',
      '/notifications/messages',
      {
        unreadOnly: true,
      },
    )
    expect(unread.body.unreadCount).toBe(1)
    expect(unread.body.items.map((m) => m.id)).toEqual([notice?.id])
    const read = await call<{ item: MessageOut }>(
      app,
      shop,
      'POST',
      `/notifications/messages/${notice?.id ?? ''}/read`,
      {
        idempotencyKey: `read-${run}`,
      },
    )
    expect(read.status, JSON.stringify(read.body)).toBe(200)
    expect(read.body.item.readAt).not.toBeNull()
    const twice = await call<{ item: MessageOut }>(
      app,
      shop,
      'POST',
      `/notifications/messages/${notice?.id ?? ''}/read`,
      {
        idempotencyKey: `read2-${run}`,
      },
    )
    expect(twice.status).toBe(200)
    expect(twice.body.item.readAt).toBe(read.body.item.readAt)
    expect(
      (await call<{ unreadCount: number }>(app, shop, 'GET', '/notifications/messages')).body
        .unreadCount,
    ).toBe(0)
    const [bill] = await messagesByKey(`InvoiceIssued:${invoiceId}`)
    const wa = await call<{ message: string }>(
      app,
      shop,
      'POST',
      `/notifications/messages/${bill?.id ?? ''}/read`,
      {
        idempotencyKey: `read-wa-${run}`,
      },
    )
    expect(wa.status).toBe(400)
    expect(wa.body.message).toContain('channel_not_markable')
    // the other shop's login cannot mark A's notice
    const foreign = await call(
      app,
      otherShop,
      'POST',
      `/notifications/messages/${notice?.id ?? ''}/read`,
      {
        idempotencyKey: `read-foreign-${run}`,
      },
    )
    expect(foreign.status).toBe(404)
  })

  it('templates.upsert creates a tenant override that list prefers, and enforces the white label', async () => {
    const id = uuidv7()
    const created = await call<{
      item: { isOverride: boolean; tenantId: string }
      created: boolean
    }>(app, manager, 'POST', '/notifications/templates', {
      idempotencyKey: `tpl-${run}`,
      id,
      key: 'order_confirmed',
      channel: 'sms',
      body: 'Namaste! Order {{orderNo}} ({{totalRupees}}) is confirmed. {{distributorName}}',
      variables: ['orderNo', 'totalRupees'],
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    expect(created.body.created).toBe(true)
    expect(created.body.item.isOverride).toBe(true)
    expect(created.body.item.tenantId).toBe(tenantId)
    const edited = await call<{ item: { id: string; body: string }; created: boolean }>(
      app,
      owner,
      'POST',
      '/notifications/templates',
      {
        idempotencyKey: `tpl-edit-${run}`,
        id: uuidv7(), // a new client id lands on the same row
        key: 'order_confirmed',
        channel: 'sms',
        body: 'Order {{orderNo}} ({{totalRupees}}) confirmed — {{distributorName}}',
        variables: ['orderNo', 'totalRupees'],
      },
    )
    expect(edited.status).toBe(200)
    expect(edited.body.created).toBe(false)
    expect(edited.body.item.id).toBe(id)
    const list = await call<{
      items: { key: string; channel: string; locale: string; isOverride: boolean }[]
    }>(app, accountant, 'GET', '/notifications/templates', {
      key: 'order_confirmed',
      channel: 'sms',
    })
    expect(list.status).toBe(200)
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0]?.isOverride).toBe(true)
    // the next order to shop B (SMS) uses the override
    const orderG = uuidv7()
    await handleNotificationEvent(db, {
      tenantId,
      aggregateType: 'sales_order',
      aggregateId: orderG,
      eventType: 'OrderConfirmed',
      payload: {
        orderId: orderG,
        orderNo: `SO-${run}-G`,
        retailerId: shopB,
        state: 'confirmed',
        totalPaise: 900,
      },
    })
    const [g] = await messagesByKey(`OrderConfirmed:${orderG}`)
    expect((g?.payload as Record<string, unknown>).body).toBe(
      `Order SO-${run}-G (₹9.00) confirmed — Notify Traders`,
    )

    // the three 400s
    const unknownVar = await call<{ message: string }>(
      app,
      owner,
      'POST',
      '/notifications/templates',
      {
        idempotencyKey: `tpl-unknown-${run}`,
        id: uuidv7(),
        key: 'order_confirmed',
        channel: 'whatsapp',
        body: 'Order {{orderNo}} {{oops}} {{distributorName}}',
        variables: ['orderNo'],
      },
    )
    expect(unknownVar.status).toBe(400)
    expect(unknownVar.body.message).toContain('unknown_variable')
    const reserved = await call<{ message: string }>(
      app,
      owner,
      'POST',
      '/notifications/templates',
      {
        idempotencyKey: `tpl-reserved-${run}`,
        id: uuidv7(),
        key: 'order_confirmed',
        channel: 'whatsapp',
        body: 'Order {{distributorName}}',
        variables: ['distributorName'],
      },
    )
    expect(reserved.status).toBe(400)
    expect(reserved.body.message).toContain('reserved_variable')
    const unbranded = await call<{ message: string }>(
      app,
      owner,
      'POST',
      '/notifications/templates',
      {
        idempotencyKey: `tpl-unbranded-${run}`,
        id: uuidv7(),
        key: 'order_confirmed',
        channel: 'whatsapp',
        body: 'Order {{orderNo}} confirmed',
        variables: ['orderNo'],
      },
    )
    expect(unbranded.status).toBe(400)
    expect(unbranded.body.message).toContain('distributor_name_missing')
    // the backstop: even a manager cannot touch a platform-default row by hand
    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(templates)
      .where(sql`tenant_id is null and key = 'welcome'`)
    await as(manager, (tx) =>
      tx
        .update(templates)
        .set({ body: 'hijacked' })
        .where(sql`tenant_id is null and key = 'welcome'`),
    )
    const hijacked = await db
      .select({ body: templates.body })
      .from(templates)
      .where(sql`tenant_id is null and key = 'welcome' and body = 'hijacked'`)
    expect(hijacked).toHaveLength(0)
    expect(before[0]?.n).toBeGreaterThanOrEqual(1)
  })

  it('push tokens upsert by device for the caller only, and unregister removes only one’s own', async () => {
    const id = uuidv7()
    const first = await call<{ item: { id: string; userId: string }; created: boolean }>(
      app,
      driver,
      'POST',
      '/notifications/push-tokens',
      {
        idempotencyKey: `pt-${run}`,
        id,
        deviceId: `phone-${run}`,
        token: 'ExponentPushToken[first]',
        platform: 'android',
      },
    )
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.created).toBe(true)
    expect(first.body.item.userId).toBe(driverId)
    const second = await call<{ item: { id: string }; created: boolean }>(
      app,
      driver,
      'POST',
      '/notifications/push-tokens',
      {
        idempotencyKey: `pt2-${run}`,
        id: uuidv7(),
        deviceId: `phone-${run}`,
        token: 'ExponentPushToken[second]',
        platform: 'android',
      },
    )
    expect(second.status).toBe(200)
    expect(second.body.created).toBe(false)
    expect(second.body.item.id).toBe(id)
    const rows = await db.execute(sql`select token from push_tokens where id = ${id}`)
    expect((rows.rows[0] as { token: string }).token).toBe('ExponentPushToken[second]')
    // the shop registers nothing
    const shopToken = await call(app, shop, 'POST', '/notifications/push-tokens', {
      idempotencyKey: `pt-shop-${run}`,
      id: uuidv7(),
      deviceId: 'x',
      token: 'y',
      platform: 'ios',
    })
    expect(shopToken.status).toBe(403)
    // a co-worker cannot remove the driver's device
    const foreign = await call(app, rep, 'POST', `/notifications/push-tokens/${id}/unregister`, {
      idempotencyKey: `pt-foreign-${run}`,
    })
    expect(foreign.status).toBe(404)
    const own = await call<{ ok: boolean }>(
      app,
      driver,
      'POST',
      `/notifications/push-tokens/${id}/unregister`,
      {
        idempotencyKey: `pt-own-${run}`,
      },
    )
    expect(own.status).toBe(200)
    expect(own.body.ok).toBe(true)
    expect((await db.execute(sql`select 1 from push_tokens where id = ${id}`)).rows).toHaveLength(0)
  })

  it('inbound triage: the rep sees its own beats’ texts, marks one handled without touching the text', async () => {
    const inA = uuidv7()
    const inE = uuidv7()
    const inUnknown = uuidv7()
    await db.insert(inboundMessages).values([
      {
        id: inA,
        tenantId,
        channel: 'whatsapp',
        from: shopPhoneA,
        retailerId: shopA,
        body: 'bhai 2 case campa kal',
      },
      {
        id: inE,
        tenantId,
        channel: 'whatsapp',
        from: shopPhoneE,
        retailerId: shopE,
        body: 'payment done',
      },
      { id: inUnknown, tenantId, channel: 'sms', from: `+919${run}99`, body: 'who is this' },
    ])
    const repView = await call<{ items: { id: string }[]; unhandledCount: number }>(
      app,
      rep,
      'GET',
      '/notifications/inbound',
    )
    expect(repView.status).toBe(200)
    expect(repView.body.items.map((i) => i.id)).toEqual([inA])
    expect(repView.body.unhandledCount).toBe(1)
    const deskView = await call<{ items: { id: string }[]; unhandledCount: number }>(
      app,
      accountant,
      'GET',
      '/notifications/inbound',
      {
        handled: false,
      },
    )
    expect(deskView.body.items.map((i) => i.id).sort()).toEqual([inA, inE, inUnknown].sort())
    expect(deskView.body.unhandledCount).toBe(3)
    const foreign = await call(app, rep, 'POST', `/notifications/inbound/${inE}/handled`, {
      idempotencyKey: `in-foreign-${run}`,
    })
    expect(foreign.status).toBe(404)
    const handled = await call<{ item: { handled: boolean; body: string; fromPhone: string } }>(
      app,
      rep,
      'POST',
      `/notifications/inbound/${inA}/handled`,
      {
        idempotencyKey: `in-${run}`,
      },
    )
    expect(handled.status).toBe(200)
    expect(handled.body.item).toMatchObject({
      handled: true,
      body: 'bhai 2 case campa kal',
      fromPhone: shopPhoneA,
    })
  })

  it('dues reminders go once per shop per seven days', async () => {
    const overdue = [{ retailerId: shopB, overduePaise: 250_000, oldestDueDate: '2026-08-01' }]
    const first = await queueDuesReminders(db, tenantId, overdue)
    expect(first).toEqual({ queued: 1, cooled: 0, skipped: 0 })
    const second = await queueDuesReminders(db, tenantId, overdue)
    expect(second).toEqual({ queued: 0, cooled: 1, skipped: 0 })
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, tenantId),
          eq(messages.recipientRetailerId, shopB),
          eq(messages.templateKey, 'dues_reminder'),
        ),
      )
    expect(rows).toHaveLength(1)
    expect((rows[0]?.payload as Record<string, unknown>).body).toContain('₹2,500.00')
    // an opted-out shop is skipped, never reminded
    const blocked = await queueDuesReminders(db, tenantId, [
      { retailerId: shopC, overduePaise: 100, oldestDueDate: null },
    ])
    expect(blocked).toEqual({ queued: 0, cooled: 0, skipped: 1 })
  })
})
