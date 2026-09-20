# Merge review — lean-warehouse-rules (DOS-045, DOS-050, DOS-054) — Fable, 2026-09-20

Branch `qa/b2-lean-warehouse-rules`, three commits 25ca6c9 · 26e59f1 · 0a11085, merge base 20c3d59; `git merge-tree` against main 787181c is clean. Read-only review of the full diff (31 files, snapshot excluded), the binding design `verdicts/lean-lean-warehouse-rules.md`, the three findings in `findings/03-walkthrough-warehouse.md`, and the overlap with every unmerged lane.

**Decision:** MERGE AFTER FIXES

## Blockers

1. `backend/libs/core/src/modules/inventory/inventory.service.ts:424` — a blank setting switches the rule OFF while the owner's screen says 30. `frontend/owner-app/app/settings/index.tsx:569` renders `valueOf(key) || '30'`, so an owner who clears the field sees "30" snap back, but `edits[key]` is `''` and Save (`settings/index.tsx:418`, `Object.entries(edits)`) writes `""` to `tenant_settings`; the reader does `Number('')` = 0, which passes `isSafeInteger && >= 0` and is the documented "rule off" value. Amendment (g) says an integer ≥ 0; a blank is neither. Exact fix, one line: `const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN` — blank then falls to `DEFAULT_MIN_SHELF_LIFE_DAYS`, which is what the screen shows. Add one assertion to the existing 'absent setting row reads as 30' spec: write `'""'::jsonb` and expect 30.

## Minors

- `grn.service.ts:230` — `open()` is the one GRN reply not wrapped in `blindGate()`; safe today only because `open` is `requireRole(MANAGEMENT)`. Wrap it so amendment (d) holds unconditionally.
- `inventory.service.ts:458` — `reserve()` reads the setting once per ORDER LINE (the orders module calls it per line); design (d) says once per request. Fold a `cutoff` into `ReserveInput` when the orders module is next open.
- `inventory.service.ts:463` / `warehouse.internals.ts:209` — with `days = 0` the cutoff is today, so an already-expired lot sorts LAST, not first as plain FEFO did (`sellable_stock` does not filter expired lots). Safer, but not what amendment (g) says; one sentence in the setting's doc, or skip the leading sort key when days = 0.
- `frontend/warehouse-app/app/pick/[id].tsx:84` — the brick chip comes from an online `picklists.get`; in the shed this screen exists for, only the amber badge shows. Declared and defensible (nothing invented client-side); the design's "haptics.warning, warning strip" clause has no home — no lane adds a warning surface to the pick screen (checked lean-warehouse-pick and lean-manager-order-lifecycle).
- READMEs not regenerated (`pnpm docs:readme:check` fails on the branch: nine contract shapes changed); docs/22 §11 and docs/23 §10 rows not written. Both are the integrator's merged-tree steps (precedent b257e4e, STATE queue item 4) — do them in the merge commit.
- `procurement.spec.ts:327,954` — `/rate|taxable|paise|cost/i` also matches "generated", "separate", "operate"; harmless today, brittle. Anchor to field names (`ratePaise|taxablePaise|costPaise|totalPaise`).
- The blind count is blind on the wire only: the warehouse device still pulls `stock_balances` (`inventory.module.ts:42`) and reads `inventory.stock.balances`. Recorded in the design's notes as a docs/22 §10 product question; not this lane's to change.

## Test integrity

Not weakened. The one edited existing test (`inventory.spec.ts` 'runs a cycle count…') moves the expected/variance assertions from the warehouse actor to an owner GET, exactly as the design makes the warehouse blind — the figures are still asserted. Nine new specs cover every red case the design lists; DOS-045 guard (count-time expected kept per line), DOS-050 guard (null supplier columns), DOS-054 guard (setting 0) are all present. Files touched outside the group's list are the four the design names plus `seed-demo/stock.ts` (design §F) — nothing else.

## Conflicts

- **Migration index 48/49 is claimed by FOUR lanes**: this one (`0048_grns_supplier_expand`, `0049_grns_supplier_guarantees`), `lean-manager-order-lifecycle` (0048/0049), `lean-retailer-platform` (0048/0049), `lean-sales-orders-pricing` (0048–0051). `merge-tree` confirms add/add on `meta/0048_snapshot.json` and content on `_journal.json` with all three. Whoever merges after the first renumbers its SQL files and `_journal.json` entries to the next free index and DROPS its `0048_snapshot.json`; after the last migration lane lands, the highest-index snapshot must describe the whole merged schema — prove it with `pnpm db:generate` reporting no changes on the merged tree, otherwise the next generate re-emits `ADD COLUMN supplier_id`.
- `lean-manager-order-lifecycle`: content conflict in `warehouse.spec.ts` (both append at the old EOF, line 2316 — keep both blocks). Semantic, not textual: that lane adds `pick_lines.cancelled_at`; after both merge, `liveWaveByOrder` (`picklists.service.ts:783`, WHERE at :799) must add `isNull(pickLines.cancelledAt)` so a put-back line neither keeps an order on a "live wave" nor counts in `pickedQtyPcs`.
- `lean-warehouse-pick`: same three files (`pick/[id].tsx`, `warehouse-app/src/strings.ts`, `warehouse.spec.ts`), merge-tree clean both ways; the design asked for a rebase on it that did not happen — re-walk the pick screen after both are in.
- `lean-retailer-platform` / `lean-delivery-collect` / `lean-owner-money-approvals`: shared `tenant-bootstrap.ts`, `tenancy.ts`, `owner-app/settings/index.tsx`, `owner-app/strings.ts` — clean merges.

## Walks still owed (none run: dev servers forbidden in the lane)

- Warehouse web 1280 + Pixel 7: Counts → open → key numbers → save, network reply carries `expectedPcs: null`/`variancePcs: null`; Inbound → GRN count → Findings shows damaged only; Held rows read "For SO-… · shop · pieces · batch"; Pack shows BEING PICKED "676 of 750 pc" and READY TO PACK only fully picked, dialog names "74 pc short"; Home gate row "GUR/26-27/… · Guru Kripa · 4 lines"; pick screen shows the brick "Under the 30-day rule" chip on the 16-day lot and the warning after picking it; nothing on these screens shows a rupee.
- Manager web: Inbound → Gate count still prints "Expected N" after a line has a count; desk sheet shows the flagged line.
- Owner web: Settings → Business → set 30 → Save → reload shows 30; set 0 → the chip disappears; clear the field → Save → (after the blocker fix) reload shows 30 and the rule is still on.
- Smoke, reshaped gate: `procurement.grns.*`, `warehouse.queue.list`, `warehouse.reservations.list`, `warehouse.picklists.get` read OK on a fresh seed and a replay; no new BROKEN vs main.
- iOS: not walked by any lane; sanity boot of the warehouse and owner apps in Expo Go once merged.

## Defects outside the group

- `frontend/owner-app/app/settings/index.tsx:418` — Save sends every edited key verbatim, so a cleared field writes `""` for ANY setting on the Business tab (`delivery.pod_required` at :549 shows `|| 'credit_only'` the same way; `dpdp.gps_retention_days` at :556). Each reader copes differently; the screen should drop blank edits or send the placeholder it displays. Not filed by this lane; belongs with the owner-desk lane.
