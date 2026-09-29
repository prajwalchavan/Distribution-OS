import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { MembershipRole } from '@dos/contracts'
// The demo password is defined ONCE, by the demo seed, which gives it to every demo user; the tool takes it from
// there (founder, 2026-09-29: every tester login keeps the demo password). `@dos/db`'s entry does not export the
// seed, so the module is imported by its path. It is re-exported below for the tool's other files; no file of the
// tool writes the value itself.
import { DEMO_PASSWORD } from '../../libs/database/src/seed-demo/index.js'
import { demoId, demoIdDate, isDemoId, unit } from './ids.js'

export { DEMO_PASSWORD }

/**
 * THE TESTER PEOPLE (brief rule 4 as the founder decided it on 2026-09-29: the demo password for all, and plain
 * usernames). Their usernames are plain — `manager`, `accounts`, `sales1`, `sales2`, `godown`,
 * `driver1`, `driver2` — and every one signs in with the demo password, set through the product's own doors (the
 * owner makes the login with a temporary password, the person signs in and changes it), so no one is asked to
 * change it at sign-in. Their display names read like people of Kalyan. No owner login is made (the owner exists
 * and keeps his own password); the existing staff and their passwords are left alone. `shop1…3` are listed for
 * the record: no procedure of the API gives a shop a sign-in (finding DOS-400), so the tool cannot make them.
 *
 * The tool finds its own people again by the MARK it made them with, never by the username: a person's user id is
 * derived from the idempotency key `demo-fill:<date>:person:<key>[:<suffix>]` (`personId`), so a plain username
 * someone else already holds is never taken for the tool's (D5), and the logins the tool used before 2026-09-29
 * (`tester.<key>`) are recognised as former testers and switched off (D6).
 */

export type TesterKey =
  'manager' | 'accounts' | 'sales1' | 'sales2' | 'godown' | 'driver1' | 'driver2'

export interface Tester {
  key: TesterKey
  role: Exclude<MembershipRole, 'owner' | 'retailer'>
  name: string
}

export const TESTERS: readonly Tester[] = [
  { key: 'manager', role: 'manager', name: 'Sameer Deshpande' },
  { key: 'accounts', role: 'accountant', name: 'Pooja Kulkarni' },
  { key: 'sales1', role: 'salesperson', name: 'Rohit Patil' },
  { key: 'sales2', role: 'salesperson', name: 'Akash Jadhav' },
  { key: 'godown', role: 'warehouse', name: 'Sunil Gaikwad' },
  { key: 'driver1', role: 'delivery', name: 'Ganesh Shinde' },
  { key: 'driver2', role: 'delivery', name: 'Imran Shaikh' },
]

export const TESTER_KEYS: readonly TesterKey[] = TESTERS.map((t) => t.key)

export function testerOf(key: TesterKey): Tester {
  const t = TESTERS.find((x) => x.key === key)
  if (!t) throw new Error(`no tester ${key}`)
  return t
}

/** The shopkeeper logins the brief asks for and the API cannot give (DOS-400), under their plain names. */
export const SHOP_USERNAMES = ['shop1', 'shop2', 'shop3'] as const

/**
 * `--login-suffix`: for a second distributor on the same database (usernames are platform-wide, so `manager` can
 * belong to one person only; the second distributor's is `manager.<suffix>`), and for the spec that builds one.
 */
export const LOGIN_SUFFIX = /^[a-z0-9]{1,8}$/

export function checkSuffix(suffix?: string): void {
  if (suffix !== undefined && !LOGIN_SUFFIX.test(suffix))
    throw new Error('a login suffix is 1 to 8 lowercase letters or digits')
}

const withSuffix = (base: string, suffix?: string): string => (suffix ? `${base}.${suffix}` : base)

/** A tester's plain username: its key, with the suffix when one is given. */
export function plainUsername(key: TesterKey, suffix?: string): string {
  checkSuffix(suffix)
  return withSuffix(key, suffix)
}

/**
 * The usernames the tool may give a tester, in order (D5): the plain one, then the next plain ones — `manager2`,
 * `manager3`, … for `manager`; `sales3`, `sales4`, … for `sales1` (the number that follows, never another tester's
 * own plain name). `taken` holds the usernames that belong to someone else or were given earlier in this run.
 */
export function usernameCandidates(
  key: TesterKey,
  suffix: string | undefined,
  taken: ReadonlySet<string>,
  count = 5,
): string[] {
  checkSuffix(suffix)
  const reserved = new Set(TESTER_KEYS.filter((k) => k !== key).map((k) => withSuffix(k, suffix)))
  const stem = key.replace(/\d+$/, '')
  const out: string[] = []
  const offer = (name: string): void => {
    if (!taken.has(name) && !reserved.has(name) && !out.includes(name)) out.push(name)
  }
  offer(withSuffix(key, suffix))
  for (let n = 2; out.length < count && n < 100; n++) offer(withSuffix(`${stem}${String(n)}`, suffix))
  return out.slice(0, count)
}

/**
 * The user id of the tester `key` made on `date`: derived from the idempotency key the tool makes the person with,
 * so it carries the tool's tag and the date (`ids.ts`). The suffix is part of it: the crew of a login suffix is
 * its own.
 */
export function personId(tenantId: string, date: string, key: TesterKey, suffix?: string): string {
  return demoId(tenantId, date, ...personParts(key, suffix))
}
export function personParts(key: TesterKey, suffix?: string): string[] {
  return suffix ? ['person', key, suffix] : ['person', key]
}

/** Which tester of this run's crew a user id is (null when the tool did not make it for this crew). */
export function crewKeyOf(tenantId: string, userId: string, suffix?: string): TesterKey | null {
  if (!isDemoId(userId)) return null
  const date = demoIdDate(userId)
  if (!date) return null
  return TESTER_KEYS.find((k) => personId(tenantId, date, k, suffix) === userId) ?? null
}

