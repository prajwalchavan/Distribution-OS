// Phase 7 · S2 — money at the office: FIFO across bills, hand-picked, on account then allocated, before delivery,
// advance before billing, reversal after allocation, reversal of banked trip cash, duplicates, refund, write-off then payment.
import { writeFileSync, readFileSync } from 'node:fs'
import { begin, step, obs, expect, figures, agree, recon, save, L, F } from './scenario-kit.mjs'

const V = { cola: 'f71bf137-50de-7182-a0d9-c83f1a613a57', glucose: 'af45e021-a167-7d3f-a8f0-60ab037214cb', soap: '8549cf4f-2489-772a-9691-7eeda70e8bdc' }
const basket = [{ variantId: V.cola, qty: 12 }, { variantId: V.glucose, qty: 24 }]
const S1 = JSON.parse(readFileSync(`${L.EV}s1-context.json`, 'utf8'))
const acc = await L.as('accountant')
const owner = await L.as('owner')
const openOf = (invoiceId) => L.q1(`select i.invoice_no, i.state::text state, i.total_paise total, i.total_paise - coalesce((select sum(amount_paise) from allocations a where a.invoice_id = i.id), 0) open from invoices i where i.id = '${invoiceId}'`)
const openBills = (shopId) => L.q(`
  select i.id, i.invoice_no, i.invoice_date::text, coalesce(i.due_date, i.invoice_date + make_interval(days => r.credit_days))::date::text due, i.total_paise total,
         i.total_paise - coalesce((select sum(amount_paise) from allocations a where a.invoice_id = i.id), 0) open
    from invoices i join retailers r on r.id = i.retailer_id
   where i.retailer_id = '${shopId}' and i.state in ('issued', 'partially_paid') and i.undelivered_at is null
   order by due, i.invoice_date, i.invoice_no`)

// --- A4a FIFO across several bills -------------------------------------------------------------------------------
begin('A4a', 'One desk receipt against outstanding, no bill named: allocated oldest bill first (seeded R-0020, 6 open bills)')
const joshi = { id: '1b3e6156-389f-7163-a4c6-1e13569f4a1d', code: 'R-0020' }
let bills = openBills(joshi.id)
step('open bills oldest first', bills.map((b) => `${b.invoice_no} due ${b.due} open ${b.open}`))
const amtA = Number(bills[0].open) + Number(bills[1].open) + Math.floor(Number(bills[2].open) / 2)
let fig = await figures('before', [joshi])
const rA = await F.deskReceipt(joshi.id, 'cash', amtA)
expect('receipt recorded', rA.ok, rA.ok ? rA.value.item.receiptNo : `${rA.status} ${rA.message}`)
const allocA = L.q(`select i.invoice_no, a.amount_paise from allocations a join invoices i on i.id = a.invoice_id where a.receipt_id = '${rA.receiptId}' order by a.allocated_at, a.id`)
step('allocations', allocA)
expect('two oldest bills settled in full, the third in part, nothing else touched', allocA.length === 3 && allocA[0].invoice_no === bills[0].invoice_no && allocA[0].amount_paise === Number(bills[0].open) && allocA[1].invoice_no === bills[1].invoice_no && allocA[2].invoice_no === bills[2].invoice_no && allocA[2].amount_paise === Math.floor(Number(bills[2].open) / 2), JSON.stringify(allocA.map((a) => a.invoice_no)))
fig = await figures('after FIFO receipt', [joshi])
expect('screens agree', agree(fig, joshi.code).length === 0, agree(fig, joshi.code).join('; '))
recon('S2-A4a-fifo')

