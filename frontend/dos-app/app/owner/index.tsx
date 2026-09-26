/**
 * O1 — Today. The owner's home on the desk and on the phone (UX-00 §9.1, docs/23 §1.1).
 *
 * It is the one screen that must answer four questions without a tap: what came in today, what went
 * out, what is owed and who is waiting for a decision. Every figure is a rupee outcome first
 * (UX-01 O1) and every panel names the procedure it came from — the screen derives nothing and
 * formats nothing that `@dos/ui` does not format at the edge.
 */
import { useApi, useQuery } from '@dos/api-client/react'
import {
  AgeingBuckets,
  Button,
  KpiStrip,
  Link,
  ListRow,
  Money,
  Screen,
  Stack,
  StatusChip,
  StackedMix,
  TrendChart,
  Txt,
  formatINR,
  paise,
  useColors,
  useGo,
  useStrings,
  type Series,
} from '@dos/ui'

import {
  AsOf,
  Async,
  Columns,
  Half,
  MIX_TOP_GROUPS,
  PageTabs,
  Panel,
  useNames,
} from '../../src/groups/owner/lib/ui'
import { instantWithClock, monthsBack, rangeOf, shortDate } from '../../src/groups/owner/lib/dates'
import { pendingDecisions } from '../../src/groups/owner/lib/pending-decisions'
import { useWord } from '../../src/groups/owner/lib/words'
import { tripName, tripOf } from '../../src/groups/owner/lib/trip-settlement'

