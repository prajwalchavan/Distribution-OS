import { sql } from 'drizzle-orm'
import type { PgBoss } from 'pg-boss'
import type * as Reporting from '@dos/core/reporting'
import {
  ageingSnapshots,
  createDb,
  createPool,
  invoices,
  loadDotenv,
  retailerOutstandingSummary,
  retailers,
  tenants,
} from '@dos/db'
import { businessDate, financialYear, uuidv7 } from '@dos/domain'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { registerReportingJobs } from './reporting.js'

/**
 * The dev database holds thousands of spec tenants, so the fan-out sees only this file's own, and the
 * 30-day behaviour pass (not what these tests are about) is skipped. `rollupTenantDay` and
 * `@dos/core/receivables` stay real.
 */
const hoisted = vi.hoisted(() => ({ tenants: [] as string[] }))
vi.mock('@dos/core/reporting', async (importOriginal) => ({
  ...(await importOriginal<typeof Reporting>()),
  activeTenantIds: async () => [...hoisted.tenants],
  rollupBehaviour: async () => 0,
}))

loadDotenv()
process.env.DATABASE_POOL_MAX ??= '3'

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

const plusDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** IST business day `offset` days from today (the real clock), `YYYY-MM-DD`. */
const day = (offset: number): string => plusDays(businessDate().date, offset)

interface Sent {
  name: string
  data: Record<string, unknown>
  options: Record<string, unknown> | undefined
  /** On a `reporting.rollup.tenant` send: the tenant's dues `as_of` at the moment the job was queued. */
  duesAsOf?: string | null
}
type Handler = (jobs: { data: unknown }[]) => Promise<unknown>

/**
 * A pg-boss that keeps what it is given — queues, workers, sends — and, like pg-boss 12, refuses a send
 * to a queue nobody created. Jobs run only when a test drains them.
 */
