# Merge review: group lean-admin-support (DOS-110, DOS-111, DOS-113, DOS-114), branch qa/b2-lean-admin-support

Fable, 2026-09-20. Read-only review of 9321019 (four commits, 39 files, +1320/−268) against the lean design `QA/evidence/batch2/verdicts/lean-lean-admin-support.md`, the four findings (QA/findings/07:137-268), the build report and the verifier's pass. Nothing run: no build, no test, no service; every claim below is from the diff and `git show` of the branch.

**Decision:** MERGE

The fix matches the design and its nine binding amendments, and no product rule moved. Checked by reading:

- **(a)/(b)/(c) one derivation.** `tenancy/support-status.ts` is the only `statusOf` and the only pair of SQL predicates in `modules/`; `grep function statusOf` finds one. Both services read the row's `expires_at` (request() writes `requestedAt + hours` into it, support.service.ts:80; approve() reads it, :125-133); nothing recomputes the deadline. `lapsed` is appended LAST, so samplers and `pnpm smoke` keep `requested`. platform-admin imports through `../tenancy/index.js`, the door it already used.
- **(d) revoke.** Both services throw 409 `request_expired` before the UPDATE, so `revoked_at` stays null; `rejected` still means the owner said no. approve()'s existing 409 untouched. **(i)** honoured: an expired-but-approved grant still records `revoked` (out of scope).
- **(e)/(f)/(g).** `askLapsed` is gone from both apps (the only hit is the test asserting its absence); the three console views send `status: 'approved' | 'requested' | none` and filter nothing on the device; the owner's `waiting` = server `requested` AND an offerable hour, else closed by default; `now` read once per `list()` on both services and once per render.
- **DOS-111.** Second insert in the SAME `withSystem` transaction: tenant id, `actorId` = the admin, `actorRole: 'platform_admin'`, `action: 'support.read'`, `entityType: 'support_grant'`, `entityId` = the grant, `after` = {grantId, scope, method, route, outcome}. `route` is the handler pattern (`GET /retailers`, tenant.guard.ts:137), never the URL, so no query string lands in the tenant's trail. Written for `refused` outcomes too. `audit_log` columns are text, no enum to widen; `tenancy.audit.list` filters by entityType/entityId/action (config.service.ts:403-406) and the owner reads it back in the spec.
- **DOS-113.** Source of truth = `tenants.plan` (what every service reads); the seed writes it into the subscription and repairs an old database with one UPDATE where they differ. The detail page prints the plan once via `planShown` (subscription first, tenant row only without one). `PLANS` in the editor includes `pilot`, so the pilot's subscription can be re-chosen.
- **DOS-114.** `(name, id)` keyset on the contract's opaque cursor, `users.name` is NOT NULL (tenancy.ts:136) so no row can fall out of the pair comparison; the poll effect returns early without a live window (`liveId`), so no `entityId=''` request after a hand-back; two singular keys picked from the LABEL ("1+" stays plural); the Subscriptions row action is gated on `can('admin.subscriptions.upsert')`.
- **Tests red before, not weakened.** Every new backend case fails on main at its first assertion (status `requested`; no `audit_log` row; id order). Every new frontend file imports a module that does not exist on main. The ONE existing assertion changed is seed-demo.test.ts `plan: 'pro' → 'pilot'`, forced by the design (one of the two seeded values had to move) and re-asserted by the new equality case. The owner `support.test.ts` "unknown status → closed" case keeps its rule with `'archived'`; the `lapsesAt − 1` / `lapsesAt` cases stay and hold under the hours rule.
- **Files outside the owned list.** All five deviations are named by the design's own Files list (tenancy/index.ts export line; owner support.ts + support.test.ts) or are dead-alias removal (platform-admin/index.ts: `supportGrantStatus` had no consumer, grep confirms). New files sit inside the two apps the group owns. Seven service READMEs changed because every service's docs render the tenancy contract; pure regeneration, `docs:readme:check` green.

## Blockers

None.

## Minors

