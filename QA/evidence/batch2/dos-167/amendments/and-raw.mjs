// node and-raw.mjs [outfile] — save the raw accessibility XML of the current screen for inspection.
import * as A from './and-appium.mjs'
import { writeFileSync } from 'node:fs'
async function main() {
  await A.newSession()
  const xml = await A.source()
  const out = A.EV + '/' + (process.argv[2] || 'and-raw') + '.xml'
  writeFileSync(out, xml)
  A.log('wrote', out, xml.length + ' chars')
  await A.quit()
}
main().catch(async (e) => {
  A.log('FAILED', e.message)
  await A.quit()
  process.exit(1)
})
