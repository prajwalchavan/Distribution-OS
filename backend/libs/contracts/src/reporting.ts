import { oc } from '@orpc/contract'
import { z } from 'zod'
import { GstSummaryInput, GstSummaryOutput } from './billing.js'
import {
  BpsSchema,
  IdSchema,
  MutationBase,
  PaiseSchema,
  PiecesSchema,
  QueryIntSchema,
} from './common.js'
import { ExportJobStatusSchema } from './integrations.js'
import { SchemeFundingSourceSchema, SchemeRewardKindSchema } from './pricing.js'
import { AgeingBucketSchema, AgeingBucketsSchema, ReceiptModeSchema } from './receivables.js'

/**
 * Reporting — the read-model layer behind every dashboard tile, every GRAPH in the owner app and every
 * register screen (docs/plans/reporting.md, coordination §1 slot 9). It owns the rollup tables in
 * `database/src/schema/reporting.ts` — `daily_tenant_stats`, `daily_rep_stats`, `daily_retailer_stats`,
 * `daily_owner_stats`, `retailer_behaviour`, `owner_summary` — refreshed by the worker by upsert, and
 * nothing else. Every register beyond those is a live, BOUNDED, grouped read of another module's tables
 * reached only through that module's exported service (coordination §4): billing's `RegistersService`
 * for the GST sales register and scheme spend, receivables' `collectionsRegister` / ageing history /
 * `outstandingList`, orders' `fillRateLines`, inventory's `valuationByLocation`, procurement's
 * `purchaseRegister`, retailers' `beatAssignmentsFor`, delivery's `performanceRows`, integrations'
 * `ExportJobsService`. Reporting never recomputes GST or ageing, never writes a business record, never
 * computes an incentive payout, and is called by nobody.
 *
 * WHICH SERVICES MOUNT `reporting` (docs/plans/00-coordination.md §6 table; `auth-service` mounts nothing):
 *
 *   owner :3001      YES — the whole surface (O1, O2, O6, O10, O13, O15, O17, O18, O22): every tile,
 *                    every series, every register, the exports; the ONLY service where `series.grossMargin`
 *                    (OWNER_ONLY) answers
 *   manager :3002    YES — manager + accountant (M1, M12, M21): the manager reads everything but the
 *                    margin series; the accountant "reads and exports everything" (docs/22 2026-09-05) —
 *                    the registers, the money series, the exports — and never the margin
 *   sales :3003      YES — ITS OWN NUMBERS ONLY (S1, S2, S9, S10): `dashboard.rep`, `dailyStats.rep`,
 *                    `registers.repProductivity`, `series.productivity` with `userId` FORCED to the
 *                    caller whatever was sent; `retailers.behaviour / lapsed / series` scoped by the
 *                    handler to the shops on the rep's own current beats. Every other procedure refuses
 *                    the role in PERMISSIONS: no tenant series, no register, no export, no cost
 *   warehouse :3004  YES — `registers.fillRate` and `series.fillRate` only (W1 packs-per-day sparkline;
 *                    picking accuracy is the godown's job, docs/23 §4.2). Everything else refuses the role
 *   delivery :3005   YES — `registers.deliveryPerformance` and `series.deliveryPerformance` with
 *                    `driverId` FORCED to the caller (D11 "my trips": stops, on-time, POD coverage of the
 *                    trips it drove or helped on). Everything else refuses the role
 *   retailer :3006   NO — not mounted at all (docs/plans/reporting.md §1: a shop never opens a report;
 *                    docs/23 §6.2). Every row below also refuses the role in PERMISSIONS, and the
 *                    0027 policies give a retailer-role session zero rows of every rollup table
 *
 * FOUNDER ANSWERS (docs/17 §D, docs/22 §8) THAT SHAPE THIS FILE:
 *
 *  1. GRAPHS (docs/22 §8 2026-09-04: "the owner app must have graphs wherever possible: growth, how the
 *     distributorship is performing"; 2026-09-05: docs/23 §1.2 is binding and "owner graphs need
 *     `reporting.series`"). The `series.*` family below is the chart-ready surface: every member answers
 *     arrays of `{ bucket, value, previous }` where `bucket` is the first IST business date of the day /
 *     Monday-anchored week / calendar month and `value` is integer paise, an integer count or a ratio,
 *     with the grain and the range on every response. `series.get` is the generic, dimension-agnostic
 *     read docs/23 §1.2 specifies; the named members fix the metric, carry the filters and the ROLE that
 *     one chart needs (a rep's own productivity, the crew's own trips, the godown's fill rate, the owner's
 *     margin) and are what the screens call. All of them are grouped reads of ≤ 92 day rows of the
 *     rollup tables — never a live scan of invoices or receipts (docs/20 rule 9).
 *  2. THE SALESPERSON NEVER COLLECTS (§D4): `daily_rep_stats.collected_paise` is always 0 for a rep and
 *     is carried only so a delivery user's doorstep collections have a home; no series here shows a rep
 *     any money but its own order value.
 *  3. COST AND MARGIN ARE A BACK-OFFICE FIGURE, never a filter (docs/22 §9 never-list 1): `stockValue`,
 *     `series.stock` (value, near-expiry value, turns) and `dashboard.owner` (MTD margin, stock at cost)
 *     are BACK_OFFICE; `series.grossMargin` is OWNER_ONLY (docs/23 §1.2, O17 "profit view, owner-only
 *     route"). The cost-bearing rollup (`daily_owner_stats`, `owner_summary`) is BACK_OFFICE_ROLES in RLS,
 *     so the database agrees with the matrix.
 *  4. EXPORTS ARE ASYNC, AUDITED AND THE MONEY DESK'S (docs/17 A12, coordination §3.5): `exports.request`
 *     writes ONE `export_jobs` row through integrations' `ExportJobsService` with `kind =
 *     report_<register>_<format>` (`reportExportKind()` below) and answers `queued`; the worker's single
 *     `exports.render` queue renders it through the `report_*` renderers this module registers, and
 *     `exports.get` mints a pre-signed URL once the object exists. Nothing streams inline (docs/20 rule 15).
 *     The rows are also visible in `integrations.exports.list` — one history, whoever queued the row.
 *  5. WHITE-LABEL (§D6): a rendered CSV's header block carries the DISTRIBUTOR's display name, never
 *     "Distribution OS"; nothing on this contract names the platform.
 *  6. ENGLISH ONLY (docs/22 §8 2026-09-04): names on the wire (`brandName`, `beatName`, `userName`) are the
 *     rows' own English names; nothing here is localised.
 *
 * COORDINATION FACTS THAT SHAPE THIS FILE:
 *
 *  - WRAP, DON'T DUPLICATE (coordination §4): `registers.gstSalesRegister` takes billing's own
 *    `GstSummaryInput` and answers billing's own `GstSummaryOutput` — the same function
 *    `billing.registers.gstSummary` calls, so the tax arithmetic exists once; `series.ageing` and
 *    `series.outstanding` are receivables' ageing snapshots re-shaped, never re-aged; there is NO
 *    `registers.outstanding` JSON procedure (that screen is `receivables.outstanding.list`) — only its CSV
 *    path through `exports.request(register: 'outstanding')`.
 *  - A FIELD ROLE'S OWN-SCOPE FILTER IS ALWAYS FORCED, NEVER MERELY ACCEPTED (docs/plans/reporting.md §8
 *    item 6, the `delivery.trips.list` "mine" pattern): `userId` / `salespersonId` for the salesperson,
 *    `driverId` for the delivery crew, are overridden to the caller's own id whatever the client sent.
 *    Never a 403 for a mismatched filter — one less error path for an offline client, and RLS on
 *    `daily_rep_stats` is the real guarantee.
 *  - BOUNDED WORK EVERYWHERE (docs/20 rule 3): every list `limit ≤ 200` on a `cursor`; every series window
 *    is capped in POINTS (`SERIES_POINT_CAPS`: day ≤ 92, week ≤ 53, month ≤ 24 — 400 `window_too_wide`
 *    from the schema itself, before any handler runs); every live register window is capped in DAYS
 *    (`REGISTER_WINDOW_DAYS`: 31 for the per-line joins, 92 for the grouped-column reads); groups ≤ 12
 *    (`<CompareBars>` max, the rest folded into `other`); rankings ≤ 50.
 *  - RATIOS ARE THE ONLY NON-INTEGER NUMBERS on this contract (docs/plans/reporting.md §4 rule 1):
 *    `strikeRate`, `fillRate`, `onTimeRate`, `podCoverageRate`, `stockTurns` are 0..1 (fill rate may
 *    exceed 1 when free goods are picked over the ordered pieces) and `0/0 → 0` — except fill rate, where
 *    `0/0 → 1` (nothing ordered is not a fulfilment failure). Never `NaN` / `Infinity` on the wire. At
 *    week / month grain a ratio is recomputed from the SUMMED numerator and denominator, never averaged.
 *  - `previous` on a point is the same bucket one period (`previousPeriod`: the window shifted back by
 *    its own length) or one year (`previousYear`) earlier, `null` when the rollup has no row there;
 *    `growthBps` is `(value − previous) / previous` in basis points, `null` when `previous` is 0 or null.
 *  - THE ROLLUP IS THE READ SURFACE: `dashboard.owner` reads the single `owner_summary` row (all-zero
 *    fields for a brand-new tenant, never 404); `retailers.behaviour` is 404 until the nightly rollup has
 *    produced the row, so the app shows "new shop" instead of a false "0 orders in 30 days".
 */

