// DOS-167 amendment A2 — proved by OPERATING the sales web app in a real (headed) Chromium.
//
// A2 (Fable, 2026-09-19): the never-a-hang memory fallback (ruling 3 (cc).2) must RELEASE the failed persistent
// file's `holdFile` hold. Proof by operation: sign in on a persistent OPFS store, corrupt that store AFTER it
// opened, reload — the app must ANNOUNCE an honest memory store instead of hanging — and then a SECOND engine on
// the SAME store name (same JS context: sign out, sign in again, no reload) must still OPEN rather than block on
// a stale hold.
//
// Phases (the browser profile persists between them, so they run as separate processes):
//   --phase setup    sign in, let the persistent store open, walk OPFS
//   --phase corrupt  reopen the origin with the app's JS blocked (no engine), overwrite the database bytes
//                    (offset 4096 on — AccessHandlePoolVFS SECTOR_SIZE) of this person's pool file, header kept
//   --phase prove    load the app on the corrupted store, watch it, then sign out + sign in again (2nd engine)
//
// Usage: node a2-web-drive.mjs --phase setup|corrupt|prove [--user rahul] [--app http://localhost:5175]
// Needs: the sales Metro on :5175, the backend services on :300x, playwright in QA/tools/node_modules.
import { createRequire } from 'node:module'
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
const PHASE = arg('phase', 'setup')
const USER = arg('user', 'rahul')
const APP = arg('app', 'http://localhost:5175')
const ORIGIN = new URL(APP).origin
const PROFILE =
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/a2-profile'
const OUT = HERE
mkdirSync(OUT, { recursive: true })
const PASSWORD = 'Dos@1234'

