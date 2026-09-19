// DOS-181 — scroll the current screen and dump what is on it.
// node d181-scroll.mjs <times> <dumpName>
import * as A from './d181-lib.mjs'

const times = Number(process.argv[2] || 1)
const name = process.argv[3] || 'scrolled'

async function main() {
  await A.newSession()
  await A.sleep(1000)
  await A.dismissAnr()
  await A.dismissLogBox()
  await A.swipeUp(times)
  await A.sleep(1200)
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
  await A.quit()
}

main().catch(async (e) => {
  A.log('scroll FAILED', e.message)
  await A.quit()
  process.exit(1)
})
