// DOS-167 amendment A4, part B — THE SAME BROWSER PROFILE run A left behind.
//
// Run A ended with rahul signed out (the second tab's own sign-out cleared the shared session) and his
// persistent OPFS file still on disk holding ONE order he had saved on the phone while offline — order
// 01a0ba24-f6cc-702b-965b-e7d3e9122bb9, which dos_qa had never seen.
//
// Founder answer A: the unsent change stays on that browser for that person and GOES FIRST at that person's next
// sign-in. This signs him in again, changing nothing else, and records what goes first and what dos_qa ends with.
//
// Usage: node a4b-next-sign-in.mjs
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire('/Users/prajwalchavan/Desktop/Distribution OS/QA/tools/package.json')
const { chromium } = require('playwright')

const APP = 'http://localhost:5175'
const ORIGIN = new URL(APP).origin
const PROFILE =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/a4-profile'
const OUT = HERE
mkdirSync(OUT, { recursive: true })
const PASSWORD = 'Dos@1234'
const ORDER_ID = '01a0ba24-f6cc-702b-965b-e7d3e9122bb9'
const RAHUL = { user: 'rahul.deshmukh', userId: '8760e17e-4830-7395-a946-1e02fffa1ad7', tenantId: '01a0b9b5-4765-777d-8073-f34f3a983513' }
const digits = (id) => BigInt(`0x${id.toLowerCase().replaceAll('-', '')}`).toString(36).padStart(25, '0')
const WANTED = `/s${digits(RAHUL.userId)}${digits(RAHUL.tenantId)}`
const NOT_PERSISTED = 'will not keep the offline copy'

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
  console.log(JSON.stringify(row).slice(0, 500))
}

const R = { orderId: ORDER_ID, wantedHeader: WANTED }
R.sqlBefore = sql(`select count(*) from sales_orders where id='${ORDER_ID}'`)
push({ kind: 'sql-before-sign-in', orderRows: R.sqlBefore })

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1280, height: 860 } })
await ctx.route(
  (u) => u.origin === ORIGIN,
  async (route) => {
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
  },
)
await ctx.grantPermissions(['local-network-access'], { origin: ORIGIN }).catch(() => {})

const net = []
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('console', (m) => {
  const text = m.text().slice(0, 400)
  if (/offline:|persistent|memory|sqlite|not a database|vfs/i.test(text)) push({ kind: 'console', type: m.type(), text })
})
page.on('pageerror', (e) => push({ kind: 'pageerror', text: String(e).slice(0, 250) }))
page.on('request', (r) => {
  if (/:300\d\//.test(r.url())) net.push({ t: at(), kind: 'request', method: r.method(), path: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 110) })
})
page.on('response', (r) => {
  if (/:300\d\//.test(r.url())) net.push({ t: at(), kind: 'response', status: r.status(), path: r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 110) })
})

const opfsWalk = () =>
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
              const file = await handle.getFile()
              entry.size = file.size
              const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
              const end = head.indexOf(0)
              entry.sqlitePath = new TextDecoder().decode(head.subarray(0, end < 0 ? 512 : end))
              entry.magic = new TextDecoder().decode(new Uint8Array(await file.slice(4096, 4112).arrayBuffer())).replace(/[^ -~]/g, '.')
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
  sizes: files.filter((f) => f.sqlitePath === WANTED).map((f) => f.size),
  magic: files.filter((f) => f.sqlitePath === WANTED).map((f) => f.magic),
  unreadable: files.filter((f) => f.error).length,
})
const strip = async () => {
  const loc = page.locator('[data-testid=connection]:visible').first()
  return (await loc.count()) === 0 ? '(none)' : (await loc.innerText().catch(() => '(unreadable)')).replace(/\s+/g, ' ').trim()
}
const shot = async (n) => {
  await page.screenshot({ path: join(OUT, n) }).catch(() => {})
  push({ kind: 'screenshot', file: n })
}
const says = async (label) => {
  const body = await page.innerText('body').catch(() => '')
  const f = {
    label,
    notPersisted: body.includes(NOT_PERSISTED),
    stillLoading: /Still loading the beat/i.test(body),
    signInForm: (await page.locator('[data-testid=sign-in-username]').count()) > 0,
    path: await page.evaluate(() => location.pathname + location.search).catch(() => '?'),
    strip: await strip(),
  }
  push({ kind: 'says', ...f })
  return f
}

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 180000 })
  R.before = await says('the sign-in form run A left behind')
  R.opfsBefore = facts(await opfsWalk())
  push({ kind: 'opfs', when: 'before sign-in', ...R.opfsBefore })
  await shot('a4b-01-sign-in-form.png')

  const signedAt = at()
  await page.fill('[data-testid=sign-in-username]', RAHUL.user)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  await page.click('[data-testid=sign-in-submit]')
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 90000 })
  push({ kind: 'signed-in', afterMs: at() - signedAt })
  await sleep(2500)
  await shot('a4b-02-right-after-sign-in.png')

  // What the engine does FIRST on this sign-in.
  const deadline = Date.now() + 120000
  while (Date.now() < deadline && !net.some((e) => e.t >= signedAt && e.kind === 'response' && /sync[./]upload/.test(e.path) && e.status === 200)) await sleep(400)
  R.syncCalls = net.filter((e) => e.t >= signedAt && e.kind === 'request' && /\/sync[./]/.test(e.path)).map((e) => ({ t: e.t - signedAt, method: e.method, path: e.path }))
  R.firstSyncCall = R.syncCalls[0] ?? null
  R.firstUploadAt = R.syncCalls.find((e) => /upload/.test(e.path))?.t ?? null
  R.firstPullAt = R.syncCalls.find((e) => /pull/.test(e.path))?.t ?? null
  R.uploadBeforePull = R.firstUploadAt !== null && (R.firstPullAt === null || R.firstUploadAt <= R.firstPullAt)
  push({ kind: 'sync-order', first: R.firstSyncCall, firstUploadAt: R.firstUploadAt, firstPullAt: R.firstPullAt, uploadBeforePull: R.uploadBeforePull })

  await sleep(8000)
  R.after = await says('after the queue had gone')
  await shot('a4b-03-after-upload.png')
  R.opfsAfter = facts(await opfsWalk())
  push({ kind: 'opfs', when: 'after upload', ...R.opfsAfter })

  await page.evaluate(() => {
    history.pushState(null, '', '/orders')
    dispatchEvent(new PopStateEvent('popstate', { state: null }))
  })
  await sleep(4000)
  await shot('a4b-04-orders.png')
  R.ordersBody = (await page.innerText('body').catch(() => '')).slice(0, 900)

  R.sqlAfter = {
    count: sql(`select count(*) from sales_orders where id='${ORDER_ID}'`),
    row: sql(`select id, order_no, state, source, salesperson_id, retailer_id, created_at from sales_orders where id='${ORDER_ID}'`),
    lines: sql(`select count(*) from sales_order_lines where order_id='${ORDER_ID}'`),
    ops: sql(`select op_id, device_id, left(outcome::text,120) as outcome from sync_ops where payload::text like '%${ORDER_ID}%' limit 5`),
  }
  push({ kind: 'sql-after', ...R.sqlAfter })
} catch (error) {
  R.fatal = String(error).slice(0, 500)
  push({ kind: 'fatal', error: R.fatal })
} finally {
  R.net = net
  writeFileSync(join(OUT, 'a4b-result.json'), JSON.stringify(R, null, 1))
  writeFileSync(join(OUT, 'a4b-events.json'), JSON.stringify(events, null, 1))
  await ctx.close().catch(() => {})
}
console.log('\nDONE — a4b-result.json written')
