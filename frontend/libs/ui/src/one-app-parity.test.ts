/**
 * docs/31 §6.2 — the kit's parity guarantee, extended to the one app's route tree.
 *
 * `parity.test.ts` next door pins the two halves of `@dos/ui`: every export exists on the web side and
 * the native side, and every `platform` module ships a `.web.ts`/`.native.ts` pair. What it cannot say
 * is anything about an APP — it names none, and after the merge there is only one left to name.
 *
 * This is that half. One codebase serves the website, Android and iOS only if every file under
 * `dos-app/app/**` is written against the kit's CONTRACT and never against a renderer or a package
 * that exists on one platform. ESLint already refuses `react-native`, `react-dom`, `@dos/ui/web` and
 * `@dos/ui/native` by name (`@dos/config/eslint/app`), which is a denylist: it stops the four things
 * somebody thought of. What follows is the other direction — an ALLOWLIST. A screen may import the
 * kit, the client, the offline package, the two dependency-free libraries, the router, React, and its
 * own `src/`. Anything else has to be argued for here first, in the open, where the argument is
 * whether it resolves the same on all three targets.
 *
 * Read as source rather than by resolving the import graph: a screen pulls in `react-native` through
 * `@dos/ui`'s native entry, which only Metro can resolve.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = join(here, '..', '..', '..')
const app = join(frontend, 'dos-app', 'app')

/**
 * What a route file may import.
 *
 * `@dos/ui` is the component contract; `@dos/ui/platform` is the one door to anything platform-shaped
 * (camera, GPS, print, files, storage, clipboard), each behind a `.web.ts`/`.native.ts` pair. The
 * client, the offline package, the contracts and the domain library are pure TypeScript over the wire
 * shapes. `expo-router` and `react` are the frame every universal app is written in.
 */
const ALLOWED: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'expo-router',
  '@dos/ui',
  '@dos/ui/platform',
  '@dos/api-client',
  '@dos/api-client/react',
  '@dos/offline',
  '@dos/offline/react',
  '@dos/contracts',
  '@dos/domain',
  /*
   * `expo-status-bar` is a two-line shim with a real web build (a no-op there, a native module on a
   * phone), and the root layout is the only file that may use it: docs/31 §1.3 lifts
   * `<StatusBar style="dark" />` into the root so Android stops painting a white clock over #F2F2EF.
   */
  'expo-status-bar',
]

/**
 * The one package in `app/**` that is neither the kit nor the frame, and why it is tolerated rather
 * than blessed.
 *
 * `@react-native-community/netinfo` came with `delivery-app/app/_layout.tsx` and moved into
 * `app/delivery/_layout.tsx` unchanged (docs/31 §8: screens MOVE, they do not change). It does ship a
 * web build, so parity holds today — but a reachability question answered by a third party is exactly
 * what `@dos/ui/platform` exists to own, and this is where it belongs. Recorded, not fixed, in the
 * same spirit as docs/31 §6.6's duplicated helpers: a move plus a refactor makes every failure
 * ambiguous. The exemption is pinned to ONE file so it cannot spread while nobody is looking.
 */
const TOLERATED: Readonly<Record<string, readonly string[]>> = {
  'delivery/_layout.tsx': ['@react-native-community/netinfo'],
}

/** Every `.ts`/`.tsx` under `dos-app/app`, as a path relative to it. */
function routeFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(next)
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(relative(app, next))
      }
    }
  }
  walk(app)
  return out.sort()
}

/** Every module specifier a file imports, static and dynamic, comments already gone. */
function specifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const found: string[] = []
  /*
   * Two things a naive `from '…'` gets wrong, both of them real in this tree:
   *
   * `[^'\n]` and not `[^']` — an apostrophe inside a sentence a screen renders would otherwise let one
   * match run from a `from '` in prose to the next quote several screens' worth of text later.
   *
   * And the lookbehind — `textColumn('from', t('m15.validFrom'), …)` is a COLUMN KEY in the manager's
   * price register and three other screens, and its last four characters are the keyword. Requiring
   * that the character before `from` is not itself a quote is what tells the keyword from the word.
   */
  for (const pattern of [
    /(?<!['"`])\bfrom\s*'([^'\n]+)'/g,
    /^\s*import\s*'([^'\n]+)'/gm,
    /\bimport\s*\(\s*'([^'\n]+)'\s*\)/g,
    /\brequire\s*\(\s*'([^'\n]+)'\s*\)/g,
  ]) {
    for (const match of code.matchAll(pattern)) found.push(match[1] ?? '')
  }
  return found
}

describe('docs/31 §6.2 one app, three targets: every route file is written against the kit', () => {
  const files = routeFiles()

  it('there is a route tree to check at all', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  /**
   * And the reader actually reads. An allowlist that silently extracts nothing passes forever; this is
   * the assertion that fails the day the extractor stops seeing an import statement.
   */
  it('every route file names at least one module, so an empty read cannot pass as a clean one', () => {
    const silent = files.filter(
      (file) => specifiers(readFileSync(join(app, file), 'utf8')).length === 0,
    )
    expect(silent).toEqual([])
  })

  it('imports only the kit, the frame, and this app’s own src/ — nothing platform-shaped', () => {
    const offenders: { file: string; imported: string }[] = []
    for (const file of files) {
      const allowed = [...ALLOWED, ...(TOLERATED[file] ?? [])]
      for (const specifier of specifiers(readFileSync(join(app, file), 'utf8'))) {
        // The app's own files: `../../src/groups/sales/lib/ui`, `./_layout`.
        if (specifier.startsWith('.')) continue
        if (allowed.includes(specifier)) continue
        offenders.push({ file, imported: specifier })
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * The denylist half, asserted here as well as in ESLint. A lint rule is switched off with a comment
   * on the line above it; this is not.
   */
  it('names no renderer and no pinned half of the kit, in any file', () => {
    const banned = [
      'react-native',
      'react-native-web',
      'react-dom',
      'react-native-svg',
      '@dos/ui/web',
      '@dos/ui/native',
    ]
    const offenders: { file: string; imported: string }[] = []
    for (const file of files) {
      for (const specifier of specifiers(readFileSync(join(app, file), 'utf8'))) {
        if (banned.includes(specifier) || banned.some((name) => specifier.startsWith(`${name}/`))) {
          offenders.push({ file, imported: specifier })
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * And a route reaches its own `src/`, never another project's. A `../../../libs/ui/src/…` or a
   * `../../owner-app/…` compiles under Metro and takes the file outside the bundle graph the three
   * targets share.
   */
  it('reaches out of dos-app/ for nothing: every relative import stays inside this project', () => {
    const offenders: { file: string; imported: string }[] = []
    for (const file of files) {
      const from = dirname(join(app, file))
      for (const specifier of specifiers(readFileSync(join(app, file), 'utf8'))) {
        if (!specifier.startsWith('.')) continue
        const resolved = relative(join(frontend, 'dos-app'), join(from, specifier))
        if (resolved.startsWith('..')) offenders.push({ file, imported: specifier })
      }
    }
    expect(offenders).toEqual([])
  })
})
