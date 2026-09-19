// DOS-181 — read the LogBox overlay in full, screenshot it, then dismiss it.
// node d181-logbox.mjs <tag>
import * as A from './d181-lib.mjs'

const tag = process.argv[2] || 'logbox'

async function main() {
  await A.newSession()
  await A.sleep(1000)
  await A.shot(`${tag}-01-logbox`)
  await A.dumpTree(`${tag}-01-logbox`)
  A.log('LOGBOX TEXT:', await A.texts(6000))
  await A.dismissLogBox()
  await A.sleep(1500)
  await A.shot(`${tag}-02-dismissed`)
  A.log('after dismissing:', await A.texts(2500))
  await A.quit()
}

main().catch(async (e) => {
  A.log('logbox FAILED', e.message)
  await A.quit()
  process.exit(1)
})
