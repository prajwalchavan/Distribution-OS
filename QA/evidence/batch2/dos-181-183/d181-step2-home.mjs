// DOS-181 Android proof — step 2: clear the system dialogs, wait for the first sync pass, read home.
import * as A from './d181-lib.mjs'

async function main() {
  await A.newSession()
  await A.sleep(1500)
  for (const t of ['No thanks', 'While using the app', 'OK']) {
    const e = await A.el(A.byText(t))
    if (e) {
      const pkg = await A.attr(e, 'package').catch(() => '')
      if (String(pkg).startsWith('android') || String(pkg).includes('google')) {
        await A.click(e)
        A.log('dismissed', t, pkg)
        await A.sleep(1500)
      }
    }
  }
  await A.dismissAnr()
  await A.dismissLogBox()

  for (let i = 0; i < 40; i++) {
    await A.dismissAnr()
    const t = await A.texts(2500)
    if (!/Still filling this phone/.test(t) && /trip|Trip/.test(t)) break
    if (i % 4 === 0) A.log('home …', t.slice(0, 260))
    await A.sleep(5000)
  }
  await A.dismissLogBox()
  A.log('HOME:', await A.texts(3000))
  await A.shot('d181-05-home-ready')
  await A.dumpTree('d181-05-home-ready')
  await A.quit()
}

main().catch(async (e) => {
  A.log('FAILED', e.message)
  try {
    await A.shot('d181-05-ERROR')
  } catch {}
  await A.quit()
  process.exit(1)
})
