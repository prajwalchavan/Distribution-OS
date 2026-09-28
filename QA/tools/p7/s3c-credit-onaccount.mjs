// Phase 7 · S3 addendum (C9) — a seeded shop that is IN CREDIT (money on account > its dues) as every screen and the gate see it.
import { begin, step, expect, figures, recon, save, L, F } from './scenario-kit.mjs'
begin('C9', 'Seeded R-0047 Mangal Traders: ₹5,000 on account, one ₹867 bill overdue, strict — what the gate and the screens say')
const shop = { id: L.q1(`select id from retailers where code = 'R-0047' and tenant_id = '${L.T}'`).id, code: 'R-0047' }
const fig = await figures('as seeded', [shop], { orderTotalPaise: 59500 })
const f = fig.shops[shop.code]
step('owner credit check for a ₹595 order', f.owner_credit)
step('rep credit check for a ₹595 order', f.rep_credit)
expect('a shop whose net is in credit is not held for credit', !f.owner_credit.breached, `net ${f.sql.net} (dues ${f.sql.outstanding}, on account ${f.sql.onAccount}); gate says breached=${f.owner_credit.breached} ${JSON.stringify(f.owner_credit.reasons)}`)
const rep = await L.as('rep')
const o = await F.placeOrder(shop.id, [{ variantId: 'af45e021-a167-7d3f-a8f0-60ab037214cb', qty: 12 }])
step('rep order for R-0047', o.submitted.ok ? { state: o.submitted.value.item.state, flags: o.submitted.value.item.approvalFlags, notice: o.submitted.value.item.creditNotice } : o.submitted.message)
recon('S3-C9-in-credit')
save('results-s3.json')
