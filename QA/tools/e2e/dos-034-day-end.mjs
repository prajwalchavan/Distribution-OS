// DOS-034: Day-end lists only cash and cheques, keeps Bank this batch in view after ticking a row below the fold, and the
// receipt panel offers Bank it and Mark bounced.
//
// A characterisation check of the manager web app (Money → Day-end, Money → Receipts) at desk width, signed in as
// vikas.kadam. RED on the build before the DOS-034 fix, GREEN after. Read-only: it ticks one register row (screen state
// only) and opens receipt panels; it never banks, bounces or confirms anything. Its only write is its own sign-in session.
//
// Needs auth-service :3000, manager-service :3002 and the manager app's web build on :5174, all on a COPY of the seeded
// data (QA/STATE.md), and `psql` to that same database: receipts are picked by id because RCPT numbers repeat (DOS-032/059).
//   cd QA/tools && DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/<copy> node e2e/dos-034-day-end.mjs
// It uses the shared Chromium of pw-server.mjs (CDP :9333) in a context of its own when that is up, else launches one.
// Exit 0 = every assertion held · 1 = the failed ones are listed · 2 = a precondition (services or data) is missing.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const NAME =
  'DOS-034: Day-end lists only cash and cheques, keeps Bank this batch in view after ticking a row below the fold, and the receipt panel offers Bank it and Mark bounced'
const APP = process.env.MANAGER_URL ?? 'http://localhost:5174'
const USER = process.env.DOS_USER ?? 'vikas.kadam'
const PASSWORD = process.env.DOS_PASSWORD ?? 'Dos@1234'
const DB = process.env.DATABASE_URL ?? 'postgres://dos:dos@127.0.0.1:5439/dos_qa'
const TENANT = process.env.DOS_TENANT_SLUG ?? 'tarsun'
const PSQL = existsSync('/opt/homebrew/opt/postgresql@17/bin/psql') ? '/opt/homebrew/opt/postgresql@17/bin/psql' : 'psql'
const EV = fileURLToPath(new URL(`../../evidence/${process.env.EV_DIR ?? 'batch1/dos-034'}/`, import.meta.url))
const VIEWPORT = { width: 1280, height: 800 }

class Precondition extends Error {}
const results = []
function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  (${detail})`}`)
}
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function sql(query) {
  const out = execFileSync(PSQL, [DB, '-X', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' })
  return out.trim().split('\n').filter(Boolean).map((line) => line.split('|'))
}

/** Newest receipts of one mode and state whose RCPT number is unique in the tenant, with their age in IST days. */
function candidates(mode, status, officeOnly) {
  return sql(`
    select r.id, r.receipt_no,
           (now() at time zone 'Asia/Kolkata')::date - (r.received_at at time zone 'Asia/Kolkata')::date
      from receipts r join tenants t on t.id = r.tenant_id
     where t.slug = '${TENANT}' and r.mode = '${mode}' and r.status = '${status}' and r.amount_paise > 0
       ${officeOnly ? 'and r.trip_id is null' : ''}
       and r.receipt_no is not null
       and (select count(*) from receipts x where x.tenant_id = r.tenant_id and x.receipt_no = r.receipt_no) = 1
     order by r.received_at desc
     limit 10`).map(([id, no, age]) => ({ id, no, age: Number(age) }))
}

/** The narrowest range segment of the Receipts screen whose 200-row page is most likely to hold the receipt. */
const rangeFor = (age) => (age <= 6 ? '7 days' : age <= 29 ? '30 days' : age <= 89 ? '90 days' : 'This FY')

async function signIn(page) {
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 120000 })
  await page.fill('[data-testid=sign-in-username]', USER)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  await page.click('[data-testid=sign-in-submit]')
  for (let i = 0; i < 60 && page.url().includes('sign-in'); i++) await page.waitForTimeout(500)
  if (page.url().includes('sign-in')) throw new Precondition(`could not sign in as ${USER} on ${APP}`)
}

