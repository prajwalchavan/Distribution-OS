import { describe, expect, it } from 'vitest'

import { clockTime, relativeTime } from '../relative-time.js'
import { t } from '../strings.js'
import {
  axisTop,
  buildScales,
  compareBarRects,
  fitLabel,
  linePath,
  mixSegments,
  niceTicks,
  plotArea,
  sparklinePath,
  xTickIndices,
  ladderLabelWidth,
  ladderValueWidth,
  LADDER_LABEL_MIN,
  LADDER_LABEL_MAX,
  LADDER_VALUE_MIN,
  type SeriesPoint,
} from './geometry.js'

const BOX = { width: 640, height: 160, top: 8, right: 8, bottom: 20, left: 44 }

describe('niceTicks', () => {
  it('always starts at zero — a money axis never begins part way up', () => {
    for (const max of [1, 999, 1_84_200_00, 3_50_00_000_00]) {
      expect(niceTicks(max)[0]).toBe(0)
    }
  })

  it('never prints more than five ticks', () => {
    for (const max of [7, 123, 45_678, 1_84_200_00]) {
      expect(niceTicks(max).length).toBeLessThanOrEqual(6)
    }
  })

  it('reaches at least the data', () => {
    for (const max of [7, 123, 45_678, 1_84_200_00]) {
      expect(axisTop(max)).toBeGreaterThanOrEqual(max)
    }
  })

  /**
   * The fill-rate, on-time and POD-coverage charts are `unit: 'ratio'` — 0…1, not paise. Rounding a
   * fractional step to the nearest integer made the axis read "0 0 1 1 1", and since the tick value
   * is also its React key it logged a duplicate-key error for every collapsed tick.
   */
  it('keeps a fractional axis distinct — a ratio chart is not five integers', () => {
    const ticks = niceTicks(0.9)
    expect(new Set(ticks).size).toBe(ticks.length)
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(0.9)
    for (const max of [0.12, 0.34, 0.5, 0.79, 0.9, 1]) {
      const t = niceTicks(max)
      expect(new Set(t).size).toBe(t.length)
      expect(axisTop(max)).toBeGreaterThanOrEqual(max)
    }
  })

  it('leaves a money axis integral — paise never grow a decimal point', () => {
    for (const max of [7, 123, 45_678, 1_84_200_00]) {
      for (const tick of niceTicks(max)) expect(Number.isInteger(tick)).toBe(true)
    }
  })

  it('answers a single zero tick for an empty chart instead of dividing by nothing', () => {
    expect(niceTicks(0)).toEqual([0])
    expect(axisTop(0)).toBe(1)
  })
})

describe('scales and paths', () => {
  const points: SeriesPoint[] = [
    { x: '1 Sep', y: 0 },
    { x: '2 Sep', y: 50 },
    { x: '3 Sep', y: 100 },
  ]

  it('puts zero on the baseline and the top of the axis at the top of the plot', () => {
    const plot = plotArea(BOX)
    const scales = buildScales(plot, 3, 100)
    expect(scales.y(0)).toBe(plot.y + plot.height)
    expect(scales.y(100)).toBe(plot.y)
  })

  it('draws a path with two-decimal coordinates so both renderers emit the same string', () => {
    const plot = plotArea(BOX)
    const scales = buildScales(plot, points.length, 100)
    const d = linePath(points, scales)
    // The first point is zero, so the path starts on the baseline at the left edge of the plot.
    expect(d.startsWith(`M${plot.x} ${plot.y + plot.height}`)).toBe(true)
    expect(d.split('L')).toHaveLength(3)
    expect(d).not.toMatch(/\d\.\d{3}/)
  })

  it('returns nothing to draw for an empty series rather than a broken path', () => {
    expect(linePath([], buildScales(plotArea(BOX), 0, 1))).toBe('')
    expect(sparklinePath([])).toBe('')
    expect(sparklinePath([5])).toBe('')
  })
})

