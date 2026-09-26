// Camera for the field-ux fixes (DOS-210, DOS-211, DOS-215): the same walks done by hand in the Browser
// pane, repeated headless so the proof screenshots and the wire log land in the worktree's evidence dir.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const WEB = 'http://localhost:5417'
const EV = '/Users/prajwalchavan/Desktop/Distribution OS/.claude/worktrees/wf_be1f8178-550-3/QA/evidence/simulation/fixes/field-ux/'
mkdirSync(EV, { recursive: true })
const wire = []
const notes = []
const note = (s) => { notes.push(s); console.log(s) }

const browser = await chromium.launch()

function track(page, label) {
  page.on('response', async (res) => {
    const req = res.request()
    const url = req.url()
    if (req.method() === 'OPTIONS') return
    if (!/auth\/login|\/retailers|docint\/documents\/[^/]+\/(approve|review)|sync\/pull/.test(url)) return
    let body = null
    try { body = req.postDataJSON() } catch { body = null }
    if (body && typeof body === 'object') { delete body.password }
    let reply = null
    try { const t = await res.text(); reply = t.length > 600 ? t.slice(0, 600) + '…' : t } catch {}
    wire.push({ at: new Date().toISOString(), label, method: req.method(), url, status: res.status(), request: body, reply })
  })
}

async function shot(page, name) {
  await page.screenshot({ path: `${EV}${name}.png`, fullPage: false })
  writeFileSync(`${EV}${name}.txt`, await page.innerText('body').catch(() => ''))
  note(`[shot] ${name}.png`)
}

async function signIn(page, user) {
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'domcontentloaded' })
  const field = page.locator('[data-testid=sign-in-username]')
  for (let i = 0; i < 40 && !(await field.isVisible().catch(() => false)); i++) {
    const welcome = page.getByText('Sign in', { exact: true }).first()
    if (await welcome.isVisible().catch(() => false)) await welcome.click().catch(() => {})
    await page.waitForTimeout(500)
  }
  await field.fill(user)
  await page.fill('[data-testid=sign-in-password]', 'Dos@1234')
  await page.click('[data-testid=sign-in-submit]')
  await page.waitForTimeout(3000)
}

async function signOutDesk(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.click('button[aria-haspopup=menu]', { force: true })
  await page.locator('[role=menu]').getByText('Sign out', { exact: true }).last().click()
  await page.waitForURL(/sign-in/, { timeout: 15000 })
}

const logins = (label) => wire.filter((w) => w.label === label && w.url.includes('auth/login')).map((w) => `${w.status} actAs=${w.request?.actAs ?? '(none)'}`)

