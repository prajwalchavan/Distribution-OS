// DOS-029: a refused manager write keeps its dialog or panel open and shows the service's own sentence where the person
// pressed; a lost connection says so, without promising to send later.
//
// End-to-end reproduction of the finding's three steps on the manager web app at desk width (1280x800), signed in as
// vikas.kadam. RED on the build before the DOS-029 fix (the wave and document dialogs close, the credit-note refusal is
// not where the person pressed), GREEN after.
//
// IT WRITES. Step 1 drafts one credit note on INV/0634 from a first desk (a draft only: no ledger, stock or journal row)
// so that the same draft from a second desk is refused, then cancels that draft. Run it ONLY against a copy of
// dos_batch1_template, with auth-service :3000, manager-service :3002 and the manager app's web build on :5174 all on
// that copy (QA/STATE.md); it refuses dos, dos_qa and the template itself:
//   createdb -h 127.0.0.1 -p 5439 -U dos -T dos_batch1_template dos_qa_029
//   cd QA/tools && DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_qa_029 node e2e/dos-029-manager-refusals.mjs
// It uses the shared Chromium of pw-server.mjs (CDP :9333) in contexts of its own when that is up, else launches one.
// Exit 0 = every assertion held · 1 = the failed ones are listed · 2 = a precondition (services or data) is missing.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const TESTS = [
  'DOS-029 manager refusals stay on screen: credit note 400, wave 409, brand-DMS approve 501',
  'DOS-029 a lost connection on a manager write keeps the dialog open and does not promise to send later',
]
const APP = process.env.MANAGER_URL ?? 'http://localhost:5174'
const USER = process.env.DOS_USER ?? 'vikas.kadam'
const PASSWORD = process.env.DOS_PASSWORD ?? 'Dos@1234'
const DB = process.env.DATABASE_URL ?? ''
const TENANT = process.env.DOS_TENANT_SLUG ?? 'tarsun'
const PSQL = existsSync('/opt/homebrew/opt/postgresql@17/bin/psql') ? '/opt/homebrew/opt/postgresql@17/bin/psql' : 'psql'
const EV = fileURLToPath(new URL(`../../evidence/${process.env.EV_DIR ?? 'batch1/dos-029'}/`, import.meta.url))
const VIEWPORT = { width: 1280, height: 800 }

// The finding's rows (dos_qa, re-checked 2026-09-12; the template carries the same seed).
const BILL = 'INV/0634'
const BILL_LINE = 'Sunbake Glucose 55 g'
const PACKED_ORDER = 'SO-0850'
const OTHER_PACKED_ORDER = 'SO-0845'
const DOCUMENT_ID = '0400aea1-7e63-7119-af27-05db2a4307ad'
const DOCUMENT_NO = 'FA/TY/26-27/1187'

// The services' own sentences (billing/credit-notes.service.ts, warehouse/picklists.service.ts, docint/documents.service.ts).
const creditSentence = (description) => `only 0 pcs of ${description} are left to credit on ${BILL}`
const WAVE_SENTENCE = `only a confirmed order can be waved; ${PACKED_ORDER} is packed`
const BRAND_DMS_SENTENCE =
  'a brand-DMS bill is committed through billing.invoices.importBrandDms (never a second legal invoice); docint keeps it reviewed'
// manager-app/src/strings.ts app.writeNoConnection, and the client default it replaces.
const NO_CONNECTION = 'No connection. Check the signal, then press again.'
const FALSE_PROMISE = 'This will send when the signal is back'

class Precondition extends Error {}
const results = []
const preconditions = []
function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined || detail === '' ? '' : `  (${detail})`}`)
}
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A row that carries this number and not a longer one (SO-0850, not SO-08501). */
const exactly = (no) => new RegExp(`${escapeRe(no)}(?!\\d)`)

function sql(query) {
  const out = execFileSync(PSQL, [DB, '-X', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' })
  return out.trim().split('\n').filter(Boolean).map((line) => line.split('|'))
}
const one = (query) => sql(query)[0] ?? []
const quote = (text) => `'${String(text).replace(/'/g, "''")}'`

async function signIn(page) {
  await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('[data-testid=sign-in-username]', { timeout: 120000 })
  await page.fill('[data-testid=sign-in-username]', USER)
  await page.fill('[data-testid=sign-in-password]', PASSWORD)
  await page.click('[data-testid=sign-in-submit]')
  for (let i = 0; i < 60 && page.url().includes('sign-in'); i++) await page.waitForTimeout(500)
  if (page.url().includes('sign-in')) throw new Precondition(`could not sign in as ${USER} on ${APP}`)
}

