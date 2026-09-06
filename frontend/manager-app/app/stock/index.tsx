/**
 * M16 — stock: what is on hand, what moved, and what is held (docs/23 §2.1).
 *
 * Three views of one truth. `stock_ledger` is append-only and the balances are DERIVED from it
 * (docs/22 never-list 3), so nothing here edits a balance: an adjustment posts a ledger row with a
 * reason, and a transfer posts a pair (out of one place, into another). That is why the adjust
 * dialog asks for a reason and a signed change rather than "what should it be".
 *
 * Near expiry is the register's own filter (`nearExpiryOnly`), not a date this screen worked out.
 *
 * A rupee is deliberately absent from this screen. Stock AT COST is `reporting.registers.stockValue`,
 * a back-office register that belongs with the money books; the godown's question is pieces.
 */
import type { LedgerEntry, ReservationRow, StockBalanceRow } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Dialog,
  Register,
  Screen,
  Segments,
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
  Panel,
  countText,
  pageTotal,
  pagedCount,
  textColumn,
  useCan,
  useNames,
} from '../../src/lib/ui'
import { daysUntil, longDate, shortInstant } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

type View = 'balances' | 'ledger' | 'held'
type AdjustReason = 'adjustment' | 'damage' | 'expiry_writeoff' | 'cycle_count'

/** Grey until it is a month out, ochre inside the month, brick once the date has passed. */
function expiryFamily(isoDate: string): StatusFamily {
  const days = daysUntil(isoDate)
  if (days < 0) return 'brick'
  if (days <= 30) return 'ochre'
  return 'neutral'
}

