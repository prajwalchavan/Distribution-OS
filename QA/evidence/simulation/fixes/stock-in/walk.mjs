// Stock-in lane walk (DOS-213, DOS-216, DOS-217) against the lane's own API :3471 and web :5471.
// node walk.mjs <scenario>   scenarios: bill | gate | gate-refused | gate-offline | post | phone
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const sqlClient = new pg.Client({ connectionString: 'postgres://dos:dos@127.0.0.1:5439/dos_test_stockin' })
await sqlClient.connect()
/** Read-only SQL snapshot, written beside the screenshots. */
async function sqlShot(name, text, params = []) {
  const r = await sqlClient.query(text, params)
  const out = `-- ${new Date().toISOString()}\n-- ${text}\n${JSON.stringify(r.rows, null, 1)}\n`
  writeFileSync(`${EV}${name}.txt`, out)
  console.log(`[sql] ${name}`, JSON.stringify(r.rows))
}

const WEB = 'http://localhost:5471'
const API = 'http://127.0.0.1:3471'
const EV =
  '/Users/prajwalchavan/Desktop/Distribution OS/.claude/worktrees/wf_be1f8178-550-2/QA/evidence/simulation/fixes/stock-in/'
const STATE = new URL('./walk-state.json', import.meta.url)
mkdirSync(EV, { recursive: true })
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1))

const SUPPLIER = 'e428e2c5-8fb1-7f24-a1ff-d22ab81f9830'
const GODOWN = '01a0999a-28e0-7224-8c93-c81b22069a0d'
const V = {
  masala: 'a47e1049-9e8a-76ad-b2cc-7ed974f4bf9d',
  salted: '30f38ab4-2bfa-7be9-90de-a3acb99f7f68',
  chataka: '1e08c003-4f1d-7b87-944a-6c885703abff',
}

// ------------------------------------------------------------------ API side (the other person's device)
async function token(username) {
  const r = await fetch(`${API}/auth/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'Dos@1234', deviceId: randomUUID() }),
  })
  const j = await r.json()
  if (!j.accessToken) throw new Error(`login ${username}: ${JSON.stringify(j)}`)
  return j.accessToken
}
async function api(tok, prefix, method, path, body) {
  const url = new URL(`${API}/${prefix}${path}`)
  const init = { method, headers: { authorization: `Bearer ${tok}` } }
  if (method === 'GET' && body) for (const [k, v] of Object.entries(body)) url.searchParams.set(k, String(v))
  else if (body) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const r = await fetch(url, init)
  const text = await r.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  console.log(`[wire] ${method} /${prefix}${path} -> ${r.status}`)
  return { status: r.status, body: json }
}
/** A one-line typed bill booked through the same procedure the screen calls, and its receipt opened. */
async function billAndReceipt(tok, no, lines) {
  const id = randomUUID()
  const body = {
    idempotencyKey: randomUUID(),
    id,
    supplierId: SUPPLIER,
    source: 'manual',
    invoiceNo: no,
    invoiceDate: '2026-09-26',
    placeOfSupplyState: '27',
    subtotalPaise: 0,
    cgstPaise: 0,
    sgstPaise: 0,
    roundOffPaise: 0,
    totalPaise: 0,
    lines: lines.map((l, i) => {
      const taxable = l.pcs * 1321
      const half = Math.round(taxable * 0.09)
      return {
        id: randomUUID(),
        lineNo: i + 1,
        description: l.name,
        variantId: l.variantId,
        hsnCode: '2106',
        batchNo: l.batch,
        expiryDate: '2027-03-11',
        mrpPaise: 2000,
        printedQty: l.pcs,
        printedUnit: 'pcs',
        qtyPcs: l.pcs,
        ratePaise: 1321,
        gstBps: 1800,
        taxablePaise: taxable,
        taxPaise: half * 2,
        lineTotalPaise: taxable + half * 2,
      }
    }),
  }
  body.subtotalPaise = body.lines.reduce((s, l) => s + l.taxablePaise, 0)
  body.cgstPaise = body.lines.reduce((s, l) => s + l.taxPaise / 2, 0)
  body.sgstPaise = body.cgstPaise
  body.totalPaise = body.lines.reduce((s, l) => s + l.lineTotalPaise, 0)
  const made = await api(tok, 'manager', 'POST', '/procurement/supplier-invoices', body)
  if (made.status !== 200) throw new Error(JSON.stringify(made.body))
  const grn = await api(tok, 'manager', 'POST', '/procurement/grns', {
    idempotencyKey: randomUUID(),
    id: randomUUID(),
    supplierInvoiceId: id,
    locationId: GODOWN,
  })
  if (grn.status !== 200) throw new Error(JSON.stringify(grn.body))
  return grn.body.item
}

// ------------------------------------------------------------------ browser side
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
const wire = []
page.on('response', (r) => {
  const u = r.url()
  if (u.startsWith(API) && r.request().method() !== 'OPTIONS' && !u.includes('/sync/'))
    wire.push(`${r.status()} ${r.request().method()} ${u.replace(API, '')}`)
})
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console error]', m.text().slice(0, 200))
})
const settle = async (ms = 1200) => {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(ms)
}
const shot = async (name) => {
  await settle(600)
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0
  })
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${EV}${name}.png`, fullPage: true })
  const text = await page.innerText('body').catch(() => '')
  writeFileSync(`${EV}${name}.txt`, text)
  console.log(`[shot] ${name}.png`)
}
const tid = (id) => page.getByTestId(id)
const phone = async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(900)
}
const desk = async () => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForTimeout(900)
}