/** What the page must never show while a refusal is on screen: an unhandled ApiError. */
function watch(page) {
  const uncaught = []
  page.on('console', (message) => {
    if (/Uncaught \(in promise\)/i.test(message.text())) uncaught.push(message.text())
  })
  page.on('pageerror', (error) => {
    if (error?.name === 'ApiError' || /Uncaught \(in promise\)/i.test(String(error?.message))) uncaught.push(String(error?.message))
  })
  return uncaught
}

async function inView(locator) {
  const box = await locator.boundingBox().catch(() => null)
  return (
    box !== null &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= VIEWPORT.width &&
    box.y + box.height <= VIEWPORT.height
  )
}

/** Presses a button and waits for the POST it sends; then gives the refusal line up to 5 s to render. */
async function press(page, button, urlPart, refusalTestId) {
  const [response] = await Promise.all([
    page
      .waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(urlPart), { timeout: 30000 })
      .catch(() => null),
    button.click(),
  ])
  await page
    .locator(`[data-testid=${refusalTestId}]`)
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .catch(() => {})
  return response
}

/** The finding's Expected, asserted after every refused press. */
async function refusalOnScreen(page, { what, surface, refusalTestId, sentence, status, response, uncaught, mark }) {
  check(
    `${what}: the service answered ${status}`,
    response !== null && response.status() === status,
    response === null ? 'no POST seen' : `HTTP ${response.status()}`,
  )
  check(`${what}: the surface is still open`, (await surface.count()) === 1 && (await surface.first().isVisible()))
  const line = page.locator(`[data-testid=${refusalTestId}]`)
  const text = (await line.count()) > 0 ? ((await line.first().textContent()) ?? '') : ''
  check(
    `${what}: [data-testid=${refusalTestId}] holds the service's sentence`,
    text.includes(sentence),
    text === '' ? 'no refusal line' : `"${text}"`,
  )
  check(`${what}: the refusal line is inside the viewport`, (await line.count()) > 0 && (await inView(line.first())))
  check(`${what}: no #error-overlay blocks the page`, (await page.locator('#error-overlay').count()) === 0)
  const fresh = uncaught.slice(mark)
  check(`${what}: no "Uncaught (in promise)" in the console`, fresh.length === 0, fresh.join(' | '))
}

// --- Step 1: credit note, 400 ---------------------------------------------------------------------------------------

