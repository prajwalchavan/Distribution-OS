// DOS-167 / S-138 — THE PERMANENT GATE: does a browser still open this person's offline copy, alone, under a slow
// load? Promoted from the diagnosis throwaway `QA/evidence/batch2/dos-167/reproof2/diagnose/diag.mjs` (41 executed
// runs) as ruling 3 requires, with Fable amendment A3 (2026-09-19) folded into the pass condition.
//
// WHAT A3 ADDED, AND WHY. The old pass condition was the OPFS pool header, the manifest, the pull, no
// "not a database", no "cannot create file" and no not-kept line. That is a check on the DAMAGE, and it can pass over
// a latent second VFS that has not damaged anything yet — while the failure mode itself is NOT delay-gated:
// `runs/warm-instr.json` built THREE `AccessHandlePoolVFS` instances over one OPFS directory and filled 12 pool slots
// at delay 0. So the gate now also asserts the CAUSE: at most one VFS construction and at most one WASM init per page
// load. Those two counts are not observable from outside expo-sqlite, so a run that is not instrumented cannot
// assert them and does not pass — instrument the tree first.
//
// One run = one FRESH browser context (its own OPFS partition): open the sales web app with COOP/COEP injected,
// optionally hold the expo-sqlite main-thread chunk and its worker bundle back by --delay ms, sign in, watch for N ms,
// walk OPFS, then judge.
//
// The pass condition itself is `dos-167-s138-verdict.mjs`, a sibling with no dependencies, so it can be imported
// and exercised without playwright and without a browser; `--selfcheck` runs it over both the ruling's recorded
// evidence and the synthetic console shapes no recorded run covers.
//
// Usage: node QA/tools/e2e/dos-167-s138-instrument.mjs            # once, so the DOSDIAG counts exist
//        node QA/tools/e2e/dos-167-s138-web-store.mjs --label cold-01 --delay 600 [--user rahul] [--watch 25000]
//              [--app http://localhost:5175] [--out <dir>] [--reload] [--second amit]
//        node QA/tools/e2e/dos-167-s138-web-store.mjs --verdict <run.json>     # judge a recorded run, no browser
//        node QA/tools/e2e/dos-167-s138-web-store.mjs --selfcheck [--runs <dir>]
// Needs (for a live run): the sales Metro on :5175 and a QA Chromium on CDP :$PW_PORT (default 9341).
// Exit code: 0 pass, 1 fail — so a lane can gate on it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The pass condition lives in the sibling so it can be IMPORTED: this file's `await import('playwright')` runs on
// import, so exporting the rule from here made it unreachable to anything but the CLI (review, 2026-09-19).
import { countInstrumentation, judge, verdict } from './dos-167-s138-verdict.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

// --verdict: judge one recorded run, no browser.
const VERDICT_FILE = argOf('verdict', null)
if (VERDICT_FILE !== null) {
  process.exit(judge(VERDICT_FILE).pass ? 0 : 1)
}

/*
 * --selfcheck: the gate judged against the ruling's OWN executed evidence, so a change to the pass condition is
 * caught without a browser. RED is the pre-fix run at delay 0 that the old condition would also have failed, but for
 * the damage only — it must now be failed by name for the three VFS instances and three WASM inits that CAUSED it.
 * GREEN is the serialised product (ruling 3 (aa), variant D) at 600 ms, instrumented: exactly one of each.
 */
