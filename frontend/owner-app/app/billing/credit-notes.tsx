/**
 * O14 — credit notes (docs/23 §1.1).
 *
 * A credit note is how an issued invoice is corrected: the invoice itself never changes. The register
 * shows every note against its bill and its reason; a draft can be issued or cancelled, an issued one
 * only cancelled, and the panel says which because the state is the whole story.
 */
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Money,
  Register,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Field,
  PageTabs,
  RangeSegments,
  moneyColumn,
  textColumn,
  useNames,
} from '../../src/lib/ui'
import { longDate, rangeOf, type RangeId } from '../../src/lib/dates'

type CreditNote = {
  id: string
  creditNoteNo: string
  noteDate: string
  invoiceId: string | null
  invoiceNo: string | null
  retailerId: string
  reason: string
  state: string
  taxablePaise: number
  totalPaise: number
}

const NOTE_FAMILY: Readonly<Record<string, StatusFamily>> = {
  draft: 'neutral',
  issued: 'ochre',
  applied: 'moss',
  cancelled: 'neutral',
}

export default function CreditNotes(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const names = useNames()
  const [range, setRange] = useState<RangeId>('d90')
  const [selected, setSelected] = useState<string | null>(null)

  const span = rangeOf(range)
  const list = useQuery(['creditNotes', span.from, span.to], () =>
    api.api.billing.creditNotes.list({ from: span.from, to: span.to, limit: 200 }),
  )
  const detail = useQuery(
    ['creditNotes', 'get', selected ?? 'none'],
    () => api.api.billing.creditNotes.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )

  const issue = useMutation(
    (id: string, meta) =>
      api.api.billing.creditNotes.issue({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['creditNotes'], ['receivables'], ['invoices']] },
  )
  const cancel = useMutation(
    (id: string, meta) =>
      api.api.billing.creditNotes.cancel({
        id,
        reason: 'Cancelled from the owner app',
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['creditNotes'], ['receivables'], ['invoices']] },
  )

  const rows = (list.data?.items ?? []) as readonly CreditNote[]
  const note = detail.data?.item

  const columns: readonly RegisterColumn<CreditNote>[] = [
    textColumn('no', t('o14.noteNo'), (row) => row.creditNoteNo, { priority: 'identity' }),
    textColumn('date', t('o13.date'), (row) => longDate(row.noteDate)),
    textColumn('shop', t('o13.shop'), (row) => names.retailer(row.retailerId)),
    textColumn('against', t('o14.against'), (row) => row.invoiceNo),
    textColumn('reason', t('o14.reason'), (row) => row.reason),
    moneyColumn('taxable', t('o13.taxable'), (row) => row.taxablePaise),
    moneyColumn('total', t('o13.total'), (row) => row.totalPaise),
    {
      key: 'state',
      head: t('o13.state'),
      priority: 'chip',
      cell: (row) => <StatusChip label={row.state} family={NOTE_FAMILY[row.state] ?? 'neutral'} />,
    },
  ]

  return (
    <Screen
      title={t('o14.title')}
      chips={<PageTabs group="/billing" active="/billing/credit-notes" />}
      actions={
        <RangeSegments
          value={range}
          onChange={(id) => {
            setRange(id as RangeId)
          }}
        />
      }
    >
      <Async state={[list]} rows={10} empty={rows.length === 0} emptyMessage={t('o14.empty')}>
        <Register
          testID="credit-notes-register"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          frozen="no"
          selectedKey={selected}
          onSelect={(row) => {
            setSelected(row.id)
          }}
          state="ready"
          totals={{
            no: t('app.rows', { count: rows.length }),
            total: (
              <Money
                value={rows.reduce((sum, row) => sum + row.totalPaise, 0)}
                size="cell"
                symbol={false}
              />
            ),
          }}
        />
      </Async>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={note?.creditNoteNo}
        testID="credit-note-panel"
      >
        <Async state={[detail]} rows={5}>
          {note === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('o13.shop')}>{names.retailer(note.retailerId)}</Field>
              <Field label={t('o14.against')}>{note.invoiceNo ?? t('app.none')}</Field>
              <Field label={t('o14.reason')}>{note.reason}</Field>
              <Field label={t('o13.total')}>
                <Money value={note.totalPaise} size="moneyM" />
              </Field>
              <Button
                label={t('o14.issue')}
                variant="primary"
                disabled={note.state !== 'draft'}
                disabledReason={t('o13.state')}
                loading={issue.status === 'pending'}
                onPress={() => {
                  issue.mutate(note.id)
                }}
              />
              <Button
                label={t('o14.cancelNote')}
                variant="destructive"
                disabled={note.state === 'cancelled' || note.state === 'applied'}
                disabledReason={t('o13.state')}
                loading={cancel.status === 'pending'}
                onPress={() => {
                  cancel.mutate(note.id)
                }}
              />
            </Stack>
          )}
        </Async>
      </Sheet>
    </Screen>
  )
}
