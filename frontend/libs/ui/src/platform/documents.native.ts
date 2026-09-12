/**
 * Documents on a phone. `open` downloads the PDF and hands it to the OS share/preview sheet —
 * WhatsApp is one tap from there, which is how a bill actually reaches a shopkeeper in this trade.
 * `share` is the same hand-over with the sheet titled: the shop receives the FILE, which never
 * expires, rather than a signed link that dies in 15 minutes (DOS-057).
 * `print` uses `expo-print`, which drives AirPrint on iOS and the Android print framework.
 */
import { File, Paths } from 'expo-file-system'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'

import type { PlatformDocuments } from './types.js'

/**
 * The cache file's name. A paper's number carries a "/" (`INV/0826`), and `new File(Paths.cache,
 * 'INV/0826.pdf')` names a file inside a directory nobody created, so the download fails on Android
 * and on iOS alike. A path separator in the name therefore becomes "-".
 */
function localName(url: string, filename: string | undefined): string {
  if (filename !== undefined && filename !== '') return filename.replace(/[\\/]/g, '-')
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

  share: async (url, options) => {
    const uri = await cache(url, options?.filename)
    if (!(await Sharing.isAvailableAsync())) return false
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      ...(options?.title === undefined ? {} : { dialogTitle: options.title }),
    })
    return true
  },

  canPrint: true,
  canShare: true,
}
