// S-98 probe (QA batch 2, Stage 1 black-box): after the sales app's OWN sign-out, does a second user in the
// same browser tab see the first user's device rows (shops, orders, beats), or inherit the first user's sync
// cursor and miss their own older rows?
//
// Usage: node QA/tools/e2e/s-098-shared-device.mjs [v1] [v3] [v4] [v5a] [v5b] [v5c] [v5d] [v5e]   (default: all)
// Needs: the sales app on :5175 (expo start --web) and a QA Chromium on CDP :$PW_PORT (pw-server.mjs, default 9333).
// It opens its OWN fresh browser contexts on that Chromium and closes them; it never touches context 0.
// Evidence: $S098_OUT (default QA/evidence/batch2/s-098/) — *.png (+ .txt body text beside each) and results-*.json.
//
// DOS-167 platform proof (2026-09-13, verifier extension): every V5 variant now walks the origin-private file
// system recursively after each sign-out and sign-in and decodes the SQLite path each expo-sqlite pool file is
// associated with (AccessHandlePoolVFS header: the first 512 bytes, NUL-terminated), so "no file for rahul" is
// read off the store itself. V5D = unsent changes kept for the same person (founder answer A), including the
// architect ruling's cold-start case (sign in holding a kept order, tap Sign out at once). V5E = the ruling's
// race: one /sync/pull answer stalled 5 s, Sign out tapped, an order submitted inside the stall.
// Run: S098_OUT=QA/evidence/batch2/dos-167/web/ PW_PORT=9341 node QA/tools/e2e/s-098-shared-device.mjs v5a v5b v5c v5d v5e
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const OUT_REL = (() => {
  const raw = process.env.S098_OUT ?? 'QA/evidence/batch2/s-098/'
  return raw.endsWith('/') ? raw : `${raw}/`
})()
const OUT = join(REPO, OUT_REL)
mkdirSync(OUT, { recursive: true })
const APP = process.env.S098_APP ?? 'http://localhost:5175'
const CDP = `http://127.0.0.1:${process.env.PW_PORT ?? '9333'}`
const PASSWORD = 'Dos@1234'
const DESK = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }

// Read-only SQL against the QA database (never `dos`, the founder's own).
const PSQL = process.env.S098_PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql'
const QA_DB = process.env.S098_DB ?? 'postgres://dos:dos@127.0.0.1:5439/dos_qa'
function sql(query) {
  if (!/\/dos_qa$/.test(QA_DB)) throw new Error(`refusing to query ${QA_DB}: QA reads dos_qa only`)
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error('read-only: SELECT/WITH only')
  try {
    return execFileSync(PSQL, [QA_DB, '-X', '-A', '-F', '|', '-c', query], { encoding: 'utf8' }).trim()
  } catch (error) {
    return `(sql error: ${String(error?.stderr ?? error).slice(0, 300)})`
  }
}

// Identities on dos_qa (SQL 2026-09-13: users ⨝ memberships ⨝ tenants).
const IDS = {
  rahul: { userId: '8760e17e-4830-7395-a946-1e02fffa1ad7', tenantId: '01a09a5b-3c58-71c1-a34d-b93c569b0099' },
  kiran: { userId: '2239ec93-0bcd-7737-a70c-c60aa4d9e9f1', tenantId: '82f5c562-b7eb-7521-8e19-4aa6befc64f8' },
  amit: { userId: 'efde1e76-9785-7827-aff2-6f56ecd33588', tenantId: '01a09a5b-3c58-71c1-a34d-b93c569b0099' },
}
/** `storeNameFor('dos-sales', identity)` in frontend/libs/offline/src/engine.ts. */
const storeFile = (who) => `dos-sales__u-${IDS[who].userId}__t-${IDS[who].tenantId}.db`
const LEGACY_FILE = 'dos-sales.db'

