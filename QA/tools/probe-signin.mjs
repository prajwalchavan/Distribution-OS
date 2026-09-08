import { chromium } from 'playwright'
const url = process.argv[2] ?? 'http://localhost:5173'
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.goto(url, { waitUntil: 'networkidle', timeout: 120000 })
await p.waitForTimeout(3000)
console.log('URL', p.url(), 'TITLE', await p.title())
const els = await p.$$eval('input, button, [role=button], a[href]', (ns) => ns.map((n) => ({
  tag: n.tagName, type: n.getAttribute('type'), ph: n.getAttribute('placeholder'), name: n.getAttribute('name'),
  al: n.getAttribute('aria-label'), tid: n.getAttribute('data-testid'), id: n.id, text: (n.innerText || '').trim().slice(0, 40), href: n.getAttribute('href'),
})))
console.log(JSON.stringify(els, null, 0))
console.log('TEXT', (await p.innerText('body')).replace(/\s+/g, ' ').slice(0, 600))
await b.close()
