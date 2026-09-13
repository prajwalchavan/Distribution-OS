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
 * How many pieces are LEFT to credit on a line is the server's own rule (`piecesLeftToCredit` in
 * @dos/domain): billed plus free, less every note on the bill that is not cancelled. The field says
 * that figure and refuses more before anything is sent; if the server still refuses, its sentence sits
 * right above the Draft button.
 *
 * The accountant may draft, issue and cancel here — this is the money desk (`creditNotes.*` is
 * BACK_OFFICE + delivery in the matrix, unlike `invoices.cancel`).
 */
import type { CreditNoteListItem, CreditNoteReason } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { creditedPiecesByLine, piecesLeftToCredit, uuidv7 } from '@dos/domain'
import {
  Button,
  Dialog,
  ListRow,
  Money,
  Register,
  Screen,
  Search,
  Chips,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  billLineQty,
  formatCount,
  parsePieces,
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
  Refusal,
  countText,
  moneyColumn,
  pageTotal,
  pagedCount,
  stayOpen,
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
  /**
   * Pieces coming back per invoice line, AS TYPED. Empty or absent = not returned, so the line is not
   * sent. Kept as text so a wrong entry stays on screen with its error, never silently clamped or
   * truncated (UX-00 §6.3).
   */
  const [returning, setReturning] = useState<Readonly<Record<string, string>>>({})

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
  /*
   * The notes already on the picked bill, so each line can say how many pieces are left to credit. The
   * bill lists its notes by id and state only; a draft counts and a cancelled note does not, so only the
   * live ones are read, and a bill with no notes makes no call. The query keeps the notes as JSON, never
   * a Map: the cache repaints from stored values.
   */
  const priorIds = (bill.data?.item.creditNotes ?? [])
    .filter((ref) => ref.state !== 'cancelled')
    .map((ref) => ref.id)
  const prior = useQuery(
    ['creditNotes', 'onBill', billId ?? 'none', ...priorIds],
    () =>
      Promise.all(
        priorIds.map((id) => api.api.billing.creditNotes.get({ id }).then((r) => r.item)),
      ),
    { enabled: billId !== null && bill.data !== undefined },
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

  const credited = creditedPiecesByLine(prior.data ?? [])
  /** Every bill line with what is left to credit on it, what was typed against it and what is wrong. */
  const entries = (bill.data?.item.lines ?? []).map((line) => {
    // Clamped for display only; the server refuses anything above its own figure either way.
    const left = Math.max(0, piecesLeftToCredit(line, credited.get(line.id) ?? 0))
    const text = returning[line.id] ?? ''
    const parsed = parsePieces(text)
    const pieces = parsed.ok ? parsed.pieces : 0
    const error = parsed.ok
      ? pieces > left
        ? t('m8.overLeft', { left: formatCount(left) })
        : undefined
      : parsed.reason === 'unparseable'
        ? t('m8.wholePieces')
        : undefined
    return { line, left, text, pieces, error }
  })
  const draftLines = entries
    .filter((entry) => entry.error === undefined && entry.pieces > 0)
    .map((entry) => ({
      invoiceLineId: entry.line.id,
      qtyPcs: entry.pieces,
      ratePaise: entry.line.ratePaise,
    }))
  /** A typed entry that is not a whole count, or is above what is left: nothing is sent until it is fixed. */
  const invalid = entries.some((entry) => entry.error !== undefined)
  /*
   * The cache starts a new key as `idle`, so between the bill arriving and the read of its notes starting,
   * `prior.isLoading` is false with no data. Reading that as "nothing credited" would show the full figure
   * for a frame, so the lines wait until the notes are in.
   */
  const priorPending =
    billId !== null &&
    bill.data !== undefined &&
    prior.data === undefined &&
    prior.error === undefined

  const commit = (): void => {
    if (selected === null || acting === null) return
    const done = (): void => {
      setActing(null)
      setReason('')
    }
    if (acting === 'issue') void issue.mutateAsync(selected).then(done, stayOpen)
    if (acting === 'cancel')
      void cancel.mutateAsync({ id: selected, reason: reason.trim() }).then(done, stayOpen)
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
          // One bill's refusal must never show against the next one.
          create.reset()
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
                  create.reset()
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
            <Async
              state={[
                bill,
                {
                  isLoading: prior.isLoading || priorPending,
                  error: prior.error,
                  refetch: prior.refetch,
                },
              ]}
              rows={4}
            >
              <Stack gap={4}>
                {entries.map(({ line, left, text, error }) => (
                  <Stack key={line.id} gap={2} border="bottom" borderTone="faint" padY={3}>
                    <Txt field="body" desk="body" numberOfLines={1}>
                      {line.description}
                    </Txt>
                    {/* Billed pieces AND free goods: both can come back, so both are shown. */}
                    <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                      {billLineQty(line, t)}
                    </Txt>
                    {/*
                     * Typed pieces, not the order-entry stepper: a return is rarely a whole case (5 of a
                     * line's 40 pc at a case of 120), and the stepper's "Not ordered" and "cs available"
                     * words describe stock, not a bill.
                     */}
                    <TextInput
                      label={t('m8.piecesToCredit')}
                      keyboard="decimal"
                      maxLength={7}
                      value={text}
                      onChange={(value) => {
                        setReturning((current) => ({ ...current, [line.id]: value }))
                      }}
                      state={left === 0 ? 'disabled' : undefined}
                      helper={
                        left > 0
                          ? t('m8.leftToCredit', { left: formatCount(left) })
                          : t('m8.nothingLeft')
                      }
                      error={error}
                      testID={`return-${line.id}`}
                    />
                  </Stack>
                ))}
                {/* The server's refusal sits directly above the button it answers, never below the fold. */}
                <Refusal of={[create]} scope={billId} testID="note-refusal" />
                <Button
                  label={t('m8.draft')}
                  variant="primary"
                  disabled={draftLines.length === 0 || invalid}
                  disabledReason={invalid ? t('m8.fixPieces') : t('app.nothingChanged')}
                  loading={create.status === 'pending'}
                  onPress={() => {
                    void create
                      .mutateAsync({ invoiceId: billId, reason: kind, lines: draftLines })
                      .then(() => {
                        setDrafting(false)
                        setBillId(null)
                        setReturning({})
                      }, stayOpen)
                  }}
                  testID="note-create"
                />
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
            <Refusal of={[issue, cancel]} testID="note-dialog-refusal" />
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
