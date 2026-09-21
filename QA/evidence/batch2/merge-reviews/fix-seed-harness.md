# fix-seed-harness (backend/seed) — S-149, S-156, S-157 — architect review (Fable, 2026-09-21)

**First review:** no earlier file existed (neither this one nor `verdicts/lean-fix-seed-harness.md`); this is the first architect read, after the verifier's round-2 pass.
**Since then:** nothing new on the branch — HEAD `a245561`, three commits, three files, on top of main `d806012` (not behind). The verifier's two majors stand and are ruled below.

**Decision: MERGE AFTER FIXES**

Read: `git diff main...qa/b2-fix-seed-harness` (examples.ts, examples.spec.ts, smoke-endpoints.mts), `git show b3ea2d7:…examples.spec.ts` against HEAD, `MessagesService.markRead/scope/findVisible`, `collectPeople`, `seed-demo/notifications.ts`, `seed-demo/people.ts`, `classify()` and the report section of the harness, my ruling `verdicts/DOS-175-177-blocker2-ruling.md`, docs/22 §8 2026-09-04 ("sample payloads that actually work, built from demo rows").

## Judgement per defect

- **S-149 — closed at the cause for four lanes, MOVED for the fifth.** The pick is now `distinct on (recipient_user_id) … where channel in ('in_app','push') and recipient_user_id is not null and recipient_retailer_id is null` — the filter runs in SQL before any limit, exactly the rule. But both overrides keep `?? ctx.notifications?.messageId` (`examples.ts:4507`, `:4535`): when the signed-in account has no own notice the document falls back to the newest row of the tenant — the shop's WhatsApp row the rule forbids. The seed gives own notices to 14 staff only (`notifications.ts:704-745`); `pilot.owner`, `anil.tarsun`, `snehal.rane`, `amol.vaidya`, `sandeep.mane`, `ruksana.shaikh`, `prashant.gawde`, `tanaji.bhosale` have none. `collectPeople` names the most recent sign-in per role (fresh DB: the oldest membership, `pilot.owner`), so the owner document on a fresh database, or any service where the founder last signed in as `anil.tarsun`, publishes a row `markRead` answers 404 on — and `DocExamplesService` caches it for the life of the process. The verifier proved it: b3ea2d7's ORIGINAL test fails on HEAD with `owner/markRead: a whatsapp row is never markable`. Commit 2239ad4 (titled S-156) pinned the test to the smoke usernames, which is what hides it. The named proof (manager AND warehouse OK on smoke) is met and order-dependent.
- **S-156 — closed, on the example side; the lane brief's premise was inverted and the repair followed the data.** A fresh seed leaves 0 unbilled packs (1430 billed), so the old `where invoice_id is null` picked nothing and the sampler invented an id. Now the newest real pack is named, unbilled-with-stock first, and the note says Execute answers 409. Honest and real. My ruling asked for the OTHER half too (a seeded parked pack); see Conflicts.
- **S-157 — the binding harness half is closed correctly.** The downgrade fires only on an already-BROKEN 404 whose document-supplied uuid names no row in any public table; every call still goes out, so 403/401/5xx/OK/EXPECTED are untouched, and the row prints under "skipped — nothing is skipped silently". `--check-id` proves it both ways. The example half does not reproduce (2 open discrepancies on a fresh seed; `resolve` 200 on owner and manager) — accepted.

## Blockers (one)

1. **The owner-lane fallback must go and the seed must make it unnecessary — same class as S-149, in this lane's files.**
   - `backend/libs/database/src/seed-demo/notifications.ts:726-745`: extend the `TeamNotice` loop to EVERY active staff membership of the tenant — `people.extra` (all eight above) AND the bootstrap `pilot.owner` (query `memberships` for the tenant; `people` does not carry it). Same `staffNotice()` shape, `idempotencyKey: TeamNotice:${broadcastId}:${person.id}`, so the seed stays idempotent.
   - `backend/libs/core/src/docs/examples.ts:4507` and `:4535`: delete `?? ctx.notifications?.messageId`. When `ownNoticeFor` is undefined the field stays empty and `NOTES['notifications.messages.markRead']` (`:5050`) says "this account has no in-app notice yet"; under the new harness rule that is SKIPPED, never a 404 the reader can press. A WhatsApp row is never the answer.
   - `backend/libs/core/src/docs/examples.spec.ts:934`: keep the pinned lanes AND restore b3ea2d7's un-pinned loop (the account `collectPeople` picks, 0 auth_sessions) — plus one census assertion: every active staff membership of the pilot tenant has ≥1 own in_app/push notice. The pinned-only test proves the harness's view, not the reader's.
   Proof: `examples.spec.ts` green on a dropped-and-reseeded database with no sign-ins; `pnpm smoke` fresh seed, first run, 0 BROKEN.

