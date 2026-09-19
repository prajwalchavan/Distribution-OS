// DOS-183 — BROWSER PROOF, run 2. Same walk as d183-web-goes-first.mjs, with the three things run 1
// could not answer added:
//
//   1. EVERY op id, read out of the real POST bodies, so "sent ONCE" is counted per OP and not per order id
//      (run 1 saw two upload calls carrying order B and could not say whether that was two ops or one op twice).
//   2. The browser's own `online` event, installed through addInitScript so it survives the offline reload
//      (run 1 installed it after the reload with page.evaluate and recorded nothing).
//   3. A 150-second OFFLINE SOAK before the radio comes back. The engine's retry timer backs off
//      1 → 2 → 4 … 60 s while the page is offline, so after the soak the next retry is up to a minute away:
//      an upload one second after the `online` event can then only be the RECONNECT, never a retry that
//      happened to fall there. Every failed call during the soak is recorded, so the schedule is visible.
//
// Usage: node d183-web-goes-first-v2.mjs
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
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/d183-profile-v2'
rmSync(PROFILE, { recursive: true, force: true })
const OUT = HERE
mkdirSync(OUT, { recursive: true })

const PASSWORD = 'Dos@1234'
const RAHUL = {
  user: 'rahul.deshmukh',
  userId: '8760e17e-4830-7395-a946-1e02fffa1ad7',
  tenantId: '01a0999a-28c3-7341-93f5-e0e84b0189a1',
}
const SHOP = { id: null, name: null }
const SOAK_MS = 150_000
const digits = (id) => BigInt(`0x${id.toLowerCase().replaceAll('-', '')}`).toString(36).padStart(25, '0')
const WANTED = `/s${digits(RAHUL.userId)}${digits(RAHUL.tenantId)}`

const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
const LANE_DB = 'postgres://dos:dos@127.0.0.1:5439/dos_test_b2_d183'
/** Read-only, and only ever against a database whose name carries `test`. */
const sql1 = (q) => {
  if (!/\/dos_test_/.test(LANE_DB)) throw new Error('lane test database only')
  if (!/^\s*(select|with)\b/i.test(q)) throw new Error('read-only')
  try {
    return execFileSync(PSQL, [LANE_DB, '-X', '-t', '-A', '-F', '|', '-c', q], { encoding: 'utf8' }).trim()
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

const R = {
  app: APP,
  api: API_HOST,
  db: LANE_DB,
  wantedHeader: WANTED,
  soakMs: SOAK_MS,
  startedAt: new Date().toISOString(),
}

// The instrumentation is PASSIVE — it listens, it changes nothing — and it is installed before the
// document's own scripts so a reload cannot lose it.
const INIT = `
  window.__qa = { online: [], offline: [], res: [] };
  addEventListener('online', () => window.__qa.online.push(Date.now()));
  addEventListener('offline', () => window.__qa.offline.push(Date.now()));
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name.includes('3100')) window.__qa.res.push({ name: e.name, start: performance.timeOrigin + e.startTime });
    }).observe({ type: 'resource', buffered: true });
  } catch (_) {}
`

const cache = new Map()
async function makeContext() {
  const c = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1280, height: 860 } })
  await c.addInitScript(INIT)
  await c.route(
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
  await c.grantPermissions(['local-network-access'], { origin: ORIGIN }).catch(() => {})
  return c
}

