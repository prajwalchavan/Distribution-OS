// S4 — reservation leaks (cancel at every state before billing, reject a held order, release, wave cancel, line edits,
// bill cancel) and over-ordering (one piece over, FEFO across batches, a short-confirmed order picked in full).
import { readFileSync, writeFileSync } from 'node:fs'
import * as K from './kit.mjs'
const { L, F } = K
const FX = JSON.parse(readFileSync(`${L.EV}fixture.json`, 'utf8'))
const { V } = FX
const LOT = FX.lots
const D1 = LOT['P10-D1']
const bal = (lot, loc = L.GODOWN) => L.q1(`select on_hand, reserved from stock_balances where lot_id = '${lot}' and location_id = '${loc}'`) ?? { on_hand: 0, reserved: 0 }
const owner = await L.as('owner')
const rep = await L.as('rep')
const wh = await L.as('wh')
const mgr = await L.as('manager')
const lotName = (id) => Object.entries(LOT).find(([, v]) => v === id)?.[0] ?? id.slice(0, 8)

const shop = await F.createShop(`QA P10 Leak Shop ${Date.now() % 100000}`)
const strict = await F.createShop(`QA P10 Strict Shop ${Date.now() % 100000}`, { creditMode: 'strict', creditLimitPaise: 100 })
const out = { shop, strict }

