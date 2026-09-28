// Lists what the examples embedded in an OpenAPI document disclose: field name -> sample values.
// Usage: node openapi-examples.mjs <openapi.json> [--counts-only]
import { readFileSync } from 'node:fs'
const [file, flag] = process.argv.slice(2)
const doc = JSON.parse(readFileSync(file, 'utf8'))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const seen = new Map()
let uuids = new Set(), ops = 0, opsWithExample = 0
const walk = (v, key) => {
  if (v === null || v === undefined) return
  if (Array.isArray(v)) return v.forEach((x) => walk(x, key))
  if (typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(x, k))
  if (typeof v === 'string' && UUID.test(v)) { uuids.add(v); return }
  const set = seen.get(key) ?? new Set(); set.add(String(v)); seen.set(key, set)
}
for (const [, methods] of Object.entries(doc.paths ?? {}))
  for (const [, op] of Object.entries(methods ?? {})) {
    ops++
    let has = false
    for (const p of op.parameters ?? []) if (p.example !== undefined) { has = true; walk(p.example, p.name) }
    const ex = op.requestBody?.content?.['application/json']?.example
    if (ex !== undefined) { has = true; walk(ex, 'body') }
    if (has) opsWithExample++
  }
console.log(JSON.stringify({ ops, opsWithExample, distinctUuids: uuids.size, fields: seen.size }))
const interesting = /name|phone|mobile|gstin|username|email|address|pan|upi|number|note|password|city|pin/i
for (const [k, set] of [...seen.entries()].sort()) {
  if (!interesting.test(k)) continue
  const vals = [...set]
  console.log(k, flag === '--counts-only' ? `(${vals.length} values)` : JSON.stringify(vals.slice(0, 6)))
}
