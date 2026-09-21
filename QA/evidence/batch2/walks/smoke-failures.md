# Smoke gate — the failed ones, run and triaged

Founder, 2026-09-21: *"Smoke gate to be done for failed ones."* This is a triage of real failures, not a hunt
for a clean run. It found **one BROKEN**, traced it to **two independent causes**, fixed both with tests, and
picked up **two further findings** on the way that are filed, not fixed.

Block key: `smoke-failures` · worktree `.claude/worktrees/b2-walks` · lane branch `qa/b2-smoke-failures`
(base `f7095ad`) · database `dos_test_b2_walks`, dropped and recreated from `dos_test_batch2b_template`.

---

## 0. The machine, and what it ruled out

Read before booting anything, as the block requires:

```
Pages free: 3129  (page size 16384) -> 51 MB free
vm.swapusage: total = 7168.00M  used = 6192.31M  free = 975.69M   -> 86.4% full
```

Free RAM **51 MB** (threshold ~300 MB) and swap **86.4%** full (threshold ~85%): **both past the refusal
line**. Re-checked mid-block: 38 MB free, swap 88.8%. So **no device legs were attempted** — no emulator, no
simulator. This matches the founder's own steer in the same message ("IOS and andriod to be validated
completely in the end / For now basics can be done"). Android and iOS are returned **not-proven** below with
that reading quoted, not guessed at.

The web legs and the whole backend gate — which is what this block actually owes — ran in full.

## 1. Are S-149 / S-156 / S-157 on main?

**Yes.** Merge **`17491e2`** "Merge QA batch 2 lean group fix-seed-harness: S-149, S-156, S-157", carrying:

| Fix | Commit |
|---|---|
| S-149 | `a0f4df9` (+ `7e957d4`, `bfceaa9` tests, `b3ea2d7` own-notice example) |
| S-156 | `2239ad4` — the `issueForPack` example always names a pack that exists |
| S-157 | `a245561` — an invented path id reports SKIPPED, never BROKEN |

The worktree base `f7095ad` is downstream of that merge, so all three were in force for every run below.

## 2. What I started, and on which ports

`:3000`–`:3007` were **already held** by node processes I did not start (PIDs 99690–99708). Per the port rule
I killed nothing and used the all-in-one instead:

- **`backend/all-in-one` on `:3100`**, `DOS_MODE=all WORKER_INLINE=1` — all eight services behind path
  prefixes **plus the worker inline**. All eight `/{service}/health` returned **200**.
- Nothing else. **Stopped before returning** (see §8).

Sequence: recreate DB from template -> `pnpm db:migrate` (exit 0) -> `pnpm db:seed` (exit 0) -> `pnpm build`
(14 tasks, exit 0; `worker/dist` was missing and had to be built before the inline worker would load).

## 3. The three runs the block asked for

All `pnpm smoke --base http://127.0.0.1:3100`. Logs: `smoke-failures-logs/`.

| Run | Flags | Calls | OK | Expected | **BROKEN** | Skipped |
|---|---|---:|---:|---:|---:|---:|
| **wf-1** | `--run-tag wf-1` (fresh seed) | 1618 | 931 | 587 | **0** | 100 |
| **wf-2** | `--run-tag wf-2` (replay) | 1618 | 939 | 574 | **1** | 104 |
| **wf-3** | `--destructive --run-tag wf-3` | 1618 | 948 | 650 | **1** | 19 |

`pnpm db:seed` re-run after wf-3, as required (exit 0).

Per-service, wf-1: auth 12 OK / 17 · owner 306 / 343 · manager 281 / 343 · sales 74 / 201 · warehouse 96 / 250
· delivery 97 / 258 · retailer 52 / 189 · admin 13 / 17 — **0 BROKEN in every service**.

**The headline: a fresh database hides this fault.** Run 1 was clean. The fault only appears from the second
run onward against the same data — which is exactly the condition a developer or a demo hits.

## 4. The full BROKEN list, with classification

