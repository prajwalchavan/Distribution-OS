// Phase 8 — keep the evidence folder under 2 MB: 2xx calls keep method/url/status only; refusals keep body and reply.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { EV } from './lib.mjs'
for (const f of readdirSync(EV).filter((x) => x.endsWith('.wire.jsonl'))) {
  const rows = readFileSync(`${EV}${f}`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const out = rows.map((r) => (r.status >= 300 ? { ...r, reply: typeof r.reply === 'string' ? r.reply.slice(0, 1500) : JSON.stringify(r.reply).slice(0, 1500) } : { at: r.at, who: r.who, method: r.method, url: r.url, status: r.status }))
  writeFileSync(`${EV}${f}`, out.map((r) => JSON.stringify(r)).join('\n') + '\n')
  console.log(f, rows.length, 'calls,', rows.filter((r) => r.status >= 300).length, 'refused')
}
