/**
 * docs/31 §9 R1 — every route file resolves to a URL of its own.
 *
 * THE BLOCKER THIS ANSWERS. An expo-router group segment — a directory in parentheses — is invisible in
 * the URL, and expo-router does not reject two files that land on the same path: the only duplicate
 * check it ships (`getRoutesCore.js`) rejects duplicate group NAMES in array syntax and nothing else.
 * So with `(owner)/index.tsx` and `(delivery)/index.tsx` in one project, a bare `/` resolves to whichever
 * branch matched first — never to the elected one — and after retirement the website is the only front
 * door left, where every URL is typed or bookmarked or reloaded. The architect settled it (ruling Q1):
 * the role segment is VISIBLE, `app/owner/…` → `/owner/orders`.
 *
 * This is the spec that says the decision was actually carried out, and keeps saying it. It is two
 * assertions over one pure function:
 *
 *   1. over the REAL tree — no two route files resolve to the same path, and no route file hides inside
 *      a parenthesised directory in the first place;
 *   2. over the same tree with the six group segments made invisible again — the counterfactual — where
 *      it must report collisions. A guard that cannot fail is not a guard, and this is the one case
 *      where the failing input is a real tree rather than a fixture somebody invented.
 *
 * WHAT THE COUNTERFACTUAL COUNTS. docs/31 §1.1 measured fourteen colliding paths across the six apps.
 * Over the MERGED tree the same measurement gives thirteen, and the two differences are both the merge:
 * `/sign-in` and `/change-password` were six copies each and are now one file each at the root (§1.2),
 * so they no longer collide with anything; and `/staff`, which owner and manager both claim, is a
 * fourteenth path §1.1's list did not name. The number moved for reasons that are written down.
 */
import { readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..', '..', '..', 'dos-app', 'app')

const GROUPS: readonly string[] = ['owner', 'manager', 'sales', 'warehouse', 'delivery', 'retailer']

/**
 * The URL expo-router gives a file, or `null` for a file that is not a route.
 *
 * `_layout` wraps routes and is none; a `+`-prefixed file is one of the router's own hooks
 * (`+not-found`, `+html`, `+native-intent`); `index` contributes no segment; a parenthesised directory
 * contributes none either — which is the whole of R1.
 */
export function resolveRoute(file: string): string | null {
  const parts = file.split('/')
  const name = (parts.pop() ?? '').replace(/\.tsx?$/, '')
  if (name === '_layout' || name.startsWith('+')) return null
  const segments = parts.filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
  if (name !== 'index') segments.push(name)
  return segments.length === 0 ? '/' : `/${segments.join('/')}`
}

/** Every path claimed by more than one file, with the files that claim it. */
export function collisions(files: readonly string[]): Record<string, string[]> {
  const byPath = new Map<string, string[]>()
  for (const file of files) {
    const path = resolveRoute(file)
    if (path === null) continue
    byPath.set(path, [...(byPath.get(path) ?? []), file])
  }
  const out: Record<string, string[]> = {}
  for (const [path, claimants] of byPath) if (claimants.length > 1) out[path] = claimants
  return out
}

/** Every `.ts`/`.tsx` under `dos-app/app`, relative to it, with `/` separators. */
function routeFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(next)
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(relative(app, next).split('\\').join('/'))
      }
    }
  }
  walk(app)
  return out.sort()
}

describe('docs/31 ruling Q1 the role segment is visible, so every URL resolves to one screen', () => {
  const files = routeFiles()

  it('there is a route tree to check at all', () => {
    expect(files.filter((file) => resolveRoute(file) !== null).length).toBeGreaterThan(100)
  })

  it('no two route files resolve to the same path', () => {
    expect(collisions(files)).toEqual({})
  })

  it('no route hides inside a parenthesised group: the segment a person reads is the segment that routes', () => {
    const hidden = files.filter((file) => /(^|\/)\([^)]+\)\//.test(file))
    expect(hidden).toEqual([])
  })

  it('every group’s screens sit under its own visible base', () => {
    const stray = files
      .filter((file) => GROUPS.includes(file.split('/')[0] ?? ''))
      .filter((file) => {
        const group = file.split('/')[0] ?? ''
        const path = resolveRoute(file)
        return path !== null && path !== `/${group}` && !path.startsWith(`/${group}/`)
      })
    expect(stray).toEqual([])
  })

  /**
   * The counterfactual. Put the six segments back in parentheses — the spelling docs/29 §3 used before
   * the ruling — and the same function has to report the collisions §1.1 measured. If this ever comes
   * back empty, the checker has stopped checking.
   */
  it('reports the collisions the invisible-group spelling would have shipped', () => {
    const invisible = files.map((file) => {
      const parts = file.split('/')
      const first = parts[0] ?? ''
      if (GROUPS.includes(first)) parts[0] = `(${first})`
      return parts.join('/')
    })
    const found = collisions(invisible)
    expect(Object.keys(found).sort()).toEqual([
      '/',
      '/billing',
      '/billing/credit-notes',
      '/bills/[id]',
      '/money',
      '/money/claims',
      '/orders',
      '/orders/[id]',
      '/prices',
      '/settings',
      '/shops',
      '/staff',
      '/stock',
    ])
    // `/` is claimed by all six landing screens plus the install's own elected-role redirect.
    expect(found['/']).toHaveLength(7)
  })
})
