/**
 * DOS-167 close — what the DIFFERENT person can see of the first person's unsent work: nothing.
 * Rahul Deshmukh is signed in on the same phone while two of Amit Pawar's ops are still queued.
 */
import fs from 'node:fs'

import { newSession, Session, sleep } from './drive.mjs'

const OUT = '/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/close'
const lines = []
const say = (s) => {
  lines.push(s)
  console.log(s)
}

const sess = new Session(await newSession('in.distributionos.sales'))
say(`## What Rahul Deshmukh sees while Amit Pawar's two ops are still queued on this phone`)
say(new Date().toISOString())
say('')

async function clearLogBox() {
  for (let i = 0; i < 3; i += 1) {
    const t = await sess.texts()
    if (!t.some((x) => x.includes('Open debugger to view'))) return
    await sess.click(await sess.byDesc('!, Open debugger to view warnings.'))
    await sleep(1500)
    if ((await sess.texts()).includes('Dismiss')) {
      await sess.click(await sess.byText('Dismiss'))
      await sleep(1000)
    }
  }
}
await clearLogBox()

const beat = await sess.texts()
await sess.shot('D4-1-rahul-beat')
say(`BEAT: ${beat.slice(0, 20).join(' | ')}`)
say(`"waiting to send" anywhere on this screen: ${String(beat.some((t) => t.includes('waiting to send')))}`)
say(`Amit's shop "Ansari" on this screen: ${String(beat.some((t) => t.includes('Ansari')))}`)
say(`Amit's shop "Prerna" on this screen: ${String(beat.some((t) => t.includes('Prerna')))}`)
say('')

// search Rahul's beat for Amit's shop
try {
  const search = await sess.byId('beat-search')
  await sess.click(search)
  await sess.type(search, 'Ansari')
  await sleep(2500)
  await sess.shot('D4-2-rahul-search-ansari')
  const found = await sess.texts()
  say(`SEARCH "Ansari" on Rahul's beat: ${found.filter((t) => /Ansari|No shop|nothing|No match/i.test(t)).join(' | ') || '(no row matched)'}`)
  say(`rows containing "Ansari": ${String(found.filter((t) => t.includes('Ansari')).length)}`)
  await sess.clear(search)
  await sleep(1500)
} catch (error) {
  say(`search: could not use beat-search (${String(error).slice(0, 120)})`)
}
say('')

// Rahul's Orders tab, and the needs-attention tray
await clearLogBox()
await sess.click(await sess.byDesc('Orders'))
await sleep(4000)
await clearLogBox()
await sess.shot('D4-3-rahul-orders')
const orders = await sess.texts()
say(`ORDERS: ${orders.slice(0, 26).join(' | ')}`)
say(`any order at Ansari Kirana Stores: ${String(orders.some((t) => t.includes('Ansari')))}`)
say(`any order at Prerna Super Market: ${String(orders.some((t) => t.includes('Prerna')))}`)
say(`"waiting to send" on the orders screen: ${String(orders.some((t) => t.includes('waiting to send')))}`)
say(`"Needs attention" count shown: ${orders.filter((t) => /attention/i.test(t)).join(' | ') || '(none)'}`)

fs.writeFileSync(`${OUT}/D4-rahul-sees-nothing.txt`, lines.join('\n') + '\n')
