// Phase 12 — tenant isolation, horizontal escalation, IDOR.
// For each Tarsun actor, call every op of its own service, substituting SAI ids for path/query ids.
// A 2xx with data, or a landed write, is a cross-tenant leak (P0). 403/404 is correct.
import { readFileSync, writeFileSync } from 'node:fs'
import {
  SERVICE_PREFIX,
  SERVICE_ROLES,
  loadOps,
  login,
  req,
  digest,
  fillPath,
  bodyFor,
  uuid,
} from './lib.mjs'

const F = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)))
const PW = 'Dos@1234'

// Map a path-param name (or the generic {id} disambiguated by the route) to a Sai id.
function saiIdFor(op, paramName) {
  const s = F.sai_ids
  const named = {
    orderId: s.orderId,
    invoiceId: s.invoiceId,
    receiptId: s.receiptId,
    retailerId: s.retailerId,
    tenantProductId: s.tenantProductId,
    priceListId: s.priceListId,
    schemeId: s.schemeId,
    lotId: s.lotId,
    tripId: s.tripId,
    loadSheetId: s.loadSheetId,
    grnId: s.grnId,
    packId: s.packId,
    packId2: s.packId,
    extractionId: null,
    userId: s.userId,
    actorId: s.userId,
  }
  if (paramName !== 'id' && named[paramName] !== undefined && named[paramName] !== null)
    return named[paramName]
  // generic {id} — disambiguate by the route path
  const p = op.path
  const table = [
    ['/orders/', s.orderId],
    ['/approvals/', s.approvalId],
    ['/receipts/', s.receiptId],
    ['/allocations/', null],
    ['/outstanding/', s.retailerId],
    ['/ledger/', s.retailerId],
    ['/invoices/', s.invoiceId],
    ['/credit-notes/', s.creditNoteId],
    ['/retailers/', s.retailerId],
    ['/beats/', s.beatId],
    ['/price-lists/', s.priceListId],
    ['/bargains/', s.bargainId],
    ['/cycle-counts/', null],
    ['/supplier-invoices/', null],
    ['/grns/', s.grnId],
    ['/discrepancies/', null],
    ['/picklists/', s.picklistId],
    ['/packs/', s.packId],
    ['/load-sheets/', s.loadSheetId],
    ['/challans/', s.challanId],
    ['/trips/', s.tripId],
    ['/stops/', null],
    ['/deliveries/', null],
    ['/documents/', null],
    ['/extractions/', null],
    ['/review-sessions/', null],
    ['/imports/', null],
    ['/exports/', s.exportId],
    ['/claims/', null],
    ['/messages/', null],
    ['/broadcasts/', null],
    ['/push-tokens/', null],
    ['/inbound/', null],
    ['/targets/', null],
    ['/statements/', null],
    ['/drafts/', null],
    ['/support-grants/', null],
  ]
  for (const [frag, id] of table) if (p.includes(frag)) return id
  return null // unknown entity: skip (recorded as no-sai-id)
}

// A response that proves cross-tenant data was returned or a write landed.
function classify(op, r) {
  if (r.status === 401) return 'REFUSED_AUTH'
  if (r.status === 403) return 'REFUSED_403'
  if (r.status === 404) {
    const m = (r.body && (r.body.message || r.body.error)) || ''
    if (/no service is mounted|Cannot (GET|POST|PUT|PATCH|DELETE)/.test(m)) return 'ROUTING_404'
    return 'REFUSED_404' // handler ran, row invisible via RLS — correct isolation
  }
  if (r.status >= 200 && r.status < 300) return 'RAN_2XX' // <-- candidate leak
  if (r.status === 400) return 'RAN_400' // handler validated a foreign id -> examine body
  if (r.status === 409) return 'RAN_409'
  if (r.status >= 500) return 'RAN_5XX'
  return `OTHER_${r.status}`
}

