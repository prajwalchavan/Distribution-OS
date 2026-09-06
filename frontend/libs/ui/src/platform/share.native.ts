/**
 * Share on a phone: React Native's own share sheet. WhatsApp is one tap from it, which is how a bill
 * or a payment link actually reaches a shopkeeper in this trade.
 */
import { Share } from 'react-native'

import type { PlatformShare } from './types.js'

export const share: PlatformShare = {
  share: async (payload) => {
    const message = [payload.message, payload.url].filter((part) => part !== undefined).join(' ')
    if (message.trim() === '') return false
    const result = await Share.share(
      payload.title === undefined ? { message } : { message, title: payload.title },
    )
    return result.action === Share.sharedAction
  },
  available: true,
}
