// One-command-per-process iOS driver over the already-running Appium (XCUITest) on :4723 — no Simulator window.
// The WebDriver session id is kept in ~/.dos-qa-logs/ios-session so short commands share one session (newCommandTimeout 1800).
// Usage: node ios-drive.mjs <cmd> [...args]
//   new                      create (or reuse) the session on the booted simulator, Expo Go bundle
//   end                      delete the session
//   shot <file.png>          screenshot via Appium (use xcrun simctl io booted screenshot for evidence of record)
//   labels [filter]          print visible element labels in document order with type and rect
//   src [file]               dump the page source XML (to file or stdout)
//   tap <label> [n]          tap the n-th (default 0) element whose label == <label> (visible ones first)
//   tapc <substring> [n]     tap the n-th element whose label CONTAINS <substring>
//   tapxy <x> <y>            tap at a point (points, not pixels)
//   type <text>              send keys to the focused element
//   setfield <n> <text>      tap the n-th TextField and type into it
//   setclass <class> <n> <text>  click, clear and type into the n-th element of an XCUIElementType class
//   swipe up|down [amount]   scroll by dragging (amount = fraction of screen height, default 0.5)
//   drag x1 y1 x2 y2 [ms]    drag between two points (points)
//   wait <ms>
//   url <exp-url>            open a URL in the simulator (simctl openurl)
//   has <substring>          exit 0 if the page source contains substring, else 1
//   alert                    print alert text if one is present; `alert accept|dismiss|<buttonLabel>` acts on it
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
const A = 'http://127.0.0.1:4723'
const SID_FILE = `${homedir()}/.dos-qa-logs/ios-session`
mkdirSync(`${homedir()}/.dos-qa-logs`, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const j = async (method, path, body) => {
  const r = await fetch(A + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.json(); if (t.value && t.value.error) { const e = new Error(`${path}: ${t.value.error} ${String(t.value.message).slice(0, 200)}`); e.code = t.value.error; throw e } return t.value
}
const udid = () => execSync(`xcrun simctl list devices booted | grep -o '[0-9A-F-]\\{36\\}' | head -1`).toString().trim()
const alive = async (sid) => { try { await j('GET', `/session/${sid}/window/rect`); return true } catch { return false } }
const session = async () => {
  if (existsSync(SID_FILE)) { const sid = readFileSync(SID_FILE, 'utf8').trim(); if (sid && (await alive(sid))) return sid }
  const s = await j('POST', '/session', { capabilities: { alwaysMatch: {
    platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid(), 'appium:bundleId': 'host.exp.Exponent',
    'appium:noReset': true, 'appium:autoAcceptAlerts': false, 'appium:wdaLaunchTimeout': 600000, 'appium:wdaConnectionTimeout': 600000,
    'appium:showXcodeLog': false, 'appium:newCommandTimeout': 1800,
  } } })
  writeFileSync(SID_FILE, s.sessionId); return s.sessionId
}
const eid = (e) => e['element-6066-11e4-a52e-4f735466cecf'] ?? e.ELEMENT
const [cmd, ...args] = process.argv.slice(2)
const sid = await session()
const S = (p) => `/session/${sid}${p}`
const parse = (xml) => [...xml.matchAll(/<(XCUIElementType\w+)([^>]*)>/g)].map((m) => {
  const a = Object.fromEntries([...m[2].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]))
  return { type: m[1].replace('XCUIElementType', ''), label: a.label ?? '', name: a.name ?? '', value: a.value ?? '', visible: a.visible, enabled: a.enabled, x: +a.x, y: +a.y, w: +a.width, h: +a.height }
})
const dec = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, ' ').replace(/&apos;/g, "'")
const tapAt = async (x, y) => j('POST', S('/actions'), { actions: [{ type: 'pointer', id: 'f1', parameters: { pointerType: 'touch' }, actions: [
  { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 80 }, { type: 'pointerUp', button: 0 } ] }] })
