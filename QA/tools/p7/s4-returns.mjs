// Phase 7 · S4 — returns and damage: full refusal, part return, wrong item, damaged and expired at the door, a failed stop,
// return after delivery, return after payment, return of scheme / free-goods lines, replacement, bill cancelled before
// dispatch and after money was taken. For each: the stock consequence (batch, location, sellable?) AND the money.
import { writeFileSync, readFileSync } from 'node:fs'
import { begin, step, obs, expect, figures, agree, recon, save, L, F } from './scenario-kit.mjs'

const V = { cola: 'f71bf137-50de-7182-a0d9-c83f1a613a57', glucose: 'af45e021-a167-7d3f-a8f0-60ab037214cb', soap: '8549cf4f-2489-772a-9691-7eeda70e8bdc', marie: '3cb5e1c4-c6b4-70ec-9af7-17287907a43a' }
const basket = [{ variantId: V.cola, qty: 12 }, { variantId: V.glucose, qty: 24 }]
const owner = await L.as('owner')
const acc = await L.as('accountant')
const mgr = await L.as('manager')
const LOC = Object.fromEntries(L.q(`select id, kind::text, name from locations where tenant_id = '${L.T}'`).map((l) => [l.id, l.kind === 'vehicle' ? `van ${l.name.replace('Vehicle ', '')}` : l.kind]))
const lines = (invoiceId) => L.q(`select il.id, il.line_no, pv.name, il.lot_id, il.batch_no, il.qty_pcs, il.free_qty_pcs, il.rate_paise, il.discount_paise, il.taxable_paise, il.gst_bps, il.cess_bps, il.line_total_paise, il.applied_rules from invoice_lines il join product_variants pv on pv.id = il.variant_id where il.invoice_id = '${invoiceId}' order by il.line_no`)
const cnOf = (invoiceId) => L.q(`select c.id, c.credit_note_no, c.reason::text, c.state::text, c.taxable_paise, c.cgst_paise + c.sgst_paise + c.igst_paise tax, c.cess_paise, c.round_off_paise, c.total_paise from credit_notes c where c.invoice_id = '${invoiceId}' order by c.created_at`)
const cnLines = (cnId) => L.q(`select l.invoice_line_id, l.qty_pcs, l.saleable, l.rate_paise, l.taxable_paise, l.tax_paise, l.line_total_paise from credit_note_lines l where l.credit_note_id = '${cnId}'`)
const moves = (refIds) => L.q(`select sl.ref_type, sl.reason::text, sl.lot_id, sl.location_id, sl.qty_delta from stock_ledger sl where sl.ref_id in (${refIds.map((r) => `'${r}'`).join(',')}) order by sl.created_at, sl.id`).map((m) => ({ ...m, where: LOC[m.location_id] ?? m.location_id }))
const lotAt = (lotId) => L.q(`select b.location_id, b.on_hand from stock_balances b where b.lot_id = '${lotId}' and b.on_hand <> 0`).map((b) => `${LOC[b.location_id] ?? b.location_id}:${b.on_hand}`)
const openOf = (invoiceId) => L.q1(`select i.invoice_no, i.state::text state, i.total_paise total, i.total_paise - coalesce((select sum(amount_paise) from allocations a where a.invoice_id = i.id), 0) open from invoices i where i.id = '${invoiceId}'`)
const sellableAt = (lotId) => L.q(`select location_id, available from sellable_stock where lot_id = '${lotId}'`).map((s) => `${LOC[s.location_id] ?? s.location_id}:${s.available}`)

