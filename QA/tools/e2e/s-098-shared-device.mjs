// S-98 probe (QA batch 2, Stage 1 black-box): after the sales app's OWN sign-out, does a second user in the
// same browser tab see the first user's device rows (shops, orders, beats), or inherit the first user's sync
// cursor and miss their own older rows?
//
// Usage: node QA/tools/e2e/s-098-shared-device.mjs [v1] [v3] [v4]      (default: all three; V2 is computed from V1)
// Needs: the sales app on :5175 (expo start --web) and the shared QA Chromium on CDP :9333 (pw-server.mjs).
// It opens its OWN fresh browser contexts on that Chromium and closes them; it never touches context 0.
// Evidence: QA/evidence/batch2/s-098/*.png (+ .txt body text beside each) and results.json.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../../evidence/batch2/s-098/', import.meta.url))
mkdirSync(OUT, { recursive: true })
const APP = process.env.S098_APP ?? 'http://localhost:5175'
const CDP = `http://127.0.0.1:${process.env.PW_PORT ?? '9333'}`
const PASSWORD = 'Dos@1234'
const DESK = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }

const USERS = {
  A: { user: 'rahul.deshmukh', tenant: 'tarsun' },
  B: { user: 'kiran.mhatre', tenant: 'sai-distributors' },
  A2: { user: 'amit.pawar', tenant: 'tarsun' },
}

// Markers proven by SQL on dos_qa (2026-09-13). A = rahul.deshmukh (tarsun, beats Kalyan West Market,
// Khadakpada, Station Road). Both shops are on Khadakpada, a beat neither kiran (sai) nor amit (tarsun) holds,
// and their names exist once across all tenants. SO-0875 is rahul's and its number exists once across tenants.
const A_MARKERS = [
  { label: 'A shop Chavan Kirana Stores (tarsun R-0024, Khadakpada)', texts: ['Chavan Kirana Stores'], ids: ['a029f31b-2c6c-707b-b580-889125d3ee07'] },
  { label: 'A shop Iyer Provision Store (tarsun R-0029, Khadakpada)', texts: ['Iyer Provision Store'], ids: ['21789c58-876b-7bc3-9071-34d79086c32f'] },
  { label: 'A order SO-0875 (rahul.deshmukh, tarsun)', texts: ['SO-0875'], ids: ['a86e7342-f6e0-7ece-997b-43b810e33630'] },
]
// Tarsun beat names: legitimate for amit (same tenant, `beats` is tenant-wide), a leak for kiran (sai).
const A_BEAT_MARKERS = [
  { label: 'A tenant beat names (tarsun)', texts: ['Khadakpada', 'Kalyan West Market'], ids: [] },
]
const A_SHOP = { id: 'a029f31b-2c6c-707b-b580-889125d3ee07', name: 'Chavan Kirana Stores' }
const A_ORDER = { id: 'a86e7342-f6e0-7ece-997b-43b810e33630', no: 'SO-0875' }
// Positive controls: prove the checks DO see a row when it is on the device.
const B_MARKERS = [
  { label: 'B own shop Aditya Provision (sai SD-0023)', texts: ['Aditya Provision'], ids: ['33b28ccd-e140-77ad-a1a2-d5893bdaf3c6'] },
  { label: 'B own order row 9e4c2819 (sai SO-0455)', texts: [], ids: ['9e4c2819-569e-7640-815d-c4bdd7e0f962'] },
]
const A2_MARKERS = [
  { label: 'A2 own shop Anand Bhavan Provision (tarsun R-0043, Kolsewadi)', texts: ['Anand Bhavan Provision'], ids: ['ffa4c055-0e89-7dea-97f2-a24e6ac0fef5'] },
  { label: 'A2 own order SO-0876', texts: ['SO-0876'], ids: ['b72adff9-38cd-728e-9d4a-32f091a0f7e2'] },
]
// What the server's read set holds for each rep (SQL on dos_qa: active shops on beats assigned today; own
// sales_orders created in the last 90 days — the scopes of retailers.module.ts and orders.module.ts).
const SQL_EXPECT = {
  A: { shops: 30, orders90d: 363 },
  B: { shops: 24, orders90d: 218 },
  A2: { shops: 29, orders90d: 380 },
}

const results = { startedAt: new Date().toISOString(), app: APP, sqlExpect: SQL_EXPECT, variants: {} }
const only = process.argv.slice(2).map((a) => a.toLowerCase())
let current = null

// ---------------------------------------------------------------------------------------------------------------
// Instruments