const USERS = {
  A: { user: 'rahul.deshmukh', tenant: 'tarsun', who: 'rahul' },
  B: { user: 'kiran.mhatre', tenant: 'sai-distributors', who: 'kiran' },
  A2: { user: 'amit.pawar', tenant: 'tarsun', who: 'amit' },
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
const SQL_EXPECT_QUERY = `with reps(u, uname) as (values ('${IDS.rahul.userId}','rahul.deshmukh'),('${IDS.kiran.userId}','kiran.mhatre'),('${IDS.amit.userId}','amit.pawar'))
select r.uname,
 (select count(distinct re.id) from beat_assignments ba join retailers re on re.beat_id=ba.beat_id and re.tenant_id=ba.tenant_id
   where ba.user_id=r.u and re.active and ba.valid_from <= (now() at time zone 'Asia/Kolkata')::date and (ba.valid_to is null or ba.valid_to >= (now() at time zone 'Asia/Kolkata')::date)) as shops_today,
 (select count(*) from sales_orders so where so.salesperson_id=r.u and so.created_at >= now() - interval '90 days') as orders_90d
from reps r order by 1`

const results = { startedAt: new Date().toISOString(), app: APP, out: OUT_REL, sqlExpect: SQL_EXPECT, variants: {} }
const only = process.argv.slice(2).map((a) => a.toLowerCase())
let current = null
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
    const body = req.postData() ?? ''
    raw += ` ${body}`
    const entry = {
      at: Date.now(),
      kind: 'request',
      method: req.method(),
      path: new URL(url).pathname,
      hasSince: /"since"|[?&]since=/.test(raw),
      knownSchemaVersion: (raw.match(/knownSchemaVersion"?[:=]"?([0-9a-f]{6,})/) ?? [])[1] ?? null,
      input: raw.replace(/^[^?]*\??/, '').slice(0, 260),
    }
    if (/sync[./]upload/.test(url)) {
      entry.opIds = [...body.matchAll(/"opId"\s*:\s*"([0-9a-f-]{36})"/g)].map((m) => m[1])
      entry.rows = [...body.matchAll(/"table"\s*:\s*"([a-z_]+)"\s*,\s*"id"\s*:\s*"([0-9a-f-]{36})"/g)].map((m) => `${m[1]}:${m[2]}`)
      entry.body = body.slice(0, 1500)
    }
    log.sync.push(entry)
  })
  const done = (req) => {
    if (!isPull(req.url())) return
    log.inflightPull = Math.max(0, log.inflightPull - 1)
    log.lastPullEventAt = Date.now()
  }
  page.on('requestfinished', done)
  page.on('requestfailed', (req) => {
    done(req)
    if (/\/sync[./]/.test(req.url()))
      log.sync.push({ at: Date.now(), kind: 'failed', path: new URL(req.url()).pathname, error: req.failure()?.errorText ?? null })
  })
  page.on('response', async (res) => {
    const url = res.url()
    if (res.status() >= 400) log.failed.push(`${res.status()} ${res.request().method()} ${url.slice(0, 160)}`)
    const isUpload = /sync[./]upload/.test(url)
    if (!isPull(url) && !/sync[./]manifest/.test(url) && !isUpload) return
    try {
      const j = await res.json()
      const body = j && typeof j === 'object' && 'json' in j ? j.json : j
      const entry = { at: Date.now(), kind: 'response', path: new URL(url).pathname, status: res.status() }
      if (isPull(url)) {
        entry.hasMore = body?.hasMore ?? null
        const rows = (t) =>
          (body?.changes ?? []).filter((c) => c.table === t).reduce((n, c) => n + (c.rows?.length ?? 0), 0)
        entry.rows = { retailers: rows('retailers'), sales_orders: rows('sales_orders'), beats: rows('beats') }
      } else if (isUpload) {
        entry.body = JSON.stringify(body).slice(0, 1500)
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
  R.shots.push({ file: `${OUT_REL}${name}.png`, url: page.url(), strip: s, note: note ?? null })
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

/** Sign in, and take a screenshot + marker scan 400 ms after the click, whatever the page shows by then. */
async function signInTimed(R, page, user, shotName, markers) {
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 60000 })
  await page.fill('[data-testid=sign-in-username]', user)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  const at = Date.now()
  const early = (async () => {
    await sleep(400)
    const offsetMs = Date.now() - at
    const path = await page.evaluate(() => location.pathname).catch(() => null)
    const rows = await scan(page, markers).catch(() => [])
    await page.screenshot({ path: `${OUT}${shotName}.png` }).catch(() => {})
    writeFileSync(`${OUT}${shotName}.txt`, await page.innerText('body').catch(() => ''))
    return { file: `${OUT_REL}${shotName}.png`, offsetMs, path, hits: hits(rows) }
  })()
  await page.click('[data-testid=sign-in-submit]')
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 60000 })
  R.plus400ms = await early
  console.log(`  [+400ms] ${shotName}.png path=${R.plus400ms.path} hits=${R.plus400ms.hits.map((h) => h.marker).join(' | ') || 'none'}`)
  return at
}

/** Opens the account menu (desk header) or the More sheet (phone) and taps "Sign out"; does not wait for the result. */
async function tapSignOut(page) {
  const width = page.viewportSize()?.width ?? 1280
  if (width >= 1024) {
    await page.locator('header button[aria-haspopup="menu"]:visible').first().click({ timeout: 15000 })
  } else {
    const more = page.getByRole('button', { name: 'More', exact: true })
    if ((await more.count()) > 0) await more.first().click({ timeout: 15000 })
    else await page.locator(':is(button,a,[role=button],[role=tab]):visible', { hasText: 'More' }).last().click({ timeout: 15000 })
  }
  await page.locator('[role=menuitem]:visible', { hasText: 'Sign out' }).first().click({ timeout: 15000 })
  return Date.now()
}

async function signOut(page) {
  await tapSignOut(page)
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 30000 })
  await page.waitForTimeout(800)
}

/** After a Sign out tap: 'sheet' when the leave sheet opens, 'signIn' when the sign-in form is back. */
async function afterSignOutTap(page, timeoutMs = 60000) {
  const t0 = Date.now()
  for (;;) {
    const state = await page.evaluate(() => {
      if (document.querySelector('[data-testid=leave-sheet] [role=dialog]')) return 'sheet'
      if (document.querySelector('[data-testid=sign-in-username]')) return 'signIn'
      return null
    })
    if (state !== null) return { state, afterMs: Date.now() - t0 }
    if (Date.now() - t0 > timeoutMs) return { state: 'timeout', afterMs: Date.now() - t0 }
    await sleep(50)
  }
}

async function readSheet(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid=leave-sheet]')
    if (!root) return null
    const dialog = root.querySelector('[role=dialog]') ?? root
    const q = (id) => root.querySelector(`[data-testid=${id}]`)
    const text = (id) => (q(id) ? q(id).textContent.replace(/\s+/g, ' ').trim() : null)
    return {
      title: dialog.getAttribute('aria-label'),
      attention: text('leave-attention'),
      body: text('leave-body'),
      why: text('leave-why'),
      sendNowButton: text('leave-send-now'),
      keepButton: text('leave-keep'),
      cancelButton: text('leave-cancel'),
      innerText: dialog.innerText,
    }
  })
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
  const R = { name, startedAt: new Date().toISOString(), shots: [], checks: [], fileChecks: [] }
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
// headers (docs/26), which selects expo-sqlite's OPFS store — the same file-per-identity shape as the phone's
// SQLite. Here Playwright adds those headers to every :5175 response of THIS context only: no product code, no
// build. Proof of the store in use: `crossOriginIsolated`, the OPFS walk, and the beat screen's own "will not keep
// the offline copy" line, which the app prints only for the memory store.

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

