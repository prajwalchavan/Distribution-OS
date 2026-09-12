/**
 * M2 — the order queue, submitted → confirmed (docs/23 §2.1, drawn in UX-00 §9.2).
 *
 * The one thing this screen exists to do that the owner's register does not: put **the credit
 * statement in one line at the point of confirming** (UX-01 M4) — "Owes ₹18,400 · oldest 22 days ·
 * limit ₹26,800 — this order takes it ₹3,200 over". `receivables.creditCheck` answers exactly that
 * for the selected order, with its own total, so the decision and the fact are on one screen.
 *
 * Confirm is server-authoritative, never optimistic and has no undo (UX-00 §9.2): it is the stock
 * check that reserves, and the order machine leaves `confirmed` only through `start_picking` or
 * `cancel`. A mistaken confirm is a cancel with a reason, which is why the dialog says so.
 *
 * The accountant reads this queue and decides nothing on it: `orders.confirm`, `orders.cancel`
 * (back office writes) and both `decide` procedures are owner + manager in the matrix, so the
 * buttons are ABSENT for that role rather than greyed.
 */
import type { Order } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Dialog,
  Money,
  Register,
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
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'

import {
  Async,
  ExportButton,
  Field,
  PageTabs,
  Panel,
  RangeSegments,
  moneyColumn,
  pageTotal,
  pagedCount,
  textColumn,
  useCan,
  useNames,
} from '../../src/lib/ui'
import { longDate, rangeOf, shortInstant, type RangeId } from '../../src/lib/dates'
import { useHotkeys, useRegisterKeys } from '../../src/lib/keys'
import { useWord } from '../../src/lib/words'

const STATE_FAMILY: Readonly<Record<string, StatusFamily>> = {
  draft: 'neutral',
  submitted: 'ochre',
  confirmed: 'moss',
  picking: 'ochre',
  packed: 'ochre',
  dispatched: 'ochre',
  delivered: 'moss',
  cancelled: 'neutral',
  closed: 'moss',
}

const STATES = ['submitted', 'confirmed', 'picking', 'packed', 'dispatched', 'cancelled'] as const
type OrderState = (typeof STATES)[number]

