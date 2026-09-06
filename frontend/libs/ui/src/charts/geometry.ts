/**
 * Chart geometry, shared by the DOM and the React Native renderers so both draw the identical
 * picture from the identical numbers (UX-00 section 6.14). Pure functions only — no React, no SVG
 * element, no chart library (UX-00 section 13 bans one, and lint enforces it in a screen).
 *
 * Every value that enters here is an integer (paise, pieces, a count or basis points). Money axes
 * start at zero and carry at most five ticks.
 */
import { chart } from '../tokens.js'

/** One point of a series. `x` is the label the axis prints (an IST business date, "4 Sep"). */
export interface SeriesPoint {
  readonly x: string
  readonly y: number
}

/** The role decides the ink and the dash pattern; a screen never picks a colour. */
export type SeriesRole = 'primary' | 'secondary' | 'previous' | 'target'

export interface Series {
  readonly id: string
  readonly label: string
  readonly role: SeriesRole
  readonly points: readonly SeriesPoint[]
}

/** The outer rectangle of a chart plus its four insets. `Box` in `@dos/ui` is the LAYOUT primitive. */
export interface ChartBox {
  readonly width: number
  readonly height: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** Plot area inside a chart box. */
export interface Plot {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function plotArea(box: ChartBox): Plot {
  return {
    x: box.left,
    y: box.top,
    width: Math.max(0, box.width - box.left - box.right),
    height: Math.max(0, box.height - box.top - box.bottom),
  }
}

/**
 * "Nice" ticks from zero to at least `max`, at most `chart.maxTicks` of them. Money axes start at
 * zero (UX-00 section 6.14), so the domain is always `[0, top]`.
 */
export function niceTicks(max: number, count: number = chart.maxTicks): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0]
  const rough = max / Math.max(1, count - 1)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const candidates = [1, 2, 2.5, 5, 10]
  const step = magnitude * (candidates.find((c) => c * magnitude >= rough) ?? 10)
  // The top tick is the first step AT OR ABOVE the data: an axis that stopped below it would draw
  // the highest point outside its own plot.
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let i = 0; i * step <= top + step / 2; i++) ticks.push(Math.round(i * step))
  return ticks
}

/** The top of a zero-based axis: the highest tick at or above the data. */
export function axisTop(max: number, count: number = chart.maxTicks): number {
  const ticks = niceTicks(max, count)
  // Never zero: it is a divisor in `buildScales`.
  return ticks[ticks.length - 1] || 1
}

/** Highest y across every series (0 when there is nothing to draw). */
export function seriesMax(series: readonly Series[]): number {
  let max = 0
  for (const s of series) for (const p of s.points) if (p.y > max) max = p.y
  return max
}

export interface Scales {
  /** Index -> x pixel. */
  readonly x: (index: number) => number
  /** Value -> y pixel (inverted: 0 sits on the baseline). */
  readonly y: (value: number) => number
  readonly top: number
  readonly count: number
}

export function buildScales(plot: Plot, count: number, top: number): Scales {
  const denominator = Math.max(1, count - 1)
  const safeTop = top > 0 ? top : 1
  return {
    x: (index) => plot.x + (plot.width * index) / denominator,
    y: (value) => plot.y + plot.height - (plot.height * value) / safeTop,
    top: safeTop,
    count,
  }
}

