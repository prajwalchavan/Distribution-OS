# Build log — where we are, what is next

## RESUME HERE (updated 2026-09-05 09:30 IST, session 3)

**LAYOUT CHOSEN (2026-09-05): A Ledger.** Frontend visual work is unblocked; apps still start after the backend is complete.

**Single source of truth: `docs/22-source-of-truth.md`** (read it before this file). Rendered view: https://claude.ai/code/artifact/24c323d8-5b45-4045-8e16-e0e549233fdd — republish it after editing the markdown with `python3 docs/tools/render-source-of-truth.py <out.html>` and the Artifact tool on that same URL.

**STANDING INSTRUCTION FROM THE FOUNDER (2026-09-05 09:20): "I expected you to complete all modules then stop. Now on keep developing until
there is a hard blocker."** So: every turn that receives a module-completion notification must (1) verify independently (full turbo run,
`pnpm smoke`, `docs:readme:check`, `format:check`), (2) record the result here, and (3) LAUNCH THE NEXT MODULE IN THE SAME TURN. Never end a turn
with nothing running unless the backend is complete or something is genuinely blocked. Development stopped once on 2026-09-05 after billing
because the turn ended without launching warehouse — that must not happen again. The remaining modules 4-10 are chained into ONE workflow
with a hard verification gate between each, so the chain itself carries on; if a usage limit kills it, resume it with `resumeFromRunId`
(completed agents replay from cache).

### Earlier resume notes (2026-09-04 23:20, laptop sleep)

**SWAGGER PHASE COMPLETE (2026-09-05 00:40 IST), independently verified by the main session:**

- `pnpm smoke` (backend/tools/smoke-endpoints.mts) signs in as each service's role, reads that service's own OpenAPI document and calls EVERY
  operation with the example it publishes. Result: **369 calls · 245 OK · 97 correct business refusals · 0 BROKEN · 27 skipped as destructive.**
- Every operation's example is built from REAL seeded rows by `backend/libs/core/src/docs/examples.ts` — no `string`, no placeholder uuid — and
  is repeatable: created ids come from database-probed free slots per service lane, so pressing Execute twice, or two services rebuilding their
  documents in the same second, cannot collide. Role-scoped too: a service without a back-office role does not get credit fields in its example,
  and the retailer service's examples name the shop actually linked to `ramesh.gupta`.
- Swagger UI at `/swagger` and Scalar at `/docs` on every service, both reading `/docs/openapi.json`, every operation annotated with `x-roles`.
- CORS added to every service (`corsOptions` in bootstrap.ts, `CORS_ORIGINS` env): without it no web app could call auth-service AND its own
  service, which are different origins by definition.
- Whole workspace: 48/48 turbo tasks, **534 tests**, `docs:readme:check` and `format:check` in sync (generated READMEs are prettier-ignored so
  the two checks cannot disagree).
- Owner app verified end to end in a real browser: sign in as sunil.tarsun / Dos@1234 → token → Retailers page lists all 36 shops. Fixed a real
  bug there: the app built its auth base URL as origin + `/auth` while the routes already start with `/auth`, so every login hit
  `/auth/auth/login` and 404'd.

**LAYOUT OPTIONS PUBLISHED for the founder to choose from (2026-09-05 00:45):**
https://claude.ai/code/artifact/23d860b3-9f0a-49a2-97c6-0f99ad25ad4d — four visual directions (A Ledger, B Instrument, C Panel, D Signal), each
rendered as an owner dashboard at desk width AND a salesperson shop screen at phone width, using real Tarsun data. The founder picks one letter
(or a mix) and that direction applies to all six apps. **No frontend code until that pick.** Source: docs/design/UX-00-design-system.md (797
lines, the full system) backed by UX-01 field reality, UX-02 current standards, UX-03 technical constraints.

**MODULE 1 OF 10 DONE — receivables (2026-09-05 01:30), verified independently by the main session:**

