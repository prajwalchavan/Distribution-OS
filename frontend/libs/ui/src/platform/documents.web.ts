/**
 * Documents on the web. A PDF opens in a tab; printing goes through a hidden iframe so the reader
 * stays on the page they were on.
 *
 * A cross-origin PDF cannot be printed programmatically — the browser will not let a page reach into
 * a frame it does not own — so that case falls back to opening it, where the reader's own Ctrl+P
 * works. Silently doing nothing would be the lie.
 *
 * `share` hands the PDF FILE to the Web Share API (Android browsers, Safari), never the signed link,
 * which dies in 15 minutes (DOS-057). Where the browser cannot share files — every desk Chrome — the
 * PDF opens in a tab INSIDE the tap, before anything is awaited, so no popup blocker refuses it and the
 * reader can save and attach it by hand; the answer is `false`, because nothing was sent.
 */
import type { PlatformDocuments } from './types.js'

const PDF_TYPE = 'application/pdf'

function openTab(url: string): void {
  if (typeof window === 'undefined') return
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** A paper's number carries a "/" (`INV/0826`); a shared file's name must not. */
function fileName(filename: string | undefined): string {
  return filename !== undefined && filename !== ''
    ? filename.replace(/[\\/]/g, '-')
    : 'document.pdf'
}

/**
 * Asked synchronously, with an empty probe of the same name and type, so the answer arrives inside
 * the tap. `navigator.canShare` is typed as required but is absent in Firefox, and it answers false
 * for files on every desk Chrome.
 */
function canShareFiles(name: string): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [new File([], name, { type: PDF_TYPE })] })
  } catch {
    return false
  }
}

export const documents: PlatformDocuments = {
  open: (url) => {
    openTab(url)
    return Promise.resolve()
  },

  print: (url) =>
    new Promise<void>((resolve) => {
      if (typeof document === 'undefined') {
        resolve()
        return
      }
      const frame = document.createElement('iframe')
      frame.style.position = 'fixed'
      frame.style.right = '0'
      frame.style.bottom = '0'
      frame.style.width = '0'
      frame.style.height = '0'
      frame.style.border = '0'
      frame.src = url
      let settled = false
      const finish = (printed: boolean): void => {
        if (settled) return
        settled = true
        if (!printed) openTab(url)
        window.setTimeout(() => {
          frame.remove()
        }, 1000)
        resolve()
      }
      frame.onload = () => {
        try {
          const win = frame.contentWindow
          if (!win) {
            finish(false)
            return
          }
          win.focus()
          win.print()
          finish(true)
        } catch {
          // Cross-origin: the browser owns that frame, not us.
          finish(false)
        }
      }
      frame.onerror = () => {
        finish(false)
      }
      document.body.appendChild(frame)
      // A PDF that never fires `load` must not leave the reader with nothing.
      window.setTimeout(() => {
        finish(false)
      }, 8000)
    }),

  share: async (url, options) => {
    const name = fileName(options?.filename)
    if (!canShareFiles(name)) {
      openTab(url)
      return false
    }
    try {
      const res = await fetch(url)
      if (res.ok) {
        const data: ShareData = { files: [new File([await res.blob()], name, { type: PDF_TYPE })] }
        if (options?.title !== undefined) data.title = options.title
        if (options?.message !== undefined) data.text = options.message
        await navigator.share(data)
        return true
      }
    } catch (error) {
      // The reader dismissed the sheet: nothing was sent, and nothing else should open.
      if (error instanceof DOMException && error.name === 'AbortError') return false
    }
    // The download failed, the link had expired, or the browser refused the hand-over (a slow fetch
    // can outlive the tap's user activation): the tab is what remains.
    openTab(url)
    return false
  },

  canPrint: true,
  canShare: typeof window !== 'undefined',
}
