/**
 * S9 · My day and my targets — the only screen in this app about the rep rather than the shop.
 *
 * Every figure is the SERVICE's own: `reporting.dashboard.rep` (a salesperson reads its own),
 * `reporting.registers.repDaily` for the thirty-day line, `incentives.progress.mine` for the targets
 * and `incentives.statements` for what has actually been approved. Nothing is derived here — a
 * payout is computed by the incentives module against its own slab table, and a second arithmetic in
 * this app would be the one the rep believes and the office does not.
 *
 * Online, and it says so. These are rollups; the phone does not hold them, and a target that is a day
 * stale is worse than a sentence saying it needs signal.
 */
import { useApi, useQuery } from '@dos/api-client/react'
import { formatINR, paise } from '@dos/domain'
import {
  BarLadder,
  Group,
  KpiStrip,
  ListRow,
  Money,
  Row,
  Screen,
  Sparkline,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useMemo } from 'react'

import { longDate, rangeOf, shortDate, today } from '../../src/lib/dates'
import { useLocalState } from '../../src/lib/local'
import { Async, PageTabs, Panel, useMyUserId } from '../../src/lib/ui'
import { formatBps, useWord } from '../../src/lib/words'

export default function Me(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const word = useWord()
  const local = useLocalState()
  const userId = useMyUserId()
  const range = rangeOf('d30', today())

  const day = useQuery(
    ['reporting', 'dashboard', 'rep'],
    () => api.api.reporting.dashboard.rep({}),
    {
      staleTime: 120_000,
    },
  )
  const daily = useQuery(
    ['reporting', 'repDaily', range.from, range.to],
    () => api.api.reporting.dailyStats.rep({ from: range.from, to: range.to, limit: 40 }),
    { staleTime: 300_000 },
  )
  const targets = useQuery(['incentives', 'progress'], () => api.api.incentives.progress.mine({}), {
    staleTime: 300_000,
  })
  const statements = useQuery(
    ['incentives', 'statements'],
    () => api.api.incentives.statements.list({ limit: 12 }),
    { staleTime: 600_000 },
  )

  /**
   * The thirty-day line, chronologically.
   *
   * `repDaily` answers newest first (it is a register a person reads), and a sparkline read
   * right-to-left is a chart that says the opposite of what happened.
   */
  const spark = useMemo(
    () =>
      [...(daily.data?.items ?? [])]
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((row) => row.orderValuePaise),
    [daily.data],
  )

  const totals = daily.data?.totals

  return (
    <Screen
      title={t('s9.title')}
      context={t('s9.context', { from: shortDate(range.from), to: shortDate(range.to) })}
      chips={local.online ? undefined : <StatusChip label={t('s0.offlineChip')} family="ochre" />}
    >
      <Stack gap={6}>
        <PageTabs group="/me" active="/me" />

        <Panel title={t('s9.today')}>
          <Async state={[day]} rows={2}>
            <KpiStrip
              testID="rep-kpis"
              items={[
                { label: t('s9.visits'), value: String(day.data?.visits ?? 0) },
                { label: t('s9.orders'), value: String(day.data?.ordersCount ?? 0) },
                {
                  label: t('s9.orderValue'),
                  value: <Money value={day.data?.orderValuePaise ?? 0} size="moneyM" />,
                },
                {
                  label: t('s9.strikeRate'),
                  value: `${String(Math.round((day.data?.strikeRate ?? 0) * 100))}%`,
                },
              ]}
            />
          </Async>
        </Panel>

        <Panel
          title={t('s9.last30')}
          meta={
            totals === undefined
              ? undefined
              : t('s9.last30Meta', {
                  visits: totals.visits,
                  orders: totals.ordersCount,
                  value: formatINR(paise(totals.orderValuePaise)),
                })
          }
        >
          <Async state={[daily]} rows={2} empty={spark.length === 0} emptyMessage={t('s9.noDays')}>
            <Stack gap={3}>
              <Sparkline testID="rep-spark" values={spark} width={320} height={64} />
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('s9.sparkNote')}
              </Txt>
            </Stack>
          </Async>
        </Panel>

        <Panel title={t('s9.targets')} meta={t('s9.targetsMeta')}>
          <Async
            state={[targets]}
            rows={3}
            empty={(targets.data?.items.length ?? 0) === 0}
            emptyMessage={t('s9.noTargets')}
          >
            <Stack gap={5} testID="rep-targets">
              {(targets.data?.items ?? []).map((target) => {
                const money = target.metric === 'value'
                const achieved = target.achievement?.achievedValue ?? 0
                const pct = target.achievement?.achievedPct ?? 0
                return (
                  <Stack key={target.id} gap={2}>
                    <Row justify="between" align="center" gap={3} wrap>
                      <Txt field="bodyStrong" desk="cell">
                        {target.name}
                      </Txt>
                      <StatusChip
                        label={formatBps(pct)}
                        family={pct >= 10_000 ? 'moss' : pct >= 7_000 ? 'ochre' : 'brick'}
                        figure
                      />
                    </Row>
                    <BarLadder
                      testID={`target-${target.id}`}
                      rows={[
                        {
                          label: t('s9.achieved'),
                          value: achieved,
                          family: pct >= 10_000 ? 'moss' : 'ochre',
                        },
                        { label: t('s9.target'), value: target.targetValue, family: 'neutral' },
                      ]}
                      formatValue={(value) =>
                        money ? formatINR(paise(Math.round(value))) : String(Math.round(value))
                      }
                    />
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {t('s9.targetPeriod', {
                        metric: word(target.metric),
                        from: shortDate(target.periodFrom),
                        to: shortDate(target.periodTo),
                      })}
                    </Txt>
                  </Stack>
                )
              })}
            </Stack>
          </Async>
        </Panel>

        <Panel title={t('s9.statements')} meta={t('s9.statementsMeta')}>
          <Async
            state={[statements]}
            rows={2}
            empty={(statements.data?.items.length ?? 0) === 0}
            emptyMessage={t('s9.noStatements')}
          >
            <Group>
              {(statements.data?.items ?? []).map((statement) => (
                <ListRow
                  key={statement.id}
                  primary={`${longDate(statement.periodFrom)} — ${longDate(statement.periodTo)}`}
                  secondary={
                    statement.approvedAt === null
                      ? t('s9.notApproved')
                      : t('s9.approvedOn', { when: shortDate(statement.approvedAt.slice(0, 10)) })
                  }
                  trailingMoney={statement.amountPaise}
                  trailing={
                    <StatusChip
                      label={statement.approvedAt === null ? t('s9.computed') : t('s9.approved')}
                      family={statement.approvedAt === null ? 'ochre' : 'moss'}
                    />
                  }
                />
              ))}
            </Group>
          </Async>
        </Panel>

        {userId === null ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('s9.ownScope')}
          </Txt>
        )}
      </Stack>
    </Screen>
  )
}