const IsoDateSchema = z.iso.date()
/** The device that requested an export; stored on the job so "who pulled this file" is answerable. */
const DeviceIdSchema = z.string().trim().min(1).max(128)
const CursorInput = {
  limit: QueryIntSchema.min(1).max(200).default(50),
  cursor: z.string().optional(),
}

/**
 * A ratio, 0..1 (`fillRate` may exceed 1 — see the header). The one non-integer number on this contract;
 * money is `PaiseSchema`, quantities `PiecesSchema`, percentages `BpsSchema`.
 */
export const RatioSchema = z.number().min(0)
export type Ratio = z.infer<typeof RatioSchema>

// ---------------------------------------------------------------------------------------------------------------
// enums and caps

export const SeriesGrainSchema = z.enum(['day', 'week', 'month'])
export type SeriesGrain = z.infer<typeof SeriesGrainSchema>

/** How many points a series window may hold per grain (docs/23 §1.2); wider is 400 `window_too_wide`. */
export const SERIES_POINT_CAPS: Readonly<Record<SeriesGrain, number>> = {
  day: 92,
  week: 53,
  month: 24,
}

/**
 * Window caps of the LIVE registers, in days (docs/plans/reporting.md §4 rule 11): 31 for the per-line
 * joins, 92 for the grouped-column reads. `exports.request` enforces the same cap for the register it
 * targets, at request time, before any job is queued.
 */
export const REGISTER_WINDOW_DAYS = {
  dailySales: 92,
  repDaily: 92,
  repProductivity: 31,
  schemeSpend: 92,
  fillRate: 31,
  deliveryPerformance: 31,
  collections: 31,
  gstSalesRegister: 92,
  gstPurchaseRegister: 92,
} as const

export const SeriesUnitSchema = z.enum(['paise', 'count', 'ratio'])
export type SeriesUnit = z.infer<typeof SeriesUnitSchema>

export const SeriesCompareSchema = z.enum(['none', 'previousPeriod', 'previousYear'])
export type SeriesCompare = z.infer<typeof SeriesCompareSchema>

/**
 * The metrics `series.get` serves, all from the STAFF-readable rollup (no cost, no margin) and the
 * dimension each may be grouped by — any other `metric × groupBy` pair is 400 `unsupported_group_by`:
 *
 *   invoiced                         paise   daily_tenant_stats           brand · category · beat
 *   orders                           count   daily_tenant_stats           salesperson (from daily_rep_stats)
 *   collected                        paise   daily_tenant_stats           paymentMode
 *   outstanding · overdue            paise   daily_tenant_stats (end of day)      —
 *   activeRetailers                  count   daily_tenant_stats                   —
 *   deliveredStops · partialStops ·
 *   failedStops                      count   daily_tenant_stats                   —
 *   onTimeRate · podCoverageRate     ratio   on_time / pod ÷ (delivered + partial) —
 *   fillRate                         ratio   picked_pcs ÷ ordered_pcs             —
 *   orderValue · visits ·
 *   productiveVisits · linesSold     —       daily_rep_stats summed       salesperson
 *   strikeRate                       ratio   productive ÷ visits          salesperson
 *
 * Stops per vehicle are `registers.deliveryPerformance` (per trip), not a series: the rollup carries no
 * vehicle mix. Cost-bearing metrics are their own procedures (`series.stock`, `series.grossMargin`,
 * `series.schemeSpend`) so the matrix, not a handler, decides who sees them.
 */
export const SERIES_METRICS = [
  'invoiced',
  'orders',
  'collected',
  'outstanding',
  'overdue',
  'activeRetailers',
  'deliveredStops',
  'partialStops',
  'failedStops',
  'onTimeRate',
  'podCoverageRate',
  'fillRate',
  'orderValue',
  'visits',
  'productiveVisits',
  'linesSold',
  'strikeRate',
] as const
export const SeriesMetricSchema = z.enum(SERIES_METRICS)
export type SeriesMetric = z.infer<typeof SeriesMetricSchema>

/** The cost-bearing metrics (`daily_owner_stats`), each served by its own BACK_OFFICE / OWNER_ONLY procedure. */
export const OWNER_SERIES_METRICS = [
  'grossMargin',
  'netSales',
  'cogs',
  'stockValue',
  'nearExpiryValue',
  'stockTurns',
  'schemeSpendCompany',
  'schemeSpendDistributor',
] as const
/** Every metric a series response may name. */
export const AnySeriesMetricSchema = z.enum([...SERIES_METRICS, ...OWNER_SERIES_METRICS])
export type AnySeriesMetric = z.infer<typeof AnySeriesMetricSchema>

export const SeriesGroupBySchema = z.enum([
  'brand',
  'category',
  'beat',
  'salesperson',
  'paymentMode',
])
export type SeriesGroupBy = z.infer<typeof SeriesGroupBySchema>

/** Month over month, or the same month one year earlier. */
export const GrowthBasisSchema = z.enum(['mom', 'yoy'])
export type GrowthBasis = z.infer<typeof GrowthBasisSchema>

export const GrowthMetricSchema = z.enum(['invoiced', 'collected', 'orders', 'activeRetailers'])
export type GrowthMetric = z.infer<typeof GrowthMetricSchema>
/** Top shops rank by money or orders (`daily_retailer_stats`); top beats by money or invoice count (the day's beat mix). */
export const TopShopsMetricSchema = z.enum(['invoiced', 'orders', 'collected'])
export const TopBeatsMetricSchema = z.enum(['invoiced', 'invoices'])
export const RankingMetricSchema = z.enum(['invoiced', 'orders', 'collected', 'invoices'])
export type RankingMetric = z.infer<typeof RankingMetricSchema>

/**
 * The registers a CSV / JSON export may target: the register's own GET input (minus `limit` / `cursor`)
 * is the `filters` of the request. `outstanding` is the one value with no JSON GET on this contract — it
 * calls receivables' `outstandingList`, whose JSON screen is `receivables.outstanding.list`.
 */
export const ReportRegisterSchema = z.enum([
  'dailySales',
  'repProductivity',
  'schemeSpend',
  'stockValue',
  'fillRate',
  'deliveryPerformance',
  'collections',
  'gstSalesRegister',
  'gstPurchaseRegister',
  'outstanding',
])
export type ReportRegister = z.infer<typeof ReportRegisterSchema>

export const ReportExportFormatSchema = z.enum(['csv', 'json'])
export type ReportExportFormat = z.infer<typeof ReportExportFormatSchema>

/** Every `export_jobs.kind` this module queues starts with this; the worker's renderer registry keys on the full kind. */
export const REPORT_EXPORT_KIND_PREFIX = 'report_'

/** `export_jobs.kind` for a report export: `report_<register>_<format>`, e.g. `report_gstSalesRegister_csv`. */
export function reportExportKind(register: ReportRegister, format: ReportExportFormat): string {
  return `${REPORT_EXPORT_KIND_PREFIX}${register}_${format}`
}

