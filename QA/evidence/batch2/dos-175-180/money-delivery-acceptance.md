# DOS-175 · DOS-176 · DOS-177 — acceptance walk, lane money-delivery

**FAIL on the letter (4 → 2 BROKEN), closed by architect ruling** (`verdicts/DOS-175-177-blocker2-ruling.md`,
Fable, 2026-09-19). This file is the record that closes **blocker 2** of `merge-reviews/money-delivery.md`.
Nothing in the walk's result is rewritten here; where I re-derived a number myself I say so.

## The tree that was walked

| | |
| --- | --- |
| Walked at | lane HEAD `6cbe235` (main already merged at `5e7afbc`, main tip `254958a`) |
| Recorded at | merge commit `e285e27` — main merged again, main tip `8f9f5c5` |
| Product code between the two | **none.** `git diff --name-only 6cbe235 e285e27 \| grep -vc '^QA/'` → `0`. The second merge of main added only `QA/` files (DOS-167 amendment evidence, verdicts, findings, a workflow script), so the walk's evidence applies verbatim to the merged tree. |
| Database | `dos_test_b2_d175`, created by the prover, seeded fresh, dropped afterwards. `pg_stat_activity` showed 21 connections on it and **zero on `dos` and `dos_qa`**. |
| Base URL | `http://127.0.0.1:3100` — `backend/all-in-one` with `DOS_MODE=all WORKER_INLINE=1 ALL_IN_ONE_PORT=3100`. `:3000`–`:3007` were held by another owner's processes (started hours earlier); none was touched or killed. |
| Health | all eight prefixes `/auth /owner /manager /sales /warehouse /delivery /retailer /admin` → 200 |

## Commands

```bash
pnpm install                                                   # up to date
pnpm exec turbo run build --filter='./libs/*'                  # 4/4
pnpm db:migrate && pnpm db:seed                                # on dos_test_b2_d175
pnpm --filter @dos/core exec vitest run src/modules/delivery src/modules/receivables src/docs
pnpm typecheck        ; pnpm exec turbo run typecheck --filter=@dos/core --force
pnpm lint             ; pnpm exec turbo run lint     --filter=@dos/core --force
pnpm format:check
pnpm smoke --base http://127.0.0.1:3100                        # run 1, fresh seed
pnpm smoke --base http://127.0.0.1:3100                        # run 2, replay, same database
```

## Counts, verbatim from `smoke1.txt` / `smoke2.txt`

```
run 1  TOTAL 1606 calls · 930 OK · 573 expected · 4 BROKEN ·  99 skipped
run 2  TOTAL 1606 calls · 924 OK · 574 expected · 2 BROKEN · 106 skipped
```

Gates on the walked tree, all PASS: the delivery + receivables + docs vitest selection (9 files, 152 tests,
0 failed, 0 skipped, 6.60s); `pnpm typecheck` (19 tasks) and a `--force` `@dos/core` typecheck (real 13.2s
`tsc`, cache bypassed); `pnpm lint` (19 tasks) and a `--force` `@dos/core` lint (only the pre-existing
`eslint-plugin-boundaries` v5→v6 migration WARNING, no error); `pnpm format:check` clean.

## The four named operations — the design's acceptance proof

Re-derived by me from the per-service JSON in `../dos-175-177/walk1/run1-json/` and `run2-json/`
(`results[].operationId`, `.status`, `.classification`), not taken from the prover's prose.
**Both runs are identical on all four.**

| Operation | owner | manager | delivery | others | Verdict |
| --- | --- | --- | --- | --- | --- |
| `receivables.receipts.deposit` | **200 OK** | 409 EXPECTED | 403 EXPECTED | sales/retailer 403 EXPECTED | **MET** — OK, never only EXPECTED. The `tripId: DROP` office receipt is bankable. |
| `delivery.deliveries.addPod` | **200 OK** | **200 OK** | **200 OK** | warehouse/retailer 403 EXPECTED | **MET** — 200 on all three, both runs. The DOS-176 500 is gone. |
| `delivery.consents.grant` | **200 OK** | **200 OK** | **200 OK** | warehouse/retailer 403 EXPECTED | **MET** — 200 on all three, both runs. The DOS-177 500 is gone. |
| `receivables.receipts.create` | **200 OK** | **200 OK** | **200 OK** | sales/retailer 403 EXPECTED | enabler — what makes `deposit` bankable. |

No 409 is counted as green anywhere above. The manager's 409 on `deposit` is a real business refusal (the
owner lane had already banked the row); every other EXPECTED is a 403 role refusal, i.e. the guard working.
The review's minor 4 — "a second run replays the banked receipt and `deposit` falls back to EXPECTED" — **did
not happen**: run 2 also read OK 200.

