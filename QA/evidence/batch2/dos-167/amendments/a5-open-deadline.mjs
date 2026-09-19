// DOS-167 amendment A5 — the 15 s open deadline, OPERATED in a real browser on main ff28995.
//
// A5 (Fable, 2026-09-19): "on the 15 s open deadline the caller receives a memory store while the real open
// continues on the chain; a persistent handle that arrives late is CLOSED and the on-disk file is left intact —
// never destroyed (answer A). OPEN_DEADLINE_MS must be generous enough that a slow-but-succeeding OPFS open is not
// routinely abandoned to memory."
//
// The re-proof it asks for: "a web run with the expo-sqlite chunk held past 15 s ends in a memory store with the
// `offline: … running in memory` line and reason `open timed out after 15s`, and the persistent file (if one had
// existed with a queued order) is still present and recovers on the next normal load."
//
// HOW THE OPEN IS MADE SLOW — the ruling's own mechanism (re-proof item 2): the expo-sqlite main-thread chunk
// `node_modules/expo-sqlite/build/index.bundle` and its worker bundle `node_modules/expo-sqlite/web/worker.bundle`
// are HELD BACK at the network by --delay ms each, exactly as `QA/tools/e2e/dos-167-s138-web-store.mjs` holds them
// at 600 / 1500 ms. Those two holds are sequential (the worker is only asked for once the chunk has run), so a hold
// of 20 000 ms puts the real open past 40 s and the 15 s deadline lands in the middle of the FIRST hold.
//
// FOUR PHASES, ONE browser profile, so OPFS survives between them:
//   P1 setup    delay 0      — sign in, a persistent OPFS store, one order queued with the page offline.
//   P2 timeout  delay 20000  — reload. The caller must be answered at the deadline with a memory store whose reason
//                              is `open timed out after 15s`, BEFORE the real open is even issued; when the real
//                              handle lands it must be CLOSED and never deleted; the file must still be on disk.
//   P3 survival delay 0      — reload. The persistent store must open again, with the queued order still in it, and
//                              then send it once when the upload endpoint is unblocked.
//   P4 slow-ok  delay 5000   — reload. ~11 s of held bundles is UNDER the deadline: the open must NOT be abandoned.
//
// WHAT IS WATCHED, and where each fact comes from:
//   * `offline: no persistent store; running in memory` + its detail — the app's own console sink (ruling 3 (dd)).
//   * every message the product sends expo-sqlite's worker — a harness-side wrapper around `Worker.postMessage`
//     installed as an init script. `open` carries {nativeDatabaseId, databasePath}, `close` carries the same id,
//     `deleteDatabase` carries the path, so close-vs-destroy is read off the wire, not inferred.
//   * `DOSDIAG …` lines — QA/tools/e2e/dos-167-s138-instrument.mjs, already applied to node_modules (A3).
//   * the OPFS pool walk — each wa-sqlite pool file carries its SQLite path in the first 512 bytes.
//
// Nothing here writes to any database but dos_qa, through the app, as the app.
// Usage: node a5-open-deadline.mjs
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire('/Users/prajwalchavan/Desktop/Distribution OS/QA/tools/package.json')
const { chromium } = require('playwright')

const APP = 'http://localhost:5175'
const ORIGIN = new URL(APP).origin
const PROFILE =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/a5-profile'
rmSync(PROFILE, { recursive: true, force: true })
const OUT = HERE
mkdirSync(OUT, { recursive: true })

const PASSWORD = 'Dos@1234'
const RAHUL = {
  user: 'rahul.deshmukh',
  userId: '8760e17e-4830-7395-a946-1e02fffa1ad7',
  tenantId: '01a0b9b5-4765-777d-8073-f34f3a983513',
}
const SHOP = { id: '34191c43-f0bc-70ab-a39d-fcbe8f94ae36', name: 'Shree Ganesh Kirana' }
const digits = (id) => BigInt(`0x${id.toLowerCase().replaceAll('-', '')}`).toString(36).padStart(25, '0')
const STORE = `s${digits(RAHUL.userId)}${digits(RAHUL.tenantId)}`
const WANTED = `/${STORE}`
const NOT_PERSISTED = 'will not keep the offline copy'
const SAVED_ON_PHONE = 'Saved on this phone'

const SLOW = /expo-sqlite\/(build\/index|web\/worker)\.bundle/
let DELAY = 0
let delayActive = false
let blockUpload = false

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const at = () => Date.now() - t0
const events = []
const push = (e) => {
  const row = { t: at(), ...e }
  events.push(row)
  console.log(JSON.stringify(row).slice(0, 400))
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 860 },
})

