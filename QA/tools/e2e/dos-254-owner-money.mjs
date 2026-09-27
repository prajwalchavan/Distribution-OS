// DOS-254: the owner's Invoiced today, Sales this month and gross margin net of credit notes.
//
// PHASE=before  the owner's Today and Reports › Profit as the pre-fix rollup left them (run after
//               QA/tools/e2e/dos-254-prefix-state.sql put the test copy's September back to gross).
// PHASE=after   the same two screens after the worker's catch-up re-rolled the September days and today's
//               rollup counted today's credit note; every figure checked against SQL; desk and phone.
//
//   APP_URL=http://127.0.0.1:5417 DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_… \
//   PLAYWRIGHT_MODULE=…/playwright/index.mjs PHASE=after node QA/tools/e2e/dos-254-owner-money.mjs
import { chromium, APP, DESK, PHONE, TENANT, check, finish, shot, signIn, sql } from './dos-253-254-lib.mjs'

const PHASE = process.env.PHASE ?? 'after'
const inr = (paise) =>
  `${Number(paise) < 0 ? '-' : ''}₹${(Math.abs(Number(paise)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const n = (s) => Number(s || 0)

const browser = await chromium.launch()
try {
  for (const [label, viewport] of [
    ['desk', DESK],
    ['phone', PHONE],
  ]) {
    const ctx = await browser.newContext({ viewport })
    const page = await ctx.newPage()
    await signIn(page, 'sunil.tarsun', 'Owner')
    await page.goto(`${APP}/owner`)
    await page.getByText('Sales this month', { exact: true }).first().waitFor({ timeout: 20000 })
    await page.waitForTimeout(1200)
    const prefix = PHASE === 'before' ? '20' : '22'
    await shot(page, `${prefix}-owner-today-${PHASE}-${label}`)
    const body = await page.locator('body').innerText()

    const summary = sql(
      `select mtd_sales_paise || '|' || today_invoiced_paise || '|' || coalesce(detail->>'todayCreditedPaise','') || '|' || coalesce(detail->>'mtdCreditedPaise','') || '|' || mtd_gross_margin_paise from owner_summary where tenant_id = ${TENANT}`,
    )
    const [mtdSales, todayInv, todayCred, mtdCred, mtdMargin] = summary.split('|')
    if (PHASE === 'after') {
      const month = sql(
        `select coalesce(sum(i.total_paise),0) from invoices i where i.tenant_id = ${TENANT} and i.state not in ('draft','cancelled') and i.invoice_date between date_trunc('month', current_date)::date and current_date`,
      )
      const credited = sql(
        `select coalesce(sum(total_paise),0) from credit_notes where tenant_id = ${TENANT} and state in ('issued','applied') and note_date between date_trunc('month', current_date)::date and current_date`,
      )
      const creditedToday = sql(
        `select coalesce(sum(total_paise),0) from credit_notes where tenant_id = ${TENANT} and state in ('issued','applied') and note_date = current_date`,
      )
      check(
        `${label}: owner_summary Sales this month = invoices since the 1st − credit notes since the 1st (SQL)`,
        n(mtdSales) === n(month) - n(credited),
        `${mtdSales} = ${month} − ${credited}`,
      )
      check(
        `${label}: the home prints Sales this month net, with the split`,
        body.includes(inr(mtdSales)) &&
          body.includes(`${inr(n(mtdSales) + n(mtdCred))} invoiced · less ${inr(mtdCred)} credited`),
        `${inr(mtdSales)} · ${inr(n(mtdSales) + n(mtdCred))} invoiced · less ${inr(mtdCred)} credited`,
      )
      check(
        `${label}: today's credit is stated beside Invoiced today (SQL ${creditedToday})`,
        n(todayCred) === n(creditedToday) &&
          body.includes(`${inr(todayCred)} credited · net ${inr(n(todayInv) - n(todayCred))}`),
        `${inr(todayCred)} credited · net ${inr(n(todayInv) - n(todayCred))}`,
      )
    } else {
      check(`${label}: before — the home prints the gross month`, body.includes(inr(mtdSales)), inr(mtdSales))
    }

    await page.goto(`${APP}/owner/reports/profit`)
    await page.getByText('Gross margin this month', { exact: false }).first().waitFor({ timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(1500)
    await shot(page, `${PHASE === 'before' ? '21' : '23'}-owner-profit-${PHASE}-${label}`)
    const profit = await page.locator('body').innerText()
    if (PHASE === 'after') {
      const margin = sql(
        `select coalesce(sum(gross_margin_paise),0) from daily_owner_stats where tenant_id = ${TENANT} and day between date_trunc('month', current_date)::date and current_date`,
      )
      check(
        `${label}: Profit's margin this month = Σ daily net margin (SQL), and it is net`,
        n(mtdMargin) === n(margin) && profit.includes(inr(mtdMargin)),
        `${inr(mtdMargin)} vs Σ ${margin}`,
      )
    } else {
      check(`${label}: before — Profit prints the gross margin`, profit.includes(inr(mtdMargin)), inr(mtdMargin))
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
finish()
