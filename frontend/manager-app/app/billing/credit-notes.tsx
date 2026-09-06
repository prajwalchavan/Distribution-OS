/**
 * M8 — credit notes (docs/23 §2.1).
 *
 * A credit note is the ONLY way an issued bill is corrected: the bill itself never changes
 * (docs/22 never-list 4). So this screen does three things and nothing else — draft a note against a
 * bill at that bill's own rates, issue it (which allots the number, restocks the pieces and credits
 * the shop), or cancel a draft.
 *
 * Drafting asks for the bill first because the note is made FROM the bill: its lines, its rates and
 * its quantities are the ones the shop was charged, and the person here says how many of each are
 * coming back and whether they are saleable. Nothing is retyped and nothing is derived.
 *
 * The accountant may draft, issue and cancel here — this is the money desk (`creditNotes.*` is
 * BACK_OFFICE + delivery in the matrix, unlike `invoices.cancel`).
 */
import type { CreditNoteListItem, CreditNoteReason } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { uuidv7 } from '@dos/domain'
import {
  Button,
  Dialog,
  ListRow,
  Money,
  QtyStepper,
  Register,
  Screen,
  Search,
  Chips,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Field,
  PageTabs,
  Panel,
  RangeSegments,
  countText,
  moneyColumn,
  pageTotal,
  pagedCount,
  textColumn,
  useCan,
  useNames,
} from '../../src/lib/ui'
import { longDate, rangeOf, today, type RangeId } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const NOTE_FAMILY: Readonly<Record<string, StatusFamily>> = {
  draft: 'neutral',
  issued: 'ochre',
  applied: 'moss',
  cancelled: 'neutral',
}

const REASONS: readonly CreditNoteReason[] = [
  'short_delivery',
  'return_saleable',
  'return_damaged',
  'rate_difference',
  'scheme_settlement',
  'cancellation',
  'other',
]

