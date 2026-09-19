// Step 3b — the phone is now genuinely cut off (airplane mode AND the adb-reverse tunnels to the
// services removed, because a reverse tunnel keeps working through airplane mode). Queue ONE pick.
import * as A from './wh-lib.mjs'
import { pull, sql, listStores } from './wh-pull.mjs'
const DBF = 'wf134ugk70jtqq43yzvsimplap7r431bgsoifpg41eqordf44xk'

await A.newSession()
await A.sleep(2500)
await A.dismissSystemDialogs()
A.log('screen:', await A.texts(1500))
await A.shot('wh-06-offline-sheet')
const off = await A.locate(['w5-offline'])
A.log('w5-offline present:', !!off)
if (off) A.log('offline note says:', await A.text(off))
const xml = await A.source()
const picks = [...xml.matchAll(/resource-id="(w5-pick-[^"]+)"/g)].map((m) => m[1])
A.log('pick buttons:', JSON.stringify(picks))
await A.quit()
