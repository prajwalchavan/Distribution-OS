// Phase 7 · S2 addendum (A9b) — the same UPI transaction (UTR) recorded twice: for the same shop, and for a second shop.
import { readFileSync } from 'node:fs'
import { begin, step, expect, figures, agree, recon, save, L, F } from './scenario-kit.mjs'
const S2 = JSON.parse(readFileSync(`${L.EV}s2-context.json`, 'utf8'))
begin('A9b', 'The same UPI UTR recorded twice (same shop), then once more against another shop')
const shop = await F.createShop('QA P7 PB7 UTR Stores', { creditLimitPaise: 50_000_00 })
const o = await F.placeOrder(shop.id, [{ variantId: 'af45e021-a167-7d3f-a8f0-60ab037214cb', qty: 12 }])
const b = (await F.pickAndPack([o.orderId])).invoices[0]
const utr = `UTR${Date.now()}`
const a = await F.deskReceipt(shop.id, 'upi', b.totalPaise, { reference: utr, upiVpa: 'pb7@okicici' })
const a2 = await F.deskReceipt(shop.id, 'upi', b.totalPaise, { reference: utr, upiVpa: 'pb7@okicici' })
step('same UTR, same shop, same amount, new id/key', a2.ok ? { receiptNo: a2.value.item.receiptNo, unalloc: a2.value.item.unallocatedPaise } : `${a2.status} ${a2.message}`)
expect('the second use of one UTR for the same shop is refused', !a2.ok, a2.ok ? `ACCEPTED ${a2.value.item.receiptNo}` : 'refused')
const other = S2.pb5
const a3 = await F.deskReceipt(other.id, 'upi', b.totalPaise, { reference: utr, upiVpa: 'pb7@okicici' })
step('same UTR against another shop', a3.ok ? { receiptNo: a3.value.item.receiptNo, alloc: a3.value.item.allocatedPaise, unalloc: a3.value.item.unallocatedPaise } : `${a3.status} ${a3.message}`)
expect('one UTR cannot pay two shops', !a3.ok, a3.ok ? `ACCEPTED ${a3.value.item.receiptNo}` : 'refused')
const fig = await figures('after duplicate UTRs', [shop, other])
step('UPI receipts carrying this UTR', L.q(`select receipt_no, retailer_id = '${shop.id}' same_shop, amount_paise from receipts where reference = '${utr}' order by receipt_no`))
recon('S2-A9b-utr')
save('results-s2.json')
