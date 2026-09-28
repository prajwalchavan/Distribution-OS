// Calls EVERY operation of every service's OpenAPI with (a) no token and (b) a garbage token.
// Output: QA/evidence/p16/unauth-enum.json (status histogram + every non-401 answer).
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { http, fillPath } from './lib.mjs'
const EV = fileURLToPath(new URL('../../evidence/p16/', import.meta.url))
const services = ['auth', 'owner', 'manager', 'sales', 'warehouse', 'delivery', 'retailer', 'admin']
const garbage = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.AAAA'
const out = { at: new Date().toISOString(), perService: {}, notUnauthorized: [] }
for (const s of services) {
  const doc = JSON.parse(readFileSync(`${EV}openapi-${s}.json`, 'utf8'))
  const hist = {}
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const url = `/${s}${fillPath(path, op)}`
      const body = method === 'get' ? undefined : (op.requestBody?.content?.['application/json']?.example ?? {})
      for (const mode of ['none', 'garbage']) {
        const r = await http(method.toUpperCase(), url, { token: mode === 'garbage' ? garbage : undefined, body })
        const k = `${mode}:${r.status}`
        hist[k] = (hist[k] ?? 0) + 1
        if (r.status !== 401)
          out.notUnauthorized.push({ service: s, method: method.toUpperCase(), path, mode, status: r.status, roles: op['x-roles'], reply: r.text.slice(0, 160) })
      }
    }
  }
  out.perService[s] = hist
}
writeFileSync(`${EV}unauth-enum.json`, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out.perService))
const summary = {}
for (const n of out.notUnauthorized) { const k = `${n.service} ${n.method} ${n.path} [${JSON.stringify(n.roles)}]`; (summary[k] ??= []).push(`${n.mode}:${n.status}`) }
for (const [k, v] of Object.entries(summary)) console.log(k, v.join(' '))