function makeLog(page) {
  const log = { console: [], failed: [], sync: [], inflightPull: 0, lastPullEventAt: 0 }
  const isPull = (url) => /sync[./]pull/.test(url)
  page.on('console', (m) => {
    if (m.type() === 'error') log.console.push(m.text().slice(0, 240))
  })
  page.on('request', (req) => {
    const url = req.url()
    if (!/\/sync[./]/.test(url)) return
    if (isPull(url)) {
      log.inflightPull += 1
      log.lastPullEventAt = Date.now()
    }
    let raw = url
    try {
      raw = decodeURIComponent(url)
    } catch {
      /* keep raw */
    }
    raw += ` ${req.postData() ?? ''}`
    log.sync.push({
      at: Date.now(),
      kind: 'request',
      method: req.method(),
      path: new URL(url).pathname,
      hasSince: /"since"|[?&]since=/.test(raw),
      knownSchemaVersion: (raw.match(/knownSchemaVersion"?[:=]"?([0-9a-f]{6,})/) ?? [])[1] ?? null,
      input: raw.replace(/^[^?]*\??/, '').slice(0, 260),
    })
  })
  const done = (req) => {
    if (!isPull(req.url())) return
    log.inflightPull = Math.max(0, log.inflightPull - 1)
    log.lastPullEventAt = Date.now()
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  page.on('response', async (res) => {
    const url = res.url()
    if (res.status() >= 400) log.failed.push(`${res.status()} ${res.request().method()} ${url.slice(0, 160)}`)
    if (!isPull(url) && !/sync[./]manifest/.test(url)) return
    try {
      const j = await res.json()
      const body = j && typeof j === 'object' && 'json' in j ? j.json : j
      const entry = { at: Date.now(), kind: 'response', path: new URL(url).pathname, status: res.status() }
      if (isPull(url)) {
        entry.hasMore = body?.hasMore ?? null
        const rows = (t) =>
          (body?.changes ?? []).filter((c) => c.table === t).reduce((n, c) => n + (c.rows?.length ?? 0), 0)
        entry.rows = { retailers: rows('retailers'), sales_orders: rows('sales_orders'), beats: rows('beats') }
      } else {
        entry.schemaVersion = body?.schemaVersion ?? null
        entry.role = body?.role ?? null
        entry.changed = body?.changed ?? null
      }
      log.sync.push(entry)
    } catch {
      /* not JSON */
    }
  })
  return log
}

async function openPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const log = makeLog(page)
  current = page
  return { ctx, page, log }
}

async function boot(page) {
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded', timeout: 240000 })
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 240000 })
  // Survives client-side navigation, gone after any reload: proves "same document" when present.
  await page.evaluate(() => {
    window.__s098 = `document-${Date.now()}`
  })
}

async function env(page) {
  return page.evaluate(() => ({
    href: location.href,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    opfs: typeof navigator.storage?.getDirectory === 'function',
    sameDocumentMarker: window.__s098 ?? null,
    localStorageKeys: (() => {
      try {
        return Object.keys(localStorage).sort()
      } catch {
        return ['(localStorage threw)']
      }
    })(),
  }))
}

async function strip(page) {
  const loc = page.locator('[data-testid=connection]:visible').first()
  if ((await loc.count()) === 0) return '(no connection strip rendered)'
  return (await loc.innerText({ timeout: 3000 }).catch(() => '(unreadable)')).replace(/\s+/g, ' ').trim()
}

function pullsSince(log, since) {
  const req = log.sync.filter((e) => e.kind === 'request' && /sync[./]pull/.test(e.path) && e.at >= since)
  const res = log.sync.filter((e) => e.kind === 'response' && /sync[./]pull/.test(e.path) && e.at >= since)
  const man = log.sync.filter((e) => e.kind === 'request' && /sync[./]manifest/.test(e.path) && e.at >= since)
  return {
    pullRequests: req.length,
    pullResponses: res.length,
    finished: res.some((e) => e.hasMore === false),
    firstPullHadSince: req[0]?.hasSince ?? null,
    firstPullInput: req[0]?.input ?? null,
    firstManifestKnownSchemaVersion: man[0]?.knownSchemaVersion ?? null,
    firstManifestInput: man[0]?.input ?? null,
    retailersRowsPulled: res.reduce((n, e) => n + (e.rows?.retailers ?? 0), 0),
    salesOrdersRowsPulled: res.reduce((n, e) => n + (e.rows?.sales_orders ?? 0), 0),
  }
}

async function waitSynced(page, log, since, timeoutMs = 240000) {
  const t0 = Date.now()
  for (;;) {
    const res = log.sync.filter((e) => e.kind === 'response' && /sync[./]pull/.test(e.path) && e.at >= since)
    const last = res[res.length - 1]
    const s = await strip(page)
    if (
      last &&
      last.hasMore === false &&
      log.inflightPull === 0 &&
      Date.now() - log.lastPullEventAt > 2500 &&
      /Updated|as of/i.test(s)
    )
      return { syncedAfterMs: Date.now() - since, strip: s, ...pullsSince(log, since) }
    if (Date.now() - t0 > timeoutMs)
      return { syncedAfterMs: null, timeout: true, strip: s, ...pullsSince(log, since) }
    await page.waitForTimeout(400)
  }
}

