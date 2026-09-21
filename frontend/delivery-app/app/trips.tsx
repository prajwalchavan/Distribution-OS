/**
 * D11 — Your trips (docs/23 §5.1): the crew's own history, and its own score.
 *
 * `trips.list` FORCES `mine` for the delivery role on the server, so this list is this crew member's
 * road and nobody else's — the app does not have to ask for that and could not widen it if it tried.
 *
 * The one figure docs/23 §5.2 allows here is the crew's own ON-TIME rate, from
 * `reporting.registers.deliveryPerformance` scoped to the signed-in driver — the share of stops made
 * by the time the office promised. It was labelled "Delivered on the first attempt", which is a
 * different measurement of a different thing, and read 0% for a crew with 104 of 125 stops delivered
 * (QA DOS-067). That register caps its window at 31 days (`window_too_wide` otherwise), which is why
 * the score is a month of ROAD ALREADY DRIVEN and ends today.
 *
 * THE LIST IS WIDER THAN THE SCORE, and deliberately. `trips.list` was asked for the same window, so
 * the trip the home screen calls "Today's trip" — a round planned for the next working day, which is
 * how the godown loads ahead — was missing from the crew's own list of trips. The list runs to the
 * end of the week ahead; the score never counts a trip nobody has driven yet.
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
  /** What is planned ahead: a trip dated after today is on the list, never in the score. */
  const until = shiftDays(to, 7)

  /*
   * THE LIST MUST BE THE WINDOW THE CHIP CLAIMS, AND THE ORDER IS THE SERVER'S.
   *
   * Unwindowed, `trips.list` pages by `id DESC` — a UUIDv7 for a row the app created, and a
   * deterministic hash for every seeded one — so on the founder's own database the first fifty
   * answered 17 Jan 2027, 9 Aug 2027, 10 Jan 2027 … under a chip that says "Last 30 days", and the
   * crew's CURRENT trip was not among them at all. `from`/`to` are on `TripsListInput`; the same two
   * dates already bound the register above.
   *
   * The screen used to re-sort the page here by `(tripDate, tripNo)`, saying the server had no date
   * ordering to ask for. It has had one since 1d934ed: `trips.list` is a dated register, so it comes
   * back newest first by `trip_date` — the same column `from`/`to` filter — with the row id breaking
   * a tie (DOS-009; founder, 2026-09-21, delegated to the architect). Ranking by trip number inside a
   * day was a SECOND ordering rule living on one screen: it disagrees with the id the cursor pages
   * on, so it reorders rows the server already placed (measured on the seed: 21 Aug came back
   * `-1, -2` and the screen drew `-2, -1`), and page two would be shuffled against page one. The
   * rows drawn are now the page the server sent, in the order it sent them.
   */
  const trips = useQuery(
    ['trips', 'mine', from, until],
    () => api.api.delivery.trips.list({ mine: true, from, to: until, limit: 50 }),
    { enabled: signedIn },
  )
  const rows = trips.data?.items ?? []

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
          <Async state={trips} empty={rows.length === 0} emptyMessage={t('d11.empty')}>
            <Group>
              {rows.map((trip) => (
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
                  /*
                   * A history row opens ITS OWN trip's day summary. Every row used to push `/` —
                   * today's trip — so a crew member checking what they handed over on Tuesday landed
                   * on Thursday's road with no way to tell the two apart.
                   */
                  onPress={() => {
                    router.push(`/day?tripId=${trip.id}`)
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
