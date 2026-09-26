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
 *
 * A TRIP SETTLEMENT (QA DOS-235) is named by its trip and vehicle, and its panel shows what the desk counted:
 * the cash the crew should hand over and how it is made up, what was handed over, the difference against the
 * owner's own allowance, and every lot of the van that did not tally with its value at cost. Approving it
 * SETTLES THE TRIP in the same step — the dialog says so, and the toast states the trip's new state from the
 * server's reply. A refusal (the figures moved since the count, say) is printed in the dialog, which stays open.
 */
import type { ApprovalTripSettlement } from '@dos/contracts'
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
  useGo,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import {
  orderLabel,
  resolutionOf,
  type OrderResolution,
} from '../../src/groups/owner/lib/bargain-order'
import { Async, Field, PageTabs, Panel, textColumn, useNames } from '../../src/groups/owner/lib/ui'
import { instantWithClock, shortDate } from '../../src/groups/owner/lib/dates'
import { Refusal, stayOpen } from '../../src/groups/owner/lib/refusal'
import {
  cashBeyondTolerance,
  cashOff,
  stockSummary,
  tripName,
  tripOf,
} from '../../src/groups/owner/lib/trip-settlement'
import { useWord } from '../../src/groups/owner/lib/words'
import { useRegisterKeys, useHotkeys } from '../../src/groups/owner/lib/keys'

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
  /** DOS-235: the trip, its cash and its van count, on a trip settlement; null for every other kind. */
  trip: ApprovalTripSettlement | null
}

/** A payload value, when it is text. */
const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null)

