// S-138 diagnosis (DOS-167 ruling 3). One run = one FRESH browser context (its own OPFS partition):
// open the sales web app with COOP/COEP injected (persistent OPFS store), optionally hold the expo-sqlite
// main-thread chunk and its worker bundle back by --delay ms, sign in, watch for N ms, then walk OPFS.
//
// Usage: node diag.mjs --label run --delay 600 [--user rahul] [--watch 25000] [--app http://localhost:5175]
//        [--reuse-profile] [--reload] [--second amit]
// Needs: the sales Metro on :5175 and a QA Chromium on CDP :$PW_PORT (default 9341).
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)

const LABEL = arg('label', 'run')
const DELAY = Number(arg('delay', '0'))
const USER = arg('user', 'rahul')
const SECOND = arg('second', null)
const WATCH = Number(arg('watch', '25000'))
const APP = arg('app', 'http://localhost:5175')
const ORIGIN = new URL(APP).origin
const SLOW = new RegExp(arg('slow', 'expo-sqlite\\/(build\\/index|web\\/worker)\\.bundle'))
const OUT = join(HERE, 'runs')
mkdirSync(OUT, { recursive: true })
const CDP = `http://127.0.0.1:${process.env.PW_PORT ?? '9341'}`
const PASSWORD = 'Dos@1234'

