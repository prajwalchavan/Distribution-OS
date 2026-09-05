import { Inject, Injectable, Optional } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import type { z } from 'zod'
import type {
  AgeingSeriesInput,
  AgeingSeriesOutput,
  AnySeriesMetric,
  BrandMixSeriesInput,
  CategoryMixSeriesInput,
  CollectionsSeriesInput,
  DailyRepStat,
  DailyRepStatsInput,
  DailyRepStatsOutput,
  DailyTenantStat,
  DailyTenantStatsInput,
  DailyTenantStatsOutput,
  DeliveryPerformanceSeriesInput,
  FillRateSeriesInput,
  GrossMarginSeriesInput,
  GrowthOutput,
  GrowthSeriesInput,
  LapsedRetailersInput,
  LapsedRetailersOutput,
  MultiSeriesOutput,
  OwnerDashboardOutput,
  OutstandingSeriesInput,
  ProductivitySeriesInput,
  RankingOutput,
  RepDashboardInput,
  RepDashboardOutput,
  RetailerBehaviourInput,
  RetailerBehaviourOutput,
  RetailerSeriesInput,
  RetailerSeriesOutput,
  SalesSeriesInput,
  SchemeSpendSeriesInput,
  SeriesCompare,
  SeriesGetInput,
  SeriesGrain,
  SeriesGroup,
  SeriesGroupBy,
  SeriesMetric,
  SeriesOutput,
  SeriesPoint,
  StockSeriesInput,
  TopBeatsInput,
  TopShopsInput,
} from '@dos/contracts'
import { withTenant, type Db } from '@dos/db'
import { currentTenant, DB, DB_REPLICA, requireDb, requireRole } from '../../platform/index.js'
import {
  deliveryPerformanceRows,
  type DeliveryPerformanceRow as CrewTripRow,
} from '../delivery/index.js'
import { ageingHistory } from '../receivables/index.js'
import {
  beatAssignmentsFor,
  beatLabels,
  currentBeatIdsFor,
  retailerIdsOnBeats,
  retailerRefs,
} from '../retailers/index.js'
import { brandLabels } from '../tenant-catalog/index.js'
import { userLabels } from '../tenancy/index.js'
import {
  addDays,
  asOfOf,
  badRequest,
  bucketList,
  bucketOf,
  compareWindow,
  growthBps,
  monthsBack,
  OTHER_GROUP,
  ratio,
  shareBps,
  today,
} from './reporting.internals.js'
import {
  behaviourRow,
  lapsedRows,
  ownerDays,
  ownerSummaryRow,
  repDays,
  retailerDays,
  retailerTotals,
  tenantDays,
  type OwnerDayRow,
  type RepDayRow,
  type TenantDayRow,
} from './reporting.queries.js'
import {
  BACK_OFFICE_READERS,
  CREW_PERFORMANCE_READERS,
  FILL_RATE_READERS,
  OWNER_ONLY,
  REP_PERFORMANCE_READERS,
} from './reporting.roles.js'
import {
  buildGroups,
  buildPoints,
  toSeriesPoints,
  type BuiltPoint,
  type GroupContribution,
  type MetricSpec,
} from './series.js'

/**
 * Reporting — the READ MODEL behind every dashboard tile and every graph in the six apps
 * (docs/plans/reporting.md, docs/23 §1.2, the founder's 2026-09-04 "the owner app must have graphs").
 *
 * The shape of everything below is the same: read ≤ 92 day rows of a rollup table, fold them into
 * buckets, hand back arrays a chart can paint. Nothing here scans a ledger, re-derives GST, re-ages a
 * bill or computes an incentive; where a number belongs to another module it is fetched through that
 * module's exported service (coordination §4) and only reshaped here.
 *
 * READS GO TO THE REPLICA. `DB_REPLICA` is the primary client itself until `DATABASE_REPLICA_URL` is
 * set (coordination §3.8, docs/20 rule 10), so a dashboard never competes with the order being
 * confirmed on the primary once a replica exists, and nothing changes until it does.
 *
 * A FIELD ROLE'S OWN-SCOPE FILTER IS FORCED, NEVER MERELY ACCEPTED (docs/plans/reporting.md §8 item 6):
 * a salesperson asking for another rep's `userId` is silently scoped to itself, a delivery user to its
 * own trips. Never a 403 for a mismatched filter — one less error path for a flaky offline client, and
 * `daily_rep_stats`' own RLS is the real guarantee.
 */

type SeriesOut = z.infer<typeof SeriesOutput>
type MultiOut = z.infer<typeof MultiSeriesOutput>

/** The metrics `daily_rep_stats` alone can answer; everything else comes from `daily_tenant_stats`. */
const REP_ONLY_METRICS = new Set<SeriesMetric>([
  'orderValue',
  'visits',
  'productiveVisits',
  'linesSold',
  'strikeRate',
])

/** metric → the dimensions the rollup actually carries (anything else is 400 `unsupported_group_by`). */
const GROUPABLE: Partial<Record<SeriesMetric, readonly SeriesGroupBy[]>> = {
  invoiced: ['brand', 'category', 'beat'],
  collected: ['paymentMode'],
  orders: ['salesperson'],
  orderValue: ['salesperson'],
  visits: ['salesperson'],
  productiveVisits: ['salesperson'],
  linesSold: ['salesperson'],
  strikeRate: ['salesperson'],
}

const TENANT_METRICS: Partial<Record<SeriesMetric, MetricSpec<TenantDayRow>>> = {
  invoiced: { unit: 'paise', mode: 'sum', value: (r) => r.invoicedPaise },
  orders: { unit: 'count', mode: 'sum', value: (r) => r.ordersCount },
  collected: { unit: 'paise', mode: 'sum', value: (r) => r.collectedPaise },
  // Dues are a STOCK: the end of the bucket, never the sum of its days.
  outstanding: { unit: 'paise', mode: 'last', value: (r) => r.outstandingPaise },
  overdue: { unit: 'paise', mode: 'last', value: (r) => r.overduePaise },
  activeRetailers: { unit: 'count', mode: 'sum', value: (r) => r.activeRetailers },
  deliveredStops: { unit: 'count', mode: 'sum', value: (r) => r.deliveredStops },
  partialStops: { unit: 'count', mode: 'sum', value: (r) => r.partialStops },
  failedStops: { unit: 'count', mode: 'sum', value: (r) => r.failedStops },
  onTimeRate: {
    unit: 'ratio',
    mode: 'ratio',
    numerator: (r) => r.onTimeStops,
    denominator: (r) => r.deliveredStops + r.partialStops,
  },
  podCoverageRate: {
    unit: 'ratio',
    mode: 'ratio',
    numerator: (r) => r.podStops,
    denominator: (r) => r.deliveredStops + r.partialStops,
  },
  // 0/0 → 1: nothing ordered is not a fulfilment failure (docs/plans/reporting.md §4).
  fillRate: {
    unit: 'ratio',
    mode: 'ratio',
    numerator: (r) => r.pickedPcs,
    denominator: (r) => r.orderedPcs,
    emptyRatio: 1,
  },
}

