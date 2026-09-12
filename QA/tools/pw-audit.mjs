// Visit routes in the shared session; report only console errors, failed requests and page-level error text.
import { chromium } from 'playwright'
const base = process.argv[2]; const routes = process.argv.slice(3)
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333'); const page = browser.contexts()[0].pages()[0]
for (const r of routes) {
  const ce = [], fr = []
  const onC = (m) => { if (m.type() === 'error' || m.type() === 'warning') ce.push(`${m.type()}: ${m.text().slice(0, 200)}`) }
  const onR = (res) => { if (res.status() >= 400) fr.push(`${res.status()} ${res.request().method()} ${res.url()}`) }
  page.on('console', onC); page.on('response', onR)
  await page.goto(`${base}/${r}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1500)
  const t = await page.innerText('body'); const bad = (t.match(/(could not|failed|error|something went wrong|not found|unauthori[sz]ed|forbidden|does not serve)[^\n]{0,80}/gi) || []).slice(0, 5)
  console.log(`/${r}: console=${ce.length} failed=${fr.length} ${bad.length ? 'TEXT: ' + bad.join(' | ') : ''}`)
  ce.forEach((x) => console.log('   ', x)); fr.forEach((x) => console.log('   ', x))
  page.off('console', onC); page.off('response', onR)
}
await browser.close().catch(() => {})