const IDS = {
  rahul: { user: 'rahul.deshmukh', userId: '8760e17e-4830-7395-a946-1e02fffa1ad7', tenantId: '01a09a5b-3c58-71c1-a34d-b93c569b0099' },
  kiran: { user: 'kiran.mhatre', userId: '2239ec93-0bcd-7737-a70c-c60aa4d9e9f1', tenantId: '82f5c562-b7eb-7521-8e19-4aa6befc64f8' },
  amit: { user: 'amit.pawar', userId: 'efde1e76-9785-7827-aff2-6f56ecd33588', tenantId: '01a09a5b-3c58-71c1-a34d-b93c569b0099' },
}
const digits = (id) => BigInt(`0x${id.toLowerCase().replaceAll('-', '')}`).toString(36).padStart(25, '0')
const storeFile = (who) => `s${digits(IDS[who].userId)}${digits(IDS[who].tenantId)}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The OPFS walk (same rule as s-098): each wa-sqlite pool file carries the SQLite path in its first 512 bytes.
async function opfsWalk(page) {
  return page
    .evaluate(async () => {
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
              entry.error = String(error).slice(0, 200)
            }
            entries.push(entry)
          }
        }
      }
      try {
        await walk(await navigator.storage.getDirectory(), '')
      } catch (error) {
        entries.push({ path: '(root)', kind: 'error', error: String(error).slice(0, 200) })
      }
      return entries.sort((a, b) => a.path.localeCompare(b.path))
    })
    .catch((error) => [{ path: '(walk failed)', kind: 'error', error: String(error).slice(0, 200) }])
}

const browser = await chromium.connectOverCDP(CDP)
const t0 = Date.now()
const events = []
const at = () => Date.now() - t0
const push = (e) => {
  events.push({ t: at(), ...e })
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['local-network-access'] })
const delayed = []
let delayActive = true
await ctx.route((u) => u.origin === ORIGIN, async (route) => {
  const url = route.request().url()
  const slow = delayActive && DELAY > 0 && SLOW.test(url)
  let response
  try {
    response = await route.fetch()
  } catch {
    await route.continue().catch(() => {})
    return
  }
  if (slow) {
    const began = Date.now()
    await sleep(DELAY)
    delayed.push({ url, heldMs: Date.now() - began, at: at() })
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
const watch = (source, target) => {
  target.on('console', (m) => {
    const text = m.text().slice(0, 400)
    if (/offline:|persistent store|running in memory|sqlite|cannot create file|file not found|not a database|DOSDIAG|Disassociating|unexpected flags|vfs/i.test(text))
      push({ kind: 'console', source, type: m.type(), text })
  })
}
watch('page', page)
page.on('pageerror', (e) => push({ kind: 'pageerror', text: String(e).slice(0, 300) }))
page.on('worker', (w) => {
  push({ kind: 'worker-created', url: w.url().slice(0, 120) })
  watch('worker', w)
  w.on('close', () => push({ kind: 'worker-closed' }))
})
page.on('request', (r) => {
  const u = r.url()
  if (/:300\d\//.test(u)) push({ kind: 'request', method: r.method(), url: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 160) })
})
page.on('response', (r) => {
  const u = r.url()
  if (/:300\d\//.test(u)) push({ kind: 'response', status: r.status(), url: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 160) })
})

await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 240000 })
await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 240000 })
push({ kind: 'sign-in-form' })

async function signIn(who) {
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 60000 })
  await page.fill('[data-testid=sign-in-username]', IDS[who].user)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  push({ kind: 'sign-in-click', who })
  await page.click('[data-testid=sign-in-submit]')
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 60000 })
  push({ kind: 'signed-in', who })
}
await signIn(USER)

const walkEarly = await opfsWalk(page)
push({ kind: 'opfs-early', files: walkEarly.filter((e) => e.kind === 'file').length })

// Watch the beat screen while the store is meant to open.
const deadline = Date.now() + WATCH
let lastBeat = ''
while (Date.now() < deadline) {
  const body = await page.innerText('body').catch(() => '')
  const beat = JSON.stringify({
    notPersisted: /will not keep the offline copy/i.test(body),
    stillLoading: /Still loading the beat/i.test(body),
    updated: /Updated just now|Updated /i.test(body),
    notUpdated: /Not updated yet/i.test(body),
  })
  if (beat !== lastBeat) {
    push({ kind: 'beat', ...JSON.parse(beat) })
    lastBeat = beat
  }
  await sleep(500)
}
const bodyText = await page.innerText('body').catch(() => '')
await page.screenshot({ path: join(OUT, `${LABEL}-beat.png`) }).catch(() => {})
writeFileSync(join(OUT, `${LABEL}-beat.txt`), bodyText)

const walk = await opfsWalk(page)
push({ kind: 'opfs-final', files: walk.filter((e) => e.kind === 'file').length })

const crossOriginIsolated = await page.evaluate(() => globalThis.crossOriginIsolated === true).catch(() => null)

// Optionally: reload in the SAME context (same OPFS) — does it heal?
let afterReload = null
if (flag('reload')) {
  delayActive = false // the reload is a NORMAL, fast load: does the browser profile heal itself?
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 240000 })
  push({ kind: 'reloaded' })
  await sleep(WATCH)
  const b = await page.innerText('body').catch(() => '')
  afterReload = {
    body: b.slice(0, 600),
    notPersisted: /will not keep the offline copy/i.test(b),
    stillLoading: /Still loading the beat/i.test(b),
    walk: await opfsWalk(page),
    syncCalls: events.filter((e) => e.kind === 'request' && /\/sync\//.test(e.url)).length,
    signedIn: !(await page.$('[data-testid=sign-in-username]')),
  }
  afterReload.manifestAfter = events.filter((e) => e.kind === 'request' && /manifest/.test(e.url)).length
  afterReload.headers = afterReload.walk.filter((e) => e.kind === 'file' && e.sqlitePath).map((e) => e.sqlitePath)
  afterReload.healed = afterReload.headers.includes(`/${storeFile(USER)}`) && !afterReload.notPersisted
}

// Optionally: a second person signs in in the same tab.
let second = null
if (SECOND !== null) {
  const before = events.length
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => /^Sign out$/i.test(n.textContent ?? ''))
    el?.click?.()
  }).catch(() => {})
  await sleep(1500)
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 240000 }).catch(() => {})
  await signIn(SECOND).catch((e) => push({ kind: 'second-signin-failed', text: String(e).slice(0, 200) }))
  await sleep(WATCH)
  const b = await page.innerText('body').catch(() => '')
  second = {
    who: SECOND,
    notPersisted: /will not keep the offline copy/i.test(b),
    stillLoading: /Still loading the beat/i.test(b),
    walk: await opfsWalk(page),
    newEvents: events.slice(before),
  }
  second.headers = second.walk.filter((e) => e.kind === 'file' && e.sqlitePath).map((e) => e.sqlitePath)
}

const syncRequests = events.filter((e) => e.kind === 'request' && /\/sync\//.test(e.url))
const headers = walk.filter((e) => e.kind === 'file' && e.sqlitePath).map((e) => e.sqlitePath)
const wanted = `/${storeFile(USER)}`
const result = {
  label: LABEL,
  delayMs: DELAY,
  user: USER,
  delayed,
  crossOriginIsolated,
  wantedHeader: wanted,
  headers,
  poolFiles: walk.filter((e) => e.kind === 'file').length,
  walk,
  walkEarly,
  syncRequests: syncRequests.map((e) => ({ t: e.t, url: e.url })),
  manifestCalls: syncRequests.filter((e) => /manifest/.test(e.url)).length,
  pullCalls: syncRequests.filter((e) => /pull/.test(e.url)).length,
  offlineLines: events.filter((e) => /offline:/.test(e.text ?? '')).map((e) => ({ t: e.t, source: e.source, text: e.text })),
  notADatabase: events.filter((e) => /not a database/i.test(e.text ?? '')).length,
  cannotCreate: events.filter((e) => /cannot create file/i.test(e.text ?? '')).length,
  beatFinal: {
    notPersisted: /will not keep the offline copy/i.test(bodyText),
    stillLoading: /Still loading the beat/i.test(bodyText),
  },
  afterReload,
  second,
  events,
}
result.pass =
  headers.includes(wanted) &&
  result.manifestCalls > 0 &&
  result.pullCalls > 0 &&
  result.notADatabase === 0 &&
  result.cannotCreate === 0 &&
  !result.beatFinal.notPersisted
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(result, null, 1))
console.log(
  `[${LABEL}] delay=${DELAY} pass=${result.pass} header=${headers.includes(wanted)} manifest=${result.manifestCalls} pull=${result.pullCalls} notADatabase=${result.notADatabase} cannotCreate=${result.cannotCreate} notPersisted=${result.beatFinal.notPersisted} pool=${result.poolFiles}`,
)
console.log(`  headers: ${JSON.stringify(headers)}`)
await ctx.close()
await browser.close()
