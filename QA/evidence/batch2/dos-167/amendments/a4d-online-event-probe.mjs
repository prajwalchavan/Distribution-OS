// Does the per-page CDP offline emulation this walk uses actually fire the window `online`/`offline` events the
// engine listens for (`react.tsx:291`)? Without this the ~50 s the queued order waited in run C could be blamed on
// the harness rather than on the product. A bare same-origin page, no app: just the events and navigator.onLine.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire('/Users/prajwalchavan/Desktop/Distribution OS/QA/tools/package.json')
const { chromium } = require('playwright')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ctx = await chromium.launchPersistentContext(
  '/private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/scratchpad/a4d-profile',
  { headless: true },
)
const page = await ctx.newPage()
await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>probe</h1>' }))
await page.goto('http://localhost:5175/')
await page.evaluate(() => {
  window.__evts = []
  addEventListener('online', () => window.__evts.push({ e: 'online', at: Date.now(), onLine: navigator.onLine }))
  addEventListener('offline', () => window.__evts.push({ e: 'offline', at: Date.now(), onLine: navigator.onLine }))
})
const cdp = await ctx.newCDPSession(page)
await cdp.send('Network.enable')
const result = {}
await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await sleep(1500)
result.afterOffline = await page.evaluate(() => ({ onLine: navigator.onLine, events: window.__evts }))
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await sleep(1500)
result.afterOnline = await page.evaluate(() => ({ onLine: navigator.onLine, events: window.__evts }))
result.offlineEventFired = result.afterOffline.events.some((e) => e.e === 'offline')
result.onlineEventFired = result.afterOnline.events.some((e) => e.e === 'online')
console.log(JSON.stringify(result, null, 1))
writeFileSync(join(HERE, 'a4d-online-event-probe.json'), JSON.stringify(result, null, 1))
await ctx.close()
