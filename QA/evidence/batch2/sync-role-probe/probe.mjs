// QA batch 2 — sync role probe (DOS-166 candidate). Sends ONE request per run and saves it.
// usage: node probe.mjs <NN> <role> <username> <port> <sync-receipt|http-receipt>
// Writes <NN>-<role>-<table>.json next to this file (token redacted) and prints the ids as JSON.
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RETAILER_ID = '8ddf5b3f-0540-7deb-a8c9-bc311b31b4a8' // Prerna Super Market, tenant tarsun (dos_qa)
const [nn, role, username, port, kind] = process.argv.slice(2)
if (!nn || !role || !username || !port || !kind) {
  console.error('usage: node probe.mjs <NN> <role> <username> <port> <sync-receipt|http-receipt>')
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
let url, requestBody, table
if (kind === 'sync-receipt') {
  table = 'receipts'
  const opId = uuidv7()
  const deviceId = `qa-b2-syncprobe-${role}-${nn}`
  url = `http://127.0.0.1:${port}/sync/upload`
  // Mirrors frontend/delivery-app/src/lib/queue.ts useQueueReceipt (no trip_id: the probed roles have no trip).
  requestBody = {
    protocol: 1,
    deviceId,
    ops: [
      {
        opId,
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
          note: `QA batch2 sync-role-probe ${nn} ${role}`,
        },
      },
    ],
  }
} else if (kind === 'sync-expense') {
  // node probe.mjs <NN> <role> <username> <port> sync-expense <tripId>
  table = 'trip_expenses'
  const tripId = process.argv[7]
  if (!tripId) {
    console.error('sync-expense needs a trip id as the 6th argument')
    process.exit(2)
  }
  const opId = uuidv7()
  const deviceId = `qa-b2-syncprobe-${role}-${nn}`
  url = `http://127.0.0.1:${port}/sync/upload`
  // Field shape read by backend/libs/core/src/modules/delivery/delivery.sync.ts applyExpenseSync.
  requestBody = {
    protocol: 1,
    deviceId,
    ops: [
      {
        opId,
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
          note: `QA batch2 sync-role-probe ${nn} ${role}`,
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
    note: `QA batch2 sync-role-probe ${nn} ${role} HTTP control`,
  }
} else {
  console.error('unknown kind', kind)
  process.exit(2)
}

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(requestBody),
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
  role,
  username,
  tenant: 'tarsun (01a0947d-7a79-75d2-bfff-97e499a58d49)',
  database: 'dos_qa',
  sentAt,
  login: { url: loginUrl, status: loginRes.status, role: loginBody?.user?.role ?? loginBody?.role ?? null },
  request: {
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', authorization: 'Bearer <redacted>' },
    body: requestBody,
  },
  response: { status: res.status, body: responseBody },
}
const file = join(HERE, `${nn}-${role}-${table}.json`)
writeFileSync(file, JSON.stringify(record, null, 2) + '\n')
console.log(
  JSON.stringify({
    file,
    status: res.status,
    receiptId,
    opId: requestBody.ops?.[0]?.opId ?? null,
    deviceId: requestBody.deviceId ?? null,
    response: responseBody,
  }),
)