## Minors

- `smoke-endpoints.mts:328` `where id = $1` across 121 tables: the day one `id` column is `uuid`-typed Postgres answers "inconsistent types deduced for parameter $1", and the throw is inside the operation loop, uncaught — the whole run dies. Write `where id::text = $1`.
- `classify()` `:2314` and the downgrade `:2657` cannot tell a business 404 from Fastify's route-not-found (`Route POST:/… not found`). A route in the contract but not mounted answers 404 → EXPECTED on a sampler id (pre-existing) and now SKIPPED on a doc-invented id. Test `messageOf(body)` for `^Route [A-Z]+:` and keep those BROKEN "route not mounted".
- `backend/tools/README.md` (classification table L51-52) is the harness's promise per my ruling; it does not mention `--check-id` or the 404-downgrade rule. Add both lines.
- Commit 2239ad4 carries the S-149 test rewrite under an S-156 title; the report discloses it, `git log` does not. Note it in the change log.
- Consequence of the mandated rule, recorded: an S-156-class regression now prints as SKIPPED with exit 0. `examples.spec.ts` is the only automated guard on example ids being real; the integrator reads the skipped section (Walk 3).

## Conflicts

- **My ruling said "Both halves, not one" for S-156** (a seeded PARKED pack). The repair declined: a domain-true parked pack needs a `packed` order with `pack` ledger rows and no invoice, which `sales.ts` (outside the brief's file list) writes at confirm. I accept the deviation for THIS merge — the finding's own remedy list allows the example side and 0 BROKEN is reached — but the seeded parked pack stays OWED to the demo-data slice (docs/23 §10): one order in `seed-demo/sales.ts` packed with `issueInvoice:false`; `examples.ts`'s ordering then prefers it and the S-156 test's unbilled branch already covers it. Until then `issueForPack` is never proven succeeding, and the manager's "left to bill" queue (DOS-173) is empty in the demo. docs/22 2026-09-04 ("sample payloads that actually work") is met for S-149 only after the blocker.
- Founder decisions: none touched. No policy, guard, permission row, migration or contract changed.

## Walks (after the blocker, on main, backend only — no device)

1. Drop, migrate, seed; start the eight services (or all-in-one); `pnpm smoke` FIRST run → 0 BROKEN. Record in STATE: totals, commit hash, `pack_confirmations` (1430/0 unbilled), `messages` (count/own-notices), `inbound_discrepancies` open. This is the line that re-arms the main-health gate.
2. Replay `pnpm smoke` on the same database → nothing turns BROKEN; the skipped count is unchanged.
3. Read the "skipped" section of run 1: any "names no row in this database" line is filed as an S-row the same turn.
4. `pnpm smoke --check-id 00000000-0000-7000-8000-000000000000` → SKIPPED; `--check-id <pilot tenant id>` → "names a row".
5. Browser, desk 1280: open owner-service `/docs` on the fresh database BEFORE any sign-in; the `markRead` example id must be an in_app row addressed to the shown sign-in. Then sign in as `anil.tarsun`, `?fresh=1`, same check.

## Defects outside this lane

- `backend/tools/` is in no gate (not in `pnpm-workspace.yaml`, no package.json); `tsc -p tools/tsconfig.json --noEmit` has two pre-existing `PermissionRole` errors. Wire it into `typecheck`/`lint`.
- QA/findings/12 S-157: the example half no longer reproduces — re-mark, keeping the harness half as fixed.
- `examples.ts` issueForPack note for an UNBILLED pack with no `pack` ledger rows still says "Bills the one pack" while Execute answers 400 "nothing packed to bill" (the smoke-created 100 % short packs) — pre-existing; the note should say why.
- Demo-data slice: the seeded parked pack (above), and S-153/S-154 as already queued.