export default function OrderQueue(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayDecide = can('orders.confirm')
  const params = useLocalSearchParams<{ q?: string }>()
  const [range, setRange] = useState<RangeId>('d30')
  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '')
  const [states, setStates] = useState<readonly OrderState[]>(['submitted'])
  const [selected, setSelected] = useState<string | null>(null)
  const [acting, setActing] = useState<'confirm' | 'cancel' | 'release' | null>(null)
  const [reason, setReason] = useState('')

  const span = rangeOf(range)
  /*
   * A search from the header carries the order number a person is holding, and that order is as
   * likely to be from May as from this week — so a number search looks at every date rather than
   * being silently hidden by the window the register opens on. The filter chip says which it is.
   */
  const searching = q !== ''
  const list = useQuery(
    ['orders', 'list', searching ? q : `${span.from}:${span.to}`, states.join(',')],
    () =>
      api.api.orders.list({
        ...(searching ? { q } : { from: span.from, to: span.to }),
        limit: 200,
        ...(states.length === 1 ? { state: states[0] } : {}),
        ...(states.length > 1 ? { states: [...states] } : {}),
      }),
  )

  const detail = useQuery(
    ['orders', 'get', selected ?? 'none'],
    () => api.api.orders.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const order = detail.data?.item
  /*
   * The gates this order still waits on (DOS-020). Confirm never decides them — the server refuses a confirm
   * while any is pending — so each one is approved or rejected by name in the panel, and the last approval is
   * what confirms the order.
   */
  const waitingOn = (order?.approvals ?? []).filter((a) => a.status === 'pending')

  /*
   * The credit line of UX-01 M4. It is asked with THIS order's own total, so `headroomPaise` is the
   * headroom AFTER the order — the number the manager is actually deciding about.
   */
  const credit = useQuery(
    ['credit', order?.retailerId ?? 'none', order?.totalPaise ?? 0],
    () =>
      api.api.receivables.creditCheck({
        retailerId: order?.retailerId ?? '',
        orderTotalPaise: order?.totalPaise ?? 0,
      }),
    { enabled: order !== undefined },
  )

  const reservations = useQuery(
    ['warehouse', 'reservations', selected ?? 'none'],
    () => api.api.warehouse.reservations.list({ orderId: selected ?? '', state: 'pending' }),
    { enabled: selected !== null && can('warehouse.reservations.list') },
  )

  const approvals = useQuery(['approvals', 'pending'], () =>
    api.api.orders.approvals.list({ status: 'pending', limit: 20 }),
  )
  const bargains = useQuery(['bargains', 'requested'], () =>
    api.api.pricing.bargains.list({ status: 'requested', limit: 20 }),
  )

  const confirmOrder = useMutation(
    (id: string, meta) => api.api.orders.confirm({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['orders'], ['warehouse'], ['billing'], ['reporting']] },
  )
  const cancelOrder = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.orders.cancel({
        id: input.id,
        reason: input.reason,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['orders'], ['warehouse'], ['reporting']] },
  )
  const release = useMutation(
    (input: { orderId: string; reason: string }, meta) =>
      api.api.warehouse.reservations.release({
        orderId: input.orderId,
        reason: input.reason,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['warehouse'], ['orders']] },
  )
  const decideApproval = useMutation(
    (input: { id: string; decision: 'approve' | 'reject'; note: string }, meta) =>
      api.api.orders.approvals.decide({
        id: input.id,
        decision: input.decision,
        ...(input.note === '' ? {} : { note: input.note }),
        idempotencyKey: meta.idempotencyKey,
      }),
    /* The last approval confirms the order and reserves its stock, so it refreshes what a confirm does. */
    { invalidates: [['approvals'], ['orders'], ['warehouse'], ['billing'], ['reporting']] },
  )
  const decideBargain = useMutation(
    (input: { id: string; decision: 'approve' | 'reject'; note: string }, meta) =>
      api.api.pricing.bargains.decide({
        id: input.id,
        decision: input.decision,
        ...(input.note === '' ? {} : { note: input.note }),
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['bargains'], ['orders']] },
  )

  const rows = list.data?.items ?? []
  /* A capped page's footer states the page, not the register: "100+ rows" and the page's own sum. */
  const page = pagedCount(list)

  const columns: readonly RegisterColumn<Order>[] = [
    textColumn('orderNo', t('m2.orderNo'), (row) => row.orderNo, { priority: 'identity' }),
    textColumn('shop', t('m2.shop'), (row) => names.retailer(row.retailerId)),
    /*
     * A line COUNT is what UX-00 §9.2 draws here and `orders.list` does not carry one (only
     * `orders.get` has the lines) — asking per row would be one request per row. The rep is what the
     * list row does carry and what the desk asks about next, so the column states that instead; the
     * gap is recorded rather than papered over with a derived number.
     */
    textColumn('rep', t('m21.rep'), (row) => names.staff(row.salespersonId)),
    moneyColumn('total', t('m2.value'), (row) => row.totalPaise),
    {
      key: 'state',
      head: t('m2.state'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.state)} family={STATE_FAMILY[row.state] ?? 'neutral'} />
      ),
    },
    textColumn('flags', t('m2.flags'), (row) =>
      row.approvalFlags.length === 0 ? null : row.approvalFlags.map(word).join(', '),
    ),
    textColumn('placed', t('m2.placed'), (row) => shortInstant(row.submittedAt ?? row.createdAt)),
  ]

  useRegisterKeys({
    rows,
    rowKey: (row) => row.id,
    selected,
    onSelect: (row) => {
      setSelected(row.id)
    },
    enabled: acting === null,
  })
  useHotkeys({
    Escape: () => {
      if (acting !== null) setActing(null)
      else setSelected(null)
    },
    ...(mayDecide && order !== undefined
      ? {
          1: () => {
            if (order.state === 'submitted' && waitingOn.length === 0) setActing('confirm')
          },
          2: () => {
            setActing('cancel')
          },
        }
      : {}),
  })

  const commit = (): void => {
    if (order === undefined || acting === null) return
    const done = (): void => {
      setActing(null)
      setReason('')
    }
    if (acting === 'confirm') void confirmOrder.mutateAsync(order.id).then(done, done)
    if (acting === 'cancel')
      void cancelOrder.mutateAsync({ id: order.id, reason: reason.trim() }).then(done, done)
    if (acting === 'release')
      void release.mutateAsync({ orderId: order.id, reason: reason.trim() }).then(done, done)
  }

  /** The one credit sentence UX-01 M4 asks for, built from `creditCheck`'s own fields. */
  const creditLine = (): string => {
    const c = credit.data
    if (c === undefined) return t('m2.creditUnknown')
    if (c.creditMode === 'stop' && c.breached) return t('m2.creditBlocked')
    const head = t('m2.creditLine', {
      owed: formatINR(paise(c.outstandingPaise)),
      limit: c.creditLimitPaise === null ? t('app.none') : formatINR(paise(c.creditLimitPaise)),
    })
    if (!c.breached) return `${head} · ${t('m2.creditClear')}`
    const over = c.headroomPaise < 0 ? -c.headroomPaise : 0
    return `${head} · ${t('m2.creditOver', { over: formatINR(paise(over)) })}`
  }

  const waiting = [
    ...(approvals.data?.items ?? []).map((row) => ({
      id: row.id,
      kind: 'approval' as const,
      what: typeof row.payload.orderNo === 'string' ? row.payload.orderNo : word(row.kind),
      why: word(row.kind),
      amount: typeof row.payload.totalPaise === 'number' ? row.payload.totalPaise : null,
    })),
    ...(bargains.data?.items ?? []).map((row) => ({
      id: row.id,
      kind: 'bargain' as const,
      what: names.retailer(row.retailerId),
      why: t('m2.askedRate'),
      amount: row.askedRatePaise,
    })),
  ]

  const [deciding, setDeciding] = useState<{
    id: string
    kind: 'approval' | 'bargain'
    decision: 'approve' | 'reject'
    what: string
  } | null>(null)
  const [note, setNote] = useState('')

  const commitDecision = (): void => {
    if (deciding === null) return
    const done = (): void => {
      setDeciding(null)
      setNote('')
    }
    const input = { id: deciding.id, decision: deciding.decision, note: note.trim() }
    if (deciding.kind === 'approval') void decideApproval.mutateAsync(input).then(done, done)
    else void decideBargain.mutateAsync(input).then(done, done)
  }

  return (
    <Screen
      title={t('m2.title')}
      chips={<PageTabs group="/orders" active="/orders" />}
      actions={
        <>
          <RangeSegments
            value={range}
            onChange={(id) => {
              setRange(id as RangeId)
            }}
            testID="orders-range"
          />
          <ExportButton
            register="dailySales"
            filters={{ from: span.from, to: span.to }}
            testID="orders-export"
          />
        </>
      }
    >
      <Stack gap={6}>
        <Stack gap={4}>
          <Chips
            testID="orders-states"
            items={STATES.map((state) => ({
              id: state,
              label: word(state),
              selected: states.includes(state),
            }))}
            onToggle={(id) => {
              setStates((current) =>
                current.includes(id as OrderState)
                  ? current.filter((s) => s !== id)
                  : [...current, id as OrderState],
              )
            }}
          />

          <Async state={[list]} rows={10} empty={rows.length === 0} emptyMessage={t('m2.empty')}>
            <Register
              testID="orders-register"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              frozen="orderNo"
              selectedKey={selected}
              onSelect={(row) => {
                setSelected(row.id)
              }}
              state="ready"
              filters={[
                ...(searching ? [{ id: 'q', label: t('app.searchFilter', { query: q }) }] : []),
                ...states.map((state) => ({ id: state, label: word(state) })),
              ]}
              onClearFilters={() => {
                setStates([])
                setQ('')
              }}
              totals={{
                orderNo: page.more
                  ? t('m1.rowsMore', { count: rows.length })
                  : t('app.rows', { count: rows.length }),
                /* Only when the whole queue is on the page — see `pageTotal`. */
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
          {/*
           * The hint states only the keys THIS role has. `1` and `2` are bound behind `mayDecide`,
           * so on the accountant's screen — where the matrix withholds `orders.confirm` and no
           * Confirm or Cancel button is drawn — the line still read "1 confirm · 2 cancel" and two
           * of its four promises were dead.
           */}
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {mayDecide ? t('m2.keys') : t('m2.keysRead')}
          </Txt>
        </Stack>

        <Panel title={t('m2.approvals')} testID="orders-approvals">
          <Async
            state={[approvals, bargains]}
            rows={4}
            empty={waiting.length === 0}
            emptyMessage={t('m2.empty')}
          >
            <Stack gap={3}>
              {waiting.map((row) => (
                <Stack key={row.id} gap={2} border="bottom" borderTone="faint" padY={2}>
                  <Txt field="body" desk="body" numberOfLines={1}>
                    {row.what}
                  </Txt>
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {row.why}
                  </Txt>
                  <Money value={row.amount} size="cell" />
                  {mayDecide ? (
                    <Stack gap={2}>
                      <Button
                        label={t('m2.approve')}
                        variant="primary"
                        onPress={() => {
                          setDeciding({
                            id: row.id,
                            kind: row.kind,
                            decision: 'approve',
                            what: row.what,
                          })
                        }}
                      />
                      <Button
                        label={t('m2.reject')}
                        variant="destructive"
                        onPress={() => {
                          setDeciding({
                            id: row.id,
                            kind: row.kind,
                            decision: 'reject',
                            what: row.what,
                          })
                        }}
                      />
                    </Stack>
                  ) : (
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {t('app.accountantRead')}
                    </Txt>
                  )}
                </Stack>
              ))}
            </Stack>
          </Async>
        </Panel>
      </Stack>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={order === undefined ? undefined : t('m2.detail', { no: order.orderNo ?? '' })}
        testID="order-panel"
      >
        <Async state={[detail]} rows={6}>
          {order === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('m2.shop')}>{names.retailer(order.retailerId)}</Field>
              <Field label={t('m2.credit')}>
                <Txt
                  field="body"
                  desk="body"
                  color={credit.data?.breached === true ? colors.status.brick.fg : undefined}
                  testID="order-credit-line"
                >
                  {creditLine()}
                </Txt>
              </Field>
              {/*
               * DOS-020: each pending gate by name, decided here with a note. The buttons follow the
               * procedure they call, so the accountant reads the list and decides nothing; a credit gate's
               * decision dialog carries the credit sentence, because deciding it is what releases the order.
               */}
              {waitingOn.length === 0 ? null : (
                <Field label={t('m2.flags')}>
                  <Stack gap={2} testID="order-waiting-on">
                    {waitingOn.map((gate) => {
                      const what = `${order.orderNo ?? ''} · ${word(gate.kind)}${
                        gate.kind === 'credit_limit' ? ` · ${creditLine()}` : ''
                      }`
                      return (
                        <Stack key={gate.id} gap={2} border="bottom" borderTone="faint" padY={2}>
                          <Txt field="body" desk="body">
                            {word(gate.kind)}
                          </Txt>
                          {can('orders.approvals.decide') ? (
                            <Stack gap={2}>
                              <Button
                                label={t('m2.approve')}
                                variant="primary"
                                onPress={() => {
                                  setDeciding({
                                    id: gate.id,
                                    kind: 'approval',
                                    decision: 'approve',
                                    what,
                                  })
                                }}
                                testID={`order-approve-${gate.kind}`}
                              />
                              <Button
                                label={t('m2.reject')}
                                variant="destructive"
                                onPress={() => {
                                  setDeciding({
                                    id: gate.id,
                                    kind: 'approval',
                                    decision: 'reject',
                                    what,
                                  })
                                }}
                                testID={`order-reject-${gate.kind}`}
                              />
                            </Stack>
                          ) : null}
                        </Stack>
                      )
                    })}
                  </Stack>
                </Field>
              )}
              <Field label={t('m2.state')}>
                <StatusChip
                  label={word(order.state)}
                  family={STATE_FAMILY[order.state] ?? 'neutral'}
                />
              </Field>
              <Field label={t('m2.terms')}>{word(order.paymentTerms)}</Field>
              <Field label={t('m2.expected')}>{longDate(order.expectedDeliveryDate)}</Field>

              <Panel title={t('m2.lines')}>
                <Stack gap={2}>
                  {order.lines.map((line) => (
                    <Stack key={line.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {`${String(line.enteredQty)} ${word(line.enteredUnit)} · ${String(line.qtyPcs)} ${word('pcs')}`}
                      </Txt>
                      {/*
                        A rule without a `rewardKind` (an override, a bargain) has no reward WORD,
                        and mapping it through `word()` printed a bare em dash under every line.
                        The rule's own kind is what that line is, so it is what prints.
                      */}
                      {line.appliedRules.length === 0 ? null : (
                        <Txt field="label" desk="meta" color={colors.text.secondary}>
                          {line.appliedRules
                            .map((rule) => word(rule.rewardKind ?? rule.kind))
                            .join(' · ')}
                        </Txt>
                      )}
                      <Money value={line.lineTotalPaise} size="cell" />
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              <Field label={t('m2.subtotal')}>
                <Money value={order.subtotalPaise} size="cell" />
              </Field>
              <Field label={t('m2.discount')}>
                <Money value={order.discountPaise} size="cell" />
              </Field>
              <Field label={t('m2.tax')}>
                <Money value={order.taxPaise} size="cell" />
              </Field>
              <Field label={t('m2.total')}>
                <Money value={order.totalPaise} size="moneyM" />
              </Field>

              {can('warehouse.reservations.list') ? (
                <Field label={t('m2.reservations')}>
                  {String(reservations.data?.items.length ?? 0)}
                </Field>
              ) : null}

              {mayDecide ? (
                <Stack gap={3}>
                  <Button
                    label={t('m2.confirm')}
                    variant="primary"
                    shortcut="1"
                    disabled={order.state !== 'submitted' || waitingOn.length > 0}
                    disabledReason={
                      order.state !== 'submitted'
                        ? t('m2.onlySubmitted')
                        : t('m2.decideFirst', {
                            what: waitingOn.map((a) => word(a.kind)).join(' · '),
                          })
                    }
                    onPress={() => {
                      setActing('confirm')
                    }}
                    testID="order-confirm"
                  />
                  {can('warehouse.reservations.release') ? (
                    <Button
                      label={t('m2.release')}
                      variant="secondary"
                      disabled={(reservations.data?.items.length ?? 0) === 0}
                      disabledReason={t('m2.nothingHeld')}
                      onPress={() => {
                        setActing('release')
                      }}
                    />
                  ) : null}
                  <Button
                    label={t('m2.cancel')}
                    variant="destructive"
                    shortcut="2"
                    disabled={order.state === 'cancelled' || order.state === 'delivered'}
                    disabledReason={t('m2.alreadyClosed')}
                    onPress={() => {
                      setActing('cancel')
                    }}
                    testID="order-cancel"
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
          acting === 'confirm'
            ? t('m2.confirm')
            : acting === 'release'
              ? t('m2.release')
              : t('m2.cancel')
        }
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {order?.orderNo ?? ''}
            </Txt>
            <Money value={order?.totalPaise ?? null} size="moneyM" />
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {acting === 'confirm' ? t('m2.confirmBody') : creditLine()}
            </Txt>
            {acting === 'confirm' ? (
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {creditLine()}
              </Txt>
            ) : null}
            {acting === 'confirm' ? null : (
              <TextInput
                label={t('m2.cancelReason')}
                value={reason}
                onChange={setReason}
                capitalize="sentences"
                testID="order-reason"
              />
            )}
          </Stack>
        }
        confirmLabel={
          acting === 'confirm'
            ? t('m2.confirm')
            : acting === 'release'
              ? t('m2.release')
              : t('m2.cancel')
        }
        destructive={acting === 'cancel'}
        busy={
          confirmOrder.status === 'pending' ||
          cancelOrder.status === 'pending' ||
          release.status === 'pending'
        }
        onConfirm={commit}
        testID="order-dialog"
      />

      <Dialog
        open={deciding !== null}
        onClose={() => {
          setDeciding(null)
        }}
        title={deciding?.decision === 'approve' ? t('m2.approve') : t('m2.reject')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {deciding?.what ?? ''}
            </Txt>
            <TextInput
              label={t('m2.decisionNote')}
              value={note}
              onChange={setNote}
              capitalize="sentences"
              helper={deciding?.decision === 'reject' ? t('m2.rejectNeedsNote') : undefined}
              testID="decision-note"
            />
          </Stack>
        }
        confirmLabel={deciding?.decision === 'approve' ? t('m2.approve') : t('m2.reject')}
        destructive={deciding?.decision === 'reject'}
        busy={decideApproval.status === 'pending' || decideBargain.status === 'pending'}
        onConfirm={commitDecision}
        testID="decision-dialog"
      />
    </Screen>
  )
}
