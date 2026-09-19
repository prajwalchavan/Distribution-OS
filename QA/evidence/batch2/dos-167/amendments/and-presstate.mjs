// node and-presstate.mjs <resource-id> — hold the element down for 2.5 s and screenshot mid-press, to see whether
// the Pressable receives the touch at all (pressed style) or the touch never reaches it.
import * as A from './and-appium.mjs'

const id = process.argv[2]

async function main() {
  await A.newSession()
  const e = await A.waitFor(A.byId(id), 20000, id)
  if (!e) throw new Error('not found ' + id)
  const b = await A.attr(e, 'bounds')
  const m = b.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  const x = Math.round((Number(m[1]) + Number(m[3])) / 2)
  const y = Math.round((Number(m[2]) + Number(m[4])) / 2)
  A.shotAdb(id + '-before-press')
  const p = fetch('http://127.0.0.1:4725/session/' + A.sid + '/actions', {
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
            { type: 'pause', duration: 2500 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    }),
  })
  await A.sleep(1200)
  A.shotAdb(id + '-during-press')
  await p
  await A.sleep(2500)
  A.shotAdb(id + '-after-press')
  A.log('after:', await A.texts(900))
  await A.quit()
}

main().catch(async (e) => {
  A.log('FAILED', e.message)
  await A.quit()
  process.exit(1)
})
