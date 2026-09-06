/**
 * UX-00 section 6.14 for React Native, on `react-native-svg`. The geometry is the same pure code the
 * DOM renderer uses, so the two draw the identical picture from the identical numbers.
 */
import { View } from 'react-native'
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg'

import {
  axisTop,
  buildScales,
  compareBarRects,
  endDot,
  fitLabel,
  linePath,
  mixSegments,
  niceTicks,
  plotArea,
  seriesMax,
  sparklinePath,
  xTickIndices,
  type Series,
} from '../charts/geometry.js'
import { abbreviateMoney } from '../money.js'
import { useTheme } from '../theme.js'
import { chart as chartTokens, space } from '../tokens.js'
import type {
  CompareBarsProps,
  SparklineProps,
  StackedMixProps,
  TrendChartProps,
} from '../types.js'
import { Txt } from './base.js'

const PADDING = { top: 8, right: 8, bottom: 20, left: 44 }
const WIDTH = 360

function ChartFooter({
  range,
  asOf,
}: {
  range?: string | undefined
  asOf?: string | undefined
}): React.JSX.Element | null {
  const theme = useTheme()
  if (!range && !asOf) return null
  // A field app never uses text.tertiary (UX-00 3.5 rule 3).
  const color = theme.density === 'desk' ? theme.colors.text.tertiary : theme.colors.text.secondary
  return (
    <Txt field="label" desk="meta" color={color} style={{ marginTop: space[1] }}>
      {[range, asOf ? theme.t('chart.asOf', { when: asOf }) : null].filter(Boolean).join(' · ')}
    </Txt>
  )
}

function strokeFor(
  role: Series['role'],
  colors: ReturnType<typeof useTheme>['colors'],
): { stroke: string; dash?: string; width: number } {
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
  const points = series[0]?.points ?? []
  const labelColor =
    theme.density === 'desk' ? theme.colors.text.tertiary : theme.colors.text.secondary

  if (points.length < chartTokens.minPoints) {
    return (
      <View testID={testID}>
        {points.length === 0 ? (
          <Txt field="body" desk="body" color={theme.colors.text.secondary}>
            {theme.t('chart.noData')}
          </Txt>
        ) : (
          points.map((p) => (
            <View key={p.x} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
                {p.x}
              </Txt>
              <Txt field="moneyM" desk="cellMoney" numeric>
                {formatValue(p.y)}
              </Txt>
            </View>
          ))
        )}
        <ChartFooter range={range} asOf={asOf} />
      </View>
    )
  }

  const plot = plotArea({ width: WIDTH, height, ...PADDING })
  const top = axisTop(seriesMax(series))
  const scales = buildScales(plot, points.length, top)
  const ticks = niceTicks(top)
  const primary = series.find((s) => s.role === 'primary') ?? series[0]
  const dot = primary ? endDot(primary.points, scales) : null

  return (
    <View testID={testID}>
      <Svg width="100%" height={height} viewBox={`0 0 ${WIDTH} ${height}`}>
        {ticks.map((tick) => (
          <Line
            key={`g${tick}`}
            x1={plot.x}
            x2={plot.x + plot.width}
            y1={scales.y(tick)}
            y2={scales.y(tick)}
            stroke={tick === 0 ? theme.colors.chart.baseline : theme.colors.chart.grid}
            strokeWidth={chartTokens.gridWidth}
          />
        ))}
        {ticks.map((tick) => (
          <SvgText
            key={`t${tick}`}
            x={0}
            y={scales.y(tick) + 4}
            fill={labelColor}
            fontSize={chartTokens.labelSize}
          >
            {formatValue(tick)}
          </SvgText>
        ))}
        {series.map((s) => {
          const style = strokeFor(s.role, theme.colors)
          return (
            <Path
              key={s.id}
              d={linePath(s.points, scales)}
              fill="none"
              stroke={style.stroke}
              strokeWidth={style.width}
              strokeLinejoin="round"
              strokeLinecap="round"
              {...(style.dash ? { strokeDasharray: style.dash } : {})}
            />
          )
        })}
        {dot ? (
          <Circle
            cx={dot.x}
            cy={dot.y}
            r={chartTokens.endDotRadius}
            fill={theme.colors.chart.primary}
          />
        ) : null}
        {xTickIndices(points, 4).map((i) => (
          <SvgText
            key={`x${i}`}
            x={scales.x(i)}
            y={height - 4}
            fill={labelColor}
            fontSize={chartTokens.labelSize}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
          >
            {points[i]?.x ?? ''}
          </SvgText>
        ))}
      </Svg>
      {legend && series.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: space[4], marginTop: space[1] }}>
          {series.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <View
                style={{
                  width: 14,
                  height: 2,
                  backgroundColor: strokeFor(s.role, theme.colors).stroke,
                }}
              />
              <Txt field="label" desk="meta" color={labelColor}>
                {s.label}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
      <ChartFooter range={range} asOf={asOf} />
    </View>
  )
}

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
  const capped = groups.slice(0, 12)
  const plot = plotArea({ width: WIDTH, height, ...PADDING })
  const top = axisTop(Math.max(0, ...capped.flatMap((g) => [g.current, g.previous ?? 0])))
  const rects = compareBarRects(capped, plot, top)
  const ticks = niceTicks(top)
  const labelColor =
    theme.density === 'desk' ? theme.colors.text.tertiary : theme.colors.text.secondary
  const yOf = (v: number): number => plot.y + plot.height - (plot.height * v) / (top || 1)
  return (
    <View testID={testID}>
      <Svg width="100%" height={height} viewBox={`0 0 ${WIDTH} ${height}`}>
        {ticks.map((tick) => (
          <Line
            key={`g${tick}`}
            x1={plot.x}
            x2={plot.x + plot.width}
            y1={yOf(tick)}
            y2={yOf(tick)}
            stroke={tick === 0 ? theme.colors.chart.baseline : theme.colors.chart.grid}
            strokeWidth={chartTokens.gridWidth}
          />
        ))}
        {ticks.map((tick) => (
          <SvgText
            key={`t${tick}`}
            x={0}
            y={yOf(tick) + 4}
            fill={labelColor}
            fontSize={chartTokens.labelSize}
          >
            {formatValue(tick)}
          </SvgText>
        ))}
        {rects.map((r, i) => (
          <Rect
            key={`${r.group}-${r.role}-${i}`}
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            fill={r.role === 'current' ? theme.colors.chart.primary : theme.colors.chart.previous}
          />
        ))}
        {capped.map((g, i) => (
          /* Cut to the slot, same as the DOM half — see `fitLabel`. */
          <SvgText
            key={`${g.label}-${String(i)}`}
            x={plot.x + (plot.width / capped.length) * (i + 0.5)}
            y={height - 4}
            fill={labelColor}
            fontSize={chartTokens.labelSize}
            textAnchor="middle"
            accessibilityLabel={g.label}
          >
            {fitLabel(g.label, plot.width / capped.length)}
          </SvgText>
        ))}
      </Svg>
      <View style={{ flexDirection: 'row', gap: space[4], marginTop: space[1] }}>
        {(capped.some((group) => group.previous !== undefined)
          ? [
              {
                color: theme.colors.chart.primary,
                label: currentLabel ?? theme.t('chart.current'),
              },
              {
                color: theme.colors.chart.previous,
                label: previousLabel ?? theme.t('chart.previous'),
              },
            ]
          : []
        ).map((entry) => (
          <View
            key={entry.label}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}
          >
            <View style={{ width: 14, height: 2, backgroundColor: entry.color }} />
            <Txt field="label" desk="meta" color={labelColor}>
              {entry.label}
            </Txt>
          </View>
        ))}
      </View>
      <ChartFooter range={range} asOf={asOf} />
    </View>
  )
}

