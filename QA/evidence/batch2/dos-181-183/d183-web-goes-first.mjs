// DOS-183 — BROWSER PROOF that the unsent queue goes FIRST at the next sign-in, on web.
//
// Founder answer A (2026-09-14): unsent changes stay on THAT device for THAT person and go FIRST at that
// person's next sign-in. The finding measured the opposite on web: a sign-in over a kept file pulled first and
// uploaded at +60 753 ms (poll tick), and a page that had booted offline made no call for 49.5 s after a real
// `online` event.
//
// This script OPERATES the sales app in a real headed Chromium. Nothing is stubbed inside the app.
//
//   STAGE 1 (build the exact failing state)
//     tab 1 signs in, opens a PERSISTENT OPFS store, goes offline through CDP, and saves an order on the phone.
//     tab 2 opens on the same profile and the same person (memory store, empty queue) and taps Sign out — the
//     shared session goes, so tab 1's engine is stopped WITHOUT `end()` ever running on that file. The window is
//     then closed. That is "a sign-out from another tab, or a closed window".
//
//   STAGE 2 (run B — the next sign-in)
//     the SAME profile is relaunched: sign-in form, the file still there with the order in it. Sign in and
//     measure, in the network log's milliseconds, when POST /sync/upload starts against /sync/manifest and
//     /sync/pull.  PASS = upload starts BEFORE both, in the same session start, with no 60 s wait.
//
//   STAGE 3 (run C — a page that BOOTED OFFLINE and then found the network)
//     offline again, save a second order, RELOAD the page while still offline (so the engine's start finds no
//     network at all), then restore the network. PASS = the flush follows the `online` event within a second or
//     two, and still precedes the pull.
//
//   REGRESSION, both runs: the pull still happens, each op appears in exactly ONE upload call, and each order
//   lands in the office database exactly once (one sales_orders row, one sync_ops row).
//
// Usage: node d183-web-goes-first.mjs
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire('/Users/prajwalchavan/Desktop/Distribution OS/QA/tools/package.json')
const { chromium } = require('playwright')

const APP = 'http://localhost:5185'
const ORIGIN = new URL(APP).origin
const API_HOST = '127.0.0.1:3100'
const PROFILE =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/d183-profile'
rmSync(PROFILE, { recursive: true, force: true })
const OUT = HERE
mkdirSync(OUT, { recursive: true })

const PASSWORD = 'Dos@1234'
const RAHUL = {
  user: 'rahul.deshmukh',
  userId: '8760e17e-4830-7395-a946-1e02fffa1ad7',
  tenantId: '01a0999a-28c3-7341-93f5-e0e84b0189a1',
}
/**
 * The shop is NOT chosen from the office database: a salesperson's device holds only the shops in his
 * own reach, and `/orders/new` for any other answers "That shop is not on this phone". It is read off
 * the app's own Shops list, which is what the device actually has.
 */
const SHOP = { id: null, name: null }
const digits = (id) => BigInt(`0x${id.toLowerCase().replaceAll('-', '')}`).toString(36).padStart(25, '0')
const WANTED = `/s${digits(RAHUL.userId)}${digits(RAHUL.tenantId)}`
const NOT_PERSISTED = 'will not keep the offline copy'

