/**
 * UX-00 §6.15 / docs/08 §0 — `<MapView>` for React DOM: MapLibre GL JS over OpenStreetMap raster
 * tiles. Free, no key, and the attribution is rendered by the component because the licence says so.
 *
 * THREE THINGS THIS DOES NOT DO, on purpose.
 *
 * 1. It does not import MapLibre at the top of the file. The library is ~800 KB and only two screens
 *    in the product need it (the owner's live map, the trip replay), so it is loaded on first render
 *    and the rest of the apps never download it.
 * 2. It does not use MapLibre's own `Marker`, `Popup` or `NavigationControl`, which is what would
 *    force `maplibre-gl.css` into every app's build. Pins are a GeoJSON circle layer and traces a line
 *    layer, drawn on the canvas; the names live in the list beneath, which is also the fallback.
 * 3. It does not fail. No WebGL, no library in the bundle, no network for the tiles — each of those
 *    ends in the same honest list of the same places, with a line saying the map is not available.
 *    That is the `@dos/ui/platform` rule (docs/08 §0) applied to a component.
 */
import { useEffect, useRef, useState } from 'react'

import { useTheme } from '../theme.js'
import { radius, space } from '../tokens.js'
import type { MapMarker, MapPoint, MapViewProps } from '../types.js'
import { Txt } from './base.js'