1. `console.service.ts:513-520` `afterUser()`: a bare-id cursor from a pre-DOS-114 client restarts at page 1 (a loop for that client, not an error). Per-session, harmless after a reload. A later polish may answer 400 `bad_cursor` instead.
2. `contracts/src/admin.ts:318` openOnly comment still says "(requested, or approved and not yet expired)" and feeds admin-service README. One line; the integrator makes it at merge and re-runs `pnpm docs:readme` (the file belongs to no pending group).
3. `docs/23-app-screens-and-api-gaps.md:976` §10 row 12 still describes the device-side `askLapsed()`; mark done by DOS-110 at merge, with the QA/13 row and the docs/22 §11 line the design defers to the main session.
4. `seed-demo/platform-admin.ts:217-222`: the repair UPDATE runs on every `pnpm db:seed`, so re-seeding the founder's `dos` would move its three subscription rows to the tenant plan. Same spirit as the existing username repairs, but the standing rule (no change to `dos` without the founder's word) now covers `pnpm db:seed` too.
5. `distributors/index.tsx:94` still prints `row.plan` (the tenant column) while the detail chip prints the subscription's. They agree after the seed fix and on every product write; if they ever diverge again the list and the page will disagree. Acceptable; noted so nobody files it as new.
6. `dos-114-console.test.ts` and `plan.test.ts` guard the SOURCE (regex on `support.tsx`, `subscriptions.tsx`, `[id].tsx`), the pattern this repo uses where Metro-only screens cannot be imported in Node. A refactor that keeps the behaviour but reshapes the text fails them with a clear message.
7. `docs/examples.ts:1922-1928` keeps its own "requested and not lapsed" predicate for the owner's approve example. It is a sampler, not the product, and outside amendment (b)'s scope; `openGrants()` could replace it later.

## Conflicts

- **main:** merge base a808ba7; main has moved by one merge (4d57a04 lean-warehouse-stock). `git merge-tree --write-tree main qa/b2-lean-admin-support` produces a tree with no conflicts.
- **Pending groups sharing files:** lean-sales-orders-pricing, lean-owner-money-approvals, lean-manager-order-lifecycle (owner strings.ts), lean-retailer-platform and lean-warehouse-rules (contracts/tenancy.ts, owner settings/index.tsx, owner strings.ts). Every one lists lean-admin-support in its `after`, so they merge main after this and take these hunks; none is a concurrent edit. Service READMEs will collide textually with any later contract change: regenerate with `pnpm docs:readme`, never resolve README hunks by hand.

## Walks (none run here; owed by a gate that may start services)

- **Web 1280 and 390, admin + owner on dos_qa** (libs rebuilt, services restarted, `pnpm db:seed` re-run so the DOS-113 repair lands): the design's walk verbatim — psql-insert a lapsed 4 h ask against Tarsun, raise a fresh 1 h ask as dos.support; home tile "1 support request waiting for an owner" (singular); Support › Open now only live windows, Waiting only the fresh ask, All shows the lapsed row as "Lapsed, no answer" with the lapsed note and NO Withdraw; distributor panel "Our last ask lapsed at …" + Ask for support access; People in name order with page 2 continuing (no repeat, no gap); Subscriptions row "Change the plan" for super/billing, absent for support; Tarsun page shows ONE plan; hand the window back and record the network log — no 4xx. Owner sunil.tarsun › Settings › Support access: one card with Approve for 1 h + Refuse, the history chip "Lapsed" neutral, "What they have read under this window" listing the console's reads with route and time; Settings › Audit names the reader "Distribution OS staff".
- **API:** GET /tenancy/support-grants → lapsed row `status: 'lapsed'`, `expiresAt` null; `?status=requested` excludes it; POST approve and revoke on it → 409 `request_expired` on :3001 AND :3007.
- **Android Pixel_7_API_36 (-memory 3072):** admin home tile (a-01 was the Android evidence) and the distributor page's single plan (a-03); owner Settings › Support access reads panel at phone width.
- **iOS:** not owed by this group's findings (all filed on web/API/Android); covered by the A.12 regression's iOS sanity.
- **Smoke, reshaped gate:** `pnpm smoke --service owner` and `--service admin` — named operations `tenancy.support.list`, `tenancy.support.revoke`, `admin.support.list`, `admin.support.revoke`, `admin.users.list`, `tenancy.audit.list` read OK on a fresh seed and on a replay; no new BROKEN against main at a808ba7. Note the seed's only requested ask lapses 4 h after seeding, so a replay past that has no row for `tenancy.support.approve` (pre-existing; the harness must report SKIPPED, never BROKEN — S-156/S-157 direction).

## Defects outside the group

- `backend/delivery-service/README.md:1721` (and sales:1664, warehouse, retailer, manager): every service README documents `tenancy.support.*` — endpoints only the owner role may call and which these services answer 403 to — because the tenancy contract is rendered whole per service. Docs drift, P3, pre-existing; the generator should render a service's procedures by the permission matrix, not by contract key.
- `backend/libs/contracts/src/admin.ts:318`: stale openOnly wording (minor 2 above), outside this group's owned list.