/** The inverse of `reportExportKind`; null for a kind another module queued (`tally_xml`, `claim_sheet`, …). */
export function parseReportExportKind(
  kind: string,
): { register: ReportRegister; format: ReportExportFormat } | null {
  if (!kind.startsWith(REPORT_EXPORT_KIND_PREFIX)) return null
  const rest = kind.slice(REPORT_EXPORT_KIND_PREFIX.length)
  const at = rest.lastIndexOf('_')
  if (at <= 0) return null
  const register = ReportRegisterSchema.safeParse(rest.slice(0, at))
  const format = ReportExportFormatSchema.safeParse(rest.slice(at + 1))
  if (!register.success || !format.success) return null
  return { register: register.data, format: format.data }
}

// ---------------------------------------------------------------------------------------------------------------
// window arithmetic (calendar dates; every date on this contract is an IST business date)

const DAY_MS = 86_400_000

function utcDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}

/** Inclusive number of calendar days from `from` to `to`; negative when `to` is before `from`. */
export function windowDays(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS) + 1
}

/** How many buckets of `grain` the inclusive window touches (weeks Monday-anchored, months calendar). */
export function windowBuckets(grain: SeriesGrain, from: string, to: string): number {
  if (grain === 'day') return windowDays(from, to)
  if (grain === 'week') {
    const monday = (iso: string) => {
      const t = utcDay(iso)
      const dow = (new Date(t).getUTCDay() + 6) % 7 // Monday = 0
      return t - dow * DAY_MS
    }
    return Math.round((monday(to) - monday(from)) / (7 * DAY_MS)) + 1
  }
  const [fy, fm] = from.split('-').map(Number) as [number, number]
  const [ty, tm] = to.split('-').map(Number) as [number, number]
  return (ty - fy) * 12 + (tm - fm) + 1
}

type Windowed = { from: string; to: string }
type Issue = { code: 'custom'; path: (string | number)[]; message: string }

function windowIssues(v: Windowed, grain: SeriesGrain | null, capDays: number | null): Issue[] {
  const days = windowDays(v.from, v.to)
  if (days < 1) return [{ code: 'custom', path: ['to'], message: 'to is before from' }]
  if (grain) {
    const cap = SERIES_POINT_CAPS[grain]
    const buckets = windowBuckets(grain, v.from, v.to)
    if (buckets > cap) {
      return [
        {
          code: 'custom',
          path: ['to'],
          message: `window_too_wide: at most ${cap} ${grain} points; this window has ${buckets}`,
        },
      ]
    }
  }
  if (capDays !== null && days > capDays) {
    return [
      {
        code: 'custom',
        path: ['to'],
        message: `window_too_wide: at most ${capDays} days; this window has ${days}`,
      },
    ]
  }
  return []
}

/** A series input: `from ≤ to` and no more than `SERIES_POINT_CAPS[grain]` points. Keeps the schema's own type. */
function seriesWindow<S extends z.ZodType<Windowed & { grain: SeriesGrain }>>(schema: S): S {
  return schema.superRefine((v, ctx) => {
    for (const issue of windowIssues(v, v.grain, null)) ctx.addIssue(issue)
  })
}

/** A register input: `from ≤ to` and no more than `capDays` days. Keeps the schema's own type. */
function registerWindow<S extends z.ZodType<Windowed>>(schema: S, capDays: number): S {
  return schema.superRefine((v, ctx) => {
    for (const issue of windowIssues(v, null, capDays)) ctx.addIssue(issue)
  })
}

// ---------------------------------------------------------------------------------------------------------------
// output shapes — series

/**
 * One point of a chart. `bucket` is the first IST business date of the day / Monday-anchored week /
 * calendar month; `value` is in the series' `unit`; `previous` is the comparison value for the same
 * bucket (see the header), null without `compare` or without a row.
 */
export const SeriesPointSchema = z.object({
  bucket: IsoDateSchema,
  value: z.number(),
  previous: z.number().nullable(),
})
export type SeriesPoint = z.infer<typeof SeriesPointSchema>

/** One group of a grouped series: a brand, a category, a beat, a rep, a payment mode, or `other` (the fold of everything past `topGroups`). */
export const SeriesGroupSchema = z.object({
  /** Brand id, `products.category`, beat id, user id, `receipt_mode` — or the literal `other`. */
  key: z.string(),
  name: z.string(),
  points: z.array(SeriesPointSchema),
})
export type SeriesGroup = z.infer<typeof SeriesGroupSchema>

/**
 * A single-metric series (docs/23 §1.2's binding shape). `points` is the ungrouped total, always;
 * `groups` is one entry per group when `groupBy` was given and `[]` otherwise. Every point of every
 * group shares the same buckets as `points`, so a stacked chart needs no alignment.
 */
export const SeriesOutput = z.object({
  metric: AnySeriesMetricSchema,
  grain: SeriesGrainSchema,
  unit: SeriesUnitSchema,
  from: IsoDateSchema,
  to: IsoDateSchema,
  compare: SeriesCompareSchema,
  groupBy: SeriesGroupBySchema.nullable(),
  /** When the rollup last wrote a row inside the window (IST timestamp); the chart's "as of". */
  asOf: z.string(),
  points: z.array(SeriesPointSchema),
  groups: z.array(SeriesGroupSchema),
})
export type Series = z.infer<typeof SeriesOutput>

/** One named line of a multi-metric chart (outstanding + overdue, visits + orders + strike rate, …). */
export const NamedSeriesSchema = z.object({
  metric: AnySeriesMetricSchema,
  unit: SeriesUnitSchema,
  points: z.array(SeriesPointSchema),
})
export type NamedSeries = z.infer<typeof NamedSeriesSchema>

/** Several metrics over the same buckets, in the order the procedure documents. */
export const MultiSeriesOutput = z.object({
  grain: SeriesGrainSchema,
  from: IsoDateSchema,
  to: IsoDateSchema,
  compare: SeriesCompareSchema,
  asOf: z.string(),
  series: z.array(NamedSeriesSchema),
})
export type MultiSeries = z.infer<typeof MultiSeriesOutput>

/** The six ageing buckets over time: one named line per bucket, keyed by `AgeingBucketSchema`. */
export const AgeingSeriesSchema = z.object({
  bucket: AgeingBucketSchema,
  points: z.array(SeriesPointSchema),
})
export const AgeingSeriesOutput = z.object({
  grain: SeriesGrainSchema,
  from: IsoDateSchema,
  to: IsoDateSchema,
  asOf: z.string(),
  /** Total open dues and the overdue part, for the line above the stack. */
  outstanding: z.array(SeriesPointSchema),
  overdue: z.array(SeriesPointSchema),
  buckets: z.array(AgeingSeriesSchema),
})
export type AgeingSeries = z.infer<typeof AgeingSeriesOutput>

/** A month of growth: the month's value, the base month's, and the change in basis points. */
export const GrowthPointSchema = z.object({
  bucket: IsoDateSchema,
  value: z.number(),
  previous: z.number().nullable(),
  /** `(value − previous) / previous` in basis points (2_500 = +25 %); null when `previous` is 0 or absent. May be negative. */
  growthBps: z.number().int().nullable(),
})
export type GrowthPoint = z.infer<typeof GrowthPointSchema>

export const GrowthOutput = z.object({
  metric: GrowthMetricSchema,
  basis: GrowthBasisSchema,
  unit: SeriesUnitSchema,
  grain: z.literal('month'),
  from: IsoDateSchema,
  to: IsoDateSchema,
  asOf: z.string(),
  points: z.array(GrowthPointSchema),
})
export type Growth = z.infer<typeof GrowthOutput>

/** One bar of a ranking: a shop or a beat, its value over the window and its share of the total. */
export const RankingItemSchema = z.object({
  rank: z.number().int().positive(),
  /** Retailer id / beat id. */
  key: IdSchema,
  name: z.string(),
  /** The shop's beat, for the click-through; null for a beat row or an unassigned shop. */
  beatId: IdSchema.nullable(),
  value: z.number(),
  previous: z.number().nullable(),
  /** `value / totalValue` in basis points over EVERY row of the window, not only the top N. */
  shareBps: BpsSchema,
})
export type RankingItem = z.infer<typeof RankingItemSchema>