// --- A4b hand-picked ---------------------------------------------------------------------------------------------
begin('A4b', 'One desk receipt hand-picked to the newest and a middle bill (seeded R-0015, 5 open bills)')
const ganpati = { id: 'c704a780-c33e-7a95-ba00-e28613f6883a', code: 'R-0015' }
bills = openBills(ganpati.id)
step('open bills oldest first', bills.map((b) => `${b.invoice_no} due ${b.due} open ${b.open}`))
const newest = bills[bills.length - 1]
const middle = bills[2]
const partMiddle = Math.floor(Number(middle.open) / 3)
const rB = await F.deskReceipt(ganpati.id, 'bank_transfer', Number(newest.open) + partMiddle, {
  reference: `NEFT${Date.now()}`,
  strategy: 'explicit',
  allocations: [
    { id: L.uuidv7(), invoiceId: newest.id, amountPaise: Number(newest.open) },
    { id: L.uuidv7(), invoiceId: middle.id, amountPaise: partMiddle },
  ],
})
expect('receipt recorded with the named split', rB.ok, rB.ok ? rB.value.item.receiptNo : `${rB.status} ${rB.message}`)
const allocB = L.q(`select i.invoice_no, a.amount_paise from allocations a join invoices i on i.id = a.invoice_id where a.receipt_id = '${rB.receiptId}' order by i.invoice_no`)
step('allocations', allocB)
expect('exactly the two named bills, by the named amounts', allocB.length === 2 && allocB.some((a) => a.invoice_no === newest.invoice_no && a.amount_paise === Number(newest.open)) && allocB.some((a) => a.invoice_no === middle.invoice_no && a.amount_paise === partMiddle))
const over = await F.deskReceipt(ganpati.id, 'cash', 1000, { strategy: 'explicit', allocations: [{ id: L.uuidv7(), invoiceId: newest.id, amountPaise: 1000 }] })
expect('a hand-picked line larger than what the bill still owes is refused', !over.ok, over.ok ? 'ACCEPTED' : `${over.status} ${over.message}`)
const mismatch = await F.deskReceipt(ganpati.id, 'cash', 5000, { strategy: 'explicit', allocations: [{ id: L.uuidv7(), invoiceId: bills[0].id, amountPaise: 7000 }] })
step('explicit split larger than the receipt itself', mismatch.ok ? { accepted: true, alloc: mismatch.value.item.allocatedPaise, unalloc: mismatch.value.item.unallocatedPaise } : `${mismatch.status} ${mismatch.message}`)
expect('an explicit split may not exceed the money received', !mismatch.ok, mismatch.ok ? `ACCEPTED: receipt ₹50 allocated ${mismatch.value.item.allocatedPaise}` : 'refused')
fig = await figures('after hand-picked receipt', [ganpati])
expect('screens agree', agree(fig, ganpati.code).length === 0, agree(fig, ganpati.code).join('; '))
recon('S2-A4b-handpicked')

// --- A6 on account, then allocated, then un-allocated -------------------------------------------------------------
begin('A6', 'Receipt kept on account (strategy none), then the accountant allocates it, then removes one allocation')
const joshiBills = openBills(joshi.id)
const rC = await F.deskReceipt(joshi.id, 'cash', 30000, { strategy: 'none' })
expect('receipt wholly on account', rC.ok && rC.value.item.allocatedPaise === 0 && rC.value.item.unallocatedPaise === 30000, rC.ok ? JSON.stringify({ a: rC.value.item.allocatedPaise, u: rC.value.item.unallocatedPaise }) : rC.message)
fig = await figures('on account', [joshi])
const target = joshiBills[joshiBills.length - 1]
const al = await L.tryCall(acc.receivables.allocations.create({ ...L.mk(), sourceType: 'receipt', sourceId: rC.receiptId, lines: [{ id: L.uuidv7(), invoiceId: target.id, amountPaise: 30000 }] }))
expect('accountant allocates the ₹300 to the newest bill', al.ok, al.ok ? '' : `${al.status} ${al.message}`)
const alTooMuch = await L.tryCall(acc.receivables.allocations.create({ ...L.mk(), sourceType: 'receipt', sourceId: rC.receiptId, lines: [{ id: L.uuidv7(), invoiceId: joshiBills[0].id, amountPaise: 100 }] }))
expect('allocating more than the receipt has free is refused', !alTooMuch.ok, alTooMuch.ok ? 'ACCEPTED' : `${alTooMuch.status} ${alTooMuch.message}`)
const allocRow = L.q1(`select id from allocations where receipt_id = '${rC.receiptId}' limit 1`)
const rm = await L.tryCall(acc.receivables.allocations.remove({ ...L.key(), id: allocRow.id, reason: 'QA p7: wrong bill' }))
expect('allocation removed; money back on account, no journal', rm.ok, rm.ok ? '' : `${rm.status} ${rm.message}`)
const allocAfter = L.q(`select amount_paise from allocations where receipt_id = '${rC.receiptId}'`)
step('allocations of the receipt after remove (net)', allocAfter)
fig = await figures('after remove', [joshi])
expect('screens agree', agree(fig, joshi.code).length === 0, agree(fig, joshi.code).join('; '))
recon('S2-A6-onaccount')

