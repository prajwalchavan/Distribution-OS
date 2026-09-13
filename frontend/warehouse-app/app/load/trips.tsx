/**
 * W10 — trips, from the godown's side (docs/23 §4.1).
 *
 * `TRIP_PLANNERS` in `permissions.ts` is owner, manager, warehouse, delivery: the godown may create a
 * trip, add its stops and put it into loading, because the vehicle is standing on the dock in front of
 * the person holding this phone. "Start loading" asks first; the load sheet is then built and counted
 * out on W7.
 *
 * The godown never sends the vehicle off (QA DOS-043): `trips.depart` is DOORSTEP, the crew's step on D2
 * in the delivery app (consent, odometer, opening cash), and the server refuses it while any load sheet
 * of the trip is still a draft. Nor does the godown cancel or settle a trip, or see a rupee of its
 * collections — `settlementPreview` and `collections.*` are MONEY_COLLECTORS, and a loader is not one.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Dialog,
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
import { useState } from 'react'

import { shortDate } from '../../src/lib/dates'
import { Async, Panel, PageTabs, workFamily } from '../../src/lib/ui'

export default function Trips(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const signedIn = session !== null
  /** The trip whose "Start loading" is waiting for the loader's yes. */
  const [asking, setAsking] = useState<string | null>(null)

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
        setAsking(null)
        haptics.success()
      },
      onError: () => {
        // A refusal closes the dialog, so the server's sentence under the list is what the loader reads.
        setAsking(null)
        haptics.error()
      },
    },
  )

  const error = startLoading.error
  const askingTrip =
    asking === null ? undefined : (trips.data?.items ?? []).find((trip) => trip.id === asking)

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
                  <Row gap={8} wrap>
                    {trip.state === 'planned' ? (
                      <Button
                        label={t('w10.startLoading')}
                        variant="primary"
                        loading={startLoading.status === 'pending'}
                        onPress={() => {
                          setAsking(trip.id)
                        }}
                        testID={`w10-load-${trip.id}`}
                      />
                    ) : null}
                    {trip.state === 'loading' ? (
                      <Txt
                        field="label"
                        desk="meta"
                        color={colors.text.secondary}
                        testID={`w10-driver-departs-${trip.id}`}
                      >
                        {t('w10.driverDeparts')}
                      </Txt>
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

      <Dialog
        open={askingTrip !== undefined}
        onClose={() => {
          setAsking(null)
        }}
        title={t('w10.confirmTitle', {
          trip: askingTrip === undefined ? '' : (askingTrip.tripNo ?? askingTrip.id.slice(0, 8)),
        })}
        body={t('w10.confirmBody', {
          vehicle: askingTrip?.vehicleRegNo ?? '',
          date: shortDate(askingTrip?.tripDate),
          stops: askingTrip?.plannedStops ?? 0,
        })}
        confirmLabel={t('w10.startLoading')}
        busy={startLoading.status === 'pending'}
        onConfirm={() => {
          if (askingTrip !== undefined) startLoading.mutate({ id: askingTrip.id })
        }}
        testID="w10-dialog"
      />
    </Screen>
  )
}
