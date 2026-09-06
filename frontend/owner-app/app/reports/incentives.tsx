/**
 * O20 — targets and incentives (docs/23 §1.1).
 *
 * A payout statement here is COMPUTED, never paid: the product records what a target says is owed and
 * the owner approves that record; money leaves the business somewhere else. The register makes the
 * distinction visible by showing achievement beside the target rather than a rupee figure alone.
 */
import type { Statement, TargetSummary } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  CompareBars,
  Money,
  Register,
  Screen,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import { Async, PageTabs, Panel, moneyColumn, textColumn } from '../../src/lib/ui'
import { longDate } from '../../src/lib/dates'

export default function Incentives(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const [view, setView] = useState<'targets' | 'statements'>('targets')

  const targets = useQuery(['incentives', 'targets'], () =>
    api.api.incentives.targets.list({ limit: 200, activeOnly: false }),
  )
  const statements = useQuery(
    ['incentives', 'statements'],
    () => api.api.incentives.statements.list({ limit: 100 }),
    { enabled: view === 'statements' },
  )

  const approve = useMutation(
    (id: string, meta) =>
      api.api.incentives.statements.approve({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['incentives']] },
  )

  const rows = targets.data?.items ?? []
  const statementRows = statements.data?.items ?? []

  /*
   * One bar per PERSON. A rep usually holds several targets in a period (one per brand), so keying a
   * bar by the person's name — which is what `<CompareBars>` does — collapsed them into one another
   * and React logged a duplicate key for every extra target. Achievement is recomputed from the sums
   * rather than averaged: two targets of different sizes do not have equal say in one number.
   */
  const byPerson = new Map<string, { label: string; target: number; achieved: number }>()
  for (const row of rows) {
    const entry = byPerson.get(row.userId) ?? { label: row.userName, target: 0, achieved: 0 }
    entry.target += row.targetValue
    entry.achieved += row.achievedValue
    byPerson.set(row.userId, entry)
  }
  const bars = [...byPerson.values()]
    .map((entry) => ({
      label: entry.label,
      current: entry.target === 0 ? 0 : Math.round((entry.achieved / entry.target) * 10_000),
    }))
    .sort((a, b) => b.current - a.current)
    .slice(0, 12)

  const targetColumns: readonly RegisterColumn<TargetSummary>[] = [
    textColumn('person', t('o20.person'), (row) => row.userName, { priority: 'identity' }),
    textColumn('target', t('o20.target'), (row) => row.name),
    textColumn('metric', t('o20.metric'), (row) => row.metric),
    textColumn(
      'period',
      t('o20.period'),
      (row) => `${longDate(row.periodFrom)} – ${longDate(row.periodTo)}`,
    ),
    {
      key: 'value',
      head: t('o20.target'),
      align: 'right',
      priority: 'value',
      cell: (row) =>
        row.metric === 'value' || row.metric === 'collections' ? (
          <Money value={row.targetValue} size="cell" symbol={false} />
        ) : (
          <Txt field="body" desk="cell" numeric>
            {row.targetValue}
          </Txt>
        ),
    },
    {
      key: 'pct',
      head: t('o20.pct'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={`${String(Math.round(row.achievedPct / 100))}%`}
          family={row.achievedPct >= 10000 ? 'moss' : row.achievedPct >= 7500 ? 'ochre' : 'brick'}
          figure
        />
      ),
    },
  ]

  const statementColumns: readonly RegisterColumn<Statement>[] = [
    textColumn('person', t('o20.person'), (row) => row.userName ?? row.userId.slice(0, 8), {
      priority: 'identity',
    }),
    textColumn(
      'period',
      t('o20.period'),
      (row) => `${longDate(row.periodFrom)} – ${longDate(row.periodTo)}`,
    ),
    moneyColumn('computed', t('o20.computed'), (row) => row.amountPaise),
    {
      key: 'approved',
      head: t('o16.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.approvedAt === null ? t('word.pending') : t('o3.approved')}
          family={row.approvedAt === null ? 'ochre' : 'moss'}
        />
      ),
    },
    {
      key: 'action',
      head: t('o20.approveStatement'),
      cell: (row) =>
        row.approvedAt === null ? (
          <Button
            label={t('o20.approveStatement')}
            variant="ghost"
            size="desk"
            onPress={() => {
              approve.mutate(row.id)
            }}
          />
        ) : (
          <Txt field="body" desk="cell">
            {longDate(row.approvedAt.slice(0, 10))}
          </Txt>
        ),
    },
  ]

  return (
    <Screen
      title={t('o20.title')}
      chips={<PageTabs group="/reports" active="/reports/incentives" />}
      actions={
        <Segments
          size="desk"
          value={view}
          onChange={(id) => {
            setView(id as 'targets' | 'statements')
          }}
          items={[
            { id: 'targets', label: t('o20.target') },
            { id: 'statements', label: t('o20.statements') },
          ]}
          testID="incentives-view"
        />
      }
    >
      <Stack gap={6}>
        {view === 'targets' ? (
          <>
            <Panel title={t('o20.team')} testID="incentives-bars">
              <Async state={[targets]} rows={4} empty={bars.length === 0}>
                <CompareBars
                  groups={bars}
                  height={200}
                  formatValue={(value) => `${String(Math.round(value / 100))}%`}
                />
              </Async>
            </Panel>
            <Async
              state={[targets]}
              rows={8}
              empty={rows.length === 0}
              emptyMessage={t('o20.empty')}
            >
              <Register
                testID="incentives-targets"
                columns={targetColumns}
                rows={rows}
                rowKey={(row) => row.id}
                frozen="person"
                state="ready"
              />
            </Async>
          </>
        ) : (
          <Async state={[statements]} rows={8} empty={statementRows.length === 0}>
            <Register
              testID="incentives-statements"
              columns={statementColumns}
              rows={statementRows}
              rowKey={(row) => row.id}
              frozen="person"
              state="ready"
            />
          </Async>
        )}
      </Stack>
    </Screen>
  )
}
