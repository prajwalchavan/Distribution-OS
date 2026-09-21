/**
 * S-108 — M7 Load-out: closing the load-sheet panel cancels a challan print still waiting.
 *
 * "Print the challan" (DOS-026) polls `warehouse.challans.pdf` for up to ~60 s while the worker renders
 * the PDF, and `challanToken` is what drops a late answer: `openChallan` starts every poll by taking a
 * fresh token, and each answer compares it before touching state. Closing the panel cleared
 * `challanUrl` and the note but never moved the token on, so a poll still running for sheet A stayed
 * current: open sheet B inside that minute and A's answer said 'Challan ready' on B, and B's Print then
 * opened A's challan — the wrong document, on a modal panel the manager had no reason to doubt.
 *
 * The screen imports `react-native`/`expo-router` transitively and cannot be rendered in Node, so — like
 * `fulfilment-queue.test.ts` and `review-desk.test.ts` — this reads the source rather than mounting it.
 * `@types/node` is deliberately absent from an app (`env.d.ts`), so the two Node functions come in
 * through a non-literal specifier and their shapes are named here. Comments are stripped and every
 * pattern tolerates whitespace, so a comment naming the token, or `pnpm format` reflowing the JSX,
 * cannot change the verdict.
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

/** The load-out screen's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../../../app/manager/fulfilment/load-out.tsx', import.meta.url)),
    'utf8',
  )
}

/** Block and line comments removed, so a comment that names the token is not counted. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * The `{ … }` block whose opening brace ends `match`, braces balanced — a handler's whole body, however
 * many blocks it grows, rather than the text up to its first closing brace.
 */
function blockAfter(code: string, match: RegExpMatchArray | null): string {
  if (match?.index === undefined) return ''
  const open = match.index + match[0].length - 1
  let depth = 0
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(open, i + 1)
    }
  }
  return ''
}

/** The props of the `<Sheet …>` carrying `testID="…"`: the text from `<Sheet` up to that testID. */
function sheetProps(code: string, testId: string): string {
  const at = code.search(new RegExp(`testID\\s*=\\s*\\{?\\s*["'\`]${testId}["'\`]`))
  if (at < 0) return ''
  const start = code.lastIndexOf('<Sheet', at)
  return start < 0 ? '' : code.slice(start, at)
}

/** `++challanToken.current`, `challanToken.current++` or `challanToken.current += 1`. */
const BUMPS_TOKEN =
  /\+\+\s*challanToken\s*\.\s*current\b|\bchallanToken\s*\.\s*current\s*(?:\+\+|\+=\s*1\b)/
const OPEN_CHALLAN = /const\s+openChallan\s*=\s*\([^)]*\)\s*(?::\s*void\s*)?=>\s*\{/
const STALE_CHECK = /\bchallanToken\s*\.\s*current\s*[!=]==\s*token\b/g
const ON_CLOSE = /\bonClose\s*=\s*\{\s*\(\s*\)\s*=>\s*\{/
const CLEARS_URL = /\bsetChallanUrl\s*\(\s*null\s*\)/

describe('S-108: closing the load-sheet panel cancels a challan print still waiting', () => {
  it("S-108: the load-sheet panel's onClose moves challanToken on, the same invalidation openChallan starts every poll with, so sheet A's poll never answers on sheet B", async () => {
    const code = withoutComments(await readScreen())

    // What the close relies on: a poll takes a fresh token, and its answer and its failure both drop
    // themselves once that token is no longer the current one.
    const poll = blockAfter(code, code.match(OPEN_CHALLAN))
    expect(poll, 'const openChallan = (…) => { … } not found in fulfilment/load-out.tsx').not.toBe(
      '',
    )
    expect(poll, 'openChallan must start its poll by bumping challanToken.current').toMatch(
      BUMPS_TOKEN,
    )
    expect(
      (poll.match(STALE_CHECK) ?? []).length,
      "both the poll's answer and its failure must compare challanToken.current with their own token",
    ).toBeGreaterThanOrEqual(2)

    // The close itself: it still clears the URL kept for Print, and it moves the token on.
    const props = sheetProps(code, 'loadsheet-panel')
    expect(
      props,
      '<Sheet … testID="loadsheet-panel"> not found in fulfilment/load-out.tsx',
    ).not.toBe('')
    const onClose = blockAfter(props, props.match(ON_CLOSE))
    expect(onClose, 'the load-sheet panel has no onClose={() => { … }} handler').not.toBe('')
    expect(onClose, 'closing the panel must still clear the challan URL kept for Print').toMatch(
      CLEARS_URL,
    )
    expect(
      onClose,
      "S-108: the load-sheet panel's onClose must bump challanToken.current, or a challan poll still running for the sheet just closed answers on the next sheet opened",
    ).toMatch(BUMPS_TOKEN)
  })
})
