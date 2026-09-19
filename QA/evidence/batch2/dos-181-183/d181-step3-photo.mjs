// DOS-181 — attach the proof photograph on D4: scroll to d4-photo, press it, drive the camera,
// then read the footer again. node d181-step3-photo.mjs <tag>
import * as A from './d181-lib.mjs'

const tag = process.argv[2] || 'd181-13'

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
  await A.sleep(1200)
  await A.dismissAnr()
  await A.dismissLogBox()

  const target = await A.scrollToId('d4-photo')
  if (!target) throw new Error('d4-photo never came into view')
  await A.sleep(800)
  await A.shot(`${tag}-01-proof-panel`)
  await A.clickId('d4-photo')
  await A.sleep(4000)
  await A.dismissAnr()
  A.log('after the photo press:', await A.texts(1500))
  await report(`${tag}-02-camera`)
  await A.quit()
}

main().catch(async (e) => {
  A.log('step3 FAILED', e.message)
  try {
    await A.shot(`${tag}-ERROR`)
  } catch {}
  await A.quit()
  process.exit(1)
})
