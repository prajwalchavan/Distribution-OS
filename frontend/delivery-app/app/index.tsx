/**
 * D1 — Today's trip (docs/23 §5.1): the road in front of the driver, the load on board and the money
 * that should be in the bag.
 *
 * EVERY FIGURE ON THIS SCREEN COMES OFF THE DEVICE. That is not an optimisation: docs/23 §5.4 says a
 * driver is out of coverage for hours, and the home screen is the one a crew opens at every stop.
 * So the trip, the stops, the shops, the bills and the receipts are read from the phone's own SQLite
 * (`sync.pull` keeps it filled), and the only thing the service is asked for is the load sheet's
 * paperwork state, which changes at the godown rather than at the door.
 *
 * "Today's" is deliberately the OPEN trip, not a date match: a van that leaves at six in the morning
 * is checked in after the IST business date has turned, and a driver whose trip is still out must
 * never be told there is no trip today. The trip's own date is printed instead of assumed.
 */
import { useSession } from '@dos/api-client/react'
import { useSyncStatus, useTable } from '@dos/offline/react'
import {
  Button,
  Group,
  KpiStrip,
  ListRow,
  Money,
  Row,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  wordFor,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useMemo } from 'react'

import { useTracking } from './_layout'
import { instantWithClock, longDate } from '../src/lib/dates'
import {
  addressLine,
  bool,
  isStopTerminal,
  nextOpenStop,
  pickCurrentTrip,
  useHydrated,
  useLocalRetailers,
  useLocalStops,
  useLocalTripReceipts,
  useLocalTrips,
  useLocalVehicle,
  type LocalStop,
} from '../src/lib/local'
import { LocalAsync, Panel, StopChip, pl } from '../src/lib/ui'

interface LocalLoadSheet {
  id: string
  trip_id: string | null
  status: string
  sheet_date: string
  expected_packages: number | null
  counted_packages: number | null
  challan_no: string | null
  confirmed_at: string | null
}