const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
const LANE_DB = 'postgres://dos:dos@127.0.0.1:5439/dos_test_b2_d183'
const sql = (q) => {
  if (!/\/dos_test_/.test(LANE_DB)) throw new Error('lane test database only')
  if (!/^\s*(select|with)\b/i.test(q)) throw new Error('read-only')
  try {
    return execFileSync(PSQL, [LANE_DB, '-X', '-A', '-F', '|', '-c', q], { encoding: 'utf8' }).trim()
  } catch (e) {
    return `(sql error: ${String(e?.stderr ?? e).slice(0, 200)})`
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const at = () => Date.now() - t0
const events = []
const push = (e) => {
  const row = { t: at(), ...e }
  events.push(row)
  console.log(JSON.stringify(row).slice(0, 600))
}

const R = { app: APP, api: API_HOST, db: LANE_DB, wantedHeader: WANTED, shop: SHOP, startedAt: new Date().toISOString() }

// ---------------------------------------------------------------- browser plumbing
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 860 },
})
// The app origin gets COOP/COEP (the persistent OPFS store needs cross-origin isolation) and every
// successful response is cached so an OFFLINE reload can still boot the page — the app code is served,
// the SERVICES stay unreachable, which is the state run C needs.
const cache = new Map()
await ctx.route(
  (u) => u.origin === ORIGIN,
  async (route) => {
    const url = route.request().url()
    let response = null
    try {
      response = await route.fetch()
    } catch {
      response = null
    }
    if (response === null) {
      const hit = cache.get(url)
      if (hit === undefined) return void (await route.abort().catch(() => {}))
      return void (await route.fulfill(hit))
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
    await route.fulfill(body === null ? { response, headers } : { status: response.status(), headers, body })
  },
)
await ctx.grantPermissions(['local-network-access'], { origin: ORIGIN }).catch(() => {})

/** Every call to the services, with the wall-clock ms at which the browser started it. */
const net = []
const errs = []
function attach(page, tag) {
  page.on('console', (m) => {
    const text = m.text().slice(0, 400)
    if (/offline:|persistent|memory|sqlite|vfs|not a database/i.test(text))
      push({ kind: 'console', tab: tag, type: m.type(), text })
  })
  page.on('pageerror', (e) => {
    const row = { t: at(), tab: tag, text: String(e).slice(0, 250) }
    errs.push(row)
    push({ kind: 'pageerror', ...row })
  })
  page.on('request', (r) => {
    if (!r.url().includes(API_HOST)) return
    const path = r.url().replace(/^https?:\/\/[^/]+/, '')
    let body = null
    if (/\/sync\/upload/.test(path)) body = (r.postData() ?? '').slice(0, 200000)
    net.push({ wall: Date.now(), t: at(), tab: tag, kind: 'request', method: r.method(), path: path.slice(0, 120), body })
  })
  page.on('response', (r) => {
    if (!r.url().includes(API_HOST)) return
    net.push({
      wall: Date.now(),
      t: at(),
      tab: tag,
      kind: 'response',
      status: r.status(),
      path: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120),
    })
  })
  page.on('requestfailed', (r) => {
    if (!r.url().includes(API_HOST)) return
    net.push({
      wall: Date.now(),
      t: at(),
      tab: tag,
      kind: 'failed',
      path: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120),
      error: r.failure()?.errorText,
    })
  })
}

/** Passive observers INSIDE the page: the browser's own `online` event and its resource timings. */
const instrument = (page) =>
  page.evaluate(() => {
    if (window.__qa) return
    window.__qa = { online: [], offline: [], res: [] }
    addEventListener('online', () => window.__qa.online.push(Date.now()))
    addEventListener('offline', () => window.__qa.offline.push(Date.now()))
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (e.name.includes('3100')) window.__qa.res.push({ name: e.name, start: performance.timeOrigin + e.startTime })
      }).observe({ type: 'resource', buffered: true })
    } catch {
      /* resource timing unavailable */
    }
  })
const readInstrument = (page) => page.evaluate(() => window.__qa ?? null).catch(() => null)

