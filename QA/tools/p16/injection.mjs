// SQL-injection / XSS / unicode / formula tests against the LOCAL API, as the owner.
// Creates retailers with hostile names, reads them back, confirms verbatim storage (no exec, no leak),
// and probes GET query params (?q=, sort, cursor) with SQLi strings for 500s / SQL text.
import { fileURLToPath } from 'node:url'; import { writeFileSync } from 'node:fs'
import { http, login, uuidv7 } from './lib.mjs'
const EV = fileURLToPath(new URL('../../evidence/p16/', import.meta.url))
const owner = await login('sunil.tarsun')
const T = owner.access
const payloads = {
  sqli_quote: "Kirana'); DROP TABLE retailers;--",
  sqli_or: "x' OR '1'='1",
  sqli_union: "' UNION SELECT username,password_hash FROM users--",
  xss_script: "<script>alert(document.cookie)</script>",
  xss_img: "<img src=x onerror=alert(1)>",
  formula_hyperlink: '=HYPERLINK("http://evil.example","click")',
  formula_cmd: '=cmd|\'/c calc\'!A1',
  formula_plus: '+1+1',
  unicode_rtl: 'Shop‮gnp.exe',
  unicode_null: 'Shop\u0000Name',
  unicode_combining: 'Shóp',
  long_10k: 'A'.repeat(10000),
}
const created = {}, readback = {}, errors = {}
for (const [tag, name] of Object.entries(payloads)) {
  const id = uuidv7()
  const body = { idempotencyKey: `inj-${tag}-${Date.now()}`, id, name, ownerName: 'QA', phone: '+919' + String(Math.floor(1e8 + Math.random() * 9e8)).slice(0,9), address: { line1: '1', area: 'A', city: 'Kalyan', pincode: '421301' }, gstRegType: 'unregistered', stateCode: '27', paymentTerms: 'POST_FULFILLMENT', cashDiscountBps: 0, cashDiscountDays: 0, active: true, tier: 'C', creditLimitPaise: 0, creditLimitBills: 0, creditDays: 0, creditMode: 'indicate' }
  const r = await http('POST', '/owner/retailers', { token: T, body })
  created[tag] = { status: r.status, id, reply: r.status >= 400 ? r.text.slice(0, 200) : (r.json?.id ?? 'ok') }
  if (r.status < 400) { const g = await http('GET', `/owner/retailers/${id}`, { token: T }); readback[tag] = { status: g.status, nameStored: g.json?.name, verbatim: g.json?.name === name } }
}
// GET query-param SQLi: ?q=, sort/order/cursor with injection strings — look for 500 or SQL text
const qProbes = [
  ['/owner/retailers?q=' + encodeURIComponent("' OR 1=1--"), 'q_or'],
  ['/owner/retailers?q=' + encodeURIComponent("'; SELECT pg_sleep(3)--"), 'q_sleep'],
  ['/owner/orders?limit=' + encodeURIComponent('1;DROP TABLE x'), 'limit_inj'],
  ['/owner/orders?cursor=' + encodeURIComponent("' OR '1'='1"), 'cursor_inj'],
  ['/owner/orders?limit=-1', 'limit_neg'],
  ['/owner/orders?limit=999999999', 'limit_huge'],
  ['/owner/retailers?sort=' + encodeURIComponent('name); DROP TABLE users--'), 'sort_inj'],
]
const query = {}
for (const [path, tag] of qProbes) { const t0 = Date.now(); const r = await http('GET', path, { token: T }); query[tag] = { status: r.status, ms: Date.now() - t0, leak: /syntax error|SELECT|pg_|drizzle|postgres|at Object|\/Users\/|node_modules|ECONNREFUSED/i.test(r.text) ? r.text.slice(0, 200) : null, sample: r.text.slice(0, 120) } }
const out = { created, readback, query }
writeFileSync(`${EV}injection.json`, JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1))
