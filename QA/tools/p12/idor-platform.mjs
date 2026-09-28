// Phase 12 — IDOR sweep (random + neighbouring UUIDv7) and platform_admin boundary.
import { readFileSync, writeFileSync } from 'node:fs'
import { login, req, uuid, digest } from './lib.mjs'

const F = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)))
const PW = 'Dos@1234'
const out = { idor: [], platform: [] }

// neighbouring UUIDv7: flip low bytes of a real id
function neighbours(id) {
  const hex = id.replace(/-/g, '')
  const list = []
  for (const delta of [1, -1, 2, 256, 4096]) {
    const tail = (parseInt(hex.slice(-8), 16) + delta) >>> 0
    const nh = hex.slice(0, -8) + tail.toString(16).padStart(8, '0')
    list.push(`${nh.slice(0, 8)}-${nh.slice(8, 12)}-${nh.slice(12, 16)}-${nh.slice(16, 20)}-${nh.slice(20)}`)
  }
  return list
}

async function tok(username, tenantId, actAs) {
  const r = await login(username, PW, { deviceId: uuid(), tenantId, actAs })
  if (r.status !== 200) throw new Error(`login ${username} -> ${r.status}`)
  return r.body.accessToken
}

// ---- IDOR as the retailer (most sensitive: must see only own) ----
const ramTar = await tok('ramesh.gupta', F.tenants.tarsun)
const ownOrder = F.tarsun_ids.ramesh_order
const fatimaOrder = '09945c17-27be-7ca1-b1c0-5fc2efa1b94e'
const cases = [
  ['own order (control)', ownOrder],
  ["another retailer's order (fatima)", fatimaOrder],
  ...neighbours(ownOrder).map((n, i) => [`neighbour +/- of own id #${i}`, n]),
  ['random uuid v4', uuid()],
  ['random uuid v4 #2', uuid()],
  ['nil uuid', '00000000-0000-7000-8000-000000000000'],
]
console.log('# IDOR sweep as retailer ramesh on /retailer/orders/{id}')
for (const [label, id] of cases) {
  const r = await req('GET', `/retailer/orders/${id}`, { token: ramTar })
  const row = { label, id, status: r.status, msg: r.body?.message, digest: digest(r.body, r.text) }
  out.idor.push(row)
  console.log(`  ${String(r.status).padEnd(3)} ${label.padEnd(38)} | ${row.digest.slice(0, 70)}`)
}
// existence oracle test: does a real-but-foreign id differ from a random non-existent id?
const foreign = out.idor.find((r) => r.label.startsWith('another'))
const random = out.idor.find((r) => r.label.startsWith('random uuid v4 '))
out.idorOracle = {
  foreignStatus: foreign.status,
  foreignMsg: foreign.msg,
  randomStatus: random.status,
  randomMsg: random.msg,
  indistinguishable: foreign.status === random.status && foreign.msg === random.msg,
}
console.log('  existence oracle:', JSON.stringify(out.idorOracle))

// ---- platform_admin boundary ----
console.log('\n# platform_admin boundary')
const plat = await req('POST', '/auth/auth/platform/login', { body: { username: 'dos.admin', password: PW, deviceId: uuid() } })
const platTok = plat.body?.accessToken
out.platform.push({ check: 'platform-login', status: plat.status, role: plat.body?.role, level: plat.body?.level })
console.log(`  platform login: ${plat.status} role=${plat.body?.role} level=${plat.body?.level}`)
if (platTok) {
  const adminList = await req('GET', '/admin/admin/tenants', { token: platTok })
  out.platform.push({ check: 'admin.tenants.list with platform token', status: adminList.status, digest: digest(adminList.body, adminList.text) })
  console.log(`  /admin/admin/tenants: ${adminList.status} | ${digest(adminList.body, adminList.text).slice(0, 70)}`)
  // platform token must be refused by every tenant service
  for (const svc of ['owner', 'manager', 'sales', 'warehouse', 'delivery', 'retailer']) {
    const r = await req('GET', `/${svc}/reporting/dashboard/owner`, { token: platTok })
    const r2 = await req('GET', `/${svc}/orders?limit=1`, { token: platTok })
    const refused = (r.status === 401 || r.status === 403) && (r2.status === 401 || r2.status === 403)
    out.platform.push({ check: `platform token on /${svc}`, dashStatus: r.status, ordersStatus: r2.status, refused })
    console.log(`  platform token on /${svc}: dashboard=${r.status} orders=${r2.status} refused=${refused}`)
  }
}
// tenant token must be refused by admin-service
const ownerTok = await tok('sunil.tarsun', F.tenants.tarsun)
const tenantOnAdmin = await req('GET', '/admin/admin/tenants', { token: ownerTok })
const tenantOnAdmin2 = await req('GET', '/admin/admin/metrics/overview', { token: ownerTok })
out.platform.push({ check: 'tenant owner token on admin-service', tenantsStatus: tenantOnAdmin.status, metricsStatus: tenantOnAdmin2.status, refused: [401, 403].includes(tenantOnAdmin.status) })
console.log(`  tenant owner token on /admin: tenants=${tenantOnAdmin.status} metrics=${tenantOnAdmin2.status}`)

writeFileSync(new URL('../../evidence/p12/idor-platform.json', import.meta.url), JSON.stringify(out, null, 1))
const idorLeak = out.idor.some((r) => r.status === 200 && !r.label.startsWith('own'))
console.log(`\nIDOR leak (non-own 200): ${idorLeak}; existence oracle: ${!out.idorOracle.indistinguishable}`)
