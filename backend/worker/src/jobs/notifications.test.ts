import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import {
  accounts,
  bootstrapTenant,
  createDb,
  createPool,
  invoices,
  journalEntries,
  journalLines,
  loadDotenv,
  messages,
  retailerIdentities,
  retailerLinks,
  retailers,
  templates,
  tenants,
  tenantSettings,
  TENANT_SETTING_KEYS,
  type Db,
} from '@dos/db'
import { businessDate, financialYear, uuidv7 } from '@dos/domain'
import { stubProviders } from '@dos/core/notifications'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerNotificationsJobs, sendStatement } from './notifications.js'
import { clearOutboxHandlers, registeredEventTypes, type OutboxEvent } from './outbox-relay.js'

loadDotenv()
process.env.DATABASE_POOL_MAX ??= '3'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** A pg-boss that accepts every queue, worker and schedule and runs nothing. */
const idleBoss = {
  createQueue: async () => undefined,
  work: async () => 'idle',
  schedule: async () => undefined,
  send: async () => null,
} as unknown as PgBoss

/** IST business day `offset` days from today, `YYYY-MM-DD`. */
function day(offset: number): string {
  const iso = businessDate().date
  const at = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  )
  return new Date(at + offset * 86_400_000).toISOString().slice(0, 10)
}

describe('notifications jobs registration', () => {
  afterAll(() => {
    clearOutboxHandlers()
  })

  it('DOS-007: registering the notifications jobs gives StatementRequested an outbox relay handler', async () => {
    clearOutboxHandlers()
    await registerNotificationsJobs(idleBoss, {} as Db, stubProviders())
    // The relay claims only rows whose type has a handler: without one, "Send statement" waits forever.
    expect(registeredEventTypes()).toContain('StatementRequested')
  })
})

