/**
 * Decode an offline store file name back to (app, user, distributor) — the inverse of
 * `storeNameFor` in frontend/libs/offline/src/engine.ts (docs/27 §2). Read-only, no product import:
 * the format is 25 base-36 digits per UUID, so the arithmetic is the whole of it.
 */
const STORE_NAME = /^([sdwh])([0-9a-z]{25})([0-9a-z]{25})$/
const APP = { s: 'dos-sales', d: 'dos-delivery', w: 'dos-warehouse', h: 'dos-harness' }
const uuidOf = (d) => {
  let v = 0n
  for (const c of d) v = v * 36n + BigInt(Number.parseInt(c, 36))
  const h = v.toString(16).padStart(32, '0')
  if (h.length > 32) return null
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
for (const n of process.argv.slice(2)) {
  const m = STORE_NAME.exec(n)
  if (!m) { console.log(`${n} -> not a store name`); continue }
  console.log(`app=${APP[m[1]]} user=${uuidOf(m[2])} distributor=${uuidOf(m[3])}`)
}