export default function Approvals(): React.JSX.Element {
  const go = useGo()
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

  /*
   * DOS-090: a rate request names the order id the REP'S PHONE minted, and the draft is placed under
   * that same id later — which is how the request gates that one order and no other. Until it is
   * placed `orders.get` answers 404, so this row used to show no order at all. One settled read per
   * distinct id on the page (at most the 100 above), cached for a minute; a 404 is an ANSWER here.
   */
  const rateOrderIds = [
    ...new Set(
      (bargains.data?.items ?? [])
        .map((row) => row.orderId)
        .filter((id): id is string => id !== null),
    ),
  ]
  const rateOrders = useQuery(
    ['orders', 'rate-requests', rateOrderIds.join(',')],
    async (): Promise<[string, OrderResolution][]> => {
      const settled = await Promise.allSettled(rateOrderIds.map((id) => api.api.orders.get({ id })))
      return rateOrderIds.map((id, i) => {
        const answer = settled[i]
        if (answer === undefined || answer.status === 'rejected') return [id, { kind: 'missing' }]
        return [
          id,
          { kind: 'found', orderNo: answer.value.item.orderNo, state: answer.value.item.state },
        ]
      })
    },
    { enabled: rateOrderIds.length > 0, staleTime: 60_000 },
  )
  const resolvedRateOrders = new Map<string, OrderResolution>(rateOrders.data ?? [])

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
      const trip = tripOf(row)
      return bargain === undefined
        ? {
            id: row.id,
            stream: 'approval',
            kind: row.kind,
            what: trip === null ? (row.retailerName ?? word(row.kind)) : tripName(trip),
            who: names.staff(row.requestedBy),
            askedAt: row.createdAt,
            amountPaise: trip === null ? row.orderTotalPaise : trip.cashVariancePaise,
            listRatePaise: null,
            askedRatePaise: null,
            orderId: row.orderId,
            orderNo: row.orderNo,
            orderTotalPaise: row.orderTotalPaise,
            retailerId: row.retailerId,
            reason: textOf(row.payload.reason) ?? textOf(row.payload.note),
            trip,
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
            trip: null,
          }
    }),
    ...(bargains.data?.items ?? [])
      .filter((row) => !gated.has(row.id))
      .map<Decision>((row) => ({
        id: row.id,
        stream: 'bargain',
        kind: 'bargain',
        // DOS-090: the shop, and which order this rate is for — "not placed yet" while it is on the phone.
        what: [
          names.retailer(row.retailerId),
          orderLabel(resolutionOf(row.orderId, resolvedRateOrders), t),
        ]
          .filter((part): part is string => part !== null && part !== '')
          .join(' · '),
        who: names.staff(row.requestedBy),
        askedAt: row.createdAt,
        amountPaise: row.askedRatePaise,
        listRatePaise: row.listRatePaise,
        askedRatePaise: row.askedRatePaise,
        // The id the request names, even when the server has no such order yet: the label says so and
        // nothing links to it.
        orderId: row.orderId,
        orderNo: null,
        orderTotalPaise: null,
        retailerId: null,
        reason: row.note,
        trip: null,
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
    // One intent, one idempotency key: a retry of THIS decision can never write a second row.
    if (current.stream === 'approval') {
      void decideApproval.mutateAsync(input).then((result) => {
        done()
        /*
         * DOS-235: a trip settlement's decision says what happened to the TRIP, read off the reply — "settled
         * with a variance" only when the server says the trip is settled, never because Approve was pressed.
         */
        if (result.trip !== null && result.trip !== undefined) {
          const name = result.trip.tripNo ?? result.trip.id.slice(0, 8)
          if (result.trip.state === 'settled_with_variance' || result.trip.state === 'settled')
            setToast(t('o3t.settled', { trip: name }))
          else if (input.decision === 'reject') setToast(t('o3t.sentBack', { trip: name }))
          return
        }
        /*
         * DOS-155: the order AFTER the decision, from the reply itself. It is `confirmed` only when
         * this was the last gate, so the toast states what actually happened rather than what the
         * screen expected. `pricing.bargains.decide` answers `{ item }` with no order and confirms
         * nothing, which is why only this branch says anything.
         */
        if (result.order?.state === 'confirmed')
          setToast(t('o3.orderConfirmed', { order: result.order.orderNo ?? '' }))
      }, stayOpen)
      return
    }
    void decideBargain.mutateAsync(input).then(done, stayOpen)
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
      chips={<PageTabs group={go.href('/')} active={go.href('/approvals')} />}
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
                      const href = go.href(`/orders?q=${encodeURIComponent(current.orderNo ?? '')}`)
                      setSelected(null)
                      router.push(href)
                    }}
                    testID="approval-open-order"
                  />
                </Stack>
              </Field>
            )}
            {current.trip === null ? null : <TripSettlementFacts trip={current.trip} />}
            {current.kind === 'trip_settlement' && current.trip === null ? (
              <Txt field="body" desk="body" color={colors.status.brick.fg}>
                {t('o3t.unreadable')}
              </Txt>
            ) : null}
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
              {current?.trip !== null && current?.trip !== undefined ? (
                <TripSettlementConsequence trip={current.trip} decision={confirm} />
              ) : null}
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
                      const href = go.href(`/shops?q=${encodeURIComponent(current.what)}`)
                      setConfirm(null)
                      setSelected(null)
                      router.push(href)
                    }}
                    testID="approval-change-limit"
                  />
                </Stack>
              ) : null}
              <Refusal
                of={[decideApproval, decideBargain]}
                scope={current?.id ?? null}
                testID="approval-refusal"
              />
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

/**
 * DOS-235: what the desk counted, as the owner reads it before deciding — the trip, the cash made up and
 * handed over, the difference against the owner's own allowance, the other money taken, and every lot of the
 * van that did not tally with its value at that batch's cost. Every figure is the server's.
 */
