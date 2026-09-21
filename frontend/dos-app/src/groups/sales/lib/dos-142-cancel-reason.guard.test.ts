/**
 * DOS-142 — the manager's cancellation reason has to reach the rep who took the order.
 *
 * The manager's cancel dialog promises the rep will be told why ("m2.cancelReason"), and the reason
 * is already on the phone: the `sales_orders` pull is a plain `tablePull` with no omit, so
 * `cancel_reason` comes down with the row. Only two things were missing — `LocalOrder` never named
 * the column, so nothing on the device could read it, and S5 drew the state chip and stopped. A rep
 * standing in the shop that placed the order was left to ring the office to find out.
 *
 * Read as SOURCE, like the other app guards (see `dos-180-banner.guard.test.ts`): importing the
 * screen in Node pulls in `react-native`, which does not resolve outside Metro.
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

describe('DOS-142 the rep is told why the office cancelled the order', () => {
  it('DOS-142 the device row carries cancel_reason and S5 renders it on a cancelled order', async () => {
    const local = await read('./local.ts')
    const screen = await read('../../../../app/sales/orders/[id].tsx')
    const strings = await read('../strings.ts')

    expect({
      // The column the pull already sends, named on the device row so a screen can read it.
      localRow: /interface LocalOrder[\s\S]*?cancel_reason: string \| null[\s\S]*?\n}/.test(local),
      localCancelledAt: /interface LocalOrder[\s\S]*?cancelled_at: string \| null[\s\S]*?\n}/.test(
        local,
      ),
      // S5 reads both copies: the phone's row and, with signal, `orders.get`'s own `cancelReason`.
      viewKeeps: /'cancel_reason'/.test(screen),
      mapsServer: /cancel_reason:\s*item\.cancelReason/.test(screen),
      // And it is on the screen, not just in the type.
      renders: /order\.cancel_reason/.test(screen),
      // With a sentence of its own, in the strings file like every other word in this app.
      key: /'s5\.cancelledReason':/.test(strings),
    }).toEqual({
      localRow: true,
      localCancelledAt: true,
      viewKeeps: true,
      mapsServer: true,
      renders: true,
      key: true,
    })
  })
})