function fakeBoss(duesAsOf: (tenantId: string) => Promise<string | null>) {
  const queues = new Set<string>()
  const handlers = new Map<string, Handler>()
  const sent: Sent[] = []
  const boss = {
    createQueue: async (name: string) => {
      queues.add(name)
    },
    work: async (name: string, ...rest: unknown[]) => {
      handlers.set(name, rest[rest.length - 1] as Handler)
      return `work-${name}`
    },
    schedule: async () => undefined,
    send: async (
      name: string,
      data: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<string> => {
      if (!queues.has(name)) throw new Error(`Queue ${name} does not exist`)
      const job: Sent = { name, data, options }
      if (name === 'reporting.rollup.tenant') job.duesAsOf = await duesAsOf(data.tenantId as string)
      sent.push(job)
      return uuidv7()
    },
  }
  const run = async (name: string, data: unknown): Promise<void> => {
    const handler = handlers.get(name)
    if (!handler) throw new Error(`no worker registered for ${name}`)
    await handler([{ data }])
  }
  return {
    boss: boss as unknown as PgBoss,
    sent,
    handlers,
    run,
    /** Runs the stored worker once for every matching job sent so far, as pg-boss would fetch them. */
    drain: async (name: string, filter: (job: Sent) => boolean = () => true): Promise<void> => {
      for (const job of sent.filter((s) => s.name === name && filter(s))) await run(name, job.data)
    },
  }
}

describeDb('DOS-117 nightly ageing through the reporting jobs (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = uuidv7().slice(-8)
  const fy = financialYear()
  let seq = 0

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(async () => {
    hoisted.tenants = []
    await pool.end()
  })

  /** A distributor with one shop on 15 credit days, its open bills, and the dues row its last posting wrote. */
  async function shopWithDues(input: {
    label: string
    bills: { totalPaise: number; dueDate: string }[]
    summary: {
      asOf: string
      outstandingPaise: number
      overduePaise: number
      bucket0to7Paise: number
      openBills: number
    }
  }): Promise<{ tenantId: string; retailerId: string }> {
    seq += 1
    const tenantId = uuidv7()
    const retailerId = uuidv7()
    const name = `Quiet Kirana ${String(seq)}`
    await db.insert(tenants).values({
      id: tenantId,
      slug: `age-${input.label}-${run}`,
      legalName: `Ageing ${input.label}`,
      stateCode: '27',
    })
    await db.insert(retailers).values({
      id: retailerId,
      tenantId,
      code: `AGE-${run}-${String(seq)}`,
      name,
      phone: `+91990000${String(seq).padStart(4, '0')}`,
      stateCode: '27',
      creditDays: 15,
    })
    for (const [i, bill] of input.bills.entries()) {
      // The columns billing writes for an issued bill (receivables.spec.ts `seedInvoice`).
      await db.insert(invoices).values({
        id: uuidv7(),
        tenantId,
        invoiceNo: `INV/${run}/${String(i + 1).padStart(3, '0')}`,
        seriesCode: 'INV',
        fy,
        invoiceDate: plusDays(bill.dueDate, -15),
        retailerId,
        state: 'issued',
        buyerName: name,
        placeOfSupplyState: '27',
        subtotalPaise: bill.totalPaise,
        taxablePaise: bill.totalPaise,
        totalPaise: bill.totalPaise,
        dueDate: bill.dueDate,
      })
    }
    await db.insert(retailerOutstandingSummary).values({ tenantId, retailerId, ...input.summary })
    return { tenantId, retailerId }
  }

  const duesAsOf = async (tenantId: string): Promise<string | null> => {
    const result = await db.execute(sql`
      select min(as_of)::text as as_of from retailer_outstanding_summary where tenant_id = ${tenantId}`)
    const value = result.rows[0]?.as_of
    return typeof value === 'string' ? value : null
  }

  const duesOf = async (tenantId: string) => {
    const result = await db.execute(sql`
      select retailer_id, as_of::text as as_of, outstanding_paise, overdue_paise,
             bucket_0_7_paise, bucket_8_15_paise
        from retailer_outstanding_summary where tenant_id = ${tenantId} order by retailer_id`)
    return result.rows.map((r) => ({
      retailerId: String(r.retailer_id),
      asOf: String(r.as_of),
      outstanding: Number(r.outstanding_paise),
      overdue: Number(r.overdue_paise),
      b0_7: Number(r.bucket_0_7_paise),
      b8_15: Number(r.bucket_8_15_paise),
    }))
  }

  const snapshotsOf = async (tenantId: string) => {
    const result = await db.execute(sql`
      select retailer_id, as_of::text as as_of, outstanding_paise, overdue_paise,
             bucket_0_7_paise, bucket_8_15_paise
        from ageing_snapshots where tenant_id = ${tenantId} order by as_of, retailer_id`)
    return result.rows.map((r) => ({
      retailerId: String(r.retailer_id),
      asOf: String(r.as_of),
      outstanding: Number(r.outstanding_paise),
      overdue: Number(r.overdue_paise),
      b0_7: Number(r.bucket_0_7_paise),
      b8_15: Number(r.bucket_8_15_paise),
    }))
  }

  it("DOS-117: the 00:20 IST finalize queues one ageing rebuild per tenant, and that job re-dates a quiet shop's dues to the new business date before it sends the tenant's rollup: stored overdue, buckets, the day's snapshot and owner_summary equal the live recompute", async () => {
    const today = day(0)
    const tomorrow = day(1)
    // ₹500 due today and ₹300 due a week ago. Today's last posting stored ₹300 overdue, all of it 0-7.
    const { tenantId, retailerId } = await shopWithDues({
      label: 'fin',
      bills: [
        { totalPaise: 50_000, dueDate: today },
        { totalPaise: 30_000, dueDate: day(-7) },
      ],
      summary: {
        asOf: today,
        outstandingPaise: 80_000,
        overduePaise: 30_000,
        bucket0to7Paise: 80_000,
        openBills: 2,
      },
    })
    hoisted.tenants = [tenantId]
    // The next IST business date, at the finalize's cron slot; nothing is posted in between.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${tomorrow}T00:20:00+05:30`))

    const fake = fakeBoss(duesAsOf)
    await registerReportingJobs(fake.boss, db)
    await fake.run('reporting.rollup.finalize', {})

    expect(fake.sent.filter((s) => s.name === 'receivables.ageing.rebuild')).toEqual([
      {
        name: 'receivables.ageing.rebuild',
        data: { tenantId, day: tomorrow },
        options: { singletonKey: `receivables-ageing:${tenantId}:${tomorrow}` },
      },
    ])

    await fake.drain('receivables.ageing.rebuild')
    // The bill due today is now a day overdue; the week-old one has moved to 8-15 days.
    const live = { retailerId, asOf: tomorrow, outstanding: 80_000, overdue: 80_000 }
    expect(await duesOf(tenantId)).toEqual([{ ...live, b0_7: 50_000, b8_15: 30_000 }])
    expect(await snapshotsOf(tenantId)).toEqual([{ ...live, b0_7: 50_000, b8_15: 30_000 }])
    // The tenant's rollup for the new day is queued only once the re-dated rows are committed.
    expect(
      fake.sent.filter((s) => s.name === 'reporting.rollup.tenant' && s.data.day === tomorrow),
    ).toEqual([
      {
        name: 'reporting.rollup.tenant',
        data: { tenantId, day: tomorrow },
        options: { singletonKey: `reporting-rollup:${tenantId}:${tomorrow}` },
        duesAsOf: tomorrow,
      },
    ])

    await fake.drain('reporting.rollup.tenant', (s) => s.data.day === tomorrow)
    const owner = await db.execute(sql`
      select overdue_paise, detail from owner_summary where tenant_id = ${tenantId}`)
    expect(Number(owner.rows[0]?.overdue_paise)).toBe(80_000)
    expect((owner.rows[0]?.detail as { ageingB8_15?: number } | undefined)?.ageingB8_15).toBe(
      30_000,
    )
    const stats = await db.execute(sql`
      select overdue_paise from daily_tenant_stats where tenant_id = ${tenantId} and day = ${tomorrow}`)
    expect(Number(stats.rows[0]?.overdue_paise)).toBe(80_000)
  })

  it('DOS-117: on worker start the catch-up queues a rebuild only for a tenant with dues rows dated before today (pg-boss never backfills a missed 00:20) and leaves a current tenant untouched', async () => {
    const today = day(0)
    // A: the worker was down at 00:20, so its dues row is still yesterday's, over a bill due three days ago.
    const stale = await shopWithDues({
      label: 'stale',
      bills: [{ totalPaise: 40_000, dueDate: day(-3) }],
      summary: {
        asOf: day(-1),
        outstandingPaise: 40_000,
        overduePaise: 40_000,
        bucket0to7Paise: 40_000,
        openBills: 1,
      },
    })
    // B: already re-dated today, with today's snapshot.
    const current = await shopWithDues({
      label: 'current',
      bills: [],
      summary: {
        asOf: today,
        outstandingPaise: 0,
        overduePaise: 0,
        bucket0to7Paise: 0,
        openBills: 0,
      },
    })
    await db.insert(ageingSnapshots).values({
      tenantId: current.tenantId,
      retailerId: current.retailerId,
      asOf: today,
      outstandingPaise: 0,
    })
    const touchedAt = async (tenantId: string): Promise<string> => {
      const result = await db.execute(sql`
        select max(updated_at)::text as at from retailer_outstanding_summary where tenant_id = ${tenantId}`)
      return String(result.rows[0]?.at)
    }
    const currentBefore = await touchedAt(current.tenantId)
    hoisted.tenants = [stale.tenantId, current.tenantId]

    const fake = fakeBoss(duesAsOf)
    await registerReportingJobs(fake.boss, db)
    expect(fake.sent.filter((s) => s.name === 'receivables.ageing.catchup')).toHaveLength(1)
    await fake.drain('receivables.ageing.catchup')

    expect(fake.sent.filter((s) => s.name === 'receivables.ageing.rebuild')).toEqual([
      {
        name: 'receivables.ageing.rebuild',
        data: { tenantId: stale.tenantId, day: today },
        options: { singletonKey: `receivables-ageing:${stale.tenantId}:${today}` },
      },
    ])
    await fake.drain('receivables.ageing.rebuild')
    expect((await duesOf(stale.tenantId)).map((d) => [d.retailerId, d.asOf, d.overdue])).toEqual([
      [stale.retailerId, today, 40_000],
    ])
    expect((await snapshotsOf(stale.tenantId)).map((s) => s.asOf)).toEqual([today])
    expect(fake.sent.filter((s) => s.name === 'reporting.rollup.tenant')).toEqual([
      {
        name: 'reporting.rollup.tenant',
        data: { tenantId: stale.tenantId, day: today },
        options: { singletonKey: `reporting-rollup:${stale.tenantId}:${today}` },
        duesAsOf: today,
      },
    ])

    expect(await touchedAt(current.tenantId)).toBe(currentBefore)
    expect(fake.sent.filter((s) => s.data.tenantId === current.tenantId)).toEqual([])
  })

  it('DOS-117: an ageing rebuild job that runs on a later business date than it was queued for ages to the run-time date, never back to the queued date', async () => {
    const today = day(0)
    const tomorrow = day(1)
    const { tenantId } = await shopWithDues({
      label: 'late',
      bills: [{ totalPaise: 25_000, dueDate: today }],
      summary: {
        asOf: today,
        outstandingPaise: 25_000,
        overduePaise: 0,
        bucket0to7Paise: 25_000,
        openBills: 1,
      },
    })
    hoisted.tenants = []
    // Queued for today (a finalize's job, or a retry of it), fetched only after the next IST midnight.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${tomorrow}T00:05:00+05:30`))

    const fake = fakeBoss(duesAsOf)
    await registerReportingJobs(fake.boss, db)
    expect(fake.handlers.has('receivables.ageing.rebuild')).toBe(true)
    await fake.run('receivables.ageing.rebuild', { tenantId, day: today })

    expect((await duesOf(tenantId)).map((d) => [d.asOf, d.overdue])).toEqual([[tomorrow, 25_000]])
    const snapshots = (await snapshotsOf(tenantId)).map((s) => s.asOf)
    expect(snapshots).toEqual([tomorrow])
    expect(snapshots).not.toContain(today)
  })
})
