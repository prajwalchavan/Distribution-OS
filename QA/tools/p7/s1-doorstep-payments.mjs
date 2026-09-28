// Phase 7 · S1 — money at the door on one trip: full, part, over-payment, UPI, cheque (banked then bounced), cash discount.
import { begin, step, obs, expect, figures, agree, recon, save, L, F } from './scenario-kit.mjs'

const V = { cola: 'f71bf137-50de-7182-a0d9-c83f1a613a57', glucose: 'af45e021-a167-7d3f-a8f0-60ab037214cb' }
const basket = [{ variantId: V.cola, qty: 12 }, { variantId: V.glucose, qty: 24 }]

begin('S1-setup', 'Six shops, one bill each, one trip (order → pick → pack/bill → load → depart)')
const shops = {}
for (const [k, terms] of Object.entries({
  PA1: {},
  PA2: {},
  PA3: {},
  PA4: {},
  PA5: {},
  PA6: { cashDiscountBps: 200, cashDiscountDays: 7 },
})) shops[k] = await F.createShop(`QA P7 ${k} ${k === 'PA6' ? 'Cash-discount' : 'Door'} Stores`, { creditLimitPaise: 50_000_00, ...terms })
step('shops', Object.fromEntries(Object.entries(shops).map(([k, s]) => [k, s.code])))
const orders = {}
for (const [k, s] of Object.entries(shops)) {
  const o = await F.placeOrder(s.id, basket)
  orders[k] = o.orderId
  expect(`${k} order confirmed on submit`, o.submitted.ok && o.submitted.value.item.state === 'confirmed', `${o.submitted.value?.item?.orderNo} ${o.submitted.value?.item?.state} ${o.submitted.value?.item?.totalPaise}`)
}
const pp = await F.pickAndPack(Object.values(orders))
const bill = {}
for (const [k, oid] of Object.entries(orders)) bill[k] = pp.invoices.find((i) => i.orderId === oid)
step('bills', Object.fromEntries(Object.entries(bill).map(([k, b]) => [k, `${b.invoiceNo} ${b.totalPaise}`])))
const order0 = await F.orderRow(orders.PA1)
expect('order total = invoice total (PA1)', order0.total_paise === bill.PA1.totalPaise, `${order0.total_paise} vs ${bill.PA1.totalPaise}`)
const cd = L.q1(`select cash_discount_bps, cash_discount_until::text, total_paise from invoices where id = '${bill.PA6.invoiceId}'`)
step('PA6 bill carries the cash-discount window', cd)
const trip = await F.tripOut(Object.keys(shops).map((k) => ({ retailerId: shops[k].id, invoiceIds: [bill[k].invoiceId] })), { floatPaise: 100000 })
step('trip departed with ₹1,000 float', trip.tripId)
const stop = Object.fromEntries(Object.keys(shops).map((k, i) => [k, trip.stops[i]]))
recon('S1-00-setup')
save('results-s1.json')

// --- deliveries (all full) --------------------------------------------------------------------------------------
begin('S1-deliver', 'Deliver all six bills in full with proof')
for (const k of Object.keys(shops)) {
  const d = await F.deliver(trip, stop[k], bill[k].invoiceId)
  expect(`${k} delivered`, d.ok && d.value.item.outcome === 'delivered', d.ok ? d.value.item.outcome : `${d.status} ${d.message}`)
}

// --- A1 payment in full ------------------------------------------------------------------------------------------
begin('A1', 'Payment in full, cash at the door')
const t = bill.PA1.totalPaise
const c1 = await F.collect(trip, stop.PA1, shops.PA1.id, 'cash', t)
expect('receipt recorded and fully allocated', c1.ok && c1.value.receipt.allocatedPaise === t && c1.value.receipt.unallocatedPaise === 0, c1.ok ? JSON.stringify({ no: c1.value.receipt.receiptNo, alloc: c1.value.receipt.allocatedPaise }) : `${c1.status} ${c1.message}`)
const s1 = L.q1(`select state::text from invoices where id = '${bill.PA1.invoiceId}'`)
expect('bill paid', s1.state === 'paid', s1.state)
let fig = await figures('after full payment', [shops.PA1])
expect('all screens agree with SQL and the journal', agree(fig, shops.PA1.code).length === 0, agree(fig, shops.PA1.code).join('; '))
recon('S1-A1-full')

