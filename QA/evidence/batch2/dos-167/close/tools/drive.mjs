/**
 * DOS-167 close — the Android driver.
 *
 * A minimal W3C WebDriver client over fetch, against the Appium/UiAutomator2 server already running
 * on :4723. Every element is addressed by RESOURCE-ID or by TEXT (UiSelector), never by a raw
 * coordinate: `byId`, `byText`, `byTextContains`, `byDesc`.
 *
 * Exported so the step scripts in this folder stay short; run directly for a smoke check.
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const BASE = process.env.APPIUM ?? 'http://127.0.0.1:4723'
const OUT = '/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/close'

export async function w3c(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 500)}`)
  return json.value
}

export async function newSession(pkg) {
  const value = await w3c('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:deviceName': 'emulator-5554',
        'appium:udid': 'emulator-5554',
        'appium:appPackage': pkg,
        'appium:appActivity': '.MainActivity',
        'appium:noReset': true,
        'appium:newCommandTimeout': 600,
        'appium:uiautomator2ServerLaunchTimeout': 120000,
        'appium:adbExecTimeout': 120000,
        'appium:disableWindowAnimation': true,
      },
      firstMatch: [{}],
    },
  })
  return value.sessionId
}

export class Session {
  constructor(id) {
    this.id = id
  }
  s(path) {
    return `/session/${this.id}${path}`
  }
  async find(using, value) {
    const v = await w3c('POST', this.s('/element'), { using, value })
    return v['element-6066-11e4-a52e-4f735466cecf'] ?? v.ELEMENT
  }
  async findAll(using, value) {
    const v = await w3c('POST', this.s('/elements'), { using, value })
    return v.map((e) => e['element-6066-11e4-a52e-4f735466cecf'] ?? e.ELEMENT)
  }
  /** React Native's `testID` lands as the raw `resource-id`, which Appium's `id` strategy does not match. */
  byId(id) {
    return this.find('-android uiautomator', `new UiSelector().resourceId(${JSON.stringify(id)})`)
  }
  allById(id) {
    return this.findAll('-android uiautomator', `new UiSelector().resourceId(${JSON.stringify(id)})`)
  }
  byText(text) {
    return this.find('-android uiautomator', `new UiSelector().text(${JSON.stringify(text)})`)
  }
  byTextContains(text) {
    return this.find('-android uiautomator', `new UiSelector().textContains(${JSON.stringify(text)})`)
  }
  byDesc(text) {
    return this.find('-android uiautomator', `new UiSelector().description(${JSON.stringify(text)})`)
  }
  allByTextContains(text) {
    return this.findAll('-android uiautomator', `new UiSelector().textContains(${JSON.stringify(text)})`)
  }
  click(el) {
    return w3c('POST', this.s(`/element/${el}/click`), {})
  }
  clear(el) {
    return w3c('POST', this.s(`/element/${el}/clear`), {})
  }
  type(el, text) {
    return w3c('POST', this.s(`/element/${el}/value`), { text })
  }
  text(el) {
    return w3c('GET', this.s(`/element/${el}/text`))
  }
  source() {
    return w3c('GET', this.s('/source'))
  }
  async texts() {
    const xml = await this.source()
    const seen = []
    for (const m of xml.matchAll(/(?:text|content-desc)="([^"]*)"/g)) {
      const t = m[1].replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#10;', ' ')
      if (t !== '' && !seen.includes(t)) seen.push(t)
    }
    return seen
  }
  async shot(name) {
    const b64 = await w3c('GET', this.s('/screenshot'))
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64, 'base64'))
    return `${name}.png`
  }
  back() {
    return w3c('POST', this.s('/back'), {})
  }
  hideKeyboard() {
    return w3c('POST', this.s('/appium/device/hide_keyboard'), {}).catch(() => {})
  }
  quit() {
    return w3c('DELETE', this.s(''))
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function waitFor(fn, { timeout = 60000, every = 500, what = 'condition' } = {}) {
  const until = Date.now() + timeout
  let last
  while (Date.now() < until) {
    try {
      const v = await fn()
      if (v) return v
    } catch (error) {
      last = error
    }
    await sleep(every)
  }
  throw new Error(`timeout waiting for ${what}${last === undefined ? '' : `: ${String(last).slice(0, 200)}`}`)
}

/** LogBox draws over the footer; dismiss it rather than tapping through (task brief). */
export async function dismissLogBox(sess) {
  for (let i = 0; i < 4; i += 1) {
    const xml = await sess.source()
    if (!xml.includes('Dismiss') && !xml.includes('LogBox')) return i
    try {
      const el = await sess.byText('Dismiss')
      await sess.click(el)
      await sleep(400)
    } catch {
      return i
    }
  }
  return 4
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = await newSession(process.argv[2] ?? 'in.distributionos.sales')
  const sess = new Session(id)
  console.log('session', id)
  console.log((await sess.texts()).join(' | ').slice(0, 800))
  await sess.shot(process.argv[3] ?? 'smoke')
  await sess.quit()
}
