/**
 * DOS-008 — "Open bill" stops saying "being prepared" once the bill is prepared.
 *
 * A bill's PDF is rendered by the WORKER (scale rule 3: nothing renders on the request path), so the
 * first ask for a bill that has never been printed answers `queued` — and 856 of the pilot's 857 bills
 * have never been printed, so that is the FIRST press on very nearly every bill. The screen printed
 * "press again in a moment" and then did nothing at all: the reader pressed again, and again, and only
 * a reload ever opened the file.
 *
 * The cure is the owner app's own, with no backend change and no shared helper: the screen polls
 * `billing.invoices.pdf` a bounded number of times while it waits, and when the file is there it
 * offers it as a BUTTON rather than opening a window by itself — a browser blocks a window opened
 * seconds after the press that asked for it, which would have been the same silence in a new shape.
 *
 * Read as SOURCE, like `settings-views.test.ts`: importing a screen in Node pulls in `react-native`
 * and `expo-router`, which resolve only under Metro.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('DOS-008 a bill that is ready opens', () => {
  it('DOS-008: the bill panel polls the queued render a bounded number of times and then offers the file', async () => {
    const screen = await read('../../../../app/owner/billing/index.tsx')
    const catalogue: Readonly<Record<string, string>> = strings

    expect({
      // The wait is the screen's own state, bounded by a named ceiling and an interval.
      bounded: /PDF_POLL_TRIES\s*=\s*\d+/.test(screen) && /PDF_POLL_MS\s*=\s*\d+/.test(screen),
      // …and it re-asks the same procedure while it waits, not once and never again.
      polls: /setTimeout\([\s\S]*?invoices\.pdf\(/.test(screen),
      // The file is offered as a press, because a window opened later than the press is blocked.
      readyButton: /testID="invoice-pdf-ready"/.test(screen),
      // Nothing is left running for a bill the reader has walked away from.
      stopsOnClose: /wait\.invoiceId\s*!==\s*selected/.test(screen),
      // And the old sentence no longer tells the reader to press again: the screen is doing that.
      tellsToPressAgain: /press again/i.test(catalogue['o13.pdfQueued'] ?? ''),
    }).toEqual({
      bounded: true,
      polls: true,
      readyButton: true,
      stopsOnClose: true,
      tellsToPressAgain: false,
    })
  })
})
