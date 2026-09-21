/**
 * docs/31 §6.4 — the two things the merge newly makes POSSIBLE, and therefore has to forbid (R9).
 *
 * With six apps, a sales screen could not reach the owner app's files or the owner service: there was
 * no import path to one and no URL for the other. One project and one origin take both walls away in
 * the same commit, and neither ESLint nor the type checker replaces them — `../../owner/lib/words`
 * resolves, `/owner/orders` is a real route, and `GROUPS.owner.port` is a real number. So the walls are
 * re-stated here, as the acceptance half of docs/29 §3: a group reaches its own tree, its own base and
 * its own service, and nothing else.
 *
 * (a) NO GROUP REACHES ANOTHER. No file under `app/<g>/**` or `src/groups/<g>/**` imports from another
 *     group, and no route literal in either names a path outside `/<g>`. The four PRE-ELECTION routes
 *     are exempt — `/`, `/welcome`, `/sign-in`, `/change-password` belong to the install, not to a
 *     group, and an account menu inside a group pushes `/change-password` by name.
 *
 *     Reading another group's file as TEXT is not reaching it: `dos-011-receipt-settles`,
 *     `dos-093-new-shop` and `dos-179-keep-words` compare two groups' screens on purpose (docs/31
 *     §6.5) and say so in their own headers. They open a path; they import nothing. This guard is
 *     about the import graph and the router, which is what a shipped bundle is made of.
 *
 * (b) ONE SERVICE PER GROUP. A group's tree names `GROUPS.<g>` and no other key, and calls `serviceFor`
 *     not at all. The service table is the install's, not a screen's: a group that could read another
 *     group's row could send a driver's call to owner-service, which answers 403 — or, for a signed URL,
 *     404 with nothing on screen at all (docs/31 R2).
 *
 * DEVIATION, RECORDED. §6.4(b) as written says `serviceFor` is called "only from `src/api.ts`". The
 * tree built to §1.4 calls it from `src/config.ts` as well, because §1.4 puts `apiUrlFor(group)` and
 * `absoluteUrl(group, url)` there — the two sentences of the plan disagree, and the assemble lane
 * followed §1.4. What is load-bearing in §6.4(b) is that NO GROUP picks a service, and that is pinned
 * exactly. The two install-level files that may are named below, so a third cannot appear quietly.
 *
 * Read as source: a screen pulls in `react-native` through the kit's native entry, which only Metro
 * resolves.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const project = join(here, '..', '..', '..', 'dos-app')

const GROUPS: readonly string[] = ['owner', 'manager', 'sales', 'warehouse', 'delivery', 'retailer']

/** docs/31 §6.4(a): the routes that belong to the INSTALL and stand before anybody has a group. */
const PRE_ELECTION: readonly string[] = ['/', '/welcome', '/sign-in', '/change-password']

/** The only two files that may name the service table (see DEVIATION above). */
const MAY_CALL_SERVICE_FOR: readonly string[] = ['src/api.ts', 'src/config.ts']

interface Finding {
  readonly group: string
  readonly file: string
  readonly wrong: string
}

/** Every `.ts`/`.tsx` under a directory, as a path relative to `dos-app/`. */
function filesUnder(relativeDir: string): string[] {
  const root = join(project, relativeDir)
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(next)
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(relative(project, next))
      }
    }
  }
  walk(root)
  return out.sort()
}

/** Both trees a group owns: its routes and its own source. */
function treeOf(group: string): string[] {
  return [...filesUnder(join('app', group)), ...filesUnder(join('src', 'groups', group))]
}

