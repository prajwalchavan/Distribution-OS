# DOS-009 — list order: is a dated register an exception to the server-time rule?

Fable, architect, 2026-09-21, in the founder's seat by his instruction ("go as per your (FABLE's) recommendation"). Read-only; this file is the only write.

## The question
Founder's rule (docs/22 §8, 2026-09-20, QA DOS-023): every list orders by server time, newest first, id only as tie-break. Lane lean-manager-order-lifecycle (1d934ed) put orders on `created_at` but bills on `invoice_date` and trips on `trip_date` — the column each list's own from/to window filters — and recorded it as "one stated exception, put to the founder". Exception, or misreading?

## What I read
docs/22 §4, §6, §8 rows 324/335, §11 line 408; QA/findings/01 DOS-009 (owner: "Bills: 21 Aug, 14 Aug, 10 Sep …", asked for date order), 02 DOS-023, 08; the lane design (verdicts/lean-lean-manager-order-lifecycle.md §DOS-009); commits 1d934ed, deb93b5 (stops), bdd6055 (sheets), 16f1f4e (packs); the queries orders.internals.ts:340-363, invoices.service.ts:900-931, trips.service.ts:290-320, picklists.service.ts:381-401; contracts billing.ts:531, delivery.ts:783/909, orders.ts:311; schema billing.ts:62/119, delivery.ts:181/202, orders.ts:158, migration 0052; screens O13, M12, O18 (Date column = invoiceDate/tripDate under a 7/30/90/FY window on the same date) and delivery-app trips.tsx:14-70; billing.internals.ts:141 (`invoice_date` = server business date at issue; only brand-DMS and opening bills carry their own); seed-demo billing.ts:473 (created_at is back-dated too, so demo data decides nothing).

## RULING
**Every list orders newest first on the same column its own from/to window filters — server time `created_at` for a queue of work (orders, sheets, packs, stops), the document's own stamped date for a dated register (bills `invoice_date`, trips `trip_date`) — with the row id only ever breaking a tie; a list is a dated register only when its reader reconciles it against a book kept by that date (the GST return, the day's trip plan).**

The lane's build is right and stays. It is not an exception to the founder's rule but the rule read at the grain of the register; there is no second rule, only the one sentence above.

## Reasoning
1. What the rule was for. DOS-023 was born from ids: a device mints the id when a row is typed, so id order jumps after a sync and a seeded hash outranks today. "Server time" was the founder's word for "the server's own truth, not the client's id". `invoice_date` IS that truth: `invoiceDateOf()` stamps `businessDate()` at issue and no pack caller can back-date it; the only bills carrying another date are brand-DMS and opening bills, whose date is the LEGAL date the register is kept by. `trip_date` is the plan date the desk sets, and trips are planned ahead by design (the crew's "today's trip" is often tomorrow's, delivery-app trips.tsx:14-17).
2. What the reader looks for. The accountant standing on August (O13/M12, one page with `gstSummary` for the same span) looks for the 14 Aug brand bill UNDER 14 Aug, where GSTR-1 has it — not on top of 31 Aug because it was typed on 21 Sep. A trip planned today for Friday belongs above Thursday's on the plan. `created_at` would put a row where no column on the screen explains its place.
3. Paging. (date, id) is a total order, so the keyset is exact: nothing skipped or repeated within a walk; a late row lands at its date — below the cursor it appears, above it waits for the next load — the same guarantee `created_at` gives, landing where the register expects. The lane's clause "filtered on one column and ordered by another cannot page" is wrong as stated (the founder's own picklists list windows on `pick_date` and pages on `created_at`, correctly); what is true is that such a list READS wrong when the two columns disagree — exactly the dated-register case, never the queue case.
4. The tie-break stays the id. Within one date a UUIDv7 id is minute-accurate typing order; nobody reads a day's bills by the minute, and a third keyset column (index + cursor subquery) buys nothing.
5. Moving everything to `created_at` would: force the window to move with it (or visibly invert the register), so the bills and the GST summary on the same page would disagree about which bills are August's; put the crew's week-ahead list out of plan order; add two indexes and change the meaning of `from`/`to` on two contracts; and leave a rule a developer can only satisfy by breaking the register. Nothing the founder asked for is gained.
6. Third answers. "Say so on the screen": the Date column is the second column and the window chip names the dates — that is saying so; the kit's Register has no sort control and a glyph is a kit change for no ambiguity found. "Window on `created_at` too": rejected in 5.

## What must change in code (small; no query, index or wire change)
- contracts: one JSDoc sentence on `OrdersListInput`, `InvoicesListInput`, `TripsListInput` stating the order and its window column, as `StopsListInput` (delivery.ts:909) already does; then `pnpm docs:readme` (CI runs `--check`).
- frontend/delivery-app/app/trips.tsx:52-70: delete the comment claiming the server has no date ordering (false since 1d934ed) and the client-side re-sort — a screen that silently re-sorts is the second rule this ruling forbids.
- docs/22: §8 row 324 reworded to the RULING sentence as the founder's decision delegated (2026-09-21), the "put to the founder" clause gone; §11 change-log line; `python3 docs/tools/render-source-of-truth.py`; republish.

## How it is proven
The three DOS-009 specs already prove order and cursor walk (orders.spec; billing.spec:1816 with a brand bill dated yesterday whose id sorts higher; delivery.spec:3897 with a trip planned ahead) plus deb93b5's stops spec — they stay green untouched. After the slice: `pnpm docs:readme:check`, frontend `pnpm lint && pnpm typecheck`, and one browser look at O13 with a window containing the seeded brand bill's date: it sits at its date, not on top.

## Left alone, deliberately
- picklists.list (DOS-023, founder-approved): window `pick_date`, order `created_at`; the desk makes a sheet for today (fulfilment/index.tsx:102), so the two never disagree at day grain. Not reopened.
- `trips_date_idx` stays (tenant_id, trip_date); the id tie-break sorts per date group in memory — trivial per tenant per day. Widen only if a plan shows a sort node.
- The unwindowed open-trip boards (manager fulfilment/trips.tsx, warehouse load/trips.tsx) read the register order; a board wanting "next trip first" is a screen question, not this one.
- Four lists still on `desc(id)`: credit notes (window `note_date`), deliveries, collections, trip expenses (windows `delivered_at`/`collected_at`/`recorded_at`). The one sentence resolves each — sort on its window column; file as a new finding, not this slice.
