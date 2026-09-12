/**
 * Staff targets, their achievement and the computed payouts (docs/plans/incentives.md §6).
 *
 * Every number here is COMPUTED FROM THE ROWS THE EARLIER SEEDS WROTE, not invented: the achievement
 * of a target is the same aggregate the worker's sweep runs, read back out of `sales_orders` /
 * `sales_order_lines` / `visits` / `receipts` by SQL, and a statement's payout comes from
 * `evaluatePayout()` — the one slab evaluator the API and the worker also use. So the demo shows a
 * consistent story: the leaderboard, the rep's progress bar and the owner's payout register all
 * agree, and pressing "compute" in Swagger reproduces the seeded number instead of contradicting it.
 *
 * WHAT THE DEMO CONTAINS, per distributor:
 *   - FIVE open targets for the current month, deliberately mid-period (the achievement is a few
 *     days of a full month), which is the "in progress" state a Performance tab actually renders;
 *     among them a rep holding TWO simultaneous targets on different metrics, a brand-scoped one,
 *     a count metric on flat slabs, and a `collections` target on a delivery crew member.
 *   - a SIXTH open target only where `feature_flags.van_sales` is on: the delivery-role value path.
 *   - TWO closed periods (last month): one computed AND approved — the statement history a rep's
 *     Performance tab shows — and one computed but NOT approved, so the owner's review queue is
 *     never empty in the demo.
 *
 * Idempotent: every id is `demoId(...)` and every insert is `onConflictDoNothing()`, so `pnpm db:seed`
 * twice adds nothing. `achievements` is the one exception in spirit — it is a derived cache the
 * worker rewrites by upsert — but the seed still only inserts, because re-running the seed must not
 * silently roll a rep's live figure back to the seed's own snapshot of it.
 *
 * The database guards from migration 0030 are honoured by construction: every `user_id`,
 * `created_by` and `approved_by` below is a member of THIS tenant, and every `achievements` row
 * carries the same `tenant_id` as its target.
 */
import { sql } from 'drizzle-orm'
import { evaluatePayout, type PayoutSlabLike } from '@dos/domain'
import { insertMany } from './db-helpers.js'
import { achievements, computedPayouts, featureFlags, targets } from '../schema/index.js'
import type { Db } from '../client.js'
import { brandId } from './catalog.js'
import { demoId } from './ids.js'
import type { PeopleResult } from './people.js'
import { atIstTime, isoDate, TODAY } from './util.js'

/** Basis points of achievement against basis points of the target's paise — a money metric only. */
const VALUE_SLABS: PayoutSlabLike[] = [
  { fromPct: 8_000, toPct: 10_000, payoutBps: 50 },
  { fromPct: 10_000, toPct: 12_000, payoutBps: 100 },
  { fromPct: 12_000, toPct: null, payoutBps: 150 },
]

/** A count metric cannot pay a share of a count, so its slabs are flat rupees (brief §4.5). */
const flat = (a: number, b: number, c: number): PayoutSlabLike[] => [
  { fromPct: 7_000, toPct: 9_000, flatPaise: a },
  { fromPct: 9_000, toPct: 10_000, flatPaise: b },
  { fromPct: 10_000, toPct: null, flatPaise: c },
]

type Metric = 'value' | 'pieces' | 'lines' | 'outlets' | 'visits' | 'collections'

interface TargetSeed {
  key: string
  userId: string
  brandId: string | null
  metric: Metric
  periodFrom: string
  periodTo: string
  targetValue: number
  name: string
  payoutRule: PayoutSlabLike[]
}

/** First and last day of the calendar month `date` falls in, as IST business dates. */
function monthWindow(date: Date): { from: string; to: string } {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  return {
    from: isoDate(new Date(Date.UTC(y, m, 1))),
    to: isoDate(new Date(Date.UTC(y, m + 1, 0))),
  }
}

