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
const o = await F.placeOrder(shop.id, [{ variantId: 'f71bf137-50de-7182-a0d9-c83f1a613a57', qty: 12 }])
step('rep order on the inactive shop: create + submit', o.submitted.ok ? { state: o.submitted.value.item.state, no: o.submitted.value.item.orderNo } : `${o.submitted.status} ${o.submitted.message}`)
expect('an inactive shop cannot be sold to on credit (order refused or held)', !o.submitted.ok || o.submitted.value.item.state !== 'confirmed', o.submitted.ok ? `state ${o.submitted.value.item.state}` : 'refused')
const cc = await L.tryCall(rep.receivables.creditCheck({ retailerId: shop.id, orderTotalPaise: 10000 }))
step('credit check on the inactive shop', cc.ok ? { breached: cc.value.breached, reasons: cc.value.reasons } : cc.message)
if (o.submitted.ok && o.submitted.value.item.state === 'confirmed') {
  const pp = await F.pickAndPack([o.orderId])
  step('billed while inactive', pp.invoices.map((i) => `${i.invoiceNo} ${i.totalPaise}`))
}
const re = await L.tryCall(owner.retailers.upsert({ ...body, ...L.key(), active: true }))
step('reactivated', re.ok ? L.q1(`select active, beat_id is not null has_beat from retailers where id = '${shop.id}'`) : re.message)
recon('S3-C4b-inactive')
save('results-s3.json')
