/**
 * DOS-167 close — phase B2: with the office already cut off, place one order so it queues.
 * Drives from wherever the app stands (beat / shop / order entry) to a queued order.
 */
import fs from 'node:fs'

import { newSession, Session, sleep, waitFor } from './drive.mjs'

const OUT = '/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/close'
const lines = []
const say = (s) => {
  lines.push(`${new Date().toISOString()} ${s}`)
  console.log(s)
}
const save = () => fs.writeFileSync(`${OUT}/B2-order.txt`, lines.join('\n') + '\n')

const sess = new Session(await newSession('in.distributionos.sales'))
say(`session ${sess.id}`)

async function where() {
  const t = await sess.texts()
  if (t.includes('Dismiss') && t.some((x) => x.includes('Warning') || x.includes('Log'))) return 'logbox'
  if (t.includes('Add items') || t.includes('This order')) return 'order'
  if (t.includes('Take order')) return 'shop'
  if (t.some((x) => x.includes("Today's beat"))) return 'beat'
  return `other: ${t.slice(0, 8).join(' | ')}`
}

for (let step = 0; step < 12; step += 1) {
  const w = await where()
  say(`at: ${w}`)
  if (w === 'order') break
  if (w === 'logbox') {
    await sess.click(await sess.byText('Dismiss'))
    await sleep(1000)
    continue
  }
  if (w === 'shop') {
    await sess.click(await sess.byId('take-order'))
    await sleep(4000)
    continue
  }
  if (w === 'beat') {
    const rows = await sess.findAll('-android uiautomator', 'new UiSelector().resourceIdMatches("beat-row-.*")')
    say(`beat rows: ${String(rows.length)}`)
    await sess.click(rows[0])
    await sleep(4000)
    continue
  }
  // unknown: go to the Beat tab
  await sess.click(await sess.byDesc('Beat'))
  await sleep(3000)
}
if ((await where()) !== 'order') {
  await sess.shot('B4-stuck')
  save()
  throw new Error(`could not reach order entry; at ${await where()}`)
}

await sleep(1500)
await sess.shot('B4-order-entry')
say(`order entry: ${(await sess.texts()).slice(0, 18).join(' | ')}`)

await waitFor(
  async () => {
    const found = await sess.allByTextContains('Add a case')
    if (found.length > 0) return true
    await sess
      .find('-android uiautomator', 'new UiScrollable(new UiSelector().scrollable(true)).scrollForward()')
      .catch(() => {})
    return false
  },
  { timeout: 90000, what: 'an "Add a case" button' },
)
const adds = await sess.allByTextContains('Add a case')
say(`"Add a case" buttons: ${String(adds.length)}`)
await sess.click(adds[0])
await sleep(2500)
await sess.shot('B5-line-added')
say(`after add: ${(await sess.texts()).filter((t) => /Items|₹|\bcs\b|before GST/.test(t)).slice(0, 8).join(' | ')}`)

const label = (await sess.texts()).find((t) => t === 'Save on this phone' || t === 'Place order') ?? '(not read)'
say(`the button reads: ${label}`)
const place = await sess.byId('place-order')
const PLACED = Date.now()
await sess.click(place)
say(`PLACED_TAP_AT ${String(PLACED)} ${new Date(PLACED).toISOString()}`)
await sleep(5000)
await sess.shot('B6-queued')
const after = await sess.texts()
say(`after save: ${after.slice(0, 26).join(' | ')}`)
say(`strip: ${after.filter((t) => /waiting to send|Offline|Saved on this phone|draft/i.test(t)).join(' | ')}`)
save()
console.log('SESSION_ID', sess.id)
