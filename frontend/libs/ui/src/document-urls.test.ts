/**
 * DOS-057 / DOS-099: a signed document URL comes back SERVICE-RELATIVE on the local storage driver
 * (`/storage/tenant/…?expires=…&signature=…`, `backend/libs/core/src/platform/object-storage.ts`). A
 * browser resolves that against the APP's origin, which answers the app's own HTML shell, and a phone
 * refuses it outright ("URI is not absolute"). So every app runs it through its own `absoluteUrl()`
 * (`src/config.ts`) before handing it to `documents.open`, `documents.print` or `documents.share`.
 *
 * The apps have no test runner of their own, so the rule is pinned here by READING their sources, the
 * way `parity.test.ts` pins the kit. It is a file-level check: the argument must be an inline
 * `absoluteUrl(…)` call, or an identifier the same file assigns from `absoluteUrl(`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
/** `frontend/`, three levels up from `frontend/libs/ui/src`. */
const frontend = join(here, '..', '..', '..')

interface CallSite {
  file: string
  line: number
  call: string
  absolutised: boolean
}

function sourcesOf(app: string): string[] {
  const files: string[] = []
  for (const dir of ['app', 'src']) {
    const root = join(frontend, app, dir)
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
      if (/\.tsx?$/.test(entry)) files.push(join(root, entry))
    }
  }
  return files
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function callSites(): CallSite[] {
  const apps = readdirSync(frontend).filter(
    (name) => name.endsWith('-app') && statSync(join(frontend, name)).isDirectory(),
  )
  const sites: CallSite[] = []
  for (const app of apps) {
    for (const file of sourcesOf(app)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/documents\.(open|print|share)\(\s*([^,)]*)/g)) {
        const arg = (match[2] ?? '').trim()
        const assignedFromAbsoluteUrl =
          /^[A-Za-z_$][\w$]*$/.test(arg) &&
          new RegExp(`\\b${escapeRegExp(arg)}\\s*=\\s*absoluteUrl\\(`).test(source)
        sites.push({
          file: relative(frontend, file),
          line: source.slice(0, match.index).split('\n').length,
          call: `documents.${match[1] ?? ''}(${arg})`,
          absolutised: arg.startsWith('absoluteUrl(') || assignedFromAbsoluteUrl,
        })
      }
    }
  }
  return sites
}

describe('signed document URLs reach the platform absolute', () => {
  const sites = callSites()

  it('finds the call sites it is meant to guard', () => {
    // A regex that silently matched nothing would pass the rule below.
    expect(sites.length).toBeGreaterThan(10)
  })

  it('DOS-057 DOS-099: every signed URL an app hands to documents.open/print/share is absolutised with absoluteUrl()', () => {
    const offenders = sites
      .filter((site) => !site.absolutised)
      .map((site) => `${site.file}:${String(site.line)} ${site.call}`)
    expect(offenders).toEqual([])
  })
})
