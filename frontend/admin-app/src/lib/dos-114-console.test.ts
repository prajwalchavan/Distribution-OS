/**
 * DOS-114 — console polish, three defects with one thing in common: each one is the console saying
 * something it does not mean.
 *
 *  - A 400 after a SUCCESSFUL hand-back. Handing the window back makes the live grant null, and the
 *    two timers that re-ask for "what we have read under this window" (the audit row lands a moment
 *    after the read, so the panel asks again) were re-armed on the new key and fired anyway —
 *    `GET /admin/audit?…&entityId=&limit=20` → 400, a failed request after a press that worked.
 *  - "1 support requests waiting for an owner". There is no plural form in this repo, deliberately:
 *    Hindi and Marathi do not share English's one-or-many rule, so a count that can be 1 needs two
 *    keys and a screen that picks between them (the shape `p7.membershipOne` already uses).
 *  - Subscriptions was a wall of rows with no action on it: to change a plan you had to know that
 *    Distributors → the distributorship → "Change the plan" existed. The register now carries the
 *    action where the data is, for the levels that may use it (super and billing — DOS-106).
 *
 * Pure rules, this app's own catalogue, and the screens' source: importing a screen in Node pulls in
 * `react-native` and `expo-router`, which resolve only under Metro.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { countKey, pageCount } from './counts'

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

describe('DOS-114: the console says what it means', () => {
  it('counts one waiting request in the singular, and everything else in the plural', () => {
    const page = <T>(items: readonly T[], nextCursor: string | null = null) => ({
      items,
      nextCursor,
    })
    expect(countKey(pageCount(page(['a'])), 'p1.waitingOwner', 'p1.waitingOwners')).toBe(
      'p1.waitingOwner',
    )
    expect(countKey(pageCount(page(['a', 'b'])), 'p1.waitingOwner', 'p1.waitingOwners')).toBe(
      'p1.waitingOwners',
    )
    expect(countKey(pageCount(page([])), 'p1.waitingOwner', 'p1.waitingOwners')).toBe(
      'p1.waitingOwners',
    )
    // A full page of one with more behind it is "1+", which is not one: the plural is right.
    expect(countKey(pageCount(page(['a'], 'cursor')), 'p1.waitingOwner', 'p1.waitingOwners')).toBe(
      'p1.waitingOwners',
    )
    expect(catalogue['p1.waitingOwner']).toBe('1 support request waiting for an owner')
    expect(catalogue['p1.waitingOwners']).toBe('{count} support requests waiting for an owner')
    expect(catalogue['p1.trialEndingOne']).toBe('1 trial ending in 30 days')
  })

  it('the home tile picks the key by its own count', async () => {
    const code = withoutComments(await read('../../app/index.tsx'))
    expect(code).toMatch(/countKey\(asked, 'p1\.waitingOwner', 'p1\.waitingOwners'\)/)
    expect(code).toMatch(/countKey\(ending, 'p1\.trialEndingOne', 'p1\.trialEnding'\)/)
  })

  it('asks for the reads of a window only while there IS one, so a hand-back fires no 400', async () => {
    const code = withoutComments(await read('./support.tsx'))
    // The query itself is already gated; the timers that re-ask must read the same fact.
    expect(code).toMatch(/enabled: live !== null/)
    const poll = /useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\)/.exec(code)?.[0] ?? ''
    expect(poll.length, 'the re-ask timers are gone').toBeGreaterThan(0)
    expect(poll).toMatch(/liveId === null/)
    expect(poll).toMatch(/\[openedAt, liveId, refetchReads\]/)
  })

  it('offers the plan change on the Subscriptions row itself, to the levels that may use it', async () => {
    const code = withoutComments(await read('../../app/subscriptions.tsx'))
    const column = /key: 'change'[\s\S]*?\n {4}\}/.exec(code)?.[0] ?? ''
    expect(column.length, 'the Subscriptions register has no row action').toBeGreaterThan(0)
    expect(column).toMatch(/setEditing\(true\)/)
    expect(column).toMatch(/p5\.edit/)
    // Only for a level that may change a subscription: a support account is offered nothing.
    expect(code).toMatch(/mayEdit \? \[change\] : \[\]/)
  })
})
