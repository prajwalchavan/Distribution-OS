// DOS-181 — read the current screen: every node with a resource-id, text or content-desc.
// node d181-probe.mjs <dumpName>
import * as A from './d181-lib.mjs'

const name = process.argv[2] || 'probe'

async function main() {
  await A.newSession()
  await A.sleep(1500)
  await A.dismissSystemDialogs()
  await A.dismissLogBox()
  const size = await A.screenSize()
  A.log('screen', JSON.stringify(size))
  await A.dumpTree(name)
  const all = await A.nodes()
  for (const n of all) {
    if (n.id === '' && n.text === '' && n.desc === '') continue
    A.log(
      [
        n.id || '-',
        JSON.stringify(n.text || n.desc || ''),
        `enabled=${n.enabled}`,
        `click=${n.clickable}`,
        n.bounds ? `[${n.bounds.x1},${n.bounds.y1}][${n.bounds.x2},${n.bounds.y2}]` : '',
      ].join(' '),
    )
  }
  await A.shot(name)
  await A.quit()
}

main().catch(async (e) => {
  A.log('PROBE FAILED', e.message)
  await A.quit()
  process.exit(1)
})
