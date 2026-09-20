/**
 * DOS-019 — the Today heading and the rail badge must count the same live rows.
 *
 * O1 read `owner_summary.pendingApprovals` in both places (`app/index.tsx:282`,
 * `app/_layout.tsx:286`). That figure is written by the worker every 15 minutes and counts approvals
 * only, so it announced "Needs you (5)" over a panel listing six rows, and after two decisions —
 * worker stopped, cache invalidated — both the heading and the badge still said 5.
 *
 * Both now read the two live lists the Approvals screen decides from, under the SAME query keys, so
 * one request serves both and the decision's own `invalidates: [['approvals'], ['bargains']]`
 * refreshes the pair. No contract changed and `rollup.ts` is untouched: the rollup is still the right
 * source for the money tiles, which is why the dashboard read stays for the connection strip.
 *
 * Read as SOURCE, like `dos-155-last-gate.guard.test.ts`: importing a screen in Node pulls in
 * `react-native` and `expo-router`, which resolve only under Metro.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'

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

const catalogue: Readonly<Record<string, string>> = strings

describe('O1 Today: the count of decisions waiting', () => {
  it('DOS-019: the heading counts the live rows, not the 15-minute rollup', async () => {
    const code = withoutComments(await read('../../app/index.tsx'))

    expect(code).toMatch(/pendingDecisions\(/)
    // The rollup's own approval count is no longer stated anywhere on this screen.
    expect(code).not.toMatch(/pendingApprovals/)
    // A bound is printed as a bound.
    expect(code).toMatch(/o1\.needsYouAtLeast/)
    expect(catalogue['o1.needsYouAtLeast']).toBe('Needs you ({count}+)')
  })

  it('DOS-019: the rail badge counts the same rows, under the same query keys', async () => {
    const layout = withoutComments(await read('../../app/_layout.tsx'))
    const today = withoutComments(await read('../../app/index.tsx'))

    expect(layout).toMatch(/pendingDecisions\(/)
    expect(layout).not.toMatch(/pendingApprovals/)
    // The reads the badge counts are the reads the panel lists.
    for (const key of [
      "\\['approvals', 'pending', 'top'\\]",
      "\\['bargains', 'requested', 'top'\\]",
    ]) {
      expect(layout).toMatch(new RegExp(key))
      expect(today).toMatch(new RegExp(key))
    }
    // The rollup stays where it is still the truth: the connection strip's "updated at".
    expect(layout).toMatch(/reporting\.dashboard\.owner/)
    // A badge the signed-in role may not read is never requested.
    expect(layout).toMatch(/permissionFor\('orders\.approvals\.list'\)/)
    expect(layout).toMatch(/permissionFor\('pricing\.bargains\.list'\)/)
  })
})
