// node and-press.mjs <resource-id> [holdMs] — press an element with a real touch down/pause/up at ITS OWN bounds
// (the element is addressed by resource-id; the pointer coordinates come from the element, never guessed).
import * as A from './and-appium.mjs'

const id = process.argv[2]
const hold = Number(process.argv[3] || 140)

async function main() {
  await A.newSession()
  await A.dismissLogBox()
  const e = await A.waitFor(A.byId(id), 20000, id)
  if (!e) throw new Error('not found ' + id)
  const b = await A.attr(e, 'bounds')
  const m = b.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  const x = Math.round((Number(m[1]) + Number(m[3])) / 2)
  const y = Math.round((Number(m[2]) + Number(m[4])) / 2)
  A.log('pressing', id, 'bounds', b, '->', x, y, 'hold', hold)
  await fetch('http://127.0.0.1:4725/session/' + A.sid + '/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: hold },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    }),
  }).then((r) => r.text().then((t) => A.log('actions ->', r.status, t.slice(0, 200))))
  await A.sleep(3000)
  A.log('after:', await A.texts(1200))
  await A.shot('press-' + id)
  await A.quit()
}

main().catch(async (e) => {
  A.log('PRESS FAILED', e.message)
  await A.quit()
  process.exit(1)
})