begin('S4-setup', 'Shops, a scheme shop, orders, bills and one trip')
const S = {}
for (const k of ['RT1', 'RT2', 'RT3', 'RT4', 'RT5', 'RT6', 'RT7', 'RT8', 'RT9', 'RT10']) S[k] = await F.createShop(`QA P7 ${k} Returns Stores (run 2)`, { creditLimitPaise: 100_000_00 })
// scheme shop: 12 + 2 free on Glucose 55 g, 10 % off soap, only for RT4
const sch1 = L.mk()
const sc1 = await L.tryCall(owner.pricing.schemes.upsert({ ...sch1, name: 'QA P7 Glucose 12+2 (RT4 only)', scope: { variantIds: [V.glucose] }, triggerKind: 'qty', triggerMin: 12, triggerUnit: 'pcs', rewardKind: 'free_qty', rewardValue: 2, freeVariantId: V.glucose, applicability: { retailerIds: [S.RT4.id] }, validFrom: F.today(), validTo: '2026-12-31', stackable: true, fundingSource: 'distributor', active: true }))
const sch2 = L.mk()
const sc2 = await L.tryCall(owner.pricing.schemes.upsert({ ...sch2, name: 'QA P7 Soap 10% (RT4 only)', scope: { variantIds: [V.soap] }, triggerKind: 'qty', triggerMin: 6, triggerUnit: 'pcs', rewardKind: 'line_pct', rewardValue: 1000, applicability: { retailerIds: [S.RT4.id] }, validFrom: F.today(), validTo: '2026-12-31', stackable: true, fundingSource: 'distributor', active: true }))
step('schemes for RT4', { freeGoods: sc1.ok ? 'ok' : sc1.message, pct: sc2.ok ? 'ok' : sc2.message })
const O = {}
for (const k of Object.keys(S)) {
  const b = k === 'RT4' ? [{ variantId: V.glucose, qty: 24 }, { variantId: V.soap, qty: 12 }] : k === 'RT3' ? [{ variantId: V.marie, qty: 12 }, { variantId: V.glucose, qty: 24 }] : basket
  const o = await F.placeOrder(S[k].id, b)
  if (o.submitted.value?.item?.state !== 'confirmed') await F.approveAll(o.orderId)
  O[k] = o.orderId
}
const pp = await F.pickAndPack(Object.values(O))
const B = Object.fromEntries(Object.entries(O).map(([k, oid]) => [k, pp.invoices.find((i) => i.orderId === oid)]))
step('bills', Object.fromEntries(Object.entries(B).map(([k, b]) => [k, `${b.invoiceNo} ${b.totalPaise}`])))
step('RT4 bill lines (scheme)', lines(B.RT4.invoiceId).map((l) => ({ n: l.name, qty: l.qty_pcs, free: l.free_qty_pcs, rate: l.rate_paise, disc: l.discount_paise, total: l.line_total_paise, rules: l.applied_rules?.map?.((r) => r.kind) })))

// RT9 / RT10 stay behind (cancel scenarios); the rest go out
const out = ['RT1', 'RT2', 'RT3', 'RT4', 'RT5', 'RT6', 'RT7', 'RT8']
const trip = await F.tripOut(out.map((k) => ({ retailerId: S[k].id, invoiceIds: [B[k].invoiceId] })), { vehicle: 'C', driver: 'driver3', floatPaise: 0 })
const stop = Object.fromEntries(out.map((k, i) => [k, trip.stops[i]]))
recon('S4-00-setup')
save('results-s4.json')

async function doorReturn(id, title, k, perLine, reason) {
  begin(id, title)
  const ls = lines(B[k].invoiceId)
  const spec = perLine(ls)
  const d = await F.deliver(trip, stop[k], B[k].invoiceId, spec)
  expect('delivery recorded', d.ok, d.ok ? `${d.value.item.outcome} cn ${d.value.item.creditNoteId ?? d.value.creditNote?.id ?? '-'}` : `${d.status} ${d.message}`)
  const cns = cnOf(B[k].invoiceId)
  step('credit note(s)', cns)
  for (const c of cns) step(`CN ${c.credit_note_no} lines`, cnLines(c.id))
  step('bill after the door', openOf(B[k].invoiceId))
  step('stock moves of the delivery and its note', moves([d.deliveryId, ...cns.map((c) => c.id)]))
  const fig = await figures('after the door', [S[k]])
  expect('screens agree with SQL and AR', agree(fig, S[k].code).length === 0, agree(fig, S[k].code).join('; '))
  recon(`S4-${id}`)
  return { d, cns, ls }
}

