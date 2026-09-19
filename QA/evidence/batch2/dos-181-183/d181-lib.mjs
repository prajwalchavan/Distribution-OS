// DOS-167 Android delivery keep proof — Appium/UiAutomator2 helper.
// Addresses elements by resource-id / text / content-desc, never by raw coordinates.
// Usage: import * as A from './and-appium.mjs'
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export const EV = '/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-181-183'
const HOST = 'http://127.0.0.1:4725'
const ADB = process.env.HOME + '/Library/Android/sdk/platform-tools/adb'
mkdirSync(EV, { recursive: true })

export const LOG = process.env.AND_LOG || EV + '/d181-run.log'
export function log(...m) {
  const line = `[${new Date().toISOString()}] ${m.join(' ')}`
  console.log(line)
  appendFileSync(LOG, line + '\n')
}

export function adb(args, { text = true } = {}) {
  return execFileSync(ADB, args, { encoding: text ? 'utf8' : 'buffer', maxBuffer: 64 * 1024 * 1024 })
}

async function req(method, path, body) {
  const r = await fetch(HOST + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || (j && j.value && j.value.error)) {
    const err = new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j).slice(0, 400)}`)
    err.appium = j
    throw err
  }
  return j.value
}

export let sid = null

export async function newSession(opts = {}) {
  const caps = {
    alwaysMatch: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Pixel_7_API_36',
      'appium:udid': 'emulator-5554',
      'appium:appPackage': 'in.distributionos.delivery',
      'appium:appActivity': '.MainActivity',
      'appium:noReset': true,
      'appium:fullReset': false,
      'appium:autoGrantPermissions': true,
      'appium:newCommandTimeout': 1800,
      'appium:uiautomator2ServerLaunchTimeout': 180000,
      'appium:uiautomator2ServerInstallTimeout': 180000,
      'appium:adbExecTimeout': 120000,
      'appium:androidInstallTimeout': 180000,
      'appium:disableWindowAnimation': true,
      'appium:ignoreHiddenApiPolicyError': true,
      'appium:skipServerInstallation': false,
      ...opts,
    },
    firstMatch: [{}],
  }
  const v = await req('POST', '/session', { capabilities: caps })
  sid = v.sessionId
  log('session', sid)
  return sid
}

export async function quit() {
  if (sid) {
    await req('DELETE', `/session/${sid}`).catch(() => {})
    sid = null
  }
}

const S = () => `/session/${sid}`

export async function source() {
  return req('GET', S() + '/source')
}

export async function shot(name) {
  const b64 = await req('GET', S() + '/screenshot')
  const p = `${EV}/${name}.png`
  writeFileSync(p, Buffer.from(b64, 'base64'))
  log('shot', p)
  return p
}

// Raw device screenshot (works even with no Appium session).
export function shotAdb(name) {
  const buf = adb(['exec-out', 'screencap', '-p'], { text: false })
  const p = `${EV}/${name}.png`
  writeFileSync(p, buf)
  log('shot(adb)', p)
  return p
}

export async function findAll(using, value) {
  try {
    return await req('POST', S() + '/elements', { using, value })
  } catch {
    return []
  }
}

export async function find(using, value) {
  const els = await findAll(using, value)
  return els.length ? els[0] : null
}

const uia = (expr) => ['-android uiautomator', expr]

// React Native's testID lands in resource-id WITHOUT the package prefix, so the plain `id` strategy misses it.
export const byId = (id) => uia(`new UiSelector().resourceId(${JSON.stringify(id)})`)
export const byIdContains = (id) => uia(`new UiSelector().resourceIdMatches(${JSON.stringify('.*' + id + '.*')})`)
export const byText = (t) => uia(`new UiSelector().text(${JSON.stringify(t)})`)
export const byTextContains = (t) => uia(`new UiSelector().textContains(${JSON.stringify(t)})`)
export const byDesc = (t) => uia(`new UiSelector().description(${JSON.stringify(t)})`)
export const byDescContains = (t) => uia(`new UiSelector().descriptionContains(${JSON.stringify(t)})`)

export async function el(loc) {
  return find(loc[0], loc[1])
}

export async function waitFor(loc, timeoutMs = 20000, label = '') {
  const t0 = Date.now()
  let ticks = 0
  for (;;) {
    const e = await el(loc)
    if (e) return e
    if (Date.now() - t0 > timeoutMs) return null
    await sleep(500)
    ticks += 1
    // An ANR dialog ("isn't responding") covers the whole tree; clear it, then keep looking.
    if (ticks % 6 === 0) await dismissAnr()
    if (label && (Date.now() - t0) % 5000 < 600) log('waiting for', label)
  }
}

/** Dismiss Android's "isn't responding" dialog by pressing Wait. Never touches a product button. */
export async function dismissAnr() {
  const e = await find(
    'xpath',
    '//android.widget.Button[@text="Wait"] | //*[@resource-id="android:id/aerr_wait"]',
  )
  if (!e) return false
  try {
    await click(e)
    log('dismissed the ANR dialog (Wait)')
    await sleep(1200)
    return true
  } catch {
    return false
  }
}

export function elId(e) {
  return e && (e['element-6066-11e4-a52e-4f735466cecf'] || e.ELEMENT)
}

export async function click(e) {
  return req('POST', `${S()}/element/${elId(e)}/click`)
}

export async function clickText(t, { contains = false, timeout = 15000 } = {}) {
  const loc = contains ? byTextContains(t) : byText(t)
  let e = await waitFor(loc, timeout, t)
  if (!e) {
    // try content-desc (RN accessibility labels land there)
    e = await waitFor(contains ? byDescContains(t) : byDesc(t), 3000, t)
  }
  if (!e) throw new Error(`clickText: not found: ${t}`)
  await click(e)
  log('clicked', JSON.stringify(t))
  return true
}

export async function setValue(e, text) {
  return req('POST', `${S()}/element/${elId(e)}/value`, { text })
}

export async function clear(e) {
  return req('POST', `${S()}/element/${elId(e)}/clear`)
}

export async function attr(e, name) {
  return req('GET', `${S()}/element/${elId(e)}/attribute/${name}`)
}

export async function text(e) {
  return req('GET', `${S()}/element/${elId(e)}/text`)
}

export async function scrollIntoView(t) {
  const expr =
    `new UiScrollable(new UiSelector().scrollable(true).instance(0))` +
    `.setMaxSearchSwipes(20).scrollIntoView(new UiSelector().textContains(${JSON.stringify(t)}))`
  const e = await find('-android uiautomator', expr)
  if (e) log('scrolled into view', JSON.stringify(t))
  return e
}

export async function swipeUp(times = 1) {
  for (let i = 0; i < times; i++) {
    await req('POST', S() + '/actions', {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: 540, y: 1600 },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 200 },
            { type: 'pointerMove', duration: 800, x: 540, y: 600 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    })
    await sleep(600)
  }
}

export async function hideKeyboard() {
  await req('POST', S() + '/appium/device/hide_keyboard').catch(() => {})
}

export async function pressKey(code) {
  await req('POST', S() + '/appium/device/press_keycode', { keycode: code })
}

export async function texts(limit = 4000) {
  const xml = await source()
  const all = [...xml.matchAll(/text="([^"]+)"/g)].map((m) => m[1])
  const desc = [...xml.matchAll(/content-desc="([^"]+)"/g)].map((m) => m[1])
  const seen = new Set()
  const out = []
  for (const t of [...all, ...desc]) {
    if (!seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out.join(' | ').slice(0, limit)
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// --- device-side inspection (read-only copies of the app's SQLite store) -------------------
export function sqliteFiles() {
  try {
    return adb(['shell', 'run-as', 'in.distributionos.delivery', 'ls', '-la', 'files/SQLite']).trim()
  } catch (e) {
    return 'ls failed: ' + String(e).slice(0, 200)
  }
}

export function pullDb(dbName, tag) {
  const tmp = `/data/local/tmp/${tag}.db`
  adb(['shell', `run-as in.distributionos.delivery cat files/SQLite/${dbName} > ${tmp}`])
  const local = `${EV}/${tag}.db`
  adb(['pull', tmp, local])
  adb(['shell', 'rm', '-f', tmp])
  return local
}

export function sqlite(local, sql) {
  try {
    return execFileSync('sqlite3', [local, sql], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
  } catch (e) {
    return 'sqlite failed: ' + String(e).slice(0, 300)
  }
}

// React Native's LogBox warning banner sits ON TOP of the bottom buttons (it overlaps "Take money" on the stop
// screen), so a click on the button underneath lands on the banner. Dismiss it by its own ✕ element.
export async function dismissLogBox() {
  const banner = await find('xpath', '//*[contains(@content-desc,"Open debugger to view")]')
  if (!banner) return false
  const x = await find('xpath', '//*[contains(@content-desc,"Open debugger to view")]//*[@clickable="true"]')
  if (x) {
    await click(x)
    log('dismissed the LogBox banner')
    await sleep(700)
    return true
  }
  log('LogBox banner present but its dismiss control was not found')
  return false
}

export async function dismissSystemDialogs() {
  for (const t of ['Wait', 'Close app', 'OK', 'No thanks', 'Allow', 'While using the app']) {
    const e = await el(byText(t))
    if (e) {
      // only dismiss real system dialogs (android package), not product buttons
      const pkg = await attr(e, 'package').catch(() => '')
      if (String(pkg).startsWith('android') || String(pkg).includes('systemui') || String(pkg).includes('permission')) {
        await click(e)
        log('dismissed system dialog button', t, pkg)
        await sleep(800)
      }
    }
  }
}

// --- DOS-181 additions ------------------------------------------------------
/** Every node of the current tree, as {id, text, desc, bounds, enabled, clickable, class}. */
export async function nodes() {
  const xml = await source()
  const out = []
  for (const m of xml.matchAll(/<[a-zA-Z.]+[^>]*\/?>/g)) {
    const tag = m[0]
    const get = (k) => {
      const mm = tag.match(new RegExp(`\\s${k}="([^"]*)"`))
      return mm ? mm[1] : ''
    }
    const b = get('bounds').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
    out.push({
      cls: get('class'),
      id: get('resource-id'),
      text: get('text'),
      desc: get('content-desc'),
      enabled: get('enabled'),
      clickable: get('clickable'),
      bounds: b ? { x1: +b[1], y1: +b[2], x2: +b[3], y2: +b[4] } : null,
    })
  }
  return out
}