// --- A5a payment before delivery -----------------------------------------------------------------------------------
begin('A5a', 'Payment before delivery: bill packed, the shop pays by UPI at the office, then the van delivers')
const pb2 = await F.createShop('QA P7 PB2 Prepay Stores', { creditLimitPaise: 50_000_00 })
const o2 = await F.placeOrder(pb2.id, basket)
const pk2 = await F.pickAndPack([o2.orderId])
const b2 = pk2.invoices[0]
const rD = await F.deskReceipt(pb2.id, 'upi', b2.totalPaise, { reference: `UTR${Date.now()}` })
expect('UPI receipt allocated to the packed bill', rD.ok && rD.value.item.allocatedPaise === b2.totalPaise, rD.ok ? `${rD.value.item.receiptNo}` : rD.message)
expect('bill paid before it left the godown', openOf(b2.invoiceId).state === 'paid', openOf(b2.invoiceId).state)
const trip2 = await F.tripOut([{ retailerId: pb2.id, invoiceIds: [b2.invoiceId] }], { vehicle: 'B', driver: 'driver2' })
const drv2 = await L.as('driver2')
const stops2 = await L.tryCall(drv2.delivery.stops.list({ tripId: trip2.tripId }))
step('crew stop list', stops2.ok ? (stops2.value.items ?? []).map((s) => ({ retailer: s.retailerName, toCollect: s.plannedCollectionPaise ?? s.toCollectPaise ?? s.duePaise, dues: s.overduePaise, bills: s.invoices?.map?.((i) => ({ no: i.invoiceNo, open: i.openPaise ?? i.duePaise })) })) : stops2.message)
const next2 = await L.tryCall(drv2.delivery.stops.next({ id: trip2.tripId }))
step('crew next stop (what the door screen reads)', next2.ok ? JSON.stringify(next2.value).slice(0, 1200) : next2.message)
const d2 = await F.deliver(trip2, trip2.stops[0], b2.invoiceId)
expect('delivered', d2.ok, d2.ok ? '' : d2.message)
fig = await figures('after delivery of a prepaid bill', [pb2])
expect('screens agree; nothing owed', agree(fig, pb2.code).length === 0 && fig.shops[pb2.code].sql.net === 0, agree(fig, pb2.code).join('; '))
const st2 = await F.checkInAndSettle(trip2)
step('trip 2 settled', { expected: st2.preview.expectedCashPaise, upi: st2.preview.upiCollectedPaise, state: st2.settle.ok ? st2.settle.value.tripState : st2.settle.message })
expect('a prepaid bill puts no UPI or cash on the crew\'s settlement', st2.preview.upiCollectedPaise === 0 && st2.preview.expectedCashPaise === 0, JSON.stringify({ cash: st2.preview.cashCollectedPaise, upi: st2.preview.upiCollectedPaise }))
recon('S2-A5a-before-delivery')

