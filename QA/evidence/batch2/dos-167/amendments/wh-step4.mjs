// Step 4 — with the phone cut off, record ONE pick and prove it sits unsent in the outbox.
import * as A from './wh-lib.mjs'
import { pull, sql } from './wh-pull.mjs'
const LINE = 'a7ed45fd-6311-7133-9889-1d90e6829236'
const DBF = 'wf134ugk70jtqq43yzvsimplap7r431bgsoifpg41eqordf44xk'

await A.newSession()
await A.sleep(2000)
await A.dismissSystemDialogs()
await A.tapId(`w5-pick-${LINE}`, { timeout: 30000, label: 'Picked (Sunbake Glucose 110 g, 156 pc)' })
await A.sleep(20000)
await A.shot('wh-07-picked-offline')
A.log('sheet after the offline pick:', await A.texts(2500))
const off = await A.locate(['w5-offline'])
A.log('w5-offline present:', !!off, off ? await A.text(off) : '')
const strip = await A.locate(['connection'])
A.log('connection strip:', strip ? await A.text(strip).catch(() => '(no text)') : '(not found)')
await A.quit()

const local = pull(DBF, 'wh-queued-before-signout')
console.log('== _outbox (before sign-out) ==')
console.log(sql(local, 'select seq,op_id,tbl,row_id,op,status,attempts,created_at,sent_at,acked_at from _outbox order by seq'))
console.log('== payload ==')
console.log(sql(local, "select data from _outbox where status!='acked' order by seq"))
console.log('== whose store is this ==')
console.log(sql(local, "select key,value from _sync_state where key not like '%cursor%' limit 20"))