export const RankingOutput = z.object({
  metric: RankingMetricSchema,
  unit: SeriesUnitSchema,
  from: IsoDateSchema,
  to: IsoDateSchema,
  compare: SeriesCompareSchema,
  asOf: z.string(),
  /** The whole tenant's value over the window — the denominator of every `shareBps`. */
  totalValue: z.number(),
  items: z.array(RankingItemSchema),
})
export type Ranking = z.infer<typeof RankingOutput>

/** A shop's own history, one point per week or month: the O6 row sparkline and the S2 shop card. */
export const RetailerSeriesPointSchema = z.object({
  bucket: IsoDateSchema,
  invoicedPaise: PaiseSchema,
  collectedPaise: PaiseSchema,
  ordersCount: z.number().int().nonnegative(),
})
export const RetailerSeriesOutput = z.object({
  retailerId: IdSchema,
  grain: z.enum(['week', 'month']),
  from: IsoDateSchema,
  to: IsoDateSchema,
  asOf: z.string(),
  points: z.array(RetailerSeriesPointSchema),
})
export type RetailerSeries = z.infer<typeof RetailerSeriesOutput>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — dashboards

/** One day of the owner's KPI sparklines (the last seven business dates, oldest first). */
export const DashboardDayPointSchema = z.object({
  bucket: IsoDateSchema,
  invoicedPaise: PaiseSchema,
  collectedPaise: PaiseSchema,
  ordersCount: z.number().int().nonnegative(),
})

/**
 * The owner's home screen in one read (O1, M1): the `owner_summary` row plus today's `daily_tenant_stats`
 * row, the tenant's ageing buckets and the seven-day sparklines. Refreshed by the worker every 15
 * minutes; `asOf` says when. A brand-new tenant gets all-zero fields, never a 404. Carries MTD margin and
 * stock at cost: BACK_OFFICE, never a field role.
 */
export const OwnerDashboardOutput = z.object({
  asOf: z.string(),
  todayInvoicedPaise: PaiseSchema,
  todayCollectedPaise: PaiseSchema,
  todayOrdersCount: z.number().int().nonnegative(),
  todayDeliveredStops: z.number().int().nonnegative(),
  todayFailedStops: z.number().int().nonnegative(),
  /** Collected by crews on trips not yet settled: money in a van, not yet in the till. */
  cashInTransitPaise: PaiseSchema,
  totalOutstandingPaise: PaiseSchema,
  overduePaise: PaiseSchema,
  /** Open dues by ageing bucket over the whole tenant (the `<AgeingBuckets>` tile). */
  ageing: AgeingBucketsSchema,
  mtdSalesPaise: PaiseSchema,
  mtdGrossMarginPaise: PaiseSchema,
  stockValuePaise: PaiseSchema,
  nearExpiryValuePaise: PaiseSchema,
  pendingApprovals: z.number().int().nonnegative(),
  activeTrips: z.number().int().nonnegative(),
  /** The last seven business dates, oldest first, for the KPI tile sparklines. */
  last7Days: z.array(DashboardDayPointSchema).max(7),
  /** Free-form extras the rollup adds without a contract change (`owner_summary.detail`). */
  detail: z.record(z.string(), z.unknown()).nullable(),
})
export type OwnerDashboard = z.infer<typeof OwnerDashboardOutput>

/**
 * A rep's day (S9, M21): today's `daily_rep_stats` row. A `salesperson` caller always gets its OWN row
 * whatever `userId` it sent; the back office must name the rep. `collectedPaise` is always 0 for a rep
 * (docs/17 §D4). `strikeRate = productiveVisits / visits`, 0 when there were no visits.
 */
export const RepDashboardOutput = z.object({
  userId: IdSchema,
  userName: z.string(),
  day: IsoDateSchema,
  visits: z.number().int().nonnegative(),
  productiveVisits: z.number().int().nonnegative(),
  ordersCount: z.number().int().nonnegative(),
  orderValuePaise: PaiseSchema,
  linesSold: z.number().int().nonnegative(),
  collectedPaise: PaiseSchema,
  strikeRate: RatioSchema,
  computedAt: z.string(),
})
export type RepDashboard = z.infer<typeof RepDashboardOutput>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — daily stats

/** One slice of a day's mix: what was invoiced under one brand / category / beat and how many invoices carried it. */
export const DailyMixSliceSchema = z.object({
  /** Brand id, `products.category` text, or beat id. */
  key: z.string(),
  name: z.string(),
  invoicedPaise: PaiseSchema,
  invoiceCount: z.number().int().nonnegative(),
})
export type DailyMixSlice = z.infer<typeof DailyMixSliceSchema>

export const DailyPaymentModeSliceSchema = z.object({
  mode: ReceiptModeSchema,
  collectedPaise: PaiseSchema,
})

/** One `daily_tenant_stats` row: the distributorship's day, with its brand / category / beat / payment-mode mixes. */
export const DailyTenantStatSchema = z.object({
  day: IsoDateSchema,
  ordersCount: z.number().int().nonnegative(),
  invoicedPaise: PaiseSchema,
  collectedPaise: PaiseSchema,
  /** Open dues at the end of the day; `overduePaise` is the part past its due date. */
  outstandingPaise: PaiseSchema,
  overduePaise: PaiseSchema,
  deliveredStops: z.number().int().nonnegative(),
  partialStops: z.number().int().nonnegative(),
  failedStops: z.number().int().nonnegative(),
  onTimeStops: z.number().int().nonnegative(),
  podStops: z.number().int().nonnegative(),
  orderedPcs: PiecesSchema,
  pickedPcs: PiecesSchema,
  activeRetailers: z.number().int().nonnegative(),
  byBrand: z.array(DailyMixSliceSchema),
  byCategory: z.array(DailyMixSliceSchema),
  byBeat: z.array(DailyMixSliceSchema),
  byPaymentMode: z.array(DailyPaymentModeSliceSchema),
  computedAt: z.string(),
})
export type DailyTenantStat = z.infer<typeof DailyTenantStatSchema>

/** One `daily_rep_stats` row with the rep's name. `strikeRate` is 0 when `visits` is 0, never NaN. */
export const DailyRepStatSchema = z.object({
  userId: IdSchema,
  userName: z.string(),
  day: IsoDateSchema,
  visits: z.number().int().nonnegative(),
  productiveVisits: z.number().int().nonnegative(),
  ordersCount: z.number().int().nonnegative(),
  orderValuePaise: PaiseSchema,
  linesSold: z.number().int().nonnegative(),
  collectedPaise: PaiseSchema,
  strikeRate: RatioSchema,
})
export type DailyRepStat = z.infer<typeof DailyRepStatSchema>

const RepTotalsSchema = z.object({
  visits: z.number().int().nonnegative(),
  productiveVisits: z.number().int().nonnegative(),
  strikeRate: RatioSchema,
  ordersCount: z.number().int().nonnegative(),
  orderValuePaise: PaiseSchema,
  linesSold: z.number().int().nonnegative(),
  collectedPaise: PaiseSchema,
})
export type RepTotals = z.infer<typeof RepTotalsSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — retailers

export const UsualBasketItemSchema = z.object({
  variantId: IdSchema,
  avgPcs: PiecesSchema,
})

/**
 * The shop card's tile (S2, O6): last order / visit / payment, the last 30 days, the usual basket that
 * powers "repeat last order", and a 0–100 lapsed-risk score. 404 until the nightly rollup has written the
 * row for a new shop.
 */
export const RetailerBehaviourSchema = z.object({
  retailerId: IdSchema,
  lastOrderAt: z.string().nullable(),
  lastVisitAt: z.string().nullable(),
  lastPaymentAt: z.string().nullable(),
  ordersLast30: z.number().int().nonnegative(),
  valueLast30Paise: PaiseSchema,
  unitsLast30: PiecesSchema,
  avgDaysToPay: z.number().int().nullable(),
  usualBasket: z.array(UsualBasketItemSchema),
  /** 0 (ordered this week) … 100 (never ordered, never visited). */
  lapsedRisk: z.number().int().min(0).max(100),
  computedAt: z.string(),
})
export type RetailerBehaviour = z.infer<typeof RetailerBehaviourSchema>

