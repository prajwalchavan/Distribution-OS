/**
 * O15 — stock: balances per lot and location, near-expiry, the stock ledger and the value at cost
 * (docs/23 §1.1).
 *
 * Value at cost is on this screen because owner-service is one of the three that may serve it; the
 * same screen file opened by a warehouse role would not receive those columns at all, and the app
 * does not draw a field it did not receive.
 *
 * QA DOS-253 (business simulation, day 7): the owner could not read his stock by item and batch. The
 * register asked for ONE page of 300 lot × location rows in lot order — zero rows included — while the
 * Godown alone holds 1 294, so 8 of the 29 live batches of the simulation's items (the 12 phantom toor of
 * DOS-251 among them) were never on screen, and the row adjustment that would write them off could not be
 * reached. The brand donut summed the first 200 rows of the value register: ₹14.0L beside ₹23.3L, Campa
 * left out. Now:
 *   - the register reads live rows only (`nonZero`), in item order (`sort: 'item'`: item, then its
 *     batches oldest first), searched ON THE SERVER by item, product or batch, a page at a time with
 *     "Show more" — and says "more below" instead of passing a page off as the whole;
 *   - a Location column appears whenever no location is picked, so a batch split across the Godown and
 *     a van reads as two rows that say where they stand;
 *   - the donut is the register's own `byBrand` (every row; the kit shows four brands and one "Other"),
 *     adding up to the stock at cost printed beside it;
 *   - the adjustment says which batch at which place, how many are on hand, and what will be left; it
 *     takes pieces OFF or ADDS them without typing a minus sign, and a refusal is printed in the dialog.
 */
import type { LedgerEntry, StockBalanceRow } from '@dos/contracts'
import { useApi, useMutation, useQuery, useRefusal } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Dialog,
  Money,
  Register,
  Row,
  Screen,
  Search,
  Segments,
  StackedMix,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  useColors,
  useGo,
  useStrings,
  useViewport,
  type RegisterColumn,
} from '@dos/ui'
import { platform } from '@dos/ui/platform'
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
} from '../../../src/groups/owner/lib/ui'
import { instantWithClock, longDate, shiftDays, today } from '../../../src/groups/owner/lib/dates'
import { useWord } from '../../../src/groups/owner/lib/words'
import { useMorePages, useSettled } from '../../../src/paging'
import { brandSlices } from '../../../src/stock'

/** Rows per page of the register: a screenful and a half on a desk, never the whole godown. */
const PAGE = 100

type Direction = 'off' | 'add'
type OffReason = 'adjustment' | 'damage' | 'expiry_writeoff'

const rowKey = (row: StockBalanceRow): string => `${row.lotId}:${row.locationId}`

