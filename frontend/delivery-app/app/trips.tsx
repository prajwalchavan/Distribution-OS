/**
 * D11 — Your trips (docs/23 §5.1): the crew's own history, and its own score.
 *
 * `trips.list` FORCES `mine` for the delivery role on the server, so this list is this crew member's
 * road and nobody else's — the app does not have to ask for that and could not widen it if it tried.
 *
 * The one figure docs/23 §5.2 allows here is the crew's own on-time rate, from
 * `reporting.registers.deliveryPerformance` scoped to the signed-in driver. That register caps its
 * window at 31 days (`window_too_wide` otherwise), which is why the range is a month and says so.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Group,
  KpiStrip,
  ListRow,
  Row,
  Screen,
  Stack,
  StatusChip,
  wordFor,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'

import { longDate, shiftDays, today } from '../src/lib/dates'
import { Async, Panel, tripFamily } from '../src/lib/ui'

export default function Trips(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null

  const to = today()
  const from = shiftDays(to, -29)

  const trips = useQuery(
    ['trips', 'mine'],
    () => api.api.delivery.trips.list({ mine: true, limit: 50 }),
    { enabled: signedIn },
  )

  const performance = useQuery(
    ['delivery-performance', from, to],
    () =>
      api.api.reporting.registers.deliveryPerformance({
        from,
        to,
        driverId: session?.user.id ?? '',
      }),
    { enabled: signedIn },
  )

  const totals = performance.data?.totals
  const onTimePct = totals === undefined ? null : Math.round((totals.onTimeRate ?? 0) * 1000) / 10

  return (
    <Screen
      title={t('d11.title')}
      context={session?.tenant.displayName}
      chips={<StatusChip label={t('d11.window')} family="neutral" />}
      testID="d11-screen"
    >
      <Stack gap={6}>
        <KpiStrip
          testID="d11-kpis"
          items={[
            {
              label: t('d8.stops'),
              value: totals === undefined ? t('d.unknown') : String(totals.stopsPlanned),
            },
            {
              label: t('d8.delivered'),
              value: totals === undefined ? t('d.unknown') : String(totals.stopsDelivered),
            },
            {
              label: t('d8.failed'),
              value: totals === undefined ? t('d.unknown') : String(totals.stopsFailed),
            },
            {
              label: t('d11.onTime'),
              value: onTimePct === null ? t('d.unknown') : `${String(onTimePct)}%`,
            },
          ]}
        />

        <Panel title={t('d11.title')} testID="d11-list">
          <Async
            state={trips}
            empty={(trips.data?.items.length ?? 0) === 0}
            emptyMessage={t('d11.empty')}
          >
            <Group>
              {(trips.data?.items ?? []).map((trip) => (
                <ListRow
                  key={trip.id}
                  testID={`d11-trip-${trip.id}`}
                  primary={trip.tripNo ?? trip.id.slice(0, 8)}
                  secondary={`${longDate(trip.tripDate)} · ${trip.vehicleRegNo}`}
                  trailing={
                    <Row gap={2} wrap>
                      <StatusChip
                        label={t('d11.stops', {
                          done: trip.stopsCompleted,
                          total: trip.plannedStops,
                        })}
                        family="neutral"
                        figure
                      />
                      <StatusChip label={wordFor(t, trip.state)} family={tripFamily(trip.state)} />
                    </Row>
                  }
                  onPress={() => {
                    router.push('/')
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>
      </Stack>
    </Screen>
  )
}
