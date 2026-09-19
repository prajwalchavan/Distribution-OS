// Step 5 — the godown phone is cut off for real (airplane mode, the reverse tunnel to the warehouse
// service removed AND the service itself stopped). Record ONE pick; prove it sits UNSENT.
import * as A from './wh-lib.mjs'
import { pull, sql } from './wh-pull.mjs'
const DBF = 'wf134ugk70jtqq43yzvsimplap7r431bgsoifpg41eqordf44xk'

await A.newSession()
await A.sleep(2500)
await A.dismissSystemDialogs()
A.log('screen:', await A.texts(1200))
let xml = await A.source()
let picks = [...xml.matchAll(/resource-id="(w5-pick-[^"]+)"/g)].map((m) => m[1])
A.log('pick buttons:', JSON.stringify(picks))
if (picks.length === 0) throw new Error('no pickable row on screen: ' + (await A.texts(800)))
const target = picks[0]
const lineId = target.replace('w5-pick-', '')

await A.tapId(target, { timeout: 30000, label: 'Picked (' + lineId.slice(0, 8) + ')' })
await A.sleep(25000)
await A.shot('wh-08-picked-with-no-signal')
A.log('after the offline pick:', await A.texts(2500))
const off = await A.locate(['w5-offline'])
A.log('w5-offline present:', !!off, off ? await A.text(off) : '')
await A.quit()

const local = pull(DBF, 'wh-queued-before-signout')
console.log('LINE PICKED OFFLINE:', lineId)
console.log('== _outbox ==')
console.log(sql(local, 'select seq,op_id,tbl,row_id,op,status,attempts,created_at,sent_at,acked_at from _outbox order by seq'))
console.log('== unsent payload ==')
console.log(sql(local, "select data from _outbox where status<>'acked' order by seq"))
