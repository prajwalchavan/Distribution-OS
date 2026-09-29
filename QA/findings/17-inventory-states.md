# 17 — Inventory lifecycle (Phase 10) and order / delivery / invoice state machines (Phase 9)

Lane "stock", 2026-09-28. Test database `dos_test_p10_stock` (template `dos_test_batch2b_template` + `pnpm db:migrate` exit 0 +
`pnpm db:seed` exit 0), all-in-one API on :3660 (`WORKER_INLINE=1 NODE_ENV=development`, no `DOS_MODE=all`, so the in-process
worker did not start: 281 outbox rows stayed unpublished and the reporting rollup never ran — see NOT TESTED). Tenant tarsun.
Every call went through the product's own oRPC contract client as the named role; every figure below was read from the API or
from SQL. Tools: `QA/tools/p10/`. Evidence: `QA/evidence/p10/` (`recon/` = the stock reconcile after every scenario,
`wire/` = every mutation and every refused call per scenario, `*.json` = steps and checks per scenario).

The stock reconcile (`QA/tools/p10/stock-reconcile.mjs`, checks C1–C9: ledger = on hand for every lot at every place, reserved =
open holds, nothing negative or over-held, `sellable_stock` = on hand − reserved at godown/van only, every ledger row's lot /
place / document exists, pieces billed = pieces moved per bill, pieces delivered = pieces sold per door, no hold on a dead
document, every journal entry balanced) ran on the fresh seed and after every scenario. C1, C2, C4, C5, C7, C8 and C9 passed
EVERY time (ledger = balances to the piece; journal 0 unbalanced). The only differences it ever reported are the findings
below: C3 (DOS-350's negative damaged bin, DOS-353's over-held batch) and C6 (the seed's three bills, DOS-363).

## Coverage

| # | Brief item | What ran | Result | Evidence |
|---|---|---|---|---|
| 1 | Stock reconcile script | C1–C9, baseline + 36 runs | written; differences = DOS-350, 353, 363 only | `recon/00-baseline-fresh-seed.txt` … `recon/99-final.txt` |
| 2 | PO → GRN (batch + expiry) → available | S1a (10 lines, 20 damaged at the gate) | works; DOS-356, DOS-357 | `s1-receive.json` |
| 2 | reserve → pick full / short / zero → pack → bill → load-out approval → dispatch → door full / part / refused / damaged → check-in → dock → out again | S2a–S2e | every step reconciled; DOS-252 regression PASS | `s2-lifecycle.json` |
| 2 | damaged at gate / in godown / on delivery, expired, return after delivery, lost (count), adjust up / down, write-off, transfers | S1a, S2c, S3a–S3g | DOS-350, 351, 352 | `s3-damage-expiry.json` |
| 3 | reservation leaks: cancel at submitted / confirmed / picking, reject a held order, release, wave cancel, re-line, bill cancel | S4a, S4b | no leak | `s4ab-console.txt`, `recon/S4a-after.txt`, `S4b-after.txt` |
| 3 | over-ordering: one piece over, FEFO across batches, short order picked in full | S4c, S4d, S4e | FEFO correct; DOS-353 | `s4cd-reservations.json`, `s4e-steal.json` |
| 4 | append-only: UPDATE / DELETE / TRUNCATE as `dos`, `app_rw`, `app_worker`; API paths that rewrite | S5 (all in ROLLBACK) + code grep | rows refused; TRUNCATE / trigger-disable open to `dos` — DOS-360 | `s5-append-only.txt` |
| 5 | reports vs SQL: stock at cost, by item and batch, godown list, expiring soon, rep availability | S9 | all equal except the owner home (worker not running → NOT TESTED); DOS-362 | `s9-reports.json`, `s9-reports-snapshot.json` |
| 6 | three lifecycles as implemented | code map + observed transitions | tables below | this file |
| 7 | forbidden moves | 48 recorded attempts | 32 refused with a clean 4xx and a sentence (no 500 anywhere); accepted where they should not be: pack never picked (DOS-359), trip cancelled after load-out, the bill re-planned and departed without goods (DOS-354), unbilled order loaded and counted out (DOS-355), mid-trip unload (DOS-358); re-confirming a confirmed order answers 200 as a no-op (holds unchanged) | `s6-forbidden-table.json`, `s6c-e-console.txt`, `s6c2-continue.json` |
| 8 | desync in SQL, seed then after scenarios | 10 queries | seed: DOS-363; lane: only the rows DOS-354/355/358 made | `s7-desync.txt`, `s7-desync-final.txt` |
| 9 | atomicity by late failure | S8a–S8d | nothing left behind, no number consumed | `s8-atomicity.json` |

## The three lifecycles as implemented

Role groups (`backend/libs/contracts/src/permissions.ts`): MANAGEMENT = PIN holders = owner, manager; STOCK_KEEPERS = owner,
manager, warehouse; DOORSTEP = owner, manager, delivery; MONEY_DESK = owner, manager, accountant. Every order move goes through
`orderMachine.next` and writes an `order_state_transitions` row plus an outbox event in the same transaction (the S7 D10 query
found no order whose column disagrees with its own log). Every handler below runs in ONE `withTenant` transaction; the
exception is noted in the atomicity column.

### Order fulfilment (`sales_orders.state`)

| From → to | Procedure (route) | Who | Stock | Money / documents | Observed |
|---|---|---|---|---|---|
| → draft | `orders.create` (POST /orders) | owner, manager, rep, shop | – | – | S2a |
| draft → submitted (→ confirmed when no gate) | `orders.submit` | same; a rep on its own orders, a shop on its own draft | holds at the godown on auto-confirm | SO number; one approval row per gate (credit, bargain, …) | S2a, S4a (credit gate) |
| submitted → confirmed | last `approvals.decide` approve, or `orders.confirm` | owner, manager; 409 while a gate is pending | holds FEFO within the shelf-life rule; a line the godown cannot cover is held short and recorded in `stock_shortages`, never refused | re-price by approved rates | S4c (1 pc over → 60 held + 1 short) |
| draft / submitted / confirmed → cancelled | `orders.cancel`, `approvals.decide` reject | shop: draft/submitted; rep: to confirmed; desk | holds voided | pending gates expired | S4a: reserved back every time |
| picking → cancelled | `orders.cancel` | owner, manager only (rep 409 `desk_only`) | holds voided, picker's rows marked put back | – | S4a |
| confirmed → picking | `warehouse.picklists.start` | owner, manager, warehouse | – | PICK number at wave | S2b |
| (holds only) | `picklists.cancel` (open sheet), `reservations.release` (confirmed) | PIN holders / back office | holds voided, order stays **confirmed with no hold** (by design, re-held at the next wave or at pack) | audit for release | S4b |
| confirmed or picking → packed | `warehouse.packs.confirm` | owner, manager, warehouse | picked pieces godown → dock (`transfer_out`/`transfer_in`, ref `pack`), godown holds posted, dock holds created; **with no recorded pick, the holds are packed** | `pack_confirmations`; bill issued unless `issueInvoice:false` | S2b; DOS-359 (never picked), DOS-355 (no bill) |
| packed → cancelled | `billing.invoices.cancel` → `orders.cancelInTx`; a whole-bill credit note before dispatch | PIN holders | dock → godown from the bill's holds; 409 `dock_short` if the dock cannot cover it | reversing journal; number kept | S4b, S6c |
| packed → dispatched | `warehouse.loadSheets.confirm` (warehouse needs the manager's approval) | owner, manager, warehouse | dock → vehicle (ref `load_sheet`), dock holds posted; never short-loads (409 `dock_short`) | DC challan number | S2c, S8b |
| dispatched → delivered / partially_delivered | `delivery.deliveries.record` | the trip's crew (and desk) | `sale` of the whole bill off the van; returns come back on the delivery's credit note: saleable → van, damaged → damaged bin | CN number + journal + allocation | S2c |
| dispatched → packed | `stops.fail`, `trips.return`, `deliveries.cameBack` | crew / PIN holders | none at the door; at settlement the bill's pieces go van → dock with a hold | `undelivered_at` set | S2c/S2d |
| delivered / partially_delivered → closed | **never applied** (no caller of `close`) | – | – | – | delivered is terminal in practice |
| van sale draft → … → delivered in one call | `delivery.vanSales.create` | crew on an active van-sale trip | `sale` off the van (ref `invoice`) | SO + INV (+ RCPT) | not run |

### Delivery (trip and stop)

| Move | Procedure | Who / guard | Stock / money / documents | Observed |
|---|---|---|---|---|
| → planned | `delivery.trips.create` | owner, manager, warehouse, crew (own trip); driver not on another open trip that day; each bill issued, not planned elsewhere, not riding back | TRIP number; stop rows + planned door rows | S2c; 409 on a bill already planned (S6b) and on a cancelled bill (S6a) |
| planned → loading | `trips.startLoading` | same | – | S2c |
| (sheet) draft → approved → confirmed | `loadSheets.create / approve / confirm` | godown builds, manager approves, godown counts out | confirm: dock → van, DC number, orders dispatched — **no check of the trip's state** | S2c, S6d |
| loading → active | `trips.depart` | crew; no draft sheet left; every planned bill already dispatched; GPS consent | nothing moves here | S2c; DOS-354 (departs a bill whose goods are on another van) |
| planned / loading → cancelled | `trips.cancel` | owner, manager | stops → `skipped` (not a stop-machine state); **a confirmed load sheet is not checked** | DOS-354 |
| active → closing | `trips.return` (check-in) | crew | open doors fail, their orders go back to packed; no stock | S2d |
| closing → settled / settled_with_variance | `trips.settle`; a variance beyond tolerance needs the owner | manager (variance → 409 + an approval row committed in its own transaction, by design), owner | van count (`cycle_count` at the van), came-back bills van → dock with holds, free van stock van → godown (`van_unload`/`transfer_in`), cash journal | S2d, S8d |
| (no trip move) | `trips.unload` (van-returns/unload) | STOCK_KEEPERS; **no trip-state check** | van → dock for a closing trip's came-back bills, else van → godown | DOS-358 |
| stop pending → started → arrived → delivered / partial / failed | `stops.start/arrive/fail`, `deliveries.record` | crew; a stop is terminal when every bill on it has an outcome | as above | S2c; second delivery of a delivered stop 409 (S6b) |

### Invoice / payment (`invoices.state`)

| Move | Procedure | Who / guard | Stock / money / documents | Observed |
|---|---|---|---|---|
| → issued | at `packs.confirm`, `invoices.issueForPack`, van sale | warehouse / desk / crew | INV number in the same transaction (counter row: a rollback consumes nothing, S8a) | S2b |
| issued → cancelled | `billing.invoices.cancel` | owner, manager; order not dispatched; no money allocated (`bill_has_money`); no live credit note; off every trip; dock covers it | stock back from the dock, reversing journal, order cancelled, number kept; DB trigger 0071 refuses a cancel that would net stock ≠ 0 | S4b, S6c; refused with a receipt (S6b), after dispatch (S6a), on a returning van (DOS-251) |
| issued → partially_paid → paid | `receipts.create`, door collections, allocations | desk / crew | allocation never exceeds the bill; a second full payment sits on account | S6b |
| paid → partially_paid / issued | receipt reverse / bounce (recompute writes the state directly, outside `invoiceMachine`) | desk | reversing journal | not run (Phase 7) |
| → written_off | `receivables.writeOffs.create` | owner | BAD_DEBTS journal | not run (Phase 7) |
| credit note draft → issued | `creditNotes.create` (+`autoIssue`) / `issue` | desk, crew | restock: saleable to the given place, damaged to the bin; a damaged line cannot be marked saleable; drafts count toward "left to credit" | S3g, S6g, S8d |

### Ledger rows each movement wrote (observed, our own batches)

| Movement | Rows (reason, place, sign, ref) | Scenario |
|---|---|---|
| GRN post | `grn` godown +good; `grn` damaged bin +damaged-at-gate | S1a |
| Confirm / cancel / reject / release | none (holds only) | S2a, S4a, S4b |
| Pack (full / short / zero) | `transfer_out` godown −picked, `transfer_in` dock +picked (ref `pack`); a zero-picked line writes nothing | S2b |
| Load-out confirm | `transfer_out` dock −, `transfer_in` van + (ref `load_sheet`) | S2c |
| Door full / part | `sale` van −whole bill (ref `delivery`); part: `sale_return_saleable` van +returned (ref `credit_note`) | S2c |
| Door damaged return | `sale` van −48, `sale_return_damaged` damaged bin +12 | S2c |
| Door refused | none; at settlement `van_unload` van −, `transfer_in` dock + (ref `trip_settlement`), hold for the bill | S2c, S2d |
| Settlement, free van stock | `van_unload` van −, `transfer_in` godown + | S2d |
| Out again | `transfer_out` dock −, `transfer_in` van +, `sale` van − | S2e |
| Bill cancel (pieces on the dock) | `transfer_out` dock −, `transfer_in` godown + (ref `invoice_cancel`) | S4b, S6c |
| Damaged in the godown | adjust: `damage` godown − (one row, nothing into the bin); or transfer: godown −, bin + | S3a |
| Expired write-off / adjust up / adjust down / count | `expiry_writeoff` −; `adjustment` + (owner only; godown login 403) / −; `cycle_count` ± (desk posts) | S3e |
| Desk return after delivery | `sale_return_saleable` godown + (same batch); `sale_return_damaged` bin + | S3g |
| Hand transfer | `transfer_out` −, `transfer_in` + (ref `transfer`) — any pair of places, the bin included (DOS-350, 352) | S3b, S3c, S3f |

## Findings

> **Judged by the main session, 2026-09-28.** DOS-350 and DOS-351 are CONFIRMED: in `dos_test_p10_stock` the damaged bin holds −50 and −88 with `negative_allowed = true` (the flag is set at `backend/libs/database/src/tenant-bootstrap.ts:234`, so every tenant bootstrapped so far has it, the live one included), and INV/9011 of 2026-09-28 carries 48 pieces of batch P10-B-EXP, expiry 2026-09-23. The P1s were read, not re-run. Nothing is fixed: these wait for the founder's approval.

### DOS-350 — The damaged bin may go below zero, so a hand transfer out of it creates sellable stock
**Status (2026-09-29): FIXED on main `1f378e6b`, not yet on the live server.** The damaged / expiry bin, like every place, can no longer go below zero: a move or a write-off beyond what it holds is refused in words and nothing is written, and no place can be saved as "may go below zero". A balance that was already below zero keeps its books and is named by a release check until a count corrects it. Proof: `bin-and-expiry.spec.ts` and `rls.test.ts` (DOS-350), migration 0075, `pnpm check:stock-negative`; the bin lane's blind check 4 replayed S3c (70 out of a bin of 20 refused for the godown, the manager and the owner), and on migrated copies of `dos_test_p10_stock` the check named exactly the −50 and −88 rows.

Category: bug | Priority: P0 | Role: Warehouse (godown login) | Platform: API

```
User: Warehouse (kavita.sawant)
Platform: API (all-in-one :3660)
Environment: dos_test_p10_stock, demo seed + own GRN-0129
Steps:
  1. GRN-0129 receives batch P10-A1 of Konkan Farsan Mix: 380 to the godown, 20 damaged at the gate to the damaged bin.
  2. S3a/S3b move pieces in and out of the bin; it holds 20 of P10-A1.
  3. As the godown login: POST /warehouse/inventory/transfers  lot P10-A1, from the damaged bin, to the godown, qtyPcs 70.
  4. As the godown login: POST /warehouse/inventory/adjustments  lot P10-C1 at the damaged bin, qtyDelta −100, reason damage (bin holds 12).
Expected: both refused (the bin holds 20 and 12).
Actual: both 200. Godown +70 of P10-A1 (195 → 265), bin −50. Bin of P10-C1 at −88. The 50 pieces that never existed are in
  the godown, in `sellable_stock` and in the rep's availability; the reconcile's C3 flags both rows from then on.
Business impact: 50 pieces (₹500 at cost, ₹6,000 at MRP) created from nothing and sellable; any quantity can be minted the
  same way. The negative bin also hides real damaged stock (138 pieces below zero at the end of the lane).
Severity: P0
Evidence: QA/evidence/p10/s3-damage-expiry.json (S3c), QA/evidence/p10/wire/S3c.jsonl, QA/evidence/p10/recon/S3c-after.txt
Suggested fix: bootstrap the damaged location with `negative_allowed = false` and back-fill existing tenants (the bin is created
  with `true`: `locations` row "Damaged / expiry bin", and `applyBalance` copies the flag onto every balance row); refuse any
  movement that takes a balance below zero outside an explicitly negative location.
```

### DOS-351 — An already-expired batch can be picked in place of the reserved in-date batch, and is billed and shipped
**Status (2026-09-29): FIXED on main `1f378e6b`, not yet on the live server.** An expired batch is never sold: it is not offered or held for an order, and the pick (online and offline), the pack, the bill and the van sale refuse it in words. Short-dated batches still only warn. Proof: `stock-states.spec.ts` (DOS-351), `bin-and-expiry.spec.ts` and `vansales.spec.ts` (DOS-261 / DOS-351); `pnpm check:stranded` names older bills of an expired batch; the states lane's blind check 4 replayed S3d online and offline, and the merged-tree check's cross-lane run held and billed only the in-date batch.

Category: business-logic | Priority: P0 | Role: Warehouse | Platform: API

```
User: Warehouse (kavita.sawant); order by rep rahul.deshmukh
Platform: API
Environment: dos_test_p10_stock; godown holds P10-B-EXP (expired 2026-09-23, 48 pcs) and in-date P10-B-G1 / G2
Steps:
  1. Rep orders 48 Sunbake Choco Chip Cookies; confirm holds 48 of the in-date P10-B-G1 (FEFO correct).
  2. Wave; the sheet suggests P10-B-G1.
  3. Picker records 48 from P10-B-EXP instead (POST /warehouse/picklists/{id}/pick).
  4. POST /warehouse/orders/{id}/pack.
Expected: an expired batch is refused at pick (or at pack), whatever FEFO does with short-dated batches.
Actual: pick 200 with only `fefo_override = true` on the row; pack 200; INV/9011 (₹1,255.00) is issued for 48 pcs of batch
  P10-B-EXP expiry 2026-09-23; the pieces moved godown → dock for loading.
Business impact: expired food goes to a shop on a GST bill carrying the expired date (FSSAI exposure). Related to DOS-261
  (expired batches reserved once in-date stock runs out, ruling pending) but a different path: here in-date stock was
  reserved and available. Rated P0 under the lane rule "sold while expired".
Severity: P0
Evidence: QA/evidence/p10/s3-damage-expiry.json (S3d), QA/evidence/p10/wire/S3d.jsonl
Suggested fix: in `applyPicks` and in `packs.confirm`, refuse a lot whose `expiry_date` < today (IST) with a named reason; keep
  "warn, never block" for short-dated batches only (the 2026-09-13 ruling).
```

### DOS-352 — Damaged pieces go back to sellable stock with a plain transfer by the godown login
**Status (2026-09-29): FIXED on main `1f378e6b`, not yet on the live server.** Pieces in the damaged / expiry bin never go back for sale: a move to the godown, a van or the dock is refused for every login, and so is an order, a wave, a pack or a load sheet from the bin; the bin cannot be switched off or saved as a godown. They leave only by the desk's write-off or a return to the brand; a carton binned by mistake is the owner's correction, with a written reason. Proof: `bin-and-expiry.spec.ts`, `bin-exits.spec.ts`, `fixed-places.spec.ts` and `rls.test.ts`; the bin lane's blind check 4 replayed S3b (9 of 9 moves out of the bin refused) and 36 of 36 attempts to switch off or re-kind the fixed places.

Category: business-logic | Priority: P1 | Role: Warehouse | Platform: API

```
Steps: as the godown login, POST /warehouse/inventory/transfers P10-A1, from the damaged bin to the godown, 5 pcs; then from the
  damaged bin to van C, 5 pcs.
Expected: refused, or held for the desk (the DOS-116 rule: damaged goods never go back into saleable stock, at the desk or at
  the door).
Actual: both 200. The 10 pieces are in `sellable_stock` (godown and van) and the rep's availability at once; nothing marks them.
Business impact: damaged cartons can be sold to shops by one tap on the stock screen, no approval, no reason code.
Severity: P1
Evidence: QA/evidence/p10/s3-damage-expiry.json (S3b), QA/evidence/p10/wire/S3b.jsonl
Suggested fix: refuse transfers OUT of a `damaged` location to a `warehouse` or `vehicle` location (or allow them to the owner
  only with a reason, audited); the bin's only exits should be a write-off, a claim/return to the brand, or scrap.
```

### DOS-353 — A short-confirmed order can take, at pick, pieces the godown holds for another confirmed order
**Status (2026-09-29): FIXED on main `1f378e6b`, not yet on the live server.** A pick takes only the pieces held for its own order plus free ones; taking pieces held for another order is refused, naming that order, online, offline and again at pack, and the order confirmed first packs in full. Proof: `stock-states.spec.ts` (DOS-353); the states lane's blind check 4 replayed S4e, S4f and S4g, and QA's own `s4e-steal` passes.

Category: business-logic | Priority: P1 | Role: Warehouse | Platform: API

```
Steps:
  1. Godown holds 202 of P10-E1 (Godavari Dairy Whitener). Order X2 (SO-0894) for 150 → confirmed, 150 held.
  2. Order Y2 (SO-0895) for 100 → confirmed with 52 held and a 48-piece shortage recorded.
  3. Wave Y2: the sheet asks 52 from P10-E1 and 48 from no batch. Picker records 52 on the first row and 48 on a split row of P10-E1.
  4. Pack Y2; then wave, pick and pack X2.
Expected: the 48 short pieces cannot come out of pieces held for X2 (pick or pack refuses, or X2 keeps its pieces).
Actual: Y2 packs and bills 100 (INV/9015, ₹25,047.00). Godown P10-E1: on hand 102, reserved 150 (reserved > on hand, C3). X2's pack
  answers 400 "Only 102 pc … 150 pc cannot go out"; X2 (₹37,570.00) is stuck in picking holding 150 against 102.
Business impact: the order confirmed first, with its stock promised, is the one that goes short; the desk sees it only at pack.
Severity: P1
Evidence: QA/evidence/p10/s4e-steal.json, QA/evidence/p10/recon/S4e-after.txt
Suggested fix: at pick (and at pack), bound what a line may take from a lot to its own holds plus that lot's free pieces
  (`on_hand − reserved`); refuse the rest with the name of the order holding them.
```

### DOS-354 — A trip cancelled after its load-out leaves the bill "dispatched" with no trip and its goods stranded on the van
**Status (2026-09-29): FIXED on main `1f378e6b`, not yet on the live server.** A loaded trip is not cancelled: it is checked in, and its bills come back to the dock to go out on another trip. A bill is loaded only onto the trip that carries it, a trip does not leave with a bill counted out on another load, and a trip cancelled before its load-out frees every bill. Proof: `stock-states.spec.ts` (DOS-354) and `van-trips.spec.ts`; `pnpm check:stranded` names older cases (`trip-cancelled-loaded`); the states lane's blind check 4 replayed the loaded-trip roads of S6d (cancel refused for the manager and the owner, check-in accepted, the bill delivered on a new trip).

Category: bug | Priority: P1 | Role: Manager | Platform: API

```
Steps:
  1. TRIP-0005 (van B) with INV/9013 (SO-0891, 60 pcs P10-D1, ₹6,398.00): start loading, load sheet approved and confirmed —
     60 pcs dock → van B, order dispatched, DC-0087 issued. The trip has not departed.
  2. Manager: POST /delivery/trips/{id}/cancel → 200. Trip cancelled, stop `skipped`, load sheet still `confirmed`, order still
     `dispatched`, 60 pcs on van B.
  3. Cancel the bill → 409 "order is dispatched; after dispatch the only correction is a credit note". Check in / settle the
     cancelled trip → 409.
  4. Re-plan INV/9013 on TRIP-0006 (van C) → 200. Load sheet → 409 "only a packed order can be loaded". Depart → 200 (the
     bill counts as already dispatched). Door → 400 "Only 0 pc … in Vehicle MH-05-EF-9012". Check-in: order back to packed,
     bill `undelivered`.
  5. A later trip on van B (TRIP-0009) settles and sweeps the 60 pcs van B → godown as free van stock.
Expected: a trip with a confirmed load sheet cannot be cancelled (or the cancel puts the goods back on the dock for the bill and
  the order back to packed).
Actual: as above; INV/9013 ends issued, undelivered, packed, with nothing on the dock for it (S7 D9); its 60 pieces were
  sellable van stock for 4 minutes and are now plain godown stock. A trip departed carrying a bill whose goods were on another van.
Business impact: a bill that cannot be delivered, cancelled or loaded until someone notices; the van's goods are re-sold as free
  stock; the owner's dispatched/undelivered registers disagree with the vans.
Severity: P1
Evidence: QA/evidence/p10/s6c-e-console.txt (S6d), QA/evidence/p10/s6c2-continue.json (S6d2), QA/evidence/p10/s7-desync.txt (D5, D9)
Suggested fix: `trips.cancel` refuses a trip with a confirmed load sheet (or reverses it: van → dock with holds, orders back to
  packed); `trips.depart` requires each planned bill to be on a load sheet of THIS trip, not merely `dispatched`.
```

### DOS-355 — An order packed without a bill can be loaded and dispatched, then can be neither billed, delivered nor cancelled
**Status (2026-09-29): FIXED on main `1f378e6b`, not yet on the live server.** A pack without a bill is not put on a load sheet or counted out at the gate, and no challan is issued; on the billing desk ("Packed, not billed") the desk can Unpack it or Cancel the order. Proof: `stock-states.spec.ts` (DOS-355) and `van-trips.spec.ts` (M1); the states lane's blind check 4 replayed S6e and the unpack and cancel roads.

Category: bug | Priority: P1 | Role: Warehouse / Manager | Platform: API

```
Steps:
  1. SO-0900 (12 Neelam Tooth Brush, ₹488.00): wave, pick, POST /warehouse/orders/{id}/pack with issueInvoice:false → packed, no bill.
  2. Owner: orders.cancel → 409 "is packed and billed; cancel the bill" (there is no bill).
  3. Godown: load sheet with no trip, manager approves, godown confirms → 200: order dispatched, DC-0088, 12 pcs dock → van C.
Expected: a load sheet refuses an order that has no issued bill (Rule 55 challan without a tax invoice), or the pack issues it.
Actual: dispatched with no GST invoice, no trip, no door possible; the van's next settlement swept the 12 pcs back to the godown;
  SO-0900 stays `dispatched` for ever (S7 D6, D7) and no endpoint moves it.
Business impact: goods can leave on a van with no bill and no receivable; the order is stuck in "dispatched" on every register.
Severity: P1
Evidence: QA/evidence/p10/s6c-e-console.txt (S6e), QA/evidence/p10/s7-desync-final.txt (D6, D7)
Suggested fix: `loadSheets.create` / `confirm` require an issued, uncancelled bill per order; `orders.cancel` on a packed order
  with no bill releases the dock pieces and cancels.
```

### DOS-356 — Receipts of an item with no batch number merge into one lot that keeps the FIRST expiry
**Status (2026-09-29): FIXED on main `1f378e6b`, not yet on the live server.** A receipt with another expiry date makes its own batch, so each keeps its own date on every stock screen and in FEFO. Batches merged before the fix are not split, because nobody can know which pieces are the early ones; the release check lists them as a warning. Proof: `receipt-expiry.spec.ts` (DOS-356), `rls.test.ts`, migration 0074; the bin lane's blind check 4 replayed S1b, and on migrated copies of `dos_test_p10_stock` `pnpm check:stock-negative` warned on GRN-0130.

Category: business-logic | Priority: P1 | Role: Owner (GRN) | Platform: API

```
Steps: GRN-0129 receives 144 Annapurna Garam Masala 50 g, no batch number, MRP ₹45, expiry 2027-01-06. A second GRN receives 144
  more, no batch, same MRP, expiry 2026-10-18.
Expected: the second 144 carry their own expiry (a separate lot, or the lot takes the earlier date).
Actual: one lot (variant, batch '', MRP) with expiry 2027-01-06 and 288 on hand; `findOrCreateLot` fills an expiry only when the
  lot has none. The GRN line keeps 2026-10-18; the stock does not.
Business impact: 144 pieces expire 80 days earlier than every stock screen, the expiring-soon list and FEFO believe; they will be
  sold past expiry with nothing flagging them. The same happens for a repeated batch number with a different expiry.
Severity: P1
Evidence: QA/evidence/p10/s1-receive.json (S1b)
Suggested fix: make expiry part of lot identity when the batch number is blank (or refuse a GRN line whose batch/MRP matches an
  existing lot with a different expiry and ask the counter); never keep the later date.
```

### DOS-357 — A goods receipt takes an already-expired batch into sellable godown stock without a word
**Status (2026-09-29): FIXED on main `1f378e6b`, not yet on the live server.** Goods that arrive already expired go into the damaged / expiry bin, not the godown: the count screen says so before the count, a gate finding is raised for the supplier claim, and the supplier's bill is still owed as printed. Proof: `receipt-expiry.spec.ts` (DOS-357); the bin lane's blind check 4 received an expired batch (36 pc into the bin, none into the godown, the purchase journal equal to the bill).

Category: business-logic | Priority: P2 | Role: Owner / Warehouse | Platform: API

```
Steps: supplier bill line P10-B-EXP, expiry 2026-09-23 (5 days ago), 48 pcs → GRN open, blind count, post.
Expected: refused, or received straight into the damaged / expiry bin, or at least flagged on the gate count.
Actual: 48 pcs posted to the godown as sellable (`grn` row); nothing on the GRN or its discrepancies mentions expiry. At the end of
  the lane 987 pieces of already-expired (seed) batches sit in the godown's `sellable_stock` and are counted in the rep's
  availability; ours left the godown on INV/9011 (DOS-351).
Business impact: expired goods enter saleable stock at the gate; combined with DOS-351 / DOS-261 they reach shops.
Severity: P2
Evidence: QA/evidence/p10/s1-receive.json (S1a), QA/evidence/p10/s9-reports.json
Suggested fix: GRN post routes pieces of a lot already past expiry to the damaged/expiry bin (or refuses the line) and raises a
  discrepancy the desk claims from the supplier.
```

### DOS-358 — A van can be unloaded to the godown by hand while its trip is still out, leaving the bill undeliverable
**Status (2026-09-29): FIXED on main `1f378e6b`, not yet on the live server.** Nothing is moved off or onto a van, adjusted or counted there by hand while its trip is loading, out on the road, or back but not settled; the godown counts the van off at Van check-in. Proof: `stock-states.spec.ts` (DOS-358) and `van-trips.spec.ts`; the states lane's blind check 4 tried every hand door (transfer by the godown and the owner, van to van, van check-in, adjustment, count): all refused while the trip was out, and the bill was delivered.

Category: bug | Priority: P2 | Role: Warehouse | Platform: API

```
Steps: trip on van A departs with INV/9016 (24 Neelam Tooth Brush, ₹975.00). Godown: POST /delivery/van-returns/unload van A,
  P10-G1, 24 → 200 (van → godown, ref `transfer`). Crew records the door → 400 "Only 0 pc … in Vehicle MH-05-AB-1234".
Expected: unload refused while the vehicle is on an active trip (it is the check-in's tool).
Actual: as above; the bill came back undelivered with nothing on the dock; its pieces were sellable godown stock.
Business impact: a godown mistake strands a bill on the road and releases its goods for sale; the crew cannot record the delivery.
Severity: P2
Evidence: QA/evidence/p10/s6c2-continue.json (S6f), QA/evidence/p10/wire/S6f.jsonl
Suggested fix: `trips.unload` refuses a vehicle whose trip is `loading` or `active` (code: settlement.service.ts has no trip-state gate).
```

### DOS-359 — An order can be packed and billed with no pick recorded; the bill follows the reservation, not a count
**Status (2026-09-29): OPEN.** P2, change backlog. Stock ruling 9 of 28 Sep keeps packing an order nobody picked as a desk shortcut, and the screen must say it bills the held quantities; that wording is not built yet.

Category: business-logic | Priority: P2 | Role: Warehouse | Platform: API

```
Steps: SO-0897 confirmed (24 held), never waved → POST /warehouse/orders/{id}/pack → 200, INV/9016 for 24 pcs, 0 pick rows
  (transition log shows confirmed → picking → packed in one call). Also S4c: Y's pick was refused (400) and its pack still
  billed the 60 held pieces.
Expected: the brief's "pack an order never picked" is refused, or at least needs a recorded count.
Actual: accepted; the bill and the stock move equal the hold, whatever went into the carton (the DOS-252 class: a bill for
  pieces nobody counted).
Severity: P2
Evidence: QA/evidence/p10/s6-forbidden.json (S6b), QA/evidence/p10/s4cd-reservations.json (S4c)
Suggested fix: `packs.confirm` requires an answered pick row per line (picked or shorted), or the founder rules that a desk-only
  "pack as held" is intended and it gets its own name and audit.
```

### DOS-360 — The ledgers can be emptied with TRUNCATE (and their append-only trigger switched off) by the role the API connects as
**Status (2026-09-29): OPEN.** P2, change backlog (Phase 3). No lane changed the ledgers' grants or the connection role.

Category: security | Priority: P2 | Role: — (database) | Platform: API / database

```
Steps (every statement in a transaction that was rolled back): as `dos` — the role in backend/.env's DATABASE_URL, table owner,
  BYPASSRLS — UPDATE / DELETE on stock_ledger and journal_lines → refused "… is append-only (ADR 0003/0004)"; TRUNCATE
  stock_ledger → TRUNCATE TABLE, 0 rows left inside the transaction; same for journal_lines; ALTER TABLE stock_ledger DISABLE
  TRIGGER USER then UPDATE → UPDATE 1. As app_rw in a tenant context: UPDATE/DELETE refused by the trigger, TRUNCATE "permission
  denied"; but app_rw and app_worker hold UPDATE and DELETE grants on both ledgers, and app_rw (actor warehouse) could
  UPDATE stock_balances.on_hand by +1000 with no ledger row.
Expected: append-only against every role the application can reach: no TRUNCATE path, no UPDATE/DELETE grant, balances only
  moved by the posting function.
Actual: as above. No API path rewrites a ledger row (code: only `journal_entries.reversed_by_entry_id` is stamped; cancels,
  credit notes, write-offs and reversals append).
Business impact: any code path, script or injection that runs outside `withTenant` runs as the table owner and can wipe the
  stock and money history in one statement; the protection is a row trigger its owner can disable.
Severity: P2 (production connection role not checked — this lane never touches the hosted server)
Evidence: QA/evidence/p10/s5-append-only.txt, QA/tools/p10/s5-append-only.sql
Suggested fix: run the API as a non-owner login role (migrations keep `dos`); REVOKE UPDATE, DELETE, TRUNCATE on the ledgers from
  app roles; add BEFORE TRUNCATE statement triggers; revoke direct UPDATE on stock_balances in favour of a SECURITY DEFINER posting function.
```

### DOS-361 — A packed order's pick can still be edited while its wave is live; the pick sheet then disagrees with the bill
**Status (2026-09-29): FIXED on main `1f378e6b`, not yet on the live server.** Once an order is packed its pick cannot change, online or offline; a wrong carton is corrected on the bill with a credit note. Proof: `stock-states.spec.ts` (DOS-361); `pnpm check:stranded` names older cases (`pick-edited-after-pack`); in the states lane's blind check 4 such an edit was refused online and offline, and S6g3 passes in the merged-tree replay.

Category: bug | Priority: P3 | Role: Warehouse | Platform: API

```
Steps: wave with orders A and B; pick both; pack A (INV/9021, 12 pcs); edit A's pick row down to 5 → 200.
Actual: pick row 5; bill, order line and stock movement 12. The fill-rate register reads pick rows.
Severity: P3
Evidence: QA/evidence/p10/s6g3-repick.json
Suggested fix: `applyPicks` refuses rows whose order already has a pack confirmation.
```

### DOS-362 — Stock at cost counts damaged and expired pieces at full cost, drops negative balances, and the windows disagree
**Status (2026-09-29): OPEN.** P3. Stock ruling 10 of 28 Sep (sellable stock only, damaged and expired shown apart, one 60-day near-expiry window) waits for round 3 of the owner's home.

Category: business-logic | Priority: P3 | Role: Owner | Platform: API

```
Observed at one moment (S9): the stock-value register = SQL to the paisa (89,639 pcs, ₹23,97,356.59). That total includes the
  damaged bin at full cost (₹26,960.42) and already-expired batches at full cost (₹67,571.48) with no split, and leaves out the
  138 pieces below zero (DOS-350). Near-expiry is 90 days on the home and the register, 60 days on the stock screen's list; the
  expiring-soon list (all pages) = SQL (640 rows) but 517 of them have 0 on hand and 231 are already expired.
Business impact: the owner's stock value overstates what can be sold; two "near expiry" figures that cannot be compared.
Severity: P3
Evidence: QA/evidence/p10/s9-reports.json, QA/evidence/p10/s9-reports-snapshot.json
Suggested fix: split stock at cost into sellable / damaged / expired; one near-expiry window setting; the list asks `nonZero`.
```

### DOS-363 — Seed data contradicts itself: three delivered bills never moved stock, a cancelled bill left its order packed
**Status (2026-09-29): OPEN.** P3, demo seed backlog. Every stock reconcile of the lanes and of the merged tree still starts with the three seed bills INV/9001, 9005 and 9006 (C6).

Category: tech-debt | Priority: P3 | Role: — (demo seed) | Platform: database

```
Fresh seed, before any QA action: INV/9001, INV/9005, INV/9006 (SO-9004/9005/9006, delivered, paid) billed 1,524 pcs (432 + 960
  + 132) with no stock movement and no door (reconcile C6; desync D3) — seed-demo/billing.ts writes them as "a separate B2B
  consignment … not part of the stock replay". INV/9002 is cancelled while its order SO-9001 stays packed with no live bill
  (D2, D7; pre-dates DOS-139). INV/0815 and INV/0820 are packed with no dock hold (D9, pre-DOS-247 seed rows).
Business impact: demo only, but every stock / order audit on the seed starts with differences to explain.
Severity: P3
Evidence: QA/evidence/p10/recon/00-baseline-fresh-seed.txt, QA/evidence/p10/s7-desync.txt
Suggested fix: move the three bills' pieces (pack → van → door) in the seed, cancel SO-9001 with INV/9002, hold the dock pieces
  of seed bills still packed.
```

## Observed, not filed (by design or already known)

- The godown's "damaged" adjustment (−N, reason `damage`) writes the pieces off the books; moving them to the damaged bin is a
  separate transfer. Two paths, two meanings of "damaged" (question 5 below).
- Cancelling an unstarted wave and `reservations.release` leave the order `confirmed` with no hold (documented in
  picklists.service.ts: re-held at the next wave or at pack).
- A delivery's damaged return goes straight into the damaged bin, a saleable return onto the van until check-in (DOS-195 model).
- `trips.settle` with a variance files the owner's approval in its own committed transaction and answers 409 (by design); the
  owner's own settle closes that approval (S8d).
- Order `close` is never applied; stop state `skipped` is written outside the stop machine; receipt reversal rewrites
  paid → partially_paid/issued outside `invoiceMachine` (code map; no stock effect).

## Regression

| Id | Test | Result |
|---|---|---|
| DOS-251 | Packed bill whose pieces are on a returning van (TRIP-0004 closing): cancel | PASS — 409 "came back on TRIP-0004, which is not settled yet …", no piece moved; after settlement the cancel succeeds and bill INV/9014 nets 0 across pack + cancel (S6c). Held dock pieces cannot be hand-moved or written off (409 `dock_held`). |
| DOS-252 | Line picked 0 | PASS — not billed, not moved; the godown's hold released (S2b). |
| DOS-257 | Cancelled bills must net to zero | PASS — `pnpm check:stock-cancels` on this DB: "every cancelled bill nets to zero stock" (exit 0); an extra `invoice_cancel` row that would return 12 pcs more is refused by the 0071 trigger (rolled back); bill cancels S4b and S6c net 0. |

## NOT TESTED

- Owner home stock figures (`dashboard.owner`): the lane's API ran without `DOS_MODE=all`, so the inline worker never started and
  the 15-minute rollup never ran; the home showed the seed's snapshot of 2026-09-12 (₹23,76,416.59 vs SQL ₹23,97,356.59). The
  live stock-value register equals SQL.
- Reservation or approval lapse by time: the code has no timeout (none to test).
- Concurrency (two pickers, cancel vs load-out, money vs cancel, concurrent credit drafts): Phase 13 lane. Sequentially, a second
  credit draft over the same line is refused (S6g).
- Van sale of damaged / expired pieces, and loss on the van counted at settlement: not run (time).
- Offline (sync upload) paths for picks and doors; web / Android / iOS screens: API only.

## Questions for the founder

1. Should the damaged / expiry bin ever go below zero? (It is created with negative allowed; DOS-350.)
2. What may leave the damaged bin, and who decides — scrap, return to the brand, or back to sale? (DOS-352.)
3. Expired batches at pick: refuse, as proposed for DOS-351, together with the pending DOS-261 ruling?
4. Goods that arrive already expired: refuse the line, or receive them straight into the expiry bin and claim them? (DOS-357.)
5. "Damaged in the godown": write the pieces off, or move them to the bin? Today both exist.
6. Should stock at cost on the home count damaged and expired pieces, and which near-expiry window is the owner's (60 or 90 days)?
7. Is packing an order that nobody picked (billing the held quantity) a desk feature you want kept? (DOS-359.)
