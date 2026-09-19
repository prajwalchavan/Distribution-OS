FAIL on the letter (4 → 2 BROKEN), closed by architect ruling

# money-delivery — walk 1 result (DOS-175, DOS-176, DOS-177)

Written by the lane's integrator under condition 2 of `../verdicts/DOS-175-177-blocker2-ruling.md`
(Fable, architect, 2026-09-19). **Nothing in the prover's result is rewritten.** Where I re-derived a
number from the evidence myself rather than copying the prose, the row says so.

## The tree that was walked

- **Lane HEAD `6cbe235`, with main merged** (the lane's earlier merge `5e7afbc`; main tip then `254958a`).
- Recorded at merge commit **`e285e27`**, which merges main again (main tip `8f9f5c5`).
  `git diff --name-only 6cbe235 e285e27 | grep -vc '^QA/'` → **`0`**: the second merge added only `QA/`
  files, so no product code moved under the walk and its evidence applies to the merged tree verbatim.
- **Database `dos_test_b2_d175`**, created by the prover from a fresh seed and **dropped afterwards**
  (confirmed absent from `pg_database`). `pg_stat_activity` during the run: 21 connections on
  `dos_test_b2_d175`, **zero on `dos` and zero on `dos_qa`**.
- **Base `http://127.0.0.1:3100`** — `backend/all-in-one` with `DOS_MODE=all`, **`WORKER_INLINE=1`**,
  `ALL_IN_ONE_PORT=3100`. `:3000`–`:3007` were held by another owner's processes (pids 69913–70028 plus two
  `@dos/worker dev` started 12:12 and 14:45, hours before that session); **none was touched or killed**.
- All eight prefixes `/auth /owner /manager /sales /warehouse /delivery /retailer /admin` answered `/health` 200.

## Both runs' totals, verbatim

```
run 1 (fresh seed)  TOTAL 1606 calls · 930 OK · 573 expected · 4 BROKEN ·  99 skipped
run 2 (replay)      TOTAL 1606 calls · 924 OK · 574 expected · 2 BROKEN · 106 skipped
```

I re-read both lines out of `../dos-175-177/walk1/smoke1.txt` and `smoke2.txt` myself; they match the
prover's report character for character.

## The operation rows as reported

The prover's result carried **fifteen** operation entries, not twelve — I record all fifteen rather than
trim to the ruling's count. Statuses and classifications in the "verified" column are ones I re-derived
from `results[].operationId / .status / .classification` in `../dos-175-177/walk1/run1-json/` (run 1) and
`run2-json/` (run 2), independently of the prose.

