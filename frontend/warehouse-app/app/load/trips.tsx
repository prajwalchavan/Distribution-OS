/**
 * W10 — trips, from the godown's side (docs/23 §4.1).
 *
 * `TRIP_PLANNERS` in `permissions.ts` is owner, manager, warehouse, delivery: the godown may put a
 * trip into loading and send it off, because those are the two moments a vehicle is standing on the
 * dock in front of the person holding this phone. It may NOT create the round, cancel it, settle it
 * or see a rupee of its collections — `settlementPreview` and `collections.*` are MONEY_COLLECTORS,
 * and a loader is not one.
 *
 * The order on a trip that the godown has already dispatched through a confirmed load sheet is a
 * no-op at depart (coordination §4 item 4), which is why sending a vehicle off from here is safe even
 * when W7 has already checked it out.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  Row,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { haptics } from '@dos/ui/platform'

import { shortDate } from '../../src/lib/dates'
import { Async, Panel, PageTabs, workFamily } from '../../src/lib/ui'

export default function Trips(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const signedIn = session !== null

  const trips = useQuery(
    ['trips', 'open'],
    () => api.api.delivery.trips.list({ states: ['planned', 'loading', 'active'], limit: 30 }),
    { enabled: signedIn },
  )

  const startLoading = useMutation(
    (input: { id: string }, meta) =>
      api.api.delivery.trips.startLoading({ id: input.id, idempotencyKey: meta.idempotencyKey }),
    {
      invalidates: [['trips']],
      onSuccess: () => {
        haptics.success()
      },
      onError: () => {
        haptics.error()
      },
    },
  )
  const depart = useMutation(
    (input: { id: string }, meta) =>
      api.api.delivery.trips.depart({ id: input.id, idempotencyKey: meta.idempotencyKey }),
    {
      invalidates: [['trips']],
      onSuccess: () => {
        haptics.success()
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const error = startLoading.error ?? depart.error

  return (
    <Screen title={t('w10.title')} context={session?.tenant.displayName} testID="w10-screen">
      <Stack gap={6}>
        <PageTabs group="/load" active="/load/trips" />

        <Panel title={t('w10.trips')} testID="w10-trips">
          <Async
            state={trips}
            empty={(trips.data?.items.length ?? 0) === 0}
            emptyMessage={t('w10.tripsEmpty')}
          >
            <Stack gap={4}>
              {(trips.data?.items ?? []).map((trip) => (
                <Stack
                  key={trip.id}
                  gap={3}
                  pad={4}
                  background="surface"
                  radius="md"
                  border="all"
                  borderTone="faint"
                  testID={`w10-trip-${trip.id}`}
                >
                  <Row justify="between" align="center" gap={3} wrap>
                    <Txt field="bodyStrong" desk="cell">
                      {trip.tripNo ?? trip.id.slice(0, 8)}
                    </Txt>
                    <StatusChip label={trip.state} family={workFamily(trip.state)} />
                  </Row>
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {`${trip.vehicleRegNo} · ${shortDate(trip.tripDate)} · ${t('w10.stops', {
                      done: trip.stopsCompleted,
                      planned: trip.plannedStops,
                    })}`}
                  </Txt>
                  <Row gap={4} wrap>
                    {trip.state === 'planned' ? (
                      <Button
                        label={t('w10.startLoading')}
                        variant="primary"
                        loading={startLoading.status === 'pending'}
                        onPress={() => {
                          startLoading.mutate({ id: trip.id })
                        }}
                        testID={`w10-load-${trip.id}`}
                      />
                    ) : null}
                    {trip.state === 'loading' ? (
                      <Button
                        label={t('w10.depart')}
                        variant="primary"
                        loading={depart.status === 'pending'}
                        onPress={() => {
                          depart.mutate({ id: trip.id })
                        }}
                        testID={`w10-depart-${trip.id}`}
                      />
                    ) : null}
                  </Row>
                </Stack>
              ))}
            </Stack>
          </Async>
        </Panel>

        {error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {error.message}
          </Txt>
        )}

        <Group>
          <ListRow primary={t('w9.settlementIsDesk')} state="disabled" />
        </Group>
      </Stack>
    </Screen>
  )
}
