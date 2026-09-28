// Phase 8 — the generated order plan. Each case gets its OWN fresh shop (so its outstanding is exactly its bill) and its own
// schemes, scoped with applicability.retailerIds = [that shop] so no case leaks into another. Seeded tenant-wide schemes still
// apply by their scope; the oracle reads them like any other input.
import * as L from './lib.mjs'

export const V = {
  // 0 %
  dahi: '57ca9f87-a0c0-717b-9184-983c7b6fae3e', // Godavari Dahi 200 g, cs 30
  salt: '0b28d56e-b090-7736-8f4f-7d95f2695b22', // Annapurna Iodised Salt 1 kg, cs 24
  uht: '3a4ace01-4dc5-71d6-bdd3-84cc49f25c54', // Godavari Toned UHT 1 L, cs 12 — seeded "2% off on 3+ cases" (to 10-12)
  // 5 %
  masala: '270b32e6-1ea8-78b4-9530-1a2794812922', // Garam Masala 100 g, cs 48
  chilli: 'a2bb9708-5bcc-7c8b-88ec-8067cee779ce', // Red Chilli 100 g, cs 48
  turmeric: '4fd944a0-d08a-70fd-98b0-019171facedd', // Turmeric 100 g, cs 48
  sugar: '203569a1-a344-775e-ba4a-5984fda4d2fa', // Sugar 1 kg, cs 20
  atta: '954d6f48-5a19-7d32-842f-66d604d8acf2', // Atta 1 kg, cs 10 — seeded "₹15 off per case on 2+"
  makhana: '58afb7ca-da10-7dec-a6c3-791732c66266', // Too Yumm Makhana 20 g, cs 90 — seeded Too Yumm 2 % cash discount
  // 12 %
  bhujia42: '357c1c5e-1023-7303-bbd6-2fa65c89cc12', // Konkan Aloo Bhujia 42 g, cs 96
  butter: '4dd6ed7f-f57b-7119-bf78-900af511f02f', // Table Butter 100 g, cs 48
  bhujia200: '1ce9637c-763c-73d4-be1a-98ec7ff5ae36', // Konkan Aloo Bhujia 200 g, cs 36
  ghee500: '7df1cb3d-63e5-74e6-98eb-2c64a7d758c9', // Godavari Cow Ghee 500 ml, cs 12 — seeded 6 % EXCLUSIVE, valid to TODAY
  // 18 %
  glucose: 'af45e021-a167-7d3f-a8f0-60ab037214cb', // Glucose, cs 120
  biscuit: '7243fd13-a429-763a-bed2-ce21243bd12c', // biscuit, cs 120
  marie: '3cb5e1c4-c6b4-70ec-9af7-17287907a43a', // Marie, cs 60
  soap: '8549cf4f-2489-772a-9691-7eeda70e8bdc', // Sandal soap, cs 72
  sachet: 'a6a052c0-8c17-7bd1-9db3-e4a40b58f94a', // shampoo sachet, cs 480
  glucose32: 'c67a8c31-c125-7d98-9010-8277027eff37', // Glucose 32 g, cs 144
  // 28 % + 12 % cess
  campa750: 'f71bf137-50de-7182-a0d9-c83f1a613a57', // Campa Cola 750 ml, cs 24
  campa200: '2f5b8e5c-5f83-74b4-9e05-f6f0e6ad0d98', // Campa 200 ml, cs 48
  campa1l: 'f086f3e3-3697-7439-98d9-f20c231c110a', // Campa 1 L, cs 24 — seeded "3 % off on 5+ cases" (to 10-02)
  rajwadi: '04c20c58-f9fd-7c12-b121-8208c35bfd98', // Rajwadi soda, cs 48 — seeded 5 % on 4+ cases ENDED YESTERDAY, 1.5 % cash discount
}
export const BRAND_SUNBAKE = 'a4ebffdb-e802-75e9-9614-d605563a9e65' // glucose, biscuit, marie, glucose32

const REG = { gstin: true }
const OUT = { stateCode: '24', gstin: true, city: 'Surat', pincode: '395003' }
const OUT_URP = { stateCode: '24', gstin: false, city: 'Surat', pincode: '395003' }
const URP = { gstin: false }

const t = L.today()
const yday = L.addDays(t, -1)
const tmrw = L.addDays(t, 1)

/** scheme economics shorthand; applicability is filled in with the case's shop */
const pct = (variantIds, bps, extra = {}) => ({ scope: { variantIds }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'pcs', rewardKind: 'line_pct', rewardValue: bps, ...extra })

/**
 * case = { id, area, title, shop: { tier, ...terms }, lines: [{ v, qty, unit }], schemes: [...], overrides: [{ v, rate, final, validFrom, validTo }],
 *          bargains: [{ v, ask, decide: 'approve'|'reject'|null, approvedRate, scope: 'order'|'shop' }], who, hold, deliveryDate }
 */
