// Round 2 — the OTHER hand signs in with a FULL signal and is shown everything the office knows.
// Bharat's kept pick must not be among it, in her tray, in her store, or on her sheet.
import * as A from './wh-lib.mjs'
import { pull, sql, listStores } from './wh-pull.mjs'

await A.newSession()
await A.sleep(2500)
await A.dismissSystemDialogs()
await A.signIn('sunita.gaikwad', 'wh-37-other-person-online')
await A.sleep(12000)
await A.shot('wh-38-other-person-online-home')
A.log('her home (with a signal):', await A.texts(2500))

// her sheet for the same wave
A.adb(['shell','am','start','-a','android.intent.action.VIEW','-d','dos-warehouse://pick/7ff186e1-aa5c-76f5-9038-2d464dfb22a2','in.distributionos.warehouse'])
await A.sleep(10000)
await A.shot('wh-39-other-person-same-wave')
A.log('her sheet:', await A.texts(2500))
const xml = await A.source()
const picks = [...xml.matchAll(/resource-id="(w5-pick-[^"]+)"/g)].map((m) => m[1])
A.log('rows she can still pick:', JSON.stringify(picks))

await A.clickText('More', { timeout: 20000 })
await A.sleep(2200)
await A.clickText('Settings', { timeout: 15000 })
await A.sleep(4000)
A.log('her settings:', await A.texts(2500))
await A.shot('wh-40-other-person-online-settings')
await A.scrollIntoView('Waiting and refused').catch(() => {})
await A.tapId('x4-tray', { timeout: 15000 }).catch(async () => { await A.clickText('Waiting and refused', { timeout: 8000 }) })
await A.sleep(4000)
await A.shot('wh-41-other-person-online-tray')
A.log('her tray:', await A.texts(2000))
A.log('stores:\n' + listStores())
await A.quit()