async function dayEnd(page) {
  await page.goto(`${APP}/money/day-end`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const rows = page.locator('[data-testid=tobank-register] tbody tr')
  await rows.first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {})
  const count = await rows.count()
  if (count < 20) throw new Precondition(`the Day-end register shows ${count} rows; the check needs at least 20`)

  // (1) only money a desk can carry to the bank
  const modes = await page.evaluate(() => {
    const table = document.querySelector('[data-testid=tobank-register] table')
    if (!table) return null
    const at = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()).indexOf('Mode')
    if (at < 0) return null
    return [...table.querySelectorAll('tbody tr')].map((tr) => (tr.children[at]?.textContent ?? '').trim())
  })
  if (modes === null) throw new Precondition('the Day-end register has no Mode column at desk width')
  const others = [...new Set(modes.filter((mode) => !/^(cash|cheque)$/i.test(mode)))]
  check(
    'Day-end: every Mode cell of the register is Cash or Cheque',
    others.length === 0,
    others.length === 0 ? `${modes.length} rows` : `also lists ${others.join(', ')}`,
  )

  // (3) the cheques (and the trips, whose settlement form opens under them) come before a register of 200+ rows
  const order = await page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid=${id}]`)
    const register = q('tobank-register')
    const follows = (el) =>
      el === null || register === null ? null : Boolean(el.compareDocumentPosition(register) & Node.DOCUMENT_POSITION_FOLLOWING)
    return { cheques: follows(q('dayend-cheques')), trips: follows(q('dayend-trips')) }
  })
  check('Day-end: Cheques in hand precede the register', order.cheques === true, `cheques before register: ${order.cheques}`)
  check('Day-end: Trips coming back precede the register', order.trips === true, `trips before register: ${order.trips}`)

  // (2) tick the 20th row with it scrolled to the middle of the screen; the batch action must be on screen
  const row = rows.nth(19)
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await row.click()
  const bar = page.locator('[data-testid=bank-batch]')
  await bar.first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
  const box = (await bar.count()) > 0 ? await bar.first().boundingBox() : null
  const inView =
    box !== null &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= VIEWPORT.width &&
    box.y + box.height <= VIEWPORT.height
  check(
    'Day-end: Bank this batch is inside the viewport after ticking the 20th row',
    inView,
    box === null ? 'no bank-batch control' : `top ${Math.round(box.y)}px, bottom ${Math.round(box.y + box.height)}px of ${VIEWPORT.height}px`,
  )
  await page.screenshot({ path: `${EV}day-end-20th-row-ticked.png` }).catch(() => {})
}

/** Opens the receipt panel for the first candidate found on the Receipts register, by its unique RCPT number. */
async function openReceipt(page, list, what) {
  for (const receipt of list) {
    await page.goto(`${APP}/money`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.locator('[data-testid=receipts-register]').waitFor({ state: 'visible', timeout: 60000 })
    await page.getByRole('radio', { name: rangeFor(receipt.age), exact: true }).click()
    const row = page
      .locator('[data-testid=receipts-register] tbody tr')
      .filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^\\s*${escapeRe(receipt.no)}\\s*$`) }) })
    await row.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    if ((await row.count()) !== 1) continue
    await row.first().click()
    const panel = page.locator('.dos-backdrop[data-testid=receipt-panel]')
    await panel.locator('[data-testid=receipt-print]').waitFor({ state: 'visible', timeout: 30000 })
    return { panel, receipt }
  }
  throw new Precondition(`no ${what} with a unique receipt number is on the Receipts register (${list.length} candidates)`)
}

async function receiptPanel(page) {
  // (4a) a cheque already banked: the bank can still return it
  const cheque = await openReceipt(page, candidates('cheque', 'deposited', false), 'deposited cheque')
  const tag = `${cheque.receipt.no} ${cheque.receipt.id}`
  const bounce = cheque.panel.locator('[data-testid=receipt-bounce]')
  const bankIt = cheque.panel.locator('[data-testid=receipt-deposit]')
  check(
    `Receipts: a deposited cheque (${tag}) offers Mark bounced, enabled`,
    (await bounce.count()) === 1 && (await bounce.isEnabled()),
    `receipt-bounce ×${await bounce.count()}`,
  )
  check(
    `Receipts: a deposited cheque (${tag}) shows Bank it disabled`,
    (await bankIt.count()) === 1 && (await bankIt.isDisabled()),
    `receipt-deposit ×${await bankIt.count()}`,
  )
  await page.screenshot({ path: `${EV}receipt-panel-deposited-cheque.png` }).catch(() => {})

  // (4b) office cash still in hand
  const cash = await openReceipt(page, candidates('cash', 'collected', true), 'collected office cash receipt')
  const cashBankIt = cash.panel.locator('[data-testid=receipt-deposit]')
  check(
    `Receipts: a collected office cash receipt (${cash.receipt.no} ${cash.receipt.id}) offers Bank it, enabled`,
    (await cashBankIt.count()) === 1 && (await cashBankIt.isEnabled()),
    `receipt-deposit ×${await cashBankIt.count()}`,
  )
  await page.screenshot({ path: `${EV}receipt-panel-office-cash.png` }).catch(() => {})
}

mkdirSync(EV, { recursive: true })
console.log(NAME)
let browser
let shared = true
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 5000 })
} catch {
  shared = false
  browser = await chromium.launch({ headless: true })
}
console.log(shared ? '[browser] shared pw-server Chromium, private context' : '[browser] private headless Chromium')

let exit = 0
const context = await browser.newContext({ viewport: VIEWPORT })
try {
  const page = await context.newPage()
  await signIn(page)
  await dayEnd(page)
  await receiptPanel(page)
  exit = results.every((result) => result.ok) ? 0 : 1
} catch (error) {
  if (error instanceof Precondition) {
    console.log(`PRECONDITION  ${error.message}`)
    exit = 2
  } else {
    console.log(`ERROR  ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    exit = 1
  }
} finally {
  await context.close().catch(() => {})
  // on a CDP connection this only disconnects; the shared browser keeps running
  await browser.close().catch(() => {})
}

const failed = results.filter((result) => !result.ok).length
console.log(
  exit === 0
    ? `GREEN  ${results.length} assertions held`
    : exit === 2
      ? 'NOT RUN  a precondition is missing'
      : `RED  ${failed} of ${results.length} assertions failed${results.length === 0 ? ' (stopped by an error)' : ''}`,
)
process.exit(exit)
