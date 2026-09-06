/**
 * UX-00 section 6.14 — the whole chart vocabulary, drawn as inline SVG. No chart library (UX-00
 * section 13 bans one and lint enforces it in a screen); the geometry is the shared pure code in
 * `../charts/geometry.ts`, so the React Native renderer draws the identical picture.
 *
 * Rules on every chart here: money axes start at zero, at most five ticks, gridlines are horizontal
 * hairlines, no area fill, no gradient, no shadow, and each chart prints its own range and "as of".
 */
import { abbreviateMoney } from '../money.js'
import { useTheme } from '../theme.js'
import { chart as chartTokens, space } from '../tokens.js'
import type {
  CompareBarsProps,
  SparklineProps,
  StackedMixProps,
  TrendChartProps,
} from '../types.js'
import {
  axisTop,
  buildScales,
  compareBarRects,
  endDot,
  linePath,
  mixSegments,
  niceTicks,
  plotArea,
  seriesMax,
  sparklinePath,
  xTickIndices,
  type Series,
} from '../charts/geometry.js'
import { Txt } from './base.js'

const PADDING = { top: 8, right: 8, bottom: 20, left: 44 }

function useSeriesColor(): (role: Series['role']) => {
  stroke: string
  dash?: string
  width: number
} {
  const { colors } = useTheme()
  return (role) => {
    switch (role) {
      case 'secondary':
        return { stroke: colors.chart.secondary, dash: chartTokens.dash.secondary, width: 2 }
      case 'previous':
        return { stroke: colors.chart.previous, dash: chartTokens.dash.previous, width: 2 }
      case 'target':
        return { stroke: colors.chart.target, dash: chartTokens.dash.target, width: 1 }
      default:
        return { stroke: colors.chart.primary, width: chartTokens.strokeWidth }
    }
  }
}

function ChartFooter({ range, asOf }: { range?: string; asOf?: string }): React.JSX.Element | null {
  const theme = useTheme()
  if (!range && !asOf) return null
  const color = theme.density === 'desk' ? theme.colors.text.tertiary : theme.colors.text.secondary
  return (
    <Txt field="label" desk="meta" as="div" color={color} style={{ marginTop: space[1] }}>
      {[range, asOf ? theme.t('chart.asOf', { when: asOf }) : null].filter(Boolean).join(' · ')}
    </Txt>
  )
}

// ---------------------------------------------------------------------------
// TrendChart
// ---------------------------------------------------------------------------

export function TrendChart({
  series,
  height = 160,
  range,
  asOf,
  formatValue = abbreviateMoney,
  legend,
  testID,
}: TrendChartProps): React.JSX.Element {
  const theme = useTheme()
  const colorFor = useSeriesColor()
  const width = 640
  const points = series[0]?.points ?? []

  // Fewer than three points is a labelled value list, not a line (UX-00 6.14).
  if (points.length < chartTokens.minPoints) {
    return (
      <div data-testid={testID}>
        {points.length === 0 ? (
          <Txt field="body" desk="body" color={theme.colors.text.secondary}>
            {theme.t('chart.noData')}
          </Txt>
        ) : (
          points.map((p) => (
            <div key={p.x} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
                {p.x}
              </Txt>
              <Txt field="moneyM" desk="cellMoney" numeric>
                {formatValue(p.y)}
              </Txt>
            </div>
          ))
        )}
        <ChartFooter {...(range ? { range } : {})} {...(asOf ? { asOf } : {})} />
      </div>
    )
  }

  const box = { width, height, ...PADDING }
  const plot = plotArea(box)
  const top = axisTop(seriesMax(series))
  const scales = buildScales(plot, points.length, top)
  const ticks = niceTicks(top)
  const primary = series.find((s) => s.role === 'primary') ?? series[0]
  const dot = primary ? endDot(primary.points, scales) : null
  const labelColor =
    theme.density === 'desk' ? theme.colors.text.tertiary : theme.colors.text.secondary

  return (
    <div data-testid={testID}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={series.map((s) => s.label).join(', ')}
        preserveAspectRatio="none"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={plot.x}
              x2={plot.x + plot.width}
              y1={scales.y(tick)}
              y2={scales.y(tick)}
              stroke={tick === 0 ? theme.colors.chart.baseline : theme.colors.chart.grid}
              strokeWidth={chartTokens.gridWidth}
            />
            <text x={0} y={scales.y(tick) + 4} fill={labelColor} fontSize={12} fontFamily="inherit">
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const style = colorFor(s.role)
          return (
            <path
              key={s.id}
              d={linePath(s.points, scales)}
              fill="none"
              stroke={style.stroke}
              strokeWidth={style.width}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={style.dash}
            />
          )
        })}
        {dot ? (
          <circle
            cx={dot.x}
            cy={dot.y}
            r={chartTokens.endDotRadius}
            fill={theme.colors.chart.primary}
          />
        ) : null}
        {xTickIndices(points).map((i) => (
          <text
            key={i}
            x={scales.x(i)}
            y={height - 4}
            fill={labelColor}
            fontSize={12}
            fontFamily="inherit"
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
          >
            {points[i]?.x}
          </text>
        ))}
      </svg>
      {legend && series.length > 1 ? (
        <div style={{ display: 'flex', gap: space[4], marginTop: space[1] }}>
          {series.map((s) => {
            const style = colorFor(s.role)
            return (
              <span
                key={s.id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: space[2] }}
              >
                <svg width={14} height={2} aria-hidden>
                  <line
                    x1={0}
                    y1={1}
                    x2={14}
                    y2={1}
                    stroke={style.stroke}
                    strokeWidth={2}
                    strokeDasharray={style.dash}
                  />
                </svg>
                <Txt field="label" desk="meta" color={labelColor}>
                  {s.label}
                </Txt>
              </span>
            )
          })}
        </div>
      ) : null}
      <ChartFooter {...(range ? { range } : {})} {...(asOf ? { asOf } : {})} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// CompareBars