describeDb('StatementRequested → one statement message (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const tenantId = uuidv7()
  /** Owes nothing. */
  const quiet = uuidv7()
  /** One bill of ₹1,234.50 issued ten days ago, due in five. */
  const owing = uuidv7()
  const phoneQuiet = `+9197${run}1`
  const phoneOwing = `+9197${run}2`
  const billId = uuidv7()

  const byKey = (key: string) =>
    db
      .select()
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.idempotencyKey, key)))
  const eventFor = (retailerId: string, payload: Record<string, unknown> = {}): OutboxEvent => ({
    id: uuidv7(),
    tenantId,
    aggregateType: 'retailer',
    aggregateId: retailerId,
    eventType: 'StatementRequested',
    payload: {
      jobId: uuidv7(),
      retailerId,
      from: day(-90),
      to: day(0),
      channel: 'whatsapp',
      includeUpiQr: true,
      ...payload,
    },
    attempts: 0,
  })
  const platformTemplate = (
    key: string,
    channel: 'whatsapp' | 'sms',
    body: string,
    variables: string[],
  ) => ({
    id: uuidv7(),
    tenantId: null,
    key,
    channel,
    locale: 'en-IN',
    providerTemplateName: channel === 'whatsapp' ? `${key}_en` : null,
    body,
    variables,
    active: true,
  })
  const period = ['fromDate', 'toDate', 'openingRupees', 'closingRupees', 'overdueRupees']

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values({ id: tenantId, slug: `stm-${run}`, legalName: 'Statement Spec', stateCode: '27' })
    await bootstrapTenant(db, tenantId)
    await db
      .insert(tenantSettings)
      .values([
        { tenantId, key: TENANT_SETTING_KEYS.brandingDisplayName, value: 'Statement Traders' },
        { tenantId, key: TENANT_SETTING_KEYS.upiVpa, value: `stm${run}@okhdfcbank` },
      ])
      .onConflictDoUpdate({
        target: [tenantSettings.tenantId, tenantSettings.key],
        set: { value: sql`excluded.value` },
      })
    await db.insert(retailers).values([
      {
        id: quiet,
        tenantId,
        code: `STM-${run}-Q`,
        name: 'Quiet Kirana',
        phone: phoneQuiet,
        stateCode: '27',
      },
      {
        id: owing,
        tenantId,
        code: `STM-${run}-O`,
        name: 'Owing Stores',
        phone: phoneOwing,
        stateCode: '27',
      },
    ])
    const identityQuiet = uuidv7()
    const identityOwing = uuidv7()
    await db.insert(retailerIdentities).values([
      { id: identityQuiet, phone: phoneQuiet, shopName: 'Quiet Kirana' },
      { id: identityOwing, phone: phoneOwing, shopName: 'Owing Stores' },
    ])
    await db.insert(retailerLinks).values(
      [
        [identityQuiet, quiet],
        [identityOwing, owing],
      ].map(([identityId, retailerId]) => ({
        id: uuidv7(),
        tenantId,
        identityId: identityId ?? '',
        retailerId: retailerId ?? '',
        role: 'owner' as const,
        linkedBy: 'rep_onboarding' as const,
        status: 'active' as const,
        whatsappOptinAt: new Date(),
        consentedAt: new Date(),
      })),
    )
    await db
      .insert(templates)
      .values([
        platformTemplate(
          'statement',
          'whatsapp',
          'Statement {{fromDate}} to {{toDate}}: opening {{openingRupees}}, closing {{closingRupees}}, overdue {{overdueRupees}}. Pay: {{upiLink}} — {{distributorName}}',
          [...period, 'upiLink'],
        ),
        platformTemplate(
          'statement',
          'sms',
          'Statement {{fromDate}} to {{toDate}}: balance {{closingRupees}}, overdue {{overdueRupees}}. UPI: {{upiLink}} {{distributorName}}',
          [...period, 'upiLink'],
        ),
        platformTemplate(
          'statement_no_upi',
          'whatsapp',
          'Statement {{fromDate}} to {{toDate}}: opening {{openingRupees}}, closing {{closingRupees}}, overdue {{overdueRupees}}. — {{distributorName}}',
          period,
        ),
        platformTemplate(
          'statement_no_upi',
          'sms',
          'Statement {{fromDate}} to {{toDate}}: balance {{closingRupees}}, overdue {{overdueRupees}}. {{distributorName}}',
          period,
        ),
      ])
      .onConflictDoNothing()
    // The bill, and its AR entry the way receivables books one: DR the shop's AR, CR sales.
    await db.insert(invoices).values({
      id: billId,
      tenantId,
      invoiceNo: `STM/${run}/001`,
      seriesCode: 'INV',
      fy: financialYear(),
      invoiceDate: day(-10),
      retailerId: owing,
      state: 'issued',
      buyerName: 'Owing Stores',
      placeOfSupplyState: '27',
      subtotalPaise: 123_450,
      taxablePaise: 123_450,
      totalPaise: 123_450,
      dueDate: day(5),
    })
    const chart = await db
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.code, ['AR', 'SALES'])))
    const ar = chart.find((a) => a.code === 'AR')?.id ?? ''
    const sales = chart.find((a) => a.code === 'SALES')?.id ?? ''
    const entryId = uuidv7()
    await db.transaction(async (tx) => {
      await tx.insert(journalEntries).values({
        id: entryId,
        tenantId,
        entryDate: day(-10),
        refType: 'invoice',
        refId: billId,
        idempotencyKey: `stm-${run}-bill`,
      })
      await tx.insert(journalLines).values([
        {
          id: uuidv7(),
          tenantId,
          entryId,
          accountId: ar,
          amountPaise: 123_450,
          partyType: 'retailer',
          partyId: owing,
        },
        { id: uuidv7(), tenantId, entryId, accountId: sales, amountPaise: -123_450 },
      ])
    })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('DOS-007: sendStatement turns a StatementRequested event into one statement message keyed on the outbox event id, a replay adds nothing and a pdf row is ignored', async () => {
    // A shop that owes nothing: the period's figures from the books, and the wording with no pay link.
    const quietEvent = eventFor(quiet)
    expect((await sendStatement(db, quietEvent)).outcome).toBe('queued')
    expect((await sendStatement(db, quietEvent)).outcome).toBe('replayed')
    const quietRows = await byKey(`Statement:${quietEvent.id}`)
    expect(quietRows).toHaveLength(1)
    expect(quietRows[0]).toMatchObject({
      channel: 'whatsapp',
      to: phoneQuiet,
      templateKey: 'statement_no_upi',
      refType: 'retailer',
      refId: quiet,
      recipientRetailerId: quiet,
    })
    expect(quietRows[0]?.payload).toMatchObject({
      fromDate: day(-90),
      toDate: day(0),
      openingRupees: '₹0.00',
      closingRupees: '₹0.00',
      overdueRupees: '₹0.00',
    })
    expect(quietRows[0]?.payload).not.toHaveProperty('upiLink')

    // A shop that owes today, on a window that closed before the bill: the link asks for TODAY's dues.
    const owingEvent = eventFor(owing, { to: day(-20) })
    expect((await sendStatement(db, owingEvent)).outcome).toBe('queued')
    const owingRows = await byKey(`Statement:${owingEvent.id}`)
    expect(owingRows).toHaveLength(1)
    expect(owingRows[0]).toMatchObject({ templateKey: 'statement', to: phoneOwing })
    expect(owingRows[0]?.payload).toMatchObject({
      toDate: day(-20),
      closingRupees: '₹0.00',
      upiLink: `upi://pay?pa=stm${run}%40okhdfcbank&pn=Statement%20Traders&am=1234.50&cu=INR`,
    })

    // Only a row written before the 501 can ask for a PDF; it, a malformed payload and a shop that is not
    // this distributor's are ignored and write nothing.
    const pdfEvent = eventFor(quiet, { channel: 'pdf' })
    expect((await sendStatement(db, pdfEvent)).outcome).toBe('ignored')
    expect(await byKey(`Statement:${pdfEvent.id}`)).toHaveLength(0)
    const malformed = eventFor(quiet, { from: 20260614 })
    expect((await sendStatement(db, malformed)).outcome).toBe('ignored')
    expect(await byKey(`Statement:${malformed.id}`)).toHaveLength(0)
    const stranger = eventFor(uuidv7())
    expect((await sendStatement(db, stranger)).outcome).toBe('ignored')
    expect(await byKey(`Statement:${stranger.id}`)).toHaveLength(0)
  })
})
