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

/**
 * DOS-128 (web, 390×844) / DOS-147 (Android): with the "N cs available" chip shown, the trailing
 * `<Row>` beside the growing name column carried BOTH the chip and "Add a case", 142–166 px plus
 * 115 px on a 356 px row — leaving 32–56 px for the item name. Below desk width the chip must move
 * onto the meta line ("Campa · 24 pc case · 18 cs") so the trailing row holds only the button.
 */
describe('S3 order entry: SuggestionRow keeps the name column wide below desk width (DOS-128, DOS-147)', () => {
  it('reads the viewport and, off desk, folds availability into the meta line instead of a second trailing chip', async () => {
    const code = withoutComments(suggestionRowSource(await readScreen()))

    // Below the desk breakpoint the row must know it — a fixed layout cannot fix a width regression.
    expect(code).toContain('useViewport()')

    // The availability figure feeds the meta line ("brand · N pc case · N cs") off desk...
    expect(code).toMatch(/metaParts\.push\(availabilityLabel\)/)

    // ...so the trailing StatusChip is desk-only, not shown beside "Add a case" on every viewport.
    expect(code).toMatch(/!phone[\s\S]{0,80}<StatusChip/)
  })
})

/**
 * DOS-161 (iOS, 267-pt scroll window): the native `Screen` pins its header (context, title, chips)
 * and `bottomBar` around the `ScrollView` (kit `native/layout.tsx`, out of bounds here). With that
 * fixed, the app-level fix is to shrink what is pinned: off desk the header carries only the shop
 * name and the title (the status chips move into the scrolling body) and the footer becomes a
 * single row instead of a 3-line "Items · money · before GST" stack.
 */
describe('S3 order entry: the phone footer is one compact row and header chips scroll (DOS-161)', () => {
  it('keeps the desk footer\'s 3-line stack but gives the phone one compact row, decided before "before GST" is reached', async () => {
    const code = withoutComments(await readScreen())

    const bottomBarStart = code.indexOf('bottomBar={')
    expect(bottomBarStart, 'Screen has no bottomBar prop').toBeGreaterThan(-1)
    const beforeGstAt = code.indexOf("t('s3.beforeGst')", bottomBarStart)
    expect(beforeGstAt, 's3.beforeGst is no longer rendered in the bottom bar').toBeGreaterThan(-1)
    const bottomBarBlock = code.slice(bottomBarStart, beforeGstAt)

    // The phone/desk split must be decided before the 3-line desk stack (with "before GST") is reached.
    expect(bottomBarBlock).toMatch(/phone\s*\?/)
    expect(bottomBarBlock).toContain("t('s3.summaryCompact'")
  })

  it('moves the header status chips into the scroll content off desk, instead of the pinned header', async () => {
    const code = withoutComments(await readScreen())

    const chipsAt = code.indexOf('chips={')
    expect(chipsAt, 'Screen has no chips prop').toBeGreaterThan(-1)
    expect(code.slice(chipsAt, chipsAt + 40)).toMatch(/chips=\{phone \? undefined/)

    // The same chip row is declared once and used twice: the (now conditional) header prop, and
    // again inside the scrolling children — never duplicated markup.
    const occurrences = code.split('orderChips').length - 1
    expect(occurrences).toBeGreaterThanOrEqual(3)
  })
})