// R1 full refusal (delivered 0, all returned)
const r1 = await doorReturn('R1', 'Full return at the door: the shop refuses everything (delivered 0, all returned, saleable)', 'RT5', (ls) => Object.fromEntries(ls.map((l) => [l.id, { delivered: 0, returned: l.qty_pcs + l.free_qty_pcs, saleable: true, reason: 'refused' }])))
expect('CN = the whole bill incl. GST; bill closed; shop owes nothing', r1.cns.length === 1 && r1.cns[0].total_paise === B.RT5.totalPaise && Number(openOf(B.RT5.invoiceId).open) === 0, JSON.stringify(r1.cns.map((c) => c.total_paise)))
// R2 part return
const r2 = await doorReturn('R2', 'Part return at the door: 6 of 24 Glucose back, saleable', 'RT1', (ls) => ({ [ls[1].id]: { delivered: ls[1].qty_pcs - 6, returned: 6, saleable: true, reason: 'other' } }))
const l2 = r2.ls[1]
const exp2 = Math.round((l2.line_total_paise * 6) / l2.qty_pcs)
expect('CN ≈ 6/24 of the Glucose line incl. GST (± rounding)', r2.cns.length === 1 && Math.abs(r2.cns[0].total_paise - exp2) <= 100, `${r2.cns[0]?.total_paise} vs ${exp2}`)
// R3 wrong item
const r3 = await doorReturn('R3', 'Wrong item at the door: 2 Cola sent back as wrong item, saleable', 'RT2', (ls) => ({ [ls[0].id]: { delivered: ls[0].qty_pcs - 2, returned: 2, saleable: true, reason: 'wrong_item' } }))
// R4 damaged + expired
const r4 = await doorReturn('R4', 'Damaged and expired at the door: 3 Marie damaged, 2 Glucose expired, not saleable', 'RT3', (ls) => ({ [ls[0].id]: { delivered: ls[0].qty_pcs - 3, returned: 3, saleable: false, reason: 'damaged' }, [ls[1].id]: { delivered: ls[1].qty_pcs - 2, returned: 2, saleable: false, reason: 'expired' } }))
const cn4 = r4.cns[0]
step('reason recorded on the CN', cn4?.reason)
// R5 scheme shop delivered in full (returns at the desk later)
begin('R8-door', 'Scheme shop RT4 delivered in full')
const d4 = await F.deliver(trip, stop.RT4, B.RT4.invoiceId)
expect('delivered', d4.ok)
// R6 failed stop
begin('R1b', 'The shop refuses at the door without a delivery record: stop failed "refused" (the bill comes back)')
const drv = await L.as(trip.driverWho)
await L.tryCall(drv.delivery.stops.start({ ...L.key(), id: stop.RT6.id }))
await L.tryCall(drv.delivery.stops.arrive({ ...L.key(), id: stop.RT6.id }))
const fail = await L.tryCall(drv.delivery.stops.fail({ ...L.key(), id: stop.RT6.id, failureReason: 'refused', failureNote: 'QA p7: shop refused' }))
expect('stop failed', fail.ok, fail.ok ? '' : fail.message)
let fig = await figures('failed stop, still on the van', [S.RT6])
step('bill', { ...openOf(B.RT6.invoiceId), undelivered: L.q1(`select undelivered_at from invoices where id = '${B.RT6.invoiceId}'`).undelivered_at })
recon('S4-R1b-failed')
// RT7 / RT8 delivered in full; RT7 pays in full at the door
begin('R7-door', 'RT7 delivered and paid in full at the door; RT8 delivered, unpaid')
await F.deliver(trip, stop.RT7, B.RT7.invoiceId)
const pay7 = await F.collect(trip, stop.RT7, S.RT7.id, 'cash', B.RT7.totalPaise)
expect('RT7 paid', pay7.ok && openOf(B.RT7.invoiceId).state === 'paid')
await F.deliver(trip, stop.RT8, B.RT8.invoiceId)

