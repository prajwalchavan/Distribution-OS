# 13 — Change log (approved product changes)

One row per approved finding fixed. Product changes land in their own commits (never with QA docs, Charter A.14);
each fix carries a failing test named for its finding id (PHASES.md §Phase 4). Regression runs are in `QA/14-regression-results.md`.

## Batch 1 — approved 2026-09-12 ("Approved" on the Phase 1 gate: 4 P0 + the 30 P1 on the Phase 2 chain)

Checkpoint: tag `qa/checkpoint-before-batch-1` = `876444a` (pushed). Scope, verbatim from the gate sheet
(`QA/findings/09-phase-1-approval-gate.md`): DOS-039, 073, 094, 106 · 020, 029, 074, 075, 076, 077, 096, 097 ·
040, 041, 042, 043, 023, 025 · 056, 057, 058, 060, 061 · 032, 059, 034, 095, 099 · 021 · 001, 003, 004, 005, 007.
Not in scope (the 8 off-chain P1, all P2/P3): DOS-031, 037, 044, 080, 098, 107, 108, 109.

Plan: one read-only planner + one adversarial reviewer per finding (workflow `qa-batch1-plan`, run `wf_4c326dc9-def`),
then implementation by cluster, then the CI chain, then the five regressions of A.12.

| ID | Title | Root cause (short) | Change | Test | Commit | Status |
|---|---|---|---|---|---|---|
| DOS-039 | Load-out confirm moves only the counted van stock; the packed orders' lots (sold at pack) are no longer taken  | Stock leaves the godown twice for the same goods. | 4 files: load-sheets.service.ts, warehouse.spec.ts, warehouse.ts +1 | DOS-039 sends out a sheet whose packed lot has nothing left in the godown instead of refusing 'insufficient st | 17be1a4 → merge f4b1756 | merged; fail-before/pass-after verified; platform walk pending |
| DOS-040 | Warehouse picking sheet: add a "Start picking" step for an open wave, lock picks until the device knows the wa | Two faults, one on each side. | 4 files: warehouse.sync.ts, warehouse.spec.ts, [id].tsx +1 | DOS-040: a device pick on a wave nobody has started is refused as picklist_not_started with 'start it before p | 740f8c5 → merge f4b1756 | merged; fail-before/pass-after verified; platform walk pending |
| DOS-042 | Close a picking wave only when every short line has had every lot row it was asked on recorded | The wave closes early because completion is judged on the order-line total, never on each lot row. | 4 files: picklists.service.ts, warehouse.spec.ts, local.ts +1 | DOS-042: a short on one lot does not close the wave while another lot row of the same line is untouched (pickl | d8dccd8cb401497a9bc0be0d6e3ff1b900ed6e6c → merge f4b1756 | merged; fail-before/pass-after verified; platform walk pending |
| DOS-041 | Refuse a pick above its own batch row's ask (server, HTTP and offline), make the manager's M20 pick update the | The server only limits picks per ORDER LINE. | 7 files: picklists.service.ts, warehouse.spec.ts, warehouse.ts +4 | DOS-041 refuses a pick above its own batch row's ask while the order line is still under its total | 475092f → merge f4b1756 | merged; fail-before/pass-after verified; platform walk pending |
| DOS-023 | Picking sheets list is newest first by server creation time, and the manager's Pick & pack asks the server for | Two contributing causes, both confirmed. | 4 files: picklists.service.ts, warehouse.spec.ts, warehouse.ts +1 | DOS-023: picklists.list is newest first by creation time — a wave made now tops a sheet whose id sorts higher, | bdd6055 → merge f4b1756 | merged; fail-before/pass-after verified; platform walk pending |
| DOS-025 | Manager Load-out: read the draft load sheets on their own and show them in a panel above the history (waiting  | The defect is in the manager-app screen only. | 6 files: load-out.ts, load-out.test.ts, load-out.tsx +3 | DOS-025: the draft at row 62 of the 83-row page is the first row of the waiting register, and history never re | 31af220 93c827c → merge f4b1756 | merged; fail-before/pass-after verified; platform walk pending |
| DOS-058 | A return marked Damaged or Past its date must go to the damaged bin: one reason control in D4, and the server  | Confirmed by reading the code. | 6 files: delivery.ts, delivery.test.ts, deliveries.service.ts +3 | DOS-058: a return marked damaged or past its date is refused as saleable (400 return_not_saleable, online and  | d2efc20 → merge 83c00b3 | merged; fail-before/pass-after verified; platform walk pending |
| DOS-060 | Money NumberPad enters rupees (paise only after "."), matching the web RupeeInput, on every native money field | Confirmed by reading the code. | 8 files: money.ts, money.tsx, money.tsx +5 | DOS-060: typing 4 7 5 6 on the money pad is ₹4,756.00 (475600 paise), not ₹47.56 | 2f3d295 → merge 83c00b3 | merged; fail-before/pass-after verified; platform walk pending |
| DOS-057+099 | Bill and receipt papers cannot be opened, printed or sent: three screens hand the service-relative signed URL  | PAIRING: confirmed, partly. | 12 files: receivables.service.ts, receivables.spec.ts, delivery.spec.ts +9 | DOS-057: recording a receipt queues its A5 original for the PDF renderer in the same transaction, and a replay | cbff41c → merge 83c00b3 | merged; fail-before/pass-after verified; platform walk pending |
| DOS-061 | Delivery app: pick the trip being driven today, open an on-the-road trip at its stops (never Start), and stop  | One cause: how the delivery app picks a trip and routes to it on the phone. | 8 files: trip-choice.ts, trip-choice.test.ts, local.ts +5 | DOS-061: today's active trip is Today's trip, not a later-dated active one, whatever order the rows arrive in | 3d64b94 → merge 83c00b3 | merged; fail-before/pass-after verified; platform walk pending |
| DOS-094 | payments.initiate builds its own UPI intent: the amount the shop chose, its PAY reference (in tr and tn), one  | One cause produces the wrong amount, the wrong reference, the doubled prefix and the null payeeVpa. | 8 files: upi.ts, upi.test.ts, index.ts +5 | DOS-094: payments.initiate puts the amount the shop chose and its own PAY reference in a single upi://pay? int | 54a3ec0 → merge aaa4f6a | merged; fail-before/pass-after verified; platform walk pending |
| DOS-095 | Retailer statement reads only the first page (50) of the ledger and prints the whole-window closing balance un | The planner's diagnosis holds: the bug is in the retailer screen. | 7 files: pages.ts, pages.test.ts, index.ts +4 | DOS-095: follows nextCursor until it is null and returns every statement entry in order, ending on the closing | a5e39469d842ac7eb47264f2ddb84d4cce0362b9 → merge aaa4f6a | merged; fail-before/pass-after verified; platform walk pending |
| DOS-021 | Credit-note draft: type pieces up to what is left to credit (free goods and earlier notes counted by one share | The screen is at fault. | 8 files: credit-notes.ts, credit-notes.test.ts, index.ts +5 | DOS-021: piecesLeftToCredit counts free pieces and earlier credits — 40 pc leaves 40, 48 + 2 free leaves 50, 2 | bc27847 → merge aaa4f6a | merged; fail-before/pass-after verified; platform walk pending |
| DOS-034 | Manager/accountant Day-end: the bank and bounce actions are out of sight, the in-hand list holds money the des | Mostly a manager-app screen defect. | 9 files: receipts.ts, receipts.test.ts, index.ts +6 | DOS-034: only cash and cheques still collected go to the bank — UPI, bank transfer, adjustment and credit_note | c0889f7 3b73a8d → merge aaa4f6a | merged; fail-before/pass-after verified; platform walk pending |
| DOS-073 | A salesperson only reaches orders credited to them: another rep's order answers 404 on get, cancel, setLines,  | Confirmed by re-reading every cited line. | 6 files: orders.internals.ts, orders.service.ts, orders.sync.ts +3 | DOS-073: a salesperson cannot cancel, re-line or submit another rep's order — 404 with the missing-id message, | 40a2294 → merge 2abb27e | merged; fail-before/pass-after verified; platform walk pending |
| DOS-075 | The pricing engine reads 'inr' scheme thresholds as rupees, but everything that stores them uses paise, so the | One cause: every stored `inr` trigger threshold is in paise, but the engine measures the order in rupees. | 4 files: schemes.ts, schemes.test.ts, pricing.ts +1 | DOS-075: an inr trigger is paise — '2% off on bills over ₹25,000' (triggerMin 2_500_000) fires at exactly ₹25, | 4450d81 → merge 2abb27e | merged; fail-before/pass-after verified; platform walk pending |
| DOS-076 | Quote a brand-scoped cash discount on its own lines' net, not on the whole order | One cause, in step 5 of the pure engine `priceOrder()` (backend/libs/domain/src/pricing/schemes.ts:338-365). | 3 files: schemes.ts, schemes.test.ts, pricing.spec.ts | DOS-076: a brand-scoped cash discount is reported on that brand's lines only, not the whole order | 212e478 → merge 2abb27e | merged; fail-before/pass-after verified; platform walk pending |
| DOS-020 | Confirm order must never decide an order's pending approvals: refuse with 409 approval_required and send each  | One cause explains both halves of DOS-020: the silent approvals and the walk through a credit stop. | 7 files: orders.service.ts, orders.spec.ts, examples.ts +4 | DOS-020: confirm on a credit-stop shop's order refuses while approvals are pending and decides none of them | 32315dc6b14abdf258ecf7347333bd063a06fe74 → merge 2abb27e | merged; fail-before/pass-after verified; platform walk pending |
| DOS-005 | Link each bargain gate to the bargain request it waits on, so one decision closes both and each queue shows on | The server and all three decision screens are both wrong. | 9 files: bargains.service.ts, index.ts, orders.internals.ts +6 | DOS-005: a bargain gate names the bargain request it waits on, and rejecting the gate rejects that request | 40fc300 → merge 2abb27e | merged; fail-before/pass-after verified; platform walk pending |
| DOS-077 | Android order entry: catalog rows show only "Add a case" because the full-width kit Button squeezes the item-n | Confirmed by reviewer. | 4 files: new.tsx, order-entry-layout.test.ts, package.json +1 | DOS-077: the catalog row's "Add a case" button sizes to its label (fullWidth={false}), so the growing item-nam | f2a36ae → merge 2abb27e | merged; fail-before/pass-after verified; platform walk pending |
| DOS-001 | Demo seed writes owner_summary.detail key 'ageingB90Plus', but the owner/manager dashboard reads 'ageingB90plu | The frontend is not the cause, so the finding's suggested fix is wrong. | 5 files: reporting.ts, reporting.ts, reporting.service.ts +2 | DOS-001: the seeded owner_summary.detail carries every ageing bucket under the keys the owner dashboard reads  | bc1f809 → merge 2abb27e | merged; fail-before/pass-after verified; platform walk pending |
| DOS-029 | Manager app: a refused write keeps its dialog or panel open and shows the server's own sentence where the person pressed | 33 manager-app call sites closed the dialog on failure (`.then(done, done)`), and two review actions had no rejection handler, so 400/409/501 looked like nothing happened | 25 files: api-client `useRefusal`/`<Refusal>` rule, manager-app ui.tsx + 19 screens (DOS-021 and DOS-034 refusal lines moved onto the same rule) | refusal.test.ts › DOS-029 (4 tests); QA/tools/e2e/dos-029-manager-refusals.mjs | 2abe7e3 d600ab8 (branch qa/b1-l5-manager-errors, not merged yet) | verified: unit red→green; **e2e RED on 2abb27e (10 of 23 assertions failed: wave and no-connection dialogs closed with no sentence) → GREEN on d600ab8 (24 of 24 held)**; brand-DMS 501 step NOT TESTED by the e2e (its document id exists only in dos_qa, not in a fresh template seed) — walk it on dos_qa; merge after regression part A |

### Batch 1 — how the 34 were split (2026-09-12, after planning)

Planning produced 31 reviewed plans (three pairs share one cause: DOS-074+097, DOS-057+099, DOS-032+059), saved in
`QA/evidence/batch1/plans.json`. Implementation workflow `qa-batch1-implement-ready` (run `wf_843b78bb-4d1`, all agents Opus):
test-first implementer → adversarial verifier (test must fail without the fix) → one repair round, in four worktree lanes,
each on its own copy of `dos_batch1_template`.

| Lane (branch) | Fixes, in order |
|---|---|
| L1 warehouse (`qa/b1-l1-warehouse`) | DOS-039, 040, 042, 041, 023, 025 |
| L2 delivery (`qa/b1-l2-delivery`) | DOS-058, 060, 057+099, 061 |
| L3 money (`qa/b1-l3-money`) | DOS-094, 095, 021, 034 |
| L4 orders (`qa/b1-l4-orders`) | DOS-073, 075, 076, 020, 005, 077, 001 |
| After the lanes merge | DOS-029 (touches every manager-app screen the lanes touch) |

**Held for an architect (Fable) review before implementation** — each changes the API contract, the permission matrix or the
schema, or depends on a founder answer: DOS-106, DOS-043, DOS-007, DOS-056, DOS-032+059 (founder questions below) and
DOS-074+097 (new `inventory.stock.availability` read), DOS-096 (`pricing.quote` returns GST and the payable total),
DOS-003 (order lines carry `variantName`), DOS-004 (`orders.approvals.list` items carry shop, order number and amount).

### Batch 1 — founder decisions (answered 2026-09-12: "yes to all 5, go with defaults")

| # | Fix | Question | Decision (founder, 2026-09-12) |
|---|---|---|---|
| Q1 | DOS-106 | Console levels: may *support* only read everything plus ask for and hand back support access, and *billing* only read everything plus change a distributor's plan? | **Yes (default).** Only *super* can onboard, suspend, lock or unlock logins |
| Q2 | DOS-043 | Remove the warehouse role from "send a trip out" (owner, manager and the crew only), and refuse departure while the load sheet is a draft? | **Yes (default).** Warehouse keeps create trip, add stops, start loading |
| Q3 | DOS-007 | "Send statement": send a short WhatsApp/SMS text now (balance, overdue, UPI pay link), or wait for a PDF statement? | **Text now (default)**; PDF statement later |
| Q4 | DOS-056 | Offline delivery photo: carry the photo inside the queued delivery (size M), or first build the separate photo-upload queue docs/27 §15 describes (size L)? | **Inside the queued delivery (default)**; docs/27 §15 updated with the fix |
| Q5 | DOS-032+059 | A database rule that receipt numbers never repeat. `dos_qa` holds four duplicate pairs, so the migration refuses there: rebuild `dos_qa` from the seed (loses the Phase 1 side-effect rows)? The founder's own `dos` may need the same. | **Yes: rebuild `dos_qa`** — only after DOS-032+059 merges (the current seed itself writes duplicates, so an earlier rebuild would reproduce them). `dos` stays the founder's own call |

Non-blocking (the fix goes ahead; recorded for Phase 3): DOS-075 — should a "bills over ₹X" threshold count lines under an
exclusive scheme? · DOS-057+099 — a long-lived share link for papers sent to shops needs a public endpoint and a security
decision · DOS-023 — lists sort by id order today; one convention (server time) should be chosen for all lists.

### Batch 1 — 21 decision-free fixes merged (2026-09-13)

Workflow `qa-batch1-implement-ready` finished: 42 Opus agents, 0 errors, no repair round needed. For every fix the verifier
reversed the non-test changes and confirmed the new test failed for the finding's reason, then passed with the fix; no blocker or
major problem. The four lanes merged into main without a textual conflict (f4b1756, 83c00b3, aaa4f6a, 2abb27e); both merged lockfiles
install with `--frozen-lockfile`. Full results: `QA/evidence/batch1/implement-results.json`; every deviation, follow-up, platform
check and verifier note: `QA/evidence/batch1/implement-followups.md`.

**Existing tests changed (charter A.5 review, all accepted):**
- DOS-039 `warehouse.spec.ts` load-out confirm — asserted three godown→van transfer pairs and 18 phantom pieces on the van (the defect); now asserts one pair for the van-stock lot and pins the packed lots' godown balances (stricter).
- DOS-040 `warehouse.spec.ts` device pick — asserted `picklist_closed` for a wave nobody started (the defect); now `picklist_not_started`, the closed branch kept by a new guard test.
- DOS-094 `receivables.spec.ts` fixture — stored a UPI payload shape billing never writes, which hid the doubled prefix; fixture now matches billing, assertions unchanged.
- DOS-075 `schemes.test.ts` ×2 — rupee-valued `inr` threshold inputs converted to paise; expected values unchanged.
- DOS-020 `orders.spec.ts` shortage test — asserted that confirm silently approves a pending approval (the defect); the approval is now decided as a fixture before confirm.

**Residuals the verifiers raised that must be checked in the regression walk (not fixed, not in scope):**
- DOS-073: warehouse and delivery logins can still cancel, re-line, submit, get and list any order through :3004/:3005 — probe with the API in the security regression; if confirmed it is a new finding.
- DOS-058: the manager desk's `billing.creditNotes.create` still accepts `return_damaged` lines that default to saleable.
- DOS-020, DOS-034: new dialogs open a native Modal from inside a Sheet (also a Modal); iOS may not show the second one — walk on the simulator.
- DOS-034: Bank it / Mark bounced stamp `new Date()` inside the mutation, so a retry after a lost reply is a new intent — probe for a double deposit.
- DOS-075: the sales app prices on the device from `@dos/domain` dist — rebuild domain and restart Metro with `--clear` before walking.
- DOS-025, DOS-077: the frontend CI job does not run `pnpm test`, so the new app specs gate only locally.
- DOS-073: generated READMEs regenerated once after the merge (orders.list summary changed).

**DOS-029 (2026-09-13):** implemented on top of the 21 merged fixes, verified by an independent Opus reviewer (unit red→green, scope clean,
no backend/contract/schema change). The unit test only proves the display rule is new; the real reproduction is the end-to-end script
`QA/tools/e2e/dos-029-manager-refusals.mjs`, which must be run RED on 2abb27e and GREEN on the fix against a fresh template copy.
Residuals to check in the manager walk: (1) a refusal that arrives while another write on the same panel is still pending is never shown
after that write settles (verifier proved it in a unit frame; realistic in the documents panel); (2) on iOS a fast reopen of the same
dialog may flash the previous sentence; (3) credit-note create and docint approve mint new line ids per call, so a retry after a lost reply
gets 409 "idempotencyKey already used with a different request" (pre-existing).

**DOS-029 end-to-end proof (2026-09-13 02:05–02:09):** own auth :3100 + manager :3102 on a fresh template copy `dos_b1_e2e` and the manager
web build on :5274, so the regression walkers were untouched. RED run on the build before the fix (worktree at 2abb27e): 10 of 23 assertions
failed — "Picking sheet for SO-0850: the surface is still open / wave-refusal holds the service's sentence / refusal line in viewport" and
the same three for "No connection". GREEN run on the fix (d600ab8), after recreating the database: 24 assertions held, including the credit
note refusal sitting directly above Draft, the wave dialog staying open with "only a confirmed order can be waved; SO-0850 is packed", and
"No connection. Check the signal, then press again." One step NOT RUN in both: the brand-DMS 501 approve needs document 0400aea1…, whose id
exists only in dos_qa. Logs: `QA/evidence/batch1/dos-029/e2e-red.log`, `e2e-green.log`, `run-summary.txt`, screenshots under `red/` and `green/`.
