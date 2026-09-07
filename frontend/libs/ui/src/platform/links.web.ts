/**
 * Hand-offs to another app, in a browser: a new tab, which is what a desktop can honestly do with a
 * `tel:` or a `https://…/maps` URL. A blocked pop-up answers `false` rather than failing silently.
 */
import type { PlatformLinks } from './types.js'

export const links: PlatformLinks = {
  open: async (url) => {
    if (typeof window === 'undefined') return false
    try {
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (opened !== null) return true
      // A pop-up blocker refused a new tab; a same-tab hand-off still reaches `tel:` and `geo:`.
      window.location.href = url
      return true
    } catch {
      return false
    }
  },

  /**
   * The phone's own map app, as a URL.
   *
   * `geo:` is Android's scheme and iOS does not answer it, so the web and iOS get the Google Maps
   * universal link — which every phone in this trade already has, and which a desktop browser opens
   * as a normal page. The label rides along as the pin's name so a driver sees the shop's name and
   * not a pair of numbers.
   */
  mapsUrl: (latitude, longitude, label) => {
    const query = `${String(latitude)},${String(longitude)}`
    const name = label === undefined || label === '' ? '' : `(${label})`
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${query}${name}`)}`
  },

  available: typeof window !== 'undefined',
}
