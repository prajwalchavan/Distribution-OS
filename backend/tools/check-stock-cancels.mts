/**
 * `pnpm check:stock-cancels` — the release check of QA DOS-257: does any cancelled bill still leave stock
 * behind that it never took out (or take back fewer pieces than it did)?
 *
 * Reads every tenant of `DATABASE_URL` (loaded through `loadDotenv()` like every script here, a real env var
 * wins) through `invoiceCancelFootprints` in @dos/db and prints one line per (bill, lot) whose `invoice` and
 * `invoice_cancel` ledger rows do not net to zero. Since migration 0071 the database refuses a new one at
 * commit, so what this finds was written before it — the simulation's INV/9034 toor is the known case.
 *
 * `written_off` means a later hand write-off or count on that lot at that place has taken at least the
 * footprint off again (the stock screen's "Take off", ideally with the bill number in the note). `open`
 * means the pieces are still in the books: the owner or manager writes them off on Stock → the batch row →
 * Adjust → Take off, reason "Adjustment", with the bill number in the note, and this check then passes.
 *
 * Exit code 1 while any footprint is open, 0 otherwise. `--json` prints the rows instead of sentences.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDb,
  createPool,
  invoiceCancelFootprints,
  loadDotenv,
} from '../libs/database/src/index.js'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
loadDotenv(root)
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set (backend/.env or the environment)')
  process.exit(2)
}

const pool = createPool(url, 1)
try {
  const rows = await invoiceCancelFootprints(createDb(pool))
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2))
  } else if (rows.length === 0) {
    console.log('every cancelled bill nets to zero stock: nothing to write off')
  } else {
    for (const r of rows) {
      const what = `${r.tenantSlug}  ${r.invoiceNo ?? r.invoiceId}  ${r.variantName} batch ${r.batchNo || '-'} at ${r.locationName ?? 'no location'}`
      const how =
        r.footprintPcs > 0
          ? `+${String(r.footprintPcs)} pc the bill never took out; ${String(r.writtenOffPcs)} written off since`
          : `${String(r.footprintPcs)} pc: the cancel put back fewer than the bill took out`
      console.log(`${r.status.toUpperCase().padEnd(11)} ${what}: ${how}`)
      console.log(`            cancel rows ${r.cancelRowIds.join(', ')}`)
      if (r.writeOffRowIds.length > 0)
        console.log(`            write-off rows ${r.writeOffRowIds.join(', ')}`)
    }
  }
  const open = rows.filter((r) => r.status === 'open').length
  if (open > 0) {
    console.error(`${String(open)} open: write them off on Stock (see the header of this script)`)
    process.exitCode = 1
  }
} finally {
  await pool.end()
}
