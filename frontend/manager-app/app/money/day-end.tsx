/**
 * M10 — day-end: banking, cheques and trip settlement (docs/23 §2.1).
 *
 * The three things that close a distributor's day, in the order they stand on the screen:
 *
 *  1. A CHEQUE COMES BACK. The cheques still in hand sit at the top; tapping one the bank returned
 *     calls `receipts.bounce`, which restores the shop's outstanding EXACTLY as it was, and the bank's
 *     charge is recorded against the day, not against the shop's ledger. A cheque already banked is
 *     returned from its receipt panel on Money → Receipts.
 *  2. THE VAN COMES BACK. Beside the cheques, the trips waiting in `closing`. Picking one opens
 *     `delivery.trips.settlementPreview` directly below them — the check-in cockpit: opening cash,
 *     what was collected by mode, what was spent, and therefore what cash the crew owes. The desk
 *     counts what was actually handed over; a difference beyond the tenant's own tolerance is not
 *     something this screen may wave through, so `acceptVariance` raises an approval for the owner.
 *  3. THE CASH GOES TO THE BANK. The register underneath lists only what a desk can carry to the
 *     bank: cash and cheques still `collected` (`receiptMayBeDeposited`, the server's own rule).
 *     Ticking rows raises a bar at the foot of the screen, in view however far the register is
 *     scrolled, and banking the batch with the slip number is one call that marks them all.
 *
 * The accountant does all three: this is the money desk. `trips.settle` is owner + manager +
 * accountant, `receipts.deposit` and `bounce` likewise.
 */