// --- A5b advance before billing -----------------------------------------------------------------------------------------
begin('A5b', 'Advance: the shop pays ₹1,000 before any order; the order is then placed, billed and delivered')
const pb3 = await F.createShop('QA P7 PB3 Advance Stores', { creditLimitPaise: 1_000_00, creditMode: 'strict' })
const rE = await F.deskReceipt(pb3.id, 'cash', 100000)
expect('advance on account', rE.ok && rE.value.item.unallocatedPaise === 100000, rE.ok ? '' : rE.message)
fig = await figures('after advance', [pb3], { orderTotalPaise: 59500 })
const cc = fig.shops[pb3.code].owner_credit
step('credit check for a ₹595 order after a ₹1,000 advance (limit ₹1,000, strict)', cc)
const o3 = await F.placeOrder(pb3.id, basket)
step('order submit', o3.submitted.ok ? { state: o3.submitted.value.item.state, flags: o3.submitted.value.item.approvalFlags, total: o3.submitted.value.item.totalPaise } : o3.submitted.message)
if (o3.submitted.ok && o3.submitted.value.item.state !== 'confirmed') await F.approveAll(o3.orderId)
const pk3 = await F.pickAndPack([o3.orderId])
const b3 = pk3.invoices[0]
const s3 = openOf(b3.invoiceId)
step('the new bill after billing', s3)
fig = await figures('advance + new bill', [pb3], { orderTotalPaise: 59500 })
const f3 = fig.shops[pb3.code]
step('dues shown vs money on account', { outstanding: f3.owner.outstanding, onAccount: f3.owner.onAccount, net: f3.sql.net })
if (f3.owner.outstanding > 0 && f3.owner.onAccount > 0) obs(`Money already paid in advance (₹${f3.owner.onAccount / 100}) is NOT applied to the new bill: the bill stays open (₹${f3.owner.outstanding / 100}) and will age, go overdue and count against the credit gate, while the shop's net is ₹${f3.sql.net / 100}.`)
const ccAfter = fig.shops[pb3.code].owner_credit
step('credit check for another ₹595 after billing', ccAfter)
const al3 = await L.tryCall(acc.receivables.allocations.create({ ...L.mk(), sourceType: 'receipt', sourceId: rE.receiptId, lines: [{ id: L.uuidv7(), invoiceId: b3.invoiceId, amountPaise: b3.totalPaise }] }))
expect('the accountant can apply the advance to the bill by hand', al3.ok, al3.ok ? '' : al3.message)
fig = await figures('advance applied', [pb3])
expect('screens agree', agree(fig, pb3.code).length === 0, agree(fig, pb3.code).join('; '))
recon('S2-A5b-advance')

// --- A8 reversal after allocation ---------------------------------------------------------------------------------------
begin('A8', 'A desk cash receipt allocated across two bills is reversed')
const pb4 = await F.createShop('QA P7 PB4 Reversal Stores', { creditLimitPaise: 50_000_00 })
const o4a = await F.placeOrder(pb4.id, basket)
const o4b = await F.placeOrder(pb4.id, [{ variantId: V.soap, qty: 6 }])
const pk4 = await F.pickAndPack([o4a.orderId, o4b.orderId])
const tot4 = pk4.invoices.reduce((s, i) => s + i.totalPaise, 0)
const rF = await F.deskReceipt(pb4.id, 'cash', tot4)
expect('both bills paid', pk4.invoices.every((i) => openOf(i.invoiceId).state === 'paid'))
const cashBefore = L.q1(`select coalesce(sum(l.amount_paise), 0) s from journal_lines l join accounts a on a.id = l.account_id where a.code = 'CASH' and l.tenant_id = '${L.T}'`).s
const rev = await L.tryCall(acc.receivables.receipts.reverse({ ...L.key(), id: rF.receiptId, reversalId: L.uuidv7(), reason: 'QA p7: recorded against the wrong shop' }))
expect('reversal accepted', rev.ok, rev.ok ? `${rev.value.item.receiptNo} ${rev.value.item.amountPaise}` : `${rev.status} ${rev.message}`)
expect('both bills reopened in full', pk4.invoices.every((i) => { const o = openOf(i.invoiceId); return o.state === 'issued' && Number(o.open) === i.totalPaise }), JSON.stringify(pk4.invoices.map((i) => openOf(i.invoiceId))))
const cashAfter = L.q1(`select coalesce(sum(l.amount_paise), 0) s from journal_lines l join accounts a on a.id = l.account_id where a.code = 'CASH' and l.tenant_id = '${L.T}'`).s
expect('cash in hand went back down by exactly the receipt', Number(cashBefore) - Number(cashAfter) === tot4, `${cashBefore} → ${cashAfter}`)
const rev2 = await L.tryCall(acc.receivables.receipts.reverse({ ...L.key(), id: rF.receiptId, reversalId: L.uuidv7(), reason: 'again' }))
expect('a second reversal of the same receipt is refused', !rev2.ok, rev2.ok ? 'ACCEPTED' : `${rev2.status} ${rev2.message}`)
fig = await figures('after reversal', [pb4])
expect('screens agree; the shop owes both bills again', agree(fig, pb4.code).length === 0 && fig.shops[pb4.code].sql.outstanding === tot4, agree(fig, pb4.code).join('; '))
recon('S2-A8-reversal')