/** `M x y L x y …` with two-decimal coordinates, so the two renderers emit byte-identical paths. */
export function linePath(points: readonly SeriesPoint[], scales: Scales): string {
  if (points.length === 0) return ''
  const round = (n: number): string => (Math.round(n * 100) / 100).toString()
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${round(scales.x(i))} ${round(scales.y(p.y))}`)
    .join(' ')
}

/** The 3 px dot goes on the LAST point only, and only for the primary series. */
export function endDot(
  points: readonly SeriesPoint[],
  scales: Scales,
): { x: number; y: number } | null {
  const last = points[points.length - 1]
  if (!last) return null
  return { x: scales.x(points.length - 1), y: scales.y(last.y) }
}

/**
 * Which x labels to print: the first, the last, and every point whose label starts a month —
 * never all 92 (UX-00 section 6.14). Returns indices in order.
 */
export function xTickIndices(points: readonly SeriesPoint[], maxLabels = 6): number[] {
  if (points.length <= maxLabels) return points.map((_, i) => i)
  const last = points.length - 1
  const candidates = new Set<number>([0, last])
  let previousSuffix: string | null = null
  points.forEach((p, i) => {
    const suffix = p.x.replace(/^\d+\s*/, '')
    if (previousSuffix !== null && suffix !== previousSuffix) candidates.add(i)
    previousSuffix = suffix
  })
  if (candidates.size > maxLabels) {
    const step = Math.ceil(points.length / (maxLabels - 1))
    candidates.clear()
    for (let i = 0; i < points.length; i += step) candidates.add(i)
    candidates.add(last)
  }
  // Two labels closer together than this collide and print on top of each other. The FIRST and the
  // LAST always survive; a month start that lands next to the last point is the one that is dropped.
  const minGap = Math.max(1, Math.floor(points.length / (maxLabels + 1)))
  const sorted = [...candidates].sort((a, b) => a - b)
  const kept: number[] = []
  for (const index of sorted) {
    if (index === last) continue
    const previous = kept[kept.length - 1]
    if (previous === undefined || index - previous >= minGap) kept.push(index)
  }
  while (kept.length > 0 && last - (kept[kept.length - 1] ?? 0) < minGap) kept.pop()
  kept.push(last)
  return kept
}

/** Grouped bars: current beside previous, at most 12 groups, 2 px gap, square corners. */
export interface CompareGroup {
  readonly label: string
  readonly current: number
  readonly previous?: number | undefined
}

export interface BarRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly role: 'current' | 'previous'
  readonly group: number
}

export function compareBarRects(
  groups: readonly CompareGroup[],
  plot: Plot,
  top: number,
  barGap = 2,
): BarRect[] {
  if (groups.length === 0) return []
  const slot = plot.width / groups.length
  const hasPrevious = groups.some((g) => g.previous !== undefined)
  const bars = hasPrevious ? 2 : 1
  const barWidth = Math.max(2, (slot - barGap * (bars + 1)) / bars)
  const safeTop = top > 0 ? top : 1
  const rects: BarRect[] = []
  groups.forEach((g, i) => {
    const base = plot.x + slot * i + barGap
    const push = (value: number, role: 'current' | 'previous', offset: number): void => {
      const height = Math.max(0, (plot.height * Math.max(0, value)) / safeTop)
      rects.push({
        x: base + offset,
        y: plot.y + plot.height - height,
        width: barWidth,
        height,
        role,
        group: i,
      })
    }
    if (hasPrevious) {
      push(g.previous ?? 0, 'previous', 0)
      push(g.current, 'current', barWidth + barGap)
    } else {
      push(g.current, 'current', 0)
    }
  })
  return rects
}

/** One horizontal 100% bar, at most five segments, percentages that add to exactly 10000 bps. */
export interface MixSlice {
  readonly label: string
  readonly value: number
}

export interface MixSegment {
  readonly label: string
  readonly value: number
  /** Basis points of the whole; the set sums to exactly 10000. */
  readonly bps: number
  readonly index: number
}

/**
 * Largest-remainder allocation so the printed percentages add up to 100.0 exactly — the same rule the
 * pricing engine uses to spread an order-level discount to the paisa.
 */
export function mixSegments(slices: readonly MixSlice[], otherLabel: string): MixSegment[] {
  const sorted = [...slices].sort((a, b) => b.value - a.value)
  const head = sorted.slice(0, chart.maxMixSlices - 1)
  const tail = sorted.slice(chart.maxMixSlices - 1)
  const merged: MixSlice[] =
    tail.length > 0
      ? [...head, { label: otherLabel, value: tail.reduce((sum, s) => sum + s.value, 0) }]
      : head
  const total = merged.reduce((sum, s) => sum + Math.max(0, s.value), 0)
  if (total <= 0) return merged.map((s, index) => ({ ...s, bps: 0, index }))
  const exact = merged.map((s) => (Math.max(0, s.value) * 10_000) / total)
  const floors = exact.map((v) => Math.floor(v))
  let remainder = 10_000 - floors.reduce((sum, v) => sum + v, 0)
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (remainder <= 0) break
    floors[i] = (floors[i] ?? 0) + 1
    remainder -= 1
  }
  return merged.map((s, index) => ({ ...s, bps: floors[index] ?? 0, index }))
}

/** A 40x16 sparkline path; no axes, no dot, one stroke. */
export function sparklinePath(values: readonly number[], width = 40, height = 16): string {
  if (values.length < 2) return ''
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const round = (n: number): string => (Math.round(n * 100) / 100).toString()
  return values
    .map((v, i) => {
      const x = (width * i) / (values.length - 1)
      const y = height - ((v - min) / span) * height
      return `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`
    })
    .join(' ')
}

/** Width of a ladder rung's fill, as a fraction of the track. */
export function ladderFraction(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(1, Math.max(0, value / max))
}
