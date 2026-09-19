// DOS-181 — take the picture in the system camera and accept it, then read D4's footer again.
// node d181-step4-shutter.mjs <tag>
import * as A from './d181-lib.mjs'

const tag = process.argv[2] || 'd181-15'

async function report(name) {
  await A.dumpTree(name)
  const all = await A.nodes()
  for (const n of all) {
    if (n.id === '' && n.text === '' && n.desc === '') continue
    A.log(
      [
        n.id || '-',
        JSON.stringify((n.text || n.desc || '').slice(0, 80)),
        `enabled=${n.enabled}`,
        n.bounds ? `[${n.bounds.x1},${n.bounds.y1}][${n.bounds.x2},${n.bounds.y2}]` : '',
      ].join(' '),
    )
  }
  await A.shot(name)
}

async function main() {
  await A.newSession()
  await A.sleep(1000)
  const shutter = await A.waitFor(A.byId('com.android.camera2:id/shutter_button'), 20000, 'shutter')
  if (!shutter) throw new Error('no shutter button on screen')
  await A.click(shutter)
  A.log('pressed the shutter')
  await A.sleep(4000)
  await A.shot(`${tag}-01-after-shutter`)

  // The camera's review screen: accept with "Done" / the check mark.
  for (const id of ['com.android.camera2:id/done_button', 'com.android.camera2:id/btn_done']) {
    const e = await A.el(A.byId(id))
    if (e) {
      await A.click(e)
      A.log('accepted the photo with', id)
      break
    }
  }
  const done = await A.el(A.byDesc('Done'))
  if (done) {
    await A.click(done)
    A.log('accepted the photo with content-desc Done')
  }
  await A.sleep(6000)
  await A.dismissAnr()
  await A.dismissLogBox()
  A.log('back on:', await A.texts(1500))
  await report(`${tag}-02-back-on-d4`)
  await A.quit()
}

main().catch(async (e) => {
  A.log('step4 FAILED', e.message)
  try {
    await A.shot(`${tag}-ERROR`)
  } catch {}
  await A.quit()
  process.exit(1)
})
