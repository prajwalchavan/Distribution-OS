// Diagnostic for "Save on this phone" on the deliver screen (d4-record): press it and sample the screen
// every 400 ms for 6 s, to catch a spinner, an error notice or a navigation that a later probe would miss.
import * as A from './and-appium.mjs'

async function main() {
  await A.newSession()
  await A.dismissLogBox()
  const rec = await A.waitFor(A.byId('d4-record'), 20000, 'd4-record')
  if (!rec) throw new Error('not on the deliver screen (d4-record missing)')
  A.log('before: enabled=', await A.attr(rec, 'enabled'), 'desc=', await A.attr(rec, 'content-desc'))
  A.log('before texts:', await A.texts(900))
  await A.click(rec)
  const t0 = Date.now()
  for (let i = 0; i < 15; i++) {
    const t = await A.texts(700)
    A.log(`+${Date.now() - t0}ms`, t)
    await A.sleep(400)
  }
  await A.shot('and-d4diag-after')
  await A.quit()
}

main().catch(async (e) => {
  A.log('D4DIAG FAILED', e.message)
  await A.quit()
  process.exit(1)
})
