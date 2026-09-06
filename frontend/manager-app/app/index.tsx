/**
 * M1 — Today, the back office's home on the desk and on the phone (docs/23 §2.1, UX-00 §9.0).
 *
 * The manager's day is a set of QUEUES, not a set of totals: orders that came in and are waiting for
 * a decision, packed orders waiting for a bill, goods at the gate waiting to be counted, supplier
 * bills waiting to be read, cash waiting to go to the bank, cheques still in hand. Each row states
 * what is waiting and opens the register that holds it — one tap to work, never a dead figure.
 *
 * The money strip underneath is the same `reporting.dashboard.owner` the owner app opens on, minus
 * the margin: `mtdGrossMarginPaise` IS served to this role, and docs/23 §1.1 O17 puts profit on an
 * owner-only route "never bundled elsewhere", so this app does not draw it.
 *
 * The accountant sees this screen too. Every panel here is a READ, which is why it needs no gate —
 * the panels the accountant may not read (the two fulfilment queues) are hidden by `useCan`, from
 * the same matrix the service enforces.
 */
import { useApi, useQuery } from '@dos/api-client/react'
import {
  AgeingBuckets,
  Button,
  KpiStrip,
  ListRow,
  Money,
  Screen,
  Stack,
  StackedMix,
  StatusChip,
  TrendChart,
  formatINR,
  paise,
  useStrings,
  type Series,
} from '@dos/ui'
import { useRouter } from 'expo-router'

import {
  AsOf,
  Async,
  Columns,
  Half,
  Panel,
  countText,
  pagedCount,
  useCan,
  type PagedCount,
} from '../src/lib/ui'
import { instantWithClock, rangeOf, shortDate, today } from '../src/lib/dates'
import { useWord } from '../src/lib/words'

