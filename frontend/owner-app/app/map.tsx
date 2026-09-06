/**
 * O4 — the live map: where every vehicle is now, and how far through its trip.
 *
 * `MapView` is a kit component the universal decision of 2026-09-06 places in `@dos/ui` (MapLibre on
 * the web, `react-native-maps` on a phone) and it does not exist yet, so this screen draws the SAME
 * data as a register and hands each vehicle to the reader's own map app by URL — the hand-off docs/08
 * §0 already specifies for navigation. Nothing here is a placeholder: the positions, the staleness
 * and the stop counts are `delivery.vehicles.positions` live, and the tiles are the only thing missing.
 */
import type { VehiclePosition } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Button,
  Register,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { share } from '@dos/ui/platform'

import { Async, PageTabs, Panel, textColumn, useNames } from '../src/lib/ui'
import { instantWithClock } from '../src/lib/dates'

export default function LiveMap(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const names = useNames()

  // 30 minutes is the contract's own default staleness window; a stale row still shows, and says so.
  const positions = useQuery(
    ['delivery', 'positions'],
    () => api.api.delivery.vehicles.positions({ staleAfterMinutes: 30 }),
    { staleTime: 30_000 },
  )

  const rows = positions.data?.items ?? []

  const columns: readonly RegisterColumn<VehiclePosition>[] = [
    textColumn('vehicle', t('o4.vehicle'), (row) => row.regNo, { priority: 'identity' }),
    textColumn('driver', t('o4.driver'), (row) => names.staff(row.driverId)),
    textColumn('trip', t('o18.tripNo'), (row) => row.tripNo),
    {
      key: 'stops',
      head: t('o4.stops'),
      align: 'right',
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numeric>
          {`${String(row.stopsDone)} / ${String(row.stopsPlanned)}`}
        </Txt>
      ),
    },
    {
      key: 'seen',
      head: t('o4.seen'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={instantWithClock(row.recordedAt)}
          family={row.stale ? 'ochre' : 'moss'}
        />
      ),
    },
    {
      key: 'open',
      head: t('o4.position'),
      cell: (row) =>
        row.lat === null || row.lng === null ? (
          <Txt field="body" desk="cell">
            {t('app.none')}
          </Txt>
        ) : (
          <Button
            label={t('o4.openInMaps')}
            variant="ghost"
            onPress={() => {
              void share.share({
                title: row.regNo,
                url: `https://www.openstreetmap.org/?mlat=${String(row.lat)}&mlon=${String(row.lng)}#map=17/${String(row.lat)}/${String(row.lng)}`,
              })
            }}
          />
        ),
    },
  ]

  return (
    <Screen title={t('o4.title')} chips={<PageTabs group="/" active="/map" />}>
      <Stack gap={4}>
        <Panel meta={t('o4.mapNote')}>
          <Async
            state={[positions]}
            rows={4}
            empty={rows.length === 0}
            emptyMessage={t('o4.noPositions')}
          >
            <Register
              testID="map-register"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.vehicleId}
              frozen="vehicle"
              state="ready"
            />
          </Async>
        </Panel>
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('o4.trace')}
        </Txt>
      </Stack>
    </Screen>
  )
}
