/**
 * D1 IS THE DRIVER'S WORK (founder, 2026-09-28, docs/22 §8: "every app opens on its work, and nobody
 * should need training"), read as SOURCE in the style of the DOS-179 guards: importing a screen in Node
 * pulls in `react-native`, which resolves only under Metro, and `@types/node` is deliberately absent
 * from an app, so the two Node functions come in through non-literal specifiers.
 *
 * What is pinned is what the founder decided that day and what would quietly rot:
 *   - the home is the job list with the buttons on the cards — no dashboard above it, no bottom bar,
 *     everything else in a closed "More" below;
 *   - every write from a card is the SAME function D3, D4 and D5 call;
 *   - money is typed by the driver and never pre-filled, and the one confirm names what it writes;
 *   - a shop that owes a photo never gets the one-tap write;
 *   - no English literal in the screen or its sheets.
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

/** Source with its comments taken out: a comment may quote the very string it explains. */
async function read(relative: string): Promise<string> {
  const { readFileSync } = (await import(NODE_FS)) as NodeFs
  const { fileURLToPath } = (await import(NODE_URL)) as NodeUrl
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\}/g, '{}')
}

const HOME = '../../../../app/delivery/index.tsx'
const SHEETS = './home-sheets.tsx'
const WRITES = './home-writes.ts'