**One distinct BROKEN**, the same operation in both repeat runs:

| Run | Operation | Method / path | HTTP | Server message |
|---|---|---|---:|---|
| wf-2, wf-3 | `retailer/notifications.inbound.create` | `POST /notifications/inbound` | **500** | `Internal server error` |

Server-side cause, from the all-in-one log:

```
DrizzleQueryError: Failed query: insert into "inbound_messages" (...)
  cause: error: duplicate key value violates unique constraint "inbound_messages_pkey"
  table: 'inbound_messages'   constraint: 'inbound_messages_pkey'
  at .../modules/notifications/inbound.service.js:63:27
```

It classifies as **(a) AND (c) — genuinely broken AND a wrong published example**, two independent faults that
happened to surface as one line. Neither is (b): the demo data is fine.

### (c) The example — S-165

`exampleSource: "contract"` with no harness override, so the body is the published example verbatim:

```json
{ "idempotencyKey": "docs-notifications.inbound.create",
  "id": "01a0d0c5-1bb3-7523-8a24-44ada2a23ea7", "retailerId": "34191c43-...", "kind": "return_request" }
```

**Measured, not inferred:** that id is byte-for-byte `createdId('notifications.inbound.create','id', 0)` —
**slot 0**. `notifications.inbound.create` (DOS-103) was the one create in its module absent from the
`freeSlots` registry in `backend/libs/core/src/docs/examples.ts`; its three siblings (`messages.send`,
`pushTokens.register`, `broadcasts.create`) are all registered. So `slotOf()` always answered 0 and the
example could never walk past an id the database already held. After wf-1 inserted it, the row was there:

```
id                                   | channel | kind           | received_at
01a0d0c5-1bb3-7523-8a24-44ada2a23ea7 | in_app  | return_request | 2026-09-21 07:53:59.188+05:30
```

This is the harness's own stated rule, from `smoke-endpoints.mts` `classify()`: *"A published example that
hard-codes the id of the row it creates succeeds exactly once and then refuses for ever, so that refusal is a
defect of the example."*

**Fixed** (`50cab0c`): registered the free slot + an explicit override pairing id and key to one slot. After
the fix the published example moves to **slot 7** — `01a0d0c5-d7b0-7a74-8234-998bf394fed8`, confirmed **0 rows**
in the database while the old id still has **1**.

### (a) The endpoint — S-164

Independently of the example, the handler was wrong. A second press under the **same** idempotency key replays
through `idempotent()` and never reaches the insert. A press re-using an id under a **different** key does
reach it, and the unique violation escaped untranslated as a 500. The shop was told "Internal server error"
for a client-side id clash.

Every sibling create already answers properly — orders (`orders.internals.ts:103`), delivery trips and
vehicles, procurement GRNs, docint documents, tenancy, platform-admin all turn `23505` into CONFLICT.

**Fixed** (`71b03e0`): the same guard, using the platform's own `isUniqueViolation`. Nothing widened — the
shop-ownership check still runs first, RLS untouched, the refusal writes nothing.

Live against the running service:

```
POST /retailer/notifications/inbound   (spent id, new key)
HTTP 409
{"code":"CONFLICT","status":409,"message":"report 01a0d0c5-1bb3-7523-8a24-44ada2a23ea7 already exists"}
```

**Proved both ways.** With the guard removed the new spec fails `AssertionError: expected 500 to be 409`; with
it in place it passes.

### A note worth keeping: the existing test could not have caught S-165

`examples.spec.ts` has `keys every mutation to the id it creates, so a second Execute replays`. I stashed my
fix and ran it: **it passed**. Its synthetic `slotLanes` fixture has no entry for this path either, so both
sides of the assertion compute slot 0 and agree. The test checks the id is *keyed to the procedure*, not that
the slot can *move* — a missing registration is structurally invisible to it. Worth knowing before anyone
trusts it to cover the next one.

## 5. Verification after the fixes

