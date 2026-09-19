// DOS-167 Android delivery keep proof — queue a REAL op offline: money taken at a door.
// The amount goes in through the app's own numeric keypad (tapped digit by digit, by text), never by input text.
import * as A from './and-appium.mjs'

const AMOUNT = process.argv[2] || '5000'

async function main() {
  await A.newSession()
  await A.dismissLogBox()
  A.log('screen:', await A.texts(600))

  // the keypad should already be open; if not, open it from the amount field
  let done = await A.el(A.byText('Done'))
  if (!done) {
    const amt = await A.waitFor(A.byId('d5-amount'), 15000, 'd5-amount')
    if (!amt) throw new Error('d5-amount not found')
    await A.click(amt)
    await A.sleep(1500)
    done = await A.waitFor(A.byText('Done'), 8000, 'Done')
  }
  if (!done) throw new Error('the amount keypad did not open')

  const clear = await A.el(A.byText('Clear'))
  if (clear) {
    await A.click(clear)
    await A.sleep(400)
  }
  for (const d of AMOUNT.split('')) {
    const k = await A.waitFor(A.byText(d), 6000, 'key ' + d)
    if (!k) throw new Error('keypad digit not found: ' + d)
    await A.click(k)
    await A.sleep(250)
  }
  await A.shot('and-13-keypad-typed')
  A.log('keypad now:', await A.texts(400))
  await A.click(await A.el(A.byText('Done')))
  await A.sleep(1500)
  A.log('after Done:', await A.texts(1200))
  await A.shot('and-14-amount-entered')

  const rec = await A.waitFor(A.byId('d5-record'), 10000, 'd5-record')
  A.log('d5-record enabled=', await A.attr(rec, 'enabled'), 'desc=', await A.attr(rec, 'content-desc'))
  await A.click(rec)
  A.log('clicked d5-record')
  await A.sleep(4000)
  A.log('after save:', await A.texts(1500))
  await A.shot('and-15-after-take-money')
  await A.quit()
}

main().catch(async (e) => {
  A.log('MONEY FAILED', e.message)
  try {
    await A.shot('and-13-ERROR')
  } catch {}
  await A.quit()
  process.exit(1)
})