async function scan(page, markers) {
  const rows = await page.evaluate((ms) => {
    const visible = document.body.innerText
    const all = document.getElementById('root')?.textContent ?? document.body.textContent ?? ''
    return ms.map((m) => ({
      marker: m.label,
      visibleText: m.texts.filter((t) => visible.includes(t)),
      hiddenText: m.texts.filter((t) => !visible.includes(t) && all.includes(t)),
      testIdHits: m.ids.filter((id) => document.querySelector(`[data-testid$="${id}"]`) !== null),
    }))
  }, markers)
  return rows
}
const hits = (rows) => rows.filter((r) => r.visibleText.length || r.hiddenText.length || r.testIdHits.length)

async function shot(R, page, name, note) {
  const file = `${OUT}${name}.png`
  await page.screenshot({ path: file })
  const text = await page.innerText('body').catch(() => '')
  writeFileSync(`${OUT}${name}.txt`, text)
  const s = await strip(page)
  R.shots.push({ file: `QA/evidence/batch2/s-098/${name}.png`, url: page.url(), strip: s, note: note ?? null })
  console.log(`[shot] ${name}.png  ${page.url()}  strip="${s}"`)
}

// ---------------------------------------------------------------------------------------------------------------
// Acting like a user

async function signIn(page, user) {
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 60000 })
  await page.fill('[data-testid=sign-in-username]', user)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  const at = Date.now()
  await page.click('[data-testid=sign-in-submit]')
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 60000 })
  return at
}

async function signOut(page) {
  const width = page.viewportSize()?.width ?? 1280
  if (width >= 1024) {
    await page.locator('header button[aria-haspopup="menu"]:visible').first().click({ timeout: 15000 })
  } else {
    const more = page.getByRole('button', { name: 'More', exact: true })
    if ((await more.count()) > 0) await more.first().click({ timeout: 15000 })
    else await page.locator(':is(button,a,[role=button],[role=tab]):visible', { hasText: 'More' }).last().click({ timeout: 15000 })
  }
  await page.locator('[role=menuitem]:visible', { hasText: 'Sign out' }).first().click({ timeout: 15000 })
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 30000 })
  await page.waitForTimeout(800)
}

/** The app's own rail (desk) or tab (phone) link: an in-app push, never a page load. */
async function tab(page, path) {
  await page.locator(`a[href="${path}"]:visible`).first().click({ timeout: 15000 })
  await page.waitForFunction((p) => location.pathname === p, path, { timeout: 15000 })
  await page.waitForTimeout(1000)
}

/** In-app navigation to a route with no visible link (history push + popstate): same document, no reload. */
async function softGo(page, url) {
  await page.evaluate((u) => {
    history.pushState(null, '', u)
    dispatchEvent(new PopStateEvent('popstate', { state: null }))
  }, url)
  await page.waitForFunction((u) => location.pathname + location.search === u, url, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1800)
}

async function searchShops(page, text) {
  await page.locator('input[data-testid=shops-search]:visible').first().fill(text)
  await page.waitForTimeout(800)
}

async function shopsCount(page) {
  return page.evaluate(() => {
    const t = document.body.innerText
    const chip = t.match(/Shops: (\d+)/)
    const capped = t.match(/Showing (\d+) of (\d+)\./)
    return {
      chip: chip ? Number(chip[1]) : null,
      rowsDrawn: document.querySelectorAll('[data-testid^="shop-row-"]').length,
      capped: capped ? { shown: Number(capped[1]), total: Number(capped[2]) } : null,
    }
  })
}

async function ordersAll(page) {
  await page.locator('[data-testid=order-view] [role=radio]:visible', { hasText: 'All' }).first().click({ timeout: 15000 })
  await page.waitForTimeout(1000)
  return page.evaluate(() => {
    const m = document.body.innerText.match(/Showing the newest (\d+) of (\d+)/)
    return {
      rowsDrawn: document.querySelectorAll('[data-testid^="order-row-"]').length,
      cappedShown: m ? Number(m[1]) : null,
      cappedTotal: m ? Number(m[2]) : null,
    }
  })
}

async function checkpoint(R, page, log, since, where, markers, shotName, extra = {}) {
  const rows = await scan(page, markers)
  const p = pullsSince(log, since)
  const entry = {
    where,
    url: page.url(),
    strip: await strip(page),
    syncFinishedAtThisMoment: p.finished,
    pullResponsesSoFar: p.pullResponses,
    inflightPull: log.inflightPull,
    hits: hits(rows),
    ...extra,
  }
  R.checks.push(entry)
  if (shotName) await shot(R, page, shotName, where)
  console.log(`  [check] ${where}: hits=${entry.hits.map((h) => h.marker).join(' | ') || 'none'} synced=${p.finished}`)
  return entry
}