// --- A8b reversal of trip cash that was settled and banked ---------------------------------------------------------------
begin('A8b', 'Undo S1\'s full cash payment (trip settled, cash banked): the money leaves the bank, not the van')
const bankBefore = L.q(`select a.code, coalesce(sum(l.amount_paise), 0) s from journal_lines l join accounts a on a.id = l.account_id where a.code in ('BANK', 'CASH', 'CASH_VAN') and l.tenant_id = '${L.T}' group by 1 order by 1`)
const rev3 = await L.tryCall(acc.receivables.receipts.reverse({ ...L.key(), id: S1.receipts.c1, reversalId: L.uuidv7(), reason: 'QA p7: the shop says it never paid' }))
expect('reversal accepted', rev3.ok, rev3.ok ? rev3.value.item.receiptNo : `${rev3.status} ${rev3.message}`)
const j3 = rev3.ok ? L.q(`select a.code, l.amount_paise from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = '${rev3.value.item.id}' order by a.code`) : []
step('reversal journal', j3)
expect('the banked cash is taken from Bank', j3.some((x) => x.code === 'BANK' && x.amount_paise === -S1.bill.PA1.totalPaise), JSON.stringify(j3))
step('bank / cash / van before', bankBefore)
recon('S2-A8b-reverse-banked')

// --- A9 duplicates ------------------------------------------------------------------------------------------------------------
begin('A9', 'The same receipt twice: same idempotency key; then a new key with the same cheque number; then the same paper receipt from a device')
const pb5 = await F.createShop('QA P7 PB5 Duplicate Stores', { creditLimitPaise: 50_000_00 })
const o5 = await F.placeOrder(pb5.id, basket)
const pk5 = await F.pickAndPack([o5.orderId])
const b5 = pk5.invoices[0]
const chq = `CHQ${String(Date.now()).slice(-6)}`
const first = await F.deskReceipt(pb5.id, 'cheque', b5.totalPaise, { reference: chq, chequeDate: F.today(), bankName: 'Cosmos Bank' })
const again = await L.tryCall(acc.receivables.receipts.create({ ...first.input, receivedAt: new Date().toISOString() }))
step('same id + same key replayed', again.ok ? { receiptNo: again.value.item.receiptNo, id: again.value.item.id } : `${again.status} ${again.message}`)
const againDiffBody = await L.tryCall(acc.receivables.receipts.create({ ...first.input, amountPaise: first.input.amountPaise + 100 }))
step('same key, different amount', againDiffBody.ok ? { receiptNo: againDiffBody.value.item.receiptNo, amount: againDiffBody.value.item.amountPaise } : `${againDiffBody.status} ${againDiffBody.message}`)
const n1 = L.q1(`select count(*) n, coalesce(sum(amount_paise), 0) s from receipts where retailer_id = '${pb5.id}'`)
expect('replay with the same key creates nothing new', Number(n1.n) === 1, JSON.stringify(n1))
const second = await F.deskReceipt(pb5.id, 'cheque', b5.totalPaise, { reference: chq, chequeDate: F.today(), bankName: 'Cosmos Bank' })
step('new id + new key, same cheque number, same amount', second.ok ? { receiptNo: second.value.item.receiptNo, alloc: second.value.item.allocatedPaise, unalloc: second.value.item.unallocatedPaise } : `${second.status} ${second.message}`)
expect('a second receipt for the same cheque number of the same shop is refused or flagged', !second.ok, second.ok ? `ACCEPTED as ${second.value.item.receiptNo}: ₹${second.value.item.unallocatedPaise / 100} now sits on the shop's account` : `${second.status} ${second.message}`)
const dev = L.uuidv7()
const paperA = await F.deskReceipt(pb5.id, 'cash', 5000, { deviceId: dev, clientReceiptNo: 'BK-0042', strategy: 'none' })
const paperB = await F.deskReceipt(pb5.id, 'cash', 5000, { deviceId: dev, clientReceiptNo: 'BK-0042', strategy: 'none' })
step('the same paper receipt (device + book no.) sent twice with new ids and keys', { a: paperA.ok ? paperA.value.item.receiptNo : paperA.message, b: paperB.ok ? `${paperB.value.item.receiptNo} id ${paperB.value.item.id === paperA.receiptId ? 'same as first' : 'NEW'}` : paperB.message })
const n2 = L.q1(`select count(*) n from receipts where retailer_id = '${pb5.id}' and client_receipt_no = 'BK-0042'`)
expect('one receipt for one paper slip', Number(n2.n) === 1, JSON.stringify(n2))
fig = await figures('after duplicates', [pb5])
expect('screens agree', agree(fig, pb5.code).length === 0, agree(fig, pb5.code).join('; '))
recon('S2-A9-duplicates')

