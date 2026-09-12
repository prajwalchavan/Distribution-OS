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

### Batch 1 — founder decisions pending

| # | Fix | Question | What the plan does by default |
|---|---|---|---|
| Q1 | DOS-106 | Console levels: may *support* only read everything plus ask for and hand back support access, and *billing* only read everything plus change a distributor's plan? | Yes to both; only *super* can onboard, suspend, lock or unlock logins |
| Q2 | DOS-043 | Remove the warehouse role from "send a trip out" (owner, manager and the crew only), and refuse departure while the load sheet is a draft? | Yes; warehouse keeps create trip, add stops, start loading |
| Q3 | DOS-007 | "Send statement": send a short WhatsApp/SMS text now (balance, overdue, UPI pay link), or wait for a PDF statement? | Text now; PDF later |
| Q4 | DOS-056 | Offline delivery photo: carry the photo inside the queued delivery (size M), or first build the separate photo-upload queue docs/27 §15 describes (size L)? | Inside the queued delivery; docs/27 §15 updated |
| Q5 | DOS-032+059 | A database rule that receipt numbers never repeat. `dos_qa` holds four duplicate pairs, so the migration refuses there: rebuild `dos_qa` from the seed (loses the Phase 1 side-effect rows)? The founder's own `dos` may need the same. | Rebuild `dos_qa` only after a yes; `dos` is the founder's call |

Non-blocking (the fix goes ahead; recorded for Phase 3): DOS-075 — should a "bills over ₹X" threshold count lines under an
exclusive scheme? · DOS-057+099 — a long-lived share link for papers sent to shops needs a public endpoint and a security
decision · DOS-023 — lists sort by id order today; one convention (server time) should be chosen for all lists.