const opfsWalk = (page) =>
  page
    .evaluate(async () => {
      const out = []
      async function walk(dir, prefix) {
        for await (const [name, handle] of dir.entries()) {
          const path = prefix + name
          if (handle.kind === 'directory') await walk(handle, `${path}/`)
          else {
            const entry = { path, kind: 'file' }
            try {
              const f = await handle.getFile()
              entry.size = f.size
              const head = new Uint8Array(await f.slice(0, 512).arrayBuffer())
              const end = head.indexOf(0)
              entry.sqlitePath = new TextDecoder().decode(head.subarray(0, end < 0 ? 512 : end))
            } catch (error) {
              entry.error = String(error).slice(0, 150)
            }
            out.push(entry)
          }
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
  fileCount: files.length,
  headers: files.filter((f) => f.sqlitePath).map((f) => f.sqlitePath),
  wantedPresent: files.some((f) => f.sqlitePath === WANTED),
  sizeOfWanted: files.filter((f) => f.sqlitePath === WANTED).map((f) => f.size),
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
    savedOnPhone: body.includes('Saved on this phone'),
    signInForm: (await page.locator('[data-testid=sign-in-username]').count()) > 0,
    path: await page.evaluate(() => location.pathname + location.search).catch(() => '?'),
    strip: await strip(page),
  }
  push({ kind: 'says', ...f })
  return f
}
async function signIn(page, tag) {
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 240000 })
  await page.fill('[data-testid=sign-in-username]', RAHUL.user)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  const submittedAt = Date.now()
  await page.click('[data-testid=sign-in-submit]')
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 180000 })
  push({ kind: 'signed-in', tab: tag, afterMs: Date.now() - submittedAt })
  return submittedAt
}
async function softGo(page, url) {
  await page.evaluate((u) => {
    history.pushState(null, '', u)
    dispatchEvent(new PopStateEvent('popstate', { state: null }))
  }, url)
  await page.waitForFunction((u) => location.pathname + location.search === u, url, { timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(1800)
}
const readDraft = (page) =>
  page.evaluate(
    ({ userId, retailerId }) => {
      const key = Object.keys(localStorage).find((k) => k.endsWith(`dos.sales.draft.${userId}.${retailerId}`))
      if (!key) return { key: null, lines: [] }
      try {
        const v = JSON.parse(localStorage.getItem(key))
        return { key, id: v.id ?? null, lines: (v.lines ?? []).map((l) => ({ id: l.id, variantId: l.variantId, qtyPcs: l.qtyPcs })) }
      } catch {
        return { key, lines: [] }
      }
    },
    { userId: RAHUL.userId, retailerId: SHOP.id },
  )
async function setPageOffline(page, offline, tag) {
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  const flippedAt = Date.now()
  await sleep(300)
  push({ kind: 'page-offline', tab: tag, offline, navigatorOnLine: await page.evaluate(() => navigator.onLine).catch(() => null) })
  return flippedAt
}
/** The shops THIS device holds, read off the app's own Shops list. */
async function pickShop(page) {
  await softGo(page, '/shops')
  for (let i = 0; i < 20; i += 1) {
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="shop-row-"]')].map((el) => ({
        id: el.getAttribute('data-testid').replace('shop-row-', ''),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60),
      })),
    )
    if (rows.length > 0) return rows[0]
    await sleep(1500)
  }
  return null
}

/** Adds one case at this shop's order entry; the catalog must already be warm. */
async function addOneCase(page) {
  const add = page.locator('button:visible', { hasText: /^Add a case$/ })
  const ok = await add
    .first()
    .waitFor({ timeout: 60000 })
    .then(() => true)
    .catch(() => false)
  if (!ok) return { gotCatalog: false, lines: [] }
  for (let i = 0; i < 8; i += 1) {
    const before = await readDraft(page)
    if (before.lines.length >= 1) break
    await add.nth(i).click({ timeout: 25000 }).catch(() => {})
    await page.waitForTimeout(1100)
  }
  return { gotCatalog: true, ...(await readDraft(page)) }
}

/** Places an order at SHOP with the page offline; returns the order id the app generated. */
async function queueAnOrderOffline(page, tag, label) {
  await softGo(page, `/orders/new?retailerId=${SHOP.id}`)
  await sleep(12000)
  await setPageOffline(page, true, tag)
  const draft = await addOneCase(page)
  push({ kind: 'draft', tab: tag, label, ...draft })
  if (!draft.gotCatalog || draft.lines.length === 0) throw new Error(`${label}: the order screen never offered a case to add`)
  await page.click('[data-testid=place-order]')
  await sleep(4500)
  push({ kind: 'placed-offline', tab: tag, label, orderId: draft.id, strip: await strip(page) })
  return { ...draft, placed: true }
}

