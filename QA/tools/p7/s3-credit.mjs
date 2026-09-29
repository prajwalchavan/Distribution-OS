// Phase 7 · S3 — credit: limit, headroom, overdue days, bill-count limit, each mode (warn / hold / block / pay-on-delivery),
// orders just under / at / over the limit, a second order while the first is unbilled, approval of a held order,
// a stopped shop reactivated, a limit lowered below what the shop owes. Every screen-facing figure beside SQL.
import { writeFileSync } from 'node:fs'
import { begin, step, obs, expect, figures, agree, recon, save, L, F } from './scenario-kit.mjs'

const V = { cola: 'f71bf137-50de-7182-a0d9-c83f1a613a57', glucose: 'af45e021-a167-7d3f-a8f0-60ab037214cb', soap: '8549cf4f-2489-772a-9691-7eeda70e8bdc' }
const basket = [{ variantId: V.cola, qty: 12 }, { variantId: V.glucose, qty: 24 }] // ₹595.00
const BASKET = 59500
const owner = await L.as('owner')
const mgr = await L.as('manager')
const rep = await L.as('rep')
const flagsOf = (o) => (o.submitted.ok ? { state: o.submitted.value.item.state, flags: o.submitted.value.item.approvalFlags, notice: o.submitted.value.item.creditNotice, total: o.submitted.value.item.totalPaise, no: o.submitted.value.item.orderNo } : { error: `${o.submitted.status} ${o.submitted.message}` })
const pendingOf = (orderId) => L.q(`select kind::text, status::text from approvals where order_id = '${orderId}' order by created_at`)
async function repCard(shopId) {
  const r = await L.tryCall(rep.retailers.get({ id: shopId }))
  const it = r.ok ? (r.value.item ?? r.value) : null
  return it ? { limit: it.creditLimitPaise, mode: it.creditMode, days: it.creditDays, bills: it.creditLimitBills } : r.message
}

// --- C1 indicate (warn) ---------------------------------------------------------------------------------------------
begin('C1', 'Warn-only shop (indicate): an order over the limit goes through with a credit notice')
const cw = await F.createShop('QA P7 CR1 Warn Stores', { creditLimitPaise: 50000, creditMode: 'indicate' })
let fig = await figures('before', [cw], { orderTotalPaise: BASKET })
const ow = await F.placeOrder(cw.id, basket)
step('submit over a ₹500 limit', flagsOf(ow))
expect('confirmed, no gate, credit notice carried', ow.submitted.ok && ow.submitted.value.item.state === 'confirmed' && ow.submitted.value.item.creditNotice?.reasons?.includes('limit_exceeded'), JSON.stringify(flagsOf(ow)))
recon('S3-C1-warn')

// --- C2 strict: under / at / over, approval ---------------------------------------------------------------------------------
begin('C2', 'Hold shop (strict): just under, exactly at, and just over the limit; the held one approved')
const cs = await F.createShop('QA P7 CR2 Strict Stores', { creditLimitPaise: BASKET + 1, creditMode: 'strict' })
const under = await F.placeOrder(cs.id, basket)
step('just under (limit = order + ₹0.01)', flagsOf(under))
expect('just under: confirmed', under.submitted.ok && under.submitted.value.item.state === 'confirmed', JSON.stringify(flagsOf(under)))
const ppU = await F.pickAndPack([under.orderId])
await F.deskReceipt(cs.id, 'cash', ppU.invoices[0].totalPaise) // clear it so the next order starts from zero
await F.setCredit(cs.id, { tier: 'B', creditLimitPaise: BASKET, creditLimitBills: 0, creditDays: 0, creditMode: 'strict', paymentTerms: 'POST_FULFILLMENT' })
fig = await figures('limit = order exactly', [cs], { orderTotalPaise: BASKET })
const at = await F.placeOrder(cs.id, basket)
step('exactly at the limit', flagsOf(at))
expect('exactly at: confirmed (the rule is "more than the limit")', at.submitted.ok && at.submitted.value.item.state === 'confirmed', JSON.stringify(flagsOf(at)))
const ppA = await F.pickAndPack([at.orderId])
await F.deskReceipt(cs.id, 'cash', ppA.invoices[0].totalPaise)
await F.setCredit(cs.id, { tier: 'B', creditLimitPaise: BASKET - 1, creditLimitBills: 0, creditDays: 0, creditMode: 'strict', paymentTerms: 'POST_FULFILLMENT' })
const over = await F.placeOrder(cs.id, basket)
step('just over (limit = order − ₹0.01)', flagsOf(over))
expect('just over: held for a credit approval', over.submitted.ok && over.submitted.value.item.state === 'submitted' && over.submitted.value.item.approvalFlags.includes('credit_limit'), JSON.stringify(flagsOf(over)))
step('approvals raised', pendingOf(over.orderId))
fig = await figures('held', [cs], { orderTotalPaise: BASKET })
step('rep sees on the shop card', await repCard(cs.id))
const dec = await F.approveAll(over.orderId, 'owner')
step('owner approves', dec.map((d) => (d.ok ? d.value.item?.status ?? 'ok' : d.message)))
const afterApprove = await F.orderRow(over.orderId)
expect('approval confirms the order; the limit stays as set (DOS-006)', afterApprove.state === 'confirmed' && L.q1(`select credit_limit_paise from retailers where id = '${cs.id}'`).credit_limit_paise === BASKET - 1, JSON.stringify(afterApprove))
recon('S3-C2-strict')

