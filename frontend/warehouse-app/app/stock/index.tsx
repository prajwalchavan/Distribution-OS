/**
 * W8 — stock: balances per lot per location, near expiry, adjustments and moves (docs/23 §4.1).
 *
 * `inventory.stock.balances` is STOCK_VIEWERS and carries pieces, a batch, an expiry date and an MRP.
 * It does NOT carry a purchase rate or a landed cost — those live in `tenant_product_costs`, whose
 * RLS policy is back-office, so there is no cost column for this screen to leak even by accident
 * (docs/22 §9 rule 1, `rls.test.ts`).
 *
 * Two writes, both `BACK_OFFICE_OR_WAREHOUSE`: an adjustment, which always carries a REASON from the
 * contract's own five (`AdjustmentReasonSchema`) and never a free-text excuse, and a move between
 * locations. Both are single append-only ledger rows; there is no edit and no delete, which is why a
 * damaged case is `damage`, an expired one is `expiry_writeoff`, and a miscount is `cycle_count`.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  Money,
  Row,
  Screen,
  Search,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import type { AdjustmentReasonSchema, StockBalanceRow } from '@dos/contracts'
import type { z } from 'zod'
import { haptics } from '@dos/ui/platform'
import { useState } from 'react'

import { instantWithClock } from '../../src/lib/dates'
import { Async, ExpiryChip, PageTabs, Panel, count } from '../../src/lib/ui'

type AdjustmentReason = z.infer<typeof AdjustmentReasonSchema>

const REASONS: readonly { id: AdjustmentReason; key: string }[] = [
  { id: 'adjustment', key: 'w8.reasonAdjustment' },
  { id: 'damage', key: 'w8.reasonDamage' },
  { id: 'expiry_writeoff', key: 'w8.reasonExpiry' },
  { id: 'cycle_count', key: 'w8.reasonCycle' },
  { id: 'opening', key: 'w8.reasonOpening' },
]

export default function Stock(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const signedIn = session !== null

  const [locationId, setLocationId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [nearExpiry, setNearExpiry] = useState(false)
  const [adjusting, setAdjusting] = useState<StockBalanceRow | null>(null)
  const [moving, setMoving] = useState<StockBalanceRow | null>(null)
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState<AdjustmentReason>('adjustment')
  const [note, setNote] = useState('')
  const [moveQty, setMoveQty] = useState('')
  const [moveTo, setMoveTo] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const locations = useQuery(
    ['locations', 'all'],
    () => api.api.inventory.locations.list({ activeOnly: true }),
    { enabled: signedIn },
  )
  const balances = useQuery(
    ['balances', locationId ?? 'all', nearExpiry ? 'near' : 'all'],
    () =>
      api.api.inventory.stock.balances({
        limit: 200,
        ...(locationId === null ? {} : { locationId }),
        ...(nearExpiry ? { nearExpiryOnly: true } : {}),
      }),
    { enabled: signedIn },
  )
  const ledger = useQuery(
    ['ledger', locationId ?? 'all'],
    () =>
      api.api.inventory.stock.ledger({
        limit: 20,
        ...(locationId === null ? {} : { locationId }),
      }),
    { enabled: signedIn },
  )

  const adjust = useMutation(
    (input: { lotId: string; locationId: string; qtyDelta: number }, meta) =>
      api.api.inventory.stock.adjust({
        idempotencyKey: meta.idempotencyKey,
        lotId: input.lotId,
        locationId: input.locationId,
        qtyDelta: input.qtyDelta,
        reason,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }),
    {
      invalidates: [['balances'], ['ledger']],
      onSuccess: () => {
        haptics.success()
        setAdjusting(null)
        setDelta('')
        setNote('')
        setToast(t('w8.adjusted'))
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const transfer = useMutation(
    (input: { lotId: string; from: string; to: string; qtyPcs: number }, meta) =>
      api.api.inventory.stock.transfer({
        idempotencyKey: meta.idempotencyKey,
        lotId: input.lotId,
        fromLocationId: input.from,
        toLocationId: input.to,
        qtyPcs: input.qtyPcs,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }),
    {
      invalidates: [['balances'], ['ledger']],
      onSuccess: () => {
        haptics.success()
        setMoving(null)
        setMoveQty('')
        setMoveTo(null)
        setToast(t('w8.transferred'))
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const term = q.trim().toLowerCase()
  const rows = (balances.data?.items ?? []).filter(
    (row) =>
      term === '' ||
      row.variantName.toLowerCase().includes(term) ||
      row.productName.toLowerCase().includes(term) ||
      row.batchNo.toLowerCase().includes(term),
  )
  const deltaValue = Number.parseInt(delta, 10)
  const deltaOk = Number.isSafeInteger(deltaValue) && deltaValue !== 0
  const moveValue = Number.parseInt(moveQty, 10)
  const moveOk = Number.isSafeInteger(moveValue) && moveValue > 0 && moveTo !== null

  return (
    <Screen title={t('w8.title')} context={session?.tenant.displayName} testID="w8-screen">
      <Stack gap={6}>
        <PageTabs group="/" active="/stock" />

        <Panel title={t('w.location')} testID="w8-locations">
          <Async state={locations} empty={(locations.data?.items.length ?? 0) === 0}>
            <Group>
              {(locations.data?.items ?? []).map((location) => (
                <ListRow
                  key={location.id}
                  testID={`w8-location-${location.id}`}
                  primary={location.name}
                  secondary={location.kind}
                  state={location.id === locationId ? 'selected' : 'default'}
                  onPress={() => {
                    setLocationId(location.id === locationId ? null : location.id)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Search
          testID="w8-search"
          value={q}
          onChange={setQ}
          placeholder={t('w8.search')}
          state={term === '' ? 'idle' : rows.length === 0 ? 'noResults' : 'results'}
        />

        <Segments
          testID="w8-expiry"
          items={[
            { id: 'all', label: t('w8.allStock') },
            { id: 'near', label: t('w8.nearExpiry') },
          ]}
          value={nearExpiry ? 'near' : 'all'}
          onChange={(id) => {
            setNearExpiry(id === 'near')
          }}
        />

        <Panel title={t('w8.rows')} testID="w8-rows">
          <Async state={balances} empty={rows.length === 0} emptyMessage={t('w8.rowsEmpty')}>
            <Stack gap={4}>
              {rows.map((row) => (
                <Stack
                  key={`${row.lotId}-${row.locationId}`}
                  gap={3}
                  pad={4}
                  background="surface"
                  radius="md"
                  border="all"
                  borderTone="faint"
                  testID={`w8-lot-${row.lotId}`}
                >
                  <Txt field="bodyStrong" desk="cell">
                    {row.variantName}
                  </Txt>
                  <Row gap={3} wrap align="center">
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {row.batchNo === '' ? t('w.noBatch') : t('w.batch', { batch: row.batchNo })}
                    </Txt>
                    <ExpiryChip expiryDate={row.expiryDate} />
                    <Money value={row.mrpPaise} size="cell" />
                  </Row>
                  <Row gap={4} wrap align="center">
                    <Txt field="moneyM" desk="cell" numeric>
                      {`${t('w8.onHand')} ${count(row.onHand)}`}
                    </Txt>
                    <StatusChip
                      label={`${t('w8.reserved')} ${count(row.reserved)}`}
                      family={row.reserved > 0 ? 'clay' : 'neutral'}
                      figure
                    />
                    <StatusChip
                      label={`${t('w8.free')} ${count(row.onHand - row.reserved)}`}
                      family={row.onHand - row.reserved > 0 ? 'moss' : 'brick'}
                      figure
                    />
                  </Row>
                  <Row gap={4} wrap>
                    <Button
                      label={t('w8.adjust')}
                      variant="secondary"
                      onPress={() => {
                        setAdjusting(row)
                        setDelta('')
                        setNote('')
                        setReason('adjustment')
                      }}
                      testID={`w8-adjust-${row.lotId}`}
                    />
                    <Button
                      label={t('w8.transfer')}
                      variant="ghost"
                      onPress={() => {
                        setMoving(row)
                        setMoveQty('')
                        setMoveTo(null)
                      }}
                      testID={`w8-move-${row.lotId}`}
                    />
                  </Row>
                </Stack>
              ))}
            </Stack>
          </Async>
        </Panel>

        <Panel title={t('w8.ledger')} testID="w8-ledger">
          <Async
            state={ledger}
            empty={(ledger.data?.items.length ?? 0) === 0}
            emptyMessage={t('w8.ledgerEmpty')}
          >
            <Group>
              {(ledger.data?.items ?? []).map((entry) => (
                <ListRow
                  key={entry.id}
                  testID={`w8-entry-${entry.id}`}
                  primary={entry.reason}
                  secondary={instantWithClock(entry.occurredAt)}
                  trailing={
                    <StatusChip
                      label={`${entry.qtyDelta > 0 ? '+' : ''}${String(entry.qtyDelta)}`}
                      family={entry.qtyDelta > 0 ? 'moss' : 'ochre'}
                      figure
                    />
                  }
                  {...(entry.note === null ? {} : { reason: entry.note })}
                />
              ))}
            </Group>
          </Async>
        </Panel>
      </Stack>

      <Sheet
        open={adjusting !== null}
        onClose={() => {
          setAdjusting(null)
        }}
        title={adjusting === null ? '' : t('w8.adjustTitle', { item: adjusting.variantName })}
        testID="w8-adjust-sheet"
      >
        <Stack gap={4}>
          <TextInput
            label={t('w8.adjustQty')}
            value={delta}
            onChange={setDelta}
            keyboard="decimal"
            helper={t('w8.qtyNeeded')}
            testID="w8-adjust-qty"
          />
          <Group>
            {REASONS.map((one) => (
              <ListRow
                key={one.id}
                testID={`w8-reason-${one.id}`}
                primary={t(one.key)}
                state={one.id === reason ? 'selected' : 'default'}
                onPress={() => {
                  setReason(one.id)
                }}
              />
            ))}
          </Group>
          <TextInput
            label={t('w8.adjustNote')}
            value={note}
            onChange={setNote}
            capitalize="sentences"
            testID="w8-adjust-note"
          />
          {adjust.error === undefined ? null : (
            <Txt field="body" desk="body" color={colors.status.brick.fg}>
              {adjust.error.message}
            </Txt>
          )}
          <Button
            label={t('w8.adjustDo')}
            variant="primary"
            loading={adjust.status === 'pending'}
            disabled={!deltaOk}
            {...(deltaOk ? {} : { disabledReason: t('w8.qtyNeeded') })}
            onPress={() => {
              if (adjusting === null || !deltaOk) return
              adjust.mutate({
                lotId: adjusting.lotId,
                locationId: adjusting.locationId,
                qtyDelta: deltaValue,
              })
            }}
            fullWidth
            testID="w8-adjust-do"
          />
        </Stack>
      </Sheet>

      <Sheet
        open={moving !== null}
        onClose={() => {
          setMoving(null)
        }}
        title={moving === null ? '' : t('w8.transferTitle', { item: moving.variantName })}
        testID="w8-move-sheet"
      >
        <Stack gap={4}>
          <TextInput
            label={t('w8.transferQty')}
            value={moveQty}
            onChange={setMoveQty}
            keyboard="decimal"
            helper={t('w8.qtyNeeded')}
            testID="w8-move-qty"
          />
          <Group>
            {(locations.data?.items ?? [])
              .filter((one) => one.id !== moving?.locationId)
              .map((one) => (
                <ListRow
                  key={one.id}
                  testID={`w8-move-to-${one.id}`}
                  primary={one.name}
                  secondary={one.kind}
                  state={one.id === moveTo ? 'selected' : 'default'}
                  onPress={() => {
                    setMoveTo(one.id)
                  }}
                />
              ))}
          </Group>
          {transfer.error === undefined ? null : (
            <Txt field="body" desk="body" color={colors.status.brick.fg}>
              {transfer.error.message}
            </Txt>
          )}
          <Button
            label={t('w8.transferDo')}
            variant="primary"
            loading={transfer.status === 'pending'}
            disabled={!moveOk}
            {...(moveOk ? {} : { disabledReason: t('w8.transferTo') })}
            onPress={() => {
              if (moving === null || moveTo === null || !moveOk) return
              transfer.mutate({
                lotId: moving.lotId,
                from: moving.locationId,
                to: moveTo,
                qtyPcs: moveValue,
              })
            }}
            fullWidth
            testID="w8-move-do"
          />
        </Stack>
      </Sheet>

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="w8-toast"
      />
    </Screen>
  )
}
