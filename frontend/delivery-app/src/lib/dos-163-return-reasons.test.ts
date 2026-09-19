/**
 * DOS-163 — THE REASON THAT MUST ROUTE STOCK TO THE EXPIRY BIN WAS THE ONE CUT IN HALF.
 *
 * Measured on an iPhone 16 Pro (402 pt): the three-segment row under "Taken back · 24 pc" was wider
 * than the line card it sits in. "Past its date" was laid out at x 294–423, its label running past the
 * grey segment and off the screen as "Past its dat". The control still worked — a tap at x≈348 flipped
 * the caption to "Into the damaged / expiry bin" — but the driver could not read the option that
 * decides whether returned stock goes back on the van or into the damaged bin.
 *
 * Three labels of that length cannot share one line on a phone, so they stop sharing one. The reasons
 * become the same stacked list D3's "Why was nothing delivered?" sheet already uses — one row each, full
 * width, at every width there is — with no change to the kit (`Segments` belongs to another lane) and no
 * shortening of `word.refused`, `word.damaged` or `word.expired`, which are the trade's own words and
 * are read by the desk, the shop's proof screen and the credit note as well as by this screen.
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

/** Source with its comments taken out: a comment may quote the very element it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('DOS-163 the return reasons fit the line card at every width', () => {
  it('DOS-163 D4 stacks the three reasons instead of sharing one line between them', async () => {
    const deliver = await read('../../app/stop/[id]/deliver.tsx')
    expect({
      // Nothing on this screen puts three long labels side by side any more.
      sharesALine: /<Segments\b/.test(deliver),
      // One row each, the same vocabulary D3's failure sheet uses, full width at any size.
      stacked: /testID=\{`d4-reason-\$\{line\.id\}-\$\{code\}`\}/.test(deliver),
      // Still the trade's own words, read in full.
      fullWords: /wordFor\(t, code\)/.test(deliver),
      // And the selected one is still visible as selected.
      saysWhichIsChosen: /state=\{\(entry\?\.reason \?\? 'refused'\) === code/.test(deliver),
    }).toEqual({
      sharesALine: false,
      stacked: true,
      fullWords: true,
      saysWhichIsChosen: true,
    })
  })

  it('DOS-163 the shared words are not shortened to make a row fit', () => {
    const words = strings as Record<string, string>
    expect([words['word.refused'], words['word.damaged'], words['word.expired']]).toEqual([
      'Shop refused it',
      'Damaged',
      'Past its date',
    ])
  })
})