// The product's own worker traffic, read off the wire. Installed before any app code runs.
await ctx.addInitScript(() => {
  const Native = globalThis.Worker
  globalThis.__A5 = { msgs: [], replies: [] }
  globalThis.Worker = class extends Native {
    constructor(url, opts) {
      super(url, opts)
      globalThis.__A5.msgs.push({ t: Math.round(performance.now()), type: 'worker-created', url: String(url).slice(0, 120) })
      this.addEventListener('message', (ev) => {
        const d = ev.data ?? {}
        globalThis.__A5.replies.push({ t: Math.round(performance.now()), id: d.id ?? null, error: d.error ? String(d.error).slice(0, 160) : null })
      })
    }
    postMessage(data, ...rest) {
      try {
        const d = data ?? {}
        const row = {
          t: Math.round(performance.now()),
          type: d.type ?? null,
          id: d.id ?? null,
          nativeDatabaseId: d.data?.nativeDatabaseId ?? null,
          databasePath: d.data?.databasePath ?? null,
        }
        globalThis.__A5.msgs.push(row)
        console.warn(`A5MSG ${JSON.stringify(row)}`)
      } catch {
        /* never break the product to watch it */
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
      if (slow) {
        await sleep(DELAY)
        push({ kind: 'held', from: 'cache', url: url.replace(ORIGIN, '').slice(0, 70), ms: DELAY })
      }
      return void (await route.fulfill(hit).catch(() => {}))
    }
    if (slow) {
      const began = Date.now()
      await sleep(DELAY)
      push({ kind: 'held', url: url.replace(ORIGIN, '').slice(0, 70), heldMs: Date.now() - began })
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
    await route
      .fulfill(body === null ? { response, headers } : { status: response.status(), headers, body })
      .catch(() => {})
  },
)
// The queued order must stay queued until P3 has proved it survived; only then is the endpoint let through.
await ctx.route('**/sync/upload', async (route) => {
  if (!blockUpload) return void (await route.continue().catch(() => {}))
  push({ kind: 'upload-blocked' })
  await route.abort().catch(() => {})
})
await ctx.grantPermissions(['local-network-access'], { origin: ORIGIN }).catch(() => {})

const net = []
const errs = []
function attach(page) {
  const watch = (source, target) =>
    target.on('console', (m) => {
      const text = m.text().slice(0, 500)
      if (!/offline:|persistent|memory|sqlite|not a database|cannot create file|vfs|A5MSG|DOSDIAG|timed out/i.test(text)) return
      const row = { kind: 'console', source, type: m.type(), text }
      push(row)
      // The fallback REASON travels as a second console argument, not in the text.
      if (/running in memory/.test(text)) {
        Promise.all(m.args().map((a) => a.jsonValue().catch(() => null)))
          .then((args) => push({ kind: 'console-detail', text, args }))
          .catch(() => {})
      }
    })
  watch('page', page)
  page.on('pageerror', (e) => {
    const row = { t: at(), text: String(e).slice(0, 250) }
    errs.push(row)
    push({ kind: 'pageerror', ...row })
  })
  page.on('worker', (w) => {
    push({ kind: 'worker', url: w.url().slice(0, 110) })
    watch('worker', w)
  })
  const rec = (kind, extra) => (r) => {
    if (/:300\d\//.test(r.url()))
      net.push({ t: at(), kind, path: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 110), ...extra(r) })
  }
  page.on('request', rec('request', (r) => ({ method: r.method() })))
  page.on('response', rec('response', (r) => ({ status: r.status() })))
  page.on('requestfailed', rec('failed', (r) => ({ error: r.failure()?.errorText })))
}

const opfsWalk = (page) =>
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
          const entry = { path, kind: 'file' }
          try {
            const file = await handle.getFile()
            entry.size = file.size
            const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
            const end = head.indexOf(0)
            entry.sqlitePath = new TextDecoder().decode(head.subarray(0, end < 0 ? 512 : end))
            const magic = new Uint8Array(await file.slice(4096, 4112).arrayBuffer())
            entry.magic = new TextDecoder().decode(magic).replace(/\0/g, '')
          } catch (error) {
            entry.error = String(error).slice(0, 150)
          }
          out.push(entry)
        }
      }
      try {
        await walk(await navigator.storage.getDirectory(), '')
      } catch (error) {
        out.push({ path: '(root)', error: String(error).slice(0, 150) })
      }
      return out.sort((a, b) => a.path.localeCompare(b.path))
    })
    .catch((e) => [{ path: '(walk failed)', error: String(e).slice(0, 150) }])

