// Step 10 — the first hand signs in with a signal; the kept pick must go FIRST.
import * as A from './wh-lib.mjs'
import { pull, sql, listStores } from './wh-pull.mjs'
const DBF = 'wf134ugk70jtqq43yzvsimplap7r431bgsoifpg41eqordf44xk'

await A.newSession()
await A.sleep(2500)
await A.dismissSystemDialogs()
await A.signIn('bharat.jadhav', 'wh-25-back-online')
await A.sleep(8000)
await A.shot('wh-26-back-online-home')
A.log('home with a signal:', await A.texts(2500))
await A.clickText('More', { timeout: 20000 })
await A.sleep(2000)
await A.clickText('Settings', { timeout: 15000 })
await A.sleep(4000)
A.log('settings:', await A.texts(2500))
await A.shot('wh-27-back-online-settings')
await A.scrollIntoView('Waiting and refused').catch(() => {})
await A.tapId('x4-tray', { timeout: 15000, label: 'Waiting and refused' }).catch(async () => {
  await A.clickText('Waiting and refused', { timeout: 8000 })
})
await A.sleep(4000)
await A.shot('wh-28-back-online-tray')
A.log('tray:', await A.texts(2500))
A.log('stores:\n' + listStores())
await A.quit()

const local = pull(DBF, 'wh-final-after-send')
console.log('== _outbox after the signal came back ==')
console.log(sql(local, 'select seq,op_id,tbl,row_id,op,status,attempts,created_at,sent_at,acked_at from _outbox order by seq'))
console.log('== _sync_errors ==')
console.log(sql(local, 'select count(*) from _sync_errors'))