const net = []
const errs = []
const opsOf = (body) => {
  try {
    return (JSON.parse(body ?? '{}').ops ?? []).map((o) => ({ opId: o.opId, table: o.table, rowId: o.rowId ?? o.id ?? null }))
  } catch {
    return []
  }
}
function attach(page, tag) {
  page.on('console', (m) => {
    const text = m.text().slice(0, 400)
    if (/offline:|persistent|memory|sqlite|vfs|not a database/i.test(text)) push({ kind: 'console', tab: tag, type: m.type(), text })
  })
  page.on('pageerror', (e) => {
    const row = { t: at(), tab: tag, text: String(e).slice(0, 250) }
    errs.push(row)
    push({ kind: 'pageerror', ...row })
  })
  page.on('request', (r) => {
    if (!r.url().includes(API_HOST)) return
    const path = r.url().replace(/^https?:\/\/[^/]+/, '')
    const entry = { wall: Date.now(), t: at(), tab: tag, kind: 'request', method: r.method(), path: path.slice(0, 130) }
    if (/\/sync\/upload/.test(path)) entry.ops = opsOf(r.postData())
    net.push(entry)
  })
  page.on('response', (r) => {
    if (!r.url().includes(API_HOST)) return
    net.push({ wall: Date.now(), t: at(), tab: tag, kind: 'response', status: r.status(), path: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 130) })
  })
  page.on('requestfailed', (r) => {
    if (!r.url().includes(API_HOST)) return
    net.push({
      wall: Date.now(),
      t: at(),
      tab: tag,
      kind: 'failed',
      method: r.method(),
      path: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 130),
      error: r.failure()?.errorText,
    })
  })
}
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
    savedOnPhone: body.includes('Saved on this phone'),
    signInForm: (await page.locator('[data-testid=sign-in-username]').count()) > 0,
    path: await page.evaluate(() => location.pathname + location.search).catch(() => '?'),
    onLine: await page.evaluate(() => navigator.onLine).catch(() => null),
    strip: await strip(page),
  }
  push({ kind: 'says', ...f })
  return f
}
async function signIn(page, tag) {
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 300000 })
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
async function pickShop(page) {
  await softGo(page, '/shops')
  for (let i = 0; i < 20; i += 1) {
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="shop-row-"]')].map((el) => ({
        id: el.getAttribute('data-testid').replace('shop-row-', ''),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').slice(0, 50),
      })),
    )
    if (rows.length > 0) return rows[0]
    await sleep(1500)
  }
  return null
}
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

