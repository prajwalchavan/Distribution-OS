/**
 * `pnpm check:demo-coverage` — does every role open on work? (brief docs/plans/demo-activity-fill.md, the
 * second table). Signs in as the owner, finds the tool's tester logins by the tool's mark (as the tool does),
 * signs each in with the demo password — a tester asked to change it is a gap — checks that the logins file lists
 * it, reads through the API what each role's screens read (`demo-fill/coverage.ts`), and prints one line per
 * feature of the brief's table: `ok` or `GAP`, with a detail made of counts and usernames only — never a shop's
 * name, a phone, a GSTIN or an address, never a password.
 *
 *   pnpm check:demo-coverage --api http://127.0.0.1:3100 --tenant tarsun \
 *     --owner-password-file /opt/dos/env/live-owner.pw --logins-file /opt/dos/env/tester-logins.txt \
 *     [--owner-username owner.tarsun] [--date YYYY-MM-DD] [--json <file>]
 *
 * `--date` is the business date the tool made (default today, IST). A feature no role can have through the
 * API (a shopkeeper's login, DOS-400) is printed as a known gap and does not fail the check.
 *
 * Exit: 0 every role has its work; 1 the gap list is not empty; 2 could not start (arguments, the API down,
 * a sign-in refused).
 */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { COMMON_OPTIONS, checkCommonArgs } from './demo-fill/args.js'
import { Api, ApiRefusal, type Session } from './demo-fill/client.js'
import { allRows, type CoverageSessions } from './demo-fill/coverage.js'
import { contract } from '@dos/contracts'
import {
  DEMO_PASSWORD,
  TESTERS,
  readLogins,
  readPasswordFile,
  sortStaff,
  type TesterKey,
} from './demo-fill/people.js'
import { KNOWN_GAPS } from './demo-fill/summary.js'

const HELP = `usage: check-demo-coverage.mts --api <url> --tenant <slug> --owner-password-file <path> --logins-file <path>
                                [--owner-username <name>] [--date YYYY-MM-DD] [--json <file>] [--login-suffix <x>]`

const say = (line = ''): void => {
  process.stdout.write(`${line}\n`)
}
function stop(message: string): never {
  console.error(`check:demo-coverage: ${message}`)
  process.exit(2)
}

const { values } = parseArgs({
  options: {
    ...COMMON_OPTIONS,
    json: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})
if (values.help) {
  say(HELP)
  process.exit(0)
}
const args = checkCommonArgs(values)
if ('refused' in args) {
  console.error(HELP)
  stop(args.refused)
}

const SESSION_OF: Record<TesterKey, keyof CoverageSessions> = {
  manager: 'manager',
  accounts: 'accountant',
  sales1: 'sales1',
  sales2: 'sales2',
  godown: 'godown',
  driver1: 'driver1',
  driver2: 'driver2',
}

const api = new Api(args.api, 'Coverage check')
if (!(await api.health())) stop(`the API at ${args.api} does not answer /health`)
let ownerPassword = ''
try {
  ownerPassword = readPasswordFile(args.passwordFile)
} catch {
  stop('cannot read the owner password file')
}
const logins = readLogins(args.loginsFile)
if (logins.size === 0)
  stop('the logins file is missing or empty: run pnpm fill:demo --commit first')

const opened: Session[] = []
const signIn = async (username: string, password: string): Promise<Session> => {
  try {
    const s = await api.signIn(username, password, args.tenant)
    opened.push(s)
    return s
  } catch (e) {
    return stop(
      `${username} could not sign in (${e instanceof ApiRefusal ? e.label : 'no answer'})`,
    )
  }
}

let failed = 0
const gap = (line: string): void => {
  say(`GAP  people      ${line}`)
  failed++
}
try {
  const owner = await signIn(args.ownerUsername, ownerPassword)
  const sessions: CoverageSessions = { owner }
  const staff = await api.call(owner, contract.tenancy.staff.list, {})
  const { crew } = sortStaff(owner.tenantId, staff.items, args.loginSuffix)
  for (const t of TESTERS) {
    const member = crew.get(t.key)
    if (!member?.username) {
      gap(`${t.key}: no tester login of the tool`)
      continue
    }
    const username = member.username
    const line = logins.get(username)
    if (!line) gap(`${username}: not in the logins file`)
    else if (line.role !== t.role) gap(`${username}: the logins file says ${line.role}, not ${t.role}`)
    else if (line.password !== DEMO_PASSWORD)
      gap(`${username}: the logins file does not give the demo password`)
    if (member.status !== 'active') {
      gap(`${username}: the login is ${member.status}`)
      continue
    }
    let s: Session
    try {
      s = await api.signIn(username, DEMO_PASSWORD, args.tenant)
      opened.push(s)
    } catch (e) {
      gap(
        `${username}: does not sign in with the demo password (${e instanceof ApiRefusal ? e.label : 'no answer'})`,
      )
      continue
    }
    if (s.mustChangePassword) gap(`${username}: is asked to change the password at sign-in`)
    if (s.role !== t.role) {
      gap(`${username}: signs in as ${s.role}, not ${t.role}`)
      continue
    }
    sessions[SESSION_OF[t.key]] = s
  }
  const read = await allRows(api, sessions, args.date)
  say(`distributor ${args.tenant}, business date ${args.date}: what each role opens on`)
  const rows: { row: string; feature: string; state: string; detail: string }[] = []
  for (const s of read.seen) {
    const gap = KNOWN_GAPS[`${s.row}:${s.feature}`]
    const state = s.ok ? 'ok' : gap ? `known gap ${gap}` : 'GAP'
    if (!s.ok && !gap) failed++
    rows.push({ row: s.row, feature: s.feature, state, detail: s.detail })
    say(`${state.padEnd(18)} ${s.row.padEnd(11)} ${s.feature.padEnd(21)} ${s.detail}`)
  }
  for (const n of read.notes) say(`note: ${n}`)
  const gaps = rows.filter((r) => r.state === 'GAP')
  say()
  say(
    gaps.length === 0 && failed === 0
      ? 'every role opens on work'
      : `${String(failed)} gap(s): ${gaps.map((g) => `${g.row}/${g.feature}`).join(', ') || 'see the people lines above'}`,
  )
  if (values.json)
    writeFileSync(
      values.json,
      `${JSON.stringify({ tenant: args.tenant, date: args.date, failed, rows, notes: read.notes }, null, 2)}\n`,
    )
} catch (e) {
  stop(
    `could not read: ${e instanceof ApiRefusal ? `the API answered ${e.label}` : e instanceof Error ? e.message : String(e)}`,
  )
} finally {
  for (const s of opened) await api.signOut(s)
}
process.exit(failed > 0 ? 1 : 0)