describe('D1 is the list of the driver’s jobs, with the buttons on them', () => {
  it('opens on the job list; the figures and panels are in "More" below it; no bottom bar', async () => {
    const home = await read(HOME)
    const page = home.slice(home.lastIndexOf('return (\n    <Screen'))
    expect({
      jobList: page.includes('<JobList'),
      jobCards: /<JobCard\b/.test(home),
      more: page.includes('<MoreGroup'),
      listBeforeMore: page.indexOf('<JobList') < page.indexOf('<MoreGroup'),
      // No dashboard above the list: the figures moved into the More group's sections.
      kpisOnlyInMore: /const moreSections[\s\S]*<KpiStrip[\s\S]*const jobs:/.test(home),
      kpisOnThePage: page.includes('<KpiStrip'),
      bottomBar: /bottomBar=/.test(home),
      headerChips: /\bchips=\{/.test(home),
    }).toEqual({
      jobList: true,
      jobCards: true,
      more: true,
      listBeforeMore: true,
      kpisOnlyInMore: true,
      kpisOnThePage: false,
      bottomBar: false,
      headerChips: false,
    })
  })

  it('a finished door folds to one line, the next one says so, and a card body still opens its stop', async () => {
    const home = await read(HOME)
    expect(home).toMatch(
      /state=\{job\.kind === 'finished' \? 'done' : isNext \? 'next' : 'default'\}/,
    )
    expect(home).toMatch(/onPress=\{\(\) => \{\s*openStop\(stop\)\s*\}\}/)
  })
})

describe('every write from a card is the one D3, D4 and D5 make', () => {
  it('the home builds and sends them with the lifted functions', async () => {
    const writes = await read(WRITES)
    for (const call of [
      'arrivalFix(',
      'useMoveStop(',
      'deliveryLinePayload(bill.lines, {}, uuidv7)',
      'arrivalGeoProof(stop, uuidv7)',
      'deliveryRecordInput(',
      'queuedDelivery(',
      'recordOrSave(',
      'doorstepOrderBlock(',
      'collectionRecordInput(',
      'queuedReceipt(',
      'pullAfterDoorstepWrite(engine,',
    ])
      expect(writes, call).toContain(call)
  })

  it('"Picked up, start" comes back to a home that knows the van has left', async () => {
    // The home reads the trip off the device, so the start screen pulls after `depart` before it
    // hands the driver back (the DOS-063 pull), instead of leaving the load card up for a poll.
    const start = await read('../../../../app/delivery/trip/start.tsx')
    const success = start.slice(start.indexOf('api.api.delivery.trips.depart('))
    const pull = success.indexOf("pullAfterDoorstepWrite(engine, 'trip departed')")
    const back = success.indexOf("router.replace(go.href('/'))")
    expect({ pulls: pull >= 0, beforeLeaving: pull >= 0 && pull < back }).toEqual({
      pulls: true,
      beforeLeaving: true,
    })
  })

  it('and so do the screens they came out of', async () => {
    const deliver = await read('../../../../app/delivery/stop/[id]/deliver.tsx')
    const collect = await read('../../../../app/delivery/stop/[id]/collect.tsx')
    const stop = await read('../../../../app/delivery/stop/[id]/index.tsx')
    expect({
      deliverLines: deliver.includes('deliveryLinePayload(lines.rows, entries, uuidv7)'),
      deliverGeo: deliver.includes('arrivalGeoProof(stop, uuidv7)'),
      deliverWire: deliver.includes('deliveryRecordInput('),
      deliverQueue: deliver.includes('queuedDelivery('),
      deliverOrSave: deliver.includes('recordOrSave('),
      collectWire: collect.includes('collectionRecordInput('),
      collectQueue: collect.includes('queuedReceipt('),
      stopFix: stop.includes('arrivalFix('),
    }).toEqual({
      deliverLines: true,
      deliverGeo: true,
      deliverWire: true,
      deliverQueue: true,
      deliverOrSave: true,
      collectWire: true,
      collectQueue: true,
      stopFix: true,
    })
  })
})

describe('the founder’s decisions of 2026-09-28', () => {
  it('money is always typed by the driver: the sheet starts empty and prints what is expected above', async () => {
    const sheets = await read(SHEETS)
    expect(sheets).toContain('useState<number | null>(null)')
    expect(sheets).toMatch(/if \(!open\) return[\s\S]{0,80}setAmountPaise\(null\)/)
    expect(sheets).toMatch(/value=\{amountPaise\}/)
    expect(sheets).toMatch(/expected=\{leftPaise\}/)
    expect(sheets).not.toMatch(/value=\{leftPaise\}/)
    expect(sheets).not.toMatch(/setAmountPaise\(leftPaise/)
  })

  it('"Delivered, all items" is one tap and ONE confirm that names the shop, each bill and its pieces', async () => {
    const sheets = await read(SHEETS)
    const dialog = sheets.slice(
      sheets.indexOf('<Dialog'),
      sheets.indexOf('/>', sheets.indexOf('confirmLabel=')),
    )
    expect(dialog).toContain("t('home.confirmBill'")
    expect(dialog).toContain('{shop}')
    // The sentence under the bills, in the number of bills it names (verify-1 m3): "this bill" for one.
    expect(dialog).toMatch(
      /t\(bills\.length === 1 \? 'home\.confirmBody\.one' : 'home\.confirmBody', \{ shop \}\)/,
    )
    expect(dialog).toContain("confirmLabel={t('home.confirmDeliver')}")
  })

  it('a shop that owes a photo gets "Deliver", which opens D4 — the photo cannot be skipped', async () => {
    const home = await read(HOME)
    const photo = home.slice(
      home.indexOf('if (doorNeedsPhoto('),
      home.indexOf('const bills = billsToDeliver('),
    )
    expect(photo).toContain("t('home.deliver')")
    expect(photo).toContain('/deliver?deliveryId=')
    expect(photo).not.toContain('setConfirming(')
  })

  it('the one tap waits until the phone has finished filling and holds every line of every bill', async () => {
    const home = await read(HOME)
    expect(home).toMatch(/const ready = hydrated && readyToDeliverAll\(bills\)/)
  })

  it('no English literal in the home or its sheets: every word comes from the strings', async () => {
    for (const path of [HOME, SHEETS]) {
      const code = await read(path)
      const literalProps = code.match(
        /\b(label|title|subtitle|message|confirmLabel|emptyMessage|disabledReason)=["'][^"']*[A-Za-z]/g,
      )
      const literalText = code.match(/>\s*[A-Z][a-z]+(?:\s+[a-z]+)+\s*</g)
      expect({ path, literalProps, literalText }).toEqual({
        path,
        literalProps: null,
        literalText: null,
      })
    }
  })
})