function start(name) {
  const R = { name, startedAt: new Date().toISOString(), shots: [], checks: [] }
  results.variants[name] = R
  console.log(`\n=== ${name}`)
  return R
}

// ---------------------------------------------------------------------------------------------------------------
// V1 (+ V2): cross-tenant, same tab, no reload

async function v1(browser) {
  const R = start('V1')
  const { ctx, page, log } = await openPage(browser, DESK)
  try {
    await boot(page)
    R.envAtBoot = await env(page)
    await shot(R, page, 'v1-00-sign-in-desk')

    const aAt = await signIn(page, USERS.A.user)
    R.aSync = await waitSynced(page, log, aAt)
    await shot(R, page, 'v1-01-a-rahul-beat-synced-desk')
    await tab(page, '/shops')
    R.aShops = await shopsCount(page)
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, aAt, 'A (rahul) shops search "Chavan Kirana" — positive control', A_MARKERS, 'v1-02-a-shops-search-chavan-desk')
    await searchShops(page, '')
    await tab(page, '/orders')
    R.aOrders = await ordersAll(page)
    await checkpoint(R, page, log, aAt, 'A (rahul) orders, All — positive control', A_MARKERS, 'v1-03-a-orders-all-desk')
    await softGo(page, `/orders/${A_ORDER.id}`)
    await checkpoint(R, page, log, aAt, 'A (rahul) order detail SO-0875 via in-app navigation — positive control', A_MARKERS, 'v1-04-a-order-detail-so0875-desk')
    await softGo(page, `/orders/new?retailerId=${A_SHOP.id}`)
    await checkpoint(R, page, log, aAt, 'A (rahul) order entry for Chavan Kirana Stores — positive control', A_MARKERS, 'v1-05-a-order-entry-chavan-desk')
    await tab(page, '/shops')
    R.envBeforeSignOut = await env(page)

    await signOut(page)
    R.envSignedOut = await env(page)
    await shot(R, page, 'v1-06-signed-out-same-tab-desk', 'after the app’s own Sign out (header account menu)')

    const bAt = await signIn(page, USERS.B.user)
    const LEAK = [...A_MARKERS, ...A_BEAT_MARKERS]
    await checkpoint(R, page, log, bAt, 'B (kiran, sai) beat, right after sign-in', LEAK, 'v1-07-b-kiran-beat-right-after-sign-in-desk')
    await tab(page, '/shops')
    await checkpoint(R, page, log, bAt, 'B shops list, early', LEAK, 'v1-08-b-shops-early-desk', { counts: await shopsCount(page) })
    await tab(page, '/orders')
    await checkpoint(R, page, log, bAt, 'B orders list (Travelling), early', LEAK, 'v1-09-b-orders-early-desk')
    await softGo(page, `/orders/${A_ORDER.id}`)
    await checkpoint(R, page, log, bAt, 'B opens A’s order SO-0875 route, early', LEAK, 'v1-10-b-A-order-detail-early-desk')

    R.bSync = await waitSynced(page, log, bAt)
    await tab(page, '/')
    await checkpoint(R, page, log, bAt, 'B beat, after sync', LEAK, 'v1-11-b-beat-synced-desk')
    await tab(page, '/shops')
    R.bShops = await shopsCount(page)
    await checkpoint(R, page, log, bAt, 'B shops list, after sync', LEAK, 'v1-12-b-shops-synced-desk', { counts: R.bShops })
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, bAt, 'B shops search "Chavan Kirana", after sync', LEAK, 'v1-13-b-search-chavan-desk')
    await searchShops(page, 'Iyer Provision')
    await checkpoint(R, page, log, bAt, 'B shops search "Iyer Provision", after sync', LEAK, 'v1-14-b-search-iyer-desk')
    await searchShops(page, 'Aditya Provision')
    R.bPositiveShop = await checkpoint(R, page, log, bAt, 'B shops search own "Aditya Provision" — positive control', B_MARKERS, 'v1-15-b-search-own-aditya-desk')
    await searchShops(page, '')
    await tab(page, '/orders')
    R.bOrders = await ordersAll(page)
    await checkpoint(R, page, log, bAt, 'B orders, All, after sync', [...LEAK, ...B_MARKERS], 'v1-16-b-orders-all-synced-desk', { counts: R.bOrders })
    await softGo(page, `/orders/${A_ORDER.id}`)
    await checkpoint(R, page, log, bAt, 'B opens A’s order SO-0875 route, after sync', LEAK, 'v1-17-b-A-order-detail-synced-desk')
    await softGo(page, `/orders/new?retailerId=${A_SHOP.id}`)
    await checkpoint(R, page, log, bAt, 'B opens order entry for A’s shop Chavan Kirana, after sync', LEAK, 'v1-18-b-A-shop-order-entry-synced-desk')
    R.envEnd = await env(page)

    await tab(page, '/shops')
    await page.setViewportSize(PHONE)
    await page.waitForTimeout(1500)
    await checkpoint(R, page, log, bAt, 'B shops list at phone width, same tab', LEAK, 'v1-19-b-shops-synced-phone', { counts: await shopsCount(page) })

    // V2: completeness against SQL, and the cursor the first pull carried.
    results.variants.V2 = {
      name: 'V2',
      fromV1: true,
      bFirstPull: pullsSince(log, bAt),
      aFirstPull: pullsSince(log, aAt),
      bShopsOnDevice: R.bShops,
      bShopsSql: SQL_EXPECT.B.shops,
      bOrdersOnDevice: R.bOrders,
      bOrders90dSql: SQL_EXPECT.B.orders90d,
    }
    R.syncLog = log.sync
    R.console = log.console.slice(0, 40)
    R.failed = log.failed.slice(0, 40)
  } finally {
    await ctx.close()
  }
}

