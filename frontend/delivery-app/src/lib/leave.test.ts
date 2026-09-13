/**
 * DOS-167 — what the delivery app says when a driver signs out, or switches distributor, with
 * deliveries, receipts or returns that have not reached the office.
 *
 * The founder's rule (2026-09-13, answer A): the changes stay on this phone for that person only and go
 * the next time that person signs in here; "Send now" while there is a signal; throwing a change away
 * is never offered at sign-out. The sheet names the count and the person, and for a switch the
 * distributor the changes wait for. Every word is in `src/strings.ts`.
 *
 * Pure rules plus a read of the sheet's source: importing a component in Node pulls in `react-native`,
 * which does not resolve outside Metro. `@types/node` is deliberately absent from an app, so the two
 * Node functions are imported through non-literal specifiers.
 */
import { describe, expect, it } from 'vitest'

import { strings } from '../strings'
import { leaveSentence } from './leave'

interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string
}

interface NodeUrl {
  fileURLToPath: (url: URL) => string
}

const NODE_FS: string = 'node:fs'
const NODE_URL: string = 'node:url'

/** A file next to this spec. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readBeside(name: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
}

const catalogue: Readonly<Record<string, string>> = strings

const LEAVE_KEYS = [
  'leave.title',
  'leave.bodySignOut',
  'leave.bodySwitch',
  'leave.attention',
  'leave.sendNow',
  'leave.signOutKeep',
  'leave.switchAnyway',
  'leave.noSignal',
] as const

const GANESH = 'Ganesh More'
const TARSUN = 'Tarsun Enterprises, Kalyan'

describe('DOS-167 the delivery leave sheet', () => {
  it('DOS-167 leaveSentence names the count, the person and the rule for sign-out and for a switch', async () => {
    // Three doorstep deliveries saved in a dead spot.
    const queued = leaveSentence({
      mode: 'signOut',
      pending: 3,
      rejected: 0,
      name: GANESH,
      tenantName: TARSUN,
    })
    expect(queued.title).toBe('3 changes have not reached the office')
    expect(queued.attention).toBeNull()
    expect(queued.body).toBe(
      'They stay on this phone for Ganesh More only and go the next time Ganesh More signs in here. Nobody else can see them.',
    )

    // Two receipts the office refused, nothing queued.
    const refused = leaveSentence({
      mode: 'signOut',
      pending: 0,
      rejected: 2,
      name: GANESH,
      tenantName: TARSUN,
    })
    expect(refused.title).toContain('2 need attention')
    expect(refused.attention).toBeNull()
    expect(refused.body).toContain(GANESH)

    // Both: the queued count is the title, the refused count the line under it.
    const both = leaveSentence({
      mode: 'signOut',
      pending: 1,
      rejected: 2,
      name: GANESH,
      tenantName: TARSUN,
    })
    expect(both.title).toBe('1 changes have not reached the office')
    expect(both.attention).toBe('2 need attention')

    // A switch names the distributor the changes wait for, not the person.
    const switching = leaveSentence({
      mode: 'switch',
      pending: 4,
      rejected: 0,
      name: GANESH,
      tenantName: TARSUN,
    })
    expect(switching.title).toBe('4 changes have not reached the office')
    expect(switching.body).toBe(
      'They go when you come back to Tarsun Enterprises, Kalyan on this phone.',
    )
    expect(switching.body).not.toContain(GANESH)

    // Every word comes from this app's catalogue.
    for (const key of LEAVE_KEYS) expect(catalogue[key], key).toBeTypeOf('string')
    expect(queued.title).toBe(catalogue['leave.title']?.replace('{n}', '3'))
    expect(switching.body).toBe(catalogue['leave.bodySwitch']?.replace('{tenantName}', TARSUN))

    // And the sheet itself holds no sentence of its own: no quoted text with a space, no text between
    // tags, and every key it asks for exists (the one kit key is the kit's own Cancel).
    const sheet = (await readBeside('./leave-sheet.tsx'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const quoted = [...sheet.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map(
      (match) => match[1] ?? match[2] ?? match[3] ?? '',
    )
    expect(quoted.filter((text) => /\s/.test(text))).toEqual([])
    const between = [...sheet.matchAll(/>\s*([^<>{}\s][^<>{}]*)</g)]
      .map((match) => (match[1] ?? '').trim())
      .filter((text) => /[A-Za-z]/.test(text))
    expect(between).toEqual([])
    const asked = [...sheet.matchAll(/t\('([^']+)'/g)].map((match) => match[1] ?? '')
    expect(asked.length).toBeGreaterThan(0)
    for (const key of asked)
      if (key !== 'action.cancel') expect(catalogue[key], key).toBeTypeOf('string')
  })
})