async function openDraftPanel(page, lineId) {
  await page.goto(`${APP}/billing/credit-notes`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.locator('[data-testid=draft-note]').click({ timeout: 60000 })
  const panel = page.locator('.dos-backdrop[data-testid=draft-note-panel]')
  await panel.waitFor({ state: 'visible', timeout: 30000 })
  await pickBill(panel, BILL)
  await panel.locator(`[data-testid=return-${lineId}]`).waitFor({ state: 'visible', timeout: 30000 })
  return panel
}

async function pickBill(panel, no) {
  await panel.locator('[data-testid=note-bill-search]').fill(no)
  const hit = panel.getByRole('button', { name: exactly(no) })
  await hit.first().waitFor({ state: 'visible', timeout: 30000 })
  await hit.first().click()
}

async function creditNote(browser) {
  const [invoiceId] = one(
    `select i.id from invoices i join tenants t on t.id = i.tenant_id where t.slug = ${quote(TENANT)} and i.invoice_no = ${quote(BILL)}`,
  )
  if (invoiceId === undefined) throw new Precondition(`${BILL} is not a bill of ${TENANT}`)
  const [lineId, description, open] = one(
    `select id, description, qty_pcs + free_qty_pcs from invoice_lines where invoice_id = ${quote(invoiceId)} and description like ${quote(`${BILL_LINE}%`)} order by line_no limit 1`,
  )
  if (lineId === undefined) throw new Precondition(`${BILL} has no "${BILL_LINE}" line`)
  const live = Number(one(`select count(*) from credit_notes where invoice_id = ${quote(invoiceId)} and state <> 'cancelled'`)[0])
  if (live !== 0) throw new Precondition(`${BILL} already carries ${live} live credit note(s); use a fresh template copy`)
  const other = one(
    `select i.invoice_no from invoices i join tenants t on t.id = i.tenant_id where t.slug = ${quote(TENANT)} and i.invoice_no is not null and i.invoice_no <> ${quote(BILL)} order by i.invoice_no desc limit 1`,
  )[0]

  // Two desks, each with its own sign-in: both read the line as fully open, the first one drafts it.
  const deskA = await browser.newContext({ viewport: VIEWPORT })
  const deskB = await browser.newContext({ viewport: VIEWPORT })
  let draftId = null
  try {
    const pageA = await deskA.newPage()
    const pageB = await deskB.newPage()
    const uncaught = watch(pageB)
    await signIn(pageA)
    await signIn(pageB)
    const panelA = await openDraftPanel(pageA, lineId)
    const panelB = await openDraftPanel(pageB, lineId)

    await panelA.locator(`[data-testid=return-${lineId}]`).fill(String(open))
    const drafted = await press(pageA, panelA.locator('[data-testid=note-create]'), '/credit-notes', 'note-refusal')
    if (drafted === null || drafted.status() >= 300)
      throw new Precondition(`desk A could not draft ${open} pc on ${BILL} (${drafted === null ? 'no POST' : `HTTP ${drafted.status()}`})`)
    draftId = (await drafted.json().catch(() => null))?.item?.id ?? null

    const mark = uncaught.length
    await panelB.locator(`[data-testid=return-${lineId}]`).fill(String(open))
    const refused = await press(pageB, panelB.locator('[data-testid=note-create]'), '/credit-notes', 'note-refusal')
    await refusalOnScreen(pageB, {
      what: `Credit note on ${BILL}`,
      surface: pageB.locator('.dos-backdrop[data-testid=draft-note-panel]'),
      refusalTestId: 'note-refusal',
      sentence: creditSentence(description),
      status: 400,
      response: refused,
      uncaught,
      mark,
    })
    const lineBox = await pageB.locator('[data-testid=note-refusal]').first().boundingBox().catch(() => null)
    const buttonBox = await panelB.locator('[data-testid=note-create]').boundingBox().catch(() => null)
    check(
      `Credit note on ${BILL}: the refusal sits directly above the button it answers`,
      lineBox !== null && buttonBox !== null && lineBox.y + lineBox.height <= buttonBox.y + 1,
    )
    await pageB.screenshot({ path: `${EV}credit-note-400.png` }).catch(() => {})
    const notes = Number(one(`select count(*) from credit_notes where invoice_id = ${quote(invoiceId)} and state <> 'cancelled'`)[0])
    check(`Credit note on ${BILL}: the refused draft wrote nothing (one live note, desk A's)`, notes === 1, `${notes} live`)

    if (other !== undefined) {
      await pickBill(panelB, other)
      await pageB.waitForTimeout(1000)
      check(
        `Credit note: picking ${other} in the same panel hides the ${BILL} refusal`,
        (await pageB.locator('[data-testid=note-refusal]').count()) === 0,
      )
    }

    // Leave the copy as it was: cancel desk A's draft through its own panel.
    await cancelDraft(pageA, draftId)
  } finally {
    await deskA.close().catch(() => {})
    await deskB.close().catch(() => {})
  }
}

async function cancelDraft(page, draftId) {
  try {
    await page.goto(`${APP}/billing/credit-notes`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const row = page
      .locator('[data-testid=credit-notes-register] tbody tr')
      .filter({ hasText: exactly(BILL) })
      .filter({ hasText: /draft/i })
    await row.first().waitFor({ state: 'visible', timeout: 30000 })
    await row.first().click()
    const panel = page.locator('.dos-backdrop[data-testid=credit-note-panel]')
    await panel.locator('[data-testid=note-cancel]').click({ timeout: 30000 })
    const dialog = page.locator('.dos-backdrop[data-testid=note-dialog]')
    await dialog.locator('[data-testid=note-reason-text]').fill('DOS-029 check: second desk race, draft withdrawn')
    await press(page, dialog.locator('button').last(), '/cancel', 'note-dialog-refusal')
    const left = draftId === null ? null : one(`select state from credit_notes where id = ${quote(draftId)}`)[0]
    console.log(`[cleanup] desk A's draft ${draftId ?? '(id unknown)'} is ${left ?? 'unknown'}`)
  } catch (error) {
    console.log(`[cleanup] WARN could not cancel desk A's draft on ${BILL} (${draftId ?? 'id unknown'}): ${error instanceof Error ? error.message : String(error)}`)
  }
}

// --- Step 2: picking sheet for a packed order, 409 ------------------------------------------------------------------

async function queueRow(page, orderNo) {
  const row = page.locator('[data-testid=fulfil-queue-register] tbody tr').filter({ hasText: exactly(orderNo) })
  await row.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  return row
}

async function wave(page, uncaught) {
  const state = one(
    `select so.state from sales_orders so join tenants t on t.id = so.tenant_id where t.slug = ${quote(TENANT)} and so.order_no = ${quote(PACKED_ORDER)}`,
  )[0]
  if (state !== 'packed') throw new Precondition(`${PACKED_ORDER} is ${state ?? 'missing'}, not packed`)
  const sheets = () =>
    Number(one(`select count(*) from picklists p join tenants t on t.id = p.tenant_id where t.slug = ${quote(TENANT)}`)[0])
  const before = sheets()

  await page.goto(`${APP}/fulfilment`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.locator('[data-testid=fulfil-queue-register]').waitFor({ state: 'visible', timeout: 60000 })
  const row = await queueRow(page, PACKED_ORDER)
  if ((await row.count()) === 0)
    throw new Precondition(`${PACKED_ORDER} is not on the fulfilment queue, so the 409 cannot be provoked from the screen (DOS-024)`)
  await row.first().click()
  await page.locator('[data-testid=make-wave]').click({ timeout: 10000 })
  const dialog = page.locator('.dos-backdrop[data-testid=wave-dialog]')
  await dialog.waitFor({ state: 'visible', timeout: 10000 })

  const mark = uncaught.length
  const response = await press(page, dialog.locator('button').last(), '/warehouse/picklists', 'wave-refusal')
  await refusalOnScreen(page, {
    what: `Picking sheet for ${PACKED_ORDER}`,
    surface: dialog,
    refusalTestId: 'wave-refusal',
    sentence: WAVE_SENTENCE,
    status: 409,
    response,
    uncaught,
    mark,
  })
  check(`Picking sheet for ${PACKED_ORDER}: no picking sheet was written`, sheets() === before)
  await page.screenshot({ path: `${EV}wave-409.png` }).catch(() => {})

  // Cancel, then reopen for the other packed order: nothing from the last opening.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await dialog.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  check('Picking sheet: Cancel closes the dialog', (await dialog.count()) === 0)
  await row.first().click()
  const other = await queueRow(page, OTHER_PACKED_ORDER)
  if ((await other.count()) > 0) await other.first().click()
  else await row.first().click()
  await page.locator('[data-testid=make-wave]').click({ timeout: 10000 })
  await dialog.waitFor({ state: 'visible', timeout: 10000 })
  check(
    'Picking sheet: reopened, the dialog shows no refusal from the last opening',
    (await page.locator('[data-testid=wave-refusal]').count()) === 0,
  )
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await dialog.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  await (((await other.count()) > 0 ? other : row).first()).click()
}

// --- Step 3: brand-DMS bill booked as a supplier bill, 501 ----------------------------------------------------------

async function brandDms(page, uncaught) {
  const read = () => one(`select kind, status, coalesce(committed_entity_id::text, '') from documents where id = ${quote(DOCUMENT_ID)}`)
  const [kind, status, committed] = read()
  if (kind !== 'brand_dms_invoice' || status !== 'needs_review' || committed !== '')
    throw new Precondition(`document ${DOCUMENT_ID} is ${kind ?? 'missing'} / ${status ?? '-'} / ${committed || 'null'}, not brand_dms_invoice / needs_review / null`)

  await page.goto(`${APP}/inbound/documents`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const row = page.locator('[data-testid=docint-register] tbody tr').filter({ hasText: DOCUMENT_NO })
  await row.first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {})
  if ((await row.count()) === 0) throw new Precondition(`${DOCUMENT_NO} is not on the documents register`)
  await row.first().click()
  const panel = page.locator('.dos-backdrop[data-testid=docint-panel]')
  const approve = panel.locator('[data-testid=docint-approve]')
  await approve.waitFor({ state: 'visible', timeout: 60000 })
  for (let i = 0; i < 40 && !(await approve.isEnabled()); i++) await page.waitForTimeout(500)
  await approve.click()
  const dialog = page.locator('.dos-backdrop[data-testid=docint-dialog]')
  await dialog.waitFor({ state: 'visible', timeout: 10000 })

  const mark = uncaught.length
  const response = await press(page, dialog.locator('button').last(), '/approve', 'docint-refusal')
  await refusalOnScreen(page, {
    what: `Book ${DOCUMENT_NO} as a supplier bill`,
    surface: dialog,
    refusalTestId: 'docint-refusal',
    sentence: BRAND_DMS_SENTENCE,
    status: 501,
    response,
    uncaught,
    mark,
  })
  const [, statusAfter, committedAfter] = read()
  check(
    `Book ${DOCUMENT_NO}: the document is still needs_review with nothing committed`,
    statusAfter === 'needs_review' && committedAfter === '',
    `${statusAfter} / ${committedAfter || 'null'}`,
  )
  await page.screenshot({ path: `${EV}brand-dms-501.png` }).catch(() => {})
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => {})
}

// --- A lost connection ------------------------------------------------------------------------------------------------

async function lostConnection(page, uncaught) {
  await page.goto(`${APP}/fulfilment`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const rows = page.locator('[data-testid=fulfil-queue-register] tbody tr')
  await rows.first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => {})
  if ((await rows.count()) === 0) throw new Precondition('the fulfilment queue is empty')
  // The POST never leaves the browser, so nothing is written whichever order is ticked.
  const abort = (route) => (route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue())
  const matches = (url) => url.pathname.endsWith('/warehouse/picklists')
  await page.route(matches, abort)
  try {
    await rows.first().click()
    await page.locator('[data-testid=make-wave]').click({ timeout: 10000 })
    const dialog = page.locator('.dos-backdrop[data-testid=wave-dialog]')
    await dialog.waitFor({ state: 'visible', timeout: 10000 })
    const mark = uncaught.length
    await dialog.locator('button').last().click()
    const line = page.locator('[data-testid=wave-refusal]')
    await line.first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {})
    check('No connection: the wave dialog is still open', (await dialog.count()) === 1)
    const text = (await line.count()) > 0 ? ((await line.first().textContent()) ?? '') : ''
    check('No connection: the dialog says to check the signal and press again', text.includes(NO_CONNECTION), text === '' ? 'no refusal line' : `"${text}"`)
    check(`No connection: nothing on the page promises "${FALSE_PROMISE}"`, (await page.getByText(FALSE_PROMISE).count()) === 0)
    check('No connection: the refusal line is inside the viewport', (await line.count()) > 0 && (await inView(line.first())))
    check('No connection: no #error-overlay blocks the page', (await page.locator('#error-overlay').count()) === 0)
    const fresh = uncaught.slice(mark)
    check('No connection: no "Uncaught (in promise)" in the console', fresh.length === 0, fresh.join(' | '))
    await page.screenshot({ path: `${EV}wave-no-connection.png` }).catch(() => {})
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => {})
    await rows.first().click().catch(() => {})
  } finally {
    await page.unroute(matches, abort).catch(() => {})
  }
}

