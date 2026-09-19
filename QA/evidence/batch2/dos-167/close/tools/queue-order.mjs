/**
 * DOS-167 close — phase B3: on the order-entry screen (already open, office cut), add one case and
 * save it on the phone, so exactly one order op is waiting in the outbox.
 */
import fs from 'node:fs'

import { newSession, Session, sleep, waitFor } from './drive.mjs'

const OUT = '/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/close'
const lines = []
const say = (s) => {
  lines.push(`${new Date().toISOString()} ${s}`)
  console.log(s)
}
const save = () => fs.writeFileSync(`${OUT}/B4-queue-order.txt`, lines.join('\n') + '\n')

const sess = new Session(await newSession('in.distributionos.sales'))
say(`session ${sess.id}`)
const start = await sess.texts()
say(`order entry: ${start.slice(0, 20).join(' | ')}`)
if (!start.includes('Add items')) {
  save()
  throw new Error('not on order entry')
}
await sess.shot('B4-order-entry')

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
say(`"Add a case" buttons on screen: ${String(adds.length)}`)
await sess.click(adds[0])
await sleep(2500)
await sess.shot('B5-line-added')
say(`after add: ${(await sess.texts()).filter((t) => /Items|₹|\bcs\b|before GST/.test(t)).slice(0, 10).join(' | ')}`)

const label = (await sess.texts()).find((t) => t === 'Save on this phone' || t === 'Place order') ?? '(not read)'
say(`the button reads: ${label}`)
const PLACED = Date.now()
await sess.click(await sess.byId('place-order'))
say(`PLACED_TAP_AT ${String(PLACED)} ${new Date(PLACED).toISOString()}`)
await sleep(6000)
await sess.shot('B6-queued')
const after = await sess.texts()
say(`after save: ${after.slice(0, 30).join(' | ')}`)
say(`strip: ${after.filter((t) => /waiting to send|Offline|Saved on this phone|draft/i.test(t)).join(' | ')}`)
save()
