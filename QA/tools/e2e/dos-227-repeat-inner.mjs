// DOS-227: "Repeat last order" of a line entered in inner packs — the office books the pieces the
// rep's screen showed and priced.
//
// Per viewport (desk 1280×800, phone 390×844): the rep books, through the API, an order for R-0007
// Ganesh General whose Konkan Aloo Bhujia 400 g line is `3 inner` (the SO-0836 shape); then, in the
// app, Take order → Repeat last order → Place, with the FIRST POST /sales/orders aborted (the failure
// path: the screen must say what failed and keep the lines), then Place again. Checks the screen, the
// wire (request + reply) and SQL agree on the pieces and on the total.
//
//   APP_URL=http://127.0.0.1:5427 API_URL=http://127.0.0.1:3427 \
//   DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_… \
//   PLAYWRIGHT_MODULE=…/playwright/index.mjs node QA/tools/e2e/dos-227-repeat-inner.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const APP = process.env.APP_URL ?? 'http://127.0.0.1:5427'
const API = process.env.API_URL ?? 'http://127.0.0.1:3427'
const DB = process.env.DATABASE_URL ?? ''
if (!/test/.test(DB)) {
  console.error('DATABASE_URL must name a test copy (it writes)')
  process.exit(2)
}
const PSQL = existsSync('/opt/homebrew/opt/postgresql@17/bin/psql')
  ? '/opt/homebrew/opt/postgresql@17/bin/psql'
  : 'psql'
