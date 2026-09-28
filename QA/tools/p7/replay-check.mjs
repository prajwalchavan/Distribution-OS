// A9 addendum: the exact same request body sent twice with the same idempotency key.
import * as L from './lib.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
L.wireTo('A9-replay')
const S2 = JSON.parse(readFileSync(`${L.EV}s2-context.json`, 'utf8'))
const acc = await L.as('accountant')
const body = { ...L.mk(), retailerId: S2.pb5.id, mode: 'cash', amountPaise: 1234, receivedAt: new Date().toISOString(), strategy: 'none', note: 'QA p7 replay' }
const a = await L.tryCall(acc.receivables.receipts.create(body))
const b = await L.tryCall(acc.receivables.receipts.create(body))
const n = L.q1(`select count(*) n, coalesce(sum(amount_paise), 0) s from receipts where id = '${body.id}' or note = 'QA p7 replay'`)
const out = { first: a.ok ? a.value.item.receiptNo : a.message, second: b.ok ? b.value.item.receiptNo : `${b.status} ${b.message}`, sameReceipt: a.ok && b.ok && a.value.item.id === b.value.item.id, rows: n }
console.log(JSON.stringify(out))
// undo it so the shop's books carry only what A9 meant to test
const rev = await L.tryCall(acc.receivables.receipts.reverse({ ...L.key(), id: body.id, reversalId: L.uuidv7(), reason: 'QA p7 replay probe undone' }))
console.log('undo', rev.ok ? rev.value.item.receiptNo : rev.message)
writeFileSync(`${L.EV}A9-replay.json`, JSON.stringify(out, null, 2))