/**
 * Which tester a login of a crew the tool no longer uses stood for, read off its username: `tester.<key>[.x]`
 * (the tool before 2026-09-29) or `<key>[n][.x]` (a crew of another suffix). Null when it cannot tell (`sales3`).
 */
export function formerKeyOf(username: string | null): TesterKey | null {
  if (!username) return null
  const head = username.replace(/^tester\./, '').split('.')[0] ?? ''
  if ((TESTER_KEYS as readonly string[]).includes(head)) return head as TesterKey
  const stem = head.replace(/\d+$/, '')
  return stem === 'manager' || stem === 'accounts' || stem === 'godown' ? stem : null
}

/** A staff member as `tenancy.staff.list` answers it (the fields the tool reads). */
export interface StaffMemberLike {
  userId: string
  username: string | null
  role: string
  status: string
}

export interface FormerTester<M extends StaffMemberLike = StaffMemberLike> {
  member: M
  /** The tester it stood for, when its username says so (a rep's beat is carried to the new rep). */
  key: TesterKey | null
}

const TESTER_ROLES: ReadonlySet<string> = new Set(TESTERS.map((t) => t.role))

/**
 * The distributor's staff, sorted by what they are to the tool:
 *  - `crew`: this run's tester of each key, found by the mark (`crewKeyOf`), an active one first, else the oldest;
 *  - `former`: every other login the tool made for a tester — the `tester.<key>` logins of the tool before
 *    2026-09-29, a crew of another suffix, a second person of a key — which the run switches off (D6);
 *  - everyone else (the owner, the distributor's own staff, a person the API attached a login to) is not listed:
 *    the tool never touches them.
 */
export function sortStaff<M extends StaffMemberLike>(
  tenantId: string,
  staff: readonly M[],
  suffix?: string,
): { crew: Map<TesterKey, M>; former: FormerTester<M>[] } {
  const crew = new Map<TesterKey, M>()
  const mine = staff
    .filter((m) => crewKeyOf(tenantId, m.userId, suffix) !== null)
    .sort(
      (a, b) =>
        Number(b.status === 'active') - Number(a.status === 'active') ||
        a.userId.localeCompare(b.userId),
    )
  for (const m of mine) {
    const key = crewKeyOf(tenantId, m.userId, suffix)
    if (key && !crew.has(key)) crew.set(key, m)
  }
  const chosen = new Set([...crew.values()].map((m) => m.userId))
  const former = staff
    .filter((m) => isDemoId(m.userId) && TESTER_ROLES.has(m.role) && !chosen.has(m.userId))
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map((member) => ({
      member,
      key: crewKeyOf(tenantId, member.userId, suffix) ?? formerKeyOf(member.username),
    }))
  return { crew, former }
}

/**
 * A profile phone for a tester: an Indian mobile in the +91 70 000… block, derived from the tenant and the
 * username, shifted past any number `taken` holds (the tenant's own staff and shops). Never printed.
 */
export function testerPhone(
  tenantId: string,
  username: string,
  taken: ReadonlySet<string>,
): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const n = Math.floor(unit(`phone:${tenantId}:${username}:${String(attempt)}`) * 1e8)
    const phone = `+9170${String(n).padStart(8, '0')}`
    if (!taken.has(phone)) return phone
  }
  throw new Error('no free phone number in the tester block')
}

/**
 * A TEMPORARY password the product's policy accepts: 16 letters and digits from the OS's randomness. It lives
 * only between the owner setting it and the person replacing it with the demo password, in memory.
 */
export function newPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const all = letters + digits
  const bytes = randomBytes(16)
  const chars = [...bytes].map((b) => all[b % all.length] ?? 'x')
  chars[3] = digits[(bytes[3] ?? 0) % digits.length] ?? '7'
  chars[9] = letters[(bytes[9] ?? 0) % letters.length] ?? 'k'
  return chars.join('')
}

export interface LoginLine {
  username: string
  password: string
  role: string
}

/** The logins file: `username<TAB>password<TAB>role` per line, `#` comments. Absent file = no lines. */
export function readLogins(path: string): Map<string, LoginLine> {
  const out = new Map<string, LoginLine>()
  if (!existsSync(path)) return out
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [username, password, role] = line.split('\t')
    if (username && password) out.set(username, { username, password, role: role ?? '' })
  }
  return out
}

/** The whole text of a logins file for these lines (what `writeLogins` writes). */
export function loginsText(tenant: string, lines: readonly LoginLine[]): string {
  return [
    `# Distribution OS tester logins for distributor "${tenant}", kept by pnpm fill:demo.`,
    '# Private: every line is a working sign-in. username<TAB>password<TAB>role',
    ...lines.map((l) => `${l.username}\t${l.password}\t${l.role}`),
    '',
  ].join('\n')
}

/**
 * Writes the whole file, mode 600, before the first byte of a password lands in it — and only when its text
 * changes, so a run that changes nobody leaves the file as it was. Answers whether it wrote.
 */
export function writeLogins(path: string, tenant: string, lines: readonly LoginLine[]): boolean {
  const body = loginsText(tenant, lines)
  if (existsSync(path) && readFileSync(path, 'utf8') === body) {
    chmodSync(path, 0o600)
    return false
  }
  if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600 })
  chmodSync(path, 0o600)
  writeFileSync(path, body, { mode: 0o600 })
  chmodSync(path, 0o600)
  return true
}

/** The owner's password file: its first non-empty line. */
export function readPasswordFile(path: string): string {
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) throw new Error('the owner password file is empty')
  return line
}
