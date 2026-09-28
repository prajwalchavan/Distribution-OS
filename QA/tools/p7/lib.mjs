// Phase 7 (money lane) — shared API + SQL driver. Test database dos_test_p7_money and the all-in-one API on :3630 ONLY.
// Every call goes through the product's own oRPC contract client (the one the apps use), one session per person.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const BASE = 'http://127.0.0.1:3630'
export const DB = 'postgres://dos:dos@127.0.0.1:5439/dos_test_p7_money'
if (!/\/dos_test_p7_money$/.test(DB)) throw new Error('refusing: not the p7 test database')
export const EV = `${ROOT}QA/evidence/p7/`
mkdirSync(EV, { recursive: true })
export const T = '01a0999a-28c3-7341-93f5-e0e84b0189a1' // tarsun (demo seed) in the TEST copy
export const GODOWN = '01a0999a-28e0-7224-8c93-c81b22069a0d'
export const DAMAGED = '01a0999a-28e0-7225-9731-6abfd6e8d459'
export const BEAT_RAHUL = '59167a2e-7d76-7bb0-ab9e-fb332fd9c88a' // Kalyan West Market (rahul.deshmukh)
export const VEHICLES = {
  A: { id: 'ed6a6781-433c-77fe-9319-7da08b1bdd97', loc: '3bbe6b52-7dd7-7540-aad6-94ff815e8d8b' },
  B: { id: '413b0f64-671f-74a5-9616-b57959bac0e5', loc: '7e8fe8ac-a7b5-7531-8def-b362624790ba' },
  C: { id: '99498089-d54e-7b50-b33e-61fd2733f05d', loc: '2c7b4801-3f88-77d1-8a25-7e903891f265' },
}
export const USERS = {
  owner: 'sunil.tarsun',
  manager: 'vikas.kadam',
  accountant: 'amol.vaidya',
  rep: 'rahul.deshmukh',
  wh: 'kavita.sawant',
  driver: 'ganesh.more',
  driver2: 'iqbal.shaikh',
  driver3: 'mahesh.sutar',
}
const SVC = { owner: 'owner', manager: 'manager', accountant: 'manager', rep: 'sales', wh: 'warehouse', driver: 'delivery', driver2: 'delivery', driver3: 'delivery' }

const imp = (rel) => import(pathToFileURL(`${ROOT}${rel}`).href)
const { createORPCClient } = await imp('frontend/node_modules/@orpc/client/dist/index.mjs')
const { OpenAPILink } = await imp('frontend/node_modules/@orpc/openapi-client/dist/adapters/fetch/index.mjs')
const { contract, authContract } = await imp('backend/libs/contracts/dist/index.js')
export const { uuidv7 } = await imp('backend/libs/domain/dist/index.js')

export const mk = () => ({ id: uuidv7(), idempotencyKey: uuidv7() })
export const key = () => ({ idempotencyKey: uuidv7() })

// ---- wire log -----------------------------------------------------------------------------------------------
export let wire = []
let wireFile = null
export function wireTo(name) {
  wireFile = `${EV}${name}.wire.jsonl`
  writeFileSync(wireFile, '')
}
function record(entry) {
  wire.push(entry)
  if (wireFile) appendFileSync(wireFile, `${JSON.stringify(entry)}\n`)
}

// ---- sessions -----------------------------------------------------------------------------------------------
const tokens = new Map() // username -> { token, tenantId }
async function login(username, tenantId) {
  const auth = createORPCClient(new OpenAPILink(authContract, { url: `${BASE}/auth` }))
  const pair = await auth.login({
    username,
    password: 'Dos@1234',
    deviceId: uuidv7(),
    deviceName: 'QA p7 money lane',
    platform: 'web',
    ...(tenantId ? { tenantId } : {}),
  })
  tokens.set(username, { token: pair.accessToken, tenantId })
  return pair.accessToken
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
    record({ at: new Date().toISOString(), who: username, method: request.method, url: request.url.replace(BASE, ''), body: body ? safeJson(body) : null, status: response.status, reply: safeJson(reply) })
    return response
  }
}
const safeJson = (t) => {
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

const clients = new Map()
/** as('owner') → oRPC client for the owner, on the owner service. as('accountant') → on /manager. */
export async function as(who, opts = {}) {
  const username = USERS[who] ?? who
  const svc = opts.svc ?? SVC[who] ?? 'retailer'
  const tenantId = opts.tenantId
  const k = `${username}@${svc}`
  if (clients.has(k)) return clients.get(k)
  if (!tokens.has(username)) await login(username, tenantId)
  const client = createORPCClient(
    new OpenAPILink(contract, {
      url: `${BASE}/${svc}`,
      headers: async () => ({ authorization: `Bearer ${tokens.get(username).token}` }),
      fetch: recordingFetch(username, tenantId),
    }),
  )
  clients.set(k, client)
  return client
}

/** Run a call; return { ok, value } or { ok:false, status, code, message, data }. Never throws. */
export async function tryCall(p) {
  try {
    return { ok: true, value: await p }
  } catch (e) {
    return { ok: false, status: e?.status, code: e?.code, message: e?.message, data: e?.data }
  }
}
/** Run a call that must succeed. */
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
/** Rows of a query as JSON objects. */
export function q(query) {
  const out = sqlRaw(`select coalesce(json_agg(t), '[]'::json) from (${query}) t`)
  return JSON.parse(out || '[]')
}
export const q1 = (query) => q(query)[0]
export const esc = (s) => String(s).replace(/'/g, "''")

// ---- reconciliation hook --------------------------------------------------------------------------------------
export function reconcile(label) {
  try {
    const out = execFileSync('node', [`${ROOT}QA/tools/p7/reconcile.mjs`, '--label', label], { encoding: 'utf8', maxBuffer: 1 << 26 })
    return { exit: 0, out }
  } catch (e) {
    return { exit: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

// ---- log ----------------------------------------------------------------------------------------------------
export const log = []
export function note(line) {
  log.push(line)
  console.log(line)
}
export const rs = (p) => (p === null || p === undefined ? String(p) : `₹${(Number(p) / 100).toFixed(2)}`)