| Run | Flags | Calls | OK | Expected | **BROKEN** | Skipped |
|---|---|---:|---:|---:|---:|---:|
| wf-4 | fresh tag | 1618 | 926 | 588 | **0** | 104 |
| wf-5 | replay | 1618 | 922 | 590 | **0** | 106 |
| **wf-6** | on the committed tree | 1618 | 920 | 591 | **0** | 107 |
| **wf-7** | replay of wf-6 | 1618 | 919 | 592 | **0** | 107 |

`POST /notifications/inbound` on the retailer lane reads **200 OK** in both wf-6 and wf-7 — the replay case
that produced the only BROKEN in this block.

Also green: `pnpm docs:readme:check` exit 0 (generated READMEs render lane 0, unchanged); `@dos/core` typecheck
exit 0; `notifications.spec.ts` + `examples.spec.ts` **64 tests passed**; the published example body pressed
twice against the live service answers **200 then 200** (the founder's "Try it out twice" rule).

## 6. Two further findings — filed, NOT fixed

Both are outside the one-file-and-obvious remit this block allows, so they are recorded for whoever owns them.
Ready-to-paste rows: `smoke-failures-findings-rows.md`.

### S-166 — the S-149 census goes red after any smoke run that creates staff (P3, test hygiene)

`examples.spec.ts` "every active staff membership of the demo distributor has an own in-app notice" fails
after a smoke run:

```
AssertionError: expected [ 'demo.docs.staff5', 'demo.docs.staff8', 'demo.docs.staff7', 'demo.docs.staff10' ] to deeply equal []
```

Measured cause — all ten `demo.docs.staff*` users were created by **my own smoke runs** (timestamps 07:53–08:06
today); the template holds **zero**. And the notice the passing six carry is dated **2026-09-09 10:32**,
template `scheme_announcement`: it is the **seed's backfill**, not something `tenancy.staff.create` writes. So
the six created before my re-seed got one; the four created after did not.

Not a race (re-ran minutes later, still red). Not caused by this block's changes (they touch only inbound and
its example). Confirmed both directions: red after smoke, **green immediately after `pnpm db:seed`**.

The census asserts a property of *seeded* data but queries *every* active membership, so it cannot survive the
smoke harness's own writes. Same family as S-149/156/157. Low operational impact — the house already re-seeds
after `--destructive` — but a non-destructive smoke run leaves `pnpm test` red for a reason that is not a code
defect. Fix direction (scope the census to seeded staff) belongs with whoever owns S-149, not here.

### S-167 — in all-in-one mode, no service's API docs page can load its own spec (P2)

Found walking to take a screenshot. Both docs pages hard-code the **root-relative** spec URL:

```
/retailer/swagger  ->  url: '/docs/openapi.json'
/retailer/docs     ->  "/docs/openapi.json"
```

Measured:

```
/docs/openapi.json            404
/retailer/docs/openapi.json   200
/owner/docs/openapi.json      200
```

