// Phase 8 — price changes in flight. Variants here are NOT used by cases.mjs, so this can run beside run-orders.mjs.
// For each change we record which rate the bill carries and whether the product tells anyone (order flags, approvals,
// transitions, notifications rows).
import { writeFileSync } from 'node:fs'
import * as L from './lib.mjs'
import * as I from './inputs.mjs'
import { oracle } from './oracle.mjs'

L.wireTo('in-flight')
const owner = await L.as('owner')
const rep = await L.as('rep')
const today = L.today()
const W = {
  w1: 'a9a1888f-4f84-78c5-aa66-06be7e0377bf', // Chamak Detergent 125 g, 18 %
  w2: '00991e15-fd1e-7637-a093-bfec3e357a26', // Chamak Detergent 250 g, 18 %
  w3: '52b699ca-9711-706b-bc2b-2326516b6c14', // Chamak Dishwash 145 g, 18 %
  w4: '5370bbc0-2819-7d3f-af0d-4e596dcfaf2a', // Chamak Dishwash 300 g, 18 %
  w5: '24aca25b-5c86-7fe2-88e0-d1ca4bd3db7c', // Konkan Banana Chips, 12 %
  w6: 'e25b8144-f0e2-799b-8166-895e5fb9fc60', // Konkan Farsan Mix, 12 %
  w7: '878de899-f8fd-70f5-b4b6-19e3a9394121', // Konkan Peanut Masala, 12 %
  w8: 'dde2766a-8341-7cfc-b57b-025e8133e99e', // Neelam Toothpaste, 18 %
}
const LIST_C = L.q1(`select id from price_lists where tenant_id='${L.T}' and tier='C'`).id
const rateC = (v) => Number(L.q1(`select rate_paise r from price_list_items where tenant_id='${L.T}' and price_list_id='${LIST_C}' and variant_id='${v}'`).r)
const setRateC = async (v, r) => L.tryCall(owner.pricing.priceLists.setItems({ ...L.key(), priceListId: LIST_C, items: [{ id: L.uuidv7(), variantId: v, ratePaise: r, inclusiveOfGst: false }] }))
const out = []
const tell = (orderId, invoiceId) => ({
  flags: L.q1(`select approval_flags f from sales_orders where id='${orderId}'`).f,
  approvals: L.q(`select kind::text, status::text from approvals where order_id='${orderId}'`),
  transitions: L.q(`select event, reason from order_state_transitions where order_id='${orderId}' order by occurred_at`).map((t) => `${t.event}${t.reason ? `(${t.reason})` : ''}`),
  messages: L.q(`select template_key, channel::text, status::text from messages where tenant_id='${L.T}' and (ref_id in ('${orderId}'${invoiceId ? `, '${invoiceId}'` : ''}) or payload::text like '%${orderId}%')`),
})
const orderLines = (orderId) => L.q(`select variant_id, qty_pcs, list_rate_paise list, rate_paise rate, discount_paise disc, tax_paise tax, line_total_paise total, applied_rules from sales_order_lines where order_id='${orderId}' order by line_no`)
const invLines = (orderId) => L.q(`select il.variant_id, il.qty_pcs, il.rate_paise rate, il.discount_paise disc, il.taxable_paise taxable, i.total_paise inv_total from invoice_lines il join invoices i on i.id=il.invoice_id where i.order_id='${orderId}' and i.state <> 'cancelled' order by il.line_no`)
const note = (x) => {
  out.push(x)
  console.log(JSON.stringify(x).slice(0, 700))
}
async function placeConfirmed(shop, lines) {
  const o = await L.placeOrder(shop.id, lines, 'rep')
  if (!o.created.ok) throw new Error(`create ${o.created.status} ${o.created.message}`)
  return o
}

