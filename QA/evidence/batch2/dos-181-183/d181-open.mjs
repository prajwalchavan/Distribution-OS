// DOS-181 — click one testID, then dump the screen that follows.
// node d181-open.mjs <testID> <dumpName>
import * as A from './d181-lib.mjs'

const id = process.argv[2]
const name = process.argv[3] || 'after-click'

async function main() {
  await A.newSession()
  await A.sleep(1200)
  await A.dismissAnr()
  await A.dismissLogBox()
  await A.clickId(id)
  await A.sleep(3500)
  await A.dismissAnr()
  await A.dismissLogBox()
  await A.dumpTree(name)
  const all = await A.nodes()
  for (const n of all) {
    if (n.id === '' && n.text === '' && n.desc === '') continue
    A.log(
      [
        n.id || '-',
        JSON.stringify((n.text || n.desc || '').slice(0, 90)),
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
  A.log('open FAILED', e.message)
  try {
    await A.shot(`${name}-ERROR`)
  } catch {}
  await A.quit()
  process.exit(1)
})