// --- C3 second order while the first is unbilled ------------------------------------------------------------------------------
begin('C3', 'Strict shop, ₹1,000 limit: two ₹595 orders placed before either is billed')
const c2 = await F.createShop('QA P7 CR3 Two-orders Stores', { creditLimitPaise: 100000, creditMode: 'strict' })
const first = await F.placeOrder(c2.id, basket)
step('first order', flagsOf(first))
fig = await figures('first confirmed, not billed', [c2], { orderTotalPaise: BASKET })
step('credit check the rep sees for the second ₹595', fig.shops[c2.code].rep_credit)
const second = await F.placeOrder(c2.id, basket)
step('second order', flagsOf(second))
const bothConfirmed = first.submitted.value?.item?.state === 'confirmed' && second.submitted.value?.item?.state === 'confirmed'
expect('the second order is held: together they pass ₹1,000', !bothConfirmed, bothConfirmed ? 'BOTH confirmed: ₹1,190 committed on a ₹1,000 strict limit' : 'held')
if (second.submitted.value?.item?.state === 'submitted') step('second held; owner approves it', (await F.approveAll(second.orderId)).map((d) => (d.ok ? 'approved' : d.message)))
const ppBoth = await F.pickAndPack([first.orderId, second.orderId])
fig = await figures('both billed', [c2], { orderTotalPaise: 0 })
step('after billing both', { outstanding: fig.shops[c2.code].sql.outstanding, limit: 100000, headroom: fig.shops[c2.code].owner_credit.headroom })
recon('S3-C3-two-orders')

