/**
 * Documents on the web. A PDF opens in a tab; printing goes through a hidden iframe so the reader
 * stays on the page they were on.
 *
 * A cross-origin PDF cannot be printed programmatically — the browser will not let a page reach into
 * a frame it does not own — so that case falls back to opening it, where the reader's own Ctrl+P
 * works. Silently doing nothing would be the lie.
 */
import type { PlatformDocuments } from './types.js'

function openTab(url: string): void {
  if (typeof window === 'undefined') return
  window.open(url, '_blank', 'noopener,noreferrer')
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

  canPrint: true,
}