/** The slice of MapLibre this uses, declared structurally so the kit is not typed against a version. */
interface GlMap {
  on(
    event: string,
    layer: string | ((event: GlEvent) => void),
    handler?: (event: GlClick) => void,
  ): void
  once(event: string, handler: () => void): void
  isStyleLoaded?(): boolean
  addSource(id: string, source: unknown): void
  addLayer(layer: unknown): void
  getSource(id: string): { setData(data: unknown): void } | undefined
  fitBounds(bounds: [[number, number], [number, number]], options: unknown): void
  resize(): void
  remove(): void
  getCanvas(): { style: { cursor: string } }
}
interface GlClick {
  features?: { properties?: { id?: string } }[]
}
/** What MapLibre hands a plain (non-layer) listener; only `error` carries anything we read. */
interface GlEvent {
  error?: { message?: string }
}
interface MapLibreModule {
  Map: new (options: Record<string, unknown>) => GlMap
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
/** Kalyan, where the pilot's godown is — the map opens on the distributorship, not on the ocean. */
const DEFAULT_CENTER: MapPoint = { latitude: 19.2437, longitude: 73.1355 }
const DEFAULT_ZOOM = 11

let cached: MapLibreModule | null | undefined

async function loadMapLibre(): Promise<MapLibreModule | null> {
  if (cached !== undefined) return cached
  try {
    const module: unknown = await import('maplibre-gl')
    const candidate = module as { Map?: unknown; default?: { Map?: unknown } }
    const ctor = candidate.Map ?? candidate.default?.Map
    cached = typeof ctor === 'function' ? ({ Map: ctor } as MapLibreModule) : null
  } catch (error) {
    // The USER is told in words by the component; a developer is told why, once, in the console.
    console.warn(
      '[@dos/ui] MapView: maplibre-gl could not be loaded; drawing the list instead',
      error,
    )
    cached = null
  }
  return cached
}

function featuresOf(markers: readonly MapMarker[], colourOf: (m: MapMarker) => string): unknown {
  return {
    type: 'FeatureCollection',
    features: markers.map((marker) => ({
      type: 'Feature',
      properties: {
        id: marker.id,
        colour: colourOf(marker),
        size: marker.selected === true ? 10 : 6,
      },
      geometry: { type: 'Point', coordinates: [marker.longitude, marker.latitude] },
    })),
  }
}

function pathFeaturesOf(paths: NonNullable<MapViewProps['paths']>, colour: string): unknown {
  return {
    type: 'FeatureCollection',
    features: paths.map((path) => ({
      type: 'Feature',
      properties: { id: path.id, colour },
      geometry: {
        type: 'LineString',
        coordinates: path.points.map((point) => [point.longitude, point.latitude]),
      },
    })),
  }
}

export function MapView({
  markers = [],
  paths = [],
  center,
  zoom = DEFAULT_ZOOM,
  height = 360,
  onSelectMarker,
  emptyMessage,
  listOnly = false,
  testID,
}: MapViewProps): React.JSX.Element {
  const theme = useTheme()
  const holder = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<GlMap | null>(null)
  const [engine, setEngine] = useState<'loading' | 'ready' | 'unavailable'>(
    listOnly ? 'unavailable' : 'loading',
  )
  const select = useRef(onSelectMarker)
  select.current = onSelectMarker

  const colourOf = (marker: MapMarker): string =>
    marker.tone === undefined ? theme.colors.accent.solid : theme.colors.status[marker.tone].edge
  const pathColour = theme.colors.accent.line
  const empty = markers.length === 0 && paths.length === 0

  /*
   * BUILT ONCE, WHEN THERE IS BOTH A LIBRARY AND A FRAME WITH A SIZE IN IT.
   *
   * Two things about this cost an afternoon on the harness and are the reason it looks like this.
   * The frame is HIDDEN, not unmounted, while there is nothing to draw — MapLibre attaches to a DOM
   * node, and the markers arrive from SQLite a tick after the first paint, so a conditionally
   * rendered frame hands the map `null` on mount and the map is never built at all. And a map built
   * inside a `display:none` box measures 0 × 0 and never finishes its first render, so it is built
   * only once the frame is showing, and told to `resize()` the moment it is.
   */
  useEffect(() => {
    if (listOnly || empty || mapRef.current !== null) return
    let live = true
    let styleTimer: ReturnType<typeof setTimeout> | null = null
    let resizeWatcher: ResizeObserver | null = null
    void (async () => {
      const maplibre = await loadMapLibre()
      const node = holder.current
      if (maplibre === null) {
        setEngine('unavailable')
        return
      }
      // Not `!live`: a re-render must not abandon the ONLY attempt to build the map. The next run
      // sees `mapRef.current === null` and tries again; the guard above is what stops a second map.
      if (node === null || mapRef.current !== null) return
      let map: GlMap
      try {
        map = new maplibre.Map({
          container: node,
          style: {
            version: 8,
            sources: {
              osm: {
                type: 'raster',
                tiles: [TILES],
                tileSize: 256,
                attribution: theme.t('map.attribution'),
              },
            },
            layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
          },
          center: [
            center?.longitude ?? DEFAULT_CENTER.longitude,
            center?.latitude ?? DEFAULT_CENTER.latitude,
          ],
          zoom,
          attributionControl: false,
        })
      } catch {
        // No WebGL (an old Android browser, a locked-down desk machine): the list still works.
        setEngine('unavailable')
        return
      }
      mapRef.current = map
      /*
       * MapLibre reports a bad style, a source that will not load and a tile that will not decode on
       * its OWN event, not by throwing — and with no listener some of them go nowhere at all. That is
       * how a version whose worker never started drew a perfect backdrop with not one pin on it and
       * said nothing. The user is never left guessing (the list below is always there); this is so a
       * developer is not either.
       */
      map.on('error', (event: GlEvent) => {
        console.warn('[@dos/ui] MapView: maplibre reported', event.error?.message ?? event)
      })
      map.resize()
      /*
       * AND AGAIN WHENEVER THE FRAME CHANGES SIZE. MapLibre measures its container once, at
       * construction, and never again: a map built while the page was still laying out — which is
       * exactly when this one is built, a tick after rows arrive — kept a 300 px canvas inside an
       * 1156 px frame, two thirds of it empty grey. The same observer covers a window resize, a rail
       * that collapses at 1024 px and a phone turned on its side.
       */
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => {
          mapRef.current?.resize()
        })
        observer.observe(node)
        resizeWatcher = observer
      }
      /*
       * The layers go on as soon as the STYLE is parsed, not on `load`: `load` waits for the first
       * visually complete render, which means the first TILES — so on a phone with no signal it never
       * fires, and a map that has every pin's position would sit on "Loading the map" for ever with
       * nothing drawn. The pins are our data; the tiles are only the backdrop.
       */
      let drawn = false
      const draw = (): void => {
        if (drawn || !live) return
        drawn = true
        try {
          map.addSource('dos-paths', { type: 'geojson', data: pathFeaturesOf([], pathColour) })
          map.addLayer({
            id: 'dos-paths',
            type: 'line',
            source: 'dos-paths',
            paint: {
              'line-color': ['get', 'colour'],
              'line-width': 3,
              'line-opacity': 0.8,
            },
          })
          map.addSource('dos-markers', { type: 'geojson', data: featuresOf([], colourOf) })
          map.addLayer({
            id: 'dos-markers',
            type: 'circle',
            source: 'dos-markers',
            paint: {
              'circle-radius': ['get', 'size'],
              'circle-color': ['get', 'colour'],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#FFFFFF',
            },
          })
          map.on('click', 'dos-markers', (event: GlClick) => {
            const id = event.features?.[0]?.properties?.id
            if (id !== undefined) select.current?.(id)
          })
          map.on('mouseenter', 'dos-markers', () => {
            map.getCanvas().style.cursor = 'pointer'
          })
          map.on('mouseleave', 'dos-markers', () => {
            map.getCanvas().style.cursor = ''
          })
          setEngine('ready')
        } catch (error) {
          console.warn('[@dos/ui] MapView: the map could not take its layers', error)
          setEngine('unavailable')
        }
      }
      /*
       * THREE WAYS IN, AND `draw` IS IDEMPOTENT, because none of the three is reliable on its own.
       * `style.load` is the right event and is the one that fires in a real browser. `load` is the
       * only one some builds emit, and it waits for the first TILES — useless on a phone with no
       * signal, which is why it is the backstop and not the trigger. And `isStyleLoaded()` covers the
       * case where the style was already parsed before the listeners went on. A map whose layers were
       * never added is a map with every pin's position and nothing drawn.
       */
      map.once('style.load', draw)
      map.once('load', draw)
      const poll = (attempt: number): void => {
        if (drawn || !live) return
        if (map.isStyleLoaded?.() === true) {
          draw()
          return
        }
        if (attempt > 200) return // 20 s: the events are the real path; this only closes a race.
        styleTimer = setTimeout(() => {
          poll(attempt + 1)
        }, 100)
      }
      poll(0)
    })()
    return () => {
      live = false
      if (styleTimer !== null) clearTimeout(styleTimer)
      resizeWatcher?.disconnect()
    }
  }, [listOnly, empty])

  // The map is torn down when the component goes, and at no other time.
  useEffect(
    () => () => {
      mapRef.current?.remove()
      mapRef.current = null
    },
    [],
  )

  /*
   * The viewport is fitted when the PLACES change, not when the component re-renders. A live map is
   * inside a screen that re-renders on every status tick, and `markers` is almost always a fresh array
   * of the same shops — refitting on each of those snatched the map back from under a user who had
   * panned or zoomed to look at something.
   */
  const fitted = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (map === null || engine !== 'ready') return
    map.getSource('dos-markers')?.setData(featuresOf(markers, colourOf))
    map.getSource('dos-paths')?.setData(pathFeaturesOf(paths, pathColour))
    const all: MapPoint[] = [...markers, ...paths.flatMap((path) => [...path.points])]
    if (all.length < 2) return
    const lngs = all.map((point) => point.longitude)
    const lats = all.map((point) => point.latitude)
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ]
    const signature = bounds.flat().join(',')
    if (fitted.current === signature) return
    fitted.current = signature
    map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 })
  }, [engine, markers, paths, colourOf, pathColour])

  return (
    <div data-testid={testID}>
      {/*
        The frame stays MOUNTED even with nothing to draw, and is hidden instead. MapLibre attaches to
        a DOM node, and markers arrive from SQLite a tick after the first paint: a frame that is
        conditionally rendered hands the map `null` on mount, and the map is then never built at all.
        Hidden is not the same as absent.
      */}
      <div
        style={{
          position: 'relative',
          height,
          borderRadius: radius.md,
          overflow: 'hidden',
          border: `1px solid ${theme.colors.border.hairline}`,
          background: theme.colors.bg.sunken,
          display: empty || engine === 'unavailable' ? 'none' : 'block',
        }}
      >
        <div ref={holder} style={{ position: 'absolute', inset: 0 }} />
        {engine === 'loading' ? (
          /* UX-00 §6.11's rule, applied to a frame: never a blank rectangle without a word. */
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
              {theme.t('map.loading')}
            </Txt>
          </div>
        ) : null}
        <div
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            padding: `2px ${String(space[2])}px`,
            background: theme.colors.bg.surface,
            borderTopLeftRadius: radius.xs,
          }}
        >
          <Txt field="label" desk="meta" color={theme.colors.text.tertiary}>
            {theme.t('map.attribution')}
          </Txt>
        </div>
      </div>
      {engine === 'unavailable' && !empty ? (
        <Txt field="label" desk="meta" as="div" color={theme.colors.text.secondary}>
          {`${theme.t('map.unavailable')} · ${theme.t('map.listFallback')}`}
        </Txt>
      ) : null}
      {empty ? (
        <Txt field="body" desk="body" as="div" color={theme.colors.text.secondary}>
          {emptyMessage ?? theme.t('map.empty')}
        </Txt>
      ) : (
        <ul style={{ listStyle: 'none', margin: `${String(space[3])}px 0 0`, padding: 0 }}>
          {markers.map((marker) => (
            <li key={marker.id} style={{ marginBottom: space[2] }}>
              <button
                type="button"
                onClick={() => onSelectMarker?.(marker.id)}
                disabled={onSelectMarker === undefined}
                style={{
                  /*
                   * `<button>` does not inherit the page's font — the UA sheet gives it Arial — so
                   * every shop name in this list came out in the wrong typeface while `<Txt>` set
                   * only its size. IBM Plex Sans everywhere (founder, 2026-09-05) includes here.
                   */
                  font: 'inherit',
                  color: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: space[2],
                  width: '100%',
                  minHeight: theme.touchSize,
                  padding: `${String(space[1])}px ${String(space[2])}px`,
                  background: marker.selected === true ? theme.colors.accent.tint : 'transparent',
                  border: 'none',
                  borderRadius: radius.sm,
                  cursor: onSelectMarker === undefined ? 'default' : 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    flex: '0 0 auto',
                    borderRadius: '50%',
                    background: colourOf(marker),
                  }}
                />
                <span>
                  <Txt field="body" desk="cell" as="div">
                    {marker.label}
                  </Txt>
                  {marker.detail === undefined ? null : (
                    <Txt field="label" desk="meta" as="div" color={theme.colors.text.secondary}>
                      {marker.detail}
                    </Txt>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