/**
 * The recursive OPFS walk (DOS-167 proof). expo-sqlite on web keeps a POOL of opaque files under `expo-sqlite/`
 * (wa-sqlite AccessHandlePoolVFS); which SQLite file a pool file currently holds is written in its header: the
 * first 512 bytes, the path as UTF-8, NUL-terminated ('' = unassociated, i.e. deleted or never used). The page
 * can read those headers through `getFile()` while the worker holds its access handles (prepare-03 probe).
 */
async function opfsWalk(page) {
  return page.evaluate(async () => {
    const entries = []
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        const path = prefix + name
        if (handle.kind === 'directory') {
          entries.push({ path: `${path}/`, kind: 'directory' })
          await walk(handle, `${path}/`)
        } else {
          const entry = { path, kind: 'file' }
          try {
            const file = await handle.getFile()
            entry.size = file.size
            const bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer())
            const end = bytes.indexOf(0)
            entry.sqlitePath = new TextDecoder().decode(bytes.subarray(0, end < 0 ? 512 : end))
          } catch (error) {
            entry.error = String(error).slice(0, 160)
          }
          entries.push(entry)
        }
      }
    }
    try {
      await walk(await navigator.storage.getDirectory(), '')
    } catch (error) {
      entries.push({ path: '(root)', kind: 'error', error: String(error).slice(0, 160) })
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path))
  })
}

function summarizeFiles(entries) {
  const paths = entries.filter((e) => e.kind === 'file' && e.sqlitePath).map((e) => e.sqlitePath)
  const exact = (name) => paths.filter((p) => p === `/${name}` || p === name || p.endsWith(`/${name}`)).length
  const count = { rahul: exact(storeFile('rahul')), kiran: exact(storeFile('kiran')), amit: exact(storeFile('amit')), legacy: exact(LEGACY_FILE) }
  count.anyDosSales = paths.filter((p) => p.includes('dos-sales')).length
  count.poolFiles = entries.filter((e) => e.kind === 'file').length
  count.unreadable = entries.filter((e) => e.error).length
  return { count, sqlitePaths: paths.sort() }
}

async function storeFacts(page) {
  const walk = await opfsWalk(page).catch((error) => [{ path: '(walk failed)', kind: 'error', error: String(error).slice(0, 160) }])
  const facts = await page.evaluate(() => ({
    href: location.href,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    beatScreenSaysNotPersisted: document.body.innerText.includes('will not keep the offline copy'),
    sameDocumentMarker: window.__s098 ?? null,
  }))
  return {
    ...facts,
    opfsTopLevel: [...new Set(walk.map((e) => e.path.split('/')[0] + (e.path.includes('/') ? '/' : '')))].sort(),
    opfsWalk: walk,
    files: summarizeFiles(walk),
  }
}

