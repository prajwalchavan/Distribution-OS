import { randomBytes } from 'node:crypto'
import {
  bootstrapTenant,
  createDb,
  createPool,
  hashPassword,
  hsnRates,
  loadDotenv,
  manufacturers,
  memberships,
  priceListItems,
  retailers,
  tenants,
  users,
  withTenant,
  type Db,
} from '@dos/db'
import { uuidv7 } from '@dos/domain'
import { eq, like, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPlan, type Plan } from './plan.js'
import type { LegacyBill, LegacyCustomer, LegacyItem } from './types.js'
import {
  findTenant,
  writePlan,
  type StepName,
  type TenantHandle,
  type WriteResult,
} from './writer.js'

/**
 * The writer against a real, migrated Postgres (skipped without DATABASE_URL, like every DB-backed spec
 * in this repository). It builds its own distributor (bootstrapped the way `infra/docker/bootstrap.mjs`
 * does it) and its own catalogue rows with a random suffix, so it can run beside the other specs and
 * again on the same database. Every name, phone and bill here is synthetic.
 */
loadDotenv()
const DATABASE_URL = process.env.DATABASE_URL
const describeDb = DATABASE_URL ? describe : describe.skip

const digits = (n: number): string => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0')

describeDb('legacy writer (database)', () => {
  const run = randomBytes(4).toString('hex')
  const stem = `88${digits(5)}` // an HSN prefix no curated row uses
  const hsn = (n: number): string => `${stem}${String(n)}`
  const HSN = { plain: hsn(1), older: hsn(2), newer: hsn(3), fallback: hsn(4) }
  let pool: pg.Pool
  let db: Db
  let tenant: TenantHandle

  const item = (code: string, row: number, over: Partial<LegacyItem> = {}): LegacyItem => ({
    code,
    title: `SYNTH ${run} ${code}`,
    packLabel: 'EACH',
    unitKind: 'each',
    mfgCode: 'SM',
    mfgName: `SYNTH MAKER ${run}`,
    gstBps: 500,
    hsnRaw: HSN.plain,
    salePaise: 416,
    mrpPaise: 500,
    active: true,
    row,
    ...over,
  })
  const shop = (code: string, over: Partial<LegacyCustomer> = {}): LegacyCustomer => ({
    code,
    name: `SYNTH SHOP ${run} ${code}`,
    address1: 'LANE 1',
    address2: '',
    address3: '',
    phoneRaw: `9000${digits(6)}`,
    altPhoneRaw: '',
    areaName: `SYNTH AREA ${run}`,
    pincode: '421301',
    gstinRaw: '',
    ownerName: '',
    email: '',
    pan: '',
    stateCode: '27',
    foodLicense: '',
    ...over,
  })
  const bill = (no: string, cashAcc: string, amount: number, received = 0): LegacyBill => ({
    bookCode: 'GL',
    salYear: '2026',
    billNo: no,
    cashAcc,
    title: '',
    areaName: '',
    salesman: '',
    billDate: '2026-06-04',
    dueDate: '2026-06-04',
    amountPaise: amount,
    receivedPaise: received,
    creditDays: 0,
    row: 2,
  })

  const planOf = (): Plan =>
    buildPlan(
      {
        items: [
          item('A', 2),
          item('B', 3),
          item('C', 4, { hsnRaw: HSN.older }),
          item('D', 5, { hsnRaw: HSN.newer }),
          item('E', 6, { hsnRaw: null }),
          item('F', 7, { salePaise: null, mrpPaise: null }),
        ],
        customers: [shop('1'), shop('2', { phoneRaw: '0' }), shop('3')],
        bills: [
          bill('101', '1', 450_000),
          bill('102', '1', 100_000, 40_000),
          bill('103', '2', 25_050),
        ],
        salesGst: [],
      },
      {
        asOf: '2026-09-26',
        ratesFrom: '2025-09-22',
        hsnFallback: new Map([[500, HSN.fallback]]),
        defaultState: '27',
      },
    )

  const write = (plan: Plan): Promise<WriteResult> =>
    writePlan(db, tenant, plan, {
      asOf: '2026-09-26',
      ratesFrom: '2025-09-22',
      openingStock: false,
      suppliers: [],
      log: () => undefined,
    })
  const total = (r: WriteResult, key: keyof WriteResult['steps'][StepName]): number =>
    Object.values(r.steps).reduce((s, x) => s + x[key], 0)

  const snapshot = async (): Promise<Record<string, number>> =>
    withTenant(
      db,
      { tenantId: tenant.tenantId, actorId: tenant.ownerId, actorRole: 'owner' },
      async (tx) => {
        const one = async (q: ReturnType<typeof sql>): Promise<number> => {
          const r = await tx.execute(q)
          return Number((r.rows[0] as { n: string | number }).n)
        }
        return {
          retailers: await one(sql`select count(*) as n from retailers`),
          codes: await one(sql`select count(*) as n from external_party_codes`),
          invoices: await one(sql`select count(*) as n from invoices`),
          journal: await one(sql`select count(*) as n from journal_lines`),
          ar: await one(
            sql`select coalesce(sum(l.amount_paise), 0) as n from journal_lines l join accounts a on a.id = l.account_id where a.code = 'AR'`,
          ),
          products: await one(sql`select count(*) as n from tenant_products`),
          priceItems: await one(sql`select count(*) as n from price_list_items`),
          beats: await one(sql`select count(*) as n from beats`),
          keys: await one(sql`select count(*) as n from idempotency_keys`),
        }
      },
    )

  beforeAll(async () => {
    pool = createPool(DATABASE_URL ?? '', 3)
    db = createDb(pool)
    const tenantId = uuidv7()
    const ownerId = uuidv7()
    await db.insert(tenants).values({
      id: tenantId,
      slug: `legacy-${run}`,
      legalName: `Synthetic ${run}`,
      stateCode: '27',
    })
    await db.insert(users).values({
      id: ownerId,
      phone: `+9190${digits(8)}`,
      name: 'Synthetic Owner',
      locale: 'en-IN',
      username: `owner.legacy.${run}`,
      passwordHash: await hashPassword(randomBytes(18).toString('base64url')),
      passwordChangedAt: new Date(),
    })
    await db.insert(memberships).values({ id: uuidv7(), tenantId, userId: ownerId, role: 'owner' })
    await bootstrapTenant(db, tenantId)
    tenant = await findTenant(db, `legacy-${run}`)
    // the curated catalogue as the migrations leave it: an OLD rate for one heading, a NEWER (curator-dated) one for another
    await withTenant(db, { ...ownerCtx(), actorRole: 'curator' }, async (tx) => {
      await tx.insert(hsnRates).values([
        {
          id: uuidv7(),
          hsnCode: HSN.older,
          description: 'synthetic old rate',
          gstBps: 1200,
          cessBps: 0,
          effectiveFrom: '2017-07-01',
        },
        {
          id: uuidv7(),
          hsnCode: HSN.newer,
          description: 'synthetic newer rate',
          gstBps: 4000,
          cessBps: 0,
          effectiveFrom: '2026-01-01',
        },
      ])
    })
  })

  const ownerCtx = () => ({
    tenantId: tenant?.tenantId ?? '',
    actorId: tenant?.ownerId ?? '',
    actorRole: 'owner' as const,
  })

  afterAll(async () => {
    await pool.end()
  })

  it('loads the plan through the services and the ledger opens with exactly the planned receivable', async () => {
    const plan = planOf()
    const first = await write(plan)
    expect(first.failures).toEqual([])
    expect(first.steps.manufacturers).toMatchObject({ created: 1 })
    // plain (5%), older (12% → 5% from 2025-09-22), fallback (assumed for E): three headings; `newer` is held back
    expect(first.steps.hsnRates).toMatchObject({ created: 3, skipped: 1 })
    expect(first.notes.hsnHeadingsHeldBack).toBe(1)
    // A, B, C, E, F are imported; D sits on the held-back heading
    expect(first.steps.products).toMatchObject({ created: 5, skipped: 1 })
    expect(first.steps.listings.created).toBe(5)
    // F has no price: listed = false and no price row
    expect(first.steps.prices).toMatchObject({ created: 4, skipped: 1 })
    expect(first.steps.beats.created).toBe(1)
    expect(first.steps.retailers.created).toBe(3)
    expect(first.steps.openingBills.created).toBe(3)
    // 450 000 + (100 000 - 40 000) + 25 050
    expect(first.openingBillPaise).toBe(535_050)
    const now = await snapshot()
    expect(now).toMatchObject({
      retailers: 3,
      codes: 3,
      invoices: 3,
      journal: 6,
      ar: 535_050,
      products: 5,
      priceItems: 4,
      beats: 1,
    })
  })

  it('wrote the HSN rows the app resolves from: the older heading gained a newer row, the newer one was left alone', async () => {
    const rows = await withTenant(db, { ...ownerCtx(), actorRole: 'curator' }, (tx) =>
      tx
        .select()
        .from(hsnRates)
        .where(like(hsnRates.hsnCode, `${stem}%`)),
    )
    const of = (code: string) =>
      rows.filter((r) => r.hsnCode === code).map((r) => [r.gstBps, r.effectiveFrom])
    expect(of(HSN.plain)).toEqual([[500, '2025-09-22']])
    expect(of(HSN.older).sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
      [1200, '2017-07-01'],
      [500, '2025-09-22'],
    ])
    expect(of(HSN.newer)).toEqual([[4000, '2026-01-01']])
    expect(of(HSN.fallback)).toEqual([[500, '2025-09-22']])
    expect(new Set(rows.map((r) => `${r.hsnCode}|${r.effectiveFrom}`)).size).toBe(rows.length)
  })

  it('a second run finds everything and changes nothing', async () => {
    const before = await snapshot()
    const second = await write(planOf())
    expect(second.failures).toEqual([])
    expect(total(second, 'created')).toBe(0)
    expect(total(second, 'failed')).toBe(0)
    expect(second.steps.retailers.unchanged).toBe(3)
    expect(second.steps.openingBills.unchanged).toBe(3)
    expect(second.steps.hsnRates).toMatchObject({ unchanged: 3, skipped: 1, created: 0 })
    expect(await snapshot()).toEqual(before)
  })

  it('never overwrites what the distributor changed since the first load', async () => {
    await withTenant(db, ownerCtx(), async (tx) => {
      await tx
        .update(priceListItems)
        .set({ ratePaise: 999 })
        .where(sql`true`)
      await tx
        .update(retailers)
        .set({ phone: '+919999999999' })
        .where(eq(retailers.tenantId, tenant.tenantId))
    })
    await write(planOf())
    const seen = await withTenant(db, ownerCtx(), async (tx) => ({
      prices: await tx.select({ r: priceListItems.ratePaise }).from(priceListItems),
      phones: await tx.select({ p: retailers.phone }).from(retailers),
    }))
    expect(new Set(seen.prices.map((p) => p.r))).toEqual(new Set([999]))
    expect(new Set(seen.phones.map((p) => p.p))).toEqual(new Set(['+919999999999']))
  })

  it('creates the global manufacturer once, however many runs and items', async () => {
    const names = await withTenant(db, { ...ownerCtx(), actorRole: 'curator' }, (tx) =>
      tx
        .select({ name: manufacturers.name })
        .from(manufacturers)
        .where(like(manufacturers.name, `SYNTH MAKER ${run}`)),
    )
    expect(names).toHaveLength(1)
  })
})
