# Realistic demo dataset — implementation spec

**Scope:** rewrite the *data* of `backend/libs/database/src/seed-demo/` so the seven apps demo against a
dataset that looks like a real Kalyan FMCG distributorship. **No product-logic changes, no schema
changes, no new tables, no new migrations.** Everything below is expressed as new/changed entries in the
existing seed arrays, plus a small number of type widenings inside `seed-demo/` itself.

Written 2026-09-08 against the tree at commit `335a11c`. Baseline measured on the founder's database
(`postgres://dos:dos@127.0.0.1:5439/dos`) and by reading every file named in §4.

---

## 0. Ground rules the implementation may not break

| # | Rule | Where it comes from |
|---|---|---|
| G1 | Every row id comes from `demoId(kind, key)` / `rowIdFor()` / `guid()`. No `Math.random()`, no `Date.now()`, no `crypto.randomUUID()`, no unordered `Map`/`Set` iteration feeding an id. | `ids.ts`; the whole idempotency story |
| G2 | Every insert stays `insertMany()` (= `.onConflictDoNothing()`) or `upsertMany()`. No delete-then-insert. `pnpm db:seed` twice must add zero rows — `seed-demo.test.ts` seeds a fresh database twice and diffs `count(*)` of **every** table in `public`. | `seed-demo.test.ts` |
| G3 | Do **not** add a kind to `GLOBAL_KINDS` (`ids.ts:16-27`). Every new catalogue row reuses an existing global kind (`manufacturer`, `brand`, `product`, `variant`, `pack`, `external-code`, `alias`, `hsn-rate`); every new tenant row reuses an existing scoped kind. | ADR 0005 |
| G4 | Ids that already exist must not change. The 29 existing variants, 6 brands, 5 manufacturers, 17 products and their packs keep their exact keys and field values — `/docs` examples, `pnpm smoke` and several specs quote them. **New rows are appended to the arrays, never inserted in the middle.** | `catalog.ts`, `backend/libs/core/src/service/examples.ts` |
| G5 | An existing row's *columns* cannot be changed by a re-seed (`onConflictDoNothing`). Therefore: never mark an **existing** variant `discontinued`, never re-tier an existing shop. All new status values live on **new** rows. | G2 |
| G6 | RNG streams are positional. A new draw goes on a **new named stream** (`makeRng('dos-demo:<new-name>')`) or is **appended** after every existing draw in that stream — never spliced in front. | `sales.ts` short-pick comment |
| G7 | The seed runs on the owner/BYPASSRLS connection with no `withTenant()`. Every new `SELECT` must carry its own `eq(table.tenantId, tenantId)`. | `index.ts` header |
| G8 | `numbering_series.next_no` only ever moves forward (`GREATEST`). Any new numbered document must call the file's `bumpSeries()` / `advanceSeries()`. | migration 0013 `dos_numbering_series_guard` |
| G9 | `closed` is **not** produced. `OrdersService` implements no `close` event (`FULFILMENT_TARGET` in `orders.service.ts:104-111` has no `close`), so a `closed` order can never be reached by any app action. The current seed writes 141 of them; they all become `delivered` / `partially_delivered`. | `orders.service.ts` |
| G10 | Total `pnpm db:seed` wall clock on a **fresh** database ≤ 180 s. Measured baseline on the warm founder DB today: **8.0 s**. | founder requirement |
| G11 | `journal_lines` per entry sum to zero; `receivables.assertBooksTie()` must still pass; `stock_balances` must stay `>= 0`. | `receivables.ts:930`, `schema/inventory.ts:150-173` |

---

## 1. Target counts per tenant

`TODAY` stays pinned at **2026-09-04** (`util.ts:5`). "Live window" = the last 21 calendar days; "history"
= the rest of the 90.

### 1.1 Global (curated, shared by all three tenants — seeded once, unscoped ids)

| Table | Now | Target | Notes |
|---|---:|---:|---|
| `manufacturers` | 5 | **11** | +6 fictional (§2.1) |
| `brands` | 6 | **13** | +7 |
| `products` | 17 | **86** | 83 active, 2 `proposed`, 1 `discontinued` |
| `product_variants` | 29 | **174** | **169 active + 3 `discontinued` + 2 `proposed`** → the "150+ SKUs" target |
| `product_packs` | 62 | **392** | piece+case ×174 = 348, plus 44 `inner` (Too Yumm 4, Sunbake 24, Konkan Crunch 15, Neelam shampoo sachet 1) |
| `hsn_rates` | 5 | **32** | GST slabs 0 / 5 / 12 / 18 / 28+12 cess (§2.2) |
| `product_aliases` | 7 | **27** | supplier-invoice spellings for docint |
| `product_external_codes` | 5 | **12** | FieldAssist item codes (Too Yumm + Sunbake) |
| `product_proposals` | 0 | **3** | tenant-scoped; pilot only: 1 `open`, 1 `accepted`, 1 `rejected` |

### 1.2 Per tenant

| Metric | **tarsun** (pilot, large) | **sai-distributors** (medium) | **kalyan-agencies** (small) |
|---|---:|---:|---:|
| depth | `full` | `core` | `core` |
| brands listed | 13 (all) | 8 | 4 |
| `tenant_products` | **174** (171 `listed`) | **86** | **51** |
| `tenant_product_costs` | 174 | 86 | 51 |
| `suppliers` | 11 | 7 | 4 |
| `supplier_pack_configs` | 46 | 28 | 19 |
| `price_lists` | 4 (Default, A, B, C) | 4 | 3 (no C) |
| `price_list_items` | 696 | 344 | 153 |
| `schemes` | **16** | 10 | 6 |
| `retailer_price_overrides` | **9** (2 `final`) | 3 | 2 |
| `bargain_requests` | **10** (2 per status) | 5 | 5 |
| `cash_discount_conditions` | ~40 | ~18 | ~10 |
| beats | **6** | 5 | 3 |
| `retailers` | **60** | 40 | 24 |
| shops shared with another distributor | 11 given away | 11 taken (10 from tarsun + 1 from kalyan) | 5 taken from tarsun |
| `retailer_identities` linked | 22 | 18 | 10 |
| staff users | **20** | 14 | 12 |
| retailer-app users | 2 | 2 | 2 |
| `stock_lots` | **≈ 330** | ≈ 150 | ≈ 88 |
| supplier invoices + GRNs | **14** | 8 | 5 |
| order days (working days back) | **90 cal ≈ 77 wd** | 60 cal ≈ 51 wd | 45 cal ≈ 39 wd |
| `sales_orders` | **≈ 310** | ≈ 175 | ≈ 120 |
| `invoices` | ≈ 270 (+9 opening +4 special) | ≈ 150 | ≈ 100 |
| `credit_notes` | ≈ 18 | ≈ 9 | ≈ 6 |
| `receipts` | ≈ 210 | ≈ 115 | ≈ 80 |
| `trips` | ≈ 60 | ≈ 34 | ≈ 24 |
| `approvals` | **≈ 24** (all 3 statuses × 3 kinds + trip settlements) | ≈ 10 | ≈ 8 |
| `ageing_snapshots` | 60 shops × 14 dates | 40 × 14 | 24 × 14 |

Row-count multiplier over today: catalogue ≈ **6×**, orders ≈ **4×**, shops ≈ **1.7×**. That is the
budget §5 is sized against.

---

## 2. The data

Everything in §2 is **fictional** except the four brands the founder asked to keep (Campa, Too Yumm,
Balaji, MOM Makhana) and their real manufacturers, which are unchanged. All shop names, shopkeeper
names, phones, GSTINs, invoice numbers and amounts are invented; no real retailer or invoice data is
used anywhere.

### 2.1 Manufacturers and brands

| # | manufacturer key | Name (legal) | New? | brand keys |
|---|---|---|---|---|
| 1 | `reliance` | Reliance Consumer Products Ltd | keep | `campa`, `independence` |
| 2 | `guiltfree` | Guiltfree Industries Pvt Ltd | keep | `tooyumm` |
| 3 | `balajiwafers` | Balaji Wafers Pvt Ltd | keep | `balaji` |
| 4 | `mommakhana` | MOM Foods Pvt Ltd | keep | `mommakhana` |
| 5 | `alansfoods` | Alan's Food Products Pvt Ltd | keep | `mastioye` |
| 6 | `rajwadi` | Rajwadi Beverages Pvt Ltd, Nashik | **new** | `rajwadi` |
| 7 | `sunrisebakers` | Sunrise Bakers Pvt Ltd, Pune | **new** | `sunbake` |
| 8 | `konkansnack` | Konkan Snack Company, Ratnagiri | **new** | `konkancrunch` |
| 9 | `annapurnaagro` | Annapurna Agro Foods Ltd, Kalyan | **new** | `annapurna` |
| 10 | `godavaridairy` | Godavari Dairy Products Ltd, Ahmednagar | **new** | `godavari` |
| 11 | `shubhda` | Shubhda Consumer Care Pvt Ltd, Vapi | **new** | `neelam`, `chamak` |

FSSAI licences follow the existing 14-digit shape (`1001504300xxxx`); websites are `https://www.<brand>.in`.

### 2.2 HSN / GST table (`HSN_RATES`, 32 rows)

