/**
 * DOS-167 close — the iOS driver for this walk.
 *
 * One process per step, one W3C/XCUITest session shared through ~/.dos-qa-logs/ios-session-dos167
 * (newCommandTimeout 1800). Elements are found by accessibility LABEL out of the page source — never a
 * raw coordinate unless the sheet aggregates into one element, and then the tap is recorded as `tapxy`.
 *
 * The only thing this file adds over QA/tools/ios-drive.mjs is TIME: every tap prints its own epoch
 * millisecond, so a sign-in tap can be lined up against QA-evidence `ios-02-request-timeline.jsonl`.
 *
 * Usage: node ios.mjs <cmd> [...args]
 *   labels [filter] | src [file] | shot <file> | tap <label> [n] | tapc <substr> [n] | tapxy <x> <y>
 *   type <text> | setclass <Class> <n> <text> | swipe up|down [amt] | drag x1 y1 x2 y2 [ms]
 *   wait <ms> | has <substr> | now | end
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

const A = 'http://127.0.0.1:4723'
const SID_FILE = `${homedir()}/.dos-qa-logs/ios-session-dos167`
mkdirSync(`${homedir()}/.dos-qa-logs`, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const stamp = (t = Date.now()) => `${new Date(t).toISOString()} (${t})`

const j = async (method, path, body) => {
  const r = await fetch(A + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await r.json()
  if (t.value && t.value.error) {
    const e = new Error(`${path}: ${t.value.error} ${String(t.value.message).slice(0, 200)}`)
    e.code = t.value.error
    throw e
  }
  return t.value
}
const udid = () => execSync(`xcrun simctl list devices booted | grep -o '[0-9A-F-]\\{36\\}' | head -1`).toString().trim()
const alive = async (sid) => {
  try {
    await j('GET', `/session/${sid}/window/rect`)
    return true
  } catch {
    return false
  }
}
const session = async () => {
  if (existsSync(SID_FILE)) {
    const sid = readFileSync(SID_FILE, 'utf8').trim()
    if (sid && (await alive(sid))) return sid
  }
  const s = await j('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:udid': udid(),
        'appium:bundleId': 'host.exp.Exponent',
        'appium:noReset': true,
        'appium:autoAcceptAlerts': false,
        'appium:wdaLaunchTimeout': 600000,
        'appium:wdaConnectionTimeout': 600000,
        'appium:showXcodeLog': false,
        'appium:newCommandTimeout': 1800,
      },
    },
  })
  writeFileSync(SID_FILE, s.sessionId)
  return s.sessionId
}
const eid = (e) => e['element-6066-11e4-a52e-4f735466cecf'] ?? e.ELEMENT
const parse = (xml) =>
  [...xml.matchAll(/<(XCUIElementType\w+)([^>]*)>/g)].map((m) => {
    const a = Object.fromEntries([...m[2].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]))
    return {
      type: m[1].replace('XCUIElementType', ''),
      label: a.label ?? '',
      name: a.name ?? '',
      value: a.value ?? '',
      visible: a.visible,
      enabled: a.enabled,
      x: +a.x,
      y: +a.y,
      w: +a.width,
      h: +a.height,
    }
  })
const dec = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#10;/g, ' ')
    .replace(/&apos;/g, "'")

export const sid = await session()
const S = (p) => `/session/${sid}${p}`
export const source = async () => dec(await j('GET', S('/source')))
export const rawSource = async () => j('GET', S('/source'))
export const shot = async (file) => {
  // `xcrun simctl io booted screenshot` is the evidence of record; Appium's is used only when a file
  // has to be taken at a precise moment inside a step.
  execSync(`xcrun simctl io booted screenshot "${file}"`, { stdio: 'ignore' })
  return file
}
export const tapAt = async (x, y) => {
  const t = Date.now()
  await j('POST', S('/actions'), {
    actions: [
      {
        type: 'pointer',
        id: 'f1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  })
  return t
}
export const pick = async (pred, n = 0, type = null) => {
  const els = parse(await j('GET', S('/source'))).filter(
    (e) => pred(dec(e.label)) && e.w > 0 && e.h > 0 && (!type || e.type === type),
  )
  const vis = els.filter((e) => e.visible === 'true')
  const list = vis.length ? vis : els
  const byLabel = new Map()
  for (const e of list) {
    const k = `${dec(e.label)}|${Math.round(e.x)}|${Math.round(e.y)}`
    const p = byLabel.get(k)
    if (!p || e.w * e.h < p.w * p.h) byLabel.set(k, e)
  }
  const uniq = [...byLabel.values()].sort((a, b) => a.y - b.y || a.x - b.x)
  return { el: uniq[n], all: uniq }
}
/** Tap the n-th element whose label satisfies `pred`; returns { t, el } with t = epoch ms of the tap. */
export const tapLabel = async (pred, n = 0, type = null) => {
  const { el, all } = await pick(pred, n, type)
  if (!el) return { t: null, el: null, all }
  const t = await tapAt(el.x + el.w / 2, el.y + el.h / 2)
  return { t, el, all }
}
export const labels = async (filter) => {
  const els = parse(await j('GET', S('/source'))).filter((e) => (e.label || e.value) && e.visible === 'true')
  const seen = new Set()
  const out = []
  for (const e of els) {
    const l = dec(e.label)
    const k = `${l}|${e.x}|${e.y}`
    if (seen.has(k)) continue
    seen.add(k)
    if (filter && !l.toLowerCase().includes(filter.toLowerCase()) && !dec(e.value).toLowerCase().includes(filter.toLowerCase()))
      continue
    out.push(
      `${e.type}\t[${e.x},${e.y} ${e.w}x${e.h}]\t${e.enabled === 'false' ? '(disabled) ' : ''}${l}${e.value && e.value !== l ? ` = ${dec(e.value)}` : ''}`,
    )
  }
  return out
}
export const setClass = async (cls, n, text) => {
  const els = await j('POST', S('/elements'), { using: 'class name', value: cls })
  if (!els[n]) throw new Error(`no ${cls}[${n}] of ${els.length}`)
  const e = eid(els[n])
  await j('POST', S(`/element/${e}/click`), {})
  await sleep(400)
  await j('POST', S(`/element/${e}/clear`), {}).catch(() => {})
  await j('POST', S(`/element/${e}/value`), { text })
}
export const drag = async (x1, y1, x2, y2, dur = 700) =>
  j('POST', S('/actions'), {
    actions: [
      {
        type: 'pointer',
        id: 'f1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: x1, y: y1 },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 120 },
          { type: 'pointerMove', duration: dur, x: x2, y: y2 },
          { type: 'pause', duration: 200 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  })
export const openUrl = (u) => execSync(`xcrun simctl openurl ${udid()} "${u}"`)
export const endSession = async () => {
  await j('DELETE', S(''))
  writeFileSync(SID_FILE, '')
}
export { sleep, dec, parse, j, S }

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('ios.mjs')) {
  const [cmd, ...args] = process.argv.slice(2)
  try {
    switch (cmd) {
      case 'new':
        console.log('session', sid)
        break
      case 'end':
        await endSession()
        console.log('ended')
        break
      case 'now':
        console.log(stamp())
        break
      case 'shot':
        await shot(args[0])
        console.log('shot', args[0], stamp())
        break
      case 'src': {
        const x = await rawSource()
        if (args[0]) writeFileSync(args[0], x)
        else console.log(x)
        break
      }
      case 'labels':
        console.log((await labels(args[0])).join('\n'))
        break
      case 'tap':
      case 'tapc': {
        const want = args[0]
        const n = +(args[1] ?? 0)
        const type = args[2] ?? null
        const { t, el, all } = await tapLabel(cmd === 'tap' ? (l) => l === want : (l) => l.includes(want), n, type)
        if (!el) {
          console.log(`NOT FOUND ${want} (matches ${all.length})`)
          process.exitCode = 2
          break
        }
        console.log(
          `tapped "${dec(el.label).slice(0, 90)}" ${el.type} at ${Math.round(el.x + el.w / 2)},${Math.round(el.y + el.h / 2)} (${n + 1} of ${all.length})  t=${stamp(t)}`,
        )
        break
      }
      case 'tapxy': {
        const t = await tapAt(+args[0], +args[1])
        console.log(`tapped ${args[0]} ${args[1]}  t=${stamp(t)}`)
        break
      }
      case 'type': {
        const text = args.join(' ')
        await j('POST', S('/keys'), { value: [...text] }).catch(async () => {
          const a = await j('GET', S('/element/active'))
          await j('POST', S(`/element/${eid(a)}/value`), { text })
        })
        console.log('typed', text)
        break
      }
      case 'setclass':
        await setClass(args[0], +args[1], args.slice(2).join(' '))
        console.log('set', args[0], args[1])
        break
      case 'swipe': {
        const r = await j('GET', S('/window/rect'))
        const amt = +(args[1] ?? 0.5)
        const x = r.width / 2
        const [y1, y2] = args[0] === 'up' ? [r.height * 0.75, r.height * (0.75 - amt)] : [r.height * 0.3, r.height * (0.3 + amt)]
        await drag(Math.round(x), Math.round(y1), Math.round(x), Math.round(y2), 600)
        console.log('swiped', args[0], amt)
        break
      }
      case 'drag':
        await drag(+args[0], +args[1], +args[2], +args[3], +(args[4] ?? 700))
        console.log('dragged', args.slice(0, 4).join(' '))
        break
      case 'wait':
        await sleep(+args[0])
        break
      case 'url':
        openUrl(args[0])
        console.log('opened', args[0], stamp())
        break
      case 'has': {
        const x = await source()
        const ok = x.includes(args.join(' '))
        console.log(ok ? 'YES' : 'NO')
        process.exitCode = ok ? 0 : 1
        break
      }
      default:
        console.log('unknown command', cmd)
        process.exitCode = 1
    }
  } catch (e) {
    console.log('ERROR', String(e).slice(0, 300))
    process.exitCode = 1
  }
}