// --- C4 stop (block) ---------------------------------------------------------------------------------------------------------------
// Architect ruling 5 of 2026-09-28 on money and credit (DOS-314, "credit mode stop means stop"): no order on credit is
// accepted for a stopped shop and nobody can approve one, the manager and the owner alike; only the owner lifts it, by
// changing the credit mode. This scenario expected the stop shop's order to be HELD and then decided; it now expects
// the refusals the ruling asks for (a hold made while the shop was still strict stands for "a hold from before the
// stop"). Ruling 6 (DOS-315): a deactivated shop takes no new order.
begin('C4', 'Blocked shop (stop): a new order on credit is refused; a hold from before the stop cannot be approved by the manager or the owner; changing the mode lifts it; then the shop is deactivated and reactivated')
const cb = await F.createShop('QA P7 CR4 Stop Stores', { creditLimitPaise: 50000, creditMode: 'strict' })
const ob = await F.placeOrder(cb.id, basket)
step('order over the ₹500 limit while the shop is still strict', flagsOf(ob))
expect('held (a hold from before the stop)', ob.submitted.ok && ob.submitted.value.item.state === 'submitted', JSON.stringify(flagsOf(ob)))
await F.setCredit(cb.id, { tier: 'B', creditLimitPaise: 50000, creditLimitBills: 0, creditDays: 0, creditMode: 'stop', paymentTerms: 'POST_FULFILLMENT' })
const appr = L.q1(`select id from approvals where order_id = '${ob.orderId}' and status = 'pending' limit 1`)
const decided = (d) => (d.ok ? 'ACCEPTED' : `${d.status} ${d.data?.code ?? ''} ${d.message}`)
const mgrDec = await L.tryCall(mgr.orders.approvals.decide({ ...L.key(), id: appr.id, decision: 'approve', note: 'QA p7 manager on a stop shop' }))
step('manager approves a stop-shop credit hold', decided(mgrDec))
expect('the manager cannot approve credit for a stopped shop (409 credit_stopped)', !mgrDec.ok && mgrDec.status === 409 && mgrDec.data?.code === 'credit_stopped', decided(mgrDec))
const ownerDec = await L.tryCall(owner.orders.approvals.decide({ ...L.key(), id: appr.id, decision: 'approve', note: 'QA p7 owner on a stop shop' }))
step('owner approves a stop-shop credit hold', decided(ownerDec))
expect('nor can the owner (409 credit_stopped)', !ownerDec.ok && ownerDec.status === 409 && ownerDec.data?.code === 'credit_stopped', decided(ownerDec))
const repDec = await L.tryCall(rep.orders.approvals.decide({ ...L.key(), id: appr.id, decision: 'approve' }))
expect('a rep cannot approve a credit hold', !repDec.ok, repDec.ok ? 'ACCEPTED' : `${repDec.status}`)
step('order after the refused decisions', await F.orderRow(ob.orderId))
expect('the hold stands', (await F.orderRow(ob.orderId)).state === 'submitted')
const ob2 = await F.placeOrder(cb.id, basket)
step('second order on the stopped shop', flagsOf(ob2))
expect('a new order on credit for a stopped shop is refused (409 credit_stopped), not held', !ob2.submitted.ok && ob2.submitted.status === 409 && ob2.submitted.data?.code === 'credit_stopped', JSON.stringify(flagsOf(ob2)))
await F.setCredit(cb.id, { tier: 'B', creditLimitPaise: 50000, creditLimitBills: 0, creditDays: 0, creditMode: 'indicate', paymentTerms: 'POST_FULFILLMENT' })
const lifted = await F.approveAll(ob.orderId, 'owner')
step('owner approves the hold once the mode is changed', lifted.map((d) => (d.ok ? d.value.item?.status ?? 'ok' : d.message)))
expect('changing the mode lifts the stop: the hold is approved and confirmed', (await F.orderRow(ob.orderId)).state === 'confirmed')
const held2 = await F.orderRow(ob2.orderId)
step('the refused order after the shop is switched to warn-only (still a draft)', held2)
const ob3 = await F.placeOrder(cb.id, basket)
step('new order after reactivation to warn-only', flagsOf(ob3))
expect('reactivated shop: new order confirmed with a notice', ob3.submitted.ok && ob3.submitted.value.item.state === 'confirmed')
// deactivate / reactivate the shop itself
const deact = await L.tryCall(owner.retailers.upsert({ ...L.key(), id: cb.id, name: cb.name, phone: L.q1(`select phone from retailers where id = '${cb.id}'`).phone, stateCode: '27', active: false }))
step('shop deactivated', deact.ok ? 'ok' : deact.message)
const oInactive = await L.tryCall(rep.orders.create({ ...L.mk(), retailerId: cb.id, source: 'salesperson', lines: [{ id: L.uuidv7(), variantId: V.soap, enteredQty: 1, enteredUnit: 'piece' }] }))
step('rep orders for an inactive shop', oInactive.ok ? `ACCEPTED ${oInactive.value.item.state}` : `${oInactive.status} ${oInactive.data?.code ?? ''} ${oInactive.message}`)
expect('a deactivated shop takes no new order (409 shop_inactive, ruling 6)', !oInactive.ok && oInactive.status === 409 && oInactive.data?.code === 'shop_inactive', oInactive.ok ? 'ACCEPTED' : `${oInactive.status} ${oInactive.data?.code}`)
const react = await L.tryCall(owner.retailers.upsert({ ...L.key(), id: cb.id, name: cb.name, phone: L.q1(`select phone from retailers where id = '${cb.id}'`).phone, stateCode: '27', active: true }))
step('shop reactivated', react.ok ? 'ok' : react.message)
const credAfter = L.q1(`select credit_limit_paise, credit_mode::text, credit_days, payment_terms::text, beat_id from retailers where id = '${cb.id}'`)
step('credit terms and beat after the deactivate/reactivate upserts', credAfter)
if (oInactive.ok && oInactive.value?.item?.id) await L.tryCall(rep.orders.cancel({ ...L.key(), id: oInactive.value.item.id, reason: 'QA p7' }))
fig = await figures('after reactivation', [cb], { orderTotalPaise: BASKET })
recon('S3-C4-stop')

// --- C5 pay on delivery ---------------------------------------------------------------------------------------------------------
begin('C5', 'Pay-on-delivery shop (payment terms ON), strict, no open bills')
const cp = await F.createShop('QA P7 CR5 POD Stores', { creditLimitPaise: 0, creditMode: 'strict', paymentTerms: 'ON' })
const op = await F.placeOrder(cp.id, basket)
step('POD order', flagsOf(op))
// Architect ruling of 2026-09-28 on DOS-225 (the five questions of the simulation report): a pay-on-delivery shop gets
// no credit, so its order is not held for credit; it is held only while the shop is blocked.
expect('pay-on-delivery order confirmed, not held for credit (DOS-225)', op.submitted.ok && op.submitted.value.item.state === 'confirmed', JSON.stringify(flagsOf(op)))
if (op.submitted.value?.item?.state === 'submitted') await F.approveAll(op.orderId)
recon('S3-C5-pod')

