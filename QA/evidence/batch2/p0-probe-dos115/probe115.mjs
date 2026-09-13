// QA batch 2 — DOS-115 post-merge regression probe (main 3d7cb36, dos_qa rebuilt 16:11 IST). Live HTTP against :3000-:3005.
// usage: node probe115.mjs 09 | 10 | 11
//   09  warehouse (dinesh.patil :3004) and delivery (ganesh.more :3005): the five order writes -> 403, GET /orders + GET /orders/{id} -> 200
//   10  control: salesperson (rahul.deshmukh :3003) creates a draft on a shop of its beat -> 200; accountant (amol.vaidya :3002) POST /orders -> 403
//   11  warehouse (dinesh.patil :3004) POST /sync/upload with a sales_orders PUT (+ a sales_order_lines PUT) -> 200, role_not_allowed
// Writes one JSON per actor/step next to this file (tokens redacted) and prints the ids it used as JSON.
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TENANT = 'tarsun (01a09a5b-3c58-71c1-a34d-b93c569b0099)'
// Real rows in dos_qa (read-only query at 2026-09-13 ~16:3x IST, see 09-db.txt section 0)
const DRAFT = '876d0028-e59c-77b8-9c0f-afae52c229cc' // draft, rahul.deshmukh, R-0008
const DRAFT_VARIANT = '677c774f-86aa-79c6-b755-702a61b92ca2' // a variant already on that draft
const SUBMITTED = '3efdbf77-02ab-745b-92d0-a175744f6761' // SO-0868 submitted, R-0013
const CONFIRMED = 'ce2350c7-770c-78dd-901b-3206d37d6182' // SO-0877 confirmed, R-0023
const BEAT_SHOP = '75659f5a-19d1-7d52-8b43-4c3d6777a33c' // R-0008 Krishna Kirana Stores, beat Station Road (assigned to rahul.deshmukh)

const step = process.argv[2]
if (!['09', '10', '11'].includes(step)) {
  console.error('usage: node probe115.mjs 09|10|11')
  process.exit(2)
}

function uuidv7() {
  const b = randomBytes(16)
  const ts = BigInt(Date.now())
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn)
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

async function login(username) {
  const res = await fetch('http://127.0.0.1:3000/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'Dos@1234', deviceId: randomUUID() }),
  })
  const body = await res.json().catch(() => null)
  const token = body?.accessToken ?? body?.tokens?.accessToken
  if (!token) {
    console.error('login failed', username, res.status, JSON.stringify(body))
    process.exit(1)
  }
  return { status: res.status, role: body?.user?.role ?? body?.role ?? null, token }
}

/** Trim a large read body to what proves the call worked (ids and states), never a cost field. */
function trim(name, body) {
  if (!body || typeof body !== 'object') return body
  if (Array.isArray(body.items))
    return {
      itemsCount: body.items.length,
      nextCursor: body.nextCursor ?? null,
      firstItems: body.items.slice(0, 3).map((o) => ({ id: o.id, orderNo: o.orderNo, state: o.state })),
    }
  if (body.item && typeof body.item === 'object')
    return {
      item: {
        id: body.item.id,
        orderNo: body.item.orderNo,
        state: body.item.state,
        source: body.item.source,
        retailerId: body.item.retailerId,
        salespersonId: body.item.salespersonId,
        totalPaise: body.item.totalPaise,
        linesCount: Array.isArray(body.item.lines) ? body.item.lines.length : null,
      },
    }
  return body
}

async function call(token, name, method, url, body, expect) {
  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  const pass =
    res.status === expect.status && (expect.message === undefined || parsed?.message === expect.message)
  return {
    name,
    expected: expect,
    request: {
      method,
      url,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), authorization: 'Bearer <redacted>' },
      body: body ?? null,
    },
    response: { status: res.status, body: res.status < 300 ? trim(name, parsed) : parsed },
    pass,
  }
}

const startedAt = new Date().toISOString()
const out = { startedAt, attemptedNewOrderIds: [], calls: [] }

