// Exploratory: sign in as the two-distributor rep and dump the switch UI (DOS-167 ruling 3, web item 10).
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const CDP = `http://127.0.0.1:${process.env.PW_PORT ?? '9341'}`
const APP = 'http://localhost:5175'
const browser = await chromium.connectOverCDP(CDP)
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['local-network-access'] })
await ctx.route(/^http:\/\/localhost:5175\//, async (route) => {
  let response
  try { response = await route.fetch() } catch { await route.continue().catch(() => {}); return }
  const headers = { ...response.headers() }
  delete headers['content-encoding']; delete headers['content-length']; delete headers['transfer-encoding']
  headers['cross-origin-opener-policy'] = 'same-origin'
  headers['cross-origin-embedder-policy'] = 'require-corp'
  headers['cross-origin-resource-policy'] = 'same-origin'
  await route.fulfill({ response, headers })
})
const page = await ctx.newPage()
const out = { steps: [] }
page.on('console', (m) => { const t = m.text().slice(0, 300); if (/offline:|sqlite|not a database|cannot create file/i.test(t)) out.steps.push({ console: t }) })
await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 240000 })
await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 240000 })
await page.fill('[data-testid=sign-in-username]', 'ruksana.shaikh')
await page.fill('[data-testid=sign-in-password]', 'Dos@1234')
await page.click('[data-testid=sign-in-submit]')
await page.waitForTimeout(6000)
out.afterSignIn = {
  path: await page.evaluate(() => location.pathname),
  body: (await page.innerText('body')).slice(0, 1500),
}
out.controls = await page.evaluate(() =>
  [...document.querySelectorAll('button,[role=button],[role=menuitem],a')]
    .filter((e) => e.offsetParent !== null)
    .map((e) => ({ tag: e.tagName, testid: e.getAttribute('data-testid'), aria: e.getAttribute('aria-label'), haspopup: e.getAttribute('aria-haspopup'), href: e.getAttribute('href'), text: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) }))
    .slice(0, 60),
)
await page.screenshot({ path: 'probe-switch-01-signed-in.png' })
// open every haspopup menu and record what is inside
const pops = await page.locator('button[aria-haspopup="menu"]:visible').all()
out.menus = []
for (let i = 0; i < pops.length; i += 1) {
  await pops[i].click({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(600)
  out.menus.push({
    index: i,
    items: await page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map((e) => ({ testid: e.getAttribute('data-testid'), text: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) }))),
  })
  await page.screenshot({ path: `probe-switch-02-menu-${i}.png` })
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(400)
}
writeFileSync('probe-switch.json', JSON.stringify(out, null, 1))
console.log(JSON.stringify({ path: out.afterSignIn.path, menus: out.menus }, null, 1).slice(0, 2500))
await ctx.close(); await browser.close()