export async function dumpTree(name) {
  const xml = await source()
  const p = `${EV}/${name}.xml`
  writeFileSync(p, xml)
  log('tree', p)
  return xml
}

/** The node carrying this resource-id (React Native puts testID there, unprefixed). */
export async function nodeById(id) {
  const all = await nodes()
  return all.find((n) => n.id === id) ?? null
}

/** Screen height in pixels, for "is it in the first viewport" measurements. */
export async function screenSize() {
  const out = adb(['shell', 'wm', 'size'])
  const m = out.match(/Physical size:\s*(\d+)x(\d+)/)
  return m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 2400 }
}

/** Type into a field by testID, re-finding it on every attempt (RN re-renders make handles stale). */
export async function typeInto(id, value, tries = 5) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      const e = await waitFor(byId(id), 20000, id)
      if (!e) throw new Error(`field not found: ${id}`)
      await click(e)
      await sleep(300)
      const e2 = await waitFor(byId(id), 20000, id)
      await clear(e2)
      await sleep(200)
      const e3 = await waitFor(byId(id), 20000, id)
      await setValue(e3, value)
      return true
    } catch (err) {
      last = err
      log('retry typeInto', id, String(err.message).slice(0, 120))
      await dismissAnr()
      await sleep(1200)
    }
  }
  throw last ?? new Error(`typeInto failed: ${id}`)
}

/** Click by testID, re-finding on every attempt. */
export async function clickId(id, tries = 4, timeout = 20000) {
  let last = null
  for (let i = 0; i < tries; i++) {
    try {
      const e = await waitFor(byId(id), timeout, id)
      if (!e) throw new Error(`not found: ${id}`)
      await click(e)
      log('clicked', id)
      return true
    } catch (err) {
      last = err
      log('retry clickId', id, String(err.message).slice(0, 120))
      await dismissAnr()
      await sleep(1000)
    }
  }
  throw last ?? new Error(`clickId failed: ${id}`)
}

/** Scroll the first scrollable until a node with this resource-id is on screen. */
export async function scrollToId(id, swipes = 20) {
  const expr =
    `new UiScrollable(new UiSelector().scrollable(true).instance(0))` +
    `.setMaxSearchSwipes(${swipes}).scrollIntoView(new UiSelector().resourceId(${JSON.stringify(id)}))`
  const e = await find('-android uiautomator', expr)
  if (e) log('scrolled into view', id)
  else log('could NOT scroll to', id)
  return e
}
