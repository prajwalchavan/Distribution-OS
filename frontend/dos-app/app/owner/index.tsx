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
  FlowStrip,
  Half,
  MIX_TOP_GROUPS,
  PageTabs,
  Panel,
  useNames,
  type FlowCell,
} from '../../src/groups/owner/lib/ui'
import {
  dayRange,
  instantWithClock,
  monthsBack,
  olderThanADay,
  rangeOf,
  shiftDays,
  shortDate,
  shortInstant,
  today,
} from '../../src/groups/owner/lib/dates'
import { buildFlow, type FlowStep } from '../../src/groups/owner/lib/flow'
import { monthCompare, monthCompareWindow } from '../../src/groups/owner/lib/month-compare'
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

  /*
   * UX-O-1: today's flow. Every read is a procedure the owner already holds and each is the SAME read its
   * register makes when the step is pressed, so the figure on the strip is the figure on the page it opens.
   */
  const now = today()
  const booked = useQuery(['orders', 'list', 'flow', 'booked', now], () =>
    api.api.orders.list({ from: now, to: now, limit: 200 }),
  )
  const billedBills = useQuery(['invoices', 'flow', 'billed', now], () =>
    api.api.billing.invoices.list({ from: now, to: now, limit: 200 }),
  )
  const packed = useQuery(['orders', 'list', 'flow', 'packed'], () =>
    api.api.orders.list({ state: 'packed', limit: 200 }),
  )
  const dispatched = useQuery(['orders', 'list', 'flow', 'dispatched'], () =>
    api.api.orders.list({ state: 'dispatched', limit: 200 }),
  )
  const onTheRoad = useQuery(['delivery', 'trips', 'flow', 'active'], () =>
    api.api.delivery.trips.list({ state: 'active', limit: 50 }),
  )
  const collections = useQuery(['registers', 'collections', now], () =>
    api.api.reporting.registers.collections({ from: now, to: now, groupBy: 'day' }),
  )
  const banked = useQuery(['receipts', 'flow', 'banked', now], () =>
    api.api.receivables.receipts.list({ status: 'deposited', from: now, to: now, limit: 1 }),
  )

  /* UX-O-4: the days of this month so far against the same days of last month, one read. */
  const compareWindow = monthCompareWindow(now)
  const monthSeries = useQuery(
    ['series', 'sales', 'mtdCompare', compareWindow.from, compareWindow.to],
    () =>
      api.api.reporting.series.sales({
        grain: 'day',
        from: compareWindow.from,
        to: compareWindow.to,
      }),
  )
  const vsLastMonth =
    monthSeries.data === undefined ? undefined : monthCompare(monthSeries.data.points, now)

  /*
   * UX-O-2: lots past their date that still stand in a godown. `expiringBefore` is inclusive, so
   * yesterday is "expired before today"; the damaged bin is left out — expired stock already put there
   * is where it belongs.
   */
  const locations = useQuery(['inventory', 'locations'], () =>
    api.api.inventory.locations.list({ activeOnly: true }),
  )
  const expired = useQuery(['inventory', 'balances', 'owner', 'expired', now], () =>
    api.api.inventory.stock.balances({
      expiringBefore: shiftDays(now, -1),
      nonZero: true,
      limit: 500,
    }),
  )
  const godowns = new Set(
    (locations.data?.items ?? []).filter((loc) => loc.kind === 'warehouse').map((loc) => loc.id),
  )
  const expiredInGodown = (expired.data?.items ?? []).filter(
    (row) => godowns.has(row.locationId) && row.onHand > 0,
  )
  const expiredPieces = expiredInGodown.reduce((total, row) => total + row.onHand, 0)
  const expiredMore = (expired.data?.nextCursor ?? null) !== null

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

  const flow = buildFlow({
    today: now,
    booked: booked.data,
    held:
      decisions === undefined
        ? undefined
        : {
            count: decisions.count,
            more: decisions.more,
            asked: [
              ...(approvals.data?.items ?? []).map((row) => row.createdAt),
              ...(bargains.data?.items ?? []).map((row) => row.createdAt),
            ],
          },
    billedBills: billedBills.data,
    packed: packed.data,
    dispatched: dispatched.data,
    trips: onTheRoad.data,
    dashboard: d,
    collections: collections.data?.totals,
    banked: banked.data?.totals,
  })
  const rupees = (value: number): string => formatINR(paise(value))
  /*
   * A step that counts shows its count (a dash until its read answers); a step that carries ₹ shows its
   * ₹. "+" marks a floor: the list had more pages than the one page read.
   */
  const COUNTED = new Set(['booked', 'held', 'billed', 'packed', 'road', 'delivered'])
  const MONEYED = new Set(['booked', 'billed', 'packed', 'road', 'collected', 'banked', 'owed'])
  const countOf = (step: FlowStep): string | undefined =>
    !COUNTED.has(step.id)
      ? undefined
      : step.count === undefined
        ? t('flow.none')
        : t(step.more ? 'flow.countMore' : 'flow.count', { count: step.count })
  const amountOf = (step: FlowStep): string | undefined =>
    !MONEYED.has(step.id)
      ? undefined
      : step.paise === undefined
        ? COUNTED.has(step.id)
          ? undefined
          : t('flow.none')
        : step.more
          ? t('flow.amountMore', { amount: rupees(step.paise) })
          : rupees(step.paise)
  const metaOf = (step: FlowStep): string | undefined => {
    switch (step.id) {
      case 'booked':
        return step.cancelled === undefined || step.cancelled.count === 0
          ? undefined
          : t('flow.cancelled', {
              count: step.cancelled.count,
              amount: rupees(step.cancelled.paise),
            })
      case 'held':
        return step.oldest === undefined
          ? undefined
          : t('flow.asked', { date: shortInstant(step.oldest) })
      case 'packed':
        return step.oldest === undefined
          ? undefined
          : t('flow.oldest', { date: shortInstant(step.oldest) })
      case 'road':
        return step.trip === undefined
          ? step.oldest === undefined
            ? undefined
            : t('flow.oldest', { date: shortInstant(step.oldest) })
          : t('flow.trip', {
              trip: step.trip.name ?? t('app.none'),
              date:
                step.trip.since.length === 10
                  ? shortDate(step.trip.since)
                  : shortInstant(step.trip.since),
            })
      case 'delivered':
        return step.asOf !== undefined
          ? t('flow.rollupOf', { when: instantWithClock(step.asOf) })
          : step.failed === undefined
            ? undefined
            : t('flow.failed', { count: step.failed })
      case 'collected':
        return step.modes === undefined
          ? undefined
          : t('flow.modes', {
              cash: formatINR(paise(step.modes.cash), { symbol: false }),
              upi: formatINR(paise(step.modes.upi), { symbol: false }),
              cheque: formatINR(paise(step.modes.cheque), { symbol: false }),
            })
      case 'banked':
        return t('flow.bankedMeta')
      case 'owed':
        return step.asOf === undefined
          ? t('flow.dues')
          : t('flow.duesAsOf', { when: instantWithClock(step.asOf) })
      default:
        return undefined
    }
  }
  const flowCells: readonly FlowCell[] = flow.map((step) => ({
    id: step.id,
    label: t(`flow.${step.id}`),
    count: countOf(step),
    amount: amountOf(step),
    meta: metaOf(step),
    stale: step.stale,
    onPress: () => {
      go.push(step.href)
    },
  }))

  /* UX-O-3: the trip that has been out longest, for the Collected tile. */
  const roadStep = flow.find((step) => step.id === 'road')
  const activeTrips = d?.activeTrips ?? 0
  const oldestTrip = roadStep?.trip
  const tripsLine =
    activeTrips === 0 || oldestTrip === undefined
      ? activeTrips === 0
        ? t('o1.noTripOnRoad')
        : t('o1.trips', { count: activeTrips })
      : t(activeTrips === 1 ? 'o1.tripOnRoad' : 'o1.tripsOnRoad', {
          count: activeTrips,
          since:
            oldestTrip.since.length === 10
              ? shortDate(oldestTrip.since)
              : shortInstant(oldestTrip.since),
        })
  const tripStuck = olderThanADay(oldestTrip?.since)

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
        {/*
          UX-O-1: the day as a story, directly under the page tabs. Each cell reads its own procedure and
          shows a dash, not a zero, until that read answers; a failed read leaves its cell on the dash and
          the rest of the strip still tells what it knows.
        */}
        <Panel title={t('flow.title')} meta={shortDate(now)} testID="today-flow-panel">
          <FlowStrip cells={flowCells} testID="today-flow" />
        </Panel>

        <Async state={[dashboard]} rows={4}>
          <Stack gap={2}>
            <KpiStrip
              testID="today-kpis"
              items={[
                {
                  label: t('o1.sales'),
                  testID: 'today-kpi-invoiced',
                  onPress: () => {
                    go.push('/billing?range=today')
                  },
                  value: <Money value={d?.todayInvoicedPaise ?? 0} size="moneyM" />,
                  /*
                   * QA DOS-254: a bill credited today was still billed today, so the tile keeps what was
                   * invoiced — and says beside it what was credited and what is left, instead of letting a
                   * whole-bill credit vanish inside a gross figure.
                   */
                  delta:
                    d === undefined || d.todayCreditedPaise === 0
                      ? undefined
                      : t('o1.creditedToday', {
                          amount: formatINR(paise(d.todayCreditedPaise)),
                          net: formatINR(paise(d.todayInvoicedPaise - d.todayCreditedPaise)),
                        }),
                  spark: invoicedSpark,
                },
                {
                  label: t('o1.collected'),
                  testID: 'today-kpi-collected',
                  onPress: () => {
                    go.push('/money/receipts?range=today')
                  },
                  value: <Money value={d?.todayCollectedPaise ?? 0} size="moneyM" />,
                  /*
                   * UX-O-3: "1 trips active" hid a trip that had been out since 12 Sep. The line names
                   * the oldest trip on the road and turns ochre once it is older than today.
                   */
                  delta: tripsLine,
                  tone: tripStuck ? 'attention' : 'neutral',
                  spark: collectedSpark,
                },
                {
                  label: t('o1.outstanding'),
                  testID: 'today-kpi-outstanding',
                  onPress: () => {
                    go.push('/money')
                  },
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
                  testID: 'today-kpi-orders',
                  onPress: () => {
                    go.push('/orders?range=today')
                  },
                  value: String(d?.todayOrdersCount ?? 0),
                  /* UX-O-3: the failed stop the dashboard already sends is said, not dropped. */
                  delta:
                    (d?.todayFailedStops ?? 0) > 0
                      ? t('o1.deliveredFailed', {
                          delivered: d?.todayDeliveredStops ?? 0,
                          failed: d?.todayFailedStops ?? 0,
                        })
                      : t('o1.deliveredOnly', { delivered: d?.todayDeliveredStops ?? 0 }),
                  tone: (d?.todayFailedStops ?? 0) > 0 ? 'attention' : 'neutral',
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
                  {/*
                    UX-O-2: stock past its date that still stands in a godown — counted in "Stock at
                    cost" above and, until DOS-261, in what reads as sellable. It opens the Stock register
                    on its Expired filter.
                  */}
                  <ListRow
                    testID="today-expired"
                    primary={t('o1.expired')}
                    secondary={
                      expired.data === undefined || locations.data === undefined
                        ? expired.error === undefined
                          ? t('flow.none')
                          : expired.error.message
                        : expiredInGodown.length === 0
                          ? t('o1.expiredNone')
                          : t(expiredMore ? 'o1.expiredLineMore' : 'o1.expiredLine', {
                              count: expiredInGodown.length,
                              pieces: expiredPieces,
                            })
                    }
                    trailing={
                      expiredInGodown.length === 0 ? undefined : (
                        <StatusChip label={t('o15.expired')} family="brick" />
                      )
                    }
                    onPress={() => {
                      go.push('/stock?filter=expired')
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
                    /* QA DOS-254: net of the month's credit notes, with the split stated. */
                    secondary={
                      d === undefined || d.mtdCreditedPaise === 0
                        ? t('o1.mtdNet')
                        : t('o1.mtdSplit', {
                            invoiced: formatINR(paise(d.mtdSalesPaise + d.mtdCreditedPaise)),
                            credited: formatINR(paise(d.mtdCreditedPaise)),
                          })
                    }
                    trailingMoney={d?.mtdSalesPaise ?? 0}
                    onPress={() => {
                      go.push('/reports')
                    }}
                  />
                  {/*
                    UX-O-4: the same days of last month, invoiced, and this month's change against them
                    — both sides summed from one day-grain `series.sales` read, so the percent is like
                    for like (`series.growth` compares a part month with a whole one).
                  */}
                  {vsLastMonth === undefined ? null : (
                    <ListRow
                      testID="today-mtd-vs-last"
                      primary={t('o1.mtdLast')}
                      secondary={
                        vsLastMonth.changePct === null
                          ? t('o1.mtdLastLineNone', { days: dayRange(vsLastMonth.previous) })
                          : t('o1.mtdLastLine', {
                              days: dayRange(vsLastMonth.previous),
                              change: `${vsLastMonth.changePct > 0 ? '+' : vsLastMonth.changePct < 0 ? '−' : ''}${String(Math.abs(vsLastMonth.changePct))} %`,
                            })
                      }
                      trailingMoney={vsLastMonth.previousPaise}
                      onPress={() => {
                        go.push('/reports')
                      }}
                    />
                  )}
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
