/**
 * DOS-138 / DOS-139 — the owner's Orders panel, the same rule as the manager's M2.
 *
 * The desk cancels up to and including picking (founder, 2026-09-13); a packed order is cancelled
 * through its bill and goes with it; after dispatch the only correction is a credit note. The panel
 * disabled Cancel only for `cancelled` and `delivered`, so the other two answered the state machine's
 * own sentence, which the owner cannot act on.
 *
 * Read as SOURCE: importing a screen in Node pulls in `react-native` and `expo-router`.
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

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('O5 order panel: Cancel is offered where it works', () => {
  it('DOS-138: Cancel is live on a picking order and states its own reason on packed and after dispatch', async () => {
    const code = withoutComments(await read('../../app/orders/index.tsx'))

    const button = /<Button\s+label=\{t\('o5\.cancel'\)\}[\s\S]*?testID="order-cancel"/.exec(
      code,
    )?.[0]
    expect(button, 'the Cancel button is gone').toBeDefined()
    const disabled = /disabled=\{([\s\S]*?)\}\n/.exec(button ?? '')?.[1] ?? ''
    expect(disabled, 'Cancel is still off for every state but cancelled and delivered').not.toMatch(
      /order\.state === 'delivered'/,
    )
    expect(disabled, 'the three reasons are not decided per state').toMatch(/cancelBlock\(/)
    const reason = /disabledReason=\{([\s\S]*?)\}\n/.exec(button ?? '')?.[1] ?? ''
    expect(reason, 'one sentence still stands for every refusal').toMatch(/cancelBlock\(/)

    expect(strings['o5.cancelViaBill']).toMatch(/bill/i)
    expect(strings['o5.afterDispatch']).toMatch(/credit note/i)
    expect(code, 'the picking dialog does not mention the picker').toMatch(/o5\.cancelPicking/)
  })
})