/** Records one file-walk checkpoint: expected counts per identity file vs what the OPFS headers say. */
function expectFiles(R, where, facts, expected) {
  const observed = {}
  for (const key of Object.keys(expected)) observed[key] = facts.files.count[key]
  const pass = Object.keys(expected).every((key) => observed[key] === expected[key])
  R.fileChecks.push({ where, expected, observed, pass, sqlitePaths: facts.files.sqlitePaths, poolFiles: facts.files.count.poolFiles, unreadable: facts.files.count.unreadable })
  console.log(`  [files] ${where}: ${pass ? 'PASS' : 'FAIL'} expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)} paths=${JSON.stringify(facts.files.sqlitePaths)}`)
  return pass
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

/** Records every distinct connection-strip text every 50 ms (same document only). */
async function armStripWatch(page) {
  await page.evaluate(() => {
    const w = { seq: [], started: Date.now() }
    window.__s098strip = w
    w.timer = setInterval(() => {
      const el = [...document.querySelectorAll('[data-testid=connection]')].find((e) => e.offsetParent !== null)
      const text = el ? el.innerText.replace(/\s+/g, ' ').trim() : '(none)'
      if (w.seq.length === 0 || w.seq[w.seq.length - 1].strip !== text) w.seq.push({ atMs: Date.now() - w.started, strip: text, path: location.pathname })
    }, 50)
  })
}

async function readStripWatch(page) {
  return page.evaluate(() => {
    const w = window.__s098strip
    if (!w) return null
    clearInterval(w.timer)
    return w.seq
  })
}

/** Starts a Node-side poll that screenshots the first frame showing a leak marker. */
function startLeakPoll(R, page, markers, prefix, w) {
  const poll = { first: null, samples: 0, errors: 0, startedAtNode: Date.now() }
  R.leakPoll = poll
  void (async () => {
    while (!page.isClosed() && Date.now() - poll.startedAtNode < 150000) {
      try {
        const found = hits(await scan(page, markers))
        poll.samples += 1
        if (found.length > 0 && poll.first === null) {
          poll.first = { atNode: Date.now(), hits: found }
          poll.first.pathAtHit = await page.evaluate(() => location.pathname).catch(() => null)
          await page.screenshot({ path: `${OUT}${prefix}-leak-first-hit-${w}.png` }).catch(() => {})
          writeFileSync(`${OUT}${prefix}-leak-first-hit-${w}.txt`, await page.innerText('body').catch(() => ''))
          poll.first.file = `${OUT_REL}${prefix}-leak-first-hit-${w}.png`
          poll.first.stillVisibleAfterShot = hits(await scan(page, markers)).length > 0
        }
      } catch {
        poll.errors += 1
      }
      await sleep(60)
    }
  })()
  return poll
}

async function v5(browser, { key, prefix, second, secondMarkers, leakMarkers, reload, viewport }) {
  const R = start(key)
  const w = viewport === PHONE ? 'phone' : 'desk'
  R.viewport = viewport
  const { ctx, page, log } = await openIsolatedPage(browser, viewport)
  try {
    await boot(page)
    R.storeAtBoot = await storeFacts(page)
    expectFiles(R, 'boot (sign-in form, nobody signed in)', R.storeAtBoot, { rahul: 0, [second.who]: 0, legacy: 0 })
    const aAt = await signIn(page, USERS.A.user)
    R.aSync = await waitSynced(page, log, aAt)
    R.storeAfterA = await storeFacts(page)
    expectFiles(R, 'after rahul signed in and synced', R.storeAfterA, { rahul: 1, [second.who]: 0, legacy: 0 })
    await shot(R, page, `${prefix}-01-a-rahul-beat-synced-${w}`, 'A on the beat screen; the not-persisted line appears only for the memory store')
    await tab(page, '/shops')
    R.aShops = await shopsCount(page)
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, aAt, 'A (rahul) shops search "Chavan Kirana" — positive control', A_MARKERS, `${prefix}-02-a-search-chavan-${w}`, { expected: 'A markers visible (positive control)', leakCheck: false })
    await searchShops(page, '')
    await tab(page, '/orders')
    R.aOrders = await ordersAll(page)
    await checkpoint(R, page, log, aAt, 'A (rahul) orders, All — positive control', A_MARKERS, `${prefix}-03-a-orders-all-${w}`, { expected: 'A markers visible (positive control)', leakCheck: false })
    await tab(page, '/shops')

    await signOut(page)
    R.storeSignedOut = await storeFacts(page)
    expectFiles(R, 'after rahul’s Sign out (one tap, nothing queued)', R.storeSignedOut, { rahul: 0, [second.who]: 0, legacy: 0 })
    await shot(R, page, `${prefix}-04-signed-out-${w}`, 'after the app’s own Sign out')
    if (reload) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 240000 })
      await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 240000 })
      R.storeAfterReload = await storeFacts(page)
      expectFiles(R, 'after reload (app restart), before the second sign-in', R.storeAfterReload, { rahul: 0, [second.who]: 0, legacy: 0 })
      await shot(R, page, `${prefix}-05-after-reload-${w}`)
    }

    R.watchArmedAtNode = Date.now()
    await armWatcher(page, leakMarkers)
    startLeakPoll(R, page, leakMarkers, prefix, w)
    const firstLeakCheck = R.checks.length
    const bAt = await signInTimed(R, page, second.user, `${prefix}-06a-second-plus-400ms-${w}`, leakMarkers)
    R.secondSignInClickAtNode = bAt
    await checkpoint(R, page, log, bAt, `${second.user} beat, right after sign-in`, leakMarkers, `${prefix}-06-second-beat-right-after-sign-in-${w}`, { expected: 'no A marker', leakCheck: true })
    R.storeSecondAtHome = await storeFacts(page)
    expectFiles(R, `right after ${second.user} signed in (home)`, R.storeSecondAtHome, { [second.who]: 1, rahul: 0, legacy: 0 })
    await tab(page, '/shops')
    await checkpoint(R, page, log, bAt, `${second.user} shops list, early`, leakMarkers, `${prefix}-07-second-shops-early-${w}`, { counts: await shopsCount(page), expected: 'no A marker', leakCheck: true })
    R.secondSync = await waitSynced(page, log, bAt)
    await tab(page, '/')
    R.storeSecondSynced = await storeFacts(page)
    expectFiles(R, `${second.user} synced`, R.storeSecondSynced, { [second.who]: 1, rahul: 0, legacy: 0 })
    await checkpoint(R, page, log, bAt, `${second.user} beat, after sync`, leakMarkers, `${prefix}-08-second-beat-synced-${w}`, { expected: 'no A marker', leakCheck: true })
    await tab(page, '/shops')
    R.secondShops = await shopsCount(page)
    await checkpoint(R, page, log, bAt, `${second.user} shops list, after sync`, leakMarkers, `${prefix}-09-second-shops-synced-${w}`, { counts: R.secondShops, expected: 'no A marker', leakCheck: true })
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, bAt, `${second.user} shops search "Chavan Kirana", after sync`, leakMarkers, `${prefix}-10-second-search-chavan-${w}`, { expected: 'no A marker (Nothing matches)', leakCheck: true })
    const own = secondMarkers[0].texts[0]
    await searchShops(page, own)
    await checkpoint(R, page, log, bAt, `${second.user} shops search own "${own}" — completeness`, secondMarkers, `${prefix}-11-second-search-own-${w}`, { expected: 'own marker visible', leakCheck: false })
    await searchShops(page, '')
    await tab(page, '/orders')
    R.secondOrders = await ordersAll(page)
    await checkpoint(R, page, log, bAt, `${second.user} orders, All, after sync`, leakMarkers, `${prefix}-12-second-orders-all-${w}`, { counts: R.secondOrders, expected: 'no A marker', leakCheck: true })
    await softGo(page, `/orders/${A_ORDER.id}`)
    const notOnPhone = await page.evaluate(() => document.body.innerText.includes('That order is not on this phone'))
    await checkpoint(R, page, log, bAt, `${second.user} opens rahul’s order SO-0875 route`, leakMarkers, `${prefix}-13-second-A-order-detail-${w}`, { expected: "no A marker; 'That order is not on this phone'", notOnPhone, leakCheck: true })
    R.watcher = await readWatcher(page)
    R.secondFirstPull = pullsSince(log, bAt)
    R.secondFirstSyncCalls = log.sync.filter((e) => e.at >= bAt).slice(0, 8)
    R.sqlExpectSecond = second === USERS.A2 ? SQL_EXPECT.A2 : SQL_EXPECT.B
    const leakChecks = R.checks.slice(firstLeakCheck).filter((c) => c.leakCheck)
    R.summary = {
      leakHitsAtCheckpoints: { expected: 0, observed: leakChecks.filter((c) => c.hits.length > 0).map((c) => ({ where: c.where, hits: c.hits })) },
      plus400msShot: { expected: 'no A marker', observed: R.plus400ms },
      watcherHits: { expected: [], observed: R.watcher?.hits ?? null, watchedMs: R.watcher?.watchedMs ?? null },
      leakPollFirstHit: { expected: null, observed: R.leakPoll.first, samples: R.leakPoll.samples },
      secondFirstManifestKnownSchemaVersion: { expected: null, observed: R.secondFirstPull.firstManifestKnownSchemaVersion },
      secondFirstPullHadSince: { expected: false, observed: R.secondFirstPull.firstPullHadSince, input: R.secondFirstPull.firstPullInput },
      secondShops: { expected: R.sqlExpectSecond.shops, observed: R.secondShops },
      secondOrdersTotal: { expected: R.sqlExpectSecond.orders90d, observed: R.secondOrders },
      rahulOrderRouteNotOnPhone: { expected: true, observed: notOnPhone },
      fileChecks: { expected: 'all pass', observed: R.fileChecks.map((f) => `${f.pass ? 'PASS' : 'FAIL'} ${f.where}`) },
    }
    R.envEnd = await env(page)
    R.syncLog = log.sync
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
// V5D / V5E helpers: an order for Chavan Kirana on rahul's phone