// ---------------------------------------------------------------------------------------------------------------
// V3: cross-tenant, reload between users, phone width

async function v3(browser) {
  const R = start('V3')
  const { ctx, page, log } = await openPage(browser, PHONE)
  try {
    await boot(page)
    R.envAtBoot = await env(page)
    await shot(R, page, 'v3-00-sign-in-phone')
    const aAt = await signIn(page, USERS.A.user)
    R.aSync = await waitSynced(page, log, aAt)
    await shot(R, page, 'v3-01-a-rahul-beat-synced-phone')
    await tab(page, '/shops')
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, aAt, 'A (rahul) shops search "Chavan Kirana" — positive control', A_MARKERS, 'v3-02-a-search-chavan-phone')
    await searchShops(page, '')

    await signOut(page)
    R.envSignedOut = await env(page)
    await shot(R, page, 'v3-03-signed-out-phone', 'after the app’s own Sign out (More sheet)')
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 240000 })
    await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 240000 })
    R.envAfterReload = await env(page)
    await shot(R, page, 'v3-04-after-reload-sign-in-phone')

    const bAt = await signIn(page, USERS.B.user)
    const LEAK = [...A_MARKERS, ...A_BEAT_MARKERS]
    await checkpoint(R, page, log, bAt, 'B (kiran, sai) beat, right after sign-in', LEAK, 'v3-05-b-beat-right-after-sign-in-phone')
    await tab(page, '/shops')
    await checkpoint(R, page, log, bAt, 'B shops list, early', LEAK, 'v3-06-b-shops-early-phone', { counts: await shopsCount(page) })
    R.bSync = await waitSynced(page, log, bAt)
    await tab(page, '/orders')
    R.bOrders = await ordersAll(page)
    await checkpoint(R, page, log, bAt, 'B orders, All, after sync', [...LEAK, ...B_MARKERS], 'v3-07-b-orders-all-synced-phone', { counts: R.bOrders })
    await tab(page, '/shops')
    R.bShops = await shopsCount(page)
    await checkpoint(R, page, log, bAt, 'B shops list, after sync', LEAK, 'v3-08-b-shops-synced-phone', { counts: R.bShops })
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, bAt, 'B shops search "Chavan Kirana", after sync', LEAK, 'v3-09-b-search-chavan-phone')
    await searchShops(page, 'Aditya Provision')
    await checkpoint(R, page, log, bAt, 'B shops search own "Aditya Provision" — positive control', B_MARKERS, 'v3-10-b-search-own-aditya-phone')
    await searchShops(page, '')
    await softGo(page, `/orders/${A_ORDER.id}`)
    await checkpoint(R, page, log, bAt, 'B opens A’s order SO-0875 route, after sync', LEAK, 'v3-11-b-A-order-detail-phone')
    R.bFirstPull = pullsSince(log, bAt)
    R.envEnd = await env(page)
    R.syncLog = log.sync
    R.console = log.console.slice(0, 40)
    R.failed = log.failed.slice(0, 40)
  } finally {
    await ctx.close()
  }
}

// ---------------------------------------------------------------------------------------------------------------
// V4: same tenant, different beats, same tab, no reload

