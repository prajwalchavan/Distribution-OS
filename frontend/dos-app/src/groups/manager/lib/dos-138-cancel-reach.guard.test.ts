/**
 * DOS-138 / DOS-139 — Cancel order is offered exactly where it can work, and says why when it cannot.
 *
 * The panel disabled Cancel only for `cancelled` and `delivered`, so a picking order was offered a
 * button that could only ever answer the machine's own sentence — "cannot apply cancel in state
 * picking" — printed verbatim in the dialog, and a packed order the same. The founder's rule
 * (2026-09-13): the desk cancels up to and including picking; a packed order is cancelled through its
 * bill; after dispatch the only correction is a credit note. Each of the three is a DIFFERENT reason,
 * so the button must not fall back to one sentence for all of them.
 *
 * Read as SOURCE, like `dos-153-note-scope.guard.test.ts`: importing a screen in Node pulls in
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

describe('M2 order panel: Cancel is offered where it works', () => {
  it('DOS-138: Cancel is live on a picking order and states its own reason on packed and after dispatch', async () => {
    const code = withoutComments(await read('../../../../app/manager/orders/index.tsx'))

    const button = /<Button\s+label=\{t\('m2\.cancel'\)\}[\s\S]*?testID="order-cancel"/.exec(
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

    // the reasons themselves say what to do next, and the dialog warns a mid-pick cancel reaches the floor
    expect(strings['m2.cancelViaBill']).toMatch(/bill/i)
    expect(strings['m2.afterDispatch']).toMatch(/credit note/i)
    expect(code, 'the picking dialog does not mention the picker').toMatch(/m2\.cancelPicking/)
  })
})
