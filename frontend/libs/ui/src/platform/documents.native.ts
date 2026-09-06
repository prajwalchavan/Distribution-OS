/**
 * Documents on a phone. `open` downloads the PDF and hands it to the OS share/preview sheet —
 * WhatsApp is one tap from there, which is how a bill actually reaches a shopkeeper in this trade.
 * `print` uses `expo-print`, which drives AirPrint on iOS and the Android print framework.
 */
import { File, Paths } from 'expo-file-system'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'

import type { PlatformDocuments } from './types.js'

function localName(url: string, filename: string | undefined): string {
  if (filename !== undefined && filename !== '') return filename
  const tail = url.split('?')[0]?.split('/').pop()
  return tail !== undefined && tail !== '' ? tail : 'document.pdf'
}

/** Downloads to the cache directory and returns the local URI. */
async function cache(url: string, filename: string | undefined): Promise<string> {
  const target = new File(Paths.cache, localName(url, filename))
  if (target.exists) target.delete()
  const saved = await File.downloadFileAsync(url, target)
  return saved.uri
}

export const documents: PlatformDocuments = {
  open: async (url, options) => {
    const uri = await cache(url, options?.filename)
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })
    }
  },

  print: async (url, options) => {
    // `printAsync({ uri })` wants a LOCAL file on Android; caching first makes both platforms equal.
    const uri = await cache(url, options?.filename)
    await Print.printAsync({ uri })
  },

  canPrint: true,
}
