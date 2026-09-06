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
  /*
   * Round to the STEP, not to the integer.
   *
   * Every chart in this product was money in paise until the first ratio one (fill rate, on-time
   * rate, POD coverage — `unit: 'ratio'`, values 0…1). There `step` is fractional: a 0.9 maximum
   * gives step 0.25 and ticks 0, 0.25, 0.5, 0.75, 1 — which `Math.round` collapsed to 0, 0, 1, 1, 1.
   * The axis then printed "0 0 1 1 1" and React logged "Encountered two children with the same key"
   * for every duplicate, because the tick value IS the key. Rounding to the step's own decimals keeps
   * an integer axis integral (money and counts are unchanged) and a fractional one distinct.
   */
  const decimals = step >= 1 ? 0 : Math.min(10, Math.ceil(-Math.log10(step)) + 1)
  const factor = 10 ** decimals
  for (let i = 0; i * step <= top + step / 2; i++) {
    ticks.push(Math.round(i * step * factor) / factor)
  }
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

/** An ageing rung ("0-7", "90+") at the label scale. The floor, and the whole story for `<AgeingBuckets>`. */
export const LADDER_LABEL_MIN = 56
/** Beyond this the name is clipped: the TRACK is what a ladder is for, and it needs the room. */
export const LADDER_LABEL_MAX = 160

/**
 * How wide the label column of one ladder should be.
 *
 * `<BarLadder>` was built for the six ageing buckets and its label column was 56 px, which is exactly
 * "0-7" and nothing else. The claims screen puts a SUPPLIER on each rung, and "Alan's Food Products —
 * Bhiwandi" wrapped onto four lines and shoved the track off its own row. The column is sized from
 * the rungs it actually has — one ladder, one width, so the tracks still line up — and never grows
 * past `LADDER_LABEL_MAX`; the renderers clamp each label to one line.
 *
 * ~6.2 px per character is the average advance of IBM Plex Sans at the 12/13 px label size; it only
 * has to be close, since the result is clamped at both ends.
 */
export function ladderLabelWidth(rows: readonly { label: string }[]): number {
  const longest = rows.reduce((n, row) => Math.max(n, row.label.length), 0)
  return Math.min(LADDER_LABEL_MAX, Math.max(LADDER_LABEL_MIN, Math.ceil(longest * 6.2)))
}

/** Enough for `1,234.00` at the desk cell size. The floor of the value column. */
export const LADDER_VALUE_MIN = 96

/**
 * How wide the FIGURE column of one ladder should be.
 *
 * It was 96 px whatever the density, and a phone sets the ladder's figures in `moneyM` — so the
 * ageing panel's own "2,81,290.00" was wider than the column it was right-aligned in and ran off the
 * right edge of a 375 px screen. The whole point of a rung is the number on it. Sized from the
 * widest FORMATTED value in this ladder (they all print through the same formatter, so they line up)
 * and never below the desk floor; the track flexes, so the row can no longer overflow its screen.
 *
 * `charWidth` is the advance of one tabular digit at the size the renderer is about to use.
 */
export function ladderValueWidth(formatted: readonly string[], charWidth: number): number {
  const longest = formatted.reduce((n, text) => Math.max(n, text.length), 0)
  return Math.max(LADDER_VALUE_MIN, Math.ceil(longest * charWidth))
}

/**
 * A bar's group label, cut to the width of its own slot.
 *
 * `<CompareBars>` centred each label on its bar at full length, so six salespeople with real names
 * printed straight through one another into an unreadable band — the team screen's strike-rate chart
 * read "Demo Docs Staff (edited)Demo Docs Staff (edite…" across the axis. A label wider than its
 * slot is cut and given a single-character ellipsis; the whole name stays available on the mark
 * itself (`<title>` on the web, `accessibilityLabel` on a phone).
 *
 * `charWidth` is an average advance, not a measurement: SVG text cannot be measured before it is
 * laid out and both renderers must agree on the same picture, so the estimate is deliberately a
 * little generous and the same one `ladderValueWidth` already uses.
 */
export function fitLabel(
  label: string,
  slotWidth: number,
  charWidth: number = chart.labelCharWidth,
): string {
  const room = Math.floor((slotWidth - 4) / charWidth)
  if (room <= 1) return ''
  if (label.length <= room) return label
  return `${label.slice(0, room - 1).trimEnd()}…`
}
