/**
 * P1 — the platform, at a glance.
 *
 * COUNTS ONLY, and the screen says so out loud. `admin.metrics.overview` answers how many
 * distributorships there are and in what state, how many people signed in this week, how much work
 * went through the platform and how much storage we are buying — and not one rupee of any
 * distributor's trade (docs/22 §9 items 1 and 9; the `admin` contract's own header states the same
 * rule). The only money this console knows is what a distributor pays US, and that lives under
 * Subscriptions.
 *
 * The three figures under "Needs attention" are the console's actual work list: somebody is late,
 * somebody's trial is about to end, and somebody's owner has been asked for a support window and has
 * not answered. Each is a link into the register that shows who.
 */
import { usePlatformApi, useQuery } from '@dos/api-client/react'
import {
  BarLadder,
  KpiStrip,
  Link,
  Row,
  Screen,
  Stack,
  StatusChip,
  TrendChart,
  Txt,
  useColors,
  useStrings,
  type LadderRow,
  type Series,
} from '@dos/ui'

import { Async, Columns, Half, Note, Panel, ReloadButton, askLapsed } from '../src/lib/ui'
import { formatBytes, shortDate } from '../src/lib/dates'
import { useWord } from '../src/lib/words'

const WINDOW_DAYS = 30

/** A count with tabular digits and Indian grouping; `—` while there is nothing to show. */
function count(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('en-IN')
}

/**
 * How many rows of a paged list belong on the work list, said honestly.
 *
 * A cursor list has no total, so a page that came back FULL and still has a cursor prints "50+"
 * rather than pretending 50 is the answer — the same rule the warehouse home strip settled on. When
 * `keep` throws rows away the "+" goes with them: a page of 200 that yields 3 is 3, not "3+", and
 * only a page where every row survived can have more behind it.
 */
function pageCount<Row>(
  list: { items: readonly Row[]; nextCursor: string | null } | undefined,
  keep: (row: Row) => boolean = () => true,
): { label: string; value: number } {
  if (list === undefined) return { label: '—', value: 0 }
  const n = list.items.filter(keep).length
  const more = list.nextCursor !== null && n === list.items.length
  return { label: `${n.toLocaleString('en-IN')}${more ? '+' : ''}`, value: n }
}