if (process.argv.includes('--selfcheck')) {
  const runs = argOf('runs', join(HERE, '..', '..', 'evidence', 'batch2', 'dos-167', 'reproof2', 'diagnose', 'runs'))
  const problems = []
  console.log(`RED — the pre-fix build, instrumented, at delay 0 (${join(runs, 'warm-instr.json')}):`)
  const red = judge(join(runs, 'warm-instr.json'))
  if (red.pass) problems.push('warm-instr passed: the gate does not catch the pre-fix build')
  if (!red.reasons.some((r) => r.startsWith('vfsInstances 3 >'))) problems.push('warm-instr was not failed for its 3 VFS instances')
  if (!red.reasons.some((r) => r.startsWith('initCREATES 3 >'))) problems.push('warm-instr was not failed for its 3 WASM inits')
  console.log('GREEN — the serialised product (variant D), instrumented, at 600 ms:')
  for (const label of ['vD-d600-1', 'vD-d600-2', 'vD-d600-3']) {
    const green = judge(join(runs, `${label}.json`))
    if (!green.pass) problems.push(`${label} failed: ${green.reasons.join('; ')}`)
    if (green.vfsInstances !== 1 || green.initCREATES !== 1)
      problems.push(`${label} reported vfsInstances=${green.vfsInstances} initCREATES=${green.initCREATES}, wanted 1 and 1`)
  }

  /*
   * THE COUNTER'S OWN BLIND SPOTS (review, 2026-09-19), judged from synthetic console lists rather than a browser.
   * A recorded run cannot cover these: no run in the evidence happens to build two workers, and an unpatched tree
   * that still prints one `DOSDIAG msg` line has to be constructed. These four cases are what a unit test over the
   * pass condition would assert, which is why it is now importable (`dos-167-s138-verdict.mjs`).
   */
  console.log('COUNTER — the shapes a recorded run does not cover:')
  const lines = (...texts) => texts.map((text) => ({ text }))
  const counterCases = [
    {
      name: 'two workers, both calling themselves id=1',
      // The exact shape the id-set counter read as ONE: `id` is worker-scoped, so the second worker's first VFS is
      // also id=1. Counting distinct LINES (each carries its own t=) sees two.
      events: lines(
        'DOSDIAG main-worker-create t=10',
        'DOSDIAG init-enter call=1 sqlite3=false vfs=false t=11',
        'DOSDIAG init-CREATES call=1 t=11',
        'DOSDIAG vfs-construct id=1 dir=expo-sqlite t=12',
        'DOSDIAG main-worker-create t=900',
        'DOSDIAG init-enter call=1 sqlite3=false vfs=false t=901',
        'DOSDIAG init-CREATES call=1 t=901',
        'DOSDIAG vfs-construct id=1 dir=expo-sqlite t=902',
      ),
      want: { instrumented: true, vfsInstances: 2, initCREATES: 2, workers: 2 },
    },
    {
      name: 'one construction, echoed by Playwright on both the worker and the page',
      events: lines(
        'DOSDIAG init-enter call=1 sqlite3=false vfs=false t=11',
        'DOSDIAG init-enter call=1 sqlite3=false vfs=false t=11',
        'DOSDIAG init-CREATES call=1 t=11',
        'DOSDIAG init-CREATES call=1 t=11',
        'DOSDIAG vfs-construct id=1 dir=expo-sqlite t=12',
        'DOSDIAG vfs-construct id=1 dir=expo-sqlite t=12',
      ),
      want: { instrumented: true, vfsInstances: 1, initCREATES: 1, workers: 0 },
    },
    {
      name: 'an unpatched tree that still prints a worker message',
      // `any DOSDIAG line` made this read as instrumented, so vfsInstances 0 looked satisfied instead of unassertable.
      events: lines('DOSDIAG msg type=open path="/s0" id=1 t=5'),
      want: { instrumented: false, vfsInstances: 0, initCREATES: 0, workers: 0 },
    },
    {
      name: 'the worker patched but the VFS module not',
      events: lines('DOSDIAG init-enter call=1 sqlite3=false vfs=false t=11', 'DOSDIAG init-CREATES call=1 t=11'),
      want: { instrumented: true, vfsInstances: 0, initCREATES: 1, workers: 0 },
    },
  ]
  for (const c of counterCases) {
    const got = countInstrumentation(c.events)
    const ok = Object.entries(c.want).every(([k, v]) => got[k] === v)
    console.log(`[counter] ok=${ok} ${c.name} -> ${JSON.stringify(got)}`)
    if (!ok) problems.push(`counter case "${c.name}" gave ${JSON.stringify(got)}, wanted ${JSON.stringify(c.want)}`)
  }
  // And each of those must be REFUSED by the pass condition, with the cause named.
  const refusals = [
    ['vfsInstances 2 >', 'two workers, both calling themselves id=1'],
    ['workers 2 >', 'two workers, both calling themselves id=1'],
    ['not instrumented:', 'an unpatched tree that still prints a worker message'],
    ['the VFS module is not instrumented:', 'the worker patched but the VFS module not'],
  ]
  for (const [prefix, caseName] of refusals) {
    const c = counterCases.find((x) => x.name === caseName)
    const v = verdict({ events: c.events })
    if (!v.reasons.some((r) => r.startsWith(prefix))) problems.push(`"${caseName}" was not refused for ${prefix}…`)
    if (v.pass) problems.push(`"${caseName}" passed the pass condition`)
  }

  for (const problem of problems) console.log(`SELFCHECK PROBLEM: ${problem}`)
  console.log(problems.length === 0 ? 'SELFCHECK OK' : `SELFCHECK FAILED (${problems.length})`)
  process.exit(problems.length === 0 ? 0 : 1)
}

const { chromium } = await import('playwright')
const arg = argOf
const flag = (name) => process.argv.includes(`--${name}`)

const LABEL = arg('label', 'run')
const DELAY = Number(arg('delay', '0'))
const USER = arg('user', 'rahul')
const SECOND = arg('second', null)
const WATCH = Number(arg('watch', '25000'))
const APP = arg('app', 'http://localhost:5175')
const ORIGIN = new URL(APP).origin
const SLOW = new RegExp(arg('slow', 'expo-sqlite\\/(build\\/index|web\\/worker)\\.bundle'))
const OUT = arg('out', join(HERE, '..', '..', 'evidence', 'batch2', 'dos-167', 's-138-gate'))
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

await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 120000 })
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
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
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
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
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
result.instrumentation = countInstrumentation(events)
const judged = verdict(result)
result.pass = judged.pass
result.reasons = judged.reasons
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(result, null, 1))
console.log(
  `[${LABEL}] delay=${DELAY} pass=${result.pass} header=${headers.includes(wanted)} manifest=${result.manifestCalls} pull=${result.pullCalls} notADatabase=${result.notADatabase} cannotCreate=${result.cannotCreate} notPersisted=${result.beatFinal.notPersisted} pool=${result.poolFiles} vfsInstances=${judged.vfsInstances} initCREATES=${judged.initCREATES}`,
)
console.log(`  headers: ${JSON.stringify(headers)}`)
for (const reason of result.reasons) console.log(`   - ${reason}`)
await ctx.close()
await browser.close()
process.exit(result.pass ? 0 : 1)
