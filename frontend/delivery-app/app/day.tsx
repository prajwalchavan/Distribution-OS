/**
 * D8 — End of day: check the vehicle in, and hand over what the office expects (docs/23 §5.1).
 *
 * THE CREW DOES NOT SETTLE THE TRIP, AND THAT IS BY DESIGN. `delivery.trips.settle` is MONEY_DESK —
 * the cashier counts the cash and the godown counts the van back in, both at the office, and a
 * variance beyond the tenant's tolerance needs the owner. What the crew does here is `trips.return`:
 * the trip goes `active → closing`, stops it never reached are recorded as not delivered and their
 * orders go back to the office, and the goods stay on the van until they are counted. The screen says
 * whose step comes next instead of drawing a button that would 403.
 *
 * The figures come from `trips.settlementPreview`, which recomputes them on every read — nothing is
 * held in process memory (docs/20 rule 1). With no signal the screen shows what the DEVICE can
 * account for and says which part of the arithmetic it cannot see, rather than printing a confident
 * total that is missing this trip's expenses.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import { useSyncStatus } from '@dos/offline/react'
import {
  Button,
  caseLine,
  Dialog,
  Group,
  KpiStrip,
  ListRow,
  Money,
  Row,
  Screen,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  formatCount,
  formatINR,
  useColors,
  wordFor,
  useStrings,
} from '@dos/ui'
import { paise } from '@dos/domain'
import { haptics } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { deviceId } from '../src/api'
import { checkInBlock, dayEndCash, deviceMoney } from '../src/lib/check-in'
import { longDate } from '../src/lib/dates'
import { keepKey } from '../src/lib/keep'
import {
  addressLine,
  isStopTerminal,
  pickCurrentTrip,
  useHydrated,
  useLocalRetailers,
  useLocalStops,
  useLocalTripReceipts,
  useLocalTrips,
} from '../src/lib/local'
import { Async, DeskOnly, Field, FillingNote, LocalAsync, Panel } from '../src/lib/ui'

export default function DaySummary(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null
  const status = useSyncStatus()
  const hydrated = useHydrated()

  /*
   * WHICH TRIP. With no `tripId` this is today's — the open trip the device holds. D11's history rows
   * name one, and a settled trip is not in `useLocalTrips` (open states only) and may not be on the
   * phone at all, so the office's own `trips.get` fills the screen in that case. `settlementPreview`
   * answers for a settled trip exactly as it does for an open one, which is what makes a crew member
   * able to look back at what they handed over.
   */
  const params = useLocalSearchParams<{ tripId?: string }>()
  const asked = typeof params.tripId === 'string' && params.tripId !== '' ? params.tripId : null
  const local = useLocalTrips()
  const trip =
    asked === null
      ? pickCurrentTrip(local.rows)
      : (local.rows.find((one) => one.id === asked) ?? null)
  const tripId = asked ?? trip?.id ?? null
  const stops = useLocalStops(tripId)
  const receipts = useLocalTripReceipts(tripId)
  /*
   * THE SHOP'S NAME, because a check-in list of "1 ₹9,399.00 At the shop" is a list nobody can act
   * on — and the one moment a driver reads it is when they are being asked whether every door was
   * done. The name is on the device already; the screen simply was not asking for it.
   */
  const { byId: shops } = useLocalRetailers(
    useMemo(() => stops.rows.map((stop) => stop.retailer_id), [stops.rows]),
  )

  const detail = useQuery(
    ['trip', tripId],
    () => api.api.delivery.trips.get({ id: tripId ?? '' }),
    {
      enabled: signedIn && tripId !== null && trip === null,
    },
  )
  const remote = detail.data?.item ?? null

  const preview = useQuery(
    ['settlement', tripId],
    () => api.api.delivery.trips.settlementPreview({ id: tripId ?? '' }),
    { enabled: signedIn && tripId !== null },
  )

  const [odometer, setOdometer] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const back = useMutation(
    (input: { odometerKm: number | null }, meta) =>
      api.api.delivery.trips.return({
        idempotencyKey: meta.idempotencyKey,
        id: tripId ?? '',
        ...(input.odometerKm === null ? {} : { endOdometerKm: input.odometerKm }),
        occurredAt: new Date().toISOString(),
        deviceId: deviceId(),
      }),
    {
      invalidates: [['settlement'], ['trip'], ['trips']],
      onSuccess: () => {
        haptics.success()
        setToast(t('d8.returned'))
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const figures = preview.data
  const doneStops =
    stops.rows.length > 0
      ? stops.rows.filter((stop) => isStopTerminal(stop.state)).length
      : (remote?.stopsCompleted ?? 0)
  const totalStops = Math.max(trip?.planned_stops ?? remote?.plannedStops ?? 0, stops.rows.length)
  const tripNo = trip?.trip_no ?? remote?.tripNo ?? null
  const tripDate = trip?.trip_date ?? remote?.tripDate ?? null
  const tripState = trip?.state ?? remote?.state ?? null
  /*
   * WHAT THE PHONE STILL HOLDS (DOS-169).
   *
   * `settlementPreview` now counts the trip's own RECEIPTS, however they reached the office — a
   * doorstep payment taken with no signal goes back as a `receipts` op (docs/23 §5.4: `collections`
   * is not a writable sync table) and is counted the moment it lands. So the phone adds only what it
   * has NOT sent yet; it used to add everything it held on top of a figure that was already right,
   * which asked the driver for the same rupee twice. On a settled trip it adds nothing at all: those
   * figures are the ones the office settled with, and a receipt arriving afterwards is refused
   * `trip_settled` — that money goes over the counter to the cashier. Both rules are `dayEndCash`.
   *
   * It is handed the PREVIEW and no trip state of its own. `tripState` below is local-first
   * (`useLocalTrips`, and the `trips.get` fallback is off while the phone holds the row), so it lags
   * a desk settling by one delta pull — branching the money on it would run the not-settled
   * arithmetic over settled figures for exactly as long as that window lasts, which is the double
   * count this slice exists to remove. The preview carries the state it answered with. `tripState`
   * still drives the chip and the check-in gate: those are about this phone's trip, not the money.
   */
  /*
   * The stop list of a trip this phone does not hold (a settled one opened from D11) comes from the
   * office, in the same shape, so one list renders both. `retailerName` rides on `TripStopDetail`,
   * which is why a past trip does not need the retailer rows on the device as well.
   */
  const stopRows =
    stops.rows.length > 0
      ? stops.rows.map((stop) => ({
          id: stop.id,
          sequence: stop.sequence,
          name: shops.get(stop.retailer_id)?.name ?? t('d.unknown'),
          secondary:
            stop.failure_reason === null
              ? (addressLine(shops.get(stop.retailer_id)?.address) ?? undefined)
              : wordFor(t, stop.failure_reason),
          money: stop.planned_collection_paise,
          state: stop.state,
          onDevice: true,
        }))
      : (remote?.stops ?? []).map((stop) => ({
          id: stop.id,
          sequence: stop.sequence,
          name: stop.retailerName,
          secondary: stop.failureReason === null ? undefined : wordFor(t, stop.failureReason),
          money: stop.plannedCollectionPaise,
          state: stop.state,
          onDevice: false,
        }))

  /*
   * DOS-178: a refused payment the crew handed to the cashier is no longer this phone's to hand over —
   * it stays on the device for ever as the record that the shop paid, and `deviceMoney` leaves it out.
   *
   * S-183: and the money the office has not taken is read from the OUTBOX (`held*`), not from the
   * difference of two totals — see the rule. With no signal the rule answers from the device rather
   * than going silent, which is why it is handed the float and told whether the office can be
   * reached: a read still in flight is not an answer, a failed one is.
   */
  const officeUnreachable = preview.error !== undefined || (!status.online && figures === undefined)
  const { cashPaise: deviceCashPaise, heldCashPaise, heldAllPaise } = deviceMoney(receipts.rows)
  const { handOverPaise, uncountedAllPaise, note } = dayEndCash({
    figures,
    officeUnreachable,
    openingCashPaise: trip?.opening_cash_paise ?? 0,
    deviceCashPaise,
    heldCashPaise,
    heldAllPaise,
  })

  const odometerKm = odometer.trim() === '' ? null : Number.parseInt(odometer.trim(), 10)
  const odometerBad = odometer.trim() !== '' && (odometerKm === null || Number.isNaN(odometerKm))
  const onTheRoad = tripState === 'active'
  /*
   * THE PHONE'S RECORDS GO BEFORE THE VEHICLE DOES (DOS-169). `trips.return` hands the trip to the
   * office, which settles on what has reached it; a doorstep receipt still in the outbox would land
   * after that and be refused. So a full outbox blocks check-in, and the driver is told the count.
   */
  const blocked = checkInBlock({
    onTheRoad,
    online: status.online,
    pending: status.pending,
    odometerBad,
  })

  if (tripId === null) {
    return (
      <Screen title={t('d8.title')} testID="d8-screen">
        <Txt field="body" desk="body" testID="d8-no-trip">
          {hydrated ? t('d1.noTripBody') : t('d.filling')}
        </Txt>
      </Screen>
    )
  }

  return (
    <Screen
      title={t('d8.title')}
      context={`${tripNo ?? t('d.trip')} · ${tripDate === null ? t('d.unknown') : longDate(tripDate)}`}
      chips={
        <Row gap={2} wrap>
          <StatusChip
            label={tripState === null ? t('d.unknown') : wordFor(t, tripState)}
            family={onTheRoad ? 'moss' : 'ochre'}
          />
          <StatusChip
            label={t('d.stopsN', { done: doneStops, total: totalStops })}
            family="neutral"
            figure
          />
        </Row>
      }
      bottomBar={
        <Stack gap={2}>
          <Row justify="between" align="center" gap={3}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('d8.expected')}
            </Txt>
            {/*
              ONE rule behind this figure (S-183). The bar used to carry its own offline fallback —
              right by arithmetic, and the reason the driver could be shown ₹1,944 with no sentence
              anywhere saying ₹1,544 of it was still on the phone. `dayEndCash` owns both now.
            */}
            <Money testID="d8-expected" value={handOverPaise} size="moneyL" />
          </Row>
          <Button
            testID="d8-return"
            label={t('d8.return')}
            variant="primary"
            size="floor"
            fullWidth
            loading={back.status === 'pending'}
            disabled={blocked !== null}
            disabledReason={
              blocked === 'notActive'
                ? t('d8.notActive')
                : blocked === 'offline'
                  ? t('d8.offlineBlocks')
                  : blocked === 'pending'
                    ? t(keepKey('pendingBlocks', status.persistent), { count: status.pending })
                    : t('d2.odometer')
            }
            onPress={() => {
              setConfirming(true)
            }}
          />
        </Stack>
      }
      testID="d8-screen"
    >
      <Stack gap={6}>
        <FillingNote hydrated={hydrated || asked !== null} testID="d8-provisional" />

        <KpiStrip
          testID="d8-kpis"
          items={[
            {
              label: t('d8.cash'),
              value: <Money value={figures?.cashCollectedPaise ?? null} size="moneyM" />,
            },
            {
              label: t('d8.upi'),
              value: <Money value={figures?.upiCollectedPaise ?? null} size="moneyM" />,
            },
            {
              label: t('d8.cheque'),
              value: <Money value={figures?.chequeCollectedPaise ?? null} size="moneyM" />,
            },
            {
              label: t('d8.expenses'),
              value: <Money value={figures?.expensesPaise ?? null} size="moneyM" />,
            },
          ]}
        />

        <Panel
          title={t('d8.expected')}
          meta={
            figures === undefined
              ? t('d.noConnectionRead')
              : t('d8.expectedHow', {
                  opening: formatINR(paise(figures.openingCashPaise)),
                  cash: formatINR(paise(figures.cashCollectedPaise)),
                  expenses: formatINR(paise(figures.expensesPaise)),
                })
          }
          testID="d8-cash"
        >
          {/*
            S-183 — THE OFFICE'S THREE FIGURES ARE INSIDE `<Async>`; THE MONEY SENTENCES ARE NOT.
            `<Async>` paints `d.noConnectionRead` over its children the moment the preview fails,
            which is every offline mount — and offline is the one state this screen exists for. It
            took the hand-over line and the uncounted note down with the office's figures, so the
            driver was shown a rupee in the bottom bar and told nothing about it. Measured 3/3 on web
            at both widths (money-web.md §5(A)). What the office alone knows can go blank; what the
            phone knows about its own money must not.
          */}
          <Stack gap={4}>
            <Async state={preview} rows={2}>
              <Row gap={4} wrap>
                <Field label={t('d1.openingCash')}>
                  <Money value={figures?.openingCashPaise ?? null} size="moneyM" />
                </Field>
                <Field label={t('d8.cash')}>
                  <Money value={figures?.cashCollectedPaise ?? null} size="moneyM" />
                </Field>
                <Field label={t('d8.expenses')}>
                  <Money value={figures?.expensesPaise ?? null} size="moneyM" />
                </Field>
              </Row>
            </Async>
            {/*
              A trip that is already closed is HISTORY, not an instruction. D11's rows open this
              screen for a settled trip, and "Hand ₹20,085.10 to the cashier" on a trip that was
              settled four days ago is a job nobody has. A null figure is the office read still in
              flight: the skeleton above stands for it, and no rupee is claimed until there is one.
            */}
            {handOverPaise === null ? null : (
              <Txt field="bodyStrong" desk="cell" testID="d8-hand-over">
                {t(onTheRoad ? 'd8.handOver' : 'd8.handedOver', {
                  amount: formatINR(paise(handOverPaise)),
                })}
              </Txt>
            )}
            {/*
              DOS-179 — both sentences begin "This phone holds ₹X in receipts", which is false on a
              browser with no OPFS, where the strip at the top of this screen already reads "· Not kept
              in this browser". `dayEndCash` picks WHICH sentence; the store picks whose it is.
            */}
            {note === null ? null : (
              <Txt field="body" desk="body" color={colors.status.ochre.fg} testID="d8-uncounted">
                {t(keepKey(note, status.persistent), {
                  amount: formatINR(paise(uncountedAllPaise)),
                })}
              </Txt>
            )}
            <DeskOnly>{t('d8.deskSettles')}</DeskOnly>
          </Stack>
        </Panel>

        <Panel
          title={t('d8.stops')}
          meta={
            figures === undefined
              ? undefined
              : `${t('d8.delivered')} ${String(figures.stopsDelivered)} · ${t('d8.partial')} ${String(
                  figures.stopsPartial,
                )} · ${t('d8.failed')} ${String(figures.stopsFailed)}`
          }
          testID="d8-stops"
        >
          <LocalAsync
            loading={stops.loading && stopRows.length === 0}
            hydrated={hydrated || asked !== null}
            empty={stopRows.length === 0}
            emptyMessage={t('d3.noBills')}
            waitingMessage={t('d.filling')}
          >
            <Group>
              {stopRows.map((stop) => (
                <ListRow
                  key={stop.id}
                  testID={`d8-stop-${stop.id}`}
                  primary={`${String(stop.sequence)}. ${stop.name}`}
                  {...(stop.secondary === undefined ? {} : { secondary: stop.secondary })}
                  trailingMoney={stop.money}
                  trailing={<StatusChip label={wordFor(t, stop.state)} family="neutral" />}
                  {...(stop.onDevice
                    ? {
                        onPress: () => {
                          router.push(`/stop/${stop.id}`)
                        },
                      }
                    : {})}
                />
              ))}
            </Group>
          </LocalAsync>
        </Panel>

        {/*
          `expectedVanStock` is what the vehicle is holding NOW, which for a trip that came back days
          ago is not "still on the van" — the godown counted it in when the trip closed. Both this
          panel and the odometer belong to the check-in, so both belong to a trip still on the road.
        */}
        {!onTheRoad ? null : (
          <>
            <Panel title={t('d8.vanStock')} meta={t('d8.vanStockNote')} testID="d8-van-stock">
              <Async
                state={preview}
                empty={(figures?.expectedVanStock.length ?? 0) === 0}
                emptyMessage={t('d.nothingHere')}
              >
                <Group>
                  {(figures?.expectedVanStock ?? []).map((lot) => (
                    <ListRow
                      key={lot.lotId}
                      testID={`d8-lot-${lot.lotId}`}
                      primary={lot.variantName}
                      /*
                       * `caseLine` picks between "4 cs = 192 pc" and "4 cs + 9 pc = 201 pc" itself. The
                       * screen used to force the second form, so a lot with no whole case read
                       * "0 cs + 7 pc = 7 pc" — three numbers for one, on a count the godown reads back.
                       */
                      secondary={
                        lot.caseSize === null || lot.caseSize <= 1
                          ? t('d.pieces', { pieces: formatCount(lot.expectedPcs) })
                          : caseLine(lot.expectedPcs, lot.caseSize, t)
                      }
                      {...(lot.batchNo === null
                        ? {}
                        : { trailing: <StatusChip label={lot.batchNo} family="neutral" /> })}
                    />
                  ))}
                </Group>
              </Async>
            </Panel>

            <Panel title={t('d2.odometer')} testID="d8-odometer">
              <TextInput
                testID="d8-odometer-input"
                label={t('d8.odometer')}
                value={odometer}
                onChange={setOdometer}
                keyboard="decimal"
                maxLength={8}
                {...(odometerBad ? { error: t('d8.odometer') } : {})}
              />
            </Panel>
          </>
        )}

        {status.pending === 0 ? null : (
          <Txt field="body" desk="body" color={colors.status.ochre.fg} testID="d8-pending">
            {t(keepKey('pending', status.persistent), { count: status.pending })}
          </Txt>
        )}

        {back.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg} testID="d8-error">
            {`${t('d8.failedReturn')} — ${back.error.message}`}
          </Txt>
        )}
      </Stack>

      <Dialog
        testID="d8-confirm"
        open={confirming}
        onClose={() => {
          setConfirming(false)
        }}
        title={t('d8.return')}
        body={t('d8.returnBody')}
        confirmLabel={t('d8.return')}
        busy={back.status === 'pending'}
        onConfirm={() => {
          setConfirming(false)
          back.mutate({ odometerKm: odometerBad ? null : odometerKm })
        }}
      />

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
      />
    </Screen>
  )
}
