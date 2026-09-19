/**
 * DOS-167 close — phase B: cut the office off, place an order so it queues, sign out KEEPING it.
 *
 * "Cut off" here is three things at once, because on this emulator airplane mode alone still lets
 * `/sync/pull` reach the office through the adb reverse (task brief):
 *   1. airplane mode ON,
 *   2. `adb reverse --remove tcp:3100` — the socket the app actually dials,
 *   3. SIGTERM the logging proxy on :3100 — nothing answers even if something dialled it.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'

import { newSession, Session, sleep, waitFor, dismissLogBox } from './drive.mjs'

const OUT = '/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/close'
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`
const lines = []
const say = (s) => {
  lines.push(`${new Date().toISOString()} ${s}`)
  console.log(s)
}
const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    return `ERR ${String(error.stdout ?? '')}${String(error.stderr ?? '')}`.trim()
  }
}

const sess = new Session(await newSession('in.distributionos.sales'))
say(`session ${sess.id}`)
await dismissLogBox(sess)
await waitFor(async () => (await sess.texts()).some((t) => t.includes("Today's beat")), { timeout: 120000, what: 'the beat' })
say(`before the cut: ${(await sess.texts()).slice(0, 12).join(' | ')}`)
await sess.shot('B0-before-cut')

// ---------------------------------------------------------------- the cut
const CUT = Date.now()
say(`CUT_AT ${String(CUT)} ${new Date(CUT).toISOString()}`)
say(`airplane on: ${sh(`${ADB} shell cmd connectivity airplane-mode enable`)}`)
say(`reverse --remove tcp:3100: ${sh(`${ADB} reverse --remove tcp:3100`)}`)
say(`reverse --list after: [${sh(`${ADB} reverse --list`)}]`)
say(`proxy pids: ${sh("pgrep -f 'log-proxy.mjs 3100'")}`)
say(`kill proxy: ${sh("pkill -TERM -f 'log-proxy.mjs 3100'")}`)
await sleep(1500)
say(`host curl :3100 -> ${sh('curl -s -o /dev/null -w "%{http_code}" -m 4 http://127.0.0.1:3100/sales/health || echo REFUSED')}`)
say(`device curl :3100 -> ${sh(`${ADB} shell 'curl -s -m 4 -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/sales/health || echo REFUSED'`)}`)
fs.writeFileSync(`${OUT}/B1-cut.txt`, lines.join('\n') + '\n')

// ---------------------------------------------------------------- place the order
await sleep(3000)
await dismissLogBox(sess)
await sess.shot('B2-after-cut')
say(`after the cut, strip: ${(await sess.texts()).filter((t) => /Offline|Updated|waiting to send|signal/i.test(t)).join(' | ')}`)

const rows = await sess.findAll('-android uiautomator', 'new UiSelector().resourceIdMatches("beat-row-.*")')
say(`beat rows: ${String(rows.length)}`)
await sess.click(rows[0])
await sleep(2500)
await dismissLogBox(sess)
await sess.shot('B3-shop')
const shopTexts = await sess.texts()
say(`shop: ${shopTexts.slice(0, 10).join(' | ')}`)

await sess.click(await sess.byId('take-order'))
await sleep(3000)
await dismissLogBox(sess)
await sess.shot('B4-order-entry')
say(`order entry: ${(await sess.texts()).slice(0, 14).join(' | ')}`)

// add one case of the first catalog item — by its label, never a coordinate
const adds = await sess.allByTextContains('Add a case')
say(`"Add a case" buttons: ${String(adds.length)}`)
await sess.click(adds[0])
await sleep(2000)
await dismissLogBox(sess)
await sess.shot('B5-line-added')
say(`after add: ${(await sess.texts()).filter((t) => /Items|₹|cs\b/.test(t)).slice(0, 8).join(' | ')}`)

const place = await sess.byId('place-order')
const placeLabel = (await sess.texts()).find((t) => t === 'Save on this phone' || t === 'Place order') ?? '(label not read)'
say(`the button reads: ${placeLabel}`)
const PLACED = Date.now()
await sess.click(place)
say(`PLACED_TAP_AT ${String(PLACED)} ${new Date(PLACED).toISOString()}`)
await sleep(4000)
await dismissLogBox(sess)
await sess.shot('B6-queued')
const after = await sess.texts()
say(`after save: ${after.slice(0, 22).join(' | ')}`)
say(`strip: ${after.filter((t) => /waiting to send|Offline|Saved on this phone/i.test(t)).join(' | ')}`)

fs.writeFileSync(`${OUT}/B1-cut.txt`, lines.join('\n') + '\n')
console.log('SESSION_ID', sess.id)
