/**
 * UX-00 §6.15 / docs/08 §0 — `<MapView>` for React Native: `react-native-maps`, which is Apple Maps
 * on iOS and the Google Maps SDK on Android (the mobile SDKs are free of charge; Android still wants
 * a key in the manifest).
 *
 * `react-native-maps` is a NATIVE module: it exists only when the app's binary was built with it. A
 * dev build made before the dependency was added has the JavaScript and not the native side, so it is
 * required lazily, inside the component, and only when a map is actually rendered — a screen that
 * never shows one cannot be broken by it. When it is missing the component draws the same places as
 * a list and says the map is unavailable, which is the `@dos/ui/platform` rule (docs/08 §0): a
 * capability that is not there answers, it does not throw.
 *
 * Navigating to a stop is NOT this component's job — that is a URL hand-off to the driver's own map
 * app, which already has his traffic, his voice and his offline tiles.
 */
import { useMemo, useState, type ComponentType } from 'react'
import { Pressable, View } from 'react-native'

import { useTheme } from '../theme.js'
import { radius, space } from '../tokens.js'
import type { MapMarker, MapPoint, MapViewProps } from '../types.js'
import { Txt } from './base.js'

interface Region {
  latitude: number
  longitude: number
  latitudeDelta: number
  longitudeDelta: number
}

interface MapsModule {
  default: ComponentType<Record<string, unknown>>
  Marker: ComponentType<Record<string, unknown>>
  Polyline: ComponentType<Record<string, unknown>>
}

let cached: MapsModule | null | undefined

function loadMaps(): MapsModule | null {
  if (cached !== undefined) return cached
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('react-native-maps') as Partial<MapsModule>
    cached =
      typeof module.default === 'function' && typeof module.Marker === 'function'
        ? (module as MapsModule)
        : null
  } catch {
    cached = null
  }
  return cached
}

/** Kalyan, where the pilot's godown is — the map opens on the distributorship, not on the ocean. */
const DEFAULT_CENTER: MapPoint = { latitude: 19.2437, longitude: 73.1355 }

function regionFor(points: readonly MapPoint[], center: MapPoint | undefined): Region {
  if (points.length === 0)
    return {
      latitude: center?.latitude ?? DEFAULT_CENTER.latitude,
      longitude: center?.longitude ?? DEFAULT_CENTER.longitude,
      latitudeDelta: 0.4,
      longitudeDelta: 0.4,
    }
  const lats = points.map((point) => point.latitude)
  const lngs = points.map((point) => point.longitude)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    // A tenth of a degree of padding, so the outermost pin is never under the edge of the frame.
    latitudeDelta: Math.max(maxLat - minLat, 0.01) * 1.4,
    longitudeDelta: Math.max(maxLng - minLng, 0.01) * 1.4,
  }
}

export function MapView({
  markers = [],
  paths = [],
  center,
  zoom: _zoom,
  height = 320,
  onSelectMarker,
  emptyMessage,
  listOnly = false,
  testID,
}: MapViewProps): React.JSX.Element {
  const theme = useTheme()
  const [maps] = useState<MapsModule | null>(() => (listOnly ? null : loadMaps()))
  const empty = markers.length === 0 && paths.length === 0

  const colourOf = (marker: MapMarker): string =>
    marker.tone === undefined ? theme.colors.accent.solid : theme.colors.status[marker.tone].edge

  const region = useMemo(
    () => regionFor([...markers, ...paths.flatMap((path) => [...path.points])], center),
    [markers, paths, center],
  )

  const Native = maps?.default
  const Marker = maps?.Marker
  const Polyline = maps?.Polyline

  return (
    <View testID={testID}>
      {empty || Native === undefined || Marker === undefined || Polyline === undefined ? null : (
        <View
          style={{
            height,
            borderRadius: radius.md,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.border.hairline,
          }}
        >
          <Native style={{ flex: 1 }} initialRegion={region}>
            {paths.map((path) => (
              <Polyline
                key={path.id}
                coordinates={path.points.map((point) => ({ ...point }))}
                strokeColor={
                  path.tone === undefined
                    ? theme.colors.accent.line
                    : theme.colors.status[path.tone].edge
                }
                strokeWidth={3}
              />
            ))}
            {markers.map((marker) => (
              <Marker
                key={marker.id}
                coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
                title={marker.label}
                description={marker.detail}
                pinColor={colourOf(marker)}
                onPress={() => onSelectMarker?.(marker.id)}
              />
            ))}
          </Native>
        </View>
      )}
      {Native === undefined && !empty && !listOnly ? (
        <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
          {`${theme.t('map.unavailable')} · ${theme.t('map.listFallback')}`}
        </Txt>
      ) : null}
      {empty ? (
        <Txt field="body" desk="body" color={theme.colors.text.secondary}>
          {emptyMessage ?? theme.t('map.empty')}
        </Txt>
      ) : (
        <View style={{ marginTop: space[3] }}>
          {markers.map((marker) => (
            <Pressable
              key={marker.id}
              onPress={() => onSelectMarker?.(marker.id)}
              disabled={onSelectMarker === undefined}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[2],
                width: '100%',
                minHeight: theme.touchSize,
                paddingHorizontal: space[2],
                borderRadius: radius.sm,
                backgroundColor:
                  marker.selected === true ? theme.colors.accent.tint : 'transparent',
              }}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: colourOf(marker),
                }}
              />
              <View style={{ flex: 1 }}>
                <Txt field="body" desk="cell">
                  {marker.label}
                </Txt>
                {marker.detail === undefined ? null : (
                  <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
                    {marker.detail}
                  </Txt>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}
