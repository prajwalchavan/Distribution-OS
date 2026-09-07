/**
 * Hand-offs to another app, on a phone: React Native's `Linking`, which is how a driver reaches the
 * dialler and the map app they already know how to use (UX-00 §6.15 — navigating TO a place is never
 * drawn by us).
 */
import { Linking, Platform } from 'react-native'

import type { PlatformLinks } from './types.js'

export const links: PlatformLinks = {
  open: async (url) => {
    try {
      await Linking.openURL(url)
      return true
    } catch {
      // No app answers this scheme (a tablet with no dialler, a device with no maps). The screen
      // keeps the number on it, which is the point of showing it.
      return false
    }
  },

  /** Android answers `geo:`; iOS answers Apple Maps' own scheme. */
  mapsUrl: (latitude, longitude, label) => {
    const query = `${String(latitude)},${String(longitude)}`
    const name = label === undefined || label === '' ? '' : label
    return Platform.OS === 'ios'
      ? `http://maps.apple.com/?ll=${query}${name === '' ? '' : `&q=${encodeURIComponent(name)}`}`
      : `geo:${query}?q=${encodeURIComponent(`${query}${name === '' ? '' : `(${name})`}`)}`
  },

  available: true,
}