const calls = (tag, sinceWall) =>
  net
    .filter((e) => e.tab === tag && e.wall >= sinceWall && e.kind === 'request' && /\/sync\//.test(e.path))
    .map((e) => ({ ms: e.wall - sinceWall, wall: e.wall, method: e.method, path: e.path, ops: e.ops ?? null }))
const firstOf = (list, re) => list.find((c) => re.test(c.path)) ?? null
/** opId -> how many upload calls carried it. Anything but 1 is a double-send. */
function sendCounts(list) {
  const seen = new Map()
  for (const c of list) for (const o of c.ops ?? []) seen.set(o.opId, (seen.get(o.opId) ?? 0) + 1)
  return Object.fromEntries(seen)
}

let ctx = await makeContext()
try {
  // ======================================================= STAGE 1 — the exact failing state
  const t1 = ctx.pages()[0] ?? (await ctx.newPage())
  attach(t1, 'tab1')
  await t1.goto(APP, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await t1.waitForSelector('[data-testid=sign-in-username]', { timeout: 300000 })
  await signIn(t1, 'tab1')
  await sleep(14000)
  R.s1 = await says(t1, 'STAGE 1 — tab 1 signed in')
  R.s1Opfs = facts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'stage1', ...R.s1Opfs })
  if (!R.s1Opfs.wantedPresent) throw new Error('no persistent store; the state under test needs one')
  const picked = await pickShop(t1)
  if (picked === null) throw new Error('the Shops list on this device was empty')
  SHOP.id = picked.id
  SHOP.name = picked.text
  R.shop = { ...SHOP }
  push({ kind: 'shop-picked-from-the-device', ...SHOP })

  const cdp1 = await ctx.newCDPSession(t1)
  await cdp1.send('Network.enable')
  const offline1 = async (offline) => {
    await cdp1.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    const w = Date.now()
    await sleep(400)
    push({ kind: 'radio', tab: 'tab1', offline, wall: w, navigatorOnLine: await t1.evaluate(() => navigator.onLine).catch(() => null) })
    return w
  }
  await softGo(t1, `/orders/new?retailerId=${SHOP.id}`)
  await sleep(12000)
  await offline1(true)
  const draftA = await addOneCase(t1)
  push({ kind: 'draft', label: 'order A', ...draftA })
  if (!draftA.gotCatalog || draftA.lines.length === 0) throw new Error('order A: the screen never offered a case to add')
  await t1.click('[data-testid=place-order]')
  await sleep(4500)
  R.orderA = draftA.id
  R.s1Queued = await says(t1, 'STAGE 1 — order A saved on this phone, unsent')
  await shot(t1, 'd183v2-s1-01-order-A-queued-offline.png')
  R.sqlOrderABefore = sql1(`select count(*) from sales_orders where id='${R.orderA}'`)
  push({ kind: 'sql', when: 'order A before the next sign-in', rows: R.sqlOrderABefore })

  // the OTHER tab signs out: the shared session goes and tab 1's engine is stopped, never `end()`ed
  const t2 = await ctx.newPage()
  attach(t2, 'tab2')
  await t2.goto(APP, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await sleep(14000)
  let s1t2 = await says(t2, 'STAGE 1 — tab 2, same person, memory store')
  if (s1t2.signInForm) {
    await signIn(t2, 'tab2')
    await sleep(10000)
    s1t2 = await says(t2, 'STAGE 1 — tab 2 after its own sign-in')
  }
  await t2.click('button[aria-haspopup=menu]').catch(() => {})
  await sleep(1000)
  await t2.getByText('Sign out', { exact: true }).last().click().catch((e) => push({ kind: 'signout-click-failed', error: String(e).slice(0, 160) }))
  await sleep(3000)
  R.s1Tab2AfterSignOut = await says(t2, 'STAGE 1 — tab 2 after Sign out')
  R.s1Tab1AfterSignOut = await says(t1, 'STAGE 1 — tab 1 after the OTHER tab signed out')
  await shot(t1, 'd183v2-s1-02-tab1-when-the-window-closes.png')
  R.s1OpfsBeforeClose = facts(await opfsWalk(t1))
  await ctx.close()
  push({ kind: 'window-closed', note: 'the file keeps the queue; end() never ran on it' })

  // ======================================================= RUN B — the next sign-in
  ctx = await makeContext()
  const p = ctx.pages()[0] ?? (await ctx.newPage())
  attach(p, 'runB')
  await p.goto(APP, { waitUntil: 'domcontentloaded', timeout: 300000 })
  R.s2Before = await says(p, 'RUN B — what the closed window left behind')
  R.s2OpfsBefore = facts(await opfsWalk(p))
  push({ kind: 'opfs', when: 'run B before sign-in', ...R.s2OpfsBefore })
  await shot(p, 'd183v2-s2-01-sign-in-form-file-still-there.png')

  const signedAt = await signIn(p, 'runB')
  await sleep(2500)
  await shot(p, 'd183v2-s2-02-right-after-sign-in.png')
  const deadlineB = Date.now() + 90000
  while (Date.now() < deadlineB && !net.some((e) => e.tab === 'runB' && e.wall >= signedAt && e.kind === 'response' && /\/sync\/upload/.test(e.path)))
    await sleep(200)
  await sleep(8000)
  const cB = calls('runB', signedAt)
  const upB = firstOf(cB, /\/sync\/upload/)
  const manB = firstOf(cB, /\/sync\/manifest/)
  const pullB = firstOf(cB, /\/sync\/pull/)
  R.runB = {
    signedAtWall: signedAt,
    calls: cB.map((c) => ({ ms: c.ms, method: c.method, path: c.path, ops: c.ops })),
    firstUploadMs: upB?.ms ?? null,
    firstManifestMs: manB?.ms ?? null,
    firstPullMs: pullB?.ms ?? null,
    uploadBeforeManifest: upB !== null && manB !== null && upB.ms < manB.ms,
    uploadBeforePull: upB !== null && pullB !== null && upB.ms < pullB.ms,
    pullHappened: pullB !== null,
    pullWasDelta: pullB !== null && /[?&]since=/.test(pullB.path),
    opSendCounts: sendCounts(cB),
    resourceTiming:
      (await readInstrument(p))?.res?.filter((r) => /sync/.test(r.name)).map((r) => ({ name: r.name.replace(/^https?:\/\/[^/]+/, '').slice(0, 60), ms: Math.round(r.start - signedAt) })) ?? null,
  }
  push({ kind: 'RUN-B', ...R.runB, calls: undefined, resourceTiming: undefined })
  R.s2After = await says(p, 'RUN B — after the queue had gone')
  await shot(p, 'd183v2-s2-03-after-the-queue-went.png')
  R.sqlOrderA = {
    orders: sql1(`select count(*) from sales_orders where id='${R.orderA}'`),
    row: sql1(`select id, state, source, salesperson_id, retailer_id from sales_orders where id='${R.orderA}'`),
    lines: sql1(`select count(*) from sales_order_lines where order_id='${R.orderA}'`),
  }
  push({ kind: 'sql', when: 'run B done', ...R.sqlOrderA })

  // ======================================================= RUN C — a page that BOOTED OFFLINE
  const cdp2 = await ctx.newCDPSession(p)
  await cdp2.send('Network.enable')
  const radio = async (offline) => {
    await cdp2.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    const w = Date.now()
    push({ kind: 'radio', tab: 'runB', offline, wall: w })
    return w
  }
  await softGo(p, `/orders/new?retailerId=${SHOP.id}`)
  await sleep(10000)
  await radio(true)
  await sleep(1500)
  const draftB = await addOneCase(p)
  push({ kind: 'draft', label: 'order B', ...draftB })
  if (!draftB.gotCatalog || draftB.lines.length === 0) throw new Error('order B: the screen never offered a case to add')
  await p.click('[data-testid=place-order]')
  await sleep(4500)
  R.orderB = draftB.id
  await shot(p, 'd183v2-s3-01-order-B-queued-offline.png')
  R.sqlOrderBBefore = sql1(`select count(*) from sales_orders where id='${R.orderB}'`)
  push({ kind: 'sql', when: 'order B before the reconnect', rows: R.sqlOrderBBefore })

  // the page BOOTS with no network: reloaded with the services unreachable (the app comes from the cache)
  const bootAt = Date.now()
  await p.reload({ waitUntil: 'domcontentloaded', timeout: 300000 }).catch((e) => push({ kind: 'reload-error', error: String(e).slice(0, 200) }))
  await sleep(12000)
  R.s3Boot = await says(p, 'RUN C — the page booted with no network')
  await shot(p, 'd183v2-s3-02-booted-offline.png')

  // SOAK: let the retry timer back off all the way while there is still no signal.
  push({ kind: 'soak-start', ms: SOAK_MS })
  await sleep(SOAK_MS)
  R.s3AfterSoak = await says(p, `RUN C — after ${SOAK_MS / 1000} s with no signal`)
  await shot(p, 'd183v2-s3-03-after-the-soak.png')
  R.retryAttemptsWhileOffline = net
    .filter((e) => e.wall >= bootAt && (e.kind === 'failed' || (e.kind === 'request' && /\/sync\//.test(e.path))))
    .map((e) => ({ sinceBootMs: e.wall - bootAt, wall: e.wall, kind: e.kind, path: e.path.slice(0, 40), error: e.error }))
  const lastTryBefore = R.retryAttemptsWhileOffline.at(-1) ?? null

  // ---- THE MEASUREMENT: the radio comes back
  const flipAt = await radio(false)
  const deadlineC = Date.now() + 90000
  while (Date.now() < deadlineC && !net.some((e) => e.tab === 'runB' && e.wall >= flipAt && e.kind === 'response' && /\/sync\/upload/.test(e.path)))
    await sleep(150)
  await sleep(8000)
  const qa = await readInstrument(p)
  const onlineEventAt = qa?.online?.length ? qa.online[qa.online.length - 1] : null
  const anchor = onlineEventAt ?? flipAt
  const cC = calls('runB', flipAt - 100)
  const upC = firstOf(cC, /\/sync\/upload/)
  const manC = firstOf(cC, /\/sync\/manifest/)
  const pullC = firstOf(cC, /\/sync\/pull/)
  R.runC = {
    bootAtWall: bootAt,
    soakSeconds: SOAK_MS / 1000,
    lastNetworkAttemptBeforeTheFlip: lastTryBefore,
    gapFromLastAttemptToFlipMs: lastTryBefore ? flipAt - lastTryBefore.wall : null,
    offlineEventsSeen: qa?.offline ?? null,
    onlineEventAtWall: onlineEventAt,
    onlineEventSeen: onlineEventAt !== null,
    flipAtWall: flipAt,
    onlineEventAfterFlipMs: onlineEventAt !== null ? onlineEventAt - flipAt : null,
    anchor: onlineEventAt !== null ? 'the browser online event' : 'the CDP flip (no online event was recorded)',
    calls: cC.map((c) => ({ msFromAnchor: c.wall - anchor, method: c.method, path: c.path, ops: c.ops })),
    firstUploadMsFromAnchor: upC ? upC.wall - anchor : null,
    firstManifestMsFromAnchor: manC ? manC.wall - anchor : null,
    firstPullMsFromAnchor: pullC ? pullC.wall - anchor : null,
    uploadBeforePull: upC !== null && pullC !== null && upC.wall < pullC.wall,
    pullHappened: pullC !== null,
    opSendCounts: sendCounts(cC),
  }
  push({ kind: 'RUN-C', ...R.runC, calls: undefined, retryAttemptsWhileOffline: undefined })
  R.s3After = await says(p, 'RUN C — after the reconnect')
  await shot(p, 'd183v2-s3-04-after-the-reconnect.png')
  await softGo(p, '/orders')
  await sleep(4000)
  await shot(p, 'd183v2-s3-05-orders.png')
  R.sqlOrderB = {
    orders: sql1(`select count(*) from sales_orders where id='${R.orderB}'`),
    row: sql1(`select id, state, source, salesperson_id, retailer_id from sales_orders where id='${R.orderB}'`),
    lines: sql1(`select count(*) from sales_order_lines where order_id='${R.orderB}'`),
  }
  push({ kind: 'sql', when: 'run C done', ...R.sqlOrderB })
  R.opfsFinal = facts(await opfsWalk(p))
  R.deviceIds = [...new Set(net.filter((e) => /deviceId=/.test(e.path)).map((e) => /deviceId=([^&]+)/.exec(e.path)[1]))]
  if (R.deviceIds.length > 0)
    R.sqlSyncOps = sql1(
      `select device_id, count(*) from sync_ops where device_id in (${R.deviceIds.map((d) => `'${d}'`).join(',')}) group by device_id`,
    )
} catch (error) {
  R.fatal = String(error).slice(0, 700)
  push({ kind: 'fatal', error: R.fatal })
} finally {
  await ctx.close().catch(() => {})
}

const one = (s) => String(s ?? '').trim() === '1'
const B = R.runB ?? {}
const C = R.runC ?? {}
const allOnce = (counts) => counts !== undefined && Object.keys(counts).length > 0 && Object.values(counts).every((n) => n === 1)
R.verdict = {
  runB_uploadBeforeManifest: B.uploadBeforeManifest === true,
  runB_uploadBeforePull: B.uploadBeforePull === true,
  runB_uploadUnder10s: typeof B.firstUploadMs === 'number' && B.firstUploadMs < 10000,
  runB_pullStillHappened: B.pullHappened === true,
  runB_everyOpSentOnce: allOnce(B.opSendCounts),
  runB_orderInOfficeOnce: one(R.sqlOrderA?.orders) && one(R.sqlOrderA?.lines),
  runC_onlineEventSeen: C.onlineEventSeen === true,
  runC_uploadWithin2s: typeof C.firstUploadMsFromAnchor === 'number' && C.firstUploadMsFromAnchor <= 2000,
  runC_uploadBeforePull: C.uploadBeforePull === true,
  runC_pullStillHappened: C.pullHappened === true,
  runC_everyOpSentOnce: allOnce(C.opSendCounts),
  runC_orderInOfficeOnce: one(R.sqlOrderB?.orders) && one(R.sqlOrderB?.lines),
}
R.verdict.PASS = Object.values(R.verdict).every((v) => v === true)
R.pageErrors = errs
writeFileSync(join(OUT, 'd183v2-result.json'), JSON.stringify(R, null, 1))
writeFileSync(join(OUT, 'd183v2-events.json'), JSON.stringify(events, null, 1))
writeFileSync(join(OUT, 'd183v2-network.json'), JSON.stringify(net, null, 1))
console.log('\n==== VERDICT (v2) ====')
console.log(JSON.stringify(R.verdict, null, 1))
console.log('\nDONE — d183v2-result.json written')
