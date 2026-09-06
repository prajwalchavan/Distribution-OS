/**
 * O2 — growth and performance: the charts screen (docs/23 §1.2, UX-00 §9.1).
 *
 * Every chart is one procedure of the `reporting.series.*` family, at the grain and the window the
 * segmented control names, and every chart prints its own range and "as of" because a figure without
 * a date is a figure nobody can check. Nothing on this screen is computed here — the compare series,
 * the shares and the ranks all arrive already reckoned.
 */
import type { RankingItem } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  CompareBars,
  Money,
  Register,
  Screen,
  Segments,
  StackedMix,
  Stack,
  TrendChart,
  Txt,
  useStrings,
  type RegisterColumn,
  type Series,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Columns,
  ExportButton,
  Half,
  PageTabs,
  Panel,
  moneyColumn,
  textColumn,
} from '../../src/lib/ui'
import {
  instantWithClock,
  grainFor,
  monthsBack,
  rangeOf,
  shortDate,
  type RangeId,
} from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

export default function Growth(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const word = useWord()
  const [range, setRange] = useState<RangeId>('d30')
  const [compare, setCompare] = useState<'none' | 'previousPeriod' | 'previousYear'>(
    'previousPeriod',
  )

  const span = rangeOf(range)
  const year = monthsBack(12)
  /*
   * The grain follows the window, because the contract caps points per grain (day <= 92, week <= 53,
   * month <= 24) and a wider ask is a 400. "This FY" is 365 days: a week chart, not a day one.
   */
  const grain = grainFor(span)

  const sales = useQuery(['series', 'sales', span.from, span.to, grain, compare], () =>
    api.api.reporting.series.sales({
      grain,
      from: span.from,
      to: span.to,
      compare,
    }),
  )
  const collections = useQuery(['series', 'collections', span.from, span.to, grain], () =>
    api.api.reporting.series.collections({ grain, from: span.from, to: span.to }),
  )
  const months = useQuery(['series', 'months', year.from, year.to, compare], () =>
    api.api.reporting.series.sales({
      grain: 'month',
      from: year.from,
      to: year.to,
      compare: compare === 'none' ? 'previousYear' : compare,
    }),
  )
  const mix = useQuery(['series', 'brandMix', year.from, year.to], () =>
    api.api.reporting.series.brandMix({ from: year.from, to: year.to, topGroups: 5 }),
  )
  const beats = useQuery(['series', 'topBeats', span.from, span.to], () =>
    api.api.reporting.series.topBeats({ from: span.from, to: span.to, top: 10 }),
  )
  const shops = useQuery(['series', 'topShops', span.from, span.to], () =>
    api.api.reporting.series.topShops({ from: span.from, to: span.to, top: 10 }),
  )
  const outstanding = useQuery(['series', 'outstanding', span.from, span.to, grain], () =>
    api.api.reporting.series.outstanding({ grain, from: span.from, to: span.to }),
  )
  const fillRate = useQuery(['series', 'fillRate', span.from, span.to, grain], () =>
    api.api.reporting.series.fillRate({ grain, from: span.from, to: span.to }),
  )
  const delivery = useQuery(['series', 'delivery', span.from, span.to, grain], () =>
    api.api.reporting.series.deliveryPerformance({ grain, from: span.from, to: span.to }),
  )
  const stock = useQuery(['series', 'stock', year.from, year.to], () =>
    api.api.reporting.series.stock({ grain: 'month', from: year.from, to: year.to }),
  )

  /**
   * A chart formats by the SERIES' own unit. The kit's default is abbreviated money, which is right
   * for paise and a lie for the rest: delivered stops rendered as "₹0.0" and a fill rate of 0.79 as
   * "₹0.0" too. `reporting` says which unit every series is in; the screen reads it rather than
   * assuming.
   */
  const formatFor = (
    unit: 'paise' | 'count' | 'ratio',
  ): ((value: number) => string) | undefined => {
    if (unit === 'count') return (value) => String(Math.round(value))
    if (unit === 'ratio') return (value) => `${String(Math.round(value * 100))}%`
    return undefined
  }

  const line = (
    id: string,
    label: string,
    points: readonly { bucket: string; value: number }[],
    role: 'primary' | 'secondary' | 'previous',
  ): Series => ({
    id,
    label,
    role,
    points: points.map((p) => ({ x: shortDate(p.bucket), y: p.value })),
  })

  /**
   * One `reporting.series.*` answer carries series in DIFFERENT units, and one chart has one y axis.
   * `delivery-performance` returns three counts (0-8 stops) and two ratios (0-1); `stock` returns two
   * paise figures (₹5.8 lakh) and `stockTurns` (0.89). Drawn together, every ratio was a dead-flat
   * line on the axis floor under a rupee or a stop scale — the stock chart printed "stockTurns" as a
   * line at exactly ₹0.00 for twelve months running. Each unit gets its own chart, and each series
   * gets the trade's word for it instead of the metric id.
   */
  const seriesOf = (
    named: readonly {
      metric: string
      unit: 'paise' | 'count' | 'ratio'
      points: readonly { bucket: string; value: number }[]
    }[],
    unit: 'paise' | 'count' | 'ratio',
  ): readonly Series[] =>
    named
      .filter((s) => s.unit === unit)
      .map((s, index) =>
        line(s.metric, word(s.metric), s.points, index === 0 ? 'primary' : 'secondary'),
      )

  const salesSeries: readonly Series[] = [
    line('invoiced', t('o1.salesLine'), sales.data?.points ?? [], 'primary'),
    ...(compare === 'none'
      ? []
      : [
          {
            id: 'previous',
            label: t('chart.previous'),
            role: 'previous' as const,
            points: (sales.data?.points ?? []).map((p) => ({
              x: shortDate(p.bucket),
              y: p.previous ?? 0,
            })),
          },
        ]),
  ]

  const collectionsSeries: readonly Series[] = [
    line('invoiced', t('o1.salesLine'), sales.data?.points ?? [], 'primary'),
    line('collected', t('o1.collectedLine'), collections.data?.points ?? [], 'secondary'),
  ]

  const monthBars = (months.data?.points ?? []).map((p) => ({
    label: shortDate(p.bucket),
    current: p.value,
    previous: p.previous ?? undefined,
  }))

  const beatBars = (beats.data?.items ?? []).map((item) => ({
    label: item.name,
    current: item.value,
    previous: item.previous ?? undefined,
  }))

  const mixSlices = (mix.data?.groups ?? []).map((group) => ({
    label: group.name,
    value: group.points.reduce((sum, point) => sum + point.value, 0),
  }))

  const outstandingSeries = seriesOf(outstanding.data?.series ?? [], 'paise')
  const deliveryCounts = seriesOf(delivery.data?.series ?? [], 'count')
  const deliveryRates = seriesOf(delivery.data?.series ?? [], 'ratio')
  const stockValues = seriesOf(stock.data?.series ?? [], 'paise')
  const stockRates = seriesOf(stock.data?.series ?? [], 'ratio')

  const shopColumns: readonly RegisterColumn<RankingItem>[] = [
    textColumn('rank', t('o2.rank'), (row) => row.rank, { priority: 'detail' }),
    textColumn('name', t('o6.name'), (row) => row.name, { priority: 'identity' }),
    moneyColumn('value', t('o5.value'), (row) => row.value),
    textColumn('share', t('o2.shareHead'), (row) => `${String(row.shareBps / 100)}%`, {
      priority: 'chip',
    }),
  ]

  return (
    <Screen
      title={t('o2.title')}
      chips={<PageTabs group="/reports" active="/reports" />}
      actions={
        <>
          <Segments
            value={range}
            onChange={(id) => {
              setRange(id as RangeId)
            }}
            items={[
              { id: 'd30', label: t('app.days30') },
              { id: 'd90', label: t('app.days90') },
              { id: 'fy', label: t('app.fy') },
            ]}
            testID="growth-range"
          />
          <Segments
            value={compare}
            onChange={(id) => {
              setCompare(id as 'none' | 'previousPeriod' | 'previousYear')
            }}
            items={[
              { id: 'none', label: t('o2.compareNone') },
              { id: 'previousPeriod', label: t('o2.comparePrev') },
              { id: 'previousYear', label: t('o2.compareYear') },
            ]}
            testID="growth-compare"
          />
          <ExportButton
            register="dailySales"
            filters={{ from: span.from, to: span.to }}
            testID="growth-export"
          />
        </>
      }
    >
      <Stack gap={6}>
        <Columns>
          <Half>
            <Panel
              title={t('o2.salesTrend')}
              meta={t('app.range', { from: shortDate(span.from), to: shortDate(span.to) })}
              testID="growth-sales"
            >
              <Async state={[sales]} rows={4} empty={(sales.data?.points.length ?? 0) === 0}>
                <TrendChart
                  series={salesSeries}
                  legend={compare !== 'none'}
                  height={180}
                  asOf={instantWithClock(sales.data?.asOf)}
                />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('o2.collectionsVsSales')} testID="growth-collections">
              <Async
                state={[collections]}
                rows={4}
                empty={(collections.data?.points.length ?? 0) === 0}
              >
                <TrendChart series={collectionsSeries} legend height={180} />
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Columns>
          <Half>
            <Panel title={t('o2.monthOnMonth')} testID="growth-months">
              <Async state={[months]} rows={4} empty={monthBars.length === 0}>
                <CompareBars
                  groups={monthBars}
                  height={200}
                  currentLabel={t('chart.current')}
                  previousLabel={t('chart.previous')}
                />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('o2.brandMix')} testID="growth-mix">
              <Async state={[mix]} rows={2} empty={mixSlices.length === 0}>
                <StackedMix slices={mixSlices} />
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Columns>
          <Half>
            <Panel title={t('o2.byBeat')} testID="growth-beats">
              <Async state={[beats]} rows={4} empty={beatBars.length === 0}>
                <CompareBars groups={beatBars} height={200} />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('o2.outstandingTrend')} testID="growth-outstanding">
              <Async state={[outstanding]} rows={4} empty={outstandingSeries.length === 0}>
                <TrendChart series={outstandingSeries} legend height={180} />
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Columns>
          <Half>
            <Panel title={t('o2.fillRate')} testID="growth-fill-rate">
              <Async state={[fillRate]} rows={4} empty={(fillRate.data?.series.length ?? 0) === 0}>
                <TrendChart
                  series={(fillRate.data?.series ?? []).map((named) =>
                    line(named.metric, t('o2.fillRate'), named.points, 'primary'),
                  )}
                  height={160}
                  formatValue={formatFor(fillRate.data?.series[0]?.unit ?? 'ratio')}
                />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('o2.delivery')} testID="growth-delivery">
              <Async state={[delivery]} rows={4} empty={deliveryCounts.length === 0}>
                <TrendChart
                  series={deliveryCounts}
                  legend
                  height={160}
                  formatValue={formatFor('count')}
                />
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Columns>
          <Half>
            <Panel title={t('o2.deliveryRates')} testID="growth-delivery-rates">
              <Async state={[delivery]} rows={4} empty={deliveryRates.length === 0}>
                <TrendChart
                  series={deliveryRates}
                  legend
                  height={160}
                  formatValue={formatFor('ratio')}
                />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('o2.stockTurns')} testID="growth-stock-turns">
              <Async state={[stock]} rows={3} empty={stockRates.length === 0}>
                {/*
                  `stockTurns` is a `ratio` on the wire like a fill rate, but it is a MULTIPLE, not a
                  percentage: 0.89 turns in a month is "0.9×", and printing it as "89%" says the wrong
                  thing about the one number this chart exists for.
                */}
                <TrendChart
                  series={stockRates}
                  legend
                  height={160}
                  formatValue={(value) => `${value.toFixed(1)}×`}
                />
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Panel title={t('o2.stockCover')} testID="growth-stock">
          <Async state={[stock]} rows={3} empty={stockValues.length === 0}>
            <TrendChart series={stockValues} legend height={160} />
          </Async>
        </Panel>

        <Panel
          title={t('o2.topShops')}
          meta={t('app.range', { from: shortDate(span.from), to: shortDate(span.to) })}
          testID="growth-top-shops"
        >
          <Async state={[shops]} rows={6} empty={(shops.data?.items.length ?? 0) === 0}>
            <Register
              columns={shopColumns}
              rows={shops.data?.items ?? []}
              rowKey={(row) => row.key}
              frozen="name"
              state="ready"
              totals={{
                name: t('word.total'),
                value: <Money value={shops.data?.totalValue ?? 0} size="cell" symbol={false} />,
              }}
            />
          </Async>
        </Panel>

        <Txt field="label" desk="meta">
          {t('app.asOf', { when: instantWithClock(sales.data?.asOf) })}
        </Txt>
      </Stack>
    </Screen>
  )
}