export async function seedIncentives(
  db: Db,
  tenantId: string,
  people: PeopleResult,
): Promise<void> {
  const thisMonth = monthWindow(TODAY)
  const lastMonth = monthWindow(new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth(), 0)))
  const owner = people.owner.id
  const { rahul, amit, pooja } = people.salespeople
  const ganesh = people.delivery.ganesh

  const [vanSales] = await db
    .select({ enabled: featureFlags.enabled })
    .from(featureFlags)
    .where(sql`${featureFlags.tenantId} = ${tenantId} and ${featureFlags.flag} = 'van_sales'`)

  const seeds: TargetSeed[] = [
    {
      key: 'this-value-rahul',
      userId: rahul.id,
      brandId: null,
      metric: 'value',
      periodFrom: thisMonth.from,
      periodTo: thisMonth.to,
      // Calibrated against the orders the sales seed actually booked, so the demo opens on a
      // believable MID-MONTH figure (~16% of a full month, a few days in) rather than 0 or 200%.
      targetValue: 150_000_000, // ₹15,00,000
      name: 'This Month — Value (All Brands)',
      payoutRule: VALUE_SLABS,
    },
    {
      key: 'this-value-amit-campa',
      userId: amit.id,
      brandId: brandId('campa'),
      metric: 'value',
      periodFrom: thisMonth.from,
      periodTo: thisMonth.to,
      targetValue: 45_000_000, // ₹4,50,000 of Campa
      name: 'This Month — Campa Value',
      payoutRule: VALUE_SLABS,
    },
    {
      key: 'this-lines-pooja',
      userId: pooja.id,
      brandId: null,
      metric: 'lines',
      periodFrom: thisMonth.from,
      periodTo: thisMonth.to,
      targetValue: 80,
      name: 'This Month — Order Lines',
      payoutRule: flat(100_000, 200_000, 350_000),
    },
    {
      // Rahul's SECOND simultaneous target, on a different metric: allowed, and the one case a
      // `progress.mine` screen has to render as two cards rather than one number.
      key: 'this-visits-rahul',
      userId: rahul.id,
      brandId: null,
      metric: 'visits',
      periodFrom: thisMonth.from,
      periodTo: thisMonth.to,
      // the calls a rep logs on his beats in a month, at the pace the order book sets (about
      // two and a half a working day on his half of the beats; the strike rate is I-51's)
      targetValue: 60,
      name: 'This Month — Beat Visits',
      payoutRule: flat(50_000, 120_000, 250_000),
    },
    {
      // The crew collects the money (docs/17 §D4), so a collections target belongs to a delivery
      // member and never to a rep.
      key: 'this-collections-ganesh',
      userId: ganesh.id,
      brandId: null,
      metric: 'collections',
      periodFrom: thisMonth.from,
      periodTo: thisMonth.to,
      targetValue: 75_000_000, // ₹7,50,000 banked
      name: 'This Month — Collections',
      payoutRule: flat(100_000, 250_000, 400_000),
    },
    // The CLOSED period. One statement per field role, so every app has a real history to open:
    // the rep's is signed off, the other two are still on the owner's desk (brief §6.4, §6.5).
    {
      key: 'last-value-rahul',
      userId: rahul.id,
      brandId: null,
      metric: 'value',
      periodFrom: lastMonth.from,
      periodTo: lastMonth.to,
      targetValue: 40_000_000, // ₹4,00,000 — he finished at 97%, so the 80% slab pays
      name: `${monthLabel(lastMonth.from)} — Value (All Brands)`,
      payoutRule: VALUE_SLABS,
    },
    {
      key: 'last-lines-amit',
      userId: amit.id,
      brandId: null,
      metric: 'lines',
      periodFrom: lastMonth.from,
      periodTo: lastMonth.to,
      targetValue: 120,
      name: `${monthLabel(lastMonth.from)} — Order Lines`,
      payoutRule: flat(100_000, 200_000, 350_000),
    },
    {
      key: 'last-collections-ganesh',
      userId: ganesh.id,
      brandId: null,
      metric: 'collections',
      periodFrom: lastMonth.from,
      periodTo: lastMonth.to,
      targetValue: 5_000_000, // ₹50,000 banked off the van
      name: `${monthLabel(lastMonth.from)} — Collections`,
      payoutRule: flat(100_000, 250_000, 400_000),
    },
  ]

  if (vanSales?.enabled) {
    // Only where the distributor sells off the van (ADR 0013): the delivery-role VALUE path, credited
    // through the van-sale order's creator because a crew member's order names no salesperson.
    seeds.push({
      key: 'this-value-ganesh-van',
      userId: ganesh.id,
      brandId: null,
      metric: 'value',
      periodFrom: thisMonth.from,
      periodTo: thisMonth.to,
      targetValue: 90_000_000, // ₹9,00,000 off the van
      name: 'This Month — Van Sales Value',
      payoutRule: VALUE_SLABS,
    })
  }

  await insertMany(
    db,
    targets,
    seeds.map((s) => ({
      id: demoId('target', s.key),
      tenantId,
      userId: s.userId,
      brandId: s.brandId,
      metric: s.metric,
      periodFrom: s.periodFrom,
      periodTo: s.periodTo,
      targetValue: s.targetValue,
      payoutRule: s.payoutRule,
      name: s.name,
      createdBy: owner,
    })),
  )

  // --- achievements: the real numbers, from the rows the earlier seeds wrote. ---
  const figures = new Map<
    string,
    { achievedValue: number; achievedPieces: number; achievedPct: number }
  >()
  for (const s of seeds) {
    const measured = await measure(db, tenantId, s)
    figures.set(s.key, measured)
  }
  await insertMany(
    db,
    achievements,
    seeds.map((s) => {
      const f = figures.get(s.key)
      return {
        id: demoId('achievement', s.key),
        tenantId,
        targetId: demoId('target', s.key),
        achievedValue: f?.achievedValue ?? 0,
        achievedPieces: f?.achievedPieces ?? 0,
        achievedPct: f?.achievedPct ?? 0,
        computedAt: atIstTime(TODAY, 6, 23),
      }
    }),
  )

  // --- statements: one approved, one waiting for the owner. ---
  const closed = [
    { key: 'last-value-rahul', userId: rahul.id, approved: true },
    { key: 'last-lines-amit', userId: amit.id, approved: false },
    { key: 'last-collections-ganesh', userId: ganesh.id, approved: false },
  ]
  const statementRows: (typeof computedPayouts.$inferInsert)[] = []
  for (const c of closed) {
    const seed = seeds.find((s) => s.key === c.key)
    const f = figures.get(c.key)
    if (!seed || !f) continue
    const evaluation = evaluatePayout({
      targetValue: seed.targetValue,
      achievedValue: f.achievedValue,
      payoutRule: seed.payoutRule,
    })
    statementRows.push({
      id: demoId('computed-payout', c.key),
      tenantId,
      userId: c.userId,
      periodFrom: seed.periodFrom,
      periodTo: seed.periodTo,
      amountPaise: evaluation.payoutPaise,
      breakdown: [
        {
          targetId: demoId('target', seed.key),
          metric: seed.metric,
          brandId: seed.brandId,
          name: seed.name,
          targetValue: seed.targetValue,
          achievedValue: f.achievedValue,
          achievedPct: f.achievedPct,
          payoutPaise: evaluation.payoutPaise,
        },
      ],
      approvedBy: c.approved ? owner : null,
      approvedAt: c.approved ? atIstTime(TODAY, 11, 5) : null,
      computedAt: atIstTime(TODAY, 10, 40),
    })
  }
  await insertMany(db, computedPayouts, statementRows)
}