const REP_METRICS: Partial<Record<SeriesMetric, MetricSpec<RepDayRow>>> = {
  orders: { unit: 'count', mode: 'sum', value: (r) => r.ordersCount },
  orderValue: { unit: 'paise', mode: 'sum', value: (r) => r.orderValuePaise },
  visits: { unit: 'count', mode: 'sum', value: (r) => r.visits },
  productiveVisits: { unit: 'count', mode: 'sum', value: (r) => r.productiveVisits },
  linesSold: { unit: 'count', mode: 'sum', value: (r) => r.linesSold },
  strikeRate: {
    unit: 'ratio',
    mode: 'ratio',
    numerator: (r) => r.productiveVisits,
    denominator: (r) => r.visits,
  },
}

const MIX_OF: Record<'brand' | 'category' | 'beat', (r: TenantDayRow) => Record<string, unknown>> =
  {
    brand: (r) => r.byBrand,
    category: (r) => r.byCategory,
    beat: (r) => r.byBeat,
  }

@Injectable()
export class ReportingService {
  constructor(
    @Optional() @Inject(DB) private readonly db: Db | null,
    @Optional() @Inject(DB_REPLICA) private readonly replica: Db | null,
  ) {}

  // =============================================================================================================
  // dashboards
  // =============================================================================================================

  /**
   * The owner's home in ONE read (docs/23 O1, M1): the `owner_summary` row the worker refreshes every
   * 15 minutes, today's day row, the tenant's ageing buckets and the seven-day sparklines. A tenant the
   * rollup has never run for gets all-zero fields, never a 404 — the phone always has something to paint.
   */
  async dashboardOwner(): Promise<z.infer<typeof OwnerDashboardOutput>> {
    requireRole(BACK_OFFICE_READERS)
    return this.read(async (tx) => {
      const day = today()
      const summary = await ownerSummaryRow(tx)
      const days = await tenantDays(tx, addDays(day, -6), day)
      const todayRow = days.find((d) => d.day === day)
      const detail = (summary?.detail as Record<string, unknown> | null) ?? null
      const fromDetail = (key: string): number => {
        const value = detail?.[key]
        return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
      }
      const ageing = {
        b0_7: fromDetail('ageingB0_7'),
        b8_15: fromDetail('ageingB8_15'),
        b16_30: fromDetail('ageingB16_30'),
        b31_60: fromDetail('ageingB31_60'),
        b61_90: fromDetail('ageingB61_90'),
        b90plus: fromDetail('ageingB90plus'),
      }
      return {
        asOf: (summary?.asOf ?? new Date()).toISOString(),
        todayInvoicedPaise: summary?.todayInvoicedPaise ?? todayRow?.invoicedPaise ?? 0,
        todayCollectedPaise: summary?.todayCollectedPaise ?? todayRow?.collectedPaise ?? 0,
        todayOrdersCount: todayRow?.ordersCount ?? 0,
        todayDeliveredStops: todayRow?.deliveredStops ?? 0,
        todayFailedStops: todayRow?.failedStops ?? 0,
        cashInTransitPaise: fromDetail('cashInTransitPaise'),
        totalOutstandingPaise: summary?.totalOutstandingPaise ?? 0,
        overduePaise: summary?.overduePaise ?? 0,
        ageing,
        mtdSalesPaise: summary?.mtdSalesPaise ?? 0,
        mtdGrossMarginPaise: summary?.mtdGrossMarginPaise ?? 0,
        stockValuePaise: summary?.stockValuePaise ?? 0,
        nearExpiryValuePaise: summary?.nearExpiryValuePaise ?? 0,
        pendingApprovals: summary?.pendingApprovals ?? 0,
        activeTrips: summary?.activeTrips ?? 0,
        last7Days: days.slice(-7).map((d) => ({
          bucket: d.day,
          invoicedPaise: d.invoicedPaise,
          collectedPaise: d.collectedPaise,
          ordersCount: d.ordersCount,
        })),
        detail,
      }
    })
  }

  /** A rep's day (docs/23 S9). A salesperson always gets its OWN row; the back office must name a rep. */
  async dashboardRep(
    input: z.infer<typeof RepDashboardInput>,
  ): Promise<z.infer<typeof RepDashboardOutput>> {
    requireRole(REP_PERFORMANCE_READERS)
    const userId = this.forcedUserId(input.userId)
    if (!userId)
      badRequest('user_id_required', 'Name the salesperson whose day you want (userId).', {
        field: 'userId',
      })
    return this.read(async (tx) => {
      const day = today()
      const rows = await repDays(tx, { from: day, to: day, userIds: [userId] })
      const names = await userLabels(tx, [userId])
      const row = rows[0]
      const visits = row?.visits ?? 0
      return {
        userId,
        userName: names.get(userId) ?? '',
        day,
        visits,
        productiveVisits: row?.productiveVisits ?? 0,
        ordersCount: row?.ordersCount ?? 0,
        orderValuePaise: row?.orderValuePaise ?? 0,
        linesSold: row?.linesSold ?? 0,
        collectedPaise: row?.collectedPaise ?? 0,
        strikeRate: ratio(row?.productiveVisits ?? 0, visits),
        computedAt: (row?.computedAt ?? new Date()).toISOString(),
      }
    })
  }

  // =============================================================================================================
  // series — the founder's graphs
  // =============================================================================================================

  /** The generic chart read of docs/23 §1.2: one metric, one grain, an optional dimension and comparison. */
  async seriesGet(input: z.infer<typeof SeriesGetInput>): Promise<SeriesOut> {
    requireRole(BACK_OFFICE_READERS)
    const { metric, grain, from, to, groupBy, compare, topGroups } = input
    if (groupBy && !(GROUPABLE[metric] ?? []).includes(groupBy))
      badRequest(
        'unsupported_group_by',
        `${metric} cannot be grouped by ${groupBy}; the rollup carries no such mix.`,
        { metric, groupBy, supported: GROUPABLE[metric] ?? [] },
      )
    return this.read((tx) =>
      groupBy === 'salesperson' || REP_ONLY_METRICS.has(metric)
        ? this.repSeries(tx, { metric, grain, from, to, compare, topGroups, groupBy })
        : this.tenantSeries(tx, { metric, grain, from, to, compare, topGroups, groupBy }),
    )
  }

  /** The sales trend (docs/23 O2), by brand, category or beat, or narrowed to one of them. */
  async seriesSales(input: z.infer<typeof SalesSeriesInput>): Promise<SeriesOut> {
    requireRole(BACK_OFFICE_READERS)
    if (input.brandId && input.beatId)
      badRequest(
        'unsupported_filter',
        'The day mix is one dimension at a time: filter by brand or by beat, not both.',
        { fields: ['brandId', 'beatId'] },
      )
    const filterDimension = input.brandId ? 'brand' : input.beatId ? 'beat' : null
    const filterKey = input.brandId ?? input.beatId ?? null
    if (filterDimension && input.groupBy && input.groupBy !== filterDimension)
      badRequest(
        'unsupported_group_by',
        `A ${filterDimension} filter cannot be grouped by ${input.groupBy}.`,
        { groupBy: input.groupBy, supported: [filterDimension] },
      )
    return this.read((tx) =>
      this.tenantSeries(tx, {
        metric: 'invoiced',
        grain: input.grain,
        from: input.from,
        to: input.to,
        compare: input.compare,
        topGroups: input.topGroups,
        groupBy: input.groupBy,
        ...(filterDimension && filterKey
          ? { filter: { dimension: filterDimension, key: filterKey } }
          : {}),
      }),
    )
  }

