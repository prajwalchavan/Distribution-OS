# Lane h11-syncpull — architect merge review (Fable, 2026-09-13)
**Decision:** MERGE

One commit (38032df), seven files, no contract / permission / schema / README change. Read in full: the `pull()` rewrite (`sync.service.ts:322-407`), `tablePull` + `readTombstones` (`sync.registry.ts:347-589`), both spec diffs, docs/07, docs/27, `engine.ts` (comment only). Row counts taken read-only on `dos` and `dos_qa`. No build or test run here.

**Why it is right.** The page is now the `limit` earliest instants across the read set, ties completed, cursor = last instant delivered. I walked the invariant "every table is complete up to `cut`" by hand: a saturated table is complete to its watermark and `cut <= wm.at` (`:385`); a table read under `until` is complete to `until`, and the final `held[limit-1]` can only move earlier than any `until` it set (`:368-372`), so `cut <= until`; an unsaturated table read without `until` is complete outright. Rows AT the cut are delivered by `onPage`'s `<=` and excluded next call by SQL `> since`, so once and only once. `held` counts only non-empty instants, `until` is strict `>`, `readTombstones` keeps ids and instants paired after the survivors filter while the watermark keeps the table's true read depth (`:587`). The `wm.at > sinceText` string compare (a real stall when `since` came from a millisecond `asOf`) is gone. The verifier's 220-op randomised probe at ten page sizes plus the four fail-first tests are the evidence I would have asked for.

## Blockers / majors (must be fixed before merge)
none

## Minors (may follow)
- Amendment (c)'s literal outcome ("drains the global catalog at most once per file") is not met: the value-shape test and the four cost-column halves still drain the whole read set. Acceptable: those assertions loop every table, naming tables would narrow them, and the cost is one 500-row page per drain — `dos` holds 54 global catalog rows (6/18/30), `dos_qa` 271, both far under one page. Whole file 3.0 s on the verifier's database.
- Pinned path (`sync.service.ts:378`, only past `TIE_COMPLETION_LIMIT` = 2000 rows in one microsecond of one table) now ships up to `tables × (limit+1)` rows untrimmed with the cursor held; before it was `limit/N` per table. Unreachable with `clock_timestamp()` per row; leave.
- `MICROSECOND_INSTANT` guard (`:388`) is unreachable through `tablePull` (every instant is `to_char`); it was proven only by the verifier's deleted probe. The sync.spec.ts pin covers the empty-instant path. Fine as a belt.
- docs/07 §0 client-contract item 4 (`docs/07-offline-sync.md:35`, "carries no tombstones") is true per call but should echo the docs/27 §5 clause "the first page of a snapshot carries none; later pages carry a cursor and may". One-line doc follow-up.
- `sync.coverage.spec.ts:600` comment "one change per shape … a global table" was stale before this lane (the test changes only `locations` and `stock_balances`); harmless.

## Amendments — satisfied? evidence
- (a) Cursor guard — YES. `held` takes only truthy instants (`:365`), `until` on strict `held.length > limit` (`:368`), `cut` failing the microsecond regex pins with no trim (`:388`, cursor `cut ?? sinceText ?? EPOCH` at `:405`). Pinned by the new sync.spec.ts test (desk_only cursor accepted, beats+desk_only at limit 1 delivers each beat once, every page 200).
- (b) Stale client comment — YES. `engine.ts:432-441` comment only ("about 25 … 265 before DOS-080"); no code; frontend `format:check` green per verifier.
- (c) Drain cost — YES with the documented deviation above. Tables named in the shop/tier, bill, delta (all five drains) and moved-row tests; `pagesOf` throws past 200 pages; every refactor is `pullOf → drainOf` (+ named tables) with no `expect()` altered — I diffed each. On the unfixed tree the six refactors pass and only the four DOS-080 tests fail, so they encode nothing of the fix.
- (d) docs/27 §5 item 2 — YES, single-line change; §15 untouched.
- (e) Merge-time re-run — DONE on the lane (25/25 coverage incl. both DOS-166 tests; 9/9 sync.spec incl. the 42501 test). Still OWED on main after the merge (below).

## Merge conflicts with main and how to resolve
None. `git diff 502a85e..main` touches none of the seven files. None of h12-kit, h8-billing, h10-console, h13-owner-support (or h7-syncdoor, already in the base) touch `modules/sync`, `docs/07`, `docs/27` or `engine.ts`. No hand-written pull handler exists on any branch (all 37 registrations go through `tablePull`; the one `handler:` hit on main is `tenant.guard.ts:289 routeOf(handler: object)`), so the new required `PullResult.at`/`deletedAt` cannot break a merging branch's typecheck. Plain three-way merge, no overlapping hunks.