// --- A2 part payment ----------------------------------------------------------------------------------------------
begin('A2', 'Part payment, cash at the door (₹200 of the bill)')
const c2 = await F.collect(trip, stop.PA2, shops.PA2.id, 'cash', 20000)
expect('receipt allocated ₹200 to the bill', c2.ok && c2.value.receipt.allocatedPaise === 20000, c2.ok ? c2.value.receipt.receiptNo : c2.message)
const s2 = L.q1(`select state::text, total_paise - (select sum(amount_paise) from allocations where invoice_id = i.id) open from invoices i where id = '${bill.PA2.invoiceId}'`)
expect('bill partially paid, open = total − 200', s2.state === 'partially_paid' && Number(s2.open) === bill.PA2.totalPaise - 20000, JSON.stringify(s2))
fig = await figures('after part payment', [shops.PA2])
expect('all screens agree', agree(fig, shops.PA2.code).length === 0, agree(fig, shops.PA2.code).join('; '))
recon('S1-A2-part')

// --- A3 over-payment ----------------------------------------------------------------------------------------------
begin('A3', 'Over-payment, cash at the door (bill + ₹105)')
const c3 = await F.collect(trip, stop.PA3, shops.PA3.id, 'cash', bill.PA3.totalPaise + 10500)
expect('receipt: bill fully allocated, ₹105 left on account', c3.ok && c3.value.receipt.allocatedPaise === bill.PA3.totalPaise && c3.value.receipt.unallocatedPaise === 10500, c3.ok ? JSON.stringify({ alloc: c3.value.receipt.allocatedPaise, unalloc: c3.value.receipt.unallocatedPaise }) : c3.message)
fig = await figures('after over-payment', [shops.PA3])
expect('shop shows ₹0 dues and ₹105 on account everywhere; net −105 = AR', agree(fig, shops.PA3.code).length === 0 && fig.shops[shops.PA3.code].sql.net === -10500, agree(fig, shops.PA3.code).join('; '))
recon('S1-A3-over')

// --- A4 UPI ----------------------------------------------------------------------------------------------------------
begin('A11', 'UPI at the door with the UTR')
const c4 = await F.collect(trip, stop.PA4, shops.PA4.id, 'upi', bill.PA4.totalPaise, { reference: `UTR${Date.now()}`, upiVpa: 'pa4shop@okaxis' })
expect('UPI receipt allocated in full', c4.ok && c4.value.receipt.allocatedPaise === bill.PA4.totalPaise, c4.ok ? c4.value.receipt.receiptNo : c4.message)
const j4 = L.q(`select a.code, l.amount_paise from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = '${c4.receiptId}' order by a.code`)
step('journal lines of the UPI receipt', j4)
expect('UPI lands in UPI clearing, never in the crew\'s cash', j4.some((x) => x.code === 'UPI' && x.amount_paise === bill.PA4.totalPaise) && !j4.some((x) => x.code === 'CASH_VAN'))
recon('S1-A11-upi')

// --- A5 cheque ------------------------------------------------------------------------------------------------------
begin('A7a', 'Cheque received at the door')
const chq = `CHQ${String(Date.now()).slice(-6)}`
const c5 = await F.collect(trip, stop.PA5, shops.PA5.id, 'cheque', bill.PA5.totalPaise, { reference: chq, chequeDate: F.today(), bankName: 'Saraswat Bank' })
expect('cheque receipt allocated; bill paid', c5.ok && c5.value.receipt.allocatedPaise === bill.PA5.totalPaise, c5.ok ? c5.value.receipt.receiptNo : c5.message)
const j5 = L.q(`select a.code, l.amount_paise from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = '${c5.receiptId}' order by a.code`)
step('journal lines of the cheque receipt', j5)
recon('S1-A7a-cheque')

// --- A10 cash discount ------------------------------------------------------------------------------------------------
begin('A10', 'Cash discount: shop on 2% / 7 days pays the bill less 2% at the door, inside the window')
const disc = Math.round((bill.PA6.totalPaise * 200) / 10000)
const pay6 = bill.PA6.totalPaise - disc
step(`bill ${bill.PA6.totalPaise}, 2% = ${disc}, pays ${pay6}`)
const c6 = await F.collect(trip, stop.PA6, shops.PA6.id, 'cash', pay6)
expect('receipt realises the discount and settles the bill', c6.ok && c6.value.receipt.cashDiscountPaise === disc && c6.value.receipt.unallocatedPaise === 0, c6.ok ? JSON.stringify({ cd: c6.value.receipt.cashDiscountPaise, alloc: c6.value.receipt.allocatedPaise, unalloc: c6.value.receipt.unallocatedPaise }) : c6.message)
const s6 = L.q1(`select state::text from invoices where id = '${bill.PA6.invoiceId}'`)
expect('bill paid', s6.state === 'paid', s6.state)
const j6 = L.q(`select a.code, l.amount_paise from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = '${c6.receiptId}' order by a.code`)
step('journal lines of the discounted receipt', j6)
const cn6 = L.q(`select count(*) n from credit_notes where invoice_id = '${bill.PA6.invoiceId}'`)[0]
step('credit notes raised for the discount (docs/22 §6 says realised as a credit note)', cn6)
if (Number(cn6.n) === 0) obs('Cash discount realised as a journal line (Dr Cash discount allowed / Cr AR) on the receipt, no credit note and no GST reversal: docs/22 §6 draws it as "realised as a credit note only when paid on time".')
fig = await figures('after discounted payment', [shops.PA6])
expect('screens agree; net 0', agree(fig, shops.PA6.code).length === 0 && fig.shops[shops.PA6.code].sql.net === 0, agree(fig, shops.PA6.code).join('; '))
recon('S1-A10-cashdisc')

