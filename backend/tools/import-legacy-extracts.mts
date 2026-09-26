/**
 * Load the legacy software's extracts (TradeEzee: product list, customer master, outstanding report, GST
 * sales register, and optionally its SQL Server backup) into a Distribution OS distributor.
 *
 *   pnpm import:legacy --dir <folder> --tenant tarsun                 dry run: plan + report, writes nothing
 *   pnpm import:legacy --dir <folder> --tenant tarsun --commit        write, through the application's services
 *   pnpm import:legacy --dir <folder> --tenant tarsun --commit --opening-stock
 *
 * Read `docs/32-legacy-import.md` first: what each file gives, the column → field mapping, what is NOT
 * imported and why, and the decisions the founder still owes. The files are READ ONLY and are never copied,
 * embedded or echoed: the report prints counts, never a name, a phone number or a GSTIN.
 *
 * Idempotent: every row's id is derived from its legacy key (ITEM_CODE, CASH_ACC, BOOK_CODE+SAL_YEAR+BILL_NO),
 * so a second run finds everything and changes nothing — and never overwrites what the distributor edited in
 * the app since the first load.
 *
 * Needs `DATABASE_URL` (or `backend/.env`), a MIGRATED database and a bootstrapped distributor
 * (`infra/docker/bootstrap.mjs`: tenant, owner, chart of accounts, locations, numbering series).
 */
/* eslint-disable no-console -- a command-line tool: its report goes to the terminal */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { readXlsx } from '@dos/core/modules/integrations'
import { createDb, createPool, loadDotenv } from '@dos/db'
import { deriveOpenBills, readBakData, type BakData, type DerivedBills } from './legacy/bak-data.js'
import { mergeCustomers, parseCustomerMasterText } from './legacy/customers.js'
import { SqlBackup } from './legacy/mssql-bak.js'
import { outstandingRecords, parseOutstandingRows } from './legacy/outstanding.js'
import { reconcileBills } from './legacy/reconcile.js'
import { buildPlan, DEFAULT_HSN_FALLBACK } from './legacy/plan.js'
import { readCustomerMasterText } from './legacy/pdf-text.js'
import { parseProductRows, productRecords } from './legacy/products.js'
import { buildReport, formatIssueRefs, formatReport, type Sources } from './legacy/report.js'
import { parseSalesGstRows, salesGstFacts, salesGstRecords } from './legacy/sales-gst.js'
import type { Issue, LegacyBill, LegacySalesGstRow } from './legacy/types.js'
import { findTenant, writePlan } from './legacy/writer.js'

const HELP = `usage: import-legacy-extracts.mts [--dir <folder>] [--products f] [--outstanding f] [--customers f]
                                  [--sales-gst f] [--bak f] [--tenant <slug>] [--commit] [--opening-stock]
                                  [--outstanding-from-backup]
                                  [--as-of YYYY-MM-DD] [--rates-from YYYY-MM-DD]
                                  [--hsn-fallback 4000=2202,500=22029920 | --no-hsn-fallback]
                                  [--default-state 27] [--report <file.json>] [--issues]

  --dir             folder holding CompanywiseProductList.xlsx, DateWiseOutStanding.xlsx, SalesGstGSTWISE.xlsx,
                    "customer data whole pdf.pdf" and, optionally, TE2627.bak (each can be named on its own)
  --commit          write to the database (default: dry run — plan and report only)
  --opening-stock   also post the backup's closing stock as opening lots (needs --bak)
  --outstanding-from-backup
                    build the opening bills from the backup's own ledger as of --as-of (bills and receipts
                    up to the end of that day) instead of the outstanding report; needs --bak
  --rates-from      effective date of new/changed HSN rate rows (default 2025-09-22, the GST 2.0 slab date)
  --hsn-fallback    heading to use for items the list gives no HSN, by GST rate in basis points
  --issues          print where each issue is (sheet:row), for the terminal only`

