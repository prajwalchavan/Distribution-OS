import * as A from './wh-appium.mjs'
await A.newSession()
await A.sleep(1500)
await A.dismissSystemDialogs()
const tries = {
  'uiauto resourceId': A.byId('sign-in-submit'),
  'uiauto desc': A.byDesc('Sign in'),
  'uiauto text': A.byText('Sign in'),
}
for (const [k, loc] of Object.entries(tries)) {
  const all = await A.findAll(loc[0], loc[1])
  console.log(k, '->', all.length)
}
for (const xp of ['//*[@resource-id="sign-in-submit"]', '//android.widget.Button[@content-desc="Sign in"]']) {
  const all = await A.findAll('xpath', xp)
  console.log('xpath', xp, '->', all.length)
}
// also try 'id' strategy
for (const idv of ['sign-in-submit', 'in.distributionos.warehouse:id/sign-in-submit']) {
  const all = await A.findAll('id', idv)
  console.log('id', idv, '->', all.length)
}
await A.quit()