| HSN | description | gstBps | cessBps | used by |
|---|---|---:|---:|---|
| 2202 | Aerated waters with added sugar | 2800 | 1200 | Campa, Rajwadi sodas, energy drink *(existing row)* |
| 2202 | Packaged drinking water | 1800 | 0 | Independence *(existing row)* |
| 2202 | Fruit pulp / fruit juice based drinks | **1200** | 0 | Rajwadi mango, apple nectar, flavoured milk |
| 2201 | Soda water, waters not sweetened | 1800 | 0 | Rajwadi Soda Water |
| 1905 | Extruded / expanded savoury snacks | 1800 | 0 | Too Yumm, Masti Oye *(existing)* |
| 1905 | Biscuits, sweet | 1800 | 0 | Sunbake — same rate, own row for the description |
| 2106 | Namkeen, bhujia, wafers, mixture | 1800 | 0 | Balaji *(existing)* |
| 2106 | Namkeen, pre-packed and labelled | **1200** | 0 | Konkan Crunch |
| 2008 | Roasted makhana | 500 | 0 | MOM, Too Yumm makhana *(existing)* |
| 1101 | Wheat flour, pre-packed | 500 | 0 | Annapurna atta |
| 1006 | Rice, pre-packed | 500 | 0 | Annapurna rice |
| 1103 | Cereal groats / meal (rava) | 500 | 0 | Annapurna rava |
| 1106 | Flour of dried leguminous vegetables (besan) | 500 | 0 | Annapurna besan |
| 1904 | Prepared cereals (poha) | 500 | 0 | Annapurna poha |
| 0713 | Dried leguminous vegetables (dals) | 500 | 0 | Annapurna dals |
| 1701 | Cane / beet sugar | 500 | 0 | Annapurna sugar |
| 1508 | Groundnut oil | 500 | 0 | Annapurna groundnut oil |
| 1512 | Sunflower oil | 500 | 0 | Annapurna sunflower oil |
| 0910 | Spices, ground, pre-packed | 500 | 0 | Annapurna masalas |
| **2501** | **Common salt, iodised** | **0** | 0 | Annapurna salt |
| **0401** | **Milk, UHT** | **0** | 0 | Godavari milk |
| **0403** | **Buttermilk, curd** | **0** | 0 | Godavari chaas, dahi |
| 0402 | Milk powder / dairy whitener | 500 | 0 | Godavari whitener |
| 0406 | Paneer, pre-packed | 500 | 0 | Godavari paneer |
| 0406 | Processed cheese | 1200 | 0 | Godavari cheese slices, shrikhand |
| 0405 | Butter and ghee | 1200 | 0 | Godavari butter, ghee |
| 3401 | Soap, organic surface-active bars | 1800 | 0 | Neelam soaps, handwash; Chamak bars |
| 3402 | Organic surface-active preparations | 1800 | 0 | Chamak powders, gels, glass cleaner |
| 3304 | Beauty / skin-care preparations | 1800 | 0 | Neelam talc, cold cream |
| 3305 | Preparations for use on the hair | 1800 | 0 | Neelam shampoo, hair oil |
| 3306 | Oral / dental hygiene preparations | 1800 | 0 | Neelam toothpaste |
| 3808 | Disinfectants | 1800 | 0 | Chamak floor / toilet cleaner, phenyl |
| 9603 | Brushes (tooth brushes) | 1800 | 0 | Neelam tooth brush |

`effectiveFrom` stays `'2017-07-01'` for every row.

### 2.3 Catalogue — products, variants, packs, MRPs

Existing 17 products / 29 variants unchanged. New entries below; `case` = pieces per case
(`defaultCaseSize`), `MRP` in rupees (write `mrpPaise` = rupees × 100), `SL` = `shelfLifeDays`.

**`rajwadi` — Rajwadi (category `Beverages`), 6 products / 13 variants**

| product | variants (name · case · MRP) | HSN | GST |
|---|---|---|---|
| Rajwadi Jeera Masala Soda | 250 ml ·48· ₹15 · 500 ml ·24· ₹30 · 1.25 L ·12· ₹60 | 2202 | 28 + 12 cess |
| Rajwadi Lemon Soda | 250 ml ·48· ₹15 · 500 ml ·24· ₹30 · 1.25 L ·12· ₹60 | 2202 | 28 + 12 cess |
| Rajwadi Aamras Mango Drink | 200 ml ·27· ₹12 · 600 ml ·24· ₹40 · 1 L ·12· ₹70 | 2202 | 12 |
| Rajwadi Apple Nectar | 200 ml ·27· ₹15 **(discontinued)** · 1 L ·12· ₹80 | 2202 | 12 |
| Rajwadi Josh Energy Drink | 250 ml ·24· ₹50 | 2202 | 28 + 12 cess |
| Rajwadi Soda Water | 750 ml ·24· ₹20 | 2201 | 18 |

SL: sodas 270, fruit drinks 180, soda water 365.

**`sunbake` — Sunbake (category `Biscuits`), 10 products / 24 variants, HSN 1905, GST 18, SL 240**

| product | variants |
|---|---|
| Sunbake Glucose | 32 g ·144· ₹5 · 55 g ·120· ₹10 · 110 g ·72· ₹20 · 250 g ·48· ₹45 |
| Sunbake Marie Light | 75 g ·96· ₹15 · 150 g ·60· ₹30 · 300 g ·36· ₹55 |
| Sunbake Bourbon Cream | 60 g ·96· ₹10 · 120 g ·60· ₹20 · 300 g ·30· ₹50 |
| Sunbake Orange Cream | 60 g ·96· ₹10 **(discontinued)** · 120 g ·60· ₹20 |
| Sunbake Elaichi Cream | 60 g ·96· ₹10 · 120 g ·60· ₹20 |
| Sunbake Digestive Hi-Fibre | 100 g ·72· ₹30 · 250 g ·36· ₹70 |
| Sunbake Butter Cookies | 75 g ·72· ₹20 · 200 g ·36· ₹50 |
| Sunbake Kaju Pista Cookies | 75 g ·72· ₹25 · 200 g ·36· ₹60 |
| Sunbake Salted Cracker | 60 g ·96· ₹10 · 200 g ·36· ₹40 |
| Sunbake Choco Chip Cookies | 40 g ·120· ₹10 · 120 g ·48· ₹30 |

Every Sunbake variant also gets an `inner` pack of 12.

**`konkancrunch` — Konkan Crunch (category `Snacks - Namkeen`), 6 products / 14 variants (+1 proposed), HSN 2106, GST 12, SL 120**

| product | variants |
|---|---|
| Konkan Kerala Banana Chips | 40 g ·72· ₹20 · 150 g ·36· ₹60 · 400 g ·20· ₹150 |
| Konkan Bhajani Chivda | 100 g ·48· ₹35 · 400 g ·20· ₹120 |
| Konkan Farsan Mix | 100 g ·48· ₹35 · 400 g ·20· ₹120 |
| Konkan Aloo Bhujia | 42 g ·96· ₹10 · 200 g ·36· ₹45 · 400 g ·20· ₹85 |
| Konkan Masala Khakhra | 180 g ·30· ₹50 · 360 g ·20· ₹95 |
| Konkan Roasted Peanut Masala | 40 g ·96· ₹10 · 150 g ·36· ₹40 |
| **Konkan Ratlami Sev (proposed)** | 180 g ·36· ₹45 — `status = 'proposed'`, `proposedByTenantId` = pilot |

Every Konkan variant also gets an `inner` pack of 6.

**`annapurna` — Annapurna (category `Packaged Food`), 15 products / 31 variants, SL 270 (oils 180, masalas 365)**

| product | variants | HSN | GST |
|---|---|---|---|
| Annapurna Chakki Fresh Atta | 1 kg ·10· ₹55 · 5 kg ·5· ₹255 · 10 kg ·3· ₹495 | 1101 | 5 |
| Annapurna Kolam Rice | 1 kg ·12· ₹68 · 5 kg ·5· ₹330 · 25 kg ·1· ₹1590 | 1006 | 5 |
| Annapurna Basmati Classic | 1 kg ·12· ₹135 · 5 kg ·4· ₹650 | 1006 | 5 |
| Annapurna Toor Dal | 500 g ·20· ₹95 · 1 kg ·12· ₹185 | 0713 | 5 |
| Annapurna Chana Dal | 500 g ·20· ₹55 · 1 kg ·12· ₹105 | 0713 | 5 |
| Annapurna Besan | 500 g ·20· ₹60 · 1 kg ·12· ₹115 | 1106 | 5 |
| Annapurna Thick Poha | 500 g ·20· ₹35 · 1 kg ·12· ₹65 | 1904 | 5 |
| Annapurna Bombay Rava | 500 g ·20· ₹28 · 1 kg ·12· ₹52 | 1103 | 5 |
| **Annapurna Iodised Salt** | 1 kg ·24· ₹28 | 2501 | **0** |
| Annapurna Sulphurless Sugar | 1 kg ·20· ₹48 · 5 kg ·5· ₹235 | 1701 | 5 |
| Annapurna Sunflower Refined Oil | 1 L pouch ·12· ₹135 · 5 L jar ·4· ₹660 | 1512 | 5 |
| Annapurna Filtered Groundnut Oil | 1 L ·12· ₹210 · 5 L ·4· ₹1035 | 1508 | 5 |
| Annapurna Turmeric Powder | 100 g ·48· ₹32 · 500 g ·20· ₹150 | 0910 | 5 |
| Annapurna Red Chilli Powder | 100 g ·48· ₹45 · 500 g ·20· ₹210 | 0910 | 5 |
| Annapurna Garam Masala | 50 g ·72· ₹45 · 100 g ·48· ₹85 | 0910 | 5 |

**`godavari` — Godavari (category `Dairy`), 12 products / 22 variants (+1 proposed)**

| product | variants | HSN | GST | SL |
|---|---|---|---|---:|
| Godavari Toned UHT Milk | 500 ml ·24· ₹32 · 1 L ·12· ₹62 | 0401 | **0** | 120 |
| Godavari Full Cream UHT Milk | 500 ml ·24· ₹37 · 1 L ·12· ₹72 | 0401 | **0** | 120 |
| Godavari Flavoured Milk Rose | 180 ml ·27· ₹25 | 2202 | 12 | 120 |
| Godavari Flavoured Milk Kesar Badam | 180 ml ·27· ₹25 | 2202 | 12 | 120 |
| Godavari Flavoured Milk Chocolate | 180 ml ·27· ₹25 | 2202 | 12 | 120 |
| Godavari Masala Chaas | 200 ml ·30· ₹12 · 1 L ·12· ₹55 | 0403 | **0** | 21 |
| Godavari Dahi | 200 g ·30· ₹22 · 400 g ·20· ₹42 · 1 kg ·8· ₹95 | 0403 | **0** | 21 |
| Godavari Fresh Paneer | 200 g ·24· ₹95 · 500 g ·12· ₹225 | 0406 | 5 | 15 |
| Godavari Table Butter | 100 g ·48· ₹58 · 500 g ·20· ₹280 | 0405 | 12 | 180 |
| Godavari Cow Ghee | 200 ml ·24· ₹165 · 500 ml ·12· ₹395 · 1 L ·8· ₹770 | 0405 | 12 | 365 |
| Godavari Cheese Slices | 200 g ·24· ₹145 | 0406 | 12 | 180 |
| Godavari Dairy Whitener | 200 g ·36· ₹115 · 500 g ·20· ₹275 | 0402 | 5 | 270 |
| **Godavari Kesar Shrikhand (proposed)** | 200 g ·24· ₹65 | 0406 | 12 | 30 |