export default function TodaysTrip(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const hydrated = useHydrated()
  const status = useSyncStatus()
  const tracking = useTracking()

  const trips = useLocalTrips()
  const trip = pickCurrentTrip(trips.rows)
  const others = trips.rows.filter((one) => one.id !== trip?.id)

  const stops = useLocalStops(trip?.id ?? null)
  const { vehicle } = useLocalVehicle(trip?.vehicle_id ?? null)
  const receipts = useLocalTripReceipts(trip?.id ?? null)
  const retailerIds = useMemo(() => stops.rows.map((stop) => stop.retailer_id), [stops.rows])
  const { byId: shops } = useLocalRetailers(retailerIds)

  const sheets = useTable<LocalLoadSheet>(
    'load_sheets',
    useMemo(
      () => ({
        where: 'trip_id = ?',
        params: [trip?.id ?? ''],
        orderBy: 'sheet_date DESC',
        limit: 20,
      }),
      [trip?.id],
    ),
  )

  const next = nextOpenStop(stops.rows)
  const done = stops.rows.filter((stop) => isStopTerminal(stop.state)).length
  /** What the crew still has to ask for at the doors that are not finished. */
  const toCollectPaise = stops.rows
    .filter((stop) => !isStopTerminal(stop.state))
    .reduce((sum, stop) => sum + (stop.planned_collection_paise ?? 0), 0)
  const collectedPaise = receipts.rows.reduce((sum, row) => sum + row.amount_paise, 0)

  const shopName = (stop: LocalStop): string => shops.get(stop.retailer_id)?.name ?? t('d.unknown')

  if (trips.loading && trip === null) {
    return (
      <Screen title={t('d1.title')} context={session?.tenant.displayName}>
        <LocalAsync
          loading
          hydrated={hydrated}
          empty={false}
          emptyMessage={t('d1.noTrip')}
          waitingMessage={t('d.filling')}
        >
          <Stack gap={4} />
        </LocalAsync>
      </Screen>
    )
  }

  if (trip === null) {
    return (
      <Screen title={t('d1.title')} context={session?.tenant.displayName} testID="d1-screen">
        <Stack gap={4}>
          <Txt field="body" desk="body" testID="d1-no-trip">
            {hydrated ? t('d1.noTripBody') : t('d.filling')}
          </Txt>
          <Button
            label={t('d11.title')}
            variant="secondary"
            onPress={() => {
              router.push('/trips')
            }}
            testID="d1-history"
          />
        </Stack>
      </Screen>
    )
  }

  const road = trip.state === 'active'
  const beforeTheRoad = trip.state === 'planned' || trip.state === 'loading'

  return (
    <Screen
      title={t('d1.title')}
      context={`${trip.trip_no ?? t('d.trip')} · ${longDate(trip.trip_date)}`}
      chips={
        <Row gap={2} wrap>
          <StatusChip
            testID="d1-trip-state"
            label={wordFor(t, trip.state)}
            family={road ? 'moss' : trip.state === 'cancelled' ? 'brick' : 'ochre'}
          />
          <StatusChip
            testID="d1-stops"
            label={t('d.stopsN', { done, total: stops.rows.length })}
            family={done === stops.rows.length && stops.rows.length > 0 ? 'moss' : 'neutral'}
            figure
          />
          <StatusChip
            testID="d1-vehicle"
            label={vehicle?.reg_no ?? t('d.vehicle')}
            family="neutral"
          />
        </Row>
      }
      bottomBar={
        beforeTheRoad ? (
          <Button
            testID="d1-start"
            label={t('d1.startTrip')}
            variant="primary"
            size="floor"
            fullWidth
            onPress={() => {
              router.push('/trip/start')
            }}
          />
        ) : road ? (
          <Stack gap={3}>
            {next === null ? null : (
              <Button
                testID="d1-next-stop"
                label={t('d1.nextStop')}
                variant="primary"
                size="floor"
                fullWidth
                onPress={() => {
                  router.push(`/stop/${next.id}`)
                }}
              />
            )}
            <Button
              testID="d1-end-day"
              label={t('d1.endDay')}
              variant="secondary"
              fullWidth
              onPress={() => {
                router.push('/day')
              }}
            />
          </Stack>
        ) : (
          <Button
            testID="d1-day"
            label={t('d8.title')}
            variant="primary"
            size="floor"
            fullWidth
            onPress={() => {
              router.push('/day')
            }}
          />
        )
      }
      testID="d1-screen"
    >
      <Stack gap={6}>
        <KpiStrip
          testID="d1-kpis"
          items={[
            { label: t('d1.toCollect'), value: <Money value={toCollectPaise} size="moneyM" /> },
            {
              label: t('d1.collectedToday'),
              value: <Money value={collectedPaise} size="moneyM" />,
            },
            {
              label: t('d1.openingCash'),
              value: <Money value={trip.opening_cash_paise} size="moneyM" />,
            },
            { label: t('d8.stops'), value: `${String(done)} / ${String(stops.rows.length)}` },
          ]}
        />

        {next === null ? null : (
          <Panel title={t('d1.nextStop')} testID="d1-next">
            <Group>
              <ListRow
                testID={`d1-next-${next.id}`}
                primary={shopName(next)}
                secondary={
                  addressLine(shops.get(next.retailer_id)?.address) ??
                  t('d.stopOf', { index: next.sequence, total: stops.rows.length })
                }
                trailingMoney={next.planned_collection_paise}
                trailingSize="moneyL"
                trailing={<StopChip state={next.state} />}
                onPress={() => {
                  router.push(`/stop/${next.id}`)
                }}
              />
            </Group>
          </Panel>
        )}

        <Panel
          title={t('d1.stops')}
          meta={t('d.stopsN', { done, total: stops.rows.length })}
          testID="d1-stop-list"
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
                  testID={`d1-stop-${stop.id}`}
                  primary={`${String(stop.sequence)}. ${shopName(stop)}`}
                  secondary={
                    stop.failure_reason === null
                      ? (addressLine(shops.get(stop.retailer_id)?.address) ?? undefined)
                      : wordFor(t, stop.failure_reason)
                  }
                  trailingMoney={stop.planned_collection_paise}
                  trailing={<StopChip state={stop.state} />}
                  /*
                   * A FINISHED STOP IS STILL A ROW YOU CAN OPEN. It used to carry
                   * `state="disabled"`, which made the whole row untappable — so a driver who had
                   * just recorded a part delivery at stop 4 could not get back to it to look at
                   * what was short, to take the money, or to send the bill. The chip already says
                   * the stop is done, and the stop screen itself refuses every further write.
                   */
                  onPress={() => {
                    router.push(`/stop/${stop.id}`)
                  }}
                />
              ))}
            </Group>
          </LocalAsync>
        </Panel>

        <Panel
          title={t('d1.load')}
          /*
           * The meta says the CONFIRMATION, and only when there is a sheet to confirm. It used to
           * fall back to "The godown has not confirmed a load sheet for this trip" — the same
           * sentence the empty state carries — so TRIP-ACTIVE, which has no sheet at all, printed
           * that line twice, one under the other. A screen that says a thing twice reads as a
           * screen that has two things to say.
           */
          {...(sheets.rows.some((sheet) => sheet.confirmed_at !== null)
            ? {
                meta: t('d1.loadConfirmed', {
                  when: instantWithClock(
                    sheets.rows.find((sheet) => sheet.confirmed_at !== null)?.confirmed_at ?? null,
                  ),
                }),
              }
            : {})}
          testID="d1-load"
        >
          <LocalAsync
            loading={sheets.loading}
            hydrated={hydrated}
            empty={sheets.rows.length === 0}
            emptyMessage={t('d1.loadNotConfirmed')}
            waitingMessage={t('d.filling')}
          >
            <Group>
              {sheets.rows.map((sheet) => (
                <ListRow
                  key={sheet.id}
                  testID={`d1-sheet-${sheet.id}`}
                  primary={sheet.challan_no ?? longDate(sheet.sheet_date)}
                  secondary={
                    sheet.expected_packages === null
                      ? undefined
                      : pl(t, 'd1.packages', sheet.expected_packages)
                  }
                  trailing={
                    <StatusChip
                      label={wordFor(t, sheet.status)}
                      family={sheet.confirmed_at === null ? 'ochre' : 'moss'}
                    />
                  }
                />
              ))}
            </Group>
          </LocalAsync>
        </Panel>

        {/*
         * The DPDP promise, kept on screen rather than in a settings page: the driver can see at a
         * glance whether the office can see the vehicle, and a browser tab says out loud that it
         * stops when it is hidden instead of dropping half a track in silence (ADR 0012).
         */}
        <Panel title={t('d12.consent')} testID="d1-tracking">
          <Stack gap={2}>
            <Row gap={3} wrap align="center">
              <StatusChip
                testID="d1-tracking-state"
                label={tracking?.state === 'on' ? t('d1.tracking') : t('d1.trackingOff')}
                family={tracking?.state === 'on' ? 'moss' : 'neutral'}
              />
              {tracking === null || tracking.buffered === 0 ? null : (
                <StatusChip
                  testID="d1-tracking-buffer"
                  label={t('d1.trackingHeld', { count: tracking.buffered })}
                  family="ochre"
                  figure
                />
              )}
            </Row>
            {tracking?.state === 'denied' ? (
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('d1.trackingDenied')}
              </Txt>
            ) : null}
            {tracking !== null && !tracking.canTrackInBackground ? (
              <Txt field="label" desk="meta" color={colors.text.secondary} testID="d1-tracking-web">
                {t('d1.trackingWeb')}
              </Txt>
            ) : null}
          </Stack>
        </Panel>

        <Row gap={8} wrap>
          {bool(trip.van_sales_enabled) && road ? (
            <Button
              testID="d1-van-sale"
              label={t('d1.vanSale')}
              variant="secondary"
              onPress={() => {
                router.push(next === null ? '/' : `/stop/${next.id}/van-sale`)
              }}
              {...(next === null ? { disabled: true, disabledReason: t('d3.noBills') } : {})}
            />
          ) : null}
          <Button
            testID="d1-expense"
            label={t('d1.addExpense')}
            variant="secondary"
            onPress={() => {
              router.push('/expenses')
            }}
          />
        </Row>

        {others.length === 0 ? null : (
          <Panel title={t('d1.otherTrips')} testID="d1-other-trips">
            <Group>
              {others.map((one) => (
                <ListRow
                  key={one.id}
                  testID={`d1-other-${one.id}`}
                  primary={one.trip_no ?? t('d.trip')}
                  secondary={t('d1.plannedFor', { date: longDate(one.trip_date) })}
                  trailing={<StatusChip label={wordFor(t, one.state)} family="neutral" />}
                  onPress={() => {
                    router.push(`/trip/start?tripId=${one.id}`)
                  }}
                />
              ))}
            </Group>
          </Panel>
        )}

        {status.pending === 0 ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary} testID="d1-pending">
            {t('d8.pending', { count: status.pending })}
          </Txt>
        )}
      </Stack>
    </Screen>
  )
}
