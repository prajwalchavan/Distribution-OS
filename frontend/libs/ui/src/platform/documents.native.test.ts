/**
 * DOS-057 on a phone: `documents.share` downloads the signed PDF into the cache and hands that FILE to
 * the OS share sheet, so WhatsApp carries a PDF that never expires instead of a `/storage/…` link.
 *
 * The cache file is named after the paper, and a bill number carries a "/" (`INV/0826`). Handed to
 * `new File(Paths.cache, 'INV/0826.pdf')` that is a file inside a directory nobody created, so the
 * download fails on Android (FileOutputStream) and on iOS (moveItem) — the name must be flat.
 *
 * The three Expo modules are native and cannot load under vitest, so they are replaced by recorders;
 * the kit's own logic (the cache name, the hand-over, the answer) is what runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { documents } from './documents.native.js'

const recorded = vi.hoisted(() => ({
  downloads: [] as { url: string; path: string }[],
  shares: [] as { uri: string; options: unknown }[],
  sharingAvailable: true,
  printError: null as Error | null,
}))

vi.mock('expo-file-system', () => {
  class File {
    readonly path: string
    constructor(...parts: string[]) {
      this.path = parts.join('/')
    }
    get exists(): boolean {
      return false
    }
    delete(): void {
      // nothing is cached in the recorder
    }
    static downloadFileAsync(url: string, target: File): Promise<{ uri: string }> {
      recorded.downloads.push({ url, path: target.path })
      return Promise.resolve({ uri: `file://${target.path}` })
    }
  }
  return { File, Paths: { cache: '/cache' } }
})

vi.mock('expo-print', () => ({
  printAsync: () =>
    recorded.printError !== null ? Promise.reject(recorded.printError) : Promise.resolve(),
}))

vi.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(recorded.sharingAvailable),
  shareAsync: (uri: string, options: unknown) => {
    recorded.shares.push({ uri, options })
    return Promise.resolve()
  },
}))

const SIGNED =
  'http://127.0.0.1:3005/storage/tenant/t1/documents/invoice/i1.pdf?expires=1789211874&signature=s'

beforeEach(() => {
  recorded.downloads.length = 0
  recorded.shares.length = 0
  recorded.sharingAvailable = true
  recorded.printError = null
})

describe('documents.share on a phone', () => {
  it('DOS-057: on a phone, documents.share caches the PDF under a flat file name and hands the file, not a link, to the share sheet', async () => {
    expect(documents.canShare).toBe(true)

    const sent = await documents.share(SIGNED, {
      filename: 'INV/0826.pdf',
      title: 'Tarsun Enterprise',
      message: 'INV/0826 · Tarsun Enterprise',
    })

    expect(sent).toBe(true)
    expect(recorded.downloads).toEqual([{ url: SIGNED, path: '/cache/INV-0826.pdf' }])
    expect(recorded.shares).toEqual([
      {
        uri: 'file:///cache/INV-0826.pdf',
        options: {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: 'Tarsun Enterprise',
        },
      },
    ])
  })

  it('DOS-057: on a phone, documents.open and documents.print cache a bill under the same flat name', async () => {
    await documents.open(SIGNED, { filename: 'INV/0826.pdf' })
    await documents.print(SIGNED, { filename: 'CN/9003.pdf' })
    expect(recorded.downloads.map((d) => d.path)).toEqual([
      '/cache/INV-0826.pdf',
      '/cache/CN-9003.pdf',
    ])
  })

  it('DOS-057: on a phone, documents.share answers false when there is no share sheet', async () => {
    recorded.sharingAvailable = false
    expect(await documents.share(SIGNED, { filename: 'RCPT-0626.pdf' })).toBe(false)
    expect(recorded.shares).toEqual([])
  })
})

/**
 * DOS-162: cancelling the OS print sheet is a normal choice, not a failure. `expo-print` rejects
 * `printAsync` with a `PrintIncompleteException` when the reader dismisses "Options"/"Cancel"
 * (measured on the iOS simulator: delivery's "Send the papers" and the retailer's bill, both left an
 * uncaught rejection whose red toast covered the sheet's own bottom button). Every one of the seven
 * callers fires this with `void documents.print(...)`, so nothing else ever sees or reports it.
 */
describe('documents.print on a phone (DOS-162)', () => {
  it('resolves quietly when the reader cancels the print sheet', async () => {
    recorded.printError = new Error(
      'PrintIncompleteException: Printing did not complete (at ExpoPrint/ExpoPrintWithPrinter.swift:94)',
    )

    await expect(documents.print(SIGNED, { filename: 'INV/0826.pdf' })).resolves.toBeUndefined()
  })

  it('still rejects on a real print failure', async () => {
    recorded.printError = new Error('Printer offline')

    await expect(documents.print(SIGNED, { filename: 'INV/0826.pdf' })).rejects.toThrow(
      'Printer offline',
    )
  })
})