  /** The collections trend and the payment-mode stack (docs/23 O2, O11, M1). */
  async seriesCollections(input: z.infer<typeof CollectionsSeriesInput>): Promise<SeriesOut> {
    requireRole(BACK_OFFICE_READERS)
    return this.read((tx) =>
      this.tenantSeries(tx, {
        metric: 'collected',
        grain: input.grain,
        from: input.from,
        to: input.to,
        compare: input.compare,
        topGroups: 12,
        groupBy: input.groupBy,
      }),
    )
  }

  /**
   * Open dues and the overdue part at the end of each bucket (docs/23 O2, O10). Unfiltered it is the
   * rollup's own end-of-day figure; narrowed to a beat or a shop it is receivables' nightly ageing
   * snapshots, re-shaped — never re-aged here (coordination §4).
   */
  async seriesOutstanding(input: z.infer<typeof OutstandingSeriesInput>): Promise<MultiOut> {
    requireRole(BACK_OFFICE_READERS)
    const buckets = bucketList(input.grain, input.from, input.to)
    return this.read(async (tx) => {
      if (input.beatId || input.retailerId) {
        const history = await ageingHistory(tx, {
          grain: input.grain,
          from: input.from,
          to: input.to,
          ...(input.beatId ? { beatId: input.beatId } : {}),
          ...(input.retailerId ? { retailerId: input.retailerId } : {}),
        })
        const rows = history.points.map((p) => ({ day: p.asOf, ...p }))
        return {
          grain: input.grain,
          from: input.from,
          to: input.to,
          compare: 'none' as SeriesCompare,
          asOf: new Date().toISOString(),
          series: [
            {
              metric: 'outstanding',
              unit: 'paise' as const,
              points: this.plain(
                buildPoints(input.grain, buckets, rows, {
                  unit: 'paise',
                  mode: 'last',
                  value: (r) => r.outstandingPaise,
                }),
              ),
            },
            {
              metric: 'overdue',
              unit: 'paise' as const,
              points: this.plain(
                buildPoints(input.grain, buckets, rows, {
                  unit: 'paise',
                  mode: 'last',
                  value: (r) => r.overduePaise,
                }),
              ),
            },
          ],
        }
      }
      const rows = await tenantDays(tx, input.from, input.to)
      return {
        grain: input.grain,
        from: input.from,
        to: input.to,
        compare: 'none' as SeriesCompare,
        asOf: asOfOf(rows),
        series: [
          {
            metric: 'outstanding',
            unit: 'paise' as const,
            points: this.plain(
              buildPoints(
                input.grain,
                buckets,
                rows,
                TENANT_METRICS.outstanding as MetricSpec<TenantDayRow>,
              ),
            ),
          },
          {
            metric: 'overdue',
            unit: 'paise' as const,
            points: this.plain(
              buildPoints(
                input.grain,
                buckets,
                rows,
                TENANT_METRICS.overdue as MetricSpec<TenantDayRow>,
              ),
            ),
          },
        ],
      }
    })
  }

  /** The six ageing buckets over time (docs/23 O10), from receivables' nightly snapshots. */
  async seriesAgeing(
    input: z.infer<typeof AgeingSeriesInput>,
  ): Promise<z.infer<typeof AgeingSeriesOutput>> {
    requireRole(BACK_OFFICE_READERS)
    const buckets = bucketList(input.grain, input.from, input.to)
    return this.read(async (tx) => {
      const history = await ageingHistory(tx, {
        grain: input.grain,
        from: input.from,
        to: input.to,
        ...(input.beatId ? { beatId: input.beatId } : {}),
        ...(input.retailerId ? { retailerId: input.retailerId } : {}),
      })
      const rows = history.points.map((p) => ({ day: p.asOf, ...p }))
      const line = (value: (r: (typeof rows)[number]) => number): SeriesPoint[] =>
        this.plain(buildPoints(input.grain, buckets, rows, { unit: 'paise', mode: 'last', value }))
      return {
        grain: input.grain,
        from: input.from,
        to: input.to,
        asOf: new Date().toISOString(),
        outstanding: line((r) => r.outstandingPaise),
        overdue: line((r) => r.overduePaise),
        buckets: [
          { bucket: 'b0_7' as const, points: line((r) => r.buckets.b0_7) },
          { bucket: 'b8_15' as const, points: line((r) => r.buckets.b8_15) },
          { bucket: 'b16_30' as const, points: line((r) => r.buckets.b16_30) },
          { bucket: 'b31_60' as const, points: line((r) => r.buckets.b31_60) },
          { bucket: 'b61_90' as const, points: line((r) => r.buckets.b61_90) },
          { bucket: 'b90plus' as const, points: line((r) => r.buckets.b90plus) },
        ],
      }
    })
  }

  /** Growth month over month or against the same month last year (docs/23 O2), in basis points. */
  async seriesGrowth(
    input: z.infer<typeof GrowthSeriesInput>,
  ): Promise<z.infer<typeof GrowthOutput>> {
    requireRole(BACK_OFFICE_READERS)
    const back = input.basis === 'mom' ? 1 : 12
    const spec = TENANT_METRICS[input.metric] as MetricSpec<TenantDayRow>
    // The base months live before `from`, so the read starts there and the answer starts at `from`.
    const readFrom = monthsBack(input.from, back)
    return this.read(async (tx) => {
      const rows = await tenantDays(tx, readFrom, input.to)
      const all = bucketList('month', readFrom, input.to)
      const points = buildPoints('month', all, rows, spec)
      const byBucket = new Map(points.map((p) => [p.bucket, p]))
      const wanted = bucketList('month', input.from, input.to)
      return {
        metric: input.metric,
        basis: input.basis,
        unit: spec.unit,
        grain: 'month' as const,
        from: input.from,
        to: input.to,
        asOf: asOfOf(rows),
        points: wanted.map((bucket) => {
          const point = byBucket.get(bucket)
          const base = byBucket.get(monthsBack(bucket, back))
          const previous = base && base.present ? base.value : null
          const value = point?.value ?? 0
          return { bucket, value, previous, growthBps: growthBps(value, previous) }
        }),
      }
    })
  }

  /** Brand mix (docs/23 O2, O17 `<StackedMix>`): the top N brands per bucket and `other`. */
  async seriesBrandMix(input: z.infer<typeof BrandMixSeriesInput>): Promise<SeriesOut> {
    requireRole(BACK_OFFICE_READERS)
    return this.read((tx) =>
      this.tenantSeries(tx, {
        metric: 'invoiced',
        grain: input.grain,
        from: input.from,
        to: input.to,
        compare: 'none',
        topGroups: input.topGroups,
        groupBy: 'brand',
      }),
    )
  }

  /** Category mix, keyed on `products.category` (docs/23 §1.2). */
  async seriesCategoryMix(input: z.infer<typeof CategoryMixSeriesInput>): Promise<SeriesOut> {
    requireRole(BACK_OFFICE_READERS)
    return this.read((tx) =>
      this.tenantSeries(tx, {
        metric: 'invoiced',
        grain: input.grain,
        from: input.from,
        to: input.to,
        compare: 'none',
        topGroups: input.topGroups,
        groupBy: 'category',
      }),
    )
  }

