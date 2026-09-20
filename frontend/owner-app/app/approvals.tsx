/**
 * O3 — the approvals queue (docs/23 §1.1, UX-00 §9.1 "Needs you").
 *
 * Two decision streams reach the same desk: an order flagged by the pricing engine or the credit
 * check (`orders.approvals.*`) and a rep asking for a rate below the floor (`pricing.bargains.*`).
 * They decide with the same two keys, so they are one queue with a segmented filter rather than two
 * screens — `j`/`k` move, `1` approves, `2` rejects (UX-00 §8.1), and every rejection carries its
 * reason because a decision without one is a decision nobody can act on (UX-02 R29).
 *
 * A bargain gate names the rate request it waits on, and deciding the gate decides that request (DOS-005), so
 * the pair is ONE row: the gate, carrying the request's shop and rates, listed under Rate requests as well.
 *
 * An approval on an order is named by that order's shop, number and total, which the list reads from the order
 * itself (DOS-004), and an over-limit gate shows the shop's live credit position, so nobody decides blind.
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
  Toast,
  Txt,
  formatINR,
  paise,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useRouter } from 'expo-router'
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
  /** The shop; the kind's own word for an approval with no order and no rate request behind it. */
  what: string
  who: string
  askedAt: string
  amountPaise: number | null
  listRatePaise: number | null
  askedRatePaise: number | null
  orderId: string | null
  orderNo: string | null
  orderTotalPaise: number | null
  retailerId: string | null
  /** What the person who asked wrote: an approval's reason or note, a rate request's note. */
  reason: string | null
}

/** A payload value, when it is text. */
const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null)