const PH = (process.env.PHASES ?? 'a,b,c').split(',')
// ---------------------------------------------------------------- desk 1280×800
if (PH.includes('a')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()

  // DOS-210: Vikas elects Manager, signs out; Meena signs in at the same desk.
  track(page, '210-desk-vikas')
  await signIn(page, 'vikas.kadam')
  await shot(page, '210-desk-01-vikas-chooser')
  await page.click('[data-testid=elect-continue]')
  await page.waitForURL(/\/manager/, { timeout: 15000 })
  note(`210 desk: remembered after Vikas = ${await page.evaluate(() => localStorage.getItem('dos.lastRole'))}`)
  await signOutDesk(page)
  const meena = await ctx.newPage(); await page.close()
  track(meena, '210-desk-meena')
  await signIn(meena, 'meena.joshi')
  await meena.waitForURL(/\/manager/, { timeout: 15000 })
  await meena.waitForTimeout(2000)
  await shot(meena, '210-desk-02-meena-signed-in-accountant')
  note(`210 desk: Meena's sign-in on the wire: ${logins('210-desk-meena').join(' | ')}`)

  // DOS-210 failure path: the same person's remembered role was taken away -> 403 once, retried, forgotten.
  await signOutDesk(meena)
  await meena.evaluate(() => localStorage.setItem('dos.lastRole', JSON.stringify({ username: 'meena.joshi', role: 'manager' })))
  const meena2 = await ctx.newPage(); await meena.close()
  track(meena2, '210-desk-meena-demoted')
  await signIn(meena2, 'meena.joshi')
  await meena2.waitForURL(/\/manager/, { timeout: 15000 })
  await shot(meena2, '210-desk-03-meena-refused-role-retried')
  note(`210 desk failure path: ${logins('210-desk-meena-demoted').join(' | ')}; remembered now ${await meena2.evaluate(() => localStorage.getItem('dos.lastRole'))}`)
  const refused = wire.find((w) => w.label === '210-desk-meena-demoted' && w.status === 403)
  note(`210 refusal sentence: ${refused?.reply ?? '(none)'}`)

  await ctx.close()
}
if (PH.includes('b')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // DOS-215: Vikas, Documents, an Extracted bill.
  const desk = await ctx.newPage()
  track(desk, '215-desk')
  await signIn(desk, 'vikas.kadam')
  await desk.click('[data-testid=elect-continue]').catch(() => {})
  await desk.waitForURL(/\/manager/, { timeout: 15000 })
  await desk.goto(`${WEB}/manager/inbound/documents`, { waitUntil: 'domcontentloaded' })
  await desk.getByText(process.env.DOC ?? 'REL/26-27/00495').first().click({ timeout: 30000 })
  await desk.waitForSelector('[data-testid=docint-approve]', { timeout: 20000 })
  await desk.locator('[data-testid=docint-approve]').scrollIntoViewIfNeeded()
  await desk.waitForTimeout(800)
  if (!process.env.ALREADY_REVIEWED) {
  const reason1 = await desk.locator('[data-testid=docint-approve]').evaluate((b) => [b.getAttribute('aria-disabled') ?? String(b.disabled), b.parentElement.innerText])
  await shot(desk, '215-desk-01-extracted-book-disabled')
  note(`215 desk extracted: approve disabled=${reason1[0]} text=${JSON.stringify(reason1[1])}`)
  await desk.locator('[data-testid=docint-approve]').click({ force: true }).catch(() => {})
  await desk.waitForTimeout(800)
  note(`215 desk: press on disabled Book it -> dialog open = ${await desk.locator('[data-testid=docint-dialog]').isVisible().catch(() => false)}`)
  }
  if (!process.env.ALREADY_REVIEWED) {
  await desk.click('[data-testid=docint-start]')
  await desk.waitForSelector('[data-testid=docint-submit]', { timeout: 20000 })
  await desk.locator('[data-testid=docint-approve]').scrollIntoViewIfNeeded()
  await desk.waitForTimeout(800)
  const reason2 = await desk.locator('[data-testid=docint-approve]').evaluate((b) => b.parentElement.innerText)
  await shot(desk, '215-desk-02-reviewing-submit-first')
  note(`215 desk reviewing: ${JSON.stringify(reason2)}`)
  await desk.click('[data-testid=docint-submit]')
  await desk.locator('[data-testid=docint-dialog]').getByText('This reading is right', { exact: true }).last().click()
  await desk.waitForFunction(() => { const b = document.querySelector('[data-testid=docint-approve]'); return b && b.getAttribute('aria-disabled') !== 'true' && !b.disabled }, null, { timeout: 20000 })
  await desk.locator('[data-testid=docint-approve]').scrollIntoViewIfNeeded()
  }
  await desk.waitForTimeout(800)
  await shot(desk, '215-desk-03-reviewed-book-ready')
  await desk.click('[data-testid=docint-approve]')
  await desk.locator('[data-testid=docint-dialog]').getByText('Book it as a supplier bill', { exact: true }).last().click()
  await desk.waitForFunction(() => !document.querySelector('[data-testid=docint-approve]'), null, { timeout: 20000 })
  await desk.waitForTimeout(1000)
  await shot(desk, '215-desk-04-booked-no-book-no-reject')
  note(`215 desk after booking: reject offered = ${await desk.locator('[data-testid=docint-reject]').count()}`)
  note(`215 desk wire: ${wire.filter((w) => w.label === '215-desk').map((w) => `${w.method} ${w.url.replace(/^.*\/manager/, '')} ${w.status}`).join(' | ')}`)

  await ctx.close()
}
if (PH.includes('d')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // DOS-211 at desk: Rahul adds a shop, on a desk where Vikas last elected Manager.
  const rep = await ctx.newPage()
  await rep.goto(`${WEB}/sign-in`, { waitUntil: 'domcontentloaded' })
  await rep.evaluate(() => localStorage.setItem('dos.lastRole', JSON.stringify({ username: 'vikas.kadam', role: 'manager' })))
  track(rep, '211-desk')
  await signIn(rep, 'rahul.deshmukh')
  await rep.waitForURL(/\/sales/, { timeout: 15000 })
  note(`210 desk: Rahul after Vikas: ${logins('211-desk').join(' | ')}`)
  await addShop(rep, 'Fix Walk Desk Stores', '9876543292', '211-desk')
  await ctx.close()
}

