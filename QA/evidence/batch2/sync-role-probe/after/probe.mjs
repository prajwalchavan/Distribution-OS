// QA batch 2 — sync role probe AFTER the DOS-166 merge (main 3d7cb36, dos_qa rebuilt 16:11 IST).
// Copied from ../probe.mjs (unchanged original). Changes: writes next to THIS file (after/), the rebuilt tenant id,
// fresh device ids (`qa-b2-syncprobe-after-<role>-<NN>`), fresh op ids / receipt ids / idempotency keys on every run,
// and a `manifest` kind (GET /sync/manifest). Sends ONE request per run and saves request + response.
// usage: node probe.mjs <NN> <role> <username> <port> <sync-receipt|http-receipt|manifest|sync-expense <tripId>>
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TENANT = 'tarsun (01a09a5b-3c58-71c1-a34d-b93c569b0099)'
const RETAILER_ID = '8ddf5b3f-0540-7deb-a8c9-bc311b31b4a8' // Prerna Super Market R-0031, tenant tarsun (dos_qa)
const [nn, role, username, port, kind] = process.argv.slice(2)
if (!nn || !role || !username || !port || !kind) {
  console.error('usage: node probe.mjs <NN> <role> <username> <port> <sync-receipt|http-receipt|manifest|sync-expense>')
  process.exit(2)
}

/** UUIDv7: 48-bit ms timestamp, version 7, RFC 4122 variant, random rest. */
function uuidv7() {
  const b = randomBytes(16)
  const ts = BigInt(Date.now())
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn)
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const loginUrl = 'http://127.0.0.1:3000/auth/login'
const loginDeviceId = randomUUID()
const loginRes = await fetch(loginUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password: 'Dos@1234', deviceId: loginDeviceId }),
})
const loginBody = await loginRes.json().catch(() => null)
const token = loginBody?.accessToken ?? loginBody?.tokens?.accessToken
if (!token) {
  console.error('login failed', loginRes.status, JSON.stringify(loginBody))
  process.exit(1)
}

const receiptId = uuidv7()
const sentAt = new Date().toISOString()
const deviceId = `qa-b2-syncprobe-after-${role}-${nn}`
let url, requestBody, table
let method = 'POST'
if (kind === 'sync-receipt') {
  table = 'receipts'
  url = `http://127.0.0.1:${port}/sync/upload`
  // Same op shape as ../probe.mjs (mirrors frontend/delivery-app/src/lib/queue.ts useQueueReceipt, no trip_id).
  requestBody = {
    protocol: 1,
    deviceId,
    ops: [
      {
        opId: uuidv7(),
        op: 'PUT',
        table: 'receipts',
        id: receiptId,
        clientTime: sentAt,
        data: {
          retailer_id: RETAILER_ID,
          mode: 'cash',
          amount_paise: 100,
          received_at: sentAt,
          received_by: null,
          device_id: deviceId,
          status: 'collected',
          note: `QA batch2 sync-role-probe AFTER ${nn} ${role}`,
        },
      },
    ],
  }
} else if (kind === 'sync-expense') {
  table = 'trip_expenses'
  const tripId = process.argv[7]
  if (!tripId) {
    console.error('sync-expense needs a trip id as the 6th argument')
    process.exit(2)
  }
  url = `http://127.0.0.1:${port}/sync/upload`
  requestBody = {
    protocol: 1,
    deviceId,
    ops: [
      {
        opId: uuidv7(),
        op: 'PUT',
        table: 'trip_expenses',
        id: receiptId, // a fresh UUIDv7 used as the expense row id
        clientTime: sentAt,
        data: {
          trip_id: tripId,
          kind: 'parking',
          amount_paise: 100,
          incurred_at: sentAt,
          device_id: deviceId,
          note: `QA batch2 sync-role-probe AFTER ${nn} ${role}`,
        },
      },
    ],
  }
} else if (kind === 'http-receipt') {
  table = 'receipts-http'
  url = `http://127.0.0.1:${port}/receipts`
  requestBody = {
    idempotencyKey: uuidv7(),
    id: receiptId,
    retailerId: RETAILER_ID,
    mode: 'cash',
    amountPaise: 100,
    note: `QA batch2 sync-role-probe AFTER ${nn} ${role} HTTP control`,
  }
} else if (kind === 'manifest') {
  table = 'manifest'
  method = 'GET'
  url = `http://127.0.0.1:${port}/sync/manifest`
  requestBody = undefined
} else {
  console.error('unknown kind', kind)
  process.exit(2)
}

const res = await fetch(url, {
  method,
  headers: {
    ...(requestBody ? { 'content-type': 'application/json' } : {}),
    authorization: `Bearer ${token}`,
  },
  body: requestBody ? JSON.stringify(requestBody) : undefined,
})
const text = await res.text()
let responseBody
try {
  responseBody = JSON.parse(text)
} catch {
  responseBody = text
}

const record = {
  probe: nn,
  phase: 'after DOS-166 merge (main 3d7cb36)',
  role,
  username,
  tenant: TENANT,
  database: 'dos_qa',
  sentAt,
  login: { url: loginUrl, status: loginRes.status, role: loginBody?.user?.role ?? loginBody?.role ?? null },
  request: {
    method,
    url,
    headers: {
      ...(requestBody ? { 'content-type': 'application/json' } : {}),
      authorization: 'Bearer <redacted>',
    },
    body: requestBody ?? null,
  },
  response: { status: res.status, body: responseBody },
}
if (kind === 'manifest' && responseBody && Array.isArray(responseBody.tables)) {
  record.summary = {
    role: responseBody.role,
    writable: responseBody.tables.filter((t) => t.writable).map((t) => t.table),
    notWritable: responseBody.tables.filter((t) => !t.writable).map((t) => t.table),
  }
}
const file = join(HERE, `${nn}-${role}-${table}.json`)
writeFileSync(file, JSON.stringify(record, null, 2) + '\n')
console.log(
  JSON.stringify({
    file,
    status: res.status,
    receiptId: requestBody?.ops ? requestBody.ops[0].id : requestBody?.id ?? null,
    opId: requestBody?.ops?.[0]?.opId ?? null,
    deviceId: requestBody?.deviceId ?? null,
    response: kind === 'manifest' ? record.summary ?? responseBody : responseBody,
  }),
)
