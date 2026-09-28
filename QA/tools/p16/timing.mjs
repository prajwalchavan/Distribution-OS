// Clean username-enumeration timing test with VALID-format usernames (no hyphens), first attempt only.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { http, uuidv7 } from './lib.mjs'
const EV = fileURLToPath(new URL('../../evidence/p16/', import.meta.url))
const psql = (q) => execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql', ['-Atc', q], { env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: '5439', PGUSER: 'dos', PGDATABASE: 'dos_test_p16_security' } }).toString().trim().split('\n').filter(Boolean)
const known = psql("select username from users where username is not null and failed_login_count=0 and locked_until is null order by created_at limit 40")
const login = (u, p) => http('POST', '/auth/auth/login', { body: { username: u, password: p, deviceId: uuidv7(), platform: 'web' } })
const validName = () => 'nu' + randomBytes(8).toString('hex') // 18 chars, [a-z0-9], valid per USERNAME_REGEX
const rec = (arr, statuses) => async (u, p) => { const r = await login(u, p); arr.push(r.ms); statuses[r.status] = (statuses[r.status] ?? 0) + 1 }
const unknownMs = [], unknownSt = {}, knownMs = [], knownSt = {}
const ru = rec(unknownMs, unknownSt), rk = rec(knownMs, knownSt)
for (let i = 0; i < 40; i++) await ru(validName(), 'Zzwrong123')
for (const u of known) await rk(u, 'Zzwrong123')
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] } }
const out = { unknownUsernameValidFormat: { statuses: unknownSt, timing: stat(unknownMs) }, knownUsernameWrongPassword: { statuses: knownSt, timing: stat(knownMs) } }
writeFileSync(`${EV}timing-oracle.json`, JSON.stringify(out, null, 2)); console.log(JSON.stringify(out))