// --- C6 bill-count limit and overdue days ----------------------------------------------------------------------------------------------
begin('C6', 'Bill-count limit and overdue days (seeded R-0017, strict, 5 open bills)')
const desh = { id: '4d9bdf95-46d1-707f-ab62-cb1b205a4433', code: 'R-0017' }
const before = L.q1(`select credit_limit_paise, credit_limit_bills, credit_days, credit_mode::text from retailers where id = '${desh.id}'`)
step('seeded terms', before)
await F.setCredit(desh.id, { tier: 'B', creditLimitPaise: 10_000_000_00, creditLimitBills: 6, creditDays: 7, creditMode: 'strict', paymentTerms: 'POST_FULFILLMENT' })
fig = await figures('big limit, 6-bill cap, 7 credit days', [desh], { orderTotalPaise: BASKET })
step('credit check', fig.shops[desh.code].owner_credit)
expect('overdue days and bill count reported against the terms', fig.shops[desh.code].owner_credit.reasons.includes('overdue_days_exceeded'), JSON.stringify(fig.shops[desh.code].owner_credit.reasons))
await F.setCredit(desh.id, { tier: 'B', creditLimitPaise: 10_000_000_00, creditLimitBills: 5, creditDays: 365, creditMode: 'strict', paymentTerms: 'POST_FULFILLMENT' })
fig = await figures('5-bill cap with 5 open bills', [desh], { orderTotalPaise: BASKET })
expect('five open bills on a five-bill cap breaches', fig.shops[desh.code].owner_credit.reasons.includes('bill_count_exceeded'), JSON.stringify(fig.shops[desh.code].owner_credit))
await F.setCredit(desh.id, { tier: 'B', creditLimitPaise: Number(before.credit_limit_paise), creditLimitBills: before.credit_limit_bills, creditDays: before.credit_days, creditMode: before.credit_mode, paymentTerms: 'POST_FULFILLMENT' })
recon('S3-C6-overdue-bills')

// --- C7 limit lowered below what the shop owes --------------------------------------------------------------------------------------------
begin('C7', 'Limit lowered below what the shop already owes (CR3 owes ₹1,190)')
await F.setCredit(c2.id, { tier: 'B', creditLimitPaise: 20000, creditLimitBills: 0, creditDays: 0, creditMode: 'strict', paymentTerms: 'POST_FULFILLMENT' })
fig = await figures('limit ₹200 on ₹1,190 owed', [c2], { orderTotalPaise: 100 })
step('credit check for a ₹1 order', fig.shops[c2.code].owner_credit)
expect('headroom negative and every new order held', fig.shops[c2.code].owner_credit.headroom < 0 && fig.shops[c2.code].owner_credit.breached)
const small = await F.placeOrder(c2.id, [{ variantId: V.soap, qty: 1 }])
step('a one-soap order', flagsOf(small))
recon('S3-C7-lowered')

// --- C8 screens for a shop with a retailer login ----------------------------------------------------------------------------------------------
begin('C8', 'Every screen for a shop with its own login (seeded R-0001, ramesh.gupta, strict)')
const ramesh = { id: '34191c43-f0bc-70ab-a39d-fcbe8f94ae36', code: 'R-0001' }
const retOpts = { retailerUser: 'ramesh.gupta', orderTotalPaise: BASKET }
const tenantOfRamesh = L.T
await L.as('ramesh.gupta', { svc: 'retailer', tenantId: tenantOfRamesh })
fig = await figures('R-0001 as seeded', [ramesh], retOpts)
expect('owner, accountant, rep, crew and the shop itself show the same dues as SQL', agree(fig, ramesh.code).length === 0, agree(fig, ramesh.code).join('; '))
const rr = await L.as('ramesh.gupta', { svc: 'retailer', tenantId: tenantOfRamesh })
const card = await L.tryCall(rr.retailers.get({ id: ramesh.id }))
step('the shop\'s own card carries no credit policy (DOS-100)', card.ok ? { limit: (card.value.item ?? card.value).creditLimitPaise, mode: (card.value.item ?? card.value).creditMode } : card.message)
const ro = await F.placeOrder(ramesh.id, basket, 'rep')
step('rep order for R-0001', flagsOf(ro))
fig = await figures('R-0001 after a rep order', [ramesh], retOpts)
recon('S3-C8-retailer-view')

save('results-s3.json')
writeFileSync(`${L.EV}s3-context.json`, JSON.stringify({ cw, cs, c2, cb, cp, desh, ramesh, orders: { ow: ow.orderId, under: under.orderId, at: at.orderId, over: over.orderId, first: first.orderId, second: second.orderId, ob: ob.orderId, ob2: ob2.orderId, ob3: ob3.orderId, op: op.orderId, small: small.orderId, ro: ro.orderId }, bills: { ppBoth: ppBoth.invoices } }, null, 2))
