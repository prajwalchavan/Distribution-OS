# 14 — Regression results

The five regressions of Charter A.12 after every approved change batch. Tests always run against a throwaway copy of
`dos_batch1_template` (never `dos` or `dos_qa`, which the DB-backed specs would pollute). Walkthroughs run against `dos_qa`.

## Batch 1 (approved 2026-09-12: 4 P0 + 30 on-chain P1)

### 0. Baseline before any product change (commit c5c6e03, DB `dos_batch1_baseline`)

The CI chain of CLAUDE.md, run unchanged, so later failures can be told apart from ones that already existed.

| Step | Backend (real run) | Frontend (real run, `--force`, 0 cached) |
|---|---|---|
| format:check | exit 0 (7 s) | exit 0 (5 s) |
| lint | exit 0, 19/19 tasks, 0 cached (47 s) | exit 0, 11/11 (16 s) |
| typecheck | exit 0, 19/19 (18 s) | exit 0, 11/11 (14 s) |
| build | exit 0, 14/14 (5 s) | exit 0, 8/8 — all seven `expo export --platform web` (105 s) |
| docs:readme:check | exit 0 | — |
| db:migrate | exit 0 (43 migrations) | — |
| test | exit 0, **2 381 passed, 0 failed** (51 s) | exit 0, **301 passed** (ui 196, api-client 67, offline 38) |

Backend tests per package: domain 86 · contracts 78 · core 500 · db 101 · auth-service 3 · owner-service 343 ·
manager-service 343 · sales-service 202 · warehouse-service 251 · delivery-service 258 · retailer-service 189 ·
admin-service 23 · worker 3 · all-in-one 1. The `ORPCError: Input validation failed` lines in the delivery-service
log are expected refusals inside passing specs, not failures.
Logs: session scratchpad `baseline/*.log` (summarised here; not kept in the repo).

### 0b. CI chain on merged main — 21 decision-free fixes (merge 2abb27e + README regeneration 0a9deac, DB `dos_batch1_merged`, every step `--force`)

| Step | Backend | Frontend |
|---|---|---|
| format:check | exit 0 | exit 0 |
| lint | exit 0, 19/19, 0 cached | exit 0, 11/11, 0 cached |
| typecheck | exit 0, 19/19 | exit 0, 11/11 |
| build | exit 0, 14/14 | exit 0, 8/8 (seven web exports) |
| docs:readme:check | exit 0 after `pnpm docs:readme` (12 READMEs regenerated for DOS-073's orders.list summary; the first check in the script ran before the build and read stale dist — script ordering, not a product fault) | — |
| db:migrate | exit 0 | — |
| schema drift (`drizzle-kit generate`) | "No schema changes, nothing to migrate" (first attempt used GNU `timeout`, absent on macOS, exit 127; re-run by hand) | — |
| test | exit 0, **2 417 passed, 0 failed** (baseline 2 381: domain 86→95, contracts 78→79, core 500→525, db 101→102) | exit 0, **336 passed** (baseline 301: ui 196→216, api-client 67→72, offline 38, new app specs sales 1, delivery 6, manager 3) |

No test that passed at the baseline fails on merged main. Six existing tests were changed by the fixes; each is reviewed in `QA/13-change-log.md` (five encoded the defect, one fixture unit).

### 1. Focused regression — pending
### 2. Cross-role regression (Phase 2 chain) — pending
### 3. Platform regression (Web, Android, iOS) — pending
### 4. Business regression (orders, inventory, payments, outstanding, delivery, reports reconcile) — pending
### 5. Security regression (permissions and isolation not weakened) — pending
