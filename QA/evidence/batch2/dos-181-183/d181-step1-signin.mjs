// DOS-181 Android proof — step 1: sign in as the driver and let the phone fill.
// node d181-step1-signin.mjs [username]
import * as A from './d181-lib.mjs'

const user = process.argv[2] || 'sachin.dalvi'
const PASS = 'Dos@1234'
const editAt = (i) => A.byId(i === 0 ? 'sign-in-username' : 'sign-in-password')

async function main() {
  await A.newSession()
  await A.sleep(2000)
  await A.dismissSystemDialogs()

  let e0 = null
  for (let i = 0; i < 60; i++) {
    await A.dismissSystemDialogs()
    await A.dismissLogBox()
    e0 = await A.el(editAt(0))
    if (e0) break
    if (i % 5 === 0) A.log('waiting for the sign-in form …', (await A.texts(300)) || '(blank)')
    await A.sleep(3000)
  }
  if (!e0) {
    await A.shot('d181-01-NO-SIGNIN-FORM')
    A.log('NO_SIGN_IN_FORM', await A.texts())
    await A.quit()
    process.exit(2)
  }
  A.log('sign-in screen:', await A.texts(1200))
  await A.shot('d181-01-signin-form')

  await A.typeInto('sign-in-username', user)
  await A.typeInto('sign-in-password', PASS)
  await A.hideKeyboard()
  await A.sleep(500)
  await A.shot('d181-02-signin-filled')

  await A.clickId('sign-in-submit')
  for (let i = 0; i < 30; i++) {
    await A.sleep(2000)
    const t = await A.texts(2000)
    if (!/Use the username|Invalid username/.test(t)) break
    if (i % 5 === 0) A.log('after submit:', t.slice(0, 300))
  }
  await A.sleep(4000)
  await A.dismissSystemDialogs()
  await A.dismissLogBox()
  A.log('HOME:', await A.texts(2500))
  await A.shot('d181-03-home')

  // let the first sync pass land
  for (let i = 0; i < 40; i++) {
    const t = await A.texts(2500)
    if (!/Still filling this phone/.test(t)) break
    if (i % 5 === 0) A.log('filling …', t.slice(0, 200))
    await A.sleep(5000)
  }
  await A.dismissSystemDialogs()
  await A.dismissLogBox()
  A.log('HOME after the pass:', await A.texts(2500))
  await A.shot('d181-04-home-filled')
  A.log('sqlite dir:\n' + A.sqliteFiles())
  await A.quit()
}

main().catch(async (e) => {
  A.log('FAILED', e.message)
  try {
    await A.shot('d181-01-ERROR')
  } catch {}
  await A.quit()
  process.exit(1)
})