async function addShop(page, name, phone, prefix) {
  await page.goto(`${WEB}/sales/shops/new`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid=shop-name]', { timeout: 30000 })
  await page.waitForTimeout(3000) // the beat list comes with the first pull
  await page.fill('[data-testid=shop-name]', name)
  await page.fill('[data-testid=shop-phone]', phone)
  const beat = page.locator('[data-testid=shop-beat]').getByText('Station Road', { exact: true })
  if (await beat.count()) await beat.first().click()
  await page.click('[data-testid=create-shop]')
  const seen = []
  const t0 = Date.now()
  let shotTaken = false
  while (Date.now() - t0 < 5000) {
    const txt = await page.innerText('body').catch(() => '')
    const onCard = /\/sales\/shops\/[0-9a-f-]{36}/.test(page.url())
    seen.push(`${Date.now() - t0}ms card=${onCard} notOnPhone=${txt.includes('not on this phone')} name=${txt.includes(name)}`)
    if (onCard && !shotTaken) { await shot(page, `${prefix}-01-card-right-after-add`); shotTaken = true }
    await page.waitForTimeout(150)
  }
  const distinct = [...new Set(seen.map((s) => s.replace(/^\d+ms /, '')))]
  note(`211 ${prefix}: states seen in 5 s after Add: ${distinct.join(' / ')}`)
  const post = wire.find((w) => w.label === prefix && w.method === 'POST' && w.url.endsWith('/retailers'))
  note(`211 ${prefix}: POST /sales/retailers ${post?.status} code=${post?.reply?.match(/"code":"(R-\d+)"/)?.[1]}`)
}

// ---------------------------------------------------------------- phone 390×844
if (PH.includes('c')) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  track(page, '211-phone')
  // The previous person on this phone was Vikas, who had elected Manager (the day-1 condition).
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.setItem('dos.lastRole', JSON.stringify({ username: 'vikas.kadam', role: 'manager' })))
  await signIn(page, 'rahul.deshmukh')
  await page.waitForURL(/\/sales/, { timeout: 15000 })
  note(`210 phone: Rahul after Vikas's election: ${logins('211-phone').join(' | ')}`)
  await shot(page, '210-phone-01-rahul-beat')
  await addShop(page, 'Fix Walk Phone Kirana', '9876543293', '211-phone')

  // DOS-211 failure path: the save is refused -> the form stays, keeps the input, says what failed.
  await page.goto(`${WEB}/sales/shops/new`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid=shop-name]', { timeout: 30000 })
  await page.fill('[data-testid=shop-name]', 'Fix Walk Refused Shop')
  await page.fill('[data-testid=shop-phone]', '123456789012')
  await page.click('[data-testid=create-shop]')
  await page.waitForTimeout(2500)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.locator('main').evaluate((m) => m.scrollTo?.(0, 0)).catch(() => {})
  await shot(page, '211-phone-02-save-refused-input-kept')
  const refusedPost = wire.filter((w) => w.label === '211-phone' && w.method === 'POST' && w.url.endsWith('/retailers')).pop()
  note(`211 phone refused: POST ${refusedPost?.status}; still on ${new URL(page.url()).pathname}; name kept = ${await page.inputValue('[data-testid=shop-name]')}`)

  await ctx.close()
}
if (PH.includes('e')) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  // DOS-215 at phone width: the manager opens a Needs-review bill on a phone.
  const mgr = await ctx.newPage()
  track(mgr, '215-phone')
  await signIn(mgr, 'vikas.kadam')
  await mgr.click('[data-testid=elect-continue]').catch(() => {})
  await mgr.waitForURL(/\/manager/, { timeout: 15000 })
  await mgr.goto(`${WEB}/manager/inbound/documents`, { waitUntil: 'domcontentloaded' })
  await mgr.waitForTimeout(4000)
  writeFileSync(`${EV}215-phone-00-queue.txt`, await mgr.innerText('body'))
  await mgr.getByText(process.env.PDOC ?? 'FA/TY/26-27/1187').first().click({ timeout: 30000 })
  await mgr.waitForSelector('[data-testid=docint-approve]', { timeout: 20000 })
  await mgr.locator('[data-testid=docint-approve]').scrollIntoViewIfNeeded()
  await mgr.waitForTimeout(800)
  const r = await mgr.locator('[data-testid=docint-approve]').evaluate((b) => [b.getAttribute('aria-disabled') ?? String(b.disabled), b.parentElement.innerText])
  await shot(mgr, process.env.PSHOT ?? '215-phone-01-needs-review-book-disabled')
  note(`215 phone needs_review: approve disabled=${r[0]} text=${JSON.stringify(r[1])}`)
  await ctx.close()
}

writeFileSync(`${EV}wire-${PH.join('')}.json`, JSON.stringify(wire, null, 1))
writeFileSync(`${EV}walk-notes-${PH.join('')}.txt`, notes.join('\n') + '\n')
await browser.close()
