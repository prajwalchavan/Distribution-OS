// DOS-167 Android SALES sanity walk — step 3: take an order with the office cut off.
import * as A from './sa-appium.mjs'
const prefix = 'sa-03b'

async function main() {
  await A.newSession()
  await A.sleep(3000)
  await A.dismissLogBox()
  A.log('start:', await A.texts(600))

  // wait until the app itself admits it has no signal
  let offline = false
  for (let i = 0; i < 24; i++) {
    const t = await A.texts(3000)
    if (/No signal|Offline since|no signal/i.test(t)) { offline = true; break }
    if (i % 4 === 0) A.log('waiting for the app to notice the cut …', /Updated/.test(t) ? '(still says Updated)' : t.slice(0, 120))
    await A.sleep(10000)
  }
  A.log('app says offline:', offline)
  await A.shot(`${prefix}-01-offline-strip`)
  A.log('SCREEN:', await A.texts(1500))
  await A.quit()
}
main().catch(async (e) => { A.log('FAILED', e.message); try { await A.shot(`${prefix}-ERROR`) } catch {}; await A.quit(); process.exit(1) })
