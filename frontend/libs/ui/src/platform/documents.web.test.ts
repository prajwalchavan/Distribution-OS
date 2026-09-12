/**
 * DOS-057: "Send on WhatsApp" hands the PDF FILE to the share sheet, never a text link that dies with
 * its 15-minute signature. Where the browser cannot share files (every desk Chrome) the PDF opens in a
 * tab INSIDE the tap — before any await, so a popup blocker has no reason to refuse it — and the
 * answer is `false`, because nothing was sent.
 *
 * `documents.web.ts` reads `window` when it loads (`canShare`), so every case stubs the globals first
 * and imports a fresh copy of the module.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { PlatformDocuments } from './types.js'

const SIGNED =
  'http://127.0.0.1:3005/storage/tenant/t1/documents/invoice/i1.pdf?expires=1789211874&signature=s'

interface Browser {
  documents: PlatformDocuments
  open: Mock<(url: string, target?: string, features?: string) => null>
  fetch: Mock<(input: string) => Promise<Response>>
  share: Mock<(data: ShareData) => Promise<void>>
}

async function browser(options: {
  /** `absent` is a browser with no `navigator.canShare` at all (Firefox). */
  canShareFiles: boolean | 'absent'
  share?: (data: ShareData) => Promise<void>
}): Promise<Browser> {
  const open = vi.fn<(url: string, target?: string, features?: string) => null>(() => null)
  const fetch = vi.fn<(input: string) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    ),
  )
  const share = vi.fn<(data: ShareData) => Promise<void>>(
    options.share ?? (() => Promise.resolve()),
  )
  const navigatorStub: { share: typeof share; canShare?: (data: ShareData) => boolean } = { share }
  if (options.canShareFiles !== 'absent') {
    const answer = options.canShareFiles
    navigatorStub.canShare = (data) => answer && (data.files?.length ?? 0) > 0
  }
  vi.stubGlobal('window', { open })
  vi.stubGlobal('navigator', navigatorStub)
  vi.stubGlobal('fetch', fetch)
  vi.resetModules()
  const { documents } = await import('./documents.web.js')
  return { documents, open, fetch, share }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('documents.share on the web', () => {
  it('DOS-057: documents.share hands the PDF file itself to navigator.share when the browser can share files', async () => {
    const b = await browser({ canShareFiles: true })
    expect(b.documents.canShare).toBe(true)

    const sent = await b.documents.share(SIGNED, {
      filename: 'INV/0826.pdf',
      title: 'Tarsun Enterprise',
      message: 'INV/0826 · Tarsun Enterprise',
    })

    expect(sent).toBe(true)
    expect(b.fetch).toHaveBeenCalledWith(SIGNED)
    expect(b.share).toHaveBeenCalledTimes(1)
    const data = b.share.mock.calls[0]?.[0]
    expect(data?.files).toHaveLength(1)
    const file = data?.files?.[0]
    expect(file?.type).toBe('application/pdf')
    // A bill number's "/" is not part of a file name.
    expect(file?.name).toBe('INV-0826.pdf')
    expect(await file?.text()).toBe('%PDF-1.4')
    expect(data?.title).toBe('Tarsun Enterprise')
    expect(data?.text).toBe('INV/0826 · Tarsun Enterprise')
    // The file, never the link that expires.
    expect(data?.url).toBeUndefined()
    expect(b.open).not.toHaveBeenCalled()
  })

  it('DOS-057: documents.share opens the PDF in a tab without fetching and answers false when the browser cannot share files', async () => {
    for (const canShareFiles of [false, 'absent'] as const) {
      const b = await browser({ canShareFiles })

      const pending = b.documents.share(SIGNED, { filename: 'INV/0826.pdf' })
      // Opened inside the tap, before anything was awaited.
      expect(b.open).toHaveBeenCalledTimes(1)
      expect(b.open.mock.calls[0]?.[0]).toBe(SIGNED)

      expect(await pending).toBe(false)
      expect(b.fetch).not.toHaveBeenCalled()
      expect(b.share).not.toHaveBeenCalled()
      expect(b.open).toHaveBeenCalledTimes(1)
      vi.unstubAllGlobals()
    }
  })

  it('DOS-057: documents.share answers false and opens nothing when the reader dismisses the share sheet', async () => {
    const b = await browser({
      canShareFiles: true,
      share: () => Promise.reject(new DOMException('Share canceled', 'AbortError')),
    })

    expect(await b.documents.share(SIGNED, { filename: 'INV-0826.pdf' })).toBe(false)
    expect(b.share).toHaveBeenCalledTimes(1)
    expect(b.open).not.toHaveBeenCalled()
  })

  it('DOS-057: documents.share falls back to the tab when the download or the hand-over fails for any other reason', async () => {
    const refused = await browser({
      canShareFiles: true,
      share: () => Promise.reject(new DOMException('No user activation', 'NotAllowedError')),
    })
    expect(await refused.documents.share(SIGNED)).toBe(false)
    expect(refused.open).toHaveBeenCalledTimes(1)
    expect(refused.open.mock.calls[0]?.[0]).toBe(SIGNED)
    vi.unstubAllGlobals()

    const expired = await browser({ canShareFiles: true })
    expired.fetch.mockResolvedValueOnce(new Response('expired', { status: 403 }))
    expect(await expired.documents.share(SIGNED)).toBe(false)
    expect(expired.share).not.toHaveBeenCalled()
    expect(expired.open).toHaveBeenCalledTimes(1)
  })
})
