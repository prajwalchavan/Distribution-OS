/**
 * DOS-092 — a cancel dialog whose two buttons both read "Cancel".
 *
 * S5's dialog offered **Cancel** and **Cancel order**: the kit's default dismiss label beside the
 * real verb, so the button that keeps the order and the button that destroys it were one word apart,
 * and the destructive one was on the right where a dismiss usually is. `DialogProps.cancelLabel`
 * already exists and both renderers honour it, so this is the app's word to choose, not a kit change.
 *
 * And the confirm was a silent no-op: `if (reason.trim().length > 0) cancel.mutate(...)`. The
 * contract requires a reason (`CancelOrderInput.reason.min(1)`), which is right — but a rep who taps
 * the destructive button and sees nothing happen learns nothing at all.
 *
 * Read as SOURCE, like the other app guards: importing the screen in Node pulls in `react-native`.
 */
import { describe, expect, it } from 'vitest'

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

describe('DOS-092 the cancel dialog says which button keeps the order', () => {
  it('DOS-092 names both buttons and answers an empty reason instead of swallowing the tap', async () => {
    const screen = await read('../../app/orders/[id].tsx')
    const strings = await read('../strings.ts')

    const keep = /'s5\.cancelKeep':\s*'([^']*)'/.exec(strings)?.[1] ?? ''
    const confirm = /'s5\.cancelConfirm':\s*'([^']*)'/.exec(strings)?.[1] ?? ''

    expect({
      // The dismiss button is named by this app, not left to the kit's "Cancel".
      passesCancelLabel: /cancelLabel=\{t\('s5\.cancelKeep'\)\}/.test(screen),
      keep,
      confirm,
      // UX-00 §12 keeps a button at or under 20 characters.
      lengths: [keep.length <= 20, confirm.length <= 20],
      // An empty reason SAYS so, on the field, and still sends nothing.
      saysWhy: /'s5\.cancelSayWhy':/.test(strings),
      showsOnField: /error=\{[^}]*s5\.cancelSayWhy/.test(screen),
      // The silent no-op is gone: the branch now sets something the dialog renders.
      silentNoOp: /if \(reason\.trim\(\)\.length > 0\) cancel\.mutate/.test(screen),
      // And a reason still reaches the contract trimmed, exactly as before.
      sendsTrimmed: /cancel\.mutate\(\{ reason: reason\.trim\(\) \}\)/.test(screen),
    }).toEqual({
      passesCancelLabel: true,
      keep: 'Keep it',
      confirm: 'Cancel the order',
      lengths: [true, true],
      saysWhy: true,
      showsOnField: true,
      silentNoOp: false,
      sendsTrimmed: true,
    })
  })
})