// ---------------------------------------------------------------------------------------------------------------
K.begin('S4a', 'cancel at submitted (held), confirmed, picking; reject a held order — reserved must return each time')
const base = bal(D1)
K.step('D1 godown before', base)
// held order: strict shop over its ₹1 limit
const held = await F.placeOrder(strict.id, [{ variantId: V.D, qty: 24 }])
K.step('strict-shop order', { submitted: L.brief(held.submitted), state: F.orderRow(held.orderId).state, approvals: L.q(`select kind::text, status::text from approvals where order_id = '${held.orderId}'`) })
K.check('held order holds nothing', bal(D1).reserved === base.reserved, bal(D1))
let r = await L.tryCall(rep.orders.cancel({ ...L.key(), id: held.orderId, reason: 'QA p10 rep cancels held order' }))
K.step('rep cancels the held order (submitted)', L.brief(r))
K.check('after cancel at submitted: reserved unchanged', bal(D1).reserved === base.reserved, bal(D1))
const held2 = await F.placeOrder(strict.id, [{ variantId: V.D, qty: 24 }])
const rej = await F.approveAll(held2.orderId, 'owner', 'reject')
K.step('owner rejects the second held order', { decide: rej.map(L.brief), state: F.orderRow(held2.orderId).state })
K.check('after reject: reserved unchanged, order cancelled', bal(D1).reserved === base.reserved && F.orderRow(held2.orderId).state === 'cancelled', bal(D1))
r = await L.tryCall(owner.orders.approvals.decide({ ...L.key(), id: L.q1(`select id from approvals where order_id = '${held2.orderId}'`).id, decision: 'approve', note: 'QA p10 approve after reject' }))
K.step('approve the rejected order\'s gate afterwards', L.brief(r))
K.check('a rejected / cancelled order cannot be approved back', !r.ok || F.orderRow(held2.orderId).state === 'cancelled', { state: F.orderRow(held2.orderId).state })
// confirmed → rep cancel
const oc = await F.placeOrder(shop.id, [{ variantId: V.D, qty: 24 }])
await F.ensureConfirmed(oc.orderId)
K.step('confirmed order D 24', { state: F.orderRow(oc.orderId).state, D1: bal(D1) })
r = await L.tryCall(rep.orders.cancel({ ...L.key(), id: oc.orderId, reason: 'QA p10 rep cancels confirmed' }))
K.step('rep cancels at confirmed', L.brief(r))
K.check('after cancel at confirmed: reserved back to base', bal(D1).reserved === base.reserved, bal(D1))
// picking → rep refused, owner allowed
const op = await F.placeOrder(shop.id, [{ variantId: V.D, qty: 36 }])
await F.ensureConfirmed(op.orderId)
const wp = await F.wave([op.orderId])
const pr = await F.pick(wp.picklistId, wp.sheet)
K.step('order D 36 picking, picker has picked all 36 (not packed)', { pick: L.brief(pr), state: F.orderRow(op.orderId).state, D1: bal(D1) })
r = await L.tryCall(rep.orders.cancel({ ...L.key(), id: op.orderId, reason: 'QA p10 rep cancels picking' }))
K.step('rep cancels at picking', L.brief(r))
K.check('rep cannot cancel while picking (DOS-138)', !r.ok)
r = await L.tryCall(owner.orders.cancel({ ...L.key(), id: op.orderId, reason: 'QA p10 owner cancels picking' }))
K.step('owner cancels at picking', L.brief(r))
K.check('after desk cancel at picking: reserved back to base', bal(D1).reserved === base.reserved, bal(D1))
const pk = await F.pack(op.orderId)
K.step('pack the cancelled (picked) order', L.brief(pk))
K.check('a cancelled order cannot be packed', !pk.ok)
K.step('put-back lines', L.q(`select picked_qty_pcs, cancelled_at is not null put_back from pick_lines where picklist_id = '${wp.picklistId}'`))
K.ledger()
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S4b', 'release holds, cancel an unstarted wave, re-line a confirmed order, cancel a packed bill (dock → godown)')
const b2 = bal(D1)
const orl = await F.placeOrder(shop.id, [{ variantId: V.D, qty: 12 }])
await F.ensureConfirmed(orl.orderId)
r = await L.tryCall(mgr.warehouse.reservations.release({ ...L.key(), orderId: orl.orderId, reason: 'QA p10 will not be picked' }))
K.step('manager releases the holds of a confirmed order', { r: L.brief(r), state: F.orderRow(orl.orderId).state, D1: bal(D1) })
K.check('release: reserved back', bal(D1).reserved === b2.reserved, bal(D1))
r = await L.tryCall(rep.orders.setLines({ ...L.key(), id: orl.orderId, lines: [{ id: L.uuidv7(), variantId: V.D, enteredQty: 6, enteredUnit: 'piece' }] }))
K.step('rep re-lines the confirmed order down to 6', L.brief(r))
K.check('lines of a confirmed order cannot be replaced', !r.ok)
const ow = await F.placeOrder(shop.id, [{ variantId: V.D, qty: 12 }])
await F.ensureConfirmed(ow.orderId)
const afterConfirm = bal(D1)
const pm = L.mk()
await L.must(wh.warehouse.picklists.create({ ...pm, orderIds: [ow.orderId], locationId: L.GODOWN }), 'picklist create')
r = await L.tryCall(mgr.warehouse.picklists.cancel({ ...L.key(), id: pm.id, reason: 'QA p10 wave not needed' }))
K.step('manager cancels the unstarted wave', { r: L.brief(r), state: F.orderRow(ow.orderId).state, D1: bal(D1) })
K.check('wave cancel: order stays confirmed and keeps exactly its hold', F.orderRow(ow.orderId).state === 'confirmed' && bal(D1).reserved === afterConfirm.reserved, bal(D1))
// packed → cancel the bill
const w2 = await F.wave([ow.orderId])
await F.pick(w2.picklistId, w2.sheet)
const pkd = await F.pack(ow.orderId)
const dockAfterPack = bal(D1, L.DOCK)
K.step('packed + billed', { invoice: pkd.invoice, godown: bal(D1), dock: dockAfterPack })
r = await F.cancelBill(pkd.invoice.id, 'owner')
K.step('owner cancels the bill while the pieces are on the dock', L.brief(r))
K.step('after', { godown: bal(D1), dock: bal(D1, L.DOCK), order: F.orderRow(ow.orderId).state, bill: L.q1(`select invoice_no, state::text from invoices where id = '${pkd.invoice.id}'`) })
K.check('bill cancel: dock back to 0 on hand / 0 held, godown got the 12 back', bal(D1, L.DOCK).on_hand === dockAfterPack.on_hand - 12 && bal(D1, L.DOCK).reserved === dockAfterPack.reserved - 12)
out.releasedOrder = orl.orderId
K.ledger()
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S4c', 'over-ordering: one piece over what is free; a short-confirmed order picked in full takes pieces held for another order')
const now = bal(D1)
const free = now.on_hand - now.reserved
K.step('D1 godown', { ...now, free })
const big = await F.placeOrder(shop.id, [{ variantId: V.D, qty: free - 60 }])
await F.ensureConfirmed(big.orderId)
K.step(`order X for ${free - 60} (fits)`, { state: F.orderRow(big.orderId).state, D1: bal(D1) })
const over = await F.placeOrder(shop.id, [{ variantId: V.D, qty: 61 }])
const oc2 = await F.ensureConfirmed(over.orderId)
const overRow = L.q1(`select state::text, stock_shortages from sales_orders where id = '${over.orderId}'`)
K.step('order Y for 61 (one piece more than the 60 still free)', { state: overRow.state, shortages: overRow.stock_shortages, holds: F.holdsOf(over.orderId), D1: bal(D1) })
K.check('one piece over: confirmed with 60 held and the 1-piece shortage recorded', overRow.state === 'confirmed' && F.holdsOf(over.orderId).reduce((n, h) => n + h.qty, 0) === 60)
const wy = await F.wave([over.orderId])
K.step('Y pick sheet asks', wy.sheet.lines.map((l) => `${l.requestedQtyPcs} from ${lotName(l.suggestedLotId ?? l.lotId)}`))
// the picker finds 61 on the rack (the rack does hold them: X's pieces are still there) and picks all 61
const lineY = F.orderLines(over.orderId)[0].id
const pickY = await L.tryCall(wh.warehouse.picklists.pick({ ...L.key(), id: wy.picklistId, lines: wy.sheet.lines.map((l) => ({ id: L.uuidv7(), orderLineId: l.orderLineId, lotId: D1, pickedQtyPcs: 61 })) }))
K.step('picker records 61 for Y from D1', L.brief(pickY))
const pkY = await F.pack(over.orderId)
K.step('pack + bill Y', { r: L.brief(pkY), invoice: pkY.invoice, billedPcs: pkY.invoice ? L.q1(`select sum(qty_pcs + free_qty_pcs) pcs from invoice_lines where invoice_id = '${pkY.invoice.id}'`).pcs : null })
const afterY = bal(D1)
K.step('D1 godown after Y packed', afterY)
K.check('pieces held for order X are not handed to order Y (reserved ≤ on hand)', afterY.reserved <= afterY.on_hand, afterY)
// X now tries to pick its full, reserved quantity
const wx = await F.wave([big.orderId])
const pickX = await F.pick(wx.picklistId, wx.sheet)
const pkX = await F.pack(big.orderId)
K.step('X picks and packs its full reserved quantity', { pick: L.brief(pickX), pack: L.brief(pkX), D1: bal(D1) })
K.check('the order that was confirmed in full can still be packed in full', pkX.ok, L.brief(pkX))
out.orderX = big.orderId
out.orderY = over.orderId
K.ledger()
K.recon()