// check in + settle
begin('S4-settle', 'Check in and settle: what the van carries back and where each returned batch ends up')
const drvRet = await L.tryCall(drv.delivery.trips.return({ ...L.key(), id: trip.tripId }))
step('check-in', drvRet.ok ? drvRet.value.item?.state : drvRet.message)
const vr = await L.tryCall(mgr.delivery.trips.vanReturns({ tripId: trip.tripId }))
step('van returns (came-back bills)', vr.ok ? JSON.stringify(vr.value).slice(0, 1500) : vr.message)
fig = await figures('after check-in (bill undelivered)', [S.RT6])
step('RT6 dues / undelivered', { dues: fig.shops[S.RT6.code].sql.outstanding, undelivered: fig.shops[S.RT6.code].sql.undelivered, owner: fig.shops[S.RT6.code].owner, credit: fig.shops[S.RT6.code].owner_credit })
const prev = await L.must(mgr.delivery.trips.settlementPreview({ id: trip.tripId }), 'preview')
const vanLots = new Set(prev.expectedVanStock.map((v) => v.lotId))
step('expected van stock (returns included)', prev.expectedVanStock.filter((v) => [...r1.ls, ...r2.ls, ...r3.ls, ...r4.ls, ...lines(B.RT6.invoiceId)].some((l) => l.lot_id === v.lotId)).map((v) => `${v.variantName} ${v.batchNo} ${v.expectedPcs}`))
const settle = await L.tryCall(mgr.delivery.trips.settle({ ...L.mk(), tripId: trip.tripId, handedOverCashPaise: prev.expectedCashPaise, counted: prev.expectedVanStock.map((v) => ({ lotId: v.lotId, countedPcs: v.expectedPcs })), note: 'QA p7 S4' }))
expect('settled', settle.ok, settle.ok ? settle.value.tripState : settle.message)
const settleId = settle.ok ? settle.value.item.id : null
if (settleId) step('settlement stock moves', moves([settleId]).filter((m) => [...r1.ls, ...r2.ls, ...r3.ls, ...r4.ls, ...lines(B.RT6.invoiceId)].some((l) => l.lot_id === m.lot_id)))
// where did the damaged / expired pieces go?
const dmgLots = r4.ls.map((l) => l.lot_id)
step('RT3 damaged/expired lots now', Object.fromEntries(dmgLots.map((id) => [id, { balances: lotAt(id), sellable: sellableAt(id) }])))
const dmgMoves = settleId ? moves([settleId, r4.d.deliveryId, ...r4.cns.map((c) => c.id)]).filter((m) => dmgLots.includes(m.lot_id)) : []
step('every move of the damaged/expired lots on this trip', dmgMoves)
const toGodown = dmgMoves.filter((m) => LOC[m.location_id] === 'warehouse' && m.qty_delta > 0).reduce((s, m) => s + m.qty_delta, 0)
const toDamaged = moves([settleId ?? 'x', r4.d.deliveryId, ...r4.cns.map((c) => c.id)]).filter((m) => LOC[m.location_id] === 'damaged' && m.qty_delta > 0).reduce((s, m) => s + m.qty_delta, 0)
expect('damaged/expired door returns (5 pcs) end in the damaged bin, never the sellable godown (DOS-116)', toDamaged >= 5, `to damaged bin ${toDamaged}; pieces of those lots put back on the godown rack by this settlement ${toGodown}`)
recon('S4-settle')

// R6 return after delivery at the desk
begin('R6', 'Return after delivery, at the desk: RT8 returns 6 Glucose (saleable) — credit note restocks the godown')
const l8 = lines(B.RT8.invoiceId)
const cn8 = L.mk()
const c8 = await L.tryCall(acc.billing.creditNotes.create({ ...cn8, invoiceId: B.RT8.invoiceId, reason: 'return_saleable', restockLocationId: L.GODOWN, autoIssue: true, note: 'QA p7 desk return', lines: [{ id: L.uuidv7(), invoiceLineId: l8[1].id, qtyPcs: 6, saleable: true }] }))
step('accountant raises the return', c8.ok ? { no: c8.value.item?.creditNoteNo, state: c8.value.item?.state, total: c8.value.item?.totalPaise } : `${c8.status} ${c8.message}`)
const c8m = c8.ok ? c8 : await L.tryCall(mgr.billing.creditNotes.create({ ...L.mk(), invoiceId: B.RT8.invoiceId, reason: 'return_saleable', restockLocationId: L.GODOWN, autoIssue: true, note: 'QA p7 desk return', lines: [{ id: L.uuidv7(), invoiceLineId: l8[1].id, qtyPcs: 6, saleable: true }] }))
if (!c8.ok) step('manager raises the return instead', c8m.ok ? { no: c8m.value.item?.creditNoteNo, state: c8m.value.item?.state, total: c8m.value.item?.totalPaise } : `${c8m.status} ${c8m.message}`)
const cns8 = cnOf(B.RT8.invoiceId)
step('CN + bill', { cns: cns8, bill: openOf(B.RT8.invoiceId) })
step('stock moves', moves(cns8.map((c) => c.id)))
fig = await figures('after desk return', [S.RT8])
expect('screens agree', agree(fig, S.RT8.code).length === 0, agree(fig, S.RT8.code).join('; '))
const again8 = await L.tryCall(mgr.billing.creditNotes.create({ ...L.mk(), invoiceId: B.RT8.invoiceId, reason: 'return_saleable', restockLocationId: L.GODOWN, autoIssue: true, lines: [{ id: L.uuidv7(), invoiceLineId: l8[1].id, qtyPcs: l8[1].qty_pcs, saleable: true }] }))
expect('returning more pieces than were delivered and not yet returned is refused', !again8.ok, again8.ok ? `ACCEPTED ${again8.value.item?.totalPaise}` : `${again8.status} ${again8.message}`)
recon('S4-R6-desk-return')