export const LapsedRetailerSchema = z.object({
  retailerId: IdSchema,
  retailerName: z.string(),
  beatId: IdSchema.nullable(),
  beatName: z.string().nullable(),
  lastOrderAt: z.string().nullable(),
  lastVisitAt: z.string().nullable(),
  ordersLast30: z.number().int().nonnegative(),
  lapsedRisk: z.number().int().min(0).max(100),
})
export type LapsedRetailer = z.infer<typeof LapsedRetailerSchema>

// ---------------------------------------------------------------------------------------------------------------
// output shapes — registers

/** A rep over the window, per beat it was assigned to on the days inside it (a mid-window reassignment gives two rows). */
export const RepProductivityRowSchema = z.object({
  userId: IdSchema,
  userName: z.string(),
  beatId: IdSchema.nullable(),
  beatName: z.string().nullable(),
  visits: z.number().int().nonnegative(),
  productiveVisits: z.number().int().nonnegative(),
  strikeRate: RatioSchema,
  ordersCount: z.number().int().nonnegative(),
  orderValuePaise: PaiseSchema,
  linesSold: z.number().int().nonnegative(),
  collectedPaise: PaiseSchema,
})
export type RepProductivityRow = z.infer<typeof RepProductivityRowSchema>

/** What one scheme cost in the window, from `invoice_lines.applied_rules` (billing's `RegistersService.schemeSpend`), cancelled invoices excluded. */
export const SchemeSpendRowSchema = z.object({
  schemeId: IdSchema,
  schemeName: z.string(),
  brandId: IdSchema.nullable(),
  brandName: z.string().nullable(),
  fundingSource: SchemeFundingSourceSchema,
  rewardKind: SchemeRewardKindSchema,
  /** Free pieces given away under the scheme. */
  qtyPcs: PiecesSchema,
  amountPaise: PaiseSchema,
  invoiceCount: z.number().int().nonnegative(),
})
export type SchemeSpendRow = z.infer<typeof SchemeSpendRowSchema>

/** Stock at cost per variant and location. `avgCostPaise` = landed cost when set, else purchase rate — BACK_OFFICE only. */
export const StockValueRowSchema = z.object({
  variantId: IdSchema,
  variantName: z.string(),
  brandId: IdSchema.nullable(),
  brandName: z.string().nullable(),
  locationId: IdSchema,
  locationName: z.string(),
  onHandPcs: PiecesSchema,
  avgCostPaise: PaiseSchema,
  valuePaise: PaiseSchema,
  nearestExpiryDate: IsoDateSchema.nullable(),
  /** The part of `valuePaise` in lots expiring inside `nearExpiryDays`. */
  nearExpiryValuePaise: PaiseSchema,
})
export type StockValueRow = z.infer<typeof StockValueRowSchema>

/** Pieces ordered against pieces picked per variant, for orders that reached picking inside the window. `fillRate` is `0/0 → 1`. */
export const FillRateRowSchema = z.object({
  variantId: IdSchema,
  variantName: z.string(),
  orderedPcs: PiecesSchema,
  pickedPcs: PiecesSchema,
  shortPcs: PiecesSchema,
  fillRate: RatioSchema,
})
export type FillRateRow = z.infer<typeof FillRateRowSchema>

/**
 * One trip (delivery's `performanceRows`): stops by outcome, on-time against the ETA plus the tenant's
 * grace, POD coverage of the delivered / partial stops, and the cash variance at settlement (null until
 * the trip is settled). A `delivery` caller sees only trips it drove or helped on.
 */
export const DeliveryPerformanceRowSchema = z.object({
  tripId: IdSchema,
  tripNo: z.string().nullable(),
  tripDate: IsoDateSchema,
  vehicleId: IdSchema,
  vehicleRegNo: z.string(),
  driverId: IdSchema.nullable(),
  driverName: z.string().nullable(),
  stopsPlanned: z.number().int().nonnegative(),
  stopsDelivered: z.number().int().nonnegative(),
  stopsPartial: z.number().int().nonnegative(),
  stopsFailed: z.number().int().nonnegative(),
  onTimeRate: RatioSchema,
  podCoverageRate: RatioSchema,
  cashVariancePaise: PaiseSchema.nullable(),
})
export type DeliveryPerformanceRow = z.infer<typeof DeliveryPerformanceRowSchema>

/**
 * Money collected in the window, by day or by collector, split by mode (receivables' `collectionsRegister`;
 * bounced and cancelled receipts excluded). Built to CSV straight into the accountant's banking slip.
 */
export const CollectionsRowSchema = z.object({
  /** The IST date (`groupBy: day`) or the collector's user id (`groupBy: collector`). */
  bucket: z.string(),
  /** The collector's name for `groupBy: collector`; null for a day row. */
  bucketName: z.string().nullable(),
  cashPaise: PaiseSchema,
  upiPaise: PaiseSchema,
  bankTransferPaise: PaiseSchema,
  chequePaise: PaiseSchema,
  adjustmentPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  receiptCount: z.number().int().nonnegative(),
})
export type CollectionsRow = z.infer<typeof CollectionsRowSchema>

const CollectionsTotalsSchema = CollectionsRowSchema.omit({ bucket: true, bucketName: true })

/** GSTR-2-shaped: one row per HSN and rate over `supplier_invoices.status = 'received'` inside the window. */
export const PurchaseRegisterRowSchema = z.object({
  hsnCode: z.string().nullable(),
  gstBps: BpsSchema,
  cessBps: BpsSchema,
  qtyPcs: PiecesSchema,
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  cessPaise: PaiseSchema,
  totalPaise: PaiseSchema,
  invoiceCount: z.number().int().nonnegative(),
})
export type PurchaseRegisterRow = z.infer<typeof PurchaseRegisterRowSchema>

export const PurchaseRegisterSupplierRowSchema = z.object({
  supplierId: IdSchema,
  supplierName: z.string(),
  supplierGstin: z.string().nullable(),
  invoiceCount: z.number().int().nonnegative(),
  taxablePaise: PaiseSchema,
  totalPaise: PaiseSchema,
})

// ---------------------------------------------------------------------------------------------------------------
// output shapes — exports

/**
 * A report export job — the `export_jobs` row this module queued, as the requester sees it. `url` is a
 * pre-signed read (short-lived) once `status = succeeded`; null while queued / running and after a
 * failure. `queued` / `running` are normal states, never an error on this endpoint.
 */
