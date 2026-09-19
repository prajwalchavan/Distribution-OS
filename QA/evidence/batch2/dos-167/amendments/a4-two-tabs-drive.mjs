// DOS-167 amendment A4 — proved by OPERATING the sales web app in a real (headed) Chromium.
//
// A4 (Fable, 2026-09-19, ruling-3 architect review): "the S-138 fix must not let a second browser tab of the same
// signed-in person corrupt or evict the first tab's persistent OPFS file. The second tab, unable to acquire the
// exclusive access-pool, must fall to a memory store, say so, and leave tab 1's file and its queue intact."
//
// PASS =
//   (1) tab 1 opens a PERSISTENT store (its `/s…` pool header on disk) and holds a QUEUED, UNSENT order;
//   (2) tab 2, same browser profile, same person, falls to an HONEST memory store and SAYS so;
//   (3) tab 1's pool header is unchanged, no orphan/junk file appears, tab 1 still holds its unsent change;
//   (4) after tab 2 is CLOSED and tab 1 is RELOADED the change is still there and still GOES FIRST
//       (the upload precedes the pull, and dos_qa ends holding that order exactly once).
//   (5) extra: a tab on a memory store never offers "Sign out, keep here" (leaveButtons, ruling 2 (t)).
//
// Tab 1 is taken offline PER PAGE (CDP Network.emulateNetworkConditions) so the queue stays unsent while tab 2
// boots online — `browserContext.setOffline` is context-wide and would stop tab 2 from loading at all.
//
// Usage: node a4-two-tabs-drive.mjs [--app http://localhost:5175]
// Needs: the sales Metro on :5175, the services on :300x against dos_qa, playwright in QA/tools/node_modules.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire('/Users/prajwalchavan/Desktop/Distribution OS/QA/tools/package.json')
const { chromium } = require('playwright')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const APP = arg('app', 'http://localhost:5175')
const ORIGIN = new URL(APP).origin
const PROFILE =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/a4-profile'
const OUT = HERE
mkdirSync(OUT, { recursive: true })
const PASSWORD = 'Dos@1234'

// Read-only SQL, dos_qa only — never the founder's `dos`.
const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
const QA_DB = 'postgres://dos:dos@127.0.0.1:5439/dos_qa'
function sql(query) {
  if (!/\/dos_qa$/.test(QA_DB)) throw new Error(`refusing to query ${QA_DB}`)
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error('read-only: SELECT/WITH only')
  try {
    return execFileSync(PSQL, [QA_DB, '-X', '-A', '-F', '|', '-c', query], { encoding: 'utf8' }).trim()
  } catch (error) {
    return `(sql error: ${String(error?.stderr ?? error).slice(0, 300)})`
  }
}

// Identities read from dos_qa today (the database was rebuilt, so the s-098 constants no longer apply).
const RAHUL = {
  user: 'rahul.deshmukh',
  userId: '8760e17e-4830-7395-a946-1e02fffa1ad7',
  tenantId: '01a0b9b5-4765-777d-8073-f34f3a983513',
}
const SHOP = { id: '34191c43-f0bc-70ab-a39d-fcbe8f94ae36', name: 'Shree Ganesh Kirana' }
const digits = (id) => BigInt(`0x${id.toLowerCase().replaceAll('-', '')}`).toString(36).padStart(25, '0')
const WANTED = `/s${digits(RAHUL.userId)}${digits(RAHUL.tenantId)}`
const NOT_PERSISTED = 'will not keep the offline copy'
const SAVED_ON_PHONE = 'Saved on this phone'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const at = () => Date.now() - t0
const events = []
const push = (e) => {
  const row = { t: at(), ...e }
  events.push(row)
  console.log(JSON.stringify(row).slice(0, 600))
}
const save = () => writeFileSync(join(OUT, 'a4-events.json'), JSON.stringify(events, null, 1))

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 860 },
})

/*
 * COOP/COEP, which `expo start --web` does not send and OPFS sync access handles require (docs/26 sends them in
 * production). Responses are cached so a RELOAD taken while the page is offline still gets its bundle — the
 * queue, not the bundle, is what must survive being offline.
 */
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
      if (hit === undefined) {
        await route.abort().catch(() => {})
        return
      }
      push({ kind: 'served-from-cache', url: url.replace(ORIGIN, '').slice(0, 90) })
      await route.fulfill(hit)
      return
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

