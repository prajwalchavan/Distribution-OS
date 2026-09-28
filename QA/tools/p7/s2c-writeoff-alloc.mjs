// A13 addendum: can the desk point the recovered money at the written-off bill? (evidence for DOS-311)
import * as L from './lib.mjs'
import { writeFileSync } from 'node:fs'
L.wireTo('A13b')
const acc = await L.as('accountant')
const inv = L.q1(`select i.id, i.invoice_no, i.state::text, r.code from invoices i join retailers r on r.id = i.retailer_id where i.invoice_no = 'INV/9019' and i.tenant_id = '${L.T}'`)
const rc = L.q1(`select id, receipt_no from receipts where receipt_no = 'RCPT-9027' and tenant_id = '${L.T}'`)
const r = await L.tryCall(acc.receivables.allocations.create({ ...L.mk(), sourceType: 'receipt', sourceId: rc.id, lines: [{ id: L.uuidv7(), invoiceId: inv.id, amountPaise: 39500 }] }))
const out = { invoice: inv, receipt: rc.receipt_no, allocateToWrittenOff: r.ok ? 'ACCEPTED' : `${r.status} ${r.message}`, pb5Bill: L.q1(`select invoice_no from invoices i join retailers r on r.id = i.retailer_id where r.code = 'R-9036' order by i.created_at limit 1`) }
console.log(JSON.stringify(out))
writeFileSync(`${L.EV}A13b.json`, JSON.stringify(out, null, 2))
