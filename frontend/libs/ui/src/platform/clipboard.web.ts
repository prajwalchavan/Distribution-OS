/**
 * DOS-125 — copying a machine string in a browser: a `upi://pay?…` intent, a payment reference.
 *
 * The Clipboard API is only there in a SECURE context — `https:`, and `localhost` / `127.0.0.1`,
 * which is what the apps are served from in development. Anywhere else `available` is false and the
 * screen hides its Copy button rather than offering one that silently does nothing. Even where the
 * API exists the browser may refuse the write (no user gesture, a denied permission); `copy` answers
 * `false` then, so the screen's "Copied" line only ever appears when something really was copied.
 */
import type { PlatformClipboard } from './types.js'

function hasClipboard(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator.clipboard?.writeText === 'function'
  )
}

export const clipboard: PlatformClipboard = {
  copy: async (text) => {
    if (!hasClipboard()) return false
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  },

  available: hasClipboard(),
}
