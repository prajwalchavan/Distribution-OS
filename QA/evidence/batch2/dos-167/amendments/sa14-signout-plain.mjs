import * as A from './sa-appium.mjs'
const prefix = 'sa-14'
async function main() {
  await A.newSession(); await A.sleep(3000); await A.dismissLogBox()
  let opened = false
  for (const probe of ['More', '⋯']) {
    const e = (await A.el(A.byDesc(probe))) ?? (await A.el(A.byText(probe)))
    if (e) { await A.click(e); opened = true; break }
  }
  if (!opened) throw new Error('header menu not found')
  await A.sleep(2000)
  await A.clickText('Sign out'); await A.sleep(3000)
  A.log('AFTER SIGN OUT TAP:', await A.texts(1500))
  await A.shot(`${prefix}-01-after-signout-tap`)
  const keep = await A.el(A.byText('Sign out, keep here'))
  if (keep) { await A.click(keep); A.log('a leave sheet appeared for the other person — clicked keep'); await A.sleep(5000) }
  A.log('NOW:', await A.texts(1200))
  await A.shot(`${prefix}-02-signed-out`)
  A.log('sqlite dir:\n' + A.sqliteFiles())
  await A.quit()
}
main().catch(async (e) => { A.log('FAILED', e.message); try { await A.shot(`${prefix}-ERROR`) } catch {}; await A.quit(); process.exit(1) })
