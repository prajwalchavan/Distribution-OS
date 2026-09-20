/**
 * DOS-030 — a brand-DMS document must not be offered "Book it as a supplier bill".
 *
 * FA/TY/26-27/1187 is a Too Yumm bill the brand's own field force already billed in FieldAssist. The
 * review desk offered the supplier-bill button, the dialog promised "This books a DRAFT supplier
 * bill", and the server answered 501 NOT_IMPLEMENTED — silently, so the document sat at "Needs
 * review" for ever. The product rule is docs/22 §5 and never-list 5: a brand bill is a receivable
 * captured under the BRAND's own number, never a second legal invoice of ours.
 *
 * Until the commit path is built (the architect's design touches the docint pipeline's validators and
 * module wiring, which this slice does not own), the button that can only ever fail is not offered and
 * the panel names the route instead. A screen must never offer an action the server will refuse.
 *
 * Read as SOURCE, like `dos-153-note-scope.guard.test.ts`: importing a screen in Node pulls in
 * `react-native` and `expo-router`, which resolve only under Metro.
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
}

/** Block and line comments removed, so a comment that quotes a call is not read as the call. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('M3 review desk: a brand-DMS bill is not booked as a supplier bill', () => {
  it('DOS-030: the supplier-bill button is withheld from a brand_dms_invoice document, and the panel names the route', async () => {
    const code = withoutComments(await read('../../app/inbound/documents.tsx'))

    // the supplier-bill commit is gated on the document's kind, not only on the caller's permission
    const gate = /\{mayApprove[\s\S]*?testID="docint-approve"/.exec(code)?.[0]
    expect(gate, 'the commit button is gone from the review desk').toBeDefined()
    expect(gate, 'a brand-DMS document is still offered the supplier-bill commit').toMatch(
      /brand_dms_invoice/,
    )

    // and it says where a brand bill actually goes, rather than leaving the reviewer with nothing
    expect(code, 'the brand-DMS route is not stated on the panel').toMatch(/m3\.brandDmsRoute/)
    expect(strings['m3.brandDmsRoute']).toMatch(/Brand DMS/)
  })
})
