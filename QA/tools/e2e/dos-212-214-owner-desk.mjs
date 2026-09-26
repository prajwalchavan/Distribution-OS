// DOS-212 + DOS-214: the desk sets a shop's credit mode and payment terms, and edits price-list rates, shop rates
// (final) and schemes — at desk (1280x800) and phone (390x844) widths, as the owner, the manager and the accountant,
// including the failure paths: a draft the contract would refuse is never sent (the editor says what is wrong), and a
// write that does not reach the service (the POST is aborted in the browser) keeps the surface open with the input and
// says so. Every "saved" is checked against SQL.
//
// IT WRITES. Run it ONLY against a test copy (name containing "test") with the all-in-one API and the dos-app web
// build on that copy:
//   APP_URL=http://127.0.0.1:5437 DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_… node QA/tools/e2e/dos-212-214-owner-desk.mjs
// Screenshots go to QA/evidence/simulation/fixes/owner-desk/. Exit 0 = every check held · 1 = the failed ones listed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PW = process.env.PLAYWRIGHT_MODULE ?? 'playwright'
const { chromium } = await import(PW)

const APP = process.env.APP_URL ?? 'http://127.0.0.1:5437'
const DB = process.env.DATABASE_URL ?? ''
if (!/test/.test(DB)) {
  console.error('DATABASE_URL must name a test copy (it writes)')
  process.exit(2)
}
const PSQL = existsSync('/opt/homebrew/opt/postgresql@17/bin/psql')
  ? '/opt/homebrew/opt/postgresql@17/bin/psql'
  : 'psql'
const EV = fileURLToPath(new URL('../../evidence/simulation/fixes/owner-desk/', import.meta.url))
mkdirSync(EV, { recursive: true })
const DESK = { width: 1280, height: 800 }
/** A suffix so a re-run names new schemes rather than matching the last run's. */
const RUN = String(Date.now()).slice(-5)
const LINE = `E2E ${RUN} 2.5% on Bourbon, tiers A B`
const ORDER = `E2E ${RUN} bills over 7500, 3% exclusive`
const NOTE = `E2E ${RUN} final rate`
const PHONE = { width: 390, height: 844 }

