// DOS-167 Android SALES sanity walk — step 2: cut the office, then queue an order offline.
import * as A from './sa-appium.mjs'

const prefix = 'sa-02'

async function main() {
  // --- the cut: airplane mode AND the loopback tunnel to the sales service removed.
  A.adb(['shell', 'cmd', 'connectivity', 'airplane-mode', 'enable'])
  A.log('airplane mode ON')
  try { A.adb(['reverse', '--remove', 'tcp:3003']) } catch (e) { A.log('reverse remove:', String(e).slice(0,120)) }
  A.log('reverse list after cut:\n' + A.adb(['reverse', '--list']))

  await A.newSession()
  await A.sleep(3000)
  await A.dismissSystemDialogs()
  A.log('SCREEN:', await A.texts(1500))
  await A.shot(`${prefix}-01-home-offline`)

  // open the first shop on the beat
  await A.clickText('Shree Ganesh Kirana', { contains: true })
  await A.sleep(3000)
  A.log('SHOP:', await A.texts(2500))
  await A.shot(`${prefix}-02-shop`)
  await A.quit()
}

main().catch(async (e) => {
  A.log('FAILED', e.message)
  try { await A.shot(`${prefix}-ERROR`) } catch {}
  await A.quit()
  process.exit(1)
})
