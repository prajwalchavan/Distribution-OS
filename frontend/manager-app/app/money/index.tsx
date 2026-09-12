/**
 * M9 — receipts and allocations: money that comes to the OFFICE (docs/23 §2.1, docs/22 §6).
 *
 * Who may take money is a founder decision, not a preference: only the delivery crew collects at the
 * door, the shop can pay online, and the desk records office payments (docs/22 §8, 2026-09-04). The
 * salesperson never appears here at all.
 *
 * Recording a payment is one call. `strategy: 'fifo'` allocates it to the oldest open bill first,
 * which is what a distributor means by "put it against his account"; the rest sits ON ACCOUNT and is
 * visible as such. A wrong receipt is never edited — it is REVERSED with a mirror receipt, and the
 * original stays in the register for ever (docs/22 never-list 3).
 *
 * Every mutation carries a client UUIDv7 and one idempotency key per intent, so a double tap on a
 * ₹40,000 receipt is one ₹40,000 receipt.
 */
import type { Receipt } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { receiptMayBeDeposited, receiptMayBounce, uuidv7 } from '@dos/domain'
import {
  Button,
  Dialog,
  ListRow,
  Money,
  Register,
  RupeeInput,
  Screen,
  Search,
  Segments,
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
import { documents } from '@dos/ui/platform'
import { useState } from 'react'

import {
  Async,
  ExportButton,
  Field,
  PageTabs,
  Panel,
  RangeSegments,
  Refusal,
  countText,
  moneyColumn,
  pagedCount,
  stayOpen,
  textColumn,
  useCan,
  useNames,
} from '../../src/lib/ui'
import { absoluteUrl } from '../../src/config'
import { rangeOf, shortInstant, type RangeId } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const RECEIPT_FAMILY: Readonly<Record<string, StatusFamily>> = {
  collected: 'ochre',
  deposited: 'moss',
  bounced: 'brick',
  cancelled: 'neutral',
}

type Mode = 'cash' | 'upi' | 'bank_transfer' | 'cheque'

export default function Receipts(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayRecord = can('receivables.receipts.create')
  const [range, setRange] = useState<RangeId>('d30')
  const [selected, setSelected] = useState<string | null>(null)
  const [reversing, setReversing] = useState(false)
  const [reason, setReason] = useState('')

  // --- banking a receipt, and a cheque the bank returned ---------------------------------------------
  const [depositing, setDepositing] = useState(false)
  const [depositRef, setDepositRef] = useState('')
  const [bouncing, setBouncing] = useState(false)
  const [bounceReason, setBounceReason] = useState('')
  const [charges, setCharges] = useState<number | null>(null)

  // --- recording a payment ----------------------------------------------------------------------
  const [recording, setRecording] = useState(false)
  const [shopQuery, setShopQuery] = useState('')
  const [shopId, setShopId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('cash')
  const [amount, setAmount] = useState<number | null>(null)
  const [reference, setReference] = useState('')

  const span = rangeOf(range)
  const list = useQuery(['receipts', span.from, span.to], () =>
    api.api.receivables.receipts.list({ from: span.from, to: span.to, limit: 200 }),
  )
  const detail = useQuery(
    ['receipts', 'get', selected ?? 'none'],
    () => api.api.receivables.receipts.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const receipt = detail.data?.item

  const shopHits = useQuery(
    ['retailers', 'search', shopQuery],
    () => api.api.retailers.list({ q: shopQuery, limit: 6 }),
    { enabled: recording && shopQuery.trim().length >= 2 },
  )
  const dues = useQuery(
    ['outstanding', shopId ?? 'none'],
    () => api.api.receivables.outstanding.get({ retailerId: shopId ?? '' }),
    { enabled: shopId !== null },
  )

  const create = useMutation(
    (input: { retailerId: string; mode: Mode; amountPaise: number; reference: string }, meta) =>
      api.api.receivables.receipts.create({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        retailerId: input.retailerId,
        mode: input.mode,
        amountPaise: input.amountPaise,
        strategy: 'fifo',
        ...(input.reference === '' ? {} : { reference: input.reference }),
      }),
    { invalidates: [['receipts'], ['receivables'], ['outstanding'], ['reporting']] },
  )
  const reverse = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.receivables.receipts.reverse({
        id: input.id,
        reversalId: uuidv7(),
        reason: input.reason,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['receipts'], ['receivables'], ['outstanding'], ['reporting']] },
  )

  /*
   * Banking one receipt and returning a bounced cheque: the per-receipt half of Day-end, and the only
   * place a cheque that is ALREADY banked can be returned (Day-end lists what is still in hand). The
   * buttons ask the server's own rules (`receiptMayBeDeposited`, `receiptMayBounce` in @dos/domain), and a
   * refusal stays in its dialog in the server's words instead of closing it.
   */
  const deposit = useMutation(
    (input: { receiptId: string; ref: string }, meta) =>
      api.api.receivables.receipts.deposit({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        receiptIds: [input.receiptId],
        depositedAt: new Date().toISOString(),
        ...(input.ref === '' ? {} : { depositRef: input.ref }),
      }),
    { invalidates: [['receipts'], ['receivables'], ['reporting']] },
  )
  const bounce = useMutation(
    (input: { id: string; reason: string; chargesPaise: number | null }, meta) =>
      api.api.receivables.receipts.bounce({
        id: input.id,
        reversalId: meta.id,
        idempotencyKey: meta.idempotencyKey,
        bouncedAt: new Date().toISOString(),
        reason: input.reason,
        ...(input.chargesPaise === null ? {} : { bankChargesPaise: input.chargesPaise }),
      }),
    { invalidates: [['receipts'], ['receivables'], ['outstanding'], ['reporting']] },
  )

  const rows = list.data?.items ?? []
  const page = pagedCount(list)

  const columns: readonly RegisterColumn<Receipt>[] = [
    textColumn('no', t('m9.receiptNo'), (row) => row.receiptNo, { priority: 'identity' }),
    textColumn('shop', t('m9.shop'), (row) => names.retailer(row.retailerId)),
    textColumn('mode', t('m9.mode'), (row) => word(row.mode)),
    moneyColumn('amount', t('m9.amount'), (row) => row.amountPaise),
    moneyColumn('unallocated', t('m9.unallocated'), (row) => row.unallocatedPaise, {
      cell: (row) => (
        <Money
          value={row.unallocatedPaise}
          size="cell"
          symbol={false}
          tone={row.unallocatedPaise > 0 ? 'critical' : 'default'}
        />
      ),
    }),
    {
      key: 'status',
      head: t('m9.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.status)} family={RECEIPT_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    textColumn('at', t('m9.receivedAt'), (row) => shortInstant(row.receivedAt)),
    textColumn('by', t('m9.receivedBy'), (row) => names.staff(row.receivedBy)),
  ]

  const canSubmit = shopId !== null && amount !== null && amount > 0

  return (
    <Screen
      title={t('m9.title')}
      chips={<PageTabs group="/money" active="/money" />}
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
          {mayRecord ? (
            <Button
              label={t('m9.record')}
              variant="primary"
              onPress={() => {
                setRecording(true)
              }}
              testID="record-receipt"
            />
          ) : null}
        </>
      }
    >
      <Async state={[list]} rows={12} empty={rows.length === 0} emptyMessage={t('m9.empty')}>
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
          /*
           * `receipts.list` answers `totals` for the WHOLE filtered set whatever the page size, so
           * the foot of this register states the SERVICE'S own figure rather than a sum of the two
           * hundred rows in front of it — the partial sum that made "Cash to bank" read ₹200.00
           * against a real ₹5,95,381.11 on Today.
           */
          totals={{
            no: countText(page, t('app.none')),
            amount: (
              <Money value={list.data?.totals.countedPaise ?? 0} size="cell" symbol={false} />
            ),
            unallocated: (
              <Money value={list.data?.totals.unallocatedPaise ?? 0} size="cell" symbol={false} />
            ),
          }}
        />
      </Async>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={receipt === undefined ? undefined : t('m9.detail', { no: receipt.receiptNo ?? '' })}
        testID="receipt-panel"
      >
        <Async state={[detail]} rows={5}>
          {receipt === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('m9.shop')}>{names.retailer(receipt.retailerId)}</Field>
              <Field label={t('m9.mode')}>{word(receipt.mode)}</Field>
              <Field label={t('m9.amount')}>
                <Money value={receipt.amountPaise} size="moneyM" />
              </Field>
              <Field label={t('m9.unallocated')}>
                <Money
                  value={receipt.unallocatedPaise}
                  size="cell"
                  tone={receipt.unallocatedPaise > 0 ? 'critical' : 'default'}
                />
              </Field>
              <Field label={t('m9.status')}>
                <StatusChip
                  label={word(receipt.status)}
                  family={RECEIPT_FAMILY[receipt.status] ?? 'neutral'}
                />
              </Field>

              <Panel title={t('m9.allocations')}>
                <Stack gap={2}>
                  {detail.data?.allocations.map((row) => (
                    <ListRow key={row.id} primary={row.invoiceId} trailingMoney={row.amountPaise} />
                  ))}
                </Stack>
              </Panel>

              <Button
                label={t('m9.print')}
                variant="secondary"
                onPress={() => {
                  void api.api.receivables.receipts
                    .document({ id: receipt.id, format: 'a5' })
                    .then((result) => {
                      const url = absoluteUrl(result.url)
                      if (url !== null) void documents.print(url)
                    })
                }}
                testID="receipt-print"
              />
              {can('receivables.receipts.deposit') ? (
                <Button
                  label={t('m9.deposit')}
                  variant="primary"
                  disabled={!receiptMayBeDeposited(receipt)}
                  disabledReason={t('m9.notBankable')}
                  onPress={() => {
                    deposit.reset()
                    setDepositing(true)
                  }}
                  testID="receipt-deposit"
                />
              ) : null}
              {can('receivables.receipts.bounce') ? (
                <Button
                  label={t('m9.bounce')}
                  variant="secondary"
                  disabled={!receiptMayBounce(receipt)}
                  disabledReason={t('m9.notBounceable')}
                  onPress={() => {
                    bounce.reset()
                    setBouncing(true)
                  }}
                  testID="receipt-bounce"
                />
              ) : null}
              {can('receivables.receipts.reverse') ? (
                <Button
                  label={t('m9.reverse')}
                  variant="destructive"
                  disabled={receipt.status === 'cancelled'}
                  disabledReason={t('m9.alreadyCancelled')}
                  onPress={() => {
                    setReversing(true)
                  }}
                  testID="receipt-reverse"
                />
              ) : null}
            </Stack>
          )}
        </Async>
      </Sheet>

      <Sheet
        open={recording}
        onClose={() => {
          setRecording(false)
          setShopId(null)
          setAmount(null)
        }}
        title={t('m9.recordTitle')}
        testID="record-panel"
      >
        <Stack gap={4}>
          <Search
            testID="receipt-shop"
            value={shopQuery}
            onChange={setShopQuery}
            placeholder={t('m9.pickShop')}
            state={
              shopQuery.trim().length < 2
                ? 'idle'
                : shopHits.isFetching
                  ? 'typing'
                  : (shopHits.data?.items.length ?? 0) === 0
                    ? 'noResults'
                    : 'results'
            }
          >
            {(shopHits.data?.items ?? []).map((row) => (
              <ListRow
                key={row.id}
                primary={row.name}
                state={shopId === row.id ? 'selected' : 'default'}
                onPress={() => {
                  setShopId(row.id)
                }}
              />
            ))}
          </Search>

          {dues.data === undefined ? null : (
            <Field label={t('m14.owes')}>
              <Money value={dues.data.outstandingPaise} size="moneyM" tone="critical" />
            </Field>
          )}

          <Segments
            testID="receipt-mode"
            value={mode}
            onChange={(id) => {
              setMode(id as Mode)
            }}
            items={[
              { id: 'cash', label: word('cash') },
              { id: 'upi', label: word('upi') },
              { id: 'cheque', label: word('cheque') },
            ]}
          />

          <RupeeInput
            testID="receipt-amount"
            label={t('m9.amountLabel')}
            value={amount}
            onChange={setAmount}
            bound={dues.data?.outstandingPaise ?? null}
            boundMessage={t('m9.allocateHint')}
          />

          <TextInput
            label={t('m9.reference')}
            value={reference}
            onChange={setReference}
            capitalize="none"
            testID="receipt-reference"
          />

          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('m9.allocateHint')}
          </Txt>

          {/* A refused receipt says why directly above the button that sent it (DOS-029). */}
          <Refusal of={[create]} scope={shopId} testID="receipt-refusal" />
          <Button
            label={t('m9.record')}
            variant="primary"
            disabled={!canSubmit}
            disabledReason={shopId === null ? t('m9.needsShop') : t('m9.needsAmount')}
            loading={create.status === 'pending'}
            onPress={() => {
              if (!canSubmit) return
              void create
                .mutateAsync({
                  retailerId: shopId,
                  mode,
                  amountPaise: amount,
                  reference: reference.trim(),
                })
                .then(() => {
                  setRecording(false)
                  setShopId(null)
                  setAmount(null)
                  setReference('')
                }, stayOpen)
            }}
            testID="receipt-submit"
          />
        </Stack>
      </Sheet>

      <Dialog
        open={reversing}
        onClose={() => {
          setReversing(false)
        }}
        title={t('m9.reverse')}
        body={
          <Stack gap={3}>
            <Money value={receipt?.amountPaise ?? null} size="moneyM" />
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m9.reverseBody')}
            </Txt>
            <TextInput
              label={t('m9.reverseReason')}
              value={reason}
              onChange={setReason}
              capitalize="sentences"
              testID="reverse-reason"
            />
            <Refusal of={[reverse]} testID="reverse-refusal" />
          </Stack>
        }
        confirmLabel={t('m9.reverse')}
        destructive
        busy={reverse.status === 'pending'}
        onConfirm={() => {
          if (selected === null) return
          void reverse.mutateAsync({ id: selected, reason: reason.trim() }).then(() => {
            setReversing(false)
            setReason('')
          }, stayOpen)
        }}
        testID="reverse-dialog"
      />

      <Dialog
        open={depositing}
        onClose={() => {
          setDepositing(false)
        }}
        title={t('m9.deposit')}
        body={
          <Stack gap={3}>
            <Money value={receipt?.amountPaise ?? null} size="moneyM" />
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m10.depositBody')}
            </Txt>
            <TextInput
              label={t('m10.depositRef')}
              value={depositRef}
              onChange={setDepositRef}
              capitalize="none"
              testID="receipt-deposit-ref"
            />
            <Refusal of={[deposit]} testID="receipt-deposit-refusal" />
          </Stack>
        }
        confirmLabel={t('m9.deposit')}
        busy={deposit.status === 'pending'}
        onConfirm={() => {
          if (selected === null) return
          void deposit.mutateAsync({ receiptId: selected, ref: depositRef.trim() }).then(() => {
            setDepositing(false)
            setDepositRef('')
          }, stayOpen)
        }}
        testID="receipt-deposit-dialog"
      />

      <Dialog
        open={bouncing}
        onClose={() => {
          setBouncing(false)
        }}
        title={t('m10.bounceTitle')}
        body={
          <Stack gap={3}>
            <Money value={receipt?.amountPaise ?? null} size="moneyM" />
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m10.bounceBody')}
            </Txt>
            <TextInput
              label={t('m10.bounceReason')}
              value={bounceReason}
              onChange={setBounceReason}
              capitalize="sentences"
              testID="receipt-bounce-reason"
            />
            <RupeeInput
              label={t('m10.bankCharges')}
              value={charges}
              onChange={setCharges}
              testID="receipt-bounce-charges"
            />
            <Refusal of={[bounce]} testID="receipt-bounce-refusal" />
          </Stack>
        }
        confirmLabel={t('m9.bounce')}
        destructive
        busy={bounce.status === 'pending'}
        onConfirm={() => {
          if (selected === null) return
          void bounce
            .mutateAsync({ id: selected, reason: bounceReason.trim(), chargesPaise: charges })
            .then(() => {
              setBouncing(false)
              setBounceReason('')
              setCharges(null)
            }, stayOpen)
        }}
        testID="receipt-bounce-dialog"
      />
    </Screen>
  )
}
