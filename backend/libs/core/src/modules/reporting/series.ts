import type { SeriesGrain, SeriesPoint, SeriesUnit } from '@dos/contracts'
import { bucketOf, OTHER_GROUP, ratio } from './reporting.internals.js'

/**
 * The series engine: rollup DAY rows in, chart-ready buckets out (docs/23 §1.2, the founder's graphs).
 *
 * Three rules it exists to keep, so no chart in six apps has to think about them:
 *  1. EVERY BUCKET OF THE WINDOW IS PRESENT, in order, zero-filled. A missing point is a lie about the
 *     shape of the week; `present` remembers whether a row actually existed, which is what makes
 *     `previous` null rather than a false zero.
 *  2. A FLOW IS SUMMED, A STOCK IS THE LAST DAY OF THE BUCKET. Money invoiced in a week is the sum of
 *     its days; dues at the end of a week are Sunday's, never the sum of seven Sundays.
 *  3. A RATIO IS RECOMPUTED FROM THE SUMMED NUMERATOR AND DENOMINATOR, never averaged across days
 *     (docs/plans/reporting.md §4 rule 1).
 */

export interface DayValued {
  day: string
}

export type SeriesMode = 'sum' | 'last' | 'ratio'

export interface MetricSpec<R extends DayValued> {
  unit: SeriesUnit
  mode: SeriesMode
  /** `sum` / `last`: the day's number. */
  value?: ((row: R) => number) | undefined
  /** `ratio`: summed over the bucket, then divided once. */
  numerator?: ((row: R) => number) | undefined
  denominator?: ((row: R) => number) | undefined
  /** What 0/0 means for this ratio: 1 for fill rate, 0 for the rest. */
  emptyRatio?: number | undefined
}

export interface BuiltPoint {
  bucket: string
  value: number
  /** A rollup row existed in this bucket — the difference between "zero sales" and "no data". */
  present: boolean
}

function bucketise<R extends DayValued>(grain: SeriesGrain, rows: readonly R[]): Map<string, R[]> {
  const out = new Map<string, R[]>()
  for (const row of rows) {
    const key = bucketOf(grain, row.day)
    const list = out.get(key)
    if (list) list.push(row)
    else out.set(key, [row])
  }
  for (const list of out.values()) list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return out
}

export function buildPoints<R extends DayValued>(
  grain: SeriesGrain,
  buckets: readonly string[],
  rows: readonly R[],
  spec: MetricSpec<R>,
): BuiltPoint[] {
  const grouped = bucketise(grain, rows)
  return buckets.map((bucket) => {
    const list = grouped.get(bucket) ?? []
    if (list.length === 0) return { bucket, value: 0, present: false }
    if (spec.mode === 'last') {
      const last = list[list.length - 1] as R
      return { bucket, value: spec.value ? spec.value(last) : 0, present: true }
    }
    if (spec.mode === 'ratio') {
      let numerator = 0
      let denominator = 0
      for (const row of list) {
        numerator += spec.numerator ? spec.numerator(row) : 0
        denominator += spec.denominator ? spec.denominator(row) : 0
      }
      return { bucket, value: ratio(numerator, denominator, spec.emptyRatio ?? 0), present: true }
    }
    let sum = 0
    for (const row of list) sum += spec.value ? spec.value(row) : 0
    return { bucket, value: sum, present: true }
  })
}

/**
 * The wire shape: this window's points with the comparison window's aligned by INDEX (bucket 3 of the
 * range against bucket 3 of the shifted range), so a 30-day window compared to the previous 30 days
 * lines up even when the two months have different lengths. `previous` is null where the comparison
 * window has no rollup row at all.
 */
export function toSeriesPoints(
  points: readonly BuiltPoint[],
  previous: readonly BuiltPoint[] | null,
): SeriesPoint[] {
  return points.map((point, i) => {
    const base = previous?.[i]
    return {
      bucket: point.bucket,
      value: point.value,
      previous: base && base.present ? base.value : null,
    }
  })
}

/** One key's contribution from one day row: `[key, numerator, denominator]` (denominator 0 for a sum). */
export type GroupContribution<R> = (row: R) => Iterable<readonly [string, number, number]>

export interface BuiltGroup {
  key: string
  points: BuiltPoint[]
  /** The group's whole-window value — how the top N is chosen and how `other` is decided. */
  total: number
}

/**
 * Grouped points over the same buckets. Groups past `topGroups` are folded into one `other` entry
 * (`<CompareBars>` shows at most 12 bars) rather than dropped, so the stack still adds up to the
 * ungrouped total.
 */
export function buildGroups<R extends DayValued>(
  grain: SeriesGrain,
  buckets: readonly string[],
  rows: readonly R[],
  spec: MetricSpec<R>,
  contributions: GroupContribution<R>,
  topGroups: number,
): BuiltGroup[] {
  const perKey = new Map<string, Map<string, { numerator: number; denominator: number }>>()
  for (const row of rows) {
    const bucket = bucketOf(grain, row.day)
    for (const [key, numerator, denominator] of contributions(row)) {
      let byBucket = perKey.get(key)
      if (!byBucket) {
        byBucket = new Map()
        perKey.set(key, byBucket)
      }
      const cell = byBucket.get(bucket) ?? { numerator: 0, denominator: 0 }
      cell.numerator += numerator
      cell.denominator += denominator
      byBucket.set(bucket, cell)
    }
  }
  const ranked = [...perKey.entries()]
    .map(([key, byBucket]) => {
      let numerator = 0
      let denominator = 0
      for (const cell of byBucket.values()) {
        numerator += cell.numerator
        denominator += cell.denominator
      }
      const total =
        spec.mode === 'ratio' ? ratio(numerator, denominator, spec.emptyRatio ?? 0) : numerator
      return { key, byBucket, total, rank: spec.mode === 'ratio' ? denominator : numerator }
    })
    .sort((a, b) => b.rank - a.rank || (a.key < b.key ? -1 : 1))

  const kept = ranked.slice(0, Math.max(0, topGroups))
  const folded = ranked.slice(Math.max(0, topGroups))
  const build = (byBucket: Map<string, { numerator: number; denominator: number }>): BuiltPoint[] =>
    buckets.map((bucket) => {
      const cell = byBucket.get(bucket)
      if (!cell) return { bucket, value: 0, present: false }
      return {
        bucket,
        value:
          spec.mode === 'ratio'
            ? ratio(cell.numerator, cell.denominator, spec.emptyRatio ?? 0)
            : cell.numerator,
        present: true,
      }
    })

  const groups: BuiltGroup[] = kept.map((entry) => ({
    key: entry.key,
    points: build(entry.byBucket),
    total: entry.total,
  }))
  if (folded.length > 0) {
    const merged = new Map<string, { numerator: number; denominator: number }>()
    let numerator = 0
    let denominator = 0
    for (const entry of folded) {
      for (const [bucket, cell] of entry.byBucket) {
        const target = merged.get(bucket) ?? { numerator: 0, denominator: 0 }
        target.numerator += cell.numerator
        target.denominator += cell.denominator
        merged.set(bucket, target)
      }
      for (const cell of entry.byBucket.values()) {
        numerator += cell.numerator
        denominator += cell.denominator
      }
    }
    groups.push({
      key: OTHER_GROUP,
      points: build(merged),
      total:
        spec.mode === 'ratio' ? ratio(numerator, denominator, spec.emptyRatio ?? 0) : numerator,
    })
  }
  return groups
}
