import { sql, type SQL } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { businessDate, financialYear, uuidv7 } from '@dos/domain'
import {
  brands,
  createDb,
  createPool,
  invoiceLines,
  invoices,
  manufacturers,
  products,
  productVariants,
  retailers,
  schemeAmountFaults,
  schemes,
  tenants,
  withTenant,
  type AppliedRule,
  type Db,
  type TenantContext,
} from '@dos/db'
import { tenantStorage } from '../../platform/index.js'
import { recountSchemeSpendDays } from '../reporting/index.js'
import { RegistersService } from './index.js'

/**
 * THE "ONCE PER ORDER LINE" READER AT SCALE (prices lane, blind check 2: speed). The reader behind the brand claim,
 * the scheme-spend register, the owner's daily rollup and the release check counts a scheme once per ORDER line over
 * the batch lines of a bill — on a bill written since 2026-09-29 (each batch line carries its share, `batchShare`) and
 * on one written before (each batch line carries a whole copy of the order line's rule). The first version ran a
 * subquery over the whole window pipeline for every bill line: 692 lines 1.1 s, 3 936 lines 75 s, where the plain read
 * took 25 ms. This spec writes 4 000 bill lines of both shapes, split over one to four batches, into a distributor of
 * its own, and asks each reader for them: every figure as expected; the brand claim's source back inside one second,
 * and its plan running the window pipeline and its bound ONCE, however many lines it reads.
 */

const url = process.env.DATABASE_URL
const describeDb = url ? describe : describe.skip

/** The brand claim's source over 4 000 bill lines must come back inside this, on a database never analysed too. */
const ONE_SECOND = 1_000

interface PlanNode {
  'Node Type': string
  'Actual Loops': number
  Plans?: PlanNode[]
}

/**
 * `total` shared over `weights` by largest remainder in whole numbers — the remainders to the largest fractions, ties
 * to the earlier entry; weights that are all zero put everything on the first. The reader's own rule, written out
 * again here in integers so the expectation cannot inherit a floating-point tie.
 */
function spread(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  const w = sum > 0 ? weights : weights.map((_, i) => (i === 0 ? 1 : 0))
  const whole = sum > 0 ? sum : 1
  const abs = Math.abs(total)
  const floors = w.map((x) => Math.floor((abs * x) / whole))
  const rems = w.map((x) => (abs * x) % whole)
  let left = abs - floors.reduce((s, f) => s + f, 0)
  const order = rems.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i] = (floors[i] ?? 0) + 1
    left -= 1
  }
  return floors.map((f) => (total < 0 ? -f : f))
}

interface Expected {
  invoiceId: string
  invoiceNo: string
  day: string
  lineId: string
  lineNo: number
  qtyPcs: number
  given: AppliedRule[]
}

