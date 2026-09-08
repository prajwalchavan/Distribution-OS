// Headless iOS sign-in through Appium XCUITest (WebDriverAgent) — no Simulator window, no Claude panel.
// Usage: node ios-login.mjs <metroPort> <user> <app>     e.g. node ios-login.mjs 5175 rahul.deshmukh sales
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const [port, user, app] = process.argv.slice(2)
const OUT = fileURLToPath(new URL('../evidence/phase0/ios/', import.meta.url)); mkdirSync(OUT, { recursive: true })
const udid = execSync(`xcrun simctl list devices booted | grep -o '[0-9A-F-]\\{36\\}' | head -1`).toString().trim()
const A = 'http://127.0.0.1:4723'
const j = async (method, path, body) => {
  const r = await fetch(A + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.json(); if (t.value && t.value.error) throw new Error(`${path}: ${t.value.error} ${t.value.message?.slice(0, 200)}`); return t.value
}
console.log('udid', udid, '— creating session (first run builds WebDriverAgent, several minutes)')
const s = await j('POST', '/session', { capabilities: { alwaysMatch: {
  platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid, 'appium:bundleId': 'host.exp.Exponent',
  'appium:noReset': true, 'appium:wdaLaunchTimeout': 600000, 'appium:wdaConnectionTimeout': 600000, 'appium:showXcodeLog': false, 'appium:newCommandTimeout': 600,
} } })
const sid = s.sessionId; console.log('session', sid)
const S = (p) => `/session/${sid}${p}`
execSync(`xcrun simctl openurl ${udid} "exp://127.0.0.1:${port}"`)
const find = async (using, value) => (await j('POST', S('/element'), { using, value }))
let field
for (let i = 0; i < 60; i++) { try { field = await find('class name', 'XCUIElementTypeTextField'); break } catch { await new Promise((r) => setTimeout(r, 3000)) } }
if (!field) throw new Error('no text field appeared')
const id = (e) => e['element-6066-11e4-a52e-4f735466cecf'] ?? e.ELEMENT
const shot = async (name) => writeFileSync(`${OUT}${app}-${user}-${name}.png`, Buffer.from(await j('GET', S('/screenshot')), 'base64'))
await shot('0-signin')
await j('POST', S(`/element/${id(field)}/value`), { text: user })
const pw = await find('class name', 'XCUIElementTypeSecureTextField')
await j('POST', S(`/element/${id(pw)}/value`), { text: 'Dos@1234' })
await shot('1-filled')
const btn = await find('-ios predicate string', "label == 'Sign in' AND (type == 'XCUIElementTypeButton' OR type == 'XCUIElementTypeOther')")
await j('POST', S(`/element/${id(btn)}/click`), {})
await new Promise((r) => setTimeout(r, 8000))
await shot('2-home')
const src = await j('GET', S('/source'))
const labels = [...src.matchAll(/label="([^"]{2,60})"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 25)
console.log(labels.some((l) => /Use the username/.test(l)) ? 'STILL_ON_SIGN_IN' : 'SIGNED_IN', app, user, '|', labels.join(' | '))
await j('DELETE', S(''))
