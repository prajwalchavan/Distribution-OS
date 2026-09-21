/**
 * O5 — the orders register and the order detail (docs/23 §1.1).
 *
 * The register is the ledger view of every order in the window; selecting a row opens the detail as a
 * side panel over the page (UX-00 §9.0 — a panel, not a third navigation level), where the owner can
 * confirm, cancel, release held stock and reach the bills the order became. `↑ ↓` move, `Enter`
 * opens, `Esc` closes; every mutation carries one idempotency key per intent.
 */
import type { Order } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  billLineQty,
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
  formatCount,
  useColors,
  useGo,
  useStrings,
  useViewport,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { platform } from '@dos/ui/platform'
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
  textColumn,
  useNames,
} from '../../../src/groups/owner/lib/ui'
import { Refusal, stayOpen } from '../../../src/groups/owner/lib/refusal'
import { rangeOf, shortInstant, longDate, type RangeId } from '../../../src/groups/owner/lib/dates'
import { waitingOnKinds } from '../../../src/groups/owner/lib/waiting-on'
import { readAllReservations, reservedPcs } from '../../../src/groups/owner/lib/reservations'
import { useHotkeys, useRegisterKeys } from '../../../src/groups/owner/lib/keys'
import { useWord } from '../../../src/groups/owner/lib/words'

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

/**
 * Why Cancel is off, or `null` when the desk may press it (QA DOS-138, DOS-139).
 *
 * The desk — owner or manager — cancels up to and INCLUDING picking (founder, 2026-09-13): the hold is
 * released and the picker's sheet shows the lines to put back. A packed order carries an issued GST
 * bill, so it is cancelled through that bill and goes with it; after dispatch the only correction is a
 * credit note. Saying which of the three it is beats the server's own 409, which the desk cannot act on.
 */
function cancelBlock(
  state: string,
): 'o5.alreadyClosed' | 'o5.cancelViaBill' | 'o5.afterDispatch' | null {
  if (state === 'cancelled' || state === 'closed') return 'o5.alreadyClosed'
  if (state === 'packed') return 'o5.cancelViaBill'
  if (state === 'dispatched' || state === 'delivered' || state === 'partially_delivered')
    return 'o5.afterDispatch'
  return null
}

const STATES = [
  'submitted',
  'confirmed',
  'picking',
  'packed',
  'dispatched',
  'delivered',
  'cancelled',
] as const
type OrderState = (typeof STATES)[number]

