/**
 * DOS-145 — a bill found in the header search must open, not merely be listed somewhere.
 *
 * A shop phones to cancel before the van leaves. The manager typed INV/9014 into "Search shops,
 * bills, orders", chose the bill, and landed on Registers — the sales register, no bill panel and
 * no Cancel. Opening `/billing?q=INV%2F9014` by hand was no better: the Billing desk stayed on the
 * order queue and the bill appeared only after switching to "Bills issued" by hand. Three attempts
 * to reach a bill issued minutes earlier.
 *
 * So: a bill hit goes to the Billing desk, on the Bills issued tab, with that bill's panel already
 * open; and a `?q=` on the Billing desk means someone is looking for a BILL, so the desk opens on
 * Bills issued. (The register's own order — newest first by bill date — is DOS-009, server-side.)
 *
 * Read as SOURCE, like `dos-153-note-scope.guard.test.ts`: importing a screen in Node pulls in
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

describe('DOS-145 the manager opens a bill from search', () => {
  it('DOS-145: a bill hit in the header search lands on the Billing desk, on Bills issued, with that bill open', async () => {
    const code = withoutComments(await read('../../app/_layout.tsx'))

    // the three hit builders sit in one array; take the bill one by the key it stamps
    const billHit = /billHits\.data\?\.items \?\? \[\]\)\.map\(\(bill\) => \(\{[\s\S]*?\}\)\)/.exec(
      code,
    )?.[0]
    expect(billHit, 'the bill hits are gone from the header search').toBeDefined()

    const href = /href: `([^`]*)`/.exec(billHit ?? '')?.[1] ?? ''
    expect(href, 'a bill hit still lands on the sales register').not.toMatch(/^\/registers/)
    expect(href, 'a bill hit does not land on the Billing desk').toMatch(/^\/billing\?/)
    expect(href, 'the Billing desk is not told to show the issued register').toContain('view=bills')
    expect(href, "the bill's own panel cannot open without its id").toMatch(
      /bill=\$\{[^}]*bill\.id[^}]*\}/,
    )
  })

  it('DOS-145: the Billing desk opens on Bills issued when the url carries a bill, and opens that bill', async () => {
    const code = withoutComments(await read('../../app/billing/index.tsx'))

    const params = /useLocalSearchParams<\{([^}]*)\}>\(\)/.exec(code)?.[1] ?? ''
    expect(params, 'the Billing desk does not read which view to open').toContain('view')
    expect(params, 'the Billing desk does not read which bill to open').toContain('bill')

    const view = /const \[view, setView\] = useState<'queue' \| 'bills'>\(([\s\S]*?)\)\n/.exec(
      code,
    )?.[1]
    expect(view, 'the view state is gone').toBeDefined()
    expect(view, 'the Billing desk still always opens on the order queue').not.toBe("'queue'")
    expect(view, 'a ?q= on the Billing desk does not open the issued register').toMatch(/params\.q/)
    expect(view, 'view=bills is ignored').toMatch(/params\.view/)

    const selected =
      /const \[selected, setSelected\] = useState<string \| null>\(([\s\S]*?)\)\n/.exec(code)?.[1]
    expect(selected, 'the selected-bill state is gone').toBeDefined()
    expect(selected, 'a bill named in the url does not open its own panel').toMatch(/params\.bill/)
  })
})