/** A comment may name another group while explaining why it must not be reached. Read the code only. */
function code(file: string): string {
  return readFileSync(join(project, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** Every module specifier, static and dynamic. The lookbehind keeps `textColumn('from', …)` out. */
function specifiers(source: string): string[] {
  const found: string[] = []
  for (const pattern of [
    /(?<!['"`])\bfrom\s*'([^'\n]+)'/g,
    /^\s*import\s*'([^'\n]+)'/gm,
    /\bimport\s*\(\s*'([^'\n]+)'\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) found.push(match[1] ?? '')
  }
  return found
}

/** The first segment of a `/…` path: `/owner/orders` → `owner`, `/` → ``. */
function firstSegment(path: string): string {
  return path.split('/')[1] ?? ''
}

describe('docs/31 §6.4(a) no group reaches another group', () => {
  it('every group has a tree to check', () => {
    for (const group of GROUPS) expect(treeOf(group).length).toBeGreaterThan(0)
  })

  it('imports nothing out of another group’s routes or source', () => {
    const findings: Finding[] = []
    for (const group of GROUPS) {
      for (const file of treeOf(group)) {
        for (const specifier of specifiers(code(file))) {
          if (!specifier.startsWith('.')) continue
          const target = relative(project, resolve(join(project, dirname(file)), specifier))
          const segments = target.split('/')
          const other =
            segments[0] === 'app' && GROUPS.includes(segments[1] ?? '')
              ? segments[1]
              : segments[0] === 'src' && segments[1] === 'groups'
                ? segments[2]
                : undefined
          if (other !== undefined && other !== group) {
            findings.push({ group, file, wrong: `imports ${specifier} — that is ${other}'s` })
          }
        }
      }
    }
    expect(findings).toEqual([])
  })

  it('writes no route literal that leaves its own group', () => {
    const findings: Finding[] = []
    for (const group of GROUPS) {
      const others = GROUPS.filter((name) => name !== group)
      for (const file of treeOf(group)) {
        for (const match of code(file).matchAll(/['"`](\/[A-Za-z0-9_[\]/.-]*)/g)) {
          const path = match[1] ?? ''
          if (PRE_ELECTION.includes(path)) continue
          if (others.includes(firstSegment(path))) {
            findings.push({ group, file, wrong: `route literal ${path}` })
          }
        }
      }
    }
    expect(findings).toEqual([])
  })

  /**
   * And the exemption is only ever those four. A fifth root route added without a decision would be a
   * place every group may push to — which is how one group starts rendering another's screen again.
   */
  it('the pre-election exemption is exactly the four routes docs/31 §6.4(a) names', () => {
    expect([...PRE_ELECTION].sort()).toEqual(['/', '/change-password', '/sign-in', '/welcome'])
  })
})

describe('docs/31 §6.4(b) one service per group', () => {
  it('a group names its own row of GROUPS and no other', () => {
    const findings: Finding[] = []
    for (const group of GROUPS) {
      for (const file of treeOf(group)) {
        const source = code(file)
        /*
         * `GROUPS[GROUP]` is how a layout reads its own row without writing the name twice, so an
         * identifier index is followed to its `const GROUP = '…'` in the same file. Anything else —
         * a computed key, a key from a prop — is refused: it is a row this file cannot be read to
         * have chosen.
         */
        for (const match of source.matchAll(/\bGROUPS(?:\.([a-zA-Z_$][\w$]*)|\[([^\]]+)\])/g)) {
          const dotted = match[1]
          if (dotted !== undefined) {
            if (dotted !== group) findings.push({ group, file, wrong: `GROUPS.${dotted}` })
            continue
          }
          const key = (match[2] ?? '').trim()
          const quoted = /^'([^']*)'$/.exec(key)?.[1]
          if (quoted !== undefined) {
            if (quoted !== group) findings.push({ group, file, wrong: `GROUPS['${quoted}']` })
            continue
          }
          const bound = new RegExp(`\\bconst ${key}\\s*=\\s*'([^']+)'`).exec(source)?.[1]
          if (bound !== group) {
            findings.push({ group, file, wrong: `GROUPS[${key}] — ${key} is not this group` })
          }
        }
      }
    }
    expect(findings).toEqual([])
  })

  it('no group calls serviceFor: the service table belongs to the install', () => {
    const findings: Finding[] = []
    for (const group of GROUPS) {
      for (const file of treeOf(group)) {
        if (code(file).includes('serviceFor')) {
          findings.push({ group, file, wrong: 'calls serviceFor' })
        }
      }
    }
    expect(findings).toEqual([])
  })

  it('and only the two install-level files do', () => {
    const callers = [...filesUnder('src'), ...filesUnder('app')].filter(
      (file) => !/\.test\.tsx?$/.test(file) && code(file).includes('serviceFor('),
    )
    expect(callers.sort()).toEqual([...MAY_CALL_SERVICE_FOR].sort())
  })
})
