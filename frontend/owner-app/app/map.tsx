/**
 * O4 — the live map: where every vehicle is now, and how far through its trip.
 *
 * `<MapView>` is the kit's own (UX-00 §6.15 / docs/08 §0): MapLibre GL JS over OpenStreetMap raster
 * tiles on the web, `react-native-maps` on a phone — Apple Maps on iOS, the Google Maps SDK on
 * Android, which still wants a key of the distributor's own in the Android build. Neither engine is a
 * hard dependency and neither can fail loudly: where the library or the WebGL context is missing the
 * component draws the same vehicles as a labelled list and says so (DOS-017).
 *
 * The register stays UNDER the map, because a pin cannot carry the trip number, the stop count or
 * how long ago the van last spoke — and "Open in maps" is still the hand-off docs/08 §0 specifies for
 * navigation, which belongs to the driver's own map app and never to this screen.
 */
import type { VehiclePosition } from '@dos/contracts'
import { useApi, useQuery } from '@dos/api-client/react'
import {
  Button,
  MapView,
  Register,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  type MapMarker,
  type RegisterColumn,
} from '@dos/ui'
import { share } from '@dos/ui/platform'
import { useState } from 'react'

import { Async, PageTabs, Panel, textColumn, useNames } from '../src/lib/ui'
import { instantWithClock } from '../src/lib/dates'

export default function LiveMap(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const [selected, setSelected] = useState<string | null>(null)

  // 30 minutes is the contract's own default staleness window; a stale row still shows, and says so.
  const positions = useQuery(
    ['delivery', 'positions'],
    () => api.api.delivery.vehicles.positions({ staleAfterMinutes: 30 }),
    { staleTime: 30_000 },
  )

  const rows = positions.data?.items ?? []

  /*
   * A van with no fix today is a ROW and not a pin: the register says "Position — none" for it, and
   * a pin at 0,0 in the Gulf of Guinea would be a lie. The detail line is the same three facts the
   * row carries, so the callout on a phone is not thinner than the table on the desk.
   */
  const markers: readonly MapMarker[] = rows
    .filter(
      (row): row is VehiclePosition & { lat: number; lng: number } =>
        row.lat !== null && row.lng !== null,
    )
    .map((row) => ({
      id: row.vehicleId,
      latitude: row.lat,
      longitude: row.lng,
      label: row.regNo,
      detail: `${t('o4.stops')} ${String(row.stopsDone)}/${String(row.stopsPlanned)} · ${instantWithClock(row.recordedAt)}`,
      tone: row.stale ? ('ochre' as const) : ('moss' as const),
      selected: row.vehicleId === selected,
    }))

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
            <Stack gap={4}>
              <MapView
                testID="map-view"
                markers={markers}
                height={360}
                emptyMessage={t('o4.noFix')}
                onSelectMarker={(id) => {
                  setSelected((current) => (current === id ? null : id))
                }}
              />
              <Register
                testID="map-register"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.vehicleId}
                frozen="vehicle"
                selectedKey={selected}
                onSelect={(row) => {
                  setSelected(row.vehicleId)
                }}
                state="ready"
              />
            </Stack>
          </Async>
        </Panel>
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('o4.trace')}
        </Txt>
      </Stack>
    </Screen>
  )
}
