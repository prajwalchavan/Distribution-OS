/**
 * O24 Settings: the view switch must reach all four views (DOS-108).
 *
 * The screen passed FOUR items to `<Segments testID="settings-view">`, and the kit draws two or three
 * (UX-00 §6.10): both renderers slice to three, silently. "Support access" was dropped, so the view
 * behind it — the only place an owner answers a support request — could not be opened on any platform
 * or width. A chip row carries any number of views.
 *
 * This reads the source rather than rendering it, like `sales-app/src/order-entry-layout.test.ts`:
 * importing the screen or the native kit in Node pulls in `react-native` and `expo-router`, which do not
 * resolve outside Metro. It lives under `src/`, not `app/`, because expo-router treats every file in
 * `app/` as a route. The two Node functions it needs come in through non-literal specifiers, because
 * `@types/node` is deliberately absent from an app (`env.d.ts`).
 */
import { describe, expect, it } from 'vitest'

import { SETTINGS_VIEWS } from './lib/support'
import { strings } from './strings'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** The Settings screen's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../../app/owner/settings/index.tsx', import.meta.url)),
    'utf8',
  )
}

/** Block and line comments removed, so a comment that names a `<Segments>` is not counted as one. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The self-closing JSX element whose props carry `testID="<id>"`: its tag and its source. */
function elementWithTestId(code: string, id: string): { tag: string; source: string } {
  const prop = `testID="${id}"`
  const at = code.indexOf(prop)
  expect(at, `no element carries ${prop} in app/owner/settings/index.tsx`).toBeGreaterThan(-1)
  expect(code.indexOf(prop, at + 1), `${prop} is carried twice`).toBe(-1)
  const opens = [...code.slice(0, at).matchAll(/<([A-Z][A-Za-z]*)\b/g)]
  const open = opens[opens.length - 1]
  if (open === undefined) throw new Error(`no JSX element opens before ${prop}`)
  const end = code.indexOf('/>', at)
  return { tag: open[1] ?? '', source: code.slice(open.index, end === -1 ? undefined : end + 2) }
}

describe('O24 Settings: the view switch', () => {
  it('DOS-108: the Settings view switch is a chip row carrying all four views (Business profile, Numbering series, Feature flags, Support access), not a <Segments> that renders three', async () => {
    const code = withoutComments(await readScreen())

    const control = elementWithTestId(code, 'settings-view')
    expect(control.tag).toBe('Chips')
    expect(control.source).toContain('SETTINGS_VIEWS.map(')

    const segments = code.match(/<Segments\b[\s\S]*?\/>/g) ?? []
    expect(segments.filter((element) => element.includes('testID="settings-view"'))).toEqual([])

    expect(SETTINGS_VIEWS.map((entry) => entry.id)).toEqual([
      'business',
      'numbering',
      'flags',
      'support',
    ])
    const catalogue: Readonly<Record<string, string>> = strings
    expect(SETTINGS_VIEWS.map((entry) => catalogue[entry.labelKey])).toEqual([
      'Business profile',
      'Numbering series',
      'Feature flags',
      'Support access',
    ])
  })
})
