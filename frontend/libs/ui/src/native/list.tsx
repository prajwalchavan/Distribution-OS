/**
 * UX-00 sections 6.6, 6.7, 6.8 and 6.9 for React Native.
 *
 * `<Register>` here is always the PHONE rendering — grouped `<ListRow>`s in column-priority order.
 * The `<table>` rendering never appears in a field app (UX-00 section 6.7).
 */
import type { ReactNode } from 'react'
import { FlatList, Pressable, View } from 'react-native'

import { ladderFraction } from '../charts/geometry.js'
import { formatMoney } from '../money.js'
import { useTheme } from '../theme.js'
import { AGEING_BUCKETS, AGEING_LADDER, chart as chartTokens, radius, space } from '../tokens.js'
import type {
  AgeingBucketsProps,
  BarLadderProps,
  GroupProps,
  KpiStripProps,
  ListRowProps,
  RegisterProps,
  StatusChipProps,
} from '../types.js'
import { Eyebrow, Txt } from './base.js'
import { Sparkline } from './charts.js'
import { EmptyState, ErrorState, Skeleton } from './feedback.js'
import { useViewport } from './viewport.js'
import { Money } from './money.js'

// ---------------------------------------------------------------------------
// 6.9 StatusChip
// ---------------------------------------------------------------------------

export function StatusChip({
  label,
  family,
  solid = false,
  icon,
  figure = false,
  testID,
}: StatusChipProps): React.JSX.Element {
  const theme = useTheme()
  const tone = theme.colors.status[family]
  const warehouse = theme.touch === 'floor'
  const height = figure ? (warehouse ? 32 : 28) : warehouse ? 28 : 24
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height,
        alignSelf: 'flex-start',
        paddingHorizontal: space[2],
        borderRadius: radius.xs,
        backgroundColor: solid ? tone.solid : tone.tint,
      }}
    >
      {icon}
      <Txt
        field={figure ? 'moneyM' : 'bodyStrong'}
        desk={figure ? 'cellMoney' : 'label'}
        numeric={figure}
        color={solid ? theme.colors.text.onSolid : tone.fg}
      >
        {label}
      </Txt>
    </View>
  )
}

// ---------------------------------------------------------------------------
// 6.6 Group and ListRow
// ---------------------------------------------------------------------------

export function Group({ title, footer, children, testID }: GroupProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <View testID={testID} style={{ marginBottom: space[4] }}>
      {title ? (
        <View style={{ marginBottom: space[2] }}>
          <Eyebrow>{title}</Eyebrow>
        </View>
      ) : null}
      <View
        style={{
          backgroundColor: theme.colors.bg.surface,
          borderWidth: 1,
          borderColor: theme.colors.border.faint,
          borderRadius: radius.md,
          overflow: 'hidden',
        }}
      >
        {children}
        {footer ? (
          <View
            style={{
              backgroundColor: theme.colors.accent.tint,
              paddingHorizontal: space[4],
              paddingVertical: space[2],
            }}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </View>
  )
}

export function ListRow({
  leading,
  primary,
  secondary,
  trailingMoney,
  trailingSize = 'moneyM',
  trailing,
  state = 'default',
  reason,
  onPress,
  testID,
}: ListRowProps): React.JSX.Element {
  const theme = useTheme()
  // The whole row is the tap target: 72 dp is above every floor in UX-00 5.2.
  const rowHeight = 72
  const leadingBar =
    state === 'selected'
      ? theme.colors.accent.line
      : state === 'needsAttention'
        ? theme.colors.status.brick.edge
        : 'transparent'
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : 'text'}
      disabled={state === 'disabled' || !onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: rowHeight,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        borderTopWidth: 1,
        borderTopColor: theme.colors.border.faint,
        borderLeftWidth: 3,
        borderLeftColor: leadingBar,
        backgroundColor:
          state === 'selected'
            ? theme.colors.accent.tint
            : pressed
              ? theme.colors.bg.raised
              : theme.colors.bg.surface,
      })}
    >
      {leading ? <View style={{ width: 40, alignItems: 'center' }}>{leading}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt field="bodyStrong" desk="body" numberOfLines={2}>
          {primary}
        </Txt>
        {secondary ? (
          <Txt field="label" desk="meta" color={theme.colors.text.secondary} numberOfLines={1}>
            {secondary}
          </Txt>
        ) : null}
        {state === 'needsAttention' && reason ? (
          <Txt field="label" desk="meta" color={theme.colors.status.brick.fg}>
            {reason}
          </Txt>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        {trailingMoney === undefined ? null : <Money value={trailingMoney} size={trailingSize} />}
        {trailing}
      </View>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// 6.8 KpiStrip and BarLadder
// ---------------------------------------------------------------------------

/**
 * 2-up on a phone viewport, one column per item on a desk one — the same rule as the web renderer's,
 * so a tablet in landscape reads like the browser and a phone reads like UX-00 §8.2's 2×2.
 */

/**
 * A KPI value is `ReactNode` because most of them are a `<Money>`; a count or a word is a plain
 * string, and on React Native a bare string inside a `<View>` throws "Text strings must be rendered
 * within a <Text> component". Wrapping it here is what makes `value` mean the same thing on a
 * browser and on a phone — found by running the universal template on the iOS simulator, 2026-09-06.
 */
function kpiValue(value: ReactNode): ReactNode {
  if (typeof value === 'string' || typeof value === 'number') {
    return (
      <Txt field="moneyM" desk="kpi" numeric>
        {value}
      </Txt>
    )
  }
  return value
}

export function KpiStrip({ items, testID }: KpiStripProps): React.JSX.Element {
  const theme = useTheme()
  const viewport = useViewport()
  const wide = theme.density === 'desk' && viewport.kind === 'desk'
  // RN types a percentage as the literal `${number}%`, so the division is named rather than inlined.
  const columnWidth: `${number}%` = wide ? `${100 / Math.max(1, items.length)}%` : '50%'
  const deltaTone = {
    positive: theme.colors.status.moss.fg,
    critical: theme.colors.status.brick.fg,
    neutral: theme.density === 'desk' ? theme.colors.text.tertiary : theme.colors.text.secondary,
  }
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        backgroundColor: theme.colors.bg.surface,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: theme.colors.border.hairline,
      }}
    >
      {items.map((item, i) => (
        <View
          key={item.label}
          style={{
            width: columnWidth,
            padding: space[3],
            borderLeftWidth: (wide ? i === 0 : i % 2 === 0) ? 0 : 1,
            borderLeftColor: theme.colors.border.faint,
            borderTopWidth: !wide && i > 1 ? 1 : 0,
            borderTopColor: theme.colors.border.faint,
          }}
        >
          <Eyebrow>{item.label}</Eyebrow>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            {kpiValue(item.value)}
            {item.spark ? <Sparkline values={item.spark} /> : null}
          </View>
          {item.delta ? (
            <Txt field="moneyM" desk="meta" numeric color={deltaTone[item.tone ?? 'neutral']}>
              {item.delta}
            </Txt>
          ) : null}
        </View>
      ))}
    </View>
  )
}

