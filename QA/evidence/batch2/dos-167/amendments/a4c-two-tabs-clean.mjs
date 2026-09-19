// DOS-167 amendment A4, run C — the CLEAN two-tab case, on a fresh browser profile.
//
// Run A did the same walk but ended with an extra probe (tab 2's Sign out) that cleared the shared session and
// stopped the last two assertions being made on the tab-1 reload path. Run C keeps the order A4 asks for and puts
// the sign-out probe LAST, guarded: the tap only happens once tab 2's own strip says something is waiting, so a
// sheet is certain and Cancel ends it.
//
//   1. tab 1 signs in, opens a PERSISTENT store, and queues an order with the page offline.
//   2. tab 2 opens on the same profile, same person, while tab 1 still holds the file.
//   3. tab 1 is re-read: still persistent, queue intact, pool header unchanged, no orphan.
//   4. tab 2's leave sheet on a memory store: no "Sign out, keep here".
//   5. tab 2 is CLOSED, tab 1 is RELOADED while still offline — the change must still be there.
//   6. tab 1 comes back online — the change must go, and dos_qa must hold it exactly once.
//
// A single-tab CONTROL window (tab 1 alone, offline, 30 s) runs before tab 2 opens so any page error can be told
// apart from one the second tab caused.
//
// Usage: node a4c-two-tabs-clean.mjs
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire('/Users/prajwalchavan/Desktop/Distribution OS/QA/tools/package.json')
const { chromium } = require('playwright')

const APP = 'http://localhost:5175'
const ORIGIN = new URL(APP).origin
const PROFILE =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/a4c-profile'
rmSync(PROFILE, { recursive: true, force: true })
const OUT = HERE
mkdirSync(OUT, { recursive: true })
const PASSWORD = 'Dos@1234'
const RAHUL = { user: 'rahul.deshmukh', userId: '8760e17e-4830-7395-a946-1e02fffa1ad7', tenantId: '01a0b9b5-4765-777d-8073-f34f3a983513' }
const SHOP = { id: '34191c43-f0bc-70ab-a39d-fcbe8f94ae36', name: 'Shree Ganesh Kirana' }
const digits = (id) => BigInt(`0x${id.toLowerCase().replaceAll('-', '')}`).toString(36).padStart(25, '0')
const WANTED = `/s${digits(RAHUL.userId)}${digits(RAHUL.tenantId)}`
const NOT_PERSISTED = 'will not keep the offline copy'
const SAVED_ON_PHONE = 'Saved on this phone'

const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
const QA_DB = 'postgres://dos:dos@127.0.0.1:5439/dos_qa'
const sql = (q) => {
  if (!/\/dos_qa$/.test(QA_DB)) throw new Error('dos_qa only')
  if (!/^\s*(select|with)\b/i.test(q)) throw new Error('read-only')
  try {
    return execFileSync(PSQL, [QA_DB, '-X', '-A', '-F', '|', '-c', q], { encoding: 'utf8' }).trim()
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
  console.log(JSON.stringify(row).slice(0, 550))
}

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1280, height: 860 } })
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
await ctx.grantPermissions(['local-network-access'], { origin: ORIGIN }).catch(() => {})

