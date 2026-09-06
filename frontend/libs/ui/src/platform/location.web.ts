/**
 * Location in a browser: `navigator.geolocation`, foreground only.
 *
 * A tab that goes to the background is throttled and then suspended, so there is no honest way to
 * follow a van from a browser — `canTrackInBackground` is `false` and the delivery app says so on
 * screen rather than dropping half a trip's points without telling anyone.
 */
import type { Coordinates, PlatformLocation } from './types.js'

function geolocation(): Geolocation | null {
  // `lib.dom` types `navigator.geolocation` as always present; a locked-down browser or an embedded
  // WebView can still omit it, and there is no other window in which to notice.
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return null
  return navigator.geolocation
}

function toPoint(position: GeolocationPosition): Coordinates {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    at: position.timestamp,
  }
}

export const location: PlatformLocation = {
  /**
   * A browser asks at the moment of the first read, not before, so this reports what a read WOULD
   * find: available or not. The real prompt happens inside `current()` / `watch()`.
   */
  requestPermission: async () => {
    const geo = geolocation()
    if (!geo) return { granted: false, canAskAgain: false, background: false }
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' })
      return {
        granted: status.state === 'granted',
        canAskAgain: status.state !== 'denied',
        background: false,
      }
    } catch {
      // Safari has no Permissions API for geolocation: assume it can be asked.
      return { granted: false, canAskAgain: true, background: false }
    }
  },

  current: () =>
    new Promise<Coordinates | null>((resolve) => {
      const geo = geolocation()
      if (!geo) {
        resolve(null)
        return
      }
      geo.getCurrentPosition(
        (position) => {
          resolve(toPoint(position))
        },
        () => {
          resolve(null)
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
      )
    }),

  watch: (onPoint) => {
    const geo = geolocation()
    if (!geo) return Promise.resolve(() => undefined)
    const id = geo.watchPosition(
      (position) => {
        onPoint(toPoint(position))
      },
      () => {
        // A refused or failed fix is not an exception; the strip already says the trip is not tracking.
      },
      { enableHighAccuracy: true, maximumAge: 10_000 },
    )
    return Promise.resolve(() => {
      geo.clearWatch(id)
    })
  },

  canTrackInBackground: false,
}
