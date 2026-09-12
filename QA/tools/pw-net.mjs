// Visit one route and save every API response (JSON) to QA/evidence/<EV_DIR>/net-<name>/ ; print a table.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const [url, name] = process.argv.slice(2)
const dir = fileURLToPath(new URL(`../evidence/${process.env.EV_DIR ?? 'phase1/owner'}/net-${name}/`, import.meta.url)); mkdirSync(dir, { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333'); const page = browser.contexts()[0].pages()[0]
const rows = []; let n = 0
page.on('response', async (res) => { const u = res.url(); if (/:5173\//.test(u) && !/\/(rpc|api)\b/.test(u)) return; const i = ++n; let body = ''; try { body = await res.text() } catch {} const f = `${String(i).padStart(2, '0')}-${res.request().method()}-${u.replace(/^https?:\/\/localhost:\d+\//, '').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80)}.json`; writeFileSync(dir + f, body); rows.push(`${res.status()} ${res.request().method().padEnd(5)} ${u.replace('http://localhost', '')} -> ${f} (${body.length}b)`) })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(2000)
console.log(rows.join('\n')); await browser.close().catch(() => {})