The short shelf lives (15–21 d) are deliberate: they are what makes near-expiry and expired lots (§2.7)
land naturally rather than by fiat.

**`neelam` — Neelam (category `Personal Care`), 10 products / 22 variants, GST 18, SL 730**

| product | variants | HSN |
|---|---|---|
| Neelam Sandal Soap | 100 g ·72· ₹42 · 3×100 g pack ·24· ₹120 | 3401 |
| Neelam Rose Soap | 100 g ·72· ₹42 · 3×100 g pack ·24· ₹120 | 3401 |
| Neelam Neem Soap | 100 g ·72· ₹38 | 3401 |
| Neelam Anti-Dandruff Shampoo | 5 ml sachet ·480· ₹2 *(also gets an `inner` of 16)* · 175 ml ·24· ₹110 · 340 ml ·18· ₹199 | 3305 |
| Neelam Coconut Hair Oil | 100 ml ·48· ₹48 · 200 ml ·36· ₹90 · 500 ml ·20· ₹210 | 3305 |
| Neelam Herbal Toothpaste | 50 g ·96· ₹35 · 100 g ·72· ₹62 · 200 g ·36· ₹115 | 3306 |
| Neelam Tooth Brush | single ·144· ₹25 · 2+1 pack ·48· ₹50 | 9603 |
| Neelam Prickly Heat Talc | 100 g ·48· ₹65 · 300 g ·24· ₹165 | 3304 |
| Neelam Handwash | 200 ml pump ·24· ₹75 · 750 ml refill ·12· ₹165 | 3401 |
| Neelam Cold Cream | 30 g ·72· ₹45 · 50 g ·48· ₹70 | 3304 |

**`chamak` — Chamak (category `Household`), 8 products / 17 variants, GST 18, SL 730**

| product | variants | HSN |
|---|---|---|
| Chamak Detergent Powder | 500 g ·24· ₹55 · 1 kg ·12· ₹105 · 4 kg ·4· ₹399 | 3402 |
| Chamak Detergent Bar | 125 g ·72· ₹10 · 250 g ·48· ₹20 | 3401 |
| Chamak Dishwash Bar | 145 g ·60· ₹15 · 300 g ·36· ₹30 | 3401 |
| Chamak Dishwash Gel | 225 ml ·36· ₹45 · 750 ml ·12· ₹129 | 3402 |
| Chamak Floor Cleaner | 500 ml ·24· ₹85 · 1 L ·12· ₹155 · 2 L ·6· ₹285 | 3808 |
| Chamak Toilet Cleaner | 500 ml ·24· ₹89 · 1 L ·12· ₹165 | 3808 |
| Chamak White Phenyl | 1 L ·12· ₹75 · 5 L ·4· ₹330 | 3808 |
| **Chamak Glass Cleaner** *(product + its only variant `discontinued`)* | 500 ml ·24· ₹95 | 3402 |

**The three discontinued variants** (`status: 'discontinued'`) are: `rajwadi-apple-nectar-200ml`,
`sunbake-orange-cream-60g`, `chamak-glass-cleaner-500ml`. All three are **new** rows, per rule G5, so a
re-seed of the founder's existing database picks them up correctly.

### 2.4 Which brands each tenant carries (`brandKeys`)

| tenant | brandKeys | variants in overlay |
|---|---|---:|
| tarsun | all 13 | 174 |
| sai-distributors | `campa, independence, tooyumm, balaji, mommakhana, sunbake, konkancrunch, godavari` | 86 |
| kalyan-agencies | `campa, independence, balaji, annapurna` | 51 |

The `listed()` / `stocked()` filters in `tenant-catalog.ts:69-72` and the `listedBrandIds` filter in
`pricing.ts:306-309` already derive suppliers, brands, return policies, costs and schemes from this one
lever — no other change is needed to scale the two smaller tenants.

`tenant_products.listed` is `false` for the three discontinued variants and `true` for the two proposed
ones (ADR 0005: a distributor may use its own proposal immediately).

### 2.5 Pricing

**Price lists (4):** `Default` (`isDefault`), `Tier A`, `Tier B`, **`Tier C`** (new, `tier: 'C'`).
Rates keep the existing model — `baseRate()` = 86 % of ex-tax MRP — with `aPaise = base × 0.98`,
`bPaise = base × 0.99`, **`cPaise = base × 0.995`**. `rateForRetailer()` in `sales.ts:120-129` gains the
`C` branch; tier `D` keeps the default list.

**Quantity slabs:** `price_list_items` has **no** quantity column (`schema/pricing.ts:72-96`), so slab
pricing is expressed **only** through `schemes.slabs` (jsonb `{min, value}[]`), which the engine already
reads. Do not invent a slab column.

**Schemes (16 for the pilot).** Existing 6 unchanged; 10 appended.

| # | key | brand | trigger | reward | valid | flags |
|---|---|---|---|---|---|---|
| 1 | `campa-750-12-plus-1` *(existing)* | campa | qty ≥ 12 case | free 1 case | −21 d → +9 d | stackable |
| 2 | `balaji-5pct-5-cases` *(existing)* | balaji | qty ≥ 5 case | line 5 % | −21 d → +9 d | stackable |
| 3 | `order-2pct-5000` *(existing)* | — | value ≥ ₹5 000 | order 2 % | −21 d → +9 d | order-level |
| 4 | `too-yumm-cash-discount` *(existing)* | tooyumm | value ≥ 0 | cash discount 2 % | −21 d → +60 d | reported, not deducted |
| 5 | `mom-makhana-slab` *(existing)* | mommakhana | qty ≥ 5 case, slabs 5→2 %, 10→4 % | line % | −21 d → +9 d | slabs |
| 6 | `balaji-monsoon-bonanza-expired` *(existing)* | balaji | qty ≥ 10 case | free 1 case | −95 d → **−35 d** | **already expired** |
| 7 | `sunbake-glucose-10-plus-1` | sunbake | qty ≥ 10 case (Glucose 110 g/250 g) | free 1 case of Glucose 110 g | −45 d → +12 d | stackable |
| 8 | `sunbake-cream-slab` | sunbake | qty ≥ 3 case, slabs 3→3 %, 6→5 %, 12→8 % | line % | −30 d → **+2 d (expires on a boundary — the day after tomorrow)** | slabs, `pricingDateMode: 'order'` |
| 9 | `annapurna-atta-flat-per-case` | annapurna | qty ≥ 5 case | `flat_amount` ₹40 per case | −60 d → +25 d | claimable |
| 10 | `godavari-ghee-exclusive` | godavari | qty ≥ 2 case | line 6 % | −14 d → +16 d | **`final: true`, `stackable: false` — the exclusive scheme** |
| 11 | `neelam-soap-3-plus-1-pcs` | neelam | qty ≥ 36 pcs | free 12 pcs | −20 d → +10 d | `rewardUnit: 'pcs'`, `gstOnFreeGoods: true` |
| 12 | `chamak-order-3pct-10000` | chamak | value ≥ ₹10 000 | order 3 % | −20 d → +10 d | order-level, `fundingSource: 'distributor'` |
| 13 | `konkan-launch-10pct` | konkancrunch | value ≥ 0 | line 10 % | −7 d → +7 d | launch offer, `priority: 15` |
| 14 | `rajwadi-soda-cash-discount` | rajwadi | value ≥ 0 | cash discount 1.5 % | −30 d → +45 d | cash-discount condition |
| 15 | `campa-2l-festive-expired` | campa | qty ≥ 20 case | free 2 case | −120 d → **−60 d** | second expired scheme |
| 16 | `annapurna-oil-scheme-inactive` | annapurna | qty ≥ 4 case | line 4 % | −10 d → +20 d | **`active: false`** — withdrawn mid-flight |