/** "August" from `2026-08-01`, so a target reads as a month rather than a date range. */
function monthLabel(isoFrom: string): string {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return months[Number(isoFrom.slice(5, 7)) - 1] ?? isoFrom.slice(0, 7)
}

/** IST midnight of a business date as an instant, `plusDays` later — the worker's own window. */
function istInstant(isoDateStr: string, plusDays = 0): Date {
  return new Date(Date.parse(`${isoDateStr}T00:00:00.000+05:30`) + plusDays * 86_400_000)
}

/**
 * The same aggregate `computeAchievement()` runs, in SQL. The seed lives in `@dos/db` and cannot
 * import `@dos/core` (the dependency goes the other way), so this is a deliberate second copy —
 * kept honest by the spec, which asserts the API's own figures against hand-computed sums, and by
 * the fact that a `pnpm smoke` run of `targets.refresh` overwrites these rows with the real thing.
 */
async function measure(
  db: Db,
  tenantId: string,
  seed: TargetSeed,
): Promise<{ achievedValue: number; achievedPieces: number; achievedPct: number }> {
  const from = istInstant(seed.periodFrom)
  const to = istInstant(seed.periodTo, 1)
  const brandJoin = seed.brandId
    ? sql`join product_variants v on v.id = l.variant_id
          join products p on p.id = v.product_id and p.brand_id = ${seed.brandId}`
    : sql``
  const sales = await db.execute(sql`
    select coalesce(sum(l.line_total_paise), 0)::bigint as value_paise,
           coalesce(sum(l.qty_pcs), 0)::bigint          as pieces,
           count(l.id)::int                             as lines,
           count(distinct o.retailer_id)::int           as outlets
      from sales_order_lines l
      join sales_orders o on o.id = l.order_id and o.tenant_id = l.tenant_id
      ${brandJoin}
     where l.tenant_id = ${tenantId}
       and o.state in ('confirmed','picking','packed','dispatched','delivered','partially_delivered')
       and (o.salesperson_id = ${seed.userId}
            or (o.salesperson_id is null and o.created_by = ${seed.userId}))
       and coalesce(o.confirmed_at, o.created_at) >= ${from}
       and coalesce(o.confirmed_at, o.created_at) < ${to}`)
  const s: Record<string, unknown> = sales.rows[0] ?? {}
  const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
  const pieces = n(s.pieces)

  let achievedValue: number
  if (seed.metric === 'visits') {
    const rows = await db.execute(sql`
      select count(*)::int as visits from visits v
       where v.tenant_id = ${tenantId} and v.user_id = ${seed.userId}
         and v.ended_at is not null
         and v.started_at >= ${from} and v.started_at < ${to}`)
    achievedValue = n(rows.rows[0]?.visits)
  } else if (seed.metric === 'collections') {
    const rows = await db.execute(sql`
      select coalesce(sum(r.amount_paise), 0)::bigint as amount_paise from receipts r
       where r.tenant_id = ${tenantId} and r.received_by = ${seed.userId}
         and r.status in ('collected','deposited')
         and r.received_at >= ${from} and r.received_at < ${to}`)
    achievedValue = n(rows.rows[0]?.amount_paise)
  } else if (seed.metric === 'pieces') {
    achievedValue = pieces
  } else if (seed.metric === 'lines') {
    achievedValue = n(s.lines)
  } else if (seed.metric === 'outlets') {
    achievedValue = n(s.outlets)
  } else {
    achievedValue = n(s.value_paise)
  }
  return {
    achievedValue,
    achievedPieces: pieces,
    achievedPct: achievedValue <= 0 ? 0 : Math.round((achievedValue * 10_000) / seed.targetValue),
  }
}