  /** The shops that bought, ordered or paid the most (docs/23 O2, O6), with each one's share. */
  async seriesTopShops(
    input: z.infer<typeof TopShopsInput>,
  ): Promise<z.infer<typeof RankingOutput>> {
    requireRole(BACK_OFFICE_READERS)
    const metric = input.metric
    const valueOf = (r: { invoicedPaise: number; ordersCount: number; collectedPaise: number }) =>
      metric === 'orders'
        ? r.ordersCount
        : metric === 'collected'
          ? r.collectedPaise
          : r.invoicedPaise
    return this.read(async (tx) => {
      const scope = await this.retailerScope(tx, input.beatId, input.salespersonId)
      const current = await retailerTotals(tx, {
        from: input.from,
        to: input.to,
        ...(scope ? { retailerIds: scope } : {}),
        orderBy: metric,
        limit: input.top,
      })
      const window = compareWindow(input.compare, input.from, input.to)
      const previous = window
        ? await retailerTotals(tx, {
            from: window.from,
            to: window.to,
            ...(scope ? { retailerIds: scope } : {}),
            orderBy: metric,
            limit: 2_000,
          })
        : null
      const previousBy = new Map(previous?.items.map((r) => [r.retailerId, valueOf(r)]) ?? [])
      const refs = await retailerRefs(
        tx,
        current.items.map((r) => r.retailerId),
      )
      const total = valueOf(current.totals)
      return {
        metric,
        unit: metric === 'orders' ? ('count' as const) : ('paise' as const),
        from: input.from,
        to: input.to,
        compare: input.compare,
        asOf: new Date().toISOString(),
        totalValue: total,
        items: current.items.map((row, i) => {
          const ref = refs.get(row.retailerId)
          const value = valueOf(row)
          return {
            rank: i + 1,
            key: row.retailerId,
            name: ref?.name ?? row.retailerId,
            beatId: ref?.beatId ?? null,
            value,
            previous: previousBy.get(row.retailerId) ?? null,
            shareBps: shareBps(value, total),
          }
        }),
      }
    })
  }

  /** The beats that sold the most (docs/23 O2 "sales by beat"), from the day's beat mix. */
  async seriesTopBeats(
    input: z.infer<typeof TopBeatsInput>,
  ): Promise<z.infer<typeof RankingOutput>> {
    requireRole(BACK_OFFICE_READERS)
    const pick = (entry: { invoicedPaise: number; invoiceCount: number }): number =>
      input.metric === 'invoices' ? entry.invoiceCount : entry.invoicedPaise
    return this.read(async (tx) => {
      const rows = await tenantDays(tx, input.from, input.to)
      const totalsOf = (days: TenantDayRow[]): Map<string, number> => {
        const out = new Map<string, number>()
        for (const row of days)
          for (const [key, entry] of Object.entries(row.byBeat))
            out.set(key, (out.get(key) ?? 0) + pick(entry))
        return out
      }
      const current = totalsOf(rows)
      const window = compareWindow(input.compare, input.from, input.to)
      const previous = window ? totalsOf(await tenantDays(tx, window.from, window.to)) : null
      const total = [...current.values()].reduce((s, v) => s + v, 0)
      const ranked = [...current.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, input.top)
      const names = await beatLabels(
        tx,
        ranked.map(([key]) => key),
      )
      return {
        metric: input.metric,
        unit: input.metric === 'invoices' ? ('count' as const) : ('paise' as const),
        from: input.from,
        to: input.to,
        compare: input.compare,
        asOf: asOfOf(rows),
        totalValue: total,
        items: ranked.map(([key, value], i) => ({
          rank: i + 1,
          key,
          name: names.get(key) ?? key,
          beatId: key,
          value,
          previous: previous?.get(key) ?? null,
          shareBps: shareBps(value, total),
        })),
      }
    })
  }

  /** A rep's — or the field force's — productivity per bucket (docs/23 S9, M21, O2). */
  async seriesProductivity(input: z.infer<typeof ProductivitySeriesInput>): Promise<MultiOut> {
    requireRole(REP_PERFORMANCE_READERS)
    const userId = this.forcedUserId(input.userId)
    const buckets = bucketList(input.grain, input.from, input.to)
    return this.read(async (tx) => {
      const userIds = await this.repScope(tx, userId, input.beatId, input.from, input.to)
      const rows = await repDays(tx, {
        from: input.from,
        to: input.to,
        ...(userIds ? { userIds } : {}),
      })
      const window = compareWindow(input.compare, input.from, input.to)
      const before = window
        ? await repDays(tx, {
            from: window.from,
            to: window.to,
            ...(userIds ? { userIds } : {}),
          })
        : null
      const beforeBuckets = window ? bucketList(input.grain, window.from, window.to) : []
      const line = (metric: SeriesMetric): MultiOut['series'][number] => {
        const spec = REP_METRICS[metric] as MetricSpec<RepDayRow>
        const points = buildPoints(input.grain, buckets, rows, spec)
        const base = before ? buildPoints(input.grain, beforeBuckets, before, spec) : null
        return { metric, unit: spec.unit, points: toSeriesPoints(points, base) }
      }
      return {
        grain: input.grain,
        from: input.from,
        to: input.to,
        compare: input.compare,
        asOf: asOfOf(rows),
        series: [
          line('visits'),
          line('productiveVisits'),
          line('orders'),
          line('orderValue'),
          line('linesSold'),
          line('strikeRate'),
        ],
      }
    })
  }

  /** The fill-rate trend (docs/23 O2, W1): picked over ordered pieces per bucket. */
  async seriesFillRate(input: z.infer<typeof FillRateSeriesInput>): Promise<MultiOut> {
    requireRole(FILL_RATE_READERS)
    return this.read((tx) =>
      this.tenantMulti(tx, input.grain, input.from, input.to, input.compare, ['fillRate']),
    )
  }

  /**
   * The last mile per bucket (docs/23 O2, O18, D11). Unfiltered it is the rollup's own day counters;
   * narrowed to a driver or a vehicle — and the crew is ALWAYS narrowed to itself — it is delivery's
   * per-trip rows folded by trip date, because the rollup carries no crew or vehicle dimension.
   */
  async seriesDeliveryPerformance(
    input: z.infer<typeof DeliveryPerformanceSeriesInput>,
  ): Promise<MultiOut> {
    requireRole(CREW_PERFORMANCE_READERS)
    const driverId = this.forcedDriverId(input.driverId)
    const buckets = bucketList(input.grain, input.from, input.to)
    if (!driverId && !input.vehicleId)
      return this.read((tx) =>
        this.tenantMulti(tx, input.grain, input.from, input.to, input.compare, [
          'deliveredStops',
          'partialStops',
          'failedStops',
          'onTimeRate',
          'podCoverageRate',
        ]),
      )
    return this.read(async (tx) => {
      const load = async (from: string, to: string): Promise<TripDay[]> =>
        this.tripDays(
          await deliveryPerformanceRows(tx, {
            from,
            to,
            ...(driverId ? { driverId } : {}),
            ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
          }),
        )
      const rows = await load(input.from, input.to)
      const window = compareWindow(input.compare, input.from, input.to)
      const before = window ? await load(window.from, window.to) : null
      const beforeBuckets = window ? bucketList(input.grain, window.from, window.to) : []
      const line = (
        metric: AnySeriesMetric,
        spec: MetricSpec<TripDay>,
      ): MultiOut['series'][number] => ({
        metric,
        unit: spec.unit,
        points: toSeriesPoints(
          buildPoints(input.grain, buckets, rows, spec),
          before ? buildPoints(input.grain, beforeBuckets, before, spec) : null,
        ),
      })
      const attempted = (r: TripDay): number => r.deliveredStops + r.partialStops
      return {
        grain: input.grain,
        from: input.from,
        to: input.to,
        compare: input.compare,
        asOf: new Date().toISOString(),
        series: [
          line('deliveredStops', { unit: 'count', mode: 'sum', value: (r) => r.deliveredStops }),
          line('partialStops', { unit: 'count', mode: 'sum', value: (r) => r.partialStops }),
          line('failedStops', { unit: 'count', mode: 'sum', value: (r) => r.failedStops }),
          line('onTimeRate', {
            unit: 'ratio',
            mode: 'ratio',
            numerator: (r) => r.onTimeStops,
            denominator: attempted,
          }),
          line('podCoverageRate', {
            unit: 'ratio',
            mode: 'ratio',
            numerator: (r) => r.podStops,
            denominator: attempted,
          }),
        ],
      }
    })
  }

