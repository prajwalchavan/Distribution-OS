/**
 * Location on a phone: `expo-location`, trip-scoped.
 *
 * `watch()` is the FOREGROUND watch — `Balanced` accuracy, 50 m / 30 s, the settings docs/08 records
 * — and it is what the delivery screen uses while the driver has the app open. Registering the
 * background task (`expo-task-manager`, Android `foregroundServiceType="location"`, the iOS
 * background indicator) belongs to the delivery app, which owns the trip lifecycle and the disclosure
 * dialogue; the kit only says here whether the platform CAN, so a screen can be honest either way.
 */
import * as Location from 'expo-location'

import type { Coordinates, PlatformLocation } from './types.js'

const DISTANCE_METRES = 50
const INTERVAL_MS = 30_000

function toPoint(position: Location.LocationObject): Coordinates {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    at: position.timestamp,
  }
}

export const location: PlatformLocation = {
  requestPermission: async (options) => {
    const foreground = await Location.requestForegroundPermissionsAsync()
    if (!foreground.granted || options?.background !== true) {
      return {
        granted: foreground.granted,
        canAskAgain: foreground.canAskAgain,
        background: false,
      }
    }
    // Android and iOS both insist the foreground grant lands first.
    const background = await Location.requestBackgroundPermissionsAsync()
    return {
      granted: foreground.granted,
      canAskAgain: foreground.canAskAgain,
      background: background.granted,
    }
  },

  current: async () => {
    const permission = await Location.getForegroundPermissionsAsync()
    if (!permission.granted) return null
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
      return toPoint(position)
    } catch {
      return null
    }
  },

  watch: async (onPoint, options) => {
    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: options?.distanceMetres ?? DISTANCE_METRES,
        timeInterval: options?.intervalMs ?? INTERVAL_MS,
      },
      (position) => {
        onPoint(toPoint(position))
      },
    )
    return () => {
      subscription.remove()
    }
  },

  canTrackInBackground: true,
}