// --- A12 refund of money on account ------------------------------------------------------------------------------------------
begin('A12', 'Refund / return of money on account (S1 shop PA3 holds ₹105)')
const pa3 = S1.shops.PA3
const neg = await F.deskReceipt(pa3.id, 'cash', -10500)
step('a negative receipt (money out)', neg.ok ? 'ACCEPTED' : `${neg.status} ${neg.message}`)
const adj = await F.deskReceipt(pa3.id, 'adjustment', 10500, { strategy: 'none', note: 'refund?' })
step('mode adjustment ₹105', adj.ok ? { receiptNo: adj.value.item.receiptNo, unalloc: adj.value.item.unallocatedPaise } : `${adj.status} ${adj.message}`)
if (adj.ok) {
  obs('mode "adjustment" is a receipt (money IN, Dr Round off / Cr AR): it ADDS ₹105 more credit to the shop instead of paying the ₹105 back; reversed below to keep the books clean.')
  await L.tryCall(acc.receivables.receipts.reverse({ ...L.key(), id: adj.receiptId, reversalId: L.uuidv7(), reason: 'QA p7: adjustment is not a refund' }))
}
const paths = Object.keys(JSON.parse(readFileSync(`${L.EV}openapi-owner.json`, 'utf8')).paths).filter((p) => /refund|payout|pay-?out|disburse/i.test(p))
step('refund/payout endpoints in the owner API', paths)
expect('a refund of money on account can be recorded', paths.length > 0, 'no refund, payout or debit-note endpoint exists')
fig = await figures('PA3 after refund attempts', [pa3])
recon('S2-A12-refund')

