// DOS-167 amendment A5, run B — the same 20 s hold, but read ON THE HOME SCREEN, and then long enough for the
// queued order to go.
//
// Run A (a5-open-deadline.mjs) proved the mechanism: the caller is answered at 15 s with
// `fallback: {wanted: 'sqlite-web', reason: 'open timed out after 15s'}`, the late handle is opened → closed and
// never deleted, and the file survives. Two things it could NOT answer, because its reload landed on the order-entry
// route and its watch was 80 s:
//   1. does the app SAY so ON SCREEN while it is running on the memory store it fell back to?
//   2. does the queued order actually go once the persistent store is back and the network is free?
// This run reloads at "/" (the home screen, where <ConnectionStrip> and the offline footer live), watches through
// the deadline, and then waits three minutes with nothing blocked.
//
// It reuses run A's browser profile, so the OPFS file, the session and the queued order are the ones run A left.
// Usage: node a5b-deadline-on-screen.mjs
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
const STORE = `s${digits(RAHUL.userId)}${digits(RAHUL.tenantId)}`
const WANTED = `/${STORE}`
const NOT_PERSISTED = 'will not keep the offline copy'

const SLOW = /expo-sqlite\/(build\/index|web\/worker)\.bundle/
let DELAY = 20000
let delayActive = true

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const at = () => Date.now() - t0
const events = []
const push = (e) => {
  const row = { t: at(), ...e }
  events.push(row)
  console.log(JSON.stringify(row).slice(0, 420))
}

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1280, height: 860 } })
await ctx.addInitScript(() => {
  const Native = globalThis.Worker
  globalThis.__A5 = { msgs: [] }
  globalThis.Worker = class extends Native {
    postMessage(data, ...rest) {
      try {
        const d = data ?? {}
        const row = { t: Math.round(performance.now()), type: d.type ?? null, nativeDatabaseId: d.data?.nativeDatabaseId ?? null, databasePath: d.data?.databasePath ?? null }
        globalThis.__A5.msgs.push(row)
        if (['open', 'close', 'deleteDatabase'].includes(row.type)) console.warn(`A5MSG ${JSON.stringify(row)}`)
      } catch {
        /* watching must never break it */
      }
      return super.postMessage(data, ...rest)
    }
  }
})
const cache = new Map()
await ctx.route(
  (u) => u.origin === ORIGIN,
  async (route) => {
    const url = route.request().url()
    const slow = delayActive && DELAY > 0 && SLOW.test(url)
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

const net = []
const page = ctx.pages()[0] ?? (await ctx.newPage())
const watch = (source, target) =>
  target.on('console', (m) => {
    const text = m.text().slice(0, 400)
    if (!/offline:|A5MSG|running in memory|timed out|not a database|cannot create/i.test(text)) return
    push({ kind: 'console', source, text })
    if (/running in memory/.test(text))
      Promise.all(m.args().map((a) => a.jsonValue().catch(() => null)))
        .then((args) => push({ kind: 'console-detail', args }))
        .catch(() => {})
  })
watch('page', page)
page.on('worker', (w) => watch('worker', w))
page.on('request', (r) => {
  if (/:300\d\//.test(r.url())) net.push({ t: at(), kind: 'request', method: r.method(), path: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90) })
})
page.on('response', (r) => {
  if (/:300\d\//.test(r.url())) net.push({ t: at(), kind: 'response', status: r.status(), path: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90) })
})

const opfsWalk = (page) =>
  page
    .evaluate(async () => {
      const out = []
      const dir = await navigator.storage.getDirectory()
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file') continue
        const file = await handle.getFile()
        const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
        const end = head.indexOf(0)
        out.push({ name, size: file.size, sqlitePath: new TextDecoder().decode(head.subarray(0, end < 0 ? 512 : end)) })
      }
      return out.sort((a, b) => a.name.localeCompare(b.name))
    })
    .catch((e) => [{ error: String(e).slice(0, 150) }])
const facts = (files) => ({
  fileCount: files.length,
  headers: files.map((f) => f.sqlitePath).filter(Boolean),
  wantedPresent: files.some((f) => f.sqlitePath === WANTED),
  sizeOfWanted: files.filter((f) => f.sqlitePath === WANTED).map((f) => f.size),
})
const strip = async (p) => {
  const loc = p.locator('[data-testid=connection]:visible').first()
  return (await loc.count()) === 0 ? '(none)' : (await loc.innerText().catch(() => '?')).replace(/\s+/g, ' ').trim()
}
const shot = async (n) => {
  await page.screenshot({ path: join(OUT, n), fullPage: true }).catch(() => {})
  push({ kind: 'screenshot', file: n })
}

const R = { wantedHeader: WANTED, deadlineMs: 15000, delayMs: DELAY }
try {
  // ----------------------------------------------- the 20 s hold, watched on the HOME screen
  const from = at()
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 240000 })
  push({ kind: 'loaded', where: await page.evaluate(() => location.pathname).catch(() => '?') })
  const marks = []
  let shot17 = false
  let shot30 = false
  while (at() - from < 75000) {
    const body = await page.innerText('body').catch(() => '')
    const m = {
      t: at() - from,
      notPersisted: body.includes(NOT_PERSISTED),
      stillLoading: /Still loading the beat/i.test(body),
      strip: await strip(page),
      waiting: /waiting to send/i.test(body),
    }
    if (marks.length === 0 || JSON.stringify({ ...m, t: 0 }) !== JSON.stringify({ ...marks[marks.length - 1], t: 0 })) {
      marks.push(m)
      push({ kind: 'mark', ...m })
    }
    if (!shot17 && at() - from > 17000) {
      shot17 = true
      await shot('a5b-01-home-just-after-the-deadline.png')
      R.bodyAtDeadline = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 900)
    }
    if (!shot30 && at() - from > 30000) {
      shot30 = true
      await shot('a5b-02-home-while-the-late-open-lands.png')
    }
    await sleep(500)
  }
  R.marks = marks
  R.opfsAfterHold = facts(await opfsWalk(page))
  R.msgsHold = await page.evaluate(() => globalThis.__A5?.msgs?.filter((m) => ['open', 'close', 'deleteDatabase'].includes(m.type)) ?? []).catch(() => [])
  await shot('a5b-03-home-end-of-hold-window.png')

  // ----------------------------------------------- a normal load, nothing blocked, three minutes
  delayActive = false
  const from2 = at()
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 240000 })
  push({ kind: 'reloaded-normal' })
  const marks2 = []
  while (at() - from2 < 190000) {
    const body = await page.innerText('body').catch(() => '')
    const m = {
      t: at() - from2,
      notPersisted: body.includes(NOT_PERSISTED),
      strip: await strip(page),
      waiting: /waiting to send/i.test(body),
      uploads: net.filter((n) => n.kind === 'request' && /\/sync\/upload/.test(n.path)).length,
    }
    if (marks2.length === 0 || JSON.stringify({ ...m, t: 0 }) !== JSON.stringify({ ...marks2[marks2.length - 1], t: 0 })) {
      marks2.push(m)
      push({ kind: 'mark2', ...m })
    }
    await sleep(2000)
  }
  R.marks2 = marks2
  R.opfsEnd = facts(await opfsWalk(page))
  R.msgsNormal = await page.evaluate(() => globalThis.__A5?.msgs?.filter((m) => ['open', 'close', 'deleteDatabase'].includes(m.type)) ?? []).catch(() => [])
  await shot('a5b-04-after-three-minutes-online.png')
} catch (error) {
  R.crashed = String(error).slice(0, 300)
  push({ kind: 'crashed', text: R.crashed })
}

R.memoryLines = events.filter((e) => e.kind === 'console' && /running in memory/.test(e.text)).map((e) => ({ t: e.t, text: e.text }))
R.reasons = events.filter((e) => e.kind === 'console-detail').map((e) => e.args)
R.uploads = net.filter((n) => /\/sync\/upload/.test(n.path))
R.net = net
R.events = events
writeFileSync(join(OUT, 'a5b-result.json'), JSON.stringify(R, null, 1))
console.log('\n============ A5 run B ============')
console.log('on-screen marks during the hold:', JSON.stringify(R.marks))
console.log('reason:', JSON.stringify(R.reasons))
console.log('opfs after hold:', JSON.stringify(R.opfsAfterHold))
console.log('open/close/delete during the hold:', JSON.stringify(R.msgsHold))
console.log('marks after a normal load:', JSON.stringify(R.marks2))
console.log('uploads:', JSON.stringify(R.uploads))
console.log('opfs at the end:', JSON.stringify(R.opfsEnd))
await ctx.close()
