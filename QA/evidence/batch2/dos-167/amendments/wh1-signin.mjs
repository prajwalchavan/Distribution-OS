// DOS-167 Android WAREHOUSE keep proof — step 1: sign in (Appium/UiAutomator2, by resource-id).
// node wh1-signin.mjs <username> <shotPrefix>
import * as A from './wh-appium.mjs'

const user = process.argv[2] || 'bharat.jadhav'
const prefix = process.argv[3] || 'wh-02'
const PASS = 'Dos@1234'

async function main() {
  await A.newSession()
  await A.sleep(2000)
  await A.dismissSystemDialogs()

  let e0 = null
  for (let i = 0; i < 60; i++) {
    await A.dismissSystemDialogs()
    e0 = await A.el(A.byId('sign-in-username'))
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
  const e1 = await A.el(A.byId('sign-in-password'))
  await A.click(e1)
  await A.clear(e1)
  await A.setValue(e1, PASS)
  await A.hideKeyboard()
  await A.sleep(2500)
  // several strategies: the RN testID lands in resource-id, the label in content-desc
  let submit = null
  for (let i = 0; i < 12; i++) {
    submit =
      (await A.el(A.byId('sign-in-submit'))) ||
      (await A.find('xpath', '//*[@resource-id="sign-in-submit"]')) ||
      (await A.find('xpath', '//android.widget.Button[@content-desc="Sign in"]'))
    if (submit) break
    A.log('submit not visible yet; look', i, 'texts:', (await A.texts(200)))
    await A.hideKeyboard()
    await A.sleep(2000)
  }
  await A.shot(`${prefix}-filled`)
  if (!submit) throw new Error('sign-in-submit not found after 12 looks')
  await A.click(submit)
  A.log('clicked sign-in-submit')
  for (let i = 0; i < 40; i++) {
    await A.sleep(2000)
    const t = await A.texts(2000)
    if (!/Ask your manager for a username/.test(t)) break
    if (i % 5 === 0) A.log('after submit:', t.slice(0, 300))
  }
  await A.sleep(6000)
  await A.dismissSystemDialogs()
  A.log('HOME:', await A.texts(2500))
  await A.shot(`${prefix}-home`)
  A.log('sqlite dir:\n' + A.sqliteFiles())
  await A.quit()
}

main().catch(async (e) => {
  A.log('FAILED', e.message)
  try { await A.shot(`${prefix}-ERROR`) } catch {}
  await A.quit()
  process.exit(1)
})