export const ReportExportJobSchema = z.object({
  id: IdSchema,
  register: ReportRegisterSchema,
  format: ReportExportFormatSchema,
  /** `report_<register>_<format>` — the same string `integrations.exports.list` shows. */
  kind: z.string(),
  status: ExportJobStatusSchema,
  /** The register's own filters as they were requested. */
  filters: z.record(z.string(), z.unknown()),
  /** Derived from the register and the window ("gst-sales-2026-08-01-to-2026-08-31.csv"). */
  fileName: z.string(),
  mimeType: z.string(),
  rowCount: z.number().int().nonnegative().nullable(),
  url: z.string().nullable(),
  expiresAt: z.string().nullable(),
  error: z.string().nullable(),
  requestedBy: IdSchema,
  requestedAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type ReportExportJob = z.infer<typeof ReportExportJobSchema>

// ---------------------------------------------------------------------------------------------------------------
// inputs — dashboards

/** `userId` is FORCED to the caller for a salesperson; the back office must pass it (400 `user_id_required`). */
export const RepDashboardInput = z.object({
  userId: IdSchema.optional(),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — series

const SeriesWindowFields = {
  grain: SeriesGrainSchema.default('day'),
  from: IsoDateSchema,
  to: IsoDateSchema,
}

/** The generic read (docs/23 §1.2): one metric, one grain, an optional dimension, an optional comparison. */
export const SeriesGetInput = seriesWindow(
  z.object({
    metric: SeriesMetricSchema,
    ...SeriesWindowFields,
    /** See `SERIES_METRICS` for which dimension each metric supports; a pair the rollup does not carry is 400 `unsupported_group_by`. */
    groupBy: SeriesGroupBySchema.optional(),
    /** Groups past this rank are folded into one `other` group (`<CompareBars>` max is 12). */
    topGroups: QueryIntSchema.min(1).max(12).default(12),
    compare: SeriesCompareSchema.default('none'),
  }),
)

/** Invoiced value: the sales trend (O2), this month vs last by brand / beat, or one beat's / brand's own trend. */
export const SalesSeriesInput = seriesWindow(
  z.object({
    ...SeriesWindowFields,
    groupBy: z.enum(['brand', 'category', 'beat']).optional(),
    topGroups: QueryIntSchema.min(1).max(12).default(12),
    compare: SeriesCompareSchema.default('none'),
    /** Narrow the whole series to one brand / beat (from the day's mix); with `groupBy` the filters intersect. */
    brandId: IdSchema.optional(),
    beatId: IdSchema.optional(),
  }),
)

/** Money collected: the collections trend (O2, M12) and the payment-mode stack (O2, O11). */
export const CollectionsSeriesInput = seriesWindow(
  z.object({
    ...SeriesWindowFields,
    groupBy: z.enum(['paymentMode']).optional(),
    compare: SeriesCompareSchema.default('none'),
  }),
)

/** Open dues and the overdue part at the end of each bucket (O2, O10), from the ageing snapshots. */
export const OutstandingSeriesInput = seriesWindow(
  z.object({
    ...SeriesWindowFields,
    /** Sum over the shops of one beat, or one shop's own trend; the two intersect. */
    beatId: IdSchema.optional(),
    retailerId: IdSchema.optional(),
  }),
)

/** The six ageing buckets over time (O10 ageing history), the last snapshot inside each bucket. */
export const AgeingSeriesInput = seriesWindow(
  z.object({
    grain: SeriesGrainSchema.default('week'),
    from: IsoDateSchema,
    to: IsoDateSchema,
    beatId: IdSchema.optional(),
    retailerId: IdSchema.optional(),
  }),
)

/**
 * Month-over-month or year-over-year growth of a metric (O2 "growth"), always at month grain over ≤ 24
 * months; the handler reads the base months before `from` itself. `from` / `to` may be any day inside
 * the first and last month.
 */
export const GrowthSeriesInput = z
  .object({
    metric: GrowthMetricSchema.default('invoiced'),
    basis: GrowthBasisSchema.default('mom'),
    from: IsoDateSchema,
    to: IsoDateSchema,
  })
  .superRefine((v, ctx) => {
    for (const issue of windowIssues(v, 'month', null)) ctx.addIssue(issue)
  })

/** Invoiced value by brand per bucket (O2, O17 `<StackedMix>`), the top N brands and `other`. */
export const BrandMixSeriesInput = seriesWindow(
  z.object({
    grain: SeriesGrainSchema.default('month'),
    from: IsoDateSchema,
    to: IsoDateSchema,
    topGroups: QueryIntSchema.min(1).max(12).default(5),
  }),
)

/** Invoiced value by `products.category` per bucket, the top N categories and `other`. */
export const CategoryMixSeriesInput = seriesWindow(
  z.object({
    grain: SeriesGrainSchema.default('month'),
    from: IsoDateSchema,
    to: IsoDateSchema,
    topGroups: QueryIntSchema.min(1).max(12).default(5),
  }),
)

/** The shops that bought / ordered / paid the most over the window (O2, O6), from `daily_retailer_stats`. */
export const TopShopsInput = registerWindow(
  z.object({
    metric: TopShopsMetricSchema.default('invoiced'),
    from: IsoDateSchema,
    to: IsoDateSchema,
    top: QueryIntSchema.min(1).max(50).default(10),
    compare: SeriesCompareSchema.default('none'),
    /** Only the shops of one beat / one rep's beats. */
    beatId: IdSchema.optional(),
    salespersonId: IdSchema.optional(),
  }),
  366,
)

/** The beats that sold the most over the window (O2 "sales by beat"), from the day's beat mix. */
export const TopBeatsInput = registerWindow(
  z.object({
    metric: TopBeatsMetricSchema.default('invoiced'),
    from: IsoDateSchema,
    to: IsoDateSchema,
    top: QueryIntSchema.min(1).max(50).default(10),
    compare: SeriesCompareSchema.default('none'),
  }),
  366,
)

/**
 * A rep's — or the whole field force's — visits, productive visits, orders, order value and strike rate
 * per bucket (S9, M21, O2). `userId` is FORCED to the caller for a salesperson; the back office may name
 * one rep, or omit it for the team total. `beatId` narrows to the days the rep(s) were assigned to that beat.
 */
export const ProductivitySeriesInput = seriesWindow(
  z.object({
    ...SeriesWindowFields,
    userId: IdSchema.optional(),
    beatId: IdSchema.optional(),
    compare: SeriesCompareSchema.default('none'),
  }),
)

/** Fill rate per bucket (O2, W1): picked ÷ ordered pieces, with the pieces behind it. */
export const FillRateSeriesInput = seriesWindow(
  z.object({
    ...SeriesWindowFields,
    compare: SeriesCompareSchema.default('none'),
  }),
)

/**
 * Delivered / partial / failed stops, on-time rate and POD coverage per bucket (O2, O18, D11). `driverId`
 * is FORCED to the caller for the delivery role (trips it drove or helped on).
 */
export const DeliveryPerformanceSeriesInput = seriesWindow(
  z.object({
    ...SeriesWindowFields,
    driverId: IdSchema.optional(),
    vehicleId: IdSchema.optional(),
    compare: SeriesCompareSchema.default('none'),
  }),
)

/**
 * Stock at cost, the near-expiry part and stock turns per bucket (O15, O17), from `daily_owner_stats`.
 * Turns = Σ cost of goods sold over the bucket ÷ the bucket's average closing stock value; 0 when the
 * average stock is 0. BACK_OFFICE — every number is purchase cost.
 */
export const StockSeriesInput = seriesWindow(
  z.object({
    grain: SeriesGrainSchema.default('month'),
    from: IsoDateSchema,
    to: IsoDateSchema,
    compare: SeriesCompareSchema.default('none'),
  }),
)

/** Gross margin per bucket (O17), by brand when asked. OWNER ONLY: the one series the manager never reads. */
export const GrossMarginSeriesInput = seriesWindow(
  z.object({
    grain: SeriesGrainSchema.default('month'),
    from: IsoDateSchema,
    to: IsoDateSchema,
    groupBy: z.enum(['brand']).optional(),
    topGroups: QueryIntSchema.min(1).max(12).default(12),
    compare: SeriesCompareSchema.default('none'),
  }),
)

/** Scheme spend per bucket split by who funds it (O17 `<StackedMix>`): company-funded is a claim to raise, distributor-funded a margin hit. */
export const SchemeSpendSeriesInput = seriesWindow(
  z.object({
    grain: SeriesGrainSchema.default('month'),
    from: IsoDateSchema,
    to: IsoDateSchema,
    compare: SeriesCompareSchema.default('none'),
  }),
)

// ---------------------------------------------------------------------------------------------------------------
// inputs — daily stats

/** The daily sales register: one row per business date, newest first, window ≤ 92 days. */
export const DailyTenantStatsInput = registerWindow(
  z.object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    ...CursorInput,
  }),
  REGISTER_WINDOW_DAYS.dailySales,
)
export const DailyTenantStatsOutput = z.object({
  items: z.array(DailyTenantStatSchema),
  nextCursor: z.string().nullable(),
  /** Over EVERY day of the window, not the page: the flows summed; dues are a stock, not a flow, so they are not here. */
  totals: z.object({
    ordersCount: z.number().int().nonnegative(),
    invoicedPaise: PaiseSchema,
    collectedPaise: PaiseSchema,
    deliveredStops: z.number().int().nonnegative(),
    partialStops: z.number().int().nonnegative(),
    failedStops: z.number().int().nonnegative(),
  }),
})

/**
 * Per-rep day rows, window ≤ 92 days. `userId` is FORCED to the caller for a salesperson; the back office
 * omitting it gets every rep, one page at a time. `beatId` keeps the days the rep was assigned to that beat.
 */
export const DailyRepStatsInput = registerWindow(
  z.object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    userId: IdSchema.optional(),
    beatId: IdSchema.optional(),
    ...CursorInput,
  }),
  REGISTER_WINDOW_DAYS.repDaily,
)
export const DailyRepStatsOutput = z.object({
  items: z.array(DailyRepStatSchema),
  nextCursor: z.string().nullable(),
  totals: RepTotalsSchema,
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — retailers

export const RetailerBehaviourInput = z.object({ id: IdSchema })
export const RetailerBehaviourOutput = z.object({ item: RetailerBehaviourSchema })

/** Ordered `lapsedRisk desc`. A salesperson is always pre-scoped to the shops on its own beats, `beatId` or not. */
export const LapsedRetailersInput = z.object({
  beatId: IdSchema.optional(),
  minRisk: QueryIntSchema.min(0).max(100).default(30),
  ...CursorInput,
})
export const LapsedRetailersOutput = z.object({
  items: z.array(LapsedRetailerSchema),
  nextCursor: z.string().nullable(),
})

/** A shop's own weekly / monthly history (O6 row sparkline, S2), the last `buckets` of `grain` ending today. */
export const RetailerSeriesInput = z.object({
  id: IdSchema,
  grain: z.enum(['week', 'month']).default('week'),
  buckets: QueryIntSchema.min(1).max(26).default(12),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — registers

/** Window ≤ 31 days. `userId` is FORCED to the caller for a salesperson. */
export const RepProductivityInput = registerWindow(
  z.object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    beatId: IdSchema.optional(),
    userId: IdSchema.optional(),
    ...CursorInput,
  }),
  REGISTER_WINDOW_DAYS.repProductivity,
)
export const RepProductivityOutput = z.object({
  items: z.array(RepProductivityRowSchema),
  nextCursor: z.string().nullable(),
  totals: RepTotalsSchema,
})

/** Window ≤ 92 days. */
export const SchemeSpendInput = registerWindow(
  z.object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    brandId: IdSchema.optional(),
    schemeId: IdSchema.optional(),
    fundingSource: SchemeFundingSourceSchema.optional(),
    ...CursorInput,
  }),
  REGISTER_WINDOW_DAYS.schemeSpend,
)
export const SchemeSpendOutput = z.object({
  items: z.array(SchemeSpendRowSchema),
  nextCursor: z.string().nullable(),
  /** The funding split is never collapsed: `companyFundedPaise + distributorFundedPaise = amountPaise`. */
  totals: z.object({
    amountPaise: PaiseSchema,
    qtyPcs: PiecesSchema,
    companyFundedPaise: PaiseSchema,
    distributorFundedPaise: PaiseSchema,
  }),
})

