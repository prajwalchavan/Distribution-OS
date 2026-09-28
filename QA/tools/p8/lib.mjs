// Phase 8 (pricing lane) — shared API + SQL driver. Test database dos_test_p8_pricing and the all-in-one API on :3650 ONLY.
// Patterns copied from QA/tools/p7/lib.mjs + flow.mjs (not imported, not edited). Every call goes through the product's own
// oRPC contract client (the one the apps use), one session per person; every request/reply pair is logged to a wire file.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const BASE = 'http://127.0.0.1:3650'
export const DB = 'postgres://dos:dos@127.0.0.1:5439/dos_test_p8_pricing'
if (!/\/dos_test_p8_pricing$/.test(DB)) throw new Error('refusing: not the p8 test database')
export const EV = `${ROOT}QA/evidence/p8/`
mkdirSync(EV, { recursive: true })
export const T = '01a0999a-28c3-7341-93f5-e0e84b0189a1' // tarsun (demo seed) in the TEST copy
export const GODOWN = '01a0999a-28e0-7224-8c93-c81b22069a0d'
export const BEAT = '59167a2e-7d76-7bb0-ab9e-fb332fd9c88a' // Kalyan West Market (rahul.deshmukh)
export const SELLER_STATE = '27'
export const USERS = {
  owner: 'sunil.tarsun',
  manager: 'vikas.kadam',
  accountant: 'amol.vaidya',
  rep: 'rahul.deshmukh',
  wh: 'kavita.sawant',
  driver: 'ganesh.more',
  shop: 'ramesh.gupta',
}
const SVC = { owner: 'owner', manager: 'manager', accountant: 'manager', rep: 'sales', wh: 'warehouse', driver: 'delivery', shop: 'retailer' }

const imp = (rel) => import(pathToFileURL(`${ROOT}${rel}`).href)
const { createORPCClient } = await imp('frontend/node_modules/@orpc/client/dist/index.mjs')
const { OpenAPILink } = await imp('frontend/node_modules/@orpc/openapi-client/dist/adapters/fetch/index.mjs')
const { contract, authContract } = await imp('backend/libs/contracts/dist/index.js')
export const { uuidv7 } = await imp('backend/libs/domain/dist/index.js')

export const mk = () => ({ id: uuidv7(), idempotencyKey: uuidv7() })
export const key = () => ({ idempotencyKey: uuidv7() })
export const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) // IST business date
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10)

// ---- wire log -----------------------------------------------------------------------------------------------
let wireFile = null
export function wireTo(name) {
  wireFile = name ? `${EV}${name}.wire.jsonl` : null
  if (wireFile) writeFileSync(wireFile, '')
}
function record(entry) {
  if (wireFile) appendFileSync(wireFile, `${JSON.stringify(entry)}\n`)
}

