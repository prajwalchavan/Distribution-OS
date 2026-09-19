// DOS-167 Android SALES sanity walk — step 5: sign out with 5 unsent changes, keeping them here.
import * as A from './sa-appium.mjs'
const prefix = 'sa-11'

async function main() {
  await A.newSession()
  await A.sleep(3000)
  await A.dismissLogBox()
  A.log('start:', await A.texts(500))

  // the account menu lives behind the header's "More" (⋯)
  let opened = false
  for (const probe of ['More', '⋯']) {
    const e = (await A.el(A.byDesc(probe))) ?? (await A.el(A.byText(probe)))
    if (e) { await A.click(e); opened = true; A.log('opened the header menu via', probe); break }
  }
  if (!opened) throw new Error('header menu not found')
  await A.sleep(2000)
  A.log('MENU:', await A.texts(1200))
  await A.shot(`${prefix}-01-account-menu`)

  await A.clickText('Sign out')
  await A.sleep(2500)
  A.log('LEAVE SHEET:', await A.texts(2000))
  await A.shot(`${prefix}-02-leave-sheet`)

  await A.clickText('Sign out, keep here')
  await A.sleep(6000)
  A.log('AFTER SIGN OUT:', await A.texts(1500))
  await A.shot(`${prefix}-03-signed-out`)
  A.log('sqlite dir:\n' + A.sqliteFiles())
  await A.quit()
}
main().catch(async (e) => { A.log('FAILED', e.message); try { await A.shot(`${prefix}-ERROR`) } catch {}; A.log('SCREEN AT FAILURE:', await A.texts(2000).catch(()=> '?')); await A.quit(); process.exit(1) })