export default function Orders(): React.JSX.Element {
  const go = useGo()
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  /*
   * DOS-010: `<Register>` keeps three cells only — identity, chip, value — whenever it is not a real
   * table, and a row then read "SO-0689 · Delivered · 6,376.00" with no shop because the
   * Shop column is dropped. That is the web register below 1024 px AND the native register at EVERY
   * width: `ui/src/native/list.tsx` is "the phone rendering of the one props contract" and has no
   * table branch, so an Android tablet or an iPad at desk width is still cards with no Shop column to
   * fall back on. The shop rides in the identity cell for exactly that shell; where a real table is
   * drawn it has its own column and printing it twice would be the same defect the other way round.
   */
  const phone = useViewport().kind === 'phone' || platform.kind === 'native'

  const params = useLocalSearchParams<{ q?: string }>()
  const [range, setRange] = useState<RangeId>('d30')
  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '')
  const [states, setStates] = useState<readonly OrderState[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'confirm' | 'cancel' | 'release' | null>(null)
  const [reason, setReason] = useState('')

  const span = rangeOf(range)
  /*
   * A search from the header carries the order number a person is holding, and that order is as
   * likely to be from May as from this week — so a number search looks at every date rather than
   * being silently hidden by the 30-day window the register opens on. The chip says which it is.
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
  /*
   * DOS-130: every hold, not the first page of them. Holds are per LOT, so the pieces an order has
   * taken out of stock are the sum of `qtyPcs` over all of them, and a page cut off mid-way would
   * under-report the one figure the owner reads as a quantity.
   */
  const reservations = useQuery(
    ['warehouse', 'reservations', selected ?? 'none'],
    () =>
      readAllReservations((cursor) =>
        api.api.warehouse.reservations.list({
          orderId: selected ?? '',
          state: 'pending',
          limit: 200,
          ...(cursor === null ? {} : { cursor }),
        }),
      ),
    { enabled: selected !== null },
  )
  const bills = useQuery(
    ['invoices', 'byOrder', selected ?? 'none'],
    () => api.api.billing.invoices.list({ orderId: selected ?? '', limit: 20 }),
    { enabled: selected !== null },
  )
  /*
   * DOS-027: what each listed order is still held by. One page of the pending approvals queue, on
   * the key the Approvals screen opens with, so the two share a cached read; the stored
   * `approvalFlags` are the copy raised at submit and nothing keeps them in step with the decisions.
   */
  const gates = useQuery(['approvals', 'pending'], () =>
    api.api.orders.approvals.list({ status: 'pending', limit: 100 }),
  )

  const confirmOrder = useMutation(
    (id: string, meta) => api.api.orders.confirm({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['orders'], ['warehouse'], ['reporting']] },
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

  const rows = list.data?.items ?? []
  const order = detail.data?.item
  const pending = gates.data?.items ?? []
  /*
   * DOS-020: confirm never decides an approval, so an order still waiting on one is released on Approvals,
   * where the last approval confirms it — the button says so instead of answering a silent 409.
   */
  const waitingOn = (order?.approvals ?? []).filter((a) => a.status === 'pending')

  const columns: readonly RegisterColumn<Order>[] = [
    textColumn(
      'orderNo',
      t('o5.orderNo'),
      (row) =>
        phone ? `${row.orderNo ?? t('app.none')} · ${names.retailer(row.retailerId)}` : row.orderNo,
      { priority: 'identity' },
    ),
    textColumn('shop', t('o5.shop'), (row) => names.retailer(row.retailerId)),
    {
      key: 'state',
      head: t('o5.state'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.state)} family={STATE_FAMILY[row.state] ?? 'neutral'} />
      ),
    },
    moneyColumn('total', t('o5.value'), (row) => row.totalPaise),
    textColumn('flags', t('o5.flags'), (row) => {
      const kinds = waitingOnKinds(row, pending)
      return kinds.length === 0 ? null : kinds.map(word).join(' · ')
    }),
    textColumn('placed', t('o5.placed'), (row) => shortInstant(row.submittedAt ?? row.createdAt)),
  ]

  useRegisterKeys({
    rows,
    rowKey: (row) => row.id,
    selected,
    onSelect: (row) => {
      setSelected(row.id)
    },
    enabled: confirming === null,
  })
  useHotkeys({
    Escape: () => {
      if (confirming !== null) setConfirming(null)
      else setSelected(null)
    },
  })

  const commit = (): void => {
    if (order === undefined || confirming === null) return
    const done = (): void => {
      setConfirming(null)
      setReason('')
    }
    if (confirming === 'confirm') void confirmOrder.mutateAsync(order.id).then(done, stayOpen)
    if (confirming === 'cancel')
      void cancelOrder.mutateAsync({ id: order.id, reason: reason.trim() }).then(done, stayOpen)
    if (confirming === 'release')
      void release.mutateAsync({ orderId: order.id, reason: reason.trim() }).then(done, stayOpen)
  }

  return (
    <Screen
      title={t('o5.title')}
      chips={<PageTabs group={go.href('/orders')} active={go.href('/orders')} />}
      actions={
        <>
          <RangeSegments
            value={range}
            onChange={(id) => {
              setRange(id as RangeId)
            }}
            testID="orders-range"
          />
          {/*
            DOS-014: "Export CSV" on the orders register exports the ORDERS, not the daily-sales
            figures it used to queue, and it carries the filters on screen — the range, and the state
            chips. A number search keeps the range (the register is dated) and adds the query.
          */}
          <ExportButton
            register="orders"
            filters={{
              from: span.from,
              to: span.to,
              ...(searching ? { q } : {}),
              ...(states.length === 1 ? { state: states[0] } : {}),
              ...(states.length > 1 ? { states: [...states] } : {}),
            }}
            testID="orders-export"
          />
        </>
      }
    >
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
          onClear={
            states.length === 0
              ? undefined
              : () => {
                  setStates([])
                }
          }
        />

        <Async state={[list]} rows={10} empty={rows.length === 0} emptyMessage={t('o5.empty')}>
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
              orderNo: t('app.rows', { count: rows.length }),
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
      </Stack>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={order === undefined ? undefined : t('o5.detail', { no: order.orderNo ?? '' })}
        testID="order-panel"
      >
        <Async state={[detail]} rows={6}>
          {order === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('o5.shop')}>{names.retailer(order.retailerId)}</Field>
              <Field label={t('o5.state')}>
                <StatusChip
                  label={word(order.state)}
                  family={STATE_FAMILY[order.state] ?? 'neutral'}
                />
              </Field>
              <Field label={t('o5.terms')}>{word(order.paymentTerms)}</Field>
              <Field label={t('o5.expected')}>{longDate(order.expectedDeliveryDate)}</Field>

              <Panel title={t('o5.lines', { count: order.lines.length })}>
                <Stack gap={2}>
                  {order.lines.map((line) => (
                    <Stack key={line.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={2}>
                        {line.variantName}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {billLineQty(line, t)}
                      </Txt>
                      <Money value={line.lineTotalPaise} size="cell" />
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              <Field label={t('o5.subtotal')}>
                <Money value={order.subtotalPaise} size="cell" />
              </Field>
              <Field label={t('o5.discount')}>
                <Money value={order.discountPaise} size="cell" />
              </Field>
              <Field label={t('o5.tax')}>
                <Money value={order.taxPaise} size="cell" />
              </Field>
              <Field label={t('o5.total')}>
                <Money value={order.totalPaise} size="moneyM" />
              </Field>

              <Panel title={t('o5.reservations')}>
                <Stack gap={1}>
                  <Txt field="body" desk="cell" numeric>
                    {t('qty.piecesOnly', {
                      pieces: formatCount(reservedPcs(reservations.data ?? [])),
                    })}
                  </Txt>
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {(reservations.data ?? []).length === 1
                      ? t('o5.reservationsLot')
                      : t('o5.reservationsLots', { count: (reservations.data ?? []).length })}
                  </Txt>
                </Stack>
              </Panel>

              <Panel title={t('o5.bills')}>
                <Stack gap={1}>
                  {(bills.data?.items ?? []).map((bill) => (
                    <Txt key={bill.id} field="body" desk="cell">
                      {bill.invoiceNo}
                    </Txt>
                  ))}
                </Stack>
              </Panel>

              <Button
                label={t('o5.confirm')}
                variant="primary"
                disabled={order.state !== 'submitted' || waitingOn.length > 0}
                disabledReason={
                  waitingOn.length > 0
                    ? t('o5.decideFirst', { what: waitingOn.map((a) => word(a.kind)).join(' · ') })
                    : t('o5.state')
                }
                onPress={() => {
                  setConfirming('confirm')
                }}
                testID="order-confirm"
              />
              <Button
                label={t('o5.release')}
                variant="secondary"
                disabled={(reservations.data ?? []).length === 0}
                disabledReason={t('o5.reservations')}
                onPress={() => {
                  setConfirming('release')
                }}
              />
              {/*
               * DOS-138 / DOS-139: Cancel used to be offered on every state but `cancelled` and
               * `delivered`, so a picking order answered the machine's raw refusal and a packed one
               * answered nothing the owner could act on. The desk may now cancel up to and including
               * picking (founder); a packed order goes with its bill, and after dispatch it is a
               * credit note.
               */}
              <Button
                label={t('o5.cancel')}
                variant="destructive"
                disabled={cancelBlock(order.state) !== null}
                disabledReason={t(cancelBlock(order.state) ?? 'o5.alreadyClosed')}
                onPress={() => {
                  setConfirming('cancel')
                }}
                testID="order-cancel"
              />
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {shortInstant(order.createdAt)}
              </Txt>
            </Stack>
          )}
        </Async>
      </Sheet>

      <Dialog
        open={confirming !== null}
        onClose={() => {
          setConfirming(null)
        }}
        title={
          confirming === 'confirm'
            ? t('o5.confirm')
            : confirming === 'release'
              ? t('o5.release')
              : t('o5.cancel')
        }
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {order?.orderNo ?? ''}
            </Txt>
            <Money value={order?.totalPaise ?? null} size="moneyM" />
            {confirming === 'cancel' && order?.state === 'picking' ? (
              <Txt field="label" desk="meta" color={colors.text.secondary} testID="order-picking">
                {t('o5.cancelPicking')}
              </Txt>
            ) : null}
            {confirming === 'confirm' ? null : (
              <TextInput
                label={t('o5.cancelReason')}
                value={reason}
                onChange={setReason}
                capitalize="sentences"
                testID="order-reason"
              />
            )}
            <Refusal
              of={[confirmOrder, cancelOrder, release]}
              scope={
                order === undefined || confirming === null ? null : `${order.id}:${confirming}`
              }
              testID="order-dialog-refusal"
            />
          </Stack>
        }
        confirmLabel={
          confirming === 'confirm'
            ? t('o5.confirm')
            : confirming === 'release'
              ? t('o5.release')
              : t('o5.cancel')
        }
        destructive={confirming === 'cancel'}
        busy={
          confirmOrder.status === 'pending' ||
          cancelOrder.status === 'pending' ||
          release.status === 'pending'
        }
        onConfirm={commit}
        testID="order-dialog"
      />
    </Screen>
  )
}
