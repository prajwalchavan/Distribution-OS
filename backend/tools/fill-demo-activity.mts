/**
 * `pnpm fill:demo` — dummy ACTIVITY on top of a distributor's real master data (docs/22 §8, 2026-09-28;
 * brief docs/plans/demo-activity-fill.md). A client of the RUNNING API: it signs in as the people who would
 * do each step and calls the same procedures the apps call. Dry run by default; `--commit` writes.
 *
 *   pnpm fill:demo --api http://127.0.0.1:3100 --tenant tarsun \
 *     --owner-password-file /opt/dos/env/live-owner.pw --logins-file /opt/dos/env/tester-logins.txt [--commit]
 *     [--owner-username owner.tarsun] [--date YYYY-MM-DD] [--report <file.json>]
 *
 * `--date` (default today, IST) names the business date whose work is made and is part of every key; the
 * tool's work still open under an earlier date is finished first. Every row it writes is marked
 * (idempotency key `demo-fill:<date>:…`, an id derived from that key carrying a fixed tag); the same date run
 * twice writes nothing the second time; a run that died midway is healed by the next. Output is counts and
 * ids only — never a shop's name, a phone number, a GSTIN or an address. The tester logins are plain
 * (`manager`, `accounts`, `sales1`, `sales2`, `godown`, `driver1`, `driver2`) and each signs in with the demo
 * password the demo seed gives every demo user (founder, 2026-09-29); the logins file (mode 600) lists them with
 * it, and nothing else the tool writes or prints carries a password. The owner's password is never changed.
 *
 * Exit: 0 done (a refusal is counted, not fatal); 1 a whole row of the brief's table could not be produced;
 * 2 could not start (bad arguments, the API down, the owner could not sign in).
 */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { COMMON_OPTIONS, checkCommonArgs } from './demo-fill/args.js'
import { ApiRefusal } from './demo-fill/client.js'
import { readPasswordFile } from './demo-fill/people.js'
import { runFill } from './demo-fill/run.js'

const HELP = `usage: fill-demo-activity.mts --api <url> --tenant <slug> --owner-password-file <path> --logins-file <path>
                               [--owner-username <name>] [--date YYYY-MM-DD] [--commit] [--report <file.json>]
                               [--login-suffix <x>]   testers become manager.<x>, sales1.<x>, … (a second distributor on one database)`

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

const { values } = parseArgs({
  options: {
    ...COMMON_OPTIONS,
    commit: { type: 'boolean', default: false },
    report: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help) {
  out(HELP)
  process.exit(0)
}
const fail = (message: string): never => {
  console.error(`fill:demo: ${message}`)
  console.error(HELP)
  process.exit(2)
}
const args = checkCommonArgs(values)
if ('refused' in args) fail(args.refused)
else {
  let ownerPassword = ''
  try {
    ownerPassword = readPasswordFile(args.passwordFile)
  } catch {
    fail('cannot read the owner password file')
  }
  const started = Date.now()
  try {
    const result = await runFill({
      api: args.api,
      tenant: args.tenant,
      ownerUsername: args.ownerUsername,
      ownerPassword,
      loginsFile: args.loginsFile,
      date: args.date,
      commit: values.commit,
      loginSuffix: args.loginSuffix,
      log: (line) => {
        out(line)
      },
    })
    out()
    for (const line of result.summary.lines()) out(line)
    out(
      `done in ${String(Math.round((Date.now() - started) / 1000))} s; exit ${String(result.exitCode)}`,
    )
    if (values.report)
      writeFileSync(
        values.report,
        `${JSON.stringify(
          {
            date: args.date,
            tenant: args.tenant,
            commit: values.commit,
            leadIn: result.leadIn,
            ...result.summary.toJSON(),
          },
          null,
          2,
        )}\n`,
      )
    process.exit(result.exitCode)
  } catch (e) {
    console.error(
      `fill:demo: could not run — ${e instanceof ApiRefusal ? `the API answered ${e.label}` : e instanceof Error ? e.message : String(e)}`,
    )
    process.exit(2)
  }
}