const results = []
const log = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}
function sql(query) {
  return execFileSync(PSQL, [DB, '-Atc', query], { encoding: 'utf8' }).trim()
}
async function shot(page, name) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${EV}${name}.png` })
  log.push(name)
}

async function signIn(page, username, role) {
  await page.goto(`${APP}/sign-in`)
  await page.waitForLoadState('networkidle')
  const welcome = page.getByText('Sign in', { exact: true })
  if ((await page.locator('input[type=password]').count()) === 0 && (await welcome.count()) > 0) {
    await welcome.first().click()
  }
  await page.locator('input[type=password]').waitFor()
  await page.locator('input[type=text]').first().fill(username)
  await page.locator('input[type=password]').fill('Dos@1234')
  await page.locator('input[type=password]').press('Enter')
  const chooser = page.getByText('Continue as', { exact: true })
  try {
    await chooser.waitFor({ timeout: 6000 })
    await page.getByText(role, { exact: true }).first().click()
    await page.getByText('Continue', { exact: true }).click()
  } catch {
    /* a one-role person goes straight in */
  }
  await page.waitForTimeout(1500)
}

/** Abort the browser's POSTs to a path (the write never reaches the service), until `release()`. */
async function cutWrites(page, pattern) {
  const handler = (route) =>
    route.request().method() === 'POST' ? route.abort('failed') : route.continue()
  await page.route(pattern, handler)
  return () => page.unroute(pattern, handler)
}

// The two shops this walk changes start from their seeded terms, so a re-run proves the same change again.
sql(`update retailers set credit_mode = 'indicate', payment_terms = 'POST_FULFILLMENT', credit_limit_paise = 18000000, credit_days = 14
     where code = 'R-0011' and tenant_id = (select id from tenants where slug = 'tarsun')`)
sql(`update retailers set credit_mode = 'strict', payment_terms = 'POST_FULFILLMENT'
     where code = 'R-0009' and tenant_id = (select id from tenants where slug = 'tarsun')`)

const browser = await chromium.launch()
try {
  // ------------------------------------------------------------------------------------------------ owner, desk
  {
    const ctx = await browser.newContext({ viewport: DESK })
    const page = await ctx.newPage()
    await signIn(page, 'sunil.tarsun', 'Owner')

    // DOS-212 — Sai Baba Kirana (R-0011): Warn only + Credit before.
    const shopId = sql(`select id from retailers where code = 'R-0011' and tenant_id = (select id from tenants where slug = 'tarsun')`)
    const before = sql(`select credit_mode || '|' || payment_terms from retailers where id = '${shopId}'`)
    await page.goto(`${APP}/owner/shops`)
    await page.getByText('Sai Baba Kirana', { exact: true }).first().waitFor()
    await shot(page, '01-owner-shops-register-mode-column-desk')
    await page.getByText('Sai Baba Kirana', { exact: true }).first().click()
    await page.getByTestId('shop-set-credit').click()
    await page.getByTestId('credit-mode').waitFor()
    const nowLine = await page.getByText(/^Now: /).first().textContent()
    check('DOS-212 the credit dialog opens on the current values', /Warn only · Credit/.test(nowLine ?? ''), nowLine ?? '')
    await shot(page, '02-owner-credit-dialog-current-values-desk')

    await page.getByRole('radio', { name: 'Blocked' }).click()
    await page.getByRole('radio', { name: 'Pays on delivery' }).click()
    await page.getByTestId('credit-limit').fill('0')
    await page.getByTestId('credit-days').fill('0')
    const release = await cutWrites(page, '**/retailers/*/credit')
    await page.getByText('Save the terms', { exact: true }).click()
    await page.getByTestId('credit-problem').waitFor({ timeout: 25000 })
    const refused = await page.getByTestId('credit-problem').textContent()
    const stillBlocked = await page.getByRole('radio', { name: 'Blocked' }).getAttribute('aria-checked')
    check('DOS-212 a write that does not reach the service keeps the dialog open, the input and says why',
      stillBlocked === 'true' && (refused ?? '').length > 0, refused ?? '')
    check('DOS-212 nothing was written on the failed save',
      sql(`select credit_mode || '|' || payment_terms from retailers where id = '${shopId}'`) === before, before)
    await shot(page, '03-owner-credit-save-not-reached-desk')
    await release()

    await page.getByText('Save the terms', { exact: true }).click()
    await page.getByText('Credit terms saved', { exact: true }).waitFor({ timeout: 15000 })
    const after = sql(`select credit_mode || '|' || payment_terms || '|' || credit_limit_paise || '|' || credit_days from retailers where id = '${shopId}'`)
    check('DOS-212 saved: stop + ON + ₹0 + 0 days in SQL', after === 'stop|ON|0|0', after)
    await shot(page, '04-owner-credit-saved-panel-desk')
    await page.keyboard.press('Escape')
    const row = page.locator('tr', { hasText: 'Sai Baba Kirana' }).first()
    const rowText = await row.textContent()
    check('DOS-212 the register chip follows the change', /Blocked/.test(rowText ?? '') && /Pays on delivery/.test(rowText ?? ''), rowText ?? '')
    await shot(page, '05-owner-shops-register-chip-followed-desk')

    // DOS-214 — every list is reachable; Tier C rate change, a refused draft, then saved.
    await page.goto(`${APP}/owner/prices`)
    await page.getByText('Tier C Price List', { exact: true }).click()
    await shot(page, '06-owner-prices-tier-c-reachable-desk')
    const tierC = sql(`select id from price_lists where tenant_id = (select id from tenants where slug='tarsun') and name = 'Tier C Price List'`)
    const item = 'Annapurna Iodised Salt 1 kg'
    await page.locator('tr', { hasText: item }).first().click()
    await page.getByTestId('rate-value').fill('')
    await page.getByText('Save the rate', { exact: true }).click()
    const rateProblem = await page.getByTestId('rate-problem').textContent()
    check('DOS-214 an empty rate is not sent; the dialog says what to do', /rate above/.test(rateProblem ?? ''), rateProblem ?? '')
    await shot(page, '07-owner-rate-empty-refused-desk')
    await page.getByTestId('rate-value').fill('27.35')
    await page.getByText('Save the rate', { exact: true }).click()
    await page.getByText('Rate saved', { exact: true }).waitFor({ timeout: 15000 })
    const rate = sql(`select string_agg(i.rate_paise::text, ',') from price_list_items i join product_variants v on v.id = i.variant_id where i.price_list_id = '${tierC}' and v.name like 'Annapurna Iodised Salt%'`)
    check('DOS-214 Tier C rate saved: 2735 paise in SQL', rate.split(',').includes('2735'), rate)
    await shot(page, '08-owner-rate-saved-desk')

    // DOS-214 — a percentage LINE scheme on chosen items for tiers A and B, stacking.
    await page.getByRole('tab', { name: 'Schemes' }).click()
    await page.getByText('New scheme', { exact: true }).click()
    await page.getByTestId('scheme-name').fill(LINE)
    await page.getByTestId('scheme-reward-value').fill('2.5')
    await page.getByRole('radio', { name: 'Chosen items' }).click()
    await page.getByTestId('scheme-items-search').fill('bourbon cream 60')
    await page.getByTestId('scheme-items-matches').getByRole('button').first().click()
    await page.getByTestId('scheme-tiers').getByRole('button', { name: 'Tier A' }).click()
    await page.getByTestId('scheme-tiers').getByRole('button', { name: 'Tier B' }).click()
    await shot(page, '09-owner-new-line-scheme-desk')
    const releaseS = await cutWrites(page, '**/pricing/schemes')
    await page.getByText('Save the scheme', { exact: true }).click()
    await page.getByTestId('scheme-problem').waitFor({ timeout: 25000 })
    check('DOS-214 a scheme save that does not reach the service keeps the sheet and the input',
      (await page.getByTestId('scheme-name').inputValue()) === LINE,
      (await page.getByTestId('scheme-problem').textContent()) ?? '')
    await shot(page, '10-owner-scheme-save-not-reached-desk')
    await releaseS()
    await page.getByText('Save the scheme', { exact: true }).click()
    await page.getByTestId('scheme-sheet').waitFor({ state: 'detached', timeout: 15000 })
    await page.getByText('Scheme saved', { exact: true }).waitFor({ timeout: 15000 })
    const line = sql(`select reward_kind || '|' || reward_value || '|' || stackable || '|' || (applicability->'tiers')::text || '|' || jsonb_array_length(scope->'variantIds') from schemes where name = '${LINE}'`)
    check('DOS-214 line scheme in SQL: line_pct 250 bps, stacks, tiers A B, one item', line === 'line_pct|250|true|["A", "B"]|1', line)
    await shot(page, '11-owner-line-scheme-saved-desk')

    // DOS-214 — an ORDER-VALUE scheme, exclusive, with dates; a bad percentage is named, not sent.
    await page.getByText('New scheme', { exact: true }).click()
    await page.getByTestId('scheme-name').fill(ORDER)
    await page.getByTestId('scheme-reward-kind').getByRole('button', { name: '% off the bill' }).click()
    await page.getByTestId('scheme-reward-value').fill('150')
    await page.getByRole('radio', { name: 'Bill value' }).click()
    await page.getByTestId('scheme-trigger-value').fill('7500')
    await page.getByRole('radio', { name: 'On its own' }).click()
    await page.getByTestId('scheme-to').fill('2026-10-31')
    await page.getByText('Save the scheme', { exact: true }).click()
    const pct = await page.getByTestId('scheme-problem').textContent()
    check('DOS-214 150 % is refused on the screen, never sent', /percentage above 0 and up to 100/.test(pct ?? ''), pct ?? '')
    await shot(page, '12-owner-order-scheme-bad-percent-desk')
    await page.getByTestId('scheme-reward-value').fill('3')
    await page.getByText('Save the scheme', { exact: true }).click()
    await page.getByTestId('scheme-sheet').waitFor({ state: 'detached', timeout: 15000 })
    await page.getByText('Scheme saved', { exact: true }).waitFor({ timeout: 15000 })
    const order = sql(`select reward_kind || '|' || reward_value || '|' || trigger_kind || '|' || trigger_unit || '|' || trigger_min || '|' || stackable || '|' || valid_to from schemes where name = '${ORDER}'`)
    check('DOS-214 order-value scheme in SQL: order_pct 300, value ≥ 750000 paise, exclusive, to 2026-10-31',
      order === 'order_pct|300|value|inr|750000|false|2026-10-31', order)
    await shot(page, '13-owner-order-scheme-saved-desk')

    // Edit: pause it, then read it back.
    await page.locator('tr', { hasText: ORDER }).first().click()
    await page.getByRole('radio', { name: 'Paused' }).click()
    await page.getByText('Save the scheme', { exact: true }).click()
    await page.getByTestId('scheme-sheet').waitFor({ state: 'detached', timeout: 15000 })
    await page.getByText('Scheme saved', { exact: true }).waitFor({ timeout: 15000 })
    const paused = sql(`select active || '|' || version from schemes where name = '${ORDER}'`)
    check('DOS-214 editing a scheme pauses it (active false; economics unchanged keep the version)', paused === 'false|1', paused)
    await shot(page, '14-owner-scheme-paused-desk')

    // DOS-214 — a FINAL shop rate, then end it.
    await page.getByRole('tab', { name: 'Per shop' }).click()
    await page.getByText('Set a shop rate', { exact: true }).click()
    await page.getByTestId('override-shop-search').fill('mahalaxmi')
    await page.getByTestId('override-shop-matches').getByRole('button').first().click()
    await page.getByTestId('override-item-search').fill('iodised salt 1')
    await page.getByTestId('override-item-matches').getByRole('button').first().click()
    await page.getByTestId('override-rate').fill('24.50')
    await page.getByRole('radio', { name: 'Final, no scheme' }).click()
    await page.getByTestId('override-note').fill(NOTE)
    await shot(page, '15-owner-final-shop-rate-form-desk')
    await page.getByText('Save the shop rate', { exact: true }).click()
    await page.getByText('Shop rate saved', { exact: true }).waitFor({ timeout: 15000 })
    const ov = sql(`select o.rate_paise || '|' || o.final || '|' || coalesce(o.valid_to::text, 'open') from retailer_price_overrides o where o.note = '${NOTE}' order by o.id desc limit 1`)
    check('DOS-214 final shop rate in SQL: 2450 paise, final, open-ended', ov === '2450|true|open', ov)
    await shot(page, '16-owner-final-shop-rate-saved-desk')
    await page.locator('tr', { hasText: 'Mahalaxmi' }).filter({ hasText: 'Iodised' }).first().click()
    await page.getByText('End this rate', { exact: true }).click()
    await shot(page, '17-owner-end-shop-rate-dialog-desk')
    await page.getByTestId('override-end-dialog').getByText('End this rate', { exact: true }).click()
    await page.getByText('Shop rate ended', { exact: true }).waitFor({ timeout: 15000 })
    const ended = sql(`select coalesce(valid_to::text, 'open') from retailer_price_overrides where note = '${NOTE}' order by id desc limit 1`)
    check('DOS-214 ending a shop rate writes its last day', ended !== 'open', ended)
    await shot(page, '18-owner-shop-rate-ended-desk')

    await page.getByRole('tab', { name: 'What-if' }).click()
    await shot(page, '19-owner-what-if-reachable-desk')
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------------------ owner, phone
  {
    const ctx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await signIn(page, 'sunil.tarsun', 'Owner')
    await page.goto(`${APP}/owner/shops`)
    await page.getByText('Shree Ganesh Kirana', { exact: true }).first().click()
    await page.getByTestId('shop-set-credit').click()
    await page.getByTestId('credit-terms').waitFor()
    await shot(page, '20-owner-credit-dialog-phone')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('phone: the credit dialog does not scroll the page sideways', overflow <= 0, `overflow ${overflow}px`)
    await page.keyboard.press('Escape')
    await page.goto(`${APP}/owner/prices`)
    await page.getByText('Tier C Price List', { exact: true }).waitFor()
    await shot(page, '21-owner-prices-lists-phone')
    await page.getByRole('tab', { name: 'Schemes' }).click()
    await page.getByText('New scheme', { exact: true }).click()
    await page.getByTestId('scheme-name').waitFor()
    await shot(page, '22-owner-new-scheme-sheet-phone')
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Per shop' }).click()
    await page.getByText('Set a shop rate', { exact: true }).click()
    await page.getByTestId('override-shop-search').waitFor()
    await shot(page, '23-owner-shop-rate-sheet-phone')
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------------------ manager
  {
    const ctx = await browser.newContext({ viewport: DESK })
    const page = await ctx.newPage()
    await signIn(page, 'vikas.kadam', 'Manager')
    const shopId = sql(`select id from retailers where code = 'R-0009' and tenant_id = (select id from tenants where slug = 'tarsun')`)
    await page.goto(`${APP}/manager/shops`)
    await page.getByText('Ambika Provision Store', { exact: true }).first().click()
    await page.getByTestId('shop-credit').click()
    await page.getByRole('radio', { name: 'Needs approval' }).click()
    await page.getByRole('radio', { name: 'Pays in advance' }).click()
    await shot(page, '30-manager-credit-dialog-desk')
    await page.getByText('Save the terms', { exact: true }).click()
    await page.getByText('Credit terms saved', { exact: true }).waitFor({ timeout: 15000 })
    const m = sql(`select credit_mode || '|' || payment_terms from retailers where id = '${shopId}'`)
    check('DOS-212 the manager sets mode + terms too (strict | PRE)', m === 'strict|PRE', m)
    await shot(page, '31-manager-credit-saved-desk')

    await page.goto(`${APP}/manager/prices`)
    await page.getByRole('radio', { name: 'Schemes' }).click()
    await page.locator('tr', { hasText: ORDER }).first().click()
    await page.getByRole('radio', { name: 'Running' }).click()
    await shot(page, '32-manager-edit-scheme-desk')
    await page.getByText('Save the scheme', { exact: true }).click()
    await page.getByTestId('scheme-sheet').waitFor({ state: 'detached', timeout: 15000 })
    await page.getByText('Scheme saved', { exact: true }).waitFor({ timeout: 15000 })
    check('DOS-214 the manager edits a scheme (running again)',
      sql(`select active from schemes where name = '${ORDER}'`) === 't')
    await ctx.close()

    const phone = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true })
    const p2 = await phone.newPage()
    await signIn(p2, 'vikas.kadam', 'Manager')
    await p2.goto(`${APP}/manager/prices`)
    await p2.getByRole('radio', { name: 'Shop rates' }).click()
    await p2.getByText('Set a shop rate', { exact: true }).click()
    await p2.getByTestId('override-shop-search').waitFor()
    await shot(p2, '33-manager-shop-rate-sheet-phone')
    await phone.close()
  }

  // ------------------------------------------------------------------------------------------------ accountant
  {
    const ctx = await browser.newContext({ viewport: DESK })
    const page = await ctx.newPage()
    await signIn(page, 'meena.joshi', 'Accounts')
    await page.goto(`${APP}/manager/shops`)
    await page.getByText('Ambika Provision Store', { exact: true }).first().click()
    await page.getByTestId('shop-statement').waitFor()
    const credit = await page.getByTestId('shop-credit').count()
    check('the accountant sees no credit control (matrix: owner + manager)', credit === 0, `controls ${credit}`)
    await shot(page, '40-accountant-shop-panel-no-credit-control-desk')
    await ctx.close()
  }
} finally {
  await browser.close()
}

writeFileSync(`${EV}results.json`, JSON.stringify({ at: new Date().toISOString(), app: APP, results, screenshots: log }, null, 2))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks held · ${log.length} screenshots in ${EV}`)
process.exit(failed.length === 0 ? 0 : 1)