export const CASES = [
  // ---------------- base tier price
  { id: 'B01', area: 'base tier price', title: 'tier B, 18 % + 5 %, loose pieces', shop: { tier: 'B', ...REG }, lines: [{ v: V.glucose, qty: 7 }, { v: V.masala, qty: 3 }] },
  { id: 'B02', area: 'base tier price', title: 'tier A, 12 % one case + 0 % loose', shop: { tier: 'A', ...REG }, lines: [{ v: V.butter, qty: 1, unit: 'case' }, { v: V.dahi, qty: 13 }] },
  { id: 'B03', area: 'base tier price', title: 'tier C unregistered, 0 % + 28 % cess', shop: { tier: 'C', ...URP }, lines: [{ v: V.salt, qty: 25 }, { v: V.campa200, qty: 17 }] },
  { id: 'B04', area: 'base tier price', title: 'tier B, all five rates in one bill', shop: { tier: 'B', ...REG }, lines: [{ v: V.dahi, qty: 5 }, { v: V.turmeric, qty: 11 }, { v: V.bhujia42, qty: 97 }, { v: V.glucose32, qty: 145 }, { v: V.campa750, qty: 23 }] },
  { id: 'B05', area: 'base tier price', title: 'tier B, cases only', shop: { tier: 'B', ...REG }, lines: [{ v: V.biscuit, qty: 2, unit: 'case' }, { v: V.chilli, qty: 1, unit: 'case' }] },
  { id: 'B06', area: 'base tier price', title: 'tier A, sachet 1 case + 1 piece', shop: { tier: 'A', ...REG }, lines: [{ v: V.sachet, qty: 481 }] },

  // ---------------- shop overrides
  { id: 'O01', area: 'override', title: 'non-final override below tier, no scheme', shop: { tier: 'B', ...REG }, overrides: [{ v: V.soap, rate: 2799, final: false }], lines: [{ v: V.soap, qty: 10 }] },
  { id: 'O02', area: 'override', title: 'FINAL override + a 5 % scheme on the item (final blocks it)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.soap, rate: 2799, final: true }], schemes: [pct([V.soap], 500, { name: 'QA P8 O02 soap 5%' })], lines: [{ v: V.soap, qty: 10 }] },
  { id: 'O03', area: 'override', title: 'non-final override + a 5 % scheme (stacks on the override rate)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.soap, rate: 2799, final: false }], schemes: [pct([V.soap], 500, { name: 'QA P8 O03 soap 5%' })], lines: [{ v: V.soap, qty: 10 }] },
  { id: 'O04', area: 'override', title: 'override ABOVE the tier price', shop: { tier: 'B', ...REG }, overrides: [{ v: V.soap, rate: 3000, final: false }], lines: [{ v: V.soap, qty: 9 }] },
  { id: 'O05', area: 'override', title: 'FINAL override line + bill-level 2 % on ₹100+ (final line takes no share)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.soap, rate: 2799, final: true }], schemes: [{ name: 'QA P8 O05 bill 2%', scope: { all: true }, triggerKind: 'value', triggerMin: 10000, triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 200 }], lines: [{ v: V.soap, qty: 10 }, { v: V.marie, qty: 13 }] },
  { id: 'O06', area: 'override', title: 'override expired yesterday and one starting tomorrow (tier applies)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.soap, rate: 2500, final: false, validFrom: L.addDays(t, -10), validTo: yday }, { v: V.marie, rate: 2000, final: false, validFrom: tmrw }], lines: [{ v: V.soap, qty: 4 }, { v: V.marie, qty: 4 }] },
  { id: 'O07', area: 'override', title: 'FINAL override + approved bargain on the same item', shop: { tier: 'B', ...REG }, overrides: [{ v: V.marie, rate: 2200, final: true }], bargains: [{ v: V.marie, ask: 2150, decide: 'approve' }], lines: [{ v: V.marie, qty: 20 }] },
  { id: 'O08', area: 'override', title: 'tier C shop, non-final override on a 12 % item', shop: { tier: 'C', ...REG }, overrides: [{ v: V.bhujia200, rate: 3333, final: false }], lines: [{ v: V.bhujia200, qty: 7 }] },

  // ---------------- quantity slabs at the boundary
  ...[119, 120, 121].map((q, i) => ({ id: `S0${i + 1}`, area: 'slab boundary', title: `3 % on 2+ cases (cs 60): ${q} pcs`, shop: { tier: 'B', ...REG }, schemes: [pct([V.marie], 300, { name: `QA P8 S0${i + 1} marie 3% 2cs`, triggerMin: 2, triggerUnit: 'case' })], lines: [{ v: V.marie, qty: q }] })),
  ...[95, 96, 97, 191, 192, 193].map((q, i) => ({ id: `S${String(i + 4).padStart(2, '0')}`, area: 'slab boundary', title: `slabs 2 cs → 2 %, 4 cs → 4 % (cs 48): ${q} pcs`, shop: { tier: 'B', ...REG }, schemes: [pct([V.chilli], 200, { name: `QA P8 S${i + 4} chilli slabs`, triggerMin: 2, triggerUnit: 'case', slabs: [{ min: 2, value: 200 }, { min: 4, value: 400 }] })], lines: [{ v: V.chilli, qty: q }] })),
  ...[11, 12, 13, 24, 25].map((q, i) => ({ id: `S${i + 10}`, area: 'slab boundary', title: `12 + 1 free (pcs): ${q} pcs`, shop: { tier: 'B', ...REG }, schemes: [{ name: `QA P8 S${i + 10} 12+1`, scope: { variantIds: [V.glucose32] }, triggerKind: 'qty', triggerMin: 12, triggerUnit: 'pcs', rewardKind: 'free_qty', rewardValue: 1 }], lines: [{ v: V.glucose32, qty: q }] })),
  { id: 'S15', area: 'slab boundary', title: '5 % on a line worth ₹500+: ₹481.60 (under)', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 S15 5% on 500', scope: { variantIds: [V.bhujia200] }, triggerKind: 'value', triggerMin: 50000, triggerUnit: 'inr', rewardKind: 'line_pct', rewardValue: 500 }], lines: [{ v: V.bhujia200, qty: 14 }] },
  { id: 'S16', area: 'slab boundary', title: '5 % on a line worth ₹500+: exactly ₹500.00 (override 25.00 × 20)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.turmeric, rate: 2500, final: false }], schemes: [{ name: 'QA P8 S16 5% on 500', scope: { variantIds: [V.turmeric] }, triggerKind: 'value', triggerMin: 50000, triggerUnit: 'inr', rewardKind: 'line_pct', rewardValue: 500 }], lines: [{ v: V.turmeric, qty: 20 }] },
  { id: 'S17', area: 'slab boundary', title: '5 % on a line worth ₹500+: ₹475.00 (one piece under)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.turmeric, rate: 2500, final: false }], schemes: [{ name: 'QA P8 S17 5% on 500', scope: { variantIds: [V.turmeric] }, triggerKind: 'value', triggerMin: 50000, triggerUnit: 'inr', rewardKind: 'line_pct', rewardValue: 500 }], lines: [{ v: V.turmeric, qty: 19 }] },

  // ---------------- percentage and flat schemes
  { id: 'P01', area: 'percentage / flat', title: '7.5 % on 37 pcs (odd paise)', shop: { tier: 'B', ...REG }, schemes: [pct([V.glucose], 750, { name: 'QA P8 P01 7.5%' })], lines: [{ v: V.glucose, qty: 37 }] },
  { id: 'P02', area: 'percentage / flat', title: '₹10 off per 3 pcs (net_scheme_amount, repeats): 10 pcs', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 P02 ₹10 per 3', scope: { variantIds: [V.sugar] }, triggerKind: 'qty', triggerMin: 3, triggerUnit: 'pcs', rewardKind: 'net_scheme_amount', rewardValue: 1000 }], lines: [{ v: V.sugar, qty: 10 }] },
  { id: 'P03', area: 'percentage / flat', title: '₹2.50 off every case on 2+ (per_unit_amount): 3 cs + 5 pcs', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 P03 ₹2.50 per case', scope: { variantIds: [V.bhujia42] }, triggerKind: 'qty', triggerMin: 2, triggerUnit: 'case', rewardKind: 'per_unit_amount', rewardValue: 250 }], lines: [{ v: V.bhujia42, qty: 293 }] },
  { id: 'P04', area: 'percentage / flat', title: '37 paise off every piece on 3+ (per_unit_amount): 5 pcs and 2 pcs', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 P04 37p per pc', scope: { variantIds: [V.soap, V.marie] }, triggerKind: 'qty', triggerMin: 3, triggerUnit: 'pcs', rewardKind: 'per_unit_amount', rewardValue: 37 }], lines: [{ v: V.soap, qty: 5 }, { v: V.marie, qty: 2 }] },
  { id: 'P05', area: 'percentage / flat', title: 'per-case slabs 2 cs → ₹10, 5 cs → ₹15 a case: 5 cases', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 P05 per-case slabs', scope: { variantIds: [V.salt] }, triggerKind: 'qty', triggerMin: 2, triggerUnit: 'case', slabs: [{ min: 2, value: 1000 }, { min: 5, value: 1500 }], rewardKind: 'per_unit_amount', rewardValue: 1000 }], lines: [{ v: V.salt, qty: 5, unit: 'case' }] },
  { id: 'P06', area: 'percentage / flat', title: 'flat slab once: 1 cs → ₹50, 3 cs → ₹200: 3 cases', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 P06 flat slabs', scope: { variantIds: [V.masala] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'case', slabs: [{ min: 1, value: 5000 }, { min: 3, value: 20000 }], rewardKind: 'net_scheme_amount', rewardValue: 5000 }], lines: [{ v: V.masala, qty: 3, unit: 'case' }] },

  // ---------------- free goods
  { id: 'F01', area: 'free goods', title: 'buy 10 get 1 (same item, repeats): 25 pcs', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 F01 10+1', scope: { variantIds: [V.biscuit] }, triggerKind: 'qty', triggerMin: 10, triggerUnit: 'pcs', rewardKind: 'free_qty', rewardValue: 1 }], lines: [{ v: V.biscuit, qty: 25 }] },
  { id: 'F02', area: 'free goods', title: 'buy 2 cases butter get 3 dahi (other item): 4 cases', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 F02 butter→dahi', scope: { variantIds: [V.butter] }, triggerKind: 'qty', triggerMin: 2, triggerUnit: 'case', rewardKind: 'free_qty', rewardValue: 3, freeVariantId: V.dahi }], lines: [{ v: V.butter, qty: 4, unit: 'case' }] },
  { id: 'F03', area: 'free goods', title: 'slab free goods: 1 cs → 2 same, 3 cs → 5 salt: 3 cases', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 F03 slab free', scope: { variantIds: [V.turmeric] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'case', slabs: [{ min: 1, value: 2 }, { min: 3, value: 5, freeVariantId: V.salt }], rewardKind: 'free_qty', rewardValue: 2 }], lines: [{ v: V.turmeric, qty: 144 }] },
  { id: 'F04', area: 'free goods', title: 'free 12+1 AND 5 % on the same line', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 F04 12+1', scope: { variantIds: [V.glucose] }, triggerKind: 'qty', triggerMin: 12, triggerUnit: 'pcs', rewardKind: 'free_qty', rewardValue: 1 }, pct([V.glucose], 500, { name: 'QA P8 F04 5%' })], lines: [{ v: V.glucose, qty: 120 }] },
  { id: 'F05', area: 'free goods', title: 'gstOnFreeGoods = true: 1 cs glucose 32 g → 2 Campa 200 ml free', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 F05 gst on free', scope: { variantIds: [V.glucose32] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'case', rewardKind: 'free_qty', rewardValue: 2, freeVariantId: V.campa200, gstOnFreeGoods: true }], lines: [{ v: V.glucose32, qty: 144 }] },
  { id: 'F06', area: 'free goods', title: 'free dahi AND dahi also bought on the same bill', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 F06 butter→dahi', scope: { variantIds: [V.butter] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'case', rewardKind: 'free_qty', rewardValue: 3, freeVariantId: V.dahi }], lines: [{ v: V.butter, qty: 1, unit: 'case' }, { v: V.dahi, qty: 10 }] },
  { id: 'F07', area: 'free goods', title: 'inter-state: buy 10 get 1 (IGST)', shop: { tier: 'B', ...OUT }, schemes: [{ name: 'QA P8 F07 10+1', scope: { variantIds: [V.biscuit] }, triggerKind: 'qty', triggerMin: 10, triggerUnit: 'pcs', rewardKind: 'free_qty', rewardValue: 1 }], lines: [{ v: V.biscuit, qty: 33 }] },

  // ---------------- exclusive schemes
  { id: 'X01', area: 'exclusive', title: 'exclusive 10 % vs stackable 3 % + 2 % (exclusive worth more)', shop: { tier: 'B', ...REG }, schemes: [pct([V.bhujia200], 300, { name: 'QA P8 X01 3%' }), pct([V.bhujia200], 200, { name: 'QA P8 X01 2%' }), pct([V.bhujia200], 1000, { name: 'QA P8 X01 excl 10%', stackable: false })], lines: [{ v: V.bhujia200, qty: 23 }] },
  { id: 'X02', area: 'exclusive', title: 'exclusive 4 % vs stackable 3 % + 2 % (stack worth more)', shop: { tier: 'B', ...REG }, schemes: [pct([V.bhujia200], 300, { name: 'QA P8 X02 3%' }), pct([V.bhujia200], 200, { name: 'QA P8 X02 2%' }), pct([V.bhujia200], 400, { name: 'QA P8 X02 excl 4%', stackable: false })], lines: [{ v: V.bhujia200, qty: 23 }] },
  { id: 'X03', area: 'exclusive', title: 'FINAL scheme 10 % + an approved bargain (final blocks the bargain)', shop: { tier: 'B', ...REG }, schemes: [pct([V.marie], 1000, { name: 'QA P8 X03 final 10%', stackable: false, final: true })], bargains: [{ v: V.marie, ask: 2200, decide: 'approve' }], lines: [{ v: V.marie, qty: 30 }] },
  { id: 'X04', area: 'exclusive', title: 'exclusive 10 % line + bill-level 2 % (DOS-219: "on its own")', shop: { tier: 'B', ...REG }, schemes: [pct([V.bhujia200], 1000, { name: 'QA P8 X04 excl 10%', stackable: false }), { name: 'QA P8 X04 bill 2%', scope: { all: true }, triggerKind: 'value', triggerMin: 10000, triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 200 }], lines: [{ v: V.bhujia200, qty: 23 }, { v: V.masala, qty: 5 }] },
  { id: 'X05', area: 'exclusive', title: 'seeded Godavari Ghee 6 % EXCLUSIVE valid to TODAY', shop: { tier: 'B', ...REG }, lines: [{ v: V.ghee500, qty: 12 }, { v: V.dahi, qty: 30 }] },
  { id: 'X06', area: 'exclusive', title: 'exclusive 5 % vs stackable 5 % (tie keeps the stack)', shop: { tier: 'B', ...REG }, schemes: [pct([V.bhujia200], 500, { name: 'QA P8 X06 stack 5%' }), pct([V.bhujia200], 500, { name: 'QA P8 X06 excl 5%', stackable: false })], lines: [{ v: V.bhujia200, qty: 11 }] },

  // ---------------- stacked percentages
  { id: 'K01', area: 'stacked', title: '7.5 % then 2.5 % compounding, 53 pcs', shop: { tier: 'B', ...REG }, schemes: [pct([V.glucose], 750, { name: 'QA P8 K01 7.5%' }), pct([V.glucose], 250, { name: 'QA P8 K01 2.5%' })], lines: [{ v: V.glucose, qty: 53 }] },
  { id: 'K02', area: 'stacked', title: '5 % then 10 paise a piece, 77 pcs', shop: { tier: 'B', ...REG }, schemes: [pct([V.chilli], 500, { name: 'QA P8 K02 5%' }), { name: 'QA P8 K02 10p per pc', scope: { variantIds: [V.chilli] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'pcs', rewardKind: 'per_unit_amount', rewardValue: 10 }], lines: [{ v: V.chilli, qty: 77 }] },
  { id: 'K03', area: 'stacked', title: '2 % + 3 % + 1 % on a 28 % + cess item, 41 pcs', shop: { tier: 'B', ...REG }, schemes: [pct([V.campa750], 200, { name: 'QA P8 K03 2%' }), pct([V.campa750], 300, { name: 'QA P8 K03 3%' }), pct([V.campa750], 100, { name: 'QA P8 K03 1%' })], lines: [{ v: V.campa750, qty: 41 }] },
  { id: 'K04', area: 'stacked', title: 'seeded UHT 2 % on 3+ cases + own 1.5 %, 3 cases', shop: { tier: 'B', ...REG }, schemes: [pct([V.uht], 150, { name: 'QA P8 K04 1.5%' })], lines: [{ v: V.uht, qty: 3, unit: 'case' }] },

  // ---------------- order-level (bill) schemes, largest remainder
  { id: 'L01', area: 'order-level', title: '3.33 % on bills ₹500+, five awkward lines', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 L01 3.33%', scope: { all: true }, triggerKind: 'value', triggerMin: 50000, triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 333 }], lines: [{ v: V.glucose, qty: 7 }, { v: V.soap, qty: 13 }, { v: V.marie, qty: 17 }, { v: V.bhujia42, qty: 3 }, { v: V.campa750, qty: 11 }] },
  { id: 'L02', area: 'order-level', title: 'bill threshold EXACTLY the bill (₹ gross = triggerMin)', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 L02 1.11% at exact', scope: { all: true }, triggerKind: 'value', triggerMin: 'GROSS', triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 111 }], lines: [{ v: V.glucose, qty: 9 }, { v: V.masala, qty: 2 }] },
  { id: 'L03', area: 'order-level', title: 'bill threshold one paisa ABOVE the bill (not earned)', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 L03 1.11% +1p', scope: { all: true }, triggerKind: 'value', triggerMin: 'GROSS+1', triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 111 }], lines: [{ v: V.glucose, qty: 9 }, { v: V.masala, qty: 2 }] },
  { id: 'L04', area: 'order-level', title: 'brand-scoped bill 4 % (Sunbake) with out-of-scope lines', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 L04 Sunbake 4%', scope: { brandIds: [BRAND_SUNBAKE] }, triggerKind: 'value', triggerMin: 20000, triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 400 }], lines: [{ v: V.glucose, qty: 31 }, { v: V.marie, qty: 7 }, { v: V.soap, qty: 5 }, { v: V.masala, qty: 3 }] },
  { id: 'L05', area: 'order-level', title: 'bill 2 % with an exclusive line and a final-override line', shop: { tier: 'B', ...REG }, overrides: [{ v: V.soap, rate: 2799, final: true }], schemes: [pct([V.bhujia200], 800, { name: 'QA P8 L05 excl 8%', stackable: false }), { name: 'QA P8 L05 bill 2%', scope: { all: true }, triggerKind: 'value', triggerMin: 10000, triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 200 }], lines: [{ v: V.bhujia200, qty: 9 }, { v: V.soap, qty: 6 }, { v: V.marie, qty: 11 }, { v: V.chilli, qty: 7 }] },
  { id: 'L06', area: 'order-level', title: 'mix trigger: 4 % when glucose + biscuit together reach 3 cases', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 L06 mix 4%', scope: { variantIds: [V.glucose, V.biscuit] }, triggerKind: 'mix', triggerMin: 3, triggerUnit: 'case', rewardKind: 'line_pct', rewardValue: 400 }], lines: [{ v: V.glucose, qty: 200 }, { v: V.biscuit, qty: 170 }, { v: V.masala, qty: 1 }] },
  { id: 'L09', area: 'order-level', title: 'mix trigger reached: 2 cs glucose + 1 cs biscuit = 3 cases → 4 %', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 L09 mix 4%', scope: { variantIds: [V.glucose, V.biscuit] }, triggerKind: 'mix', triggerMin: 3, triggerUnit: 'case', rewardKind: 'line_pct', rewardValue: 400 }], lines: [{ v: V.glucose, qty: 240 }, { v: V.biscuit, qty: 131 }, { v: V.masala, qty: 1 }] },
  { id: 'L07', area: 'order-level', title: 'two bill schemes 2 % + 1.5 % (compounding)', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 L07 bill 2%', scope: { all: true }, triggerKind: 'value', triggerMin: 10000, triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 200 }, { name: 'QA P8 L07 bill 1.5%', scope: { all: true }, triggerKind: 'value', triggerMin: 10000, triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 150 }], lines: [{ v: V.soap, qty: 7 }, { v: V.marie, qty: 9 }, { v: V.dahi, qty: 11 }] },
  { id: 'L08', area: 'order-level', title: 'bill 5 % on lines of three GST rates, awkward split', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 L08 bill 5%', scope: { all: true }, triggerKind: 'value', triggerMin: 1, triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 500 }], lines: [{ v: V.dahi, qty: 1 }, { v: V.turmeric, qty: 1 }, { v: V.glucose32, qty: 1 }, { v: V.campa200, qty: 1 }] },

  // ---------------- scheme validity (IST business date)
  { id: 'V01', area: 'validity', title: 'scheme valid to TODAY applies', shop: { tier: 'B', ...REG }, schemes: [pct([V.glucose], 500, { name: 'QA P8 V01 to today', validFrom: L.addDays(t, -5), validTo: t })], lines: [{ v: V.glucose, qty: 19 }] },
  { id: 'V02', area: 'validity', title: 'scheme ended YESTERDAY does not apply', shop: { tier: 'B', ...REG }, schemes: [pct([V.glucose], 500, { name: 'QA P8 V02 to yesterday', validFrom: L.addDays(t, -5), validTo: yday })], lines: [{ v: V.glucose, qty: 19 }] },
  { id: 'V03', area: 'validity', title: 'scheme starting TOMORROW does not apply', shop: { tier: 'B', ...REG }, schemes: [pct([V.glucose], 500, { name: 'QA P8 V03 from tomorrow', validFrom: tmrw, validTo: L.addDays(t, 10) })], lines: [{ v: V.glucose, qty: 19 }] },
  { id: 'V04', area: 'validity', title: 'delivery-dated scheme from tomorrow, order for delivery tomorrow', shop: { tier: 'B', ...REG }, deliveryDate: tmrw, schemes: [pct([V.glucose], 500, { name: 'QA P8 V04 delivery-dated', validFrom: tmrw, validTo: L.addDays(t, 10), pricingDateMode: 'delivery' })], lines: [{ v: V.glucose, qty: 19 }] },
  { id: 'V05', area: 'validity', title: 'seeded Rajwadi 5 % on 4+ cases ENDED yesterday; its 1.5 % cash discount runs', shop: { tier: 'B', ...REG }, lines: [{ v: V.rajwadi, qty: 4, unit: 'case' }] },
  { id: 'V06', area: 'validity', title: 'inactive scheme (active=false) inside its dates', shop: { tier: 'B', ...REG }, schemes: [pct([V.glucose], 500, { name: 'QA P8 V06 inactive', active: false })], lines: [{ v: V.glucose, qty: 19 }] },

  // ---------------- bargains
  { id: 'N01', area: 'bargain', title: 'rep asks 2 % off (inside the 3 % bound) → auto-approved', shop: { tier: 'B', ...REG }, bargains: [{ v: V.marie, ask: 2200, decide: null }], lines: [{ v: V.marie, qty: 24 }] },
  { id: 'N02', area: 'bargain', title: 'rep asks 10 % off → owner approves before the order', shop: { tier: 'B', ...REG }, bargains: [{ v: V.marie, ask: 2020, decide: 'approve' }], lines: [{ v: V.marie, qty: 24 }] },
  { id: 'N03', area: 'bargain', title: 'rep asks 10 % off on THIS order, not decided → order held; owner approves the gate', shop: { tier: 'B', ...REG }, bargains: [{ v: V.marie, ask: 2020, decide: null, scope: 'order' }], lines: [{ v: V.marie, qty: 24 }] },
  { id: 'N04', area: 'bargain', title: 'rep asks 10 % off → owner REJECTS → tier price', shop: { tier: 'B', ...REG }, bargains: [{ v: V.marie, ask: 2020, decide: 'reject' }], lines: [{ v: V.marie, qty: 24 }] },
  { id: 'N05', area: 'bargain', title: 'rep asks ₹0.01 a piece (below any floor) → owner approves', shop: { tier: 'B', ...REG }, bargains: [{ v: V.marie, ask: 1, decide: 'approve' }], lines: [{ v: V.marie, qty: 5 }] },
  { id: 'N06', area: 'bargain', title: 'bargain on a line that also has a 5 % scheme', shop: { tier: 'B', ...REG }, schemes: [pct([V.marie], 500, { name: 'QA P8 N06 5%' })], bargains: [{ v: V.marie, ask: 2100, decide: 'approve' }], lines: [{ v: V.marie, qty: 24 }] },
  { id: 'N07', area: 'bargain', title: 'owner approves at a DIFFERENT rate than asked', shop: { tier: 'B', ...REG }, bargains: [{ v: V.marie, ask: 2000, decide: 'approve', approvedRate: 2111 }], lines: [{ v: V.marie, qty: 24 }] },
  { id: 'N08', area: 'bargain', title: 'bargain on a non-final override line', shop: { tier: 'B', ...REG }, overrides: [{ v: V.marie, rate: 2200, final: false }], bargains: [{ v: V.marie, ask: 2050, decide: 'approve' }], lines: [{ v: V.marie, qty: 24 }] },
  { id: 'N09', area: 'bargain', title: 'owner approves at a rate ABOVE the tier price', shop: { tier: 'B', ...REG }, bargains: [{ v: V.marie, ask: 2000, decide: 'approve', approvedRate: 2400 }], lines: [{ v: V.marie, qty: 24 }] },

  // ---------------- cash discount
  { id: 'C01', area: 'cash discount', title: 'two brand cash-discount offers (Too Yumm 2 %, Rajwadi 1.5 %) — the better one is reported', shop: { tier: 'B', ...REG }, lines: [{ v: V.makhana, qty: 95 }, { v: V.rajwadi, qty: 60 }] },
  { id: 'C02', area: 'cash discount', title: "shop's own terms 2.5 % cash discount, no scheme", shop: { tier: 'B', ...REG, cashDiscountBps: 250, cashDiscountDays: 7 }, lines: [{ v: V.glucose, qty: 30 }] },
  { id: 'C03', area: 'cash discount', title: 'own cash-discount scheme 3 % on everything + Too Yumm 2 %', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 C03 CD 3%', scope: { all: true }, triggerKind: 'value', triggerMin: 0, triggerUnit: 'inr', rewardKind: 'cash_discount_pct', rewardValue: 300 }], lines: [{ v: V.makhana, qty: 90 }, { v: V.glucose, qty: 10 }] },

  // ---------------- GST place of supply
  { id: 'G01', area: 'GST', title: 'Gujarat registered shop, five rates → IGST', shop: { tier: 'B', ...OUT }, lines: [{ v: V.dahi, qty: 5 }, { v: V.turmeric, qty: 11 }, { v: V.bhujia42, qty: 97 }, { v: V.glucose32, qty: 145 }, { v: V.campa750, qty: 23 }] },
  { id: 'G02', area: 'GST', title: 'Gujarat UNREGISTERED shop → IGST, B2C', shop: { tier: 'B', ...OUT_URP }, lines: [{ v: V.glucose, qty: 17 }, { v: V.campa200, qty: 9 }] },
  { id: 'G03', area: 'GST', title: 'Maharashtra UNREGISTERED shop → CGST+SGST, B2C', shop: { tier: 'B', ...URP }, lines: [{ v: V.glucose, qty: 17 }, { v: V.campa200, qty: 9 }] },
  { id: 'G04', area: 'GST', title: 'Gujarat shop with a scheme + bill scheme', shop: { tier: 'B', ...OUT }, schemes: [pct([V.marie], 750, { name: 'QA P8 G04 7.5%' }), { name: 'QA P8 G04 bill 3.33%', scope: { all: true }, triggerKind: 'value', triggerMin: 10000, triggerUnit: 'inr', rewardKind: 'order_pct', rewardValue: 333 }], lines: [{ v: V.marie, qty: 13 }, { v: V.soap, qty: 7 }, { v: V.campa750, qty: 5 }] },
  { id: 'G05', area: 'GST', title: 'Gujarat shop, cess item only', shop: { tier: 'A', ...OUT }, lines: [{ v: V.campa750, qty: 37 }] },
  { id: 'G06', area: 'GST', title: 'Maharashtra registered, tier A, 12 % + 18 %', shop: { tier: 'A', ...REG }, lines: [{ v: V.butter, qty: 13 }, { v: V.sachet, qty: 77 }] },

  // ---------------- halves of a paisa
  { id: 'H01', area: 'half paisa', title: '₹10.50 × 1 at 18 % (CGST 94.5 p)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.marie, rate: 1050, final: false }], lines: [{ v: V.marie, qty: 1 }] },
  { id: 'H02', area: 'half paisa', title: '₹10.25 × 1 at 12 % (CGST 61.5 p)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.bhujia200, rate: 1025, final: false }], lines: [{ v: V.bhujia200, qty: 1 }] },
  { id: 'H03', area: 'half paisa', title: '₹10.20 × 1 at 5 % (CGST 25.5 p)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.turmeric, rate: 1020, final: false }], lines: [{ v: V.turmeric, qty: 1 }] },
  { id: 'H04', area: 'half paisa', title: '₹10.25 × 1 at 28 % + 12 % cess (CGST 143.5 p)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.campa200, rate: 1025, final: false }], lines: [{ v: V.campa200, qty: 1 }] },
  { id: 'H05', area: 'half paisa', title: '5 % scheme on ₹10.10 (50.5 p discount)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.marie, rate: 1010, final: false }], schemes: [pct([V.marie], 500, { name: 'QA P8 H05 5%' })], lines: [{ v: V.marie, qty: 1 }] },
  { id: 'H06', area: 'half paisa', title: 'four half-paisa lines in one bill (errors add up?)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.marie, rate: 1050, final: false }, { v: V.bhujia200, rate: 1025, final: false }, { v: V.turmeric, rate: 1020, final: false }, { v: V.campa200, rate: 1025, final: false }], lines: [{ v: V.marie, qty: 1 }, { v: V.bhujia200, qty: 1 }, { v: V.turmeric, qty: 1 }, { v: V.campa200, qty: 1 }] },
  { id: 'H07', area: 'half paisa', title: 'inter-state: 5 % scheme on ₹10.10 + ₹10.50 at 18 %', shop: { tier: 'B', ...OUT }, overrides: [{ v: V.marie, rate: 1010, final: false }, { v: V.soap, rate: 1050, final: false }], schemes: [pct([V.marie], 500, { name: 'QA P8 H07 5%' })], lines: [{ v: V.marie, qty: 1 }, { v: V.soap, qty: 1 }] },
  { id: 'H08', area: 'half paisa', title: 'round-off exactly 50 paise (₹10.50 at 0 %)', shop: { tier: 'B', ...REG }, overrides: [{ v: V.dahi, rate: 1050, final: false }], lines: [{ v: V.dahi, qty: 1 }] },
  { id: 'H09', area: 'half paisa', title: '7 half-paisa 18 % lines at ₹10.50 each (7 × CGST 94.5 p)', shop: { tier: 'B', ...REG }, overrides: [V.marie, V.soap, V.glucose, V.biscuit, V.glucose32, V.sachet, V.chilli].map((v) => ({ v, rate: 1050, final: false })), lines: [V.marie, V.soap, V.glucose, V.biscuit, V.glucose32, V.sachet].map((v) => ({ v, qty: 1 })) },

  // ---------------- order total vs bill total at the rupee boundary (built after the first run showed CGST/SGST drift)
  { id: 'T01', area: 'rupee boundary', title: '₹10.25 at 12 % + ₹10.01 at 0 %: order exact ₹21.49, split GST +1 p', shop: { tier: 'B', ...REG }, overrides: [{ v: V.bhujia200, rate: 1025, final: false }, { v: V.dahi, rate: 1001, final: false }], lines: [{ v: V.bhujia200, qty: 1 }, { v: V.dahi, qty: 1 }] },
  { id: 'T02', area: 'rupee boundary', title: '₹10.50 at 18 % + ₹10.10 at 0 %: order exact ₹22.49, split GST +1 p', shop: { tier: 'B', ...REG }, overrides: [{ v: V.marie, rate: 1050, final: false }, { v: V.dahi, rate: 1010, final: false }], lines: [{ v: V.marie, qty: 1 }, { v: V.dahi, qty: 1 }] },
  { id: 'T03', area: 'rupee boundary', title: '₹10.25 at 18 % + ₹10.40 at 0 %: order exact ₹22.50, split GST −1 p', shop: { tier: 'B', ...REG }, overrides: [{ v: V.soap, rate: 1025, final: false }, { v: V.dahi, rate: 1040, final: false }], lines: [{ v: V.soap, qty: 1 }, { v: V.dahi, qty: 1 }] },
  { id: 'T04', area: 'rupee boundary', title: 'six ₹10.50 18 % lines + ₹10.11 at 0 %: order exact ₹84.45, split GST +6 p', shop: { tier: 'B', ...REG }, overrides: [...[V.marie, V.soap, V.glucose, V.biscuit, V.glucose32, V.sachet].map((v) => ({ v, rate: 1050, final: false })), { v: V.dahi, rate: 1011, final: false }], lines: [...[V.marie, V.soap, V.glucose, V.biscuit, V.glucose32, V.sachet].map((v) => ({ v, qty: 1 })), { v: V.dahi, qty: 1 }] },
  { id: 'T05', area: 'rupee boundary', title: 'inter-state: ₹10.50 at 18 % + ₹10.10 at 0 % (IGST, no split)', shop: { tier: 'B', ...OUT }, overrides: [{ v: V.marie, rate: 1050, final: false }, { v: V.dahi, rate: 1010, final: false }], lines: [{ v: V.marie, qty: 1 }, { v: V.dahi, qty: 1 }] },

  // ---------------- mixed cases and loose pieces
  { id: 'M01', area: 'cases + pieces', title: 'same item on two lines, 1 case + 60 pcs, scheme on 2+ cases (per line)', shop: { tier: 'B', ...REG }, schemes: [pct([V.marie], 300, { name: 'QA P8 M01 3% 2cs', triggerMin: 2, triggerUnit: 'case' })], lines: [{ v: V.marie, qty: 1, unit: 'case' }, { v: V.marie, qty: 60 }] },
  { id: 'M02', area: 'cases + pieces', title: 'cases and pieces across five items', shop: { tier: 'B', ...REG }, lines: [{ v: V.glucose, qty: 1, unit: 'case' }, { v: V.glucose32, qty: 7 }, { v: V.bhujia42, qty: 2, unit: 'case' }, { v: V.sugar, qty: 3 }, { v: V.campa750, qty: 1, unit: 'case' }] },
  { id: 'M03', area: 'cases + pieces', title: 'seeded Atta ₹15 off per case on 2+ at 3 cases', shop: { tier: 'B', ...REG }, lines: [{ v: V.atta, qty: 3, unit: 'case' }] },
  { id: 'M04', area: 'cases + pieces', title: 'seeded Campa 1 L 3 % on 5+ cases: 4 cs + 23 pcs (under) and 5 cs', shop: { tier: 'B', ...REG }, lines: [{ v: V.campa1l, qty: 119 }] },
  { id: 'M05', area: 'cases + pieces', title: 'seeded Campa 1 L 3 % on 5+ cases: exactly 5 cases', shop: { tier: 'B', ...REG }, lines: [{ v: V.campa1l, qty: 5, unit: 'case' }] },

  // ---------------- tax edge cases
  { id: 'E01', area: 'tax edge', title: 'fully discounted line (100 % scheme) beside a paid line', shop: { tier: 'B', ...REG }, schemes: [pct([V.glucose32], 10000, { name: 'QA P8 E01 100%' })], lines: [{ v: V.glucose32, qty: 12 }, { v: V.glucose, qty: 5 }] },
  { id: 'E02', area: 'tax edge', title: 'flat ₹ off larger than the line (capped?)', shop: { tier: 'B', ...REG }, schemes: [{ name: 'QA P8 E02 ₹100 off', scope: { variantIds: [V.glucose32] }, triggerKind: 'qty', triggerMin: 1, triggerUnit: 'pcs', rewardKind: 'net_scheme_amount', rewardValue: 10000, slabs: [{ min: 1, value: 10000 }] }], lines: [{ v: V.glucose32, qty: 3 }, { v: V.glucose, qty: 5 }] },
]