const IDS = {
  rahul: {
    user: 'rahul.deshmukh',
    userId: '8760e17e-4830-7395-a946-1e02fffa1ad7',
    tenantId: '01a09a5b-3c58-71c1-a34d-b93c569b0099',
  },
  amit: {
    user: 'amit.pawar',
    userId: 'efde1e76-9785-7827-aff2-6f56ecd33588',
    tenantId: '01a09a5b-3c58-71c1-a34d-b93c569b0099',
  },
}
const digits = (id) => BigInt(`0x${id.toLowerCase().replaceAll('-', '')}`).toString(36).padStart(25, '0')
const storeFile = (who) => `s${digits(IDS[who].userId)}${digits(IDS[who].tenantId)}`
const WANTED = `/${storeFile(USER)}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const at = () => Date.now() - t0
const events = []
const push = (e) => {
  const row = { t: at(), ...e }
  events.push(row)
  console.log(JSON.stringify(row))
}

// The OPFS walk: each wa-sqlite pool file carries its SQLite path in the first 512 bytes; the database itself
// starts at offset 4096 (AccessHandlePoolVFS SECTOR_SIZE), where "SQLite format 3" lives.
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
              const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
              const end = head.indexOf(0)
              entry.sqlitePath = new TextDecoder().decode(head.subarray(0, end < 0 ? 512 : end))
              const magic = new Uint8Array(await file.slice(4096, 4112).arrayBuffer())
              entry.magic = new TextDecoder().decode(magic).replace(/[^ -~]/g, '.')
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

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 860 },
})

// COOP/COEP, which `expo start --web` does not send and OPFS sync access handles require (docs/26 sends them in
// production). Same injection the permanent S-138 gate uses. `blockAppJs` gives a bare same-origin page whose
// OPFS can be reached with no engine running.
let blockAppJs = PHASE === 'corrupt' || PHASE === 'walk'
await ctx.route(
  (u) => u.origin === ORIGIN,
  async (route) => {
    const url = route.request().url()
    if (blockAppJs && /\.bundle|\.js($|\?)/.test(url)) {
      await route.abort()
      return
    }
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

// Chrome's local-network-access gate: without it the app's fetch to the services on :300x never answers and the
// sign-in form just says "No connection" (the S-138 gate grants the same permission).
try {
  await ctx.grantPermissions(['local-network-access'], { origin: ORIGIN })
  push({ kind: 'granted', permission: 'local-network-access' })
} catch (error) {
  push({ kind: 'grant-failed', error: String(error).slice(0, 200) })
}

const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('requestfailed', (r) => {
  const u = r.url()
  if (/:300\d\//.test(u))
    push({ kind: 'request-failed', url: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 120), error: r.failure()?.errorText })
})
const watch = (source, target) => {
  target.on('console', (m) => {
    const text = m.text().slice(0, 400)
    if (/offline:|persistent|memory|sqlite|cannot create file|not a database|file not found|vfs/i.test(text))
      push({ kind: 'console', source, type: m.type(), text })
  })
}
watch('page', page)
page.on('pageerror', (e) => push({ kind: 'pageerror', text: String(e).slice(0, 300) }))
page.on('worker', (w) => {
  push({ kind: 'worker-created', url: w.url().slice(0, 120) })
  watch('worker', w)
})
page.on('request', (r) => {
  const u = r.url()
  if (/:300\d\//.test(u))
    push({ kind: 'request', method: r.method(), url: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 120) })
})
page.on('response', (r) => {
  const u = r.url()
  if (/:300\d\//.test(u))
    push({ kind: 'response', status: r.status(), url: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 120) })
})

const shot = async (name) => {
  await page.screenshot({ path: join(OUT, name), fullPage: false })
  push({ kind: 'screenshot', file: name })
}

async function signIn(who) {
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 90000 })
  await page.fill('[data-testid=sign-in-username]', IDS[who].user)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  push({ kind: 'sign-in-click', who })
  await page.click('[data-testid=sign-in-submit]')
  try {
    await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 45000 })
    push({ kind: 'signed-in', who, url: page.url() })
  } catch {
    push({
      kind: 'sign-in-stuck',
      url: page.url(),
      body: (await page.innerText('body').catch(() => '')).slice(0, 800),
    })
    await shot(`a2-00-sign-in-stuck-${PHASE}.png`)
    throw new Error('sign-in did not leave the form')
  }
}

/** What the screen says, sampled; every change is recorded with the moment it changed. */
async function watchScreen(label, ms) {
  const deadline = Date.now() + ms
  let last = ''
  while (Date.now() < deadline) {
    const body = await page.innerText('body').catch(() => '')
    const state = {
      stillLoading: /Still loading the beat/i.test(body),
      notPersisted: /will not keep the offline copy/i.test(body),
      couldNotBeOpened: /could not be opened/i.test(body),
      updated: /Updated /i.test(body),
      notUpdated: /Not updated yet/i.test(body),
      shopsLine: (body.match(/Shops[^\n]{0,40}/i) ?? [''])[0],
    }
    const key = JSON.stringify(state)
    if (key !== last) {
      push({ kind: 'screen', label, ...state })
      last = key
    }
    await sleep(400)
  }
}

if (PHASE === 'setup') {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 120000 })
  await shot('a2-01-sign-in-form.png')
  await signIn(USER)
  await sleep(2000)
  await watchScreen('persistent', 15000)
  await shot('a2-02-persistent-home.png')
  const walk = await opfsWalk(page)
  push({ kind: 'opfs-after-open', files: walk })
  const mine = walk.filter((e) => /^\/s[0-9a-z]{50}$/.test(e.sqlitePath ?? ''))
  push({ kind: 'store-file', expectedName: WANTED, found: mine })
} else if (PHASE === 'corrupt') {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {})
  const before = await opfsWalk(page)
  push({ kind: 'opfs-before-corrupt', files: before })
  const result = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const files = []
    const collect = async (dir, prefix) => {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') await collect(handle, `${prefix + name}/`)
        else files.push([prefix + name, handle])
      }
    }
    await collect(root, '')
    for (const [name, handle] of files) {
      const file = await handle.getFile()
      const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
      const end = head.indexOf(0)
      const path = new TextDecoder().decode(head.subarray(0, end < 0 ? 512 : end))
      // This person's main database: the 51-character `s<25><25>` name ruling 2 (s) fixed. Never the -wal sibling.
      if (!/^\/s[0-9a-z]{50}$/.test(path)) continue
      const read = async (h) =>
        new TextDecoder()
          .decode(new Uint8Array(await (await h.getFile()).slice(4096, 4112).arrayBuffer()))
          .replace(/[^ -~]/g, '.')
      const magicBefore = await read(handle)
      const writable = await handle.createWritable({ keepExistingData: true })
      await writable.write({ type: 'write', position: 4096, data: new Uint8Array(100).fill(0x58) })
      await writable.close()
      return { name, path, magicBefore, magicAfter: await read(handle), size: (await handle.getFile()).size }
    }
    return null
  })
  push({ kind: 'corrupted', result })
  const after = await opfsWalk(page)
  push({ kind: 'opfs-after-corrupt', files: after })
  await page.evaluate((rows) => {
    document.body.innerHTML = `<pre style="font:13px monospace;padding:16px;white-space:pre-wrap">${rows}</pre>`
  }, JSON.stringify({ corrupted: result, opfs: after }, null, 2))
  await shot('a2-03-corrupted-opfs.png')
} else if (PHASE === 'prove') {
  // (1) THE RELOAD on a store that opens and is then unusable.
  push({ kind: 'load-on-corrupt-store' })
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await sleep(5000)
  await shot('a2-04-reload-early.png')
  await watchScreen('after-corruption', 35000)
  await shot('a2-05-after-corruption-memory.png')
  push({ kind: 'body-after-corruption', text: (await page.innerText('body').catch(() => '')).slice(0, 1200) })
  push({ kind: 'opfs-after-reload', files: await opfsWalk(page) })

  // (2) A SECOND ENGINE ON THE SAME STORE NAME, in the SAME JS context (no reload): sign out, sign in again.
  push({ kind: 'second-engine-begin' })
  await page.click('button[aria-haspopup=menu]')
  await sleep(500)
  await shot('a2-06-account-menu.png')
  await page.getByText('Sign out', { exact: true }).last().click()
  await sleep(1500)
  await shot('a2-07-after-sign-out.png')
  push({ kind: 'after-sign-out-body', text: (await page.innerText('body').catch(() => '')).slice(0, 600) })
  const secondFrom = Date.now()
  await signIn(USER)
  push({ kind: 'second-sign-in-took-ms', ms: Date.now() - secondFrom })
  await sleep(4000)
  await shot('a2-08-second-engine-early.png')
  await watchScreen('second-engine', 35000)
  await shot('a2-09-second-engine-settled.png')
  push({ kind: 'body-second-engine', text: (await page.innerText('body').catch(() => '')).slice(0, 1200) })
  push({ kind: 'opfs-final', files: await opfsWalk(page) })
} else if (PHASE === 'prove2') {
  // The same corrupted store again, this time photographed where the app SAYS it: the foot of the beat, and the
  // console lines it wrote while opening.
  const lines = []
  page.on('console', (m) => {
    const text = m.text()
    if (/offline:/.test(text)) lines.push(`[${m.type()}] ${text.split('\n')[0].slice(0, 300)}`)
  })
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await sleep(2500)
  await shot('a2-10-loaded-2s.png')
  await watchScreen('prove2', 8000)
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight)
    const main = document.querySelector('main') ?? document.body
    main.scrollTop = main.scrollHeight
    for (const el of document.querySelectorAll('div')) if (el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight
  })
  await sleep(1200)
  await shot('a2-11-not-kept-line.png')
  await page.screenshot({ path: join(OUT, 'a2-12-beat-fullpage.png'), fullPage: true })
  push({ kind: 'screenshot', file: 'a2-12-beat-fullpage.png' })
  push({ kind: 'console-lines', lines })
  await page.evaluate((rows) => {
    document.body.innerHTML = `<pre style="font:13px monospace;padding:16px;white-space:pre-wrap">${rows}</pre>`
  }, `The sales app's own console on a store that opens and cannot be read:\n\n${lines.join('\n\n')}`)
  await shot('a2-13-console-lines.png')
} else if (PHASE === 'prove3') {
  /*
   * THE ATTRIBUTION RUN. In the app, a second engine on one store name always follows a sign-out — and `end()`'s
   * own `finally` releases the file too, so the plain walk cannot say WHICH release freed it. So this run holds
   * the FIRST engine's `end()` open: a `/sync/pull` is put in flight and then stalled for 25 s, and `end()` waits
   * for `settled()`. If the second engine opens the same file DURING that stall, the hold was already free — the
   * memory fallback released it, not `end()`.
   */
  const marks = []
  page.on('console', (m) => {
    const text = m.text()
    if (/offline:/.test(text)) marks.push({ t: at(), kind: 'console', text: text.split('\n')[0].slice(0, 200) })
  })
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await sleep(7000)
  await shot('a2-14-first-engine-memory.png')

  let stalling = true
  await ctx.route(
    (u) => u.href.includes('/sync/pull'),
    async (route) => {
      const began = at()
      push({ kind: 'pull-intercepted', at: began, stalling })
      if (stalling) await sleep(25000)
      push({ kind: 'pull-released', heldMs: at() - began })
      await route.continue().catch(() => {})
    },
  )
  // Make the engine sync now: the network hint goes away and comes back, and the pull it starts is the one held.
  await ctx.setOffline(true)
  await sleep(1200)
  await ctx.setOffline(false)
  await sleep(2500)
  push({ kind: 'sign-out-click', at: at() })
  await page.click('button[aria-haspopup=menu]')
  await sleep(400)
  await page.getByText('Sign out', { exact: true }).last().click()
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 30000 })
  push({ kind: 'sign-in-form-back', at: at() })
  await shot('a2-15-signed-out-while-end-is-held.png')
  const before = marks.length
  await signIn(USER)
  const deadline = Date.now() + 20000
  while (Date.now() < deadline && marks.length === before) await sleep(200)
  push({ kind: 'second-engine-marks', marks: marks.slice(before) })
  await shot('a2-16-second-engine-during-stall.png')
  await watchScreen('prove3-second', 30000)
  stalling = false
  await shot('a2-17-second-engine-after-stall.png')
  push({ kind: 'marks-all', marks })
} else if (PHASE === 'prove4') {
  // What the SECOND sign-in looks like while the first engine's `end()` is still held by a stalled call: the
  // screen, the button, and how long the tap does nothing (prove3 measured 16.9 s).
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await sleep(7000)
  let stalling = true
  await ctx.route(
    (u) => u.href.includes('/sync/pull'),
    async (route) => {
      push({ kind: 'pull-intercepted', stalling })
      if (stalling) await sleep(25000)
      await route.continue().catch(() => {})
    },
  )
  await ctx.setOffline(true)
  await sleep(1200)
  await ctx.setOffline(false)
  await sleep(2500)
  await page.click('button[aria-haspopup=menu]')
  await sleep(400)
  await page.getByText('Sign out', { exact: true }).last().click()
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 30000 })
  await page.fill('[data-testid=sign-in-username]', IDS[USER].user)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  const tapped = Date.now()
  await page.click('[data-testid=sign-in-submit]')
  push({ kind: 'second-sign-in-tapped' })
  for (const wait of [1500, 4000, 9000]) {
    await sleep(wait)
    push({
      kind: 'waiting',
      afterMs: Date.now() - tapped,
      url: page.url(),
      button: await page.innerText('[data-testid=sign-in-submit]').catch(() => '(gone)'),
      body: (await page.innerText('body').catch(() => '')).slice(0, 300),
    })
    await shot(`a2-18-signin-wait-${Math.round((Date.now() - tapped) / 1000)}s.png`)
  }
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 60000 })
  push({ kind: 'second-sign-in-landed', afterMs: Date.now() - tapped })
  stalling = false
  await sleep(3000)
  await shot('a2-19-after-second-sign-in.png')
} else if (PHASE === 'walk') {
  // The state of the browser's OPFS at the end of it all: is the file we could not read still there, whole, and is
  // the pool free of orphans?
  blockAppJs = true
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {})
  const files = await opfsWalk(page)
  push({ kind: 'opfs-final-walk', files })
  await page.evaluate((rows) => {
    document.body.innerHTML = `<pre style="font:13px monospace;padding:16px;white-space:pre-wrap">${rows}</pre>`
  }, JSON.stringify(files, null, 2))
  await shot('a2-20-opfs-at-the-end.png')
} else {
  console.error(`unknown phase ${PHASE}`)
}

writeFileSync(join(OUT, `a2-${PHASE}-events.json`), JSON.stringify(events, null, 2))
await sleep(500)
await ctx.close()
