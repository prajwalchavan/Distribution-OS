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
| DOS-135 | Show a refusal that arrives while a sibling write on the same panel is still pending (repair inside DOS-029) | DOS-029's nextRefusal marked a refusal seen but forced it hidden while another write was pending, and never showed it after that write settled | api-client `useRefusal` keeps the latest refusal that arrived during a pending write as `waiting` and shows it when nothing is pending; README sentence | refusal.test.ts › DOS-135 (red on d600ab8, green on 8161f21) | 8161f21 (branch qa/b1-l5-manager-errors, not merged yet) | verified: unit red→green; live BEFORE d600ab8 reproduces, AFTER 8161f21 fixed (desk + phone) |

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

**DOS-029 whole-frontend check on its branch (d600ab8, before merging):** lint 11/11, typecheck 11/11, tests 6/6 packages
(api-client 76, ui 216, offline 38, sales-app 1, delivery-app 6, manager-app 3 = 340 passed), format:check clean — the api-client change breaks no
other app. `git merge-tree` against main: clean. Merge waits only for the last regression walker (sales + owner) so its apps do not reload mid-walk.

**Regression outcome of the fixes so far (2026-09-13 ~03:45 IST; details in QA/14):** web and API re-walks PASS for DOS-039 (desk), 040, 041, 042, 023, 025,
058, 060 (web), 057, 061, 094, 095, 099, 073, 075, 076, 001, 005, 020 and DOS-029 (a–d). **DOS-034 PASS within its approved scope** — actions in sight and working; trip cash in the in-hand list is the companion finding DOS-132 (pre-existing root cause, made reachable by DOS-034; its plan asked for it to be filed at the same gate and QA missed that). **DOS-029 residual** — refusal dropped while another write is pending (DOS-135, a defect in DOS-029's own code; repaired on the DOS-029 branch before merge). **DOS-077** — web
desk PASS; web phone clipping predates the fix (DOS-128); Android result pending. Cross-role chain completes only through the API for trip creation and
load-sheet building (DOS-131 P0, DOS-133 P1); money sanity PASS.

### Architect review of the nine held plans (Fable, 2026-09-13 07:40 IST)

All nine approved; amendments are conditions and live in `QA/evidence/batch1/held-review-brief.md` §Architect verdicts. The ones that change
the design: DOS-032+059 — a server-assigned number collision self-heals (counter → max+1, retry once, audit row) instead of halting money
recording; FY is IST everywhere via `@dos/domain`. DOS-056 — the inline photo is stored through the files platform inside the sync handler
(object key only in rows), device compresses to ≤ 300 KB, the sync route gets an 8 MiB body limit and an oversize op becomes a sync_error,
never 413; DOS-156 folds in. DOS-106 — one in-transaction level+status check on every admin.* handler (reads included). DOS-043 — the draft
load-sheet gate also matches sheets by the trip's stop orders (DOS-137 makes `trip_id` unreliable). DOS-074+097 — `reservableLocationId()`
exported from inventory, used by orders and warehouse too. DOS-003 — name lookup exported by tenant-catalog; replay 500 logged as DOS-160.
Designs for the new P0/P1 (DOS-115, 131, 126, 117, 132, 133, 116, 146) are in the same file for the approval gate.

### Batch 1 — merged and regression-tested (2026-09-13 08:47 IST)

DOS-029 + DOS-135 merged into main as d8ae49e (pushed). Final per-fix status across platforms is the matrix in QA/14 §3 and
QA/findings/11-batch1-outcome-gate.md. Short form: every merged fix PASSES on web and Android; on iOS every fix walked passes except the
in-Sheet dialogs of DOS-020 (manager) and DOS-034 (DOS-164, pre-existing kit defect); DOS-029's no-connection sentence fails on Android
(DOS-156, folded into DOS-056); DOS-135 not testable on iOS. Regression added 51 findings (DOS-115..DOS-165), none of the P0/P1 caused by batch 1.

## Batch 2 — approved 2026-09-13 (founder: "I want to fix everything identified" · "Approved all pending items")

Checkpoint: tag `qa/checkpoint-before-batch-2` = `b59bbf0` (pushed). Scope: every open finding. That is the three P0 (DOS-106, 115, 131)
and every P1: the nine held plans as the architect amended them, the eight Phase 1 P1 left out of batch 1 (DOS-031, 037, 044, 080, 098,
107, 108, 109) and DOS-116, 117, 126, 132, 133, 146, 164. It also covers every P2 and P3 from Phase 1 and from the batch-1 regression.
Order: P0 → P1 → P2 → P3 (Charter A.7).

Plan: the inventory workflow `qa-batch2-inventory` (run `wf_05a45daa-9f8`, all agents Opus) lists every open finding with its status, any
architect design it already has, whether it needs one, its files and its test. Output: `QA/evidence/batch2/inventory.md`, `lanes.md` and
`fable-brief.md`. Findings that already have an architect design (the nine held plans, and DOS-115, 131, 126, 117, 132, 133, 116, 146 in
`QA/evidence/batch1/held-review-brief.md`) go to Opus implementation in worktree lanes, test-first with an adversarial verifier. The rest
wait for the architect (Fable) to answer `fable-brief.md`, DOS-164 first. Then the five A.12 regressions.

Process change (founder, 2026-09-13, option "A"): Fable runs as helper agents from the Opus session. Every batch-2 plan gets a Fable
sign-off before it is built (`QA/evidence/batch2/verdicts/<id>.md`: approve / approve with lettered binding amendments / reject). Every
lane gets a Fable review of its combined diff before it merges into main. Planners, builders, verifiers and walkers stay on Opus. The nine
held plans already carry Fable's 2026-09-13 07:40 verdicts, so they went straight to build (run `wf_beb0d5ef-504`).

Lean mode for P2/P3 (founder, 2026-09-13: "yes for lean mode"). P0 and P1 keep the full process: plan, adversarial review, Fable
sign-off, build, verify. P2 and P3 are grouped by app, with one Opus builder and one Opus verifier per group of five to eight and no
separate planning step. Copy-only or layout-only P3 fixes may run on Sonnet. Fable designs the ones that need a decision. One full A.12
regression runs at the end of batch 2, and phones are walked only where a fix changes a phone screen. If overall weekly usage passes
about 70% by Wednesday, work stops after P0/P1 and its regression, and P2/P3 resume after the Saturday 11:30 IST reset.

Added to batch 2 (founder, 2026-09-13: "approved"): **DOS-166** (P0, security). A salesperson recorded a money receipt through
`/sync/upload`, which the HTTP matrix refuses (QA/findings/12-batch2-new-findings.md). Fable writes the design
(QA/evidence/batch2/verdicts/DOS-166-design.md), which serves as the signed-off plan; Opus builds and verifies it ahead of the remaining
P1. Approved in the same answer, the architect defaults of the batch-2 sign-offs:
- the accountant cannot change orders (DOS-115)
- confirm applies only rates approved since the draft (DOS-126)
- trip cheques wait for settlement (DOS-132)
- expired desk returns are booked as damaged (DOS-116)
- an emptied trip-start cash field means a ₹0 float (DOS-146)
- a warehouse-app load sheet is always for one trip (DOS-131+137)
All are recorded in docs/22 §8.

Approved next (founder, 2026-09-13: "Approved"), the sign-off-2 defaults:
- Order again repeats the shop's last placed order, never a draft (DOS-098)
- the accountant views M3, M4 and M16 and changes nothing there, and still captures supplier bills (DOS-037)
- only the owner and the manager add stock or record opening stock; arrivals come through a GRN (DOS-044)
- the accountant is not a stock adder (DOS-044)
- no large-reduction confirm until after DOS-164 (DOS-044)
These are also recorded in docs/22 §8. Usage limit: the session limit stopped five agents at 10:43 IST; they were relaunched at 12:25 after the reset.

### Batch 2 — relaunch after /clear (2026-09-13 12:59 IST)

The /clear at 12:55 IST stopped two runs mid-plan: `wf_3db93761-bb2` (wave 1a) and `wf_b57b3ffe-74c` (wave 1b). This is what each lane held:

| lane | state found (git log main..HEAD, git status) |
|---|---|
| h1-money | DOS-007 committed `b18cc68` and verified: pass, all four amendments. DOS-117: three test files written but not yet run, no code. |
| h3-doorstep | DOS-056 implementation uncommitted: 21 modified + 4 new files, +815/−126. Not verified. |
| h7-syncdoor | DOS-166 tests written (`sync.coverage.spec`, `sync.spec`, `rls.test`, +302). Test (e) seen red. No implementation. |
| h5-orders, h2-trips | Nothing beyond main. Both fast-forwarded to main `fcb0d77`; their DBs were recreated from `dos_test_batch2b_template`. |

The lanes were relaunched as one priority-scheduled run, `wf_ae8abf06-4fc`. It runs at most three lanes at once, one per worktree, P0 chains first:
1. h7 DOS-166
2. h5 DOS-115
3. h2 DOS-133 → DOS-131+137
4. h3 DOS-056 → 146
5. h1 DOS-117 → 132
6. h5 DOS-098 → 126, only after DOS-115 verifies

Each resumed implementer is told what the stopped one left behind. It must re-check that work against the plan and its amendments before it commits.

### Batch 2 — ten verified, eight merged (2026-09-13 15:50 IST)

**Build.** Run `wf_ae8abf06-4fc` verified all ten plans: each test failed before the fix and passed after, as an independent verifier confirmed. Every amendment was satisfied, no repair round was needed, and there were no blockers. Per-plan implementer and verifier reports are in `QA/evidence/batch2/lane-results/<id>.json`.

**Review.** Fable merge reviews (runs `wf_a8e3a6c2-fdd` and `wf_c61e23fd-3f9`) returned MERGE for h7, DOS-115, h2 slice 2, h1 slice 2 and h5 slice 3. h3 got MERGE AFTER FIXES. The reviews are in `QA/evidence/batch2/merge-reviews/`.

**Integration.** Run `wf_3f9f63f5-98a` handled each slice in four steps:
1. An integrator merged main into the lane and resolved conflicts as the review said.
2. The same integrator applied the merge-time fixes and got the merged tree green.
3. An adversarial verifier checked that no hunk was dropped, the scope stayed clean and the key specs passed.
4. The slice was merged `--no-ff` into main and pushed.

| slice | fixes | on main | merge-time work |
|---|---|---|---|
| h7-syncdoor | DOS-166 (P0) | `5b10e44` | prettier on pricing.spec.ts (DOS-096 drift), so backend format:check is green again |
| h5 commit 2ec9583 | DOS-115 (P0) | `c5d21d1` · `e474288` · `492da02` | The orders.spec upload test now expects `role_not_allowed`, because the DOS-166 door refuses before the handler; `requirePlacer` stays pinned by direct assertions. READMEs regenerated. |
| h2-trips slice 2 | DOS-133, DOS-131+137 (P0) | `b11697e` | Index migration regenerated as 0047 on top of h7's 0045/0046; lane DB recreated |
| h1-money slice 2 | DOS-007, DOS-117, DOS-132 | `eb3a8b2` | delivery.module.ts conflict: both the TripSettled lines and the standsFor registrations kept; prettier on the slice specs |
| h3-doorstep | DOS-056 (+156), DOS-146 | `3d7cb36` | sync.service.ts upload order is now unknown_table → role_not_allowed → savepoint { oversize → stale → handler }; DOS-056 test no longer hard-codes TRIP-0003; lane DB recreated |

**Still owed on the merged fixes.**
- Platform walks on web, Android and iOS.
- The DOS-166 regression probe on dos_qa.
- docs/22 rows for DOS-166, DOS-115, DOS-131+137, DOS-056/146/156 and DOS-117 (f).
- Review minors, which may follow:
  - `rowTooLarge` added to SYNC_REJECTION_CODES;
  - a test pinning the 8 MiB route limit;
  - stale proof-of-delivery prose in contracts/delivery.ts and docs/20 rule 15.
- Suspected defects S-73..S-91, not tested.
- Tooling note: `pnpm --filter <pkg> test -- <file>` runs the whole vitest suite; use `pnpm --filter <pkg> exec vitest run <file>` for a single file.

**h5-orders slice 3** (DOS-098, DOS-126) merged as `43824b0` at 16:25 (run `wf_64118f05-f5b`). The integrator resolved its one textual conflict, the drizzle import in orders.service.ts, as the review said. The verifier passed it; its only minor was that main had moved on by two QA-only commits. The READMEs gain `GET /orders/last-placed`. The lane DB was recreated and migrated to 0047. Batch 2 now has 13 approved findings on main (3 P0, 10 P1).

**dos_qa rebuilt** on merged main at 16:11: 48 migrations, verify-seed 206/206, no duplicate receipt numbers. The services and the worker were restarted on it.

**P0 regression probe** (run `wf_878c1f40-c4d`, dos_qa): 16 PASS, 0 FAIL, 3 NOT TESTED. Evidence is in `QA/evidence/batch2/sync-role-probe/after/SUMMARY.md` and `p0-probe-dos115/`.
- DOS-166:
  - A delivery receipt through /sync/upload is accepted.
  - A salesperson receipt and a warehouse receipt get 200 role_not_allowed. Neither draws a number or writes a journal; the warehouse one now also writes a sync_ops row.
  - Retailer and salesperson POST /receipts still get 403.
  - The manifests are role-aware.
  - In the database, a salesperson INSERT into receipts fails with 42501 while a delivery INSERT goes through (rolled back).
- DOS-115: warehouse and delivery logins get 403 on every order write and 200 on reads. The accountant gets 403 on POST /orders. A warehouse sales_orders op through /sync/upload gets role_not_allowed.
- NOT TESTED: the delivery, sales and warehouse app offline-sync walks. They run in the A.12 regression.

**h9-desk verified** (run `wf_ac1e794b-9d1`): DOS-044 `8798c18`, DOS-037 `d59c8fe`, DOS-031 `dd722a5`. Each test failed before the fix and passed after, every amendment was satisfied, and there were no blockers. The Fable merge review is running.

**h12-kit and h8-billing verified** (run `wf_1bfa433f-83b`):
- DOS-164 `de8f6bd`: native overlays now go through a JS overlay stack; the web renderer is untouched.
- DOS-116 `1ea7cfe`: damaged desk returns go to the damaged bin, and saleable:true is refused.

Each test failed before the fix and passed after, every amendment was satisfied, and there were no blockers. Fable merge reviews are running (`wf_5363c388-c3f`). Lean-mode grouping of every open P2 and P3 has started (`wf_c2b9844d-877`).

**h9-desk merged** as `d521f84` at 16:52 (run `wf_30bb86fa-c2d`): DOS-044, DOS-037, DOS-031.
- **No textual conflict.** The review had predicted a semantic one, and it appeared on the merged tree. The DOS-037 test "pins every non-GET procedure the accountant may call" still listed the five order writes that DOS-115 (founder-approved) had removed, so it failed with 68 received vs 73 expected. The five rows were dropped from that literal list, and nothing else changed (`cbc2cbc`).
- **READMEs:** 12 regenerated. The stock.adjust summary changed and 24 rows lose the accountant.
- **Process note:** the integrator ran one read-only `select 1` against the template database, which the lane rules forbid. It disclosed this itself; nothing was written.

**h12-kit and h8-billing merged** (run `wf_f2eaa16e-1a9`), both clean with no merge-time fix: DOS-164 as `146eed2`, DOS-116 as `73b120c`. No generated README changed. One contract note: `/docs/openapi.json` for owner, manager and delivery no longer carries `default: true` on `lines[].saleable`. Batch 2 now has 18 approved findings on main (3 P0, 15 P1).

**h11-syncpull merged** as `be5c40f` at 17:21 (run `wf_c0a9229d-d52`): DOS-080. The merge was clean, and the sync specs pass on the merged tree (coverage 25/25, sync 9/9). The review raised a suspect, S-98: sign-out never wipes the device store. It is being probed on the sales web app now.

**h11-syncpull verified** (run `wf_51c8b336-66e`): DOS-080 `38032df`.
- **The fix:** a pull page now fills its limit across tables, the cursor never passes a table's unread rows or tombstones, and a snapshot takes about ceil(rows / limit) + 1 calls.
- **Tests:** four new coverage tests failed before the fix for the storm reasons (25 pages against 9, rows sent twice) and pass after. One pin was added for amendment (a).
- **Existing tests:** six existing coverage tests now drain the whole pass instead of reading page 1. The plan and amendment (c) require this, and their assertions are unchanged.
- **Merge review:** the Fable merge review is running.

### Batch 2 — approvals (founder, 2026-09-13 18:10 IST: "Approved")

Answer to the approval gate that asked about DOS-167 P0, 11 lean-design decisions and the P2/P3 setup:
- **DOS-167 (P0) is added to batch 2 and goes first.** Order: Fable design → Opus build and verify → Fable merge review → proof on Android and iOS as well as web.
- **All 11 recommended defaults are approved:** DOS-006, 016, 066, 071, 054, 081, 087, 100, 102, 103, 138. Text: `QA/evidence/batch2/lean-founder-questions.md`; designs: `verdicts/lean-<group>.md`. They go into docs/22 §8 on branch `qa/b2-docs22`.
- **The cheaper P2/P3 setup is approved:**
  - Sonnet 5 builds, verifies and integrates each lean group.
  - Fable reviews a group before merge only when it contains a P2.
  - Phones are walked where a fix changes a phone screen.
  - Estimate for all remaining work: about $900–1,400 at API list prices.
- **P2/P3 building started** with the groups that do not touch DOS-167's files: lean-sales-entry, lean-kit-overlays and lean-manager-billing, two at a time.

**h10-console and h13-owner-support merged** (run `wf_0449696e-a32`): DOS-109 and DOS-107 as `ff1393e`, DOS-108 as `a19edf3`. Both merges were clean.
- **h10:** prettier fixed in platform-admin.spec.ts, and the admin-service and admin-app READMEs regenerated.
- **h13:** the frontend lockfile auto-merged; `pnpm install --frozen-lockfile` passes.
- **Result:** all 25 batch-2 P1 findings are on main. Still owed: the platform walks, the owner Support access walk on the DOS-164 overlay host, and three "may follow" minors in the admin console (auditChange has no 'user.enabled' case, the unlock dialog keeps its old error, and a spec comment still counts fifteen).

### Batch 2 — lean wave 1 merged (2026-09-13, 20:04 IST)

**Run `wf_5c958b90-522`** — Sonnet 5 build, verify and integrate; Fable merge review (every group has a P2); 20 agents, about 1 h 55 min. 15 findings merged (11 P2, 4 P3). Every item failed its test before the fix and passed after; no verifier blocker. Per-group reports: `QA/evidence/batch2/lane-results/lean-<group>.json`; reviews: `merge-reviews/lean-<group>.md`.
- **lean-kit-overlays `8c6d228`:** DOS-152 `4af2565`, DOS-159 `bf47ebd`, DOS-157 `6b4aee5`, DOS-162 `23d33c8`, DOS-158 `d6977fa`. Review: MERGE AFTER FIXES. DOS-159's KeyboardAvoidingView was sized by its content, so every native Sheet would stop at 86 % of its own height with a tap-to-close gap under it, and Android's 'height' behaviour could shrink a short sheet to nothing. Merge-time fix `58a8a99` gives it a definite height.
- **lean-sales-entry `e6f931c`:** DOS-128 + DOS-147 `636cc3f`, DOS-161 `30927ba`, DOS-085 `a226956` + review fix `996a4e1`, DOS-082 `3d7e61f`, DOS-129 `e250fde`. Review: MERGE AFTER FIXES. The phone footer's full-width button squeezed the money read-back; fix `101fc28`.
- **lean-manager-billing `663c6f3`:** DOS-022 `7865d6c`, DOS-026 `42f6bcb`, DOS-024 `917a505`, DOS-134 `1ae9a0d`. Review: MERGE AFTER FIXES. Print the challan opened from a poll timer, which a web browser blocks outside the tap; fix `144bcfe`.
- **Pushed:** origin/main = `663c6f3`, which also carries the docs/22 merge `46f2227`.
- **NOT TESTED (goes to the A.12 regression):** every walk the builders listed — W5 Short sheet (Android), credit-note Sheet with Gboard (Android) and a Sheet with a text field (iOS), Load-out chip plus two chip registers (Android), print cancel (iOS and Android), refused-write button label (Android), sales order entry phone footer and pieces pad (web phone, Android, iOS), the QtyStepper confirm on delivery D4 / van sale and manager M20, Print the challan (web, Android, iOS).
- **New suspects:** S-102..S-109 in `QA/findings/12` (money: S-106, the parked-pack double count in 'left to bill').
- **Wave 2 started:** lean-retailer-shop (DOS-101, 123, 124, 154, 105, 143, 144) and lean-backend-platform (DOS-127, 160, 028, 112, 151); worktrees from main `663c6f3`, DBs `dos_test_b2_lr` and `dos_test_b2_lb`.

### Batch 2 — DOS-167 answer (founder, 2026-09-13 20:21 IST: "DOS-167 — A")

- **Rule:** when someone signs out with changes not yet sent, the changes stay on that phone for that person only. They go first the next time that person signs in there. The sign-out sheet names the count, offers "Send now" when there is signal, and offers "Sign out, keep them here". Nothing is thrown away at sign-out, and nobody else who signs in can see or send them.
- **docs/22:** §7 diagram note, §8 row and §11 change log, committed as `0f5a9b5`; the source-of-truth artifact is republished.
- **Run `wf_74bd442f-12c` started:**
  - Build: a libs slice, then an apps slice. Each gets an Opus build, an adversarial verify and one repair round.
  - Review: two Fable merge reviews, one for leaks and one for loss and platform.
  - Merge: Opus integration with one repair round, then merge and push.
  - Proof: web (persistent store), Android sales, Android delivery and warehouse, and iOS, then a Fable judge per platform.

### Batch 2 — DOS-167 first pass: libs verified, apps slice sent to an architect ruling (22:17 IST)

**Run `wf_74bd442f-12c`** — 6 agents, about 1 h 52 min. Lane result: `QA/evidence/batch2/lane-results/DOS-167.json`.
- **Libs slice `afc8b6e`: VERIFIED.** 13 new tests (11 in offline identity.test.ts, 2 in api-client identity.test.ts), each red before and green after. The DISTRIBUTOR test in engine.test.ts moved to `identity` as amendment (k) allows. Two deviations were proven by mutation:
  - end() also waits for the open and for a pull in flight; otherwise a pull page commits its cursor into the kept file after the drop.
  - The stamp writes `role` only when none is stored, so the manifest still catches a role change. A new test covers it.
- **Apps slice `9c304b7` + review fix `3386a4e`: NOT VERIFIED.** The re-verifier's executed probe found a loss race:
  - A one-tap sign-out calls end({ keepQueue: false }), which waits for a pull still in flight.
  - An order the same rep queues in that window resolves with an opId.
  - wipe() then deletes the queue and the file. Nothing is uploaded.
  - This path is new with DOS-167, breaks answer A, and the design does not cover it, so it goes to the architect.
- **Minors:**
  - 'Sign out, keep them here' is 24 characters, over the kit's 20-character button rule.
  - The title reads '1 changes'.
  - When only refusals remain, the body still says the changes go by themselves.
  - No test covers the Chrome wiring in the three layouts.
  - A pre-existing unhandled switchDistributor rejection.
- **Next:** the same run is resumed with a ruling stage — Fable ruling → Opus build → adversarial verify (one repair) — then the two Fable merge reviews, integration, merge, the web/Android/iOS proof and the Fable judge.
- **Wave 2 (seen in git log):** lean-retailer-shop merged `b17e23f`; lean-backend-platform is integrating.

### Batch 2 — lean wave 2 merged; one review blocker missed (22:22 IST)

**Run `wf_a339006c-4dc`** — 14 agents, about 2 h 10 min. 12 findings merged (7 P2, 5 P3); every item failed its test before the fix and passed after. Reports: `lane-results/lean-retailer-shop.json`, `lean-backend-platform.json`; reviews: `merge-reviews/lean-retailer-shop.md`, `lean-backend-platform.md`.

**lean-retailer-shop `b17e23f`:** DOS-101 `effbef8`, DOS-123 `7ecae27`, DOS-124 `37bd879`, DOS-154 `bcaf0fb`, DOS-105 `89ea1ed`, DOS-143 `d37b31b`, DOS-144 `526bfe4`.
- Review: MERGE AFTER FIXES. All three blockers were applied in `6949209`:
  - a short line is measured against picked pieces, not delivered ones (delivered is 0 until the door);
  - Pay treats an emptied amount as ₹0, with its own "Enter an amount" reason;
  - the seeded dues-reminder date is written out in words.

**lean-backend-platform `d1c7da0`:** DOS-127 `861da8d`, DOS-160 `d78574d`, DOS-028 `0df8bad`, DOS-112 `f8fff34` + `16d05b6`, DOS-151 `98a0256`.
- Review: MERGE AFTER FIXES, with one blocker: DOS-112's settle redirect makes every real Day-end settle from the manager app answer 400, because the compact client link puts the settlement id in the path.
- **The blocker was NOT applied.**
  - The integrator took the pre-review commit `16d05b6` as the fix, but that commit is the redirect the review says breaks the settle.
  - The integration verifier compared merge hunks and never read the review.
- The regression is shown by code reading only so far (suspect S-113). A repair lane first proves the 400, then applies the review's preferred fix.

**Pushed:** origin/main = `d1c7da0`.

**NOT TESTED** — every walk the builders listed:
- retailer R7 pieces;
- the bill's proof-of-delivery photo;
- Pay from a bill, and Pay's amount field;
- the returns, cancelled-order and offers wording;
- My orders' IST date;
- a short-picked order's page;
- owner Settings > Audit;
- Day-end settle.

**Owed:**
- a dos_qa reseed for the DOS-123 / DOS-105 demo data, at the A.12 rebuild;
- a live `pnpm smoke --run-tag` pass for DOS-112.

**New suspects:** S-110..S-115.

**Process fix:** later lean waves use `qa-batch2-lean-wave3.js`. Its integration verifier checks each review blocker on HEAD.

### Batch 2 — DOS-112 settle repair merged: S-113 confirmed and fixed (23:16 IST)

**Run `wf_4cfc5e81-4e4`** — 7 agents, about 49 min. Lane result: `lane-results/dos112-settle.json`. Review: `merge-reviews/dos112-settle.md` (MERGE).

**Proven before the fix.**
- The real `createApiClient`, given Day-end's input, sent `POST /delivery/trips/<settlementId>/settle` with the trip in the body.
- A temporary server probe sent that same request; the guard answered 400 ("the id in the URL … does not match the tripId in the body").
- The regression was real: every manager Day-end settle on main `d1c7da0` was refused.

**Fix `dd5ffeb`.**
- The contract path is now `/delivery/trips/{tripId}/settle`, and the settle redirect is removed.
- Smoke pathParams use `{ tripId }`.
- The published example now puts the trip in the path.
- 10 READMEs were regenerated (`2137755`), and the delivery plan doc was corrected (`dfeacab`).
- Test results:
  - api-client client.test.ts: 22/22
  - delivery.spec.ts: 34/34
  - manager-service permission matrix: 346/346
  - delivery-service: 262/262
  - examples.spec: 32/32
- The adversarial verifier re-proved red and green.

**Merged** `468a926` and pushed.

**Live probe on dos_qa.**
- NOT TESTED: a successful settle. dos_qa holds no trip in `closing` (Tarsun: 61 settled, 20 settled with variance, 1 active, 1 planned), and no data was made up.
- PASS: the path check. The same client call on a settled trip put the trip id in the path and got 409 "already settled", not 400.
- The script `QA/tools/e2e/dos-112-settle-probe.mjs` is kept for the re-run.
- The prober rebuilt the main libs at `468a926` and migrated dos_qa; services answer 200.

**Still owed:**
- A manager Day-end settle walk on web and Android.
- `pnpm smoke --run-tag`.
- A pre-existing minor stays open: the path/body check runs before the bearer check, so an anonymous mismatched call gets 400 instead of 401.

### Batch 2 — six suspects confirmed, two of them P0 (2026-09-14 01:01 IST)

**Run `wf_309501e5-2f5`** — 12 agents, about 1 h 40 min. Each suspect got an executed probe on current main, then a skeptic who re-ran the probe and tried to refute it. All six were confirmed and all six upheld. No product code was changed. Evidence: `QA/evidence/batch2/suspects/<S-id>/`; result: `lane-results/suspects-money.json`. The blocks are in `QA/findings/12`.

| New id | Suspect | Priority | What happens |
|---|---|---|---|
| DOS-168 | S-75b | P0 | Two desks bank the same receipt at the same moment and both calls return 200: BANK doubles and CASH/CHEQUES go negative. The window is under 5 ms for one receipt and about 25–50 ms for a 200-receipt batch (measured locally). |
| DOS-169 | S-76 = S-09 | P0 | Settlement counts collections rows only, and a cash receipt uploaded offline has none. An honest crew shows as cash over and needs the owner; cash a crew keeps settles green. Banking later makes the error permanent. |
| DOS-170 | S-75a | P1 | Undoing a trip cash receipt after its trip settled credits CASH_VAN again (-₹134 with the crew), and office CASH stays overstated. |
| DOS-171 | S-28 | P1 | The van sale's 'Sale total' shows the pre-GST net: ₹221.40, while the bill issued is ₹248.00. |
| DOS-172 | S-03 | P1 | A bill returned undelivered after its load sheet was confirmed can never go on another load sheet (409), and the next trip carries it with no count, no challan and no e-way bill check. |
| DOS-173 | S-106 | P3 | A pack parked without a bill is counted twice in 'left to bill' until dispatch. |

**NOT TESTED:** every screen and device (all proofs are API-level).
**Next:** Fable designs, then one approval request to the founder. Nothing is built before approval.

### Batch 2 — DOS-167 merged; the web proof finds a store-name regression (2026-09-14 01:05 IST)

**The resumed run `wf_74bd442f-12c` merged DOS-167 as `199952b` and pushed it.**
- **Ruling 1 (Fable), no founder question needed** (`verdicts/DOS-167-ruling-1.json`). Four mandatory amendments, built in `3a07863`, `6d533f5`, `c81cba4` and `10e864e`, all verified red before and green after:
  - (m) from the sign-out tap on, the engine refuses new writes, and a write already in hand is finished, counted and kept;
  - (n) the sheet's words: a 19-character keep button, the singular form, and the truth about refusals;
  - (o) no read answers from the store until the identity is claimed;
  - (p) the sweep closes a store it could not count.
- **Merge reviews:** leak and loss both said MERGE AFTER FIXES. The integration fixed their blockers:
  - `54aa621`: a stop() while the store opens never attaches it or calls the office;
  - `80c354c`: docs/27 no longer says kept refusals go out by themselves;
  - `4acd5f8`: the outbox and tray hooks never leave a rejected query unhandled.
- **Web proof: FAIL** (`QA/evidence/batch2/dos-167/web/`). A new **P1 regression** caused by the fix itself:
  - The per-person store name is 92+ characters, and expo-sqlite web (wa-sqlite AccessHandlePoolVFS) refuses paths over 56 characters.
  - The open fails silently into a memory store, so every web field app loses its persistent offline copy.
  - An order kept with "Sign out, keep here" is gone: nothing was uploaded, and dos_qa has 0 rows.
  - The no-leak variants passed, but only on the memory store.
  - Two P3s were also found. One order counts as "2 changes" (the header and its line). A write refused during sign-out shows the generic "try again".
- **Android sales proof: PASS** (`QA/evidence/batch2/dos-167/android/`). Files are keyed per person, sign-out removes them, and the next person sees no markers. A kept order is kept and sent at the next sign-in. The same P3 "2 changes" count appears here.
- **Still running:** Android delivery and warehouse, iOS, and the Fable judge. DOS-167 stays open.
- **Repair:** Fable ruling 2 covers the store name, the silent fallback, the count, and the order-enqueue gap between the header and its lines. Then build, verify, review, merge, and re-run the proof.
- **New suspects:** S-116..S-123 — see QA/findings/12. They are the ruling-1 out-of-scope items, the verifier minor and the proof defects.
- **Lean wave 3 is on HOLD** until the proofs finish and the store-name repair merges.

### Batch 2 — DOS-167 ruling 2 (Fable) on the web store-name regression (2026-09-14 01:24 IST)

**Run `wf_03a998d4-f25`** — 1 Fable agent, about 15 min. Ruling: `verdicts/DOS-167-ruling-2.md` and `.json`. No founder question; answer A decides everything below.

**Root cause (confirmed in code).** wa-sqlite's VFS has `mxPathname = 64`, and SQLite refuses a path when its length + 8 > 64. The databasePath `'./' + name` must therefore be at most 56 characters. The 199952b names are 92–96 characters.

**Mandatory amendments:**
- **(s) The name.** It is `<app><user><distributor>`: 51 lowercase base-36 characters, lossless and provably collision-free, so it is safe even on the case-insensitive filesystem of the iOS simulator. `parseStoreName` turns a name back into its ids. The long-name files from 199952b are swept once for the signed-in person, and kept if they still hold anything unsent.
- **(t) The fallback.** It is logged and named in the sync status. On a memory store the leave sheet offers only "Send now" (online) or "Cancel". The sign-out waits, and a new sentence says this browser cannot keep the changes.
- **(u) Orders.** An order and its lines are queued as one write, whole or not at all. A kept file keeps its drafts, and the sweep runs on every sign-out.
- **(v) The refusal sentence.** A write refused because the phone is signing out shows its own sentence on the sales order screen.

**Left as is:** (w) the count stays as outbox ops, so S-121 stays open.

**New suspects:** S-124 and S-125. The strip cannot say "not kept in this browser", and the order screen says "Saved on this phone" on a memory store.

**Build prepared, not launched.** It waits for the running delivery, warehouse and iOS proofs of `wf_74bd442f-12c`, which hold the emulator and simulator (not enough RAM for both).

### Batch 2 — designs for DOS-168..172; Fable limit reached (2026-09-14 01:26 IST)

**Run `wf_4254a4ee-d2f`** produced three Fable designs:
- **`verdicts/DOS-168-169-170-design.md` (money, 1.5 d).**
  - Every receipt row is locked while it moves.
  - Day-end counts the trip's receipts however they arrived, net of undone ones.
  - An undo takes money from where it actually is (van, office till, bank).
  - A receipt for a settled trip is refused with `trip_settled`.
  - A check-in gate stops a vehicle from being checked in while its phone still holds unsent records.
  - No migration and no contract change.
  - Founder questions: a receipt that reaches the office after its trip settled (recommended: refuse it, and the cashier records the cash); correcting figures already wrong in the founder's own dos (recommended: one balancing entry per case, signed off trip by trip).
- **`verdicts/DOS-171-design.md` (van sale, 0.75 d).**
  - D6 shows the GST-inclusive total.
  - D5 is fixed as well.
  - Founder question: build now, or wait for cess (DOS-079)? Recommended: build now.
- **`verdicts/DOS-172-design.md` (load sheet, 1.75 d; covers S-03 and S-82).**
  - A load sheet's claim on a bill ends when the bill comes back undelivered.
  - The bill returns to W7 and the planning board.
  - Contract change.
  - Founder question: may a trip leave the godown with a bill no load sheet counted? Recommended: no.

**The cross-design critic failed:** "You've reached your Fable limit". Fable is unavailable until the Saturday 11:30 IST reset. Opus now stands in, labelled as such, for the critic, the revision pass, the DOS-167 ruling-2 merge review and judge, and lean merge reviews. The design run was resumed on that basis, with the designs replayed from cache.

### Batch 2 — designs revised; the DOS-167 Android keep-path crash; approval request (2026-09-14 02:04 IST)

**Designs.** The Opus stand-in critic said NEEDS-CHANGES (8 overlaps, 16 gaps). One Opus revision per design followed.
- Main gaps fixed:
  - the D8 hand-over heuristic is replaced;
  - trip detail reads the same receipt money as settlement;
  - trip_settled refuses only cash and cheque (UPI is accepted);
  - allocations lock the receipt too;
  - late collections ops get the same refusal as receipts ops;
  - a desk check-in follow-up;
  - the repair queries are made exact;
  - the van-sale repair is one-shot;
  - the godown holds a returned bill until check-in;
  - a binding rule that every new spec loads out through a confirmed sheet.
- The founder questions were merged into three, all recommending A. The cess question was dropped: the architect builds DOS-171 now and recommends moving DOS-079's cess earlier.

**DOS-167 Android delivery and warehouse proof: FAIL.**
- **P1 (S-128), 2 of 2:** the delivery app crashes natively right after "Sign out, keep here". SIGSEGV in expo-sqlite `sqlite3_reset`, most likely a store call racing the close.
  - No data was lost: the kept file is intact and the op was sent once at the owner's next sign-in.
  - One-tap sign-outs did not crash.
- **P2 (S-126):** one warehouse cold-start crash in the React Native Fabric renderer, seen once and not attributed to DOS-167.
- **P3 (S-127):** delivery says "Still filling this phone" after a completed pull.
- **Repair:** addendum (x) (`verdicts/DOS-167-ruling-2-addendum.md`, written by the main session as the Opus stand-in). end() drains every store call before it closes the store, and the adapter refuses calls after close. It is folded into the prepared ruling-2 build. Its re-proof adds the keep path three times on delivery, once on warehouse and once on iOS, plus the S-126 and S-127 checks.

**Approval request sent:** add DOS-168..DOS-173 to batch 2, with questions Q1–Q3.

### Batch 2 — DOS-167 iOS proof: a P0 on the keep path; addendum (y) (2026-09-14 02:44 IST)

**Run `wf_74bd442f-12c` finished.** 18 agents ran; the Fable judge failed on the usage limit, so the run has no verdict. Lane result: `lane-results/DOS-167.json`.

**iOS, Expo Go on the iPhone 16 Pro simulator: FAIL.** Evidence: `QA/evidence/batch2/dos-167/ios/`.
- **PASS:**
  - Sales steps 1–4: a store file per person, sign-out removes it, and the next person sees none of the previous rep's rows.
  - The cold-start sign-out sheet with Cancel.
  - The delivery and warehouse leak sequences.
- **P0 (S-130), 2 of 2:** "Sign out, keep here" crashes Expo Go natively.
  - The fault is SIGSEGV at 0x1000000bb in `exsqlite3_reset`, the same as Android S-128.
  - The sign-out never completes. The relaunch is still signed in as the rep who chose to sign out, so on a shared phone the next person is inside that rep's session.
  - No data was lost: both kept orders reached dos_qa once.
- **P3 (S-129):** the kit's native sheets are one accessibility element on iOS, so rows cannot be targeted one by one. This predates DOS-167.

**Repair — addendum (y)**, written by the main session as the Opus stand-in:
- The leave flow clears the stored session before `end()` touches the store, and revokes on the server afterwards in the background.
- A crash during sign-out can therefore never leave the person signed in.
- Addendum (x) is the drain before close.
- Both are folded into the ruling-2 build, whose re-proof now includes the iOS and Android keep paths three times each with the outbox retrying.


### Batch 2 — main was red since wave 1; DOS-167 ruling-2 first pass (2026-09-14 05:22 IST)

**Run `wf_a77ba6a6-adc`, first pass — ended `integration-blocked`.** 6 agents, about 2 h 33 min. Lane result: `lane-results/DOS-167-ruling-2.json`.
- **Build and verify: PASSED.** 10 commits:
  - one per amendment: (s) `dcbd1c8`, (t) `8a62f92`, (u) `910eb3f`, (v) `428f886`, (x) `e4d251e`, (y) `fb2b786`;
  - four review repairs: one holder per device file, the leaving runs inside the sign-out and waits for the secure store, a late refresh signs nobody back in, and the docs.
  - Every test failed before its fix and passed after. The verifier left only minors.
- **Review** (Opus standing in for Fable, `merge-reviews/dos167-ruling2.md`): MERGE AFTER FIXES. The blocker was to run the full frontend gate before merging.
- **Integration** on `31de0f8`:
  - Green: lint, typecheck, build (8 web exports), format, docs:readme:check, and a Hermes Android export containing the BigInt store-name code.
  - Red: one test, `@dos/ui` `document-urls.test.ts`.
- **The red was not this lane's.** Main has been red since wave 1:
  - Cause: the DOS-026 merge-time fix `144bcfe` sent the challan URL through a helper and state, so the guard could not see `absoluteUrl()` at `load-out.tsx:236` and `:464`.
  - Why nobody noticed: the lean integrator re-ran only the group's own test files.
  - Confirmed by running the guard on main at 05:19.
- **Fixed on main as `1f8e0c3`.** The URL now goes through `absoluteUrl()` where it is opened. Behaviour is identical, because the URL was already absolute and absoluteUrl returns an absolute URL unchanged. Checks: guard green, manager-app typecheck, eslint, prettier (S-134).
- **Process:** later lean integrators run the kit's cross-app guards.
- **Addendum (z)** comes from the review:
  - (z1) Settings > Sign out on delivery and warehouse bypassed the leave flow (S-131, P1). It now uses the same flow.
  - (z2) A sign-in waits at most 25 s for the previous leaving.
  - (z3) Drafts are kept when end() throws.
- **New suspects:** S-132 (SecureStore writes not awaited) and S-133 (a forced sign-out on a memory store drops the queue).
- **Next:** the run resumes from cache into integration, with (z), then merge and the full re-proof.


### Batch 2 — document-URL guard: investigation and clean fix (2026-09-14 08:04 IST)

**Founder request:** determine whether the guard failure at load-out.tsx:236 and :464 was (a) a real relative-URL bug or (b) a safe value the guard could not trace, and fix it without weakening the test.

**Finding: (b).**
- `result.url` (`string|null`, contracts common.ts:116) went through `absoluteUrl()` before `nextChallanPoll`.
- The poll's `open` step returns the exact url it was given (load-out.ts:73).
- `challanUrl` is only ever null or that value (load-out.tsx:84, :221, :238, :360).
- `absoluteUrl` returns an absolute URL unchanged, and returns null only for null, undefined or `''` (config.ts:41-45).

**Fix `9532a67`** replaces 1f8e0c3's `absoluteUrl(x) ?? x`, which kept a raw fallback:
- `const readyUrl = absoluteUrl(result.url)` is fed to the poll, and it is the only value opened or stored.
- On the button, `const printUrl = absoluteUrl(challanUrl)` is a no-op re-check.
- Both values are checked for null.
- The button still opens synchronously inside the tap.
- The guard test is unchanged.

**Checks (all exit 0):**
- guard 4/4
- manager-app load-out.test.ts 6/6
- manager-app typecheck and lint
- ui typecheck and lint
- frontend format:check

**Adversarial read-only verifier: UPHELD.**
- Caveat: a scheme-less API_URL would double-prefix the button path; no configuration does that.
- It also re-confirmed S-108 by code reading: closing the sheet never bumps `challanToken`, so a running poll can open sheet A's challan from sheet B. One-line fix; offered to the founder, not applied.


### Batch 2 — approvals (founder, 2026-09-14 08:12 IST: "Approved")

The founder approved the request for the six confirmed findings and the one-line S-108 fix.
- **Added to batch 2:** DOS-168 and DOS-169 (P0), DOS-170, DOS-171 and DOS-172 (P1), DOS-173 (P3).
- **Answers, all A:**
  - Q1 (DOS-169): a late cash or cheque trip payment is refused and handed to the cashier; UPI is accepted.
  - Q2 (DOS-172): no trip departs with a bill that no load sheet counted out.
  - Q3: wrong money figures in the founder's own dos are corrected by one appended entry per case, signed off trip by trip.
- **Also approved:** the S-108 challan-poll fix (closing the panel cancels a waiting print). "Approved" was read as covering both the pending approval request and that question.
- **Architect decisions carried with the batch:** DOS-171 is built now, and DOS-079's cess moves up to follow it. DOS-173 goes to lean-orders-panels (owner of billing/index.tsx).
- **docs/22 updated in the same turn:** §4 T1, D5 and D8 nodes; the §6 diagram and prose; the §7 sign-out note; six §8 rows; a §11 line. The "Sign out, keep here" wording is corrected. The artifact is republished.
- **Build plan:**
  - Lanes: b2-money (receivables → settlement → phone), b2-dos171 (backend → app), b2-s108, b2-dos172 (backend → apps).
  - Each slice: Opus implementer and adversarial verifier, one repair round.
  - Review: Opus merge reviews standing in for Fable, whose limit resets Saturday.
  - At most 2 build lanes at once, while the DOS-167 re-proof holds the devices.
  - Merge order: money → dos171 → dos172; s108 whenever it is ready.
  - Platform proofs run in a later run, once the devices are free.
- **Q3 data repair:** runs after the money fix merges. The founder is told before `pnpm db:migrate` runs on dos.


### Batch 2 — DOS-167 ruling-2 re-proof: the phones pass, the web store fails (2026-09-14 09:59 IST)

**Run `wf_a77ba6a6-adc`** — 13 agents, about 4 h 34 min. The merge `bafb7b5` includes the (z) commits `c236f18`, `c457b5b` and `4be7fe2`, plus docs `9eed92b`. The judge (Opus standing in for Fable) says **OPEN**. Lane result: `lane-results/DOS-167-ruling-2.json`; evidence: `QA/evidence/batch2/dos-167/reproof/`.

**Proven**
- **Android delivery and warehouse:** store names decode to the right person and distributor, and the next person sees none of the previous person's data. Sign out through Settings shows the sheet. "Keep" never crashed, each relaunch came back to the sign-in form, and each kept op was sent once.
- **iOS sales, delivery and warehouse:** one store file per person, no leak, and no crash across three keep runs with the office unreachable. Each relaunch showed the sign-in form, and "Send now" works.

**Failed**
- **P1 (S-138), web sales on a persistent store:** the store never opens when the expo-sqlite chunk and worker arrive late. This happened on the first load after a Metro start, and with 600 ms of added latency (4 of 4 runs; the control passed).
  - 'SQLiteError: not a database' is thrown.
  - The OPFS pool fills with orphan temp files and '/dos-sales.db-wal'.
  - The engine makes no sync call for 240 s.

  The judge suspects a clean-up step that DOS-167 added.
- **P3 (S-139):** no app passes onLog, so the 'offline:' lines never print. This fails the web memory-variant check and the Android upgrade check. The file behaviour itself was right.
- **P3 (S-140):** on a persistent web store, "will not keep" flashes for 39–82 ms after every sign-in.

**Not DOS-167**
- S-135 (P2): warehouse waves cannot be reached offline.
- S-136 (P3): LogBox state-update warning on Android debug builds.
- S-137 (P3): a 401 after sign-in, then a refresh; this predates DOS-167.
- S-127 predates DOS-167; a warehouse variant was also seen.

**Next:** DOS-167 ruling 3. First diagnose S-138 by executing it, then build, verify, review, and integrate with the full frontend gate. After that, a focused web re-proof plus the device gaps, and the judge.


### Batch 2 — the weekly limit cut both runs; restarted on 2026-09-19 12:08 IST

**What happened.** On 2026-09-14 the weekly usage limit (reset Sep 19, 11:30 IST) killed four agents in the lane build run `wf_6abc2042-1ff` and the first agent of DOS-167 ruling 3 `wf_0f651b54-f1b`. Nothing was merged, and no committed work was lost.

**What survived, on the lane branches, each adversarially verified:**
- money: receivables `9c44458` + `d19d39d`, settlement `1b4e022` (its re-verification never ran).
- DOS-171: `cafb0ef` + `483685a`, with a review (MERGE AFTER FIXES, two blockers).
- S-108: `0f49863`, with a review (MERGE).
- DOS-172: backend `60b55f2` + `f61f265`; the app slice never finished and left two uncommitted test files.

**Why resume was impossible.** Both scripts lived in the session scratchpad under /private/tmp, which was wiped. A resume needs the identical script.

**Fix for next time.** Workflow scripts now live in the repository at `QA/tools/batch2/workflows/`.

**Restarted:**
- `wf_ee45b8a1-b2c` (`finish-lanes.js`): verify the money settlement slice as committed, build the money phone slice and the DOS-172 app slice, write the two missing reviews, then integrate and merge in the order S-108, money, DOS-171, DOS-172.
- `wf_586d5dd5-dcf` (`dos167-ruling3.js`): diagnose S-138 by execution, then ruling 3, build, review, integrate with the full frontend gate, merge, re-proof and judge.

### CI red on main — backend lint, `@dos/db` test-setup (2026-09-19)

**Reported by the founder** as a GitHub Actions failure: `backend/libs/database/src/test-setup.ts:3:1 Unsafe call of a type that could not be resolved (@typescript-eslint/no-unsafe-call)`.

**Cause.** That file was the one place in the backend where a package imported ITSELF by package name (`import { loadDotenv } from '@dos/db'`), which resolves to `dist/`. Turbo runs `lint` after its DEPENDENCIES' `^build`, not after the package's own build, so on a clean CI checkout `libs/database/dist` does not exist when `@dos/db:lint` runs, the import resolves to nothing, and the type-aware rule sees `any`. On this Mac `dist/` is always present from an earlier build, which is why it never went red locally.

**Fix.** `import { loadDotenv } from './env.js'` — the same relative import `migrate.ts` and `seed.ts` already use. No behaviour change; `env.js` is what `@dos/db` re-exports.

**Proof, executed under the CI condition (`rm -rf libs/database/dist`).** Before: `eslint .` exit 1, that one error. After: exit 0. Then the backend CI gates from the repo root: `pnpm format:check` 0, `pnpm lint` 0 (19 tasks), `pnpm typecheck` 0 (19), `pnpm build` 0 (14).

**Swept for recurrences:** no other backend package (`@dos/domain`, `@dos/contracts`, `@dos/db`, `@dos/core`) imports its own package name anywhere in `src/`.

### CI red on main — backend tests, the doc-example specs (2026-09-19)

**Reported by the founder** as the next GitHub Actions failure after the lint fix: `@dos/core` `src/docs/examples.spec.ts`, three assertions — `ctx.variantId` undefined, one broken `retailers.linkIdentity` example, and no parsed party-master import row.

**Cause.** The CI backend job runs `pnpm db:migrate` and then `pnpm test`, and never seeds. `describeDb('doc examples against the demo database')` runs whenever `DATABASE_URL` resolves, and on CI it resolves to a migrated but EMPTY database: there is no tenant with shops, products and orders to build an example from. It read as three failures rather than four only because other specs in the same turbo run had created a tenant and a retailer as their own fixtures — that part was a race. Nobody saw it locally: every developer database here is seeded.

**Fix.** One line in `.github/workflows/ci.yml`, `pnpm db:seed` between migrate and test, with a comment saying why. `db:seed` is idempotent. No source or test change; the spec is right to demand demo rows.

**Proof, executed on a fresh database (`dos_test_ci_repro`, created and dropped for this).** Migrate only: `vitest run src/docs/examples.spec.ts` → 4 failed / 28 passed. Then `pnpm db:seed` → 32 passed / 32. Then the whole backend suite against that seeded copy: `pnpm test` exit 0, 19 of 19 turbo tasks.

### DOS-167 — Fable back in the architect seat, and five amendments to ruling 3 (2026-09-19)

**Why it matters.** Both runs relaunched this morning were written on 2026-09-14, while Fable's weekly limit was exhausted, so every architect seat in them still said "Opus standing in for Fable". The limit reset at 11:30 IST and the scripts were not switched back — the Opus stand-in wrote ruling 3 at 13:35. The founder caught it. From the DOS-167 close decision onward every architect role is Fable again.

**First act as architect: an adversarial review of ruling 3** (read-only, against the executed diagnosis, the ruling-2 addenda, docs/27 and the offline sources). Verdict **SOUND WITH AMENDMENTS**, five of them, written to `QA/evidence/batch2/verdicts/DOS-167-ruling-3-architect-review.md` and binding on the build:

- **A1** — the `persistent: boolean | null` widening must be threaded through EVERY hop (`LeaveSession.persistent`, the three `_layout` device props, the `LeaveSheet` prop, `leaveButtons`/`leaveSentence`, and the owner, manager and retailer consumers), not only the endpoints the ruling named; proven red by a failing `pnpm typecheck`.
- **A2** — the never-a-hang memory fallback must RELEASE the failed persistent file's `holdFile` hold; proven by a post-open corruption that drops to memory, after which a second engine on the same store name still opens instead of blocking.
- **A3** — the promoted S-138 gate must assert at most ONE VFS construction and ONE WASM init per load: the concurrency mode fired at delay 0 (`warm-instr`), and the pool-header check alone can pass over a latent second VFS.
- **A4** — a SECOND TAB of the same person must be proven to fall to an honest memory store without corrupting or evicting the first tab's persistent file. Ruling 3 omits this case.
- **A5** — the 15 s timeout path must CLOSE a late-arriving persistent handle, never destroy it, and keep the on-disk file, with a deadline generous enough not to abandon a slow-but-succeeding OPFS open.

**How they land.** The ruling-3 build was already three commits deep and mid-slice when the review came back, so it was not interrupted. The amendments run as their own lane after ruling 3 merges: `QA/tools/batch2/workflows/dos167-amendments.js` — implementer, adversarial verifier, one repair round, Fable's own merge review, integration with the full frontend gate including the kit cross-app guards, merge, then a re-proof of ONLY the four cases the amendments add (web memory fallback, web second tab, web timeout, an Android sanity walk), and finally Fable as judge on whether DOS-167 closes.

### Batch 2 — finish-lanes run wf_ee45b8a1-b2c finished (2026-09-19)

20 agents, about 2 h 45 min, 0 agent errors. **Merged and pushed: S-108 `c3b4ec1`** (the challan poll is cancelled when the load-sheet panel closes, so a reopened panel never opens a stale challan) **and DOS-171 `d65034b`** (the van sale shows the bill total with GST, keeps the bill on screen, and names no cash discount the bill never takes off). The DOS-167 ruling-3 repair merged in the same window as `ce3dc8c` from its own run.

**DOS-168..DOS-170 (money) did NOT merge.** Built, adversarially verified, reviewed twice (both MERGE AFTER FIXES, blockers resolved) and integrated to a green automated gate — but the integration verifier raised two majors:
- **The runtime proof both reviews demand was never run:** `QA/evidence/batch2/dos-168-170/{web,android,ios}` items 1–4 (two desks banking one receipt; the offline-receipt trip settling; the reversal on the trial balance; D8 with one receipt held offline at 1280×800 and 390×844, on the Pixel 7 and on iOS), plus `pnpm smoke` 0 BROKEN on a database copy. The integrator and the verifier were both forbidden by their briefs to start dev servers, emulators or simulators, so neither could close it. **This is a process gap of mine**: the reviews demanded runtime proof from agents that were not allowed to produce it.
- **Two out-of-lane defects the reviews ordered filed were not filed.** Now filed: **S-141** (`collections.list` totals still sum `collections` rows, so an offline doorstep payment can under-state the accountant's collections screen — `receivables/collections.service.ts:193-199`) and **S-142** (the delivery device pulls 90 days of WHOLE-TENANT receipts rather than the crew's own — `receivables.module.ts:48-54`). Both are code-reading only, NOT TESTED, and go to the next approval gate as DOS blocks.

**DOS-172 did not merge either** — it waits on money by design (it changes departure for every spec, so it merges last). Its branch holds the backend slice, the app slice and a review-fix commit, tree clean.

**Referred to Fable** (architect, 2026-09-19): does money merge now with the walks owed afterwards — the convention every lane merge message states, "Platform proof follows" — or must the walks run first? Only the architect may resolve that, and her ruling names the exact proof set, what happens if a walk fails after a merge, and the ordering against DOS-172. Output: `QA/evidence/batch2/verdicts/DOS-168-170-merge-gate-ruling.md`.

### DOS-168..DOS-170 — Fable's merge-gate ruling: MERGE NOW (2026-09-19)

The architect resolved the deadlock between the programme's own convention ("Platform proof follows", in every lane merge message) and the two money reviews, which demanded the device walks before the merge. **Decision: MERGE NOW**, proof owed afterwards, DOS-168/169/170 staying OPEN until the walks pass. Full ruling: `QA/evidence/batch2/verdicts/DOS-168-170-merge-gate-ruling.md`.

**The proof set she named, in order** (item 0 and 1 before DOS-172 rebases; 2–7 after):
0. Merge main into `qa/b2-money` and re-run the FULL gate on that tree — the lane last saw main at `6f2614b`, before DOS-171 and the ruling-3 repair — then merge and push.
1. `pnpm smoke --run-tag money-1`, then `--destructive`, on a fresh database copy: 0 BROKEN, with collections, settle, receipts and deposit all OK.
2. Web at 1280×800: two desks press Bank on ONE collected receipt in the same second — exactly one 2xx, the loser told "is deposited, not collected" (409 `receipt_moved`), one deposit ref, one `ChequeDeposited` row, one Dr BANK line.
3. Web + API probe: a returned trip whose only cash is a driver-uploaded receipt op with no `collections` row still shows that cash in the cockpit and settles green at float + X with Cr CASH_VAN = X; a second trip handed the float alone answers 409 `settlement_needs_owner`.
4. Web: the accountant undoes that receipt after settlement — the reversal credits CASH, never CASH_VAN; the trial balance shows CASH −X with CASH_VAN unchanged; the bill reopens; the settlement row is untouched.
5. Web delivery at both widths: one receipt held offline shows `d8-uncounted` and a disabled check-in, clears on re-open after reconnect with the hand-over rupee unchanged; in the settle-while-open leg the refused `trip_settled` op reaches the tray while D8 shows the settled figure.
6. **Android on the Pixel 7 — the one item that genuinely needs a real device** (SQLite outbox, airplane mode, background push, the tray).
7. iOS through `xcrun simctl`, renderer sanity only; a failure Android does not reproduce is P3 and never blocks.

**If a walk fails later:** it is a new finding repaired forward on `b2-money-r1`, re-proving only the failed leg. The merge is reverted **only** if the merged tree writes money wrong where main did not — an unbalanced journal, a double bank or double count, CASH_VAN not at 0, or a settle against founder answer A — and the forward fix is not on main within one working day. A screen fault never reverts.

**Ordering:** nothing in money waits for DOS-172, and DOS-172 must not merge before money; DOS-172 comes onto merged main once, resolving three `trips.service.ts` lines and the contract JSDoc hunks, folding a duplicate load-out helper at that merge.

**Three risks nobody else raised, now filed:**
- **S-143 (P1, money, data loss):** the delivery phone's tray offers **Discard** on a receipt op the server refused with `trip_settled` — discarding erases the phone's only record of cash a shop has already paid, which is exactly what founder answer A forbids.
- **S-144 (P2):** D8's settlement preview is fetched once per mount and never refetched, so a stale "money still on the phone" note can stand beside an enabled check-in button.
- **S-145 (P2):** the D8 held-money figure is totals-minus-totals, so it mis-states a two-phone crew or an unpulled desk receipt; bounded today by the outbox gate.

**Executing it:** run `wf_a26d0575-7f9`, script `QA/tools/batch2/workflows/money-then-dos172.js` — items 0 and 1, then DOS-172's merge. The walks (2–7) run in their own pass once the DOS-167 proofs free the browser and the emulator.

### Batch 2 — money and DOS-172 merged; the smoke pass FAILED; and a QA run damaged dos_qa (2026-09-19)

**Merged and pushed, per Fable's MERGE NOW ruling:** **DOS-168, DOS-169, DOS-170 `6e5c7c5`** (a trip payment arriving after its trip settled is refused and handed to the cashier, UPI and bank transfer accepted; a phone holding unsent payments cannot check its vehicle in) and **DOS-172 `d25574e`** (no trip departs with a packed bill no confirmed load sheet counted out; a returned bill waits on its van until check-in). Both re-gated on merged main: the whole backend suite forced (19/19 tasks, 0 cached), every touched spec, `examples.spec.ts`, the six service specs that mount the touched modules, `docs:readme:check`, the whole frontend gate including the kit cross-app guards, format and build. The money lane's single review blocker was re-checked on the merged HEAD and is resolved more strongly than either review asked: `dayEndCash` no longer accepts the screen's lagging `tripState` at all — the state rides with the figures as one snapshot (`check-in.ts:33`, read at `:103`). DOS-172's merge folded the duplicate load-out helper (`85e5ac8`).

**DOS-168/169/170 and DOS-172 are MERGED, PROOF OWED, and stay OPEN** until the browser and device walks (ruling items 2–7) pass.

#### The smoke pass failed: 6 BROKEN of 1606 calls

Fable's item 1 passes only at 0 BROKEN with collections, settle, receipts and deposit all OK. **It did not pass.** Collections, settle and receipts were OK in every lane. `deposit` never returned 200 on either run, and four faults reproduce on a fresh seeded database in both runs. Filed:

- **S-146 (P1, money)** — a receipt can be created against a `tripId` that exists in no `trips` row (no validation, and no FK because receipts→trips is an upstream reference). The settled-trip deposit guard then refuses it **forever** with `trip_cash_not_settled`, because that trip can never settle. Money collected against a non-existent trip is permanently un-bankable. The published contract example is what supplied the bad id. This sits squarely in the code that just merged.
- **S-147 (P1)** — `delivery.deliveries.addPod` answers 500 "proof insert returned nothing".
- **S-148 (P1)** — `delivery.consents.grant` answers 500 with no message; that consent is the gate a trip cannot depart without.
- **S-149 (P3)** — `notifications.messages.markRead` 404 for manager and warehouse: the published example names a message the seed never creates.
- **S-150 (P2, tooling)** — re-running `--destructive` with the same `--run-tag` on an already-mutated database silently skipped 328 of 1606 operations, so collections and settle were never exercised while the totals still read healthy.

Per the ruling's own terms these are new findings repaired forward, not a revert: none of them shows the merged tree writing money wrong where main did not. S-146 is the one to fix first.

#### A QA run committed destructive calls against dos_qa

**What happened.** The smoke agent's first destructive attempt omitted `--base`, so the harness fell back to its hardcoded `localhost:3000-3007` — which were occupied by services the DOS-167 proof run had started against **dos_qa** at 15:43. The run therefore read fixtures from the throwaway `dos_smoke_money` while CALLING services bound to dos_qa, and committed there before the agent caught it. The agent disclosed it rather than hiding it, stopped, assessed the damage read-only, and re-ran correctly against an all-in-one instance on :3100.

**Damage on dos_qa, assessed read-only:** all 4 tenants `active`, zero disabled users or memberships, and `auth.changePassword` sent `Dos@1234` → `Dos@1234`, so every demo sign-in still works. 15 destructive operations did commit, notably `receivables.allocations.remove` (reopens the bill it settled), `receivables.writeOffs.create`, `receivables.receipts.reverse`, `orders.cancel`, `procurement.supplierInvoices.cancel`, `claims.lines.remove`, `claims.writeOff`, `incentives.targets.remove`, `integrations.imports.cancel`, `docint.documents.reject`, `ai.drafts.reject`, `admin.support.revoke`, `auth.revokeSession`. `pnpm db:seed` restores demo access but will not undo the cancelled order, the removed allocation or the write-off. Evidence: `scratchpad/money1/smoke-run2.log` and `smoke-json-run2-DOS_QA/`.

**Consequence for DOS-167:** the DOS-167 re-proof was running against dos_qa in that same window (15:47–15:48 IST). Any leg of it that touched money, allocations or sessions in those two minutes must be re-run before its result is trusted.

**Repair, not yet done:** dos_qa needs a clean rebuild (stop services and worker, `dropdb --force`, `createdb`, `db:migrate`, `db:seed`, restart). It is deliberately NOT done while the DOS-167 proofs are still using it; it runs the moment that run reports.

**The fix so it cannot recur.** `backend/tools/smoke-endpoints.mts` now refuses to run when the two halves disagree: after sign-in it checks that the tenant the SERVICES returned actually exists in the database the FIXTURES read (`DATABASE_URL`), and aborts with both names if it does not. The gap was structural — the harness reads one database and calls whatever is listening on the ports, and nothing tied them together — and it is the same gap whether or not `--destructive` is passed. The run header now also prints the database name. (Noted while there: `backend/tools/` is neither linted nor typechecked by the gate — two pre-existing type errors sit in that file today. That is its own follow-up.)

### DOS-167 ruling 3 — merged and re-proved; the judge says OPEN (2026-09-19)

Run `wf_586d5dd5-dcf`, 12 agents, about 6 h. **Ruling 3 merged `ce3dc8c`.** The diagnosis was done by execution, not inference — 41 browser runs, `QA/evidence/batch2/dos-167/reproof2/diagnose/results-diagnose.json`.

**What S-138 actually was.** `OfflineProvider` issues THREE opens on first mount — the legacy `./dos-sales.db`, the engine's own store, and the interim sweep name — and all three await the SAME in-flight `import('expo-sqlite')`. With no added latency the three land 148/193/361 ms apart and the WASM module initialises once. Under any latency on that chunk they resolve in ONE microtask batch, 2–3 ms apart, and `maybeInitAsync()` sets `_sqlite3` only AFTER its `await`, so each concurrent call builds its own WASM module and its own `AccessHandlePoolVFS` over the same OPFS directory (measured: three VFS instances, 12 files in a 6-slot pool). Worse, wa-sqlite's `sqlite-api.js:34-35` keeps ONE module-global scratch cell that `open_v2` writes and then reads back across an `await`, so concurrent opens clobber each other's names — that is where the `0.<random>` orphans and the truncated 14-character header came from. And the interim name is 94 characters against wa-sqlite's 64-character path budget, so on web it could never open at all; its failure is what poisoned the two healthy connections. A reload does not heal it.

**Proven on the merged artefact:** 22 store-opening runs — 3 cold after a Metro restart, 3 at 600 ms and 3 at 1500 ms on both bundles, 7 on a real production `expo export` served with COOP/COEP, 3 next-person-same-profile, 3 second-tab — each leaving exactly ONE pool header and five empty slots, zero orphans, zero `not a database`, one manifest, twelve pulls. S-139 (silent log lines) and S-140 (the false "will not keep" flash) are both gone, on the browser and on the phone. iOS: **pass**.

**The judge (architect) says DOS-167 is still OPEN.** Named gaps:
1. **The memory-fallback warning is shown on the beat screen only** — walked on sales web, 3/3 FAIL, and never walked at all on delivery or warehouse. Filed **S-151**.
2. **Android delivery keep run (required): not finished** — no op could be queued within budget, and at least two of the four obstacles were the driver's own `adb shell input tap` throwing 'Argument expected after "tap"'. Product versus synthetic tap is not established.
3. **Android warehouse keep run (required): never started.**
4. **Fable's amendment A3** (`vfsInstances <= 1`, `initCREATES <= 1` asserted per page load) not in the gate — the prover would have had to patch `node_modules` in the main checkout during a live run and rightly refused.
5. The permanent S-138 gate is not yet promoted into `QA/tools/e2e/`.

Also filed from the same proofs: **S-152** — the sales order screen's outcome banner reads the LIVE connection state (`orders/new.tsx:387-388`), so an order saved offline flips from the honest "queued" banner to "Order placed — the office has it, with its number and its price" the moment the radio returns, over an order the office still holds as a draft with no number.

**dos_qa REBUILT** at 16:5x after the smoke incident: dropped, recreated, 34 migrations, fresh seed. Verified clean — `rahul.deshmukh` and `amit.pawar` carry their real names again (the smoke run had renamed both to "Demo Docs Staff (edited)", which was corrupting every screenshot of the DOS-167 leave sheet), 3 tenants, 52 users. Nothing was listening on :3000–:3007 or any Metro port at the time, so no run was disturbed.

**Next:** run `wf_dae59dd1-114`, script `QA/tools/batch2/workflows/dos167-amendments.js` — Fable's five amendments built test-first and adversarially verified, her own merge review, the full frontend gate, merge, then six proofs (web memory fallback, web second tab, web timeout, Android sanity, and the two required Android keep runs — delivery and warehouse — this time driven through Appium by resource-id rather than raw taps), then Fable judges whether DOS-167 closes. S-151 and S-152 need a design and the founder's approval; they are not in this lane.

### Founder decisions, 2026-09-19: "accept all recommended", "fix all 4 defects", "go on dos"

**Correction first.** The eleven "open" product questions I put to the founder today were **not open**. They were decided on 2026-09-13 and docs/22 §8 already carries a row for each (DOS-006, 016, 054, 066, 071, 081, 087, 100, 102, 103, 138), with the §11 change-log row to match. `QA/evidence/batch2/lean-founder-questions.md` and the STATE note that pointed at it were stale, and I asked again from them instead of from docs/22. The founder's "accept all recommended" confirms what was already recorded, so nothing changes in the product — but **wave 3 has no held items**, and `lean-wave3.js` has been corrected: all sixteen `defer` lists are now empty (84 items, not 73).

**New decisions recorded in docs/22 (§8 three rows, §9 never-list #12 and #13, §11), rendered and republished:**

1. **The honesty rule (never-list #12).** The app never tells someone their work is saved on the device when it is not, and never says an order reached the office before it did. Filed as **DOS-179** (when a browser cannot keep an offline copy, EVERY screen says so — not only the beat screen — and the order button stops reading "Saved on this phone" over work that dies with the tab) and **DOS-180** (an order saved with no signal keeps saying so until the office actually confirms it; it never re-labels itself "Order placed" because the radio came back).
2. **Four executed faults approved for repair.** **DOS-175** a receipt recorded against a trip that does not exist can never be banked — the trip id is validated at creation; **DOS-176** proof of delivery 500; **DOS-177** the driver's GPS consent 500, which blocks departure; **DOS-178** a late payment the office refuses may be DISCARDED on the phone, erasing the only record that a shop paid — it is kept and routed to the cashier instead (**never-list #13**: money a person has entered is never offered for deletion).
3. **The Q3 repair on the founder's own `dos` database is authorised to run.** Method unchanged from 2026-09-14: read-only checks first, then ONE appended balancing entry per wrong figure, never an edit, with the founder approving the list trip by trip. `pnpm db:migrate` runs there first.

**Also filed today:** **DOS-174** — S-108, the challan poll that kept running after its panel closed, merged as `c3b4ec1`; its manual walks are still owed.

### Founder, 2026-09-19 evening: the stop rule is withdrawn and the machine runs unattended

- **"no need of this rule now"** — the 2026-09-13 lean-mode ceiling ("if overall weekly usage passes about 70% by Wednesday, work stops after P0/P1 and its regression") is **withdrawn**. QA batch 2 runs to the end, P2 and P3 included. Usage is paced, not capped. docs/22 §8 carries the superseding row; the rest of the lean-mode rule is unchanged.
- **"full time internet and charging provided"** — long browser and device walks may run overnight and across sessions. What still serialises them is the Mac's 8 GB, not the founder's availability: one Android emulator at 3 GB plus Metro plus the eight services is already near the ceiling. So the proof stages batch their checks into **fewer, longer device sessions** instead of booting per check, and browser walks run beside a device walk only where memory allows.
- **"finish it this week if possible"** — the target is batch 2 closed and its full regression done inside this week.

### The Q3 repair on the founder's own database: nothing to repair (2026-09-19)

Run `wf_1683f0e7-b83` — two analysts on different lenses, then an adversarial checker who had to reproduce every claim with a second, independent query before it survived. All read-only, all on `dos_test_q3_repair`, a template copy taken after `dos` was backed up (2.7 MB dump) and migrated from 43 to 48 migrations. **Nothing was written to `dos`. No balancing entry was appended, and none will be.**

**The answer, and it is not the one the plan assumed.** There is no wrong money in `dos` **because there is no real money in it**. All three books — M/s. Tarsun Enterprise, Kalyan Agencies, Sai Distributors — were written by `pnpm db:seed`: all 254 receipts were inserted in one burst on 2026-09-08 (Tarsun's 83 in 0.36 s, Kalyan's 84 in 0.31 s, Sai's 84 in 0.40 s) while the dates printed on them are backdated to 22 Aug – 4 Sep. **The premise of the repair was wrong, and it came from a stale QA note rather than from the data** — the same failure as the eleven "open" questions earlier today, which docs/22 had already answered on 2026-09-13. Both times the fix is the same: read the source of truth, not the working note.

**The checks that ran clean** (every one returning rows, not counts): more than one BANK debit for one receipt — none; a deposit reference repeating where it should not — none (DEP/2026/0117 appears once per tenant, over two receipts, one timestamp, one account; three separate books are not a double effect); a deposited receipt whose trip had not settled — none (every deposited receipt is an office cheque with no trip); a bounced cheque missing or doubling its reversal — none (three bounces, each with exactly one mirror receipt and one reversing entry). Structural: every tenant's journal sums to zero, and no entry fails to balance.

**The checker killed five of the analysts' claims**, including their reading of Tarsun as "pilot, real trade", and found **four things neither analyst checked**. Two are now filed:

- **S-153 (P1, fixture)** — the seed builds settlement figures from `collections`, but the live `settleTrip` reads `receipts`. On **44 of 48 settled trips** the stored `trip_settlements` row disagrees with what the real code would compute (Kalyan ₹2,48,114.37, Sai ₹2,38,202.89, Tarsun ₹2,26,218.48), and **33 `collections` rows contradict the receipt their own `receipt_id` points at**. Any test or walk judging settlement against seeded data is judging the wrong number — `dos`, `dos_qa` and every template copy are unsafe as a settlement fixture until this is fixed.
- **S-154 (P2, fixture)** — the seed writes journal rows directly rather than through the posting service: `reversed_by_entry_id` is NULL on every reversed original, there are zero `receipt_reversal` entries (a bounce is the mirror receipt's own entry), and 44 trip-tagged cash receipts post to CASH rather than CASH_VAN because `receiptAccountCode()` never ran. The books still balance; a query keyed on `receipt_reversal` would wrongly call every bounce unreversed.

Both belong in the queued demo-data slice (docs/23 §10).

**Open for the founder:** has any real collection ever been entered into Distribution OS, or does Tarsun's money still live only in the old books? If a real book exists anywhere — another database, a backup, an export from TradeEzee — name it and the repair re-runs against that. Until then there is nothing to correct. The copy `dos_test_q3_repair` is kept for now; the list is at `QA/evidence/batch2/dos-q3-repair/sign-off-list.md`.

### QA/STATE.md pruned, and the machine held awake (2026-09-19 evening)

**Held awake two ways**, at the founder's word ("keep system on, dont let it sleep"): the desktop app's own keep-awake hold, plus `caffeinate -dimsu -t 86400` (pid 58695), confirmed by `pmset -g assertions` showing `PreventUserIdleSystemSleep 1`. That covers idle sleep for 24 hours; a closed lid or a manual Sleep still sleeps, which is worth knowing rather than assuming.

**STATE pruned from 107 lines of mixed history to current state only** (the previous version is kept in the session scratchpad as `STATE-before-prune.md`, and every fact in it that still matters is in this change log). The reason is not tidiness. Twice today a stale note in STATE sent work down a wrong path: the eleven "open" founder questions that `docs/22` had already answered on 2026-09-13, and a Q3 money repair aimed at a database that turns out to hold no real money. Both cost real work. STATE now opens with the rule that caused them — **read `docs/22` for what the founder has decided, never a note in STATE; if the two disagree, docs/22 wins and STATE is wrong** — and carries only what is running, what is queued, what merged today, the state of each database, and the standing rules. History lives here; findings live in `QA/findings/12`.

### DOS-175..DOS-180: both lanes built, neither merged yet — and a process bug of mine, twice (2026-09-19 night)

Run `wf_318fd158-c04`, 13 agents, ~3 h 10 m. Fable's design is at `QA/evidence/batch2/verdicts/DOS-175-180-design.md` and is worth reading: it turns DOS-175 into one check in `recordReceipt` that the online endpoint, the upload door and delivery's collections all share (404 `trip_not_found`, 409 `trip_not_on_road`, the existing 409 `trip_settled` untouched, and delivery registers the SQL so receivables never names `trips`), and DOS-178 into a rule decided by TABLE rather than by code — a refused op on `receipts`, `allocations` or `collections` is kept whatever the refusal, offers neither "Throw it away" nor "Send it again", and gains "Handed to the cashier".

**money-delivery (DOS-175, 176, 177):** built, verified, Fable review **MERGE AFTER FIXES** with two blockers.
- Blocker 1 — real and nasty: the idempotency replay looked rows up by **id alone**, and `pod_evidence_read` / `location_consents_rw` show an owner or manager the whole tenant, so a back-office caller adding proof to delivery X under an id that belongs to delivery Y's proof was told "proof recorded" about a **foreign row**. Addressed in the lane.
- Blocker 2 — the acceptance proof the design demands: `pnpm smoke` on a fresh seeded database with the services running, `deposit` reading **OK and not merely EXPECTED**, `addPod` and `consents.grant` 200 on three lanes, 0 BROKEN, twice.

**honesty (DOS-178, 179, 180):** built, repaired once, and the verifier still returned two majors, both real and both worth the round:
- The lane **introduced its own violation of never-list #12**: a new hand-over line reading "stays on this phone as handed over", printed unconditionally, bypassing the `keepClaim` helper the design makes binding. On a memory store that screen contradicts itself in a single render, three lines apart.
- **DOS-180's own guard is inert.** `useRow` never restores `loading` when its `id` changes, so for one render after the tap the not-yet-read row looks acked and the banner says "Reached the office as a draft" about an order that has only just been queued — the exact lie DOS-180 exists to stop, surviving inside its own fix.

**The process bug, and it is mine.** Twice now a lane has stalled because a merge review demanded runtime proof from agents whose brief forbids starting services — first money (DOS-168..170), now money-delivery. The reviews are right to demand it; the briefs were wrong to make it impossible. `QA/tools/batch2/workflows/finish-175-180.js` adds the missing piece: a **WALK stage that may start services**, running between review and integration, whose result is written into the lane as the blocker's evidence. It also carries the port rule that the dos_qa accident taught — if anything is already listening on :3000-:3007, use `all-in-one` on :3100 and never kill what you did not start. Every future runner gets this stage.

Also in that runner: the merge step now says what to do when the auto-mode classifier refuses `git merge` (stop after two tries, return blocked, say so) instead of failing silently — that happened on the DOS-167 amendments and cost a round trip.

Running as `wf_8e97ed40-f91`.
