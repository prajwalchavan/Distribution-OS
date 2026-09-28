// Phase 7 — scenario bookkeeping: every scenario keeps its wire, its figures (API next to SQL) and its reconciliation.
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import * as L from './lib.mjs'
import * as F from './flow.mjs'

export const results = []
let current = null

export function begin(id, title) {
  current = { id, title, at: new Date().toISOString(), steps: [], figures: [], observations: [], checks: [] }
  results.push(current)
  L.wireTo(`${id}`)
  console.log(`\n=== ${id} ${title}`)
  return current
}
export function step(text, data) {
  current.steps.push(data === undefined ? text : { text, data })
  console.log(`  · ${text}${data === undefined ? '' : ` ${JSON.stringify(data).slice(0, 400)}`}`)
}
export function obs(text) {
  current.observations.push(text)
  console.log(`  ! ${text}`)
}
export function expect(name, ok, detail = '') {
  current.checks.push({ name, ok: Boolean(ok), detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}
/** Screen-facing figures for each shop, from every service that shows them, beside SQL. */
export async function figures(label, shops, opts = {}) {
  const row = { label, shops: {} }
  for (const s of shops) row.shops[s.code ?? s.id] = await F.shopFigures(s.id, opts)
  current.figures.push(row)
  for (const [code, f] of Object.entries(row.shops)) {
    const nets = ['owner', 'accountant', 'rep', 'driver', 'retailer'].filter((k) => f[k] && !f[k].error).map((k) => `${k} ${f[k].outstanding}/${f[k].onAccount}`)
    console.log(`  # ${label} ${code}: sql dues ${f.sql.outstanding} on-acct ${f.sql.onAccount} net ${f.sql.net} AR ${f.sql.arJournal} | ${nets.join(' | ')}`)
  }
  return row
}
export function agree(fig, code) {
  const f = fig.shops[code]
  const bad = []
  for (const k of ['owner', 'accountant', 'rep', 'driver', 'retailer']) {
    if (!f[k] || f[k].error) continue
    if (f[k].outstanding !== f.sql.outstanding || f[k].onAccount !== f.sql.onAccount || f[k].undelivered !== f.sql.undelivered) bad.push(`${k}: ${f[k].outstanding}/${f[k].onAccount}/${f[k].undelivered} vs sql ${f.sql.outstanding}/${f.sql.onAccount}/${f.sql.undelivered}`)
  }
  if (f.sql.net !== f.sql.arJournal) bad.push(`sql net ${f.sql.net} ≠ AR journal ${f.sql.arJournal}`)
  return bad
}
export function recon(label) {
  const r = L.reconcile(label)
  current.recon = { label, exit: r.exit, result: (r.out.match(/RESULT: .*/) ?? ['?'])[0] }
  console.log(`  RECON ${label}: exit ${r.exit} ${current.recon.result.slice(0, 300)}`)
  return r
}
export function save(file) {
  const path = `${L.EV}${file}`
  const prior = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
  const merged = [...prior.filter((p) => !results.some((r) => r.id === p.id)), ...results]
  writeFileSync(path, JSON.stringify(merged, null, 2))
}
export { L, F }
