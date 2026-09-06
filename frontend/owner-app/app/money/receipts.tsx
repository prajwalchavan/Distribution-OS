/**
 * O11 — receipts, banking and cheques (docs/23 §1.1).
 *
 * The money desk's own register: what came in, in what form, how much of it is still on account, and
 * the four things that can happen to a receipt afterwards — bank it, mark it bounced, reverse it, or
 * allocate it to a bill. A receipt is never edited; each of those is its own append-only event.
 */
import type { Receipt } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Dialog,
  Money,
  Register,
  RupeeInput,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  ExportButton,
  Field,
  PageTabs,
  RangeSegments,
  moneyColumn,
  textColumn,
  useNames,
} from '../../src/lib/ui'
import { instantWithClock, rangeOf, type RangeId } from '../../src/lib/dates'

const STATUS_FAMILY: Readonly<Record<string, StatusFamily>> = {
  collected: 'ochre',
  deposited: 'moss',
  bounced: 'brick',
  cancelled: 'neutral',
}

const MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'adjustment'] as const
type Mode = (typeof MODES)[number]

export default function Receipts(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const names = useNames()

  const [range, setRange] = useState<RangeId>('d30')
  const [mode, setMode] = useState<Mode | null>(null)
  const [unallocatedOnly, setUnallocatedOnly] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'deposit' | 'bounce' | 'reverse' | null>(null)
  const [note, setNote] = useState('')
  const [charges, setCharges] = useState<number | null>(null)

  const span = rangeOf(range)
  const list = useQuery(
    ['receipts', span.from, span.to, mode ?? 'all', unallocatedOnly ? 'unallocated' : 'all'],
    () =>
      api.api.receivables.receipts.list({
        from: span.from,
        to: span.to,
        limit: 200,
        ...(mode === null ? {} : { mode }),
        ...(unallocatedOnly ? { unallocatedOnly: true } : {}),
      }),
  )
  const detail = useQuery(
    ['receipts', 'get', selected ?? 'none'],
    () => api.api.receivables.receipts.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )

  const deposit = useMutation(
    (input: { ids: readonly string[]; ref: string }, meta) =>
      api.api.receivables.receipts.deposit({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        receiptIds: [...input.ids],
        depositAccountCode: 'BANK',
        depositedAt: new Date().toISOString(),
        ...(input.ref === '' ? {} : { depositRef: input.ref }),
      }),
    { invalidates: [['receipts'], ['receivables']] },
  )
  const bounce = useMutation(
    (input: { id: string; reason: string; charges: number | null }, meta) =>
      api.api.receivables.receipts.bounce({
        id: input.id,
        reversalId: meta.id,
        idempotencyKey: meta.idempotencyKey,
        bouncedAt: new Date().toISOString(),
        reason: input.reason,
        bankChargesPaise: input.charges ?? 0,
      }),
    { invalidates: [['receipts'], ['receivables'], ['invoices']] },
  )
  const reverse = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.receivables.receipts.reverse({
        id: input.id,
        reversalId: meta.id,
        idempotencyKey: meta.idempotencyKey,
        reason: input.reason,
      }),
    { invalidates: [['receipts'], ['receivables'], ['invoices']] },
  )

  const rows = list.data?.items ?? []
  const receipt = detail.data?.item

  const columns: readonly RegisterColumn<Receipt>[] = [
    textColumn('no', t('o11.receiptNo'), (row) => row.receiptNo, { priority: 'identity' }),
    textColumn('shop', t('o11.shop'), (row) => names.retailer(row.retailerId)),
    textColumn('mode', t('o11.mode'), (row) => row.mode),
    moneyColumn('amount', t('o11.amount'), (row) => row.amountPaise),
    moneyColumn('unallocated', t('o11.unallocated'), (row) => row.unallocatedPaise),
    {
      key: 'status',
      head: t('o11.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={row.status} family={STATUS_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    textColumn('received', t('o11.received'), (row) => instantWithClock(row.receivedAt)),
  ]

  return (
    <Screen
      title={t('o11.title')}
      chips={<PageTabs group="/money" active="/money/receipts" />}
      actions={
        <>
          <RangeSegments
            value={range}
            onChange={(id) => {
              setRange(id as RangeId)
            }}
          />
          <ExportButton
            register="collections"
            filters={{ from: span.from, to: span.to }}
            testID="receipts-export"
          />
        </>
      }
    >
      <Stack gap={4}>
        <Chips
          testID="receipts-modes"
          items={[
            ...MODES.map((id) => ({ id, label: id, selected: mode === id })),
            { id: 'unallocated', label: t('o11.onAccount'), selected: unallocatedOnly },
          ]}
          onToggle={(id) => {
            if (id === 'unallocated') setUnallocatedOnly((v) => !v)
            else setMode((cur) => (cur === id ? null : (id as Mode)))
          }}
          onClear={
            mode === null && !unallocatedOnly
              ? undefined
              : () => {
                  setMode(null)
                  setUnallocatedOnly(false)
                }
          }
        />

        <Async state={[list]} rows={10} empty={rows.length === 0} emptyMessage={t('o11.empty')}>
          <Register
            testID="receipts-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="no"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
            totals={{
              no: t('word.total'),
              amount: (
                <Money value={list.data?.totals.countedPaise ?? 0} size="cell" symbol={false} />
              ),
              unallocated: (
                <Money value={list.data?.totals.unallocatedPaise ?? 0} size="cell" symbol={false} />
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
        title={receipt?.receiptNo ?? undefined}
        testID="receipt-panel"
      >
        <Async state={[detail]} rows={5}>
          {receipt === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('o11.shop')}>{names.retailer(receipt.retailerId)}</Field>
              <Field label={t('o11.mode')}>{receipt.mode}</Field>
              <Field label={t('o11.amount')}>
                <Money value={receipt.amountPaise} size="moneyM" />
              </Field>
              <Field label={t('o11.unallocated')}>
                <Money value={receipt.unallocatedPaise} size="cell" />
              </Field>
              <Field label={t('o11.received')}>{instantWithClock(receipt.receivedAt)}</Field>
              <Field label={t('o7.person')}>{names.staff(receipt.receivedBy)}</Field>
              <Button
                label={t('o11.deposit')}
                variant="primary"
                disabled={receipt.status !== 'collected'}
                disabledReason={t('o11.status')}
                onPress={() => {
                  setDialog('deposit')
                }}
                testID="receipt-deposit"
              />
              <Button
                label={t('o11.bounce')}
                variant="secondary"
                disabled={receipt.mode !== 'cheque' || receipt.status === 'bounced'}
                disabledReason={t('o11.mode')}
                onPress={() => {
                  setDialog('bounce')
                }}
              />
              <Button
                label={t('o11.reverse')}
                variant="destructive"
                disabled={receipt.status === 'cancelled'}
                disabledReason={t('o11.status')}
                onPress={() => {
                  setDialog('reverse')
                }}
              />
            </Stack>
          )}
        </Async>
      </Sheet>

      <Dialog
        open={dialog !== null}
        onClose={() => {
          setDialog(null)
        }}
        title={
          dialog === 'deposit'
            ? t('o11.deposit')
            : dialog === 'bounce'
              ? t('o11.bounce')
              : t('o11.reverse')
        }
        body={
          <Stack gap={3}>
            <Money value={receipt?.amountPaise ?? null} size="moneyM" />
            <TextInput
              label={dialog === 'bounce' ? t('o11.bounceReason') : t('o3.note')}
              value={note}
              onChange={setNote}
              capitalize="sentences"
            />
            {dialog === 'bounce' ? (
              <RupeeInput label={t('o23.cost')} value={charges} onChange={setCharges} />
            ) : null}
          </Stack>
        }
        confirmLabel={
          dialog === 'deposit'
            ? t('o11.deposit')
            : dialog === 'bounce'
              ? t('o11.bounce')
              : t('o11.reverse')
        }
        destructive={dialog !== 'deposit'}
        busy={
          deposit.status === 'pending' ||
          bounce.status === 'pending' ||
          reverse.status === 'pending'
        }
        onConfirm={() => {
          if (receipt === undefined) return
          const done = (): void => {
            setDialog(null)
            setNote('')
            setCharges(null)
          }
          if (dialog === 'deposit')
            void deposit.mutateAsync({ ids: [receipt.id], ref: note.trim() }).then(done, done)
          if (dialog === 'bounce')
            void bounce
              .mutateAsync({ id: receipt.id, reason: note.trim(), charges })
              .then(done, done)
          if (dialog === 'reverse')
            void reverse.mutateAsync({ id: receipt.id, reason: note.trim() }).then(done, done)
        }}
        testID="receipt-dialog"
      />
    </Screen>
  )
}
