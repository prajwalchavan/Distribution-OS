/**
 * DOS-180 — the source half: S3 no longer decides what happened to an order by looking at the radio.
 *
 * `local.online ? t('s3.placed…` at new.tsx:311 and :387 is the whole defect. It is a render-time read
 * of a global fact, standing in for a per-order one, so the SAME banner re-labelled itself "Order
 * placed — The office has it, with its number and its price" the moment a signal returned, over an
 * order the office still held as a draft with no number. The rule now lives in `orderOutcome`, which
 * takes only facts about that order; this guard is what stops the read coming back.
 *
 * Read as SOURCE, like the other app guards: importing the screen in Node pulls in `react-native`,
 * which does not resolve outside Metro. `@types/node` is deliberately absent from an app, so the two
 * Node functions come in through non-literal specifiers.
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

/** The screen with its comments taken out: a comment may quote the very read it describes. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL('../../app/orders/new.tsx', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-180 S3 decides the outcome from the order, never from the radio', () => {
  it('DOS-180 new.tsx takes the banner and the spent button from orderOutcome and never from local.online', async () => {
    const code = await readScreen()

    expect({
      // The rule is imported, and it is the only thing that names the outcome.
      imports:
        /import\s*\{[^}]*\borderOutcome\b[^}]*\}\s*from\s*'\.\.\/\.\.\/src\/lib\/outcome'/.test(
          code,
        ),
      calls: (code.match(/\borderOutcome\s*\(/g) ?? []).length,
      // THE DEFECT, in both places it stood: a radio read choosing what happened to this order.
      placedFromRadio: /local\.online\s*\?\s*t\(\s*'s3\.placed/.test(code),
      // The row is read, which is what makes the banner per-order rather than global.
      readsRow: /useRow<[^>]*>\(\s*'sales_orders'/.test(code),
      // And the reply's own answer, not a guess about what the tap did.
      readsQueued: /place\.data\??\.?\.?queued|queued:\s*place\.data/.test(code),
      /*
       * The PRE-tap label keeps `local.online`: before the tap it is the truth about what the tap is
       * about to do (place it, or hold it on the phone). Only the spent label and the banner move.
       */
      keepsPreTapRadio: /local\.online\s*\n?\s*\?\s*t\('s3\.place'\)/.test(code),
    }).toEqual({
      imports: true,
      calls: 1,
      placedFromRadio: false,
      readsRow: true,
      readsQueued: true,
      keepsPreTapRadio: true,
    })
  })
})
