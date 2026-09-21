/**
 * DOS-009 — D11 shows the crew the page the server sent, in the order the server sent it.
 *
 * The founder's rule (docs/22 §8, delegated to the architect 2026-09-21) is one sentence: every list
 * is newest first on the same column its own `from`/`to` window filters — server time `created_at`
 * for a queue of work, the document's own stamped date for a dated register — the row id only ever
 * breaking a tie. `trips.list` is a dated register: it windows on `trip_date` and, since 1d934ed,
 * orders by `(trip_date DESC, id DESC)`.
 *
 * D11 was written before that landed. It carried a comment saying "the server has no date ordering to
 * ask for" and re-sorted the page in the browser by `(tripDate DESC, tripNo DESC)`. Both halves are
 * now wrong. The comment states as fact something the server has done for several commits; and the
 * re-sort is a SECOND ordering rule living on one screen — within a day it ranks by trip number while
 * every other list, the backend spec and the cursor that pages this very query rank by id. A screen
 * that silently re-sorts cannot page either: page two arrives ordered by the server's cursor and is
 * then shuffled against page one.
 *
 * So the guard is: the rows D11 draws are the query's items, untouched, and the window it asks for is
 * still the column the server orders by.
 *
 * Read as SOURCE, like this app's other guards: importing a screen in Node pulls in `react-native`
 * and `expo-router`, which resolve only under Metro, and `@types/node` is deliberately absent here.
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

async function readRaw(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Source with its comments taken out: a comment may quote the very call it explains. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('DOS-009 D11 keeps the server’s trip order', () => {
  it('DOS-009: the rows drawn are the query’s items — D11 never re-sorts the page', async () => {
    const code = withoutComments(await readRaw('../../../../app/delivery/trips.tsx'))

    /* What the Group maps over, and how that name was produced. */
    const mapped = /\{(\w+)\.map\(\(trip\)/.exec(code)?.[1] ?? null
    const derivation =
      mapped === null
        ? null
        : (new RegExp(`const ${mapped} =([\\s\\S]*?)\\n\\s*(?:const|return) `).exec(code)?.[1] ??
          null)

    expect({
      mapped,
      derivationFound: derivation !== null,
      /* A comparator anywhere in the module is a second ordering rule on one screen. */
      sortsInTheBrowser: /\.sort\(/.test(code),
      /* And the rows are the page the server sent, not a copy put through one. */
      readsItemsDirectly: derivation === null ? false : /trips\.data\?\.items/.test(derivation),
      ranksByTripNo: derivation === null ? true : /tripNo/.test(derivation),
    }).toEqual({
      mapped: 'rows',
      derivationFound: true,
      sortsInTheBrowser: false,
      readsItemsDirectly: true,
      ranksByTripNo: false,
    })
  })

  it('DOS-009: the window D11 asks for is the column the server orders by, and the screen no longer claims otherwise', async () => {
    const raw = await readRaw('../../../../app/delivery/trips.tsx')
    const code = withoutComments(raw)

    /* `from`/`to` on `trips.list` filter `trip_date`; the server orders by the same column. */
    const call = /api\.api\.delivery\.trips\.list\(\{([^}]*)\}\)/.exec(code)?.[1] ?? ''

    expect({
      windowAsked: /from,/.test(call) && /to:\s*until/.test(call),
      mineForced: /mine:\s*true/.test(call),
      /*
       * The comment that sent the screen down this road. It is read from the RAW source on purpose:
       * the claim lived in a comment, and a false comment is what the next reader believes.
       */
      claimsServerHasNoDateOrder: /server has no date ordering/i.test(raw),
    }).toEqual({
      windowAsked: true,
      mineForced: true,
      claimsServerHasNoDateOrder: false,
    })
  })
})
