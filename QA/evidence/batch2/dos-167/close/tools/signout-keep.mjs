/**
 * DOS-167 close — phase B5: sign out while two ops are still waiting, and KEEP them on this phone.
 * The sheet's own words and its buttons are captured; the button pressed is "Sign out, keep here".
 */
import fs from 'node:fs'

import { newSession, Session, sleep, waitFor } from './drive.mjs'

const OUT = '/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/close'
const lines = []
const say = (s) => {
  lines.push(`${new Date().toISOString()} ${s}`)
  console.log(s)
}
const save = () => fs.writeFileSync(`${OUT}/B9-signout-keep.txt`, lines.join('\n') + '\n')

const sess = new Session(await newSession('in.distributionos.sales'))
say(`session ${sess.id}`)

/**
 * LogBox's collapsed banner is drawn over the footer and swallows presses on the buttons BELOW it as
 * well as on the tab bar — it is what made "Take order" and "Save on this phone" look dead. Tapping the
 * banner dismisses it; nothing in the app is tapped through it.
 */
async function clearLogBox() {
  for (let i = 0; i < 3; i += 1) {
    const t = await sess.texts()
    if (!t.some((x) => x.includes('Open debugger to view'))) return i === 0 ? 'not shown' : 'dismissed'
    await sess.click(await sess.byDesc('!, Open debugger to view warnings.'))
    await sleep(1500)
    const after = await sess.texts()
    if (after.includes('Dismiss')) {
      await sess.click(await sess.byText('Dismiss'))
      await sleep(1000)
    }
  }
  return 'still shown'
}
say(`logbox: ${await clearLogBox()}`)
say(`before sign-out: ${(await sess.texts()).slice(0, 8).join(' | ')}`)
await sess.shot('B9-1-before-signout')

// the account menu is the "⋯" in the app header
await sess.click(await sess.byDesc('More'))
await sleep(2000)
await sess.shot('B9-2-menu')
say(`menu: ${(await sess.texts()).slice(0, 20).join(' | ')}`)

await waitFor(async () => (await sess.texts()).includes('Sign out'), { timeout: 30000, what: 'the Sign out item' })
await sess.click(await sess.byText('Sign out'))
await sleep(2500)
await sess.shot('B9-3-leave-sheet')
const sheet = await sess.texts()
say(`THE SHEET SAYS: ${sheet.join(' | ')}`)

const keep = sheet.find((t) => t.includes('keep here'))
say(`keep button: ${keep ?? 'NOT OFFERED'}`)
if (keep === undefined) {
  save()
  throw new Error('the sheet did not offer to keep the change')
}
await sess.click(await sess.byText(keep))
await sleep(6000)
await sess.shot('B9-4-signed-out')
say(`after keep: ${(await sess.texts()).slice(0, 14).join(' | ')}`)
save()