async function v4(browser) {
  const R = start('V4')
  const { ctx, page, log } = await openPage(browser, DESK)
  try {
    await boot(page)
    const aAt = await signIn(page, USERS.A.user)
    R.aSync = await waitSynced(page, log, aAt)
    await tab(page, '/shops')
    R.aShops = await shopsCount(page)
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, aAt, 'A (rahul) shops search "Chavan Kirana" — positive control', A_MARKERS, 'v4-01-a-search-chavan-desk')
    await searchShops(page, '')
    await tab(page, '/orders')
    R.aOrders = await ordersAll(page)
    await checkpoint(R, page, log, aAt, 'A (rahul) orders, All — positive control', A_MARKERS, 'v4-02-a-orders-all-desk')
    await tab(page, '/shops')

    await signOut(page)
    R.envSignedOut = await env(page)
    await shot(R, page, 'v4-03-signed-out-same-tab-desk')

    const a2At = await signIn(page, USERS.A2.user)
    await checkpoint(R, page, log, a2At, 'A2 (amit, tarsun) beat, right after sign-in', A_MARKERS, 'v4-04-a2-amit-beat-right-after-sign-in-desk')
    await tab(page, '/shops')
    await checkpoint(R, page, log, a2At, 'A2 shops list, early', A_MARKERS, 'v4-05-a2-shops-early-desk', { counts: await shopsCount(page) })
    R.a2Sync = await waitSynced(page, log, a2At)
    await tab(page, '/')
    await tab(page, '/shops')
    R.a2Shops = await shopsCount(page)
    await checkpoint(R, page, log, a2At, 'A2 shops list, after sync', A_MARKERS, 'v4-06-a2-shops-synced-desk', { counts: R.a2Shops })
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, a2At, 'A2 shops search "Chavan Kirana" (rahul-only beat), after sync', A_MARKERS, 'v4-07-a2-search-chavan-desk')
    await searchShops(page, 'Iyer Provision')
    await checkpoint(R, page, log, a2At, 'A2 shops search "Iyer Provision" (rahul-only beat), after sync', A_MARKERS, 'v4-08-a2-search-iyer-desk')
    await searchShops(page, 'Anand Bhavan')
    await checkpoint(R, page, log, a2At, 'A2 shops search own "Anand Bhavan" — positive control', A2_MARKERS, 'v4-09-a2-search-own-anand-desk')
    await searchShops(page, '')
    await tab(page, '/orders')
    R.a2Orders = await ordersAll(page)
    await checkpoint(R, page, log, a2At, 'A2 orders, All, after sync', [...A_MARKERS, ...A2_MARKERS], 'v4-10-a2-orders-all-desk', { counts: R.a2Orders })
    await softGo(page, `/orders/${A_ORDER.id}`)
    await checkpoint(R, page, log, a2At, 'A2 opens rahul’s order SO-0875 route, after sync', A_MARKERS, 'v4-11-a2-A-order-detail-desk')
    await softGo(page, `/orders/new?retailerId=${A_SHOP.id}`)
    await checkpoint(R, page, log, a2At, 'A2 opens order entry for rahul’s shop Chavan Kirana, after sync', A_MARKERS, 'v4-12-a2-A-shop-order-entry-desk')
    R.a2FirstPull = pullsSince(log, a2At)
    R.envEnd = await env(page)
    R.syncLog = log.sync
    R.console = log.console.slice(0, 40)
    R.failed = log.failed.slice(0, 40)
  } finally {
    await ctx.close()
  }
}

// ---------------------------------------------------------------------------------------------------------------

// V5a / V5b / V5c: the same questions with a PERSISTENT device store on web.
//
// `expo start --web` sends no COOP/COEP headers, so `openStore` (libs/offline/src/store/open.web.ts) hands every
// engine a FRESH in-memory store and V1-V4 cannot exercise the S-98 mechanism at all. The hosted site sends both
// headers (docs/26), which selects expo-sqlite's OPFS store named `dos-sales.db` — the same file-per-app shape as
// the phone's SQLite. Here Playwright adds those headers to every :5175 response of THIS context only: no product
// code, no build. Proof of the store in use: `crossOriginIsolated`, the OPFS entries, and the beat screen's own
// "will not keep the offline copy" line, which the app prints only for the memory store (app/index.tsx:233).
// Run: node QA/tools/e2e/s-098-shared-device.mjs v5a v5b v5c

async function openIsolatedPage(browser, viewport) {
  // A document fulfilled through interception has no remote address, so Chromium 145 treats it as public and
  // refuses its calls to 127.0.0.1 ("Permission was denied ... `loopback` address space", v5-diag evidence).
  // Granting Local Network Access restores what the real hosted page (same-site API) would be allowed.
  const ctx = await browser.newContext({ viewport, permissions: ['local-network-access'] })
  await ctx.route(/^http:\/\/localhost:5175\//, async (route) => {
    let response
    try {
      response = await route.fetch()
    } catch {
      await route.continue().catch(() => {})
      return
    }
    const headers = { ...response.headers() }
    delete headers['content-encoding']
    delete headers['content-length']
    delete headers['transfer-encoding']
    headers['cross-origin-opener-policy'] = 'same-origin'
    headers['cross-origin-embedder-policy'] = 'require-corp'
    headers['cross-origin-resource-policy'] = 'same-origin'
    await route.fulfill({ response, headers })
  })
  const page = await ctx.newPage()
  const log = makeLog(page)
  current = page
  return { ctx, page, log }
}