On its own port each service *is* the root, so this works. In **all-in-one mode** (`:3100`, docs/26 §7, the
founder's least-cost deployment) the spec lives under the prefix, and `/docs/openapi.json` is 404. Swagger UI
shows **"Failed to load API definition — Fetch error Not Found /docs/openapi.json"**
(`smoke-failures-web-swagger-allinone.png`) and Scalar renders an empty page
(`smoke-failures-web-scalar-allinone.png`). The same header also advertises "port 3006" and
`http://localhost:3000/auth/login`, neither of which serves in this mode.

Not fixed here deliberately: `./openapi.json` is **not** a safe one-liner — the page is served at
`/retailer/docs` with no trailing slash, where a relative URL resolves to `/retailer/openapi.json`. It needs a
prefix-aware URL and a decision about trailing-slash behaviour, which is a design call, not a walk fix.

## 7. Claims and verdicts

| # | Claim | Platform | Measured | Verdict |
|---|---|---|---|---|
| 1 | S-149/156/157 are on main | git | merge `17491e2` + 3 commits | **proven** |
| 2 | A fresh seeded run is clean | web/API | wf-1: 1618 calls, **0 BROKEN** | **proven** |
| 3 | A replay run is clean | web/API | wf-2: **1 BROKEN** | **claim false — fault found** |
| 4 | A destructive run is clean | web/API | wf-3: **1 BROKEN** (same op) | **claim false — same fault** |
| 5 | Every BROKEN is classified | analysis | 1 op, causes (a)+(c), neither (b) | **proven** |
| 6 | The endpoint fault is real and fixed | web/API | 500 -> **409**; spec fails w/o guard | **proven** |
| 7 | The example fault is real and fixed | web/API | slot 0 (spent) -> slot 7 (0 rows); 200/200 | **proven** |
| 8 | 0 BROKEN after the fixes | web/API | wf-6 **0**, wf-7 **0** | **proven** |
| 9 | S-149 census survives a smoke run | test | 4 staff without notices | **claim false — S-166** |
| 10 | All-in-one serves its docs pages | web | `/docs/openapi.json` **404** | **claim false — S-167** |
| 11 | Android behaviour | Android | not booted — 38 MB free, swap 88.8% | **not-proven** |
| 12 | iOS behaviour | iOS | not booted — same reading | **not-proven** |

Screenshots: `smoke-failures-web-swagger-allinone.png`, `smoke-failures-web-scalar-allinone.png`.

**On screenshots for claims 1–9:** these are HTTP and database claims with no screen. Their evidence is the
captured run logs, HTTP transcripts and SQL output in `smoke-failures-logs/` — the actual artefacts. I did not
manufacture a picture of a terminal to satisfy a per-claim count; the log is the stronger evidence and it is
all here.

## 8. What I started and stopped

Started: the all-in-one on `:3100` (three times — initial, after the fixes, and on the committed tree).
**All stopped; `:3100` is free.** `:3000`–`:3007` were never touched. Databases: only `dos_test_b2_walks`
(recreated from the template) and reads of `dos_test_batch2b_template`. `dos` and `dos_qa` untouched.

## 9. Still not proven — honest and complete

1. **Android — not booted.** 38 MB free, swap 88.8% full. Nothing about Android is claimed.
2. **iOS — not booted.** Same reading. The block's standing note that iOS is the one unproven target is
   unchanged by this work.
3. **S-166 and S-167 are filed, not fixed, and not re-tested after any fix** — there is no fix yet.
4. **S-167's blast radius is not established.** I proved the docs pages fail in all-in-one mode; I did **not**
   check whether any app or tool depends on `/docs/openapi.json` at the root, so I cannot say the damage stops
   at the two pages.
5. **The fixes are on the lane branch `qa/b2-smoke-failures` only** — not merged, not pushed. Two commits,
   `71b03e0` and `50cab0c`, on base `f7095ad`.
6. **The findings rows were NOT written into `QA/findings/12-batch2-new-findings.md`.** This block's
   environment rules say never to edit the main checkout and to write nothing under `QA/` outside the walks
   evidence directory, which directly contradicts the instruction to file there. I took the safer reading and
   left a ready-to-paste block at `smoke-failures-findings-rows.md`. **Someone must paste it in** — S-164
   through S-167 are otherwise unregistered. Note S-160–S-163 were already taken; my numbering starts at 164.
   *[Editorial note, 2026-09-21: done — the four rows are registered as S-164..S-167. The money-web block (09:28) had
   meanwhile filed S-166..S-169; being the later filing, its two colliding rows were renumbered S-166 → S-183 and
   S-167 → S-184. Every S-number in this report still means what it meant when it was written.]*
7. **Only the retailer lane's `notifications.inbound.create` was examined for the slot-registration class of
   fault.** Other creates may be missing a registration too; the existing test cannot see it (§4). I did not
   audit the whole registry.
8. **`pnpm lint` and the full backend `pnpm test` were not run** — only the two affected spec files, the
   `@dos/core` typecheck, the build and `docs:readme:check`.
