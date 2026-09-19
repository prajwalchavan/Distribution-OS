// Step 3 — go offline (airplane mode), queue ONE real pick, prove it is in the outbox.
import * as A from './wh-lib.mjs'
const LINE = '363ada0f-d002-700b-9dc0-ec5141c411e8'
const WAVE = '7ff186e1-aa5c-76f5-9038-2d464dfb22a2'
const DBF = 'wf134ugk70jtqq43yzvsimplap7r431bgsoifpg41eqordf44xk'

await A.newSession()
await A.sleep(1500)
await A.dismissSystemDialogs()

A.log('airplane mode ON')
A.adb(['shell', 'cmd', 'connectivity', 'airplane-mode', 'enable'])
await A.sleep(9000)
A.log('wifi state:', A.adb(['shell', 'settings', 'get', 'global', 'airplane_mode_on']).trim())

// back to the sheet
A.log('screen now:', await A.texts(600))
const wave = await A.locate([`w1-wave-${WAVE}`])
if (wave) {
  await A.tapId(`w1-wave-${WAVE}`)
} else {
  await A.tapId('w4-tab', { timeout: 5000 }).catch(() => {})
}
await A.sleep(4000)
await A.shot('wh-04-sheet-offline')
A.log('sheet offline:', await A.texts(2500))

// prove the app itself says it has no signal
const off = await A.locate(['w5-offline'])
A.log('w5-offline present:', !!off)

await A.tapId(`w5-pick-${LINE}`, { timeout: 30000, label: 'Picked (line ' + LINE.slice(0, 8) + ')' })
await A.sleep(5000)
await A.shot('wh-05-after-picked-offline')
A.log('after the tap:', await A.texts(2500))
await A.quit()

// read the device store
const local = A.pullDb(DBF, 'wh-queued-before-signout')
console.log('== _outbox ==')
console.log(A.sqlite(local, "select seq,op_id,tbl,row_id,op,status,attempts,created_at,sent_at,acked_at from _outbox order by seq"))
console.log('== payload ==')
console.log(A.sqlite(local, "select data from _outbox order by seq"))
console.log('== meta ==')
console.log(A.sqlite(local, "select * from _meta"))