// ---------------------------------------------------------------------------

export function CompareBars({
  groups,
  height = 160,
  range,
  asOf,
  formatValue = abbreviateMoney,
  currentLabel,
  previousLabel,
  testID,
}: CompareBarsProps): React.JSX.Element {
  const theme = useTheme()
  const width = 640
  const capped = groups.slice(0, 12)
  const box = { width, height, ...PADDING }
  const plot = plotArea(box)
  const top = axisTop(Math.max(0, ...capped.flatMap((g) => [g.current, g.previous ?? 0])))
  const rects = compareBarRects(capped, plot, top)
  const ticks = niceTicks(top)
  const labelColor =
    theme.density === 'desk' ? theme.colors.text.tertiary : theme.colors.text.secondary
  return (
    <div data-testid={testID}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={plot.x}
              x2={plot.x + plot.width}
              y1={plot.y + plot.height - (plot.height * tick) / (top || 1)}
              y2={plot.y + plot.height - (plot.height * tick) / (top || 1)}
              stroke={tick === 0 ? theme.colors.chart.baseline : theme.colors.chart.grid}
              strokeWidth={chartTokens.gridWidth}
            />
            <text
              x={0}
              y={plot.y + plot.height - (plot.height * tick) / (top || 1) + 4}
              fill={labelColor}
              fontSize={12}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {rects.map((r, i) => (
          <rect
            key={`${r.group}-${r.role}-${i}`}
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            fill={r.role === 'current' ? theme.colors.chart.primary : theme.colors.chart.previous}
          />
        ))}
        {capped.map((g, i) => (
          <text
            key={`${g.label}-${String(i)}`}
            x={plot.x + (plot.width / capped.length) * (i + 0.5)}
            y={height - 4}
            fill={labelColor}
            fontSize={12}
            textAnchor="middle"
          >
            {g.label}
          </text>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: space[4], marginTop: space[1] }}>
        <LegendSwatch
          color={theme.colors.chart.primary}
          label={currentLabel ?? theme.t('chart.current')}
        />
        <LegendSwatch
          color={theme.colors.chart.previous}
          label={previousLabel ?? theme.t('chart.previous')}
        />
      </div>
      <ChartFooter {...(range ? { range } : {})} {...(asOf ? { asOf } : {})} />
    </div>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }): React.JSX.Element {
  const theme = useTheme()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[2] }}>
      <span aria-hidden style={{ width: 14, height: 2, background: color }} />
      <Txt
        field="label"
        desk="meta"
        color={theme.density === 'desk' ? theme.colors.text.tertiary : theme.colors.text.secondary}
      >
        {label}
      </Txt>
    </span>
  )
}

// ---------------------------------------------------------------------------
// StackedMix — one 100% bar, labels in the key line beneath, never on a segment
// ---------------------------------------------------------------------------

export function StackedMix({
  slices,
  formatValue = abbreviateMoney,
  testID,
}: StackedMixProps): React.JSX.Element {
  const theme = useTheme()
  const segments = mixSegments(slices, theme.t('chart.other'))
  return (
    <div data-testid={testID}>
      <div
        style={{
          display: 'flex',
          height: 24,
          gap: 1,
          background: theme.colors.bg.surface,
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {segments.map((seg, index) => (
          <div
            key={`${seg.label}-${String(index)}`}
            title={seg.label}
            style={{
              width: `${seg.bps / 100}%`,
              background: theme.colors.chart.mix[Math.min(seg.index, 4) as 0 | 1 | 2 | 3 | 4],
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: space[3],
          marginTop: space[2],
        }}
      >
        {segments.map((seg, index) => (
          <span
            key={`${seg.label}-${String(index)}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: space[2] }}
          >
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                background: theme.colors.chart.mix[Math.min(seg.index, 4) as 0 | 1 | 2 | 3 | 4],
                borderRadius: 2,
              }}
            />
            <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
              {seg.label}
            </Txt>
            <Txt field="moneyM" desk="cellMoney" numeric>
              {formatValue(seg.value)}
            </Txt>
            <Txt field="label" desk="meta" numeric color={theme.colors.text.secondary}>
              {(seg.bps / 100).toFixed(0)}%
            </Txt>
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sparkline — 40x16, one stroke, no axes
// ---------------------------------------------------------------------------

export function Sparkline({
  values,
  width = 40,
  height = 16,
  testID,
}: SparklineProps): React.JSX.Element {
  const theme = useTheme()
  const d = sparklinePath(values, width, height)
  if (!d) return <span data-testid={testID} style={{ width, height, display: 'inline-block' }} />
  return (
    <svg
      data-testid={testID}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path
        d={d}
        fill="none"
        stroke={theme.colors.chart.primary}
        strokeWidth={chartTokens.strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
