// A4, run E — PHOTOGRAPH the sentence. Runs C and A read "This browser will not keep the offline copy after you
// close it" out of tab 2's DOM, but the beat screen scrolls inside its own container, so the viewport shot stopped
// above it. This opens the same two tabs again and scrolls tab 2 to where the app says it, then shows tab 1's foot
// beside it for the contrast (tab 1 keeps; tab 2 does not).
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire('/Users/prajwalchavan/Desktop/Distribution OS/QA/tools/package.json')
const { chromium } = require('playwright')
const APP = 'http://localhost:5175'
const ORIGIN = new URL(APP).origin
const PROFILE =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/a4c-profile'
mkdirSync(HERE, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NOT_PERSISTED = 'will not keep the offline copy'
const out = {}

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1280, height: 860 } })
await ctx.route(
  (u) => u.origin === ORIGIN,
  async (route) => {
    let response
    try {
      response = await route.fetch()
    } catch {
      return void (await route.continue().catch(() => {}))
    }
    const h = { ...response.headers() }
    delete h['content-encoding']
    delete h['content-length']
    delete h['transfer-encoding']
    h['cross-origin-opener-policy'] = 'same-origin'
    h['cross-origin-embedder-policy'] = 'require-corp'
    h['cross-origin-resource-policy'] = 'same-origin'
    await route.fulfill({ response, headers: h })
  },
)
await ctx.grantPermissions(['local-network-access'], { origin: ORIGIN }).catch(() => {})

const scrollDown = (page) =>
  page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight)
    for (const el of document.querySelectorAll('div')) if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight
  })

try {
  const t1 = ctx.pages()[0] ?? (await ctx.newPage())
  await t1.goto(APP, { waitUntil: 'domcontentloaded', timeout: 180000 })
  if ((await t1.locator('[data-testid=sign-in-username]').count()) > 0) {
    await t1.fill('[data-testid=sign-in-username]', 'rahul.deshmukh')
    await t1.fill('[data-testid=sign-in-password]', 'Dos@1234')
    await t1.click('[data-testid=sign-in-submit]')
    await t1.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 120000 })
  }
  await sleep(12000)
  await scrollDown(t1)
  await sleep(1200)
  out.tab1Foot = (await t1.innerText('body').catch(() => '')).slice(-500)
  out.tab1NotPersisted = out.tab1Foot.includes(NOT_PERSISTED)
  await t1.screenshot({ path: join(HERE, 'a4e-01-tab1-foot-keeps.png') })

  const t2 = await ctx.newPage()
  t2.on('console', (m) => {
    if (/offline:/.test(m.text())) out.tab2Console = (out.tab2Console ?? []).concat(m.text().split('\n')[0].slice(0, 220))
  })
  await t2.goto(APP, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await sleep(16000)
  await scrollDown(t2)
  await sleep(1500)
  const body2 = await t2.innerText('body').catch(() => '')
  out.tab2NotPersisted = body2.includes(NOT_PERSISTED)
  out.tab2Foot = body2.slice(-500)
  await t2.screenshot({ path: join(HERE, 'a4e-02-tab2-foot-says-memory.png') })
  const line = t2.locator(`text=${NOT_PERSISTED}`).first()
  if ((await line.count()) > 0) {
    await line.scrollIntoViewIfNeeded().catch(() => {})
    await sleep(600)
    await line.screenshot({ path: join(HERE, 'a4e-03-tab2-the-sentence.png') }).catch(() => {})
    out.sentenceShot = true
  }
  // Back to tab 1 with tab 2 still open: the same foot must still say nothing of the sort.
  await scrollDown(t1)
  await sleep(1000)
  const body1 = await t1.innerText('body').catch(() => '')
  out.tab1NotPersistedWithTab2Open = body1.includes(NOT_PERSISTED)
  await t1.screenshot({ path: join(HERE, 'a4e-04-tab1-foot-while-tab2-open.png') })
} catch (error) {
  out.fatal = String(error).slice(0, 400)
} finally {
  writeFileSync(join(HERE, 'a4e-result.json'), JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
  await ctx.close().catch(() => {})
}
