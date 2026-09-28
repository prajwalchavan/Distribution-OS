// Phase 12 / 11 access + isolation harness — shared library.
// No new dependencies: native fetch (Node 24), node:crypto.
import { randomUUID } from 'node:crypto'

export const BASE = process.env.P12_BASE || 'http://127.0.0.1:3610'

export const SERVICE_PREFIX = {
  owner: '/owner',
  manager: '/manager',
  sales: '/sales',
  warehouse: '/warehouse',
  delivery: '/delivery',
  retailer: '/retailer',
  admin: '/admin',
}

// Which membership role each service serves (from /health).
export const SERVICE_ROLES = {
  owner: ['owner'],
  manager: ['manager', 'accountant'],
  sales: ['salesperson'],
  warehouse: ['warehouse'],
  delivery: ['delivery'],
  retailer: ['retailer'],
  admin: ['platform_admin'],
}

const DEVICE = '01900000-0000-7000-8000-0000000000aa'

export function uuid() {
  return randomUUID()
}

export async function req(method, path, { token, body, headers } = {}) {
  const h = { 'content-type': 'application/json', ...(headers || {}) }
  if (token) h.authorization = `Bearer ${token}`
  let res, text
  const started = Date.now()
  try {
    res = await fetch(BASE + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    text = await res.text()
  } catch (e) {
    return { status: 0, ms: Date.now() - started, error: String(e), body: null }
  }
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not json */
  }
  return { status: res.status, ms: Date.now() - started, body: json, text }
}

export async function login(username, password, extra = {}) {
  const r = await req('POST', '/auth/auth/login', {
    body: { username, password, deviceId: extra.deviceId || DEVICE, ...extra },
  })
  return r
}

export async function platformLogin(username, password) {
  const r = await req('POST', '/auth/auth/platform/login', {
    body: { username, password, deviceId: DEVICE },
  })
  return r
}

// A tiny digest of a response body so evidence files stay small but tell us what came back.
export function digest(body, text) {
  if (body === null) return (text || '').slice(0, 120)
  if (Array.isArray(body)) return `array[${body.length}]`
  if (body && typeof body === 'object') {
    if (Array.isArray(body.items))
      return `items[${body.items.length}]${body.cursor ? ' +cursor' : ''} keys=${Object.keys(body).slice(0, 6).join(',')}`
    const keys = Object.keys(body)
    // Errors: keep the message so we can see WHY it refused.
    if (body.message || body.error)
      return `err{${body.statusCode ?? ''} ${(body.error || '')}: ${(body.message || '').slice(0, 90)}}`
    return `obj{${keys.slice(0, 10).join(',')}}`
  }
  return String(body).slice(0, 120)
}

// Load an OpenAPI doc for a service and return the list of operations.
export async function loadOps(service) {
  const r = await req('GET', `${SERVICE_PREFIX[service]}/docs/openapi.json`)
  if (r.status !== 200) throw new Error(`openapi ${service} -> ${r.status}`)
  const doc = r.body
  const ops = []
  for (const [rawPath, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
      const params = op.parameters || []
      const example = op.requestBody?.content?.['application/json']?.example
      ops.push({
        service,
        path: rawPath, // may contain {id}
        method: method.toUpperCase(),
        operationId: op.operationId,
        roles: op['x-roles'] || null,
        params,
        example: example ?? null,
      })
    }
  }
  return ops
}

// Fill {name} path params and gather query params, using the OpenAPI example for each param
// unless an override map is given. Returns { path, missing:[names without a value] }.
export function fillPath(op, overrides = {}) {
  const prefix = SERVICE_PREFIX[op.service] || ''
  let path = prefix + op.path
  const missing = []
  const query = []
  for (const p of op.params) {
    const val =
      overrides[p.name] !== undefined
        ? overrides[p.name]
        : p.example !== undefined
          ? p.example
          : undefined
    if (p.in === 'path') {
      if (val === undefined) {
        missing.push(p.name)
        path = path.replace(`{${p.name}}`, '00000000-0000-7000-8000-000000000000')
      } else {
        path = path.replace(`{${p.name}}`, encodeURIComponent(String(val)))
      }
    } else if (p.in === 'query') {
      if (val !== undefined) query.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(String(val))}`)
    }
  }
  return { path: query.length ? `${path}?${query.join('&')}` : path, missing }
}

export function bodyFor(op, overrides = {}) {
  if (op.method === 'GET' || op.method === 'DELETE') return undefined
  const ex = op.example ? { ...op.example } : {}
  // give every mutation a fresh idempotency key + id so replays don't false-negative
  if ('idempotencyKey' in ex || op.example === null) ex.idempotencyKey = `p12-${uuid()}`
  if ('id' in ex) ex.id = uuid()
  return { ...ex, ...overrides }
}
