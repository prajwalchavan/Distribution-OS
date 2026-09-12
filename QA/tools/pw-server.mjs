// Long-lived headless Chromium with a CDP port, so short pw.mjs commands share one signed-in session.
// Usage: nohup node pw-server.mjs > ~/.dos-qa-logs/logs/pw-server.log 2>&1 &
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${process.env.PW_PORT ?? '9333'}`] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.newPage()
console.log(`pw-server ready on http://127.0.0.1:${process.env.PW_PORT ?? '9333'}`)
setInterval(() => {}, 1 << 30)
