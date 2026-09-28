// Brute force / rate limiting against the LOCAL API only. My isolated DB, so locking accounts is fine.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { http, uuidv7 } from './lib.mjs'
const EV = fileURLToPath(new URL('../../evidence/p16/', import.meta.url))
const login = (username, password) => http('POST', '/auth/auth/login', { body: { username, password, deviceId: uuidv7(), deviceName: 'p16-bf', platform: 'web' } })

// 1) 200 wrong passwords for ONE real username (delivery user, throwaway) — watch for lock.
const target = 'iqbal.shaikh'
const one = { statuses: {}, firstLockAt: null, sampleLockBody: null, timings: [] }
for (let i = 1; i <= 200; i++) {
  const r = await login(target, `wrong-${i}`)
  one.statuses[r.status] = (one.statuses[r.status] ?? 0) + 1
  if (r.status === 423 && one.firstLockAt === null) { one.firstLockAt = i; one.sampleLockBody = r.text.slice(0, 200) }
  if (i <= 8 || i % 50 === 0) one.timings.push([i, r.status, r.ms])
}
// recovery: the correct password while locked should still be refused with 423
const stillLocked = await login(target, 'Dos@1234')
one.correctPasswordWhileLocked = { status: stillLocked.status, body: stillLocked.text.slice(0, 160) }

// 2) 200 DISTINCT non-existent usernames, one password — is there any global/IP throttle? timing?
const many = { statuses: {}, msMin: Infinity, msMax: 0, msSum: 0 }
for (let i = 0; i < 200; i++) {
  const r = await login(`nouser_${uuidv7().slice(0, 8)}`, 'Dos@1234')
  many.statuses[r.status] = (many.statuses[r.status] ?? 0) + 1
  many.msMin = Math.min(many.msMin, r.ms); many.msMax = Math.max(many.msMax, r.ms); many.msSum += r.ms
}
many.msAvg = Math.round(many.msSum / 200)

// timing oracle: unknown username vs known username wrong password (both should be ~equal = constant time)
const timeIt = async (u, p, n = 20) => { const t = []; for (let i = 0; i < n; i++) { const r = await login(u, p); t.push(r.ms) } t.sort((a, b) => a - b); return { median: t[Math.floor(n / 2)], min: t[0], max: t[n - 1] } }
const timing = { unknownUser: await timeIt(`nouser_${uuidv7().slice(0, 8)}`, 'Dos@1234'), knownUserWrongPw: await timeIt('ganesh.more', 'definitely-wrong') }

const out = { target, oneUsernameManyPasswords: one, manyUsernamesOnePassword: many, timingOracle: timing }
writeFileSync(`${EV}bruteforce.json`, JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1))