const pick = async (pred, n) => {
  const els = parse(await j('GET', S('/source'))).filter((e) => pred(dec(e.label)) && e.w > 0 && e.h > 0)
  const vis = els.filter((e) => e.visible === 'true'); const list = vis.length ? vis : els
  // prefer the innermost (smallest) element with that label: RN wraps a Pressable in Others that repeat the label
  const byLabel = new Map(); for (const e of list) { const k = `${dec(e.label)}|${Math.round(e.x)}|${Math.round(e.y)}`; const p = byLabel.get(k); if (!p || e.w * e.h < p.w * p.h) byLabel.set(k, e) }
  const uniq = [...byLabel.values()].sort((a, b) => a.y - b.y || a.x - b.x)
  return { el: uniq[n], count: uniq.length, all: uniq }
}
try {
  switch (cmd) {
    case 'new': console.log('session', sid); break
    case 'end': await j('DELETE', S('')); writeFileSync(SID_FILE, ''); console.log('ended'); break
    case 'shot': writeFileSync(args[0], Buffer.from(await j('GET', S('/screenshot')), 'base64')); console.log('shot', args[0]); break
    case 'src': { const x = await j('GET', S('/source')); if (args[0]) writeFileSync(args[0], x); else console.log(x); break }
    case 'labels': {
      const f = args[0] ? args[0].toLowerCase() : null
      const els = parse(await j('GET', S('/source'))).filter((e) => (e.label || e.value) && e.visible === 'true')
      const seen = new Set()
      for (const e of els) { const l = dec(e.label); const k = `${l}|${e.x}|${e.y}`; if (seen.has(k)) continue; seen.add(k); if (f && !l.toLowerCase().includes(f) && !dec(e.value).toLowerCase().includes(f)) continue; console.log(`${e.type}\t[${e.x},${e.y} ${e.w}x${e.h}]\t${e.enabled === 'false' ? '(disabled) ' : ''}${l}${e.value && e.value !== l ? ` = ${dec(e.value)}` : ''}`) }
      break }
    case 'tap': case 'tapc': {
      const want = args[0]; const n = +(args[1] ?? 0)
      const { el, count, all } = await pick(cmd === 'tap' ? (l) => l === want : (l) => l.includes(want), n)
      if (!el) { console.log(`NOT FOUND ${want} (matches ${count})`); process.exitCode = 2; break }
      await tapAt(el.x + el.w / 2, el.y + el.h / 2); console.log(`tapped "${dec(el.label).slice(0, 80)}" ${el.type} at ${Math.round(el.x + el.w / 2)},${Math.round(el.y + el.h / 2)} (${n + 1} of ${all.length})`); break }
    case 'tapxy': await tapAt(+args[0], +args[1]); console.log('tapped', args[0], args[1]); break
    case 'type': await j('POST', S('/keys'), { value: [...args.join(' ')] }).catch(async () => { const a = await j('GET', S('/element/active')); await j('POST', S(`/element/${eid(a)}/value`), { text: args.join(' ') }) }); console.log('typed', args.join(' ')); break
    case 'setfield': {
      const els = await j('POST', S('/elements'), { using: 'class name', value: 'XCUIElementTypeTextField' })
      const e = eid(els[+args[0]]); await j('POST', S(`/element/${e}/click`), {}); await sleep(300); await j('POST', S(`/element/${e}/value`), { text: args.slice(1).join(' ') }); console.log('set field', args[0]); break }
    case 'setclass': {
      // setclass <XCUIElementTypeX> <n> <text...>  — click the n-th element of that class, clear it, then type (e.g. SearchField)
      const els = await j('POST', S('/elements'), { using: 'class name', value: args[0] })
      if (!els[+args[1]]) { console.log('NOT FOUND', args[0], args[1], 'of', els.length); process.exitCode = 2; break }
      const e = eid(els[+args[1]]); await j('POST', S(`/element/${e}/click`), {}); await sleep(400)
      await j('POST', S(`/element/${e}/clear`), {}).catch(() => {}); await j('POST', S(`/element/${e}/value`), { text: args.slice(2).join(' ') })
      console.log('set', args[0], args[1], '=', args.slice(2).join(' ')); break }
    case 'swipe': {
      const r = await j('GET', S('/window/rect')); const amt = +(args[1] ?? 0.5); const x = r.width / 2
      const [y1, y2] = args[0] === 'up' ? [r.height * 0.75, r.height * (0.75 - amt)] : [r.height * 0.3, r.height * (0.3 + amt)]
      await j('POST', S('/actions'), { actions: [{ type: 'pointer', id: 'f1', parameters: { pointerType: 'touch' }, actions: [
        { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y1) }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 100 },
        { type: 'pointerMove', duration: 600, x: Math.round(x), y: Math.round(y2) }, { type: 'pointerUp', button: 0 } ] }] })
      console.log('swiped', args[0], amt); break }
    case 'drag': {
      const [x1, y1, x2, y2] = args.map(Number); const dur = +(args[4] ?? 700)
      await j('POST', S('/actions'), { actions: [{ type: 'pointer', id: 'f1', parameters: { pointerType: 'touch' }, actions: [
        { type: 'pointerMove', duration: 0, x: x1, y: y1 }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 120 },
        { type: 'pointerMove', duration: dur, x: x2, y: y2 }, { type: 'pause', duration: 200 }, { type: 'pointerUp', button: 0 } ] }] })
      console.log('dragged', x1, y1, '->', x2, y2); break }
    case 'wait': await sleep(+args[0]); break
    case 'url': execSync(`xcrun simctl openurl ${udid()} "${args[0]}"`); console.log('opened', args[0]); break
    case 'has': { const x = dec(await j('GET', S('/source'))); const ok = x.includes(args.join(' ')); console.log(ok ? 'YES' : 'NO'); process.exitCode = ok ? 0 : 1; break }
    case 'alert': {
      try { const t = await j('GET', S('/alert/text')); console.log('ALERT:', t)
        if (args[0] === 'accept') await j('POST', S('/alert/accept'), {}); else if (args[0] === 'dismiss') await j('POST', S('/alert/dismiss'), {})
        else if (args[0]) { const b = await j('GET', S('/alert/buttons')).catch(() => null); console.log('buttons', b); await j('POST', S('/alert/accept'), { buttonLabel: args[0] }) }
      } catch (e) { console.log('no alert', String(e).slice(0, 120)) }
      break }
    default: console.log('unknown command', cmd); process.exitCode = 1
  }
} catch (e) { console.log('ERROR', String(e).slice(0, 300)); process.exitCode = 1 }
