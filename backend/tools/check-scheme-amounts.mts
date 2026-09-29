/**
 * `pnpm check:scheme-amounts` — the release check of QA DOS-330 (docs/22 §8, 2026-09-28, prices and tax ruling 1):
 * do a bill's scheme amounts add up to its discount?
 *
 * Reads every tenant of `DATABASE_URL` (loaded through `loadDotenv()` like every script here, a real env var wins)
 * through `schemeAmountFaults` in @dos/db — the same SQL definition (`invoiceRulesGiven`) the claim builder, the
 * scheme-spend register and the owner's daily figures read with — and prints one line per bill whose scheme
 * amounts and discount disagree:
 *
 *   COPIES       written before 2026-09-29 with each scheme copied whole onto every batch line of an order line;
 *                the readers count it once and get the discount. Information: the bill stays as issued.
 *   OLD DIFFERS  written before, and even counted once its rules are not its discount (a short pack of that time
 *                billed less than the order line's rule). Information: the readers count the order line's rule.
 *   DIFFERS      written since, and its batch lines' shares do not add up to its discount. A fault.
 *
 * Exit code 1 while any bill DIFFERS, 0 otherwise (a fresh seed prints nothing). `--json` prints the rows.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, createPool, loadDotenv, schemeAmountFaults } from '../libs/database/src/index.js'

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
const rupees = (p: number): string => `₹${(p / 100).toFixed(2)}`

const pool = createPool(url, 1)
try {
  const rows = await schemeAmountFaults(createDb(pool))
  if (process.argv.includes('--json')) {
    say(JSON.stringify(rows, null, 2))
  } else if (rows.length === 0) {
    say('every bill’s scheme amounts add up to its discount')
  } else {
    for (const r of rows) {
      const label = r.status === 'old_differs' ? 'OLD DIFFERS' : r.status.toUpperCase()
      say(
        `${label.padEnd(12)} ${r.tenantSlug}  ${r.invoiceNo ?? r.invoiceId}  ${r.invoiceDate}: discount ${rupees(r.discountPaise)}, scheme amounts as written ${rupees(r.storedPaise)}, as read once per order line ${rupees(r.readPaise)}`,
      )
    }
  }
  const failing = rows.filter((r) => r.status === 'differs').length
  if (failing > 0) {
    console.error(
      `${String(failing)} bill(s) written since the fix whose scheme shares do not add up to their discount: the bill is right, the claim and the scheme spend read the shares — report it`,
    )
    process.exitCode = 1
  }
} finally {
  await pool.end()
}