async function storeFacts(page) {
  return page.evaluate(async () => {
    const names = []
    try {
      const root = await navigator.storage.getDirectory()
      for await (const [name, handle] of root.entries()) names.push(`${name}${handle.kind === 'directory' ? '/' : ''}`)
    } catch (error) {
      names.push(`(opfs error: ${String(error).slice(0, 80)})`)
    }
    return {
      href: location.href,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      opfsTopLevel: names.sort(),
      beatScreenSaysNotPersisted: document.body.innerText.includes('will not keep the offline copy'),
      sameDocumentMarker: window.__s098 ?? null,
    }
  })
}

/** Polls the DOM every 50 ms from BEFORE the second sign-in, so a leak shorter than a checkpoint is still caught. */
async function armWatcher(page, markers) {
  await page.evaluate((ms) => {
    const w = { hits: [], started: Date.now() }
    window.__s098watch = w
    const texts = ms.flatMap((m) => m.texts.map((t) => [m.label, t]))
    const ids = ms.flatMap((m) => m.ids.map((id) => [m.label, id]))
    const seen = (what) => w.hits.some((h) => h.what === what)
    w.timer = setInterval(() => {
      const body = document.body?.innerText ?? ''
      for (const [label, t] of texts)
        if (!seen(t) && body.includes(t)) w.hits.push({ label, what: t, atMs: Date.now() - w.started, path: location.pathname })
      for (const [label, id] of ids)
        if (!seen(id) && document.querySelector(`[data-testid$="${id}"]`))
          w.hits.push({ label, what: id, atMs: Date.now() - w.started, path: location.pathname })
    }, 50)
  }, markers)
}

async function readWatcher(page) {
  return page.evaluate(() => {
    const w = window.__s098watch
    if (!w) return null
    clearInterval(w.timer)
    return { hits: w.hits, watchedMs: Date.now() - w.started }
  })
}

async function v5(browser, { key, prefix, second, secondMarkers, leakMarkers, reload, viewport }) {
  const R = start(key)
  const w = viewport === PHONE ? 'phone' : 'desk'
  const { ctx, page, log } = await openIsolatedPage(browser, viewport)
  try {
    await boot(page)
    R.storeAtBoot = await storeFacts(page)
    const aAt = await signIn(page, USERS.A.user)
    R.aSync = await waitSynced(page, log, aAt)
    R.storeAfterA = await storeFacts(page)
    await shot(R, page, `${prefix}-01-a-rahul-beat-synced-${w}`, 'A on the beat screen; the not-persisted line appears only for the memory store')
    await tab(page, '/shops')
    R.aShops = await shopsCount(page)
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, aAt, 'A (rahul) shops search "Chavan Kirana" — positive control', A_MARKERS, `${prefix}-02-a-search-chavan-${w}`)
    await searchShops(page, '')
    await tab(page, '/orders')
    R.aOrders = await ordersAll(page)
    await checkpoint(R, page, log, aAt, 'A (rahul) orders, All — positive control', A_MARKERS, `${prefix}-03-a-orders-all-${w}`)
    await tab(page, '/shops')

    await signOut(page)
    R.storeSignedOut = await storeFacts(page)
    await shot(R, page, `${prefix}-04-signed-out-${w}`, 'after the app’s own Sign out')
    if (reload) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 240000 })
      await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 240000 })
      R.storeAfterReload = await storeFacts(page)
      await shot(R, page, `${prefix}-05-after-reload-${w}`)
    }

    R.watchArmedAtNode = Date.now()
    await armWatcher(page, leakMarkers)
    // A Node-side poll as well, on Node's clock: it SCREENSHOTS the first frame that shows a leak marker, so a
    // leak shorter than the checkpoints is proven by a picture and not only by the in-page record. It ends by
    // itself when the context closes (or after 150 s), so it can never keep the process alive.
    const poll = { first: null, samples: 0, errors: 0, startedAtNode: Date.now() }
    R.leakPoll = poll
    void (async () => {
      while (!page.isClosed() && Date.now() - poll.startedAtNode < 150000) {
        try {
          const found = hits(await scan(page, leakMarkers))
          poll.samples += 1
          if (found.length > 0 && poll.first === null) {
            poll.first = { atNode: Date.now(), hits: found }
            poll.first.pathAtHit = await page.evaluate(() => location.pathname).catch(() => null)
            await page.screenshot({ path: `${OUT}${prefix}-leak-first-hit-${w}.png` }).catch(() => {})
            writeFileSync(`${OUT}${prefix}-leak-first-hit-${w}.txt`, await page.innerText('body').catch(() => ''))
            poll.first.file = `QA/evidence/batch2/s-098/${prefix}-leak-first-hit-${w}.png`
            poll.first.stillVisibleAfterShot = hits(await scan(page, leakMarkers)).length > 0
          }
        } catch {
          poll.errors += 1
        }
        await new Promise((resolve) => setTimeout(resolve, 60))
      }
    })()
    const bAt = await signIn(page, second.user)
    R.secondSignInClickAtNode = bAt
    await checkpoint(R, page, log, bAt, `${second.user} beat, right after sign-in`, leakMarkers, `${prefix}-06-second-beat-right-after-sign-in-${w}`)
    R.storeSecondAtHome = await storeFacts(page)
    await tab(page, '/shops')
    await checkpoint(R, page, log, bAt, `${second.user} shops list, early`, leakMarkers, `${prefix}-07-second-shops-early-${w}`, { counts: await shopsCount(page) })
    R.secondSync = await waitSynced(page, log, bAt)
    await tab(page, '/')
    R.storeSecondSynced = await storeFacts(page)
    await checkpoint(R, page, log, bAt, `${second.user} beat, after sync`, leakMarkers, `${prefix}-08-second-beat-synced-${w}`)
    await tab(page, '/shops')
    R.secondShops = await shopsCount(page)
    await checkpoint(R, page, log, bAt, `${second.user} shops list, after sync`, leakMarkers, `${prefix}-09-second-shops-synced-${w}`, { counts: R.secondShops })
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, bAt, `${second.user} shops search "Chavan Kirana", after sync`, leakMarkers, `${prefix}-10-second-search-chavan-${w}`)
    const own = secondMarkers[0].texts[0]
    await searchShops(page, own)
    await checkpoint(R, page, log, bAt, `${second.user} shops search own "${own}" — completeness`, secondMarkers, `${prefix}-11-second-search-own-${w}`)
    await searchShops(page, '')
    await tab(page, '/orders')
    R.secondOrders = await ordersAll(page)
    await checkpoint(R, page, log, bAt, `${second.user} orders, All, after sync`, [...leakMarkers, ...secondMarkers], `${prefix}-12-second-orders-all-${w}`, { counts: R.secondOrders })
    await softGo(page, `/orders/${A_ORDER.id}`)
    await checkpoint(R, page, log, bAt, `${second.user} opens rahul’s order SO-0875 route`, leakMarkers, `${prefix}-13-second-A-order-detail-${w}`)
    R.watcher = await readWatcher(page)
    R.secondFirstPull = pullsSince(log, bAt)
    R.secondFirstSyncCalls = log.sync.filter((e) => e.at >= bAt).slice(0, 8)
    R.sqlExpectSecond = second === USERS.A2 ? SQL_EXPECT.A2 : SQL_EXPECT.B
    R.envEnd = await env(page)
    R.console = log.console.slice(0, 40)
    R.failed = log.failed.slice(0, 40)
  } finally {
    await ctx.close()
  }
}