  /** Stock at cost, the near-expiry part and stock turns (docs/23 O15, O17). BACK OFFICE: it is cost. */
  async seriesStock(input: z.infer<typeof StockSeriesInput>): Promise<MultiOut> {
    requireRole(BACK_OFFICE_READERS)
    const buckets = bucketList(input.grain, input.from, input.to)
    return this.read(async (tx) => {
      const rows = await ownerDays(tx, input.from, input.to)
      const window = compareWindow(input.compare, input.from, input.to)
      const before = window ? await ownerDays(tx, window.from, window.to) : null
      const beforeBuckets = window ? bucketList(input.grain, window.from, window.to) : []
      const line = (
        metric: AnySeriesMetric,
        spec: MetricSpec<OwnerDayRow>,
      ): MultiOut['series'][number] => ({
        metric,
        unit: spec.unit,
        points: toSeriesPoints(
          buildPoints(input.grain, buckets, rows, spec),
          before ? buildPoints(input.grain, beforeBuckets, before, spec) : null,
        ),
      })
      return {
        grain: input.grain,
        from: input.from,
        to: input.to,
        compare: input.compare,
        asOf: asOfOf(rows),
        series: [
          line('stockValue', { unit: 'paise', mode: 'last', value: (r) => r.stockValuePaise }),
          line('nearExpiryValue', {
            unit: 'paise',
            mode: 'last',
            value: (r) => r.nearExpiryValuePaise,
          }),
          // Turns = cost of goods sold over the bucket ÷ the bucket's average closing stock value.
          line('stockTurns', {
            unit: 'ratio',
            mode: 'ratio',
            numerator: (r) => r.cogsPaise,
            denominator: (r) => r.stockValuePaise,
          }),
        ],
      }
    })
  }

  /** Gross margin per bucket, by brand when asked (docs/23 O17). OWNER ONLY. */
  async seriesGrossMargin(input: z.infer<typeof GrossMarginSeriesInput>): Promise<SeriesOut> {
    requireRole(OWNER_ONLY)
    const buckets = bucketList(input.grain, input.from, input.to)
    const spec: MetricSpec<OwnerDayRow> = {
      unit: 'paise',
      mode: 'sum',
      value: (r) => r.grossMarginPaise,
    }
    return this.read(async (tx) => {
      const rows = await ownerDays(tx, input.from, input.to)
      const window = compareWindow(input.compare, input.from, input.to)
      const before = window ? await ownerDays(tx, window.from, window.to) : null
      const beforeBuckets = window ? bucketList(input.grain, window.from, window.to) : []
      const groups = input.groupBy
        ? buildGroups(
            input.grain,
            buckets,
            rows,
            spec,
            (row) =>
              Object.entries(row.byBrand).map(
                ([key, entry]) => [key, entry.grossMarginPaise, 0] as const,
              ),
            input.topGroups,
          )
        : []
      const names = await brandLabels(
        tx,
        groups.map((g) => g.key).filter((k) => k !== OTHER_GROUP),
      )
      return {
        metric: 'grossMargin' as AnySeriesMetric,
        grain: input.grain,
        unit: 'paise' as const,
        from: input.from,
        to: input.to,
        compare: input.compare,
        groupBy: input.groupBy ?? null,
        asOf: asOfOf(rows),
        points: toSeriesPoints(
          buildPoints(input.grain, buckets, rows, spec),
          before ? buildPoints(input.grain, beforeBuckets, before, spec) : null,
        ),
        groups: groups.map((g) => ({
          key: g.key,
          name: g.key === OTHER_GROUP ? 'Other' : (names.get(g.key) ?? g.key),
          points: this.plain(g.points),
        })),
      }
    })
  }

  /** Scheme spend per bucket, company-funded and distributor-funded apart (docs/23 O17). */
  async seriesSchemeSpend(input: z.infer<typeof SchemeSpendSeriesInput>): Promise<MultiOut> {
    requireRole(BACK_OFFICE_READERS)
    const buckets = bucketList(input.grain, input.from, input.to)
    return this.read(async (tx) => {
      const rows = await ownerDays(tx, input.from, input.to)
      const window = compareWindow(input.compare, input.from, input.to)
      const before = window ? await ownerDays(tx, window.from, window.to) : null
      const beforeBuckets = window ? bucketList(input.grain, window.from, window.to) : []
      const line = (
        metric: AnySeriesMetric,
        value: (r: OwnerDayRow) => number,
      ): MultiOut['series'][number] => {
        const spec: MetricSpec<OwnerDayRow> = { unit: 'paise', mode: 'sum', value }
        return {
          metric,
          unit: 'paise' as const,
          points: toSeriesPoints(
            buildPoints(input.grain, buckets, rows, spec),
            before ? buildPoints(input.grain, beforeBuckets, before, spec) : null,
          ),
        }
      }
      return {
        grain: input.grain,
        from: input.from,
        to: input.to,
        compare: input.compare,
        asOf: asOfOf(rows),
        // Never collapsed: company-funded is a claim to raise, distributor-funded a margin hit.
        series: [
          line('schemeSpendCompany', (r) => r.schemeSpendCompanyPaise),
          line('schemeSpendDistributor', (r) => r.schemeSpendDistributorPaise),
        ],
      }
    })
  }

  // =============================================================================================================
  // daily stats registers
  // =============================================================================================================