// R7 return after payment
begin('R7', 'Return after payment: RT7 paid in full, then returns 12 Cola (saleable) at the desk')
const l7 = lines(B.RT7.invoiceId)
const c7 = await L.tryCall(mgr.billing.creditNotes.create({ ...L.mk(), invoiceId: B.RT7.invoiceId, reason: 'return_saleable', restockLocationId: L.GODOWN, autoIssue: true, lines: [{ id: L.uuidv7(), invoiceLineId: l7[0].id, qtyPcs: 12, saleable: true }] }))
step('CN', c7.ok ? { total: c7.value.item?.totalPaise, state: c7.value.item?.state } : c7.message)
fig = await figures('after return on a paid bill', [S.RT7])
const f7 = fig.shops[S.RT7.code]
expect('the credit sits on the shop\'s account (DOS-245); screens agree', agree(fig, S.RT7.code).length === 0 && f7.sql.onAccount === (c7.ok ? c7.value.item?.totalPaise : -1), `on account ${f7.sql.onAccount}`)
recon('S4-R7-after-payment')

// R8 scheme / free goods return
begin('R8', 'Return of scheme lines at the desk: RT4 returns 12 of 24 Glucose (12+2 free) and 6 of 12 soap (10% off)')
const l4 = lines(B.RT4.invoiceId)
step('RT4 lines as billed', l4.map((l) => ({ n: l.name, qty: l.qty_pcs, free: l.free_qty_pcs, rate: l.rate_paise, disc: l.discount_paise, taxable: l.taxable_paise, total: l.line_total_paise })))
const gl = l4.find((l) => l.name.includes('Glucose'))
const so = l4.find((l) => l.name.includes('Soap'))
const c4 = await L.tryCall(mgr.billing.creditNotes.create({ ...L.mk(), invoiceId: B.RT4.invoiceId, reason: 'return_saleable', restockLocationId: L.GODOWN, autoIssue: true, lines: [{ id: L.uuidv7(), invoiceLineId: gl.id, qtyPcs: 12, saleable: true }, { id: L.uuidv7(), invoiceLineId: so.id, qtyPcs: 6, saleable: true }] }))
step('CN', c4.ok ? { total: c4.value.item?.totalPaise } : `${c4.status} ${c4.message}`)
const cns4 = cnOf(B.RT4.invoiceId)
for (const c of cns4) step(`CN ${c.credit_note_no} lines`, cnLines(c.id))
const glPaid = (gl.taxable_paise * 12) / gl.qty_pcs
const soPaid = (so.taxable_paise * 6) / so.qty_pcs
step('what the shop was billed for those pieces (taxable, pro rata)', { glucose12: glPaid, soap6: soPaid })
const cnl = cns4[0] ? cnLines(cns4[0].id) : []
const glCn = cnl.find((x) => x.invoice_line_id === gl.id)
const soCn = cnl.find((x) => x.invoice_line_id === so.id)
expect('soap credited at the billed (10%-off) rate, not list (DOS-242)', soCn && Math.abs(soCn.taxable_paise - soPaid) <= 6, `${soCn?.taxable_paise} vs ${soPaid}`)
const freeLeft = gl.free_qty_pcs
step('free pieces the shop keeps after returning half the qualifying pieces', { freeGiven: gl.free_qty_pcs, freeReturned: 0, stillEntitled: Math.floor((gl.qty_pcs - 12) / 12) * 2 })
if (glCn && gl.free_qty_pcs > Math.floor((gl.qty_pcs - 12) / 12) * 2) obs(`Returning 12 of 24 Glucose keeps all ${freeLeft} free pieces with the shop although only ${Math.floor((gl.qty_pcs - 12) / 12) * 2} are earned by the 12 it kept: the credit note is at the full paid rate (${glCn.taxable_paise} taxable), no claw-back of the free goods.`)
const cFree = await L.tryCall(mgr.billing.creditNotes.create({ ...L.mk(), invoiceId: B.RT4.invoiceId, reason: 'return_saleable', restockLocationId: L.GODOWN, autoIssue: true, lines: [{ id: L.uuidv7(), invoiceLineId: gl.id, qtyPcs: gl.qty_pcs + gl.free_qty_pcs - 12, saleable: true }] }))
step('return of every remaining Glucose piece incl. the free ones', cFree.ok ? { total: cFree.value.item?.totalPaise } : `${cFree.status} ${cFree.message}`)
if (cFree.ok) {
  const extra = cFree.value.item?.totalPaise
  const remainingPaid = gl.line_total_paise - (glCn?.line_total_paise ?? 0)
  expect('credit for the remaining pieces never exceeds what the shop still paid for on that line', extra <= remainingPaid + 100, `credited ${extra} vs ${remainingPaid} left on the line`)
}
fig = await figures('after scheme returns', [S.RT4])
expect('screens agree', agree(fig, S.RT4.code).length === 0, agree(fig, S.RT4.code).join('; '))
step('stock moves', moves(cnOf(B.RT4.invoiceId).map((c) => c.id)))
recon('S4-R8-scheme')

