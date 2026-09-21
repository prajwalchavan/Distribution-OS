Stage: 1
Current phase: 2 — Cross-role end-to-end business flow (day 1 of QA/10-DAY-PLAN.md, five-day form). Batch 2 (Phase 4) is merged: 153 of 158.
Last updated: 2026-09-20, 20:15 IST

**This file is CURRENT STATE ONLY.** Every history — what was found, what was ruled, what was merged and why — lives in `QA/13-change-log.md`. Findings live in `QA/findings/12-batch2-new-findings.md`. Founder decisions live in `docs/22-source-of-truth.md` §8; **read docs/22, never a note in here, for what the founder has decided.** Twice on 2026-09-19 a stale note in this file sent work down a wrong path (eleven "open" questions docs/22 had already answered on 09-13, and a Q3 money repair on a database that holds no real money). If this file and docs/22 disagree, docs/22 wins and this file is wrong.

## Running right now — DAY 1 of five (Mon 22 Sep in the plan; started Sun 21 Sep 08:30 IST)

| Run | Task | What it is |
|---|---|---|
| `day1-chain.js` | `whj7hepvd` | **Phase 2 — the cross-role chain**: one order through all seven apps as the people who carry it, hop by hop, then the eight days that go wrong, then a blind verifier against the database. Own DB `dos_test_chain`, all-in-one on :3200, apps on :5273–5279. Output `QA/09-cross-role-workflows.md`. (A first launch did nothing — a founder question relayed mid-turn was taken as the agent's brief and it rightly refused to drop a database on it; relaunched.) |
| `welcome-and-landing.js` | see /workflows | **docs/29 §1** — a Welcome screen before sign-in and a landing after it, in every app, built once in `@dos/ui` through the template. UI only; Opus in the review seat on purpose. Own DB `dos_test_b2_welcome`. |
| `web-first.js` | `ws0x0dyo9` | Still on the walk blocks; holds :3000–3007, :3100, :5173–5179 and the emulator. |

**Three sign-in decisions today, designed in `docs/29-sign-in-roles-and-one-store-app.md`, recorded in docs/22 §8:** (1) Welcome + landing — building now; (2) **role election at sign-in, downward only** (owner may act as any staff role, manager as the field roles, others as their own plus owner/manager-set *extra roles*; the token carries the elected role so nothing on the server changes) — **not before the simulation**, day 4 if free, else after go-live, Fable reviews it; (3) **one store app** that becomes the right app after sign-in — after go-live, after (2). The seven web apps stay for the browser.

**Hosting, decided on verified terms (`wf_e2039cff-1b2`, 2026-09-21):** free managed Postgres is IMPOSSIBLE for this schema (`CREATE ROLE app_worker BYPASSRLS` needs a superuser; Neon, Supabase and RDS withhold it) → Postgres self-hosts on **Oracle Cloud Always Free** (now 2 OCPU / 12 GB ARM, halved on 2026-06-15 without announcement; home region Mumbai, irreversible; idle reclamation is the real risk — mitigate by PAYG-inside-free-limits and off-Oracle backups). The seven apps on **Cloudflare Pages** (unlimited bandwidth, no card). Domain **`distributionos.in`** (checked available; ~₹690/yr at Porkbun, same at renewal). **There is no working path from the repo to a server today**: the Dockerfile has never been built and has a definite COPY bug, no compose/Caddy/migrations step/backups/secrets/static pipeline, Docker not installed on the Mac, and builds must NOT run on the free VM (OOM) — build on the Mac or CI, ship artifacts. Full findings in the run's output; the deployment plumbing is its own lane, next.

**Owed by the founder for day 5:** Oracle account (Mumbai; a real credit card — PIN-debit, prepaid and virtual are refused) + an API key config pasted here; Cloudflare account + an API token; the domain bought and its nameservers left on "custom"; gated-or-public (recommended gated); the data extract if it is coming (before day 2).

**The simulation design is written: `QA/24-simulation-design.md` (Fable, the architect seat — the main session runs on Fable 5.1 since 08:20 today).** It is binding for days 2–3. The founder should read §4 (the seven days) and §7 (the blind auditor) — those are the two things that make it a test rather than a demo.

**The five-day plan** (`QA/10-DAY-PLAN.md`, page https://claude.ai/artifact/5c7mWeutvCDtEEsiujS1ei): day 1 chain · days 2–3 simulation · day 4 fix + aimed checks · day 5 Android basics, security slice, go-live, audit with the handover. Four days scheduled, one unknown; the founder hears on day 3 evening whether the five hold.

**Owed by the founder for day 5:** an AWS account with `aws configure` done on this Mac (an IAM user; the keys never pass through the assistant), a domain name, public-or-gated, and the data extract if it is coming (before day 2).

## The founder re-ordered this work on 2026-09-21 — read docs/22 §8, not this summary

Three sentences, and they change what "done" means for the rest of Stage 1:

- **"Smoke gate to be done for failed ones."** No all-or-nothing bar. `pnpm smoke` runs and every BROKEN is triaged on its own merits into one of three kinds — a real fault (a finding), no demo row that qualifies (a harness fault: it must say SKIPPED), or a wrong published example. Nothing waits for a perfect run. The old "0 BROKEN re-arms the main-health gate" framing is gone.
- **"IOS and andriod to be validated completely in the end / For now basics can be done."** One complete device pass, at the end, on both platforms. Until then a device walk is a short sanity check and **no finding stays open waiting for a phone** — it closes on its browser evidence and is listed for the end pass. This folds up the per-lane "platform proof follows" debt of 2026-09-14 and turns the standing iOS gap (open since 2026-09-06) into scheduled work instead of a running debt. NO iOS in the current run, deliberately.
- **"As working and user tests and all other are more imp that can be done on system it self."** What a browser on this Mac can exercise comes first. That is the cross-role end-to-end phase and the full regression, and they now outrank device time.

**The architect's ruling on list order, which the founder delegated ("go as per your (FABLE's) recommendation"):** one rule, not a rule plus an exception — *every list orders newest first on the same column its own from/to window filters: server time `created_at` for a queue of work, the document's own stamped date for a dated register, the row id only ever breaking a tie.* `QA/evidence/batch2/verdicts/DOS-009-list-order-ruling.md`. Its code cost is one stale comment and one client-side re-sort to delete in `frontend/delivery-app/app/trips.tsx` — a screen that silently re-sorts is exactly the second rule the ruling forbids.

## Queued next, and it is now the priority

1. **Full A.12 regression** — 7 apps in a browser, at desk and phone widths, against the running services.
2. **Phase 2 — the cross-role end-to-end business flow.** This is the "working and user tests" the founder means: one order carried by real people through every app, end to end.
3. **The complete device validation**, Android and iOS, once the product is otherwise right.

## Wave 3 is closed — all 21 lean groups on main, 153 of 158 findings merged

`lean-retailer-platform` was the last, merged `d211e21` after a repair, a device walk and a Fable
re-review. Its story is worth keeping: the previous repair had moved the retailer home screen's
memberships read onto the auth link, where `AUTH_RETRY_PATHS` did not list it — so a 401 on that call was
never retried and the screen could tell a shop that owes lakhs "You owe ₹0.00 across 3 distributors". The
fix replaced the four-name allow-list with a deny-list of the nine routes that authenticate through the
BODY (login, refresh, logout, switchTenant, forgotPassword, resetPassword, platformLogin, platformRefresh,
jwks), so every Bearer-carrying auth route heals like any other read **and a new one heals the day it
lands**; a test walks the auth contract's leaves and pins that exactly those nine are excluded. The screen
was fixed at the same cause: an unanswered read can no longer become a money figure, a green chip or
"No bills yet".

**The walk stage is the method from now on.** Three lanes walked with services running under the port rule
and produced measured evidence in `QA/evidence/batch2/walks/`: web desk 1280, web phone 390, the Pixel 7,
and — for `lean-warehouse-pick` and `lean-warehouse-rules` — the iOS simulator. One walk overturned its own
finding honestly ("CLAIM FALSE at HEAD — the call IS healed"). Every remaining "merged, proof owed"
finding is settled this way, not by another round of static reading.

**Machine limits that shaped these runs, and will shape the next.** At walk time the Mac had ~40 MB of RAM
free and 6.07 of 7.17 GB of swap in use; the retailer lane declined to boot an iOS simulator on top of that
rather than risk the other live lanes, and said so instead of pretending. The 25 lane worktrees held 44 GB
on a disk that was 94% full; they are removed now that every branch is merged and pushed (the branches
themselves are kept as the evidence trail). Size the next run to this machine: few lanes, one device queue.

The Mac is held awake two ways: the app's keep-awake hold, and `caffeinate -dimsu -t 86400` (pid 58695). Founder, 2026-09-19: the machine runs unattended around the clock; **the 70%-by-Wednesday stop rule is WITHDRAWN** — batch 2 runs to the end, P2 and P3 included, aiming to finish this week.

## The smoke gate, reshaped (Fable, 2026-09-19 — binding)

`pnpm smoke`'s "0 BROKEN" could not be reached on a fresh database for reasons no lane owns (S-149, S-156, S-157), so a lane was being held to a bar it could not clear. The architect's ruling `QA/evidence/batch2/verdicts/DOS-175-177-blocker2-ruling.md` replaces it, per lane, at the walk stage:
(a) the design's NAMED operations read **OK** — never EXPECTED, never a 409 counted as green — on a fresh seed AND on a replay;
(b) **no NEW BROKEN against main at the merge base** (same seed, same `--run-tag`, first run), and every BROKEN that is also on main is filed as an S-row in the same turn;
(c) nothing turns BROKEN on the replay.
Absolute 0 BROKEN survives as a **main-health** gate the integrator runs once after each merge of main — and it is **binding only after** S-149, S-156 and S-157 are fixed and one observed `pnpm smoke` on a fresh seed records 0 BROKEN in this file with its commit hash. **Until that line exists, nobody may be held to 0 BROKEN.**

## Queued, in order

0. **Fix S-149, S-156 and S-157, then observe 0 BROKEN once on main** and record it here with the commit hash and the seed's row counts — that is what re-arms the main-health gate. S-149: `examples.ts` `ownNotices` must be filtered to in_app/push with `recipient_user_id` set and no retailer BEFORE any limit (never "newest 500 of the tenant"), proven by `markRead` OK on the manager AND warehouse lanes on a fresh seed. S-156/S-157: the seed leaves one PARKED pack and one OPEN gate-count discrepancy, AND the harness reports an INVENTED path id as SKIPPED "no demo row qualifies", never BROKEN.
1. **Money + DOS-172 platform walks** — Fable's merge-gate ruling items 2–7 (`QA/evidence/batch2/verdicts/DOS-168-170-merge-gate-ruling.md`). Device-bound: they queue behind the DOS-167 walks. DOS-168/169/170 and DOS-172 are **MERGED, PROOF OWED, still OPEN** until these pass.
2. **Lean wave 3** — the last 16 groups, 84 items, runner `QA/tools/batch2/workflows/lean-wave3.js`, Fable in every architect seat. Nothing is held back: all sixteen `defer` lists are empty. Waits only for the device queue above to clear.
3. **The suspects still unprobed** — S-141, S-142, S-144, S-145, S-149, S-150, S-153, S-154, S-155. S-153 (the seed builds 44 of 48 trip settlements from the wrong table) and S-155 (a turbo cache hit reports the cross-app guards green without running them) are the two that make other tests untrustworthy; do those first.
3b. **The four product answers of 2026-09-20 (docs/22 §8) — a lane of their own, after wave 3.** Batch 1 fixed only the mechanical half of each; these are the product clauses the founder has now decided:
   - **DOS-075** — `priceOrder()` counts a line under an exclusive scheme toward a threshold ("bills over ₹X") while still giving it nothing from that scheme. `backend/libs/domain/src/pricing/schemes.ts` + its specs; every order/invoice line's `applied_rules` must still read true.
   - **DOS-023** — every list in every app orders by server time, newest first, record id only as a tie-break. Batch 1 (`bdd6055`) did picking sheets alone; this is the convention across all seven apps and the contracts behind them.
   - **DOS-043** — a trip may depart before its planned date; the trip carries the planned date and "departed early" beside it. Batch 1 (`d20a584`) settled who may depart, not when.
   - **DOS-057 / DOS-099** — NOTHING TO BUILD. A permanent public link to a shop's papers is refused; phone sharing stays. Recorded so nobody proposes it again.

4. **docs as-built** — docs/22 rows for what merged today, docs/23 §10 #6, docs/27 §14, `pnpm docs:readme` per merge.
5. **Full A.12 regression** — 7 apps × browser + Android, iOS sanity. The largest device block.
6. **Phase 2** — the cross-role chain.

## One new question for the founder (raised by a lane, not yet asked)

`lean-manager-order-lifecycle` hit the founder's own DOS-023 rule of 2026-09-20 — every list orders by
server time — and found one place it cannot apply cleanly. Orders now sort by `created_at`, exactly as he
said. **Bills and trips sort by `invoice_date` and `trip_date`**, the column each list's own window filters
on, because a bill dated 14 Aug that was typed today would otherwise jump to the top of a 1–31 Aug window.
The lane recorded that as the ONE stated exception in docs/22 rather than deciding it, which is right.
Ask him: pure server time everywhere (a follow-up moves both lists to `created_at` with new indexes and
nothing else changes), or keep the two date columns where the list is a dated register?

## Expected tomorrow (2026-09-20)

The founder hands over a **real data extract** ("okk share real data extract with you tomorrow"). Copy it before reading; never work in place. Then decide which job it is, and do not start either until that is clear:
- a **Distribution OS book** (a dump carrying rows the apps wrote) → the money repair re-runs against the copy, read-only first, founder signs off trip by trip;
- an **old-system export** (TradeEzee, Tally, Excel) → nothing in Distribution OS is wrong; it is an import through the generic importer (docs/17 §D7) with its own reconciliation.

## Merged into main, 2026-09-19 → 20

`c3b4ec1` S-108/DOS-174 challan poll · `d65034b` DOS-171 van sale · `ce3dc8c` DOS-167 ruling 3 (the web store opens under slow loads) · `6e5c7c5` DOS-168+169+170 money · `d25574e` DOS-172 loading · `609388b` DOS-167 Fable amendments A1–A5 · `ed3e1b7` DOS-178+179+180 honesty · `f144e29` DOS-175+176+177 money-delivery · plus two CI repairs, `d30ccf7` (backend lint: a package imported its own name) and `eb9a155` (CI seeds before `pnpm test`).

**Coverage: 153 of 158 batch-2 findings merged.** P0 DOS-167 is OPEN on one clause (DOS-183). MERGED BUT STILL OPEN, platform walks owed: DOS-168, DOS-169, DOS-170, DOS-172, DOS-175, DOS-176, DOS-177. Filed and building: DOS-181, DOS-182, DOS-183.

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
