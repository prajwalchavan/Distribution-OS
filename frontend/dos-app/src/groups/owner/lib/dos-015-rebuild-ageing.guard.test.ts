/**
 * DOS-015 — "Rebuild ageing" says what it rebuilt.
 *
 * The button opens a confirm and the confirm calls `receivables.ageing.rebuild`, which answers the
 * date it aged to, how many shops it re-aged and the two totals (`RebuildAgeingOutput`). The screen
 * threw that answer away and closed the dialog on success AND on failure (`.then(done, done)`), so
 * the owner pressed a button, watched a dialog vanish, and had no way to tell a rebuild from a
 * refusal — the ladder above it looks the same either way when nothing has moved since the worker's
 * own nightly pass.
 *
 * App-only, by the DOS-117 verdict: the endpoint, its permission and its transaction do not change.
 * A rebuild reports itself in a toast; a refusal keeps the dialog open and prints the service's own
 * sentence through the app's one copy of `Refusal`/`stayOpen` (DOS-012's sweep, finished here for
 * Money — `money/receipts.tsx` is DOS-136's).
 *
 * Read as SOURCE, like `settings-views.test.ts`.
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

describe('DOS-015 rebuilding the ageing reports itself', () => {
  it('DOS-015: the rebuild shows its result, and a refused rebuild keeps the dialog open', async () => {
    const screen = await read('../../../../app/owner/money/index.tsx')
    const catalogue: Readonly<Record<string, string>> = strings

    expect({
      // The answer is read, not discarded: the toast names the shops and the date it aged to.
      closedSilently: /rebuild\s*\.?\s*mutateAsync\(null\)\s*\.then\(\s*done\s*,\s*done\s*\)/.test(
        screen,
      ),
      readsResult: /rebuild\s*\n?\s*\.mutateAsync\(null\)[\s\S]{0,400}?result\.retailers/.test(
        screen,
      ),
      saysAsOf: /result\.asOf/.test(screen),
      // A refusal is a sentence on the dialog, from the app's one copy.
      importsFromLib:
        /import\s*\{[^}]*\bRefusal\b[^}]*\bstayOpen\b[^}]*\}\s*from\s*'[^']*lib\/refusal'/.test(
          screen,
        ),
      refusalOnDialog: /<Refusal[\s\S]*?of=\{\[[\s\S]*?rebuild[\s\S]*?\]\}/.test(screen),
      staysOpen: /\.then\(\s*done\s*,\s*stayOpen\s*\)/.test(screen),
      // The sentence exists and is about this rebuild, not a generic "Saved".
      wording: catalogue['o10.rebuilt'] ?? '',
    }).toEqual({
      closedSilently: false,
      readsResult: true,
      saysAsOf: true,
      importsFromLib: true,
      refusalOnDialog: true,
      staysOpen: true,
      wording: 'Ageing rebuilt to {date} — {count} shops',
    })
  })
})