describe('xTickIndices', () => {
  const days = (n: number): SeriesPoint[] =>
    Array.from({ length: n }, (_, i) => ({ x: `${i + 1} Sep`, y: i }))

  it('labels every point when there are few of them', () => {
    expect(xTickIndices(days(4))).toEqual([0, 1, 2, 3])
  })

  it('always keeps the first and the last point', () => {
    const chosen = xTickIndices(days(31))
    expect(chosen[0]).toBe(0)
    expect(chosen[chosen.length - 1]).toBe(30)
  })

  it('never puts two labels close enough to print on top of each other', () => {
    // The bug this locks: a month start one or two points from the end printed over the last label.
    const monthCrossing: SeriesPoint[] = [
      ...Array.from({ length: 28 }, (_, i) => ({ x: `${i + 4} Aug`, y: i })),
      { x: '1 Sep', y: 28 },
      { x: '2 Sep', y: 29 },
      { x: '3 Sep', y: 30 },
    ]
    const chosen = xTickIndices(monthCrossing)
    const minGap = Math.floor(monthCrossing.length / 7)
    for (let i = 1; i < chosen.length; i++) {
      expect((chosen[i] ?? 0) - (chosen[i - 1] ?? 0)).toBeGreaterThanOrEqual(minGap)
    }
    expect(chosen).toContain(30)
  })

  it('caps a 92-point day-grain chart at the label budget', () => {
    expect(xTickIndices(days(92)).length).toBeLessThanOrEqual(6)
  })
})

describe('mixSegments', () => {
  it('keeps at most five segments and rolls the rest into Other', () => {
    const segments = mixSegments(
      [
        { label: 'Too Yumm', value: 936 },
        { label: 'Campa', value: 558 },
        { label: 'MOM', value: 216 },
        { label: 'Balaji', value: 60 },
        { label: 'Masti Oye', value: 30 },
        { label: 'Others', value: 20 },
      ],
      'Other',
    )
    expect(segments).toHaveLength(5)
    expect(segments[4]?.label).toBe('Other')
    expect(segments[4]?.value).toBe(50)
  })

  it('makes the printed percentages add up to exactly 100', () => {
    const cases = [
      [1, 1, 1],
      [7, 11, 13],
      [936, 558, 216, 60, 30],
      [1, 1, 1, 1, 1, 1, 1],
    ]
    for (const values of cases) {
      const segments = mixSegments(
        values.map((value, i) => ({ label: `s${i}`, value })),
        'Other',
      )
      expect(segments.reduce((sum, s) => sum + s.bps, 0)).toBe(10_000)
    }
  })

  it('answers zero-width segments rather than dividing by nothing', () => {
    const segments = mixSegments([{ label: 'a', value: 0 }], 'Other')
    expect(segments[0]?.bps).toBe(0)
  })
})

describe('compareBarRects', () => {
  it('draws two bars per group when a previous period is given, one when it is not', () => {
    const plot = plotArea(BOX)
    expect(compareBarRects([{ label: 'Apr', current: 10, previous: 8 }], plot, 10)).toHaveLength(2)
    expect(compareBarRects([{ label: 'Apr', current: 10 }], plot, 10)).toHaveLength(1)
  })

  it('sits every bar on the baseline and never above the plot', () => {
    const plot = plotArea(BOX)
    const rects = compareBarRects(
      [
        { label: 'Apr', current: 10, previous: 8 },
        { label: 'May', current: 0, previous: 4 },
      ],
      plot,
      10,
    )
    for (const rect of rects) {
      expect(rect.y + rect.height).toBeCloseTo(plot.y + plot.height, 5)
      expect(rect.y).toBeGreaterThanOrEqual(plot.y - 0.001)
    }
  })
})

