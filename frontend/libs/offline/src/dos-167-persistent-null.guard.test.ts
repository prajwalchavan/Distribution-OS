/**
 * DOS-167 ruling 3 (ee) + Fable amendment A1, S-140 — the LAST consumer of the tri-state: the offline harness.
 *
 * A1 says the `persistent: boolean | null` widening must be threaded through EVERY hop and every consumer, not only
 * the ones the ruling named. The three field apps were threaded and are guarded by their own
 * `dos-167-persistent-null.guard.test.ts`; `frontend/libs/offline/harness/App.tsx` was missed. It read the tri-state
 * as a plain boolean — `{status.persistent ? null : …}` — so for the whole of the open (persistent === null, up to
 * the 15 s deadline) it told the developer driving the harness that the browser keeps nothing. That is the S-140
 * flash, in the one screen a developer uses to judge whether the store opened.
 *
 * The harness is in-tree code: `frontend/libs/offline/tsconfig.json` includes `harness`, and eslint lints it. It is
 * read as SOURCE for the same reason the app guards are — importing it pulls in `@dos/ui`, which resolves
 * `react-native` only under Metro — so what is asserted is the GATE around the string, the thing an edit must delete
 * to bring the flash back. `@types/node` is not a dependency of this package, so the two Node functions come in
 * through non-literal specifiers.
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

/** The harness with its comments taken out: a comment may TALK about the gate it describes. */
async function readSource(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * The gates a persistence line may sit behind — the same three the app guards accept. Each leaves NOTHING on the
 * screen while `persistent` is null; anything else (`!persistent ?`, a bare `persistent ? … : …`, `?? false`) is the
 * S-140 flash again.
 */
const GATES: readonly RegExp[] = [
  /status\.persistent\s*!==\s*false\s*\?\s*null\s*:/,
  /status\.persistent\s*===\s*null\s*\?\s*null\s*:/,
  /status\.persistent\s*===\s*null\s*\?\s*\{\}\s*:/,
]

/** How far back from a plain `persistent` read its gate may sit: the same JSX expression, not somewhere in the file. */
const GATE_REACH = 300

/** The string a developer must never see while the store is still opening. */
const MEMORY_LINE = 'Offline data is not saved on this browser'

describe('DOS-167 the offline harness never says "not saved" before the store has resolved', () => {
  it('DOS-167 the harness gates its memory-store line on a RESOLVED false, so a null open says nothing', async () => {
    const source = await readSource('../harness/App.tsx')
    const at = source.indexOf(MEMORY_LINE)
    const gatedBefore = (index: number): boolean =>
      GATES.some((gate) => gate.test(source.slice(Math.max(0, index - GATE_REACH), index)))

    expect({
      // The line exists at all: a renamed string must not let this test pass by finding nothing to guard.
      present: at !== -1,
      // Something in the same JSX expression routes a null away from it.
      gated: at !== -1 && gatedBefore(at),
      // And no plain truthiness read of `persistent` stands outside such a gate — that read IS the flash.
      ungated: [...source.matchAll(/status\.persistent(?!\s*(?:===|!==))/g)]
        .filter((match) => !gatedBefore(match.index ?? 0))
        .map((match) =>
          source
            .slice(match.index ?? 0, (match.index ?? 0) + 60)
            .split('\n')[0]
            ?.trim(),
        ),
      // On a RESOLVED memory store the line IS printed: withholding it there is the other half of the lie.
      onFalse: new RegExp(
        `status\\.persistent\\s*!==\\s*false\\s*\\?\\s*null\\s*:[\\s\\S]{0,200}${MEMORY_LINE}`,
      ).test(source),
    }).toEqual({ present: true, gated: true, ungated: [], onFalse: true })
  })
})