if (step === '09') {
  const actors = [
    { role: 'warehouse', username: 'dinesh.patil', port: 3004 },
    { role: 'delivery', username: 'ganesh.more', port: 3005 },
  ]
  for (const a of actors) {
    const l = await login(a.username)
    const base = `http://127.0.0.1:${a.port}`
    const msg = (p) => `the ${a.role} role may not call ${p}`
    const newOrder = uuidv7()
    const newRepeat = uuidv7()
    out.attemptedNewOrderIds.push(newOrder, newRepeat)
    const calls = []
    calls.push(
      await call(l.token, 'create', 'POST', `${base}/orders`, {
        idempotencyKey: uuidv7(),
        id: newOrder,
        retailerId: BEAT_SHOP,
        source: 'salesperson',
        note: `QA batch2 DOS-115 after-probe 09 ${a.role}`,
        lines: [{ id: uuidv7(), variantId: DRAFT_VARIANT, enteredQty: 1, enteredUnit: 'piece' }],
      }, { status: 403, message: msg('POST /orders') }),
    )
    calls.push(
      await call(l.token, 'setLines (draft)', 'POST', `${base}/orders/${DRAFT}/lines`, {
        idempotencyKey: uuidv7(),
        id: DRAFT,
        lines: [{ id: uuidv7(), variantId: DRAFT_VARIANT, enteredQty: 2, enteredUnit: 'piece' }],
      }, { status: 403, message: msg('POST /orders/:id/lines') }),
    )
    calls.push(
      await call(l.token, 'submit (draft)', 'POST', `${base}/orders/${DRAFT}/submit`, {
        idempotencyKey: uuidv7(),
        id: DRAFT,
      }, { status: 403, message: msg('POST /orders/:id/submit') }),
    )
    calls.push(
      await call(l.token, 'cancel (confirmed SO-0877)', 'POST', `${base}/orders/${CONFIRMED}/cancel`, {
        idempotencyKey: uuidv7(),
        id: CONFIRMED,
        reason: `QA batch2 DOS-115 after-probe 09 ${a.role}`,
      }, { status: 403, message: msg('POST /orders/:id/cancel') }),
    )
    calls.push(
      await call(l.token, 'cancel (submitted SO-0868)', 'POST', `${base}/orders/${SUBMITTED}/cancel`, {
        idempotencyKey: uuidv7(),
        id: SUBMITTED,
        reason: `QA batch2 DOS-115 after-probe 09 ${a.role}`,
      }, { status: 403, message: msg('POST /orders/:id/cancel') }),
    )
    calls.push(
      await call(l.token, 'cancel (draft)', 'POST', `${base}/orders/${DRAFT}/cancel`, {
        idempotencyKey: uuidv7(),
        id: DRAFT,
        reason: `QA batch2 DOS-115 after-probe 09 ${a.role}`,
      }, { status: 403, message: msg('POST /orders/:id/cancel') }),
    )
    calls.push(
      await call(l.token, 'repeatLast', 'POST', `${base}/orders/repeat-last`, {
        idempotencyKey: uuidv7(),
        id: newRepeat,
        retailerId: BEAT_SHOP,
      }, { status: 403, message: msg('POST /orders/repeat-last') }),
    )
    calls.push(await call(l.token, 'list', 'GET', `${base}/orders`, null, { status: 200 }))
    calls.push(await call(l.token, 'get (confirmed SO-0877)', 'GET', `${base}/orders/${CONFIRMED}`, null, { status: 200 }))
    const record = {
      probe: '09',
      finding: 'DOS-115',
      phase: 'after merge (main 3d7cb36)',
      role: a.role,
      username: a.username,
      service: base,
      tenant: TENANT,
      database: 'dos_qa',
      startedAt,
      login: { status: l.status, role: l.role },
      realRows: { DRAFT, SUBMITTED, CONFIRMED, BEAT_SHOP, DRAFT_VARIANT },
      attemptedNewOrderIds: [newOrder, newRepeat],
      calls,
      allPass: calls.every((c) => c.pass),
    }
    writeFileSync(join(HERE, `09-${a.role}-${a.username}.json`), JSON.stringify(record, null, 2) + '\n')
    out.calls.push(...calls.map((c) => ({ actor: a.username, name: c.name, status: c.response.status, message: c.response.body?.message, pass: c.pass })))
  }
}