describeDb('the once-per-order-line reader over 4 000 bill lines (DATABASE_URL)', () => {
  const pool = createPool(url ?? '')
  const db = createDb(pool)
  const run = String(Date.now()).slice(-8)
  const tenantId = uuidv7()
  const ctx: TenantContext = { tenantId, actorId: 'system', actorRole: 'system' }
  const inTenant = <T>(fn: (tx: Db) => Promise<T>) =>
    tenantStorage.run(ctx, () => withTenant(db, ctx, fn))
  const registers = new RegistersService(db)

  const brandId = uuidv7()
  const moneyScheme = uuidv7() // 10 % off, company-funded
  const freeScheme = uuidv7() // one free per twelve of the item itself, company-funded
  const variants = [uuidv7(), uuidv7(), uuidv7(), uuidv7()]
  const RATE = 1_250
  const today = businessDate().date
  const days = [5, 4, 3, 2, 1].map((k) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10),
  )
  const BILLS = 400

  const expected: Expected[] = []
  /** Per bill: the money the schemes gave (once), and whether it was written before the ruling. */
  const bills: { id: string; no: string; day: string; old: boolean; discount: number }[] = []
  let givenMoney = 0
  let givenFree = 0
  const moneyByDay = new Map<string, number>()

  beforeAll(async () => {
    await db.insert(tenants).values({
      id: tenantId,
      slug: `speed-${run}`,
      legalName: 'Reader Speed Traders',
      stateCode: '27',
    })
    const retailerId = uuidv7()
    await db.insert(retailers).values({
      id: retailerId,
      tenantId,
      code: `SPD-${run}`,
      name: `Speed Shop ${run}`,
      phone: `+91977${run}01`,
      stateCode: '27',
      gstRegType: 'unregistered',
      creditDays: 7,
    })
    const manufacturerId = uuidv7()
    await db.insert(manufacturers).values({ id: manufacturerId, name: `Maker speed ${run}` })
    await db.insert(brands).values({ id: brandId, manufacturerId, name: `Speed brand ${run}` })
    const productId = uuidv7()
    await db
      .insert(products)
      .values({ id: productId, manufacturerId, brandId, name: 'Biscuit', category: 'bakery' })
    await db.insert(productVariants).values(
      variants.map((id, i) => ({
        id,
        productId,
        name: `Biscuit ${String(i + 1)}`,
        netQty: 1,
        netUnit: 'pcs' as const,
        defaultCaseSize: 12,
        hsnCode: '19059020',
      })),
    )
    const scheme = (id: string, name: string, rewardKind: string, rewardValue: number) => ({
      id,
      tenantId,
      name: `${name} ${run}`,
      brandId,
      scope: { variantIds: variants },
      triggerKind: 'qty' as const,
      triggerMin: 1,
      triggerUnit: 'pcs' as const,
      rewardKind: rewardKind as 'line_pct',
      rewardValue,
      applicability: {},
      validFrom: '2020-01-01',
      validTo: '2099-12-31',
      stackable: true,
      final: false,
      fundingSource: 'company' as const,
      claimable: true,
      claimChannel: 'dos' as const,
      active: true,
    })
    await db
      .insert(schemes)
      .values([
        scheme(moneyScheme, 'Speed 10 %', 'line_pct', 1_000),
        scheme(freeScheme, 'Speed 12 + 1', 'free_qty', 1),
      ])

    // 400 bills × 4 order lines, each order line packed from one to four batches: 4 000 bill lines. Even bills are
    // written the way the pack writes them since the ruling (shares), odd ones the way it wrote them before (copies).
    const headRows: (typeof invoices.$inferInsert)[] = []
    const lineRows: (typeof invoiceLines.$inferInsert)[] = []
    for (let b = 0; b < BILLS; b += 1) {
      const old = b % 2 === 1
      const invoiceId = uuidv7()
      const invoiceNo = `SPD/${String(b + 1).padStart(4, '0')}`
      const day = days[b % days.length] ?? today
      let lineNo = 0
      let billDiscount = 0
      for (let j = 0; j < 4; j += 1) {
        const orderLineId = uuidv7()
        const variantId = variants[j] ?? ''
        const batches = 1 + ((b + j) % 4)
        const qtys = Array.from({ length: batches }, (_, i) => 3 + ((b * 7 + j * 3 + i) % 9))
        const pieces = qtys.reduce((s, q) => s + q, 0)
        // lines 0 and 1: 10 % off; line 2: 10 % off AND one free per twelve; line 3: no scheme at all
        const money = j < 3 ? Math.round((pieces * RATE) / 10) : 0
        const free = j === 2 ? Math.max(1, Math.floor(pieces / 12)) : 0
        const moneyShares = spread(money, qtys)
        // the free pieces a batch line carries: since the ruling in proportion to its pieces, before it all on the last
        const freeOnLine = old
          ? qtys.map((_, i) => (i === batches - 1 ? free : 0))
          : spread(free, qtys)
        const moneyRule: AppliedRule = {
          ruleId: moneyScheme,
          version: 1,
          kind: 'scheme',
          rewardKind: 'line_pct',
          amountPaise: money,
        }
        const freeRule: AppliedRule = {
          ruleId: freeScheme,
          version: 1,
          kind: 'scheme',
          rewardKind: 'free_qty',
          freeQty: free,
          freeVariantId: variantId,
        }
        // what a reader must give back on each batch line: the share (written, or spread back from the copy)
        const givenMoneyShares = moneyShares
        const givenFreeShares = spread(free, freeOnLine)
        qtys.forEach((qty, i) => {
          lineNo += 1
          const lineId = uuidv7()
          const discount = givenMoneyShares[i] ?? 0
          billDiscount += discount
          const written: AppliedRule[] = []
          const given: AppliedRule[] = []
          if (j < 3) {
            written.push(
              old ? moneyRule : { ...moneyRule, amountPaise: discount, batchShare: true },
            )
            given.push({ ...moneyRule, amountPaise: discount })
          }
          if (j === 2) {
            written.push(
              old ? freeRule : { ...freeRule, freeQty: freeOnLine[i] ?? 0, batchShare: true },
            )
            given.push({ ...freeRule, freeQty: givenFreeShares[i] ?? 0 })
          }
          lineRows.push({
            id: lineId,
            tenantId,
            invoiceId,
            lineNo,
            orderLineId,
            variantId,
            description: `Biscuit ${String(j + 1)}`,
            hsnCode: '19059020',
            qtyPcs: qty,
            freeQtyPcs: freeOnLine[i] ?? 0,
            ratePaise: RATE,
            discountPaise: discount,
            taxablePaise: qty * RATE - discount,
            gstBps: 500,
            lineTotalPaise: qty * RATE - discount,
            appliedRules: written,
          })
          expected.push({ invoiceId, invoiceNo, day, lineId, lineNo, qtyPcs: qty, given })
        })
        givenMoney += money
        givenFree += free
        moneyByDay.set(day, (moneyByDay.get(day) ?? 0) + money)
      }
      headRows.push({
        id: invoiceId,
        tenantId,
        invoiceNo,
        seriesCode: 'SPD',
        fy: financialYear(new Date(`${day}T06:00:00Z`)),
        invoiceDate: day,
        retailerId,
        source: 'pack',
        state: 'issued',
        buyerName: `Speed Shop ${run}`,
        placeOfSupplyState: '27',
        discountPaise: billDiscount,
      })
      bills.push({ id: invoiceId, no: invoiceNo, day, old, discount: billDiscount })
    }
    await db.insert(invoices).values(headRows)
    for (let i = 0; i < lineRows.length; i += 500)
      await db.insert(invoiceLines).values(lineRows.slice(i, i + 500))
    // the reader orders by (date, bill id, line) — so does the expectation
    const billOrder = new Map(
      [...bills]
        .sort((a, b) =>
          a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        )
        .map((bill, i) => [bill.id, i]),
    )
    expected.sort(
      (a, b) =>
        (billOrder.get(a.invoiceId) ?? 0) - (billOrder.get(b.invoiceId) ?? 0) ||
        a.lineNo - b.lineNo,
    )
  }, 120_000)

  afterAll(async () => {
    await pool.end()
  })

  /**
   * The read, timed the way a person waits for it: back inside one second. On this 8 GB machine with other lanes
   * running (swapping, load above 10) any single call can stall for seconds, so the read is timed up to five times,
   * half a second apart, and the first that comes back inside the second passes. The reader before this repair never
   * came close: 4 000 lines took 75 s, a thousand 7 s.
   */
  async function insideOneSecond<T>(what: string, read: () => Promise<T>): Promise<T> {
    const tries: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now()
      const value = await read()
      const ms = performance.now() - t0
      tries.push(Math.round(ms))
      if (ms < ONE_SECOND) return value
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`${what}: no read came back inside one second (${tries.join(', ')} ms)`)
  }

  /**
   * The work the reader's statement does, whatever the load: its own statement (caught on its way to the database) run
   * as EXPLAIN (ANALYZE, TIMING OFF), every plan node with how many times it ran.
   */
  async function planOf(
    filter: Parameters<RegistersService['invoiceLinesForPeriod']>[1],
  ): Promise<{ node: string; loops: number }[]> {
    return inTenant(async (tx) => {
      let statement: SQL | undefined
      const spy = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop === 'execute')
            return (query: SQL) => {
              statement = query
              return target.execute(query)
            }
          const value: unknown = Reflect.get(target, prop, receiver)
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(target)
            : value
        },
      })
      await registers.invoiceLinesForPeriod(spy, filter)
      if (!statement) throw new Error('the reader sent no statement')
      const res = await tx.execute(sql`EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) ${statement}`)
      const [row] = res.rows as { 'QUERY PLAN': { Plan: PlanNode }[] }[]
      const out: { node: string; loops: number }[] = []
      const walk = (n: PlanNode): void => {
        out.push({ node: n['Node Type'], loops: n['Actual Loops'] })
        for (const child of n.Plans ?? []) walk(child)
      }
      const top = row?.['QUERY PLAN'][0]?.Plan
      if (top) walk(top)
      return out
    })
  }
  /** The window pipeline (every WindowAgg) and the bound (every Limit) each ran once — never once per line. */
  const onceEach = (plan: { node: string; loops: number }[]) =>
    plan.filter((n) => n.node === 'WindowAgg' || n.node === 'Limit').map((n) => [n.node, n.loops])

  const from = () => days[0] ?? today
  const to = () => days[days.length - 1] ?? today

  it('writes 4 000 bill lines, half of the bills in each shape', () => {
    expect(expected).toHaveLength(4_000)
    expect(bills.filter((b) => b.old)).toHaveLength(BILLS / 2)
  })

  it('the brand claim’s source reads all 4 000 lines inside one second, each with its share of the rule, the rule once per order line', async () => {
    const filter = { from: from(), to: to(), brandId }
    const read = await insideOneSecond('invoiceLinesForPeriod over 4 000 lines', () =>
      inTenant((tx) => registers.invoiceLinesForPeriod(tx, filter)),
    )
    expect(read).toHaveLength(4_000)
    expect(read.map((l) => l.lineId)).toEqual(expected.map((e) => e.lineId))
    expect(read.map((l) => [l.qtyPcs, l.appliedRules])).toEqual(
      expected.map((e) => [e.qtyPcs, e.given]),
    )
    const sum = (ruleId: string, key: 'amountPaise' | 'freeQty') =>
      read
        .flatMap((l) => l.appliedRules)
        .filter((r) => r.ruleId === ruleId)
        .reduce((s, r) => s + (r[key] ?? 0), 0)
    expect(sum(moneyScheme, 'amountPaise')).toBe(givenMoney)
    expect(sum(freeScheme, 'freeQty')).toBe(givenFree)
    // one pass: the pipeline ran once for the 4 000 lines (the reader before ran it once per line)
    const plan = onceEach(await planOf(filter))
    expect(plan.filter(([node]) => node === 'WindowAgg').length).toBeGreaterThan(0)
    expect(plan).toEqual(plan.map(([node]) => [node, 1]))
  })

  it('a bound on the lines is cut at the edge of the bill its last line belongs to, inside one second', async () => {
    const bound = 1_001
    const filter = { from: from(), to: to(), brandId, limit: bound }
    const read = await insideOneSecond('invoiceLinesForPeriod bounded at 1 001 lines', () =>
      inTenant((tx) => registers.invoiceLinesForPeriod(tx, filter)),
    )
    // the bills the first 1 001 lines touch, every one of them to its end
    const touched = new Set(expected.slice(0, bound).map((e) => e.invoiceId))
    const wanted = expected.filter((e) => touched.has(e.invoiceId))
    expect(wanted.length).toBeGreaterThan(bound)
    expect(read.map((l) => [l.lineId, l.appliedRules])).toEqual(
      wanted.map((e) => [e.lineId, e.given]),
    )
    // the bound is found once, not once per line
    const plan = onceEach(await planOf(filter))
    expect(plan.filter(([node]) => node === 'Limit').length).toBeGreaterThan(0)
    expect(plan).toEqual(plan.map(([node]) => [node, 1]))
  })

  it('the scheme-spend register counts each rule once per order line', async () => {
    const spend = await inTenant((tx) =>
      registers.schemeSpend(tx, { from: from(), to: to(), brandId }),
    )
    expect(spend.find((r) => r.ruleId === moneyScheme)).toMatchObject({
      amountPaise: givenMoney,
      documentCount: BILLS,
    })
    expect(spend.find((r) => r.ruleId === freeScheme)).toMatchObject({
      freeQtyPcs: givenFree,
      amountPaise: 0,
      documentCount: BILLS,
    })
  })

  it('the release check names every bill written before as copies read once, and none written since', async () => {
    const faults = await schemeAmountFaults(db, tenantId)
    const old = bills.filter((b) => b.old)
    expect(faults.map((f) => [f.invoiceNo, f.status, f.readPaise, f.discountPaise]).sort()).toEqual(
      old.map((b) => [b.no, 'copies', b.discount, b.discount]).sort(),
    )
  })

  it('the owner’s daily rollup recounts each day’s scheme spend once per order line', async () => {
    for (const day of days)
      await db.execute(sql`
        insert into daily_owner_stats (tenant_id, day, scheme_spend_company_paise, scheme_spend_distributor_paise)
        values (${tenantId}, ${day}, 0, 0)`)
    const recounted = await recountSchemeSpendDays(db, tenantId)
    expect([...recounted].sort()).toEqual([...days].sort())
    const rows = (
      await db.execute(sql`
        select to_char(day, 'YYYY-MM-DD') as day, scheme_spend_company_paise::bigint as company
          from daily_owner_stats where tenant_id = ${tenantId} order by day`)
    ).rows as { day: string; company: string }[]
    expect(rows.map((r) => [r.day, Number(r.company)])).toEqual(
      days.map((d) => [d, moneyByDay.get(d) ?? 0]),
    )
  })
})
