/**
 * O15 — stock: balances per lot and location, near-expiry, the stock ledger and the value at cost
 * (docs/23 §1.1).
 *
 * Value at cost is on this screen because owner-service is one of the three that may serve it; the
 * same screen file opened by a warehouse role would not receive those columns at all, and the app
 * does not draw a field it did not receive.
 */
import type { LedgerEntry, StockBalanceRow } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Dialog,
  Money,
  Register,
  Screen,
  Segments,
  StackedMix,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Columns,
  ExportButton,
  Half,
  PageTabs,
  Panel,
  moneyColumn,
  textColumn,
} from '../../src/lib/ui'
import { instantWithClock, longDate, shiftDays, today } from '../../src/lib/dates'

export default function StockScreen(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()

  const [view, setView] = useState<'balances' | 'ledger'>('balances')
  const [locationId, setLocationId] = useState<string | null>(null)
  const [nearExpiryOnly, setNearExpiryOnly] = useState(false)
  const [adjustLot, setAdjustLot] = useState<StockBalanceRow | null>(null)
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')

  const locations = useQuery(['inventory', 'locations'], () =>
    api.api.inventory.locations.list({ activeOnly: true }),
  )
  const balances = useQuery(
    ['inventory', 'balances', locationId ?? 'all', nearExpiryOnly ? 'expiry' : 'all'],
    () =>
      api.api.inventory.stock.balances({
        limit: 300,
        ...(locationId === null ? {} : { locationId }),
        ...(nearExpiryOnly ? { expiringBefore: shiftDays(today(), 90) } : {}),
      }),
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
  const value = useQuery(['reporting', 'stockValue'], () =>
    api.api.reporting.registers.stockValue({ limit: 200 }),
  )

  const adjust = useMutation(
    (input: { lotId: string; locationId: string; qtyDelta: number; reason: string }, meta) =>
      api.api.inventory.stock.adjust({
        idempotencyKey: meta.idempotencyKey,
        lotId: input.lotId,
        locationId: input.locationId,
        qtyDelta: input.qtyDelta,
        reason: 'adjustment',
        note: input.reason,
      }),
    { invalidates: [['inventory'], ['reporting']] },
  )

  const rows = balances.data?.items ?? []
  const ledgerRows = ledger.data?.items ?? []
  const valueRows = value.data?.items ?? []

  const byBrand = valueRows.reduce<Record<string, number>>((acc, row) => {
    const key = row.brandName ?? t('word.all')
    acc[key] = (acc[key] ?? 0) + row.valuePaise
    return acc
  }, {})
  const slices = Object.entries(byBrand)
    .map(([label, v]) => ({ label, value: v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)

  const balanceColumns: readonly RegisterColumn<StockBalanceRow>[] = [
    textColumn('item', t('o15.item'), (row) => row.variantName, { priority: 'identity' }),
    textColumn('batch', t('o15.batch'), (row) => row.batchNo || t('app.none')),
    textColumn('expiry', t('o15.expiry'), (row) => longDate(row.expiryDate)),
    {
      key: 'onHand',
      head: t('o15.onHand'),
      align: 'right',
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numeric>
          {row.onHand}
        </Txt>
      ),
    },
    {
      key: 'reserved',
      head: t('o15.reserved'),
      align: 'right',
      cell: (row) => (
        <Txt field="body" desk="cell" numeric>
          {row.reserved}
        </Txt>
      ),
    },
    {
      key: 'sellable',
      head: t('o15.sellable'),
      align: 'right',
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={String(row.onHand - row.reserved)}
          family={row.onHand - row.reserved <= 0 ? 'brick' : 'moss'}
          solid={row.onHand - row.reserved <= 0}
          figure
        />
      ),
    },
    moneyColumn('mrp', t('o15.mrp'), (row) => row.mrpPaise),
  ]

  const ledgerColumns: readonly RegisterColumn<LedgerEntry>[] = [
    textColumn('when', t('o12.date'), (row) => instantWithClock(row.occurredAt), {
      priority: 'identity',
    }),
    textColumn('reason', t('o15.reason'), (row) => row.reason, { priority: 'chip' }),
    {
      key: 'delta',
      head: t('o15.movement'),
      align: 'right',
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numeric>
          {row.qtyDelta}
        </Txt>
      ),
    },
    textColumn('ref', t('o15.ref'), (row) => row.refType),
    textColumn('note', t('o3.note'), (row) => row.note),
  ]

  return (
    <Screen
      title={t('o15.title')}
      chips={<PageTabs group="/stock" active="/stock" />}
      actions={
        <>
          <Segments
            value={view}
            onChange={(id) => {
              setView(id as 'balances' | 'ledger')
            }}
            items={[
              { id: 'balances', label: t('o15.balances') },
              { id: 'ledger', label: t('o15.ledger') },
            ]}
            testID="stock-view"
          />
          <ExportButton register="stockValue" filters={{}} testID="stock-export" />
        </>
      }
    >
      <Stack gap={6}>
        <Columns>
          <Half>
            <Panel title={t('o15.byBrand')} testID="stock-mix">
              <Async state={[value]} rows={3} empty={slices.length === 0}>
                <StackedMix slices={slices} />
              </Async>
            </Panel>
          </Half>
          <Half>
            <Panel title={t('o17.stockValue')}>
              <Async state={[value]} rows={3}>
                <Stack gap={2}>
                  <Money value={value.data?.totals.valuePaise ?? 0} size="moneyL" />
                  <Txt field="label" desk="meta">
                    {t('o15.nearExpiry')}
                  </Txt>
                  <Money
                    value={value.data?.totals.nearExpiryValuePaise ?? 0}
                    size="cell"
                    tone="critical"
                  />
                </Stack>
              </Async>
            </Panel>
          </Half>
        </Columns>

        <Chips
          testID="stock-locations"
          items={[
            ...(locations.data?.items ?? []).map((loc) => ({
              id: loc.id,
              label: loc.name,
              selected: locationId === loc.id,
            })),
            { id: 'nearExpiry', label: t('o15.nearExpiry'), selected: nearExpiryOnly },
          ]}
          onToggle={(id) => {
            if (id === 'nearExpiry') setNearExpiryOnly((v) => !v)
            else setLocationId((cur) => (cur === id ? null : id))
          }}
          onClear={
            locationId === null && !nearExpiryOnly
              ? undefined
              : () => {
                  setLocationId(null)
                  setNearExpiryOnly(false)
                }
          }
        />

        {view === 'balances' ? (
          <Async
            state={[balances]}
            rows={12}
            empty={rows.length === 0}
            emptyMessage={t('o15.empty')}
          >
            <Register
              testID="stock-register"
              columns={balanceColumns}
              rows={rows}
              rowKey={(row) => `${row.lotId}:${row.locationId}`}
              frozen="item"
              onSelect={(row) => {
                setAdjustLot(row)
              }}
              state="ready"
            />
          </Async>
        ) : (
          <Async state={[ledger]} rows={12} empty={ledgerRows.length === 0}>
            <Register
              testID="stock-ledger"
              columns={ledgerColumns}
              rows={ledgerRows}
              rowKey={(row) => row.id}
              frozen="when"
              state="ready"
            />
          </Async>
        )}
      </Stack>

      <Dialog
        open={adjustLot !== null}
        onClose={() => {
          setAdjustLot(null)
        }}
        title={t('o15.adjust')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {adjustLot?.variantName ?? ''}
            </Txt>
            <TextInput
              label={t('o15.movement')}
              value={delta}
              onChange={setDelta}
              keyboard="decimal"
              helper={t('o15.onHand')}
            />
            <TextInput
              label={t('o15.reason')}
              value={reason}
              onChange={setReason}
              capitalize="sentences"
            />
          </Stack>
        }
        confirmLabel={t('o15.adjust')}
        busy={adjust.status === 'pending'}
        onConfirm={() => {
          if (adjustLot === null) return
          const qty = Number.parseInt(delta, 10)
          if (!Number.isInteger(qty) || qty === 0) return
          void adjust
            .mutateAsync({
              lotId: adjustLot.lotId,
              locationId: adjustLot.locationId,
              qtyDelta: qty,
              reason: reason.trim(),
            })
            .then(
              () => {
                setAdjustLot(null)
                setDelta('')
                setReason('')
              },
              () => {
                /* the error stays on the mutation and the dialog stays open */
              },
            )
        }}
        testID="stock-adjust-dialog"
      />

      <Button
        label={t('o15.counts')}
        variant="ghost"
        onPress={() => {
          setView('ledger')
        }}
        testID="stock-counts"
      />
    </Screen>
  )
}