| # | Operation (lane) | Reported | Verified from JSON — run 1 / run 2 |
| --- | --- | --- | --- |
| 1 | `receivables.receipts.deposit` (owner) | OK — 200 on BOTH runs, the design's headline proof: the `tripId: DROP` office receipt is bankable. The review's minor 4 (a second run replays the banked receipt and deposit falls back to EXPECTED) did NOT happen. | `200/OK` / `200/OK` |
| 2 | `receivables.receipts.deposit` (manager / delivery / sales / retailer) | EXPECTED — manager 409 "business refusal on a row that does not qualify" (the owner lane already banked it); delivery/sales/retailer 403 "role may not call this procedure". The OK evidence comes from the owner lane, not from any 409. | manager `409/EXPECTED`; sales, delivery, retailer `403/EXPECTED` — both runs |
| 3 | `delivery.deliveries.addPod` (owner) | OK — 200 both runs. No 500, no 409; the free-slot walk re-publishes a proof id this delivery already holds, so the replay is a real replay. | `200/OK` / `200/OK` |
| 4 | `delivery.deliveries.addPod` (manager) | OK — 200 both runs. | `200/OK` / `200/OK` |
| 5 | `delivery.deliveries.addPod` (delivery) | OK — 200 both runs. Owner + manager + delivery all 200 = the pass condition met in full. | `200/OK` / `200/OK` |
| 6 | `delivery.deliveries.addPod` (warehouse / retailer) | EXPECTED — 403 "role may not call this procedure", a correct refusal, not a gap. | both `403/EXPECTED` — both runs |
| 7 | `delivery.consents.grant` (owner) | OK — 200 both runs. | `200/OK` / `200/OK` |
| 8 | `delivery.consents.grant` (manager) | OK — 200 both runs. | `200/OK` / `200/OK` |
| 9 | `delivery.consents.grant` (delivery) | OK — 200 both runs. Owner + manager + delivery all 200 = the pass condition met in full; the DOS-177 500 is gone. | `200/OK` / `200/OK` |
| 10 | `delivery.consents.grant` (warehouse / retailer) | EXPECTED — 403 role gate, correct. | both `403/EXPECTED` — both runs |
| 11 | `receivables.receipts.create` (owner / manager / delivery) | OK — 200 both runs with `tripId` dropped (the DOS-175 office receipt); sales/retailer 403. This is what makes `deposit` bankable. | owner, manager, delivery `200/OK`; sales, retailer `403/EXPECTED` — both runs |
| 12 | `notifications.messages.markRead` (manager) | **BROKEN** — 404 on BOTH runs, the only stable failure. Root cause and hand-proof below. | `404` both runs |
| 13 | `notifications.messages.markRead` (warehouse) | **BROKEN** — 404 on BOTH runs, same id, same cause. | `404` both runs |
| 14 | `billing.invoices.issueForPack` (owner) | **BROKEN** — 404 on run 1 ONLY; never read OK on either run. | run 1 `404`; run 2 `400/EXPECTED` |
| 15 | `procurement.discrepancies.resolve` (manager) | **BROKEN** — 404 on run 1 ONLY. | run 1 `404`; run 2 `200/OK` |

No 409 anywhere above is counted as green. Every EXPECTED on the three named operations is a 403 role
refusal — the guard working — except the manager's 409 on `deposit`, which is a real business refusal.

## Pass condition, item by item

1. **0 BROKEN — NOT met** (4 on run 1, 2 on run 2). This is the FAIL on the letter.
2. `receipts.deposit` must read OK, not EXPECTED — **MET**, owner lane, 200, run 1 and run 2.
3. `addPod` and `consents.grant` 200 on owner, manager AND delivery — **MET**, both runs, six 200s each run.
4. Replay must turn nothing BROKEN — **MET**. Run 2 broke nothing new and cleared two.

## The four BROKEN, with ids and root causes

Verbatim from the runs' BROKEN blocks:

```
run 1  owner/billing.invoices.issueForPack        404  pack 01a06dfc-c72b-7578-8d88-28f8e0d9054b not found
run 1  manager/procurement.discrepancies.resolve  404  discrepancy 01a0baa5-046a-76d6-9216-0784344790b5 not found
both   manager/notifications.messages.markRead    404  message fe0e3c28-1398-7e34-9633-c17e07ddad1d not found
both   warehouse/notifications.messages.markRead  404  message fe0e3c28-1398-7e34-9633-c17e07ddad1d not found
```

- **The two stable ones — S-149, an example-selection defect.**
  `backend/libs/core/src/docs/examples.ts:1065-1098` builds `ownNotices` from
  `select … from messages where tenant_id = … order by id desc limit 500`. The pilot tenant holds **1104**
  messages, so only 8 of its 50 own-notices fall inside that window (owner, sales and delivery users —
  which is precisely why those three services pass). `vikas.kadam` has 19 push + 1 in_app notices, all
  outside it, so `ownNoticeFor` returns undefined and the example falls back to
  `ctx.notifications?.messageId` = `fe0e3c28-1398-7e34-9633-c17e07ddad1d`, a **WhatsApp** row (channel
  `whatsapp`, `recipient_retailer_id` set, `recipient_user_id` null). The endpoint is documented "never a
  WhatsApp or SMS row", so **the 404 is the server being correct.** Proved by hand: signed in as
  `vikas.kadam` and called `POST /manager/notifications/messages/332b1a92-875d-7d9e-b2e2-4c6173850b00/read`
  (his own in_app notice) → **HTTP 200**; the same token on the published WhatsApp id → HTTP 404
  "message … not found". Same cause on the warehouse lane: `dinesh.patil`'s single in_app notice is outside
  the window, so the example publishes the same WhatsApp row.
