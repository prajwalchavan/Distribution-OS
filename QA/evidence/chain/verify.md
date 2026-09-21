# Blind verification of the day-1 chain — database only

**Verifier:** blind (did not read the operators' narrative until the last step, as the brief requires).
**Database:** `dos_test_chain` on 127.0.0.1:5439. **Snapshot taken at 2026-09-21 11:18–11:35 IST.**
**Nothing was started, edited or committed.** No service was launched; every statement below is a SQL read,
a file read, or a source read. Free RAM at start was ~60 MB with swap at 87.7% — the brief's headroom rule
would have applied, but this task needs no app server.

**State of the run at snapshot.** The backend was still up (`pg_stat_activity` shows `pgboss` connections),
last write 11:05:54 (TRIP-0004 created). TRIP-0002 is `closing` and TRIP-0003 `active`, both unsettled. So
this is a snapshot of a run that had stopped writing 13 minutes earlier, not of a finished, closed day.

**Claims coverage.** The claims handed to me end mid-sentence in hop 6 ("COLLECTED TODAY Rs10,"). Hops 1–6
are verified below. **There are no claims for the eight "wrong days"** — the rows exist in the database and I
checked the invariants over them, but I cannot mark claims TRUE or FALSE for text I was not given.

---

## 1. Verdict

**holds-with-findings.** Every decidable claim in hops 1–6 is TRUE. Not one figure in the claims block
contradicts the database. Two of the brief's named invariants fail, and one new defect — larger than either —
came out of testing the claims rather than reading them.

| | |
|---|---|
| Claims decided TRUE | 33 |
| Claims decided FALSE | 0 |
| NOT DECIDABLE (screen text, HTTP codes, truncated claim) | 8 |
| Named invariants: pass | 5 of 7 |
| Named invariants: fail | `sellable_stock` contains the damaged bin; CASH_VAN is non-zero tenant-wide (but 0 for this trip) |
| New defects found here | 2 (free goods across variants; the delivery challan's tax) |

---

## 2. Hop by hop

### Hop 1 — sales, SO-0879

| Claim | Result | Evidence |
|---|---|---|
| Header 859828 / 40817 / 195813 / 41799 / −24 / 1014800, `approval_flags ["credit_limit"]` | **TRUE** | `sales_orders` row, every column equal |
| `credit_notice` = overdue_days_exceeded, strict, 46, headroom 400900, limit 5000000, outstanding 3584300 | **TRUE** | stored JSON matches; it also carries `orderTotalPaise 1014800`, which the claim omitted |
| State `submitted` at that moment | **TRUE** | `order_state_transitions`: draft→submitted 08:45:16.478 |
| Line 1 Campa Cola 1 L 126 pc @ ₹28.50, scheme −₹107.73; line 2 ghee 8 pc @ ₹625.91, −₹300.44 | **TRUE** | `rate_paise` 2850 / 62591, `discount_paise` 10773 / 30044 |
| Drawer lines ₹4,876.58 + ₹5,271.66 | **TRUE** | `line_total_paise` 487658 + 527166 |
| Subtotal ₹8,598.28, Discount ₹408.17, Tax ₹1,958.13 **incl. cess ₹417.99**, Total ₹10,148.00 | **TRUE** | 126×2850 + 8×62591 = 859828; 10773+30044 = 40817; 139331+56482 = 195813, of which cess 41799; 819011 + 195813 − 24 = 1014800 |
| `applied_rules` line 1 = free_qty (freeQty 5, freeVariantId Campa Cola 750 ml) + line_pct 10773, `free_qty_pcs = 0` | **TRUE** | verbatim; free variant id `f71bf137…` resolves to Campa Cola 750 ml |
| ATP hint "19 cs available" on the row and the cart line | **NOT DECIDABLE** | screen text; no DOM captured by me |
| Cart warned before submit / outcome wording | **NOT DECIDABLE** | screen text. The *data* behind it (46 days, strict, held) is TRUE |

### Hop 2 — manager then owner

| Claim | Result | Evidence |
|---|---|---|
| `approvals` approved, `decided_by` sunil.tarsun, 08:51:42, note stored | **TRUE** | decided_at 08:51:42.926; note = "QA chain: approved once, limit untouched. Collect the 46-day bill on this trip." |
| `sales_orders` confirmed, `confirmed_at 08:51:42.95` | **TRUE** | exact |
| R-0001 credit limit 5000000, strict, 7 days **unchanged** | **TRUE** | `retailers.updated_at = 2026-09-13 12:40:12` — eight days before the run. The limit was not touched to let the order through |
| 19 reservations, 126 pc Campa over 14 lots + 8 pc ghee over 5 lots, none for the free bottles | **TRUE** | 14 rows / 126 and 5 rows / 8; no reservation names the 750 ml variant. (`state` is `posted` now, `pending` at the time — consistent) |
| Warehouse pick queue "134 pc confirmed" | **TRUE** for the quantity | 126 + 8 = 134, `sum(requested_qty_pcs)` on PICK-0079 |

### Hop 3 — warehouse: pick, pack, bill

| Claim | Result | Evidence |
|---|---|---|
| PICK-0079, 19 lines, 134/134 picked, `free_qty_pcs = 0` on every row | **TRUE** | counted; and all 19 rows have `lot_id = suggested_lot_id` (no FEFO override) |
| FEFO: RCP20260529 (23 Feb 27, 5 pc) … RCP20260814 (11 May 27, 11 pc), B20260909 (6 Jun 27) takes the remaining 57; ghee GD20260614 → GD20260806 | **TRUE** | the 19 rows come back in strictly ascending `expiry_date` with exactly those quantities; 5+7+4+4+4+4+2+4+4+6+5+9+11 = 69, +57 = 126, ghee 2+1+2+1+2 = 8 |
| INV/9007 issued at pack: 859828 / 40817 / 819011 / 77004 / 77004 / 41799 / −18 / 1014800, due 2026-09-28 | **TRUE** | every column equal; `state` was `issued`, now `paid` |
| 19 `stock_ledger` rows, reason `sale`, ref_type `pack`, −134 pc from Godown | **TRUE** | exactly 19 rows, sum −134, location "Godown" |
| `stock_balances` lot B20260909 → on_hand 336, version 4, updated_at 08:58:33 | **TRUE** | exact, all three |
| PDF 23 013 bytes, "Tarsun Enterprise", GSTIN 27CNGPP9039R1ZX, TOTAL Rs 10,148.00, footer | **TRUE** | file on disk is 23 013 bytes; decompressed text streams contain all four strings |
| One image XObject 360×150 DeviceRGB = the tenant's own `branding.logo_object_key` | **TRUE** | the embedded JPEG is **byte-identical** to `tenant/…/branding/logo.jpg` (18 724 bytes, same sha256) |
| Picker sheet shows MRP ₹50.00 / ₹770.00 only, no purchase cost | **partly** | the MRPs are right (`mrp_paise` 5000 / 77000). "No cost on screen" is **NOT DECIDABLE** from the database |

### Hop 4 — trip, load sheet, PIN, depart

| Claim | Result | Evidence |
|---|---|---|
| TRIP-0001: 2026-09-21, MH-05-CD-5678, Ganesh More, Iqbal Shaikh, float 200000, 1 planned stop | **TRUE** | every field |
| `trip_stops.planned_collection_paise = 1014800` | **TRUE** | exact |
| Load sheet: value 1014800, expected_packages 1, approved by **Vikas Kadam** 09:10:31, then confirmed, counted 1, challan **DC-0083**, 09:14:12 | **TRUE** | every field. `pin_verified_by` is NULL — consistent with "the manager's approval IS the PIN" |
| "19 lot lines" on the load sheet | **NOT DECIDABLE from `load_sheets`** | `load_sheets.van_stock = []` (van sales off). The 19 lot lines exist on **DC-0083** (`delivery_challans.lines`, 19 entries) and on the pick sheet, so the screen had them; they are not stored on the sheet row |
| Refusal probe 1: warehouse role → HTTP 403 on depart | **NOT DECIDABLE** | no HTTP capture. `PERMISSIONS` does exclude warehouse from `delivery.trips.depart`, and no write exists |
| Refusal probe 2: driver → HTTP 409 `load_sheet_not_confirmed`, trip stayed `loading` | **NOT DECIDABLE for the code; TRUE that nothing was written** | one load sheet, one challan, one trip; `started_at 09:17:24` is **after** `confirmed_at 09:14:12`, so the van did not leave on a draft sheet |
| Departed: state active, 09:17:24, odometer 48210 | **TRUE** | exact |

### Hop 5 — delivery and the shop

| Claim | Result | Evidence |
|---|---|---|
| "Owes ₹45,991 · Overdue ₹35,843 · 7 bills open" before the drop | **TRUE** as arithmetic | 3584300 + 1014800 = 4599100; 6 open bills + the new one = 7 |
| `deliveries` delivered, 09:20:11, receiver "Ganesh Kirana - Ramesh" | **TRUE** | exact |
| `pod_evidence` photo at `tenant/…/pod/004d0157-…/01a0c215-ea23-….jpg`, 130 B | **TRUE** | `file_objects.bytes = 130`, status `uploaded`. **A second `file_objects` row for the same delivery is still `pending`** — an orphan signed-upload row, consistent with the run's own S-170 |
| 19 lot lines pre-filled at 134/134; delivered 134, returned 0 | **TRUE** | 19 `delivery_lines`, sum delivered 134, returned 0 |
| RCPT-9005 cash 600000 RB-2209-01; RCPT-9006 upi 414800 UTR926521440871 RB-2209-02; both on TRIP-0001 | **TRUE** | every field |
| Both allocated to INV/9007, 600000 + 414800 = 1014800; invoice `paid` | **TRUE** | two `allocations` rows, sum = the invoice total to the paisa |
| `retailer_outstanding_summary` 3584300 / 3584300 / 6 open | **TRUE** | exact; ageing buckets 547200 + 1643400 + 1393700 = 3584300, oldest_due 2026-08-06 = 46 days |
| Retailer-app timeline 8:45 → 8:51 → 8:56 → 8:58 → 9:14 → 9:20 | **TRUE as data** | `order_state_transitions` holds exactly those six stamps in that order |

### Hop 6 — check-in and the desk

| Claim | Result | Evidence |
|---|---|---|
| "Float ₹2,000 + cash ₹6,000 − spent ₹0 → hand ₹8,000" | **TRUE** | 200000 + 600000 − 0 = 800000 |
| Checked in, odometer 48237 → closing | **TRUE** | `end_odometer_km 48237`, `ended_at 09:25:03` (state is `settled` now) |
| Settlement expected 800000, handed 800000, variance **0**, UPI 414800, by Meena Joshi | **TRUE** | every field; `has_variance = false` |
| Banked RCPT-9005 under SLIP-QA-210926-01 | **TRUE** | `status deposited`, `deposit_ref SLIP-QA-210926-01`, `deposited_at 09:34:55`. RCPT-9006 (UPI) correctly stayed `collected` |
| Owner's Today: INVOICED TODAY ₹10,148.00 | **TRUE at that moment** | one invoice existed on 2026-09-21 before 09:59 |
| "COLLECTED TODAY Rs10," | **NOT DECIDABLE** | the claim is truncated. Receipts on 2026-09-21 up to 09:35 were cash 600000 + upi 414800 = 1014800 |

---

## 3. The named invariants

| Check | Result |
|---|---|
| **Totals equal order → invoice → receipt + outstanding** | **PASS.** SO-0879 1014800 = INV/9007 1014800 = 600000 + 414800, and the shop's outstanding fell by exactly 1014800. All six of today's orders equal their invoice to the paisa. Every invoice in the database (1 504 of them) reconciles header = Σ lines + round_off: **0 exceptions**. No invoice or receipt is over-allocated once `cash_discount_paise` is counted (49 of 50 apparent over-allocations are exactly the cash discount; the 50th was my own cross-tenant grouping error) |
| **`stock_ledger` rows for the pack and for the return, right lot** | **PASS.** Pack: 19 rows, `sale`/`pack`, −134, Godown. Returns: 2 rows, `sale_return_damaged`/`credit_note`, +10 and +6, both on lot `483250cb…` (batch B20260729) — the same lot the invoice lines carry — into the Damaged / expiry bin |
| **The damaged bin never appears in `sellable_stock`** | **FAIL.** `sellable_stock` has no location predicate at all (`pg_get_viewdef`; migration 0003 line 170). It currently returns **85 rows and 1 241 pieces** sitting in damaged bins, `available` and all. The safety is entirely in the six call sites, each of which scopes to a location (`l.kind = 'warehouse'`, or the reservable godown id). Nothing today reached the damaged stock — but the guarantee is a convention, not a property of the object, and the object's name argues the other way |
| **CASH_VAN nets to 0 after settlement** | **PASS for this trip.** `receipt RCPT-9005` +600000, `settlement of trip TRIP-0001` −600000 = 0. Tenant-wide CASH_VAN is ₹1,52,536 non-zero, but every paisa of that is four **seeded** doorstep receipts from 11–12 Sep whose trips are still `active` — pre-existing, not this run |
| **Every journal balances** | **PASS.** 0 entries with a non-zero line sum; 0 entries with no lines, across all three tenants and all time. As a stronger check: the GL AR control (₹43,87,074) reconciles to the receivables sub-ledger (₹44,22,154) exactly once unallocated credit (₹35,080) is netted — difference **0 paise** |
| **Invoice and receipt numbers unique per series and FY** | **PASS.** 0 duplicates for invoices, receipts, credit notes, challans or trips, per tenant, per series, per FY |
| **No negative `stock_balances` anywhere** | **PASS.** 0 rows with `on_hand < 0` or `reserved < 0`, all tenants |

---

## 4. The "wrong days"

No claims were supplied for these, so nothing here is marked TRUE or FALSE. The rows and the invariants:

SO-0880 rejected → `cancelled`, `cancel_reason = approval_rejected`, **0 reservations ever taken**.
SO-0882 cancelled mid-pick → both reservations `voided`, `stock_balances.reserved` back to 0, **no invoice**.
SO-0883 partial → INV/9008 ₹3,810, CN/9003 ₹1,066 for 10 damaged pieces, allocated, net ₹2,744.
SO-0885 delivered then credited → INV/9011 ₹3,849, CN/9004 ₹646.
Both credit notes land in the Damaged / expiry bin on the correct lot, and the Godown was never credited.
SO-0881 / SO-0884 / SO-0886 → failed, refused or reassigned; the bills stay `issued` and payable.
`sync_ops`: 39 operations today, **every one `{"ok": true}`**; 0 new `sync_errors`.

**The one thing the database says loudly about this half:** 297 pieces were relieved from the Godown at pack
today; 212 reached shops and 16 went to the damaged bin. **The remaining 75 are in no location in the
database** — `stock_balances` for Vehicle MH-05-CD-5678 has **0 rows**. Three shops are billed ₹614 + ₹605 +
₹614 for goods that came back on the van, and the stock on hand is 75 pieces light with nothing to count back.
The code says this is intended (`deliveries.service.ts:182-184`: *"the pieces stay on the van for the next
attempt"*) — but that sentence is a comment, not a ledger row, and no screen backed by balances can show them.

---

## 5. Two defects found here, not in the claims

### A. Free goods are dropped when the reward is a **different variant** — one line in the whole database

This is the sharpest measurement of the run, and it is narrower and more actionable than "the free bottles
were lost".

```
                 lines   carried   dropped   promised_pcs   recorded_pcs
same variant     1 716     1 716         0         12 416         12 416
CROSS variant        1         0         1              5              0
```

Every one of 1 716 free-goods lines in this database carried its promised quantity end to end. **Exactly one
line dropped it: SO-0879 line 1 — the only cross-variant reward in the database.** Four other live orders
today (SO-0880, SO-0881, SO-0884, SO-0886) ran the *same scheme* (`8c91c558…`, "Campa 750 ml / 1 L — a bottle
free per case") and every one of them recorded `free_qty_pcs = 1`, because they ordered the 750 ml itself.
SO-0879 ordered the 1 L and earns the 750 ml, so the quantity had nowhere to go.

The cause is in the source, stated in its own comment:

- `backend/libs/domain/src/pricing/schemes.ts:169` — *"Free pieces of THIS variant. Free goods of another
  variant are only in `freeItems`."*
- `schemes.ts:345-347` — `freeQtyPcs: line.freeItems.filter(f => f.variantId === line.input.variantId)…`
- `backend/libs/core/src/modules/orders/pricing-lines.ts:114-140` — `PricedLineFields` is the exhaustive list
  of what a quote puts on an order line, and **`freeItems` is not in it**. It is published on the
  `pricing.quote` contract (`contracts/src/pricing.ts:333`) and read by nothing that writes an order.

So a cross-variant reward is quoted to the client, written into `applied_rules` as a promise, and then has no
column to live in. Every downstream hand-off is innocent. Any distributor running a "buy the litre, get a
750 ml free" scheme loses the free goods silently and owes the brand a claim it cannot substantiate.

### B. The delivery challan declares the wrong tax, from a lookup that cannot be deterministic

DC-0083 — the transport document that travels with the van — carries:

- 19 lot lines, **all** at `gstBps: 1200`, on MRP-based line values summing **₹12,460**, with
  `load_value_gst_paise = 149520` (12% of ₹12,460);
- `value_paise = 1014800` — the invoice total, against those ₹12,460 of line value;
- **no cess at all**, on goods whose invoice charges 12% cess.

INV/9007, from the same pack, taxes Campa Cola at `gst_bps 2800` + `cess_bps 1200`. The challan says 12%.

The cause: `hsn_rates` holds **three open-ended rows for HSN 2202, all `effective_from 2017-07-01`** —
28%+12% cess (aerated waters), 18% (packaged water), 12% (fruit-juice drinks). `loadGstBps`
(`backend/libs/core/src/modules/warehouse/warehouse.internals.ts:142-170`) selects by HSN and date, orders by
`(hsn_code, effective_from)`, and keeps whichever row the database happens to return last. For 2202 it kept
12%. The same three-way ambiguity exists for HSN 0406, 1905 and 2106.

A checkpost reading DC-0083 sees a goods value of ₹12,460, tax of ₹1,495.20 at 12%, and a declared
consignment value of ₹10,148 — three numbers that cannot all be true, on a document that leaves the premises.

---

## 6. QA/09-cross-role-workflows.md — where the words are stronger than the evidence

Read once, at the end, as instructed. The document is unusually honest: it files its own failures, quotes its
own SQL, and marks what it did not test. Most of its figures reproduce exactly — including the ones it uses
against itself (4 909 of the ledger rows sorting above every real UUIDv7; 85 rows and 1 241 pieces of damaged
stock inside `sellable_stock`; 163 packed, 72 with shops, 16 damaged, 75 nowhere; every rupee of §3, §6 and §7
to the paisa; the credit-note note empty for CN/9004; zero frontend callers of `allocations.create`). Six
places where the prose outruns what was measured:

1. **DOS-185 is framed as a missing capability; it is a single conditional bug.** "Five free bottles priced
   and then never picked, billed or delivered … no hand in the chain carried them" reads as *free goods do not
   travel*. The database says free goods travel 1 716 times out of 1 717, and that the one failure is the only
   **cross-variant** reward in it — four orders on the *same scheme*, the same day, kept theirs. The narrative
   had the evidence one query away (`SO-0880 … free_qty_pcs = 1`, quoted in its own §1 as "1 pc free") and did
   not connect it. As written, the finding invites a large rewrite; as measured, it is one missing field in
   `PricedLineFields`.
2. **"Nothing was lost, duplicated or delayed between people"** (opening of *What this chain cost the
   business*) is a verdict the same paragraph then withdraws, and the second half contradicts outright: 75
   pieces of stock are lost. The evidence supports "nothing was lost in the money"; the sentence claims more.
3. **"Godown 166 available · Damaged / expiry bin 16 available" (§6) does not reproduce.** The damaged 16 is
   exact. For that lot (`483250cb…`) the Godown row is **60**; for the whole Konkan Bhajani Chivda 400 g at
   the Godown it is **160**. Neither is 166, and nothing moved that lot after 10:58. The claim it supports —
   two separate rows, the Godown never credited, damaged stock unreachable — is TRUE; the number is not.
4. **"ORDERS, 30 DAYS 218 ✅" is a nine-minute coincidence presented as a match.** The console's query is
   `created_at > now() - interval '30 days'` (`platform-admin/counts.ts:77-78`). Over the hop-7 window that
   count reads 224 at 09:39, **218 at 09:45**, and 215 at 09:48, because the seed clusters orders at 09:4x.
   The tick is earned, but a rolling-window count that swings by nine in nine minutes is not evidence that the
   console agrees with the database; it is evidence that both were read at the same instant.
5. **"The wall holds"** rests on one DOM regex on one page at one moment (`["₹4,999.00"]`). That proves what
   that page rendered, not a property of the console. A negative of this shape needs the contract surface or
   the permission matrix behind it, and neither is cited.
6. **§8's "No credit note was raised — correct, since a refused bill is meant to be cancelled or redelivered,
   not credited."** "Correct" is an appeal to intent, not a measurement, and the same section files DOS-197
   (P1) against what that behaviour does to the shop. Either the behaviour is right and DOS-197 is about the
   missing message, or it is wrong; the document asserts both without separating them.

Two things the document does not cover at all, both found above: **the cross-variant free-goods rule** (§5A —
it has the symptom, not the rule) and **the delivery challan's tax** (§5B — DC-0083 and DC-0084/0085 were
written, numbered and never read). The head table scores the warehouse → planning and load-sheet → driver
hand-offs "Yes" on the strength of the *amount* matching; the legal document created at that hand-off carries
three mutually inconsistent numbers and was not opened.

---

## 7. Queries behind this file

All run as `psql "postgres://dos:dos@127.0.0.1:5439/dos_test_chain"`, read-only.

```sql
-- journals balance / no empty entries
select je.id, sum(jl.amount_paise) from journal_entries je join journal_lines jl on jl.entry_id=je.id
 group by 1 having sum(jl.amount_paise) <> 0;                                   -- 0 rows

-- AR control vs sub-ledger (pilot tenant)
-- journal AR 438707400 ; Σ open invoice value 442215400 ; Σ unallocated credit 3508000 ; difference 0

-- CASH_VAN for TRIP-0001
select a.code, jl.amount_paise, je.ref_type from journal_lines jl
  join journal_entries je on je.id=jl.entry_id join accounts a on a.id=jl.account_id
 where a.code='CASH_VAN' and je.posted_at >= '2026-09-21';                       -- +600000 / -600000

-- damaged stock inside the ATP view
select count(*), sum(available) from sellable_stock s join locations l on l.id=s.location_id
 where l.kind='damaged';                                                         -- 85 | 1241

-- free goods, same variant vs cross variant
with r as (select sol.variant_id, sol.free_qty_pcs,
   (jsonb_path_query_first(sol.applied_rules,'$[*] ? (@.rewardKind == "free_qty")')->>'freeVariantId') fv,
   (jsonb_path_query_first(sol.applied_rules,'$[*] ? (@.rewardKind == "free_qty")')->>'freeQty')::int promised
   from sales_order_lines sol where sol.applied_rules::text like '%free_qty%')
select case when fv = variant_id then 'same' else 'CROSS' end, count(*),
       count(*) filter (where free_qty_pcs>0), sum(promised), sum(free_qty_pcs) from r group by 1;

-- stock that is nowhere
select l.name, count(*), sum(sb.on_hand) from stock_balances sb join locations l on l.id=sb.location_id
 where sb.tenant_id='01a0999a-28c3-7341-93f5-e0e84b0189a1' group by 1;           -- no vehicle CD-5678 row

-- the challan's own tax
select lines, value_paise, load_value_gst_paise from delivery_challans where challan_no='DC-0083';
select * from hsn_rates where hsn_code='2202';                                   -- three open-ended rows
```