- Migrations 0006 (generated) + 0007 (hand-written) applied. **The journal-balance security hole is closed and was proven the honest way:** the
  agent wrote the test first, applied only 0006, and watched a `delivery` actor commit a two-line entry with a 100-rupee hole — silently, exactly
  as predicted. It then applied 0007 and watched the same test reject it, then tightened the assertion to prove the trigger now SEES the lines
  and rejects on the arithmetic rather than merely tripping a new invisibility guard. Confirmed in the database by the main session:
  `dos_journal_entry_balanced` is now `SECURITY DEFINER` with `search_path = public, pg_temp` (pg_temp LAST, so a temp table cannot shadow
  `journal_lines`), and the function also raises if it can see NO line for the entry, turning any future silent failure into a loud one.
- `journal_lines` and `journal_entries` policies narrowed to SELECT back-office / INSERT staff-minus-warehouse / UPDATE back-office, NO DELETE.
- New tables `write_offs` and `retailer_outstanding_summary` (a TABLE, not a view — PowerSync streams allow no GROUP BY); receipts gained the
  deposit, bounce and offline-dedupe columns; ageing gained the 61-90 and 90+ buckets; chart of accounts gained BANK_CHARGES and CASH_SHORT.
- `ReceivablesService` ships the COMPLETE interface from coordination §3.1 — every method billing, delivery and integrations will import.
- Demo data: 9 carried-over opening bills, 8 unallocated on-account receipts, 5 cheques (2 in hand, 2 banked, 1 returned with its reversal and
  bank charges), 3 part-payments carrying the offline device key, 4 trip cash collections, a keying-error reversal, 2 write-offs, 4 open
  cash-discount offers. The seed asserts every entry sums to zero and the rollup ties to the AR account, and throws if not. Real ageing spread
  confirmed in the database: 1,37,115 / 18,061 / 18,670 / 41,470 / 58,050 / 63,640 rupees across the six buckets, 3,50,626 total.
- Whole workspace green (48/48 turbo tasks); `pnpm smoke` **445 calls · 282 OK · 124 correct refusals · 0 BROKEN** (up from 369 calls).

**MODULE 2 OF 10 DONE — billing (2026-09-05 03:00), verified independently by the main session:**

- Invoices at pack (`issueForPack`, which warehouse calls at step 3 and which moves no stock and no order state), van-sale and brand-DMS
  invoices, credit notes, UPI QR, e-way bill entry, and the GSTR-1-shaped registers reporting and claims will consume. Migrations 0008/0009.
- **Object storage built for the WHOLE product** (`backend/libs/core/src/platform/object-storage.ts`, coordination §3.3): plain DI-free
  functions behind `OBJECT_STORAGE_DRIVER`. The `local` driver is the default and needs NO cloud account — it writes under `backend/.storage`
  (git-ignored) and signs its own URLs with HMAC. The `s3` driver implements SigV4 by hand in ~70 lines of `node:crypto` rather than pulling in
  the AWS SDK, and is tested against AWS's own published signing vectors with no network call. Keys are tenant-scoped and a key that escapes its
  tenant prefix is refused four different ways.
- **White-label keys are now fixed and exported as `TENANT_SETTING_KEYS`**: `branding.display_name`, `branding.logo_object_key`,
  `branding.invoice_footer`, `upi_vpa`. Convention set by 0009 and binding on every later module: any setting holding a credential is named
  `secret.<name>` and stays owner-only. This also fixed a real latent bug — under FORCE RLS every non-owner role read `tenant_settings` as EMPTY
  and silently treated every setting as unconfigured.

**INFRASTRUCTURE FIX FOUND WHILE VERIFYING (main session, not the agents):** the full test suite failed intermittently — billing's spec timed
out at 5 s while passing in 3 s alone. Cause: vitest runs spec files in parallel and each boots its own `DbModule`, so 13 spec files in
`@dos/core` at the default pool of 10 asked for 130 connections while the seven running dev services already held 70 of Postgres's 100. Specs
were STARVED, not slow. Fixed properly rather than by raising the timeout alone: `createPool` now honours `DATABASE_POOL_MAX` (`poolMax()` in
client.ts, default 10) and every test setup sets it to 3; the shared vitest preset also gets a 30 s test timeout because these are integration
tests against a real database. **This matters beyond tests — it is a scale rule: `replicas x DATABASE_POOL_MAX <= max_connections` (docs/20).**
Verified by three consecutive clean full runs.

