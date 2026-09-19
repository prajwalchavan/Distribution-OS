// Shared warehouse-keep helpers on top of wh-appium.mjs: stale-safe interactions.
import * as A from './wh-appium.mjs'
export * from './wh-appium.mjs'

export async function locate(names) {
  for (const n of names) {
    const e = (await A.el(A.byId(n))) || (await A.find('xpath', `//*[@resource-id=${JSON.stringify(n)}]`))
    if (e) return e
  }
  return null
}

export async function waitId(name, timeoutMs = 30000) {
  const t0 = Date.now()
  for (;;) {
    const e = await locate([name])
    if (e) return e
    if (Date.now() - t0 > timeoutMs) return null
    await A.sleep(800)
  }
}

/** click by testID, re-finding every attempt so a re-render cannot leave a stale handle. */
export async function tapId(name, { timeout = 30000, label = name } = {}) {
  const t0 = Date.now()
  let lastErr = null
  for (;;) {
    const e = await locate([name])
    if (e) {
      try {
        await A.click(e)
        A.log('tapped', label)
        return true
      } catch (err) {
        lastErr = err
      }
    }
    if (Date.now() - t0 > timeout) throw new Error(`tapId ${name} failed: ${lastErr ? lastErr.message : 'not found'}`)
    await A.sleep(700)
  }
}

/** type into a field by testID, re-finding before each step. */
export async function typeId(name, value) {
  for (let i = 0; i < 6; i++) {
    try {
      let e = await locate([name])
      if (!e) throw new Error('not found')
      await A.click(e)
      await A.sleep(300)
      e = await locate([name])
      await A.clear(e).catch(() => {})
      await A.sleep(200)
      e = await locate([name])
      await A.setValue(e, value)
      A.log('typed into', name)
      return true
    } catch (err) {
      A.log('typeId retry', name, String(err.message).slice(0, 120))
      await A.sleep(900)
    }
  }
  throw new Error(`typeId ${name} failed`)
}

export async function signIn(user, prefix, pass = 'Dos@1234') {
  const form = await waitId('sign-in-username', 180000)
  if (!form) {
    await A.shot(`${prefix}-NO-SIGNIN-FORM`)
    throw new Error('no sign-in form: ' + (await A.texts(400)))
  }
  await A.shot(`${prefix}-signin-form`)
  await typeId('sign-in-username', user)
  await typeId('sign-in-password', pass)
  await A.hideKeyboard()
  await A.sleep(2000)
  await A.shot(`${prefix}-filled`)
  await tapId('sign-in-submit', { timeout: 40000 })
  for (let i = 0; i < 45; i++) {
    await A.sleep(2000)
    const t = await A.texts(2000)
    if (!/Ask your manager for a username/.test(t)) break
  }
  await A.sleep(5000)
  await A.dismissSystemDialogs()
  A.log('after sign-in:', await A.texts(2000))
  await A.shot(`${prefix}-home`)
}
