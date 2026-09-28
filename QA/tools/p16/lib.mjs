// Phase 16 helpers. Talks ONLY to the local production-mode API (default http://127.0.0.1:3620).
// Tokens stay in memory; nothing here writes a token to disk.
import { randomUUID } from 'node:crypto'
export const BASE = process.env.P16_BASE ?? 'http://127.0.0.1:3620'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('p16 tools only target the local API')
export const PASSWORD = 'Dos@1234'

export function uuidv7() {
  const b = Buffer.alloc(16)
  const ms = BigInt(Date.now())
  b.writeUIntBE(Number(ms >> 16n), 0, 4); b.writeUInt16BE(Number(ms & 0xffffn), 4)
  const r = Buffer.from(randomUUID().replace(/-/g, ''), 'hex')
  r.copy(b, 6, 6, 16)
  b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export async function http(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  let payload
  if (raw !== undefined) payload = raw
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] ??= 'application/json' }
  const t0 = performance.now()
  const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch {}
  return { status: res.status, headers: Object.fromEntries(res.headers), text, json, ms: Math.round(performance.now() - t0) }
}

const sessions = new Map()
export async function login(username, { tenantId, password = PASSWORD } = {}) {
  const key = `${username}|${tenantId ?? ''}`
  if (sessions.has(key)) return sessions.get(key)
  const deviceId = uuidv7()
  const r = await http('POST', '/auth/auth/login', { body: { username, password, deviceId, deviceName: 'p16', platform: 'web', ...(tenantId ? { tenantId } : {}) } })
  if (r.status !== 200) throw new Error(`login ${username} -> ${r.status} ${r.text.slice(0, 200)}`)
  const s = { username, deviceId, access: r.json.accessToken, refresh: r.json.refreshToken, reply: r.json }
  sessions.set(key, s)
  return s
}

export const redact = (s) => String(s).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>')

/** Fill `{param}` segments of an OpenAPI path from the operation's example, else a fresh UUIDv7. */
export function fillPath(path, op) {
  return path.replace(/\{([^}]+)\}/g, (_, name) => {
    const p = (op.parameters ?? []).find((x) => x.name === name && x.in === 'path')
    return encodeURIComponent(p?.example ?? uuidv7())
  })
}
