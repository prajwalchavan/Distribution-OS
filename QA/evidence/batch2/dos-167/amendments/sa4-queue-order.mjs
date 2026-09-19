// DOS-167 Android SALES sanity walk — step 4: with no signal, take a repeat order and queue it.
import * as A from './sa-appium.mjs'
const prefix = 'sa-04'

async function main() {
  await A.newSession()
  await A.sleep(3000)
  await A.dismissLogBox()
  A.log('shop screen:', await A.texts(600))
  await A.clickText('Take order')
  await A.sleep(4000)
  await A.dismissLogBox()
  A.log('ORDER SCREEN:', await A.texts(2500))
  await A.shot(`${prefix}-01-order-screen`)

  const repeat = await A.el(A.byId('repeat-last'))
  if (repeat) {
    await A.click(repeat)
    A.log('tapped repeat-last')
    await A.sleep(3000)
  } else {
    A.log('no repeat-last button; will add an item by hand')
  }
  await A.dismissLogBox()
  A.log('AFTER REPEAT:', await A.texts(2500))
  await A.shot(`${prefix}-02-lines`)

  const place = await A.el(A.byId('place-order'))
  if (!place) throw new Error('place-order not found')
  A.log('place button says:', await A.text(place).catch(() => '(no text)'))
  await A.shot(`${prefix}-03-before-place`)
  await A.click(place)
  A.log('tapped place-order')
  await A.sleep(5000)
  await A.dismissLogBox()
  A.log('AFTER PLACE:', await A.texts(2500))
  await A.shot(`${prefix}-04-after-place`)
  A.log('sqlite dir:\n' + A.sqliteFiles())
  await A.quit()
}
main().catch(async (e) => { A.log('FAILED', e.message); try { await A.shot(`${prefix}-ERROR`) } catch {}; await A.quit(); process.exit(1) })
