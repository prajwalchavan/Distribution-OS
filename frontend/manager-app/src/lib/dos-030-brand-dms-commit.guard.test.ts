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
 * the panel says why. A screen must never offer an action the server will refuse.
 *
 * REVIEW (DOS-030, second pass): the replacement copy must also promise no DESTINATION. It first read
 * "It is recorded under the brand's number in Billing → Brand DMS" — present tense, as if the desk
 * could go there and finish the job. It cannot: `app/billing/brand-dms.tsx` is a read-only register
 * plus an imports list, and its one button photographs a bill and `router.push('/inbound/documents')`
 * back to this screen. So this test pins both halves — the rule, and the admission that nothing here
 * finishes the document — and forbids naming a screen that cannot.
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
  it('DOS-030: the supplier-bill button is withheld from a brand_dms_invoice document, and the panel states the rule and admits the document cannot be finished here, naming no screen that cannot do it', async () => {
    const code = withoutComments(await read('../../app/inbound/documents.tsx'))

    // the supplier-bill commit is gated on the document's kind, not only on the caller's permission
    const gate = /\{mayApprove[\s\S]*?testID="docint-approve"/.exec(code)?.[0]
    expect(gate, 'the commit button is gone from the review desk').toBeDefined()
    expect(gate, 'a brand-DMS document is still offered the supplier-bill commit').toMatch(
      /brand_dms_invoice/,
    )

    // and it says, on the panel, why the button is gone
    expect(code, 'the reviewer is left with nothing where the button was').toMatch(
      /m3\.brandDmsRoute/,
    )

    // …stating the rule that makes the button wrong…
    expect(strings['m3.brandDmsRoute'], 'the copy does not state the rule').toMatch(
      /never raise a second bill/,
    )

    // …and the plain truth that nothing here can finish the document. This is a STOPGAP: the commit
    // path is the rest of DOS-030 and belongs to the slice that owns the docint pipeline.
    expect(
      strings['m3.brandDmsRoute'],
      'the copy does not admit the job cannot be finished',
    ).toMatch(/not built yet/)

    // It must promise NO destination. "Billing → Brand DMS" is a read-only register whose only
    // button photographs a bill and pushes straight back to this very screen, so naming it walked
    // the manager round a circle while the document sat at "Needs review" for ever.
    expect(
      strings['m3.brandDmsRoute'],
      'the copy sends the desk to a screen that cannot book the bill',
    ).not.toMatch(/Brand DMS\b|Billing|→/)
  })
})
