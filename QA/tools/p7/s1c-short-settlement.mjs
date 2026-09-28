// Phase 7 · S1 addendum — a short settlement then day-end banking (measures the money effect of known DOS-258),
// and a cash receipt refused after its trip settled (DOS-169 door) handed to the cashier.
import { begin, step, obs, expect, figures, agree, recon, save, L, F } from './scenario-kit.mjs'
const V = { cola: 'f71bf137-50de-7182-a0d9-c83f1a613a57', glucose: 'af45e021-a167-7d3f-a8f0-60ab037214cb' }
const acc = await L.as('accountant')
const bal = (codes) => Object.fromEntries(L.q(`select a.code, coalesce(sum(l.amount_paise), 0) s from accounts a left join journal_lines l on l.account_id = a.id where a.tenant_id = '${L.T}' and a.code in (${codes.map((c) => `'${c}'`).join(',')}) group by 1`).map((r) => [r.code, Number(r.s)]))

begin('A7d', 'Short settlement: the crew collects ₹595 cash but hands over ₹545 (inside the ₹100 tolerance); day-end banks the receipt')
const shop = await F.createShop('QA P7 PA7 Short-cash Stores', { creditLimitPaise: 50_000_00 })
const o = await F.placeOrder(shop.id, [{ variantId: V.cola, qty: 12 }, { variantId: V.glucose, qty: 24 }])
const pp = await F.pickAndPack([o.orderId])
const b = pp.invoices[0]
const trip = await F.tripOut([{ retailerId: shop.id, invoiceIds: [b.invoiceId] }], { vehicle: 'B', driver: 'driver2', floatPaise: 0 })
await F.deliver(trip, trip.stops[0], b.invoiceId)
const c = await F.collect(trip, trip.stops[0], shop.id, 'cash', b.totalPaise)
expect('collected', c.ok)
const before = bal(['CASH', 'CASH_VAN', 'CASH_SHORT', 'BANK'])
const st = await F.checkInAndSettle(trip, { handedOverCashPaise: b.totalPaise - 5000 })
step('settle short by ₹50', st.settle.ok ? { state: st.settle.value.tripState, expected: st.settle.value.item.expectedCashPaise, handed: st.settle.value.item.handedOverCashPaise, variance: st.settle.value.item.cashVariancePaise } : `${st.settle.status} ${st.settle.message}`)
const afterSettle = bal(['CASH', 'CASH_VAN', 'CASH_SHORT', 'BANK'])
const dep = await F.deposit([c.receiptId])
step('day-end banks the receipt', dep.ok ? dep.value : `${dep.status} ${dep.message}`)
const afterBank = bal(['CASH', 'CASH_VAN', 'CASH_SHORT', 'BANK'])
const delta = (a, z) => Object.fromEntries(Object.keys(z).map((k) => [k, z[k] - a[k]]))
step('movement: settlement', delta(before, afterSettle))
step('movement: banking', delta(afterSettle, afterBank))
const cashNet = afterBank.CASH - before.CASH
step('net change in Cash in hand over settle + bank', cashNet)
if (cashNet !== 0) obs(`DOS-258 (known) measured: the office was handed ₹${(b.totalPaise - 5000) / 100} but banked ₹${b.totalPaise / 100}; Cash in hand moves by ₹${cashNet / 100} although the till received and released the same notes — the book now shows ₹${-cashNet / 100} less cash than the drawer holds (or a phantom ₹${-cashNet / 100} banked).`)
recon('S1-A7d-short-settlement')

begin('A7e', 'Late cash for a settled trip: refused at the door; the cashier records it at the office')
const late = await F.collect(trip, trip.stops[0], shop.id, 'cash', 1000)
expect('the phone\'s late cash for a settled trip is refused (DOS-169)', !late.ok, late.ok ? 'ACCEPTED' : `${late.status} ${late.message}`)
const desk = await F.deskReceipt(shop.id, 'cash', 1000, { strategy: 'none', note: 'QA p7: handed to the cashier' })
expect('the cashier records it with no trip', desk.ok && desk.value.item.tripId === null, desk.ok ? desk.value.item.receiptNo : desk.message)
const fig = await figures('after late cash', [shop])
expect('screens agree', agree(fig, shop.code).length === 0, agree(fig, shop.code).join('; '))
recon('S1-A7e-late-cash')
save('results-s1.json')
