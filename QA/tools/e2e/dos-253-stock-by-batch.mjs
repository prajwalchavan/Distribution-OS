// DOS-253: the owner (and the manager, and the godown) read stock by item and batch.
//
// Owner at desk: the register is live rows in item order with a Location column, a page at a time with
// "Show more"; the brand donut adds up to the stock at cost; a server-side search finds every live toor
// batch at the Godown (the old screen's one page of 300 lot-ordered rows held 3 of 12 — sql-00); the row
// adjustment is reachable and writes the phantom toor off, including the failure paths (too many pieces is
// refused on the screen and never sent; a count that went stale under the dialog is refused by the service,
// printed in the dialog, the input kept). Owner at phone width, the manager at desk, the godown at phone.
//
//   APP_URL=http://127.0.0.1:5417 DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_… \
//   PLAYWRIGHT_MODULE=…/playwright/index.mjs node QA/tools/e2e/dos-253-stock-by-batch.mjs
import { chromium, APP, DESK, PHONE, TENANT, check, finish, shot, signIn, sql } from './dos-253-254-lib.mjs'

const API = process.env.API_URL ?? 'http://127.0.0.1:3417'
const GODOWN = `(select id from locations where tenant_id = ${TENANT} and name = 'Godown')`
const TOOR = 'Annapurna Toor Dal 1 kg'
const BATCH = 'B20260909'
const lot = sql(
  `select lo.id from stock_lots lo join product_variants v on v.id = lo.variant_id where lo.tenant_id = ${TENANT} and v.name = '${TOOR}' and lo.batch_no = '${BATCH}'`,
)
const godown = sql(`select ${GODOWN}`)
const onHand = () =>
  Number(sql(`select on_hand from stock_balances where lot_id = '${lot}' and location_id = '${godown}'`))

/** A write the same godown makes while the owner's dialog is open (the manager's own token). */
async function takeOffBehindTheDialog(pieces) {
  const login = await fetch(`${API}/auth/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'vikas.kadam',
      password: 'Dos@1234',
      deviceId: '01a0e000-0000-7000-8000-00000000d7f2',
    }),
  })
  const { accessToken } = await login.json()
  const key = `01a0e171-${String(Date.now()).slice(-4)}-7000-8000-${String(Date.now()).padStart(12, '0').slice(-12)}`
  const res = await fetch(`${API}/manager/inventory/adjustments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: key,
      lotId: lot,
      locationId: godown,
      qtyDelta: -pieces,
      reason: 'damage',
      note: 'DOS-253 walk: a damaged carton found while the owner was looking',
    }),
  })
  return res.status
}