const EV = fileURLToPath(new URL('../../evidence/simulation/fixes/day2/', import.meta.url))
mkdirSync(EV, { recursive: true })
const DESK = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }
const PASSWORD = 'Dos@1234' // the seed's demo password (pnpm db:seed)

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const sql = (q) => execFileSync(PSQL, [DB, '-Atc', q], { encoding: 'utf8' }).trim()
// PHASE=before: the same walk against the pre-fix screen (new.tsx as of 0588f30c), screenshots prefixed.
const PREFIX = process.env.PHASE === 'before' ? 'before-' : ''
async function shot(page, name) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${EV}${PREFIX}${name}.png`, fullPage: true })
  writeFileSync(`${EV}${PREFIX}${name}.txt`, await page.locator('body').innerText())
}
const inr = (p) =>
  `₹${(Number(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function uuid() {
  const ms = BigInt(Date.now())
  const b = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn)
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const TENANT = "(select id from tenants where slug = 'tarsun')"
const SHOP = sql(`select id from retailers where tenant_id = ${TENANT} and code = 'R-0007'`)
const variant = (name) =>
  sql(`select id from product_variants where name = '${name}'`)
const BHUJIA = variant('Konkan Aloo Bhujia 400 g')
const MARIE = variant('Sunbake Marie Light 300 g')
const TURMERIC = variant('Annapurna Turmeric Powder 100 g')
const bhujiaCase = Number(
  sql(
    `select coalesce(tp.case_size_override, v.default_case_size) from product_variants v join tenant_products tp on tp.variant_id = v.id and tp.tenant_id = ${TENANT} where v.id = '${BHUJIA}'`,
  ),
)

const piecesSent = (qty, unit) => (unit === 'piece' ? qty : qty * bhujiaCase)

/** The SO-0836 shape, booked through the real API as the rep: 2 case · 3 inner · 14 piece. */
async function bookInnerOrder() {
  const login = await fetch(`${API}/auth/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'rahul.deshmukh', password: PASSWORD, deviceId: uuid() }),
  }).then((r) => r.json())
  const h = { 'content-type': 'application/json', authorization: `Bearer ${login.accessToken}` }
  const id = uuid()
  await fetch(`${API}/sales/orders`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      id,
      idempotencyKey: `${id}:create`,
      retailerId: SHOP,
      source: 'salesperson',
      lines: [
        { id: uuid(), variantId: MARIE, enteredQty: 2, enteredUnit: 'case' },
        { id: uuid(), variantId: BHUJIA, enteredQty: 3, enteredUnit: 'inner' },
        { id: uuid(), variantId: TURMERIC, enteredQty: 14, enteredUnit: 'piece' },
      ],
    }),
  })
  const sub = await fetch(`${API}/sales/orders/${id}/submit`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ id, idempotencyKey: `${id}:submit` }),
  }).then((r) => r.json())
  return { id, orderNo: sub.item.orderNo }
}

const browser = await chromium.launch()
try {
  for (const [label, viewport, n] of [
    ['desk', DESK, '01'],
    ['phone', PHONE, '11'],
  ]) {
    const prior = await bookInnerOrder()
    const priorLine = sql(
      `select entered_qty || ' ' || entered_unit || ' pack ' || pack_size_at_entry || ' = ' || qty_pcs from sales_order_lines where order_id = '${prior.id}' and variant_id = '${BHUJIA}'`,
    )
    check(
      `${label}: the last order ${prior.orderNo} holds the bhujia line in inners (SQL)`,
      priorLine === `3 inner pack ${bhujiaCase} = ${3 * bhujiaCase}`,
      priorLine,
    )

    const ctx = await browser.newContext({ viewport })
    const page = await ctx.newPage()
    await page.goto(`${APP}/sign-in`)
    await page.waitForLoadState('networkidle')
    const welcome = page.getByText('Sign in', { exact: true })
    if ((await page.locator('input[type=password]').count()) === 0 && (await welcome.count()) > 0)
      await welcome.first().click()
    await page.locator('input[type=password]').waitFor({ timeout: 30000 })
    await page.locator('input[type=text]').first().fill('rahul.deshmukh')
    await page.locator('input[type=password]').fill(PASSWORD)
    await page.locator('input[type=password]').press('Enter')
    await page.waitForTimeout(3000)
    await page.goto(`${APP}/sales/orders/new?retailerId=${SHOP}`)
    const repeat = page.getByText(/^Repeat last order \(3\)$/)
    await repeat.waitFor({ timeout: 60000 })
    await shot(page, `${n}-repeat-offer-${label}`)
    await repeat.click()
    await page.getByText(/the shop pays/).first().waitFor({ timeout: 30000 })
    await page.waitForTimeout(1500)
    await shot(page, `${String(Number(n) + 1).padStart(2, '0')}-repeated-${label}`)
    const repeated = await page.locator('body').innerText()
    const bhujiaQty = `${3 * bhujiaCase} pcs`
    const bhujiaCases = `3 cs`
    check(
      `${label}: the repeated bhujia line reads the ${3 * bhujiaCase} pieces the shop was sent`,
      /Konkan Aloo Bhujia 400 g\n(3 cs|60 pcs)/.test(repeated) ||
        repeated.includes(`Konkan Aloo Bhujia 400 g\n${bhujiaCases}`) ||
        repeated.includes(`Konkan Aloo Bhujia 400 g\n${bhujiaQty}`),
      (repeated.match(/Konkan Aloo Bhujia 400 g\n[^\n]*/) ?? [''])[0].replace('\n', ' · '),
    )
    const priorTotal = sql(`select total_paise from sales_orders where id = '${prior.id}'`)
    check(
      `${label}: the screen's payable is the last order's total (${inr(priorTotal)})`,
      repeated.includes(inr(priorTotal)),
    )

    // Failure path: the first create never reaches the office.
    let aborted = false
    await page.route('**/sales/orders', async (route) => {
      if (!aborted && route.request().method() === 'POST') {
        aborted = true
        await route.abort('connectionrefused')
      } else await route.continue()
    })
    const place = page.getByTestId('place-order')
    await place.click()
    await page.waitForTimeout(2500)
    await shot(page, `${String(Number(n) + 2).padStart(2, '0')}-place-failed-${label}`)
    const failed = await page.locator('body').innerText()
    check(
      `${label}: a create that never arrived is not called placed, and the lines stay`,
      !failed.includes('Order placed') &&
        failed.includes('Konkan Aloo Bhujia 400 g') &&
        (await place.isEnabled()),
      (failed.match(/(Failed to fetch|network|signal|could not|couldn't)[^\n]*/i) ?? ['(no error line)'])[0],
    )

    // Place again, reading the wire.
    let sent = null
    let reply = null
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/sales\/orders$/.test(req.url())) sent = req.postDataJSON()
    })
    page.on('response', async (res) => {
      if (res.request().method() === 'POST' && /\/sales\/orders$/.test(res.url()))
        reply = await res.json().catch(() => null)
    })
    await place.click()
    await page.getByText('Order placed').first().waitFor({ timeout: 30000 })
    await page.waitForTimeout(1500)
    await shot(page, `${String(Number(n) + 3).padStart(2, '0')}-placed-${label}`)
    const sentBhujia = sent?.lines.find((l) => l.variantId === BHUJIA)
    const replyBhujia = reply?.item.lines.find((l) => l.variantId === BHUJIA)
    check(
      `${label}: the wire sends the pieces the screen priced`,
      sentBhujia !== undefined &&
        (sentBhujia.enteredUnit === 'piece'
          ? sentBhujia.enteredQty === 3 * bhujiaCase
          : sentBhujia.enteredQty * bhujiaCase === 3 * bhujiaCase),
      JSON.stringify(sentBhujia),
    )
    check(
      `${label}: the reply books ${3 * bhujiaCase} pc`,
      replyBhujia?.qtyPcs === 3 * bhujiaCase,
      `qtyPcs ${String(replyBhujia?.qtyPcs)}`,
    )
    const orderId = sent?.id
    const booked = sql(
      `select o.order_no || '|' || o.state || '|' || o.total_paise || '|' || string_agg(v.name || ' ' || l.qty_pcs || ' pc (' || l.entered_qty || ' ' || l.entered_unit || ')', '; ' order by l.line_no) from sales_orders o join sales_order_lines l on l.order_id = o.id join product_variants v on v.id = l.variant_id where o.id = '${orderId}' group by o.order_no, o.state, o.total_paise`,
    )
    const [orderNo, state, total, lines] = booked.split('|')
    const priorLines = sql(
      `select string_agg(v.name || ' ' || l.qty_pcs, '; ' order by v.name) from sales_order_lines l join product_variants v on v.id = l.variant_id where l.order_id = '${prior.id}'`,
    )
    const newLines = sql(
      `select string_agg(v.name || ' ' || l.qty_pcs, '; ' order by v.name) from sales_order_lines l join product_variants v on v.id = l.variant_id where l.order_id = '${orderId}'`,
    )
    check(`${label}: SQL ${orderNo} (${state}) books the same pieces as ${prior.orderNo}`, newLines === priorLines, lines)
    check(
      `${label}: SQL ${orderNo} total ${total} = the payable the screen showed (${inr(priorTotal)})`,
      total === priorTotal,
      `${total} vs ${priorTotal}`,
    )
    await page.getByText('Open the order').first().click().catch(() => {})
    await page.waitForTimeout(3000)
    await shot(page, `${String(Number(n) + 4).padStart(2, '0')}-order-page-${label}`)
    const orderPage = await page.locator('body').innerText()
    check(
      `${label}: the order page reads the booked bhujia pieces and total`,
      orderPage.includes('Konkan Aloo Bhujia 400 g') && orderPage.includes(inr(total)),
      (orderPage.match(/Konkan Aloo Bhujia 400 g[^\n]*\n[^\n]*/) ?? [''])[0].replace('\n', ' · '),
    )
    await ctx.close()
  }

  // The no-signal path: the repeat goes into the outbox, lands as a draft and submits itself.
  {
    const prior = await bookInnerOrder()
    const ctx = await browser.newContext({ viewport: PHONE })
    const page = await ctx.newPage()
    await page.goto(`${APP}/sign-in`)
    await page.waitForLoadState('networkidle')
    const welcome = page.getByText('Sign in', { exact: true })
    if ((await page.locator('input[type=password]').count()) === 0 && (await welcome.count()) > 0)
      await welcome.first().click()
    await page.locator('input[type=password]').waitFor({ timeout: 30000 })
    await page.locator('input[type=text]').first().fill('rahul.deshmukh')
    await page.locator('input[type=password]').fill(PASSWORD)
    await page.locator('input[type=password]').press('Enter')
    await page.waitForTimeout(3000)
    await page.goto(`${APP}/sales/orders/new?retailerId=${SHOP}`)
    const repeat = page.getByText(/^Repeat last order \(3\)$/)
    await repeat.waitFor({ timeout: 60000 })
    await repeat.click()
    await page.waitForTimeout(1500)
    const uploads = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/sync\/upload$/.test(req.url())) uploads.push(req.postDataJSON())
    })
    await ctx.setOffline(true)
    await page.waitForTimeout(2500)
    await shot(page, '21-repeated-offline-phone')
    await page.getByTestId('place-order').click()
    await page.waitForTimeout(2000)
    await shot(page, '22-queued-offline-phone')
    await ctx.setOffline(false)
    let orderId = ''
    for (let i = 0; i < 45 && orderId === ''; i++) {
      await page.waitForTimeout(2000)
      orderId = sql(
        `select id from sales_orders where retailer_id = '${SHOP}' and created_at > (select created_at from sales_orders where id = '${prior.id}') and order_no is not null order by created_at desc limit 1`,
      )
    }
    await page.waitForTimeout(1500)
    await shot(page, '23-queued-landed-phone')
    const ops = uploads.flatMap((u) => u.ops ?? u.operations ?? [])
    const upBhujia = ops.find((op) => op.table === 'sales_order_lines' && op.data?.variant_id === BHUJIA)
    check(
      'offline: the outbox carries the pieces the screen priced',
      upBhujia !== undefined &&
        piecesSent(upBhujia.data.entered_qty, upBhujia.data.entered_unit) === 3 * bhujiaCase,
      JSON.stringify(upBhujia?.data ?? uploads.slice(0, 1)).slice(0, 240),
    )
    const landed = orderId === '' ? '' : sql(
      `select o.order_no || ' ' || o.state || ' ' || o.total_paise || ' · bhujia ' || l.qty_pcs || ' pc (' || l.entered_qty || ' ' || l.entered_unit || ')' from sales_orders o join sales_order_lines l on l.order_id = o.id where o.id = '${orderId}' and l.variant_id = '${BHUJIA}'`,
    )
    const priorTotal = sql(`select total_paise from sales_orders where id = '${prior.id}'`)
    check(
      `offline: the landed order books ${3 * bhujiaCase} pc and the last order's total ${priorTotal} (SQL)`,
      landed.includes(` ${priorTotal} · bhujia ${3 * bhujiaCase} pc`),
      landed || '(no order landed)',
    )
    await ctx.close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks held`)
if (failed.length > 0) process.exit(1)
