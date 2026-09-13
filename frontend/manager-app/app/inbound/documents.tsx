/**
 * M3 — inbound documents: the review desk (docs/23 §2.1, docs/22 §5).
 *
 * "Zero manual entry" means zero TYPING, not zero judgement (docs/22 never-list 6: document intake
 * never commits on its own). A supplier bill is photographed, its QR verified, read by the engine,
 * checked by the validators and matched to our own SKUs — and then a person reads what the machine
 * read and says whether it is right. That assertion is what this screen collects.
 *
 * What the panel shows, in the order the reviewer needs it:
 *   the page image (a signed read URL, never a raw object key — docs/22 §documents);
 *   the checks that FAILED, red before amber, with the two numbers that disagree;
 *   the header the engine read, correctable;
 *   each printed line with the SKU we think it is and the other candidates.
 *
 * The review LOCK is single-writer (`review.start` … `release`), so two people cannot correct the
 * same bill; the screen says who holds it.
 *
 * Approving books a supplier invoice DRAFT — never a goods receipt. Stock arrives at the gate, and
 * the gate counts it blind.
 */
import type { QueueItem } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { uuidv7 } from '@dos/domain'
import {
  Button,
  Dialog,
  Img,
  Money,
  Register,
  RupeeInput,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  formatINR,
  paise,
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
  Refusal,
  moneyColumn,
  stayOpen,
  textColumn,
  useCan,
  useNames,
} from '../../src/lib/ui'
import { absoluteUrl } from '../../src/config'
import { longDate, rangeOf } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const DOC_FAMILY: Readonly<Record<string, StatusFamily>> = {
  capturing: 'neutral',
  queued: 'ochre',
  extracting: 'ochre',
  needs_review: 'clay',
  in_review: 'ochre',
  reviewed: 'moss',
  committed: 'moss',
  rejected: 'neutral',
  failed: 'brick',
}

type RejectReason = 'duplicate' | 'unreadable' | 'not_ours' | 'wrong_buyer_gstin' | 'other'

/** The paise pair a failed money check carries, as the two figures that disagree. */
function moneyPair(detail: unknown): { ours: number; theirs: number } | null {
  if (typeof detail !== 'object' || detail === null) return null
  const record = detail as Record<string, unknown>
  const pairs: readonly [string, string][] = [
    ['totalPaise', 'qrTotalPaise'],
    ['subtotalPaise', 'linesPaise'],
    ['taxPaise', 'linesTaxPaise'],
  ]
  for (const [ours, theirs] of pairs) {
    if (typeof record[ours] === 'number' && typeof record[theirs] === 'number') {
      return { ours: record[ours], theirs: record[theirs] }
    }
  }
  return null
}

