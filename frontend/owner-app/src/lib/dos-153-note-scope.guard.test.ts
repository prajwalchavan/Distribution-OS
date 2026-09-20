/**
 * DOS-153 — a decision note must never follow the owner to the next request.
 *
 * On O3 Approvals the note box lives on the panel, and its state was cleared in exactly one place:
 * after a decision went through. Closing the panel without deciding left the text behind, so opening
 * another rep's bargain showed "QA android DOS-020 approve fixture bargain" already typed in, and
 * approving or rejecting THAT request sent it — to the person who asked, who reads it ("the person
 * who asked will read it"). An ESC-closed attempt left partial text that the next tap inserted into,
 * garbling the note further.
 *
 * So the note is cleared wherever the request it was typed for stops being the one on screen: the
 * Sheet closing, and a different row being chosen — by tap or by the `j`/`k` keys, which are the
 * same journey.
 *
 * Read as SOURCE, like `dos-012-refusal.guard.test.ts`: importing a screen in Node pulls in
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

/** The body of `const <name> = ( … ): void => { … }`, to its matching brace. */
function bodyOf(code: string, name: string): string {
  const head = new RegExp(`const ${name} = \\([^)]*\\)[^{]*\\{`).exec(code)
  expect(head, `approvals.tsx has no ${name}`).not.toBeNull()
  const from = (head?.index ?? 0) + (head?.[0].length ?? 0)
  let depth = 1
  for (let i = from; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(from, i)
    }
  }
  throw new Error(`${name} is never closed`)
}

describe('O3 Approvals: the note belongs to one request', () => {
  it('DOS-153: closing the panel without deciding clears the note', async () => {
    const code = withoutComments(await read('../../app/approvals.tsx'))

    const close = bodyOf(code, 'closePanel')
    expect(close).toMatch(/setSelected\(null\)/)
    expect(close, 'the panel closes with the note still typed').toMatch(/setNote\(''\)/)

    // The Sheet that carries the note box closes THROUGH it — and so does Esc.
    const sheet = /<Sheet[\s\S]*?testID="approval-panel"/.exec(code)?.[0] ?? ''
    expect(sheet.length, 'the approval panel is gone').toBeGreaterThan(0)
    expect(sheet).toMatch(/onClose=\{closePanel\}/)
    expect(code).toMatch(/Escape: \(\) => \{[\s\S]*?closePanel\(\)/)
  })

  it('DOS-153: opening a different request clears the note, by tap and by key', async () => {
    const code = withoutComments(await read('../../app/approvals.tsx'))

    const open = bodyOf(code, 'openRow')
    // A different request, a fresh box; re-choosing the SAME row must not wipe what is being typed.
    expect(open).toMatch(/!==\s*selected/)
    expect(open, 'choosing another request keeps the last note').toMatch(/setNote\(''\)/)
    expect(open).toMatch(/setSelected\(/)

    // Both ways into a row go through it: the register's tap and the j/k keys.
    // Both spellings: the hook's object property and the register's JSX prop.
    const selects = [...code.matchAll(/onSelect[=:]\s*\{?\s*\(row\) => \{([^}]*)\}/g)].map(
      (m) => m[1] ?? '',
    )
    expect(selects.length, 'no onSelect on this screen').toBeGreaterThan(1)
    for (const body of selects) expect(body).toMatch(/openRow\(row\.id\)/)
  })
})
