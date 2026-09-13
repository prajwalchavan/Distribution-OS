/**
 * DOS-024 — M5 fulfilment desk: the Waves queue must offer only what `picklists.create` can actually
 * accept.
 *
 * `warehouse.queue.list` defaults to no `state` filter, so with none supplied it answers `confirmed`,
 * `picking` AND `packed` orders — `unpicklistedOnly` (default true) only hides an order still on a
 * LIVE picklist, which is a different question: an order that was picked, packed and billed carries no
 * live picklist any more, so it came back in "Waiting to be picked" (SO-0845/SO-0850, measured) and
 * ticking it produced a silent 409 from `picklists.create`, which refuses anything that is not
 * `confirmed`. The warehouse app hit the same bug (DOS-029) and fixed it by asking for exactly
 * `state: 'confirmed', unpicklistedOnly: true` — this guards the manager screen the same way.
 *
 * The screen imports `react-native`/`expo-router` transitively and cannot be rendered in Node, so —
 * like `review-desk.test.ts` — this reads the source rather than mounting it. The pattern tolerates
 * whitespace, so `pnpm format` reflowing the call cannot turn it red.
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

/** The fulfilment desk's source. `fileURLToPath`, never `URL.pathname`: the path has a space. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../app/fulfilment/index.tsx', import.meta.url)),
    'utf8',
  )
}

/** Block and line comments removed, so a comment that names the fields is not counted. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const QUEUE_CALL = /api\.api\.warehouse\.queue\.list\(\s*\{([\s\S]*?)\}\s*\)/

describe('DOS-024: the fulfilment Waves queue asks for exactly what picklists.create can accept', () => {
  it("warehouse.queue.list is called with state: 'confirmed' and unpicklistedOnly: true, like the warehouse app's own pick queue", async () => {
    const code = withoutComments(await readScreen())
    const call = code.match(QUEUE_CALL)
    expect(
      call,
      'api.api.warehouse.queue.list({ ... }) not found in fulfilment/index.tsx',
    ).not.toBeNull()
    const args = call?.[1] ?? ''
    expect(args, "warehouse.queue.list must pass state: 'confirmed'").toMatch(
      /state\s*:\s*['"]confirmed['"]/,
    )
    expect(args, 'warehouse.queue.list must pass unpicklistedOnly: true').toMatch(
      /unpicklistedOnly\s*:\s*true/,
    )
  })
})
