/**
 * DOS-191 — an order the office refused has to reach the rep standing in the shop.
 *
 * The manager's rejection dialog demands a note ("the person who asked will read it"), and the whole
 * of it reached the rep as the literal string `approval_rejected` under "Reason given". The sentence
 * itself sat in `approvals.decision_note`, on no screen a rep could open; nothing was pushed back to
 * the phone at all; and the order left the default tab, so the rep had to think to go looking.
 *
 * So: the server writes the decision onto the order in words and stamps `refused_at`, the device row
 * carries both, S5 says "The office refused this order" with the manager's sentence under it, and S6
 * keeps a **Refused** filter beside Travelling, Drafts and All — four views, which is why the control
 * is a chip row and not `<Segments>` (`items.slice(0, 3)` drops a fourth in silence).
 *
 * Read as SOURCE, like `dos-142-cancel-reason.guard.test.ts`: importing a screen in Node pulls in
 * `react-native`, which does not resolve outside Metro.
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
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-191 the rep reads the office’s refusal, and keeps the order in sight', () => {
  it('DOS-191 the device row carries refused_at and S5 says the office refused it, in the manager’s words', async () => {
    const local = await read('./local.ts')
    const screen = await read('../../../../app/sales/orders/[id].tsx')
    const strings = await read('../strings.ts')

    expect({
      // The fact, on the device row, so the phone can tell a refusal from any other cancellation.
      localRow: /interface LocalOrder[\s\S]*?refused_at: string \| null[\s\S]*?\n}/.test(local),
      viewKeeps: /'refused_at'/.test(screen),
      mapsServer: /refused_at:\s*item\.refusedAt/.test(screen),
      // S5 draws the refusal as its own thing, and still prints the words that came with it.
      renders: /order\.refused_at/.test(screen),
      words: /order\.cancel_reason/.test(screen),
      title: strings.includes("'s5.refused': 'The office refused this order'"),
      when: strings.includes("'s5.refusedAt': 'Refused {when}'"),
    }).toEqual({
      localRow: true,
      viewKeeps: true,
      mapsServer: true,
      renders: true,
      words: true,
      title: true,
      when: true,
    })
  })

  it('DOS-191 S6 keeps a Refused filter beside Travelling, Drafts and All, on a control that holds four', async () => {
    const list = await read('../../../../app/sales/orders/index.tsx')
    const strings = await read('../strings.ts')

    // Four views, so the three-slot <Segments> is gone: a fourth option there is dropped in silence.
    expect(list).not.toMatch(/<Segments\b/)
    expect(list).toMatch(/<Chips\b/)
    expect(list).toMatch(/'refused'/)
    // The filter is the server's own fact, never a match on the text of a free-text column.
    expect(list).toMatch(/order\.refused_at\s*!==\s*null/)
    expect(list).not.toMatch(/approval_rejected/)
    expect(strings).toContain("'s6.viewRefused': 'Refused'")
  })
})