Ordering matters: `priority` values keep the documented `priority, id` stacking (`5` cash discount, `10`
free-goods, `15` launch, `20` line %, `30` order %). The `final` scheme (#10) must be the only rule that
applies to a Godavari ghee line — the verifier asserts it (§5, I-14).

**Retailer price overrides (9, of which 2 `final`).** Selected **by archetype**, not by array index
(see the risk in §4.5):

| # | shop archetype | variant | rate | `final` | note |
|---|---|---|---|---|---|
| 1 | `high_volume` | Campa Cola 750 ml | 96 % of default | no | "Long-standing account, negotiated in person." |
| 2 | `supermarket` | Campa Orange 750 ml | 97 % | no | |
| 3 | `high_volume` | Balaji Ratlami Sev 200 g | 94 % | **yes** | "Final rate; schemes do not stack." |
| 4 | `supermarket` | Annapurna Chakki Atta 10 kg | 95 % | **yes** | staple loss-leader |
| 5 | `grocery_medium` #1 | Sunbake Glucose 250 g | 97 % | no | |
| 6 | `grocery_medium` #2 | Godavari Cow Ghee 1 L | 98 % | no | |
| 7 | `credit_near_limit` | Chamak Detergent Powder 1 kg | 96 % | no | |
| 8 | `cash_only` | Neelam Sandal Soap 100 g | 95 % | no | cash-and-carry rate |
| 9 | `kirana_small` #3 | Konkan Aloo Bhujia 200 g | 98 % | no | expired 30 d ago (`validTo` set) |

**Bargain requests (10 for the pilot):** two rows for each of the five `bargain_status` values
(`requested`, `auto_approved`, `approved`, `rejected`, `expired`), on five different shops and three
different variants (Campa Cola 750 ml, Sunbake Marie 300 g, Godavari Ghee 500 ml). Of the `requested`
pair, **both are today's** and both carry a matching `approvals` row of kind `bargain`, status `pending`
— that is what makes the owner app's approval queue non-empty on the live day.

**Cash-discount condition:** every invoice of a shop whose `cashDiscountBps > 0` gets a
`cash_discount_conditions` row (`discountBps` = the shop's, `payBy` = invoice date + `cashDiscountDays`).
Statuses: most `open` while `payBy >= TODAY`, `expired` where the window passed unpaid, and
**at least 3 `realised`** pointing at the receipt that earned them.

### 2.6 Retailers — archetypes

Replace the flat `TIER_PATTERN` with a named archetype per shop. `RetailerNetwork` gains
`archetypePattern: readonly ArchetypeKey[]` (length must equal `names.length`); the old
`TIER_PATTERN`-derived behaviour becomes the archetype `kirana_small` / `grocery_medium` etc., so no
shop's *shape* changes silently.

| archetype | tier | credit limit | credit days | mode | terms | cash disc. | `active` | link status | GST reg. | intended outstanding |
|---|---|---:|---:|---|---|---|---|---|---|---|
| `kirana_small` | C | ₹25 000 | 7 | `strict` | POST | — | true | active | unregistered | 0-7 bucket, small |
| `grocery_medium` | B | ₹50 000 | 14 | `indicate` | POST | 2 % / 7 d | true | active | regular | 0-7 + 8-15 |
| `supermarket` | A | ₹1 50 000 | 21 | `indicate` | POST | 2 % / 7 d | true | active | regular | 8-15 + 16-30 |
| `high_volume` | A | ₹2 50 000 | 21 | `indicate` | POST | 2.5 % / 7 d | true | active | regular | 16-30, large |
| `cash_only` | D | ₹0 | 0 | `stop` | `ON` | — | true | active | unregistered | none — pays at delivery |
| `prepaid` | D | ₹0 | 0 | `stop` | `PRE` | — | true | active | unregistered | none |
| `new_shop` | C | ₹10 000 | 7 | `strict` | POST | — | true | active | unregistered | **none — no history at all** |
| `credit_near_limit` | B | ₹50 000 | 14 | `indicate` | POST | 2 % / 7 d | true | active | regular | **≈ 92 % of limit** |
| `overdue_mild` | C | ₹25 000 | 7 | `strict` | POST | — | true | active | unregistered | 16-30 + 31-60 |
| `overdue_hard` | B | ₹50 000 | 14 | `stop` | POST | — | true | active | regular | 31-60 + 61-90 |
| `bad_debt` | C | ₹25 000 | 7 | `stop` | POST | — | true | active | unregistered | 90+ only |
| `blocked_link` | C | ₹25 000 | 7 | `stop` | POST | — | true | **`blocked`** | unregistered | 31-60, frozen |
| `closed_shop` | D | ₹10 000 | 0 | `stop` | `ON` | — | **false** | active | unregistered | small 90+ residue |

**Pilot network (`TARSUN_NETWORK`): 6 beats × 10 shops = 60.** Beats: the existing four
(`station-road`, `kalyan-west-market`, `khadakpada`, `godrej-hill`) plus **`kolsewadi`** (visit days 2,5)
and **`birla-college-road`** (visit days 4,6). The existing 36 names keep their positions 0-35 (rule G4:
their `demoId('retailer', code)` must not move); 24 new names are appended:

> Sai Krupa Super Bazar · Rukmini Provision · Gavhane Kirana · Shubhalabh Stores ·
> Trimurti General Store · Vaibhav Kirana Mart · Anand Bhavan Provision · Sujata Stores ·
> Hariom Kirana Bhandar · Prerna Super Market · Mangal Traders · Dnyandeep Stores ·
> Shantai Provision Store · Nakshatra Kirana · Rameshwar General Store · Karve Provision ·
> Sahyadri Super Bazar · Nutan Kirana Stores · Ashirwad Provision · Meghana General Store ·
> Kolsewadi Corner Store · Birla Road Kirana Mart · Gurukrupa Provision · Vasudha Stores

Archetype pattern for the 60 (10 per beat, repeated with two hand-placed exceptions):

```
beat 0  Station Road          kirana_small, grocery_medium, kirana_small, supermarket, kirana_small,
                              overdue_mild, grocery_medium, cash_only, kirana_small, high_volume
beat 1  Kalyan West Market    grocery_medium, kirana_small, credit_near_limit, kirana_small, grocery_medium,
                              supermarket, kirana_small, overdue_hard, kirana_small, grocery_medium
beat 2  Khadakpada            kirana_small, kirana_small, grocery_medium, kirana_small, bad_debt,
                              kirana_small, grocery_medium, kirana_small, prepaid, kirana_small
beat 3  Godrej Hill           supermarket, kirana_small, grocery_medium, kirana_small, kirana_small,
                              blocked_link, kirana_small, grocery_medium, kirana_small, overdue_mild
beat 4  Kolsewadi             kirana_small, grocery_medium, kirana_small, new_shop, kirana_small,
                              cash_only, kirana_small, grocery_medium, closed_shop, kirana_small
beat 5  Birla College Road    grocery_medium, kirana_small, high_volume, kirana_small, new_shop,
                              kirana_small, overdue_hard, kirana_small, grocery_medium, bad_debt
```

Counts: 30 `kirana_small`, 12 `grocery_medium`, 3 `supermarket`, 2 `high_volume`, 2 `cash_only`,
1 `prepaid`, 2 `new_shop`, 1 `credit_near_limit`, 2 `overdue_mild`, 2 `overdue_hard`, 2 `bad_debt`,
1 `blocked_link`, 1 `closed_shop` = 60.

`registeredIndices` becomes derived: every shop whose archetype's *GST reg.* column says `regular`
(≈ 22 shops). **This must be computed from the archetype pattern, never re-listed by hand**, or a later
edit will silently change the tax basis of invoices already written (`retailers.ts:88-99` comment).

`linkedIndices` (shops on the retailer app) = 22: indices 0-9 (the shared ones), plus the two
`supermarket`s, the two `high_volume`s, the `credit_near_limit`, both `new_shop`s, both `overdue_hard`s
and 3 more `grocery_medium`s. `appLoginIndices` stays `[0, 9]`.

**Sai (`SAI_NETWORK`): 5 beats × 8 = 40.** Existing 32 names keep positions 0-31; 8 appended
(Kopar Road / Thakurli area). New beat `kopar-road` (visit days 2,6). Archetype mix skews mid-market:
14 `kirana_small`, 12 `grocery_medium`, 4 `supermarket`, 1 `high_volume`, 2 `cash_only`, 1 `new_shop`,
1 `credit_near_limit`, 2 `overdue_mild`, 2 `overdue_hard`, 1 `bad_debt`.

**Kalyan (`KALYAN_NETWORK`): 3 beats × 8 = 24.** Keep the first 24 of the existing 32 names and the
first three beats; drop `shahad` (its 8 shops move out of the list). Mix: 16 `kirana_small`,
4 `grocery_medium`, 1 `supermarket`, 1 `cash_only`, 1 `new_shop`, 1 `overdue_hard`.

> **Shrinking Kalyan from 32 to 24 shops is exactly what breaks `pricing.ts`'s hard-coded
> `nth(retailers, 29)`.** §4.5 makes the index→archetype replacement mandatory, not optional.

**Shops on more than one distributor's books.** Keep `sharesPilotShops` for Sai `{0..9 → 0..9}` and
Kalyan `{0..4 → 0..4}`, and add:

- Sai index 12 → pilot index 41 (`Prerna Super Market`, a `supermarket` both distributors serve).
- Kalyan index 9 → **Sai** index 14 — a second `sharedShopsFrom()` call sourced from
  `buildRetailerRows(SAI_NETWORK)` rather than the pilot's rows, so one shop is shared between the two
  non-pilot tenants. `retailer_identities.phone` is globally unique, which is the whole mechanism; Sai
  must therefore seed before Kalyan (it already does — `EXTRA_TENANTS` order).

Result: 1 shop on **three** distributors' books (index 0, Ramesh Gupta's), 10 on two via the pilot,
1 on two via Sai. `ramesh.gupta` keeps three memberships; `fatima.shaikh` keeps two.

### 2.7 Staff

`PeopleRoster`'s tuple arity is load-bearing — `sales.ts`, `delivery.ts`, `warehouse.ts`,
`incentives.ts` destructure `people.salespeople.rahul`, `people.delivery.ganesh` etc. by name. So the
**required slots stay exactly as they are** and the roster gains one optional field:

```ts
/** Extra staff beyond the slots the downstream seeds address by name. Users + memberships only. */
extra?: readonly (PersonSpec & { role: 'owner'|'manager'|'accountant'|'salesperson'|'warehouse'|'delivery' })[]
```

`seedPeople` appends them to the `users`, `memberships` and `backfillCredentials` batches and returns
them as `PeopleResult.extra`. Nothing downstream has to change.

**Tarsun — 20 staff (12 existing + 8 new). Every existing sign-in below is unchanged.**

| role | name | username | status |
|---|---|---|---|
| owner | Sunil Tarsun | `sunil.tarsun` | **existing — must keep working** |
| owner | Anil Tarsun | `anil.tarsun` | new (partner) |
| manager | Vikas Kadam | `vikas.kadam` | **existing** |
| manager | Snehal Rane | `snehal.rane` | new |
| accountant | Meena Joshi | `meena.joshi` | **existing** |
| accountant | Amol Vaidya | `amol.vaidya` | new |
| salesperson | Rahul Deshmukh | `rahul.deshmukh` | **existing** |
| salesperson | Amit Pawar | `amit.pawar` | existing |
| salesperson | Pooja Shinde | `pooja.shinde` | existing (Too Yumm only, manufacturer-employed) |
| salesperson | Sandeep Mane | `sandeep.mane` | new |
| salesperson | Ruksana Shaikh | `ruksana.shaikh` | new |
| warehouse | Dinesh Patil | `dinesh.patil` | **existing** |
| warehouse | Kavita Sawant | `kavita.sawant` | existing |
| warehouse | Prashant Gawde | `prashant.gawde` | new |
| delivery | Ganesh More | `ganesh.more` | **existing** |
| delivery | Raju Yadav | `raju.yadav` | existing |
| delivery | Santosh Kamble | `santosh.kamble` | existing |
| delivery | Iqbal Shaikh | `iqbal.shaikh` | existing |
| delivery | Tanaji Bhosale | `tanaji.bhosale` | new |
| delivery | Mahesh Sutar | `mahesh.sutar` | new |
| retailer | Ramesh Gupta | `ramesh.gupta` | **existing** |
| retailer | Fatima Shaikh | `fatima.shaikh` | existing |

New phones continue the existing blocks: managers `+91981000000x`, reps `+9198100000 1x`,
delivery `+9198100000 2x`, warehouse `+9198100000 3x` — pick the next free number in each block.
Password for all: `Dos@1234`. `dos.admin` (platform console) is untouched.

**Sai — 14 staff:** existing 12 + `pallavi.more` (salesperson) + `arif.qureshi` (delivery).
**Kalyan — 12 staff:** unchanged.

Beat assignments must cover the new beats: Rahul takes beats 0-2, Amit 3-5, Sandeep 0/4, Ruksana 2/5,
Pooja rides all six (unchanged rule: `half = ceil(beats/2)` still works, plus explicit rows for the two
new reps).

### 2.8 Stock

`stock.ts` gains a **lot profile** per variant, chosen deterministically by the variant's index within
its brand so the mix is stable and reviewable:

| profile | share | lots | opening qty | expiry | purpose |
|---|---:|---|---|---|---|
| `float` | 1 variant (`campa-cola-750ml`) | 3 | **400 cases** total | fresh | the one SKU with a large float |
| `fast` | 18 | 3 | 3 + 6 + 10 cases | mfg −90 / −20 / −3 d | FEFO has something to choose |
| `normal` | ~110 | 2 | 5 + 5 cases | mfg −45 / −10 d | the bulk |
| `near_expiry` | 10 | 2 | 4 cases + **2 cases expiring in 8-28 d** | `expiryDate` in `TODAY+8 … TODAY+28` | near-expiry report, claims |
| `expired` | 5 | 2 | 4 cases + **1 case already expired** | `expiryDate` in `TODAY−20 … TODAY−4` | expiry claim, blocked from sale |
| `low` | 12 | 1 | **< 1 case** (e.g. 7 pieces) | fresh | low-stock alert |
| `zero` | 8 | 1 | opened at 2 cases, then fully issued out | fresh | zero-stock / out-of-stock screens |
| `damaged` | 6 (overlaps other profiles) | — | a `damage` out+in pair moving 1 case to the Damaged bin | — | damaged-stock screen, claims |

Rules the implementation must honour:

- `zero` is produced with an **opening row then a matching negative `damage`/`adjustment` row**, never a
  zero-quantity ledger row (`stock_ledger` has `CHECK qty_delta <> 0`).
- The short-shelf-life dairy SKUs (paneer 15 d, dahi/chaas 21 d) are the natural `near_expiry` and
  `expired` picks — set their `mfgDate` so the expiry falls where the profile says, rather than writing
  an expiry that contradicts `shelfLifeDays`.
- Never let a lot go negative: `warehouse.ts` already clamps with `Math.min(wanted, onHand)`, but the
  **opening + GRN quantity must scale with the order volume** (§2.9) or vans will silently under-load.
  Rule of thumb from the current data: opening pieces per variant ≥ 3 × the 90-day sold pieces of that
  variant. Implement it as a second pass: seed stock, run the sales generator's quantity plan, and if a
  variant's planned demand exceeds 40 % of its opening + GRN quantity, raise the newest lot's opening
  cases. (Deterministic — same inputs, same result.)

**Suppliers (11) and supplier invoices / GRNs (14 for the pilot).**

| supplier key | name | state | brands supplied |
|---|---|---|---|
| `reliance` *(existing)* | Reliance Consumer Products — Kalyan Depot | 27 | campa, independence |
| `guruKripa` *(existing)* | Guru Kripa Agencies (Balaji Super-Stockist) | 27 | balaji |
| `momMakhana` *(existing)* | MOM Foods — Bikaner | 08 | mommakhana |
| `guiltfree` *(existing)* | Guiltfree Industries — Ahmedabad | 06 | tooyumm |
| `alansFoods` *(existing)* | Alan's Food Products — Bhiwandi | 27 | mastioye |
| `rajwadiDepot` | Rajwadi Beverages — Bhiwandi Depot | 27 | rajwadi |
| `sunriseStockist` | Shree Sai Marketing (Sunbake Super-Stockist) | 27 | sunbake |
| `konkanAgency` | Konkan Traders, Ratnagiri | 27 | konkancrunch |
| `annapurnaMill` | Annapurna Agro — Kalyan Mill Depot | 27 | annapurna |
| `godavariDairy` | Godavari Dairy — Ahmednagar Chilling Centre | 27 | godavari |
| `shubhdaDist` | Shubhda Consumer Care — Vapi Works | **24** | neelam, chamak |

14 supplier invoices spread over the 90 days (one per supplier in the last 21 days, plus three older
ones from Reliance / Guru Kripa / Annapurna at −38, −55 and −72 days), each with 3-6 lines. Keep the two
existing discrepancies (Reliance Campa Cola 1 case short; Guru Kripa Ratlami Sev 1 case damaged) and add
two more: a **Godavari paneer line rejected at the gate for temperature** (`inbound_discrepancies`,
short) and an **Annapurna atta line 2 bags excess** (excess). One invoice (`shubhdaDist`) is interstate
(state 24) so IGST is exercised — `splitGst()` already handles it.

### 2.9 Orders — 90 days, every reachable state

`SeedDemoOptions` gains `historyDays?: number` (default 90). `seedSales` replaces
`workingDaysBack(14)` with `workingDaysBack(historyDays)` and applies the table below. **`closed` is
never written** (rule G9).

| age (days before TODAY = 2026-09-04) | orders / working day | state mix |
|---|---:|---|
| 0 — **today, the live day** | 10 | 3 `draft`, 2 `submitted` (both blocked on a pending approval), 2 `confirmed`, 2 `picking` (one open picklist, no pack confirmation), 1 `packed` |
| 1 | 7 | 4 `dispatched`, 2 `packed`, 1 `cancelled` (cancelled at `confirmed`) |
| 2-6 | 7 | 68 % `delivered`, 15 % `partially_delivered`, 10 % `dispatched`, 4 % `cancelled`, 3 % `packed` |
| 7-20 | 6 | 84 % `delivered`, 12 % `partially_delivered`, 4 % `cancelled` |
| 21-89 | 3 | 88 % `delivered`, 9 % `partially_delivered`, 3 % `cancelled` |

Approximate pilot totals: 10 + 7 + 35 + 84 + ~180 ≈ **316 orders**, of which ~2 `picking`,
~7 `packed`, ~9 `dispatched`, ~250 `delivered`, ~30 `partially_delivered`, ~12 `cancelled`,
3 `draft`, 2 `submitted`. Sai runs the same table over 60 days, Kalyan over 45.

Sources stay as they are (`salesperson` ~75 %, `van_sale` ~10 %, `retailer_app` ~10 % for the two
app-enabled shops) plus a new 5 % on `phone` and `whatsapp` (both already in the `order_source` enum) so
the order-source filter chips in the manager app have something to filter.

**`partially_delivered` is set by `seedDelivery`, not by `seedSales`:** an order whose trip stop ended
`partial` is moved `dispatched → partially_delivered` (the machine's `deliver_partial`), and a stop that
ended `failed` moves the order `dispatched → packed` (`return_undelivered`) with the failure reason on
the stop. That keeps the state and the delivery evidence consistent.

**Approvals (pilot ≈ 24 rows).** The current seed writes only 2 pending rows plus 8 trip settlements.

| kind | status | count | attached to | date |
|---|---|---:|---|---|
| `credit_limit` | `pending` | 2 | the `credit_near_limit` shop and one `overdue_hard` shop, both on today's `submitted` orders | −0 d |
| `credit_limit` | `approved` | 3 | orders on −5, −18, −40 d | decided same day by the owner |
| `credit_limit` | `rejected` | 1 | order on −12 d → **that order is `cancelled`**, `cancelReason: 'credit_limit_rejected'` | −12 d |
| `bargain` | `pending` | 2 | the two `requested` bargain rows (§2.5) | −0 d |
| `bargain` | `approved` | 2 | the two `approved` bargain rows | −3, −22 d |
| `bargain` | `rejected` | 1 | the `rejected` bargain row → order `cancelled` | −9 d |
| `bargain` | `expired` | 1 | the `expired` bargain row | −30 d |
| `below_floor` | `pending` | 1 | today's second `submitted` order (a rep sold under the floor) | −0 d |
| `below_floor` | `approved` | 2 | −7, −26 d | |
| `below_floor` | `rejected` | 1 | −15 d → order `cancelled` | |
| `trip_settlement` | `approved` | 8 *(existing)* | the variance trips `delivery.ts` already writes | |

`approvals.status = 'expired'` on the bargain row exercises the fourth enum value (the one
`OrdersService.cancelInTx` writes when an order is cancelled under an open gate).

**Invoices, credit notes, receipts.**

- Invoice is issued at `pack` — so exactly the `packed`/`dispatched`/`delivered`/`partially_delivered`
  orders have one. No invoice on `picking`, `confirmed`, `submitted`, `draft`, `cancelled`.
- **Credit notes (~18):** 9 short-delivery (from the `partially_delivered` orders), 4 returns
  (damaged/expired goods taken back), 3 rate-difference, 1 for a cancelled-after-invoice order
  (the existing `#9002` pattern), 1 financial CN realising a cash discount.
- **Receipts (~210):** modes across the whole `receipt_mode` enum — `cash` (van collections, ~45 %),
  `upi` (~30 %), `bank_transfer` (~12 %), `cheque` (~10 %: statuses `collected` in-hand ×3,
  `deposited` ×4, `bounced` ×2 with the reversal journal), `adjustment` ×2, `credit_note` ×2.
  Amount profile: ~70 % full settlement, ~18 % partial, **2 over-payments** (allocated up to the bill,
  remainder left on account), ~10 % pure `on-account` with no allocation.
  Keep the existing keying-error pair and crew-book receipts.
- **Trips (~60):** 1 `active` today (7 stops, 2 already `delivered`, 1 `arrived`, 4 `pending`),
  1 `planned` for tomorrow, the rest `settled` / `settled_with_variance` over the 90 days across
  **3 vehicles** (`tempo`, `three-wheeler`, plus a new `loader`). Failure reasons on failed stops:
  `shop_closed`, `payment_refused`, `wrong_address`, `retailer_not_available`.

**The live day must look live.** After the whole seed, TODAY carries: 3 pending approvals of three
different kinds, 2 orders in `picking` with an open picklist, 1 `active` trip mid-route, 3 draft orders
on a rep's device, 2 bargains awaiting a decision, at least one near-expiry alert and one zero-stock SKU.

### 2.10 Ageing profile (drives §5's bucket invariants)

Real orders over 90 days plus the 9 existing `OPEN/000x` opening bills give every bucket. Target
distribution of the pilot's outstanding on `TODAY`:

| bucket | shops | source |
|---|---:|---|
| 0-7 | ~22 | live-window invoices of `kirana_small` / `grocery_medium` |
| 8-15 | ~12 | `grocery_medium` / `supermarket`, 14-day terms |
| 16-30 | ~8 | `supermarket`, `high_volume`, `overdue_mild` |
| 31-60 | ~6 | `overdue_mild`, `overdue_hard`, `blocked_link` |
| 61-90 | ~4 | `overdue_hard` + `OPEN/0004`, `OPEN/0005` |
| 90+ | ~3 | `bad_debt` + `OPEN/0006`, `OPEN/0008`, `OPEN/0009` |

`new_shop` shops must appear in **zero** buckets and have zero orders, zero invoices, zero visits — that
is the archetype's whole point.

---

## 3. Determinism, idempotency and the existing test

- Every new array entry gets a **new** `demoId` key string. Never reuse a key with different content.
- `seedCatalog(db)` becomes `seedCatalog(db, opts?: { proposerTenantId?: string })`. `index.ts` passes
  `tenantId` **only when `!(opts.scope ?? '')`** (the pilot), so the two `proposed` products name the
  pilot as proposer and the other two tenants' calls are no-ops. Ids stay global.
- New RNG streams to add (never splice into an existing one):
  `dos-demo:sales:history`, `dos-demo:sales:source-mix`, `dos-demo:stock:profiles`,
  `dos-demo:receipts:mix`, `dos-demo:delivery:outcomes`.
- `seed-demo.test.ts` needs **no change**. It asserts (a) two consecutive seeds of a fresh database
  produce identical `count(*)` for every table, and (b) the AI demo shape per tenant (a draft in every
  status, ≥ 3 forecasts below 21-day cover, one unapplied route plan per plannable trip). Both survive:
  the AI seed derives from whatever sales/stock exist, and every new insert is `onConflictDoNothing` on a
  deterministic id. Run it as the last gate: `pnpm --filter @dos/db test -- src/seed-demo.test.ts`.

---

## 4. File-by-file change plan

Reuse the existing helpers everywhere; do not introduce a second way to do any of these things.

**Helpers to reuse (do not re-implement):** `insertMany` / `upsertMany` / `seriesPrefix`
(`db-helpers.ts`), `demoId` / `inDemoScope` / `currentDemoScope` (`ids.ts`), `makeRng` / `pick` /
`randInt` / `randChance` / `nth` / `jitter` / `makeGstin` / `isoDate` / `daysAgo` / `daysAhead` /
`atIstTime` / `isWorkingDay` / `workingDaysBack` / `TODAY` / `FY` (`util.ts`), `buildRetailerRows` /
`sharedShopsFrom` (`retailers.ts`), `person` / `shortKey` (`people.ts`), `brandId` (`catalog.ts`),
`bumpSeries` / `reconcileSeries` (`sales.ts`, `billing.ts`), `advanceSeries` / `postTransfers` /
`godownOnHand` (`warehouse.ts`), `paise` / `percentOf` / `splitGst` / `roundToRupee` / `allocate` /
`businessDate` (`@dos/domain`).

### 4.1 `catalog.ts` — the biggest edit, all data

- Widen `VariantDef['netUnit']` and `VariantRow['netUnit']` from `'ml' | 'g'` to the full `net_unit`
  enum (`'g' | 'kg' | 'ml' | 'l' | 'pcs'`) — the column already accepts all five.
- Add optional `status?: 'active' | 'proposed' | 'discontinued'` to `VariantDef` and `ProductDef`,
  defaulting to `active`; pass it through to the `products` / `product_variants` inserts.
- Add `proposedByTenantId` on the two proposed products (from the new `seedCatalog` option).
- Append 6 `MANUFACTURERS`, 7 `BRANDS`, 67 `PRODUCTS` (§2.1-§2.3), 27 `HSN_RATES`, 20 `ALIASES`,
  7 `product_external_codes`.
- Replace the `isTooYumm` inner-pack filter with `INNER_PACK_BRANDS = new Set(['tooyumm','sunbake','konkancrunch'])`
  plus the one Neelam sachet variant, with per-brand inner sizes (`tooyumm` 12, `sunbake` 12,
  `konkancrunch` 6, Neelam sachet 16).
- Keep the existing entries **first and byte-identical**.

### 4.2 `tenant-catalog.ts`

- **`MANUFACTURER_MARGIN_BPS` must gain all 6 new keys** — the map falls back to 1000 bps silently
  (lines 295, 307), which would give the dairy and staples businesses a wrong margin with no error.
  Suggested: `rajwadi` 1100, `sunrisebakers` 1300, `konkansnack` 1600, `annapurnaagro` 600 (staples are
  thin), `godavaridairy` 800, `shubhda` 1800.
- Extend `SupplierIds` and the `suppliers` array with the 6 new suppliers (§2.8); the `stocked()` filter
  keeps them out of tenants that do not carry the brand.
- `tenantBrands` / `returnPolicies`: one row per new brand. Dairy return policy = `expiry` window 7 d;
  staples = no returns; personal care / household = 30 d damage-only.
- `supplierPackConfigs`: extend beyond Balaji/Too Yumm to Sunbake (`_120` style codes), Annapurna
  (`CS1`/`BAG` codes) and Godavari (`CRATE` codes) — this is what makes the docint pack-size mismatch
  demo real.
- `tenantProducts.listed = false` for the three discontinued variants; `sortOrder` grouped by category.
- New: seed 3 `product_proposals` rows for the pilot (`open`, `accepted`, `rejected`) pointing at the two
  proposed products.

### 4.3 `ids.ts`, `util.ts`

- `ids.ts`: **no change**. Do not touch `GLOBAL_KINDS`.
- `util.ts`: add `pickWeighted(rng, [[weight, value], …])` and `workingDaysBetween(a, b)` — used by the
  state-mix table (§2.9) and the ageing checks. Both pure and deterministic.

### 4.4 `retailers.ts`

- Add `ArchetypeKey` and the `ARCHETYPES` record (§2.6); keep `TIER_ECONOMICS` as the derived shape.
- `RetailerNetwork` gains `archetypePattern: readonly ArchetypeKey[]`; `registeredIndices` becomes
  optional and, when absent, is derived from the pattern.
- `RetailerRow` gains `archetype: ArchetypeKey`, `active: boolean`, `linkStatus: 'active' | 'blocked'`.
- `buildRetailerRows` stays **pure and DB-free** — `tenants.ts` calls it to learn the pilot's shops.
- `seedRetailers` writes `retailers.active` from the row and `retailer_links.status` from `linkStatus`.
- Beats 5 and 6 for the pilot, beat 5 for Sai, minus one beat for Kalyan (§2.6).
- The `numbering_series` `RET` row's `nextNo = names.length + 1` still holds; it is an INSERT, so the
  numbering guard is not engaged (G8).
- **Batch the identity-claim loop.** Today `retailers.ts:363-369` runs one `UPDATE` per shared identity
  sequentially. At 22 linked shops × 3 tenants that is 60+ round trips. Replace with a single
  `UPDATE … FROM (VALUES …)` in the same shape as `people.ts`'s `backfillCredentials`.

### 4.5 `pricing.ts` — mandatory de-hardcoding

- Add a `byArchetype(retailers, key, n = 0)` helper and **replace every `nth(retailersRes.retailers, N)`**
  (currently 0/4/9 for overrides and 1/6/11/20/29 for bargains). Kalyan shrinks to 24 shops, so
  `nth(..., 29)` would throw. This is the single highest-risk edit in the whole spec.
- 4th price list (`Tier C`) and the `cPaise` rate; `rateForRetailer()` in `sales.ts` gains the `C` branch.
- Append 10 schemes (§2.5). The existing `schemeRows.filter(r => !r.brandId || listedBrandIds.has(r.brandId))`
  already scales them down per tenant for free — a scheme with no `brandId` (the order-level ones) is
  written for every tenant, which is correct.
- Overrides: 9 rows (§2.5), 2 with `final: true`; one carries a past `validTo` so an expired override is
  visible.
- Bargains: 10 rows, two per status, across 3 variants.

### 4.6 `people.ts`, `tenants.ts`

- `people.ts`: optional `extra` roster field + `PeopleResult.extra`; append to `users`,
  `memberships`, `backfillCredentials`, and give two of the new reps a `devices` row and a
  `rep_auto_approve_bounds` row. `repProductAuthorisations` for the new reps = full catalogue.
- `tenants.ts`: new `brandKeys` per profile (§2.4), the enlarged networks, the extra roster members,
  the two extra shared shops (§2.6), and a second `sharedShopsFrom()` call sourced from Sai's rows for
  the Sai↔Kalyan overlap. `DEMO_TENANT_SLUGS` in `platform-admin.ts` is unchanged (still 3 tenants).

### 4.7 `stock.ts`

- Replace `FAST_MOVERS` with the `LOT_PROFILES` map (§2.8), assigned deterministically.
- Expand `SUPPLIER_INVOICES` from 5 to 14 templates and `DAMAGED_VARIANT_KEYS` from 3 to 6.
- Add the demand-vs-opening second pass so vans never silently under-load (§2.8).
- Two new `inbound_discrepancies` (a temperature rejection, an excess).
- Everything still goes through the existing balance accumulator; ledger keys keep the
  `opening:<lotId>` / `grn:<line>` shapes so `UNIQUE(tenant_id, idempotency_key)` holds.

### 4.8 `sales.ts`

- `historyDays` option; `workingDaysBack(historyDays)`; the per-age state table (§2.9) replacing
  `finalStateFor()`.
- Delete `'closed'` from `FinalOrderState` and from `INVOICE_ELIGIBLE`; add `'picking'` and
  `'partially_delivered'` to the type (the latter only assigned later by `delivery.ts`).
- Cancellations become **approval-driven**: the three rejected approvals cancel their orders with a
  reason, plus the existing two arbitrary cancellations spread over the history.
- Source mix gains `phone` / `whatsapp` on a new RNG stream.
- Keep `bumpSeries` for `SO`/`INV`/`CN` (G8).

### 4.9 `warehouse.ts`

- Picklists for `picking` orders: status `picking`, pick lines present, **no** `pack_confirmation`
  (that is what "in the godown right now" means).
- `PACKED_STATES` / `DISPATCHED_STATES` lose `'closed'` and gain `'partially_delivered'`.
- Third vehicle key (`loader`); raise `shortsLeft` 6 → 14 and `overridesLeft` 4 → 10 to keep the same
  exception *rate* over 4× the orders.
- `advanceSeries` for `PICK` and `DC` still called once at the end.

### 4.10 `delivery.ts`, `delivery-road.ts`

- After writing stops, update the parent order: `partial` stop → `partially_delivered`,
  `failed` stop → back to `packed`. Use the same `sql` UPDATE shape as the existing paid-state update
  (`delivery.ts:833-838`) so the invoice-immutability trigger is not touched.
- Failure reason codes (§2.9); 3 vehicles; ~60 trips over the longer window.

### 4.11 `billing.ts`, `receivables.ts`

- Credit-note mix (§2.9); keep the `while` guard that stops a CN exceeding the bill's open balance.
- Receipt mode/status/amount mix (§2.9), including the two over-payments; keep `assertBooksTie()`
  exactly as it is — it is the seed's own integration test and must still pass.
- `cash_discount_conditions`: add the `realised` rows.
- Opening bills `OPEN/0001`-`0009` unchanged.

### 4.12 `reporting.ts`, `incentives.ts`, `notifications.ts`, `ai.ts`, `docint.ts`, `integrations.ts`

- `reporting.ts`: expand the approvals block from 2 rows to the table in §2.9 (all three kinds × all
  three decided statuses). `HISTORY_DAYS = 400` stays; `LIVE_WINDOW_DAYS` becomes `historyDays` so the
  backfill loop starts where the real orders stop and the two never overlap.
- `incentives.ts`: its order-state filter already lists `partially_delivered`; just drop `'closed'`
  from the `in (...)` list at line 346 so the SQL stays honest.
- `notifications.ts`, `ai.ts`, `docint.ts`, `integrations.ts`: **no data-list changes required** — all
  four derive from what the seeds above wrote. Only verify they still find what they look for after the
  catalogue grows (`docint.ts`'s `readingOf()` reads the booked supplier invoices; adding invoices is
  additive). `docint.ts` should gain 2 documents for the new suppliers so the inbox is not all
  Reliance/Guru Kripa, but that is optional (P2).

### 4.13 `index.ts`

- `SeedDemoOptions` gains `historyDays?: number`.
- Pass `{ proposerTenantId: tenantId }` to `seedCatalog` only at the root scope.
- The call **order is unchanged** — it is load-bearing (stock → sales → delivery → billing → warehouse →
  pending van sale → receivables → reporting → [full: platform-gaps → docint → integrations →
  delivery-road → claims → notifications → incentives] → ai → platform support → pilot branding).

### 4.14 New: the verifier

Add `QA/tools/seed/verify-seed.sql` (the queries in §5) and `QA/tools/seed/verify-seed.sh`:

```sh
#!/bin/sh
# Usage: QA/tools/seed/verify-seed.sh   (reads DATABASE_URL from backend/.env)
set -e
PSQL=/opt/homebrew/opt/postgresql@17/bin/psql
"$PSQL" "${DATABASE_URL:-postgres://dos:dos@127.0.0.1:5439/dos}" \
  -v ON_ERROR_STOP=1 -f "$(dirname "$0")/verify-seed.sql"
```

Every check is written as a row returning `check_name`, `expected`, `actual`, `ok boolean`. The script
ends with a query that fails loudly if any `ok` is false.

---

## 5. SQL invariants the verifier runs

Each is `ok = true` or the seed is wrong. `:tid` = a tenant id; run the whole file once per tenant plus
once globally.

**Catalogue**

- **I-1 SKU count** — `SELECT count(*) FROM product_variants` ≥ 150.
- **I-2 slabs** — `SELECT count(DISTINCT r.gst_bps) FROM hsn_rates r WHERE r.gst_bps IN (0,500,1200,1800)` = 4,
  and `count(*) FILTER (WHERE cess_bps > 0)` ≥ 1.
- **I-3 lifecycle** — `SELECT count(*) FROM product_variants WHERE status='discontinued'` ≥ 3
  AND `... WHERE status='proposed'` ≥ 2; every `proposed` product has a non-null `proposed_by_tenant_id`.
- **I-4 packs complete** — no variant is missing a `piece` or `case` pack:
  ```sql
  SELECT count(*) FROM product_variants v
   WHERE NOT EXISTS (SELECT 1 FROM product_packs p WHERE p.variant_id=v.id AND p.level='piece')
      OR NOT EXISTS (SELECT 1 FROM product_packs p WHERE p.variant_id=v.id AND p.level='case');
  ```
  must be 0. And every `case` pack has `qty_in_parent = v.default_case_size`.
- **I-5 categories** — `SELECT count(DISTINCT category) FROM products` ≥ 7, and each of
  `Beverages, Biscuits, Dairy, Household, Packaged Food, Personal Care` and a `Snacks%` category has ≥ 8 variants.
- **I-6 no orphan HSN** — every `product_variants.hsn_code` has at least one `hsn_rates` row.

**Pricing**

- **I-7 price coverage** — every listed variant has a row in the default price list:
  ```sql
  SELECT count(*) FROM tenant_products tp
    JOIN price_lists pl ON pl.tenant_id=tp.tenant_id AND pl.is_default
   WHERE tp.tenant_id=:tid AND tp.listed
     AND NOT EXISTS (SELECT 1 FROM price_list_items i
                      WHERE i.tenant_id=tp.tenant_id AND i.price_list_id=pl.id AND i.variant_id=tp.variant_id);
  ```
  must be 0.
- **I-8 tier monotonicity** — for every variant, `A rate <= B rate <= C rate <= default rate`.
- **I-9 scheme variety** — for `:tid = tarsun`: `count(*) FILTER (WHERE valid_to < current_date)` ≥ 2 (expired),
  `count(*) FILTER (WHERE final)` ≥ 1 (exclusive), `count(*) FILTER (WHERE slabs IS NOT NULL)` ≥ 2,
  `count(*) FILTER (WHERE reward_kind='free_qty')` ≥ 2,
  `count(*) FILTER (WHERE reward_kind='cash_discount_pct')` ≥ 2,
  `count(*) FILTER (WHERE reward_kind='order_pct')` ≥ 2,
  `count(*) FILTER (WHERE NOT active)` ≥ 1,
  and at least one scheme has `valid_to = current_date + 2` (the boundary expiry).
- **I-10 overrides** — ≥ 1 with `final = true`; every override's `variant_id` is listed by that tenant.
- **I-11 bargains** — all five `bargain_status` values present for tarsun; every `approved` /
  `auto_approved` row has a non-null `approved_rate_paise`; every `rejected` has a `decided_by`.
- **I-12 no dangling scheme brand** — every `schemes.brand_id` is a brand the tenant lists
  (`tenant_brands`).
- **I-13 cash discount** — ≥ 1 `cash_discount_conditions` row per status in (`open`,`expired`,`realised`);
  a `realised` row always names a `realised_receipt_id`.
- **I-14 exclusive scheme really is exclusive** — no `invoice_lines.applied_rules` array contains the
  `godavari-ghee-exclusive` scheme id together with any other scheme id:
  ```sql
  SELECT count(*) FROM invoice_lines l
   WHERE l.tenant_id=:tid
     AND l.applied_rules @> '[{"ruleId":"<scheme id>"}]'::jsonb
     AND jsonb_array_length(l.applied_rules) > 1;
  ```

**Retailers**

- **I-15 archetype coverage** — for tarsun: ≥ 1 shop each with `active=false`, with a
  `retailer_links.status='blocked'`, with `credit_mode='stop'`, with `payment_terms='PRE'`,
  with `payment_terms='ON'`, and ≥ 2 with `tier='A'`.
- **I-16 brand-new shop is genuinely new** — the `new_shop` shops have
  `0 = (SELECT count(*) FROM sales_orders WHERE retailer_id = r.id)` and no invoice, receipt or visit.
- **I-17 near the limit** — exactly 1 shop per tenant with
  `outstanding_paise BETWEEN 0.85*credit_limit_paise AND 0.99*credit_limit_paise` (join
  `retailer_outstanding_summary`), and none above its limit unless `credit_mode = 'indicate'`.
- **I-18 ageing buckets all populated** — on the latest `ageing_snapshots.as_of`, each of
  `bucket_0_7, bucket_8_15, bucket_16_30, bucket_31_60, bucket_61_90, bucket_90_plus` has
  `sum(...) > 0` across the tenant, and ≥ 2 distinct retailers contribute to each of the last three.
- **I-19 legacy roll-up holds** — `bucket_60_plus_paise = bucket_61_90_paise + bucket_90_plus_paise` on
  every `ageing_snapshots` row (a spec already asserts this; keep it true).
- **I-20 shared shops** — ≥ 1 `retailer_identities` row with 3 `retailer_links` in 3 distinct tenants,
  and ≥ 11 with 2; `retailer_identities.phone` is unique platform-wide (it is a constraint — assert the
  count of duplicate phones is 0 as a guard against a bad phone seed).
- **I-21 beats and PJP** — every retailer has a `beat_id` and exactly one `pjp` row; every beat has ≥ 1
  `beat_assignments` row.

**Staff**

- **I-22 sign-ins intact** — all of `sunil.tarsun, vikas.kadam, meena.joshi, rahul.deshmukh,
  dinesh.patil, ganesh.more, ramesh.gupta, dos.admin` exist in `users` with a non-null `password_hash`,
  `must_change_password = false`, `status='active'` and (except `dos.admin`) an `active` membership.
- **I-23 role coverage** — per tenant, `count(*) >= 2` for each of `owner, manager, accountant,
  salesperson, warehouse, delivery` in `memberships` (pilot); `>= 1` for the other two tenants.
- **I-24 no user without credentials** — `SELECT count(*) FROM users WHERE username IS NULL OR password_hash IS NULL` = 0.

**Stock**

- **I-25 ledger ↔ balances reconcile** (the most important one):
  ```sql
  SELECT count(*) FROM (
    SELECT l.lot_id, l.location_id, sum(l.qty_delta) AS ledger
      FROM stock_ledger l WHERE l.tenant_id=:tid GROUP BY 1,2
  ) x FULL JOIN stock_balances b
    ON b.lot_id=x.lot_id AND b.location_id=x.location_id AND b.tenant_id=:tid
   WHERE coalesce(x.ledger,0) <> coalesce(b.on_hand,0);
  ```
  must be 0.
- **I-26 non-negative** — `SELECT count(*) FROM stock_balances WHERE tenant_id=:tid AND on_hand < 0 AND NOT negative_allowed` = 0;
  same for `reserved < 0`.
- **I-27 ledger idempotency keys unique** — `count(*) - count(DISTINCT idempotency_key)` = 0 per tenant.
- **I-28 expiry spread** — per tenant, ≥ 3 lots with `expiry_date < current_date` (expired),
  ≥ 8 with `expiry_date BETWEEN current_date AND current_date + 30` (near expiry),
  and ≥ 50 with `expiry_date > current_date + 60`.
- **I-29 stock states** — ≥ 6 variants whose total on-hand at the godown is 0; ≥ 10 whose total is
  `> 0 AND < default_case_size` (low); ≥ 1 whose total `> 100 * default_case_size` (the float);
  ≥ 5 lots with a positive balance in the `damaged` location.
- **I-30 GRN ↔ ledger** — every `grn_lines.counted_qty_pcs > 0` has a matching `stock_ledger` row with
  `reason='grn'` and the same quantity; `count` of mismatches = 0.
- **I-31 lot uniqueness** — `UNIQUE(tenant, variant, batch, mrp)` holds (assert 0 duplicates as a guard).

**Orders, money, delivery**

- **I-32 every reachable state present, `closed` absent**:
  ```sql
  SELECT state, count(*) FROM sales_orders WHERE tenant_id=:tid GROUP BY 1;
  ```
  must contain `draft, submitted, confirmed, picking, packed, dispatched, delivered,
  partially_delivered, cancelled` each ≥ 1, and **`closed` must be 0**.
- **I-33 invoice only at pack or later** — 0 rows where an order in
  (`draft, submitted, confirmed, picking, cancelled`) has an invoice, **except** the deliberately
  cancelled-after-invoice bill, which must be exactly 1 and must carry `state='cancelled'` and a
  `cancel_reason`.
- **I-34 approvals matrix** — for tarsun, the set of `(kind, status)` pairs includes
  `(credit_limit,pending) (credit_limit,approved) (credit_limit,rejected)`,
  `(bargain,pending) (bargain,approved) (bargain,rejected) (bargain,expired)`,
  `(below_floor,pending) (below_floor,approved) (below_floor,rejected)`;
  every non-`pending` row has `decided_by` and `decided_at`.
- **I-35 rejection cancels** — every order with a `rejected` approval is `state='cancelled'` and carries
  a `cancel_reason`.
- **I-36 journals balance** — `SELECT entry_id FROM journal_lines WHERE tenant_id=:tid GROUP BY entry_id HAVING sum(amount_paise) <> 0` returns 0 rows.
- **I-37 books tie** — AR control-account balance = `sum(outstanding_paise)` in
  `retailer_outstanding_summary` (the same assertion `receivables.assertBooksTie()` makes; repeat it
  from outside so a refactor that removes the in-seed check is still caught).
- **I-38 allocations never exceed the bill** — 0 rows where
  `sum(allocations.amount_paise) > invoices.total_paise` per invoice.
- **I-39 receipt variety** — ≥ 1 receipt per `receipt_mode` value except where the tenant genuinely has
  none; statuses `collected, deposited, bounced` all present for tarsun; ≥ 1 receipt whose allocated
  total is **less** than its amount (on-account / over-payment), and ≥ 1 with zero allocations.
- **I-40 credit notes** — ≥ 1 CN per reason in (short delivery, return, rate difference); every CN's
  total ≤ the linked invoice's total; no CN on an invoice that has none.
- **I-41 trips** — ≥ 1 `active`, ≥ 1 `planned`, ≥ 1 `settled_with_variance`; every
  `settled_with_variance` trip has an `approved` `approvals` row of kind `trip_settlement`
  (the DB trigger enforces it — assert anyway); ≥ 1 stop each in `failed` and `partial`, each with a
  non-null reason.
- **I-42 delivery ↔ order agree** — every order in `partially_delivered` has a trip stop in state
  `partial`; every stop in `partial` has its order in `partially_delivered`.

**History and the live day**

- **I-43 90 days of activity** — `max(order_date) - min(order_date)` ≥ 85 days for tarsun (≥ 55 Sai,
  ≥ 40 Kalyan), and every one of the last 12 ISO weeks has ≥ 1 invoice.
- **I-44 period comparison is meaningful** — invoiced value in `[TODAY-29, TODAY]` and in
  `[TODAY-59, TODAY-30]` are both > 0 and differ by < 60 % (so "sales vs the period before" reads as
  growth, not as a cliff).
- **I-45 monthly margin is positive** — for the current month,
  `sum(invoice taxable) - sum(qty × tenant_product_costs.landed_cost)` > 0. *(This is one of the two
  known demo-data defects in `docs/23` §10 — the verifier is where it gets caught.)*
- **I-46 daily stats exist** — `daily_tenant_stats` has a row for every working day in the live window
  and its `orders_count` matches `count(*)` of that day's non-draft orders.
- **I-47 the live day looks live** — on `current_date`: ≥ 3 `approvals` with `status='pending'` across
  ≥ 2 kinds, ≥ 1 order in `picking` with an open picklist, ≥ 1 trip in `active`, ≥ 1 `draft` order,
  ≥ 2 `bargain_requests` in `requested`.
- **I-48 smoke leftovers absent** *(the other `docs/23` §10 item)* — 0 retailers whose name or code
  matches `%smoke%` / `%probe%`, 0 locations named `Smoke Probe%`, 0 orders whose `cancel_reason`
  mentions smoke. A fresh `pnpm db:seed` on a clean database must satisfy this; on the founder's
  existing database it will not until the database is dropped and re-migrated, which the check should
  report as a warning rather than a failure.

**Idempotency and runtime (run by the shell wrapper, not SQL)**

- **I-49** — `pnpm db:seed` twice in a row leaves every `count(*)` in `public` unchanged (the same check
  `seed-demo.test.ts` makes, run against the real database).
- **I-50** — total wall clock of `pnpm db:migrate && pnpm db:seed` on a freshly created database
  ≤ 180 s.

---

## 6. Runtime budget

Measured today: a warm re-seed of the founder's database is **8.0 s** (every insert conflicts). The
work this spec adds is dominated by row count, and every write is already a single batched
`INSERT … VALUES (…), (…) …`.

| phase | rows now | rows after | notes |
|---|---:|---:|---|
| global catalogue | ~125 | ~740 | one-off, 8 batched inserts |
| per-tenant catalogue + pricing | ~160 | ~950 | ×3 tenants |
| retailers + people | ~150 | ~260 | ×3; the per-identity `UPDATE` loop must be batched (§4.4) |
| stock + GRN | ~120 | ~600 | ×3 |
| orders → invoices → receipts → journal | ~1 100 | ~4 500 | ×3, the bulk of the run |
| reporting backfill | ~4 000 | ~4 000 | unchanged (`HISTORY_DAYS = 400`) |
| docint / integrations / claims / notifications / incentives | ~600 | ~800 | pilot only |

Estimated fresh-database run: **60-100 s**, against a 180 s budget. If it overshoots, the levers in
order of preference are: Sai 60 → 45 days, Kalyan 45 → 30 days, then the 21-89 day band from 3 orders
per working day to 2. Do **not** cut the catalogue — the 150+ SKU target is the founder's ask.

Three things will cost more than their row count suggests and should be watched:

1. `claims.ts` runs several awaited queries **per claim** — adding claims scales round trips linearly.
2. `reporting.ts`'s `loadOpenBills()` / `refreshOutstanding()` scan whole tenant tables unpaginated.
3. `retailers.ts`'s per-identity `UPDATE` loop (§4.4) — batch it before raising shop counts.

---

## 7. Out of scope (deliberately)

- No schema change, no migration, no new table, no new enum value. Everything above uses values the
  enums already carry.
- No change to `priceOrder()`, `evaluatePayout()`, `planRoute()` or any service — the seed keeps
  computing money with `paise()` / `percentOf()` / `splitGst()` / `roundToRupee()` / `allocate()` and
  keeps hand-building journals, exactly as it does today.
- The two UX-00 questions and the fifteen backend gaps in `docs/23` §10 are separate work; this spec
  only adds verifier checks (I-45, I-48) for the two demo-data items on that list.
- iOS remains unproven for unrelated reasons; nothing here depends on it.