// R9 replacement
begin('R9', 'Replacement of damaged goods')
const spec = JSON.parse(readFileSync(`${L.EV}openapi-owner.json`, 'utf8'))
const rep = Object.keys(spec.paths).filter((p) => /replace|exchange|swap/i.test(p))
step('replacement / exchange endpoints', rep)
expect('a replacement (goods for goods, no money) can be recorded as one document', rep.length > 0, 'none: a replacement is a credit note plus a new order and bill')

// R10 cancel before dispatch
begin('R10', 'Bill cancelled before dispatch (RT9: packed, billed, never loaded)')
const lot9 = lines(B.RT9.invoiceId)
const godownBefore = Object.fromEntries(lot9.map((l) => [l.lot_id, lotAt(l.lot_id)]))
const cx = await L.tryCall(mgr.billing.invoices.cancel({ ...L.key(), id: B.RT9.invoiceId, reason: 'QA p7: shop cancelled before loading', restockLocationId: L.GODOWN }))
expect('cancel accepted', cx.ok, cx.ok ? '' : `${cx.status} ${cx.message}`)
step('bill and order after cancel', { bill: openOf(B.RT9.invoiceId), order: await F.orderRow(O.RT9) })
step('stock of its lots before → after', Object.fromEntries(lot9.map((l) => [l.lot_id, { before: godownBefore[l.lot_id], after: lotAt(l.lot_id) }])))
step('journal', L.q(`select e.ref_type, a.code, l.amount_paise from journal_entries e join journal_lines l on l.entry_id = e.id join accounts a on a.id = l.account_id where e.ref_id = '${B.RT9.invoiceId}' order by e.posted_at, a.code`))
fig = await figures('after cancel', [S.RT9])
expect('shop owes nothing; screens agree', agree(fig, S.RT9.code).length === 0 && fig.shops[S.RT9.code].sql.net === 0, agree(fig, S.RT9.code).join('; '))
recon('S4-R10-cancel')

// R11 cancel after payment
begin('R11', 'Bill cancelled after payment was taken (RT10 paid ₹595 by UPI at the office, bill still in the godown)')
const pay10 = await F.deskReceipt(S.RT10.id, 'upi', B.RT10.totalPaise, { reference: `UTR${Date.now()}` })
expect('paid', pay10.ok && openOf(B.RT10.invoiceId).state === 'paid')
const cx10 = await L.tryCall(mgr.billing.invoices.cancel({ ...L.key(), id: B.RT10.invoiceId, reason: 'QA p7: cancel after payment', restockLocationId: L.GODOWN }))
step('cancel a paid bill', cx10.ok ? { bill: openOf(B.RT10.invoiceId) } : `${cx10.status} ${cx10.message}`)
fig = await figures('after cancel attempt on a paid bill', [S.RT10])
const f10 = fig.shops[S.RT10.code]
step('shop', { dues: f10.sql.outstanding, onAccount: f10.sql.onAccount, net: f10.sql.net, ar: f10.sql.arJournal })
if (cx10.ok) expect('the money taken is kept for the shop (on account), none lost', f10.sql.onAccount === B.RT10.totalPaise && f10.sql.net === -B.RT10.totalPaise, JSON.stringify(f10.sql))
else expect('cancel refused while money sits on the bill (docs/22 §4: only before any money)', true, cx10.message)
recon('S4-R11-cancel-paid')

save('results-s4.json')
writeFileSync(`${L.EV}s4-context.json`, JSON.stringify({ S, O, B, trip, settleId }, null, 2))
