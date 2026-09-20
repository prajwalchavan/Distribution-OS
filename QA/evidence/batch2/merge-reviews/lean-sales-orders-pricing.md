# lean-sales-orders-pricing — Fable merge review (2026-09-21, after repair 3e806d7)

**First review:** no review file existed on disk for this lane; the earlier pass is the verifier's carry in `finish-wave3.js` (one major: `credit_notice` + `stock_shortages` reached the shop's own device through `sync.pull`).
**Since then:** repair `3e806d7` adds a retailer-only `omit` on the `sales_orders` pull plus a two-door spec; re-verify = pass. This review re-read the whole branch (9 commits, `main..qa/b2-lean-sales-orders-pricing`, merge-base `8b030e5`), not only the repair.

**Decision: MERGE AFTER FIXES** — two mechanical fixes the integrator places in the merge commit; no repair round, no re-verify round.

## The proven defect — closed at the cause, not moved
- `orders.module.ts:56-64` narrows the ONLY `select *` door for role `retailer` alone; `sync.registry.ts` builds manifest and rows from the same `omittedFor(role)`, so a shop device re-snapshots on the new schema hash. Salesperson/desk keep both columns (rep is a CREDIT_CHECKER, `permissions.ts:203`).
- Every other door checked on HEAD: `get`/`list`/`lastPlaced` go through `toOrder(row, office)` / `loadDetail(…, actorRole !== 'retailer')`; the shop's own SUBMIT reply too — `asSystem` (`orders.internals.ts:214-227`) flips only the DB setting `app.actor_role`, never `currentTenant()`, so `detail()` inside it still sees a retailer. No outbox/notification payload carries either field (`git grep` outside `modules/orders`: none). `retailer_outstanding_summary` (pulled by the shop) has no limit/headroom column. Not moved.
- Nothing the design approved is broken: the change is +13 lines inside one call; permissions.ts untouched; specs re-run green by the verifier (orders 51, pricing 17, billing 27, schemes 29, app specs 30).

## Blockers (exact fixes; integrator applies them in the merge commit, then `pnpm db:seed` on dos_qa)
1. **DOS-079 binding amendment (d) unmet — the seed folds cess into `tax_paise` but never writes `cess_bps`/`cess_paise`**, so every seeded aerated-drink order reads `cessPaise 0` under a tax that contains it (the manager detail's "includes cess ₹X" never shows; the column's definition "cess_paise is the cess share" is false on seed rows). Neither seed file was touched by the lane although the design named both.
   `backend/libs/database/src/seed-demo/sales.ts:949-951` — beside `gstBps: v.gstBps, taxPaise: lineTax` add `cessBps: v.cessBps, cessPaise: percentOf(paise(taxable), v.cessBps)` (the same figure `taxOn` :470-473 folds in); the header at `:1038` (`taxPaise: built.tax`) adds `cessPaise: built.cess` with `cess` summed per line in the builder that yields `built.tax`.
   `backend/libs/database/src/seed-demo/billing.ts` — order headers `:466`, `:607`, `:797` add `cessPaise: priced.cess`; order lines `:489`, `:629`, `:820` add `cessBps: <the variant in scope>.cessBps, cessPaise: priced.cess`; treat `:1140`, `:1392`, `:1415` the same if they are order rows (invoice rows already carry `cessPaise`). Touch nothing else in those files (amendment d).
2. **docs/22 rows the design listed and the lane's own brief promised in-slice are absent (`git diff` on docs/22: empty).** Add, then the main session runs `python3 docs/tools/render-source-of-truth.py` and republishes:
   §8 (2026-09-13, architect enforcement, not a new decision): "An order beyond the godown's stock confirms SHORT and the shortfall is recorded on the order (`stock_shortages`), office-only, visible to the desk before pack — never a cap, never a new gate (QA DOS-078; UX-00 §6.4, §4 W4)."
   §11: "DOS-079 correction — an order's `tax_paise` is GST plus compensation cess (`cess_paise` the share), so the rep's total is the bill's; DOS-083 — the rep reads the payable (GST and cess in) before placing; DOS-090 — a rate request keeps the phone's draft id; the desk reads 'Not placed yet'."
   §10 open question: "Should a rate request tied to a draft that is never placed lapse on its own, and after how long? (DOS-090 — no auto-expiry in batch 2: it would break the DOS-005 gate/request pairing.)"

