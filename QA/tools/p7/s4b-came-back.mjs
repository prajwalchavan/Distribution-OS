// Phase 7 · S4 addendum — the two refused bills after check-in: RT5 credited in full at the desk (the shop never wants it),
// RT6 re-planned onto a new trip, delivered and paid. Stock and money for both.
import { readFileSync, writeFileSync } from 'node:fs'
import { begin, step, expect, figures, agree, recon, save, L, F } from './scenario-kit.mjs'
const C = JSON.parse(readFileSync(`${L.EV}s4-context.json`, 'utf8'))
const mgr = await L.as('manager')
const LOC = Object.fromEntries(L.q(`select id, kind::text, name from locations where tenant_id = '${L.T}'`).map((l) => [l.id, l.kind === 'vehicle' ? `van ${l.name.replace('Vehicle ', '')}` : l.kind]))
const moves = (refIds) => L.q(`select sl.ref_type, sl.reason::text, sl.lot_id, sl.location_id, sl.qty_delta from stock_ledger sl where sl.ref_id in (${refIds.map((r) => `'${r}'`).join(',')}) order by sl.created_at, sl.id`).map((m) => ({ reason: m.reason, lot: m.lot_id.slice(-6), where: LOC[m.location_id] ?? m.location_id, qty: m.qty_delta }))
const openOf = (id) => L.q1(`select i.invoice_no, i.state::text state, i.undelivered_at, i.total_paise total, i.total_paise - coalesce((select sum(amount_paise) from allocations a where a.invoice_id = i.id), 0) open from invoices i where i.id = '${id}'`)

begin('R1c', 'Full refusal, final: the desk credits the whole came-back bill (RT5) — stock back from the dock, dues cleared')
const b5 = C.B.RT5
const l5 = L.q(`select id, qty_pcs + free_qty_pcs pcs from invoice_lines where invoice_id = '${b5.invoiceId}'`)
const cn = await L.tryCall(mgr.billing.creditNotes.create({ ...L.mk(), invoiceId: b5.invoiceId, reason: 'cancellation', restockLocationId: L.GODOWN, autoIssue: true, note: 'QA p7: shop refused, will not take it', lines: l5.map((l) => ({ id: L.uuidv7(), invoiceLineId: l.id, qtyPcs: l.pcs, saleable: true })) }))
step('whole-bill credit note', cn.ok ? { no: cn.value.item?.creditNoteNo, total: cn.value.item?.totalPaise, state: cn.value.item?.state } : `${cn.status} ${cn.message}`)
expect('credit = bill total', cn.ok && cn.value.item?.totalPaise === b5.totalPaise, cn.ok ? `${cn.value.item?.totalPaise} vs ${b5.totalPaise}` : '')
step('bill after', openOf(b5.invoiceId))
if (cn.ok) step('stock moves of the note (from where to where)', moves([cn.value.item.id]))
let fig = await figures('RT5 after the whole-bill credit', [C.S.RT5])
expect('shop owes nothing, nothing left undelivered; screens agree', agree(fig, C.S.RT5.code).length === 0 && fig.shops[C.S.RT5.code].sql.net === 0 && fig.shops[C.S.RT5.code].sql.undelivered === 0, JSON.stringify(fig.shops[C.S.RT5.code].sql))
const dockLeft = L.q(`select b.location_id, b.on_hand from stock_balances b join invoice_lines il on il.lot_id = b.lot_id where il.invoice_id = '${b5.invoiceId}' and b.on_hand <> 0`).map((b) => `${LOC[b.location_id]}:${b.on_hand}`)
step('balances of its lots now', dockLeft)
recon('S4-R1c-full-credit')

begin('R1d', 'The other refused bill (RT6) goes out again on a new trip, is delivered and paid in cash')
const b6 = C.B.RT6
const trip = await F.tripOut([{ retailerId: C.S.RT6.id, invoiceIds: [b6.invoiceId] }], { vehicle: 'A', driver: 'driver' })
step('re-planned and departed', trip.tripId)
const d = await F.deliver(trip, trip.stops[0], b6.invoiceId)
expect('delivered', d.ok, d.ok ? d.value.item.outcome : d.message)
step('bill after delivery', openOf(b6.invoiceId))
const pay = await F.collect(trip, trip.stops[0], C.S.RT6.id, 'cash', b6.totalPaise)
expect('paid', pay.ok && openOf(b6.invoiceId).state === 'paid', pay.ok ? '' : pay.message)
const st = await F.checkInAndSettle(trip)
expect('settled at the expected cash', st.settle.ok, st.settle.ok ? `${st.preview.expectedCashPaise}` : st.settle.message)
fig = await figures('RT6 after re-delivery', [C.S.RT6])
expect('screens agree; nothing owed; nothing on the van', agree(fig, C.S.RT6.code).length === 0 && fig.shops[C.S.RT6.code].sql.net === 0, JSON.stringify(fig.shops[C.S.RT6.code].sql))
recon('S4-R1d-redeliver')
save('results-s4.json')
writeFileSync(`${L.EV}s4b-context.json`, JSON.stringify({ trip, cn: cn.ok ? cn.value.item.id : null }, null, 2))