  /** The daily sales register (docs/23 M12): one row per business date, newest first. */
  async dailyStatsTenant(
    input: z.infer<typeof DailyTenantStatsInput>,
  ): Promise<z.infer<typeof DailyTenantStatsOutput>> {
    requireRole(BACK_OFFICE_READERS)
    return this.read(async (tx) => {
      const rows = await tenantDays(tx, input.from, input.to)
      const totals = rows.reduce(
        (acc, r) => ({
          ordersCount: acc.ordersCount + r.ordersCount,
          invoicedPaise: acc.invoicedPaise + r.invoicedPaise,
          collectedPaise: acc.collectedPaise + r.collectedPaise,
          deliveredStops: acc.deliveredStops + r.deliveredStops,
          partialStops: acc.partialStops + r.partialStops,
          failedStops: acc.failedStops + r.failedStops,
        }),
        {
          ordersCount: 0,
          invoicedPaise: 0,
          collectedPaise: 0,
          deliveredStops: 0,
          partialStops: 0,
          failedStops: 0,
        },
      )
      const [brandNames, beatNames] = await Promise.all([
        brandLabels(
          tx,
          rows.flatMap((r) => Object.keys(r.byBrand)),
        ),
        beatLabels(
          tx,
          rows.flatMap((r) => Object.keys(r.byBeat)),
        ),
      ])
      const descending = [...rows].reverse()
      const cursor = input.cursor
      const page = (cursor ? descending.filter((r) => r.day < cursor) : descending).slice(
        0,
        input.limit + 1,
      )
      const items = page.slice(0, input.limit).map((r): DailyTenantStat => ({
        day: r.day,
        ordersCount: r.ordersCount,
        invoicedPaise: r.invoicedPaise,
        collectedPaise: r.collectedPaise,
        outstandingPaise: r.outstandingPaise,
        overduePaise: r.overduePaise,
        deliveredStops: r.deliveredStops,
        partialStops: r.partialStops,
        failedStops: r.failedStops,
        onTimeStops: r.onTimeStops,
        podStops: r.podStops,
        orderedPcs: r.orderedPcs,
        pickedPcs: r.pickedPcs,
        activeRetailers: r.activeRetailers,
        byBrand: mixSlices(r.byBrand, brandNames),
        byCategory: mixSlices(r.byCategory, null),
        byBeat: mixSlices(r.byBeat, beatNames),
        byPaymentMode: Object.entries(r.byPaymentMode)
          .filter(([mode]) => RECEIPT_MODES.has(mode))
          .map(([mode, paise]) => ({
            mode: mode as DailyTenantStat['byPaymentMode'][number]['mode'],
            collectedPaise: paise,
          })),
        computedAt: r.computedAt.toISOString(),
      }))
      const last = items[items.length - 1]
      return {
        items,
        nextCursor: page.length > input.limit && last ? last.day : null,
        totals,
      }
    })
  }

  /** Per-rep day rows (docs/23 M21). A salesperson is forced to its own id, `beatId` narrows by assignment. */
  async dailyStatsRep(
    input: z.infer<typeof DailyRepStatsInput>,
  ): Promise<z.infer<typeof DailyRepStatsOutput>> {
    requireRole(REP_PERFORMANCE_READERS)
    const userId = this.forcedUserId(input.userId)
    return this.read(async (tx) => {
      const userIds = await this.repScope(tx, userId, input.beatId, input.from, input.to)
      const rows = await repDays(tx, {
        from: input.from,
        to: input.to,
        ...(userIds ? { userIds } : {}),
      })
      const kept = input.beatId
        ? await this.keepOnBeat(tx, rows, input.beatId, input.from, input.to)
        : rows
      const names = await userLabels(
        tx,
        kept.map((r) => r.userId),
      )
      const descending = [...kept].sort((a, b) =>
        a.day === b.day ? (a.userId < b.userId ? 1 : -1) : a.day < b.day ? 1 : -1,
      )
      const cursor = input.cursor
      const after = cursor ? descending.filter((r) => `${r.day}|${r.userId}` < cursor) : descending
      const page = after.slice(0, input.limit + 1)
      const items = page.slice(0, input.limit).map((r): DailyRepStat => ({
        userId: r.userId,
        userName: names.get(r.userId) ?? '',
        day: r.day,
        visits: r.visits,
        productiveVisits: r.productiveVisits,
        ordersCount: r.ordersCount,
        orderValuePaise: r.orderValuePaise,
        linesSold: r.linesSold,
        collectedPaise: r.collectedPaise,
        strikeRate: ratio(r.productiveVisits, r.visits),
      }))
      const last = page[items.length - 1]
      return {
        items,
        nextCursor: page.length > input.limit && last ? `${last.day}|${last.userId}` : null,
        totals: repTotals(kept),
      }
    })
  }

  // =============================================================================================================
  // retailer surfaces
  // =============================================================================================================

  /** The shop card's tile (docs/23 S2, O6). 404 until the nightly rollup has written the row. */
  async retailerBehaviour(
    input: z.infer<typeof RetailerBehaviourInput>,
  ): Promise<z.infer<typeof RetailerBehaviourOutput>> {
    requireRole(REP_PERFORMANCE_READERS)
    return this.read(async (tx) => {
      await this.assertRepServes(tx, input.id)
      const row = await behaviourRow(tx, input.id)
      if (!row)
        throw new ORPCError('NOT_FOUND', {
          message: 'No behaviour has been computed for this shop yet.',
          data: { code: 'behaviour_not_computed', retailerId: input.id },
        })
      return {
        item: {
          retailerId: row.retailerId,
          lastOrderAt: row.lastOrderAt ? row.lastOrderAt.toISOString() : null,
          lastVisitAt: row.lastVisitAt ? row.lastVisitAt.toISOString() : null,
          lastPaymentAt: row.lastPaymentAt ? row.lastPaymentAt.toISOString() : null,
          ordersLast30: row.ordersLast30,
          valueLast30Paise: row.valueLast30Paise,
          unitsLast30: row.unitsLast30,
          avgDaysToPay: row.avgDaysToPay,
          usualBasket: row.usualBasket,
          lapsedRisk: row.lapsedRisk,
          computedAt: row.computedAt.toISOString(),
        },
      }
    })
  }

  /** A shop's own weekly / monthly history (docs/23 O6 row sparkline, S2). */
  async retailerSeries(
    input: z.infer<typeof RetailerSeriesInput>,
  ): Promise<z.infer<typeof RetailerSeriesOutput>> {
    requireRole(REP_PERFORMANCE_READERS)
    const to = today()
    const grain: SeriesGrain = input.grain
    const from =
      grain === 'week'
        ? addDays(bucketOf('week', to), -(input.buckets - 1) * 7)
        : monthsBack(to, input.buckets - 1)
    const buckets = bucketList(grain, from, to)
    return this.read(async (tx) => {
      await this.assertRepServes(tx, input.id)
      const rows = await retailerDays(tx, { from, to, retailerIds: [input.id] })
      const line = (value: (r: (typeof rows)[number]) => number): BuiltPoint[] =>
        buildPoints(grain, buckets, rows, { unit: 'paise', mode: 'sum', value })
      const invoiced = line((r) => r.invoicedPaise)
      const collected = line((r) => r.collectedPaise)
      const orders = line((r) => r.ordersCount)
      return {
        retailerId: input.id,
        grain,
        from,
        to,
        asOf: asOfOf(rows),
        points: buckets.map((bucket, i) => ({
          bucket,
          invoicedPaise: invoiced[i]?.value ?? 0,
          collectedPaise: collected[i]?.value ?? 0,
          ordersCount: orders[i]?.value ?? 0,
        })),
      }
    })
  }

