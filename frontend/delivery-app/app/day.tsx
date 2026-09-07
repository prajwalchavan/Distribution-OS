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
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { deviceId } from '../src/api'
import { longDate } from '../src/lib/dates'
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
import { Async, DeskOnly, Field, LocalAsync, Panel } from '../src/lib/ui'

export default function DaySummary(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null
  const status = useSyncStatus()
  const hydrated = useHydrated()

  const local = useLocalTrips()
  const trip = pickCurrentTrip(local.rows)
  const tripId = trip?.id ?? null
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
  /** What the device alone can account for: the float plus the cash it holds receipts for. */
  const deviceCashPaise =
    (trip?.opening_cash_paise ?? 0) +
    receipts.rows
      .filter((row) => row.mode === 'cash')
      .reduce((sum, row) => sum + row.amount_paise, 0)
  const doneStops = stops.rows.filter((stop) => isStopTerminal(stop.state)).length

  const odometerKm = odometer.trim() === '' ? null : Number.parseInt(odometer.trim(), 10)
  const odometerBad = odometer.trim() !== '' && (odometerKm === null || Number.isNaN(odometerKm))
  const onTheRoad = trip?.state === 'active'

  if (trip === null) {
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
      context={`${trip.trip_no ?? t('d.trip')} · ${longDate(trip.trip_date)}`}
      chips={
        <Row gap={2} wrap>
          <StatusChip label={wordFor(t, trip.state)} family={onTheRoad ? 'moss' : 'ochre'} />
          <StatusChip
            label={t('d.stopsN', { done: doneStops, total: stops.rows.length })}
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
            <Money
              testID="d8-expected"
              value={figures?.expectedCashPaise ?? (status.online ? null : deviceCashPaise)}
              size="moneyL"
            />
          </Row>
          <Button
            testID="d8-return"
            label={t('d8.return')}
            variant="primary"
            size="floor"
            fullWidth
            loading={back.status === 'pending'}
            disabled={!onTheRoad || odometerBad || !status.online}
            disabledReason={
              !onTheRoad ? t('d8.notActive') : !status.online ? t('d6.online') : t('d2.odometer')
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
          <Async state={preview} rows={3}>
            <Stack gap={4}>
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
              <Txt field="bodyStrong" desk="cell" testID="d8-hand-over">
                {t('d8.handOver', { amount: formatINR(paise(figures?.expectedCashPaise ?? 0)) })}
              </Txt>
              <DeskOnly>{t('d8.deskSettles')}</DeskOnly>
            </Stack>
          </Async>
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
            loading={stops.loading}
            hydrated={hydrated}
            empty={stops.rows.length === 0}
            emptyMessage={t('d3.noBills')}
            waitingMessage={t('d.filling')}
          >
            <Group>
              {stops.rows.map((stop) => (
                <ListRow
                  key={stop.id}
                  testID={`d8-stop-${stop.id}`}
                  primary={`${String(stop.sequence)}. ${
                    shops.get(stop.retailer_id)?.name ?? t('d.unknown')
                  }`}
                  secondary={
                    stop.failure_reason === null
                      ? (addressLine(shops.get(stop.retailer_id)?.address) ?? undefined)
                      : wordFor(t, stop.failure_reason)
                  }
                  trailingMoney={stop.planned_collection_paise}
                  trailing={<StatusChip label={wordFor(t, stop.state)} family="neutral" />}
                  onPress={() => {
                    router.push(`/stop/${stop.id}`)
                  }}
                />
              ))}
            </Group>
          </LocalAsync>
        </Panel>

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

        {status.pending === 0 ? null : (
          <Txt field="body" desk="body" color={colors.status.ochre.fg} testID="d8-pending">
            {t('d8.pending', { count: status.pending })}
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
