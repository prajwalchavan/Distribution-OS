/**
 * S3 order entry on a phone: the catalog row must keep its item name (DOS-077).
 *
 * `SuggestionRow` is a non-wrapping `<Row>` of a growing name column (`<Stack grow>`, flex-basis 0)
 * and a trailing `<Row>` holding the stock chip and the "Add a case" button. A kit `<Button>` fills
 * its parent by default, and on React Native it does that with a `width: '100%'` wrapper, which Yoga
 * resolves against the whole row: the trailing group claimed all of it and the name column was laid
 * out at 0 dp. The Pixel 7 drew a column of anonymous "Add a case" buttons with no name, pack or
 * stock. The web build never showed it (`.dos-btn` is `white-space: nowrap`, so the CSS percentage
 * width resolves to the label), which is why only the phone walk found it.
 *
 * This reads the source rather than rendering it, like `@dos/ui`'s parity spec: importing the screen
 * or the native kit in Node pulls in `react-native` and `expo-router`, which do not resolve outside
 * Metro. It lives under `src/`, not `app/`, because expo-router treats every file in `app/` as a route.
 *
 * `@types/node` is deliberately absent from an app (`env.d.ts`: a screen has no `fs`, and the compiler
 * should say so), and a type reference in any one file would load Node's globals into the whole app
 * program. So the two Node functions this spec needs are imported through a non-literal specifier,
 * which the compiler does not resolve, and their shapes are named here, in the one file that runs in
 * Node.
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

/** The order-entry screen's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL('../app/orders/new.tsx', import.meta.url)), 'utf8')
}

/** The source of `function SuggestionRow(…)`, up to the next top-level interface or function. */
function suggestionRowSource(screen: string): string {
  const start = screen.indexOf('function SuggestionRow(')
  expect(start, 'SuggestionRow is not declared in app/orders/new.tsx').toBeGreaterThan(-1)
  const ends = ['\ninterface ', '\nfunction ']
    .map((marker) => screen.indexOf(marker, start + 1))
    .filter((index) => index !== -1)
  return screen.slice(start, ends.length === 0 ? undefined : Math.min(...ends))
}

/** Block and line comments removed, so a comment that names a `<Button>` is not counted as one. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('S3 order entry: the catalog row on Android and iOS', () => {
  it('DOS-077: the catalog row\'s "Add a case" button sizes to its label (fullWidth={false}), so the growing item-name column keeps its width on Android', async () => {
    const code = withoutComments(suggestionRowSource(await readScreen()))

    // The shape that makes a full-width button collapse its neighbour: a name column that grows from 0.
    expect(code).toContain('<Stack gap={1} grow>')

    const buttons = code.match(/<Button\b[\s\S]*?\/>/g) ?? []
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toMatch(/fullWidth=\{false\}/)
  })
})
