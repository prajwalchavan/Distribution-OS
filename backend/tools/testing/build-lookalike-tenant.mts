/**
 * Build the LOOK-ALIKE TENANT on a test database (test only): a distributor made the way the real one was
 * made — `bootstrapTenant`, then the legacy importer's writer fed a SYNTHETIC plan (invented shops, items,
 * makers, suppliers and bills; `testing/lookalike.ts`) — with one owner login and nothing else.
 *
 *   DATABASE_URL=postgres://…/dos_test_fill pnpm --filter @dos/tools exec tsx testing/build-lookalike-tenant.mts \
 *     --slug tarsun --owner-username owner.tarsun --owner-password-file <path> [--as-of YYYY-MM-DD] [--hsn-stem 881100]
 *
 * REFUSES every database whose name does not begin `dos_test_`. The owner's password is read from the file
 * (or generated into it, mode 600, when the file does not exist yet) and never printed. Prints ids and counts
 * only. Idempotent: a second run finds everything and writes nothing.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createDb, createPool, loadDotenv } from '@dos/db'
import { businessDate } from '@dos/domain'
import { buildLookalikeTenant, databaseName, newPassword } from './lookalike.js'

const { values: args } = parseArgs({
  options: {
    slug: { type: 'string', default: 'tarsun' },
    'owner-username': { type: 'string', default: 'owner.tarsun' },
    'owner-password-file': { type: 'string' },
    'as-of': { type: 'string' },
    'hsn-stem': { type: 'string' },
    shops: { type: 'string' },
  },
})

loadDotenv()
const url = process.env.DATABASE_URL ?? ''
const name = databaseName(url)
if (!name?.startsWith('dos_test_')) {
  console.error(
    `build-lookalike-tenant: REFUSED — the database "${name ?? '(none)'}" does not begin dos_test_. This builder is for test databases only.`,
  )
  process.exit(2)
}
const passwordFile = args['owner-password-file']
if (!passwordFile) {
  console.error('build-lookalike-tenant: --owner-password-file <path> is required')
  process.exit(2)
}
if (!existsSync(passwordFile)) {
  writeFileSync(passwordFile, `${newPassword()}\n`, { mode: 0o600 })
}
chmodSync(passwordFile, 0o600)
const ownerPassword = readFileSync(passwordFile, 'utf8').trim()

const pool = createPool(url, 3)
const db = createDb(pool)
try {
  const result = await buildLookalikeTenant(db, {
    slug: args.slug,
    ownerUsername: args['owner-username'],
    ownerPassword,
    asOf: args['as-of'] ?? businessDate().date,
    ...(args['hsn-stem'] ? { hsnStem: args['hsn-stem'] } : {}),
    ...(args.shops ? { shops: Number(args.shops) } : {}),
  })
  const created = Object.values(result.write.steps).reduce((n, s) => n + s.created, 0)
  const failed = Object.values(result.write.steps).reduce((n, s) => n + s.failed, 0)
  console.warn(`look-alike tenant ${args.slug} (${result.tenantId}) on ${name}`)
  console.warn(`  plan: ${JSON.stringify(result.counts)}`)
  console.warn(
    `  written: ${String(created)} rows created, ${String(failed)} failed; steps ${JSON.stringify(
      Object.fromEntries(
        Object.entries(result.write.steps).map(([k, s]) => [k, `${String(s.created)}/${String(s.unchanged)}/${String(s.skipped)}/${String(s.failed)}`]),
      ),
    )} (created/unchanged/skipped/failed)`,
  )
  console.warn(`  owner password: in ${passwordFile} (mode 600, not printed)`)
  if (failed > 0) process.exitCode = 1
} finally {
  await pool.end()
}