## Pass condition, item by item

1. **0 BROKEN — NOT met** (4 on run 1, 2 on run 2). This is the FAIL on the letter.
2. `receipts.deposit` OK, not EXPECTED — **MET**, both runs.
3. `addPod` and `consents.grant` 200 on owner, manager and delivery — **MET**, both runs.
4. Replay turns nothing BROKEN — **MET**. Run 2 broke nothing new and cleared two.

## The four BROKEN — all traced, none from this lane

```
run 1  owner/billing.invoices.issueForPack        404  pack 01a06dfc-c72b-7578-8d88-28f8e0d9054b not found
run 1  manager/procurement.discrepancies.resolve  404  discrepancy 01a0baa5-046a-76d6-9216-0784344790b5 not found
both   manager/notifications.messages.markRead    404  message fe0e3c28-1398-7e34-9633-c17e07ddad1d not found
both   warehouse/notifications.messages.markRead  404  message fe0e3c28-1398-7e34-9633-c17e07ddad1d not found
```

- **The two stable ones (S-149).** `backend/libs/core/src/docs/examples.ts:1065-1098` builds `ownNotices` from
  `select … from messages where tenant_id = … order by id desc limit 500`. The pilot tenant holds 1104 messages,
  so only 8 of its 50 own-notices fall in the window (owner, sales, delivery users — which is exactly why those
  three services pass). `vikas.kadam`'s 19 push + 1 in_app notices are all outside it, so `ownNoticeFor` returns
  undefined and the example falls back to `ctx.notifications?.messageId` — a **WhatsApp** row (channel
  `whatsapp`, `recipient_retailer_id` set, `recipient_user_id` null). `markRead` is documented "never a WhatsApp
  or SMS row", so **the 404 is the server being correct.** Proved by hand: signed in as `vikas.kadam`,
  `POST /manager/notifications/messages/332b1a92-875d-7d9e-b2e2-4c6173850b00/read` (his own in_app notice) →
  **HTTP 200**; the same token on the published WhatsApp id → HTTP 404. Same cause on the warehouse lane
  (`dinesh.patil`'s single in_app notice is outside the window).
- **The two run-1-only ones (S-156 / S-157).** A freshly seeded database has no PARKED pack and no OPEN
  gate-count discrepancy, so `ctx.parkedPackId` did not resolve and the sampler filled the path with an invented
  uuid. Proof it is the seed and not the code: the pilot tenant's two parked packs are timestamped 22:39:32 and
  22:39:43 — **during run 1 itself**; on run 2 the example pointed at the real pack
  `223c021d-74a7-724b-8e82-673db4840647` and read EXPECTED 400 "pack … moved no stock; there is nothing to
  bill" (it never read OK on either run). The four seeded discrepancies (22:36:25) are all already
  accepted/claimed/credited; on run 2 the example found the real row `a9d0dc09-e92b-7cea-bc1b-858280ba5827`
  and read OK 200. Self-healing, and a defect in the demo data rather than in the product.

## Attribution — read, not assumed

`git diff 5e7afbc..HEAD` over `backend/libs/core/src/modules/{notifications,billing,procurement}` and
`backend/libs/contracts/src/notifications.ts` is **empty**. The lane's `examples.ts` diff holds only the
addPod / consents free-slot entries and `receipts.create tripId: DROP`; the `ownNotices` builder is untouched.
`warehouse/load-sheets.service.ts` is a one-word comment change (`registerTripSettled` →
`registerTripPredicates`). The lane's whole contribution over main is 14 files, all in `@dos/core`, none under
`modules/notifications`, `modules/billing` or `modules/procurement`.

**Caveat, on the record and accepted by the ruling:** no baseline `pnpm smoke` was run on main — that needs a
second worktree and build. The "pre-existing" attribution rests on the empty diff above plus root causes
reproduced in the database and by hand, not on a main run.

## Evidence

`QA/evidence/batch2/dos-175-177/walk1/` — `smoke1.txt`, `smoke2.txt`, `run1-json/` (8 per-service JSON),
`run2-json/` (8 per-service JSON, lifted from the worktree's `backend/.smoke/`), `all-in-one.log.gz`
(1.9 MB server log, gzipped to 160 KB; the repo already uses `.gz` for bulk evidence).

## What stays owed after this merge

Walks 2, 3 and 4 of the review, per the DOS-168..170 convention; DOS-175/176/177 stay OPEN in STATE until
they pass. The ruling's ledger check joins them: on the first smoke on main after the merge, the example
receipt must hold **ONE** deposit reference and **ONE** Dr BANK line — a second line reopens DOS-168, not this
lane. S-149, S-156 and S-157 must land before `pnpm smoke`'s absolute "0 BROKEN" is a merge gate for anybody.
