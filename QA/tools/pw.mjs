// One command against the shared Chromium (pw-server.mjs). Evidence goes to QA/evidence/<EV_DIR>/ (default phase1/owner).
// node pw.mjs goto <url> [name] | shot <name> | phone <name> | desk | size <w> <h> | text [maxChars] | click <sel> | fill <sel> <val>
//              | press <key> | eval <js> | refs | login <user> [pass] | wait <ms> | url
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const EV = fileURLToPath(new URL(`../evidence/${process.env.EV_DIR ?? 'phase1/owner'}/`, import.meta.url))
mkdirSync(EV, { recursive: true })
const [cmd, ...args] = process.argv.slice(2)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.PW_PORT ?? '9333'}`)
const ctx = browser.contexts()[0]
const page = ctx.pages()[0]
const consoleErrors = [], failed = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url()}`) })
const settle = async (ms = 1500) => { await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(ms) }
const shot = async (name) => { const p = `${EV}${name}.png`; await page.screenshot({ path: p, fullPage: true }); const t = await page.innerText('body').catch(() => ''); writeFileSync(`${EV}${name}.txt`, t); console.log(`[shot] ${p} (${t.length} chars text)`) }
const sel = (s) => (s.startsWith('text=') || s.startsWith('css=') || s.startsWith('xpath=') || s.startsWith('[') || s.startsWith('#') || s.startsWith('.') || /^[a-z]+(\[|$)/.test(s)) ? page.locator(s).first() : page.getByText(s, { exact: false }).first()
try {
  switch (cmd) {
    case 'goto': await page.goto(args[0], { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(); if (args[1]) await shot(args[1]); console.log('[url]', page.url()); break
    case 'shot': await settle(500); await shot(args[0]); break
    case 'phone': await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1200); await shot(args[0]); break
    case 'desk': await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(800); if (args[0]) await shot(args[0]); break
    case 'size': await page.setViewportSize({ width: +args[0], height: +args[1] }); await page.waitForTimeout(800); if (args[2]) await shot(args[2]); break
    case 'text': { const t = (await page.innerText('body')).replace(/\n{3,}/g, '\n\n'); console.log(t.slice(0, +(args[0] ?? 6000))); break }
    case 'click': await sel(args[0]).click({ timeout: 10000 }); await settle(); console.log('[url]', page.url()); if (args[1]) await shot(args[1]); break
    case 'fill': await sel(args[0]).fill(args[1]); console.log('[filled]'); break
    case 'press': await page.keyboard.press(args[0]); await settle(500); break
    case 'wait': await page.waitForTimeout(+args[0]); break
    case 'url': console.log(page.url()); break
    case 'eval': console.log(JSON.stringify(await page.evaluate(args[0]), null, 1)?.slice(0, 8000)); break
    case 'refs': { const r = await page.evaluate(() => [...document.querySelectorAll('a,button,[role=button],[role=link],[role=tab],input,select,textarea,[role=checkbox],[role=switch]')].map((e, i) => `${i}\t${e.tagName.toLowerCase()}${e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''}\t${(e.getAttribute('data-testid') || '')}\t${(e.getAttribute('href') || e.getAttribute('placeholder') || '')}\t${(e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80)}`)); console.log(r.join('\n')); break }
    case 'login': { await page.goto(args[2] ?? 'http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 60000 }); await page.fill('[data-testid=sign-in-username]', args[0]); await page.fill('[data-testid=sign-in-password]', args[1] ?? 'Dos@1234'); await page.click('[data-testid=sign-in-submit]'); for (let i = 0; i < 40 && page.url().includes('sign-in'); i++) await page.waitForTimeout(500); await settle(2500); console.log('[url]', page.url()); break }
    case 'do': { const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor; const fn = new AsyncFunction('page', 'settle', 'shot', 'sel', args[0]); const out = await fn(page, settle, shot, sel); if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1)?.slice(0, 8000)); console.log('[url]', page.url()); break }
    default: console.log('unknown command', cmd)
  }
} finally {
  if (consoleErrors.length) console.log('[console errors]', consoleErrors.join('\n  '))
  if (failed.length) console.log('[failed requests]', failed.join('\n  '))
  await browser.close().catch(() => {})
}
