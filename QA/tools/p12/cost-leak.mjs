// Phase 12 §4 — purchase cost / margin must NEVER appear in a reply to sales, delivery,
// warehouse or retailer. Sign in as each, call every GET op of its service, scan full bodies.
import { readFileSync, writeFileSync } from 'node:fs'
import { loadOps, login, req, fillPath, uuid } from './lib.mjs'

const F = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)))
const PW = 'Dos@1234'

// role -> [service, tarsun login]
const SUBJECTS = [
  ['salesperson', 'sales', 'rahul.deshmukh'],
  ['delivery', 'delivery', 'ganesh.more'],
  ['warehouse', 'warehouse', 'dinesh.patil'],
  ['retailer', 'retailer', 'ramesh.gupta'],
]

// field-name patterns that would betray distributor purchase cost / margin
const BAD = /cost|margin|landed|wac|purchasePrice|buyPrice|moving_?avg|weightedAvg/i
// benign words containing those substrings that are NOT purchase-cost disclosures
const ALLOW = /costCentre|costcenter/i

function scan(node, keyPath, hits) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    node.slice(0, 5).forEach((v, i) => scan(v, `${keyPath}[${i}]`, hits))
    return
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (BAD.test(k) && !ALLOW.test(k)) hits.push({ key: `${keyPath}.${k}`, value: v })
      scan(v, `${keyPath}.${k}`, hits)
    }
  }
}

async function tok(username, actAs) {
  const r = await login(username, PW, { deviceId: uuid(), tenantId: F.tenants.tarsun, actAs })
  if (r.status !== 200) throw new Error(`login ${username} -> ${r.status}`)
  return r.body.accessToken
}

const report = []
for (const [role, service, username] of SUBJECTS) {
  const token = await tok(username, role === 'accountant' ? 'accountant' : undefined)
  const ops = (await loadOps(service)).filter((o) => o.method === 'GET')
  let scanned = 0
  const roleHits = []
  for (const op of ops) {
    const { path } = fillPath(op) // uses OpenAPI examples for id/query params (real seeded ids)
    const r = await req('GET', path, { token })
    if (r.status !== 200 || !r.body) continue
    scanned++
    const hits = []
    scan(r.body, '$', hits)
    if (hits.length) {
      roleHits.push({ op: op.operationId, path, status: r.status, hits })
    }
  }
  report.push({ role, service, opsScanned: scanned, badFieldHits: roleHits })
  console.log(`\n== ${role} (${service}) — GET ops that returned 200: ${scanned}; cost/margin field hits: ${roleHits.length}`)
  for (const h of roleHits) {
    console.log(`  ${h.op} ${h.path}`)
    for (const hit of h.hits.slice(0, 6)) console.log(`      ${hit.key} = ${JSON.stringify(hit.value)}`)
  }
}

writeFileSync(new URL('../../evidence/p12/cost-leak.json', import.meta.url), JSON.stringify(report, null, 1))
const total = report.reduce((n, r) => n + r.badFieldHits.length, 0)
console.log(`\nTOTAL cost/margin field hits across sales+delivery+warehouse+retailer: ${total}`)