## What the later fixes must build on
- Page semantics are now: `limit` earliest changes across the read set, ties completed, cursor = last instant delivered; `until` bounds the rows query, the tie query and the FIRST tombstone query. A new pull handler must either use `tablePull` or fill `at`/`deletedAt` honestly (`''` = rides on every page, never cuts).
- Never shrink a later table's limit by what is held; the follow-up for memory pressure is an instants-first two-phase read (plan risk 3). Worst case in memory per request stays 37 × 501 rows for the desk, bounded by `limit ≤ 500` (`contracts/src/sync.ts:234`).
- The final-page cursor is still `asOf − 5 s` (`:404`) and may land BEFORE the previous page's cut: the next delta re-sends up to 5 s of rows (upsert, free). Do not "fix" it monotonic without keeping the overlap.
- Held DOS-032+059 changes the receipts manifest hash; delivery and retailer devices re-snapshot once, now ≤ ~25 calls.
- The verdict's three new findings (sign-out wipe P1, unnarrowed catalog P2, dev COOP/COEP P3) are unblocked by this lane and should be filed.

## READMEs that will change
None expected: `SyncPullInput`/`SyncPullOutput`, `PERMISSIONS`, schema and the published `sync.pull` example are unchanged. Run `pnpm docs:readme:check` on the merged tree to confirm.

## Regression walk, API probes and SQL
Owed by the merge step (this review ran nothing): `pnpm --filter @dos/core build`; on main after merge run `sync.spec.ts` and `sync.coverage.spec.ts` whole, one file per command (amendment e); `pnpm docs:readme:check`; restart services on dos_qa (`QA/tools/start-services.sh`).
- Web :5175, rahul.deshmukh, fresh sign-in: group `GET /sync/pull` in `~/.dos-qa-logs/logs/sales-service.log` by deviceId (a run starts at a call without `since=`). Expect ONE run of ≤ 25 calls (ceil((11 968 + 2)/500)+1; baseline 257-277), every non-final response ≈ 500 rows+deleted, decoded cursors stepping by hundreds of rows. Reload `/orders/new`: ≤ 25 (memory-store re-snapshot, docs/27 §2). Idle 2 min: exactly 2 polls.
- Android `Pixel_7_API_36 -memory 3072`: `adb shell pm clear in.distributionos.sales` → sign-in → one run ≤ 25; force-stop + relaunch → exactly one pull carrying `since`.
- Warehouse dinesh.patil :5176 and delivery ganesh.more :5177: first sync ≤ ceil(R/500)+1 with R counted for that role's tables in `sync-tables.ts`; no 4xx on `/sync/pull`; an upload after the pass is accepted (door untouched).
- `pnpm smoke --service sales --only GET` → 0 BROKEN.
- SQL / content: capture one run (Playwright or DevTools), dedupe by (table, manifest primaryKey) — no pair twice; per tenant-wide table the deduped count equals `select count(*) from <t> where tenant_id = '01a0947d-7a79-75d2-bfff-97e499a58d49'` (beats, price_lists, price_list_items, tenant_products, schemes, …) and for manufacturers/brands/products/product_variants `select count(*)`; beat-narrowed tables (retailers, retailer_links, visits, sales_orders…) equal the b59bbf0 baseline capture. Shops list, order-entry catalog with prices/schemes and an existing order's lines equal the baseline.

## Defects outside this lane
- P1 `frontend/libs/offline/src/engine.ts:200` — `wipe()` has no caller; sign-out keeps the previous user's rows and cursor, and the store name is per app, not per user (`frontend/sales-app/app/_layout.tsx:299`, delivery `:299`, warehouse `:305`). A second rep on the same phone never receives their own beat's rows older than the inherited cursor.
- P2 scale `backend/libs/core/src/modules/catalog/catalog.module.ts:30-33` — the four global catalog tables are pulled unnarrowed by every device; at lakhs of SKUs this dominates every first sync.
- P2 `backend/libs/core/src/modules/sync/sync.service.ts:385` — a mid-pass cut carries no overlap: a row stamped by an in-flight transaction before the cut and committed after the read is skipped unless the pass ends within 5 s of it (pre-existing since the watermark cursor; a horizon from `min(xact_start)` of active backends, or a mid-pass overlap, closes it).
- P3 docs `docs/27-offline-sync-client.md:36` — says the dev server sends COOP/COEP; nothing in `frontend/` sets it, so every `expo start --web` walk runs the memory store and re-snapshots on reload.