// ---- IF1: price list raised after confirm, before pack
{
  const shop = await L.createShop('QA P8 IF1 list change before bill', { tier: 'C' })
  const r0 = rateC(W.w1)
  const o = await placeConfirmed(shop, [{ variantId: W.w1, qty: 10 }])
  const st = o.submitted.value.item.state
  const before = orderLines(o.orderId)
  const ch = await setRateC(W.w1, r0 + 111)
  const pk = await L.pickAndPack([o.orderId])
  note({ id: 'IF1', what: 'tier-C price list raised by ₹1.11 after confirm, before pick/pack', stateAtChange: st, listBefore: r0, listAfter: r0 + 111, change: ch.ok ? 'ok' : `${ch.status} ${ch.message}`, orderLine: before[0], billLine: invLines(o.orderId)[0], tell: tell(o.orderId, pk.invoices[0].invoiceId), invoice: pk.invoices[0] })
  await setRateC(W.w1, r0)
}
// ---- IF2: shop override lowered after confirm, before pack
{
  const shop = await L.createShop('QA P8 IF2 override before bill', { tier: 'C' })
  const o = await placeConfirmed(shop, [{ variantId: W.w2, qty: 10 }])
  const before = orderLines(o.orderId)
  const ch = await L.tryCall(owner.pricing.overrides.upsert({ ...L.mk(), retailerId: shop.id, variantId: W.w2, ratePaise: 1300, final: false, validFrom: today, note: 'QA p8 IF2' }))
  const pk = await L.pickAndPack([o.orderId])
  note({ id: 'IF2', what: 'shop override ₹13.00 set after confirm, before pack (tier C ₹14.24)', stateAtChange: o.submitted.value.item.state, change: ch.ok ? 'ok' : `${ch.status} ${ch.message}`, orderLine: before[0], billLine: invLines(o.orderId)[0], tell: tell(o.orderId, pk.invoices[0].invoiceId) })
}
// ---- IF3: a 10 % scheme created after confirm, before pack
{
  const shop = await L.createShop('QA P8 IF3 scheme before bill', { tier: 'C' })
  const o = await placeConfirmed(shop, [{ variantId: W.w3, qty: 10 }])
  const before = orderLines(o.orderId)
  const ch = await L.tryCall(owner.pricing.schemes.upsert({ ...L.mk(), name: 'QA P8 IF3 10%', scope: { variantIds: [W.w3] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'pcs', rewardKind: 'line_pct', rewardValue: 1000, applicability: { retailerIds: [shop.id] }, validFrom: today, validTo: L.addDays(today, 30), fundingSource: 'distributor' }))
  const pk = await L.pickAndPack([o.orderId])
  note({ id: 'IF3', what: '10 % scheme for this shop created after confirm, before pack', change: ch.ok ? 'ok' : `${ch.status} ${ch.message}`, orderLine: before[0], billLine: invLines(o.orderId)[0], tell: tell(o.orderId, pk.invoices[0].invoiceId) })
}
// ---- IF4: price list, override and scheme changed AFTER the bill
{
  const shop = await L.createShop('QA P8 IF4 change after bill', { tier: 'C' })
  const r0 = rateC(W.w4)
  const o = await placeConfirmed(shop, [{ variantId: W.w4, qty: 10 }])
  const pk = await L.pickAndPack([o.orderId])
  const inv0 = L.q1(`select total_paise, taxable_paise, updated_at from invoices where id='${pk.invoices[0].invoiceId}'`)
  const ol0 = orderLines(o.orderId)
  const c1 = await setRateC(W.w4, r0 - 200)
  const c2 = await L.tryCall(owner.pricing.overrides.upsert({ ...L.mk(), retailerId: shop.id, variantId: W.w4, ratePaise: r0 - 300, final: false, validFrom: today }))
  const c3 = await L.tryCall(owner.pricing.schemes.upsert({ ...L.mk(), name: 'QA P8 IF4 10%', scope: { variantIds: [W.w4] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'pcs', rewardKind: 'line_pct', rewardValue: 1000, applicability: { retailerIds: [shop.id] }, validFrom: today, validTo: L.addDays(today, 30), fundingSource: 'distributor' }))
  const inv1 = L.q1(`select total_paise, taxable_paise, updated_at from invoices where id='${pk.invoices[0].invoiceId}'`)
  note({ id: 'IF4', what: 'list −₹2, override −₹3, 10 % scheme — all after the bill', changes: [c1.ok, c2.ok, c3.ok], invoiceBefore: inv0, invoiceAfter: inv1, orderBefore: ol0[0], orderAfter: orderLines(o.orderId)[0], unchanged: inv0.total_paise === inv1.total_paise && JSON.stringify(ol0) === JSON.stringify(orderLines(o.orderId)) })
  await setRateC(W.w4, r0)
}
// ---- IF5: changes while the order is HELD for approval (strict credit shop over its limit)
async function heldShop(name) {
  const shop = await L.createShop(name, { tier: 'C' })
  await L.must(owner.retailers.setCredit({ ...L.key(), id: shop.id, tier: 'C', creditLimitPaise: 100, creditLimitBills: 0, creditDays: 0, creditMode: 'strict', paymentTerms: 'POST_FULFILLMENT' }), 'setCredit strict')
  return shop
}
for (const sc of [
  { id: 'IF5a', v: W.w5, what: 'tier-C list LOWERED by ₹2 while held', change: async (shop, r0) => setRateC(W.w5, r0 - 200), restore: async (r0) => setRateC(W.w5, r0), rule: 'docs/22 2026-09-13 (DOS-126): a price-list edit made in between does NOT re-price' },
  { id: 'IF5b', v: W.w6, what: 'tier-C list RAISED by ₹2 while held', change: async (shop, r0) => setRateC(W.w6, r0 + 200), restore: async (r0) => setRateC(W.w6, r0), rule: 'DOS-126: does NOT re-price' },
  { id: 'IF5c', v: W.w7, what: "shop's own override LOWERED by ₹2 while held", change: async (shop, r0) => L.tryCall(owner.pricing.overrides.upsert({ ...L.mk(), retailerId: shop.id, variantId: W.w7, ratePaise: r0 - 200, final: false, validFrom: today })), rule: "DOS-126: a shop's own approved rate that lowers the net IS applied" },
  { id: 'IF5d', v: W.w8, what: '10 % scheme created while held', change: async (shop) => L.tryCall(owner.pricing.schemes.upsert({ ...L.mk(), name: 'QA P8 IF5d 10%', scope: { variantIds: [W.w8] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'pcs', rewardKind: 'line_pct', rewardValue: 1000, applicability: { retailerIds: [shop.id] }, validFrom: today, validTo: L.addDays(today, 30), fundingSource: 'distributor' })), rule: 'DOS-126: a scheme edit does NOT re-price' },
]) {
  const shop = await heldShop(`QA P8 ${sc.id} held`)
  const r0 = rateC(sc.v)
  const o = await L.placeOrder(shop.id, [{ variantId: sc.v, qty: 10 }], 'rep')
  const heldState = o.submitted.ok ? o.submitted.value.item.state : `${o.submitted?.status} ${o.submitted?.message}`
  const before = orderLines(o.orderId)
  const ch = await sc.change(shop, r0)
  const appr = await L.approveAll(o.orderId)
  const after = orderLines(o.orderId)
  const st = L.q1(`select state::text s from sales_orders where id='${o.orderId}'`).s
  let bill = null
  if (st === 'confirmed') {
    const pk = await L.pickAndPack([o.orderId])
    bill = invLines(o.orderId)[0]
  }
  note({ id: sc.id, what: sc.what, rule: sc.rule, heldState, flags: o.submitted.ok ? o.submitted.value.item.approvalFlags : null, listRate: r0, change: ch.ok === false ? `${ch.status} ${ch.message}` : 'ok', approvals: appr.map((a) => `${a.kind}:${a.r.ok ? 'approved' : a.r.status}`), orderBefore: before[0], orderAfterConfirm: after[0], stateAfter: st, billLine: bill, tell: tell(o.orderId) })
  if (sc.restore) await sc.restore(r0)
}
// ---- IF6: orders.setLines on a draft that already carries applied rules
{
  const shop = await L.createShop('QA P8 IF6 setLines', { tier: 'C' })
  await L.must(owner.pricing.schemes.upsert({ ...L.mk(), name: 'QA P8 IF6 5% on 2+ cases', scope: { variantIds: [W.w1] }, triggerKind: 'qty', triggerMin: 2, triggerUnit: 'case', rewardKind: 'line_pct', rewardValue: 500, applicability: { retailerIds: [shop.id] }, validFrom: today, validTo: L.addDays(today, 30), fundingSource: 'distributor' }), 'IF6 scheme')
  const o = await L.placeOrder(shop.id, [{ variantId: W.w1, qty: 2, unit: 'case' }], 'rep', { draftOnly: true })
  const d0 = orderLines(o.orderId)
  const lineId = L.uuidv7()
  const s1 = await L.tryCall(rep.orders.setLines({ ...L.key(), id: o.orderId, lines: [{ id: lineId, variantId: W.w1, enteredQty: 143, enteredUnit: 'piece' }] }))
  const d1 = orderLines(o.orderId)
  // a second scheme appears while it is still a draft, then the lines are set again (back to 2 cases)
  await L.must(owner.pricing.schemes.upsert({ ...L.mk(), name: 'QA P8 IF6 extra 2%', scope: { variantIds: [W.w1] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'pcs', rewardKind: 'line_pct', rewardValue: 200, applicability: { retailerIds: [shop.id] }, validFrom: today, validTo: L.addDays(today, 30), fundingSource: 'distributor' }), 'IF6 scheme 2')
  const s2 = await L.tryCall(rep.orders.setLines({ ...L.key(), id: o.orderId, lines: [{ id: L.uuidv7(), variantId: W.w1, enteredQty: 2, enteredUnit: 'case' }] }))
  const d2 = orderLines(o.orderId)
  const orc = oracle(I.load(shop.id, [{ lineId: 'x', variantId: W.w1, qtyPcs: 144 }]))
  // a stored reward line posted back through setLines must be dropped (DOS-185) — try posting an extra "free" style line at 0 qty is impossible
  // (enteredQty must be positive), so post the reward variant as a normal line and see that it is SOLD, not free (expected: sold at list).
  note({ id: 'IF6', what: 'setLines on a draft with rules: 2 cs (5 %) → 143 pcs (under 2 cs) → 2 cs again after a new 2 % scheme', draft: d0.map((l) => ({ qty: l.qty_pcs, disc: l.disc, rules: l.applied_rules.map((r) => r.amountPaise) })), afterSet1: s1.ok ? d1.map((l) => ({ qty: l.qty_pcs, disc: l.disc, rules: l.applied_rules.map((r) => r.amountPaise) })) : `${s1.status} ${s1.message}`, afterSet2: s2.ok ? d2.map((l) => ({ qty: l.qty_pcs, disc: l.disc, total: l.total, rules: l.applied_rules.map((r) => r.amountPaise) })) : `${s2.status} ${s2.message}`, oracleFor2cs: { disc: orc.lines[0].discount, net: orc.lines[0].net, total: orc.lines[0].total } })
}
// ---- IF7: a DRAFT priced, the list changes, then the draft is submitted (does submit re-price?)
{
  const shop = await L.createShop('QA P8 IF7 draft then list change', { tier: 'C' })
  const r0 = rateC(W.w2)
  const o = await L.placeOrder(shop.id, [{ variantId: W.w2, qty: 6 }], 'rep', { draftOnly: true })
  const d0 = orderLines(o.orderId)
  await setRateC(W.w2, r0 + 150)
  const sub = await L.tryCall(rep.orders.submit({ ...L.key(), id: o.orderId }))
  const d1 = orderLines(o.orderId)
  note({ id: 'IF7', what: 'draft at ₹' + r0 / 100 + ', tier-C list raised ₹1.50, then submitted', submit: sub.ok ? sub.value.item.state : `${sub.status} ${sub.message}`, draftLine: d0[0], afterSubmit: d1[0], repriced: d0[0].rate !== d1[0].rate, tell: tell(o.orderId) })
  await setRateC(W.w2, r0)
}
writeFileSync(`${L.EV}in-flight.json`, JSON.stringify(out, null, 1))
console.log('done', out.length)
