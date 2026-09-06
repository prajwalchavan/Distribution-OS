/**
 * Share on the web: the Web Share API where the browser has one (every Android browser, Safari),
 * and the clipboard where it does not — a desktop reader gets the link copied and told so, which is
 * the honest desktop equivalent of a share sheet.
 */
import type { PlatformShare } from './types.js'

/** `navigator.share` is typed as required but is absent in Firefox and in every desktop Chrome. */
function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

export const share: PlatformShare = {
  share: async (payload) => {
    if (typeof navigator === 'undefined') return false

    if (canShare()) {
      const data: ShareData = {}
      if (payload.title !== undefined) data.title = payload.title
      if (payload.message !== undefined) data.text = payload.message
      if (payload.url !== undefined) data.url = payload.url
      try {
        await navigator.share(data)
        return true
      } catch {
        // The user dismissed the sheet. Not an error, and not a share either.
        return false
      }
    }

    const text = [payload.message, payload.url].filter((part) => part !== undefined).join(' ')
    if (text === '') return false
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  },
  available: typeof navigator !== 'undefined',
}
