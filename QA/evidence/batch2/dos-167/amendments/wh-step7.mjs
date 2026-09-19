// Step 7 — the SAME hand signs back in on the same phone, still with no signal to the service.
import * as A from './wh-lib.mjs'
import { pull, sql, listStores } from './wh-pull.mjs'
const DBF = 'wf134ugk70jtqq43yzvsimplap7r431bgsoifpg41eqordf44xk'

await A.newSession()
await A.sleep(2500)
await A.dismissSystemDialogs()
await A.signIn('bharat.jadhav', 'wh-13-same-person')
await A.sleep(6000)
await A.shot('wh-14-same-person-home')
A.log('home:', await A.texts(2500))

// the tray: More -> Settings -> "Waiting and refused"
await A.clickText('More')
await A.sleep(2000)
await A.clickText('Settings', { timeout: 15000 })
await A.sleep(3500)
A.log('settings:', await A.texts(2500))
await A.shot('wh-15-same-person-settings')
await A.scrollIntoView('Waiting and refused').catch(() => {})
await A.sleep(600)
await A.tapId('x4-tray', { timeout: 15000, label: 'Waiting and refused' }).catch(async (e) => {
  A.log('tray button:', e.message)
  await A.clickText('Waiting and refused', { timeout: 8000 })
})
await A.sleep(4000)
await A.shot('wh-16-same-person-tray')
A.log('tray:', await A.texts(2500))
A.log('stores on the device:\n' + listStores())
await A.quit()

const local = pull(DBF, 'wh-same-person-after-signin')
console.log('== _outbox after the SAME person signed back in ==')
console.log(sql(local, 'select seq,op_id,tbl,row_id,op,status,attempts,created_at,sent_at,acked_at from _outbox order by seq'))
console.log('== who this store belongs to ==')
console.log(sql(local, "select key,value from _sync_state where key in ('userId','role','tenantId','deviceId')"))