// ---- sessions -----------------------------------------------------------------------------------------------
const tokens = new Map()
async function login(username, tenantId) {
  const auth = createORPCClient(new OpenAPILink(authContract, { url: `${BASE}/auth` }))
  const pair = await auth.login({ username, password: 'Dos@1234', deviceId: uuidv7(), deviceName: 'QA p8 pricing lane', platform: 'web', ...(tenantId ? { tenantId } : {}) })
  tokens.set(username, { token: pair.accessToken, tenantId })
  return pair.accessToken
}
const safeJson = (t) => {
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}
function recordingFetch(username, tenantId) {
  return async (request, init) => {
    const body = request.method === 'GET' ? null : await request.clone().text()
    let response = await fetch(request.clone(), init)
    if (response.status === 401) {
      const token = await login(username, tenantId)
      const headers = new Headers(request.headers)
      headers.set('authorization', `Bearer ${token}`)
      response = await fetch(new Request(request, { headers }), init)
    }
    const reply = await response.clone().text()
    record({ at: new Date().toISOString(), who: username, method: request.method, url: request.url.replace(BASE, ''), body: body ? safeJson(body) : null, status: response.status, reply: reply.length > 6000 ? `${reply.slice(0, 6000)}…` : safeJson(reply) })
    return response
  }
}
const clients = new Map()
/** as('owner') → oRPC client on the owner service. as('accountant') → on /manager. opts.svc forces a service. */
export async function as(who, opts = {}) {
  const username = USERS[who] ?? who
  const svc = opts.svc ?? SVC[who] ?? 'retailer'
  const tenantId = opts.tenantId ?? (svc === 'retailer' ? T : undefined)
  const k = `${username}@${svc}`
  if (clients.has(k)) return clients.get(k)
  if (!tokens.has(username)) await login(username, tenantId)
  const client = createORPCClient(new OpenAPILink(contract, { url: `${BASE}/${svc}`, headers: async () => ({ authorization: `Bearer ${tokens.get(username).token}` }), fetch: recordingFetch(username, tenantId) }))
  clients.set(k, client)
  return client
}
/** Raw HTTP as a person (for extra/unknown fields the typed client would strip). */
export async function raw(who, method, path, body, opts = {}) {
  const username = USERS[who] ?? who
  const svc = opts.svc ?? SVC[who] ?? 'retailer'
  if (!tokens.has(username)) await login(username, opts.tenantId ?? (svc === 'retailer' ? T : undefined))
  const doit = async () => fetch(`${BASE}/${svc}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.get(username).token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  let res = await doit()
  if (res.status === 401) {
    await login(username, opts.tenantId ?? (svc === 'retailer' ? T : undefined))
    res = await doit()
  }
  const text = await res.text()
  const out = { status: res.status, body: safeJson(text) }
  record({ at: new Date().toISOString(), who: username, method, url: `/${svc}${path}`, body: body ?? null, status: res.status, reply: text.length > 6000 ? `${text.slice(0, 6000)}…` : out.body })
  return out
}
export async function tryCall(p) {
  try {
    return { ok: true, value: await p }
  } catch (e) {
    return { ok: false, status: e?.status, code: e?.code, message: e?.message, data: e?.data }
  }
}
export async function must(p, label = '') {
  const r = await tryCall(p)
  if (!r.ok) throw new Error(`${label} failed: ${r.status} ${r.code} ${r.message} ${JSON.stringify(r.data ?? '')}`)
  return r.value
}

// ---- SQL ----------------------------------------------------------------------------------------------------
const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
export function sqlRaw(query) {
  return execFileSync(PSQL, [DB, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
}
export function q(query) {
  const out = sqlRaw(`select coalesce(json_agg(t), '[]'::json) from (${query}) t`)
  return JSON.parse(out || '[]')
}
export const q1 = (query) => q(query)[0]
export const esc = (s) => String(s).replace(/'/g, "''")
export const inList = (ids) => ids.map((i) => `'${esc(i)}'`).join(',') || "''"

// ---- GSTIN with a valid checksum (Luhn mod 36, written here from the GSTN rule) ------------------------------
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export function gstin(state, pan, entity = '1') {
  const base = `${state}${pan}${entity}Z`
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const v = CH.indexOf(base[i]) * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(v / 36) + (v % 36)
  }
  return base + CH[(36 - (sum % 36)) % 36]
}

// ---- the chain ----------------------------------------------------------------------------------------------
let phoneSeq = Number(String(Date.now()).slice(-7))
export function phone() {
  phoneSeq += 1
  return `+9197${String(phoneSeq).padStart(8, '0').slice(-8)}`
}
/** A fresh shop on rahul.deshmukh's beat, created by the owner. terms: { tier, stateCode, gstin, cashDiscountBps, cashDiscountDays } */
export async function createShop(name, terms = {}) {
  const owner = await as('owner')
  const m = mk()
  const input = {
    ...m,
    name,
    ownerName: `${name} owner`,
    phone: phone(),
    beatId: BEAT,
    stateCode: terms.stateCode ?? '27',
    gstRegType: terms.gstin ? 'regular' : 'unregistered',
    ...(terms.gstin ? { gstin: terms.gstin } : {}),
    paymentTerms: 'POST_FULFILLMENT',
    cashDiscountBps: terms.cashDiscountBps ?? 0,
    cashDiscountDays: terms.cashDiscountDays ?? 0,
    address: { line1: 'QA p8 pricing test shop', city: terms.city ?? 'Kalyan', pincode: terms.pincode ?? '421301' },
  }
  const shop = await must(owner.retailers.upsert(input), `create shop ${name}`)
  const id = shop.item?.id ?? m.id
  await must(owner.retailers.setCredit({ ...key(), id, tier: terms.tier ?? 'B', creditLimitPaise: 500_000_000_00, creditLimitBills: 0, creditDays: 0, creditMode: 'indicate', paymentTerms: 'POST_FULFILLMENT' }), 'setCredit')
  return { id, name, ...q1(`select code, tier::text tier, state_code, gstin, beat_id from retailers where id = '${id}'`) }
}
/** Draft (+ submit) an order. lines: [{ variantId, qty, unit? }] */
export async function placeOrder(shopId, lines, who = 'rep', opts = {}) {
  const c = await as(who)
  const m = opts.orderId ? { id: opts.orderId, idempotencyKey: uuidv7() } : mk()
  const input = { ...m, retailerId: shopId, source: who === 'rep' ? 'salesperson' : who === 'shop' ? 'retailer_app' : 'phone', lines: lines.map((l) => ({ id: l.lineId ?? uuidv7(), variantId: l.variantId, enteredQty: l.qty, enteredUnit: l.unit ?? 'piece' })) }
  const created = await tryCall(c.orders.create(input))
  if (!created.ok) return { orderId: m.id, created, submitted: null }
  if (opts.draftOnly) return { orderId: m.id, created, submitted: null }
  const submitted = await tryCall(c.orders.submit({ ...key(), id: m.id }))
  return { orderId: m.id, created, submitted }
}
export async function approveAll(orderId, who = 'owner', decision = 'approve') {
  const c = await as(who)
  const list = await must(c.orders.approvals.list({ orderId, status: 'pending' }), 'approvals.list')
  const out = []
  for (const a of list.items ?? []) out.push({ kind: a.kind, r: await tryCall(c.orders.approvals.decide({ ...key(), id: a.id, decision, note: 'QA p8' })) })
  return out
}
/** Pick and pack confirmed orders as the godown, every line picked from its suggested lots, invoice issued at pack. */
export async function pickAndPack(orderIds) {
  const wh = await as('wh')
  const pm = mk()
  const pl = await must(wh.warehouse.picklists.create({ ...pm, orderIds, locationId: GODOWN }), 'picklists.create')
  const picklistId = pl.item?.id ?? pm.id
  await must(wh.warehouse.picklists.start({ ...key(), id: picklistId }), 'picklists.start')
  const sheet = await must(wh.warehouse.picklists.get({ id: picklistId }), 'picklists.get')
  const rows = sheet.item?.lines ?? sheet.lines ?? []
  const lines = rows.map((l) => ({ id: uuidv7(), orderLineId: l.orderLineId, lotId: l.suggestedLotId ?? l.lotId, pickedQtyPcs: l.requestedQtyPcs }))
  await must(wh.warehouse.picklists.pick({ ...key(), id: picklistId, lines }), 'picklists.pick')
  const invoices = []
  for (const orderId of orderIds) {
    const packed = await tryCall(wh.warehouse.packs.confirm({ ...mk(), orderId, packages: 1, issueInvoice: true }))
    const inv = q1(`select id, invoice_no, total_paise from invoices where order_id = '${orderId}' and state <> 'cancelled' order by created_at desc limit 1`)
    invoices.push({ orderId, invoiceId: inv?.id, invoiceNo: inv?.invoice_no, totalPaise: inv?.total_paise, packOk: packed.ok, packErr: packed.ok ? null : `${packed.status} ${packed.message}` })
  }
  return { picklistId, invoices }
}

export const rs = (p) => (p === null || p === undefined ? String(p) : `₹${(Number(p) / 100).toFixed(2)}`)
