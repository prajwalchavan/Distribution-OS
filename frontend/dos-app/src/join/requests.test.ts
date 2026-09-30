/**
 * M2 (blind check of the shopkeeper's sign-up) — ask a shop, withdraw, ask the same shop again in the same visit: the
 * app said "Request sent" and sent nothing, because the mutation hook kept the same id for the same shop code and the
 * server answered the withdrawn request that id had made. The words now follow the state the server answered with,
 * and the screen starts a new request (a new id and key) after every answered ask.
 *
 * The screen is read as SOURCE, like the other app guards: importing it in Node pulls in `react-native`.
 */
import { describe, expect, it } from 'vitest'

import { askedToastKey } from './requests'
import { JOIN_STRINGS } from './strings'

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
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('asking to join says what happened, and asking again sends a new request', () => {
  it('says "Request sent" only for a request that waits', () => {
    expect(askedToastKey('waiting')).toBe('join.asked')
    expect(askedToastKey('approved')).toBe('join.askedJoined')
    expect(askedToastKey('withdrawn')).toBe('join.askedClosed')
    expect(askedToastKey('refused')).toBe('join.askedClosed')
    const words = JOIN_STRINGS as Record<string, string>
    for (const state of ['waiting', 'approved', 'withdrawn', 'refused'] as const) {
      expect(words[askedToastKey(state)], state).toBeTruthy()
    }
    expect(words['join.askedClosed']).not.toBe(words['join.asked'])
  })

  it('starts a new request after every answered ask, and toasts the answered state', async () => {
    const screen = await read('./add-distributor.tsx')
    const sent =
      /const sent = \(result: MyJoinRequestOut\): void => \{([\s\S]*?)\n {2}\}/.exec(screen)?.[1] ??
      ''
    expect({
      resetsTheIntent: /ask\.reset\(\)/.test(sent),
      toastFollowsState: /setToast\(t\(askedToastKey\(result\.item\.state\)\)\)/.test(sent),
      saysSentWhateverCame: /setToast\(t\('join\.asked'\)\)/.test(screen),
      bothWaysUseIt: (screen.match(/\.then\(sent, /g) ?? []).length,
    }).toEqual({
      resetsTheIntent: true,
      toastFollowsState: true,
      saysSentWhateverCame: false,
      bothWaysUseIt: 2,
    })
  })
})
