/**
 * The two parity guarantees the universal-app decision rests on (docs/08 section 0, docs/22 section 8
 * of 2026-09-06):
 *
 * 1. Every name `@dos/ui/web` exports, `@dos/ui/native` exports too, and the other way round.
 * 2. Every `@dos/ui/platform` capability exists as a `.web.ts` / `.native.ts` PAIR exporting the same
 *    names.
 *
 * Both are checked by reading the barrel files rather than by importing them, on purpose: importing
 * `./native/index.js` in Node would pull in `react-native`, which does not resolve outside Metro, and
 * a test that cannot run is not a guarantee. The compiler covers the other half — every component in
 * both renderers is typed against the ONE contract in `src/types.ts`, so a name that matches with the
 * wrong props fails `pnpm typecheck`, and `parity.types.ts` binds the new primitives explicitly.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Every name a barrel re-exports, value and type alike.
 *
 * `export type * from '../types.js'` is deliberately ignored: it is the SAME module on both sides, so
 * it can never differ, and expanding it would need a parser rather than a reader.
 */
function exportedNames(file: string): Set<string> {
  const source = readFileSync(file, 'utf8')
  const names = new Set<string>()

  // export { A, B as C, type D } from '...'   and   export { A, B }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    const body = match[1] ?? ''
    for (const raw of body.split(',')) {
      const part = raw.trim().replace(/^type\s+/, '')
      if (part === '') continue
      const alias = /\s+as\s+(\w+)$/.exec(part)
      names.add(alias ? (alias[1] ?? '') : part)
    }
  }
  // export const x / function x / class x / type x / interface x
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:const|let|function|class|type|interface|enum)\s+(\w+)/gm,
  )) {
    names.add(match[1] ?? '')
  }
  names.delete('')
  return names
}

/**
 * The only exports allowed to exist on one side.
 *
 * React Native has no cascade, so the stylesheet generator has no native counterpart and never will;
 * it is used by the web `<ThemeProvider>` and by the gallery, never by a screen. The two provider
 * prop types differ by one web-only field (`className`). Everything else must be a pair — that is
 * what makes one screen file serve three targets.
 */
const RENDERER_PRIVATE = {
  web: new Set([
    'BASE_CSS',
    'FONT_CSS',
    'buildStylesheet',
    'buildThemeVars',
    'cssVar',
    'cssVarName',
    'WebThemeProviderProps',
  ]),
  native: new Set(['NativeThemeProviderProps']),
}

describe('renderer parity: @dos/ui/web and @dos/ui/native', () => {
  const web = exportedNames(join(here, 'web', 'index.ts'))
  const native = exportedNames(join(here, 'native', 'index.ts'))

  it('exports something worth comparing', () => {
    // A regex that silently matched nothing would pass every assertion below.
    expect(web.size).toBeGreaterThan(30)
    expect(native.size).toBeGreaterThan(30)
  })

  it('has a native sibling for every web export', () => {
    const missing = [...web]
      .filter((name) => !native.has(name) && !RENDERER_PRIVATE.web.has(name))
      .sort()
    expect(missing).toEqual([])
  })

  it('has a web sibling for every native export', () => {
    const missing = [...native]
      .filter((name) => !web.has(name) && !RENDERER_PRIVATE.native.has(name))
      .sort()
    expect(missing).toEqual([])
  })

  it('keeps the renderer-private list honest: every name on it is really exported once', () => {
    for (const name of RENDERER_PRIVATE.web) {
      expect(web, `${name} is on the web-private list but web does not export it`).toContain(name)
      expect(native, `${name} is on the web-private list but native exports it too`).not.toContain(
        name,
      )
    }
    for (const name of RENDERER_PRIVATE.native) {
      expect(native).toContain(name)
      expect(web).not.toContain(name)
    }
  })

  it('exports the ten layout primitives of docs/08 §0 on both renderers', () => {
    for (const name of [
      'Screen',
      'Box',
      'Stack',
      'Row',
      'Scroll',
      'List',
      'Pressable',
      'Img',
      'Link',
      'Txt',
    ]) {
      expect(web, `web is missing <${name}>`).toContain(name)
      expect(native, `native is missing <${name}>`).toContain(name)
    }
  })

  it('exports the shell and the viewport hook on both renderers', () => {
    for (const name of ['AppShell', 'TenantSwitcher', 'useViewport']) {
      expect(web, `web is missing ${name}`).toContain(name)
      expect(native, `native is missing ${name}`).toContain(name)
    }
  })
})

describe('platform parity: @dos/ui/platform', () => {
  const dir = join(here, 'platform')
  const files = readdirSync(dir)
  const webFiles = files.filter((f) => f.endsWith('.web.ts') && f !== 'index.web.ts')
  const nativeFiles = files.filter((f) => f.endsWith('.native.ts') && f !== 'index.native.ts')

  it('ships every capability as a PAIR, and only the ones named here', () => {
    const capabilities = webFiles.map((f) => f.replace('.web.ts', '')).sort()
    expect(capabilities).toEqual([
      'camera',
      'crypto',
      'documents',
      'files',
      'haptics',
      'location',
      'share',
      'storage',
    ])
    expect(nativeFiles.map((f) => f.replace('.native.ts', '')).sort()).toEqual(capabilities)
  })

  it.each(webFiles.map((f) => f.replace('.web.ts', '')))(
    '%s exports the same names on both platforms',
    (capability) => {
      const web = exportedNames(join(dir, `${capability}.web.ts`))
      const native = exportedNames(join(dir, `${capability}.native.ts`))
      expect(web.size).toBeGreaterThan(0)
      expect([...web].sort()).toEqual([...native].sort())
    },
  )

  it('the two barrels export the same names', () => {
    const web = exportedNames(join(dir, 'index.web.ts'))
    const native = exportedNames(join(dir, 'index.native.ts'))
    expect([...web].sort()).toEqual([...native].sort())
    expect(web).toContain('platform')
  })
})

describe('entry parity: @dos/ui', () => {
  it('both entries re-export the shared half and their own renderer', () => {
    const web = readFileSync(join(here, 'index.web.ts'), 'utf8')
    const native = readFileSync(join(here, 'index.native.ts'), 'utf8')
    expect(web).toContain("export * from './shared.js'")
    expect(web).toContain("export * from './web/index.js'")
    expect(native).toContain("export * from './shared.js'")
    expect(native).toContain("export * from './native/index.js'")
  })
})