/** The sync calls a tab made after `sinceWall`, in wall-clock ms relative to it. */
const syncCalls = (tag, sinceWall) =>
  net
    .filter((e) => e.tab === tag && e.wall >= sinceWall && e.kind === 'request' && /\/sync\//.test(e.path))
    .map((e) => ({ ms: e.wall - sinceWall, wall: e.wall, method: e.method, path: e.path, bodyLen: e.body?.length ?? null }))
const firstOf = (calls, re) => calls.find((c) => re.test(c.path)) ?? null
/** How many DIFFERENT upload calls carried this order id. "Sent once" is one. */
const uploadsCarrying = (tag, sinceWall, orderId) =>
  net.filter(
    (e) => e.tab === tag && e.wall >= sinceWall && e.kind === 'request' && /\/sync\/upload/.test(e.path) && (e.body ?? '').includes(orderId),
  ).length

try {
  // =============================================================== STAGE 1 — build the failing state
  const t1 = ctx.pages()[0] ?? (await ctx.newPage())
  attach(t1, 'tab1')
  await t1.goto(APP, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await instrument(t1)
  await t1.waitForSelector('[data-testid=sign-in-username]', { timeout: 300000 })
  await signIn(t1, 'tab1')
  await sleep(14000)
  R.s1SignedIn = await says(t1, 'STAGE 1 — tab 1 signed in')
  R.s1Opfs = facts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'stage1 signed in', ...R.s1Opfs })
  await shot(t1, 'd183-s1-01-tab1-signed-in.png')
  if (!R.s1Opfs.wantedPresent) throw new Error('tab 1 did not open a persistent store; the state under test needs one')

  const picked = await pickShop(t1)
  if (picked === null) throw new Error('the Shops list on this device was empty')
  SHOP.id = picked.id
  SHOP.name = picked.text
  R.shop = { ...SHOP }
  push({ kind: 'shop-picked-from-the-device', ...SHOP })
  await shot(t1, 'd183-s1-01b-shops-on-this-device.png')

  const q1 = await queueAnOrderOffline(t1, 'tab1', 'order A')
  R.orderA = q1.id
  R.s1Queued = await says(t1, 'STAGE 1 — order A saved on the phone, unsent')
  await shot(t1, 'd183-s1-02-order-A-queued-offline.png')
  R.s1OpfsQueued = facts(await opfsWalk(t1))
  R.sqlOrderABefore = sql(`select count(*) from sales_orders where id='${R.orderA}'`)
  push({ kind: 'sql', when: 'order A before any sign-in', rows: R.sqlOrderABefore })

  // tab 2: same browser, same person. Its own store is memory (the file is held by tab 1), queue empty —
  // its Sign out therefore clears the SHARED session without any leave sheet, and tab 1 is stopped, never ended.
  const t2 = await ctx.newPage()
  attach(t2, 'tab2')
  await t2.goto(APP, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await sleep(14000)
  R.s1Tab2 = await says(t2, 'STAGE 1 — tab 2, same person, memory store')
  await shot(t2, 'd183-s1-03-tab2-memory.png')
  if (R.s1Tab2.signInForm) {
    await signIn(t2, 'tab2')
    await sleep(10000)
    R.s1Tab2 = await says(t2, 'STAGE 1 — tab 2 after its own sign-in')
  }
  await t2.click('button[aria-haspopup=menu]').catch(() => {})
  await sleep(1000)
  await t2
    .getByText('Sign out', { exact: true })
    .last()
    .click()
    .catch((e) => push({ kind: 'tab2-signout-click-failed', error: String(e).slice(0, 160) }))
  await sleep(3000)
  R.s1Tab2AfterSignOut = await says(t2, 'STAGE 1 — tab 2 after Sign out')
  await shot(t2, 'd183-s1-04-tab2-after-sign-out.png')
  // A leave sheet would mean tab 2 had something of its own; take the plain sign-out if it is offered.
  if (!R.s1Tab2AfterSignOut.signInForm) {
    const sheet = await t2.evaluate(() => document.querySelector('[data-testid=leave-sheet]') !== null)
    push({ kind: 'tab2-leave-sheet-present', sheet })
    if (sheet) {
      await t2.click('[data-testid=leave-keep]').catch(() => {})
      await sleep(3000)
      R.s1Tab2AfterSignOut = await says(t2, 'STAGE 1 — tab 2 after keeping and signing out')
    }
  }
  R.s1Tab1AfterTab2SignedOut = await says(t1, 'STAGE 1 — tab 1 after the OTHER tab signed out')
  await shot(t1, 'd183-s1-05-tab1-after-other-tab-signed-out.png')
  R.s1OpfsBeforeClose = facts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'stage1 before the window closes', ...R.s1OpfsBeforeClose })

  // and now the window is closed, with the queue on disk and `end()` never having run on that file.
  await ctx.close()
  push({ kind: 'window-closed', note: 'the profile keeps the OPFS file; no end() ever ran on it' })
} catch (error) {
  R.fatalStage1 = String(error).slice(0, 700)
  push({ kind: 'fatal', stage: 1, error: R.fatalStage1 })
  await ctx.close().catch(() => {})
}