export function StackedMix({
  slices,
  formatValue = abbreviateMoney,
  testID,
}: StackedMixProps): React.JSX.Element {
  const theme = useTheme()
  const segments = mixSegments(slices, theme.t('chart.other'))
  return (
    <View testID={testID}>
      <View
        style={{
          flexDirection: 'row',
          height: 24,
          gap: 1,
          borderRadius: 2,
          overflow: 'hidden',
          backgroundColor: theme.colors.bg.surface,
        }}
      >
        {segments.map((seg, index) => (
          <View
            key={`${seg.label}-${String(index)}`}
            style={{
              width: `${seg.bps / 100}%`,
              backgroundColor: theme.colors.chart.mix[Math.min(seg.index, 4) as 0 | 1 | 2 | 3 | 4],
            }}
          />
        ))}
      </View>
      {/* Labels live in the key line beneath, never on a segment (UX-00 3.4). */}
      <View style={{ marginTop: space[2], gap: space[1] }}>
        {segments.map((seg, index) => (
          <View
            key={`${seg.label}-${String(index)}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor:
                  theme.colors.chart.mix[Math.min(seg.index, 4) as 0 | 1 | 2 | 3 | 4],
              }}
            />
            <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
              {seg.label}
            </Txt>
            <Txt field="moneyM" desk="cellMoney" numeric>
              {formatValue(seg.value)}
            </Txt>
            <Txt field="label" desk="meta" numeric color={theme.colors.text.secondary}>
              {`${(seg.bps / 100).toFixed(0)}%`}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  )
}

export function Sparkline({
  values,
  width = 40,
  height = 16,
  testID,
}: SparklineProps): React.JSX.Element {
  const theme = useTheme()
  const d = sparklinePath(values, width, height)
  if (!d) return <View testID={testID} style={{ width, height }} />
  return (
    <Svg
      {...(testID ? { testID } : {})}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <Path
        d={d}
        fill="none"
        stroke={theme.colors.chart.primary}
        strokeWidth={chartTokens.strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  )
}
