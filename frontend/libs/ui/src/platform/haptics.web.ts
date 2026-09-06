/**
 * Haptics in a browser. `navigator.vibrate` exists on Android Chrome and nowhere else worth naming,
 * and iOS Safari has nothing — so this is a no-op with `available` telling the truth. A screen never
 * substitutes a sound or an animation for a missing buzz: the confirmation is the words on screen.
 */
import type { PlatformHaptics } from './types.js'

function buzz(pattern: number | number[]): void {
  const nav = typeof navigator === 'undefined' ? null : navigator
  if (!nav || typeof nav.vibrate !== 'function') return
  nav.vibrate(pattern)
}

export const haptics: PlatformHaptics = {
  tap: () => {
    buzz(10)
  },
  success: () => {
    buzz([12, 40, 12])
  },
  warning: () => {
    buzz([20, 60, 20])
  },
  error: () => {
    buzz([40, 60, 40, 60, 40])
  },
  available: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
}
