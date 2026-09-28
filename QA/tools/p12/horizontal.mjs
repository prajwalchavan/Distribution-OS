// Phase 12 — horizontal escalation + cross-distributor retailer.
// Targeted probes: rep A vs rep B, retailer A vs retailer B, crew A vs crew B,
// and the retailer linked to two distributors seeing only the elected distributor's data.
import { readFileSync, writeFileSync } from 'node:fs'
import { login, req, digest, uuid } from './lib.mjs'

const F = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)))
const PW = 'Dos@1234'
const T = F.tenants
const TI = F.tarsun_ids
const RM = F.ramesh_multi

async function tok(username, tenantId, actAs) {
  const body = { username, password: PW, deviceId: uuid() }
  if (tenantId) body.tenantId = tenantId
  if (actAs) body.actAs = actAs
  const r = await login(username, PW, tenantId ? { deviceId: body.deviceId, tenantId, actAs } : { deviceId: body.deviceId, actAs })
  if (r.status !== 200) throw new Error(`login ${username}@${tenantId} -> ${r.status} ${r.text}`)
  return r.body.accessToken
}

const out = []
async function probe(label, expectRefused, method, path, token, body) {
  const r = await req(method, path, { token, body })
  const refused = r.status === 401 || r.status === 403 || r.status === 404
  // A 200 that returns an EMPTY list is not a leak — no foreign row came back.
  const emptyList =
    r.status === 200 &&
    r.body &&
    Array.isArray(r.body.items) &&
    r.body.items.length === 0
  const gotData = !refused && !emptyList
  const verdict = expectRefused
    ? refused || emptyList
      ? 'OK-refused'
      : 'LEAK'
    : gotData
      ? 'OK-allowed'
      : refused
        ? 'unexpected-refuse'
        : 'OK-empty'
  const row = { label, method, path, status: r.status, verdict, digest: digest(r.body, r.text), body: verdict === 'LEAK' ? r.body : undefined }
  out.push(row)
  console.log(`${verdict.padEnd(17)} ${label} | ${method} ${path.slice(0, 70)} -> ${r.status} | ${row.digest.slice(0, 80)}`)
  return r
}

// ---- 1. Sales rep A (rahul) vs rep B (amit) ----
const repA = await tok(F.logins.tarsun.salesperson, T.tarsun) // rahul
console.log('\n# Rep A (rahul) reaching Rep B (amit) data')
await probe('repA reads repB order', false, 'GET', `/sales/orders/${TI.repB_order}`, repA) // product: staff see tenant orders
await probe('repA lists orders filtered to repB', false, 'GET', `/sales/orders?salespersonId=${TI.repB_userId}`, repA)
await probe('repA cancels repB draft order', 'expectRefusedOrOwn', 'POST', `/sales/orders/39c6f032-fd27-7d15-b761-79cded32d0f8/cancel`, repA, { idempotencyKey: `p12-${uuid()}`, reason: 'p12 horizontal probe' })

// ---- 2. Retailer A (ramesh) vs retailer B (fatima), same distributor ----
const ramTar = await tok(F.logins.tarsun.retailer, T.tarsun) // ramesh @ tarsun
console.log('\n# Retailer A (ramesh) reaching Retailer B (fatima) data — same distributor')
await probe('ramesh reads fatima order', true, 'GET', `/retailer/orders/09945c17-27be-7ca1-b1c0-5fc2efa1b94e`, ramTar)
await probe('ramesh reads fatima invoice', true, 'GET', `/retailer/invoices/0739e8c8-12fc-7b6a-aedf-a750fa29f4fe`, ramTar)
await probe('ramesh reads fatima outstanding', true, 'GET', `/retailer/receivables/outstanding/${TI.fatima_retailerId}`, ramTar)
await probe('ramesh lists orders filtered to fatima retailer', 'expectRefusedOrOwn', 'GET', `/retailer/orders?retailerId=${TI.fatima_retailerId}`, ramTar)
await probe('ramesh reads fatima invoice pdf', true, 'GET', `/retailer/invoices/0739e8c8-12fc-7b6a-aedf-a750fa29f4fe/pdf`, ramTar)

// ---- 3. Delivery crew A (ganesh) vs crew B (tanaji) ----
const crewA = await tok(F.logins.tarsun.delivery, T.tarsun) // ganesh
console.log('\n# Delivery crew A (ganesh) reaching crew B (tanaji) trip')
await probe('ganesh reads crewB trip', 'observe', 'GET', `/delivery/delivery/trips/${TI.crewB_trip}`, crewA)
await probe('ganesh departs crewB trip', 'observe', 'POST', `/delivery/delivery/trips/${TI.crewB_trip}/depart`, crewA, { idempotencyKey: `p12-${uuid()}` })
await probe('ganesh reads crewB van-stock', 'observe', 'GET', `/delivery/delivery/trips/${TI.crewB_trip}/van-stock`, crewA)

// ---- 4. Cross-distributor retailer: ramesh (Tarsun token) must not see his Sai data ----
console.log('\n# Cross-distributor retailer (ramesh) — Tarsun token must not reach Sai rows')
await probe('ramesh@tarsun reads his SAI order', true, 'GET', `/retailer/orders/${RM.sai_order}`, ramTar)
await probe('ramesh@tarsun reads his SAI invoice', true, 'GET', `/retailer/invoices/${RM.sai_invoice}`, ramTar)
await probe('ramesh@tarsun outstanding for his SAI retailer id', true, 'GET', `/retailer/receivables/outstanding/${RM.sai_retailerId}`, ramTar)

// ramesh elected on Sai must see Sai and not Tarsun
const ramSai = await tok(F.logins.tarsun.retailer, T.sai)
console.log('\n# ramesh elected on SAI — must see Sai rows, not the Tarsun order')
await probe('ramesh@sai reads his SAI order', false, 'GET', `/retailer/orders/${RM.sai_order}`, ramSai)
await probe('ramesh@sai reads his TARSUN order', true, 'GET', `/retailer/orders/${TI.ramesh_order}`, ramSai)
await probe('ramesh@sai reads his TARSUN invoice', true, 'GET', `/retailer/invoices/${TI.ramesh_invoice}`, ramSai)

writeFileSync(new URL('../../evidence/p12/horizontal.json', import.meta.url), JSON.stringify(out, null, 1))
const leaks = out.filter((r) => r.verdict === 'LEAK')
console.log(`\nTOTAL ${out.length} probes; LEAKS: ${leaks.length}`)