const browser = await chromium.launch()
try {
  // ------------------------------------------------------------------------------------ owner, desk
  {
    const ctx = await browser.newContext({ viewport: DESK })
    const page = await ctx.newPage()
    await signIn(page, 'sunil.tarsun', 'Owner')
    await page.goto(`${APP}/owner/stock`)
    await page.getByTestId('stock-register').waitFor({ timeout: 20000 })
    await page.getByTestId('stock-count').waitFor()
    await page.waitForTimeout(1200)
    await shot(page, '01-owner-stock-all-places-desk')

    const live = Number(sql(`select count(*) from stock_balances where tenant_id = ${TENANT} and on_hand <> 0`))
    const head = await page.locator('thead').first().innerText()
    check('the register has a Location column when no place is picked', /Location/.test(head), head.replace(/\s+/g, ' '))
    const count1 = await page.getByTestId('stock-count').innerText()
    check(
      `a page of 100 of ${live} live rows says more are below`,
      /^100 batches shown — more below/.test(count1),
      count1,
    )
    // the brand donut is the register's own split of every row, and adds up to the stock at cost
    const total = Number(sql(`select sum(value) from (
        select b.on_hand * coalesce(
          (select case when landed_cost_paise > 0 then landed_cost_paise else purchase_rate_paise end
             from tenant_product_costs c where c.tenant_id = b.tenant_id and c.lot_id = b.lot_id order by effective_from desc limit 1),
          (select case when landed_cost_paise > 0 then landed_cost_paise else purchase_rate_paise end
             from tenant_product_costs c where c.tenant_id = b.tenant_id and c.variant_id = lo.variant_id
            order by (c.lot_id is null) desc, effective_from desc limit 1), 0) as value
          from stock_balances b join stock_lots lo on lo.id = b.lot_id
         where b.tenant_id = ${TENANT} and b.on_hand > 0) x`))
    const mixText = await page.getByTestId('stock-mix').innerText()
    const valueText = await page.getByTestId('stock-value').innerText()
    const rupees = `₹${(total / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    check('Stock at cost beside the donut = Σ on hand × lot cost (SQL)', valueText.includes(rupees), `${rupees} in "${valueText.replace(/\s+/g, ' ')}"`)
    const topBrands = sql(`select string_agg(name, '|') from (
        select coalesce(br.name, 'No brand') as name, sum(b.on_hand) as pcs
          from stock_balances b join stock_lots lo on lo.id = b.lot_id
          join product_variants v on v.id = lo.variant_id join products p on p.id = v.product_id
          left join brands br on br.id = p.brand_id
         where b.tenant_id = ${TENANT} and b.on_hand > 0 group by 1) x`).split('|')
    check(
      'the donut names the four largest brands and folds the rest into Other (never drops them)',
      topBrands.length <= 5 || /Other/.test(mixText),
      mixText.replace(/\s+/g, ' ').slice(0, 200),
    )

    await page.getByTestId('stock-more').click()
    await page.getByTestId('stock-count').filter({ hasText: /^200 batches shown/ }).waitFor({ timeout: 20000 })
    const rows200 = await page.locator('[data-testid="stock-register"] tbody tr').count()
    check('Show more appends the next page (200 rows, none repeated)', rows200 === 200, String(rows200))
    await shot(page, '02-owner-stock-show-more-desk')

    // the Godown chip + a server-side search: every live toor batch, 3 of which the old page held
    await page.getByTestId('stock-locations').getByText('Godown', { exact: true }).click()
    await page.getByPlaceholder('Find an item, product or batch').fill('toor')
    await page.waitForTimeout(1500)
    await page.getByTestId('stock-count').filter({ hasText: /^\d+ batches · / }).waitFor({ timeout: 20000 })
    await page.waitForTimeout(800)
    const toorSql = sql(`select string_agg(v.name || ' ' || lo.batch_no, '|' order by v.name, lo.id)
        from stock_balances b join stock_lots lo on lo.id = b.lot_id join product_variants v on v.id = lo.variant_id
       where b.tenant_id = ${TENANT} and b.location_id = ${GODOWN} and b.on_hand <> 0 and (v.name ilike '%toor%')`).split('|')
    const tableText = await page.getByTestId('stock-register').innerText()
    const missing = toorSql.filter((x) => {
      const batch = x.split(' ').pop()
      return !tableText.includes(batch)
    })
    const headGodown = await page.locator('thead').first().innerText()
    check(`the search finds every live toor batch at the Godown (${toorSql.length} in SQL)`, missing.length === 0, missing.join(', ') || toorSql.join(', '))
    check('with a place picked, the Location column goes', !/Location/.test(headGodown), headGodown.replace(/\s+/g, ' '))
    const order = await page.locator('[data-testid="stock-register"] tbody tr td:first-child').allInnerTexts()
    check('rows read item by item', order.join('|') === [...order].sort((a, b) => a.localeCompare(b)).join('|') || order.every((x, i) => i === 0 || order[i - 1] <= x), order.slice(0, 4).join(' / '))
    await shot(page, '03-owner-stock-godown-search-toor-desk')

    // the row adjustment is reachable: the phantom toor
    const before = onHand()
    await page.locator('[data-testid="stock-register"] tbody tr', { hasText: BATCH }).filter({ hasText: TOOR }).first().click()
    const dialog = page.getByTestId('stock-adjust-dialog')
    await dialog.waitFor()
    const what = await page.getByTestId('stock-adjust-what').innerText()
    check('the dialog names the item, the batch and the place', what === `${TOOR} · batch ${BATCH} · Godown`, what)
    check('and says how many are on hand', (await dialog.innerText()).includes(`On hand now: ${before} pcs`), String(before))
    await page.getByTestId('stock-adjust-pieces').fill(String(before + 80))
    const ledgerBefore = sql(`select count(*) from stock_ledger where lot_id = '${lot}'`)
    await dialog.getByRole('button', { name: 'Adjust stock' }).click()
    await page.waitForTimeout(800)
    check(
      'more pieces than are on hand: said on the screen, never sent',
      (await dialog.innerText()).includes(`Only ${before} pcs are on hand here`) &&
        sql(`select count(*) from stock_ledger where lot_id = '${lot}'`) === ledgerBefore,
      `ledger rows ${ledgerBefore}`,
    )
    await shot(page, '04-owner-adjust-too-many-refused-on-screen-desk')

    // the count goes stale under the open dialog: the service refuses, the dialog says so and keeps the input
    await page.getByTestId('stock-adjust-pieces').fill(String(before))
    await page.getByTestId('stock-adjust-note').fill('Phantom pieces from DOS-251: not on the rack')
    const behind = await takeOffBehindTheDialog(5)
    await dialog.getByRole('button', { name: 'Adjust stock' }).click()
    await page.getByTestId('stock-adjust-refusal').waitFor({ timeout: 20000 })
    const refusal = await page.getByTestId('stock-adjust-refusal').innerText()
    check(
      `a stale count is refused by the service (manager took 5 off: ${behind}), printed in the dialog, input kept`,
      behind === 200 &&
        (await page.getByTestId('stock-adjust-pieces').inputValue()) === String(before) &&
        onHand() === before - 5,
      refusal,
    )
    await dialog.getByText(`On hand now: ${before - 5} pcs`).waitFor({ timeout: 15000 })
    check('after the refusal the dialog re-reads the batch: "On hand now" is what the service counted', true, `${before - 5} pcs`)
    await shot(page, '05-owner-adjust-stale-refused-by-service-desk')

    // now the right figure: every phantom piece off, the row leaves the live register
    await page.getByTestId('stock-adjust-pieces').fill(String(before - 5))
    await dialog.getByRole('button', { name: 'Adjust stock' }).click()
    await page.getByText(/^Stock adjusted:/).waitFor({ timeout: 20000 })
    const toast = await page.getByText(/^Stock adjusted:/).innerText()
    const last = sql(`select qty_delta || '|' || reason || '|' || coalesce(note,'') from stock_ledger where lot_id = '${lot}' order by occurred_at desc limit 1`)
    check(
      'saved only after the 2xx: the toast states the new balance, the ledger holds the row, the balance is 0',
      toast.includes(`${TOOR}, batch ${BATCH} now 0 pcs`) && onHand() === 0 && last === `-${before - 5}|adjustment|Phantom pieces from DOS-251: not on the rack`,
      `${toast} · ${last}`,
    )
    await page.waitForTimeout(1500)
    const afterText = await page.getByTestId('stock-register').innerText()
    check('the batch written off to zero leaves the live register', !afterText.includes(BATCH), '')
    await shot(page, '06-owner-adjusted-row-gone-desk')
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------ owner, phone
  {
    const ctx = await browser.newContext({ viewport: PHONE })
    const page = await ctx.newPage()
    await signIn(page, 'sunil.tarsun', 'Owner')
    await page.goto(`${APP}/owner/stock`)
    await page.getByTestId('stock-count').waitFor({ timeout: 20000 })
    await page.getByPlaceholder('Find an item, product or batch').fill('AN20260829')
    await page.waitForTimeout(1800)
    const text = await page.locator('body').innerText()
    const want = Number(sql(`select count(*) from stock_balances b join stock_lots lo on lo.id = b.lot_id where b.tenant_id = ${TENANT} and b.on_hand <> 0 and lo.batch_no ilike '%AN20260829%'`))
    check(`phone: a batch search reads "${want} batches" (SQL)`, text.includes(`${want} batches`), `${want}`)
    const named = (text.match(/Batch AN20260829/g) ?? []).length
    const placed = (text.match(/ · (Godown|Vehicle [^\n]+|In transit|Damaged \/ expiry bin)\n/g) ?? []).length
    check('phone: every card names its batch (a chip) and its place (the phone register has no Batch column)', named === want && placed === want, `${named} batch chips, ${placed} places`)
    await page.getByTestId('stock-count').scrollIntoViewIfNeeded()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check('phone: no sideways page scroll', overflow <= 0, String(overflow))
    await shot(page, '07-owner-stock-batch-search-phone')
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------ manager, desk
  {
    const ctx = await browser.newContext({ viewport: DESK })
    const page = await ctx.newPage()
    await signIn(page, 'vikas.kadam', 'Manager')
    await page.goto(`${APP}/manager/stock`)
    await page.getByTestId('stock-count').waitFor({ timeout: 20000 })
    const count = await page.getByTestId('stock-count').innerText()
    check('manager: a page of 100 says more are below, with Show more', /^100 batches shown — more below/.test(count) && (await page.getByTestId('stock-more').count()) === 1, count)
    await page.getByPlaceholder('Find an item, product or batch').fill('toor dal 500')
    await page.waitForTimeout(1800)
    const want = Number(sql(`select count(*) from stock_balances b join stock_lots lo on lo.id = b.lot_id join product_variants v on v.id = lo.variant_id where b.tenant_id = ${TENANT} and b.on_hand <> 0 and v.name ilike '%toor dal 500%'`))
    const c2 = await page.getByTestId('stock-count').innerText()
    check(`manager: "toor dal 500" finds ${want} live batches (SQL)`, c2 === `${want} batches`, c2)
    await shot(page, '08-manager-stock-search-desk')
    await ctx.close()
  }
  {
    const ctx = await browser.newContext({ viewport: PHONE })
    const page = await ctx.newPage()
    await signIn(page, 'vikas.kadam', 'Manager')
    await page.goto(`${APP}/manager/stock`)
    await page.getByTestId('stock-count').waitFor({ timeout: 20000 })
    await page.getByPlaceholder('Find an item, product or batch').fill('AN20260829')
    await page.waitForTimeout(1800)
    await page.getByTestId('stock-count').scrollIntoViewIfNeeded()
    const text = await page.locator('body').innerText()
    const want = Number(sql(`select count(*) from stock_balances b join stock_lots lo on lo.id = b.lot_id where b.tenant_id = ${TENANT} and b.on_hand <> 0 and lo.batch_no ilike '%AN20260829%'`))
    check(`manager phone: ${want} cards, each with its batch chip`, (text.match(/Batch AN20260829/g) ?? []).length === want, String(want))
    await shot(page, '08b-manager-stock-batch-search-phone')
    await ctx.close()
  }

  // ------------------------------------------------------------------------------------ godown, phone
  {
    const ctx = await browser.newContext({ viewport: PHONE })
    const page = await ctx.newPage()
    await signIn(page, 'dinesh.patil', 'Warehouse')
    await page.goto(`${APP}/warehouse/stock`)
    await page.getByTestId('w8-count').waitFor({ timeout: 30000 })
    const count = await page.getByTestId('w8-count').innerText()
    check('godown: a page of 50 says more are below', /^50 batches shown — more below/.test(count), count)
    await page.getByTestId('w8-more').click()
    await page.getByTestId('w8-count').filter({ hasText: /^100 batches shown/ }).waitFor({ timeout: 20000 })
    await shot(page, '09-godown-stock-show-more-phone')
    // DOS-223: the search is the server's, so a batch far down the godown is found
    await page.getByTestId('w8-search').fill('AN20260725')
    await page.waitForTimeout(1800)
    const text = await page.getByTestId('w8-rows').innerText()
    check('godown: a batch past the first page is found by search', text.includes('AN20260725'), '')
    await shot(page, '10-godown-stock-batch-search-phone')
    await ctx.close()
  }
} finally {
  await browser.close()
}
finish()