async function signIn(username, roleLabel) {
  await page.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' })
  await settle(2000)
  if ((await tid('sign-in-username').count()) === 0)
    await page.getByText('Sign in', { exact: true }).first().click()
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 60000 })
  await tid('sign-in-username').fill(username)
  await tid('sign-in-password').fill('Dos@1234')
  await tid('sign-in-submit').click()
  await page.waitForTimeout(2500)
  const chooser = page.getByText('Continue as')
  if (await chooser.count()) {
    await page.getByText(roleLabel, { exact: true }).first().click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForTimeout(2500)
  }
  await settle()
  console.log('[signed in]', username, page.url())
}

async function pickSupplier() {
  await tid('bill-supplier-search').fill('Guru')
  await tid(`bill-supplier-${SUPPLIER}`).click()
}
async function addLine({ item, variantId, batch, expiry, unit, qty, basis, rate, free }) {
  await tid('bill-add-line').click()
  await tid('bill-item-search').fill(item)
  await tid(`bill-item-${variantId}`).click()
  if (batch !== undefined) await tid('bill-line-batch').fill(batch)
  if (expiry !== undefined) await tid('bill-line-expiry').fill(expiry)
  if (unit === 'pcs') await page.getByRole('radio', { name: 'In pieces' }).click()
  await tid('bill-line-qty').fill(qty)
  if (free) await tid('bill-line-free').fill(free)
  if (basis === 'piece') await page.getByRole('radio', { name: 'Rate per piece' }).click()
  await tid('bill-line-rate').fill(rate)
  await page.waitForTimeout(400)
}