const facts = (files) => ({
  fileCount: files.filter((f) => f.kind === 'file').length,
  headers: files.filter((f) => f.sqlitePath).map((f) => f.sqlitePath),
  wantedPresent: files.some((f) => f.sqlitePath === WANTED),
  extraHeaders: files.filter((f) => f.sqlitePath && f.sqlitePath !== WANTED && f.sqlitePath !== '').map((f) => f.sqlitePath),
  sizeOfWanted: files.filter((f) => f.sqlitePath === WANTED).map((f) => f.size),
  magicOfWanted: files.filter((f) => f.sqlitePath === WANTED).map((f) => f.magic),
  unreadable: files.filter((f) => f.error).length,
})

const strip = async (page) => {
  const loc = page.locator('[data-testid=connection]:visible').first()
  return (await loc.count()) === 0 ? '(none)' : (await loc.innerText().catch(() => '(unreadable)')).replace(/\s+/g, ' ').trim()
}
const shot = async (page, n) => {
  await page.screenshot({ path: join(OUT, n) }).catch(() => {})
  push({ kind: 'screenshot', file: n })
}
const says = async (page, label) => {
  const body = await page.innerText('body').catch(() => '')
  const f = {
    label,
    notPersisted: body.includes(NOT_PERSISTED),
    savedOnPhone: body.includes(SAVED_ON_PHONE),
    stillLoading: /Still loading the beat/i.test(body),
    signInForm: (await page.locator('[data-testid=sign-in-username]').count()) > 0,
    path: await page.evaluate(() => location.pathname + location.search).catch(() => '?'),
    strip: await strip(page),
  }
  push({ kind: 'says', ...f })
  return f
}
async function signIn(page) {
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 180000 })
  await page.fill('[data-testid=sign-in-username]', RAHUL.user)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  await page.click('[data-testid=sign-in-submit]')
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 150000 })
  push({ kind: 'signed-in' })
}
async function softGo(page, url) {
  await page.evaluate((u) => {
    history.pushState(null, '', u)
    dispatchEvent(new PopStateEvent('popstate', { state: null }))
  }, url)
  await page
    .waitForFunction((u) => location.pathname + location.search === u, url, { timeout: 20000 })
    .catch(() => {})
  await page.waitForTimeout(1800)
}
const readDraft = (page) =>
  page.evaluate(
    ({ userId, retailerId }) => {
      const key = Object.keys(localStorage).find((k) => k.endsWith(`dos.sales.draft.${userId}.${retailerId}`))
      if (!key) return { key: null, lines: [] }
      try {
        const v = JSON.parse(localStorage.getItem(key))
        return { key, id: v.id ?? null, lines: (v.lines ?? []).map((l) => ({ id: l.id, qtyPcs: l.qtyPcs })) }
      } catch {
        return { key, lines: [] }
      }
    },
    { userId: RAHUL.userId, retailerId: SHOP.id },
  )
async function setPageOffline(page, offline) {
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await sleep(1200)
  push({ kind: 'page-offline', offline, navigatorOnLine: await page.evaluate(() => navigator.onLine).catch(() => null) })
}
const a5msgs = (page) => page.evaluate(() => globalThis.__A5?.msgs ?? []).catch(() => [])
const outbox = (page) =>
  page.evaluate(() => document.querySelectorAll('[data-testid^="order-row-"]').length).catch(() => null)

const R = { app: APP, wantedHeader: WANTED, shop: SHOP, deadlineMs: 15000 }
const page = ctx.pages()[0] ?? (await ctx.newPage())
attach(page)

