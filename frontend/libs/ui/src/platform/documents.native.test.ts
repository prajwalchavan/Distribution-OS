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

vi.mock('expo-print', () => ({ printAsync: () => Promise.resolve() }))

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
