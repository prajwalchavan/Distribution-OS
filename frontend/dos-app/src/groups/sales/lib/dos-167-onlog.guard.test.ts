/**
 * DOS-167 ruling 3 (dd), S-139 — the sales app's offline lines have somewhere to go.
 *
 * `@dos/offline` says what it cannot do through `onLog`: ruling (t)'s `offline: no persistent store; running in
 * memory` with the reason it fell back, ruling (s)'s `offline: kept the store from before ruling 2`, and now
 * ruling (cc)'s `offline: the device store could not be used; running in memory`. No field app passed `onLog`, so
 * every one of those lines went nowhere — which is why S-138 (a browser whose offline copy never opened, for 240 s,
 * in silence) needed a QA gate to find rather than a support call. `consoleSink` writes them through `console.warn`,
 * the one console level a library may use here, and is NOT gated on `__DEV__`: a release build is exactly where a
 * stuck store has to be explainable.
 *
 * Read as source, in the style of `libs/ui/src/dos-1xx-*.guard.test.ts`: importing a layout in Node pulls in
 * `react-native`, which does not resolve outside Metro. `@types/node` is deliberately absent from an app, so the two
 * Node functions are imported through non-literal specifiers.
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

/** The layout with its comments taken out: the file TALKS about `<OfflineProvider>` before it renders one. */
async function readLayout(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(
    fileURLToPath(new URL('../../../../app/sales/_layout.tsx', import.meta.url)),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-167 the sales app writes the offline lines somewhere they can be read', () => {
  it('DOS-167 the sales app passes onLog to OfflineProvider', async () => {
    const source = await readLayout()
    const element = /<OfflineProvider\b[\s\S]*?>/.exec(source)?.[0] ?? ''

    expect({
      found: element.length > 0,
      onLog: /\bonLog=/.test(element),
      // The sink is the library's own, not a console call written into the app.
      sink: /consoleSink/.test(source) && /from '@dos\/offline'/.test(source),
    }).toEqual({ found: true, onLog: true, sink: true })
  })
})
