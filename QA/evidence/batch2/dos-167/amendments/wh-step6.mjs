// Step 6 — sign out with the pick still unsent; choose "Sign out, keep here".
import * as A from './wh-lib.mjs'
import { pull, sql } from './wh-pull.mjs'
const DBF = 'wf134ugk70jtqq43yzvsimplap7r431bgsoifpg41eqordf44xk'

await A.newSession()
await A.sleep(2500)
await A.dismissSystemDialogs()
await A.dismissLogBox()

// bottom tab "More" opens the rest of the shell
await A.clickText('More')
await A.sleep(2500)
await A.shot('wh-09-more-menu')
A.log('more:', await A.texts(1500))

// Settings
await A.clickText('Settings', { timeout: 15000 })
await A.sleep(3500)
await A.shot('wh-10-settings')
A.log('settings:', await A.texts(2000))

await A.scrollIntoView('Sign out').catch(() => {})
await A.sleep(800)
await A.tapId('x4-sign-out', { timeout: 20000, label: 'Sign out' })
await A.sleep(3000)
await A.shot('wh-11-leave-sheet')
A.log('leave sheet:', await A.texts(2000))
const body = await A.locate(['leave-body'])
const why = await A.locate(['leave-why'])
A.log('leave-body:', body ? await A.text(body) : '(none)')
A.log('leave-why:', why ? await A.text(why) : '(none)')

await A.tapId('leave-keep', { timeout: 20000, label: 'Sign out, keep here' })
await A.sleep(7000)
await A.dismissSystemDialogs()
await A.shot('wh-12-signed-out')
A.log('after sign-out:', await A.texts(1500))
A.log('sqlite dir after sign-out:\n' + A.sqliteFiles())
await A.quit()

const local = pull(DBF, 'wh-kept-after-signout')
console.log('== _outbox AFTER SIGN-OUT ==')
console.log(sql(local, 'select seq,op_id,tbl,row_id,op,status,attempts,created_at,sent_at,acked_at from _outbox order by seq'))
console.log('== who this store belongs to ==')
console.log(sql(local, "select key,value from _sync_state where key in ('userId','role','tenantId','deviceId')"))
