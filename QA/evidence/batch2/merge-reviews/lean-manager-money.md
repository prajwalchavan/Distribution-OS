# Merge review — lean-manager-money (DOS-035, DOS-036, DOS-038, DOS-136, DOS-141)

Branch `qa/b2-lean-manager-money`, five commits 454d436..95c0cdb on main 5f710dc (fast-forward). Reviewer: Fable, 2026-09-20. Read-only: diff, group note §10, the five finding texts, the kit rule, the contracts, the idempotency guard, `useMutation`.

**Decision:** MERGE

## Blockers

None.

## What was checked, and holds

- DOS-035: `overdueAmount` = `formatINR(paise())`, the manager home's own line (`app/index.tsx:284`). Test `6_042_250 → '₹60,422.50'`.
- DOS-036: no contract change — `RetailerLedgerOutput` already carries `openingPaise`, `debitPaise`, `creditPaise`, `balancePaise`, and `'opening'` is in `RetailerLedgerKindSchema`; `word.opening` = "Opening balance" exists. Opening row first, dated the window's `from`; the panel now reads the same 90-day window `statements.send` queues, so the message and the panel agree (finding's "send should produce the same").
- DOS-038: `SHOP_COLUMNS` makes `name` the identity, `mode` the chip, `limit` a detail; the kit's narrow rule (`web/list.tsx:514-516`, `native/list.tsx:394-396`) is exactly identity / first value / chip, so the phone row is "name · policy". Desk table ignores priority, so the desk is unchanged. Kit untouched.
- DOS-136: `intentHash` is a sorted-key JSON of the INPUT and `meta.id` is kept for the same input, so a `depositIntent`/`bounceIntent` made when the dialog opens gives a byte-identical retry; credit-note and docint line ids are held per bill/document through `keepIds`; `receipts.reverse` now uses `meta.id` (was a fresh `uuidv7()` inside the run — same defect, same file). A timeout is a `FetchError` → kind `network`, so `outcomeUnknown` covers the 20 s deadline. The reword matches the guard's sentence (`platform/idempotency.ts:71`) and `serviceMessage` reads `data.body.message`, the path the transport uses.
- DOS-141: no id, no ISO-Z in any of the three sentences; `userLabels` is membership-joined (no cross-tenant name); `IST_OFFSET_MINUTES` is re-exported from `@dos/domain` index; direct `../../platform/refusal-words.js` import is the existing `object-storage.js` pattern; `platform/index.ts` untouched. Server `z.string().trim().min(1)` on the bounce reason is untouched. No spec, smoke or client on main asserts the three old sentences (grep of main).
- Tests: DOS-141 specs assert the exact sentence and `not.toContain(id)` — red on main. DOS-136/035/036/038 are pure-helper tests; the DOS-135 fixture string in `refusal.test.ts` is a fixture, not an assertion — not a weakening. `manager-app` has `"test": "vitest run"`, so the six new tests run under turbo.
- Ownership: six new files at fresh paths that no other group's Owns list claims; no contract, kit, or `react/index.tsx` edit.

## Minors (fix after merge, in this lane's sweep)

1. `frontend/manager-app/app/shops/index.tsx:161-162` — `statements.send` still makes `from`/`to` inside the run; the input is only `retailerId`, so a press before IST midnight retried after it is a different body under a spent key and now reads "This was already saved" although the second statement did not go. Fix: capture `{ retailerId, from: statementFrom, to: today() }` when the dialog opens and pass it as the input.
2. `frontend/manager-app/src/lib/money-intents.ts:141` — the reworded 409 tells the reader to "close this and open it again to see it", but nothing refetches on a `conflict`, and `useQuery` serves the cached row for 30 s (`staleTime`), so reopening the same receipt within that window still shows "Collected". Fix: `outcomeUnknown` returns true for `kind === 'conflict' && message === ALREADY_SAVED` (export the constant from `errors.ts`), or the sentence drops the promise. Nearly unreachable on these five writes now that the retry is byte-identical.
3. `backend/libs/core/src/modules/warehouse/load-sheets.service.ts:350` — "was already approved by Manager at 13 Sep, 4:20 pm": `at` before a date; the approvals sentence says `on`. One word.
4. `frontend/manager-app/app/billing/credit-notes.tsx:249` — a ref written during render (`heldLineIds.current.ids = keepIds(...)`). Harmless (idempotent under StrictMode's double render); move it into the `returned` memo or the press handler when next touched.
5. DOS-141's finding text asked for the confirm button disabled until a reason is typed; the binding note asked for a field error and that is what was built. The field error is the better product (a disabled button that says nothing is the silence UX-00 forbids); no change asked.
6. `phoneRow` restates the kit rule rather than rendering a `Register`; DOS-038 is proven by the walk below, not by the test.

## Conflicts

- With main now: none — the branch sits on main's HEAD (5f710dc); the merge is a fast-forward.
- With lanes still unmerged: `qa/b2-lean-warehouse-pick` (base b8b116d) also adds to `warehouse.spec.ts`, at lines 47 and 1401+; this group's hunk is at 972 — disjoint, auto-merges. `lean-owner-desk` and `lean-sales-rep` share no file.
- With groups not yet branched: 13, 16, 17, 18 and 20 own `approvals.service.ts`, `orders.spec.ts`, `money/index.tsx`, owner `receipts.tsx`, `documents.tsx`, `strings.ts`, `warehouse.spec.ts` — every one of them lists lean-manager-money in its waits-for, so they branch after this merge. The three `strings.ts` keys are additive.

## Walks owed (none were run; the lane's environment forbade servers)

- Web desk 1280×800, manager AND accountant: Shops → Patil General Store — overdue as money (DOS-035), the statement's three heads + opening row and the last balance (DOS-036); Money → RCPT → Bank it with the reply dropped (page.route abort, the finding's step 2), press again → 200 Banked, dialog closes, panel Banked; Cheque returned with an empty reason → field says "Write what the bank said", no POST; the same on Day-end. Owner O11 receipts: a refused deposit stays open with the sentence.
- Web phone 390×844: Shops rows read "name · policy" and a tap on "Patil General Store" opens the panel; the three-column statement fits without horizontal scroll.
- Android Pixel 7 (DOS-038's own platform): Shops list names via the native `ListRow`; the bounce field error under the native `TextInput`.
- iOS sanity only: the bounce dialog inside the Money sheet (DOS-164's dialogs-in-sheets rule), Expo Go.

## Defects outside the group (unfiled; DOS-136's class, all inside `@dos/api-client` `useMutation` runs keyed on input)

- `frontend/delivery-app/app/stop/[id]/collect.tsx:121` `receiptId: uuidv7()` and `:131` `collectedAt: new Date()` — doorstep money: a retry after a lost reply is refused instead of replayed. P2.
- `frontend/delivery-app/app/stop/[id]/deliver.tsx:310` `deliveredAt`; `frontend/delivery-app/app/day.tsx:121` and `trip/start.tsx:140` `occurredAt`; `frontend/delivery-app/app/expenses.tsx:104` `incurredAt`.
- `frontend/sales-app/app/shops/[id].tsx:468` `startedAt` (visits.record); `frontend/manager-app/app/orders/drafts.tsx:104` per-line `uuidv7()` (ai.drafts.confirm).
- `frontend/manager-app/app/shops/index.tsx:116` (pre-existing) — the statement reads 30 rows, shows the oldest 12, ignores `nextCursor` and never prints `closingPaise`, so a shop with more than 12 documents in 90 days ends on a balance that is not its balance. P3.
