/**
 * DOS-063 — THE SCREEN A DRIVER LANDS ON AFTER A WRITE SHOWS THE WRITE.
 *
 * D4 and D5 both record at the office and then `router.replace` back to D3, which reads everything it
 * draws off this phone's SQLite. Nothing told the device to go and fetch what the office had just
 * written, so the stop went on saying "Not started · Deliver this bill" and "Owes ₹75,228.00" until the
 * 60-second poll came round — up to forty seconds of a driver reading a bill he has just handed over as
 * undelivered, and dues he has just been paid. A driver who trusts the screen delivers or collects a
 * second time (QA DOS-062), and the second one is refused at the door.
 *
 * The fix is the one the device already has: the public `useSyncEngine().sync()` (`@dos/offline/react`),
 * the same call `sales-app/app/orders/[id].tsx` and `warehouse-app/app/pick/[id].tsx` make after their
 * own writes. NOT a new engine method that writes server rows into the local tables — a screen that
 * writes its own copy of what the office said is a second source of truth on the device.
 *
 * Only the ONLINE path pulls: the offline path has no signal by definition, and `queueDelivery` /
 * `queueReceipt` have already written the device's own row.
 *
 * Read as SOURCE, in the style of `dos-179-trip-close.guard.test.ts`: importing a screen in Node pulls
 * in `react-native`, which resolves only under Metro.
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

/** Source with its comments taken out: a comment may quote the very call it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** The slice of a screen between two markers — here, one mutation's success handler. */
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  if (start < 0) return ''
  const end = source.indexOf(to, start + from.length)
  return source.slice(start, end < 0 ? source.length : end)
}

describe('DOS-063 the stop is pulled again after a doorstep write', () => {
  it('DOS-063 D4 and D5 hold the public sync engine and pull with it before they leave the screen', async () => {
    const screens = [
      { name: 'deliver', source: await read('../../app/stop/[id]/deliver.tsx') },
      { name: 'collect', source: await read('../../app/stop/[id]/collect.tsx') },
    ]

    const seen = screens.map(({ name, source }) => {
      const success = between(source, 'onSuccess:', 'onError:')
      const sync = success.indexOf('engine?.sync(')
      const replace = success.indexOf('router.replace(')
      return {
        name,
        // The hook, from the offline library's own React layer — never a new engine method.
        holdsEngine: /const engine = useSyncEngine\(\)/.test(source),
        importsHook: /import \{[^}]*\buseSyncEngine\b[^}]*\} from '@dos\/offline\/react'/.test(
          source,
        ),
        // The office answered: go and read back what it wrote, then go to the stop.
        pullsOnSuccess: sync >= 0,
        pullsBeforeLeaving: sync >= 0 && replace >= 0 && sync < replace,
      }
    })

    expect(seen).toEqual([
      {
        name: 'deliver',
        holdsEngine: true,
        importsHook: true,
        pullsOnSuccess: true,
        pullsBeforeLeaving: true,
      },
      {
        name: 'collect',
        holdsEngine: true,
        importsHook: true,
        pullsOnSuccess: true,
        pullsBeforeLeaving: true,
      },
    ])
  })

  it('DOS-063 neither screen writes the office’s answer into the device tables itself', async () => {
    const deliver = await read('../../app/stop/[id]/deliver.tsx')
    const collect = await read('../../app/stop/[id]/collect.tsx')
    for (const source of [deliver, collect]) {
      // No local write of a server row: the pull is the only thing that fills the device.
      expect(source).not.toMatch(/engine\?\.(putRow|applyRows|upsert|writeRow)\(/)
    }
  })
})