try {
  await ctx.grantPermissions(['local-network-access'], { origin: ORIGIN })
  push({ kind: 'granted', permission: 'local-network-access' })
} catch (error) {
  push({ kind: 'grant-failed', error: String(error).slice(0, 200) })
}

// ---------------------------------------------------------------------------------------------------- helpers

const net = [] // every /sync/* and /auth/* call, per tab, in the order the browser made it
function attach(page, tag) {
  const watch = (source, target) => {
    target.on('console', (m) => {
      const text = m.text().slice(0, 400)
      if (/offline:|persistent|memory|sqlite|not a database|cannot create file|vfs|file not found/i.test(text))
        push({ kind: 'console', tab: tag, source, type: m.type(), text })
    })
  }
  watch('page', page)
  page.on('pageerror', (e) => push({ kind: 'pageerror', tab: tag, text: String(e).slice(0, 300) }))
  page.on('worker', (w) => {
    push({ kind: 'worker', tab: tag, url: w.url().slice(0, 100) })
    watch('worker', w)
  })
  page.on('request', (r) => {
    const u = r.url()
    if (/:300\d\//.test(u)) net.push({ t: at(), tab: tag, kind: 'request', method: r.method(), path: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 110) })
  })
  page.on('response', (r) => {
    const u = r.url()
    if (/:300\d\//.test(u)) net.push({ t: at(), tab: tag, kind: 'response', status: r.status(), path: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 110) })
  })
  page.on('requestfailed', (r) => {
    const u = r.url()
    if (/:300\d\//.test(u)) net.push({ t: at(), tab: tag, kind: 'failed', path: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 110), error: r.failure()?.errorText })
  })
}

/** The OPFS pool, walked from whichever tab is asked: each wa-sqlite pool file names its SQLite path in its first 512 bytes. */
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
          } else {
            const entry = { path, kind: 'file' }
            try {
              const file = await handle.getFile()
              entry.size = file.size
              const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
              const end = head.indexOf(0)
              entry.sqlitePath = new TextDecoder().decode(head.subarray(0, end < 0 ? 512 : end))
              const magic = new Uint8Array(await file.slice(4096, 4112).arrayBuffer())
              entry.magic = new TextDecoder().decode(magic).replace(/[^ -~]/g, '.')
            } catch (error) {
              entry.error = String(error).slice(0, 200)
            }
            out.push(entry)
          }
        }
      }
      try {
        await walk(await navigator.storage.getDirectory(), '')
      } catch (error) {
        out.push({ path: '(root)', kind: 'error', error: String(error).slice(0, 200) })
      }
      return out.sort((a, b) => a.path.localeCompare(b.path))
    })
    .catch((error) => [{ path: '(walk failed)', kind: 'error', error: String(error).slice(0, 200) }])

/** What one tab's OPFS view amounts to, in the terms A4 judges. */
function poolFacts(files) {
  const headers = files.filter((f) => f.sqlitePath).map((f) => f.sqlitePath)
  return {
    fileCount: files.filter((f) => f.kind === 'file').length,
    headers,
    wantedPresent: headers.includes(WANTED),
    junk: headers.filter((h) => h !== '' && !/^\/[sdwh][0-9a-z]{50}$/.test(h)),
    unreadable: files.filter((f) => f.error).length,
    sizes: files.filter((f) => f.sqlitePath === WANTED).map((f) => f.size),
    magicOfWanted: files.filter((f) => f.sqlitePath === WANTED).map((f) => f.magic),
  }
}

const strip = async (page) => {
  const loc = page.locator('[data-testid=connection]:visible').first()
  if ((await loc.count()) === 0) return '(no connection strip)'
  return (await loc.innerText({ timeout: 3000 }).catch(() => '(unreadable)')).replace(/\s+/g, ' ').trim()
}
const bodyText = (page) => page.innerText('body').catch(() => '')
const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, name), fullPage: false }).catch(() => {})
  push({ kind: 'screenshot', file: name })
}

