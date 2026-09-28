// Phase 10 — scenario bookkeeping: steps, checks, ledger rows written, and the stock reconcile after every scenario.
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import * as L from './lib.mjs'
import * as F from './flow.mjs'

export const results = []
let cur = null
export function begin(id, title) {
  cur = { id, title, at: new Date().toISOString(), marker: L.now(), steps: [], checks: [], ledger: null, recon: null }
  results.push(cur)
  L.wireTo(id)
  console.log(`\n=== ${id} ${title}`)
  return cur
}
export function step(text, data) {
  cur.steps.push(data === undefined ? text : { text, data })
  console.log(`  · ${text}${data === undefined ? '' : ` ${JSON.stringify(data).slice(0, 600)}`}`)
}
export function check(name, ok, detail = '') {
  cur.checks.push({ name, ok: Boolean(ok), detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
  return ok
}
/** Ledger rows written since the scenario began (compact). */
export function ledger(extra = '') {
  const rows = L.ledgerSince(cur.marker, extra)
  const names = new Map(L.q(`select id, batch_no from stock_lots where id in (${rows.length ? L.inList([...new Set(rows.map((r) => r.lot_id))]) : "''"})`).map((r) => [r.id, r.batch_no]))
  cur.ledger = rows.map((r) => `${r.reason} ${r.kind}:${r.loc} batch=${names.get(r.lot_id) || '(none)'} ${r.qty_delta > 0 ? '+' : ''}${r.qty_delta} ref=${r.ref_type}`)
  for (const l of cur.ledger) console.log(`    ledger: ${l}`)
  return rows
}
export function recon(label) {
  const r = L.reconcile(`${cur.id}-${label ?? 'after'}`)
  const res = (r.out.match(/RESULT: .*/) ?? ['?'])[0]
  const fails = r.out.split('\n').filter((l) => l.startsWith('FAIL'))
  cur.recon = { exit: r.exit, result: res, fails }
  console.log(`  RECON: exit ${r.exit} ${res} ${fails.join(' | ')}`)
  return r
}
export function save(file) {
  const path = `${L.EV}${file}`
  const prior = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
  const merged = [...prior.filter((p) => !results.some((r) => r.id === p.id)), ...results]
  writeFileSync(path, JSON.stringify(merged, null, 1))
}
export { L, F }
