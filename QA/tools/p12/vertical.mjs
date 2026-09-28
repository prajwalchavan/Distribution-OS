// Phase 12 — vertical escalation. Every Tarsun role's token against every service's every op.
// Oracle = x-roles (which IS permissions.ts rendered) AND the service-role gate.
// VIOLATION = business logic ran (2xx / 4xx-handler / 5xx / handler-404) for a (role,op) the
// combined policy forbids. DENY_DISAGREE = a 403 for something the matrix says is allowed.
import { readFileSync, writeFileSync } from 'node:fs'
import { SERVICE_ROLES, loadOps, login, req, digest, fillPath, bodyFor, uuid } from './lib.mjs'

const F = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)))
const PW = 'Dos@1234'
const SERVICES = ['owner', 'manager', 'sales', 'warehouse', 'delivery', 'retailer', 'admin']
// canonical role -> a Tarsun login
const ROLE_LOGIN = {
  owner: 'sunil.tarsun',
  manager: 'vikas.kadam',
  accountant: 'meena.joshi',
  salesperson: 'rahul.deshmukh',
  warehouse: 'dinesh.patil',
  delivery: 'ganesh.more',
  retailer: 'ramesh.gupta',
}
const ROLES = Object.keys(ROLE_LOGIN)

async function tokenFor(role) {
  const username = ROLE_LOGIN[role]
  const actAs = role === 'accountant' ? 'accountant' : undefined
  const r = await login(username, PW, { deviceId: uuid(), tenantId: F.tenants.tarsun, actAs })
  if (r.status !== 200) throw new Error(`login ${username} -> ${r.status} ${r.text}`)
  return r.body.accessToken
}

function expectedRun(role, service, roles) {
  if (roles === 'public') return true
  const served = (SERVICE_ROLES[service] || []).includes(role)
  if (roles === 'authenticated') return served
  if (Array.isArray(roles)) return served && roles.includes(role)
  return false
}

function refusalKind(r) {
  if (r.status === 401) return 'AUTH_401'
  if (r.status === 403) {
    const m = (r.body && r.body.message) || ''
    if (/does not serve/.test(m)) return 'GATE_403'
    if (/may not call/.test(m)) return 'MATRIX_403'
    return 'OTHER_403'
  }
  if (r.status === 404) {
    const m = (r.body && (r.body.message || '')) || ''
    if (/no service is mounted|Cannot (GET|POST|PUT|PATCH|DELETE)/.test(m)) return 'ROUTING_404'
    return null // handler 404 -> authz passed -> RAN
  }
  return null
}

// simple concurrency pool
async function pool(items, n, fn) {
  const out = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: n }, worker))
  return out
}

const opsByService = {}
for (const s of SERVICES) opsByService[s] = await loadOps(s)

const rows = []
const violations = []
const denyDisagree = []

for (const role of ROLES) {
  const token = await tokenFor(role)
  for (const s of SERVICES) {
    const ops = opsByService[s]
    await pool(ops, 12, async (op) => {
      const { path } = fillPath(op)
      const body = bodyFor(op)
      const r = await req(op.method, path, { token, body })
      const refK = refusalKind(r)
      const refused = refK !== null
      const exp = expectedRun(role, s, op.roles)
      const row = {
        role,
        service: s,
        method: op.method,
        op: op.operationId,
        path,
        xroles: op.roles,
        status: r.status,
        refusalKind: refK,
        expectedRun: exp,
        ran: !refused,
        digest: digest(r.body, r.text),
      }
      rows.push(row)
      if (!refused && !exp) violations.push(row)
      if (refused && exp && r.status === 403) denyDisagree.push(row)
    })
  }
}

writeFileSync(new URL('../../evidence/p12/vertical-all.json', import.meta.url), JSON.stringify(rows, null, 0))
writeFileSync(new URL('../../evidence/p12/vertical-violations.json', import.meta.url), JSON.stringify({ violations, denyDisagree }, null, 1))

const byStatus = {}
for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1
console.log('vertical calls:', rows.length)
console.log('by status:', byStatus)
console.log('\n== VIOLATIONS (ran but policy forbids):', violations.length)
for (const v of violations.slice(0, 60))
  console.log(`  ${v.role} -> ${v.service} ${v.method} ${v.path} [xroles=${JSON.stringify(v.xroles)}] -> ${v.status} | ${v.digest.slice(0, 70)}`)
console.log('\n== DENY_DISAGREE (403 for a matrix-allowed call):', denyDisagree.length)
for (const d of denyDisagree.slice(0, 40))
  console.log(`  ${d.role} -> ${d.service} ${d.method} ${d.path} [xroles=${JSON.stringify(d.xroles)}] -> 403 | ${d.digest.slice(0, 60)}`)
