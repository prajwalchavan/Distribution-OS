/**
 * DOS-138 — W5 tells the picker what to PUT BACK, and does not count it as work.
 *
 * The desk may now cancel an order the floor is already picking (founder, 2026-09-13). The pieces
 * already in the trolley have to go back on the rack, and the picker is the only person who can do
 * it — so the sheet has to say so. `pick_lines.cancelled_at` reaches the device with the table
 * itself, and the three things that must follow from it are:
 *
 *  1. the put-back lines are OUT of the progress figure and out of the Confirm gate, or the wave can
 *     never be finished — `left` would never reach zero and the picker would stand at a sheet that
 *     refuses to close on rows nobody is allowed to pick;
 *  2. they are out of the pick list and out of the SCAN lookup, so scanning an EAN cannot land the
 *     picker back on a line whose pieces are going back;
 *  3. they are still SHOWN, in their own group, saying how many pieces go back and from which batch —
 *     a line that simply vanished would leave the trolley wrong with nobody told.
 *
 * REVIEW (DOS-138, second pass): the whole app half of this shipped with no test at all — reverting
 * it left @dos/warehouse-app passing 26/26 — and the run rules forbid the emulator walk that would
 * have caught it. This is the guard that was missing.
 *
 * Read as SOURCE, like `dos-167-onlog.guard.test.ts`: importing a screen in Node pulls in
 * `react-native` and `expo-router`, which resolve only under Metro. `@types/node` is deliberately
 * absent from an app, so the two Node functions come in through non-literal specifiers.
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

/** The screen with its comments taken out: it TALKS about the put-back group before it renders one. */
async function readScreen(): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL('../../app/pick/[id].tsx', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('DOS-138 W5 shows the picker what goes back on the rack', () => {
  it("DOS-138: a cancelled order's lines are split out of the sheet by cancelled_at, and the split is what the progress figure and the scan lookup use", async () => {
    const code = await readScreen()

    // the split is made on the put-back marker, not on anything the picker did
    const split = /const putBack = \(row: PickRow\): boolean =>([\s\S]*?)\n\n/.exec(code)?.[1] ?? ''
    expect(split, 'W5 no longer reads the put-back marker off the line').toMatch(/cancelled_at/)

    expect(code, 'the live rows are not separated from the put-back rows').toMatch(
      /const live = useMemo\(\(\) => rows\.filter\(\(row\) => !putBack\(row\)\)/,
    )
    expect(code, 'the put-back rows are not collected for their own group').toMatch(
      /const returns = useMemo\(\(\) => rows\.filter\(putBack\)/,
    )

    /*
     * THE GATE. `picked` and `left` must count only the live rows: counted against `rows` the picker
     * could never reach zero, and "Take it to packing" would stay disabled for ever on lines they are
     * forbidden to pick.
     */
    expect(code, 'the progress figure still counts lines that are going back').toMatch(
      /const picked = live\.filter\(/,
    )
    expect(code, 'the Confirm gate still counts lines that are going back').toMatch(
      /const left = live\.length - picked/,
    )
    expect(code, 'the progress figure is still totalled over every row').not.toMatch(
      /total: rows\.length/,
    )

    // and the scan cannot land the picker on a line whose pieces are going back
    expect(code, 'a scan still matches a put-back line').toMatch(
      /const found = live\.find\(\(row\) => row\.ean === code\.value\)/,
    )
  })

  it('DOS-138: the put-back group is rendered, and says how many pieces go back from which batch', async () => {
    const code = await readScreen()

    const group = /\{returns\.length === 0 \? null : \(([\s\S]*?)\n {8}\)\}/.exec(code)?.[1]
    expect(group, 'the put-back group is gone from W5').toBeDefined()
    expect(group, 'the put-back group has no test handle').toContain('testID="w5-put-back"')
    expect(group, 'the put-back group has no heading').toContain('w5.putBackTitle')

    /*
     * Two different instructions, and the difference matters to the man holding the trolley: pieces
     * he already took off the rack have to be carried back, while a line he never touched is simply
     * not needed. Telling him to "put back 0 pcs" would send him looking for something he never had.
     */
    expect(group, 'the picker is not told how much to carry back').toMatch(
      /picked_qty_pcs > 0[\s\S]*?w5\.putBack/,
    )
    expect(group, 'an untouched cancelled line is not distinguished').toContain('w5.notNeeded')
    expect(group, 'the batch to put it back into is not named').toMatch(/batch:/)

    // the words themselves, so the group cannot ship with a placeholder
    expect(strings['w5.putBackTitle']).toBe('Put back')
    expect(strings['w5.putBack'], 'the put-back line names neither pieces nor batch').toMatch(
      /\{pieces\}[\s\S]*\{batch\}/,
    )
    expect(strings['w5.notNeeded'], 'an untouched line does not say why it is here').toMatch(
      /cancelled/,
    )
  })
})