export default function Platform(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = usePlatformApi()

  const metrics = useQuery(['admin', 'metrics', WINDOW_DAYS], () =>
    api.api.admin.metrics.overview({ days: WINDOW_DAYS }),
  )
  const pastDue = useQuery(['admin', 'subscriptions', 'past_due'], () =>
    api.api.admin.subscriptions.list({ status: 'past_due', limit: 200 }),
  )
  const endingSoon = useQuery(['admin', 'subscriptions', 'ending', 30], () =>
    api.api.admin.subscriptions.list({ endingWithinDays: 30, status: 'trialing', limit: 200 }),
  )
  const waiting = useQuery(['admin', 'support', 'requested'], () =>
    api.api.admin.support.list({ status: 'requested', limit: 200 }),
  )

  const data = metrics.data
  const planRows: readonly LadderRow[] = (data?.tenantsByPlan ?? []).map((row) => ({
    label: word(row.plan),
    value: row.count,
    family: 'neutral',
  }))
  const subscriptionRows: readonly LadderRow[] = (data?.subscriptions ?? []).map((row) => ({
    label: word(row.status),
    value: row.count,
    family:
      row.status === 'active'
        ? 'moss'
        : row.status === 'trialing'
          ? 'clay'
          : row.status === 'past_due'
            ? 'ochre'
            : 'neutral',
    solid: row.status === 'past_due',
  }))

  const series: readonly Series[] = [
    {
      id: 'orders',
      label: t('p1.orders'),
      role: 'primary',
      /*
       * The AXIS LABEL, not the ISO date. `<TrendChart>` prints `x` verbatim under the tick, so
       * `2026-08-09` came out nine characters wide and the last two ticks overlapped each other —
       * measured on this screen at 1440 px. Every other chart in the product passes `shortDate()`.
       */
      points: (data?.series.orders ?? []).map((point) => ({
        x: shortDate(point.day),
        y: point.value,
      })),
    },
    {
      id: 'invoices',
      label: t('p1.invoices'),
      role: 'secondary',
      points: (data?.series.invoices ?? []).map((point) => ({
        x: shortDate(point.day),
        y: point.value,
      })),
    },
  ]
  const first = data?.series.orders[0]?.day
  const last = data?.series.orders[data.series.orders.length - 1]?.day

  const due = pageCount(pastDue.data)
  const ending = pageCount(endingSoon.data)
  /*
   * ONLY the asks somebody can still answer. `status: 'requested'` is what the wire calls an ask
   * nobody decided — including one whose own hours ran out days ago, which their owner can no longer
   * open (409 `request_expired`). Measured on the founder's database: this chip read "200+ support
   * requests waiting for an owner" and NOT ONE of the two hundred was still openable, on the panel
   * whose whole job is to say what the console should do today. `askLapsed()` is the same rule the
   * Support register and the distributorship panel read by.
   */
  const asked = pageCount(waiting.data, (row) => !askLapsed(row))
  const readFailed =
    pastDue.error !== undefined || endingSoon.error !== undefined || waiting.error !== undefined
  /*
   * "Nothing waiting" is a claim about the platform, and three failed reads are not that claim —
   * they are three zeroes with nothing behind them. Measured with admin-service blocked: the panel
   * said "Nothing waiting" over its own "No connection" message.
   */
  const nothingWaiting = !readFailed && due.value + ending.value + asked.value === 0

  return (
    <Screen
      title={t('p1.title')}
      context={t('p1.window', { days: WINDOW_DAYS })}
      actions={
        <ReloadButton
          onPress={() => {
            void metrics.refetch()
            void pastDue.refetch()
            void endingSoon.refetch()
            void waiting.refetch()
          }}
        />
      }
    >
      <Stack gap={6}>
        <Async state={[metrics]} rows={4}>
          <KpiStrip
            testID="platform-kpis"
            items={[
              { label: t('p1.tenants'), value: count(data?.tenants.total) },
              {
                label: t('p1.working'),
                value: count(data?.tenants.active),
                tone: 'positive',
              },
              {
                label: t('p1.suspended'),
                value: count(data?.tenants.suspended),
                tone: (data?.tenants.suspended ?? 0) > 0 ? 'critical' : 'neutral',
              },
              { label: t('p1.activeUsers'), value: count(data?.activeUsers7d) },
              {
                label: t('p1.storage'),
                value: formatBytes(data?.storage.bytes),
                delta:
                  data === undefined
                    ? undefined
                    : t('p1.storageObjects', { count: count(data.storage.objects) }),
              },
            ]}
          />
        </Async>

        <Note testID="counts-only">{t('app.countsOnly')}</Note>

        <Panel
          title={t('p1.needsAttention')}
          testID="needs-attention"
          meta={nothingWaiting ? t('p1.allClear') : undefined}
        >
          <Async state={[pastDue, endingSoon, waiting]} rows={2}>
            {/*
             * A chip is sized by its word (UX-00 §6.9). In a `<Stack>` every child stretches, so
             * these three read as full-width bars across a 1440 px page rather than as chips —
             * measured on this screen. A wrapping `<Row>` is what the design draws.
             */}
            <Stack gap={3}>
              <Row gap={3} wrap>
                <StatusChip
                  testID="attention-past-due"
                  label={t('p1.pastDue', { count: due.label })}
                  family={due.value > 0 ? 'ochre' : 'neutral'}
                  solid={due.value > 0}
                />
                <StatusChip
                  testID="attention-ending"
                  label={t('p1.trialEnding', { count: ending.label })}
                  family={ending.value > 0 ? 'clay' : 'neutral'}
                />
                <StatusChip
                  testID="attention-waiting"
                  label={t('p1.waitingOwners', { count: asked.label })}
                  family={asked.value > 0 ? 'clay' : 'neutral'}
                />
              </Row>
              <Row gap={3} wrap>
                <Link href="/subscriptions" variant="text">
                  <Txt field="label" desk="meta" color={colors.accent.fg}>
                    {t('p1.openSubscriptions')}
                  </Txt>
                </Link>
                <Link href="/support" variant="text">
                  <Txt field="label" desk="meta" color={colors.accent.fg}>
                    {t('p1.openSupport')}
                  </Txt>
                </Link>
              </Row>
            </Stack>
          </Async>
        </Panel>

        <Columns>
          <Half>
            <Panel title={t('p1.byPlan')} testID="by-plan">
              <Async state={[metrics]} rows={5} empty={planRows.length === 0}>
                <BarLadder rows={planRows} formatValue={(value) => count(value)} />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('p1.bySubscription')} testID="by-subscription">
              <Async state={[metrics]} rows={5} empty={subscriptionRows.length === 0}>
                <BarLadder rows={subscriptionRows} formatValue={(value) => count(value)} />
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Panel
          title={t('p1.work')}
          testID="work-chart"
          meta={
            data === undefined
              ? undefined
              : `${t('p1.ordersWindow', { days: data.windowDays, count: count(data.totals.ordersInWindow) })} · ${t(
                  'p1.invoicesWindow',
                  { days: data.windowDays, count: count(data.totals.invoicesInWindow) },
                )}`
          }
        >
          <Async state={[metrics]} rows={6}>
            <TrendChart
              testID="platform-trend"
              series={series}
              legend
              formatValue={(value) => count(value)}
              range={
                first === undefined || last === undefined
                  ? undefined
                  : t('chart.range', { from: shortDate(first), to: shortDate(last) })
              }
            />
          </Async>
        </Panel>
      </Stack>
    </Screen>
  )
}
