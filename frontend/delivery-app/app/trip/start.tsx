/**
 * D2 — Start the trip: the location notice, the odometer, the float, and away (docs/23 §5.1).
 *
 * THIS SCREEN NEEDS A SIGNAL, and says so rather than pretending. `trips` is not a writable table in
 * the delivery manifest — a trip is planned and dispatched at the office, and `depart` also dispatches
 * every order on it that the godown has not already sent out through a confirmed load sheet, which is
 * a stock movement no phone may invent. Everything that happens AFTER this screen works with no
 * coverage; getting on the road is the one moment a driver is still in the yard.
 *
 * The notice is the DPDP one (docs/plans/delivery.md §4 rule 11): `trips.depart` refuses with
 * `gps_consent_missing` unless a granted `location_consents` row exists for the driver, so the notice
 * is not a formality that can be skipped — and refusing it is a real answer that is recorded, after
 * which the trip cannot start from this app. The text names the distributor, says what is kept and
 * for how long, and is versioned so the office holds an agreement to the words that were shown.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  RupeeInput,
  Row,
  Screen,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  formatINR,
  useColors,
  wordFor,
  useStrings,
} from '@dos/ui'
import { paise } from '@dos/domain'
import { haptics } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { GPS_NOTICE_VERSION } from '../../src/config'
import { instantWithClock, longDate } from '../../src/lib/dates'
import { deviceId } from '../../src/api'
import { pickCurrentTrip, useHydrated, useLocalTrips } from '../../src/lib/local'
import { Async, Field, FillingNote, Panel } from '../../src/lib/ui'

export default function StartTrip(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null

  /*
   * WHICH trip is being started, and why it is a parameter.
   *
   * `pickCurrentTrip` ranks `active` first — right for the home screen, wrong here: a crew that is
   * still out on today's trip and wants to look at tomorrow's plan would be shown the trip it is
   * already driving, with a "Start the trip" button that can only refuse. D1's "Your other trips"
   * rows name the one they mean.
   */
  const params = useLocalSearchParams<{ tripId?: string }>()
  const asked = typeof params.tripId === 'string' ? params.tripId : null
  const hydrated = useHydrated()
  const local = useLocalTrips()
  const localTrip = local.rows.find((one) => one.id === asked) ?? pickCurrentTrip(local.rows)
  const tripId = localTrip?.id ?? null

  const trip = useQuery(['trip', tripId], () => api.api.delivery.trips.get({ id: tripId ?? '' }), {
    enabled: signedIn && tripId !== null,
  })
  const consent = useQuery(['consent', 'mine'], () => api.api.delivery.consents.get({}), {
    enabled: signedIn,
  })

  const [odometer, setOdometer] = useState('')
  const [cashPaise, setCashPaise] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const detail = trip.data?.item
  const granted = consent.data?.item?.granted === true
  const answered = consent.data?.item !== null && consent.data?.item !== undefined
  const retentionDays = detail?.policy.gpsRetentionDays ?? 90

  const answerNotice = useMutation(
    (input: { granted: boolean }, meta) =>
      api.api.delivery.consents.grant({
        idempotencyKey: meta.idempotencyKey,
        id: meta.id,
        granted: input.granted,
        noticeVersion: GPS_NOTICE_VERSION,
        locale: 'en-IN',
        deviceId: deviceId(),
      }),
    {
      invalidates: [['consent']],
      onSuccess: () => {
        haptics.success()
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const startLoading = useMutation(
    (_input: Record<string, never>, meta) =>
      api.api.delivery.trips.startLoading({
        idempotencyKey: meta.idempotencyKey,
        id: tripId ?? '',
        deviceId: deviceId(),
      }),
    {
      invalidates: [['trip']],
      onSuccess: () => {
        haptics.success()
        setToast(t('d2.loadingNow'))
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const depart = useMutation(
    (input: { odometerKm: number | null; cashPaise: number | null }, meta) =>
      api.api.delivery.trips.depart({
        idempotencyKey: meta.idempotencyKey,
        id: tripId ?? '',
        ...(input.odometerKm === null ? {} : { startOdometerKm: input.odometerKm }),
        ...(input.cashPaise === null ? {} : { openingCashPaise: input.cashPaise }),
        occurredAt: new Date().toISOString(),
        deviceId: deviceId(),
      }),
    {
      invalidates: [['trip'], ['trips']],
      onSuccess: () => {
        haptics.success()
        setToast(t('d2.departed'))
        router.replace('/')
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const odometerKm = odometer.trim() === '' ? null : Number.parseInt(odometer.trim(), 10)
  const odometerBad = odometer.trim() !== '' && (odometerKm === null || Number.isNaN(odometerKm))
  const state = detail?.state ?? localTrip?.state ?? 'planned'
  /*
   * A GUESSED TRIP IS NEVER DEPARTED. With no `tripId` in the route this screen picks the trip out of
   * whatever the device holds, and until the first pull finishes that is a subset — measured in the
   * gate: `/` named TRIP-NEXT and this screen named TRIP-ACTIVE, with a live "Start the trip" under
   * it. `depart` dispatches every undispatched bill on the trip and turns tracking on; it is not a
   * thing to do to the wrong trip. Departing needs a signal anyway, so waiting for the pull that the
   * same signal is already running costs a driver nothing.
   */
  const provisional = !hydrated && asked === null
  const canDepart = granted && state === 'loading' && !provisional

  return (
    <Screen
      title={t('d2.title')}
      context={
        localTrip === null
          ? undefined
          : `${localTrip.trip_no ?? t('d.trip')} · ${longDate(localTrip.trip_date)}`
      }
      chips={
        <StatusChip label={t('d1.tripState', { state: wordFor(t, state) })} family="neutral" />
      }
      bottomBar={
        <Button
          testID="d2-depart"
          label={t('d2.depart')}
          variant="primary"
          size="floor"
          fullWidth
          loading={depart.status === 'pending'}
          disabled={!canDepart || odometerBad}
          disabledReason={
            !granted
              ? t('d2.consentNeeded')
              : provisional
                ? t('d.waitForFill')
                : state !== 'loading'
                  ? t('d2.mustLoadFirst')
                  : t('d.unknown')
          }
          onPress={() => {
            setConfirming(true)
          }}
        />
      }
      testID="d2-screen"
    >
      <Stack gap={6}>
        <FillingNote hydrated={!provisional} testID="d2-provisional" />

        <Async state={[trip, consent]} rows={4}>
          <Panel title={t('d2.consentTitle')} testID="d2-consent">
            <Stack gap={4}>
              <Txt field="body" desk="body" testID="d2-notice">
                {t('d2.consentBody', {
                  name: session?.tenant.displayName ?? t('app.distributor'),
                  days: retentionDays,
                })}
              </Txt>
              {answered ? (
                <Row gap={3} wrap align="center">
                  <StatusChip
                    testID="d2-consent-state"
                    label={
                      granted
                        ? t('d2.consentGiven', {
                            when: instantWithClock(consent.data?.item?.grantedAt ?? null),
                          })
                        : t('d2.consentRefused')
                    }
                    family={granted ? 'moss' : 'brick'}
                    solid={!granted}
                  />
                </Row>
              ) : null}
              <Row gap={8} wrap>
                <Button
                  testID="d2-agree"
                  label={t('d2.consentAgree')}
                  variant="primary"
                  loading={answerNotice.status === 'pending'}
                  onPress={() => {
                    answerNotice.mutate({ granted: true })
                  }}
                />
                <Button
                  testID="d2-refuse"
                  label={t('d2.consentRefuse')}
                  variant="destructive"
                  onPress={() => {
                    answerNotice.mutate({ granted: false })
                  }}
                />
              </Row>
              {answerNotice.error === undefined ? null : (
                <Txt field="body" desk="body" color={colors.status.brick.fg}>
                  {answerNotice.error.message}
                </Txt>
              )}
            </Stack>
          </Panel>

          <Panel title={t('d2.before')} testID="d2-form">
            <Stack gap={4}>
              <TextInput
                testID="d2-odometer"
                label={t('d2.odometer')}
                value={odometer}
                onChange={setOdometer}
                keyboard="decimal"
                maxLength={8}
                {...(odometerBad ? { error: t('d2.odometer') } : {})}
              />
              <RupeeInput
                testID="d2-cash"
                label={t('d2.openingCash')}
                helper={t('d2.openingCashHelp')}
                value={cashPaise ?? detail?.openingCashPaise ?? null}
                onChange={setCashPaise}
              />
              <Row gap={4} wrap>
                <Field label={t('d.vehicle')}>{detail?.vehicleRegNo ?? t('d.unknown')}</Field>
                <Field label={t('d8.stops')}>
                  {String(detail?.plannedStops ?? localTrip?.planned_stops ?? 0)}
                </Field>
              </Row>
            </Stack>
          </Panel>

          {state === 'planned' ? (
            <Stack gap={3}>
              <Button
                testID="d2-start-loading"
                label={t('d2.startLoading')}
                variant="secondary"
                loading={startLoading.status === 'pending'}
                onPress={() => {
                  startLoading.mutate({})
                }}
              />
              {startLoading.error === undefined ? null : (
                <Txt field="body" desk="body" color={colors.status.brick.fg}>
                  {startLoading.error.message}
                </Txt>
              )}
            </Stack>
          ) : null}

          {depart.error === undefined ? null : (
            <Txt field="body" desk="body" color={colors.status.brick.fg} testID="d2-error">
              {`${t('d2.failed')} — ${depart.error.message}`}
            </Txt>
          )}
        </Async>
      </Stack>

      <Dialog
        testID="d2-confirm"
        open={confirming}
        onClose={() => {
          setConfirming(false)
        }}
        title={t('d2.depart')}
        /*
         * UX-00 §6.12: the body is EXACTLY what will be written. It used to print the consent
         * timestamp — true, already on the screen above, and no answer at all to "what happens if I
         * tap this", on a button that dispatches every undispatched bill on the trip and turns
         * location tracking on.
         */
        body={t('d2.confirmBody', {
          trip: localTrip?.trip_no ?? t('d.trip'),
          vehicle: detail?.vehicleRegNo ?? t('d.vehicle'),
          stops: detail?.plannedStops ?? localTrip?.planned_stops ?? 0,
          cash: formatINR(paise(cashPaise ?? detail?.openingCashPaise ?? 0)),
        })}
        confirmLabel={t('d2.depart')}
        busy={depart.status === 'pending'}
        onConfirm={() => {
          setConfirming(false)
          depart.mutate({
            odometerKm: odometerBad ? null : odometerKm,
            cashPaise,
          })
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
