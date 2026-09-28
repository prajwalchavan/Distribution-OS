/**
 * `pnpm check:stock-negative` — the release check of QA DOS-350: does any place still show a balance below zero?
 *
 * No place goes below zero, the damaged / expiry bin included (architect ruling 1, 2026-09-28). Migration 0075
 * cleared the bin's "may go negative" flag everywhere and refuses it from then on; a balance that was ALREADY below
 * zero was left as it was (nothing is invented) and is listed here — one line per (item, batch, place) with the
 * pieces the books show — so the owner can count that place and correct it (Stock → Counts, or an adjustment with a
 * reason). Reads every tenant of `DATABASE_URL` (loaded through `loadDotenv()` like every script here, a real env
 * var wins) through `stockBelowZero` in @dos/db — the same SQL (`dos_stock_below_zero`) the specs read.
 *
 * It also prints, as a warning that does not fail the check, every posted receipt line merged before migration 0074
 * into a lot with ANOTHER expiry (QA DOS-356): such a lot's stock screens show one expiry for pieces that carry two,
 * and only a count can separate them.
 *
 * `--clear-flags` first runs 0075's correction again (`dos_clear_negative_flags`, idempotent) — for a database
 * restored from a dump taken before 0075. It needs a role that bypasses row level security (the migration owner),
 * like `pnpm db:migrate`.
 *
 * Exit code 1 while any balance is below zero, 0 otherwise. `--json` prints the rows instead of sentences.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clearNegativeFlags,
  createDb,
  createPool,
  loadDotenv,
  receiptsMergedAcrossExpiry,
  stockBelowZero,
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
  if (process.argv.includes('--clear-flags')) {
    const cleared = await clearNegativeFlags(db)
    say(
      `CLEARED     ${String(cleared.binsCleared)} bin flag(s), ${String(cleared.balancesCleared)} balance flag(s); ${String(cleared.balancesKeptBelowZero)} balance(s) below zero keep theirs until counted`,
    )
  }
  const below = await stockBelowZero(db)
  const merged = await receiptsMergedAcrossExpiry(db)
  if (process.argv.includes('--json')) {
    say(JSON.stringify({ belowZero: below, mergedAcrossExpiry: merged }, null, 2))
  } else {
    if (below.length === 0) say('no place shows a balance below zero')
    for (const b of below) {
      const batch = b.batchNo ? ` batch ${b.batchNo}` : ' (no batch)'
      const expiry = b.expiryDate ? `, expiry ${b.expiryDate}` : ''
      say(
        `BELOW ZERO  ${b.tenantSlug}  ${b.locationName} (${b.locationKind}): ${String(b.onHandPcs)} pc of ${b.variantName}${batch}${expiry}; count ${b.locationName} and correct it`,
      )
      say(`            lot ${b.lotId} at ${b.locationId}`)
    }
    for (const m of merged) {
      const batch = m.batchNo ? `batch ${m.batchNo}` : 'no batch'
      say(
        `WARN        ${m.tenantSlug}  ${m.variantName} (${batch}): ${m.grnNo ?? m.grnId} received ${String(m.receivedPcs)} pc expiring ${m.lineExpiry} into a lot that shows ${m.lotExpiry ?? 'no expiry'}; count that lot and separate the pieces`,
      )
    }
  }
  if (below.length > 0) {
    console.error(
      `${String(below.length)} balance(s) below zero: count each place and correct it on Stock before release`,
    )
    process.exitCode = 1
  }
} finally {
  await pool.end()
}
