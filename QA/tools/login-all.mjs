// Phase 0 evidence: sign in to every web app as every role, screenshot desk + phone, record console/network errors.
// Usage: node login-all.mjs [filter]   e.g. node login-all.mjs retailer
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../evidence/phase0/web/', import.meta.url))
mkdirSync(OUT, { recursive: true })
const PASSWORD = 'Dos@1234'
const ACCOUNTS = [
  { app: 'owner', port: 5173, user: 'sunil.tarsun', role: 'owner' },
  { app: 'manager', port: 5174, user: 'vikas.kadam', role: 'manager' },
  { app: 'manager', port: 5174, user: 'meena.joshi', role: 'accountant' },
  { app: 'sales', port: 5175, user: 'rahul.deshmukh', role: 'salesperson' },
  { app: 'warehouse', port: 5176, user: 'dinesh.patil', role: 'warehouse' },
  { app: 'delivery', port: 5177, user: 'ganesh.more', role: 'delivery' },
  { app: 'retailer', port: 5178, user: 'ramesh.gupta', role: 'retailer (3 distributors)' },
  { app: 'admin', port: 5179, user: 'dos.admin', role: 'platform_admin' },
]
const filter = process.argv[2]
const results = []
const browser = await chromium.launch()

for (const a of ACCOUNTS.filter((x) => !filter || x.app.includes(filter) || x.user.includes(filter))) {
  const tag = `${a.app}-${a.user}`
  const r = { ...a, consoleErrors: [], failedRequests: [], steps: [] }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') r.consoleErrors.push(m.text().slice(0, 200)) })
  page.on('response', (res) => { if (res.status() >= 400) r.failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`) })
  try {
    await page.goto(`http://localhost:${a.port}/`, { waitUntil: 'networkidle', timeout: 120000 })
    await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 60000 })
    await page.screenshot({ path: `${OUT}${tag}-0-signin.png` })
    await page.fill('[data-testid=sign-in-username]', a.user)
    await page.fill('[data-testid=sign-in-password]', PASSWORD)
    await page.click('[data-testid=sign-in-submit]')
    r.steps.push('submitted')
    // wait for either leaving /sign-in or a distributor picker
    let left = false
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500)
      if (!page.url().includes('sign-in')) { left = true; break }
      const picker = page.locator('text=/Tarsun/i').first()
      if (await picker.count()) {
        await page.screenshot({ path: `${OUT}${tag}-1-picker.png` })
        r.steps.push('distributor picker shown; chose Tarsun')
        await picker.click()
      }
    }
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2500)
    r.landedUrl = page.url()
    r.leftSignIn = left
    r.title = await page.title()
    r.bodyText = (await page.innerText('body')).replace(/\s+/g, ' ').slice(0, 400)
    await page.screenshot({ path: `${OUT}${tag}-2-home-desk.png`, fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}${tag}-3-home-phone.png`, fullPage: true })
    r.status = left ? 'SIGNED_IN' : 'STILL_ON_SIGN_IN'
  } catch (e) {
    r.status = 'ERROR'
    r.error = String(e).slice(0, 300)
    await page.screenshot({ path: `${OUT}${tag}-9-error.png` }).catch(() => {})
  }
  await ctx.close()
  results.push(r)
  console.log(`${r.status.padEnd(18)} ${tag.padEnd(28)} -> ${r.landedUrl ?? ''}  console:${r.consoleErrors.length} failed:${r.failedRequests.length}`)
}
await browser.close()
writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2))
console.log('written', `${OUT}results.json`)