const scenario = process.argv[2]
try {
  if (scenario === 'bill') {
    // DOS-213 at the desk, as the manager.
    await signIn('vikas.kadam', 'Manager')
    await page.goto(`${WEB}/manager/inbound`)
    await shot('213-01-desk-inbound-type-a-bill')
    await tid('type-bill').click()
    await settle()
    await shot('213-02-desk-empty-form-book-disabled')
    await pickSupplier()
    await tid('bill-no').fill('GUR/26-27/00701')
    // not a complete line: Keep says what is missing and keeps the sheet open
    await tid('bill-add-line').click()
    await tid('bill-line-keep').click()
    await shot('213-03-desk-line-not-complete')
    await page.getByText('Close', { exact: true }).last().click()
    await page.waitForTimeout(500)
    await addLine({
      item: 'Masala Masti',
      variantId: V.masala,
      batch: 'GK20260828',
      expiry: '11-03-2027',
      qty: '2',
      rate: '1188.90',
    })
    await shot('213-04-desk-line-sheet-cases-per-case-rate')
    await tid('bill-line-keep').click()
    await addLine({
      item: 'Simply Salted',
      variantId: V.salted,
      batch: 'GK20260901',
      expiry: '15-10-2026',
      unit: 'pcs',
      qty: '180',
      basis: 'piece',
      rate: '13.21',
      free: '6',
    })
    await tid('bill-line-keep').click()
    await addLine({
      item: 'Chataka',
      variantId: V.chataka,
      batch: 'GK20260815',
      expiry: '28-02-2027',
      qty: '1',
      rate: '1188.90',
    })
    await tid('bill-line-keep').click()
    await tid('bill-printed-total').fill('5000')
    await page.waitForTimeout(400)
    await shot('213-05-desk-printed-total-mismatch')
    await tid('bill-printed-total').fill('')
    await page.waitForTimeout(400)
    await shot('213-06-desk-bill-ready')
    await tid('bill-book').click()
    await page.waitForTimeout(600)
    await shot('213-07-desk-confirm-dialog')
    await tid('bill-dialog').getByRole('button', { name: 'Book the bill' }).click()
    await settle(2000)
    await shot('213-08-desk-booked-receipt-at-gate')
    // the same bill again: the server refuses it and the form keeps every figure
    await tid('bill-another').click()
    await settle()
    await pickSupplier()
    await tid('bill-no').fill('GUR/26-27/00701')
    await addLine({
      item: 'Masala Masti',
      variantId: V.masala,
      batch: 'GK20260828',
      expiry: '11-03-2027',
      qty: '2',
      rate: '1188.90',
    })
    await tid('bill-line-keep').click()
    await tid('bill-book').click()
    await tid('bill-dialog').getByRole('button', { name: 'Book the bill' }).click()
    await settle(1500)
    await shot('213-09-desk-duplicate-refused-input-kept')
    // phone width, same form
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await phone()
    await shot('213-10-phone-form-with-line')
    await tid('bill-add-line').click()
    await tid('bill-item-search').fill('Ratlami')
    await page.waitForTimeout(1500)
    await shot('213-11-phone-line-sheet')
  } else if (scenario === 'gate') {
    // DOS-216 on the gate phone: the review says "Not saved yet" until the 2xx, then "Saved".
    await signIn('dinesh.patil', 'Godown')
    await phone()
    await page.goto(`${WEB}/warehouse`)
    await settle(2000)
    await shot('216-01-phone-warehouse-home-receipt-waiting')
    const id = process.argv[3]
    await page.goto(`${WEB}/warehouse/inbound/${id}`)
    await settle(2000)
    const counts = (process.argv[4] ?? '').split(',').filter(Boolean)
    for (let i = 0; i < counts.length; i++) {
      for (const d of counts[i]) await page.getByRole('button', { name: d, exact: true }).click()
      await page.getByRole('button', { name: 'Damaged pieces' }).click()
      await page.waitForTimeout(300)
      await page.getByRole('button', { name: i + 1 < counts.length ? 'Next line' : 'Review the count' }).last().click()
      await page.waitForTimeout(400)
    }
    await shot('216-02-phone-review-before-save-not-saved-yet')
    console.log('[wire so far]', wire.filter((w) => w.includes('/count')).join(' | ') || 'no count call')
    await sqlShot(
      'sql-216-before-save',
      'select g.status, g.counted_at, l.counted_qty_pcs, l.damaged_qty_pcs from grns g join grn_lines l on l.grn_id = g.id where g.id = $1 order by l.id',
      [id],
    )
    await tid('w3-save').click()
    await settle(2000)
    await shot('216-03-phone-after-2xx-saved')
    await sqlShot(
      'sql-216-after-save',
      'select g.status, g.counted_at, l.counted_qty_pcs, l.damaged_qty_pcs from grns g join grn_lines l on l.grn_id = g.id where g.id = $1 order by l.id',
      [id],
    )
  } else if (scenario === 'gate-refused' || scenario === 'gate-offline') {
    const id = process.argv[3]
    const counts = (process.argv[4] ?? '').split(',').filter(Boolean)
    await signIn('dinesh.patil', 'Godown')
    await phone()
    await page.goto(`${WEB}/warehouse/inbound/${id}`)
    await settle(2000)
    for (let i = 0; i < counts.length; i++) {
      for (const d of counts[i]) await page.getByRole('button', { name: d, exact: true }).click()
      await page.getByRole('button', { name: 'Damaged pieces' }).click()
      await page.waitForTimeout(300)
      await page.getByRole('button', { name: i + 1 < counts.length ? 'Next line' : 'Review the count' }).last().click()
      await page.waitForTimeout(400)
    }
    if (scenario === 'gate-refused') {
      // Meanwhile the desk counts and posts the same receipt from its own device.
      const tok = await token('vikas.kadam')
      const g = await api(tok, 'manager', 'GET', `/procurement/grns/${id}`)
      await api(tok, 'manager', 'POST', `/procurement/grns/${id}/count`, {
        idempotencyKey: randomUUID(),
        lines: g.body.item.lines.map((l) => ({ grnLineId: l.id, countedQtyPcs: l.expectedQtyPcs })),
      })
      await api(tok, 'manager', 'POST', `/procurement/grns/${id}/post`, { idempotencyKey: randomUUID() })
      await tid('w3-save').click()
      await settle(1500)
      await shot('216-04-phone-save-refused-figures-kept')
    } else {
      await ctx.setOffline(true)
      await tid('w3-save').click()
      await page.waitForTimeout(3000)
      await shot('216-05-phone-save-offline-figures-kept')
      await ctx.setOffline(false)
      await page.waitForTimeout(1000)
      await tid('w3-save').click()
      await settle(2000)
      await shot('216-06-phone-back-online-saved')
    }
  } else if (scenario === 'post') {
    // DOS-217 at the desk: Today says what waits; a counted receipt posts; a partly counted one says why not.
    await signIn('vikas.kadam', 'Manager')
    await page.goto(`${WEB}/manager`)
    await settle(2500)
    await shot('217-01-desk-today-receipts-to-post')
    await page.goto(`${WEB}/manager/inbound?view=receipts`)
    await settle(2000)
    const which = process.argv[3]
    const partly = process.argv[4]
    const fresh = process.argv[5]
    if (partly) {
      await page.getByTestId('grn-register').getByText(partly, { exact: false }).first().click()
      await settle(1500)
      await shot('217-02-desk-partly-counted-says-what-is-missing')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
    if (fresh) {
      await page.getByTestId('grn-register').getByText(fresh, { exact: false }).first().click()
      await settle(1500)
      await shot('217-03-desk-not-counted-yet')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
    await page.getByTestId('grn-register').getByText(which, { exact: false }).first().click()
    await settle(1500)
    await shot('217-04-desk-counted-receipt-post-enabled')
    await tid('post-grn').click()
    await page.waitForTimeout(600)
    await shot('217-05-desk-post-dialog')
    await tid('inbound-dialog').getByRole('button', { name: 'Post the receipt' }).click()
    await settle(2000)
    await shot('217-06-desk-posted-as-grn')
    await sqlShot(
      'sql-217-after-post',
      `select g.status, g.grn_no, g.posted_at, si.status as bill_status,
         (select count(*) from grn_lines l where l.grn_id = g.id and l.lot_id is not null) as lines_with_lot,
         (select count(*) from stock_ledger s where s.ref_id = g.id and s.reason = 'grn') as ledger_rows,
         (select coalesce(sum(s.qty_delta), 0) from stock_ledger s where s.ref_id = g.id and s.reason = 'grn') as pieces_in,
         (select count(*) from tenant_product_costs c where c.lot_id in (select lot_id from grn_lines where grn_id = g.id)) as cost_rows
       from grns g join supplier_invoices si on si.id = g.supplier_invoice_id where g.supplier_invoice_no = $1`,
      [which.replace('Against bill ', '')],
    )
    await sqlShot(
      'sql-217-lots-and-costs',
      `select v.name, sl.batch_no, sl.expiry_date, c.purchase_rate_paise, c.landed_cost_paise
       from grn_lines l join grns g on g.id = l.grn_id join stock_lots sl on sl.id = l.lot_id
       join product_variants v on v.id = l.variant_id left join tenant_product_costs c on c.lot_id = l.lot_id
       where g.supplier_invoice_no = $1 order by v.name`,
      [which.replace('Against bill ', '')],
    )
    await phone()
    await shot('217-07-phone-posted-receipt-panel')
  } else if (scenario === 'setup') {
    const tok = await token('vikas.kadam')
    const mk = async (no, lines) => (await billAndReceipt(tok, no, lines)).id
    state.refused = await mk(`GUR/26-27/R${process.argv[3]}`, [{ name: 'Masala Masti', variantId: V.masala, pcs: 90, batch: 'R1' }])
    state.offline = await mk(`GUR/26-27/O${process.argv[3]}`, [{ name: 'Simply Salted', variantId: V.salted, pcs: 180, batch: 'O1' }])
    state.partly = await mk(`GUR/26-27/P${process.argv[3]}`, [
      { name: 'Masala Masti', variantId: V.masala, pcs: 90, batch: 'P1' },
      { name: 'Chataka', variantId: V.chataka, pcs: 90, batch: 'P2' },
    ])
    state.fresh = await mk(`GUR/26-27/F${process.argv[3]}`, [{ name: 'Chataka', variantId: V.chataka, pcs: 90, batch: 'F1' }])
    // the gate counts ONE of the two lines of 00604
    const wtok = await token('dinesh.patil')
    const g = await api(wtok, 'warehouse', 'GET', `/procurement/grns/${state.partly}`)
    await api(wtok, 'warehouse', 'POST', `/procurement/grns/${state.partly}/count`, {
      idempotencyKey: randomUUID(),
      lines: [{ grnLineId: g.body.item.lines[0].id, countedQtyPcs: 90 }],
    })
    save()
    console.log(state)
  } else if (scenario === 'grns') {
    const tok = await token('vikas.kadam')
    const r = await api(tok, 'manager', 'GET', '/procurement/grns', { limit: 10 })
    for (const g of r.body.items)
      console.log(g.id, g.status, g.supplierInvoiceNo, g.lineCount, g.grnNo)
  }
} finally {
  if (wire.length) console.log('[wire]\n  ' + wire.filter((w) => !w.includes('GET')).join('\n  '))
  await browser.close()
  await sqlClient.end()
}