export default function Stock(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayAdjust = can('inventory.stock.adjust')
  const [view, setView] = useState<View>('balances')
  const [locationId, setLocationId] = useState<string | null>(null)
  const [nearExpiry, setNearExpiry] = useState(false)
  const [adjusting, setAdjusting] = useState<StockBalanceRow | null>(null)
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState<AdjustReason>('adjustment')
  const [note, setNote] = useState('')
  const [transferring, setTransferring] = useState<StockBalanceRow | null>(null)
  const [toLocation, setToLocation] = useState<string | null>(null)
  const [qty, setQty] = useState('')

  const locations = useQuery(['names', 'locations'], () => api.api.inventory.locations.list({}), {
    staleTime: 300_000,
  })
  const balances = useQuery(
    ['inventory', 'balances', locationId ?? 'all', nearExpiry ? 'near' : 'all'],
    () =>
      api.api.inventory.stock.balances({
        limit: 300,
        ...(locationId === null ? {} : { locationId }),
        ...(nearExpiry ? { nearExpiryOnly: true } : {}),
      }),
    { enabled: view === 'balances' },
  )
  const ledger = useQuery(
    ['inventory', 'ledger', locationId ?? 'all'],
    () =>
      api.api.inventory.stock.ledger({
        limit: 200,
        ...(locationId === null ? {} : { locationId }),
      }),
    { enabled: view === 'ledger' },
  )
  const held = useQuery(
    ['warehouse', 'reservations', 'all'],
    () => api.api.warehouse.reservations.list({ state: 'pending', limit: 200 }),
    { enabled: view === 'held' && can('warehouse.reservations.list') },
  )

  const adjust = useMutation(
    (
      input: {
        lotId: string
        locationId: string
        qtyDelta: number
        reason: AdjustReason
        note: string
      },
      meta,
    ) =>
      api.api.inventory.stock.adjust({
        idempotencyKey: meta.idempotencyKey,
        lotId: input.lotId,
        locationId: input.locationId,
        qtyDelta: input.qtyDelta,
        reason: input.reason,
        ...(input.note === '' ? {} : { note: input.note }),
      }),
    { invalidates: [['inventory'], ['reporting']] },
  )
  const transfer = useMutation(
    (
      input: { lotId: string; fromLocationId: string; toLocationId: string; qtyPcs: number },
      meta,
    ) =>
      api.api.inventory.stock.transfer({
        idempotencyKey: meta.idempotencyKey,
        lotId: input.lotId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        qtyPcs: input.qtyPcs,
      }),
    { invalidates: [['inventory']] },
  )

  const balanceColumns: readonly RegisterColumn<StockBalanceRow>[] = [
    textColumn('item', t('m16.item'), (row) => row.variantName, { priority: 'identity' }),
    textColumn('lot', t('m16.lot'), (row) => row.batchNo),
    textColumn('where', t('m16.location'), (row) => names.location(row.locationId)),
    textColumn('onHand', t('m16.onHand'), (row) => row.onHand, {
      align: 'right',
      priority: 'value',
    }),
    textColumn('reserved', t('m16.reserved'), (row) => row.reserved, { align: 'right' }),
    textColumn('free', t('m16.available'), (row) => row.onHand - row.reserved, { align: 'right' }),
    {
      key: 'expiry',
      head: t('m16.expiry'),
      priority: 'chip',
      cell: (row) =>
        row.expiryDate === null ? (
          <Txt field="body" desk="cell">
            {t('app.none')}
          </Txt>
        ) : (
          /*
           * Expired is BRICK, closing is OCHRE, everything else is the plain chip. `nearExpiryOnly`
           * is the register's own filter, but a manager reading the whole godown must be able to
           * see the bad rows without filtering for them first.
           */
          <StatusChip label={longDate(row.expiryDate)} family={expiryFamily(row.expiryDate)} />
        ),
    },
  ]

  const ledgerColumns: readonly RegisterColumn<LedgerEntry>[] = [
    textColumn('when', t('m16.when'), (row) => shortInstant(row.occurredAt), {
      priority: 'identity',
    }),
    textColumn('reason', t('m16.reason'), (row) => word(row.reason)),
    textColumn('where', t('m16.location'), (row) => names.location(row.locationId)),
    textColumn('qty', t('m16.qty'), (row) => row.qtyDelta, { align: 'right', priority: 'value' }),
    textColumn('by', t('m9.receivedBy'), (row) => names.staff(row.actorId)),
    textColumn('note', t('app.note'), (row) => row.note),
  ]

  const heldColumns: readonly RegisterColumn<ReservationRow>[] = [
    textColumn('order', t('m5.orderNo'), (row) => row.orderId, { priority: 'identity' }),
    textColumn('item', t('m16.item'), (row) => names.variant(row.variantId)),
    textColumn('where', t('m16.location'), (row) => names.location(row.locationId)),
    textColumn('qty', t('m16.qty'), (row) => row.qtyPcs, { align: 'right', priority: 'value' }),
    textColumn('state', t('m4.status'), (row) => word(row.state), { priority: 'chip' }),
  ]

  return (
    <Screen
      title={t('m16.title')}
      actions={
        <Segments
          testID="stock-view"
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'balances', label: t('m16.balances') },
            { id: 'ledger', label: t('m16.ledger') },
            { id: 'held', label: t('m16.reservationsTitle') },
          ]}
        />
      }
    >
      <Stack gap={4}>
        <Chips
          testID="stock-locations"
          items={[
            ...(locations.data?.items ?? []).map((place) => ({
              id: place.id,
              label: place.name,
              selected: locationId === place.id,
            })),
            { id: 'near', label: t('m16.nearExpiry'), selected: nearExpiry },
          ]}
          onToggle={(id) => {
            if (id === 'near') setNearExpiry((current) => !current)
            else setLocationId((current) => (current === id ? null : id))
          }}
          onClear={
            locationId === null && !nearExpiry
              ? undefined
              : () => {
                  setLocationId(null)
                  setNearExpiry(false)
                }
          }
        />

        {view === 'balances' ? (
          <Async
            state={[balances]}
            rows={12}
            empty={(balances.data?.items.length ?? 0) === 0}
            emptyMessage={t('m16.empty')}
          >
            <Register
              testID="balances-register"
              columns={balanceColumns}
              rows={balances.data?.items ?? []}
              rowKey={(row) => `${row.lotId}-${row.locationId}`}
              frozen="item"
              onSelect={
                mayAdjust
                  ? (row) => {
                      setAdjusting(row)
                      setDelta('')
                      setNote('')
                    }
                  : undefined
              }
              state="ready"
              totals={{
                item: countText(pagedCount(balances), t('app.none')),
                onHand: pageTotal(
                  pagedCount(balances),
                  String((balances.data?.items ?? []).reduce((sum, row) => sum + row.onHand, 0)),
                ),
              }}
            />
          </Async>
        ) : view === 'ledger' ? (
          <Async
            state={[ledger]}
            rows={12}
            empty={(ledger.data?.items.length ?? 0) === 0}
            emptyMessage={t('m16.empty')}
          >
            <Register
              testID="ledger-register"
              columns={ledgerColumns}
              rows={ledger.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="when"
              state="ready"
            />
          </Async>
        ) : (
          <Async
            state={[held]}
            rows={10}
            empty={(held.data?.items.length ?? 0) === 0}
            emptyMessage={t('m16.empty')}
          >
            <Register
              testID="held-register"
              columns={heldColumns}
              rows={held.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="order"
              state="ready"
            />
          </Async>
        )}

        {mayAdjust ? (
          <Panel>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m16.adjustReason')}
            </Txt>
          </Panel>
        ) : null}
      </Stack>

      <Dialog
        open={adjusting !== null}
        onClose={() => {
          setAdjusting(null)
        }}
        title={t('m16.adjustTitle')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body" numberOfLines={1}>
              {`${adjusting?.variantName ?? ''} · ${adjusting?.batchNo ?? ''}`}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
              {`${t('m16.onHand')} ${String(adjusting?.onHand ?? 0)}`}
            </Txt>
            <Segments
              testID="adjust-reason"
              value={reason}
              onChange={(id) => {
                setReason(id as AdjustReason)
              }}
              items={[
                { id: 'adjustment', label: word('adjustment') },
                { id: 'damage', label: word('damage') },
                { id: 'expiry_writeoff', label: word('expiry_writeoff') },
              ]}
            />
            <TextInput
              label={t('m16.qty')}
              value={delta}
              onChange={setDelta}
              keyboard="decimal"
              helper={t('m16.adjustReason')}
              testID="adjust-delta"
            />
            <TextInput
              label={t('app.note')}
              value={note}
              onChange={setNote}
              capitalize="sentences"
              testID="adjust-note"
            />
            <Button
              label={t('m16.transfer')}
              variant="ghost"
              onPress={() => {
                setTransferring(adjusting)
                setAdjusting(null)
                setQty('')
              }}
              testID="open-transfer"
            />
          </Stack>
        }
        confirmLabel={t('m16.adjust')}
        busy={adjust.status === 'pending'}
        onConfirm={() => {
          if (adjusting === null) return
          const value = Number.parseInt(delta, 10)
          if (Number.isNaN(value) || value === 0) return
          void adjust
            .mutateAsync({
              lotId: adjusting.lotId,
              locationId: adjusting.locationId,
              qtyDelta: value,
              reason,
              note: note.trim(),
            })
            .then(
              () => {
                setAdjusting(null)
              },
              () => {
                setAdjusting(null)
              },
            )
        }}
        testID="adjust-dialog"
      />

      <Dialog
        open={transferring !== null}
        onClose={() => {
          setTransferring(null)
        }}
        title={t('m16.transferTitle')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body" numberOfLines={1}>
              {`${transferring?.variantName ?? ''} · ${transferring?.batchNo ?? ''}`}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {`${t('m16.transferFrom')}: ${names.location(transferring?.locationId)}`}
            </Txt>
            <Chips
              testID="transfer-to"
              items={(locations.data?.items ?? [])
                .filter((place) => place.id !== transferring?.locationId)
                .map((place) => ({
                  id: place.id,
                  label: place.name,
                  selected: toLocation === place.id,
                }))}
              onToggle={(id) => {
                setToLocation(id)
              }}
            />
            <TextInput
              label={t('m16.qty')}
              value={qty}
              onChange={setQty}
              keyboard="decimal"
              testID="transfer-qty"
            />
          </Stack>
        }
        confirmLabel={t('m16.transfer')}
        busy={transfer.status === 'pending'}
        onConfirm={() => {
          if (transferring === null || toLocation === null) return
          const pieces = Number.parseInt(qty, 10)
          if (Number.isNaN(pieces) || pieces <= 0) return
          void transfer
            .mutateAsync({
              lotId: transferring.lotId,
              fromLocationId: transferring.locationId,
              toLocationId: toLocation,
              qtyPcs: pieces,
            })
            .then(
              () => {
                setTransferring(null)
              },
              () => {
                setTransferring(null)
              },
            )
        }}
        testID="transfer-dialog"
      />
    </Screen>
  )
}
