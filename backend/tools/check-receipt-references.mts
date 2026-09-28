/**
 * `pnpm check:receipt-references` — the release check of QA DOS-310: does any payment reference stand on more
 * than one live receipt?
 *
 * Reads every tenant of `DATABASE_URL` (loaded through `loadDotenv()` like every script here, a real env var wins)
 * through `receiptReferenceReport` in @dos/db — the SQL definition `dos_receipt_reference_duplicates` (migration
 * 0079) the spec reads too, or, on a database the migration has not reached yet (a read-only look at a copy of live
 * before the deploy), the same query sent inline — in a READ ONLY transaction, and prints one line per reference:
 *
 *   TRANSFER    a UPI / bank-transfer reference (UTR) on several live receipts of one distributor: money booked
 *               more than once, unless all but one are reversed;
 *   CHEQUE      a cheque number on several live receipts of the SAME shop: the same;
 *   SHOPS       one cheque number on live receipts of several shops — each confirmed at the desk as a different
 *               cheque. Information only.
 *
 * Since 0079 the service refuses a new duplicate at every door and the database refuses what gets past it, so on a
 * migrated database this lists only history that was there before (imported, or recorded before the fix). The
 * desk reverses the receipt that was never paid (`receipts.reverse`), which frees the reference.
 *
 * Exit code 1 while any TRANSFER or CHEQUE line stands, 0 otherwise. `--json` prints the rows instead.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatINR, paise } from '../libs/domain/src/index.js'
import {
  createDb,
  createPool,
  loadDotenv,
  receiptReferenceReport,
} from '../libs/database/src/index.js'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
loadDotenv(root)
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set (backend/.env or the environment)')
  process.exit(2)
}

/** stdout, one line: the report IS the output (no-console allows only warn and error). */
const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const LABEL = { transfer: 'TRANSFER', cheque_same_shop: 'CHEQUE', cheque_shops: 'SHOPS' } as const

const pool = createPool(url, 1)
try {
  const db = createDb(pool)
  const { source, duplicates: rows } = await receiptReferenceReport(db)
  if (source === 'inline') {
    console.warn(
      'this database has not reached migration 0079: the check ran its query inline, read-only',
    )
  }
  if (process.argv.includes('--json')) {
    say(JSON.stringify(rows, null, 2))
  } else if (rows.length === 0) {
    say('every payment reference stands on one live receipt: nothing booked twice')
  } else {
    for (const r of rows) {
      const what =
        r.kind === 'transfer'
          ? `UPI / transfer reference ${r.reference}`
          : r.kind === 'cheque_same_shop'
            ? `cheque ${r.reference} of one shop`
            : `cheque number ${r.reference} used by ${String(r.retailerIds.length)} shops`
      say(
        `${LABEL[r.kind].padEnd(9)} ${r.tenantSlug}  ${what}: ${String(r.receiptIds.length)} live receipts, ${formatINR(paise(r.amountPaise))} in all (${r.receiptNos.join(', ')})`,
      )
    }
  }
  const failing = rows.filter((r) => r.failing).length
  if (failing > 0) {
    console.error(
      `${String(failing)} reference(s) booked more than once: reverse the receipt that was never paid on Money → Receipts`,
    )
    process.exitCode = 1
  }
} finally {
  await pool.end()
}