if (step === '10') {
  const rep = await login('rahul.deshmukh')
  const acc = await login('amol.vaidya')
  const repOrder = uuidv7()
  const accOrder = uuidv7()
  out.attemptedNewOrderIds.push(accOrder)
  out.createdOrderId = repOrder
  const calls = []
  calls.push(
    await call(rep.token, 'salesperson create draft (beat shop R-0008)', 'POST', 'http://127.0.0.1:3003/orders', {
      idempotencyKey: uuidv7(),
      id: repOrder,
      retailerId: BEAT_SHOP,
      source: 'salesperson',
      note: 'QA batch2 DOS-115 after-probe 10 control (salesperson draft)',
      lines: [{ id: uuidv7(), variantId: DRAFT_VARIANT, enteredQty: 1, enteredUnit: 'piece' }],
    }, { status: 200 }),
  )
  calls.push(
    await call(acc.token, 'accountant create (manager-service)', 'POST', 'http://127.0.0.1:3002/orders', {
      idempotencyKey: uuidv7(),
      id: accOrder,
      retailerId: BEAT_SHOP,
      source: 'salesperson',
      note: 'QA batch2 DOS-115 after-probe 10 accountant',
      lines: [{ id: uuidv7(), variantId: DRAFT_VARIANT, enteredQty: 1, enteredUnit: 'piece' }],
    }, { status: 403, message: 'the accountant role may not call POST /orders' }),
  )
  calls.push(await call(acc.token, 'accountant list (manager-service)', 'GET', 'http://127.0.0.1:3002/orders', null, { status: 200 }))
  const record = {
    probe: '10',
    finding: 'DOS-115',
    phase: 'after merge (main 3d7cb36)',
    tenant: TENANT,
    database: 'dos_qa',
    startedAt,
    logins: { 'rahul.deshmukh': { status: rep.status, role: rep.role }, 'amol.vaidya': { status: acc.status, role: acc.role } },
    createdOrderId: repOrder,
    attemptedNewOrderIds: [accOrder],
    calls,
    allPass: calls.every((c) => c.pass),
  }
  writeFileSync(join(HERE, '10-control-salesperson-accountant.json'), JSON.stringify(record, null, 2) + '\n')
  out.calls.push(...calls.map((c) => ({ name: c.name, status: c.response.status, message: c.response.body?.message, pass: c.pass })))
}

if (step === '11') {
  const w = await login('dinesh.patil')
  const orderId = uuidv7()
  const lineId = uuidv7()
  const deviceId = 'qa-b2-dos115-after-warehouse-11'
  const sentAt = new Date().toISOString()
  out.attemptedNewOrderIds.push(orderId)
  const body = {
    protocol: 1,
    deviceId,
    ops: [
      {
        opId: uuidv7(),
        op: 'PUT',
        table: 'sales_orders',
        id: orderId,
        clientTime: sentAt,
        data: { retailer_id: BEAT_SHOP, state: 'draft', source: 'salesperson', note: 'QA batch2 DOS-115 after-probe 11 warehouse upload' },
      },
      {
        opId: uuidv7(),
        op: 'PUT',
        table: 'sales_order_lines',
        id: lineId,
        clientTime: sentAt,
        data: { order_id: DRAFT, variant_id: DRAFT_VARIANT, entered_qty: 1, entered_unit: 'piece' },
      },
    ],
  }
  const c = await call(w.token, 'warehouse sync upload sales_orders + sales_order_lines', 'POST', 'http://127.0.0.1:3004/sync/upload', body, { status: 200 })
  const r = c.response.body
  c.pass =
    c.response.status === 200 &&
    r?.accepted === 0 &&
    Array.isArray(r?.rejected) &&
    r.rejected[0]?.code === 'role_not_allowed' &&
    r.rejected[0]?.table === 'sales_orders'
  const record = {
    probe: '11',
    finding: 'DOS-115 (+ DOS-166 registry door)',
    phase: 'after merge (main 3d7cb36)',
    username: 'dinesh.patil',
    role: 'warehouse',
    tenant: TENANT,
    database: 'dos_qa',
    startedAt,
    login: { status: w.status, role: w.role },
    deviceId,
    orderId,
    lineId,
    opIds: body.ops.map((o) => o.opId),
    call: c,
    expected: '200, accepted 0, rejected[0].code role_not_allowed on sales_orders, no sales_orders row for orderId',
    pass: c.pass,
  }
  writeFileSync(join(HERE, '11-warehouse-sync-sales_orders.json'), JSON.stringify(record, null, 2) + '\n')
  out.deviceId = deviceId
  out.orderId = orderId
  out.lineId = lineId
  out.opIds = record.opIds
  out.calls.push({ name: c.name, status: c.response.status, body: r, pass: c.pass })
}

console.log(JSON.stringify(out))
