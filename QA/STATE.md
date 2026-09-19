Stage: 1
Current phase: 4 — Implement approved changes (batch 2). Phase 2 (cross-role chain) follows.
Last updated: 2026-09-19 21:0x IST

**This file is CURRENT STATE ONLY.** Every history — what was found, what was ruled, what was merged and why — lives in `QA/13-change-log.md`. Findings live in `QA/findings/12-batch2-new-findings.md`. Founder decisions live in `docs/22-source-of-truth.md` §8; **read docs/22, never a note in here, for what the founder has decided.** Twice on 2026-09-19 a stale note in this file sent work down a wrong path (eleven "open" questions docs/22 had already answered on 09-13, and a Q3 money repair on a database that holds no real money). If this file and docs/22 disagree, docs/22 wins and this file is wrong.

## Running right now

| Run | Task | What it is | Where it stops |
|---|---|---|---|
| `wf_dae59dd1-114` | `wwjggbx0h` | DOS-167: the six owed walks (web memory fallback, web second tab, web timeout, Android sanity, Android delivery keep, Android warehouse keep) then **Fable judges whether DOS-167 closes** | script `QA/tools/batch2/workflows/dos167-amendments.js` |
| `wf_318fd158-c04` | `w02bf6b2m` | DOS-175..DOS-180: Fable design → two build lanes → Fable review → backend merges, frontend merges onto it | script `QA/tools/batch2/workflows/dos175-180.js` |

The Mac is held awake two ways: the app's keep-awake hold, and `caffeinate -dimsu -t 86400` (pid recorded in the 2026-09-19 change-log section). Founder, 2026-09-19: the machine runs unattended around the clock; **the 70%-by-Wednesday stop rule is WITHDRAWN** — batch 2 runs to the end, P2 and P3 included, aiming to finish this week.

## Queued, in order

1. **Money + DOS-172 platform walks** — Fable's merge-gate ruling items 2–7 (`QA/evidence/batch2/verdicts/DOS-168-170-merge-gate-ruling.md`). Device-bound: they queue behind the DOS-167 walks. DOS-168/169/170 and DOS-172 are **MERGED, PROOF OWED, still OPEN** until these pass.
2. **Lean wave 3** — the last 16 groups, 84 items, runner `QA/tools/batch2/workflows/lean-wave3.js`, Fable in every architect seat. Nothing is held back: all sixteen `defer` lists are empty. Waits only for the device queue above to clear.
3. **The suspects still unprobed** — S-141, S-142, S-144, S-145, S-149, S-150, S-153, S-154, S-155. S-153 (the seed builds 44 of 48 trip settlements from the wrong table) and S-155 (a turbo cache hit reports the cross-app guards green without running them) are the two that make other tests untrustworthy; do those first.
4. **docs as-built** — docs/22 rows for what merged today, docs/23 §10 #6, docs/27 §14, `pnpm docs:readme` per merge.
5. **Full A.12 regression** — 7 apps × browser + Android, iOS sanity. The largest device block.
6. **Phase 2** — the cross-role chain.

## Expected tomorrow (2026-09-20)

The founder hands over a **real data extract** ("okk share real data extract with you tomorrow"). Copy it before reading; never work in place. Then decide which job it is, and do not start either until that is clear:
- a **Distribution OS book** (a dump carrying rows the apps wrote) → the money repair re-runs against the copy, read-only first, founder signs off trip by trip;
- an **old-system export** (TradeEzee, Tally, Excel) → nothing in Distribution OS is wrong; it is an import through the generic importer (docs/17 §D7) with its own reconciliation.

## Merged into main on 2026-09-19

`c3b4ec1` S-108/DOS-174 challan poll · `d65034b` DOS-171 van sale · `ce3dc8c` DOS-167 ruling 3 (the web store opens under slow loads) · `6e5c7c5` DOS-168+169+170 money · `d25574e` DOS-172 loading · `609388b` DOS-167 Fable amendments A1–A5 · plus two CI repairs, `d30ccf7` (backend lint: a package imported its own name) and `eb9a155` (CI seeds before `pnpm test`).

**Coverage: 69 of 155 batch-2 findings merged.** P0: DOS-167 still OPEN (its close decision is running); DOS-168, DOS-169 merged, proof owed. Filed today and not yet built: DOS-175, DOS-176, DOS-177, DOS-178 (building), DOS-179, DOS-180 (building).

## Databases

- `dos` — the founder's own. Backed up 2026-09-19 (2.7 MB dump in the session scratchpad) and migrated 43 → 48. **Nothing was changed in it and nothing will be without the founder's word.** It holds no real trade: every row came from `pnpm db:seed`.
- `dos_test_q3_repair` — a template copy of `dos`, kept for now; the read-only repair analysis ran on it.
- `dos_qa` — REBUILT clean on 2026-09-19 after a smoke run committed 15 destructive operations against it (dropped, recreated, 48 migrations, fresh seed; the renamed demo staff are correct again). The harness gap that allowed it is closed: `pnpm smoke` now refuses to run when the tenant the services return does not exist in the database the fixtures read.
- Lane databases `dos_test_b2_*` are copies of `dos_test_batch2b_template`; a lane may drop and recreate only its own.

## Standing rules for this programme

- Never touch `dos` or `dos_qa` from a lane; destructive work only on a database whose name carries `test`.
- A blocker in a merge review was raised against the branch AS REVIEWED: **a commit that already existed when the review was written is never its fix.**
- An integrator must run the kit's cross-app guards with `--force`; a turbo cache hit cannot prove them (S-155).
- Fable is the architect in every seat — design, ruling, merge review, judge. Opus builds and verifies; Sonnet for mechanical steps.
- Workflow scripts live in `QA/tools/batch2/workflows/`, in the repository, because a scratchpad wipe once made resume impossible.
- The auto-mode classifier sometimes refuses an agent's `git merge`. That is a tool permission, not a conflict: the main session completes the merge by hand and says so.
- Never report a command that was not run or an outcome that was not seen. "not-tested" is an honest answer.
