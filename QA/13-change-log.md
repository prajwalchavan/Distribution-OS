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
