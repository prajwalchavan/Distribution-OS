// DOS-167 ruling-3 merge review, owed web walk A4: a SECOND TAB of the same person on the same browser profile.
// (aa)'s chain is per page, so two tabs are two wa-sqlite instances over one OPFS directory — the shape that, left
// concurrent inside ONE page, destroyed the store. Neither tab may poison the pool, and whichever cannot have the
// file must say so rather than pretend.
// Usage: node twotabs.mjs --label tt-01
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1] }
const LABEL = arg('label', 'tt'), APP = arg('app', 'http://localhost:5175')
const ORIGIN = new URL(APP).origin
const OUT = join(HERE, 'runs'); mkdirSync(OUT, { recursive: true })
const CDP = `http://127.0.0.1:${process.env.PW_PORT ?? '9341'}`
const RAHUL = '/s80j3azqcg6our25a35rhwbg7r03guzv9zghwmmy1imsvb8cmft'
const NOT_PERSISTED = 'will not keep the offline copy'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const lines = []
const browser = await chromium.connectOverCDP(CDP)
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['local-network-access'] })
await ctx.route((u) => u.origin === ORIGIN, async (route) => {
  let response
  try { response = await route.fetch() } catch { await route.continue().catch(() => {}); return }
  const h = { ...response.headers() }
  delete h['content-encoding']; delete h['content-length']; delete h['transfer-encoding']
  h['cross-origin-opener-policy'] = 'same-origin'; h['cross-origin-embedder-policy'] = 'require-corp'; h['cross-origin-resource-policy'] = 'same-origin'
  await route.fulfill({ response, headers: h })
})
const walk = (page) => page.evaluate(async () => {
  const out = []
  async function w(dir, p) { for await (const [n, h] of dir.entries()) { const path = p + n
      if (h.kind === 'directory') await w(h, `${path}/`)
      else { const e = { path }; try { const f = await h.getFile(); e.size = f.size
          const b = new Uint8Array(await f.slice(0, 512).arrayBuffer()); const z = b.indexOf(0)
          e.sqlitePath = new TextDecoder().decode(b.subarray(0, z < 0 ? 512 : z)) } catch (err) { e.error = String(err).slice(0, 120) }
        out.push(e) } } }
  try { await w(await navigator.storage.getDirectory(), '') } catch (err) { out.push({ path: '(root)', error: String(err).slice(0, 120) }) }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}).catch(() => [])
const facts = async (page, who) => {
  const files = await walk(page)
  const body = await page.innerText('body').catch(() => '')
  return { who, headers: files.filter((f) => f.sqlitePath).map((f) => f.sqlitePath), poolFiles: files.length,
    unreadable: files.filter((f) => f.error).length, junk: files.filter((f) => f.sqlitePath && !/^\/[sdwh][0-9a-z]{50}$/.test(f.sqlitePath)).map((f) => f.sqlitePath),
    saysNotPersisted: body.includes(NOT_PERSISTED), stillLoading: /Still loading the beat/.test(body), path: await page.evaluate(() => location.pathname) }
}
const attach = (page, tag) => {
  page.on('console', (m) => { const t = m.text().slice(0, 300); if (/offline:|sqlite|not a database|cannot create file|memory/i.test(t)) lines.push({ tab: tag, type: m.type(), text: t }) })
  page.on('pageerror', (e) => lines.push({ tab: tag, type: 'pageerror', text: String(e).slice(0, 200) }))
}
const sync = []
const netWatch = (page, tag) => page.on('request', (r) => { if (/:300\d\/sync\//.test(r.url())) sync.push({ tab: tag, url: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 100) }) })

const t1 = await ctx.newPage(); attach(t1, 'tab1'); netWatch(t1, 'tab1')
await t1.goto(APP, { waitUntil: 'domcontentloaded', timeout: 300000 })
await t1.waitForSelector('[data-testid=sign-in-username]', { timeout: 300000 })
await t1.fill('[data-testid=sign-in-username]', 'rahul.deshmukh')
await t1.fill('[data-testid=sign-in-password]', 'Dos@1234')
await t1.click('[data-testid=sign-in-submit]')
await t1.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 120000 })
await sleep(9000)
const tab1Before = await facts(t1, 'tab1 before the second tab')

// The second tab of the SAME person, same profile, while the first still holds the file.
const t2 = await ctx.newPage(); attach(t2, 'tab2'); netWatch(t2, 'tab2')
await t2.goto(APP, { waitUntil: 'domcontentloaded', timeout: 300000 })
await sleep(22000)
const tab2 = await facts(t2, 'tab2 after its own boot')
const tab1After = await facts(t1, 'tab1 after the second tab opened')
await t1.screenshot({ path: join(OUT, `${LABEL}-tab1.png`) }).catch(() => {})
await t2.screenshot({ path: join(OUT, `${LABEL}-tab2.png`) }).catch(() => {})
const bad = lines.filter((l) => /not a database|cannot create file|SQLiteError/i.test(l.text))
const result = { label: LABEL, tab1Before, tab2, tab1After, consoleLines: lines, badLines: bad, syncCalls: sync,
  rahulHeaderPresentThroughout: [tab1Before, tab2, tab1After].every((f) => f.headers.includes(RAHUL)),
  noJunk: [tab1Before, tab2, tab1After].every((f) => f.junk.length === 0 && f.unreadable === 0 && f.poolFiles <= 6),
  tab1KeptWorking: tab1After.stillLoading === false && tab1After.saysNotPersisted === false }
result.pass = result.noJunk && bad.length === 0 && result.rahulHeaderPresentThroughout && result.tab1KeptWorking
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(result, null, 1))
console.log(`[${LABEL}] pass=${result.pass} noJunk=${result.noJunk} bad=${bad.length} rahulHeaderThroughout=${result.rahulHeaderPresentThroughout} tab1Working=${result.tab1KeptWorking}`)
console.log(`  tab2: headers=${JSON.stringify(tab2.headers)} notPersisted=${tab2.saysNotPersisted} stillLoading=${tab2.stillLoading} path=${tab2.path}`)
console.log(`  lines: ${JSON.stringify(lines.map((l) => `${l.tab}:${l.text.slice(0, 90)}`))}`)
await ctx.close(); await browser.close()