const ordersOfRahulAtChavan = () =>
  sql(`select id, order_no, state, source, salesperson_id, created_by, created_at from sales_orders where retailer_id='${A_SHOP.id}' and (salesperson_id='${IDS.rahul.userId}' or created_by='${IDS.rahul.userId}') order by created_at desc limit 12`)

/** Opens order entry for Chavan Kirana (in-app) and adds one case of the first suggested item. */
async function buildOrderForChavan(R, page) {
  await softGo(page, `/orders/new?retailerId=${A_SHOP.id}`)
  await page.locator('button:visible', { hasText: /^Add a case$/ }).first().click({ timeout: 30000 })
  await page.waitForSelector('[data-testid^="line-"]', { timeout: 15000 })
  await page.waitForTimeout(900) // the draft saves on a trailing 500 ms timer
  const draft = await page.evaluate(
    ({ userId, retailerId }) => {
      const key = Object.keys(localStorage).find((k) => k.endsWith(`dos.sales.draft.${userId}.${retailerId}`))
      if (!key) return { key: null, keys: Object.keys(localStorage).filter((k) => k.includes('draft')) }
      try {
        const value = JSON.parse(localStorage.getItem(key))
        return { key, id: value.id ?? null, lines: (value.lines ?? []).map((l) => ({ id: l.id, variantId: l.variantId, qtyPcs: l.qtyPcs })) }
      } catch {
        return { key, raw: String(localStorage.getItem(key)).slice(0, 300) }
      }
    },
    { userId: IDS.rahul.userId, retailerId: A_SHOP.id },
  )
  R.draft = draft
  console.log(`  [draft] ${JSON.stringify(draft)}`)
  return draft
}

