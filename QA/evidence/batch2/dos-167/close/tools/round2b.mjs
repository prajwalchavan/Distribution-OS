/**
 * DOS-167 close — round 2 continued: from the open order-entry screen (office already cut), add a
 * case, save it on the phone, sign out keeping it, and bring the office back.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'

import { newSession, Session, sleep, waitFor } from './drive.mjs'

const OUT = '/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/close'
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`
const lines = []
const say = (s) => {
  lines.push(`${new Date().toISOString()} ${s}`)
  console.log(s)
}
const save = () => fs.appendFileSync(`${OUT}/D1-round2.txt`, lines.join('\n') + '\n')
const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    return `ERR ${String(error.stdout ?? '')}${String(error.stderr ?? '')}`.trim()
  }
}

const sess = new Session(await newSession('in.distributionos.sales'))
say(`(round2b) session ${sess.id}`)

async function clearLogBox() {
  for (let i = 0; i < 3; i += 1) {
    const t = await sess.texts()
    if (!t.some((x) => x.includes('Open debugger to view'))) return i === 0 ? 'not shown' : 'dismissed'
    await sess.click(await sess.byDesc('!, Open debugger to view warnings.'))
    await sleep(1500)
    if ((await sess.texts()).includes('Dismiss')) {
      await sess.click(await sess.byText('Dismiss'))
      await sleep(1000)
    }
  }
  return 'still shown'
}

await waitFor(
  async () => {
    if ((await sess.allByTextContains('Add a case')).length > 0) return true
    await sess
      .find('-android uiautomator', 'new UiScrollable(new UiSelector().scrollable(true)).scrollForward()')
      .catch(() => {})
    return false
  },
  { timeout: 90000, what: 'an "Add a case" button' },
)
await sess.click((await sess.allByTextContains('Add a case'))[0])
await sleep(2500)
say(`logbox before save: ${await clearLogBox()}`)
say(`the button reads: ${(await sess.texts()).find((t) => t === 'Save on this phone' || t === 'Place order') ?? '(not read)'}`)
await sess.click(await sess.byId('place-order'))
await sleep(6000)
await sess.shot('D1-2-queued')
say(`after save: ${(await sess.texts()).filter((t) => /waiting to send|Saved on this phone|Offline/i.test(t)).join(' | ')}`)

say(`logbox: ${await clearLogBox()}`)
await sess.click(await sess.byDesc('More'))
await sleep(2000)
await sess.click(await sess.byText('Sign out'))
await sleep(2500)
await sess.shot('D1-3-leave-sheet')
const sheet = await sess.texts()
say(`THE SHEET SAYS: ${sheet.join(' | ')}`)
const keep = sheet.find((t) => t.includes('keep here'))
if (keep === undefined) {
  save()
  throw new Error('no keep option')
}
await sess.click(await sess.byText(keep))
await sleep(6000)
await sess.shot('D1-4-signed-out')
say(`signed out: ${(await sess.texts()).slice(0, 8).join(' | ')}`)

sh(
  `cd '/Users/prajwalchavan/Desktop/Distribution OS' && nohup node '${OUT}/tools/log-proxy.mjs' 3100 3101 '${OUT}/02-request-timeline.jsonl' >> '${OUT}/02-proxy.log' 2>&1 & disown`,
)
await sleep(2500)
say(`reverse: ${sh(`${ADB} reverse tcp:3100 tcp:3100`)}`)
say(`host :3100 -> ${sh('curl -s -m 4 http://127.0.0.1:3100/sales/health')}`)
save()
console.log('ROUND2_READY')
