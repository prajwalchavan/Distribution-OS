// DOS-167 ruling 3 (cc): an open that cannot finish must be ANNOUNCED, BOUNDED and NEVER A HANG.
// The expo-sqlite chunk and its worker are held back past OPEN_DEADLINE_MS (15 s), so `openStore` answers an
// announced memory store. The run then asks what the re-proof's real harm was about: does the app still sync, does
// it SAY it cannot keep — on every screen a rep works on all day, not only the beat — and is the console line there?
// Usage: node deadline.mjs --label dl-01 --delay 20000 [--app http://localhost:5175]
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1] }
const LABEL = arg('label', 'dl'), DELAY = Number(arg('delay', '20000')), APP = arg('app', 'http://localhost:5175')
const ORIGIN = new URL(APP).origin
const SLOW = new RegExp(arg('slow', 'expo-sqlite\\/(build\\/index|web\\/worker)\\.bundle'))
const OUT = join(HERE, 'runs'); mkdirSync(OUT, { recursive: true })
const CDP = `http://127.0.0.1:${process.env.PW_PORT ?? '9341'}`
const NOT_PERSISTED = 'will not keep the offline copy'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.connectOverCDP(CDP)
const t0 = Date.now(), events = []
const push = (e) => events.push({ t: Date.now() - t0, ...e })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['local-network-access'] })
await ctx.route((u) => u.origin === ORIGIN, async (route) => {
  const slow = DELAY > 0 && SLOW.test(route.request().url())
  let response
  try { response = await route.fetch() } catch { await route.continue().catch(() => {}); return }
  if (slow) { push({ kind: 'holding', url: route.request().url().split('/').pop().slice(0, 40) }); await sleep(DELAY); push({ kind: 'released' }) }
  const h = { ...response.headers() }
  delete h['content-encoding']; delete h['content-length']; delete h['transfer-encoding']
  h['cross-origin-opener-policy'] = 'same-origin'; h['cross-origin-embedder-policy'] = 'require-corp'; h['cross-origin-resource-policy'] = 'same-origin'
  await route.fulfill({ response, headers: h })
})
const page = await ctx.newPage()
const watch = (src, target) =>
  target.on('console', (m) => {
    const t = m.text().slice(0, 400)
    if (!/offline:|memory|sqlite|not a database|cannot create file|timed out/i.test(t)) return
    const entry = { kind: 'console', src, type: m.type(), text: t, args: null }
    push(entry)
    // console.warn's second argument is an object; its JSON is where ruling (cc)'s reason lives.
    Promise.all(m.args().map(async (a) => a.jsonValue().catch(() => null)))
      .then((args) => { entry.args = args })
      .catch(() => {})
  })
watch('page', page)
page.on('worker', (w) => watch('worker', w))
page.on('request', (r) => { if (/:300\d\//.test(r.url())) push({ kind: 'request', url: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120) }) })
await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 300000 })
await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 300000 })
await page.fill('[data-testid=sign-in-username]', 'rahul.deshmukh')
await page.fill('[data-testid=sign-in-password]', 'Dos@1234')
const signInAt = Date.now()
await page.click('[data-testid=sign-in-submit]')
await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 120000 })
push({ kind: 'signed-in' })
// Wait past the 15 s deadline, then walk the screens a rep works on all day.
await sleep(28000)
const screens = []
for (const [name, href] of [['beat', '/'], ['shops', '/shops'], ['orders', '/orders'], ['me', '/me'], ['settings', '/settings']]) {
  await page.locator(`a[href="${href}"]:visible`).first().click({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1600)
  const body = await page.innerText('body').catch(() => '')
  screens.push({ name, path: await page.evaluate(() => location.pathname), saysNotPersisted: body.includes(NOT_PERSISTED), stillLoadingBeat: /Still loading the beat/.test(body), body: body.slice(0, 220) })
  await page.screenshot({ path: join(OUT, `${LABEL}-${name}.png`) }).catch(() => {})
}
const opfs = await page.evaluate(async () => {
  const out = []
  try { for await (const [n, h] of (await navigator.storage.getDirectory()).entries()) out.push({ name: n, kind: h.kind }) } catch (e) { out.push({ error: String(e).slice(0, 120) }) }
  return out
})
const sync = events.filter((e) => e.kind === 'request' && /\/sync\//.test(e.url))
const memoryLines = events.filter((e) => /offline:/.test(e.text ?? '') && /memory/i.test(e.text ?? ''))
const reasonText = (e) => `${e.text} ${JSON.stringify(e.args ?? null)}`
const result = {
  label: LABEL, delayMs: DELAY, signInAt,
  memoryLines: memoryLines.map((e) => ({ t: e.t, text: e.text })),
  memoryLineDetails: memoryLines.map((e) => e.args),
  timeoutReasonNamed: memoryLines.some((e) => /timed out/i.test(reasonText(e))),
  syncCalls: sync.length, manifestCalls: sync.filter((e) => /manifest/.test(e.url)).length, pullCalls: sync.filter((e) => /pull/.test(e.url)).length,
  firstSyncAfterSignInMs: sync.length === 0 ? null : sync[0].t - (signInAt - t0),
  screens, opfsTopLevel: opfs, events,
}
result.pass = result.timeoutReasonNamed && result.manifestCalls > 0 && result.pullCalls > 0 &&
  screens.every((s) => s.saysNotPersisted) && screens.every((s) => !s.stillLoadingBeat)
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(result, null, 1))
console.log(`[${LABEL}] delay=${DELAY} pass=${result.pass} memoryLine=${result.timeoutReasonNamed} manifest=${result.manifestCalls} pull=${result.pullCalls} screensSayingNotKept=${screens.filter((s) => s.saysNotPersisted).map((s) => s.name).join(',')} stillLoading=${screens.filter((s) => s.stillLoadingBeat).map((s) => s.name).join(',') || 'none'}`)
console.log(`  lines: ${JSON.stringify(result.memoryLines.map((l) => l.text.slice(0, 150)))}`)
await ctx.close(); await browser.close()
