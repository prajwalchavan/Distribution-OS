/**
 * DOS-017 — "Live map" has a map.
 *
 * O4 drew a register of vehicles under the sentence "Map tiles arrive with the MapView component",
 * which was true when the screen was written and stopped being true when `<MapView>` landed in the
 * kit (UX-00 §6.15: MapLibre over OpenStreetMap on the web, `react-native-maps` on a phone, and the
 * same places as a labelled list wherever neither engine is there). "Where are my vans" is now
 * answered by pins; the register stays under them, because it carries the trip, the stops and the
 * staleness a pin cannot.
 *
 * Both engines are OPTIONAL peer dependencies of `@dos/ui` (package.json peerDependenciesMeta), so a
 * map draws in an app only if that app installs them itself — which is why this guard reads the
 * owner app's own package.json as well as its screen.
 *
 * Read as SOURCE, like `settings-views.test.ts`: importing a screen in Node pulls in `react-native`
 * and `expo-router`, which resolve only under Metro.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** The screen's source with its comments removed: a comment may quote the very element it explains. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

interface AppManifest {
  dependencies?: Record<string, string>
}

describe('DOS-017 the owner live map draws a map', () => {
  it('DOS-017: O4 renders the kit <MapView> over the vehicle positions, not a register alone', async () => {
    const screen = withoutComments(await read('../../app/map.tsx'))

    expect({
      // The kit component, imported from the one place a screen may import from.
      imported: /import\s*\{[\s\S]*?\bMapView\b[\s\S]*?\}\s*from\s*'@dos\/ui'/.test(screen),
      rendered: /<MapView\b/.test(screen),
      // Pins are the live positions: a row with no fix cannot be a pin, and each pin carries a name.
      markersProp: /<MapView[\s\S]*?markers=\{/.test(screen),
      marksFromRows: /markers\b[\s\S]*?rows\s*\n?\s*\.filter\(/.test(screen),
      // The register survives underneath: trip, stops and staleness are not pin material.
      keepsRegister: /testID="map-register"/.test(screen),
      /*
       * Android's engine is the Google Maps SDK, which draws a GREY BOX without a key of the
       * distributor's own (`android.config.googleMaps.apiKey` in app.json — docs/26 §2 "maps key",
       * still to arrive). The kit's native fallback only catches a MISSING `react-native-maps`, and
       * this app now installs it, so a dev build would mount the keyless engine and show that grey
       * box instead of the honest list. Until the key lands, Android asks for the list by name.
       */
      androidListUntilKey: /listOnly=\{process\.env\.EXPO_OS === 'android'\}/.test(screen),
    }).toEqual({
      imported: true,
      rendered: true,
      markersProp: true,
      marksFromRows: true,
      keepsRegister: true,
      androidListUntilKey: true,
    })
  })

  it('DOS-017: the owner app installs both map engines, and no longer promises tiles in words', async () => {
    const manifest = JSON.parse(await read('../../package.json')) as AppManifest
    const deps = manifest.dependencies ?? {}
    const catalogue: Readonly<Record<string, string>> = strings

    expect({
      web: deps['maplibre-gl'],
      native: deps['react-native-maps'],
      // The old sentence was a promise, not a note; the note now says where the tiles come from.
      promisesTiles: /arrive with the MapView component/.test(catalogue['o4.mapNote'] ?? ''),
    }).toEqual({
      web: 'catalog:',
      native: 'catalog:',
      promisesTiles: false,
    })
  })
})
