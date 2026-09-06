/**
 * M21 — team performance (docs/23 §2.1, §2.2).
 *
 * Three questions a manager asks about the field, and the register that answers each:
 *   who is working — visits, strike rate and order value per rep per beat (`repProductivity`);
 *   who is winning — the target leaderboard, ranked by achievement (`incentives.progress.team`);
 *   who we are losing — shops going quiet, by risk (`reporting.retailers.lapsed`).
 *
 * The strike-rate bars are `<CompareBars>` on a RATIO axis, drawn as percentages: mixing a ratio and
 * a rupee figure on one axis is the defect the owner slice's own gate found and it is not repeated
 * here.
 *
 * Targets themselves are the OWNER's to set (`incentives.targets.upsert` is owner-only), so this
 * screen reads the leaderboard and never offers a way to change a target.
 */
import type { LapsedRetailer, RepProductivityRow } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  CompareBars,
  Money,
  Register,
  Screen,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Columns,
  Half,
  PageTabs,
  Panel,
  RangeSegments,
  moneyColumn,
  textColumn,
  useCan,
} from '../../src/lib/ui'
import { rangeOf, shortDate, shortInstant, type RangeId } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

type Metric = 'value' | 'outlets' | 'collections'

export default function Team(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const can = useCan()

  const [range, setRange] = useState<RangeId>('d30')
  const [metric, setMetric] = useState<Metric>('value')
  const span = rangeOf(range)

  const productivity = useQuery(['registers', 'repProductivity', span.from, span.to], () =>
    api.api.reporting.registers.repProductivity({ from: span.from, to: span.to, limit: 100 }),
  )
  const leaderboard = useQuery(
    ['incentives', 'team', metric],
    () => api.api.incentives.progress.team({ metric, limit: 20 }),
    { enabled: can('incentives.progress.team') },
  )
  const lapsed = useQuery(
    ['reporting', 'lapsed'],
    () => api.api.reporting.retailers.lapsed({ limit: 50 }),
    { enabled: can('reporting.retailers.lapsed') },
  )

  const repRows = productivity.data?.items ?? []

  const repColumns: readonly RegisterColumn<RepProductivityRow>[] = [
    textColumn('rep', t('m21.rep'), (row) => row.userName, { priority: 'identity' }),
    textColumn('beat', t('m21.beat'), (row) => row.beatName),
    textColumn('visits', t('m21.visits'), (row) => row.visits, { align: 'right' }),
    textColumn('orders', t('m21.orders'), (row) => row.ordersCount, { align: 'right' }),
    {
      key: 'strike',
      head: t('m21.strikeRate'),
      align: 'right',
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numeric>
          {`${String(Math.round(row.strikeRate * 100))}%`}
        </Txt>
      ),
    },
    moneyColumn('value', t('m21.value'), (row) => row.orderValuePaise),
    moneyColumn('collected', t('m12.collected'), (row) => row.collectedPaise),
  ]

  const lapsedColumns: readonly RegisterColumn<LapsedRetailer>[] = [
    textColumn('shop', t('m12.shop'), (row) => row.retailerName, { priority: 'identity' }),
    textColumn('beat', t('m21.beat'), (row) => row.beatName),
    textColumn('last', t('m21.lastOrder'), (row) => shortInstant(row.lastOrderAt)),
    textColumn('orders', t('m21.orders'), (row) => row.ordersLast30, { align: 'right' }),
    {
      /*
       * `lapsedRisk` is ALREADY a percentage: "0 (ordered this week) … 100 (never ordered, never
       * visited)". Treating it as a 0–1 ratio printed up to 10000% and put every shop in the red
       * band, because every value above 0 is above a 0.6 threshold.
       */
      key: 'risk',
      head: t('m21.risk'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={`${String(row.lapsedRisk)}%`}
          family={row.lapsedRisk > 60 ? 'brick' : row.lapsedRisk > 30 ? 'ochre' : 'neutral'}
          figure
        />
      ),
    },
  ]

  /*
   * Strike rate IS a 0–1 ratio (`RatioSchema`), unlike `achievedPct` below. It gets its own chart on
   * a 0–100 axis rather than sharing one with a rupee series, and `formatValue` prints the percent
   * sign so the axis never reads as money.
   */
  const strikeGroups = repRows.slice(0, 12).map((row) => ({
    key: row.userId + (row.beatId ?? ''),
    label: row.userName,
    current: Math.round(row.strikeRate * 100),
  }))

  /*
   * `achievedPct` is BASIS POINTS despite its name (`incentives.ts`: "100% = 10000 … a rep at 140%
   * reads 14000"). Multiplying it by 100 like a ratio drew an axis reading 0% · 100000% · 200000%
   * · 300000% — the same unit mistake the owner slice's gate found on the schemes register, one
   * table over. A rate in this product is bps, and `formatBps` is the one place that knows it.
   */
  const first = leaderboard.data?.items[0]
  const period = first === undefined ? undefined : { from: first.periodFrom, to: first.periodTo }

  const targetGroups = (leaderboard.data?.items ?? []).slice(0, 12).map((row) => ({
    key: row.targetId,
    label: row.userName,
    current: Math.round(row.achievedPct / 100),
  }))

  return (
    <Screen
      title={t('m21.title')}
      chips={<PageTabs group="/registers" active="/registers/team" />}
      actions={
        <RangeSegments
          value={range}
          onChange={(id) => {
            setRange(id as RangeId)
          }}
        />
      }
    >
      <Stack gap={6}>
        <Columns>
          <Half>
            <Panel title={t('m21.strikeChart')} testID="team-strike">
              <Async state={[productivity]} rows={4} empty={strikeGroups.length === 0}>
                <CompareBars
                  groups={strikeGroups}
                  height={200}
                  formatValue={(value) => `${String(value)}%`}
                  /* Not the ISO dates: this caption read "2026-08-08 — 2026-09-06" on a screen
                     where every other date is written "8 Aug". */
                  range={t('app.range', {
                    from: shortDate(span.from),
                    to: shortDate(span.to),
                  })}
                />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel
              title={t('m21.leaderboard')}
              actions={
                <Segments
                  testID="team-metric"
                  value={metric}
                  onChange={(id) => {
                    setMetric(id as Metric)
                  }}
                  items={[
                    { id: 'value', label: word('value') },
                    { id: 'outlets', label: word('outlets') },
                    { id: 'collections', label: word('collections') },
                  ]}
                />
              }
              testID="team-targets"
            >
              <Async
                state={[leaderboard]}
                rows={4}
                empty={targetGroups.length === 0}
                emptyMessage={t('m21.empty')}
              >
                <CompareBars
                  groups={targetGroups}
                  height={200}
                  formatValue={(value) => `${String(value)}%`}
                  /*
                   * The leaderboard is a TARGET PERIOD, not the 7/30/90-day window the control at
                   * the top of the screen sets — `incentives.progress.team` answers whatever period
                   * each target was set for. Without saying so, the panel sat under that control
                   * and looked as though it obeyed it. `%` here is achievement against the target.
                   */
                  range={
                    period === undefined
                      ? t('m21.ofTarget')
                      : `${t('m21.ofTarget')} · ${t('app.range', {
                          from: shortDate(period.from),
                          to: shortDate(period.to),
                        })}`
                  }
                />
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Panel title={t('m21.title')} testID="team-productivity">
          <Async
            state={[productivity]}
            rows={8}
            empty={repRows.length === 0}
            emptyMessage={t('m21.empty')}
          >
            <Register
              testID="productivity-register"
              columns={repColumns}
              rows={repRows}
              rowKey={(row) => row.userId + (row.beatId ?? '')}
              frozen="rep"
              state="ready"
              totals={{
                rep: t('app.rows', { count: repRows.length }),
                visits: String(productivity.data?.totals.visits ?? 0),
                orders: String(productivity.data?.totals.ordersCount ?? 0),
                value: (
                  <Money
                    value={productivity.data?.totals.orderValuePaise ?? 0}
                    size="cell"
                    symbol={false}
                  />
                ),
              }}
            />
          </Async>
        </Panel>

        {can('reporting.retailers.lapsed') ? (
          <Panel title={t('m21.lapsed')} testID="team-lapsed">
            <Async
              state={[lapsed]}
              rows={6}
              empty={(lapsed.data?.items.length ?? 0) === 0}
              emptyMessage={t('m21.empty')}
            >
              <Register
                testID="lapsed-register"
                columns={lapsedColumns}
                rows={lapsed.data?.items ?? []}
                rowKey={(row) => row.retailerId}
                frozen="shop"
                state="ready"
              />
            </Async>
          </Panel>
        ) : null}

        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('m21.targets')}
        </Txt>
      </Stack>
    </Screen>
  )
}
