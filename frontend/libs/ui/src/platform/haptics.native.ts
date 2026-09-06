/**
 * Haptics on a phone: `expo-haptics`. The four confirmations a warehouse hand feels through a glove,
 * mapped to the OS's own vocabulary so they match every other app on the device.
 */
import * as Haptics from 'expo-haptics'

import type { PlatformHaptics } from './types.js'

export const haptics: PlatformHaptics = {
  tap: () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  },
  success: () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  },
  warning: () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  },
  error: () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
  },
  available: true,
}
