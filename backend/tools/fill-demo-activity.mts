/**
 * `pnpm fill:demo` — dummy ACTIVITY on top of a distributor's real master data (docs/22 §8, 2026-09-28;
 * brief docs/plans/demo-activity-fill.md). A client of the RUNNING API: it signs in as the people who would
 * do each step and calls the same procedures the apps call. Dry run by default; `--commit` writes.
 *
 *   pnpm fill:demo --api http://127.0.0.1:3100 --tenant tarsun \
 *     --owner-password-file /opt/dos/env/live-owner.pw --logins-file /opt/dos/env/tester-logins.txt [--commit]
 *     [--owner-username owner.tarsun] [--date YYYY-MM-DD] [--report <file.json>]
 *
 * Every row it writes is marked (idempotency key `demo-fill:<date>:…`, an id derived from it with a fixed
 * tag); the same date run twice writes nothing the second time; a run that died midway is healed by the
 * next. Output is counts and ids only — never a shop's name, a phone number, a GSTIN or an address. The
 * tester passwords go to the logins file (mode 600) and nowhere else.
 *
 * Exit: 0 done (a refusal is counted, not fatal); 1 a whole row of the brief's table could not be produced;
 * 2 could not start (bad arguments, the API down, the owner could not sign in).
 */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { ApiRefusal } from './demo-fill/client.js'
import { assertIsoDate, todayIst } from './demo-fill/ids.js'
import { readPasswordFile } from './demo-fill/people.js'
import { runFill } from './demo-fill/run.js'

const HELP = `usage: fill-demo-activity.mts --api <url> --tenant <slug> --owner-password-file <path> --logins-file <path>
                               [--owner-username <name>] [--date YYYY-MM-DD] [--commit] [--report <file.json>]`

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

const { values: args } = parseArgs({
  options: {
    api: { type: 'string' },
    tenant: { type: 'string' },
    'owner-username': { type: 'string' },
    'owner-password-file': { type: 'string' },
    'logins-file': { type: 'string' },
    date: { type: 'string' },
    commit: { type: 'boolean', default: false },
    report: { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (args.help) {
  out(HELP)
  process.exit(0)
}
const fail = (message: string): never => {
  console.error(`fill:demo: ${message}`)
  console.error(HELP)
  process.exit(2)
}
const api = (args.api ?? '').replace(/\/$/, '')
const tenant = args.tenant ?? ''
const passwordFile = args['owner-password-file'] ?? ''
const loginsFile = args['logins-file'] ?? ''
if (!api || !tenant || !passwordFile || !loginsFile)
  fail('--api, --tenant, --owner-password-file and --logins-file are required')
let host = ''
try {
  host = new URL(api).hostname
} catch {
  fail(`--api is not a URL`)
}
// The tool talks to an API on the same machine: the server runs it against 127.0.0.1:3100.
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host) && !args['allow-remote'])
  fail(`--api must be on this machine (127.0.0.1); pass --allow-remote to override`)
const today = todayIst()
const date = args.date ?? today
try {
  assertIsoDate(date)
} catch {
  fail(`--date must be YYYY-MM-DD`)
}
if (date > today) fail(`--date ${date} has not come yet (today is ${today} IST)`)
let ownerPassword = ''
try {
  ownerPassword = readPasswordFile(passwordFile)
} catch {
  fail('cannot read the owner password file')
}

const started = Date.now()
try {
  const result = await runFill({
    api,
    tenant,
    ownerUsername: args['owner-username'] ?? `owner.${tenant}`,
    ownerPassword,
    loginsFile,
    date,
    commit: args.commit,
    log: (line) => out(line),
  })
  out()
  for (const line of result.summary.lines()) out(line)
  out(`done in ${String(Math.round((Date.now() - started) / 1000))} s; exit ${String(result.exitCode)}`)
  if (args.report)
    writeFileSync(
      args.report,
      `${JSON.stringify({ date, tenant, commit: args.commit, leadIn: result.leadIn, ...result.summary.toJSON() }, null, 2)}\n`,
    )
  process.exit(result.exitCode)
} catch (e) {
  console.error(
    `fill:demo: could not run — ${e instanceof ApiRefusal ? `the API answered ${e.label}` : e instanceof Error ? e.message : String(e)}`,
  )
  process.exit(2)
}