import type { Receipt, Trip } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { receiptMayBeDeposited } from '@dos/domain'
import {
  Button,
  Dialog,
  KpiStrip,
  ListRow,
  Money,
  Register,
  RupeeInput,
  Screen,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  formatINR,
  paise,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import {
  Async,
  Columns,
  Field,
  Half,
  PageTabs,
  Panel,
  addCounts,
  moneyColumn,
  pagedCount,
  textColumn,
  useCan,
  useNames,
  type PagedCount,
} from '../../src/lib/ui'
import { shortInstant } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

export default function DayEnd(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayBank = can('receivables.receipts.deposit')
  const maySettle = can('delivery.trips.settle')
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [depositRef, setDepositRef] = useState('')
  const [banking, setBanking] = useState(false)
  const [bouncing, setBouncing] = useState<string | null>(null)
  const [bounceReason, setBounceReason] = useState('')
  const [charges, setCharges] = useState<number | null>(null)
  const [tripId, setTripId] = useState<string | null>(null)
  const [handedOver, setHandedOver] = useState<number | null>(null)
  const [settleNote, setSettleNote] = useState('')
  const [settling, setSettling] = useState(false)

  /*
   * The register is exactly the money a desk can carry to the bank: cash and cheques still
   * `collected`, read as the two mode-filtered lists the KPI figures use. A plain `collected` list
   * also held UPI and bank transfers — money already in the bank — under "Cash and cheques in hand",
   * and a batch with one of them in it is refused whole by the server.
   *
   * The KPI figures and the register's foot are the SERVICE'S OWN TOTALS for each mode, not a sum over
   * the page. Summing a capped page reported ₹200.00 of cash where the real figure is ₹5,95,381.11 — a
   * partial sum that looks like a total, on the one screen whose whole job is to say how much money is
   * in the drawer.
   */
  const cashTotals = useQuery(['receipts', 'collected', 'cash'], () =>
    api.api.receivables.receipts.list({ status: 'collected', mode: 'cash', limit: 200 }),
  )
  const chequeTotals = useQuery(['receipts', 'collected', 'cheque'], () =>
    api.api.receivables.receipts.list({ status: 'collected', mode: 'cheque', limit: 200 }),
  )
  const trips = useQuery(
    ['delivery', 'trips', 'closing'],
    () => api.api.delivery.trips.list({ limit: 50 }),
    { enabled: can('delivery.trips.list') },
  )
  const preview = useQuery(
    ['delivery', 'settlement', tripId ?? 'none'],
    () => api.api.delivery.trips.settlementPreview({ id: tripId ?? '' }),
    { enabled: tripId !== null && maySettle },
  )

  const deposit = useMutation(
    (input: { receiptIds: readonly string[]; ref: string }, meta) =>
      api.api.receivables.receipts.deposit({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        receiptIds: [...input.receiptIds],
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
  const settle = useMutation(
    (input: { tripId: string; handedOverCashPaise: number; note: string; accept: boolean }, meta) =>
      api.api.delivery.trips.settle({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        tripId: input.tripId,
        handedOverCashPaise: input.handedOverCashPaise,
        acceptVariance: input.accept,
        ...(input.note === '' ? {} : { note: input.note }),
      }),
    { invalidates: [['delivery'], ['receipts'], ['receivables'], ['reporting']] },
  )

  const countLabel = (of: PagedCount): string =>
    of.count === undefined
      ? t('app.none')
      : of.more
        ? t('m1.rowsMore', { count: of.count })
        : t('app.rows', { count: of.count })
  const cashCount = pagedCount(cashTotals)
  const chequeCount = pagedCount(chequeTotals)
  /* The cheque list is short enough to page in full, and the row list is what the bounce panel uses. */
  const cheques = chequeTotals.data?.items ?? []
  /* The register: both pages, newest first, the order one list read would have given. */
  const receipts = [...(cashTotals.data?.items ?? []), ...cheques].sort(
    (a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt),
  )
  const inHandCount = addCounts(cashCount, chequeCount)
  /* The foot is the two services' own totals added up, and nothing until both have answered. */
  const inHandPaise =
    cashTotals.data === undefined || chequeTotals.data === undefined
      ? null
      : cashTotals.data.totals.countedPaise + chequeTotals.data.totals.countedPaise
  const tickedTotal = receipts
    .filter((row) => ticked.includes(row.id))
    .reduce((sum, row) => sum + row.amountPaise, 0)

  /** Trips that have come back and are waiting for the desk: `closing`, never one still on the road. */
  const closing = (trips.data?.items ?? []).filter((row) => row.state === 'closing')

  const receiptColumns: readonly RegisterColumn<Receipt>[] = [
    textColumn('no', t('m9.receiptNo'), (row) => row.receiptNo, { priority: 'identity' }),
    textColumn('shop', t('m9.shop'), (row) => names.retailer(row.retailerId)),
    textColumn('mode', t('m9.mode'), (row) => word(row.mode)),
    moneyColumn('amount', t('m9.amount'), (row) => row.amountPaise),
    textColumn('at', t('m9.receivedAt'), (row) => shortInstant(row.receivedAt)),
    {
      key: 'ticked',
      head: t('m10.ticked'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={ticked.includes(row.id) ? t('word.yes') : t('word.no')}
          family={ticked.includes(row.id) ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  const tripColumns: readonly RegisterColumn<Trip>[] = [
    textColumn('no', t('m10.tripNo'), (row) => row.tripNo, { priority: 'identity' }),
    textColumn('vehicle', t('m10.vehicle'), (row) => row.vehicleRegNo),
    textColumn('driver', t('m10.driver'), (row) => names.staff(row.driverId)),
    textColumn(
      'stops',
      t('m10.stops'),
      (row) => `${String(row.stopsCompleted)}/${String(row.plannedStops)}`,
      { align: 'right' },
    ),
    {
      key: 'state',
      head: t('m4.status'),
      priority: 'chip',
      cell: (row) => <StatusChip label={word(row.state)} family="ochre" />,
    },
  ]

  const p = preview.data
  const variance = p === undefined || handedOver === null ? 0 : handedOver - p.expectedCashPaise
  const beyondTolerance = p !== undefined && Math.abs(variance) > p.tolerancePaise

  return (
    <Screen
      title={t('m10.title')}
      chips={<PageTabs group="/money" active="/money/day-end" />}
      bottomBar={
        mayBank && ticked.length > 0 ? (
          <Stack gap={2}>
            <Txt field="body" desk="body" numeric>
              {t('m10.selected', { count: ticked.length, amount: formatINR(paise(tickedTotal)) })}
            </Txt>
            <Button
              label={t('m10.deposit')}
              variant="primary"
              onPress={() => {
                setBanking(true)
              }}
              testID="bank-batch"
            />
          </Stack>
        ) : undefined
      }
    >
      <Stack gap={6}>
        <Async state={[cashTotals, chequeTotals]} rows={4}>
          <KpiStrip
            testID="dayend-kpis"
            items={[
              {
                label: t('m1.cashToBank'),
                value: <Money value={cashTotals.data?.totals.countedPaise ?? null} size="moneyM" />,
                delta: countLabel(cashCount),
              },
              {
                label: t('m10.cheques'),
                value: (
                  <Money value={chequeTotals.data?.totals.countedPaise ?? null} size="moneyM" />
                ),
                delta: countLabel(chequeCount),
              },
              {
                label: t('m10.trips'),
                value: String(closing.length),
                tone: closing.length > 0 ? 'critical' : 'neutral',
              },
            ]}
          />
        </Async>

        {/*
         * Cheques and trips come before the register, and the settlement form follows the trips: under
         * a register of two hundred rows, a cheque card or a trip picked at the top would act out of sight.
         */}
        <Columns>
          <Half>
            <Panel
              title={t('m10.cheques')}
              meta={mayBank ? t('m10.chequesHint') : undefined}
              testID="dayend-cheques"
            >
              <Async
                state={[chequeTotals]}
                rows={4}
                empty={cheques.length === 0}
                emptyMessage={t('m10.empty')}
              >
                <Stack gap={2}>
                  {cheques.map((row) => (
                    <ListRow
                      key={row.id}
                      primary={names.retailer(row.retailerId)}
                      secondary={`${row.receiptNo ?? ''} · ${row.bankName ?? t('app.none')}`}
                      trailingMoney={row.amountPaise}
                      onPress={
                        mayBank
                          ? () => {
                              setBouncing(row.id)
                            }
                          : undefined
                      }
                    />
                  ))}
                </Stack>
              </Async>
            </Panel>
          </Half>

          <Half>
            <Panel title={t('m10.trips')} testID="dayend-trips">
              <Async
                state={[trips]}
                rows={4}
                empty={closing.length === 0}
                emptyMessage={t('m10.noTrips')}
              >
                <Register
                  testID="trips-register"
                  columns={tripColumns}
                  rows={closing}
                  rowKey={(row) => row.id}
                  frozen="no"
                  selectedKey={tripId}
                  onSelect={
                    maySettle
                      ? (row) => {
                          setTripId(row.id)
                          setHandedOver(null)
                        }
                      : undefined
                  }
                  state="ready"
                />
              </Async>
            </Panel>
          </Half>
        </Columns>

        {tripId === null || p === undefined ? null : (
          <Panel title={t('m10.settleTitle')} testID="dayend-settlement">
            <Stack gap={4}>
              <Columns>
                <Half>
                  <Field label={t('m10.collections')}>
                    <Money value={p.cashCollectedPaise} size="moneyM" />
                  </Field>
                  <Field label={t('m10.expenses')}>
                    <Money value={p.expensesPaise} size="cell" />
                  </Field>
                </Half>
                <Half>
                  <Field label={t('m10.expectedCash')}>
                    <Money value={p.expectedCashPaise} size="moneyM" />
                  </Field>
                  <Field label={t('m10.tolerance', { amount: formatINR(paise(p.tolerancePaise)) })}>
                    <Money value={p.tolerancePaise} size="cell" />
                  </Field>
                </Half>
              </Columns>

              <RupeeInput
                testID="settle-cash"
                label={t('m10.countedCash')}
                value={handedOver}
                onChange={setHandedOver}
                expected={p.expectedCashPaise}
                expectedLabel={t('m10.expectedCash')}
              />

              {handedOver === null ? null : (
                <Field label={t('m10.variance')}>
                  <Money
                    value={variance}
                    size="moneyM"
                    tone={beyondTolerance ? 'critical' : 'default'}
                  />
                </Field>
              )}

              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('m10.settleBody')}
              </Txt>

              <Button
                label={t('m10.settle')}
                variant="primary"
                disabled={handedOver === null}
                disabledReason={t('m10.countedCash')}
                onPress={() => {
                  setSettling(true)
                }}
                testID="settle-trip"
              />
            </Stack>
          </Panel>
        )}

        <Panel
          title={t('m10.toBank')}
          meta={mayBank && ticked.length === 0 ? t('m10.tickToBank') : undefined}
          testID="dayend-bank"
        >
          <Async
            state={[cashTotals, chequeTotals]}
            rows={8}
            empty={receipts.length === 0}
            emptyMessage={t('m10.empty')}
          >
            <Register
              testID="tobank-register"
              columns={receiptColumns}
              rows={receipts}
              rowKey={(row) => row.id}
              frozen="no"
              onSelect={
                mayBank
                  ? (row) => {
                      if (!receiptMayBeDeposited(row)) return
                      setTicked((current) =>
                        current.includes(row.id)
                          ? current.filter((id) => id !== row.id)
                          : [...current, row.id],
                      )
                    }
                  : undefined
              }
              state="ready"
              totals={{
                no: countLabel(inHandCount),
                amount: <Money value={inHandPaise} size="cell" symbol={false} />,
              }}
            />
          </Async>
        </Panel>
      </Stack>

      <Dialog
        open={banking}
        onClose={() => {
          setBanking(false)
        }}
        title={t('m10.depositTitle')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body" numeric>
              {t('m10.selected', { count: ticked.length, amount: formatINR(paise(tickedTotal)) })}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m10.depositBody')}
            </Txt>
            <TextInput
              label={t('m10.depositRef')}
              value={depositRef}
              onChange={setDepositRef}
              capitalize="none"
              testID="deposit-ref"
            />
          </Stack>
        }
        confirmLabel={t('m10.deposit')}
        busy={deposit.status === 'pending'}
        onConfirm={() => {
          void deposit.mutateAsync({ receiptIds: ticked, ref: depositRef.trim() }).then(
            () => {
              setTicked([])
              setDepositRef('')
              setBanking(false)
            },
            () => {
              setBanking(false)
            },
          )
        }}
        testID="deposit-dialog"
      />

      <Dialog
        open={bouncing !== null}
        onClose={() => {
          setBouncing(null)
        }}
        title={t('m10.bounceTitle')}
        body={
          <Stack gap={3}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('m10.bounceBody')}
            </Txt>
            <TextInput
              label={t('m10.bounceReason')}
              value={bounceReason}
              onChange={setBounceReason}
              capitalize="sentences"
              testID="bounce-reason"
            />
            <RupeeInput
              label={t('m10.bankCharges')}
              value={charges}
              onChange={setCharges}
              testID="bounce-charges"
            />
          </Stack>
        }
        confirmLabel={t('m10.bounce')}
        destructive
        busy={bounce.status === 'pending'}
        onConfirm={() => {
          if (bouncing === null) return
          void bounce
            .mutateAsync({ id: bouncing, reason: bounceReason.trim(), chargesPaise: charges })
            .then(
              () => {
                setBouncing(null)
                setBounceReason('')
                setCharges(null)
              },
              () => {
                setBouncing(null)
              },
            )
        }}
        testID="bounce-dialog"
      />

      <Dialog
        open={settling}
        onClose={() => {
          setSettling(false)
        }}
        title={t('m10.settleTitle')}
        body={
          <Stack gap={3}>
            <Money value={handedOver} size="moneyM" />
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {beyondTolerance ? t('m10.acceptVariance') : t('m10.settleBody')}
            </Txt>
            <TextInput
              label={t('app.note')}
              value={settleNote}
              onChange={setSettleNote}
              capitalize="sentences"
              testID="settle-note"
            />
          </Stack>
        }
        confirmLabel={t('m10.settle')}
        busy={settle.status === 'pending'}
        onConfirm={() => {
          if (tripId === null || handedOver === null) return
          void settle
            .mutateAsync({
              tripId,
              handedOverCashPaise: handedOver,
              note: settleNote.trim(),
              accept: beyondTolerance,
            })
            .then(
              () => {
                setSettling(false)
                setTripId(null)
                setHandedOver(null)
                setSettleNote('')
              },
              () => {
                setSettling(false)
              },
            )
        }}
        testID="settle-dialog"
      />
    </Screen>
  )
}
