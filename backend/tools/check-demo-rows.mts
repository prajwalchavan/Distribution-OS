/**
 * `pnpm check:demo-rows` — the marker check (brief docs/plans/demo-activity-fill.md, rules 2, 3 and 7).
 * READS the database named by `DATABASE_URL` (loaded through `loadDotenv()` like every script here; a real
 * env var wins) inside ONE read-only transaction that is rolled back, and prints:
 *
 *  - the tool's rows by kind, found by the tag in their id, and the rows the API made from them;
 *  - rule 3: no money of the tool on a bill it did not make, nothing of the tool on an opening bill;
 *  - rule 7: stock ledger = balances, every journal entry balances, each shop's dues = its bills less its
 *    receipts, credit notes and write-offs to the paisa, and the dues add up to the ledger's receivables.
 *
 *   pnpm check:demo-rows --tenant tarsun [--expect <run.json> ...] [--baseline <before.json>] [--json <file>]
 *
 * `--expect` takes the reports `pnpm fill:demo --report` wrote (one per run, any number) and fails unless
 * the rows found of each kind are exactly what the runs said they made — on top of `--baseline`, this
 * check's own `--json` taken before those runs (so a nightly run is proved against the night before).
 * Output is counts and ids only.
 *
 * Exit: 0 all holds; 1 a rule is broken or a count differs from the reports; 2 could not start.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createPool, loadDotenv } from '@dos/db'
import {
  DEMO_ID_LIKE,
  DERIVED_KINDS,
  OPENING_BILLS_SQL,
  TOOL_KINDS,
  VIOLATIONS,
  expectedFromReports,
} from './demo-fill/rows.js'

const say = (line = ''): void => {
  process.stdout.write(`${line}\n`)
}
function stop(message: string): never {
  console.error(`check:demo-rows: ${message}`)
  process.exit(2)
}

const { values } = parseArgs({
  options: {
    tenant: { type: 'string' },
    expect: { type: 'string', multiple: true },
    baseline: { type: 'string' },
    json: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})
if (values.help) {
  say(
    'usage: check-demo-rows.mts --tenant <slug> [--expect <run.json> ...] [--baseline <before.json>] [--json <file>]',
  )
  process.exit(0)
}
const slug = values.tenant ?? stop('--tenant <slug> is required')
/** An earlier `--json` of this check: the rows that were there before the runs of `--expect`. */
const baseline: Record<string, number> = values.baseline
  ? (() => {
      try {
        const b = JSON.parse(readFileSync(values.baseline, 'utf8')) as {
          kinds?: Record<string, number>
        }
        return b.kinds ?? {}
      } catch {
        return stop(`cannot read the baseline ${values.baseline}`)
      }
    })()
  : {}
const reports = (values.expect ?? []).map((path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { made?: Record<string, number> }
  } catch {
    return stop(`cannot read the report ${path}`)
  }
})

loadDotenv(resolve(fileURLToPath(new URL('.', import.meta.url)), '..'))
const url =
  process.env.DATABASE_URL ?? stop('DATABASE_URL is not set (backend/.env or the environment)')

const pool = createPool(url, 1)
const client = await pool.connect()
let failures = 0
try {
  await client.query('begin transaction isolation level repeatable read read only')
  const tenant = await client.query<{ id: string }>('select id from tenants where slug = $1', [
    slug,
  ])
  const tenantId = tenant.rows[0]?.id ?? stop(`no distributor "${slug}" in this database`)
  const count = async (sql: string): Promise<number> =>
    (await client.query<{ n: number }>(sql, [tenantId, DEMO_ID_LIKE])).rows[0]?.n ?? 0

  say(`distributor ${slug} (${tenantId}): rows the tool made`)
  const found = new Map<string, number>()
  for (const k of TOOL_KINDS) {
    const n = await count(k.sql)
    found.set(k.kind, n)
    say(`  ${k.kind.padEnd(44)} ${String(n)}`)
  }
  say('rows the API made from them, and real rows they touch')
  const derived: Record<string, number> = {}
  for (const k of DERIVED_KINDS) {
    derived[k.kind] = await count(k.sql)
    say(`  ${k.kind.padEnd(44)} ${String(derived[k.kind])}`)
  }
  const opening = (
    await client.query<{ bills: number; open_paise: string }>(OPENING_BILLS_SQL, [tenantId])
  ).rows[0]
  say(
    `bills without an order (the opening bills): ${String(opening?.bills ?? 0)}, open ${String(opening?.open_paise ?? 0)} paise`,
  )

  say('rules')
  const broken: { rule: string; what: string; ids: string[] }[] = []
  for (const v of VIOLATIONS) {
    const params = v.sql.includes('$2') ? [tenantId, DEMO_ID_LIKE] : [tenantId]
    const ids = (await client.query<{ id: string }>(v.sql, params)).rows.map((r) => r.id)
    if (ids.length > 0) {
      failures++
      broken.push({ rule: v.rule, what: v.what, ids })
    }
    say(
      ids.length === 0
        ? `  ok   rule ${v.rule}: ${v.holds}`
        : `  FAIL rule ${v.rule}: ${v.what}: ${ids.join(', ')}`,
    )
  }

  const mismatches: { kind: string; found: number; reported: number }[] = []
  if (reports.length > 0) {
    say(`against ${String(reports.length)} run report(s)`)
    for (const [kind, made] of expectedFromReports(reports)) {
      const reported = (baseline[kind] ?? 0) + made
      const n = found.get(kind) ?? 0
      if (n !== reported) {
        failures++
        mismatches.push({ kind, found: n, reported })
      }
      say(
        `  ${n === reported ? 'ok  ' : 'FAIL'} ${kind.padEnd(40)} found ${String(n)}, ${values.baseline ? `${String(baseline[kind] ?? 0)} before + ` : ''}the runs made ${String(made)}`,
      )
    }
  }
  if (values.json)
    writeFileSync(
      values.json,
      `${JSON.stringify(
        {
          tenant: slug,
          kinds: Object.fromEntries(found),
          derived,
          openingBills: opening ?? null,
          broken,
          mismatches,
        },
        null,
        2,
      )}\n`,
    )
  say()
  say(failures === 0 ? 'every rule holds' : `${String(failures)} failure(s)`)
} finally {
  await client.query('rollback').catch(() => undefined)
  client.release()
  await pool.end()
}
process.exit(failures > 0 ? 1 : 0)