const { values: args } = parseArgs({
  options: {
    dir: { type: 'string' },
    products: { type: 'string' },
    outstanding: { type: 'string' },
    customers: { type: 'string' },
    'sales-gst': { type: 'string' },
    bak: { type: 'string' },
    tenant: { type: 'string' },
    commit: { type: 'boolean', default: false },
    'opening-stock': { type: 'boolean', default: false },
    'outstanding-from-backup': { type: 'boolean', default: false },
    'as-of': { type: 'string' },
    'rates-from': { type: 'string' },
    'hsn-fallback': { type: 'string' },
    'no-hsn-fallback': { type: 'boolean', default: false },
    'default-state': { type: 'string', default: '27' },
    report: { type: 'string' },
    issues: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (args.help) {
  console.log(HELP)
  process.exit(0)
}

function pick(explicit: string | undefined, file: string, required: boolean): string | null {
  const path = explicit ?? (args.dir ? join(args.dir, file) : undefined)
  if (!path) {
    if (required) throw new Error(`name the ${file} file (--dir <folder> or its own flag)\n${HELP}`)
    return null
  }
  if (!existsSync(path)) {
    if (required) throw new Error(`${basename(path)} not found at ${path}`)
    return null
  }
  return resolve(path)
}

function sheet(path: string): string[][] {
  const wb = readXlsx(readFileSync(path))
  const s = wb.sheet()
  if (!s) throw new Error(`${basename(path)} has no sheet`)
  return s.rows
}

/** Today in IST as an ISO date (the business calendar is IST, whatever this machine's clock says). */
function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
}

function parseFallback(): ReadonlyMap<number, string> | null {
  if (args['no-hsn-fallback']) return null
  const raw = args['hsn-fallback']
  if (!raw) return DEFAULT_HSN_FALLBACK
  const map = new Map<number, string>()
  for (const part of raw.split(',')) {
    const [bps, hsn] = part.split('=')
    if (!bps || !hsn || !/^\d+$/.test(bps) || !/^\d{4,8}$/.test(hsn))
      throw new Error(
        `--hsn-fallback wants bps=hsn pairs like 4000=2202,500=22029920 (got "${part}")`,
      )
    map.set(Number(bps), hsn)
  }
  return map
}

async function main(): Promise<void> {
  const asOf = args['as-of'] ?? todayIst()
  const ratesFrom = args['rates-from'] ?? '2025-09-22'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !/^\d{4}-\d{2}-\d{2}$/.test(ratesFrom))
    throw new Error('--as-of and --rates-from are ISO dates (YYYY-MM-DD)')

  const productsPath = pick(args.products, 'CompanywiseProductList.xlsx', true)
  const fromBackup = args['outstanding-from-backup'] === true
  const outstandingPath = pick(args.outstanding, 'DateWiseOutStanding.xlsx', !fromBackup)
  const customersPath = pick(args.customers, 'customer data whole pdf.pdf', true)
  const salesGstPath = pick(args['sales-gst'], 'SalesGstGSTWISE.xlsx', false)
  const bakPath = pick(args.bak, 'TE2627.bak', false)
  if (!productsPath || !customersPath) throw new Error('missing input')
  if (fromBackup && !bakPath)
    throw new Error('--outstanding-from-backup needs --bak (or --dir holding TE2627.bak)')

  // ------------------------------------------------------------------------------------------ parse
  const parseIssues: Issue[] = []
  const productRows = sheet(productsPath)
  const products = parseProductRows(productRecords(productRows))
  parseIssues.push(...products.issues)
  const outstandingRows = outstandingPath ? sheet(outstandingPath) : [[]]
  const sheetBills = outstandingPath
    ? parseOutstandingRows(outstandingRecords(outstandingRows))
    : { items: [] as LegacyBill[], issues: [] as Issue[] }
  if (!fromBackup) parseIssues.push(...sheetBills.issues)
  const pdf = parseCustomerMasterText(readCustomerMasterText(customersPath))
  parseIssues.push(...pdf.issues)

  let salesGst: LegacySalesGstRow[] = []
  let salesGstSource: Sources['salesGst'] = null
  if (salesGstPath) {
    const rows = sheet(salesGstPath)
    const parsed = parseSalesGstRows(salesGstRecords(rows))
    parseIssues.push(...parsed.issues)
    salesGst = parsed.items
    salesGstSource = { rows: rows.length - 1, facts: salesGstFacts(parsed.items) }
  }

  let bak: BakData | null = null
  let backup: SqlBackup | null = null
  if (bakPath) {
    const buffer = readFileSync(bakPath)
    if (!SqlBackup.isMtf(buffer))
      throw new Error(`${basename(bakPath)} is not a SQL Server backup (no MTF header)`)
    backup = new SqlBackup(buffer)
    bak = readBakData(backup)
  }
  const merged = mergeCustomers(pdf.items, bak?.customers ?? [])

  // The opening bills: the report, or the backup's ledger rebuilt for the day. When both exist they are
  // compared for the REPORT's last bill date, which says how far the report can be trusted.
  let bills = sheetBills
  let rebuilt: DerivedBills['facts'] | null = null
  let reconciliation = null
  if (backup && outstandingPath && sheetBills.items.length > 0) {
    const reportEnd =
      sheetBills.items
        .map((b) => b.billDate)
        .sort()
        .at(-1) ?? asOf
    const theirs = deriveOpenBills(backup, reportEnd)
    if (!('unsupported' in theirs)) reconciliation = reconcileBills(sheetBills.items, theirs.bills)
  }
  if (fromBackup && backup) {
    const derived = deriveOpenBills(backup, asOf)
    if ('unsupported' in derived)
      throw new Error(`cannot rebuild the outstanding from the backup: ${derived.unsupported}`)
    bills = { items: derived.bills, issues: [] }
    rebuilt = derived.facts
  }

  // ------------------------------------------------------------------------------------------- plan
  const plan = buildPlan(
    {
      items: products.items,
      ...(bak ? { itemExtras: bak.itemExtras } : {}),
      customers: merged.customers,
      bills: bills.items,
      salesGst,
    },
    { asOf, ratesFrom, hsnFallback: parseFallback(), defaultState: args['default-state'] ?? '27' },
  )

  const sources: Sources = {
    products: { rows: productRows.length - 1, parsed: products.items.length },
    outstanding: {
      source: fromBackup ? 'backup' : 'sheet',
      rows: Math.max(0, outstandingRows.length - 1),
      parsed: bills.items.length,
      reconciliation,
      rebuilt,
    },
    customers: { parsed: merged.customers.length },
    salesGst: salesGstSource,
    backup: bak ? bak.facts : null,
    backupUnsupported: bak ? bak.unsupported.length : 0,
  }

  // ------------------------------------------------------------------------------------------ write
  const allIssues = [...parseIssues, ...plan.issues]
  let written = null
  if (args.commit) {
    if (!args.tenant) throw new Error('--commit needs --tenant <slug>')
    loadDotenv()
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    console.log(
      `writing to database ${url.slice(url.lastIndexOf('/') + 1).replace(/\?.*$/, '')}, distributor ${args.tenant}`,
    )
    const pool = createPool(url, 4)
    try {
      const db = createDb(pool)
      const tenant = await findTenant(db, args.tenant)
      written = await writePlan(db, tenant, plan, {
        asOf,
        ratesFrom,
        openingStock: args['opening-stock'] === true,
        suppliers: bak?.suppliers ?? [],
        log: (line) => console.log(line),
      })
    } finally {
      await pool.end()
    }
  } else if (args['opening-stock']) console.log('note: --opening-stock only applies with --commit')

  const report = buildReport({
    mode: args.commit ? 'commit' : 'dry-run',
    asOf,
    plan,
    parseIssues,
    sources,
    written,
  })
  console.log(formatReport(report))
  if (args.issues) console.log(`\nISSUE LOCATIONS\n${formatIssueRefs(allIssues)}`)
  if (written && written.failures.length > 0) {
    console.log(`\nFAILURES (${String(written.failures.length)})`)
    for (const f of written.failures.slice(0, 20)) console.log(`  ${f}`)
  }
  if (args.report) {
    writeFileSync(resolve(args.report), `${JSON.stringify(report, null, 2)}\n`)
    console.log(`\nreport written to ${args.report}`)
  }
  if (
    written &&
    (written.failures.length > 0 || (report.reconciliation && !report.reconciliation.equal))
  )
    process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