## Minors (record; fix when convenient)
- Four expand migrations `0048`–`0051` instead of the one amendment (c) asked for; harmless, expand-only, `_journal.json` idx 48-51 consistent with main's tip 0047.
- DOS-078 (c) asked for one test per confirm path: submit auto-confirm and desk `orders.confirm` are pinned; the `ApprovalsService.decide` → `confirmInTx` path is not (same function, low risk). The shop's own submit reply (`orders.spec.ts:771`) does not assert `stockShortages []` / `creditNotice null` — two lines to add.
- `frontend/owner-app/src/lib/bargain-order.ts` is an untested twin of the manager's (5 tests); mirror them or accept.
- `approval_flags` (a gate NAME such as `credit_limit`, never a figure) still reaches the shop on both paths — pre-existing, consistent with the DOS-100 answer (gate, not a figure); recorded, not fixed here.
- DOS-083's `pricing.quote` runs once per basket change while online (30 s stale). Bounded by taps; acceptable under docs/20, noted.

## Conflicts
- `orders.module.ts` is a cross-lane edit (13 lines, disclosed); no live lane owns it — place it as is.
- Sibling unmerged lanes each carry their OWN `0048`/`0049`: manager-order-lifecycle (`0048_list_date_indexes`, `0049_pick_lines_cancelled_at`), retailer-platform (`0048_inbound_reports_*`), warehouse-rules (`0048_grns_supplier_*`). Whichever merges after this lane renumbers to `0052+` and regenerates its snapshot; `_journal.json` merges textually but idx/tag must stay unique. `git merge-tree main…branch` is clean today.
- READMEs: generated at `c34843b`; the later DOS-090 commit changed contract DOC text only, which the renderer does not print (verified: no field descriptions in the README) — `docs:readme:check` should pass; run it once on the merged tree.

## Walks (owed at the lean gate, after blocker 1's re-seed)
- DOS-079 (web): sales app places Campa Cola 750 ml; manager opens it — Tax + "includes cess ₹X"; warehouse packs; manager invoice total == order total. Seeded Campa orders show the cess line too.
- DOS-078 (web + Pixel 7): 12 cs of a 10-cs item + 1 cs zero-stock → placed panel names both; manager list "Short 2", detail lists the lines.
- DOS-081 (web + Pixel 7): Navjeevan (warn, over) ochre chip before, "Order placed" after, manager "Over limit · warn only"; Shree Ganesh (strict) brick chip, "Held for credit", manager "Over limit · held"; shop card headroom line online, "Owes X of Y" offline. Retailer app on Android: a warn shop places an order — nothing about credit anywhere; first sync after merge re-snapshots (schema hash), watch it land.
- DOS-083 (web 1280 + 390, Pixel 7): footer "the shop pays · net + tax GST (and cess)"; offline → "before GST"; the chip says "(before GST)" only then.
- DOS-087 (web): 2 cs Annapurna Atta → −₹30 on the phone and on the placed order; owner prices "Per case/piece off: ₹15.00"; retailer shop card sentence.
- DOS-090 (web + Pixel 7 + iOS for the rep flow): fresh draft, ask a rate over the bound → manager Rate requests "Not placed yet — on the rep's phone · asked …" with no link; place → the row becomes the gate naming SO-xxxx; owner Approvals same, no "Open order" button on the request.
- Lane smoke (reshaped gate): `pricing.quote`, `orders.submit/get/list`, `receivables.creditCheck`, `pricing.bargains.request/list`, `pricing.schemes.upsert` with `per_unit_amount`, and `sync.manifest`/`sync.pull` as the retailer read OK on a fresh seed and on replay; no new BROKEN against main.

## Defects outside this lane
- `sync.coverage.spec.ts` sweeps only cost/margin/landed/purchase/ptd: add a retailer-role assertion that no pulled table carries credit/outstanding/limit/headroom columns (DOS-072 and this leak were both invisible to it).
- Owner `o5.tax` and retailer `r7.gst` still read "GST" while holding GST + cess on aerated drinks (manager's was renamed to "Tax" in-lane).
- Sales app `orders/[id].tsx` does not list the order's shortages (design note: the owning group's follow-up).
- `approval_flags` reaching the shop — decide once whether a gate name is fine for the retailer app (see Minors).
