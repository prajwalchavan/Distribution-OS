import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { MembershipRole } from '@dos/contracts'
import { unit } from './ids.js'

/**
 * THE TESTER PEOPLE (brief rule 4). Their usernames are the brief's; their display names read like people
 * of Kalyan. `tester.owner` is not made (the owner exists and signs in with its own password); the existing
 * staff and their passwords are left alone. `tester.shop1…3` are listed for the record: no procedure of the
 * API gives a shop a sign-in (finding DOS-400), so the tool cannot make them.
 */

export type TesterKey =
  'manager' | 'accounts' | 'sales1' | 'sales2' | 'godown' | 'driver1' | 'driver2'

export interface Tester {
  key: TesterKey
  username: string
  role: Exclude<MembershipRole, 'owner' | 'retailer'>
  name: string
}

export const TESTERS: readonly Tester[] = [
  { key: 'manager', username: 'tester.manager', role: 'manager', name: 'Sameer Deshpande' },
  { key: 'accounts', username: 'tester.accounts', role: 'accountant', name: 'Pooja Kulkarni' },
  { key: 'sales1', username: 'tester.sales1', role: 'salesperson', name: 'Rohit Patil' },
  { key: 'sales2', username: 'tester.sales2', role: 'salesperson', name: 'Akash Jadhav' },
  { key: 'godown', username: 'tester.godown', role: 'warehouse', name: 'Sunil Gaikwad' },
  { key: 'driver1', username: 'tester.driver1', role: 'delivery', name: 'Ganesh Shinde' },
  { key: 'driver2', username: 'tester.driver2', role: 'delivery', name: 'Imran Shaikh' },
]

/** The shopkeeper logins the brief asks for and the API cannot give (DOS-400). */
export const SHOP_USERNAMES = ['tester.shop1', 'tester.shop2', 'tester.shop3'] as const

/**
 * The tester people of one run. `suffix` (`--login-suffix`) is for a second distributor on the same
 * database, and for the spec that builds one: usernames are global, so `tester.manager` can belong to one
 * distributor only; the second gets `tester.manager.<suffix>`. Without it the usernames are the brief's.
 */
export const LOGIN_SUFFIX = /^[a-z0-9]{1,8}$/
export function testersFor(suffix?: string): Tester[] {
  if (suffix !== undefined && !LOGIN_SUFFIX.test(suffix))
    throw new Error('a login suffix is 1 to 8 lowercase letters or digits')
  return TESTERS.map((t) => (suffix ? { ...t, username: `${t.username}.${suffix}` } : { ...t }))
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

/** A password the product's policy accepts: 16 characters, letters and digits, from the OS's randomness. */
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

/** Writes the whole file, mode 600, before the first byte of a password lands in it. */
export function writeLogins(path: string, tenant: string, lines: readonly LoginLine[]): void {
  const body = [
    `# Distribution OS tester logins for distributor "${tenant}", kept by pnpm fill:demo.`,
    '# Private: every line is a working sign-in. username<TAB>password<TAB>role',
    ...lines.map((l) => `${l.username}\t${l.password}\t${l.role}`),
    '',
  ].join('\n')
  if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600 })
  chmodSync(path, 0o600)
  writeFileSync(path, body, { mode: 0o600 })
  chmodSync(path, 0o600)
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
