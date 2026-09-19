/**
 * Read the proxy's request timeline and print every sync-relevant call with its offset from a zero.
 *
 * Usage: node timeline.mjs <timelineFile> <zeroEpochMs> [windowMs=60000] [label]
 *
 * Zero is normally the epoch millisecond of a "Sign in" tap printed by signin.mjs. Offsets are plain
 * arithmetic on the `t` the proxy stamped when it parsed the request line — before the body was read
 * and before anything was forwarded.
 */
import { readFileSync } from 'node:fs'

const [file, zeroArg, windowArg, label] = process.argv.slice(2)
const zero = Number(zeroArg)
const win = Number(windowArg ?? 60000)

const rows = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => !r.event || r.event === 'proxy-up' || r.event === 'proxy-down' || r.event === 'upstream-error')
  .filter((r) => r.t >= zero - 2000 && r.t <= zero + win)

console.log(`# ${label ?? ''}`)
console.log(`zero = ${zero}  ${new Date(zero).toISOString()}  (the "Sign in" tap)`)
console.log(`window = ${win} ms`)
console.log('')
console.log('offset_ms  method  path')
const firsts = new Map()
for (const r of rows) {
  const off = r.t - zero
  if (r.event) {
    console.log(`${String(off).padStart(9)}  --      [${r.event}]`)
    continue
  }
  const path = r.url
  console.log(`${String(off).padStart(9)}  ${String(r.method).padEnd(6)}  ${path}`)
  const key = `${r.method} ${path.split('?')[0]}`
  if (!firsts.has(key)) firsts.set(key, off)
}
console.log('')
console.log('# first occurrence of each call, in order')
for (const [k, v] of [...firsts.entries()].sort((a, b) => a[1] - b[1])) console.log(`${String(v).padStart(9)} ms  ${k}`)

const up = [...firsts.entries()].find(([k]) => k.includes('/sync/upload'))
const man = [...firsts.entries()].find(([k]) => k.includes('/sync/manifest'))
const pull = [...firsts.entries()].find(([k]) => k.includes('/sync/pull'))
console.log('')
console.log('# the clause')
console.log(`  first POST /sync/upload  : ${up ? `+${up[1]} ms` : 'NONE in this window'}`)
console.log(`  first GET  /sync/manifest: ${man ? `+${man[1]} ms` : 'NONE in this window'}`)
console.log(`  first GET  /sync/pull    : ${pull ? `+${pull[1]} ms` : 'NONE in this window'}`)
if (up && man && pull) {
  const ok = up[1] < man[1] && up[1] < pull[1]
  console.log(`  upload BEFORE manifest and pull: ${ok ? 'YES' : 'NO'}`)
}