const v5a = (browser) =>
  v5(browser, { key: 'V5A', prefix: 'v5a', second: USERS.A2, secondMarkers: A2_MARKERS, leakMarkers: A_MARKERS, reload: false, viewport: DESK })
const v5b = (browser) =>
  v5(browser, { key: 'V5B', prefix: 'v5b', second: USERS.B, secondMarkers: B_MARKERS, leakMarkers: [...A_MARKERS, ...A_BEAT_MARKERS], reload: false, viewport: DESK })
const v5c = (browser) =>
  v5(browser, { key: 'V5C', prefix: 'v5c', second: USERS.B, secondMarkers: B_MARKERS, leakMarkers: [...A_MARKERS, ...A_BEAT_MARKERS], reload: true, viewport: PHONE })

// ---------------------------------------------------------------------------------------------------------------

// One results file per invocation, so a later run never overwrites an earlier one's evidence.
const RESULTS = `${OUT}results${only.length > 0 ? `-${only.join('-')}` : '-all'}.json`
const browser = await chromium.connectOverCDP(CDP)
try {
  for (const [name, fn] of [
    ['v1', v1],
    ['v3', v3],
    ['v4', v4],
    ['v5a', v5a],
    ['v5b', v5b],
    ['v5c', v5c],
  ]) {
    if (only.length > 0 && !only.includes(name)) continue
    try {
      await fn(browser)
    } catch (error) {
      const key = name.toUpperCase()
      results.variants[key] = results.variants[key] ?? { name: key, shots: [], checks: [] }
      results.variants[key].error = String(error?.stack ?? error).slice(0, 1500)
      console.log(`!! ${key} failed: ${String(error).slice(0, 300)}`)
      if (current) await current.screenshot({ path: `${OUT}${name}-99-error.png` }).catch(() => {})
    }
    writeFileSync(RESULTS, JSON.stringify(results, null, 2))
  }
} finally {
  results.finishedAt = new Date().toISOString()
  writeFileSync(RESULTS, JSON.stringify(results, null, 2))
  await browser.close().catch(() => {})
}
console.log(`\nwritten ${RESULTS}`)
