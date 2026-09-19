// Step 8 — sign out again keeping the pick, then a DIFFERENT warehouse hand signs in on the same phone.
import * as A from './wh-lib.mjs'
import { pull, sql, listStores } from './wh-pull.mjs'
const BHARAT = 'wf134ugk70jtqq43yzvsimplap7r431bgsoifpg41eqordf44xk'

await A.newSession()
await A.sleep(2500)
await A.dismissSystemDialogs()
await A.dismissLogBox()

// close the tray sheet if it is still open
await A.clickText('Close', { timeout: 6000 }).catch(() => {})
await A.sleep(1500)
await A.clickText('More', { timeout: 15000 })
await A.sleep(2000)
await A.clickText('Settings', { timeout: 15000 }).catch(() => {})
await A.sleep(3000)
await A.scrollIntoView('Sign out').catch(() => {})
await A.tapId('x4-sign-out', { timeout: 20000, label: 'Sign out (2nd time)' })
await A.sleep(3000)
await A.shot('wh-17-leave-sheet-2')
A.log('leave sheet 2:', await A.texts(1500))
await A.tapId('leave-keep', { timeout: 20000, label: 'Sign out, keep here (2nd)' })
await A.sleep(7000)
await A.shot('wh-18-signed-out-2')
A.log('signed out again:', await A.texts(800))

// the other person
await A.signIn('sunita.gaikwad', 'wh-19-other-person')
await A.sleep(6000)
await A.shot('wh-20-other-person-home')
A.log('other person home:', await A.texts(2500))
await A.clickText('More', { timeout: 20000 })
await A.sleep(2000)
await A.clickText('Settings', { timeout: 15000 })
await A.sleep(3500)
A.log('other person settings:', await A.texts(2500))
await A.shot('wh-21-other-person-settings')
await A.scrollIntoView('Waiting and refused').catch(() => {})
await A.tapId('x4-tray', { timeout: 15000, label: 'Waiting and refused (other person)' }).catch(async () => {
  await A.clickText('Waiting and refused', { timeout: 8000 })
})
await A.sleep(4000)
await A.shot('wh-22-other-person-tray')
A.log('other person tray:', await A.texts(2500))
A.log('stores on the device:\n' + listStores())
await A.quit()