// --- Run ----------------------------------------------------------------------------------------------------------------

const dbName = DB.split('/').pop()?.split('?')[0] ?? ''
if (DB === '' || ['dos', 'dos_qa', 'dos_batch1_template'].includes(dbName)) {
  console.log(`NOT RUN  DATABASE_URL must name a copy of dos_batch1_template (got "${dbName || 'nothing'}"): this check writes`)
  process.exit(2)
}
mkdirSync(EV, { recursive: true })

let browser
let shared = true
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 5000 })
} catch {
  shared = false
  browser = await chromium.launch({ headless: true })
}
console.log(shared ? '[browser] shared pw-server Chromium, private contexts' : '[browser] private headless Chromium')

async function step(name, run) {
  try {
    await run()
  } catch (error) {
    if (error instanceof Precondition) {
      preconditions.push(`${name}: ${error.message}`)
      console.log(`PRECONDITION  ${name}: ${error.message}`)
    } else {
      check(`${name}: ran to the end`, false, error instanceof Error ? (error.stack ?? error.message) : String(error))
    }
  }
}

const context = await browser.newContext({ viewport: VIEWPORT })
try {
  const page = await context.newPage()
  const uncaught = watch(page)
  await step('sign in', () => signIn(page))
  console.log(`\n${TESTS[0]}`)
  await step('credit note 400', () => creditNote(browser))
  await step('wave 409', () => wave(page, uncaught))
  await step('brand-DMS approve 501', () => brandDms(page, uncaught))
  console.log(`\n${TESTS[1]}`)
  await step('no connection', () => lostConnection(page, uncaught))
} finally {
  await context.close().catch(() => {})
  // on a CDP connection this only disconnects; the shared browser keeps running
  await browser.close().catch(() => {})
}

const failed = results.filter((result) => !result.ok).length
const exit = failed > 0 ? 1 : preconditions.length > 0 ? 2 : 0
console.log(
  exit === 0
    ? `GREEN  ${results.length} assertions held`
    : exit === 2
      ? `NOT RUN  ${preconditions.length} precondition(s) missing; ${results.length} assertions held`
      : `RED  ${failed} of ${results.length} assertions failed`,
)
process.exit(exit)