writeFileSync(join(OUT, 'd183-stage1-result.json'), JSON.stringify(R, null, 1))

// =============================================================== STAGE 2 — run B, and STAGE 3 — run C
if (R.fatalStage1 === undefined) {
  const ctx2 = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1280, height: 860 } })
  await ctx2.route(
    (u) => u.origin === ORIGIN,
    async (route) => {
      const url = route.request().url()
      let response = null
      try {
        response = await route.fetch()
      } catch {
        response = null
      }
      if (response === null) {
        const hit = cache.get(url)
        if (hit === undefined) return void (await route.abort().catch(() => {}))
        push({ kind: 'served-from-cache', url: url.replace(ORIGIN, '').slice(0, 80) })
        return void (await route.fulfill(hit))
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
      await route.fulfill(body === null ? { response, headers } : { status: response.status(), headers, body })
    },
  )
  await ctx2.grantPermissions(['local-network-access'], { origin: ORIGIN }).catch(() => {})
  const ctxOffline = async (page, offline, tag) => {
    const cdp = await ctx2.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    const flippedAt = Date.now()
    push({ kind: 'page-offline', tab: tag, offline, flippedAt })
    return flippedAt
  }

  try {
    const p = ctx2.pages()[0] ?? (await ctx2.newPage())
    attach(p, 'runB')
    await p.goto(APP, { waitUntil: 'domcontentloaded', timeout: 300000 })
    await instrument(p)
    R.s2Before = await says(p, 'RUN B — the window the closed session left behind')
    R.s2OpfsBefore = facts(await opfsWalk(p))
    push({ kind: 'opfs', when: 'run B before sign-in', ...R.s2OpfsBefore })
    await shot(p, 'd183-s2-01-sign-in-form-file-still-there.png')

    // ---- THE MEASUREMENT
    const signedAt = await signIn(p, 'runB')
    R.runB = { signedAtWall: signedAt }
    await sleep(2500)
    await shot(p, 'd183-s2-02-right-after-sign-in.png')
    // wait for the upload to have been answered, or 90 s, whichever comes first
    const deadlineB = Date.now() + 90000
    while (
      Date.now() < deadlineB &&
      !net.some((e) => e.tab === 'runB' && e.wall >= signedAt && e.kind === 'response' && /\/sync\/upload/.test(e.path))
    )
      await sleep(250)
    await sleep(6000)

    const callsB = syncCalls('runB', signedAt)
    const upB = firstOf(callsB, /\/sync\/upload/)
    const manB = firstOf(callsB, /\/sync\/manifest/)
    const pullB = firstOf(callsB, /\/sync\/pull/)
    R.runB = {
      ...R.runB,
      calls: callsB.map((c) => ({ ms: c.ms, method: c.method, path: c.path })),
      firstUploadMs: upB?.ms ?? null,
      firstManifestMs: manB?.ms ?? null,
      firstPullMs: pullB?.ms ?? null,
      uploadBeforeManifest: upB !== null && manB !== null && upB.ms < manB.ms,
      uploadBeforePull: upB !== null && pullB !== null && upB.ms < pullB.ms,
      pullHappened: pullB !== null,
      uploadCallsCarryingOrderA: uploadsCarrying('runB', signedAt, R.orderA),
      resourceTiming: (await readInstrument(p))?.res?.filter((r) => /sync/.test(r.name)).map((r) => ({
        name: r.name.replace(/^https?:\/\/[^/]+/, ''),
        ms: Math.round(r.start - signedAt),
      })) ?? null,
    }
    push({ kind: 'RUN-B', ...R.runB, calls: undefined })
    R.s2After = await says(p, 'RUN B — after the queue had gone')
    await shot(p, 'd183-s2-03-after-the-queue-went.png')
    await softGo(p, '/orders')
    await sleep(4000)
    await shot(p, 'd183-s2-04-orders.png')
    R.sqlOrderA = {
      orders: sql(`select count(*) from sales_orders where id='${R.orderA}'`),
      row: sql(`select id, order_no, state, source, salesperson_id, retailer_id from sales_orders where id='${R.orderA}'`),
      lines: sql(`select count(*) from sales_order_lines where order_id='${R.orderA}'`),
      syncOps: sql(`select count(*) from sync_ops where payload::text like '%${R.orderA}%'`),
    }
    push({ kind: 'sql', when: 'run B done', ...R.sqlOrderA })

    // =============================================================== STAGE 3 — run C
    const q2 = await (async () => {
      await softGo(p, `/orders/new?retailerId=${SHOP.id}`)
      await sleep(7000)
      await ctxOffline(p, true, 'runB')
      await sleep(1200)
      const draft = await addOneCase(p)
      push({ kind: 'draft', tab: 'runC', label: 'order B', ...draft })
      if (!draft.gotCatalog || draft.lines.length === 0) return { ...draft, placed: false }
      await p.click('[data-testid=place-order]')
      await sleep(4500)
      return { ...draft, placed: true }
    })()
    R.orderB = q2.id
    await shot(p, 'd183-s3-01-order-B-queued-offline.png')
    R.sqlOrderBBefore = sql(`select count(*) from sales_orders where id='${R.orderB}'`)
    push({ kind: 'sql', when: 'order B before the reconnect', rows: R.sqlOrderBBefore })

    // the page BOOTS OFFLINE: reloaded with the services unreachable (the app itself comes from the cache)
    await p.reload({ waitUntil: 'domcontentloaded', timeout: 300000 }).catch((e) => push({ kind: 'reload-error', error: String(e).slice(0, 200) }))
    await instrument(p)
    await sleep(15000)
    R.s3BootedOffline = await says(p, 'RUN C — the page booted with no network')
    await shot(p, 'd183-s3-02-booted-offline.png')
    const bootWall = Date.now()
    R.runCBootCalls = net
      .filter((e) => e.tab === 'runB' && e.kind !== 'response' && e.wall >= bootWall - 15000)
      .map((e) => ({ kind: e.kind, path: e.path, error: e.error }))
      .slice(0, 20)

    // ---- THE MEASUREMENT: the radio comes back
    const onlineFlippedAt = await ctxOffline(p, false, 'runB')
    const deadlineC = Date.now() + 90000
    while (
      Date.now() < deadlineC &&
      !net.some((e) => e.tab === 'runB' && e.wall >= onlineFlippedAt && e.kind === 'response' && /\/sync\/upload/.test(e.path))
    )
      await sleep(200)
    await sleep(6000)
    const qa = await readInstrument(p)
    const onlineEventAt = qa?.online?.length ? qa.online[qa.online.length - 1] : null
    const anchor = onlineEventAt ?? onlineFlippedAt
    const callsC = syncCalls('runB', anchor - 50)
    const upC = firstOf(callsC, /\/sync\/upload/)
    const manC = firstOf(callsC, /\/sync\/manifest/)
    const pullC = firstOf(callsC, /\/sync\/pull/)
    R.runC = {
      onlineFlippedAtWall: onlineFlippedAt,
      onlineEventAtWall: onlineEventAt,
      onlineEventSeen: onlineEventAt !== null,
      calls: callsC.map((c) => ({ ms: c.ms - 50, method: c.method, path: c.path })),
      firstUploadMsAfterOnlineEvent: upC ? upC.wall - anchor : null,
      firstManifestMsAfterOnlineEvent: manC ? manC.wall - anchor : null,
      firstPullMsAfterOnlineEvent: pullC ? pullC.wall - anchor : null,
      uploadBeforePull: upC !== null && pullC !== null && upC.wall < pullC.wall,
      pullHappened: pullC !== null,
      uploadCallsCarryingOrderB: uploadsCarrying('runB', anchor - 50, R.orderB),
    }
    push({ kind: 'RUN-C', ...R.runC, calls: undefined })
    R.s3After = await says(p, 'RUN C — after the reconnect')
    await shot(p, 'd183-s3-03-after-the-reconnect.png')
    await softGo(p, '/orders')
    await sleep(4000)
    await shot(p, 'd183-s3-04-orders.png')
    R.sqlOrderB = {
      orders: sql(`select count(*) from sales_orders where id='${R.orderB}'`),
      row: sql(`select id, order_no, state, source, salesperson_id, retailer_id from sales_orders where id='${R.orderB}'`),
      lines: sql(`select count(*) from sales_order_lines where order_id='${R.orderB}'`),
      syncOps: sql(`select count(*) from sync_ops where payload::text like '%${R.orderB}%'`),
    }
    push({ kind: 'sql', when: 'run C done', ...R.sqlOrderB })
    R.opfsFinal = facts(await opfsWalk(p))
  } catch (error) {
    R.fatalStage23 = String(error).slice(0, 700)
    push({ kind: 'fatal', stage: '2/3', error: R.fatalStage23 })
  } finally {
    await ctx2.close().catch(() => {})
  }
}

