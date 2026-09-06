/**
 * O12 — the books: the trial balance and the day book (docs/23 §1.1).
 *
 * `journal_lines` is append-only and every entry balances at commit, so the one thing this screen has
 * to prove is that it still does: the trial balance carries its own debit and credit totals and says,
 * in words, whether they agree. Selecting an entry opens its lines.
 */
import type { Account, JournalEntry } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Money,
  Register,
  Screen,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Field,
  PageTabs,
  Panel,
  RangeSegments,
  moneyColumn,
  textColumn,
  useNames,
} from '../../src/lib/ui'
import { instantWithClock, longDate, rangeOf, type RangeId } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

export default function Books(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const names = useNames()
  const [view, setView] = useState<'trial' | 'day'>('trial')
  const [range, setRange] = useState<RangeId>('d30')
  const [selected, setSelected] = useState<string | null>(null)

  const span = rangeOf(range)
  const accounts = useQuery(['receivables', 'accounts'], () =>
    api.api.receivables.accounts.list({ withBalances: true }),
  )
  const journal = useQuery(['receivables', 'journal', span.from, span.to], () =>
    api.api.receivables.journal.list({ from: span.from, to: span.to, limit: 200 }),
  )

  const accountRows = accounts.data?.items ?? []
  const entries = journal.data?.items ?? []
  const entry = entries.find((row) => row.id === selected) ?? null

  const debit = accounts.data?.totals.debitPaise ?? 0
  const credit = accounts.data?.totals.creditPaise ?? 0
  const balanced = debit + credit === 0

  const accountColumns: readonly RegisterColumn<Account>[] = [
    textColumn('code', t('o12.code'), (row) => row.code, { priority: 'identity' }),
    textColumn('name', t('o12.account'), (row) => row.name),
    textColumn('kind', t('o12.kind'), (row) => word(row.kind), { priority: 'chip' }),
    moneyColumn('balance', t('o12.balance'), (row) => row.balancePaise),
  ]

  const entryColumns: readonly RegisterColumn<JournalEntry>[] = [
    textColumn('date', t('o12.date'), (row) => longDate(row.entryDate), { priority: 'identity' }),
    textColumn('ref', t('o15.ref'), (row) => word(row.refType)),
    textColumn('narration', t('o12.narration'), (row) => row.narration),
    textColumn('by', t('o7.person'), (row) => names.staff(row.postedBy)),
    moneyColumn('amount', t('o12.debit'), (row) =>
      row.lines.reduce((sum, line) => sum + Math.max(0, line.amountPaise), 0),
    ),
  ]

  return (
    <Screen
      title={t('o12.title')}
      chips={<PageTabs group="/money" active="/money/books" />}
      actions={
        <>
          <Segments
            value={view}
            onChange={(id) => {
              setView(id as 'trial' | 'day')
            }}
            items={[
              { id: 'trial', label: t('o12.trialBalance') },
              { id: 'day', label: t('o12.dayBook') },
            ]}
            testID="books-view"
          />
          {view === 'day' ? (
            <RangeSegments
              value={range}
              onChange={(id) => {
                setRange(id as RangeId)
              }}
            />
          ) : null}
        </>
      }
    >
      {view === 'trial' ? (
        <Stack gap={4}>
          <Panel
            title={t('o12.trialBalance')}
            actions={
              <StatusChip
                label={balanced ? t('o12.balanced') : t('o12.unbalanced')}
                family={balanced ? 'moss' : 'brick'}
                solid={!balanced}
              />
            }
          >
            <Async state={[accounts]} rows={10} empty={accountRows.length === 0}>
              <Register
                testID="trial-balance"
                columns={accountColumns}
                rows={accountRows}
                rowKey={(row) => row.id}
                frozen="code"
                state="ready"
                totals={{
                  code: t('word.total'),
                  balance: <Money value={debit + credit} size="cell" symbol={false} />,
                }}
              />
            </Async>
          </Panel>
        </Stack>
      ) : (
        <Async state={[journal]} rows={10} empty={entries.length === 0}>
          <Register
            testID="day-book"
            columns={entryColumns}
            rows={entries}
            rowKey={(row) => row.id}
            frozen="date"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
          />
        </Async>
      )}

      <Sheet
        open={entry !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={t('o12.entry')}
        testID="journal-panel"
      >
        {entry === null ? null : (
          <Stack gap={4}>
            <Field label={t('o12.date')}>{longDate(entry.entryDate)}</Field>
            <Field label={t('o12.narration')}>{entry.narration}</Field>
            <Field label={t('o7.person')}>{names.staff(entry.postedBy)}</Field>
            <Field label={t('o11.received')}>{instantWithClock(entry.postedAt)}</Field>
            <Panel title={t('o5.lines', { count: entry.lines.length })}>
              <Stack gap={2}>
                {entry.lines.map((line) => (
                  <Stack key={line.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                    <Txt field="body" desk="cell">
                      {`${line.accountCode} · ${line.accountName}`}
                    </Txt>
                    <Money
                      value={line.amountPaise}
                      size="cell"
                      tone={line.amountPaise < 0 ? 'critical' : 'default'}
                    />
                  </Stack>
                ))}
              </Stack>
            </Panel>
          </Stack>
        )}
      </Sheet>
    </Screen>
  )
}