export default function StockScreen(): React.JSX.Element {
  const go = useGo()
  const t = useStrings()
  const api = useApi()
  const word = useWord()
  const colors = useColors()
  /*
   * The phone rendering of a register draws the identity, one number and a chip — no Batch or Location
   * column (the web register below 1024 px, and the native one at every width). Stock read "by item and
   * batch" must still name the batch there, so on that shell the chip IS the batch (tinted brick when
   * nothing of it is free) and the identity carries the place when none is picked.
   */
  const phone = useViewport().kind === 'phone' || platform.kind === 'native'

  const [view, setView] = useState<'balances' | 'ledger'>('balances')
  const [locationId, setLocationId] = useState<string | null>(null)
  const [nearExpiryOnly, setNearExpiryOnly] = useState(false)
  const [search, setSearch] = useState('')
  const q = useSettled(search.trim(), 300)
  const [adjustLot, setAdjustLot] = useState<StockBalanceRow | null>(null)
  const [direction, setDirection] = useState<Direction>('off')
  const [offReason, setOffReason] = useState<OffReason>('adjustment')
  const [pieces, setPieces] = useState('')
  const [reason, setReason] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const locations = useQuery(['inventory', 'locations'], () =>
    api.api.inventory.locations.list({ activeOnly: true }),
  )
  const placeName = (id: string): string =>
    (locations.data?.items ?? []).find((loc) => loc.id === id)?.name ?? t('app.none')

  const filters = {
    nonZero: true,
    sort: 'item' as const,
    ...(q === '' ? {} : { q }),
    ...(locationId === null ? {} : { locationId }),
    ...(nearExpiryOnly ? { expiringBefore: shiftDays(today(), 90) } : {}),
  }
  const filterKey = JSON.stringify(filters)
  const balances = useQuery(['inventory', 'balances', 'owner', filterKey], () =>
    api.api.inventory.stock.balances({ ...filters, limit: PAGE }),
  )
  const paged = useMorePages(
    filterKey,
    balances.data,
    (cursor) => api.api.inventory.stock.balances({ ...filters, limit: PAGE, cursor }),
    rowKey,
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
  // One row is enough: the totals and the brand split in the reply cover EVERY row (DOS-253).
  const value = useQuery(['reporting', 'stockValue', 'summary'], () =>
    api.api.reporting.registers.stockValue({ limit: 1 }),
  )

  const adjust = useMutation(
    (
      input: {
        lotId: string
        locationId: string
        qtyDelta: number
        reason: OffReason
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
  const refusal = useRefusal([adjust], adjustLot === null ? null : rowKey(adjustLot))

  const rows = paged.rows
  const ledgerRows = ledger.data?.items ?? []
  const slices = brandSlices(value.data?.byBrand ?? [], t('o15.noBrand'))

  // The row as the register holds it NOW: re-read after a refusal, so a count that went stale under the
  // open dialog shows the figure the service refused against, not the one the dialog opened on.
  const liveLot =
    adjustLot === null ? null : (rows.find((row) => rowKey(row) === rowKey(adjustLot)) ?? adjustLot)
  const count = Number.parseInt(pieces, 10)
  const piecesOk = /^\d+$/.test(pieces.trim()) && count > 0
  const onHandNow = liveLot?.onHand ?? 0
  const tooMany = direction === 'off' && piecesOk && count > onHandNow
  const after = piecesOk ? onHandNow + (direction === 'off' ? -count : count) : onHandNow
  const pieceError =
    pieces.trim() === ''
      ? undefined
      : !piecesOk
        ? t('o15.piecesNeeded')
        : tooMany
          ? t('o15.piecesTooMany', { count: onHandNow })
          : undefined

  const openAdjust = (row: StockBalanceRow): void => {
    setAdjustLot(row)
    setDirection('off')
    setOffReason('adjustment')
    setPieces('')
    setReason('')
  }

  const balanceColumns: readonly RegisterColumn<StockBalanceRow>[] = [
    textColumn(
      'item',
      t('o15.item'),
      (row) =>
        phone && locationId === null
          ? t('o15.itemAt', { item: row.variantName, location: placeName(row.locationId) })
          : row.variantName,
      { priority: 'identity' },
    ),
    phone
      ? {
          key: 'batch',
          head: t('o15.batch'),
          priority: 'chip',
          cell: (row) => (
            <StatusChip
              label={t('o15.batchChip', { batch: row.batchNo || t('app.none') })}
              family={row.onHand - row.reserved <= 0 ? 'brick' : 'neutral'}
            />
          ),
        }
      : textColumn('batch', t('o15.batch'), (row) => row.batchNo || t('app.none')),
    // A batch split across the Godown and a van is two rows; with no place picked, each says where.
    ...(locationId === null
      ? [
          textColumn<StockBalanceRow>('where', t('o15.location'), (row) =>
            placeName(row.locationId),
          ),
        ]
      : []),
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
      ...(phone ? {} : { priority: 'chip' as const }),
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
    textColumn('reason', t('o15.reason'), (row) => word(row.reason), { priority: 'chip' }),
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
    textColumn('ref', t('o15.ref'), (row) => word(row.refType)),
    textColumn('note', t('o3.note'), (row) => row.note),
  ]

  const searching = search.trim() !== ''
  const rowsLine = paged.hasMore
    ? t('o15.rowsMore', { count: rows.length })
    : t('o15.rows', { count: rows.length })

  return (
    <Screen
      title={t('o15.title')}
      chips={<PageTabs group={go.href('/stock')} active={go.href('/stock')} />}
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
            <Panel title={t('o17.stockValue')} testID="stock-value">
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

        {view === 'balances' ? (
          <Search
            testID="stock-search"
            value={search}
            onChange={setSearch}
            placeholder={t('o15.search')}
            state={
              !searching
                ? 'idle'
                : search.trim() !== q || balances.isFetching
                  ? 'typing'
                  : rows.length === 0
                    ? 'noResults'
                    : 'results'
            }
          />
        ) : null}

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
            emptyMessage={q === '' ? t('o15.empty') : t('o15.noMatch', { q })}
          >
            <Stack gap={3}>
              <Register
                testID="stock-register"
                columns={balanceColumns}
                rows={rows}
                rowKey={rowKey}
                frozen="item"
                onSelect={openAdjust}
                state="ready"
                totals={{ item: rowsLine }}
              />
              <Row gap={4} align="center" wrap>
                <Txt field="label" desk="meta" color={colors.text.secondary} testID="stock-count">
                  {`${rowsLine} · ${t('o15.hint')}`}
                </Txt>
                {paged.hasMore ? (
                  <Button
                    label={t('o15.showMore')}
                    variant="secondary"
                    loading={paged.loading}
                    onPress={paged.showMore}
                    testID="stock-more"
                  />
                ) : null}
              </Row>
              {paged.error === undefined ? null : (
                <Txt
                  field="body"
                  desk="body"
                  color={colors.status.brick.fg}
                  testID="stock-more-error"
                >
                  {paged.error.kind === 'network'
                    ? t('app.writeNoConnection')
                    : paged.error.message}
                </Txt>
              )}
            </Stack>
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
            <Txt field="bodyStrong" desk="body" testID="stock-adjust-what">
              {adjustLot === null
                ? ''
                : t('o15.adjustWhat', {
                    item: adjustLot.variantName,
                    batch: adjustLot.batchNo || t('app.none'),
                    location: placeName(adjustLot.locationId),
                  })}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
              {t('o15.adjustNow', { count: onHandNow })}
            </Txt>
            <Segments
              testID="stock-adjust-direction"
              value={direction}
              onChange={(id) => {
                setDirection(id as Direction)
              }}
              items={[
                { id: 'off', label: t('o15.takeOff') },
                { id: 'add', label: t('o15.add') },
              ]}
            />
            {direction === 'off' ? (
              <Segments
                testID="stock-adjust-reason"
                value={offReason}
                onChange={(id) => {
                  setOffReason(id as OffReason)
                }}
                items={[
                  { id: 'adjustment', label: word('adjustment') },
                  { id: 'damage', label: word('damage') },
                  { id: 'expiry_writeoff', label: word('expiry_writeoff') },
                ]}
              />
            ) : null}
            <TextInput
              label={t('o15.pieces')}
              value={pieces}
              onChange={setPieces}
              keyboard="decimal"
              helper={piecesOk && !tooMany ? t('o15.adjustAfter', { count: after }) : undefined}
              error={pieceError}
              testID="stock-adjust-pieces"
            />
            <TextInput
              label={t('o15.why')}
              value={reason}
              onChange={setReason}
              capitalize="sentences"
              testID="stock-adjust-note"
            />
            {refusal === undefined ? null : (
              <Txt
                field="body"
                desk="body"
                color={colors.status.brick.fg}
                testID="stock-adjust-refusal"
              >
                {refusal.kind === 'network' ? t('app.writeNoConnection') : refusal.message}
              </Txt>
            )}
          </Stack>
        }
        confirmLabel={t('o15.adjust')}
        busy={adjust.status === 'pending'}
        onConfirm={() => {
          if (adjustLot === null || !piecesOk || tooMany) return
          const lot = adjustLot
          const delta = direction === 'off' ? -count : count
          void adjust
            .mutateAsync({
              lotId: lot.lotId,
              locationId: lot.locationId,
              qtyDelta: delta,
              // Adding by hand is always a correction; taking off names why.
              reason: direction === 'off' ? offReason : 'adjustment',
              note: reason.trim(),
            })
            .then(
              (result) => {
                setAdjustLot(null)
                setToast(
                  t('o15.adjusted', {
                    item: lot.variantName,
                    batch: lot.batchNo || t('app.none'),
                    count: result.balance.onHand,
                  }),
                )
              },
              () => {
                // The refusal stays on the mutation and is printed in the dialog, which stays open with the
                // input; the register is read again so "On hand now" states what the service counted.
                void balances.refetch()
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

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="stock-toast"
      />
    </Screen>
  )
}