export default function Documents(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayReview = can('docint.review.start')
  const mayApprove = can('docint.documents.approve')
  const [selected, setSelected] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [acting, setActing] = useState<'approve' | 'reject' | 'submit' | null>(null)
  const [rejectReason] = useState<RejectReason>('unreadable')
  const [note, setNote] = useState('')
  /** Header corrections held here until Save; absent = leave the engine's reading alone. */
  const [invoiceNo, setInvoiceNo] = useState<string | null>(null)
  const [totalPaise, setTotalPaise] = useState<number | null>(null)

  const queue = useQuery(['docint', 'queue'], () => api.api.docint.queue.list({ limit: 200 }))
  const detail = useQuery(
    ['docint', 'documents', 'get', selected ?? 'none'],
    () => api.api.docint.documents.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const doc = detail.data?.item

  const extractions = useQuery(
    ['docint', 'extractions', selected ?? 'none'],
    () => api.api.docint.extractions.list({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const latest = extractions.data?.items[0]

  /*
   * `extractions.list` answers the reading's HEADER and its checks with `result: null` — the lines,
   * the evidence and the field confidences are only on `extractions.get`. Rendering the review from
   * the list alone left "What we think each line is" permanently empty, which is the one panel the
   * reviewer is here for.
   */
  const reading = useQuery(
    ['docint', 'extraction', latest?.id ?? 'none'],
    () => api.api.docint.extractions.get({ id: latest?.id ?? '' }),
    { enabled: latest !== undefined },
  )

  const candidates = useQuery(
    ['docint', 'candidates', latest?.id ?? 'none'],
    () => api.api.docint.matches.list({ extractionId: latest?.id ?? '' }),
    { enabled: latest !== undefined },
  )

  const mismatch = (detail: unknown): string | null => {
    const pair = moneyPair(detail)
    return pair === null
      ? null
      : t('m3.checkMismatch', {
          ours: formatINR(paise(pair.ours)),
          theirs: formatINR(paise(pair.theirs)),
        })
  }

  const statsRange = rangeOf('d30')
  const stats = useQuery(
    ['docint', 'stats', statsRange.from, statsRange.to],
    () => api.api.docint.stats.summary({ from: statsRange.from, to: statsRange.to }),
    { enabled: can('docint.stats.summary') },
  )

  /*
   * The review LOCK row is client-identified like every other write here: `sessionId` is the id of
   * the `review_sessions` row, generated by us, so a retry of the same intent takes the same lock
   * rather than opening a second one.
   */
  const startReview = useMutation(
    (id: string, meta) =>
      api.api.docint.review.start({
        id,
        sessionId: meta.id,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['docint']] },
  )
  const releaseReview = useMutation(
    (id: string, meta) =>
      api.api.docint.review.release({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['docint']] },
  )
  const saveReview = useMutation(
    (input: { sessionId: string; invoiceNo: string | null; totalPaise: number | null }, meta) =>
      api.api.docint.review.save({
        id: input.sessionId,
        idempotencyKey: meta.idempotencyKey,
        patch: {
          header: {
            ...(input.invoiceNo === null ? {} : { invoiceNo: input.invoiceNo }),
            ...(input.totalPaise === null ? {} : { totalPaise: input.totalPaise }),
          },
        },
      }),
    { invalidates: [['docint']] },
  )
  const submitReview = useMutation(
    (id: string, meta) => api.api.docint.review.submit({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['docint']] },
  )
  const approve = useMutation(
    (input: { id: string; lineNos: readonly number[]; supplierId: string | null }, meta) =>
      api.api.docint.documents.approve({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        supplierInvoiceId: meta.id,
        ...(input.supplierId === null ? {} : { supplierId: input.supplierId }),
        lineIds: input.lineNos.map((lineNo) => ({ lineNo, id: uuidv7() })),
      }),
    { invalidates: [['docint'], ['procurement']] },
  )
  const reject = useMutation(
    (input: { id: string; reason: RejectReason; note: string }, meta) =>
      api.api.docint.documents.reject({
        id: input.id,
        reason: input.reason,
        ...(input.note === '' ? {} : { note: input.note }),
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['docint']] },
  )
  const acceptMatch = useMutation(
    (input: { extractionId: string; lineNo: number; candidateId: string }, meta) =>
      api.api.docint.matches.accept({
        id: input.extractionId,
        lineNo: input.lineNo,
        candidateId: input.candidateId,
        rememberAlias: true,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['docint']] },
  )
  const rematch = useMutation(
    (extractionId: string, meta) =>
      api.api.docint.matches.rerun({ id: extractionId, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['docint']] },
  )

  const rows = queue.data?.items ?? []

  const columns: readonly RegisterColumn<QueueItem>[] = [
    textColumn('supplier', t('m3.supplier'), (row) => row.supplierName, { priority: 'identity' }),
    textColumn('no', t('m3.invoiceNo'), (row) => row.invoiceNo),
    textColumn('date', t('m3.invoiceDate'), (row) => longDate(row.invoiceDate)),
    moneyColumn('total', t('m3.value'), (row) => row.totalPaise),
    textColumn('lines', t('m3.lines'), (row) => row.lineCount, { align: 'right' }),
    {
      key: 'checks',
      head: t('m3.red'),
      priority: 'chip',
      cell: (row) =>
        row.redCount > 0 ? (
          <StatusChip label={String(row.redCount)} family="brick" figure />
        ) : row.amberCount > 0 ? (
          <StatusChip label={String(row.amberCount)} family="ochre" figure />
        ) : (
          <StatusChip label={word(row.status)} family={DOC_FAMILY[row.status] ?? 'neutral'} />
        ),
    },
    textColumn('unmatched', t('m3.unmatched'), (row) => row.unmatchedLines, { align: 'right' }),
    /* "1372 min" is a number nobody converts in their head; past 90 minutes it reads in hours. */
    textColumn('age', t('m3.age'), (row) =>
      row.ageMinutes > 90
        ? t('m3.ageHours', { count: Math.round(row.ageMinutes / 60) })
        : t('m3.ageMinutes', { count: row.ageMinutes }),
    ),
    textColumn('locked', t('m3.lockedHead'), (row) =>
      row.lockedByName === null ? null : t('m3.lockedBy', { name: row.lockedByName }),
    ),
  ]

  const full = reading.data?.item
  const failed = (full?.checks ?? latest?.checks ?? []).filter((check) => !check.passed)
  const header = full?.result?.header
  const lines = full?.result?.lines ?? []

  const commit = (): void => {
    if (selected === null || acting === null) return
    const done = (): void => {
      setActing(null)
      setNote('')
    }
    if (acting === 'approve')
      void approve
        .mutateAsync({
          id: selected,
          lineNos: lines.map((line) => line.lineNo),
          supplierId: doc?.supplierId ?? null,
        })
        .then(done, stayOpen)
    if (acting === 'reject')
      void reject
        .mutateAsync({ id: selected, reason: rejectReason, note: note.trim() })
        .then(done, stayOpen)
    if (acting === 'submit' && sessionId !== null)
      void submitReview.mutateAsync(sessionId).then(done, stayOpen)
  }

  return (
    <Screen
      title={t('m3.title')}
      chips={<PageTabs group="/inbound" active="/inbound/documents" />}
      context={
        stats.data === undefined ? undefined : t('m3.edits', { count: stats.data.editsPerTenLines })
      }
    >
      <Async state={[queue]} rows={10} empty={rows.length === 0} emptyMessage={t('m3.empty')}>
        <Register
          testID="docint-register"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.documentId}
          frozen="supplier"
          selectedKey={selected}
          onSelect={(row) => {
            setSelected(row.documentId)
            setSessionId(null)
            setInvoiceNo(null)
            setTotalPaise(null)
          }}
          state="ready"
          totals={{ supplier: t('app.rows', { count: rows.length }) }}
        />
      </Async>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={
          doc === undefined
            ? undefined
            : t('m3.detail', {
                supplier: doc.supplierName ?? t('app.none'),
                no: latest?.invoiceNo ?? t('app.none'),
              })
        }
        testID="docint-panel"
      >
        <Async state={[detail, extractions, reading]} rows={6}>
          {doc === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('m3.supplier')}>
                {doc.supplierName ?? names.supplier(doc.supplierId)}
              </Field>
              <Field label={t('m4.status')}>
                <StatusChip label={word(doc.status)} family={DOC_FAMILY[doc.status] ?? 'neutral'} />
              </Field>
              <Field label={t('m3.qr')}>
                {`${word(doc.qrStatus)}${doc.irnVerified ? ` · ${t('m3.irnVerified')}` : ''}`}
              </Field>

              <Panel title={t('m3.pages')}>
                <Stack gap={3}>
                  {doc.pages.map((page) => {
                    const src = absoluteUrl(page.readUrl)
                    return src === null ? null : (
                      <Img
                        key={page.id}
                        source={src}
                        alt={`${t('m3.pages')} ${String(page.pageNo)}`}
                        height={220}
                        fit="contain"
                        radius="sm"
                      />
                    )
                  })}
                </Stack>
              </Panel>

              {failed.length === 0 ? null : (
                <Panel title={t('m3.checks')}>
                  <Stack gap={2}>
                    {failed.map((check) => (
                      <Stack key={check.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                        <Txt
                          field="body"
                          desk="cell"
                          color={
                            check.severity === 'error'
                              ? colors.status.brick.fg
                              : colors.status.ochre.fg
                          }
                        >
                          {word(check.check)}
                        </Txt>
                        {/*
                          A check's `detail` is the machine's own object. Dumped with
                          `JSON.stringify` it read
                          `{"totalPaise":326200,"qrTotalPaise":134400}` on the screen whose whole
                          job is to tell a person what disagrees — so the two money fields become
                          the sentence, and anything else says nothing rather than something
                          unreadable.
                        */}
                        {mismatch(check.detail) === null ? null : (
                          <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                            {mismatch(check.detail)}
                          </Txt>
                        )}
                      </Stack>
                    ))}
                  </Stack>
                </Panel>
              )}

              {header === undefined ? null : (
                <Panel title={t('m3.reading')}>
                  <Stack gap={3}>
                    <TextInput
                      label={t('m3.invoiceNo')}
                      value={invoiceNo ?? header.invoiceNo ?? ''}
                      onChange={setInvoiceNo}
                      capitalize="none"
                      state={sessionId === null ? 'readonly' : 'default'}
                      testID="docint-invoice-no"
                    />
                    <RupeeInput
                      label={t('m3.value')}
                      value={totalPaise ?? header.totalPaise}
                      onChange={setTotalPaise}
                      disabled={sessionId === null}
                      testID="docint-total"
                    />
                    <Field label={t('m3.invoiceDate')}>{longDate(header.invoiceDate)}</Field>
                  </Stack>
                </Panel>
              )}

              <Panel title={t('m3.candidates')}>
                <Stack gap={3}>
                  {lines.map((line) => {
                    const forLine = (candidates.data?.items ?? []).filter(
                      (row) => row.lineNo === line.lineNo,
                    )
                    return (
                      <Stack key={line.lineNo} gap={2} border="bottom" borderTone="faint" padY={3}>
                        <Txt field="body" desk="body" numberOfLines={2}>
                          {`${t('m3.printed')}: ${line.description}`}
                        </Txt>
                        <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                          {`${String(line.qtyPcs)} ${word('pcs')}`}
                        </Txt>
                        <Money value={line.lineTotalPaise} size="cell" />
                        {forLine.map((candidate) => (
                          <Stack key={candidate.id} gap={1}>
                            <Txt field="body" desk="cell" numberOfLines={1}>
                              {`${t('m3.ourItem')}: ${candidate.variantName}`}
                            </Txt>
                            <Txt field="label" desk="meta" color={colors.text.secondary}>
                              {`${t('m3.score')} ${String(Math.round(candidate.score * 100))}% · ${word(candidate.reason)}`}
                            </Txt>
                            {mayReview && !candidate.chosen && latest !== undefined ? (
                              <Button
                                label={t('m3.accept')}
                                variant="secondary"
                                onPress={() => {
                                  acceptMatch.mutate({
                                    extractionId: latest.id,
                                    lineNo: line.lineNo,
                                    candidateId: candidate.id,
                                  })
                                }}
                                testID={`accept-${String(line.lineNo)}`}
                              />
                            ) : null}
                          </Stack>
                        ))}
                      </Stack>
                    )
                  })}
                </Stack>
              </Panel>

              {mayReview ? (
                <Stack gap={3}>
                  <Refusal
                    of={[startReview, saveReview, releaseReview, rematch, acceptMatch]}
                    scope={selected}
                    testID="docint-panel-refusal"
                  />
                  {sessionId === null ? (
                    <Button
                      label={t('m3.startReview')}
                      variant="primary"
                      loading={startReview.status === 'pending'}
                      onPress={() => {
                        void startReview.mutateAsync(selected ?? '').then((result) => {
                          setSessionId(result.session.id)
                        }, stayOpen)
                      }}
                      testID="docint-start"
                    />
                  ) : (
                    <>
                      <Button
                        label={t('app.save')}
                        variant="secondary"
                        loading={saveReview.status === 'pending'}
                        disabled={invoiceNo === null && totalPaise === null}
                        disabledReason={t('app.nothingChanged')}
                        onPress={() => {
                          saveReview.mutate({ sessionId, invoiceNo, totalPaise })
                        }}
                        testID="docint-save"
                      />
                      <Button
                        label={t('m3.submitReview')}
                        variant="primary"
                        onPress={() => {
                          setActing('submit')
                        }}
                        testID="docint-submit"
                      />
                      <Button
                        label={t('m3.releaseReview')}
                        variant="ghost"
                        loading={releaseReview.status === 'pending'}
                        onPress={() => {
                          void releaseReview.mutateAsync(sessionId).then(() => {
                            setSessionId(null)
                          }, stayOpen)
                        }}
                        testID="docint-release"
                      />
                    </>
                  )}
                  {latest === undefined ? null : (
                    <Button
                      label={t('m3.rematch')}
                      variant="ghost"
                      loading={rematch.status === 'pending'}
                      onPress={() => {
                        rematch.mutate(latest.id)
                      }}
                      testID="docint-rematch"
                    />
                  )}
                  {mayApprove ? (
                    <Button
                      label={t('m3.approve')}
                      variant="primary"
                      disabled={lines.length === 0}
                      disabledReason={t('m3.noLines')}
                      onPress={() => {
                        setActing('approve')
                      }}
                      testID="docint-approve"
                    />
                  ) : null}
                  <Button
                    label={t('m3.reject')}
                    variant="destructive"
                    onPress={() => {
                      setActing('reject')
                    }}
                    testID="docint-reject"
                  />
                </Stack>
              ) : (
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('app.accountantRead')}
                </Txt>
              )}
            </Stack>
          )}
        </Async>
      </Sheet>

      <Dialog
        open={acting !== null}
        onClose={() => {
          setActing(null)
        }}
        title={
          acting === 'approve'
            ? t('m3.approve')
            : acting === 'submit'
              ? t('m3.submitReview')
              : t('m3.reject')
        }
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {doc?.supplierName ?? ''}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {acting === 'approve' ? t('m3.approveBody') : ''}
            </Txt>
            {acting === 'reject' ? (
              <TextInput
                label={t('m3.rejectReason')}
                value={note}
                onChange={setNote}
                capitalize="sentences"
                testID="docint-reason"
              />
            ) : null}
            <Refusal of={[approve, reject, submitReview]} testID="docint-refusal" />
          </Stack>
        }
        confirmLabel={
          acting === 'approve'
            ? t('m3.approve')
            : acting === 'submit'
              ? t('m3.submitReview')
              : t('m3.reject')
        }
        destructive={acting === 'reject'}
        busy={
          approve.status === 'pending' ||
          reject.status === 'pending' ||
          submitReview.status === 'pending'
        }
        onConfirm={commit}
        testID="docint-dialog"
      />
    </Screen>
  )
}