/** A point-in-time read (now), no window. `nearExpiryDays` decides what counts as near expiry. */
export const StockValueInput = z.object({
  locationId: IdSchema.optional(),
  brandId: IdSchema.optional(),
  nearExpiryDays: QueryIntSchema.min(1).max(365).default(90),
  ...CursorInput,
})
export const StockValueOutput = z.object({
  items: z.array(StockValueRowSchema),
  nextCursor: z.string().nullable(),
  totals: z.object({
    onHandPcs: PiecesSchema,
    valuePaise: PaiseSchema,
    nearExpiryValuePaise: PaiseSchema,
  }),
})

/** Window ≤ 31 days. `salespersonId` is FORCED to the caller for a salesperson (the role is refused anyway; kept for symmetry). */
export const FillRateInput = registerWindow(
  z.object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    locationId: IdSchema.optional(),
    salespersonId: IdSchema.optional(),
    ...CursorInput,
  }),
  REGISTER_WINDOW_DAYS.fillRate,
)
export const FillRateOutput = z.object({
  items: z.array(FillRateRowSchema),
  nextCursor: z.string().nullable(),
  totals: z.object({
    orderedPcs: PiecesSchema,
    pickedPcs: PiecesSchema,
    shortPcs: PiecesSchema,
    fillRate: RatioSchema,
  }),
})

/** Window ≤ 31 days. `driverId` is FORCED to the caller for the delivery role. */
export const DeliveryPerformanceInput = registerWindow(
  z.object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    vehicleId: IdSchema.optional(),
    driverId: IdSchema.optional(),
    ...CursorInput,
  }),
  REGISTER_WINDOW_DAYS.deliveryPerformance,
)
export const DeliveryPerformanceOutput = z.object({
  items: z.array(DeliveryPerformanceRowSchema),
  nextCursor: z.string().nullable(),
  totals: z.object({
    stopsPlanned: z.number().int().nonnegative(),
    stopsDelivered: z.number().int().nonnegative(),
    stopsPartial: z.number().int().nonnegative(),
    stopsFailed: z.number().int().nonnegative(),
    onTimeRate: RatioSchema,
    podCoverageRate: RatioSchema,
    /** Over the settled trips of the window only. */
    cashVariancePaise: PaiseSchema,
  }),
})

export const CollectionsGroupBySchema = z.enum(['day', 'collector'])
export type CollectionsGroupBy = z.infer<typeof CollectionsGroupBySchema>

/** Window ≤ 31 days. */
export const CollectionsRegisterInput = registerWindow(
  z.object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    mode: ReceiptModeSchema.optional(),
    groupBy: CollectionsGroupBySchema.default('day'),
    ...CursorInput,
  }),
  REGISTER_WINDOW_DAYS.collections,
)
export const CollectionsRegisterOutput = z.object({
  items: z.array(CollectionsRowSchema),
  nextCursor: z.string().nullable(),
  totals: CollectionsTotalsSchema,
})

/**
 * Billing's own input and output, verbatim (coordination §4: "the GST arithmetic exists once; reporting
 * wraps it"), with reporting's 92-day cap on top. The response of `billing.registers.gstSummary` for the
 * same filters is byte-for-byte the same document.
 */
export const GstSalesRegisterInput = registerWindow(
  GstSummaryInput,
  REGISTER_WINDOW_DAYS.gstSalesRegister,
)
export const GstSalesRegisterOutput = GstSummaryOutput

/** GSTR-2-shaped, window ≤ 92 days: only `supplier_invoices.status = 'received'` — what actually landed as a liability. */
export const GstPurchaseRegisterInput = registerWindow(
  z.object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    supplierId: IdSchema.optional(),
  }),
  REGISTER_WINDOW_DAYS.gstPurchaseRegister,
)
export const GstPurchaseRegisterOutput = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  rows: z.array(PurchaseRegisterRowSchema),
  totals: PurchaseRegisterRowSchema.omit({ hsnCode: true, gstBps: true, cessBps: true }),
  supplierRows: z.array(PurchaseRegisterSupplierRowSchema),
})

// ---------------------------------------------------------------------------------------------------------------
// inputs — exports

/**
 * Queues ONE `export_jobs` row (`kind = report_<register>_<format>`) and answers `queued`; poll
 * `exports.get`. `filters` is the target register's own GET input minus `limit` / `cursor`, validated
 * against that register's schema and window cap at request time (400 before any job exists). A replay
 * with the same `idempotencyKey` returns the same job, never a second row. Audited
 * (`report.export.request`).
 */
export const RequestReportExportInput = MutationBase.extend({
  /** Client id of the new `export_jobs` row. */
  id: IdSchema,
  register: ReportRegisterSchema,
  format: ReportExportFormatSchema.default('csv'),
  filters: z.record(z.string(), z.unknown()).default({}),
  deviceId: DeviceIdSchema.optional(),
})
export const RequestReportExportOutput = z.object({ item: ReportExportJobSchema })

export const ReportExportGetInput = z.object({ id: IdSchema })
export const ReportExportGetOutput = z.object({ item: ReportExportJobSchema })

// ---------------------------------------------------------------------------------------------------------------
// the router: mount as `reporting: reportingContract` in contract.ts

