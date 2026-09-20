/**
 * D5 — Take money at the door (docs/23 §5.1, UX-01 D6).
 *
 * THE EXPECTED AMOUNT IS PRINTED ABOVE THE PAD AND NEVER PRE-FILLED INTO IT. That is `RupeeInput`'s
 * own `expected` prop and it is a rule, not a preference: a driver who taps "record" on a figure the
 * app typed has recorded the office's hope, not the shopkeeper's money, and the difference only shows
 * up at check-in when the cash is short.
 *
 * With a signal this is ONE call — `delivery.collections.record` wraps `ReceiptsService`, so the
 * receipt, its allocations (oldest bill first unless the crew splits it), the cash discount inside its
 * window and the balanced journal entry all happen in one transaction and the receipt NUMBER comes
 * back to be read out or printed.
 *
 * With none it is a `receipts` op in the outbox, and this screen says exactly what that costs. The
 * money is recorded and allocated correctly when it lands — `receivables.sync.ts` takes `trip_id`, so
 * cash still posts to the van's cash account — but the trip's own `collections` row is NOT written,
 * because `collections` is registered as a sync handler and is absent from `SYNC_PULL_TABLES`, so the
 * manifest can never mark it writable. `trips.settlementPreview` adds up `collections`, so an offline
 * receipt is money the day summary cannot see until the office reconciles it. The crew's paper book
 * number is what carries identity in the meantime, which is why it is offered here and why it is the
 * server's own offline dedupe key.
 */
import { useApi, useMutation, useSession } from '@dos/api-client/react'
import { useSyncEngine, useSyncStatus } from '@dos/offline/react'
import {
  Button,
  Group,
  ListRow,
  Money,
  Row,
  RupeeInput,
  Screen,
  Segments,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  formatINR,
  useColors,
  useStrings,
} from '@dos/ui'
import { haptics, share } from '@dos/ui/platform'
import { paise, uuidv7 } from '@dos/domain'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { deviceId } from '../../../src/api'
import {
  appliedLines,
  billsThatTakeMoney,
  owedHerePaise,
  tagAllocations,
  whereTheMoneyGoes,
  type DoorBill,
  type TaggedAllocation,
} from '../../../src/lib/allocate'
import { doorDoneHref, pullAfterDoorstepWrite } from '../../../src/lib/at-the-door'
import { keepApplied } from '../../../src/lib/door-money'
import { longDate, today } from '../../../src/lib/dates'
import { keepKey } from '../../../src/lib/keep'
import {
  useHydrated,
  useLocalDeliveries,
  useLocalInvoices,
  useLocalOutstanding,
  useLocalRetailers,
  useLocalStop,
  useLocalTripReceipts,
} from '../../../src/lib/local'
import { useQueueReceipt } from '../../../src/lib/queue'
import { LocalAsync, Panel, useMyUserId, pl } from '../../../src/lib/ui'

type Mode = 'cash' | 'upi' | 'cheque'