/** Everything the screen says that A4 cares about, in one sample. */
async function says(page, label) {
  const body = await bodyText(page)
  const facts = {
    label,
    notPersisted: body.includes(NOT_PERSISTED),
    stillLoading: /Still loading the beat/i.test(body),
    savedOnPhone: body.includes(SAVED_ON_PHONE),
    signInForm: (await page.locator('[data-testid=sign-in-username]').count()) > 0,
    path: await page.evaluate(() => location.pathname + location.search).catch(() => '(gone)'),
    strip: await strip(page),
    who: (body.match(/rahul[^\n]{0,30}/i) ?? [''])[0],
  }
  push({ kind: 'says', ...facts })
  return facts
}

async function signIn(page, tag) {
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 120000 })
  await page.fill('[data-testid=sign-in-username]', RAHUL.user)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  push({ kind: 'sign-in-click', tab: tag })
  await page.click('[data-testid=sign-in-submit]')
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 90000 })
  push({ kind: 'signed-in', tab: tag, url: page.url() })
}

async function softGo(page, url) {
  await page.evaluate((u) => {
    history.pushState(null, '', u)
    dispatchEvent(new PopStateEvent('popstate', { state: null }))
  }, url)
  await page.waitForFunction((u) => location.pathname + location.search === u, url, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1800)
}

const readDraft = (page) =>
  page.evaluate(
    ({ userId, retailerId }) => {
      const key = Object.keys(localStorage).find((k) => k.endsWith(`dos.sales.draft.${userId}.${retailerId}`))
      if (!key) return { key: null, lines: [], keys: Object.keys(localStorage).filter((k) => k.includes('draft')) }
      try {
        const value = JSON.parse(localStorage.getItem(key))
        return { key, id: value.id ?? null, lines: (value.lines ?? []).map((l) => ({ id: l.id, variantId: l.variantId, qtyPcs: l.qtyPcs })) }
      } catch {
        return { key, lines: [], raw: String(localStorage.getItem(key)).slice(0, 200) }
      }
    },
    { userId: RAHUL.userId, retailerId: SHOP.id },
  )

/** Per-page offline, so the other tab keeps its network. */
async function setPageOffline(page, offline, tag) {
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  await sleep(1200)
  const onLine = await page.evaluate(() => navigator.onLine).catch(() => null)
  push({ kind: 'page-offline', tab: tag, offline, navigatorOnLine: onLine })
  return cdp
}

async function waitFor(page, predicate, ms, what) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await predicate().catch(() => false)) {
      push({ kind: 'waited', what, ok: true, afterMs: ms - (deadline - Date.now()) })
      return true
    }
    await sleep(500)
  }
  push({ kind: 'waited', what, ok: false, afterMs: ms })
  return false
}

const R = { app: APP, wantedHeader: WANTED, rahul: RAHUL, shop: SHOP }

