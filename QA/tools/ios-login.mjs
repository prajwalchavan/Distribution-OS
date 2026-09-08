// Headless iOS sign-in through Appium XCUITest (WebDriverAgent) — no Simulator window, no Claude panel.
// Usage: node ios-login.mjs <metroPort> <user> <app> [TitleWord]   e.g. node ios-login.mjs 5175 rahul.deshmukh sales Sales
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const [port, user, app, titleArg] = process.argv.slice(2)
const title = titleArg ?? app[0].toUpperCase() + app.slice(1)
const OUT = fileURLToPath(new URL('../evidence/phase0/ios/', import.meta.url)); mkdirSync(OUT, { recursive: true })
const udid = execSync(`xcrun simctl list devices booted | grep -o '[0-9A-F-]\\{36\\}' | head -1`).toString().trim()
const A = 'http://127.0.0.1:4723'
// Every app runs inside the ONE Expo Go sandbox on the simulator, so the previous app's session (SecureStore →
// keychain) is visible to the next one. Reset the keychain between apps; a real device gives each app its own.
execSync(`xcrun simctl terminate ${udid} host.exp.Exponent 2>/dev/null; xcrun simctl keychain ${udid} reset`, { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const j = async (method, path, body) => {
  const r = await fetch(A + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.json(); if (t.value && t.value.error) throw new Error(`${path}: ${t.value.error} ${t.value.message?.slice(0, 160)}`); return t.value
}
const s = await j('POST', '/session', { capabilities: { alwaysMatch: {
  platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid, 'appium:bundleId': 'host.exp.Exponent',
  'appium:noReset': true, 'appium:autoAcceptAlerts': true, 'appium:wdaLaunchTimeout': 600000, 'appium:wdaConnectionTimeout': 600000, 'appium:showXcodeLog': false, 'appium:newCommandTimeout': 600,
} } })
const sid = s.sessionId
const S = (p) => `/session/${sid}${p}`
const id = (e) => e['element-6066-11e4-a52e-4f735466cecf'] ?? e.ELEMENT
const find = (using, value) => j('POST', S('/element'), { using, value })
const source = () => j('GET', S('/source'))
const shot = async (name) => writeFileSync(`${OUT}${app}-${user}-${name}.png`, Buffer.from(await j('GET', S('/screenshot')), 'base64'))
// stale-element-safe: re-find right before acting, retry a few times
const act = async (using, value, fn) => { let err; for (let i = 0; i < 4; i++) { try { return await fn(id(await find(using, value))) } catch (e) { err = e; await sleep(1500) } } throw err }
// iOS offers to save the password after a successful sign-in; the sheet would cover the next app's form
const dismissSavePassword = async () => { try { const src = await source(); if (src.includes('Not Now')) { const el = id(await find('-ios predicate string', "label == 'Not Now'")); await j('POST', S(`/element/${el}/click`), {}); await sleep(800) } } catch {} }
let status = 'ERROR'
try {
  execSync(`xcrun simctl openurl ${udid} "exp://127.0.0.1:${port}"`)
  // wait for THIS app's sign-in screen (Expo Go may still be showing the previous app while the new bundle loads)
  let ready = false
  for (let i = 0; i < 40; i++) { await sleep(3000); const src = await source(); if ((src.includes(`Distribution OS - ${title}`) || src.includes(`Distribution OS ${title}`)) && src.includes('XCUIElementTypeTextField')) { ready = true; break } }
  if (!ready) throw new Error(`sign-in screen for ${title} did not appear`)
  await sleep(1500); await dismissSavePassword(); await shot('0-signin')
  // click BEFORE typing: XCUITest types into whichever field has focus, and a SecureTextField does not take focus on /value alone
  await act('class name', 'XCUIElementTypeTextField', async (el) => { await j('POST', S(`/element/${el}/click`), {}); await j('POST', S(`/element/${el}/clear`), {}); await j('POST', S(`/element/${el}/value`), { text: user }) })
  await act('class name', 'XCUIElementTypeSecureTextField', async (el) => { await j('POST', S(`/element/${el}/click`), {}); await j('POST', S(`/element/${el}/value`), { text: 'Dos@1234' }) })
  await shot('1-filled')
  try { await act('-ios class chain', '**/XCUIElementTypeButton[`label == "Sign in"`]', (el) => j('POST', S(`/element/${el}/click`), {})) }
  catch { await act('-ios predicate string', "label == 'Sign in' AND type == 'XCUIElementTypeOther'", (el) => j('POST', S(`/element/${el}/click`), {})) }
  const onSignIn = (src) => /label="Username"/.test(src) && /label="Password"/.test(src)
  let src = ''
  for (let i = 0; i < 15; i++) { await sleep(2000); await dismissSavePassword(); src = await source(); if (!onSignIn(src)) break }
  await sleep(3000); await dismissSavePassword(); await shot('2-home'); src = await source()
  status = onSignIn(src) ? 'STILL_ON_SIGN_IN' : 'SIGNED_IN'
  const labels = [...src.matchAll(/label="([^"]{2,60})"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 22)
  console.log(status, app, user, '|', labels.join(' | '))
} catch (e) {
  await shot('9-error').catch(() => {}); console.log('ERROR', app, user, String(e).slice(0, 200))
} finally { await j('DELETE', S('')).catch(() => {}) }