describe('time', () => {
  it('says "just now", minutes, then hours — and nothing beyond', () => {
    const now = Date.parse('2026-09-06T10:00:00+05:30')
    expect(relativeTime(now, now, t)).toBe('just now')
    expect(relativeTime(now - 12 * 60_000, now, t)).toBe('12 min ago')
    expect(relativeTime(now - 3 * 3_600_000, now, t)).toBe('3 h ago')
  })

  it('prints a clock time in lower-case am/pm for "Offline since" and "as of"', () => {
    const morning = new Date(2026, 8, 6, 9, 40).getTime()
    const evening = new Date(2026, 8, 6, 18, 5).getTime()
    const midnight = new Date(2026, 8, 6, 0, 7).getTime()
    expect(clockTime(morning)).toBe('9:40 am')
    expect(clockTime(evening)).toBe('6:05 pm')
    expect(clockTime(midnight)).toBe('12:07 am')
  })
})

describe('ladderLabelWidth', () => {
  it('leaves the ageing ladder exactly as it was: six short rungs, 56 px', () => {
    expect(
      ladderLabelWidth([
        { label: '0-7' },
        { label: '8-15' },
        { label: '16-30' },
        { label: '31-60' },
        { label: '61-90' },
        { label: '90+' },
      ]),
    ).toBe(LADDER_LABEL_MIN)
  })

  it('grows for a ladder whose rungs are names, so a supplier does not wrap onto four lines', () => {
    const width = ladderLabelWidth([
      { label: "Alan's Food Products — Bhiwandi" },
      { label: 'MOM Foods — Bikaner' },
    ])
    expect(width).toBeGreaterThan(LADDER_LABEL_MIN)
    expect(width).toBeLessThanOrEqual(LADDER_LABEL_MAX)
  })

  it('never lets one long name eat the track', () => {
    expect(ladderLabelWidth([{ label: 'x'.repeat(200) }])).toBe(LADDER_LABEL_MAX)
  })

  it('is one width for the whole ladder, so every track starts at the same x', () => {
    const rows = [{ label: 'Campa' }, { label: 'MOM Roasted Makhana Peri Peri' }]
    expect(ladderLabelWidth(rows)).toBe(ladderLabelWidth([...rows].reverse()))
  })
})

describe('ladderValueWidth', () => {
  it('keeps the desk column exactly where it was for ordinary figures', () => {
    expect(ladderValueWidth(['1,234.00', '17,071.46'], 8)).toBe(LADDER_VALUE_MIN)
  })

  it('widens for a lakh figure at the phone’s money size, so it stops running off a 375 px screen', () => {
    // "2,81,290.00" in `moneyM`: 11 characters at ~11 px each.
    const width = ladderValueWidth(['2,81,290.00', '17,071.46'], 11)
    expect(width).toBeGreaterThan(LADDER_VALUE_MIN)
    expect(width).toBeGreaterThanOrEqual('2,81,290.00'.length * 11)
  })

  it('is one width for the whole ladder, so the figures right-align to the same edge', () => {
    const values = ['2,81,290.00', '229.12']
    expect(ladderValueWidth(values, 11)).toBe(ladderValueWidth([...values].reverse(), 11))
  })
})

describe('fitLabel', () => {
  it('leaves a label that fits alone', () => {
    expect(fitLabel('Godrej Hill', 200)).toBe('Godrej Hill')
  })

  it('cuts a label wider than its slot and marks the cut', () => {
    // The team screen's own case: six 24-character names sharing a 570 px plot.
    const cut = fitLabel('Demo Docs Staff (edited)', 570 / 6)
    expect(cut.length).toBeLessThan('Demo Docs Staff (edited)'.length)
    expect(cut.endsWith('…')).toBe(true)
  })

  it('never returns more characters than the slot holds', () => {
    const slot = 60
    const cut = fitLabel('A very long salesperson name indeed', slot)
    expect(cut.length * 7.3).toBeLessThanOrEqual(slot)
  })

  it('gives up rather than print one character and an ellipsis', () => {
    expect(fitLabel('Anything', 8)).toBe('')
  })
})
