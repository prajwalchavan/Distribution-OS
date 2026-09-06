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
  textColumn,
  useNames,
} from '../../src/lib/ui'
import { rangeOf, shortInstant, longDate, type RangeId } from '../../src/lib/dates'
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
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()

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
  const reservations = useQuery(
    ['warehouse', 'reservations', selected ?? 'none'],
    () => api.api.warehouse.reservations.list({ orderId: selected ?? '', state: 'pending' }),
    { enabled: selected !== null },
  )
  const bills = useQuery(
    ['invoices', 'byOrder', selected ?? 'none'],
    () => api.api.billing.invoices.list({ orderId: selected ?? '', limit: 20 }),
    { enabled: selected !== null },
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

  const columns: readonly RegisterColumn<Order>[] = [
    textColumn('orderNo', t('o5.orderNo'), (row) => row.orderNo, { priority: 'identity' }),
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
    textColumn('flags', t('o5.flags'), (row) => row.approvalFlags.map(word).join(', ')),
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
    if (confirming === 'confirm') void confirmOrder.mutateAsync(order.id).then(done, done)
    if (confirming === 'cancel')
      void cancelOrder.mutateAsync({ id: order.id, reason: reason.trim() }).then(done, done)
    if (confirming === 'release')
      void release.mutateAsync({ orderId: order.id, reason: reason.trim() }).then(done, done)
  }

  return (
    <Screen
      title={t('o5.title')}
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
              <Field label={t('o5.terms')}>{order.paymentTerms}</Field>
              <Field label={t('o5.expected')}>{longDate(order.expectedDeliveryDate)}</Field>

              <Panel title={t('o5.lines', { count: order.lines.length })}>
                <Stack gap={2}>
                  {order.lines.map((line) => (
                    <Stack key={line.id} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {`${String(line.enteredQty)} ${line.enteredUnit} · ${String(line.qtyPcs)} pc`}
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
                <Txt field="body" desk="cell" numeric>
                  {String(reservations.data?.items.length ?? 0)}
                </Txt>
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
                disabled={order.state !== 'submitted'}
                disabledReason={t('o5.state')}
                onPress={() => {
                  setConfirming('confirm')
                }}
                testID="order-confirm"
              />
              <Button
                label={t('o5.release')}
                variant="secondary"
                disabled={(reservations.data?.items.length ?? 0) === 0}
                disabledReason={t('o5.reservations')}
                onPress={() => {
                  setConfirming('release')
                }}
              />
              <Button
                label={t('o5.cancel')}
                variant="destructive"
                disabled={order.state === 'cancelled' || order.state === 'delivered'}
                disabledReason={t('o5.state')}
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
            {confirming === 'confirm' ? null : (
              <TextInput
                label={t('o5.cancelReason')}
                value={reason}
                onChange={setReason}
                capitalize="sentences"
                testID="order-reason"
              />
            )}
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
