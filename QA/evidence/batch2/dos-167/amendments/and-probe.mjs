// DOS-167 Android probe: dump the current screen's addressable nodes (resource-id / text / desc) + a screenshot.
// node and-probe.mjs <shotName> [--tap <resource-id>] [--tap-text <text>] [--scroll-to <text>] [--wait <ms>]
import * as A from './and-appium.mjs'

const args = process.argv.slice(2)
const name = args[0] || 'probe'

function nodes(xml) {
  const out = []
  for (const n of xml.match(/<[a-zA-Z.]+[^>]*\/?>/g) || []) {
    const g = (k) => (n.match(new RegExp(`${k}="([^"]*)"`)) || [, ''])[1]
    const t = g('text'),
      d = g('content-desc'),
      r = g('resource-id'),
      c = g('clickable'),
      b = g('bounds')
    if (t || d || r || c === 'true') out.push(`${r ? 'id=' + r + ' ' : ''}${t ? 'text=' + JSON.stringify(t) + ' ' : ''}${d ? 'desc=' + JSON.stringify(d) + ' ' : ''}${c === 'true' ? 'CLICK ' : ''}${b}`)
  }
  return out
}

async function main() {
  await A.newSession()
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--wait') await A.sleep(Number(args[++i]))
    else if (args[i] === '--tap') {
      const id = args[++i]
      await A.dismissLogBox()
      const e = await A.waitFor(A.byId(id), 20000, id)
      if (!e) throw new Error('not found: id=' + id)
      await A.click(e)
      A.log('tapped id', id)
      await A.sleep(2500)
    } else if (args[i] === '--tap-text') {
      const t = args[++i]
      const e = (await A.waitFor(A.byText(t), 15000, t)) || (await A.waitFor(A.byDesc(t), 3000, t))
      if (!e) throw new Error('not found: text=' + t)
      await A.click(e)
      A.log('tapped text', t)
      await A.sleep(2500)
    } else if (args[i] === '--scroll-to') {
      const t = args[++i]
      await A.scrollIntoView(t)
      await A.sleep(800)
    }
  }
  const xml = await A.source()
  const list = nodes(xml)
  A.log(`--- ${name}: ${list.length} nodes ---\n` + list.join('\n'))
  await A.shot(name)
  await A.quit()
}

main().catch(async (e) => {
  A.log('PROBE FAILED', e.message)
  try {
    await A.shot(name + '-ERROR')
  } catch {}
  await A.quit()
  process.exit(1)
})
