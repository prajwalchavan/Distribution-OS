/**
 * UX-00 sections 6.6, 6.7, 6.8 and 6.9 for React DOM: Group, ListRow, Register, KpiStrip, BarLadder,
 * AgeingBuckets and StatusChip.
 *
 * A row does ZERO derivation: ageing, totals and formatting arrive pre-computed from the service.
 */
import { useMemo, type ReactNode } from 'react'

import { formatMoney } from '../money.js'
import { useTheme } from '../theme.js'
import {
  AGEING_BUCKETS,
  AGEING_LADDER,
  chart as chartTokens,
  layout,
  radius,
  space,
  typeField,
} from '../tokens.js'
import type {
  AgeingBucketsProps,
  BarLadderProps,
  GroupProps,
  KpiStripProps,
  ListRowProps,
  RegisterProps,
  StatusChipProps,
} from '../types.js'
import { ladderFraction } from '../charts/geometry.js'
import { Eyebrow, Txt, typeStyle, useTypeStyle } from './base.js'
import { Money } from './money.js'
import { Sparkline } from './charts.js'
import { EmptyState, ErrorState, Skeleton } from './feedback.js'
import { useViewport } from './viewport.js'

// ---------------------------------------------------------------------------
// 6.9 StatusChip — information, never a tap target
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
  // Both scales are read unconditionally: a hook may never sit behind a branch.
  const wordStyle = useTypeStyle('bodyStrong', 'label')
  const figureStyle = useTypeStyle('moneyM', 'cellMoney')
  const textStyle = figure ? figureStyle : wordStyle
  return (
    <span
      data-testid={testID}
      className={figure ? 'dos-num' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height,
        padding: `0 ${space[2]}px`,
        borderRadius: radius.xs,
        background: solid ? tone.solid : tone.tint,
        color: solid ? theme.colors.text.onSolid : tone.fg,
        whiteSpace: 'nowrap',
        ...textStyle,
      }}
    >
      {icon}
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 6.6 Group and ListRow
// ---------------------------------------------------------------------------