const net = []
const errs = []
function attach(page, tag) {
  const watch = (source, target) =>
    target.on('console', (m) => {
      const text = m.text().slice(0, 400)
      if (/offline:|persistent|memory|sqlite|not a database|cannot create file|vfs|file not found/i.test(text)) push({ kind: 'console', tab: tag, source, type: m.type(), text })
    })
  watch('page', page)
  page.on('pageerror', (e) => {
    const row = { t: at(), tab: tag, text: String(e).slice(0, 250) }
    errs.push(row)
    push({ kind: 'pageerror', ...row })
  })
  page.on('worker', (w) => watch('worker', w))
  const rec = (kind, extra) => (r) => {
    if (/:300\d\//.test(r.url())) net.push({ t: at(), tab: tag, kind, path: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 110), ...extra(r) })
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
          if (handle.kind === 'directory') await walk(handle, `${path}/`)
          else {
            const entry = { path, kind: 'file' }
            try {
              const f = await handle.getFile()
              entry.size = f.size
              const head = new Uint8Array(await f.slice(0, 512).arrayBuffer())
              const end = head.indexOf(0)
              entry.sqlitePath = new TextDecoder().decode(head.subarray(0, end < 0 ? 512 : end))
              entry.magic = new TextDecoder().decode(new Uint8Array(await f.slice(4096, 4112).arrayBuffer())).replace(/[^ -~]/g, '.')
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
    who: (body.match(/Rahul[^\n]{0,25}/i) ?? [''])[0],
  }
  push({ kind: 'says', ...f })
  return f
}
async function signIn(page, tag) {
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 150000 })
  await page.fill('[data-testid=sign-in-username]', RAHUL.user)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  await page.click('[data-testid=sign-in-submit]')
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 120000 })
  push({ kind: 'signed-in', tab: tag })
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
  await sleep(1200)
  push({ kind: 'page-offline', tab: tag, offline, navigatorOnLine: await page.evaluate(() => navigator.onLine).catch(() => null) })
}
/** Adds one case at this shop's order entry; the catalog must already be warm. */
async function addOneCase(page) {
  const add = page.locator('button:visible', { hasText: /^Add a case$/ })
  const ok = await add.first().waitFor({ timeout: 45000 }).then(() => true).catch(() => false)
  if (!ok) return { gotCatalog: false, lines: [] }
  for (let i = 0; i < 8; i += 1) {
    const before = await readDraft(page)
    if (before.lines.length >= 1) break
    await add.nth(i).click({ timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(1100)
  }
  return { gotCatalog: true, ...(await readDraft(page)) }
}

const R = { app: APP, wantedHeader: WANTED, shop: SHOP }
try {
  // ---------------------------------------------------- 1. tab 1: persistent store
  const t1 = ctx.pages()[0] ?? (await ctx.newPage())
  attach(t1, 'tab1')
  await t1.goto(APP, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await t1.waitForSelector('[data-testid=sign-in-username]', { timeout: 180000 })
  await signIn(t1, 'tab1')
  await sleep(10000)
  R.tab1Open = await says(t1, 'tab1 signed in, persistent store expected')
  await shot(t1, 'a4c-01-tab1-persistent-home.png')
  R.opfsOpen = facts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'tab1 open', ...R.opfsOpen })

  // warm the catalog while there is still a signal, then queue with none
  await softGo(t1, `/orders/new?retailerId=${SHOP.id}`)
  await sleep(6000)
  await setPageOffline(t1, true, 'tab1')
  R.tab1Draft = await addOneCase(t1)
  push({ kind: 'draft', tab: 'tab1', ...R.tab1Draft })
  R.orderId = R.tab1Draft.id
  R.placeLabel = await t1.evaluate(() => document.querySelector('[data-testid=place-order]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null)
  await shot(t1, 'a4c-02-tab1-draft-offline.png')
  await t1.click('[data-testid=place-order]')
  await sleep(4000)
  R.tab1Queued = await says(t1, 'tab1 order queued, unsent')
  await shot(t1, 'a4c-03-tab1-order-queued.png')
  R.opfsQueued = facts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'tab1 queued', ...R.opfsQueued })
  R.sqlBefore = sql(`select count(*) from sales_orders where id='${R.orderId}'`)
  push({ kind: 'sql', when: 'before tab 2', count: R.sqlBefore })

  // ---------------------------------------------------- CONTROL: tab 1 alone, offline, 30 s
  const controlFrom = at()
  await sleep(30000)
  R.controlErrors = errs.filter((e) => e.t >= controlFrom).map((e) => e.text)
  push({ kind: 'control-window', seconds: 30, pageErrors: R.controlErrors })
  R.tab1AfterControl = await says(t1, 'tab1 after 30 s alone and offline')
  R.opfsAfterControl = facts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'after control', ...R.opfsAfterControl })

  // ---------------------------------------------------- 2. tab 2, same person, same browser
  const tab2From = at()
  const t2 = await ctx.newPage()
  attach(t2, 'tab2')
  await t2.goto(APP, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await sleep(10000)
  R.tab2Early = await says(t2, 'tab2, ten seconds after opening')
  await shot(t2, 'a4c-04-tab2-early.png')
  if (R.tab2Early.signInForm) {
    push({ kind: 'tab2-needed-sign-in' })
    await signIn(t2, 'tab2')
    await sleep(8000)
  }
  R.tab2Settled = await says(t2, 'tab2 settled')
  R.tab2SaidMemoryAfterMs = R.tab2Settled.notPersisted ? at() - tab2From : null
  await shot(t2, 'a4c-05-tab2-memory-line.png')
  await t2.screenshot({ path: join(OUT, 'a4c-06-tab2-full.png'), fullPage: true }).catch(() => {})
  R.opfsFromTab2 = facts(await opfsWalk(t2))
  push({ kind: 'opfs', when: 'from tab2', ...R.opfsFromTab2 })
  R.tab2Errors = errs.filter((e) => e.tab === 'tab2').map((e) => e.text)

  // ---------------------------------------------------- 3. tab 1 must be untouched
  R.tab1WithTab2 = await says(t1, 'tab1 while tab2 is open')
  await shot(t1, 'a4c-07-tab1-while-tab2-open.png')
  R.opfsWithTab2 = facts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'tab1 while tab2 open', ...R.opfsWithTab2 })
  await softGo(t1, '/orders')
  await sleep(3000)
  R.tab1OrderRowsWithTab2 = await t1.evaluate(() => document.querySelectorAll('[data-testid^="order-row-"]').length)
  push({ kind: 'tab1-order-rows', when: 'tab2 open', rows: R.tab1OrderRowsWithTab2 })
  await shot(t1, 'a4c-08-tab1-orders-while-tab2-open.png')
  R.tab1ErrorsAfterTab2 = errs.filter((e) => e.tab === 'tab1' && e.t >= tab2From).map((e) => `${e.t}: ${e.text}`)

  // ---------------------------------------------------- 4. tab 2's leave sheet (guarded)
  await softGo(t2, `/orders/new?retailerId=${SHOP.id}`)
  await sleep(6000)
  await setPageOffline(t2, true, 'tab2')
  R.tab2Draft = await addOneCase(t2)
  push({ kind: 'draft', tab: 'tab2', ...R.tab2Draft })
  if (R.tab2Draft.gotCatalog && R.tab2Draft.lines.length > 0) {
    await t2.click('[data-testid=place-order]').catch((e) => push({ kind: 'tab2-place-failed', error: String(e).slice(0, 140) }))
    await sleep(4000)
  }
  R.tab2BeforeLeave = await says(t2, 'tab2 before the Sign out tap')
  await shot(t2, 'a4c-09-tab2-before-sign-out.png')
  if (/waiting to send/.test(R.tab2BeforeLeave.strip)) {
    await t2.click('button[aria-haspopup=menu]').catch(() => {})
    await sleep(800)
    await t2.getByText('Sign out', { exact: true }).last().click().catch((e) => push({ kind: 'tab2-signout-failed', error: String(e).slice(0, 140) }))
    await sleep(2500)
    R.tab2LeaveSheet = await t2.evaluate(() => ({
      sheet: document.querySelector('[data-testid=leave-sheet]') !== null,
      text: document.querySelector('[data-testid=leave-sheet]')?.innerText?.replace(/\s+/g, ' ').slice(0, 400) ?? null,
      body: document.querySelector('[data-testid=leave-body]')?.textContent ?? null,
      keepButton: document.querySelector('[data-testid=leave-keep]') !== null,
      sendNowButton: document.querySelector('[data-testid=leave-send-now]') !== null,
      cancelButton: document.querySelector('[data-testid=leave-cancel]') !== null,
      signInForm: document.querySelector('[data-testid=sign-in-username]') !== null,
    }))
    await shot(t2, 'a4c-10-tab2-leave-sheet.png')
    push({ kind: 'tab2-leave-sheet', ...R.tab2LeaveSheet })
    if (R.tab2LeaveSheet.cancelButton) await t2.click('[data-testid=leave-cancel]').catch(() => {})
    await sleep(1500)
    R.tab2AfterCancel = await says(t2, 'tab2 after Cancel')
  } else {
    R.tab2LeaveSheet = { skipped: 'tab 2 had nothing waiting, so the tap would have signed the shared session out' }
    push({ kind: 'tab2-leave-sheet-skipped', strip: R.tab2BeforeLeave.strip })
  }

  // ---------------------------------------------------- 5. close tab 2, reload tab 1 (still offline)
  await t2.close()
  push({ kind: 'tab2-closed' })
  await sleep(2000)
  R.tab1BeforeReload = await says(t1, 'tab1 just before the reload')
  await t1.reload({ waitUntil: 'domcontentloaded', timeout: 180000 }).catch((e) => push({ kind: 'reload-error', error: String(e).slice(0, 200) }))
  await sleep(12000)
  R.tab1AfterReload = await says(t1, 'tab1 reloaded, still offline')
  await shot(t1, 'a4c-11-tab1-reloaded-offline.png')
  R.opfsAfterReload = facts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'after reload, offline', ...R.opfsAfterReload })
  await softGo(t1, '/orders')
  await sleep(4000)
  R.tab1OrderRowsAfterReload = await t1.evaluate(() => document.querySelectorAll('[data-testid^="order-row-"]').length)
  R.tab1OrdersBodyAfterReload = (await t1.innerText('body').catch(() => '')).slice(0, 900)
  push({ kind: 'tab1-order-rows', when: 'after reload', rows: R.tab1OrderRowsAfterReload })
  await shot(t1, 'a4c-12-tab1-orders-after-reload.png')

  // ---------------------------------------------------- 6. back online — does it go, and how soon?
  const onlineAt = at()
  await setPageOffline(t1, false, 'tab1')
  const deadline = Date.now() + 150000
  while (Date.now() < deadline && !net.some((e) => e.tab === 'tab1' && e.t >= onlineAt && e.kind === 'response' && /sync[./]upload/.test(e.path) && e.status === 200)) await sleep(400)
  R.syncAfterOnline = net.filter((e) => e.tab === 'tab1' && e.t >= onlineAt && e.kind === 'request' && /\/sync[./]/.test(e.path)).map((e) => ({ t: e.t - onlineAt, method: e.method, path: e.path.slice(0, 60) }))
  R.firstUploadAfterOnlineMs = R.syncAfterOnline.find((e) => /upload/.test(e.path))?.t ?? null
  R.firstPullAfterOnlineMs = R.syncAfterOnline.find((e) => /pull/.test(e.path))?.t ?? null
  push({ kind: 'sync-after-online', firstUploadMs: R.firstUploadAfterOnlineMs, firstPullMs: R.firstPullAfterOnlineMs, calls: R.syncAfterOnline.slice(0, 12) })
  await sleep(8000)
  R.tab1Sent = await says(t1, 'tab1 after the queue went')
  await shot(t1, 'a4c-13-tab1-sent.png')
  await softGo(t1, '/orders')
  await sleep(3500)
  await shot(t1, 'a4c-14-tab1-orders-sent.png')
  R.opfsFinal = facts(await opfsWalk(t1))
  push({ kind: 'opfs', when: 'final', ...R.opfsFinal })
  R.sqlAfter = {
    count: sql(`select count(*) from sales_orders where id='${R.orderId}'`),
    row: sql(`select id, order_no, state, source, salesperson_id, retailer_id from sales_orders where id='${R.orderId}'`),
    lines: sql(`select count(*) from sales_order_lines where order_id='${R.orderId}'`),
  }
  push({ kind: 'sql-final', ...R.sqlAfter })
} catch (error) {
  R.fatal = String(error).slice(0, 600)
  push({ kind: 'fatal', error: R.fatal })
} finally {
  R.net = net
  R.pageErrors = errs
  writeFileSync(join(OUT, 'a4c-result.json'), JSON.stringify(R, null, 1))
  writeFileSync(join(OUT, 'a4c-events.json'), JSON.stringify(events, null, 1))
  await ctx.close().catch(() => {})
}
console.log('\nDONE — a4c-result.json written')
