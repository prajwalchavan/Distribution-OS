// Round 2 — queue a second pick with no signal, sign out keeping it, so the OTHER hand can then sign
// in WITH a full signal and be shown everything the office knows: the kept pick must not be among it.
import * as A from './wh-lib.mjs'
import { pull, sql } from './wh-pull.mjs'
const DBF = 'wf134ugk70jtqq43yzvsimplap7r431bgsoifpg41eqordf44xk'

await A.newSession()
await A.sleep(2500)
await A.dismissSystemDialogs()
await A.dismissLogBox()
await A.clickText('Close', { timeout: 5000 }).catch(() => {})
await A.sleep(1200)
// The home and Pick panels are service-backed and show "No connection" with the office cut off;
// the SHEET itself reads the device, so reach it by its own route.
A.adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
  'dos-warehouse://pick/7ff186e1-aa5c-76f5-9038-2d464dfb22a2', 'in.distributionos.warehouse'])
await A.sleep(6000)
A.log('sheet:', await A.texts(1500))
await A.sleep(4000)
let xml = await A.source()
const picks = [...xml.matchAll(/resource-id="(w5-pick-[^"]+)"/g)].map((m) => m[1])
A.log('pick buttons:', JSON.stringify(picks))
if (picks.length === 0) throw new Error('no pickable row: ' + (await A.texts(900)))
const lineId = picks[0].replace('w5-pick-', '')
await A.tapId(picks[0], { timeout: 20000, label: 'Picked (' + lineId.slice(0, 8) + ')' })
await A.sleep(22000)
await A.shot('wh-29-round2-picked-offline')
A.log('after round-2 pick:', await A.texts(2000))

await A.clickText('More', { timeout: 20000 })
await A.sleep(2000)
await A.clickText('Settings', { timeout: 15000 })
await A.sleep(3000)
await A.scrollIntoView('Sign out').catch(() => {})
await A.tapId('x4-sign-out', { timeout: 20000, label: 'Sign out (round 2)' })
await A.sleep(3000)
await A.shot('wh-30-round2-leave-sheet')
A.log('leave sheet:', await A.texts(1500))
await A.tapId('leave-keep', { timeout: 20000, label: 'Sign out, keep here' })
await A.sleep(7000)
await A.shot('wh-31-round2-signed-out')
await A.quit()

const local = pull(DBF, 'wh-round2-kept-after-signout')
console.log('ROUND 2 LINE:', lineId)
console.log('== _outbox after sign-out ==')
console.log(sql(local, "select seq,op_id,tbl,row_id,status,attempts from _outbox order by seq"))
console.log('== the unsent payload ==')
console.log(sql(local, "select data from _outbox where status<>'acked'"))