async function placeButtonLabel(page) {
  return page.evaluate(() => document.querySelector('[data-testid=place-order]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null)
}

async function waitPlaceLabel(page, text, timeoutMs) {
  const t0 = Date.now()
  for (;;) {
    const label = await placeButtonLabel(page)
    if (label !== null && label.includes(text)) return { label, afterMs: Date.now() - t0 }
    if (Date.now() - t0 > timeoutMs) return { label, afterMs: Date.now() - t0, timeout: true }
    await sleep(40)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// V5D: unsent changes kept for the same person (founder answer A), plus the ruling's cold-start case.

async function v5d(browser) {
  const R = start('V5D')
  const w = 'desk'
  R.viewport = DESK
  const { ctx, page, log } = await openIsolatedPage(browser, DESK)
  try {
    await boot(page)
    R.storeAtBoot = await storeFacts(page)
    expectFiles(R, 'boot', R.storeAtBoot, { rahul: 0, kiran: 0, legacy: 0 })
    R.sqlBefore = ordersOfRahulAtChavan()

    // D1 — rahul online, synced; queue an order for Chavan Kirana with no signal; sign out keeping it.
    const aAt = await signIn(page, USERS.A.user)
    R.aSync = await waitSynced(page, log, aAt)
    R.storeAfterA = await storeFacts(page)
    expectFiles(R, 'D1 rahul signed in and synced', R.storeAfterA, { rahul: 1, kiran: 0, legacy: 0 })
    await shot(R, page, 'v5d-01-rahul-synced-desk')
    await buildOrderForChavan(R, page)
    await ctx.setOffline(true)
    R.d1OfflineLabel = await waitPlaceLabel(page, 'Save on this phone', 10000)
    await shot(R, page, 'v5d-02-order-entry-offline-desk', 'radio off: the button says it will save on this phone')
    await page.click('[data-testid=place-order]')
    await page.waitForFunction(() => document.body.innerText.includes('Saved on this phone'), null, { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1200)
    R.d1Queued = { placeLabel: await placeButtonLabel(page), strip: await strip(page), bodySavedOnPhone: await page.evaluate(() => document.body.innerText.includes('Saved on this phone')) }
    await shot(R, page, 'v5d-03-queued-offline-desk', 'order saved on this phone, strip counts what waits')
    R.d1TapAt = await tapSignOut(page)
    R.d1AfterTap = await afterSignOutTap(page, 30000)
    R.d1Sheet = await readSheet(page)
    await shot(R, page, 'v5d-04-leave-sheet-offline-desk', 'the leave sheet, offline')
    console.log(`  [sheet] D1 ${JSON.stringify(R.d1Sheet)}`)
    if (R.d1AfterTap.state === 'sheet') {
      await page.click('[data-testid=leave-keep]')
      await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 60000 })
    }
    await page.waitForTimeout(800)
    R.storeAfterKeep = await storeFacts(page)
    expectFiles(R, 'D1 after "Sign out, keep here" (rahul’s file kept)', R.storeAfterKeep, { rahul: 1, kiran: 0, legacy: 0 })
    await shot(R, page, 'v5d-05-signed-out-kept-desk')
    await ctx.setOffline(false)
    await page.waitForTimeout(500)

    // D2 — kiran (sai), online, on the same browser: nothing of rahul's, own read set.
    const leak = [...A_MARKERS, ...A_BEAT_MARKERS]
    await armWatcher(page, leak)
    startLeakPoll(R, page, leak, 'v5d', w)
    const firstLeakCheck = R.checks.length
    const bAt = await signInTimed(R, page, USERS.B.user, 'v5d-06a-kiran-plus-400ms-desk', leak)
    await checkpoint(R, page, log, bAt, 'D2 kiran beat, right after sign-in', leak, 'v5d-06-kiran-beat-right-after-sign-in-desk', { expected: 'no rahul marker', leakCheck: true })
    R.kiranSync = await waitSynced(page, log, bAt)
    R.storeKiranSynced = await storeFacts(page)
    expectFiles(R, 'D2 kiran synced (kiran’s file; rahul’s kept file untouched)', R.storeKiranSynced, { kiran: 1, rahul: 1, legacy: 0 })
    await tab(page, '/shops')
    R.kiranShops = await shopsCount(page)
    await checkpoint(R, page, log, bAt, 'D2 kiran shops list, after sync', leak, 'v5d-07-kiran-shops-synced-desk', { counts: R.kiranShops, expected: 'no rahul marker; Shops 24', leakCheck: true })
    await searchShops(page, 'Chavan Kirana')
    await checkpoint(R, page, log, bAt, 'D2 kiran shops search "Chavan Kirana"', leak, 'v5d-08-kiran-search-chavan-desk', { expected: 'Nothing matches', leakCheck: true })
    await searchShops(page, '')
    await tab(page, '/orders')
    R.kiranOrders = await ordersAll(page)
    await checkpoint(R, page, log, bAt, 'D2 kiran orders, All', leak, 'v5d-09-kiran-orders-all-desk', { counts: R.kiranOrders, expected: 'no rahul marker; total 218', leakCheck: true })
    R.kiranStrip = await strip(page)
    R.watcher = await readWatcher(page)
    R.kiranFirstPull = pullsSince(log, bAt)
    R.kiranTapAt = await tapSignOut(page)
    R.kiranAfterTap = await afterSignOutTap(page, 30000)
    R.kiranSheet = R.kiranAfterTap.state === 'sheet' ? await readSheet(page) : null
    if (R.kiranAfterTap.state === 'sheet') await shot(R, page, 'v5d-10-kiran-unexpected-sheet-desk')
    await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 60000 })
    await page.waitForTimeout(800)
    R.storeAfterKiranOut = await storeFacts(page)
    expectFiles(R, 'D2 after kiran’s one-tap Sign out', R.storeAfterKiranOut, { kiran: 0, rahul: 1, legacy: 0 })

    // D3 — ruling (m) case 1: rahul signs in holding the kept order and taps Sign out at once. Uploads are
    // refused at the network (route abort) so the kept order is still unsent at the tap, whatever the timing.
    const blocked = []
    await page.route(/\/sync\/upload/, async (route) => {
      blocked.push(Date.now())
      await route.abort('internetdisconnected')
    })
    const cAt = await signIn(page, USERS.A.user)
    R.d3SignedInAfterMs = Date.now() - cAt
    R.d3TapAt = await tapSignOut(page)
    R.d3TapAfterSignInClickMs = R.d3TapAt - cAt
    R.d3AfterTap = await afterSignOutTap(page, 60000)
    R.d3Sheet = R.d3AfterTap.state === 'sheet' ? await readSheet(page) : null
    R.d3UploadsBlockedBeforeTap = blocked.filter((t) => t <= R.d3TapAt).length
    await shot(R, page, 'v5d-11-cold-start-after-tap-desk', 'rahul signed in holding the kept order; Sign out tapped at once')
    console.log(`  [cold start] tap +${R.d3TapAfterSignInClickMs} ms, ${JSON.stringify(R.d3AfterTap)}, sheet=${JSON.stringify(R.d3Sheet)}`)
    if (R.d3AfterTap.state === 'sheet') {
      await page.click('[data-testid=leave-keep]')
      await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 60000 })
    }
    await page.waitForTimeout(800)
    R.storeAfterColdStart = await storeFacts(page)
    expectFiles(R, 'D3 cold start: after the tap (and keep) the kept file is not deleted', R.storeAfterColdStart, { rahul: 1, kiran: 0, legacy: 0 })
    await shot(R, page, 'v5d-12-cold-start-signed-out-desk')
    R.d3UploadsBlockedTotal = blocked.length
    await page.unroute(/\/sync\/upload/)

    // D4 — rahul signs in online: the kept order goes before the re-snapshot, once.
    await armStripWatch(page)
    const dAt = await signIn(page, USERS.A.user)
    R.d4Sync = await waitSynced(page, log, dAt)
    await page.waitForTimeout(1500)
    R.d4StripSequence = await readStripWatch(page)
    R.d4SyncCallOrder = log.sync.filter((e) => e.at >= dAt && e.kind === 'request').slice(0, 8).map((e) => ({ atMs: e.at - dAt, method: e.method, path: e.path, hasSince: e.hasSince, opIds: e.opIds, rows: e.rows }))
    R.d4Uploads = log.sync.filter((e) => e.at >= dAt && /sync[./]upload/.test(e.path))
    R.storeAfterSend = await storeFacts(page)
    expectFiles(R, 'D4 rahul signed in again and synced', R.storeAfterSend, { rahul: 1, kiran: 0, legacy: 0 })
    await shot(R, page, 'v5d-13-rahul-sent-synced-desk')
    const draftId = R.draft?.id ?? '00000000-0000-0000-0000-000000000000'
    R.sqlOrder = sql(`select id, order_no, state, source, salesperson_id, created_by, retailer_id, created_at from sales_orders where id='${draftId}'`)
    R.sqlOrderLines = sql(`select id, order_id, variant_id, entered_qty, entered_unit from sales_order_lines where order_id='${draftId}'`)
    const opIds = [...new Set(R.d4Uploads.flatMap((e) => e.opIds ?? []))]
    R.sqlSyncOps = opIds.length === 0 ? '(no opIds captured)' : sql(`select op_id, device_id, outcome, created_at from sync_ops where op_id in (${opIds.map((id) => `'${id}'`).join(',')})`)
    R.sqlAfter = ordersOfRahulAtChavan()
    await softGo(page, `/orders/${draftId}`)
    await shot(R, page, 'v5d-14-rahul-kept-order-on-phone-desk', 'the order that was kept, as the phone shows it after the send')
    R.console = log.console.slice(0, 40)
    R.failed = log.failed.slice(0, 40)
    R.syncLog = log.sync
    R.summary = {
      d1QueuedStrip: { expected: "'1 waiting' (design) — the strip counts outbox ops", observed: R.d1Queued.strip },
      d1Sheet: { expected: "title '1 change has not reached the office' (ruling n; one op) — no 'Send now' offline; keep button 'Sign out, keep here'", observed: R.d1Sheet },
      d1KeptFile: { expected: 1, observed: R.storeAfterKeep.files.count.rahul },
      d2KiranLeaks: { expected: 0, observed: R.checks.slice(firstLeakCheck).filter((c) => c.leakCheck && c.hits.length > 0).map((c) => c.where), watcher: R.watcher, pollFirst: R.leakPoll?.first ?? null, plus400ms: R.plus400ms },
      d2KiranShops: { expected: 24, observed: R.kiranShops },
      d2KiranOrdersTotal: { expected: 218, observed: R.kiranOrders },
      d2KiranSignOut: { expected: 'one tap, no sheet', observed: R.kiranAfterTap },
      d3ColdStart: { expected: "sheet names the kept change after the open; file not deleted", observed: { tapAfterSignInClickMs: R.d3TapAfterSignInClickMs, afterTap: R.d3AfterTap, sheet: R.d3Sheet, fileKept: R.storeAfterColdStart.files.count.rahul } },
      d4StripSequence: { expected: "'waiting' then 'Updated just now'", observed: R.d4StripSequence },
      d4Order: { expected: 'one row, id = the draft id, rahul as salesperson/creator', observed: R.sqlOrder },
    }
  } finally {
    await ctx.close()
  }
}