async function tok(username, tenantId, actAs) {
  const r = await login(username, PW, tenantId ? { tenantId, actAs } : { actAs })
  if (r.status !== 200) throw new Error(`login ${username} -> ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.accessToken
}

const ACTORS = [
  ['owner', 'owner', SERVICE_PREFIX.owner ? 'owner' : null],
  ['manager', 'manager', 'manager'],
  ['accountant', 'accountant', 'manager'],
  ['salesperson', 'salesperson', 'sales'],
  ['warehouse', 'warehouse', 'warehouse'],
  ['delivery', 'delivery', 'delivery'],
  ['retailer', 'retailer', 'retailer'],
]

const results = []
const leaks = []

for (const [roleKey, , serviceName] of ACTORS) {
  const username = F.logins.tarsun[roleKey]
  let token
  try {
    token = await tok(username, F.tenants.tarsun, roleKey === 'accountant' ? 'accountant' : undefined)
  } catch (e) {
    // owner/etc log in without actAs; retry plain
    token = await tok(username, F.tenants.tarsun)
  }
  const ops = await loadOps(serviceName)
  for (const op of ops) {
    // find id params (path or query) we can point at Sai
    const idParams = op.params.filter(
      (p) => /id$/i.test(p.name) || p.name === 'id' || p.name === 'retailerId',
    )
    if (idParams.length === 0) continue // no id to cross tenants with
    const overrides = {}
    let pointed = false
    for (const p of idParams) {
      const sid = saiIdFor(op, p.name)
      if (sid) {
        overrides[p.name] = sid
        pointed = true
      }
    }
    if (!pointed) continue
    const { path } = fillPath(op, overrides)
    const body =
      op.method === 'GET' || op.method === 'DELETE'
        ? undefined
        : bodyFor(op, /* keep example body but with fresh keys */ {})
    const r = await req(op.method, path, { token, body })
    const cls = classify(op, r)
    // precise leak signal
    let itemCount = null
    let leak = 'no'
    if (r.body && Array.isArray(r.body.items)) itemCount = r.body.items.length
    else if (Array.isArray(r.body)) itemCount = r.body.length
    if (cls === 'RAN_2XX') {
      if (itemCount !== null) leak = itemCount > 0 ? 'LIST_NONEMPTY' : 'empty-ok'
      else leak = 'OBJECT_INSPECT' // scalar/object body — must read it
    } else if (cls === 'RAN_400' || cls === 'RAN_409') {
      leak = 'handler-ran-4xx' // authz passed, but validation/conflict — examine body for id disclosure
    }
    const row = {
      actor: `tarsun:${roleKey}`,
      service: serviceName,
      method: op.method,
      op: op.operationId,
      path,
      saiPointed: overrides,
      status: r.status,
      cls,
      itemCount,
      leak,
      digest: digest(r.body, r.text),
      body: leak === 'LIST_NONEMPTY' || leak === 'OBJECT_INSPECT' ? r.body : undefined,
    }
    results.push(row)
    if (leak === 'LIST_NONEMPTY' || leak === 'OBJECT_INSPECT' || leak === 'handler-ran-4xx')
      leaks.push(row)
  }
}

writeFileSync(new URL('../../evidence/p12/isolation-all.json', import.meta.url), JSON.stringify(results, null, 1))
writeFileSync(
  new URL('../../evidence/p12/isolation-candidates.json', import.meta.url),
  JSON.stringify(leaks, null, 1),
)

const byCls = {}
const byLeak = {}
for (const r of results) {
  byCls[r.cls] = (byCls[r.cls] || 0) + 1
  byLeak[r.leak] = (byLeak[r.leak] || 0) + 1
}
console.log('isolation calls:', results.length)
console.log('by class:', byCls)
console.log('by leak:', byLeak)
const real = leaks.filter((l) => l.leak === 'LIST_NONEMPTY')
const inspect = leaks.filter((l) => l.leak === 'OBJECT_INSPECT')
const ran4xx = leaks.filter((l) => l.leak === 'handler-ran-4xx')
console.log('\n== LIST_NONEMPTY (rows returned for a Sai id) ==', real.length)
for (const l of real) console.log(' ', l.method, l.path, '-> items', l.itemCount)
console.log('\n== OBJECT_INSPECT (scalar/object body) ==', inspect.length)
for (const l of inspect.slice(0, 60)) console.log(' ', l.method, l.path, '|', l.digest)