// --- settle + bank --------------------------------------------------------------------------------------------------
begin('A7b', 'Check in, settle the trip, bank the cash and the cheque')
const st = await F.checkInAndSettle(trip)
step('settlement preview', { expected: st.preview.expectedCashPaise, cash: st.preview.cashCollectedPaise, upi: st.preview.upiCollectedPaise, cheque: st.preview.chequeCollectedPaise, float: st.preview.openingCashPaise })
const expectCash = 100000 + bill.PA1.totalPaise + 20000 + bill.PA3.totalPaise + 10500 + pay6
expect('expected cash = float + every cash receipt', st.preview.expectedCashPaise === expectCash, `${st.preview.expectedCashPaise} vs ${expectCash}`)
expect('settled', st.settle.ok && st.settle.value.tripState === 'settled', st.settle.ok ? st.settle.value.tripState : st.settle.message)
const cashIds = [c1, c2, c3, c6].map((c) => c.receiptId)
const dep = await F.deposit([...cashIds, c5.receiptId])
expect('cash and the cheque banked in one slip', dep.ok, dep.ok ? JSON.stringify(dep.value) : dep.message)
const upiDep = await F.deposit([c4.receiptId])
step('try to bank the UPI receipt', upiDep.ok ? upiDep.value : `${upiDep.status} ${upiDep.message}`)
recon('S1-A7b-banked')

// --- bounce -----------------------------------------------------------------------------------------------------------
begin('A7c', 'The banked cheque bounces (₹250 bank charge)')
const acc = await L.as('accountant')
const bounce = await L.tryCall(acc.receivables.receipts.bounce({ ...L.key(), id: c5.receiptId, reversalId: L.uuidv7(), bouncedAt: new Date().toISOString(), reason: 'Funds insufficient (QA p7)', bankChargesPaise: 25000 }))
expect('bounce accepted', bounce.ok, bounce.ok ? `${bounce.value.item.receiptNo} ${bounce.value.item.amountPaise}` : `${bounce.status} ${bounce.message}`)
const s5 = L.q1(`select state::text, total_paise - coalesce((select sum(amount_paise) from allocations where invoice_id = i.id), 0) open from invoices i where id = '${bill.PA5.invoiceId}'`)
expect('bill reopened in full', s5.state === 'issued' && Number(s5.open) === bill.PA5.totalPaise, JSON.stringify(s5))
const jb = L.q(`select e.ref_type, a.code, l.amount_paise from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_type = 'receipt_reversal' and e.ref_id = '${bounce.ok ? bounce.value.item.id : ''}' order by a.code`)
step('bounce journal', jb)
fig = await figures('after bounce', [shops.PA5])
expect('screens agree; the shop owes the bill again (charges not added to its dues)', agree(fig, shops.PA5.code).length === 0 && fig.shops[shops.PA5.code].sql.outstanding === bill.PA5.totalPaise, agree(fig, shops.PA5.code).join('; '))
if (!jb.some((x) => x.code === 'AR' && x.amount_paise > bill.PA5.totalPaise)) obs('The ₹250 bank charge is booked Dr Bank charges / Cr Bank (the distributor bears it); nothing is added to the shop\'s dues and no debit note exists to recover it.')
recon('S1-A7c-bounce')

// --- figures for all six --------------------------------------------------------------------------------------------
begin('S1-close', 'All six shops after settlement, banking and the bounce')
fig = await figures('close', Object.values(shops))
for (const s of Object.values(shops)) expect(`${s.code} screens agree with SQL and AR`, agree(fig, s.code).length === 0, agree(fig, s.code).join('; '))
const tripRow = L.q1(`select t.trip_no, t.state::text, s.expected_cash_paise, s.handed_over_cash_paise, s.upi_collected_paise from trips t join trip_settlements s on s.trip_id = t.id where t.id = '${trip.tripId}'`)
step('trip', tripRow)
recon('S1-99-close')
save('results-s1.json')
import { writeFileSync } from 'node:fs'
writeFileSync(`${L.EV}s1-context.json`, JSON.stringify({ shops, orders, bill, trip, receipts: { c1: c1.receiptId, c2: c2.receiptId, c3: c3.receiptId, c4: c4.receiptId, c5: c5.receiptId, c6: c6.receiptId }, cheque: chq }, null, 2))