// ---------------------------------------------------------------------------------------------------------------
K.begin('S4d', 'FEFO across batches of B: in-date earliest first, short-dated only when in-date runs out, expired never')
const bRows = L.q(`select l.batch_no, l.expiry_date, b.on_hand, b.reserved from stock_balances b join stock_lots l on l.id = b.lot_id where l.variant_id = '${V.B}' and b.location_id = '${L.GODOWN}' and b.on_hand <> 0 order by l.expiry_date`)
K.step('B at the godown', bRows)
const f1 = await F.placeOrder(shop.id, [{ variantId: V.B, qty: 150 }])
await F.ensureConfirmed(f1.orderId)
const h1 = F.holdsOf(f1.orderId).map((h) => `${lotName(h.lot_id)}:${h.qty}`)
K.step('order B 150 holds', h1)
const g1Free = bRows.find((b) => b.batch_no === 'P10-B-G1')
K.check('150 held on the in-date batches, earliest expiry first (G1 then G2)', F.holdsOf(f1.orderId).every((h) => [LOT['P10-B-G1'], LOT['P10-B-G2']].includes(h.lot_id)) && F.holdsOf(f1.orderId).find((h) => h.lot_id === LOT['P10-B-G1'])?.qty === g1Free.on_hand - g1Free.reserved, h1)
const inDateLeft = L.q(`select coalesce(sum(b.on_hand - b.reserved), 0) n from stock_balances b join stock_lots l on l.id = b.lot_id where l.variant_id = '${V.B}' and b.location_id = '${L.GODOWN}' and l.expiry_date >= '${L.addDays(L.todayIst(), 30)}'`)[0].n
const f2 = await F.placeOrder(shop.id, [{ variantId: V.B, qty: Number(inDateLeft) + 20 }])
await F.ensureConfirmed(f2.orderId)
const h2 = F.holdsOf(f2.orderId).map((h) => `${lotName(h.lot_id)}:${h.qty}`)
K.step(`order B ${Number(inDateLeft) + 20} (in-date left ${inDateLeft}) holds`, h2)
K.check('short-dated batch used only for the part in-date stock cannot cover', F.holdsOf(f2.orderId).find((h) => h.lot_id === LOT['P10-B-SHORT'])?.qty === 20, h2)
K.check('no expired batch held', !F.holdsOf(f2.orderId).some((h) => h.lot_id === LOT['P10-B-EXP']) && !F.holdsOf(f1.orderId).some((h) => h.lot_id === LOT['P10-B-EXP']))
// clean up: cancel both so B holds are released
for (const o of [f1, f2]) K.step('owner cancels', L.brief(await L.tryCall(owner.orders.cancel({ ...L.key(), id: o.orderId, reason: 'QA p10 FEFO probe done' }))))
K.check('B reserved back to what it was', L.q(`select coalesce(sum(b.reserved),0) n from stock_balances b join stock_lots l on l.id = b.lot_id where l.variant_id = '${V.B}' and b.location_id = '${L.GODOWN}'`)[0].n == bRows.reduce((n, b) => n + b.reserved, 0))
K.recon()

writeFileSync(`${L.EV}fixture-s4.json`, JSON.stringify(out, null, 1))
K.save('s4-reservations.json')