  /** Shops being lost (docs/23 O6, S10). A salesperson sees only the shops on its own beats. */
  async retailersLapsed(
    input: z.infer<typeof LapsedRetailersInput>,
  ): Promise<z.infer<typeof LapsedRetailersOutput>> {
    requireRole(REP_PERFORMANCE_READERS)
    return this.read(async (tx) => {
      const scope = await this.retailerScope(tx, input.beatId, this.forcedUserId(undefined))
      const cursor = decodeLapsedCursor(input.cursor)
      const rows = await lapsedRows(tx, {
        minRisk: input.minRisk,
        ...(scope ? { retailerIds: scope } : {}),
        ...(cursor ? { cursor } : {}),
        limit: input.limit + 1,
      })
      const page = rows.slice(0, input.limit)
      const refs = await retailerRefs(
        tx,
        page.map((r) => r.retailerId),
      )
      const names = await beatLabels(
        tx,
        page.map((r) => refs.get(r.retailerId)?.beatId ?? '').filter((id) => id.length > 0),
      )
      const last = page[page.length - 1]
      return {
        items: page.map((r) => {
          const ref = refs.get(r.retailerId)
          return {
            retailerId: r.retailerId,
            retailerName: ref?.name ?? r.retailerId,
            beatId: ref?.beatId ?? null,
            beatName: ref?.beatId ? (names.get(ref.beatId) ?? null) : null,
            lastOrderAt: r.lastOrderAt ? r.lastOrderAt.toISOString() : null,
            lastVisitAt: r.lastVisitAt ? r.lastVisitAt.toISOString() : null,
            ordersLast30: r.ordersLast30,
            lapsedRisk: r.lapsedRisk,
          }
        }),
        nextCursor:
          rows.length > input.limit && last
            ? encodeLapsedCursor(last.lapsedRisk, last.retailerId)
            : null,
      }
    })
  }

  // =============================================================================================================
  // internals
  // =============================================================================================================

  /**
   * Every read of this module goes through here: the REPLICA client when one is configured, the
   * primary otherwise (they are the same object until `DATABASE_REPLICA_URL` is set), inside
   * `withTenant` so RLS applies exactly as it does on the primary.
   */
  private read<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const db = requireDb(this.replica ?? this.db)
    return withTenant(db, currentTenant(), fn)
  }

  /** A salesperson's `userId` is its own, whatever the client sent (docs/plans/reporting.md §8 item 6). */
  private forcedUserId(requested: string | undefined): string | undefined {
    const ctx = currentTenant()
    return ctx.actorRole === 'salesperson' ? ctx.actorId : requested
  }

  /** The delivery crew sees the trips it drove or helped on, whatever the client sent. */
  private forcedDriverId(requested: string | undefined): string | undefined {
    const ctx = currentTenant()
    return ctx.actorRole === 'delivery' ? ctx.actorId : requested
  }

  private plain(points: readonly BuiltPoint[]): SeriesPoint[] {
    return toSeriesPoints(points, null)
  }

  /** The shops a read may touch: one beat's, a rep's own beats', or every shop (null). */
  private async retailerScope(
    tx: Db,
    beatId: string | undefined,
    salespersonId: string | undefined,
  ): Promise<string[] | null> {
    const beats = beatId
      ? [beatId]
      : salespersonId
        ? await currentBeatIdsFor(tx, salespersonId, today())
        : null
    if (!beats) return null
    return retailerIdsOnBeats(tx, beats)
  }

  /** The reps a read may touch: one rep, the reps on a beat inside the window, or every rep (null). */
  private async repScope(
    tx: Db,
    userId: string | undefined,
    beatId: string | undefined,
    from: string,
    to: string,
  ): Promise<string[] | null> {
    if (userId) return [userId]
    if (!beatId) return null
    const rows = await beatAssignmentsFor(tx, { from, to, beatId })
    return [...new Set(rows.map((r) => r.userId))]
  }

  /**
   * A rep reassigned mid-window belongs to the beat it was on THAT DAY: the days outside the beat's
   * own assignment window drop out, so a beat's total is never inflated by a rep's other beat
   * (docs/plans/reporting.md §5 spec 4).
   */
  private async keepOnBeat(
    tx: Db,
    rows: readonly RepDayRow[],
    beatId: string,
    from: string,
    to: string,
  ): Promise<RepDayRow[]> {
    const spans = await beatAssignmentsFor(tx, { from, to, beatId })
    return rows.filter((row) =>
      spans.some(
        (s) =>
          s.userId === row.userId && s.validFrom <= row.day && (!s.validTo || s.validTo >= row.day),
      ),
    )
  }

  /** A salesperson may only open a shop on one of its own current beats (the S1 / S2 scoping). */
  private async assertRepServes(tx: Db, retailerId: string): Promise<void> {
    const ctx = currentTenant()
    if (ctx.actorRole !== 'salesperson') return
    const scope = await this.retailerScope(tx, undefined, ctx.actorId)
    if (scope && !scope.includes(retailerId))
      throw new ORPCError('NOT_FOUND', {
        message: 'That shop is not on your beat.',
        data: { code: 'retailer_not_on_beat', retailerId },
      })
  }

  /** The tenant-rollup series, grouped or not. */
  private async tenantSeries(
    tx: Db,
    input: {
      metric: SeriesMetric
      grain: SeriesGrain
      from: string
      to: string
      compare: SeriesCompare
      topGroups: number
      groupBy?: SeriesGroupBy | undefined
      filter?: { dimension: 'brand' | 'beat'; key: string } | undefined
    },
  ): Promise<SeriesOut> {
    const base = TENANT_METRICS[input.metric]
    if (!base)
      badRequest('unsupported_metric', `${input.metric} is not served from the tenant rollup.`, {
        metric: input.metric,
      })
    // A brand / beat filter reads that key out of the day's mix instead of the day's total.
    const spec: MetricSpec<TenantDayRow> = input.filter
      ? {
          unit: base.unit,
          mode: 'sum',
          value: (row) =>
            (
              MIX_OF[input.filter?.dimension ?? 'brand'](row)[input.filter?.key ?? ''] as
                { invoicedPaise: number } | undefined
            )?.invoicedPaise ?? 0,
        }
      : base
    const buckets = bucketList(input.grain, input.from, input.to)
    const rows = await tenantDays(tx, input.from, input.to)
    const window = compareWindow(input.compare, input.from, input.to)
    const before = window ? await tenantDays(tx, window.from, window.to) : null
    const beforeBuckets = window ? bucketList(input.grain, window.from, window.to) : []
    const groups = input.groupBy
      ? buildGroups(
          input.grain,
          buckets,
          rows,
          spec,
          tenantContribution(input.groupBy),
          input.topGroups,
        )
      : []
    const names = await this.groupNames(
      tx,
      input.groupBy,
      groups.map((g) => g.key),
    )
    return {
      metric: input.metric,
      grain: input.grain,
      unit: spec.unit,
      from: input.from,
      to: input.to,
      compare: input.compare,
      groupBy: input.groupBy ?? null,
      asOf: asOfOf(rows),
      points: toSeriesPoints(
        buildPoints(input.grain, buckets, rows, spec),
        before ? buildPoints(input.grain, beforeBuckets, before, spec) : null,
      ),
      groups: groups.map((g) => ({
        key: g.key,
        name: names.get(g.key) ?? g.key,
        points: this.plain(g.points),
      })),
    }
  }

  /**
   * The same series from `daily_rep_stats`: the FIELD FORCE's total, which is less than the tenant's
   * when shops order through the retailer app — grouping by salesperson is only meaningful over the
   * rows that name a rep.
   */
  private async repSeries(
    tx: Db,
    input: {
      metric: SeriesMetric
      grain: SeriesGrain
      from: string
      to: string
      compare: SeriesCompare
      topGroups: number
      groupBy?: SeriesGroupBy | undefined
    },
  ): Promise<SeriesOut> {
    const spec = REP_METRICS[input.metric]
    if (!spec)
      badRequest('unsupported_metric', `${input.metric} is not served from the rep rollup.`, {
        metric: input.metric,
      })
    const buckets = bucketList(input.grain, input.from, input.to)
    const rows = await repDays(tx, { from: input.from, to: input.to })
    const window = compareWindow(input.compare, input.from, input.to)
    const before = window ? await repDays(tx, { from: window.from, to: window.to }) : null
    const beforeBuckets = window ? bucketList(input.grain, window.from, window.to) : []
    const groups = input.groupBy
      ? buildGroups(
          input.grain,
          buckets,
          rows,
          spec,
          (row) => [
            [
              row.userId,
              spec.mode === 'ratio' ? (spec.numerator?.(row) ?? 0) : (spec.value?.(row) ?? 0),
              spec.mode === 'ratio' ? (spec.denominator?.(row) ?? 0) : 0,
            ] as const,
          ],
          input.topGroups,
        )
      : []
    const names = await userLabels(
      tx,
      groups.map((g) => g.key).filter((k) => k !== OTHER_GROUP),
    )
    return {
      metric: input.metric,
      grain: input.grain,
      unit: spec.unit,
      from: input.from,
      to: input.to,
      compare: input.compare,
      groupBy: input.groupBy ?? null,
      asOf: asOfOf(rows),
      points: toSeriesPoints(
        buildPoints(input.grain, buckets, rows, spec),
        before ? buildPoints(input.grain, beforeBuckets, before, spec) : null,
      ),
      groups: groups.map((g): SeriesGroup => ({
        key: g.key,
        name: g.key === OTHER_GROUP ? 'Other' : (names.get(g.key) ?? g.key),
        points: this.plain(g.points),
      })),
    }
  }

  /** Several tenant metrics over the same buckets (the `MultiSeries` answers). */
  private async tenantMulti(
    tx: Db,
    grain: SeriesGrain,
    from: string,
    to: string,
    compare: SeriesCompare,
    metrics: readonly SeriesMetric[],
  ): Promise<MultiOut> {
    const buckets = bucketList(grain, from, to)
    const rows = await tenantDays(tx, from, to)
    const window = compareWindow(compare, from, to)
    const before = window ? await tenantDays(tx, window.from, window.to) : null
    const beforeBuckets = window ? bucketList(grain, window.from, window.to) : []
    return {
      grain,
      from,
      to,
      compare,
      asOf: asOfOf(rows),
      series: metrics.map((metric) => {
        const spec = TENANT_METRICS[metric] as MetricSpec<TenantDayRow>
        return {
          metric,
          unit: spec.unit,
          points: toSeriesPoints(
            buildPoints(grain, buckets, rows, spec),
            before ? buildPoints(grain, beforeBuckets, before, spec) : null,
          ),
        }
      }),
    }
  }

  private async groupNames(
    tx: Db,
    groupBy: SeriesGroupBy | undefined,
    keys: readonly string[],
  ): Promise<Map<string, string>> {
    const real = keys.filter((k) => k !== OTHER_GROUP)
    const out =
      groupBy === 'brand'
        ? await brandLabels(tx, real)
        : groupBy === 'beat'
          ? await beatLabels(tx, real)
          : groupBy === 'salesperson'
            ? await userLabels(tx, real)
            : new Map<string, string>(real.map((k) => [k, k]))
    if (keys.includes(OTHER_GROUP)) out.set(OTHER_GROUP, 'Other')
    return out
  }

  /** Delivery's per-trip rows folded to one row per trip date (the crew's own trend). */
  private tripDays(rows: readonly CrewTripRow[]): TripDay[] {
    const byDay = new Map<string, TripDay>()
    for (const row of rows) {
      const day = byDay.get(row.tripDate) ?? {
        day: row.tripDate,
        deliveredStops: 0,
        partialStops: 0,
        failedStops: 0,
        onTimeStops: 0,
        podStops: 0,
      }
      day.deliveredStops += row.stopsDelivered
      day.partialStops += row.stopsPartial
      day.failedStops += row.stopsFailed
      day.onTimeStops += row.stopsOnTime
      day.podStops += row.stopsWithPod
      byDay.set(row.tripDate, day)
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
  }
}