export default function Today(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const router = useRouter()
  const can = useCan()

  const week = rangeOf('d7')
  const now = today()

  const dashboard = useQuery(
    ['reporting', 'dashboard', 'owner'],
    () => api.api.reporting.dashboard.owner(),
    { staleTime: 60_000 },
  )

  /*
   * The six queues of docs/23 §2.1, each read with the same filter the destination screen opens on,
   * so landing there costs nothing: the cache already holds the rows.
   */
  const submitted = useQuery(['orders', 'list', 'submitted', 'badge'], () =>
    api.api.orders.list({ state: 'submitted', limit: 100 }),
  )
  const billing = useQuery(['billing', 'queue', 'badge'], () =>
    api.api.billing.invoices.queue({ limit: 100 }),
  )
  const grns = useQuery(
    ['procurement', 'grns', 'counting'],
    () => api.api.procurement.grns.list({ status: 'counting', limit: 100 }),
    { enabled: can('procurement.grns.list') },
  )
  const documents = useQuery(
    ['docint', 'queue', 'today'],
    () => api.api.docint.queue.list({ limit: 100 }),
    { enabled: can('docint.queue.list') },
  )
  /*
   * CASH AND CHEQUES ARE ASKED FOR SEPARATELY, and the money comes from `totals`, not from the rows.
   *
   * Filtering one capped page by mode gave two wrong answers at once: "Cheques in hand — more than 0
   * rows" (a count derived from a page that had no cheque on it), and a "Cash to bank" of ₹200.00
   * summed over 200 of many rows when the real figure is ₹5,95,381.11 — a partial sum that looks
   * exact. `receipts.list` answers `totals` for the WHOLE filtered set whatever the page size
   * (measured: limit 5 and limit 200 return the same `countedPaise`), so each mode is its own read
   * and each figure is the service's own total.
   */
  const cashInHandQuery = useQuery(['receipts', 'collected', 'cash'], () =>
    api.api.receivables.receipts.list({ status: 'collected', mode: 'cash', limit: 200 }),
  )
  const chequesQuery = useQuery(['receipts', 'collected', 'cheque'], () =>
    api.api.receivables.receipts.list({ status: 'collected', mode: 'cheque', limit: 200 }),
  )
  const windows = useQuery(['cashDiscounts', 'open'], () =>
    api.api.receivables.cashDiscounts.list({ status: 'open', limit: 20 }),
  )

  /** Today's collections split by mode — the banking slip, before it is banked (§2.2). */
  const collections = useQuery(['registers', 'collections', now], () =>
    api.api.reporting.registers.collections({ from: now, to: now, groupBy: 'day' }),
  )

  const d = dashboard.data
  const cashCount = pagedCount(cashInHandQuery)
  const chequeCount = pagedCount(chequesQuery)
  const cashInHand = cashInHandQuery.data?.totals.countedPaise
  const chequeValue = chequesQuery.data?.totals.countedPaise

  const trend: readonly Series[] = [
    {
      id: 'invoiced',
      label: word('invoiced'),
      role: 'primary',
      points: (d?.last7Days ?? []).map((day) => ({
        x: shortDate(day.bucket),
        y: day.invoicedPaise,
      })),
    },
    {
      id: 'collected',
      label: word('collected'),
      role: 'secondary',
      points: (d?.last7Days ?? []).map((day) => ({
        x: shortDate(day.bucket),
        y: day.collectedPaise,
      })),
    },
  ]

  const modeTotals = collections.data?.totals
  const modeSlices = [
    { label: word('cash'), value: modeTotals?.cashPaise ?? 0 },
    { label: word('upi'), value: modeTotals?.upiPaise ?? 0 },
    { label: word('cheque'), value: modeTotals?.chequePaise ?? 0 },
    { label: word('bank_transfer'), value: modeTotals?.bankTransferPaise ?? 0 },
  ].filter((slice) => slice.value > 0)

  const countLabel = (of: PagedCount): string | undefined =>
    of.count === undefined
      ? undefined
      : of.more
        ? t('m1.rowsMore', { count: of.count })
        : t('app.rows', { count: of.count })

  const orderQueue = pagedCount(submitted)
  const billQueue = pagedCount(billing)
  const grnQueue = pagedCount(grns)
  const docQueue = pagedCount(documents)

  /**
   * One queue row: what is waiting, how much of it, and the register that holds it. `count` is
   * `undefined` until its read has answered — a queue that states "0" while its own service is
   * refusing is claiming the pleasanter of two possible facts.
   */
  const queues: readonly {
    id: string
    label: string
    of: PagedCount
    href: string
    show: boolean
    money?: number | undefined
  }[] = [
    {
      id: 'orders',
      label: t('m1.submitted'),
      of: orderQueue,
      /*
       * The rupee value of a queue is stated ONLY when the whole queue fits the page.
       *
       * `orders.list` and `billing.invoices.queue` carry no `totals` (unlike `receipts.list` and
       * `outstanding.list`), so summing the rows of a capped page produces a figure that looks like
       * the value of the queue and is the value of its first hundred rows. A count that says "100+"
       * is honest; a rupee figure that says "₹23,089.00" for a queue worth far more is not, so it is
       * left out until the page is complete. The gap is recorded for the backend.
       */
      money: orderQueue.more
        ? undefined
        : (submitted.data?.items ?? []).reduce((sum, row) => sum + row.totalPaise, 0),
      href: '/orders',
      show: true,
    },
    {
      id: 'billing',
      label: t('m1.billingBacklog'),
      of: billQueue,
      money: billQueue.more
        ? undefined
        : (billing.data?.items ?? []).reduce((sum, row) => sum + row.orderTotalPaise, 0),
      href: '/billing',
      show: can('billing.invoices.queue'),
    },
    {
      id: 'grn',
      label: t('m1.grnQueue'),
      of: grnQueue,
      href: '/inbound',
      show: can('procurement.grns.list'),
    },
    {
      id: 'docs',
      label: t('m1.documents'),
      of: docQueue,
      href: '/inbound/documents',
      show: can('docint.queue.list'),
    },
    {
      id: 'bank',
      label: t('m1.cashToBank'),
      of: cashCount,
      money: cashInHand,
      href: '/money/day-end',
      show: can('receivables.receipts.deposit'),
    },
    {
      id: 'cheques',
      label: t('m1.chequesDue'),
      of: chequeCount,
      money: chequeValue,
      href: '/money/day-end',
      show: can('receivables.receipts.deposit'),
    },
  ]

  const visible = queues.filter((queue) => queue.show)

  return (
    <Screen
      title={t('m1.title')}
      actions={
        <Button
          label={t('m1.openQueue')}
          variant="primary"
          onPress={() => {
            router.push('/orders')
          }}
          testID="today-open-queue"
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
                  label: t('m1.invoicedToday'),
                  value: <Money value={d?.todayInvoicedPaise ?? 0} size="moneyM" />,
                  spark: (d?.last7Days ?? []).map((day) => day.invoicedPaise),
                },
                {
                  label: t('m1.collectedToday'),
                  value: <Money value={d?.todayCollectedPaise ?? 0} size="moneyM" />,
                  delta: t('m1.trips', { count: d?.activeTrips ?? 0 }),
                  spark: (d?.last7Days ?? []).map((day) => day.collectedPaise),
                },
                {
                  label: t('m1.outstanding'),
                  value: <Money value={d?.totalOutstandingPaise ?? 0} size="moneyM" />,
                  delta:
                    d === undefined
                      ? undefined
                      : t('m1.overdue', { amount: formatINR(paise(d.overduePaise)) }),
                  tone: (d?.overduePaise ?? 0) > 0 ? 'critical' : 'neutral',
                },
                {
                  /*
                   * The two queues the day is paced by, in one tile: how many orders are waiting for
                   * a decision, and — underneath — how many packed orders are waiting for a bill.
                   * The tile said "Bills to issue" as its delta line and gave no figure for it,
                   * which named a queue and then declined to count it.
                   */
                  label: t('m1.submitted'),
                  value: countText(orderQueue, t('app.none')),
                  delta:
                    billQueue.count === undefined
                      ? undefined
                      : t('m1.billsWaiting', { count: billQueue.count }),
                  spark: (d?.last7Days ?? []).map((day) => day.ordersCount),
                },
              ]}
            />
            <AsOf at={d?.asOf} />
          </Stack>
        </Async>

        <Panel title={t('m1.queues')} testID="today-queues">
          <Async
            state={[submitted, billing]}
            rows={6}
            empty={visible.length === 0}
            emptyMessage={t('m1.nothingWaiting')}
          >
            <Stack gap={2}>
              {visible.map((queue) => (
                <ListRow
                  key={queue.id}
                  primary={queue.label}
                  secondary={countLabel(queue.of)}
                  /* A queue with no money attached shows no money cell, rather than an em dash. */
                  trailingMoney={queue.money}
                  trailing={
                    queue.of.count === undefined ? undefined : (
                      <StatusChip
                        label={countText(queue.of, t('app.none'))}
                        family={queue.of.count > 0 ? 'ochre' : 'moss'}
                        figure
                      />
                    )
                  }
                  onPress={() => {
                    router.push(queue.href)
                  }}
                />
              ))}
            </Stack>
          </Async>
        </Panel>

        <Columns>
          <Half>
            <Panel
              title={t('m1.invoicedToday')}
              meta={t('app.range', { from: shortDate(week.from), to: shortDate(week.to) })}
              testID="today-trend"
            >
              <Async state={[dashboard]} rows={4} empty={(d?.last7Days.length ?? 0) === 0}>
                <TrendChart
                  series={trend}
                  legend
                  height={180}
                  range={`${shortDate(week.from)} — ${shortDate(week.to)}`}
                  asOf={instantWithClock(d?.asOf)}
                />
              </Async>
            </Panel>

            {/*
             * THE MIX CARRIES ITS OWN DATE.
             *
             * `reporting.dashboard.owner` is a rolled-up snapshot — its `asOf` was last night, so
             * "Collected today ₹177.01" in the strip is yesterday's figure, correctly stamped under
             * the strip. This panel reads `registers.collections` for TODAY and answered ₹165.00.
             * Two different days, both called today, half a screen apart. The panel now says which
             * day it is showing.
             */}
            <Panel title={t('m1.collectionsToday')} meta={shortDate(now)} testID="today-modes">
              <Async
                state={[collections]}
                rows={2}
                empty={modeSlices.length === 0}
                emptyMessage={t('m12.empty')}
              >
                <StackedMix slices={modeSlices} />
              </Async>
            </Panel>
          </Half>

          <Half>
            {/* `<AgeingBuckets>` draws its own heading (`ageing.title`); a panel title above it
                printed the same words twice. */}
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
            </Panel>

            <Panel title={t('m1.cashWindows')} testID="today-windows">
              <Async
                state={[windows]}
                rows={4}
                empty={(windows.data?.items.length ?? 0) === 0}
                emptyMessage={t('m1.noWindows')}
              >
                <Stack gap={2}>
                  {(windows.data?.items ?? []).slice(0, 6).map((row) => (
                    <ListRow
                      key={row.id}
                      primary={row.retailerName}
                      secondary={t('m1.window', { date: shortDate(row.payBy) })}
                      trailingMoney={row.potentialPaise}
                      onPress={() => {
                        router.push('/money')
                      }}
                    />
                  ))}
                </Stack>
              </Async>
            </Panel>
          </Half>
        </Columns>
      </Stack>
    </Screen>
  )
}
