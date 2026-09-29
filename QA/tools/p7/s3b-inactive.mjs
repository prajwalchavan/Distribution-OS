// Phase 7 · S3 addendum — an inactive (blocked) shop: can an order still be submitted and billed? Full-record upserts.
import { readFileSync } from 'node:fs'
import { begin, step, expect, recon, save, L, F } from './scenario-kit.mjs'
const S3 = JSON.parse(readFileSync(`${L.EV}s3-context.json`, 'utf8'))
const owner = await L.as('owner')
const rep = await L.as('rep')
begin('C4b', 'Shop deactivated with its full record (beat kept), then a rep order is submitted; then reactivated')
const shop = await F.createShop('QA P7 CR4b Inactive Stores', { creditLimitPaise: 100_000_00, creditMode: 'strict' })
const cur = await L.must(owner.retailers.get({ id: shop.id }), 'get')
const rec = cur.item ?? cur
const body = { ...L.key(), id: shop.id, name: rec.name, ownerName: rec.ownerName, phone: rec.phone, address: rec.address, beatId: rec.beatId, stateCode: rec.stateCode, gstRegType: rec.gstRegType, paymentTerms: rec.paymentTerms, cashDiscountBps: rec.cashDiscountBps, cashDiscountDays: rec.cashDiscountDays, active: false }
const de = await L.tryCall(owner.retailers.upsert(body))
step('deactivated', de.ok ? L.q1(`select active, beat_id is not null has_beat, credit_mode::text from retailers where id = '${shop.id}'`) : de.message)
// Architect ruling 6 of 2026-09-28 on money and credit (DOS-315): a shop that was deactivated takes no new order, from
// any door — the rep's create is refused 409 shop_inactive in words and nothing is drafted. This scenario expected the
// order to be drafted and then refused or held at submit; it now expects the refusal at create the ruling asks for.
const m = L.mk()
const o = await L.tryCall(rep.orders.create({ ...m, retailerId: shop.id, source: 'salesperson', lines: [{ id: L.uuidv7(), variantId: 'f71bf137-50de-7182-a0d9-c83f1a613a57', enteredQty: 12, enteredUnit: 'piece' }] }))
step('rep order on the inactive shop: create', o.ok ? { state: o.value.item.state } : `${o.status} ${o.data?.code ?? ''} ${o.message}`)
expect('a deactivated shop takes no new order (409 shop_inactive, nothing drafted)', !o.ok && o.status === 409 && o.data?.code === 'shop_inactive' && !L.q1(`select id from sales_orders where id = '${m.id}'`), o.ok ? `ACCEPTED ${o.value.item.state}` : `${o.status} ${o.data?.code}`)
const cc = await L.tryCall(rep.receivables.creditCheck({ retailerId: shop.id, orderTotalPaise: 10000 }))
step('credit check on the inactive shop', cc.ok ? { breached: cc.value.breached, reasons: cc.value.reasons } : cc.message)
if (o.ok && o.value.item.state === 'draft') await L.tryCall(rep.orders.cancel({ ...L.key(), id: o.value.item.id, reason: 'QA p7' }))
const re = await L.tryCall(owner.retailers.upsert({ ...body, ...L.key(), active: true }))
step('reactivated', re.ok ? L.q1(`select active, beat_id is not null has_beat from retailers where id = '${shop.id}'`) : re.message)
recon('S3-C4b-inactive')
save('results-s3.json')