export default function Today(): React.JSX.Element {
  const go = useGo()
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()

  const month = monthsBack(1)
  const thirty = rangeOf('d30')

  const dashboard = useQuery(
    ['reporting', 'dashboard', 'owner'],
    () => api.api.reporting.dashboard.owner(),
    { staleTime: 60_000 },
  )
  const sales = useQuery(['series', 'sales', thirty.from, thirty.to], () =>
    api.api.reporting.series.sales({
      grain: 'day',
      from: thirty.from,
      to: thirty.to,
      compare: 'previousPeriod',
    }),
  )
  const mix = useQuery(['series', 'brandMix', month.from, month.to], () =>
    api.api.reporting.series.brandMix({
      from: month.from,
      to: month.to,
      topGroups: MIX_TOP_GROUPS,
    }),
  )
  const approvals = useQuery(['approvals', 'pending', 'top'], () =>
    api.api.orders.approvals.list({ status: 'pending', limit: 5 }),
  )
  const bargains = useQuery(['bargains', 'requested', 'top'], () =>
    api.api.pricing.bargains.list({ status: 'requested', limit: 5 }),
  )

  const d = dashboard.data

  // The seven-day sparklines: `last7Days` is oldest first, exactly as the tile draws it.
  const week = d?.last7Days ?? []
  const invoicedSpark = week.map((day) => day.invoicedPaise)
  const collectedSpark = week.map((day) => day.collectedPaise)
  const ordersSpark = week.map((day) => day.ordersCount)

  const trend: readonly Series[] = [
    {
      id: 'invoiced',
      label: t('o1.salesLine'),
      role: 'primary',
      points: (sales.data?.points ?? []).map((p) => ({ x: shortDate(p.bucket), y: p.value })),
    },
    {
      id: 'previous',
      label: t('chart.previous'),
      role: 'previous',
      points: (sales.data?.points ?? []).map((p) => ({
        x: shortDate(p.bucket),
        y: p.previous ?? 0,
      })),
    },
  ]

  const slices = (mix.data?.groups ?? []).map((group) => ({
    label: group.name,
    value: group.points.reduce((sum, point) => sum + point.value, 0),
  }))

  /*
   * A bargain gate names the rate request it waits on and decides it with the same answer (DOS-005), so a pair
   * on this list is one row: the gate, with the request's shop and asked rate. A request whose gate is not among
   * these five approvals still shows once, as itself.
   */
  const requested = new Map((bargains.data?.items ?? []).map((row) => [row.id, row]))
  const gated = new Set(
    (approvals.data?.items ?? [])
      .filter((row) => row.entityType === 'bargain_request')
      .map((row) => row.entityId),
  )
  /* The shop, the order number and its total are read from the approval's own order (DOS-004), not its payload. */
  const waiting = [
    ...(approvals.data?.items ?? []).map((row) => {
      const bargain = row.entityType === 'bargain_request' ? requested.get(row.entityId) : undefined
      // DOS-235: a trip settlement is named by its trip and carries the cash difference, not "—".
      const trip = tripOf(row)
      if (trip !== null)
        return { id: row.id, kind: row.kind, what: tripName(trip), amount: trip.cashVariancePaise }
      return bargain === undefined
        ? {
            id: row.id,
            kind: row.kind,
            what:
              [row.retailerName, row.orderNo].filter((p): p is string => p !== null).join(' · ') ||
              word(row.kind),
            amount: row.orderTotalPaise,
          }
        : {
            id: row.id,
            kind: row.kind,
            what: [row.retailerName ?? names.retailer(bargain.retailerId), row.orderNo]
              .filter((p): p is string => p !== null)
              .join(' · '),
            amount: bargain.askedRatePaise,
          }
    }),
    ...(bargains.data?.items ?? [])
      .filter((row) => !gated.has(row.id))
      .map((row) => ({
        id: row.id,
        kind: 'bargain',
        what: names.retailer(row.retailerId),
        amount: row.askedRatePaise,
      })),
  ].slice(0, 6)

  /*
   * What the heading states, and what the rail badge states: the same two reads, counted once each
   * (DOS-019). The panel lists the first six; the count is all of them, so it may run ahead of the
   * rows — that is what "Open approvals" is for.
   */
  const decisions = pendingDecisions(approvals.data, bargains.data)

  return (
    <Screen
      title={t('o1.title')}
      chips={<PageTabs group={go.href('/')} active={go.href('/')} />}
      actions={
        <Button
          label={t('o1.openApprovals')}
          variant="primary"
          onPress={() => {
            go.push('/approvals')
          }}
          testID="today-approvals"
        />
      }
    >
      <Stack gap={6}>
        <Async state={[dashboard]} rows={4}>
          <Stack gap={2}>
            <KpiStrip
              testID="today-kpis"
              items={[
                {
                  label: t('o1.sales'),
                  value: <Money value={d?.todayInvoicedPaise ?? 0} size="moneyM" />,
                  spark: invoicedSpark,
                },
                {
                  label: t('o1.collected'),
                  value: <Money value={d?.todayCollectedPaise ?? 0} size="moneyM" />,
                  delta: t('o1.trips', { count: d?.activeTrips ?? 0 }),
                  spark: collectedSpark,
                },
                {
                  label: t('o1.outstanding'),
                  value: <Money value={d?.totalOutstandingPaise ?? 0} size="moneyM" />,
                  /*
                   * DOS-016: the tile stays the GROSS open value of bills — the ageing ladder, the
                   * ageing history and the shop register all sum to it. Money already received on
                   * account is stated beside it, so the owner stops chasing what is in the till and
                   * the gap against Books → Trial balance is named rather than unexplained.
                   */
                  delta:
                    d === undefined
                      ? undefined
                      : d.onAccountPaise > 0
                        ? t('o1.overdueLessOnAccount', {
                            amount: formatINR(paise(d.overduePaise)),
                            onAccount: formatINR(paise(d.onAccountPaise)),
                          })
                        : t('o1.overdue', { amount: formatINR(paise(d.overduePaise)) }),
                  tone: (d?.overduePaise ?? 0) > 0 ? 'critical' : 'neutral',
                },
                {
                  label: t('o1.orders'),
                  value: String(d?.todayOrdersCount ?? 0),
                  delta: t('o1.stopsDone', { count: d?.todayDeliveredStops ?? 0 }),
                  spark: ordersSpark,
                },
              ]}
            />
            <AsOf at={d?.asOf} />
          </Stack>
        </Async>

        <Columns>
          <Half>
            <Panel
              title={t('o2.salesVsPrev')}
              meta={t('app.range', { from: shortDate(thirty.from), to: shortDate(thirty.to) })}
              testID="today-trend"
            >
              <Async state={[sales]} rows={4} empty={(sales.data?.points.length ?? 0) === 0}>
                <TrendChart
                  series={trend}
                  legend
                  height={180}
                  range={`${shortDate(thirty.from)} — ${shortDate(thirty.to)}`}
                  asOf={instantWithClock(sales.data?.asOf)}
                />
              </Async>
            </Panel>

            <Panel
              title={t('o2.brandMix')}
              meta={t('app.range', { from: shortDate(month.from), to: shortDate(month.to) })}
            >
              <Async state={[mix]} rows={2} empty={slices.length === 0}>
                <StackedMix slices={slices} testID="today-mix" />
              </Async>
            </Panel>
          </Half>

          <Half>
            <Panel testID="today-ageing">
              <Async state={[dashboard]} rows={6}>
                <AgeingBuckets
                  buckets={{
                    '0-7': d?.ageing.b0_7 ?? 0,
                    '8-15': d?.ageing.b8_15 ?? 0,
                    '16-30': d?.ageing.b16_30 ?? 0,
                    '31-60': d?.ageing.b31_60 ?? 0,
                    '61-90': d?.ageing.b61_90 ?? 0,
                    '90+': d?.ageing.b90plus ?? 0,
                  }}
                />
              </Async>
              <Link href={go.href('/money')} variant="text">
                {t('app.drill')}
              </Link>
            </Panel>

            <Panel title={t('o1.atRisk')}>
              <Async state={[dashboard]} rows={3}>
                <Stack gap={2}>
                  <ListRow
                    primary={t('o1.stockValue')}
                    secondary={t('o1.nearExpiry', {
                      amount: formatINR(paise(d?.nearExpiryValuePaise ?? 0)),
                    })}
                    trailingMoney={d?.stockValuePaise ?? 0}
                    onPress={() => {
                      go.push('/stock')
                    }}
                  />
                  <ListRow
                    primary={t('o1.cashInTransit')}
                    secondary={t('o1.trips', { count: d?.activeTrips ?? 0 })}
                    trailingMoney={d?.cashInTransitPaise ?? 0}
                    onPress={() => {
                      go.push('/orders/trips')
                    }}
                  />
                  <ListRow
                    primary={t('o1.mtdSales')}
                    trailingMoney={d?.mtdSalesPaise ?? 0}
                    onPress={() => {
                      go.push('/reports')
                    }}
                  />
                </Stack>
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Panel
          /*
           * The count is stated only when a read has actually answered. With the service refusing or
           * unreachable, both reads are undefined, so this asserted "Needs you (0)" over a panel
           * whose own body was reporting the failure — the heading contradicting the body, and
           * claiming the safer of the two possible facts.
           *
           * It is the live lists, not `owner_summary.pendingApprovals` (DOS-019): that rollup counts
           * approvals alone and is rewritten every 15 minutes, so it disagreed with the rows under it
           * and did not move when the owner decided two of them. A page left holding a cursor is a
           * floor, and says so with a "+".
           */
          title={
            decisions === undefined
              ? t('o1.needsYou')
              : decisions.more
                ? t('o1.needsYouAtLeast', { count: decisions.count })
                : t('o1.needsYouCount', { count: decisions.count })
          }
          actions={
            <Button
              label={t('o1.openApprovals')}
              variant="secondary"
              onPress={() => {
                go.push('/approvals')
              }}
            />
          }
          testID="today-needs-you"
        >
          <Async
            state={[approvals, bargains]}
            rows={4}
            empty={waiting.length === 0}
            emptyMessage={t('o1.noApprovals')}
          >
            <Stack gap={2}>
              {waiting.map((row) => (
                <ListRow
                  key={row.id}
                  primary={row.what}
                  secondary={word(row.kind)}
                  trailingMoney={row.amount}
                  trailing={<StatusChip label={t('status.pending')} family="ochre" />}
                  onPress={() => {
                    go.push('/approvals')
                  }}
                />
              ))}
            </Stack>
          </Async>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('app.keyboardHint')}
          </Txt>
        </Panel>
      </Stack>
    </Screen>
  )
}