- **The two run-1-only ones — S-156 / S-157, a fresh-database seed gap.** A freshly seeded database has no
  PARKED pack and no OPEN gate-count discrepancy, so `ctx.parkedPackId` did not resolve and the sampler
  filled the path id with an invented uuid. Proof it is the seed and not the code: the pilot tenant's two
  parked packs are timestamped **22:39:32 and 22:39:43 — during smoke run 1 itself**; on run 2 the example
  pointed at the real pack `223c021d-74a7-724b-8e82-673db4840647` and read EXPECTED 400 "pack … moved no
  stock; there is nothing to bill" (it never read OK on either run). The four seeded discrepancies
  (22:36:25) are all already accepted/claimed/credited; on run 2 the example found the real row
  `a9d0dc09-e92b-7cea-bc1b-858280ba5827` and read OK 200. Self-healing, and a real defect in the demo data
  rather than in the product.

## Attribution — the diff command and its empty output

Re-run by the integrator on the merged tree, output pasted as it came:

```
$ git diff --stat 5e7afbc..HEAD -- backend/libs/core/src/modules/notifications \
    backend/libs/core/src/modules/billing backend/libs/core/src/modules/procurement \
    backend/libs/contracts/src/notifications.ts
[empty]

$ git diff --stat main HEAD -- backend/libs/core/src/modules/notifications \
    backend/libs/core/src/modules/billing backend/libs/core/src/modules/procurement \
    backend/libs/contracts/src/notifications.ts
[empty]

$ git diff main HEAD -- backend/libs/core/src/docs/examples.ts | grep -E "^[+-].*(ownNotice|limit\(500\)|messages)"
[empty]
```

The lane's whole contribution over main is **14 files, all in `@dos/core`** — `docs/examples.ts`,
`docs/examples.spec.ts`, five delivery files, four receivables files, and a one-word comment change in
`modules/warehouse/load-sheets.service.ts` (`registerTripSettled` → `registerTripPredicates`). None is
under `modules/notifications`, `modules/billing` or `modules/procurement`. The `examples.ts` hunks are the
addPod / consents free-slot entries and `receipts.create tripId: DROP`; the `ownNotices` builder is untouched.

## The prover's caveat, kept

No baseline `pnpm smoke` was run on main — that needs a second worktree and build. The "pre-existing"
attribution rests on the empty diffs above plus root causes traced in the database and reproduced by hand,
**not** on a main run. The architect accepted this explicitly in the ruling.

## Evidence

`../dos-175-177/walk1/` — `smoke1.txt`, `smoke2.txt`, `run1-json/` (8 per-service JSON), `run2-json/`
(8 per-service JSON lifted from the worktree's `backend/.smoke/` before it was cleared), and
`all-in-one.log.gz` (the 1.9 MB server log, gzipped to 160 KB — the repo's convention for bulk evidence).
A fuller narrative of the same walk is `../dos-175-180/money-delivery-acceptance.md`.

## Still owed after this merge

Review walks 2, 3 and 4, per the DOS-168..170 convention. DOS-175/176/177 stay **OPEN** in STATE until they
pass. The ruling's ledger check joins them: on the first smoke on main after the merge, the example receipt
must hold **ONE** deposit reference and **ONE** Dr BANK line — a second line reopens DOS-168, not this lane.
S-149, S-156 and S-157 must land before `pnpm smoke`'s absolute "0 BROKEN" binds anybody as a merge gate.
