// S1 — stock in: PO → supplier bill → GRN with batch + expiry → blind count (with damage at the gate) → post.
import { writeFileSync } from 'node:fs'
import * as K from './kit.mjs'
const { L, F } = K
const today = L.todayIst()
const d = (n) => L.addDays(today, n)

export const V = {
  A: '1c127a29-8c7d-7423-9309-a843be818fae', // Konkan Farsan Mix 400 g, case 20
  B: '5e6a0969-c072-7ede-ac4a-69f079d70101', // Sunbake Choco Chip Cookies 120 g, case 48
  C: 'a3c74ab3-3374-7ed9-bda6-b5fb55a1d5c4', // Rajwadi Soda Water 750 ml, case 24
  D: 'a4d86cbe-4dde-7eba-9fa3-a634b39205b6', // Chamak Dishwash Gel 750 ml, case 12
  E: '11356d48-7b70-7f7c-ac45-d2c894e5ef36', // Godavari Dairy Whitener 500 g, case 20
  F: 'be2f1d1d-0a9f-70a2-88c2-d7913822c235', // Annapurna Garam Masala 50 g, case 72
  G: '5f360724-a903-7cf9-8d18-590689edb74a', // Neelam Tooth Brush 2+1, case 48
}

K.begin('S1a', 'receive own batches: PO → supplier bill → GRN → count (20 damaged at gate) → post')
const r1 = await F.receive('S1a', [
  { variantId: V.A, batchNo: 'P10-A1', expiryDate: d(180), mrpPaise: 12000, qtyPcs: 400, damaged: 20 },
  { variantId: V.B, batchNo: 'P10-B-EXP', expiryDate: d(-5), mrpPaise: 3000, qtyPcs: 48 },
  { variantId: V.B, batchNo: 'P10-B-SHORT', expiryDate: d(10), mrpPaise: 3000, qtyPcs: 96 },
  { variantId: V.B, batchNo: 'P10-B-G1', expiryDate: d(120), mrpPaise: 3000, qtyPcs: 96 },
  { variantId: V.B, batchNo: 'P10-B-G2', expiryDate: d(200), mrpPaise: 3000, qtyPcs: 96 },
  { variantId: V.C, batchNo: 'P10-C1', expiryDate: d(90), mrpPaise: 2000, qtyPcs: 480 },
  { variantId: V.D, batchNo: 'P10-D1', expiryDate: d(300), mrpPaise: 12900, qtyPcs: 240 },
  { variantId: V.E, batchNo: 'P10-E1', expiryDate: d(150), mrpPaise: 27500, qtyPcs: 200 },
  { variantId: V.F, batchNo: '', expiryDate: d(100), mrpPaise: 4500, qtyPcs: 144 },
  { variantId: V.G, batchNo: 'P10-G1', expiryDate: null, mrpPaise: 5000, qtyPcs: 480 },
])
K.step('received', { po: r1.poResult, grn: r1.grnNo, lots: r1.lots.map((l) => `${l.batch_no || '(no batch)'} exp ${l.expiry_date} good ${l.counted_qty_pcs} damaged ${l.damaged_qty_pcs}`) })
const rows = K.ledger()
K.check('GRN wrote one grn row per good line into the godown', rows.filter((r) => r.reason === 'grn' && r.kind === 'warehouse').length === 10)
K.check('20 damaged-at-gate pieces went to the damaged bin, not the godown', rows.some((r) => r.reason === 'grn' && r.kind === 'damaged' && r.qty_delta === 20))
K.check('an already-expired batch (P10-B-EXP, expiry today−5) was accepted at the gate', r1.lots.some((l) => l.batch_no === 'P10-B-EXP'), 'recorded: the gate does not refuse or flag an expired batch')
const lotA = r1.lots.find((l) => l.batch_no === 'P10-A1').lot_id
const aPlaces = L.lotPlaces(lotA)
K.step('P10-A1 places', aPlaces)
K.check('P10-A1: godown 380, damaged bin 20', aPlaces.find((p) => p.kind === 'warehouse')?.on_hand === 380 && aPlaces.find((p) => p.kind === 'damaged')?.on_hand === 20)
// Can the damaged-at-gate pieces be seen as sellable by anyone?
const rep = await L.as('rep')
const sell = await L.tryCall(rep.inventory.stock.sellable({ variantId: V.A, limit: 50 }))
const avail = await L.tryCall(rep.inventory.stock.availability({ variantId: V.A }))
K.step('rep sees sellable / availability for item A', { sellable: sell.ok ? sell.value.items.map((i) => `${i.batchNo}@${i.locationId === L.GODOWN ? 'godown' : i.locationId}:${i.available}`) : L.brief(sell), availability: avail.ok ? avail.value.items : L.brief(avail) })
K.check('rep availability for A = 380 (damaged 20 excluded)', avail.ok && avail.value.items[0]?.available === 380)
K.recon()

K.begin('S1b', 'second receipt of a no-batch item with a NEARER expiry (lot identity = item + batch + MRP)')
const r2 = await F.receive('S1b', [{ variantId: V.F, batchNo: '', expiryDate: d(20), mrpPaise: 4500, qtyPcs: 144 }])
const fLots = L.q(`select id, batch_no, expiry_date from stock_lots where variant_id = '${V.F}' and tenant_id = '${L.T}'`)
K.step('lots of item F after two receipts (expiry +100 then +20)', fLots)
K.check('the +20-day pieces kept their own expiry', fLots.some((l) => l.expiry_date === d(20)), fLots.length === 1 ? `ONE lot, expiry ${fLots[0].expiry_date}: the 144 pieces that expire on ${d(20)} are recorded as expiring on ${fLots[0].expiry_date}` : '')
K.step('F places', L.lotPlaces(fLots[0].id))
K.ledger()
K.recon()

writeFileSync(`${L.EV}fixture.json`, JSON.stringify({ V, grn1: r1, grn2: r2, lots: Object.fromEntries(L.q(`select batch_no, id from stock_lots where tenant_id = '${L.T}' and batch_no like 'P10-%'`).map((r) => [r.batch_no, r.id])), lotF: fLots[0]?.id }, null, 1))
K.save('s1-receive.json')