try {
  // ============================================================== 1. TAB 1: sign in, persistent store, sync
  const t1 = ctx.pages()[0] ?? (await ctx.newPage())
  attach(t1, 'tab1')
  await t1.goto(APP, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await t1.waitForSelector('[data-testid=sign-in-username]', { timeout: 180000 })
  await shot(t1, 'a4-01-tab1-sign-in.png')
  await signIn(t1, 'tab1')
  await waitFor(t1, async () => !(await bodyText(t1)).includes('Still loading the beat'), 180000, 'tab1 beat loaded')
  await sleep(6000)
  R.tab1AfterOpen = await says(t1, 'tab1 after sign-in, persistent store expected')
  await shot(t1, 'a4-02-tab1-home-persistent.png')
  R.opfsAfterOpen = poolFacts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'tab1 after open', ...R.opfsAfterOpen })

  // ============================================================== 2. TAB 1: queue an UNSENT order
  R.tab1Cdp = await setPageOffline(t1, true, 'tab1')
  await softGo(t1, `/orders/new?retailerId=${SHOP.id}`)
  const add = t1.locator('button:visible', { hasText: /^Add a case$/ })
  await add.first().waitFor({ timeout: 60000 })
  for (let i = 0; i < 8; i += 1) {
    const before = await readDraft(t1)
    if (before.lines.length >= 1) break
    await add.nth(i).click({ timeout: 20000 }).catch(() => {})
    await t1.waitForTimeout(1100)
  }
  R.draft = await readDraft(t1)
  push({ kind: 'draft', ...R.draft })
  await shot(t1, 'a4-03-tab1-draft-offline.png')
  const placeLabel = await t1.evaluate(() => document.querySelector('[data-testid=place-order]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null)
  push({ kind: 'place-label', label: placeLabel })
  R.placeLabel = placeLabel
  await t1.click('[data-testid=place-order]')
  await waitFor(t1, async () => (await bodyText(t1)).includes(SAVED_ON_PHONE), 30000, 'tab1 saved on phone')
  await sleep(2000)
  R.tab1Queued = await says(t1, 'tab1 with the order queued and unsent')
  await shot(t1, 'a4-04-tab1-order-queued.png')
  R.opfsAfterQueue = poolFacts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'tab1 after queueing', ...R.opfsAfterQueue })
  R.orderId = R.draft.id
  R.sqlBeforeTab2 = sql(`select count(*) from sales_orders where id='${R.orderId}'`)
  push({ kind: 'sql', when: 'before tab 2', orderRowsInDosQa: R.sqlBeforeTab2 })

  // ============================================================== 3. TAB 2: the same person, the same browser
  const t2 = await ctx.newPage()
  attach(t2, 'tab2')
  const tab2OpenedAt = at()
  await t2.goto(APP, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await sleep(8000)
  R.tab2Early = await says(t2, 'tab2 eight seconds after opening')
  await shot(t2, 'a4-05-tab2-early.png')
  if (R.tab2Early.signInForm) {
    push({ kind: 'tab2-needed-sign-in' })
    await signIn(t2, 'tab2')
  }
  await waitFor(t2, async () => (await bodyText(t2)).includes(NOT_PERSISTED), 60000, 'tab2 says memory')
  await sleep(4000)
  R.tab2Settled = await says(t2, 'tab2 once its store had resolved')
  R.tab2MemoryLineAfterMs = at() - tab2OpenedAt
  await shot(t2, 'a4-06-tab2-memory-line.png')
  await t2.screenshot({ path: join(OUT, 'a4-07-tab2-full.png'), fullPage: true }).catch(() => {})
  R.opfsFromTab2 = poolFacts(await opfsWalk(t2))
  push({ kind: 'opfs', when: 'walked from tab2', ...R.opfsFromTab2 })

  // ============================================================== 4. TAB 1: still whole?
  R.tab1WithTab2Open = await says(t1, 'tab1 while tab2 is open')
  await shot(t1, 'a4-08-tab1-while-tab2-open.png')
  R.opfsWithTab2Open = poolFacts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'tab1 while tab2 open', ...R.opfsWithTab2Open })
  await softGo(t1, '/orders')
  await sleep(2500)
  R.tab1OrdersWithTab2Open = {
    rows: await t1.evaluate(() => document.querySelectorAll('[data-testid^="order-row-"]').length),
    body: (await bodyText(t1)).slice(0, 700),
  }
  push({ kind: 'tab1-orders', when: 'tab2 open', rows: R.tab1OrdersWithTab2Open.rows })
  await shot(t1, 'a4-09-tab1-orders-while-tab2-open.png')

  // ================================== 5. TAB 2's leave sheet: a memory store must never offer to keep
  await setPageOffline(t2, true, 'tab2')
  await softGo(t2, `/orders/new?retailerId=${SHOP.id}`)
  const add2 = t2.locator('button:visible', { hasText: /^Add a case$/ })
  const gotCatalog = await add2
    .first()
    .waitFor({ timeout: 40000 })
    .then(() => true)
    .catch(() => false)
  if (gotCatalog) {
    for (let i = 0; i < 8; i += 1) {
      const before = await readDraft(t2)
      if (before.lines.length >= 1) break
      await add2.nth(i).click({ timeout: 20000 }).catch(() => {})
      await t2.waitForTimeout(1100)
    }
    await t2.click('[data-testid=place-order]').catch((e) => push({ kind: 'tab2-place-failed', error: String(e).slice(0, 160) }))
    await sleep(3000)
  }
  R.tab2BeforeLeave = await says(t2, 'tab2 before tapping Sign out')
  await shot(t2, 'a4-10-tab2-before-sign-out.png')
  await t2.click('button[aria-haspopup=menu]').catch(() => {})
  await sleep(700)
  await t2.getByText('Sign out', { exact: true }).last().click().catch((e) => push({ kind: 'tab2-signout-click-failed', error: String(e).slice(0, 160) }))
  await sleep(2500)
  R.tab2LeaveSheet = await t2.evaluate(() => ({
    sheet: document.querySelector('[data-testid=leave-sheet]') !== null,
    title: document.querySelector('[data-testid=leave-sheet]')?.innerText?.replace(/\s+/g, ' ').slice(0, 300) ?? null,
    body: document.querySelector('[data-testid=leave-body]')?.textContent ?? null,
    keep: document.querySelector('[data-testid=leave-keep]') !== null,
    sendNow: document.querySelector('[data-testid=leave-send-now]') !== null,
    cancel: document.querySelector('[data-testid=leave-cancel]') !== null,
    signInForm: document.querySelector('[data-testid=sign-in-username]') !== null,
  }))
  push({ kind: 'tab2-leave-sheet', ...R.tab2LeaveSheet })
  await shot(t2, 'a4-11-tab2-leave-sheet.png')
  if (R.tab2LeaveSheet.cancel) await t2.click('[data-testid=leave-cancel]').catch(() => {})
  await sleep(1500)
  R.tab2AfterCancel = await says(t2, 'tab2 after Cancel')

  // ============================================================== 6. CLOSE TAB 2, RELOAD TAB 1 (still offline)
  await t2.close()
  push({ kind: 'tab2-closed' })
  await sleep(2000)
  await t1.reload({ waitUntil: 'domcontentloaded', timeout: 180000 }).catch((e) => push({ kind: 'reload-error', error: String(e).slice(0, 200) }))
  await sleep(9000)
  R.tab1AfterReloadOffline = await says(t1, 'tab1 reloaded, still offline')
  await shot(t1, 'a4-12-tab1-reloaded-offline.png')
  R.opfsAfterReload = poolFacts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'tab1 after reload, offline', ...R.opfsAfterReload })
  await softGo(t1, '/orders')
  await sleep(3000)
  R.tab1OrdersAfterReload = {
    rows: await t1.evaluate(() => document.querySelectorAll('[data-testid^="order-row-"]').length),
    body: (await bodyText(t1)).slice(0, 900),
  }
  push({ kind: 'tab1-orders', when: 'after reload, offline', rows: R.tab1OrdersAfterReload.rows })
  await shot(t1, 'a4-13-tab1-orders-after-reload.png')

  // ============================================================== 7. BACK ONLINE: does it go first?
  const onlineAt = at()
  await setPageOffline(t1, false, 'tab1')
  R.netBeforeOnline = net.length
  await waitFor(
    t1,
    async () => net.some((e) => e.tab === 'tab1' && e.t >= onlineAt && e.kind === 'response' && /sync[./]upload/.test(e.path) && e.status === 200),
    180000,
    'tab1 uploaded after coming back',
  )
  await sleep(6000)
  R.tab1AfterOnline = await says(t1, 'tab1 back online')
  await shot(t1, 'a4-14-tab1-back-online.png')
  R.syncOrderAfterOnline = net
    .filter((e) => e.tab === 'tab1' && e.t >= onlineAt && e.kind === 'request' && /\/sync[./]/.test(e.path))
    .map((e) => ({ t: e.t - onlineAt, path: e.path }))
  push({ kind: 'sync-order-after-online', calls: R.syncOrderAfterOnline })
  await softGo(t1, '/orders')
  await sleep(3000)
  await shot(t1, 'a4-15-tab1-orders-sent.png')
  R.opfsFinal = poolFacts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'final', ...R.opfsFinal })

  R.sqlAfter = {
    orderRows: sql(`select id, order_no, state, source, salesperson_id, retailer_id, created_at from sales_orders where id='${R.orderId}'`),
    orderCount: sql(`select count(*) from sales_orders where id='${R.orderId}'`),
    lineCount: sql(`select count(*) from sales_order_lines where order_id='${R.orderId}'`),
  }
  push({ kind: 'sql-final', ...R.sqlAfter })
} catch (error) {
  R.fatal = String(error).slice(0, 600)
  push({ kind: 'fatal', error: R.fatal })
} finally {
  R.net = net
  writeFileSync(join(OUT, 'a4-result.json'), JSON.stringify(R, null, 1))
  save()
  await ctx.close().catch(() => {})
}
console.log('\nDONE — a4-result.json written')