export function BarLadder({ rows, title, formatValue, testID }: BarLadderProps): React.JSX.Element {
  const theme = useTheme()
  const max = Math.max(0, ...rows.map((r) => r.value))
  const format = formatValue ?? ((v: number) => formatMoney(v, { symbol: false }))
  return (
    <View testID={testID}>
      {title ? (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: space[2],
          }}
        >
          <Txt field="title" desk="section">
            {title}
          </Txt>
          <Txt field="label" desk="label" color={theme.colors.text.secondary}>
            {theme.t('money.rupeeSymbol')}
          </Txt>
        </View>
      ) : null}
      {rows.map((row) => {
        const tone = theme.colors.status[row.family]
        return (
          <View
            key={row.label}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: 6 }}
          >
            <View style={{ width: 56 }}>
              <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
                {row.label}
              </Txt>
            </View>
            <View
              style={{
                flex: 1,
                height: chartTokens.ladderTrackHeight,
                backgroundColor: row.solid ? theme.colors.bg.sunken : tone.tint,
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  height: '100%',
                  width: `${ladderFraction(row.value, max) * 100}%`,
                  backgroundColor: row.solid ? tone.solid : tone.edge,
                }}
              />
            </View>
            {/* Every rung carries its number even at zero. */}
            <Txt field="moneyM" desk="cellMoney" numeric style={{ width: 104, textAlign: 'right' }}>
              {format(row.value)}
            </Txt>
          </View>
        )
      })}
    </View>
  )
}

export function AgeingBuckets({ buckets, title, testID }: AgeingBucketsProps): React.JSX.Element {
  const theme = useTheme()
  const rows = AGEING_BUCKETS.map((bucket) => {
    const rung = AGEING_LADDER[bucket]
    return {
      label: theme.t(`ageing.${bucket}`),
      value: buckets[bucket],
      family: rung.family,
      solid: rung.solid,
    }
  })
  return <BarLadder rows={rows} title={title ?? theme.t('ageing.title')} testID={testID} />
}

// ---------------------------------------------------------------------------
// 6.7 Register — the phone rendering of the one props contract
// ---------------------------------------------------------------------------

export function Register<Row>({
  columns,
  rows,
  rowKey,
  onSelect,
  selectedKey,
  state = 'ready',
  filters,
  asOf,
  errorMessage,
  emptyMessage,
  testID,
}: RegisterProps<Row>): React.JSX.Element {
  const theme = useTheme()
  if (state === 'loading') return <Skeleton rows={6} rowHeight={72} testID={testID} />
  if (state === 'error') {
    return <ErrorState message={errorMessage ?? theme.t('state.error')} testID={testID} />
  }
  if (rows.length === 0) {
    return <EmptyState message={emptyMessage ?? theme.t('register.empty')} testID={testID} />
  }
  const identity = columns.find((c) => c.priority === 'identity') ?? columns[0]
  const value = columns.find((c) => c.priority === 'value')
  const chipCol = columns.find((c) => c.priority === 'chip')
  return (
    <View testID={testID}>
      {filters && filters.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: space[2], marginBottom: space[2] }}>
          {filters.map((f) => (
            <StatusChip key={f.id} label={f.label} family="neutral" />
          ))}
        </View>
      ) : null}
      {state === 'partial' && asOf ? (
        <View style={{ marginBottom: space[2] }}>
          <StatusChip label={theme.t('register.asOf', { when: asOf })} family="ochre" />
        </View>
      ) : null}
      <Group>
        <FlatList
          data={rows}
          keyExtractor={rowKey}
          scrollEnabled={false}
          renderItem={({ item }) => {
            const key = rowKey(item)
            return (
              <ListRow
                primary={identity?.cell(item) ?? ''}
                {...(value ? { trailing: value.cell(item) } : {})}
                {...(chipCol ? { secondary: chipCol.cell(item) } : {})}
                {...(onSelect
                  ? {
                      onPress: () => {
                        onSelect(item)
                      },
                    }
                  : {})}
                state={selectedKey === key ? 'selected' : 'default'}
              />
            )
          }}
        />
      </Group>
    </View>
  )
}
