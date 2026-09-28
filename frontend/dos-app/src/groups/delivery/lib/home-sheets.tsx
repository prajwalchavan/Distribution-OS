/**
 * The two surfaces a card on the driver's home opens: the ONE confirm behind "Delivered, all items",
 * and the "Take money" sheet (founder, 2026-09-28).
 *
 * Both are the kit's own (`Dialog`, `Sheet`) and both keep the kit's rules. The confirm states exactly
 * what will be written — the shop, every bill and its pieces, "delivered in full" — and its verb is the
 * real one, never "OK". The money sheet prints what is still to collect ABOVE the field and never
 * pre-fills it: the driver types what the shopkeeper handed over (`RupeeInput`'s `expected`, UX-01 D6).
 * Anything unusual — tagging a bill, a cheque's date and bank, the paper book number — is one tap away
 * on D5, the screen that already does it, rather than squeezed in here.
 *
 * Every word comes from the group's strings. Where a sentence says a write is kept on this device it
 * goes through `keepKey` (DOS-179), so a browser that keeps nothing is never told otherwise.
 */
import {
  Button,
  Dialog,
  RupeeInput,
  Segments,
  Sheet,
  Stack,
  TextInput,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useEffect, useState } from 'react'

import { today } from './dates'
import { moneyNeedsReference, type DoorMoney, type DoorMoneyMode } from './door-writes'
import type { BillToDeliver } from './home'
import { keepKey } from './keep'

// ---------------------------------------------------------------------------
// Delivered, all items — the one confirm
// ---------------------------------------------------------------------------

export interface DeliverAllDialogProps {
  open: boolean
  shop: string
  bills: readonly BillToDeliver[]
  online: boolean
  persistent: boolean | null
  busy: boolean
  /**
   * Why nothing (or not everything) was written — the office's own sentence, or DOS-148's "this bill
   * is not on this van". Said inside the dialog, where the driver's thumb still is, never in a toast
   * that is gone in four seconds.
   */
  error: string | null
  onConfirm: () => void
  onClose: () => void
}

export function DeliverAllDialog({
  open,
  shop,
  bills,
  online,
  persistent,
  busy,
  error,
  onConfirm,
  onClose,
}: DeliverAllDialogProps): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  return (
    <Dialog
      testID="d1-deliver-confirm"
      open={open}
      onClose={onClose}
      title={t('home.confirmTitle')}
      body={
        <Stack gap={3}>
          <Txt field="bodyStrong" desk="body">
            {shop}
          </Txt>
          <Stack gap={1}>
            {bills.map((bill) => (
              <Txt
                key={bill.deliveryId}
                field="body"
                desk="body"
                numeric
                testID={`d1-confirm-bill-${bill.deliveryId}`}
              >
                {t('home.confirmBill', {
                  no: bill.invoiceNo ?? t('d.bill'),
                  pieces: bill.pieces ?? 0,
                })}
              </Txt>
            ))}
          </Stack>
          <Txt field="body" desk="body" testID="d1-confirm-body">
            {/* One bill is "this bill", not "these bills" (verify-1 m3). */}
            {t(bills.length === 1 ? 'home.confirmBody.one' : 'home.confirmBody', { shop })}
          </Txt>
          {online ? null : (
            <Txt
              field="label"
              desk="meta"
              color={colors.text.secondary}
              testID="d1-confirm-offline"
            >
              {t(keepKey('offlineWrite', persistent))}
            </Txt>
          )}
          {error === null ? null : (
            <Txt field="body" desk="body" color={colors.status.brick.fg} testID="d1-confirm-error">
              {error}
            </Txt>
          )}
        </Stack>
      }
      confirmLabel={t('home.confirmDeliver')}
      busy={busy}
      onConfirm={onConfirm}
    />
  )
}

// ---------------------------------------------------------------------------
// Take money — the sheet
// ---------------------------------------------------------------------------

export interface MoneySheetProps {
  open: boolean
  shop: string
  /** What the office's plan still asks for here — printed above the field, never typed into it. */
  leftPaise: number | null
  online: boolean
  persistent: boolean | null
  busy: boolean
  /** The office's refusal, word for word, or null. */
  error: string | null
  onRecord: (money: DoorMoney) => void
  /** Opens D5, where a bill can be tagged and a cheque's date and bank written. */
  onMoreOptions: () => void
  onClose: () => void
}

export function MoneySheet({
  open,
  shop,
  leftPaise,
  online,
  persistent,
  busy,
  error,
  onRecord,
  onMoreOptions,
  onClose,
}: MoneySheetProps): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const [mode, setMode] = useState<DoorMoneyMode>('cash')
  const [amountPaise, setAmountPaise] = useState<number | null>(null)
  const [reference, setReference] = useState('')

  /* Every opening starts EMPTY: a figure left over from another shop is a pre-filled amount. */
  useEffect(() => {
    if (!open) return
    setMode('cash')
    setAmountPaise(null)
    setReference('')
  }, [open])

  const needsReference = moneyNeedsReference({ mode, reference })
  const amountBad = amountPaise === null || amountPaise <= 0

  return (
    <Sheet open={open} onClose={onClose} title={t('home.moneyTitle')} testID="d1-money-sheet">
      <Stack gap={4}>
        <Txt field="bodyStrong" desk="body">
          {shop}
        </Txt>
        <Segments
          testID="d1-money-mode"
          items={[
            { id: 'cash', label: t('d5.cash') },
            { id: 'upi', label: t('d5.upi') },
            { id: 'cheque', label: t('d5.cheque') },
          ]}
          value={mode}
          onChange={(id) => {
            setMode(id as DoorMoneyMode)
          }}
        />
        {/* `expected` prints ABOVE and never pre-fills — UX-00 §6.3, UX-01 D6. */}
        <RupeeInput
          testID="d1-money-amount"
          label={t('d5.amount')}
          value={amountPaise}
          onChange={setAmountPaise}
          expected={leftPaise}
          expectedLabel={t('home.moneyLeft')}
        />
        {mode === 'cash' ? null : (
          <TextInput
            testID="d1-money-reference"
            label={mode === 'upi' ? t('d5.reference') : t('d5.chequeNo')}
            value={reference}
            onChange={setReference}
            maxLength={64}
            {...(needsReference ? { error: t('d5.needsReference') } : {})}
          />
        )}
        <Txt field="label" desk="meta" color={colors.text.secondary} testID="d1-money-goes">
          {online ? t('home.moneyGoes') : t('home.moneyGoesLater')}
        </Txt>
        {online ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary} testID="d1-money-offline">
            {t(keepKey('offlineWrite', persistent))}
          </Txt>
        )}
        {error === null ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg} testID="d1-money-error">
            {error}
          </Txt>
        )}
        <Button
          testID="d1-money-record"
          label={t('d5.record')}
          variant="primary"
          size="floor"
          fullWidth
          loading={busy}
          disabled={amountBad || needsReference}
          disabledReason={amountBad ? t('d6.enterTaken') : t('d5.needsReference')}
          onPress={() => {
            if (amountPaise === null || amountBad || needsReference) return
            onRecord({
              mode,
              amountPaise,
              reference,
              chequeDate: today(),
              bankName: '',
              bookNo: '',
            })
          }}
        />
        <Stack gap={1}>
          <Button
            testID="d1-money-more"
            label={t('home.moreOptions')}
            variant="ghost"
            onPress={onMoreOptions}
          />
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('home.moreOptionsHelp')}
          </Txt>
        </Stack>
      </Stack>
    </Sheet>
  )
}
