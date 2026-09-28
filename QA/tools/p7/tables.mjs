// Phase 7 — renders the side-by-side figures recorded by every scenario (results-s*.json) as Markdown tables.
//   node QA/tools/p7/tables.mjs > fragment.md
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const EV = fileURLToPath(new URL('../../evidence/p7/', import.meta.url))
const rs = (p) => (p === null || p === undefined ? '—' : (Number(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const trip = (o) => (!o ? '—' : o.error ? `ERR ${o.error.slice(0, 20)}` : `${rs(o.outstanding)} / ${rs(o.onAccount)} / ${rs(o.undelivered)}`)
const agree = (f) => {
  const s = f.sql
  const bad = ['owner', 'accountant', 'rep', 'driver', 'retailer'].filter((k) => f[k] && !f[k].error && (f[k].outstanding !== s.outstanding || f[k].onAccount !== s.onAccount || f[k].undelivered !== s.undelivered))
  if (s.net !== s.arJournal) bad.push('AR')
  return bad.length ? `NO (${bad.join(', ')})` : 'yes'
}
const out = []
for (const file of ['results-s1.json', 'results-s2.json', 'results-s3.json', 'results-s4.json']) {
  if (!existsSync(`${EV}${file}`)) continue
  for (const r of JSON.parse(readFileSync(`${EV}${file}`, 'utf8'))) {
    if (!r.figures?.length) continue
    out.push(`\n#### ${r.id} — ${r.title}\n`)
    out.push('| Snapshot | Shop | SQL dues / on account / on van | Net (SQL) | Sundry Debtors (journal) | Owner | Accountant | Rep | Crew | Shop app | Credit check (limit · headroom · breached) | All agree |')
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const fig of r.figures) {
      for (const [code, f] of Object.entries(fig.shops)) {
        const cc = f.owner_credit && !f.owner_credit.error ? `${rs(f.owner_credit.limit)} · ${rs(f.owner_credit.headroom)} · ${f.owner_credit.breached ? 'yes' : 'no'}${f.owner_credit.reasons?.length ? ` (${f.owner_credit.reasons.join(',')})` : ''}` : '—'
        const ccAgree = ['accountant_credit', 'rep_credit'].every((k) => !f[k] || f[k].error || (f[k].headroom === f.owner_credit?.headroom && f[k].breached === f.owner_credit?.breached)) ? '' : ' (desk/rep verdicts differ)'
        out.push(`| ${fig.label} | ${code} | ${rs(f.sql.outstanding)} / ${rs(f.sql.onAccount)} / ${rs(f.sql.undelivered)} | ${rs(f.sql.net)} | ${rs(f.sql.arJournal)} | ${trip(f.owner)} | ${trip(f.accountant)} | ${trip(f.rep)} | ${trip(f.driver)} | ${f.retailer ? trip(f.retailer) : 'n/a'} | ${cc}${ccAgree} | ${agree(f)} |`)
      }
    }
  }
}
console.log(out.join('\n'))