// --- A13 write-off then payment -------------------------------------------------------------------------------------------------
begin('A13', 'Bad-debt write-off of the rest of a bill, then the shop pays it after all')
const pb6 = await F.createShop('QA P7 PB6 Writeoff Stores', { creditLimitPaise: 50_000_00 })
const o6 = await F.placeOrder(pb6.id, basket)
const pk6 = await F.pickAndPack([o6.orderId])
const b6 = pk6.invoices[0]
await F.deskReceipt(pb6.id, 'cash', 20000)
const woAmt = b6.totalPaise - 20000
const partial = await L.tryCall(owner.receivables.writeOffs.create({ ...L.mk(), invoiceId: b6.invoiceId, amountPaise: 1000, reason: 'rounding', note: 'QA p7 partial' }))
step('partial write-off of ₹10', partial.ok ? { state: openOf(b6.invoiceId) } : `${partial.status} ${partial.message}`)
const wo = await L.tryCall(owner.receivables.writeOffs.create({ ...L.mk(), invoiceId: b6.invoiceId, amountPaise: Number(openOf(b6.invoiceId).open), reason: 'bad_debt', note: 'QA p7: shop closed' }))
expect('write-off of what is left accepted; bill written off', wo.ok && openOf(b6.invoiceId).state === 'written_off', wo.ok ? JSON.stringify(openOf(b6.invoiceId)) : `${wo.status} ${wo.message}`)
const accWo = await L.tryCall(acc.receivables.writeOffs.create({ ...L.mk(), invoiceId: pk4.invoices[1].invoiceId, amountPaise: 100, reason: 'bad_debt' }))
step('the accountant writes off ₹1 (docs/22: accountant may record write-offs; contract summary says owner only)', accWo.ok ? 'ACCEPTED' : `${accWo.status} ${accWo.message}`)
const rep = await L.as('rep')
const repWo = await L.tryCall(rep.receivables.writeOffs.create({ ...L.mk(), invoiceId: pk4.invoices[1].invoiceId, amountPaise: 100, reason: 'bad_debt' }))
expect('a salesperson cannot write off', !repWo.ok, repWo.ok ? 'ACCEPTED' : `${repWo.status}`)
fig = await figures('after write-off', [pb6])
const bdBefore = L.q1(`select coalesce(sum(l.amount_paise), 0) s from journal_lines l join accounts a on a.id = l.account_id where a.code = 'BAD_DEBTS' and l.party_id is null and l.tenant_id = '${L.T}'`).s
const late = await F.deskReceipt(pb6.id, 'cash', woAmt)
step('the shop pays the written-off amount', late.ok ? { receiptNo: late.value.item.receiptNo, alloc: late.value.item.allocatedPaise, unalloc: late.value.item.unallocatedPaise } : late.message)
const bdAfter = L.q1(`select coalesce(sum(l.amount_paise), 0) s from journal_lines l join accounts a on a.id = l.account_id where a.code = 'BAD_DEBTS' and l.tenant_id = '${L.T}'`).s
fig = await figures('after the late payment', [pb6])
const f6 = fig.shops[pb6.code]
step('shop after late payment', { dues: f6.sql.outstanding, onAccount: f6.sql.onAccount, net: f6.sql.net, bill: openOf(b6.invoiceId), badDebtsTotal: bdAfter })
expect('the recovered money is booked as a bad-debt recovery (the write-off undone), not as the shop\'s credit', late.ok && late.value.item.unallocatedPaise === 0, late.ok ? `₹${late.value.item.unallocatedPaise / 100} parked on the shop's account; bill stays written_off; Bad debts unchanged` : '')
const o6b = await F.placeOrder(pb6.id, basket)
if (o6b.submitted.ok && o6b.submitted.value.item.state !== 'confirmed') await F.approveAll(o6b.orderId)
const pk6b = await F.pickAndPack([o6b.orderId])
fig = await figures('next bill after the recovered money', [pb6])
const f6b = fig.shops[pb6.code]
step('next bill: dues and on-account side by side', { newBill: pk6b.invoices[0].totalPaise, dues: f6b.sql.outstanding, onAccount: f6b.sql.onAccount, net: f6b.sql.net })
recon('S2-A13-writeoff')

save('results-s2.json')
writeFileSync(`${L.EV}s2-context.json`, JSON.stringify({ pb2, pb3, pb4, pb5, pb6, joshi, ganpati, receipts: { rA: rA.receiptId, rB: rB.receiptId, rC: rC.receiptId, rD: rD.receiptId, rE: rE.receiptId, rF: rF.receiptId, first: first.receiptId, second: second.receiptId, late: late.receiptId }, bills: { b2, b3, b5, b6, pk4: pk4.invoices, b6b: pk6b.invoices[0] }, trip2 }, null, 2))
