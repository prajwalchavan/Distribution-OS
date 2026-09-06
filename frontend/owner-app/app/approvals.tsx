/**
 * O3 — the approvals queue (docs/23 §1.1, UX-00 §9.1 "Needs you").
 *
 * Two decision streams reach the same desk: an order flagged by the pricing engine or the credit
 * check (`orders.approvals.*`) and a rep asking for a rate below the floor (`pricing.bargains.*`).
 * They decide with the same two keys, so they are one queue with a segmented filter rather than two
 * screens — `j`/`k` move, `1` approves, `2` rejects (UX-00 §8.1), and every rejection carries its
 * reason because a decision without one is a decision nobody can act on (UX-02 R29).
 */
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Money,
  Register,
  Screen,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import { Async, Field, PageTabs, Panel, textColumn, useNames } from '../src/lib/ui'
import { instantWithClock } from '../src/lib/dates'
import { useWord } from '../src/lib/words'
import { useRegisterKeys, useHotkeys } from '../src/lib/keys'

/** One row of the merged queue, so both streams answer the same four questions. */
interface Decision {
  id: string
  stream: 'approval' | 'bargain'
  kind: string
  what: string
  who: string
  askedAt: string
  amountPaise: number | null
  listRatePaise: number | null
  askedRatePaise: number | null
  note: string | null
}