export function Group({ title, footer, children, testID }: GroupProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <div data-testid={testID} style={{ marginBottom: space[4] }}>
      {title ? (
        <div style={{ marginBottom: space[2] }}>
          <Eyebrow>{title}</Eyebrow>
        </div>
      ) : null}
      <div
        style={{
          background: theme.colors.bg.surface,
          border: `1px solid ${theme.colors.border.faint}`,
          borderRadius: radius.md,
          overflow: 'hidden',
        }}
      >
        {children}
        {footer ? (
          <div
            style={{
              background: theme.colors.accent.tint,
              color: theme.colors.accent.fg,
              padding: `${space[2]}px ${space[4]}px`,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
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
  const rowHeight = theme.density === 'desk' ? 56 : 72
  const leadingBar =
    state === 'selected'
      ? theme.colors.accent.line
      : state === 'needsAttention'
        ? theme.colors.status.brick.edge
        : 'transparent'
  return (
    <button
      type="button"
      data-testid={testID}
      className="dos-row"
      data-pressable={onPress ? 'true' : 'false'}
      data-state={state}
      disabled={state === 'disabled' || !onPress}
      onClick={onPress}
      style={{
        minHeight: rowHeight,
        padding: `${space[3]}px ${space[4]}px`,
        borderTop: `1px solid ${theme.colors.border.faint}`,
        borderLeft: `3px solid ${leadingBar}`,
        gap: space[3],
        background: state === 'selected' ? theme.colors.accent.tint : theme.colors.bg.surface,
      }}
    >
      {leading ? (
        <span
          style={{
            width: 40,
            display: 'inline-flex',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {leading}
        </span>
      ) : null}
      <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
        <Txt field="bodyStrong" desk="body" as="div">
          {primary}
        </Txt>
        {secondary ? (
          <Txt field="label" desk="meta" as="div" color={theme.colors.text.secondary}>
            {secondary}
          </Txt>
        ) : null}
        {state === 'needsAttention' && reason ? (
          <Txt field="label" desk="meta" as="div" color={theme.colors.status.brick.fg}>
            {reason}
          </Txt>
        ) : null}
        {state === 'waiting' ? (
          <Txt field="label" desk="meta" as="div" color={theme.colors.status.ochre.fg}>
            {theme.t('connection.waiting', { count: 1 })}
          </Txt>
        ) : null}
      </span>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 4,
          flexShrink: 0,
        }}
      >
        {trailingMoney === undefined ? null : <Money value={trailingMoney} size={trailingSize} />}
        {trailing}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// 6.8 KpiStrip — columns of a register strip, never tiles
// ---------------------------------------------------------------------------

/**
 * The strip is 2-up on a PHONE VIEWPORT whatever the app's density (UX-00 §8.2: "the owner's Today is
 * the strip 2×2"). Density alone stopped being enough the day one codebase became website, Android and
 * iOS (docs/08 §0): an owner app is `desk` density and still opens on a 390 px phone, where four
 * columns put "Distributor" through a shredder.
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
  const deltaTone = {
    positive: theme.colors.status.moss.fg,
    critical: theme.colors.status.brick.fg,
    neutral: theme.density === 'desk' ? theme.colors.text.tertiary : theme.colors.text.secondary,
  }
  return (
    <div
      data-testid={testID}
      style={{
        display: 'grid',
        gridTemplateColumns: wide
          ? `repeat(${String(Math.max(1, items.length))}, minmax(0, 1fr))`
          : 'repeat(2, minmax(0, 1fr))',
        borderTop: `1px solid ${theme.colors.border.hairline}`,
        borderBottom: `1px solid ${theme.colors.border.hairline}`,
        background: theme.colors.bg.surface,
      }}
    >
      {items.map((item, i) => (
        <div
          key={`${item.label}-${String(i)}`}
          style={{
            padding: `${space[3]}px ${space[4]}px`,
            borderLeft: (wide ? i === 0 : i % 2 === 0)
              ? undefined
              : `1px solid ${theme.colors.border.faint}`,
            borderTop: !wide && i > 1 ? `1px solid ${theme.colors.border.faint}` : undefined,
            minWidth: 0,
          }}
        >
          <Eyebrow>{item.label}</Eyebrow>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: space[2] }}>
            {kpiValue(item.value)}
            {item.spark ? <Sparkline values={item.spark} /> : null}
          </div>
          {item.delta ? (
            <Txt
              field="moneyM"
              desk="meta"
              as="div"
              numeric
              color={deltaTone[item.tone ?? 'neutral']}
            >
              {item.delta}
            </Txt>
          ) : null}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 6.8 BarLadder — one row per rung, every rung carries its number even at zero
// ---------------------------------------------------------------------------

export function BarLadder({ rows, title, formatValue, testID }: BarLadderProps): React.JSX.Element {
  const theme = useTheme()
  const max = Math.max(0, ...rows.map((r) => r.value))
  const format = formatValue ?? ((v: number) => formatMoney(v, { symbol: false }))
  return (
    <div data-testid={testID}>
      {title ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: space[2],
          }}
        >
          <Txt field="title" desk="section" as="div">
            {title}
          </Txt>
          {/* `₹` is stated once, in the panel title (UX-00 4.5 rule 5). */}
          <Txt field="label" desk="label" color={theme.colors.text.secondary}>
            {theme.t('money.rupeeSymbol')}
          </Txt>
        </div>
      ) : null}
      {rows.map((row, index) => {
        const tone = theme.colors.status[row.family]
        return (
          <div
            key={`${row.label}-${String(index)}`}
            style={{ display: 'flex', alignItems: 'center', gap: space[3], marginBottom: 6 }}
          >
            <span style={{ width: 56, flexShrink: 0 }}>
              <Txt
                field="label"
                desk="meta"
                color={
                  theme.density === 'desk'
                    ? theme.colors.text.tertiary
                    : theme.colors.text.secondary
                }
              >
                {row.label}
              </Txt>
            </span>
            <span
              style={{
                flex: 1,
                height: chartTokens.ladderTrackHeight,
                background: row.solid ? theme.colors.bg.sunken : tone.tint,
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  display: 'block',
                  height: '100%',
                  width: `${ladderFraction(row.value, max) * 100}%`,
                  background: row.solid ? tone.solid : tone.edge,
                }}
              />
            </span>
            <span
              className="dos-num"
              style={{
                width: 96,
                textAlign: 'right',
                flexShrink: 0,
                fontWeight: 600,
                ...(theme.density === 'desk' ? {} : typeStyle(typeField.moneyM)),
              }}
            >
              {format(row.value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** `<BarLadder>` with the six ageing rungs of docs/22 section 6, in order, always all six. */
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
// 6.7 Register — one props contract, two renderings
// ---------------------------------------------------------------------------

export function Register<Row>({
  columns,
  rows,
  rowKey,
  frozen,
  totals,
  onSelect,
  selectedKey,
  state = 'ready',
  filters,
  onClearFilters,
  asOf,
  errorMessage,
  emptyMessage,
  testID,
}: RegisterProps<Row>): React.JSX.Element {
  const theme = useTheme()
  const headStyle = useTypeStyle('label', 'label')
  const cellStyle = useTypeStyle('body', 'cell')
  const isDesk = theme.density === 'desk'

  const filterRow = useMemo(
    () =>
      filters && filters.length > 0 ? (
        <div
          style={{
            display: 'flex',
            gap: space[2],
            alignItems: 'center',
            marginBottom: space[2],
            flexWrap: 'wrap',
          }}
        >
          {filters.map((f) => (
            <StatusChip key={f.id} label={f.label} family="neutral" />
          ))}
          <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
            {theme.t('register.filters', { count: filters.length })}
          </Txt>
          {onClearFilters ? (
            <button
              type="button"
              onClick={onClearFilters}
              style={{
                border: 0,
                background: 'transparent',
                color: theme.colors.accent.fg,
                cursor: 'pointer',
                fontFamily: 'inherit',
                minHeight: 24,
              }}
            >
              {theme.t('register.clearFilters')}
            </button>
          ) : null}
        </div>
      ) : null,
    [filters, onClearFilters, theme],
  )

  if (state === 'loading') {
    return (
      <div data-testid={testID}>
        {filterRow}
        <Skeleton rows={8} rowHeight={isDesk ? layout.deskRowHeight : 72} />
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div data-testid={testID}>
        <ErrorState message={errorMessage ?? theme.t('state.error')} />
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div data-testid={testID}>
        {filterRow}
        <EmptyState message={emptyMessage ?? theme.t('register.empty')} />
      </div>
    )
  }

  const asOfLine =
    state === 'partial' && asOf ? (
      <div style={{ marginBottom: space[2] }}>
        <StatusChip label={theme.t('register.asOf', { when: asOf })} family="ochre" />
      </div>
    ) : null

  // Phone rendering: grouped rows in column-priority order. The <table> never appears in a field app.
  if (!isDesk) {
    const identity = columns.find((c) => c.priority === 'identity') ?? columns[0]
    const value = columns.find((c) => c.priority === 'value')
    const chipCol = columns.find((c) => c.priority === 'chip')
    return (
      <div data-testid={testID}>
        {filterRow}
        {asOfLine}
        <Group>
          {rows.map((row) => {
            const key = rowKey(row)
            return (
              <ListRow
                key={key}
                primary={identity?.cell(row) ?? ''}
                {...(value ? { trailing: value.cell(row) } : {})}
                {...(chipCol ? { secondary: chipCol.cell(row) } : {})}
                {...(onSelect
                  ? {
                      onPress: () => {
                        onSelect(row)
                      },
                    }
                  : {})}
                state={selectedKey === key ? 'selected' : 'default'}
              />
            )
          })}
        </Group>
      </div>
    )
  }

  return (
    <div data-testid={testID}>
      {filterRow}
      {asOfLine}
      <div style={{ overflowX: 'auto', background: theme.colors.bg.surface }}>
        <table className="dos-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{
                    height: layout.deskRowHeight,
                    textAlign: col.align ?? 'left',
                    color: theme.colors.text.secondary,
                    borderBottom: `1px solid ${theme.colors.border.hairline}`,
                    width: col.width,
                    ...headStyle,
                  }}
                >
                  {col.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = rowKey(row)
              return (
                <tr
                  key={key}
                  aria-selected={selectedKey === key}
                  tabIndex={0}
                  onClick={() => onSelect?.(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelect?.(row)
                  }}
                  style={{ cursor: onSelect ? 'pointer' : 'default' }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={col.align === 'right' ? 'dos-num' : undefined}
                      style={{
                        height: layout.deskRowHeight,
                        textAlign: col.align ?? 'left',
                        borderBottom: `1px solid ${theme.colors.border.faint}`,
                        borderRight:
                          col.key === frozen
                            ? `1px solid ${theme.colors.border.strong}`
                            : undefined,
                        whiteSpace: 'nowrap',
                        ...cellStyle,
                      }}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {totals ? (
            <tfoot>
              <tr>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.align === 'right' ? 'dos-num' : undefined}
                    style={{
                      height: layout.deskRowHeight,
                      textAlign: col.align ?? 'left',
                      borderTop: `1px solid ${theme.colors.border.hairline}`,
                      fontWeight: 600,
                      ...cellStyle,
                    }}
                  >
                    {totals[col.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  )
}
