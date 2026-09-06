/**
 * O26 — the documents inbox (docint), shared with the manager app (docs/23 §1.1).
 *
 * "Zero manual entry" means zero TYPING, not zero looking: every inbound bill still passes a human,
 * and this queue is that human's list. The red and amber counts are the extractor's own confidence
 * flags — the owner opens the reds first, and the reading-quality panel says whether the pipeline is
 * getting better or worse.
 */
import type { QueueItem } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Money,
  Register,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Columns,
  Field,
  Half,
  PageTabs,
  Panel,
  moneyColumn,
  textColumn,
} from '../../src/lib/ui'
import { instantWithClock, longDate, rangeOf } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const STATUS_FAMILY: Readonly<Record<string, StatusFamily>> = {
  extracted: 'ochre',
  needs_review: 'clay',
  reviewed: 'moss',
  failed: 'brick',
}

export default function DocumentsInbox(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const [selected, setSelected] = useState<string | null>(null)

  /**
   * How long this bill has been waiting. `ageMinutes` is a raw count and the register printed it as
   * one — "1104 min" is a number nobody converts in their head while deciding what to open next.
   */
  const waiting = (minutes: number): string =>
    minutes < 90
      ? t('o26.minutes', { count: minutes })
      : minutes < 48 * 60
        ? t('o26.hours', { count: Math.round(minutes / 60) })
        : t('o26.days', { count: Math.round(minutes / (60 * 24)) })

  const span = rangeOf('d30')
  const queue = useQuery(['docint', 'queue'], () => api.api.docint.queue.list({ limit: 100 }))
  const stats = useQuery(['docint', 'stats', span.from, span.to], () =>
    api.api.docint.stats.summary({ from: span.from, to: span.to }),
  )
  const detail = useQuery(
    ['docint', 'get', selected ?? 'none'],
    () => api.api.docint.documents.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )

  const rows = queue.data?.items ?? []
  const current = rows.find((row) => row.documentId === selected) ?? null

  const columns: readonly RegisterColumn<QueueItem>[] = [
    textColumn('supplier', t('o16.supplier'), (row) => row.supplierName, { priority: 'identity' }),
    textColumn('invoice', t('o16.invoiceNo'), (row) => row.invoiceNo),
    textColumn('date', t('o13.date'), (row) => longDate(row.invoiceDate)),
    moneyColumn('total', t('o16.total'), (row) => row.totalPaise),
    {
      key: 'lines',
      head: t('o26.lines'),
      align: 'right',
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numeric>
          {row.lineCount}
        </Txt>
      ),
    },
    {
      key: 'flags',
      head: t('o26.red'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={`${String(row.redCount)} / ${String(row.amberCount)}`}
          family={row.redCount > 0 ? 'brick' : row.amberCount > 0 ? 'ochre' : 'moss'}
          solid={row.redCount > 0}
          figure
        />
      ),
    },
    {
      key: 'status',
      head: t('o16.status'),
      cell: (row) => (
        <StatusChip label={word(row.status)} family={STATUS_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    textColumn('age', t('o26.age'), (row) => waiting(row.ageMinutes)),
  ]

  return (
    <Screen title={t('o26.title')} chips={<PageTabs group="/stock" active="/stock/documents" />}>
      <Stack gap={6}>
        <Columns>
          <Half>
            <Panel title={t('o26.quality')} meta={t('app.range', { from: span.from, to: span.to })}>
              <Async state={[stats]} rows={3}>
                <Stack gap={2}>
                  <Field label={t('o26.documents')}>{String(stats.data?.documents ?? 0)}</Field>
                  <Field label={t('o26.editsPerTen')}>
                    {String(stats.data?.editsPerTenLines ?? 0)}
                  </Field>
                  <Field label={t('o26.failed')}>{String(stats.data?.failed ?? 0)}</Field>
                </Stack>
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('o26.title')}>
              <Async state={[queue]} rows={2}>
                <Field label={t('o26.waiting')}>
                  <Money
                    value={rows.reduce((sum, row) => sum + (row.totalPaise ?? 0), 0)}
                    size="moneyM"
                  />
                </Field>
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Async state={[queue]} rows={10} empty={rows.length === 0} emptyMessage={t('o26.empty')}>
          <Register
            testID="docint-queue"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.documentId}
            frozen="supplier"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.documentId)
            }}
            state="ready"
          />
        </Async>
      </Stack>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={current?.invoiceNo ?? t('o26.document')}
        testID="docint-panel"
      >
        <Async state={[detail]} rows={5}>
          {current === null ? null : (
            <Stack gap={4}>
              <Field label={t('o16.supplier')}>{current.supplierName ?? '—'}</Field>
              <Field label={t('o13.date')}>{longDate(current.invoiceDate)}</Field>
              <Field label={t('o16.total')}>
                <Money value={current.totalPaise} size="moneyM" />
              </Field>
              <Field label={t('o26.qr')}>{current.qrStatus ?? '—'}</Field>
              <Field label={t('o26.uploaded')}>{current.uploadedByName ?? '—'}</Field>
              <Field label={t('o26.age')}>
                {instantWithClock(detail.data?.item.createdAt ?? null)}
              </Field>
              <Field label={t('o26.review')}>{current.lockedByName ?? t('app.none')}</Field>
            </Stack>
          )}
        </Async>
      </Sheet>
    </Screen>
  )
}
