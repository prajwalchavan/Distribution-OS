// DOS-181 — press the footer button and watch what it DOES.
// node d181-step5-press.mjs <tag>
import * as A from './d181-lib.mjs'

const tag = process.argv[2] || 'd181-25'

async function main() {
  await A.newSession()
  await A.sleep(1000)
  await A.dismissAnr()
  await A.dismissLogBox()

  // The LogBox banner draws OVER the footer; a click on the button would open the LogBox panel
  // instead of pressing it (measured 21:11:55Z). Refuse to press while anything covers the button.
  const cover = (await A.nodes()).find(
    (n) =>
      /perform a React state update|Console Error|LogBox|Open debugger/i.test(n.text + n.desc) ||
      /logbox/i.test(n.id),
  )
  if (cover) {
    A.log('LOGBOX IS ON SCREEN — dismiss it before pressing:', JSON.stringify(cover.text || cover.desc))
    throw new Error('a LogBox overlay covers the footer; dismiss it first')
  }

  const before = await A.nodeById('d4-record')
  if (!before) throw new Error('d4-record is not on screen')
  A.log(
    'BEFORE the press: d4-record enabled=' +
      before.enabled +
      ' label=' +
      JSON.stringify(before.text || before.desc),
  )
  await A.shot(`${tag}-01-before-press`)

  const t0 = Date.now()
  await A.clickId('d4-record')
  A.log('PRESSED d4-record at', new Date(t0).toISOString())

  for (let i = 0; i < 14; i++) {
    await A.sleep(1500)
    const t = await A.texts(1600)
    A.log(`+${Date.now() - t0}ms`, t.slice(0, 300))
    if (/recorded|waiting to send|Credit note|could not|Could not/i.test(t)) break
  }
  await A.shot(`${tag}-02-after-press`)
  await A.dumpTree(`${tag}-02-after-press`)
  A.log('screen after the press:', await A.texts(2500))
  await A.quit()
}

main().catch(async (e) => {
  A.log('press FAILED', e.message)
  try {
    await A.shot(`${tag}-ERROR`)
  } catch {}
  await A.quit()
  process.exit(1)
})