function TripSettlementFacts({ trip }: { trip: ApprovalTripSettlement }): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const off = cashOff(trip)
  const stock = stockSummary(trip)
  const rupees = (value: number | null): string => (value === null ? '—' : formatINR(paise(value)))
  return (
    <Stack gap={4} testID="approval-trip">
      <Field label={t('o3t.trip')}>
        {t('o3t.tripLine', { trip: tripName(trip), date: shortDate(trip.tripDate) })}
      </Field>
      <Field label={t('o3t.expected')}>
        <Stack gap={1}>
          <Money value={trip.expectedCashPaise} size="moneyM" testID="approval-trip-expected" />
          {trip.cashCollectedPaise === null ? null : (
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('o3t.expectedHow', {
                float: rupees(trip.openingCashPaise),
                taken: rupees(trip.cashCollectedPaise),
                spent: rupees(trip.expensesPaise),
              })}
            </Txt>
          )}
        </Stack>
      </Field>
      <Field label={t('o3t.handed')}>
        <Money value={trip.handedOverCashPaise} size="moneyM" testID="approval-trip-handed" />
      </Field>
      <Field label={t('o3t.difference')}>
        <Stack gap={1}>
          <Txt
            field="bodyStrong"
            desk="body"
            color={cashBeyondTolerance(trip) ? colors.status.brick.fg : undefined}
            testID="approval-trip-difference"
          >
            {off === 'exact'
              ? t('o3t.exact')
              : t(off === 'short' ? 'o3t.short' : 'o3t.over', {
                  amount: rupees(Math.abs(trip.cashVariancePaise)),
                })}
          </Txt>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('o3t.allowed', { amount: rupees(trip.tolerancePaise) })}
          </Txt>
        </Stack>
      </Field>
      {trip.upiCollectedPaise === null && trip.chequeCollectedPaise === null ? null : (
        <Field label={t('o3t.otherMoney')}>
          {t('o3t.otherMoneyLine', {
            upi: rupees(trip.upiCollectedPaise),
            cheques: rupees(trip.chequeCollectedPaise),
          })}
        </Field>
      )}
      <Field label={t('o3t.stock')}>
        {stock.lots === 0 ? (
          <Txt field="body" desk="body" testID="approval-trip-stock-tallies">
            {t('o3t.stockTallies')}
          </Txt>
        ) : (
          <Stack gap={3} testID="approval-trip-stock">
            {trip.stockVariance.map((line) => (
              <Stack key={line.lotId} gap={1} border="bottom" borderTone="faint" padY={1}>
                <Txt field="bodyStrong" desk="body">
                  {line.batchNo === null
                    ? line.variantName
                    : `${line.variantName} · ${line.batchNo}`}
                </Txt>
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {t('o3t.stockLine', { expected: line.expectedPcs, counted: line.countedPcs })}
                </Txt>
                <Txt
                  field="body"
                  desk="body"
                  color={line.deltaPcs < 0 ? colors.status.brick.fg : undefined}
                >
                  {[
                    line.deltaPcs < 0
                      ? t('o3t.missing', { count: -line.deltaPcs })
                      : t('o3t.extra', { count: line.deltaPcs }),
                    line.valuePaise === null
                      ? t('o3t.noCost')
                      : t('o3t.atCost', { value: rupees(Math.abs(line.valuePaise)) }),
                  ].join(' · ')}
                </Txt>
              </Stack>
            ))}
            <Txt field="bodyStrong" desk="body" testID="approval-trip-stock-total">
              {t('o3t.stockTotal', {
                missing: stock.missingPcs,
                value:
                  stock.valuePaise === null ? t('o3t.noCost') : rupees(Math.abs(stock.valuePaise)),
              })}
            </Txt>
          </Stack>
        )}
      </Field>
    </Stack>
  )
}

/** DOS-235: what the decision DOES to the trip, said in the confirm dialog before it happens. */
function TripSettlementConsequence({
  trip,
  decision,
}: {
  trip: ApprovalTripSettlement
  decision: 'approve' | 'reject' | null
}): React.JSX.Element {
  const t = useStrings()
  const name = trip.tripNo ?? trip.tripId.slice(0, 8)
  if (decision !== 'approve')
    return (
      <Txt field="bodyStrong" desk="body" testID="approval-trip-consequence">
        {t('o3t.rejectSays', { trip: name })}
      </Txt>
    )
  const off = cashOff(trip)
  const stock = stockSummary(trip)
  const rupees = (value: number): string => formatINR(paise(Math.abs(value)))
  return (
    <Stack gap={1} testID="approval-trip-consequence">
      <Txt field="bodyStrong" desk="body">
        {t('o3t.approveCash', {
          trip: name,
          cash:
            off === 'exact'
              ? t('o3t.exact').toLowerCase()
              : t(off === 'short' ? 'o3t.short' : 'o3t.over', {
                  amount: rupees(trip.cashVariancePaise),
                }),
        })}
      </Txt>
      {stock.missingPcs === 0 ? null : (
        <Txt field="body" desk="body">
          {t('o3t.approveStock', {
            count: stock.missingPcs,
            value: stock.valuePaise === null ? t('o3t.noCost') : rupees(stock.valuePaise),
          })}
        </Txt>
      )}
      {stock.extraPcs === 0 ? null : (
        <Txt field="body" desk="body">
          {t('o3t.approveExtra', { count: stock.extraPcs })}
        </Txt>
      )}
      <Txt field="body" desk="body">
        {t('o3t.approveBank')}
      </Txt>
    </Stack>
  )
}
