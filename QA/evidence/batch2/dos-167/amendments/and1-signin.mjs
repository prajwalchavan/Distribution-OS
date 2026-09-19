// DOS-167 Android delivery keep proof — step 1: sign in as the driver (Appium/UiAutomator2).
// node and1-signin.mjs <username> <shotPrefix>
import * as A from './and-appium.mjs'

const user = process.argv[2] || 'sachin.dalvi'
const prefix = process.argv[3] || 'and-01'
const PASS = 'Dos@1234'

const editAt = (i) => A.byId(i === 0 ? 'sign-in-username' : 'sign-in-password')

async function main() {
  await A.newSession()
  await A.sleep(2000)
  await A.dismissSystemDialogs()

  // wait for the bundle + sign-in form
  let e0 = null
  for (let i = 0; i < 60; i++) {
    await A.dismissSystemDialogs()
    e0 = await A.el(editAt(0))
    if (e0) break
    if (i % 5 === 0) A.log('waiting for the sign-in form …', (await A.texts(300)) || '(blank)')
    await A.sleep(3000)
  }
  if (!e0) {
    await A.shot(`${prefix}-NO-SIGNIN-FORM`)
    A.log('NO_SIGN_IN_FORM', await A.texts())
    await A.quit()
    process.exit(2)
  }
  A.log('sign-in screen:', await A.texts(1200))
  await A.shot(`${prefix}-signin-form`)

  await A.click(e0)
  await A.clear(e0)
  await A.setValue(e0, user)
  const e1 = await A.el(editAt(1))
  await A.click(e1)
  await A.clear(e1)
  await A.setValue(e1, PASS)
  await A.hideKeyboard()
  await A.sleep(500)
  await A.shot(`${prefix}-filled`)

  const submit = await A.el(A.byId('sign-in-submit'))
  if (!submit) throw new Error('sign-in-submit not found')
  await A.click(submit)
  A.log('clicked sign-in-submit')
  for (let i = 0; i < 30; i++) {
    await A.sleep(2000)
    const t = await A.texts(2000)
    if (!/Use the username|Invalid username|Sign in/.test(t)) break
    if (i % 5 === 0) A.log('after submit:', t.slice(0, 300))
  }
  await A.sleep(4000)
  await A.dismissSystemDialogs()
  A.log('HOME:', await A.texts(2500))
  await A.shot(`${prefix}-home`)
  A.log('sqlite dir:\n' + A.sqliteFiles())
  await A.quit()
}

main().catch(async (e) => {
  A.log('FAILED', e.message)
  try {
    await A.shot(`${prefix}-ERROR`)
  } catch {}
  await A.quit()
  process.exit(1)
})