export default function CreditNotes(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayWrite = can('billing.creditNotes.create')
  const [range, setRange] = useState<RangeId>('d90')
  const [selected, setSelected] = useState<string | null>(null)
  const [acting, setActing] = useState<'issue' | 'cancel' | null>(null)
  const [reason, setReason] = useState('')

  // --- drafting ---------------------------------------------------------------------------------
  const [drafting, setDrafting] = useState(false)
  const [billQuery, setBillQuery] = useState('')
  const [billId, setBillId] = useState<string | null>(null)
  const [kind, setKind] = useState<CreditNoteReason>('return_saleable')
  /** Pieces coming back, per invoice line. Absent = not returned, so the line is not sent. */
  const [returning, setReturning] = useState<Readonly<Record<string, number>>>({})

  const span = rangeOf(range)
  const list = useQuery(['creditNotes', span.from, span.to], () =>
    api.api.billing.creditNotes.list({ from: span.from, to: span.to, limit: 200 }),
  )
  const detail = useQuery(
    ['creditNotes', 'get', selected ?? 'none'],
    () => api.api.billing.creditNotes.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const note = detail.data?.item

  const billHits = useQuery(
    ['invoices', 'search', billQuery],
    () => api.api.billing.invoices.list({ q: billQuery, limit: 6 }),
    { enabled: drafting && billQuery.trim().length >= 2 },
  )
  const bill = useQuery(
    ['invoices', 'get', billId ?? 'none'],
    () => api.api.billing.invoices.get({ id: billId ?? '' }),
    { enabled: billId !== null },
  )

  const create = useMutation(
    (
      input: {
        invoiceId: string
        reason: CreditNoteReason
        lines: readonly { invoiceLineId: string; qtyPcs: number; ratePaise: number }[]
      },
      meta,
    ) =>
      api.api.billing.creditNotes.create({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        invoiceId: input.invoiceId,
        reason: input.reason,
        noteDate: today(),
        lines: input.lines.map((line) => ({
          id: uuidv7(),
          invoiceLineId: line.invoiceLineId,
          qtyPcs: line.qtyPcs,
          saleable: input.reason !== 'return_damaged',
          ratePaise: line.ratePaise,
        })),
      }),
    { invalidates: [['creditNotes'], ['invoices'], ['receivables']] },
  )
  const issue = useMutation(
    (id: string, meta) =>
      api.api.billing.creditNotes.issue({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['creditNotes'], ['receivables'], ['invoices'], ['inventory']] },
  )
  const cancel = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.billing.creditNotes.cancel({
        id: input.id,
        reason: input.reason,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['creditNotes'], ['receivables'], ['invoices']] },
  )

  const rows = list.data?.items ?? []
  const page = pagedCount(list)

  const columns: readonly RegisterColumn<CreditNoteListItem>[] = [
    textColumn('no', t('m8.noteNo'), (row) => row.creditNoteNo, { priority: 'identity' }),
    textColumn('date', t('m12.date'), (row) => longDate(row.noteDate)),
    textColumn('shop', t('m8.shop'), (row) => names.retailer(row.retailerId)),
    textColumn('against', t('m8.against'), (row) => row.invoiceNo),
    textColumn('reason', t('m8.reason'), (row) => word(row.reason)),
    moneyColumn('taxable', t('m6.taxable'), (row) => row.taxablePaise),
    moneyColumn('total', t('m8.value'), (row) => row.totalPaise),
    {
      key: 'state',
      head: t('m8.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.state)} family={NOTE_FAMILY[row.state] ?? 'neutral'} />
      ),
    },
  ]

  const draftLines = (bill.data?.item.lines ?? [])
    .filter((line) => (returning[line.id] ?? 0) > 0)
    .map((line) => ({
      invoiceLineId: line.id,
      qtyPcs: returning[line.id] ?? 0,
      ratePaise: line.ratePaise,
    }))

  const commit = (): void => {
    if (selected === null || acting === null) return
    const done = (): void => {
      setActing(null)
      setReason('')
    }
    if (acting === 'issue') void issue.mutateAsync(selected).then(done, done)
    if (acting === 'cancel')
      void cancel.mutateAsync({ id: selected, reason: reason.trim() }).then(done, done)
  }

  return (
    <Screen
      title={t('m8.title')}
      chips={<PageTabs group="/billing" active="/billing/credit-notes" />}
      actions={
        <>
          <RangeSegments
            value={range}
            onChange={(id) => {
              setRange(id as RangeId)
            }}
          />
          {mayWrite ? (
            <Button
              label={t('m8.draft')}
              variant="primary"
              onPress={() => {
                setDrafting(true)
              }}
              testID="draft-note"
            />
          ) : null}
        </>
      }
    >
      <Async state={[list]} rows={10} empty={rows.length === 0} emptyMessage={t('m8.empty')}>
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
            no: countText(page, t('app.none')),
            total: pageTotal(
              page,
              <Money
                value={rows.reduce((sum, row) => sum + row.totalPaise, 0)}
                size="cell"
                symbol={false}
              />,
            ),
          }}
        />
      </Async>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={note === undefined ? undefined : t('m8.detail', { no: note.creditNoteNo ?? '' })}
        testID="credit-note-panel"
      >
        <Async state={[detail]} rows={5}>
          {note === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('m8.shop')}>{names.retailer(note.retailerId)}</Field>
              <Field label={t('m8.against')}>{note.invoiceNo ?? t('app.none')}</Field>
              <Field label={t('m8.reason')}>{word(note.reason)}</Field>
              <Field label={t('m8.value')}>
                <Money value={note.totalPaise} size="moneyM" />
              </Field>

              <Panel title={t('m8.lines')}>
                <Stack gap={2}>
                  {note.lines.map((line) => (
                    <Stack key={line.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {line.description}
                      </Txt>
                      <Money value={line.lineTotalPaise} size="cell" />
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              {mayWrite ? (
                <Stack gap={3}>
                  <Button
                    label={t('m8.issue')}
                    variant="primary"
                    disabled={note.state !== 'draft'}
                    disabledReason={t('m8.onlyDraft')}
                    onPress={() => {
                      setActing('issue')
                    }}
                    testID="note-issue"
                  />
                  <Button
                    label={t('m8.cancel')}
                    variant="destructive"
                    disabled={note.state !== 'draft'}
                    disabledReason={t('m8.onlyDraft')}
                    onPress={() => {
                      setActing('cancel')
                    }}
                    testID="note-cancel"
                  />
                </Stack>
              ) : null}
            </Stack>
          )}
        </Async>
      </Sheet>

      <Sheet
        open={drafting}
        onClose={() => {
          setDrafting(false)
          setBillId(null)
          setReturning({})
        }}
        title={t('m8.draft')}
        testID="draft-note-panel"
      >
        <Stack gap={4}>
          <Search
            testID="note-bill-search"
            value={billQuery}
            onChange={setBillQuery}
            placeholder={t('app.searchBills')}
            state={
              billQuery.trim().length < 2
                ? 'idle'
                : billHits.isFetching
                  ? 'typing'
                  : (billHits.data?.items.length ?? 0) === 0
                    ? 'noResults'
                    : 'results'
            }
          >
            {(billHits.data?.items ?? []).map((row) => (
              <ListRow
                key={row.id}
                primary={row.invoiceNo ?? ''}
                secondary={row.buyerName}
                trailingMoney={row.totalPaise}
                state={billId === row.id ? 'selected' : 'default'}
                onPress={() => {
                  setBillId(row.id)
                  setReturning({})
                }}
              />
            ))}
          </Search>

          {/*
           * ALL SEVEN reasons, on a chip row.
           *
           * `<Segments>` is 2–3 options (UX-00 §6.10) and the kit slices to three, so this control
           * offered "short delivered · returned, saleable · returned, damaged" and nothing else:
           * a rate difference, a scheme settlement, a cancellation and "other" could not be chosen
           * at all — and the register one tab away already shows an issued note whose reason is
           * "Rate difference". A credit note is a legal document; the wrong reason on it is not a
           * cosmetic problem.
           */}
          <Chips
            testID="note-reason"
            items={REASONS.map((id) => ({ id, label: word(id), selected: kind === id }))}
            onToggle={(id) => {
              setKind(id as CreditNoteReason)
            }}
          />

          {billId === null ? (
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('app.selectRow')}
            </Txt>
          ) : (
            <Async state={[bill]} rows={4}>
              <Stack gap={4}>
                {(bill.data?.item.lines ?? []).map((line) => (
                  <Stack key={line.id} gap={2} border="bottom" borderTone="faint" padY={3}>
                    <Txt field="body" desk="body" numberOfLines={1}>
                      {line.description}
                    </Txt>
                    <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                      {`${String(line.qtyPcs)} ${word('pcs')}`}
                    </Txt>
                    <QtyStepper
                      testID={`return-${line.id}`}
                      pieces={returning[line.id] ?? 0}
                      caseSize={line.caseSize ?? 1}
                      availablePieces={line.qtyPcs}
                      onChange={(pieces) => {
                        setReturning((current) => ({ ...current, [line.id]: pieces }))
                      }}
                    />
                  </Stack>
                ))}
                <Button
                  label={t('m8.draft')}
                  variant="primary"
                  disabled={draftLines.length === 0}
                  disabledReason={t('app.nothingChanged')}
                  loading={create.status === 'pending'}
                  onPress={() => {
                    void create
                      .mutateAsync({ invoiceId: billId, reason: kind, lines: draftLines })
                      .then(
                        () => {
                          setDrafting(false)
                          setBillId(null)
                          setReturning({})
                        },
                        () => {
                          /* the error is shown by the mutation's own state */
                        },
                      )
                  }}
                  testID="note-create"
                />
                {create.error === undefined ? null : (
                  <Txt field="label" desk="meta" color={colors.status.brick.fg}>
                    {create.error.message}
                  </Txt>
                )}
              </Stack>
            </Async>
          )}
        </Stack>
      </Sheet>

      <Dialog
        open={acting !== null}
        onClose={() => {
          setActing(null)
        }}
        title={acting === 'issue' ? t('m8.issue') : t('m8.cancel')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {note?.creditNoteNo ?? ''}
            </Txt>
            <Money value={note?.totalPaise ?? null} size="moneyM" />
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {acting === 'issue' ? t('m8.issueBody') : ''}
            </Txt>
            {acting === 'cancel' ? (
              <TextInput
                label={t('app.reason')}
                value={reason}
                onChange={setReason}
                capitalize="sentences"
                testID="note-reason-text"
              />
            ) : null}
          </Stack>
        }
        confirmLabel={acting === 'issue' ? t('m8.issue') : t('m8.cancel')}
        destructive={acting === 'cancel'}
        busy={issue.status === 'pending' || cancel.status === 'pending'}
        onConfirm={commit}
        testID="note-dialog"
      />
    </Screen>
  )
}