export default function Collect(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const params = useLocalSearchParams<{ id: string }>()
  const stopId = typeof params.id === 'string' ? params.id : null
  const hydrated = useHydrated()
  const status = useSyncStatus()
  /*
   * DOS-063 — the stop screen behind this one reads the shop's dues off SQLite. `collections.record`
   * posts the receipt and the new outstanding in one transaction at the office, so the device is one
   * pull away from the right figure; without that pull the crew read the OLD dues back to a shopkeeper
   * who had just paid, for as long as the sixty-second poll took to come round.
   */
  const engine = useSyncEngine()
  const myUserId = useMyUserId()

  const { stop } = useLocalStop(stopId)
  const { byId: shops } = useLocalRetailers(
    useMemo(() => (stop === null ? [] : [stop.retailer_id]), [stop]),
  )
  const shop = stop === null ? undefined : shops.get(stop.retailer_id)
  const { row: dues } = useLocalOutstanding(stop?.retailer_id ?? null)
  const deliveries = useLocalDeliveries(stopId)
  const { byId: invoices } = useLocalInvoices(
    useMemo(() => deliveries.rows.map((row) => row.invoice_id), [deliveries.rows]),
  )
  const receipts = useLocalTripReceipts(stop?.trip_id ?? null)
  const alreadyHere = receipts.rows.filter((row) => row.retailer_id === stop?.retailer_id)

  const [mode, setMode] = useState<Mode>('cash')
  const [amountPaise, setAmountPaise] = useState<number | null>(null)
  const [reference, setReference] = useState('')
  const [chequeDate, setChequeDate] = useState(today())
  const [bank, setBank] = useState('')
  const [bookNo, setBookNo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /* DOS-062: the bills the driver has tagged, by invoice id — empty means the office's own rule. */
  const [tagged, setTagged] = useState<ReadonlySet<string>>(() => new Set<string>())

  /**
   * The bills riding on this door, as `allocate.ts` reads them. A bill the office has already marked
   * paid is still LISTED — the driver is holding it — but it is not owed here and cannot be tagged.
   */
  const doorBills = useMemo<DoorBill[]>(
    () =>
      deliveries.rows.flatMap((row) => {
        const invoice = invoices.get(row.invoice_id)
        return invoice === undefined
          ? []
          : [
              {
                id: row.id,
                invoiceId: invoice.id,
                invoiceNo: invoice.invoice_no,
                invoiceDate: invoice.invoice_date,
                totalPaise: invoice.total_paise,
                state: invoice.state,
              },
            ]
      }),
    [deliveries.rows, invoices],
  )
  const owedHere = owedHerePaise(doorBills)
  const takesMoney = new Set(billsThatTakeMoney(doorBills).map((bill) => bill.invoiceId))
  /*
   * A TAG ONLY TRAVELS WITH A SIGNAL. The offline `receipts` op carries no allocations (queue.ts), so
   * an offline receipt is allocated oldest bill first when it lands. Offering a tag the phone cannot
   * send would be the same lie DOS-062 is about, one screen further on.
   */
  const canTag = status.online

  /**
   * What this door is meant to yield.
   *
   * DOS-062: the bills HERE, counted from what they still ask for — never `planned_collection_paise`,
   * which the office set before the van left and which goes on counting a bill paid since (measured on
   * Android: "Owed on the bills here ₹4,756.00" over INV/0829, which the same screen had just settled).
   * With nothing left owed at this door it is the shop's whole outstanding, and the label says so.
   */
  const expectedHere = owedHere > 0
  const expectedPaise = expectedHere
    ? owedHere
    : (dues?.outstanding_paise ?? stop?.planned_collection_paise ?? null)

  /** A UPI payment link to send to the shopkeeper — the payload the office already built on the bill. */
  const upiPayload =
    [...invoices.values()].find((invoice) => invoice.upi_qr_payload !== null)?.upi_qr_payload ??
    null

  const queueReceipt = useQueueReceipt()

  const collect = useMutation(
    (input: { mode: Mode; amountPaise: number; allocations: TaggedAllocation[] | null }, meta) =>
      api.api.delivery.collections.record({
        idempotencyKey: meta.idempotencyKey,
        id: meta.id,
        receiptId: uuidv7(),
        tripId: stop?.trip_id ?? '',
        stopId: stop?.id ?? '',
        retailerId: stop?.retailer_id ?? '',
        mode: input.mode,
        amountPaise: input.amountPaise,
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        ...(input.mode === 'cheque' ? { chequeDate } : {}),
        ...(bank.trim() === '' ? {} : { bankName: bank.trim() }),
        ...(bookNo.trim() === '' ? {} : { clientReceiptNo: bookNo.trim() }),
        /*
         * DOS-062 — "unless tagged". An empty split is not sent at all: the server reads the presence
         * of `allocations` as `strategy: 'explicit'`, and an empty explicit split would allocate
         * nothing rather than falling back to the office's oldest-bill-first rule.
         */
        ...(input.allocations === null || input.allocations.length === 0
          ? {}
          : { allocations: input.allocations }),
        collectedAt: new Date().toISOString(),
        deviceId: deviceId(),
      }),
    {
      invalidates: [['trip'], ['settlement'], ['collections']],
      onSuccess: (result) => {
        haptics.success()
        void pullAfterDoorstepWrite(engine, 'payment recorded')
        /*
         * DOS-062 — THE BILLS THIS MONEY ACTUALLY PAID, WHILE THE SHOPKEEPER IS STILL THERE. The
         * office's own answer carries them (`allocations` + `invoices` with each bill's open balance),
         * and the device has no allocations table of its own, so this reply is the ONE place they
         * exist. They are handed to the stop, which is the screen still standing a second later
         * (DOS-149) and where the receipt number is already said; this one is being replaced.
         */
        keepApplied(
          appliedLines(t, {
            allocations: result.allocations,
            invoices: result.invoices,
            unallocatedPaise: result.unallocatedPaise,
            money: (value) => formatINR(paise(value)),
          }),
        )
        router.replace(
          doorDoneHref(stopId ?? '', {
            code: 'money',
            no: result.receipt.receiptNo ?? result.receipt.id.slice(0, 8),
          }),
        )
      },
      onError: (failed) => {
        haptics.error()
        setError(failed.message)
      },
    },
  )

  const needsReference = mode !== 'cash' && reference.trim() === ''
  const amountBad = amountPaise === null || amountPaise <= 0

  const commit = (): void => {
    setError(null)
    if (amountBad) return
    if (needsReference) {
      setError(t('d5.needsReference'))
      return
    }
    if (stop === null) return
    if (status.online) {
      collect.mutate({
        mode,
        amountPaise,
        allocations: tagAllocations({ bills: doorBills, tagged, amountPaise, newId: uuidv7 }),
      })
      return
    }
    setBusy(true)
    void (async () => {
      try {
        const id = await queueReceipt({
          tripId: stop.trip_id,
          retailerId: stop.retailer_id,
          mode,
          amountPaise,
          reference: reference.trim(),
          ...(mode === 'cheque' ? { chequeDate } : {}),
          bankName: bank.trim(),
          clientReceiptNo: bookNo.trim(),
          deviceId: deviceId(),
          receivedBy: myUserId,
        })
        haptics.success()
        router.replace(
          doorDoneHref(stopId ?? '', {
            code: 'moneyKept',
            no: bookNo.trim() === '' ? id.slice(0, 8) : bookNo.trim(),
          }),
        )
      } catch (thrown) {
        haptics.error()
        setError(thrown instanceof Error ? thrown.message : t('d5.failed'))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Screen
      title={t('d5.title')}
      context={shop?.name ?? t('d3.title')}
      chips={
        <Row gap={2} wrap>
          {dues === null ? null : (
            <StatusChip
              testID="d5-dues"
              label={t('d.owes', { amount: formatINR(paise(dues.outstanding_paise)) })}
              family={dues.overdue_paise > 0 ? 'brick' : 'neutral'}
              solid={dues.overdue_paise > 0}
              figure
            />
          )}
          {alreadyHere.length === 0 ? null : (
            <StatusChip
              testID="d5-already"
              label={pl(t, 'd5.settled', alreadyHere.length)}
              family="moss"
              figure
            />
          )}
        </Row>
      }
      bottomBar={
        <Stack gap={2}>
          {/*
              NAME THE FIGURE BY WHAT IT IS. This is what the bills at THIS DOOR still ask for when
              any of them can still take money (DOS-062), and the shop's whole outstanding when none
              can — and the chip at the top of the same screen already says what the shop owes.
              Labelling ₹9,399 "The shop owes" beside a chip reading "Owes ₹68,203.00" is one screen
              giving a shopkeeper two answers to the same question, as money changes hands.
            */}
          <Row justify="between" align="center" gap={3}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {expectedHere ? t('d5.expectedHere') : t('d5.expected')}
            </Txt>
            <Money value={expectedPaise} size="moneyM" testID="d5-expected" />
          </Row>
          <Button
            testID="d5-record"
            label={status.online ? t('d5.record') : t(keepKey('recordMoney', status.persistent))}
            variant="primary"
            size="floor"
            fullWidth
            loading={busy || collect.status === 'pending'}
            disabled={amountBad || needsReference}
            disabledReason={amountBad ? t('d5.amount') : t('d5.needsReference')}
            onPress={commit}
          />
        </Stack>
      }
      testID="d5-screen"
    >
      <Stack gap={6}>
        <Panel title={t('d.bills')} testID="d5-bills">
          <LocalAsync
            loading={deliveries.loading}
            hydrated={hydrated}
            empty={deliveries.rows.length === 0}
            emptyMessage={t('d3.noBills')}
            waitingMessage={t('d.filling')}
          >
            <Stack gap={3}>
              <Group>
                {deliveries.rows.map((row) => {
                  const invoice = invoices.get(row.invoice_id)
                  const invoiceId = invoice?.id ?? null
                  const open = invoiceId !== null && takesMoney.has(invoiceId)
                  return (
                    <ListRow
                      key={row.id}
                      testID={`d5-bill-${row.id}`}
                      primary={invoice?.invoice_no ?? t('d.billNotHere')}
                      secondary={invoice === undefined ? undefined : longDate(invoice.invoice_date)}
                      trailingMoney={invoice?.total_paise ?? null}
                      trailingSize="moneyM"
                      /*
                        A BILL THE OFFICE HAS MARKED PAID IS NOT OFFERED AGAIN. It stays on the list —
                        the driver is holding the paper — but it says "Paid", it cannot be tagged, and
                        it is out of the figure above the pad. Offering it as owed is how one shop
                        pays the same bill twice at one door.
                      */
                      trailing={
                        invoiceId !== null && !open ? (
                          <StatusChip
                            testID={`d5-paid-${row.id}`}
                            label={t('d5.paidOff')}
                            family="moss"
                          />
                        ) : tagged.has(invoiceId ?? '') ? (
                          <StatusChip
                            testID={`d5-tagged-${row.id}`}
                            label={t('d5.tagged')}
                            family="ochre"
                            solid
                          />
                        ) : undefined
                      }
                      state={tagged.has(invoiceId ?? '') ? 'selected' : 'default'}
                      {...(open && invoiceId !== null && canTag
                        ? {
                            onPress: () => {
                              setTagged((held) => {
                                const next = new Set(held)
                                if (next.has(invoiceId)) next.delete(invoiceId)
                                else next.add(invoiceId)
                                return next
                              })
                            },
                          }
                        : {})}
                    />
                  )
                })}
              </Group>
              {/*
                DOS-062 — SAID BEFORE THE MONEY CHANGES HANDS, which is while the shopkeeper is still
                standing there and can say which bill he means. After the fact it is an apology.
              */}
              <Txt field="label" desk="meta" color={colors.text.secondary} testID="d5-goes">
                {status.online
                  ? whereTheMoneyGoes(t, {
                      bills: doorBills,
                      tagged,
                      openBills: dues?.open_bills ?? takesMoney.size,
                    })
                  : t('d5.appliedOffline')}
              </Txt>
            </Stack>
          </LocalAsync>
        </Panel>

        <Panel title={t('d5.mode')} testID="d5-form">
          <Stack gap={4}>
            <Segments
              testID="d5-mode"
              items={[
                { id: 'cash', label: t('d5.cash') },
                { id: 'upi', label: t('d5.upi') },
                { id: 'cheque', label: t('d5.cheque') },
              ]}
              value={mode}
              onChange={(id) => {
                setMode(id as Mode)
                setError(null)
              }}
            />

            {/* `expected` prints ABOVE and never pre-fills — UX-00 §6.3, UX-01 D6. */}
            <RupeeInput
              testID="d5-amount"
              label={t('d5.amount')}
              value={amountPaise}
              onChange={setAmountPaise}
              expected={expectedPaise}
              expectedLabel={t('d5.expectedLabel')}
              bound={dues?.outstanding_paise ?? null}
              boundMessage={t('d5.onAccount', { amount: t('d.unknown') })}
              autoFocus
            />

            {mode === 'cash' ? null : (
              <TextInput
                testID="d5-reference"
                label={mode === 'upi' ? t('d5.reference') : t('d5.chequeNo')}
                value={reference}
                onChange={setReference}
                maxLength={64}
                {...(needsReference ? { error: t('d5.needsReference') } : {})}
              />
            )}
            {mode === 'cheque' ? (
              <Row gap={4} wrap>
                <TextInput
                  testID="d5-cheque-date"
                  label={t('d5.chequeDate')}
                  value={chequeDate}
                  onChange={setChequeDate}
                  maxLength={10}
                />
                <TextInput
                  testID="d5-bank"
                  label={t('d5.bank')}
                  value={bank}
                  onChange={setBank}
                  capitalize="words"
                  maxLength={120}
                />
              </Row>
            ) : null}

            <TextInput
              testID="d5-book-no"
              label={t('d5.bookNo')}
              helper={t('d5.bookNoHelp')}
              value={bookNo}
              onChange={setBookNo}
              maxLength={32}
            />

            {mode === 'upi' && upiPayload !== null ? (
              <Button
                testID="d5-upi-link"
                label={t('d5.qr')}
                variant="secondary"
                disabled={!share.available}
                disabledReason={t('d9.notShared')}
                onPress={() => {
                  void share.share({
                    title: session?.tenant.displayName ?? '',
                    message: `${session?.tenant.displayName ?? ''} · ${formatINR(paise(expectedPaise ?? 0))}`,
                    url: upiPayload,
                  })
                }}
              />
            ) : null}
          </Stack>
        </Panel>

        {status.online ? null : (
          <Txt field="body" desk="body" color={colors.text.secondary} testID="d5-offline">
            {`${t(keepKey('offlineWrite', status.persistent))} ${t('d5.offlineNoNumber')}`}
          </Txt>
        )}

        {error === null ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg} testID="d5-error">
            {error}
          </Txt>
        )}
      </Stack>
    </Screen>
  )
}