// ---------------------------------------------------------------- verdict
const B = R.runB ?? {}
const C = R.runC ?? {}
R.verdict = {
  runB_uploadBeforeManifest: B.uploadBeforeManifest === true,
  runB_uploadBeforePull: B.uploadBeforePull === true,
  runB_uploadUnder10s: typeof B.firstUploadMs === 'number' && B.firstUploadMs < 10000,
  runB_pullStillHappened: B.pullHappened === true,
  runB_sentOnce: B.uploadCallsCarryingOrderA === 1,
  runB_orderInOfficeOnce: /(^|\n)1$/.test(R.sqlOrderA?.orders ?? ''),
  runC_onlineEventSeen: C.onlineEventSeen === true,
  runC_uploadWithin2s: typeof C.firstUploadMsAfterOnlineEvent === 'number' && C.firstUploadMsAfterOnlineEvent <= 2000,
  runC_uploadBeforePull: C.uploadBeforePull === true,
  runC_pullStillHappened: C.pullHappened === true,
  runC_sentOnce: C.uploadCallsCarryingOrderB === 1,
  runC_orderInOfficeOnce: /(^|\n)1$/.test(R.sqlOrderB?.orders ?? ''),
}
R.verdict.PASS = Object.values(R.verdict).every((v) => v === true)
R.pageErrors = errs
R.net = net.map((e) => ({ ...e, body: e.body ? `(${e.body.length} bytes)` : null }))
writeFileSync(join(OUT, 'd183-result.json'), JSON.stringify(R, null, 1))
writeFileSync(join(OUT, 'd183-events.json'), JSON.stringify(events, null, 1))
writeFileSync(
  join(OUT, 'd183-network.json'),
  JSON.stringify(
    net.filter((e) => /\/sync\/|\/auth\//.test(e.path)).map((e) => ({ ...e, body: e.body ? `(${e.body.length} bytes)` : null })),
    null,
    1,
  ),
)
console.log('\n==== VERDICT ====')
console.log(JSON.stringify(R.verdict, null, 1))
console.log('\nDONE — d183-result.json written')
