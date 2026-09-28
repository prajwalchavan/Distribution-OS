// Phase 8 — who may discount. Every role tries every price/discount lever through its own service, by raw HTTP so that
// extra fields a typed client would strip reach the server. Status codes and what was stored are recorded.
import { writeFileSync } from 'node:fs'
import * as L from './lib.mjs'

L.wireTo('roles')
const today = L.today()
const owner = await L.as('owner')
const ROLES = [
  { role: 'owner', who: 'owner', svc: 'owner' },
  { role: 'manager', who: 'manager', svc: 'manager' },
  { role: 'accountant', who: 'accountant', svc: 'manager' },
  { role: 'salesperson', who: 'rep', svc: 'sales' },
  { role: 'warehouse', who: 'wh', svc: 'warehouse' },
  { role: 'delivery', who: 'driver', svc: 'delivery' },
  { role: 'retailer', who: 'shop', svc: 'retailer' },
]
const W1 = 'a9a1888f-4f84-78c5-aa66-06be7e0377bf' // Chamak Detergent 125 g (not used by cases.mjs)
const LIST_C = L.q1(`select id from price_lists where tenant_id='${L.T}' and tier='C'`).id
const rateC = Number(L.q1(`select rate_paise r from price_list_items where tenant_id='${L.T}' and price_list_id='${LIST_C}' and variant_id='${W1}'`).r)
const probe = await L.createShop('QA P8 roles probe shop', { tier: 'C' })
const ownShop = L.q1(`select r.id from retailer_links rl join users u on u.id=rl.user_id join retailers r on r.id=rl.retailer_id where rl.tenant_id='${L.T}' and u.username='${L.USERS.shop}'`).id
await L.must(owner.retailers.setCredit({ ...L.key(), id: ownShop, tier: 'C', creditLimitPaise: 500_000_000_00, creditLimitBills: 0, creditDays: 0, creditMode: 'indicate', paymentTerms: 'POST_FULFILLMENT' }), 'own shop credit')
const repId = L.q1(`select id from users where username='${L.USERS.rep}'`).id
const rows = []
const rec = (role, action, r, extra = {}) => {
  const row = { role, action, status: r.status, code: r.body?.code ?? null, msg: typeof r.body?.message === 'string' ? r.body.message.slice(0, 140) : null, ...extra }
  rows.push(row)
  console.log(`${role.padEnd(11)} ${action.padEnd(44)} ${r.status} ${row.code ?? ''} ${row.msg ?? ''} ${Object.keys(extra).length ? JSON.stringify(extra).slice(0, 300) : ''}`)
  return r
}
const pendingBargain = async () => {
  const r = await L.must((await L.as('rep')).pricing.bargains.request({ ...L.mk(), retailerId: probe.id, variantId: W1, askedRatePaise: Math.round(rateC * 0.8), note: 'QA p8 roles: decide me' }), 'rep bargain')
  return r.item.id
}
const heldApproval = async () => {
  const s = await L.createShop('QA P8 roles held', { tier: 'C' })
  await L.must(owner.retailers.setCredit({ ...L.key(), id: s.id, tier: 'C', creditLimitPaise: 100, creditLimitBills: 0, creditDays: 0, creditMode: 'strict', paymentTerms: 'POST_FULFILLMENT' }), 'strict')
  const o = await L.placeOrder(s.id, [{ variantId: W1, qty: 3 }], 'rep')
  return L.q1(`select id from approvals where order_id='${o.orderId}' and status='pending' limit 1`)?.id
}

