// DOS-167 Android SALES sanity walk — round 2: queue a second change for Rahul and keep it across sign-out.
import * as A from './sa-appium.mjs'
const prefix = 'sa-10'

async function main() {
  await A.newSession(); await A.sleep(3500); await A.dismissLogBox()
  // wait until the app admits the office is gone
  let offline = false
  for (let i = 0; i < 20; i++) {
    const t = await A.texts(2500)
    if (/No signal|Offline since/i.test(t)) { offline = true; break }
    await A.sleep(10000)
  }
  A.log('app says offline:', offline)
  await A.shot(`${prefix}-01-offline`)

  await A.clickText('Beat'); await A.sleep(3000); await A.dismissLogBox()
  A.log('BEAT:', await A.texts(1200))
  await A.clickText('Om Sai Provision Store', { contains: true }); await A.sleep(3500); await A.dismissLogBox()
  A.log('SHOP:', await A.texts(1200))
  await A.shot(`${prefix}-02-shop`)
  await A.clickText('Take order'); await A.sleep(4000); await A.dismissLogBox()
  const repeat = await A.el(A.byId('repeat-last'))
  if (repeat) { await A.click(repeat); A.log('tapped repeat-last'); await A.sleep(3000) }
  await A.dismissLogBox()
  A.log('LINES:', await A.texts(1500))
  await A.shot(`${prefix}-03-lines`)
  const place = await A.el(A.byId('place-order'))
  if (!place) throw new Error('place-order not found')
  await A.click(place); A.log('tapped place-order'); await A.sleep(5000); await A.dismissLogBox()
  A.log('AFTER PLACE:', await A.texts(2000))
  await A.shot(`${prefix}-04-saved`)
  await A.quit()
}
main().catch(async (e) => { A.log('FAILED', e.message); try { await A.shot(`${prefix}-ERROR`) } catch {}; A.log('AT FAILURE:', await A.texts(1500).catch(()=>'?')); await A.quit(); process.exit(1) })