interface TripDay {
  day: string
  deliveredStops: number
  partialStops: number
  failedStops: number
  onTimeStops: number
  podStops: number
}

const RECEIPT_MODES = new Set(['cash', 'upi', 'bank_transfer', 'cheque', 'adjustment'])

function tenantContribution(groupBy: SeriesGroupBy): GroupContribution<TenantDayRow> {
  if (groupBy === 'paymentMode')
    return (row) =>
      Object.entries(row.byPaymentMode)
        .filter(([mode]) => RECEIPT_MODES.has(mode))
        .map(([key, paise]) => [key, paise, 0] as const)
  const mix = MIX_OF[groupBy as 'brand' | 'category' | 'beat']
  return (row) =>
    Object.entries(mix ? mix(row) : {}).map(
      ([key, entry]) => [key, (entry as { invoicedPaise: number }).invoicedPaise, 0] as const,
    )
}

function mixSlices(
  mix: Record<string, { invoicedPaise: number; invoiceCount: number }>,
  names: Map<string, string> | null,
): DailyTenantStat['byBrand'] {
  return Object.entries(mix)
    .map(([key, entry]) => ({
      key,
      name: names?.get(key) ?? key,
      invoicedPaise: entry.invoicedPaise,
      invoiceCount: entry.invoiceCount,
    }))
    .sort((a, b) => b.invoicedPaise - a.invoicedPaise || (a.key < b.key ? -1 : 1))
}

/** Window totals of a rep page: the strike rate is recomputed from the sums, never averaged. */
export function repTotals(
  rows: readonly RepDayRow[],
): z.infer<typeof DailyRepStatsOutput>['totals'] {
  const totals = rows.reduce(
    (acc, r) => ({
      visits: acc.visits + r.visits,
      productiveVisits: acc.productiveVisits + r.productiveVisits,
      ordersCount: acc.ordersCount + r.ordersCount,
      orderValuePaise: acc.orderValuePaise + r.orderValuePaise,
      linesSold: acc.linesSold + r.linesSold,
      collectedPaise: acc.collectedPaise + r.collectedPaise,
    }),
    {
      visits: 0,
      productiveVisits: 0,
      ordersCount: 0,
      orderValuePaise: 0,
      linesSold: 0,
      collectedPaise: 0,
    },
  )
  return { ...totals, strikeRate: ratio(totals.productiveVisits, totals.visits) }
}

function encodeLapsedCursor(risk: number, retailerId: string): string {
  return Buffer.from(`${String(risk)}|${retailerId}`, 'utf8').toString('base64url')
}

function decodeLapsedCursor(
  cursor: string | undefined,
): { risk: number; retailerId: string } | undefined {
  if (!cursor) return undefined
  const [risk, retailerId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  if (risk === undefined || retailerId === undefined) return undefined
  const value = Number(risk)
  return Number.isFinite(value) ? { risk: value, retailerId } : undefined
}
