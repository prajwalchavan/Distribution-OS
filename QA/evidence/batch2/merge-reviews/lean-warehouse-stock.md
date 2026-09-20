# Merge review — lean-warehouse-stock (warehouse) · branch `qa/b2-lean-warehouse-stock`

Reviewer: Fable (architect). Read-only. Base = main `1d993b4` (merge base is main's tip: no drift). Six commits, 15 files, +682/−39.
Items: DOS-048, DOS-121, DOS-140, DOS-049, DOS-052, DOS-072. No design file existed; judged against the binding group notes in
`QA/evidence/batch2/lean-groups.json` and the six finding records.

**Decision:** MERGE

## Why it matches the design and the product rules
- DOS-048 `inventory.service.ts:178-222,232-236`: item/batch/location names and the live on-hand are read BEFORE the write, so the
  CHECK-aborted transaction no longer eats the words; ids stay in `data`. Two indexed reads per `post()`, never per entry; every
  caller (grn:399, cycle-counts:231, stock:322/340, settlement:188/203, load-sheets:458, credit-notes:494, invoices:1724) passes one
  batched array. RLS is `tenantReadPolicy` on lots/balances/locations, so every role that can post can read the labels.
- DOS-140 `stock.service.ts:209-214`: godown rows always; a `vehicle` only when it is the `locationId` asked for; damaged /
  in_transit / customer never, named or not. No migration, no other caller of `sellable()` in the backend; the only app caller is
  D6 van sale, which already passes its vehicle id (`delivery-app/app/stop/[id]/van-sale.tsx:108`). `stock.balances` untouched.
- DOS-121 W7: one blind count per `source='van'` lot in the existing manifest list (no second panel), confirm blocked with
  "Count the van-sale stock first", zero left off the payload — which is exactly what the server does with an absent lot
  (`load-sheets.service.ts:437-470`: `countedVanStock` REPLACES `van_stock`, only counted lots move).
- DOS-049 W7: `cartonsVisible = !draft || counted !== null`; `order.packages` drawn once. W9: rows filtered to `onHand > 0` — the
  pad behind a 0-row is a `stock.transfer` off the vehicle, which could only ever be refused, so nothing is lost.
- DOS-052 + DOS-072: `toView` returns `RetailerPublic` to warehouse and delivery (union already in the contract, no README change);
  the delivery pull omits the four credit-term columns and keeps `credit_mode` through the same `omit` that builds the manifest
  (`sync.registry.ts:352-434`), so the schema hash changes and devices re-snapshot; `LocalRetailer` in the delivery app already
  carried only `credit_mode`. The warehouse inbox is `recipient_user_id = actor` for both `list` and `get`; the crew is not narrowed.
- Never-list respected: `warehouse.spec.ts` and `load-sheets.service.ts` untouched; no contract, migration or README change.

## Tests: would fail without the fix, not weakened
- inventory.spec DOS-048 asserts `15 pc`, `Makhana 12 g`, `L2`, `Godown`, no UUID pattern, ids in `data`; DOS-140 asserts the
  five places on the books but only the godown offered, the van only when asked, `[]` for the bin by name.
- The pre-existing "below zero" test moved its two id assertions from `message` to `data` — same ids, still asserted.
- availability.spec DOS-074: 64 → 49 and `{godown, secondGodown}` is a consequence of DOS-140 (fails against pre-fix code with
  "expected 64 to be 49"); its point (availability 38 ≠ summed per-lot read) still bites.
- retailers.spec, notifications.spec and sync.coverage.spec each assert the absence for the field roles AND the presence for the
  desk/rep, so a regression in either direction is caught. W7/W9 are source-guard specs (house pattern), not executed screens.

## Blockers
None.

## Minors (no merge hold; fold into the walk lane or a later tidy)
1. `inventory.service.ts:184-190` `lotLabels` selects `productName` and never uses it; the label is the variant name alone
   (the finding's example wanted product + batch). Consistent with every screen (`lot.variantName`), so acceptable — drop the dead column.
2. DOS-052 delta from the finding text: the finding asked to keep `creditMode` for field roles; the design's public shape drops it from
   `retailers.get` and routes it to the crew via the pull. docs/23 §4.3/§5.3 say so. `cashDiscountBps/Days` stay (public by contract).
3. `availability.spec.ts` is outside `ownsFiles`; confirmed no group owns it (grep over every `ownsFiles`), so no lane is displaced.
4. DOS-121's docs/23 W7 paragraph rode in the DOS-049 commit (`55aec88`); code is one commit per item.
5. No walk was run (environment rules). The DOS-121 positive path — a sheet with van stock confirmed from W7 producing one
   transfer_out/transfer_in pair per counted lot — is proven server-side only (`warehouse.spec.ts:930-1065`), never from the screen.

## Conflicts
- With main now: none (merge base = main tip `1d993b4`; `git diff --check` clean).
- With unmerged lanes: `lean-sales-rep` overlaps `docs/23` and `lean-warehouse-pick` overlaps `warehouse-app/src/strings.ts` —
  both merge clean by `git merge-tree`, and neither touches W7/W9, retailers, messages or `sellable` semantically. `lean-manager-money`
  and `lean-orders-panels`: no overlap. This group's `waitsFor` names lean-warehouse-pick and lean-sales-rep, still unmerged; nothing
  in either changes what this group relies on, so merging ahead of them is safe.
- Lanes that wait on THIS group and must rebase after it lands: `lean-warehouse-rules` (inventory.service.ts, inventory.spec.ts,
  strings.ts), `lean-manager-order-lifecycle` (strings.ts), `lean-retailer-platform` (notifications.spec.ts), `lean-kit-polish`
  (DOS-122 rewrites the W7 confirm dialog this branch's `blocked`/`disabledReason` feeds).

## Walks still owed (web desk 1280 + phone width, Android Pixel 7; iOS Expo Go sanity on W7 — iOS is the unproven target)
- W7 with a van-stock sheet built through the API (`loadSheets.create` with `vanStock`, approved): rows read "Not counted yet", tap →
  pad → "Counted N", confirm blocked until all counted, then ONE transfer_out/in pair per lot in `stock_ledger`, `van_stock` = the
  count, challan lists the counted lots; a lot counted 0 neither moves nor appears. Blind cartons: no "Cartons N" until keyed.
- W9: no "0 pc" row; a positive row still transfers back. W12: inbox shows only the loader's notices (seed a notice if none).
- W6 pack: shop name still on the carton with the public shape. Delivery: device re-snapshots on the new schema hash and the stop
  still shows credit mode + dues; D6 van sale lists only its own vehicle's lots. Adjust −100 on a 5-pc lot on W8: the sentence, not a UUID.

## Defects outside this group (not filed)
- `backend/libs/core/src/modules/warehouse/load-sheets.service.ts:437-470, 511-512` — `confirm` never checks that a
  `countedVanStock` lot is in the sheet's drafted `van_stock`, nor that the count is within it: any lot with godown stock can be moved
  onto the vehicle under an approved sheet, `loadValuePaise` is silently recomputed, and `pinVerifiedBy` is kept whenever the CARTON
  count matches — the manager's PIN then covers van stock it never approved. The package variance needs a note; the van-stock variance
  needs nothing. Owner: lean-warehouse-pick / lean-manager-money (file as a new P3 finding; W7 only sends the sheet's own van lots).
