// DOS-167 Android SALES sanity walk — step 6: the same person is back; where is the kept change?
import * as A from './sa-appium.mjs'
const prefix = process.argv[2] || 'sa-07'

async function main() {
  await A.newSession()
  await A.sleep(4000)
  await A.dismissLogBox()
  A.log('HOME:', await A.texts(2000))
  await A.shot(`${prefix}-01-home`)

  await A.clickText('Orders')
  await A.sleep(3500)
  await A.dismissLogBox()
  A.log('ORDERS:', await A.texts(2500))
  await A.shot(`${prefix}-02-orders`)

  await A.clickText('Me')
  await A.sleep(3500)
  await A.dismissLogBox()
  A.log('ME:', await A.texts(2500))
  await A.shot(`${prefix}-03-me`)
  await A.quit()
}
main().catch(async (e) => { A.log('FAILED', e.message); try { await A.shot(`${prefix}-ERROR`) } catch {}; await A.quit(); process.exit(1) })