// ---------------------------------------------------------------------------------------------------------------
// V5E: the ruling's race — a pull answer stalled 5 s, Sign out tapped, an order submitted inside the stall.

async function v5e(browser) {
  const R = start('V5E')
  const w = 'desk'
  R.viewport = DESK
  const { ctx, page, log } = await openIsolatedPage(browser, DESK)
  try {
    await boot(page)
    R.sqlBefore = ordersOfRahulAtChavan()
    const aAt = await signIn(page, USERS.A.user)
    R.aSync = await waitSynced(page, log, aAt)
    R.storeAfterA = await storeFacts(page)
    expectFiles(R, 'rahul signed in and synced', R.storeAfterA, { rahul: 1, legacy: 0 })
    await buildOrderForChavan(R, page)
    R.onlineLabel = await placeButtonLabel(page)
    await shot(R, page, 'v5e-01-order-entry-online-desk')

    // Quiet first: no pull in flight.
    const q0 = Date.now()
    while ((log.inflightPull > 0 || Date.now() - log.lastPullEventAt < 1500) && Date.now() - q0 < 30000) await sleep(100)

    const STALL_MS = 5000
    const stall = { intercepted: 0, interceptedAt: null, releasedAt: null, url: null, releasedHow: null }
    R.stall = stall
    await page.route(/\/sync\/pull/, async (route) => {
      stall.intercepted += 1
      if (stall.intercepted > 1) {
        await route.continue().catch(() => {})
        return
      }
      stall.interceptedAt = Date.now()
      stall.url = route.request().url().slice(0, 240)
      await sleep(STALL_MS)
      stall.releasedAt = Date.now()
      try {
        await route.continue()
        stall.releasedHow = 'continue'
      } catch (error) {
        stall.releasedHow = `continue threw: ${String(error).slice(0, 120)}; aborted`
        await route.abort('internetdisconnected').catch(() => {})
      }
    })
    // Provoke a pull now: the radio goes away and comes back (the engine's reconnect sync).
    await ctx.setOffline(true)
    await sleep(400)
    await ctx.setOffline(false)
    const s0 = Date.now()
    while (stall.interceptedAt === null && Date.now() - s0 < 20000) await sleep(25)
    R.stallArmedWaitMs = Date.now() - s0
    if (stall.interceptedAt === null) throw new Error('no /sync/pull request was intercepted within 20 s')

    R.tapAt = await tapSignOut(page)
    await ctx.setOffline(true)
    R.offlineLabel = await waitPlaceLabel(page, 'Save on this phone', 3000)
    R.placeClickAt = Date.now()
    await page.click('[data-testid=place-order]', { timeout: 3000 }).catch((error) => {
      R.placeClickError = String(error).slice(0, 200)
    })
    await page.waitForTimeout(700)
    R.insideStall = {
      tapAfterInterceptMs: R.tapAt - stall.interceptedAt,
      placeClickAfterInterceptMs: R.placeClickAt - stall.interceptedAt,
      stallMs: STALL_MS,
      placeClickedInsideStall: R.placeClickAt < stall.interceptedAt + STALL_MS && stall.releasedAt === null,
    }
    R.afterPlace = await page.evaluate(() => {
      const body = document.body.innerText
      return {
        path: location.pathname,
        savedOnThisPhone: body.includes('Saved on this phone'),
        orderPlaced: body.includes('Order placed'),
        genericError: body.includes('Something could not be completed'),
        engineSentence: body.includes('This phone is signing out'),
        signInFormShown: document.querySelector('[data-testid=sign-in-username]') !== null,
        placeLabel: document.querySelector('[data-testid=place-order]')?.textContent ?? null,
      }
    })
    R.stripInsideStall = await strip(page)
    await shot(R, page, 'v5e-02-inside-stall-after-place-desk', 'Sign out tapped, radio off, "Save on this phone" pressed while the pull is still held')
    console.log(`  [race] ${JSON.stringify(R.insideStall)} after=${JSON.stringify(R.afterPlace)}`)
    await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 60000 })
    R.signInBackAfterTapMs = Date.now() - R.tapAt
    await page.waitForTimeout(800)
    R.storeAfterSignOut = await storeFacts(page)
    const kept = R.storeAfterSignOut.files.count.rahul
    expectFiles(R, 'after the sign-out finished (refused write: nothing kept, file deleted)', R.storeAfterSignOut, { rahul: 0, legacy: 0 })
    await shot(R, page, 'v5e-03-signed-out-desk')
    await ctx.setOffline(false)
    await page.unroute(/\/sync\/pull/)
    await page.waitForTimeout(500)

    await armStripWatch(page)
    const bAt = await signIn(page, USERS.A.user)
    R.againSync = await waitSynced(page, log, bAt)
    await page.waitForTimeout(1500)
    R.againStripSequence = await readStripWatch(page)
    R.againUploads = log.sync.filter((e) => e.at >= bAt && /sync[./]upload/.test(e.path))
    R.storeAgain = await storeFacts(page)
    expectFiles(R, 'rahul signed in again and synced', R.storeAgain, { rahul: 1, legacy: 0 })
    await shot(R, page, 'v5e-04-rahul-again-synced-desk')
    const draftId = R.draft?.id ?? '00000000-0000-0000-0000-000000000000'
    R.sqlOrderById = sql(`select id, order_no, state, source, salesperson_id, created_at from sales_orders where id='${draftId}'`)
    R.sqlAfter = ordersOfRahulAtChavan()
    R.console = log.console.slice(0, 40)
    R.failed = log.failed.slice(0, 40)
    R.syncLog = log.sync
    R.summary = {
      placeInsideStall: { expected: true, observed: R.insideStall },
      orderScreen: { expected: "an error line; never 'Saved on this phone'", observed: R.afterPlace },
      fileAfterSignOut: { expected: '0 (or 1 if the write landed first)', observed: kept },
      stripWhenBack: { expected: "no 'waiting' (or '1 waiting' then 'Updated just now' if it landed)", observed: R.againStripSequence },
      uploadsWhenBack: { expected: 0, observed: R.againUploads.length },
      dosQaOrder: { expected: 'no row with the draft id (or exactly one if it landed)', observed: R.sqlOrderById },
    }
  } finally {
    await ctx.close()
  }
}

// ---------------------------------------------------------------------------------------------------------------

// One results file per invocation, so a later run never overwrites an earlier one's evidence.
const RESULTS = `${OUT}results${only.length > 0 ? `-${only.join('-')}` : '-all'}.json`
results.sqlExpectLive = /v5/.test(only.join(' ')) || only.length === 0 ? sql(SQL_EXPECT_QUERY) : null
const browser = await chromium.connectOverCDP(CDP)
try {
  for (const [name, fn] of [
    ['v1', v1],
    ['v3', v3],
    ['v4', v4],
    ['v5a', v5a],
    ['v5b', v5b],
    ['v5c', v5c],
    ['v5d', v5d],
    ['v5e', v5e],
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
