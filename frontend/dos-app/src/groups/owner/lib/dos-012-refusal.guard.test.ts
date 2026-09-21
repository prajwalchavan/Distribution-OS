/**
 * DOS-012 — a refused owner write is printed where it was pressed.
 *
 * "Cancel bill" is offered on a bill whose order is already delivered, because only the server knows
 * that (`after dispatch the only correction is a credit note`, 409). The owner pressed it, the dialog
 * CLOSED, the panel was unchanged, and nothing on the screen said no: every confirm on this app closed
 * on failure as well as on success (`.then(done, done)`). The money was safe and the person learnt
 * nothing.
 *
 * The cure is the manager app's, already in this app for Settings › Support access (DOS-108): a
 * surface closes only on success (`stayOpen` is the rejection handler) and `<Refusal>` prints the
 * service's own sentence as the last child of the dialog body. Both come from
 * `src/groups/owner/lib/refusal.tsx` — ONE copy per group, never a second one in a screen.
 *
 * The sweep is this group's own files: Billing (the finding), Orders and Staff. Money is swept by
 * DOS-015 in the same batch (its rebuild dialog needs the result as well as the refusal), and
 * `money/receipts.tsx` (DOS-136), `settings/index.tsx` (DOS-108) and `shops/index.tsx` are other
 * lanes'.
 *
 * Read as SOURCE, like `settings-views.test.ts`: importing a screen in Node pulls in `react-native`
 * and `expo-router`, which resolve only under Metro, and `@types/node` is deliberately absent from an
 * app.
 */
import { describe, expect, it } from 'vitest'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** A screen's source with its comments removed: a comment may quote the very call it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** What a swept screen must look like, whatever `pnpm format` does to its line breaks. */
async function sweepOf(relative: string): Promise<Record<string, boolean | number>> {
  const code = await read(relative)
  return {
    // A refused write no longer closes the surface it was pressed on.
    closesOnRefusal: /\.then\(\s*done\s*,\s*done\s*\)/.test(code),
    // …because `stayOpen` is the rejection handler now.
    staysOpen: /\.then\(\s*done\s*,\s*stayOpen\s*\)/.test(code),
    // Both come from the app's ONE copy (DOS-108 amendment (a)), never a second one in the screen.
    importsFromLib:
      /import\s*\{[^}]*\bRefusal\b[^}]*\bstayOpen\b[^}]*\}\s*from\s*'[^']*lib\/refusal'/.test(code),
    localCopy: /(function|const)\s+stayOpen\b/.test(code),
    // And the sentence is on the surface, scoped so a different bill or action never inherits it.
    refusals: (code.match(/<Refusal\b/g) ?? []).length,
    scoped: /<Refusal[\s\S]*?scope=/.test(code),
  }
}

const SWEPT = {
  closesOnRefusal: false,
  staysOpen: true,
  importsFromLib: true,
  localCopy: false,
  scoped: true,
}

describe('DOS-012 the owner hears a refused write', () => {
  it('DOS-012: the bill dialog stays open on a refusal and prints the service sentence', async () => {
    const billing = await sweepOf('../../../../app/owner/billing/index.tsx')
    // Two surfaces refuse here: the cancel / e-way dialog, and the IRN button in the bill panel.
    expect(billing).toEqual({ ...SWEPT, refusals: 2 })
  })

  it('DOS-012: the order panel dialog stays open on a refusal', async () => {
    expect(await sweepOf('../../../../app/owner/orders/index.tsx')).toEqual({
      ...SWEPT,
      refusals: 1,
    })
  })

  it('DOS-012: the staff dialog stays open on a refusal', async () => {
    // Two surfaces refuse here: the password / status dialog, and the extra-roles panel the owner
    // saves a person's other roles from (docs/29 §2) — which is a write on the page itself, not in a
    // dialog, so it prints its own scoped sentence where it was pressed.
    expect(await sweepOf('../../../../app/owner/staff/index.tsx')).toEqual({
      ...SWEPT,
      refusals: 2,
    })
  })
})