try {
  // ------------------------------------------------------------------ P1 setup: a persistent store, one queued order
  push({ kind: 'phase', phase: 'P1 setup', delay: 0 })
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 240000 })
  await signIn(page)
  await sleep(12000)
  R.p1Home = await says(page, 'P1 signed in — a persistent store is expected')
  R.p1Opfs = facts(await opfsWalk(page))
  push({ kind: 'opfs', when: 'P1 open', ...R.p1Opfs })
  await shot(page, 'a5-01-p1-persistent-home.png')

  await softGo(page, `/orders/new?retailerId=${SHOP.id}`)
  await sleep(6000)
  await setPageOffline(page, true)
  blockUpload = true
  const add = page.locator('button:visible', { hasText: /^Add a case$/ })
  await add
    .first()
    .waitFor({ timeout: 60000 })
    .catch(() => {})
  for (let i = 0; i < 8; i += 1) {
    const before = await readDraft(page)
    if (before.lines.length >= 1) break
    await add
      .nth(i)
      .click({ timeout: 20000 })
      .catch(() => {})
    await page.waitForTimeout(1100)
  }
  R.p1Draft = await readDraft(page)
  R.orderId = R.p1Draft.id
  push({ kind: 'draft', ...R.p1Draft })
  await page.click('[data-testid=place-order]')
  await sleep(4000)
  R.p1Queued = await says(page, 'P1 order queued, unsent')
  await shot(page, 'a5-02-p1-order-queued.png')
  R.p1OpfsQueued = facts(await opfsWalk(page))
  push({ kind: 'opfs', when: 'P1 queued', ...R.p1OpfsQueued })
  await setPageOffline(page, false)

  // ------------------------------------------------------------------ P2 timeout: the chunk held 20 s, past the deadline
  push({ kind: 'phase', phase: 'P2 timeout', delay: 20000 })
  DELAY = 20000
  delayActive = true
  const p2From = at()
  await page.evaluate(() => {
    globalThis.__A5.msgs.length = 0
  })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 240000 })
  push({ kind: 'reloaded', phase: 'P2' })
  const p2Marks = []
  for (let i = 0; i < 160; i += 1) {
    const body = await page.innerText('body').catch(() => '')
    p2Marks.push({
      t: at() - p2From,
      notPersisted: body.includes(NOT_PERSISTED),
      savedOnPhone: body.includes(SAVED_ON_PHONE),
      stillLoading: /Still loading the beat/i.test(body),
      signIn: body.includes('Sign in') && (await page.locator('[data-testid=sign-in-username]').count()) > 0,
    })
    if (at() - p2From > 80000) break
    await sleep(500)
  }
  R.p2Marks = p2Marks.filter((m, i) => i === 0 || JSON.stringify(m).replace(/"t":\d+,/, '') !== JSON.stringify(p2Marks[i - 1]).replace(/"t":\d+,/, ''))
  R.p2Says = await says(page, 'P2 after the deadline and after the real open landed')
  await shot(page, 'a5-03-p2-timeout-memory.png')
  R.p2Msgs = await a5msgs(page)
  R.p2Opfs = facts(await opfsWalk(page))
  push({ kind: 'opfs', when: 'P2 end', ...R.p2Opfs })
  await softGo(page, '/orders')
  await sleep(3000)
  R.p2OrderRows = await outbox(page)
  await shot(page, 'a5-04-p2-orders-on-memory-store.png')

  // ------------------------------------------------------------------ P3 survival: a normal load, the order still there
  push({ kind: 'phase', phase: 'P3 survival', delay: 0 })
  delayActive = false
  DELAY = 0
  const p3From = at()
  await page.evaluate(() => {
    globalThis.__A5.msgs.length = 0
  })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 240000 })
  await sleep(18000)
  R.p3Says = await says(page, 'P3 the persistent store is back')
  R.p3Opfs = facts(await opfsWalk(page))
  push({ kind: 'opfs', when: 'P3', ...R.p3Opfs })
  await shot(page, 'a5-05-p3-persistent-again.png')
  await softGo(page, '/orders')
  await sleep(3000)
  R.p3OrderRows = await outbox(page)
  R.p3StripBeforeSend = await strip(page)
  await shot(page, 'a5-06-p3-order-still-queued.png')
  R.p3Msgs = await a5msgs(page)
  R.p3OpenMs = at() - p3From

  // let it go
  blockUpload = false
  await sleep(25000)
  R.p3AfterSend = await says(page, 'P3 upload unblocked — the change goes')
  R.p3Uploads = net.filter((n) => /\/sync\/upload/.test(n.path))
  await shot(page, 'a5-07-p3-sent.png')

  // ------------------------------------------------------------------ P4 slow but under the deadline: NOT abandoned
  push({ kind: 'phase', phase: 'P4 slow-ok', delay: 5000 })
  DELAY = 5000
  delayActive = true
  const p4From = at()
  await page.evaluate(() => {
    globalThis.__A5.msgs.length = 0
  })
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 240000 })
  const p4Marks = []
  for (let i = 0; i < 80; i += 1) {
    const body = await page.innerText('body').catch(() => '')
    p4Marks.push({
      t: at() - p4From,
      notPersisted: body.includes(NOT_PERSISTED),
      savedOnPhone: body.includes(SAVED_ON_PHONE),
      stillLoading: /Still loading the beat/i.test(body),
    })
    if (at() - p4From > 45000) break
    await sleep(500)
  }
  R.p4Marks = p4Marks.filter((m, i) => i === 0 || JSON.stringify(m).replace(/"t":\d+,/, '') !== JSON.stringify(p4Marks[i - 1]).replace(/"t":\d+,/, ''))
  R.p4Says = await says(page, 'P4 a slow open under the deadline')
  R.p4Opfs = facts(await opfsWalk(page))
  R.p4Msgs = await a5msgs(page)
  R.p4Held = events.filter((e) => e.kind === 'held' && e.t >= p4From)
  await shot(page, 'a5-08-p4-slow-but-kept.png')
  delayActive = false
} catch (error) {
  R.crashed = String(error).slice(0, 400)
  push({ kind: 'crashed', text: R.crashed })
}