export default function Approvals(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const word = useWord()

  const [stream, setStream] = useState<'all' | 'approval' | 'bargain'>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null)
  const [note, setNote] = useState('')

  const approvals = useQuery(['approvals', 'pending'], () =>
    api.api.orders.approvals.list({ status: 'pending', limit: 100 }),
  )
  const bargains = useQuery(['bargains', 'requested'], () =>
    api.api.pricing.bargains.list({ status: 'requested', limit: 100 }),
  )

  const rows: readonly Decision[] = [
    ...(approvals.data?.items ?? []).map<Decision>((row) => ({
      id: row.id,
      stream: 'approval',
      kind: row.kind,
      what: typeof row.payload.orderNo === 'string' ? row.payload.orderNo : row.entityType,
      who: names.staff(row.requestedBy),
      askedAt: row.createdAt,
      amountPaise: typeof row.payload.totalPaise === 'number' ? row.payload.totalPaise : null,
      listRatePaise: null,
      askedRatePaise: null,
      note: null,
    })),
    ...(bargains.data?.items ?? []).map<Decision>((row) => ({
      id: row.id,
      stream: 'bargain',
      kind: 'bargain',
      what: names.retailer(row.retailerId),
      who: names.staff(row.requestedBy),
      askedAt: row.createdAt,
      amountPaise: row.askedRatePaise,
      listRatePaise: row.listRatePaise,
      askedRatePaise: row.askedRatePaise,
      note: row.note,
    })),
  ].filter((row) => stream === 'all' || row.stream === stream)

  const current = rows.find((row) => row.id === selected) ?? null

  const decideApproval = useMutation(
    (input: { id: string; decision: 'approve' | 'reject'; note?: string }, meta) =>
      api.api.orders.approvals.decide({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        decision: input.decision,
        ...(input.note === undefined || input.note === '' ? {} : { note: input.note }),
      }),
    { invalidates: [['approvals'], ['orders'], ['reporting']] },
  )

  const decideBargain = useMutation(
    (input: { id: string; decision: 'approve' | 'reject'; note?: string }, meta) =>
      api.api.pricing.bargains.decide({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        decision: input.decision,
        ...(input.note === undefined || input.note === '' ? {} : { note: input.note }),
      }),
    { invalidates: [['bargains'], ['reporting']] },
  )

  const busy = decideApproval.status === 'pending' || decideBargain.status === 'pending'

  const commit = (): void => {
    if (current === null || confirm === null) return
    const input = { id: current.id, decision: confirm, note: note.trim() }
    const run = current.stream === 'approval' ? decideApproval : decideBargain
    // One intent, one idempotency key: a retry of THIS decision can never write a second row.
    void run.mutateAsync(input).then(
      () => {
        setConfirm(null)
        setNote('')
        setSelected(null)
      },
      () => {
        /* the error is on the mutation state and rendered under the dialog */
      },
    )
  }

  useRegisterKeys({
    rows,
    rowKey: (row) => row.id,
    selected,
    onSelect: (row) => {
      setSelected(row.id)
    },
    enabled: confirm === null,
  })

  useHotkeys(
    {
      '1': () => {
        if (selected !== null) setConfirm('approve')
      },
      '2': () => {
        if (selected !== null) setConfirm('reject')
      },
      Escape: () => {
        setConfirm(null)
        setSelected(null)
      },
    },
    true,
  )

  const columns: readonly RegisterColumn<Decision>[] = [
    textColumn('kind', t('o3.kind'), (row) => word(row.kind), { priority: 'chip' }),
    textColumn('what', t('o3.what'), (row) => row.what, { priority: 'identity' }),
    textColumn('who', t('o7.person'), (row) => row.who),
    {
      key: 'amount',
      head: t('o5.value'),
      align: 'right',
      priority: 'value',
      cell: (row) => <Money value={row.amountPaise} size="cell" symbol={false} />,
    },
    textColumn('asked', t('o3.asked'), (row) => instantWithClock(row.askedAt)),
  ]

  return (
    <Screen
      title={t('o3.title')}
      chips={<PageTabs group="/" active="/approvals" />}
      actions={
        <Segments
          value={stream}
          onChange={(id) => {
            setStream(id as 'all' | 'approval' | 'bargain')
          }}
          items={[
            { id: 'all', label: t('word.all') },
            { id: 'approval', label: t('o3.orderApprovals') },
            { id: 'bargain', label: t('o3.bargains') },
          ]}
          testID="approvals-filter"
        />
      }
    >
      <Stack gap={4}>
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('o3.keys')}
        </Txt>

        <Async
          state={[approvals, bargains]}
          rows={8}
          empty={rows.length === 0}
          emptyMessage={t('o3.empty')}
        >
          <Register
            testID="approvals-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="what"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
          />
        </Async>
      </Stack>

      <Sheet
        open={current !== null && confirm === null}
        onClose={() => {
          setSelected(null)
        }}
        title={current?.what}
        testID="approval-panel"
      >
        {current === null ? null : (
          <Stack gap={4}>
            <Field label={t('o3.kind')}>
              <StatusChip label={word(current.kind)} family="ochre" />
            </Field>
            <Field label={t('o7.person')}>{current.who}</Field>
            <Field label={t('o3.asked')}>{instantWithClock(current.askedAt)}</Field>
            {current.listRatePaise === null ? null : (
              <Field label={t('o3.listRate')}>
                <Money value={current.listRatePaise} size="moneyM" />
              </Field>
            )}
            {current.askedRatePaise === null ? null : (
              <Field label={t('o3.askedRate')}>
                <Money value={current.askedRatePaise} size="moneyM" tone="critical" />
              </Field>
            )}
            {current.note === null ? null : <Field label={t('o3.note')}>{current.note}</Field>}
            <TextInput
              label={t('o3.note')}
              value={note}
              onChange={setNote}
              capitalize="sentences"
              testID="approval-note"
            />
            <Button
              label={t('o3.approve')}
              variant="primary"
              shortcut="1"
              onPress={() => {
                setConfirm('approve')
              }}
              testID="approval-approve"
            />
            <Button
              label={t('o3.reject')}
              variant="destructive"
              shortcut="2"
              disabled={note.trim() === ''}
              disabledReason={t('o3.rejectNeedsNote')}
              onPress={() => {
                setConfirm('reject')
              }}
              testID="approval-reject"
            />
          </Stack>
        )}
      </Sheet>

      <Dialog
        open={confirm !== null && current !== null}
        onClose={() => {
          setConfirm(null)
        }}
        title={
          confirm === 'approve'
            ? t('o3.confirmApprove', { what: current?.what ?? '' })
            : t('o3.confirmReject', { what: current?.what ?? '' })
        }
        body={
          <Panel>
            <Stack gap={2}>
              <Txt field="body" desk="body">
                {word(current?.kind)}
              </Txt>
              <Money value={current?.amountPaise ?? null} size="moneyM" />
              {note.trim() === '' ? null : (
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {note}
                </Txt>
              )}
            </Stack>
          </Panel>
        }
        confirmLabel={confirm === 'approve' ? t('o3.approve') : t('o3.reject')}
        destructive={confirm === 'reject'}
        busy={busy}
        onConfirm={commit}
        testID="approval-confirm"
      />
    </Screen>
  )
}
