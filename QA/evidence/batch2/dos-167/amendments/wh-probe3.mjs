import * as A from './wh-lib.mjs'
await A.newSession()
await A.sleep(2000)
await A.dismissSystemDialogs()
A.adb(['shell','am','start','-a','android.intent.action.VIEW','-d','dos-warehouse://pick/7ff186e1-aa5c-76f5-9038-2d464dfb22a2','in.distributionos.warehouse'])
for (let i = 0; i < 12; i++) {
  await A.sleep(10000)
  const xml = await A.source()
  const picks = [...xml.matchAll(/resource-id="(w5-pick-[^"]+)"/g)].map((m) => m[1])
  const t = await A.texts(900)
  A.log(`t+${(i + 1) * 10}s picks=${picks.length}`, t.slice(0, 260))
  if (picks.length) { A.log('BUTTONS BACK:', JSON.stringify(picks)); break }
}
await A.shot('wh-32-cold-start-offline-sheet')
await A.quit()