for (const R of ROLES) {
  const call = (method, path, body) => L.raw(R.who, method, path, body, { svc: R.svc })
  const shopFor = R.role === 'retailer' ? ownShop : probe.id
  // 1. price lists
  rec(R.role, 'priceLists.upsert (new inactive list)', await call('POST', '/pricing/price-lists', { ...L.mk(), name: `QA P8 probe list ${R.role}`, tier: null, isDefault: false, active: false }))
  const setItems = rec(R.role, 'priceLists.setItems (Tier C, W1 −₹1)', await call('POST', `/pricing/price-lists/${LIST_C}/items`, { ...L.key(), priceListId: LIST_C, items: [{ id: L.uuidv7(), variantId: W1, ratePaise: rateC - 100, inclusiveOfGst: false }] }))
  if (setItems.status < 300) await L.must(owner.pricing.priceLists.setItems({ ...L.key(), priceListId: LIST_C, items: [{ id: L.uuidv7(), variantId: W1, ratePaise: rateC, inclusiveOfGst: false }] }), 'restore list')
  // 2. override
  rec(R.role, 'overrides.upsert (shop rate ₹1.00)', await call('POST', '/pricing/overrides', { ...L.mk(), retailerId: probe.id, variantId: W1, ratePaise: 100, final: true, validFrom: L.addDays(today, 400), note: 'QA p8 roles probe (dated next year)' }))
  // 3. scheme
  rec(R.role, 'schemes.upsert (inactive 50 % scheme)', await call('POST', '/pricing/schemes', { ...L.mk(), name: `QA P8 roles probe ${R.role}`, scope: { variantIds: [W1] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'pcs', rewardKind: 'line_pct', rewardValue: 5000, applicability: { retailerIds: [probe.id] }, validFrom: today, validTo: today, active: false }))
  // 4. bargain request (own shop for the retailer, the probe shop for staff), and the retailer against a shop that is not its own
  const br = rec(R.role, 'bargains.request (−20 %)', await call('POST', '/pricing/bargains', { ...L.mk(), retailerId: shopFor, variantId: W1, askedRatePaise: Math.round(rateC * 0.8), qtyPcs: 5, note: `QA p8 roles ${R.role}` }))
  if (br.status < 300) rows[rows.length - 1].stored = br.body?.item?.status
  const small = rec(R.role, 'bargains.request (−2 %, inside a rep bound)', await call('POST', '/pricing/bargains', { ...L.mk(), retailerId: shopFor, variantId: W1, askedRatePaise: Math.round(rateC * 0.98), qtyPcs: 5, note: `QA p8 roles small ${R.role}` }))
  if (small.status < 300) rows[rows.length - 1].stored = small.body?.item?.status
  if (R.role === 'retailer') rec(R.role, 'bargains.request for ANOTHER shop', await call('POST', '/pricing/bargains', { ...L.mk(), retailerId: probe.id, variantId: W1, askedRatePaise: 1, qtyPcs: 5 }))
  // 5. bargain decide
  const bid = await pendingBargain()
  const bd = rec(R.role, 'bargains.decide (approve at ₹0.01)', await call('POST', `/pricing/bargains/${bid}/decide`, { ...L.key(), id: bid, decision: 'approve', approvedRatePaise: 1, note: 'QA p8 roles' }))
  if (bd.status < 300) {
    rows[rows.length - 1].stored = L.q1(`select status::text, approved_rate_paise from bargain_requests where id='${bid}'`)
    await L.tryCall(owner.pricing.bargains.decide({ ...L.key(), id: bid, decision: 'reject' }))
  } else await L.tryCall(owner.pricing.bargains.decide({ ...L.key(), id: bid, decision: 'reject', note: 'QA p8 roles cleanup' }))
  // 6. rep bound
  rec(R.role, 'bounds.set (rep may give 50 %)', await call('POST', '/pricing/bounds', { ...L.mk(), userId: repId, maxDiscountBps: 5000 }))
  if (L.q1(`select max_discount_bps m from rep_auto_approve_bounds where user_id='${repId}' and brand_id is null`).m !== 300) {
    rows[rows.length - 1].stored = 'bound changed'
    await L.must(owner.pricing.bounds.set({ ...L.mk(), id: L.q1(`select id from rep_auto_approve_bounds where user_id='${repId}' and brand_id is null`).id, userId: repId, maxDiscountBps: 300 }), 'restore bound')
  }
  // 7. manual price / discount smuggled on an order line (create) and on re-line (setLines)
  const oid = L.uuidv7()
  const lineId = L.uuidv7()
  const cr = rec(R.role, 'orders.create with ratePaise/discount fields', await call('POST', '/orders', { id: oid, idempotencyKey: L.uuidv7(), retailerId: shopFor, source: R.role === 'retailer' ? 'retailer_app' : R.role === 'salesperson' ? 'salesperson' : 'phone', discountPaise: 99999, totalPaise: 100, lines: [{ id: lineId, variantId: W1, enteredQty: 10, enteredUnit: 'piece', ratePaise: 1, listRatePaise: 1, discountPaise: 5000, discountBps: 5000, priceLocked: true, appliedRules: [{ ruleId: 'manual', version: 1, kind: 'manual', amountPaise: 5000 }] }] }))
  if (cr.status < 300) {
    const l = L.q1(`select list_rate_paise, rate_paise, discount_paise, discount_bps, price_locked, applied_rules from sales_order_lines where order_id='${oid}'`)
    rows[rows.length - 1].stored = { ...l, tierC: rateC, orderTotal: L.q1(`select total_paise t from sales_orders where id='${oid}'`).t }
    const sl = rec(R.role, 'orders.setLines with ratePaise/discount fields', await call('POST', `/orders/${oid}/lines`, { ...L.key(), id: oid, lines: [{ id: L.uuidv7(), variantId: W1, enteredQty: 12, enteredUnit: 'piece', ratePaise: 1, discountPaise: 5000, discountBps: 9000 }] }))
    if (sl.status < 300) rows[rows.length - 1].stored = L.q1(`select rate_paise, discount_paise, discount_bps from sales_order_lines where order_id='${oid}'`)
    await L.tryCall(owner.orders.cancel({ ...L.key(), id: oid, reason: 'QA p8 roles probe' }))
  }
  // 8. approvals (a held order's gate)
  const aid = await heldApproval()
  if (aid) rec(R.role, 'orders.approvals.decide (approve a gate)', await call('POST', `/approvals/${aid}/decide`, { ...L.key(), id: aid, decision: 'approve', note: 'QA p8 roles' }))
  // 9. quote with a rate the caller made up
  const qq = rec(R.role, 'pricing.quote with ratePaise on the line', await call('POST', '/pricing/quote', { retailerId: shopFor, lines: [{ lineId: 'a', variantId: W1, qtyPcs: 10, ratePaise: 1 }] }))
  if (qq.status < 300) rows[rows.length - 1].stored = { rate: qq.body?.lines?.[0]?.ratePaise }
}
writeFileSync(`${L.EV}roles.json`, JSON.stringify({ at: new Date().toISOString(), tierCRate: rateC, rows }, null, 1))
