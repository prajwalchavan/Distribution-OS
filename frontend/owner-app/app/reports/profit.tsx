/**
 * O17 — profit. An owner-only route (docs/23 §1.1, UX-01 O10).
 *
 * Margin, cost and scheme spend live here and are never bundled into a screen another role can open:
 * `reporting.series.grossMargin` and `registers.stockValue` are served by owner-service alone, and the
 * rail item is hidden for anyone the matrix refuses. The line at the top says so out loud, because an
 * owner showing a laptop to a rep should know which page not to leave open.
 */
import type { SchemeSpendRow } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  CompareBars,
  KpiStrip,
  Money,
  Register,
  Screen,
  StackedMix,
  Stack,
  TrendChart,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'

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
import { instantWithClock, clampWindow, monthsBack, shortDate } from '../../src/lib/dates'

export default function Profit(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()

  const year = monthsBack(12)
  /* `REGISTER_WINDOW_DAYS.schemeSpend` is 92: the live register refuses a year, the SERIES does not. */
  const spendWindow = clampWindow(year, 92)

  const dashboard = useQuery(
    ['reporting', 'dashboard', 'owner'],
    () => api.api.reporting.dashboard.owner(),
    { staleTime: 60_000 },
  )
  const margin = useQuery(['series', 'grossMargin', year.from, year.to], () =>
    api.api.reporting.series.grossMargin({ grain: 'month', from: year.from, to: year.to }),
  )
  const marginByBrand = useQuery(['series', 'grossMarginBrand', year.from, year.to], () =>
    api.api.reporting.series.grossMargin({
      grain: 'month',
      from: year.from,
      to: year.to,
      groupBy: 'brand',
      topGroups: 8,
    }),
  )
  const schemeSpend = useQuery(['registers', 'schemeSpend', spendWindow.from, spendWindow.to], () =>
    api.api.reporting.registers.schemeSpend({
      from: spendWindow.from,
      to: spendWindow.to,
      limit: 100,
    }),
  )
  const stockValue = useQuery(['reporting', 'stockValue'], () =>
    api.api.reporting.registers.stockValue({ limit: 100 }),
  )

  const marginBars = (marginByBrand.data?.groups ?? []).map((group) => ({
    label: group.name,
    current: group.points.reduce((sum, point) => sum + point.value, 0),
  }))

  const fundingSlices = Object.entries(
    (schemeSpend.data?.items ?? []).reduce<Record<string, number>>((acc, row) => {
      acc[row.fundingSource] = (acc[row.fundingSource] ?? 0) + row.amountPaise
      return acc
    }, {}),
  ).map(([label, value]) => ({ label, value }))

  const spendColumns: readonly RegisterColumn<SchemeSpendRow>[] = [
    textColumn('scheme', t('o8.scheme'), (row) => row.schemeName, { priority: 'identity' }),
    textColumn('brand', t('o17.brand'), (row) => row.brandName),
    textColumn('funding', t('o17.fundedBy'), (row) => row.fundingSource, { priority: 'chip' }),
    moneyColumn('amount', t('o17.spend'), (row) => row.amountPaise),
    textColumn('invoices', t('o13.tab'), (row) => row.invoiceCount),
  ]

  return (
    <Screen
      title={t('o17.title')}
      chips={<PageTabs group="/reports" active="/reports/profit" />}
      actions={
        <ExportButton
          register="schemeSpend"
          filters={{ from: spendWindow.from, to: spendWindow.to }}
          testID="profit-export"
        />
      }
    >
      <Stack gap={6}>
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('o17.ownerOnly')}
        </Txt>

        <Async state={[dashboard]} rows={3}>
          <KpiStrip
            testID="profit-kpis"
            items={[
              {
                label: t('o17.mtdMargin'),
                value: <Money value={dashboard.data?.mtdGrossMarginPaise ?? 0} size="moneyM" />,
                tone: (dashboard.data?.mtdGrossMarginPaise ?? 0) < 0 ? 'critical' : 'positive',
              },
              {
                label: t('o1.mtdSales'),
                value: <Money value={dashboard.data?.mtdSalesPaise ?? 0} size="moneyM" />,
              },
              {
                label: t('o17.stockValue'),
                value: <Money value={dashboard.data?.stockValuePaise ?? 0} size="moneyM" />,
              },
              {
                label: t('o15.nearExpiry'),
                value: <Money value={dashboard.data?.nearExpiryValuePaise ?? 0} size="moneyM" />,
                tone: 'critical',
              },
            ]}
          />
        </Async>

        <Columns>
          <Half>
            <Panel title={t('o17.marginTrend')} testID="profit-trend">
              <Async state={[margin]} rows={4} empty={(margin.data?.points.length ?? 0) === 0}>
                <TrendChart
                  series={[
                    {
                      id: 'margin',
                      label: t('o17.margin'),
                      role: 'primary',
                      points: (margin.data?.points ?? []).map((p) => ({
                        x: shortDate(p.bucket),
                        y: p.value,
                      })),
                    },
                  ]}
                  height={180}
                  asOf={instantWithClock(margin.data?.asOf)}
                />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('o17.marginByBrand')} testID="profit-brands">
              <Async state={[marginByBrand]} rows={4} empty={marginBars.length === 0}>
                <CompareBars groups={marginBars} height={200} />
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Columns>
          <Half>
            <Panel title={t('o17.schemeSpend')} testID="profit-scheme-mix">
              <Async state={[schemeSpend]} rows={3} empty={fundingSlices.length === 0}>
                <StackedMix slices={fundingSlices} />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('o17.stockValue')}>
              <Async state={[stockValue]} rows={3}>
                <Stack gap={2}>
                  <Money value={stockValue.data?.totals.valuePaise ?? 0} size="moneyL" />
                  <Money
                    value={stockValue.data?.totals.nearExpiryValuePaise ?? 0}
                    size="cell"
                    tone="critical"
                  />
                </Stack>
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Panel
          title={t('o17.schemeSpend')}
          meta={t('app.range', { from: spendWindow.from, to: spendWindow.to })}
          testID="profit-scheme-register"
        >
          <Async state={[schemeSpend]} rows={8} empty={(schemeSpend.data?.items.length ?? 0) === 0}>
            <Register
              columns={spendColumns}
              rows={schemeSpend.data?.items ?? []}
              rowKey={(row) => row.schemeId}
              frozen="scheme"
              state="ready"
              totals={{
                scheme: t('word.total'),
                amount: (
                  <Money
                    value={schemeSpend.data?.totals.amountPaise ?? 0}
                    size="cell"
                    symbol={false}
                  />
                ),
              }}
            />
          </Async>
        </Panel>
      </Stack>
    </Screen>
  )
}
