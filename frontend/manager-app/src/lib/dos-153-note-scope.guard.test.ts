/**
 * DOS-153 — a decision note must never follow the manager to the next request.
 *
 * The owner's Approvals panel kept a note typed for one request and sent it with the decision on
 * another (`owner-020-08-om-sai-panel-note-carried.png`); the finding asks for the same check on the
 * manager's decision dialog, which holds the note in the same shape — one `note` state, cleared only
 * after a decision went through. Closing that dialog without deciding is the same journey and left
 * the same text behind, ready to be sent with the next gate the manager opens.
 *
 * The dialog is the only way in and the only way out here, so clearing it on close is the whole fix.
 *
 * Read as SOURCE, like `trips-held-bills.test.ts`: importing a screen in Node pulls in `react-native`
 * and `expo-router`, which resolve only under Metro.
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

async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Block and line comments removed, so a comment that quotes a call is not read as the call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('M2 order queue: the decision note belongs to one request', () => {
  it('DOS-153: closing the decision dialog without deciding clears the note', async () => {
    const code = withoutComments(await read('../../app/orders/index.tsx'))

    const dialog = /<Dialog\s+open=\{deciding !== null\}[\s\S]*?testID="decision-dialog"/.exec(
      code,
    )?.[0]
    expect(dialog, 'the decision dialog is gone').toBeDefined()
    const onClose = /onClose=\{\(\) => \{([\s\S]*?)\}\}/.exec(dialog ?? '')?.[1] ?? ''
    expect(onClose).toMatch(/setDeciding\(null\)/)
    expect(onClose, 'the dialog closes with the note still typed').toMatch(/setNote\(''\)/)
  })
})
