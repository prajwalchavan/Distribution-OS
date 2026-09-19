// node and-attr.mjs <resource-id> — print an element's addressing attributes.
import * as A from './and-appium.mjs'
const id = process.argv[2]
async function main() {
  await A.newSession()
  const e = await A.waitFor(A.byId(id), 15000, id)
  if (!e) {
    A.log('not found', id)
    await A.quit()
    return
  }
  const out = {}
  for (const a of ['enabled', 'clickable', 'focusable', 'displayed', 'bounds', 'content-desc', 'text', 'class', 'checked', 'selected']) {
    out[a] = await A.attr(e, a).catch((x) => 'ERR ' + x.message.slice(0, 80))
  }
  A.log(id, JSON.stringify(out))
  await A.quit()
}
main().catch(async (e) => {
  A.log('FAILED', e.message)
  await A.quit()
  process.exit(1)
})
