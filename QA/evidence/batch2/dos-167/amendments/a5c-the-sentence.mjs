// DOS-167 amendment A5, run C — a photograph of the SENTENCE, and a correct OPFS walk.
//
// Run B proved the home screen carries the not-kept line the moment the 15 s deadline passes (its `notPersisted`
// mark went true at 15.8 s), but its screenshots were of the viewport and the line sits in the footer of an inner
// scroller, so no image shows it. Run B's OPFS walk was also shallow — wa-sqlite's pool lives in the `expo-sqlite`
// SUBDIRECTORY, so it reported an empty root and proved nothing either way. Both are fixed here.
//
// Same 20 s hold on the expo-sqlite chunk and worker; same profile; this run only looks.
// Usage: node a5c-the-sentence.mjs
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
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/a5-profile'
const OUT = HERE
mkdirSync(OUT, { recursive: true })
const RAHUL = { userId: '8760e17e-4830-7395-a946-1e02fffa1ad7', tenantId: '01a0b9b5-4765-777d-8073-f34f3a983513' }
const digits = (id) => BigInt(`0x${id.toLowerCase().replaceAll('-', '')}`).toString(36).padStart(25, '0')
const WANTED = `/s${digits(RAHUL.userId)}${digits(RAHUL.tenantId)}`
const NOT_PERSISTED = 'will not keep the offline copy'
const SLOW = /expo-sqlite\/(build\/index|web\/worker)\.bundle/
const DELAY = 20000
let delayActive = true

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const at = () => Date.now() - t0
const events = []
const push = (e) => {
  const row = { t: at(), ...e }
  events.push(row)
  console.log(JSON.stringify(row).slice(0, 400))
}

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1280, height: 860 } })
const cache = new Map()
await ctx.route(
  (u) => u.origin === ORIGIN,
  async (route) => {
    const url = route.request().url()
    const slow = delayActive && SLOW.test(url)
    let response = null
    try {
      response = await route.fetch()
    } catch {
      response = null
    }
    if (response === null) {
      const hit = cache.get(url)
      if (hit === undefined) return void (await route.abort().catch(() => {}))
      if (slow) await sleep(DELAY)
      return void (await route.fulfill(hit).catch(() => {}))
    }
    if (slow) {
      const began = Date.now()
      await sleep(DELAY)
      push({ kind: 'held', url: url.replace(ORIGIN, '').slice(0, 60), heldMs: Date.now() - began })
    }
    const headers = { ...response.headers() }
    delete headers['content-encoding']
    delete headers['content-length']
    delete headers['transfer-encoding']
    headers['cross-origin-opener-policy'] = 'same-origin'
    headers['cross-origin-embedder-policy'] = 'require-corp'
    headers['cross-origin-resource-policy'] = 'same-origin'
    const body = await response.body().catch(() => null)
    if (body !== null) cache.set(url, { status: response.status(), headers, body })
    await route.fulfill(body === null ? { response, headers } : { status: response.status(), headers, body }).catch(() => {})
  },
)
await ctx.grantPermissions(['local-network-access'], { origin: ORIGIN }).catch(() => {})

const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('console', (m) => {
  const text = m.text().slice(0, 400)
  if (!/running in memory|timed out|offline:/i.test(text)) return
  push({ kind: 'console', text })
  Promise.all(m.args().map((a) => a.jsonValue().catch(() => null)))
    .then((args) => push({ kind: 'detail', args }))
    .catch(() => {})
})

const opfsWalk = () =>
  page
    .evaluate(async () => {
      const out = []
      async function walk(dir, prefix) {
        for await (const [name, handle] of dir.entries()) {
          const path = prefix + name
          if (handle.kind === 'directory') {
            out.push({ path: `${path}/`, kind: 'directory' })
            await walk(handle, `${path}/`)
            continue
          }
          const file = await handle.getFile()
          const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
          const end = head.indexOf(0)
          const magic = new Uint8Array(await file.slice(4096, 4112).arrayBuffer())
          out.push({
            path,
            kind: 'file',
            size: file.size,
            sqlitePath: new TextDecoder().decode(head.subarray(0, end < 0 ? 512 : end)),
            magic: new TextDecoder().decode(magic).replace(/\0/g, ''),
          })
        }
      }
      await walk(await navigator.storage.getDirectory(), '')
      return out.sort((a, b) => a.path.localeCompare(b.path))
    })
    .catch((e) => [{ error: String(e).slice(0, 200) }])

const R = { wantedHeader: WANTED, delayMs: DELAY, deadlineMs: 15000 }
try {
  const from = at()
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 240000 })
  // wait for the line itself, with a bound a little past the deadline
  const line = page.locator(`text=${NOT_PERSISTED}`).first()
  R.lineAppearedMs = await line
    .waitFor({ timeout: 40000 })
    .then(() => at() - from)
    .catch(() => null)
  push({ kind: 'line', appearedAfterMs: R.lineAppearedMs })
  if (R.lineAppearedMs !== null) {
    await line.scrollIntoViewIfNeeded().catch(() => {})
    await sleep(600)
    R.lineText = (await line.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    await page.screenshot({ path: join(OUT, 'a5c-01-the-sentence-on-screen.png') }).catch(() => {})
    const box = await line.boundingBox().catch(() => null)
    if (box !== null)
      await page
        .screenshot({
          path: join(OUT, 'a5c-02-the-sentence-closeup.png'),
          clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 60), width: Math.min(1200, box.width + 260), height: box.height + 120 },
        })
        .catch(() => {})
  }
  // let the late handle land, then look at the disk
  await sleep(45000)
  R.opfsAfterLateClose = await opfsWalk()
  R.wantedPresent = R.opfsAfterLateClose.some((f) => f.sqlitePath === WANTED)
  R.headers = R.opfsAfterLateClose.filter((f) => f.sqlitePath).map((f) => f.sqlitePath)
  push({ kind: 'opfs', wantedPresent: R.wantedPresent, headers: R.headers, files: R.opfsAfterLateClose.filter((f) => f.kind === 'file').length })
  await page.screenshot({ path: join(OUT, 'a5c-03-after-the-late-handle-closed.png') }).catch(() => {})
} catch (error) {
  R.crashed = String(error).slice(0, 300)
  push({ kind: 'crashed', text: R.crashed })
}
R.events = events
writeFileSync(join(OUT, 'a5c-result.json'), JSON.stringify(R, null, 1))
console.log('\n============ A5 run C ============')
console.log('line appeared after (ms):', R.lineAppearedMs, '|', JSON.stringify(R.lineText))
console.log('reasons:', JSON.stringify(events.filter((e) => e.kind === 'detail').map((e) => e.args)))
console.log('opfs:', JSON.stringify({ wantedPresent: R.wantedPresent, headers: R.headers }))
await ctx.close()