- Whole workspace green three times in a row: **828 tests**, 48/48 turbo tasks, `docs:readme:check` and `format:check` in sync.
- `pnpm smoke`: **517 calls · 318 OK · 147 correct refusals · 0 BROKEN** (369 → 445 → 517 as modules land).

**CURRENT MODULE: warehouse (step 3 of 10)** — order queue, picklist, pick lines, pack (which takes over the invoice-issuing path from billing's
temporary `billing.invoices.issue`, per coordination §4's phased hand-over), load sheet, delivery challan. Migrations 0010/0011.

**Superseded: billing (step 2 of 10)** — workflow `wf_01bdaaa1-8b4`: invoices at pack (`issueForPack`), van-sale and brand-DMS invoices,
credit notes, UPI QR, GST registers, migrations 0008/0009, AND the object-storage platform (coordination §3.3) that receivables, warehouse,
delivery, docint, claims, reporting and integrations all assume and none of them builds. Local driver by default so it works with no cloud
account.

**Superseded: receivables (step 1 of 10)** — workflow `wf_67b45b30-9c3` running: migrations 0006/0007 (including the journal-balance
SECURITY DEFINER fix from coordination §5.2), the complete `ReceivablesService` interface every later module imports (coordination §3.1), the
contract + permissions, the module implementation, demo data, and `pnpm smoke` staying at 0 BROKEN.

**Earlier: work in flight when the session paused (background agents were killed by the sleep; re-run them):**

- `dos-working-swagger` workflow (run id `wf_1f65f5a0-dac`): phase 1 was mid-flight — `backend/libs/core/src/docs/examples.ts` (real OpenAPI
  examples built from seeded demo rows) and `backend/tools/smoke-endpoints.mts` (`pnpm smoke`, calls every endpoint of every service). Check what
  landed on disk before re-running; resume with the script in the session's workflows dir.
- `dos-design-research` workflow (`wf_f210275f-34d`): writing docs/design/UX-01-field-reality.md, UX-02-current-standards.md,
  UX-03-technical-constraints.md, then UX-00-design-system.md. Frontend only — does not block backend.
- One agent writing `docs/plans/00-coordination.md` (resolves the migration-number collisions between the ten module briefs — FOUR of them each
  claim `0006` — plus the shared services no module owns, the cross-module call graph, and the consolidated founder questions).
  **Verified working at the pause:** all seven services up on 3000-3006 with Swagger at `/swagger` and Scalar at `/docs`; login and the whole
  permission matrix proven live; owner app signs in at :5173 and lists 36 shops (fixed a doubled `/auth/auth/login` base URL in
  frontend/owner-app/src/lib/api.ts); whole backend green (48/48 turbo tasks); frontend green (9/9).
  **Founder answered the six expensive questions on 2026-09-04 23:40 — see `docs/17-corrections-from-review.md` §D for the answers and exactly what each one changes. Key ones: shops ARE GST-registered (B2B tax invoice is primary); only DELIVERY collects money plus the shop paying online, never the salesperson; NO separate van-sale numbering; invoice series is per-tenant configuration, never hard-coded; cash discount realised at receipt only; and the product is WHITE-LABELLED — each distributor sees their own name and logo in the app and on every document, so `tenant_settings` needs display name + logo and the design phase must prove it.**

**Remaining questions** — see `docs/plans/00-coordination.md` §7 once that agent's file exists, and the short list posted
in chat on 2026-09-04 23:20. Nothing is blocked on them: assumptions are recorded per brief and are cheap to change if the answer differs.

**MODULE 3 OF 10 DONE — warehouse (2026-09-05 07:50 IST), verified independently by the main session:**

- Migrations 0010 (generated: columns, indexes, and the five policy replacements — drizzle can express policies, so they live in the
  generated file; 0011 hand-written carries FORCE RLS, grants and a DO block that fails the migration if any of the five tables lacks
  FORCE RLS or still has a FOR ALL policy). Fresh-database migrate 0000→0011 proven.
- 20 procedures under `warehouse.*`: fulfilment queue, picklists (create / start / pick with FEFO warnings / cancel), packs (confirm =
  stock out once + order state + invoice issued through billing `issueForPack`), load sheets (create / confirm with PIN and count →
  transfer godown→vehicle, DC challan from the tenant `DC-` series, e-way bill gate above the intra-state threshold), challans,
  reservations. `billing.invoices.issue` is gone; a pack is the only way a sale invoice is issued. Orders gained the fulfilment surface
  (`applyFulfilmentEvent`, `recordPick`, `fulfilmentQueue`, `fulfilmentLines`).
- Mounted on owner :3001, manager :3002, warehouse :3004 (with billing), delivery :3005 (reads only). Not sales, not retailer.
- Whole workspace green: 48/48 turbo tasks forced, **962 tests** (core 223 incl. 30 warehouse cases), `docs:readme:check`, `format:check`;
  `pnpm smoke` **610 calls · 362 OK · 186 correct refusals · 0 BROKEN · 62 skipped** (up from 517).
- One test race fixed by the main session: `examples.spec` probed free ids in the owner lane while the owner-service spec, running in
  parallel under turbo, created rows in that lane. The spec now takes the spare lane (`SPARE_LANE`). Not a product defect.
- Open item carried to the platform-gaps slice: a cancelled pack invoice cannot be re-billed (`pack_confirmations` is unique per order);
  `billing.invoices.issueForPack` for a parked pack is in docs/23 §8.2.

## Earlier resume notes (session 3, 22:10 IST)

1. `brew services list | grep postgresql@17` must say `started`. Node 24: `export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24`.
2. Two pnpm workspaces: `cd backend && pnpm install && pnpm db:migrate && pnpm db:seed`; `cd frontend && pnpm install`. Build `@dos/contracts` and `@dos/domain` in backend before any frontend work (the apps link them).
3. **AUTH IS DONE (2026-09-04).** Username + password, our own token service. Every service now requires `Authorization: Bearer <jwt>`; the `x-tenant-id`/`x-actor-id`/`x-actor-role` headers are GONE. Sign in at `POST http://localhost:3000/auth/login`; demo password for every seeded user is `Dos@1234` (usernames in the table below). Permission matrix per endpoint lives in `backend/libs/contracts/src/permissions.ts`, is enforced by `TenantGuard`, rendered in every README and `/docs`, and tested by `describePermissionMatrix` in every service spec (every endpoint × every role).
4. **CURRENT WORK: finish the backend completely before any frontend work** (founder, 2026-09-04 22:30: "continue with all backend services, test all endpoints again, see if desired results are coming, if not fix them till everything in backend is perfect; once done notify me, then we move to frontend").

   4a. Swagger/API console must be usable by hand: every operation carries a REAL example built from the seeded demo rows (never `string` or the placeholder uuid), and pressing Execute succeeds. Built by `backend/libs/core/src/docs/examples.ts` + `backend/tools/smoke-endpoints.mts` (`pnpm smoke`), which calls every operation of every service with a real token and exits non-zero on anything broken.

   4b. The remaining ten modules, one at a time to "stable". **READ `docs/plans/00-coordination.md` FIRST — it is the coordination contract** and it overrides any single brief where they disagree. A dedicated pass found that the ten briefs, written independently, collided badly: SIX of them claimed migration `0006`, three claimed numbers already used, seven shared services (object storage, export jobs, PDF rendering, the outbox registry, CSV writing, the replica pool, the ledger surface) were each going to be built two or three times, billing and warehouse would both post the stock movement and both advance the order so stock left twice, and several briefs restated facts about the code that are no longer true. All of that is resolved in that document: migrations are assigned uniquely 0006–0024, every shared service has ONE named owner and a fixed signature, and the ledger surface is one `ReceivablesService` with a fixed method list.

   **It also caught a real hole nobody had spotted.** The trigger that guarantees every money entry balances (`dos_journal_entry_balanced`, migration 0003) is NOT `SECURITY DEFINER`, and `journal_lines` has FORCE row-level security, so the trigger's own `SELECT SUM(...)` obeys the caller's policy. Today the policy is tenant-wide, so it works. The moment receivables narrows reads to back-office only — which its brief proposes — a delivery worker recording a doorstep payment would insert lines the trigger cannot see, the sum would read zero, and **an unbalanced money entry would commit silently**, for exactly the roles that handle cash. Verified against the live database: the function has no `SECURITY DEFINER` and `journal_lines_tenant` is the only policy. The fix is `SECURITY DEFINER SET search_path = public` in migration `0007`, with a new case in `rls.test.ts`. Do not narrow those policies without it.

   **CORRECTED BUILD ORDER** (integrations moved from 9 to 6, because claims and reporting both need its `export_jobs` table and would otherwise each build their own):
   1. receivables — the ledger surface every money module calls, receipts, allocations, ageing, outstanding, write-offs (migrations 0006/0007, including the trigger fix)
   2. billing — invoice at pack, credit notes, UPI QR, GST registers; also builds OBJECT STORAGE for everyone (0008/0009)
   3. warehouse — order queue, picklist, pack, load sheet, delivery challan; takes over posting the sale and advancing the order from billing (0010/0011)
   4. delivery — trips, stops, POD, doorstep collections, van sales, expenses, settlement, `/gps/points`
   5. docint — bill scanning to GRN; also builds the OUTBOX RELAY handler registry (the relay is a no-op stub today)
   6. **integrations** — the generic mapped importer (see §D row 7), Tally export, FieldAssist import; also builds `export_jobs` + the export queue for everyone
   7. claims — scheme, damage and expiry claims to brands
   8. notifications — WhatsApp/SMS adapters, event-driven sends, templates, broadcasts
   9. reporting — dashboards, registers, the CHART SERIES the owner app needs; also builds CSV writing and the `DATABASE_REPLICA_URL` second pool
   10. incentives — plans, targets, slabs, statements

   4c. Then demo data for three distributors with staff under each and shops linked to two of them; `DATABASE_REPLICA_URL` second pool + the ledger partition plan (docs/20). THEN notify the founder and start the frontend.

5. Then: demo data for three distributors + shops linked to two of them; `DATABASE_REPLICA_URL` second pool + ledger partition plan (docs/20). Only then the six frontend apps.
6. Founder 2026-09-04 21:20: the owner app must have GRAPHS wherever possible (growth, how the distributorship is performing) — the reporting module serves chart-ready time series.
7. Before ending a session: update this block + the table, `pnpm format` in both workspaces, `pnpm docs:readme` in backend, `git add -A`, hand the founder the commit command.

Rule reminders: subagents never permanently edit `backend/libs/contracts/src/contract.ts`, module `index.ts` files or `service.ts` — the main session wires. Migrations are EXPAND-ONLY from 0004 onward (0004 auth + warehouse role, 0005 auth guarantees). Generated READMEs are prettier-ignored so `format:check` and `docs:readme:check` cannot disagree.

## Local links (`.claude/launch.json` entries, or the commands in CLAUDE.md "Run things")

Sign in first: `POST http://localhost:3000/auth/login` with `{"username":"sunil.tarsun","password":"Dos@1234","deviceId":"<any uuid>"}`, then send `Authorization: Bearer <accessToken>`.

| Service   | Swagger UI                    | Scalar                     | OpenAPI                                 | Roles served        |
| --------- | ----------------------------- | -------------------------- | --------------------------------------- | ------------------- |
| auth      | http://localhost:3000/swagger | http://localhost:3000/docs | http://localhost:3000/docs/openapi.json | everyone (sign-in)  |
| owner     | http://localhost:3001/swagger | http://localhost:3001/docs | http://localhost:3001/docs/openapi.json | owner               |
| manager   | http://localhost:3002/swagger | http://localhost:3002/docs | http://localhost:3002/docs/openapi.json | manager, accountant |
| sales     | http://localhost:3003/swagger | http://localhost:3003/docs | http://localhost:3003/docs/openapi.json | salesperson         |
| warehouse | http://localhost:3004/swagger | http://localhost:3004/docs | http://localhost:3004/docs/openapi.json | warehouse           |
| delivery  | http://localhost:3005/swagger | http://localhost:3005/docs | http://localhost:3005/docs/openapi.json | delivery            |
| retailer  | http://localhost:3006/swagger | http://localhost:3006/docs | http://localhost:3006/docs/openapi.json | retailer            |

Owner app: http://localhost:5173 (`cd frontend && pnpm --filter @dos/owner-app dev`) — sign in with a username and password.
Database in DBeaver / pgAdmin: 127.0.0.1:5439, db `dos`, user `dos`, password `dos` (steps in `docs/21-local-database-setup.md`).

### Demo sign-in (every password is `Dos@1234`), tenant Tarsun Enterprises

| Role        | Name           | Username       |
| ----------- | -------------- | -------------- |
| owner       | Sunil Tarsun   | sunil.tarsun   |
| manager     | Vikas Kadam    | vikas.kadam    |
| accountant  | Meena Joshi    | meena.joshi    |
| warehouse   | Dinesh Patil   | dinesh.patil   |
| salesperson | Rahul Deshmukh | rahul.deshmukh |
| salesperson | Amit Pawar     | amit.pawar     |
| salesperson | Pooja Shinde   | pooja.shinde   |
| delivery    | Ganesh More    | ganesh.more    |
| delivery    | Raju Yadav     | raju.yadav     |
| retailer    | Ramesh Gupta   | ramesh.gupta   |
| retailer    | Fatima Shaikh  | fatima.shaikh  |

## Status by module

| Module                                                                                                  | Backend                                                 | App screens      |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------- |
| platform (tenancy, idempotency, sync, outbox, retention, storage)                                       | ✅ verified                                             | after backend    |
| auth (username + password, tokens, permission matrix)                                                   | ✅ verified (2026-09-04)                                | after backend    |
| catalog + tenant-catalog · retailers · pricing · inventory · procurement · orders                       | ✅ verified                                             | after backend    |
| 1 receivables                                                                                           | ✅ verified (2026-09-05)                                | after backend    |
| 2 billing                                                                                               | ✅ verified (2026-09-05)                                | after backend    |
| 3 warehouse                                                                                             | ✅ verified (2026-09-05, 962 tests, smoke 610/0 broken) | after backend    |
| 3b platform gaps (docs/23 in built modules, files + PDF, accountant scope, manager load-sheet approval) | 🔄 chain                                                | after backend    |
| 4 delivery · 5 docint · 6 integrations · 7 claims · 8 notifications · 9 reporting · 10 incentives       | ⏳ chained, one at a time                               | after backend    |
| 11 three distributors + shared shops demo, ledger partition plan                                        | ⏳ end of chain                                         | —                |
| six apps (layout A Ledger, design system being finalised)                                               | —                                                       | ⏳ after backend |

## Known gaps to fix in the next schema regeneration (0002 is still local-only)

- `sales_orders_retailer_update` RLS allows retailer updates only when `state = 'draft'`, but the orders service lets a retailer cancel a `submitted` order → widen the USING clause to `state IN ('draft','submitted')`.
- `order_state_transitions` has staff-only writes; the orders service temporarily sets `app.actor_role = 'system'` for a retailer's own cancel → add a retailer-write policy and delete that branch (`orders.internals.ts`).

## Next steps (in order)

1. Finish inventory + procurement (agent), wire, verify, update this log.
2. Migration 0004: review deltas from docs/17 §A + `app_worker` BYPASSRLS role; regenerate types; re-run all specs.
3. `pnpm install` to refresh the lockfile (console now depends on `@dos/contracts`); full workspace green; `/init` refresh of CLAUDE.md.
4. Permanent local Postgres 17 as a Homebrew service on 5439 (data outside the session scratchpad); `.env` at repo root; demo seed with dummy data (brands/products from the real invoices, 3 beats, ~30 retailers, price lists, schemes, stock, a week of orders/invoices/receipts, 2 vehicles, trips).
5. Console pages: pricing (price lists, schemes, bargains queue).
6. Orders module + console approvals; then warehouse/billing, receivables, delivery; then the team app (Expo) screens per role, then the retailer app.

## Session history

- 2026-09-04 (session 1–2): research + synthesis + skeleton; schema (121 tables incl. docs/17 deltas, RLS, ledgers); catalog, retailers, pricing, inventory, procurement, orders, sync modules (API 53 tests, DB 5, domain 50); console with dashboard/catalog/costs/retailers/pricing/orders; review corrections adopted (docs/17); permanent Postgres 17 service on 5439; Flow Atlas artifact + PDF; demo seed in flight at session end.