// ------------------------------------------------------------------ the judgement
const con = (re) => events.filter((e) => e.kind === 'console' && re.test(e.text))
const detail = events.filter((e) => e.kind === 'console-detail')
const msgFacts = (msgs) => {
  const opens = (msgs ?? []).filter((m) => m.type === 'open')
  const mine = opens.filter((m) => String(m.databasePath ?? '').includes(STORE))
  const ids = new Set(mine.map((m) => m.nativeDatabaseId))
  return {
    opens: opens.map((m) => ({ t: m.t, id: m.nativeDatabaseId, path: m.databasePath })),
    opensOfMyFile: mine.length,
    closesOfMyFile: (msgs ?? []).filter((m) => m.type === 'close' && ids.has(m.nativeDatabaseId)).length,
    deletesOfMyFile: (msgs ?? []).filter((m) => m.type === 'deleteDatabase' && String(m.databasePath ?? '').includes(STORE)).length,
    deletesAny: (msgs ?? []).filter((m) => m.type === 'deleteDatabase').map((m) => m.databasePath),
    closesAny: (msgs ?? []).filter((m) => m.type === 'close').length,
    everyTypeSeen: [...new Set((msgs ?? []).map((m) => m.type))],
  }
}
R.p2MsgFacts = msgFacts(R.p2Msgs)
R.p3MsgFacts = msgFacts(R.p3Msgs)
R.p4MsgFacts = msgFacts(R.p4Msgs)
R.heldP2 = events.filter((e) => e.kind === 'held' && e.heldMs > 15000)
R.memoryLines = con(/running in memory/).map((e) => e.text)
R.timedOutDetail = detail.filter((d) => JSON.stringify(d.args ?? []).includes('open timed out'))
R.jDeleteOfMyFile = con(/DOSDIAG jDelete/).filter((e) => e.text.includes(STORE)).map((e) => e.text)
R.jDeleteAll = con(/DOSDIAG jDelete/).map((e) => e.text)
R.mainOpens = con(/DOSDIAG main-open/).map((e) => ({ t: e.t, text: e.text }))
R.vfsConstructs = con(/DOSDIAG vfs-construct/).length
R.initCreates = con(/DOSDIAG init-CREATES/).length
R.notADatabase = con(/not a database/).length
R.cannotCreate = con(/cannot create file/).length
R.pageErrors = errs
R.net = net
R.events = events

writeFileSync(join(OUT, 'a5-result.json'), JSON.stringify(R, null, 1))
writeFileSync(join(OUT, 'a5-events.json'), JSON.stringify(events, null, 1))
console.log('\n================ A5 ================')
for (const [k, v] of Object.entries({
  'P1 persistent store': R.p1Opfs?.wantedPresent,
  'P1 order queued': R.p1Queued?.strip,
  'P2 memory line': R.memoryLines,
  'P2 timed-out reason': JSON.stringify(R.timedOutDetail).slice(0, 300),
  'P2 my file: opens/closes/deletes': `${R.p2MsgFacts.opensOfMyFile}/${R.p2MsgFacts.closesOfMyFile}/${R.p2MsgFacts.deletesOfMyFile}`,
  'P2 deletes of anything': JSON.stringify(R.p2MsgFacts.deletesAny),
  'P2 file still on disk': R.p2Opfs?.wantedPresent,
  'P3 persistent again': R.p3Says?.notPersisted === false && R.p3Opfs?.wantedPresent,
  'P3 order rows / strip': `${R.p3OrderRows} / ${R.p3StripBeforeSend}`,
  'P3 after send': R.p3AfterSend?.strip,
  'P4 not abandoned': R.p4Says?.notPersisted === false && R.p4Opfs?.wantedPresent,
  'P4 holds': JSON.stringify(R.p4Held?.map((h) => h.heldMs)),
  'jDelete of my file': JSON.stringify(R.jDeleteOfMyFile),
})) {
  console.log(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
}
await ctx.close()