export default function Approvals(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const router = useRouter()
  const names = useNames()
  const word = useWord()

  const [stream, setStream] = useState<'all' | 'approval' | 'bargain'>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null)
  const [note, setNote] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const approvals = useQuery(['approvals', 'pending'], () =>
    api.api.orders.approvals.list({ status: 'pending', limit: 100 }),
  )
  /*
   * Every pending bargain gate, past the 100-row page: the requests list is oldest first and the approvals list
   * newest first, so a request can be on its page while its gate is not. Knowing every gate keeps that request
   * from showing alone, where deciding it would leave its order waiting on the gate.
   */
  const gates = useQuery(['approvals', 'pending', 'bargain'], () =>
    api.api.orders.approvals.list({ status: 'pending', kind: 'bargain', limit: 200 }),
  )
  const bargains = useQuery(['bargains', 'requested'], () =>
    api.api.pricing.bargains.list({ status: 'requested', limit: 100 }),
  )

  const pending = [
    ...new Map(
      [...(approvals.data?.items ?? []), ...(gates.data?.items ?? [])].map((row) => [row.id, row]),
    ).values(),
  ]
  const requested = new Map((bargains.data?.items ?? []).map((row) => [row.id, row]))
  const gated = new Set(
    pending.filter((row) => row.entityType === 'bargain_request').map((row) => row.entityId),
  )

  const rows: readonly Decision[] = [
    ...pending.map<Decision>((row) => {
      const bargain = row.entityType === 'bargain_request' ? requested.get(row.entityId) : undefined
      return bargain === undefined
        ? {
            id: row.id,
            stream: 'approval',
            kind: row.kind,
            what: row.retailerName ?? word(row.kind),
            who: names.staff(row.requestedBy),
            askedAt: row.createdAt,
            amountPaise: row.orderTotalPaise,
            listRatePaise: null,
            askedRatePaise: null,
            orderId: row.orderId,
            orderNo: row.orderNo,
            orderTotalPaise: row.orderTotalPaise,
            retailerId: row.retailerId,
            reason: textOf(row.payload.reason) ?? textOf(row.payload.note),
          }
        : {
            id: row.id,
            stream: 'approval',
            kind: row.kind,
            what: row.retailerName ?? names.retailer(bargain.retailerId),
            who: names.staff(row.requestedBy),
            askedAt: row.createdAt,
            amountPaise: bargain.askedRatePaise,
            listRatePaise: bargain.listRatePaise,
            askedRatePaise: bargain.askedRatePaise,
            orderId: row.orderId,
            orderNo: row.orderNo,
            orderTotalPaise: row.orderTotalPaise,
            retailerId: row.retailerId ?? bargain.retailerId,
            reason: bargain.note,
          }
    }),
    ...(bargains.data?.items ?? [])
      .filter((row) => !gated.has(row.id))
      .map<Decision>((row) => ({
        id: row.id,
        stream: 'bargain',
        kind: 'bargain',
        what: names.retailer(row.retailerId),
        who: names.staff(row.requestedBy),
        askedAt: row.createdAt,
        amountPaise: row.askedRatePaise,
        listRatePaise: row.listRatePaise,
        askedRatePaise: row.askedRatePaise,
        orderId: null,
        orderNo: null,
        orderTotalPaise: null,
        retailerId: null,
        reason: row.note,
      })),
  ].filter(
    (row) =>
      stream === 'all' || row.stream === stream || (stream === 'bargain' && row.kind === 'bargain'),
  )

  const current = rows.find((row) => row.id === selected) ?? null
  /** The shop and its order number: the panel's title and the name both dialogs decide. */
  const heading =
    current === null
      ? undefined
      : [current.what, current.orderNo].filter((p): p is string => p !== null).join(' · ')

  /*
   * An over-limit gate shows the shop's live credit position, asked with the order's own total so the headroom is
   * the headroom AFTER this order. The sentence is built from `reasons`, the breaches the server found, so a
   * credit stop still shows the figures and an overdue-only breach never reads as "₹0.00 over the limit".
   */
  const checksCredit =
    current?.kind === 'credit_limit' &&
    current.retailerId !== null &&
    current.orderTotalPaise !== null
  const credit = useQuery(
    ['credit', current?.retailerId ?? 'none', current?.orderTotalPaise ?? 0],
    () =>
      api.api.receivables.creditCheck({
        retailerId: current?.retailerId ?? '',
        orderTotalPaise: current?.orderTotalPaise ?? 0,
      }),
    { enabled: checksCredit },
  )
  const creditLine = (): string => {
    const c = credit.data
    if (c === undefined) return t('o3.creditUnknown')
    const parts = [
      t('o3.creditLine', {
        owed: formatINR(paise(c.outstandingPaise)),
        limit: formatINR(paise(c.creditLimitPaise)),
      }),
    ]
    if (c.creditMode === 'stop') parts.push(t('o3.creditStop'))
    if (c.reasons.includes('limit_exceeded'))
      parts.push(t('o3.creditOver', { over: formatINR(paise(-c.headroomPaise)) }))
    if (c.reasons.includes('overdue_days_exceeded'))
      parts.push(t('o3.creditOverdue', { days: c.overdueDays, terms: c.creditDays }))
    if (c.reasons.includes('bill_count_exceeded'))
      parts.push(t('o3.creditBills', { count: c.openBills, limit: c.creditLimitBills }))
    if (c.reasons.length === 0) parts.push(t('o3.creditClear'))
    return parts.join(' · ')
  }

  /*
   * DOS-155: is this gate the LAST one the order is waiting on?
   *
   * Approving the last gate confirms the order and reserves its stock (`approvals.service.ts:187`),
   * and the owner was never told. The answer comes from the ORDER's own approvals rather than the
   * page of pending rows on screen: a gate on another page would make "last" a guess, and the
   * sentence in the dialog is a promise. A rate request decided outside a gate names no order and
   * confirms nothing, so it is never the last of anything.
   */
  const gateOrder = useQuery(
    ['orders', 'get', current?.orderId ?? 'none'],
    () => api.api.orders.get({ id: current?.orderId ?? '' }),
    { enabled: current?.stream === 'approval' && current.orderId !== null },
  )
  const stillPending = (gateOrder.data?.item.approvals ?? []).filter((a) => a.status === 'pending')
  const lastGate =
    current !== null &&
    current.stream === 'approval' &&
    current.orderId !== null &&
    stillPending.length === 1 &&
    stillPending[0]?.id === current.id

  const decideApproval = useMutation(
    (input: { id: string; decision: 'approve' | 'reject'; note?: string }, meta) =>
      api.api.orders.approvals.decide({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        decision: input.decision,
        ...(input.note === undefined || input.note === '' ? {} : { note: input.note }),
      }),
    { invalidates: [['approvals'], ['bargains'], ['orders'], ['reporting']] },
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
    const done = (): void => {
      setConfirm(null)
      setNote('')
      setSelected(null)
    }
    const failed = (): void => {
      /* the error is on the mutation state and rendered under the dialog */
    }
    // One intent, one idempotency key: a retry of THIS decision can never write a second row.
    if (current.stream === 'approval') {
      void decideApproval.mutateAsync(input).then((result) => {
        done()
        /*
         * DOS-155: the order AFTER the decision, from the reply itself. It is `confirmed` only when
         * this was the last gate, so the toast states what actually happened rather than what the
         * screen expected. `pricing.bargains.decide` answers `{ item }` with no order and confirms
         * nothing, which is why only this branch says anything.
         */
        if (result.order?.state === 'confirmed')
          setToast(t('o3.orderConfirmed', { order: result.order.orderNo ?? '' }))
      }, failed)
      return
    }
    void decideBargain.mutateAsync(input).then(done, failed)
  }

  /*
   * DOS-153: the note belongs to the request it was typed for, and to no other.
   *
   * It was cleared only after a decision went through, so closing the panel without deciding left
   * the text in the box and the next request opened with another rep's sentence already typed in —
   * and sending it means sending it to the person who asked. Every way OUT of a request clears it:
   * the panel closing, and a different row being chosen (by tap or by `j`/`k`). Re-choosing the row
   * already open is not a change and never wipes what is being typed.
   */
  const openRow = (id: string): void => {
    if (id !== selected) setNote('')
    setSelected(id)
  }
  const closePanel = (): void => {
    setSelected(null)
    setNote('')
  }

  useRegisterKeys({
    rows,
    rowKey: (row) => row.id,
    selected,
    onSelect: (row) => {
      openRow(row.id)
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
        closePanel()
      },
    },
    true,
  )

  const columns: readonly RegisterColumn<Decision>[] = [
    textColumn('kind', t('o3.kind'), (row) => word(row.kind), { priority: 'chip' }),
    textColumn('what', t('o3.what'), (row) => row.what, { priority: 'identity' }),
    textColumn('order', t('o3.order'), (row) => row.orderNo),
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
          state={[approvals, gates, bargains]}
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
              openRow(row.id)
            }}
            state="ready"
          />
        </Async>
      </Stack>

      <Sheet
        open={current !== null && confirm === null}
        onClose={closePanel}
        title={heading}
        testID="approval-panel"
      >
        {current === null ? null : (
          <Stack gap={4}>
            <Field label={t('o3.kind')}>
              <StatusChip label={word(current.kind)} family="ochre" />
            </Field>
            <Field label={t('o7.person')}>{current.who}</Field>
            <Field label={t('o3.asked')}>{instantWithClock(current.askedAt)}</Field>
            {current.orderNo === null ? null : (
              <Field label={t('o3.order')}>
                <Stack gap={2}>
                  <Txt field="body" desk="body">
                    {current.orderNo}
                  </Txt>
                  <Money value={current.orderTotalPaise} size="moneyM" />
                  {/*
                   * The order's lines are read on the order itself, never re-derived here. The panel closes first:
                   * on a phone the sheet is a modal that would otherwise stay over the order it opened.
                   */}
                  <Button
                    label={t('o3.openOrder')}
                    variant="secondary"
                    onPress={() => {
                      const href = `/orders?q=${encodeURIComponent(current.orderNo ?? '')}`
                      setSelected(null)
                      router.push(href)
                    }}
                    testID="approval-open-order"
                  />
                </Stack>
              </Field>
            )}
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
            {current.reason === null ? null : (
              <Field label={t('o3.reason')}>{current.reason}</Field>
            )}
            {checksCredit ? <Field label={t('o3.credit')}>{creditLine()}</Field> : null}
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
            ? t('o3.confirmApprove', { what: heading ?? '' })
            : t('o3.confirmReject', { what: heading ?? '' })
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
              {/*
                DOS-155: the consequence, stated before it happens. Only on approve — rejecting a
                gate confirms nothing.
              */}
              {lastGate && confirm === 'approve' ? (
                <Txt field="bodyStrong" desk="body" testID="approval-last-gate">
                  {t('o3.lastGate', { order: current?.orderNo ?? '' })}
                </Txt>
              ) : null}
              {/*
                DOS-006: what approving an over-limit gate actually does, said before it happens.
                The founder's answer (docs/22 §8, 2026-09-13): it releases THIS order and leaves the
                shop's limit where it is — the limit is a setting on the shop's page. The owner used
                to read a "requested limit" the server never honoured, so the sentence names the
                order, its total and the limit that stays, and the button goes where it is changed.
                Only on approve: rejecting a gate releases nothing.
              */}
              {current?.kind === 'credit_limit' && confirm === 'approve' ? (
                <Stack gap={2}>
                  <Txt field="bodyStrong" desk="body" testID="approval-credit-release">
                    {t('o3.creditRelease', {
                      order: current.orderNo ?? '',
                      total: formatINR(paise(current.orderTotalPaise ?? 0)),
                      limit:
                        credit.data === undefined
                          ? t('o3.creditUnknown')
                          : formatINR(paise(credit.data.creditLimitPaise)),
                    })}
                  </Txt>
                  <Button
                    label={t('o3.changeLimit')}
                    variant="secondary"
                    onPress={() => {
                      const href = `/shops?q=${encodeURIComponent(current.what)}`
                      setConfirm(null)
                      setSelected(null)
                      router.push(href)
                    }}
                    testID="approval-change-limit"
                  />
                </Stack>
              ) : null}
            </Stack>
          </Panel>
        }
        confirmLabel={confirm === 'approve' ? t('o3.approve') : t('o3.reject')}
        destructive={confirm === 'reject'}
        busy={busy}
        onConfirm={commit}
        testID="approval-confirm"
      />

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="approval-toast"
      />
    </Screen>
  )
}
