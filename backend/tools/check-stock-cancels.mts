/**
 * `pnpm check:stock-cancels` — the release check of QA DOS-257: does any cancelled bill still leave stock
 * behind that it never took out (or take back fewer pieces than it did)?
 *
 * Reads every tenant of `DATABASE_URL` (loaded through `loadDotenv()` like every script here, a real env var
 * wins) through `invoiceCancelFootprints` in @dos/db — the same SQL definition (`dos_invoice_cancel_footprints`)
 * migration 0072 wrote its write-off from — and prints one line per (bill, lot) that does not net to zero.
 * Since 0071 (and 0072) the database refuses a new one at commit and has already written off every invented piece that
 * was still standing where its cancel put it, so on a migrated database this normally prints nothing.
 *
 * `--write-off` runs 0072's write-off again first (`dos_write_off_invoice_cancel_phantoms`, idempotent), for a
 * database a phantom reached after its migration — a restored dump, a hand-written row. It needs a role that
 * bypasses row level security (the migration owner), like `pnpm db:migrate`.
 *
 * `written_off` means a hand write-off or count on that lot at that place has taken at least the footprint
 * off. `open` means somebody has to look: the pieces moved on before the write-off could take them.
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
  writeOffInvoiceCancelPhantoms,
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

const pool = createPool(url, 1)
try {
  const db = createDb(pool)
  if (process.argv.includes('--write-off')) {
    for (const w of await writeOffInvoiceCancelPhantoms(db)) {
      say(
        `WROTE OFF   ${w.invoiceNo}  lot ${w.lotId} at ${w.locationId}: ${String(w.writtenPcs)} of ${String(w.footprintPcs)} pc (${String(w.takenOffPcs)} taken off by hand before, ${String(w.onHandPcs)} were there)`,
      )
    }
  }
  const rows = await invoiceCancelFootprints(db)
  if (process.argv.includes('--json')) {
    say(JSON.stringify(rows, null, 2))
  } else if (rows.length === 0) {
    say('every cancelled bill nets to zero stock: nothing to write off')
  } else {
    for (const r of rows) {
      const what = `${r.tenantSlug}  ${r.invoiceNo ?? r.invoiceId}  ${r.variantName} batch ${r.batchNo || '-'} at ${r.locationName ?? 'no location'}`
      const how =
        r.footprintPcs > 0
          ? `+${String(r.footprintPcs)} pc the bill never took out; ${String(r.writtenOffPcs)} written off since`
          : `${String(r.footprintPcs)} pc: the cancel put back fewer than the bill took out`
      say(`${r.status.toUpperCase().padEnd(11)} ${what}: ${how}`)
      say(`            cancel rows ${r.cancelRowIds.join(', ')}`)
      if (r.writeOffRowIds.length > 0)
        say(`            write-off rows ${r.writeOffRowIds.join(', ')}`)
    }
  }
  const open = rows.filter((r) => r.status === 'open').length
  if (open > 0) {
    console.error(
      `${String(open)} open: the pieces had moved on before the write-off; count that batch and correct it on Stock`,
    )
    process.exitCode = 1
  }
} finally {
  await pool.end()
}