export const reportingContract = {
  dashboard: {
    owner: oc
      .route({
        method: 'GET',
        path: '/reporting/dashboard/owner',
        summary: "The owner's home: today, dues by ageing, MTD margin, stock at cost, sparklines",
      })
      .output(OwnerDashboardOutput),
    rep: oc
      .route({
        method: 'GET',
        path: '/reporting/dashboard/rep',
        summary: "A rep's day: visits, orders, strike rate (a salesperson: its own)",
      })
      .input(RepDashboardInput)
      .output(RepDashboardOutput),
  },
  series: {
    get: oc
      .route({
        method: 'GET',
        path: '/reporting/series',
        summary: 'Any rollup metric as a chart-ready series: grain, range, group-by, compare',
      })
      .input(SeriesGetInput)
      .output(SeriesOutput),
    sales: oc
      .route({
        method: 'GET',
        path: '/reporting/series/sales',
        summary: 'Sales trend: invoiced paise per day / week / month, by brand, category or beat',
      })
      .input(SalesSeriesInput)
      .output(SeriesOutput),
    collections: oc
      .route({
        method: 'GET',
        path: '/reporting/series/collections',
        summary: 'Collections trend: paise collected per bucket, by payment mode',
      })
      .input(CollectionsSeriesInput)
      .output(SeriesOutput),
    outstanding: oc
      .route({
        method: 'GET',
        path: '/reporting/series/outstanding',
        summary: 'Outstanding trend: open dues and the overdue part at the end of each bucket',
      })
      .input(OutstandingSeriesInput)
      .output(MultiSeriesOutput),
    ageing: oc
      .route({
        method: 'GET',
        path: '/reporting/series/ageing',
        summary: 'Ageing trend: the six buckets over time, from the nightly snapshots',
      })
      .input(AgeingSeriesInput)
      .output(AgeingSeriesOutput),
    growth: oc
      .route({
        method: 'GET',
        path: '/reporting/series/growth',
        summary: 'Growth: month over month or year over year, in basis points',
      })
      .input(GrowthSeriesInput)
      .output(GrowthOutput),
    brandMix: oc
      .route({
        method: 'GET',
        path: '/reporting/series/brand-mix',
        summary: 'Brand mix: invoiced paise per brand per bucket, top N and other',
      })
      .input(BrandMixSeriesInput)
      .output(SeriesOutput),
    categoryMix: oc
      .route({
        method: 'GET',
        path: '/reporting/series/category-mix',
        summary: 'Category mix: invoiced paise per product category per bucket',
      })
      .input(CategoryMixSeriesInput)
      .output(SeriesOutput),
    topShops: oc
      .route({
        method: 'GET',
        path: '/reporting/series/top-shops',
        summary: 'Top shops over a range by invoiced, orders or collected, with share',
      })
      .input(TopShopsInput)
      .output(RankingOutput),
    topBeats: oc
      .route({
        method: 'GET',
        path: '/reporting/series/top-beats',
        summary: 'Top beats over a range by invoiced paise or invoice count, with share',
      })
      .input(TopBeatsInput)
      .output(RankingOutput),
    productivity: oc
      .route({
        method: 'GET',
        path: '/reporting/series/productivity',
        summary:
          'Salesperson productivity: visits, orders, order value, strike rate (a rep: its own)',
      })
      .input(ProductivitySeriesInput)
      .output(MultiSeriesOutput),
    fillRate: oc
      .route({
        method: 'GET',
        path: '/reporting/series/fill-rate',
        summary: 'Fill rate trend: picked over ordered pieces per bucket',
      })
      .input(FillRateSeriesInput)
      .output(MultiSeriesOutput),
    deliveryPerformance: oc
      .route({
        method: 'GET',
        path: '/reporting/series/delivery-performance',
        summary: 'Delivery trend: stops by outcome, on-time rate, POD coverage (the crew: its own)',
      })
      .input(DeliveryPerformanceSeriesInput)
      .output(MultiSeriesOutput),
    stock: oc
      .route({
        method: 'GET',
        path: '/reporting/series/stock',
        summary: 'Stock value at cost, near-expiry value and stock turns per bucket (back office)',
      })
      .input(StockSeriesInput)
      .output(MultiSeriesOutput),
    grossMargin: oc
      .route({
        method: 'GET',
        path: '/reporting/series/gross-margin',
        summary: 'Gross margin per bucket, by brand (owner only)',
      })
      .input(GrossMarginSeriesInput)
      .output(SeriesOutput),
    schemeSpend: oc
      .route({
        method: 'GET',
        path: '/reporting/series/scheme-spend',
        summary: 'Scheme spend per bucket, company-funded and distributor-funded apart',
      })
      .input(SchemeSpendSeriesInput)
      .output(MultiSeriesOutput),
  },
  dailyStats: {
    tenant: oc
      .route({
        method: 'GET',
        path: '/reporting/registers/daily-sales',
        summary: 'Daily sales register: one row per business date with its mixes',
      })
      .input(DailyTenantStatsInput)
      .output(DailyTenantStatsOutput),
    rep: oc
      .route({
        method: 'GET',
        path: '/reporting/registers/rep-daily',
        summary: 'Per-rep day rows (a salesperson: its own)',
      })
      .input(DailyRepStatsInput)
      .output(DailyRepStatsOutput),
  },
  retailers: {
    behaviour: oc
      .route({
        method: 'GET',
        path: '/reporting/retailers/{id}/behaviour',
        summary: "A shop's habits: last order, usual basket, days since visit, lapsed risk",
      })
      .input(RetailerBehaviourInput)
      .output(RetailerBehaviourOutput),
    series: oc
      .route({
        method: 'GET',
        path: '/reporting/retailers/{id}/series',
        summary: "A shop's own weekly or monthly purchases, the row sparkline",
      })
      .input(RetailerSeriesInput)
      .output(RetailerSeriesOutput),
    lapsed: oc
      .route({
        method: 'GET',
        path: '/reporting/retailers/lapsed',
        summary: 'Shops being lost, by risk (a salesperson: its own beats)',
      })
      .input(LapsedRetailersInput)
      .output(LapsedRetailersOutput),
  },
  registers: {
    repProductivity: oc
      .route({
        method: 'GET',
        path: '/reporting/registers/rep-productivity',
        summary: 'Rep productivity per beat over a window: visits, strike rate, orders, value',
      })
      .input(RepProductivityInput)
      .output(RepProductivityOutput),
    schemeSpend: oc
      .route({
        method: 'GET',
        path: '/reporting/registers/scheme-spend',
        summary: 'What each scheme cost, company- and distributor-funded apart',
      })
      .input(SchemeSpendInput)
      .output(SchemeSpendOutput),
    stockValue: oc
      .route({
        method: 'GET',
        path: '/reporting/registers/stock-value',
        summary: 'Stock at cost per variant and location, near expiry flagged (back office)',
      })
      .input(StockValueInput)
      .output(StockValueOutput),
    fillRate: oc
      .route({
        method: 'GET',
        path: '/reporting/registers/fill-rate',
        summary: 'Fill rate per variant: ordered, picked, short',
      })
      .input(FillRateInput)
      .output(FillRateOutput),
    deliveryPerformance: oc
      .route({
        method: 'GET',
        path: '/reporting/registers/delivery-performance',
        summary:
          'Per-trip delivery performance: stops, on-time, POD, cash variance (the crew: its own)',
      })
      .input(DeliveryPerformanceInput)
      .output(DeliveryPerformanceOutput),
    collections: oc
      .route({
        method: 'GET',
        path: '/reporting/registers/collections',
        summary: 'Collections by day or collector, split by mode: the banking slip',
      })
      .input(CollectionsRegisterInput)
      .output(CollectionsRegisterOutput),
    gstSalesRegister: oc
      .route({
        method: 'GET',
        path: '/reporting/registers/gst-sales',
        summary: "GSTR-1-shaped sales register — billing's own gstSummary, wrapped",
      })
      .input(GstSalesRegisterInput)
      .output(GstSalesRegisterOutput),
    gstPurchaseRegister: oc
      .route({
        method: 'GET',
        path: '/reporting/registers/gst-purchase',
        summary: 'GSTR-2-shaped purchase register over received supplier invoices',
      })
      .input(GstPurchaseRegisterInput)
      .output(GstPurchaseRegisterOutput),
  },
  exports: {
    request: oc
      .route({
        method: 'POST',
        path: '/reporting/exports',
        summary: 'Queue a CSV / JSON export of a register (async, audited)',
      })
      .input(RequestReportExportInput)
      .output(RequestReportExportOutput),
    get: oc
      .route({
        method: 'GET',
        path: '/reporting/exports/{id}',
        summary: 'A report export job and, once rendered, its short-lived download URL',
      })
      .input(ReportExportGetInput)
      .output(ReportExportGetOutput),
  },
}
