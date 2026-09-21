/**
 * DOS-103 — the desk must SEE what the shop filed (docs/22 §8, 2026-09-13: a shop's report "lands …
 * with its kind and the bill or delivery it names; the desk triages it").
 *
 * The shop half shipped: the retailer app files a return request, a complaint or a question, and
 * `inbound.create` stores `kind`, `refType` and `refId` beside the shopkeeper's own words. The
 * `InboundMessage` on the wire carries all three. M18's "Shops wrote to us" register showed none of
 * them — shop, text, channel, received, handled — so a return request raised against bill INV/9014
 * reached the desk as a row reading "In app" with free text in it, indistinguishable from a
 * customer's "kya aaj delivery hai?". The structure was on the wire and invisible on the screen,
 * which is the half-built shape the founder's decision was written against.
 *
 * So the register states the kind in the trade's own words, and names the thing the report is about
 * — and for a bill that name is a LINK onto the Billing desk with that bill's panel already open,
 * the same `/billing?view=bills&bill=…` route the header search uses (DOS-145). Display-only: the
 * desk still triages with "Mark it handled", and nothing here writes.
 *
 * Read as SOURCE, like `dos-145-bill-search.guard.test.ts`: importing a screen in Node pulls in
 * `react-native` and `expo-router`, which resolve only under Metro.
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

async function inboundColumns(): Promise<string> {
  const code = withoutComments(await read('../../../../app/manager/messages/index.tsx'))
  const block =
    /const inboundColumns: readonly RegisterColumn<InboundMessage>\[\] = \[([\s\S]*?)\n {2}\]/.exec(
      code,
    )?.[1]
  expect(block, "M18's inbound register is gone").toBeDefined()
  return block ?? ''
}

describe('DOS-103 the desk sees what the shop filed', () => {
  it('DOS-103: the inbound register states the report’s kind', async () => {
    const block = await inboundColumns()

    expect(block, 'the inbound register does not carry a kind column').toMatch(
      /textColumn\(\s*'kind'/,
    )
    expect(block, 'the kind column does not read the row’s own kind').toMatch(/row\.kind/)
    expect(block, 'the kind column prints a machine word instead of a translated one').toMatch(
      /m18\.kind\.\$\{[^}]*row\.kind[^}]*\}/,
    )
    // A captured WhatsApp text has no kind; it must read as the register's em dash, never as
    // "m18.kind.null" or an invented kind.
    expect(block, 'a text with no kind is not left blank').toMatch(/row\.kind === null/)
  })

  it('DOS-103: a report against a bill names it, and opens that bill on the Billing desk', async () => {
    const block = await inboundColumns()

    expect(block, 'the inbound register does not name what the report is about').toMatch(
      /key: 'ref'/,
    )
    expect(block, 'the reference column ignores refType').toMatch(/row\.refType/)
    expect(block, 'the reference column ignores refId').toMatch(/row\.refId/)
    expect(block, 'a reference with no id is still rendered as a link').toMatch(
      /row\.refId === null/,
    )

    // Built through `routeFor('manager', …)` since the one-app merge (docs/31 ruling Q1); the
    // assertions below are on the path itself, which is what this guard has always been about.
    const href = /href=\{(?:routeFor\('manager', )?`([^`]*)`/.exec(block)?.[1] ?? ''
    expect(href, 'a bill reference does not lead to the Billing desk').toMatch(/^\/billing\?/)
    expect(href, 'the Billing desk is not told to show the issued register').toContain('view=bills')
    expect(href, "the bill's own panel cannot open without its id").toMatch(
      /bill=\$\{[^}]*row\.refId[^}]*\}/,
    )
    // Only a bill has a route on this desk today; a delivery or an order is named, not linked.
    expect(block, 'every reference type is treated as a bill').toMatch(/'invoice'/)
  })

  it('DOS-103: the words the desk reads are in the string catalogue, not in the screen', async () => {
    const strings = await read('../strings.ts')
    for (const key of [
      'm18.kind',
      'm18.kind.return_request',
      'm18.kind.complaint',
      'm18.kind.question',
      'm18.ref',
      'm18.ref.invoice',
      'm18.ref.delivery',
      'm18.ref.order',
    ]) {
      expect(strings, `the manager app has no "${key}"`).toContain(`'${key}':`)
    }
  })
})
